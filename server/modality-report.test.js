import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { generateModalityReport } from './modality-report.js'

const modality = { id: 'modality-1', name: 'Vôlei' }

function occurrence({ name = 'Evento [especial]: Vôlei', registrations = [] } = {}) {
  return {
    id: 'occurrence-1',
    starts_at: '2026-12-01T22:00:00.000Z',
    ends_at: '2026-12-02T00:00:00.000Z',
    seats: 16,
    price_cents: 5000,
    event: { id: 'event-1', name },
    registrations
  }
}

const registrations = [
  {
    id: 'pending-1',
    situation: 'confirmed',
    payment: 'pending',
    wait_position: null,
    created_at: '2026-11-01T12:00:00.000Z',
    paid_at: null,
    person: { name: '=HYPERLINK("https://example.invalid","Pessoa")', phone: '00123456789' }
  },
  {
    id: 'paid-1',
    situation: 'confirmed',
    payment: 'paid',
    wait_position: null,
    created_at: '2026-11-02T12:00:00.000Z',
    paid_at: '2026-11-03T15:45:00.000Z',
    person: { name: 'Pessoa paga', phone: '0055987654321' }
  },
  {
    id: 'wait-1',
    situation: 'waitlist',
    payment: 'pending',
    wait_position: 1,
    created_at: '2026-11-04T12:00:00.000Z',
    paid_at: null,
    person: { name: 'Pessoa em espera', phone: '000011112222' }
  }
]

async function loadReport(occurrences) {
  const buffer = await generateModalityReport({
    modality,
    occurrences,
    generatedAt: new Date('2026-11-20T13:30:00.000Z')
  })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook
}

test('workbook reports local dates, payment counts, waitlist, and literal text phones', async () => {
  const workbook = await loadReport([occurrence({ registrations })])
  assert.equal(workbook.worksheets.length, 1)
  const worksheet = workbook.worksheets[0]

  assert.equal(worksheet.getCell('A2').value, 'Relatório gerado em: 20/11/2026 10:30')
  assert.equal(worksheet.getCell('A3').value, 'Data e horário do evento: 01/12/2026 19:00')
  assert.equal(worksheet.getCell('A6').value.result, 3)
  assert.equal(worksheet.getCell('A6').value.formula, 'SUM(B6:C6,H6)')
  assert.equal(worksheet.getCell('B6').value.result, 1)
  assert.equal(worksheet.getCell('C6').value.result, 1)
  assert.equal(worksheet.getCell('E6').value.result, 50)
  assert.equal(worksheet.getCell('E6').value.formula, 'SUM(I15:I15)')
  assert.equal(worksheet.getCell('F6').value.result, 50)
  assert.equal(worksheet.getCell('F6').value.formula, 'SUM(I10:I10)')
  assert.equal(worksheet.getCell('D6').value, 50)
  assert.equal(worksheet.getCell('G6').value, 16)
  assert.equal(worksheet.getCell('H6').value.result, 1)
  assert.equal(worksheet.getCell('B10').value, '=HYPERLINK("https://example.invalid","Pessoa")')
  assert.equal(worksheet.getCell('B10').type, ExcelJS.ValueType.String)
  assert.equal(worksheet.getCell('B10').value.formula, undefined)
  assert.equal(worksheet.getCell('C10').value, '00123456789')
  assert.equal(worksheet.getCell('C10').numFmt, '@')
  assert.equal(worksheet.getCell('D10').value.toISOString(), '2026-11-01T09:00:00.000Z')
  assert.equal(worksheet.getCell('C15').value, '0055987654321')
  assert.equal(worksheet.getCell('D15').numFmt, 'dd/mm/yyyy hh:mm')
  assert.equal(worksheet.getCell('E15').numFmt, 'dd/mm/yyyy hh:mm')
  assert.equal(worksheet.getCell('A20').value, 1)
  assert.equal(worksheet.getCell('B20').value, 'Pessoa em espera')
  assert.equal(worksheet.views[0].state, 'frozen')
  assert.equal(worksheet.pageSetup.paperSize, 9)
  assert.equal(worksheet.pageSetup.orientation, 'portrait')
  assert.equal(worksheet.pageSetup.fitToWidth, 1)
  assert.equal(worksheet.getColumn(9).hidden, true)
  assert.equal(worksheet.getColumn(6).hidden, false)
  assert.equal(Object.keys(worksheet.tables).length, 3)
})

test('worksheet names are valid, limited to 31 characters, and made unique', async () => {
  const longName = 'Evento / [especial]: nome muito longo repetido'
  const first = occurrence({ name: longName })
  const second = { ...first, id: 'occurrence-2', event: { ...first.event, id: 'event-2' } }
  const workbook = await loadReport([first, second])
  const names = workbook.worksheets.map(worksheet => worksheet.name)

  assert.equal(names.length, 2)
  assert.ok(names.every(name => name.length <= 31))
  assert.ok(names.every(name => !/[\[\]:*?/\\]/.test(name)))
  assert.notEqual(names[0].toLocaleLowerCase(), names[1].toLocaleLowerCase())
})

test('empty occurrence lists are rejected instead of producing an empty workbook', async () => {
  await assert.rejects(
    generateModalityReport({ modality, occurrences: [] }),
    error => error.code === 'REPORT_NO_OCCURRENCES'
  )
})

test('empty payment and waitlist blocks remain visible and contribute zero to formulas', async () => {
  const workbook = await loadReport([occurrence()])
  const worksheet = workbook.worksheets[0]

  assert.equal(worksheet.getCell('B10').value, 'Ninguém nesta lista')
  assert.equal(worksheet.getCell('B15').value, 'Ninguém nesta lista')
  assert.equal(worksheet.getCell('B20').value, 'Ninguém nesta lista')
  assert.equal(worksheet.getCell('A6').value.formula, 'SUM(B6:C6,H6)')
  assert.equal(worksheet.getCell('A6').value.result ?? 0, 0)
  assert.equal(worksheet.getCell('E6').value.result ?? 0, 0)
  assert.equal(worksheet.getCell('F6').value.result ?? 0, 0)
})

test('unpaid registrations are oldest-first and the waitlist follows its position', async () => {
  const newerWaitlist = { ...registrations[2], id: 'wait-2', wait_position: 2, person: { name: 'Espera 2', phone: '0002' } }
  const olderPending = {
    ...registrations[0],
    id: 'pending-older',
    created_at: '2026-10-31T12:00:00.000Z',
    person: { name: 'Pendente antigo', phone: '0001' }
  }
  const workbook = await loadReport([occurrence({ registrations: [
    registrations[0], newerWaitlist, registrations[1], olderPending,
    { ...registrations[2], id: 'wait-1', wait_position: 1 }
  ] })])
  const worksheet = workbook.worksheets[0]

  assert.equal(worksheet.getCell('B10').value, 'Pendente antigo')
  assert.equal(worksheet.getCell('B11').value, '=HYPERLINK("https://example.invalid","Pessoa")')
  assert.equal(worksheet.getCell('A21').value, 1)
  assert.equal(worksheet.getCell('A22').value, 2)
})
