import ExcelJS from 'exceljs'

const TIME_ZONE = 'America/Sao_Paulo'

function localDateParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value))
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
}

function formatLocalDateTime(value) {
  const parts = localDateParts(value)
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`
}

function toLocalExcelDate(value) {
  const parts = localDateParts(value)
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  ))
}

function worksheetName(eventName, startsAt, usedNames) {
  const date = formatLocalDateTime(startsAt).slice(0, 10).replaceAll('/', '-')
  const cleaned = `${eventName} ${date}`
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '') || 'Evento'
  const base = cleaned.slice(0, 31)
  let name = base
  let suffixNumber = 2
  while (usedNames.has(name.toLocaleLowerCase('pt-BR'))) {
    const suffix = ` (${suffixNumber++})`
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`
  }
  usedNames.add(name.toLocaleLowerCase('pt-BR'))
  return name
}

function writeLiteral(cell, value) {
  const text = String(value ?? '')
  cell.value = text
  cell.numFmt = '@'
}

function countFormula(firstRow, lastRow) {
  return `COUNTIF(B${firstRow}:B${lastRow},"?*")-COUNTIF(B${firstRow}:B${lastRow},"Ninguém nesta lista")`
}

function addTable(worksheet, { name, headerRow, headers, rows, headerColor, headerFontColor }) {
  const values = rows.length ? rows : [headers.map((_, index) => index === 1 ? 'Ninguém nesta lista' : null)]
  worksheet.addTable({
    name,
    ref: `A${headerRow}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: headers.map(header => ({ name: header, filterButton: true })),
    rows: values
  })

  const lastRow = headerRow + values.length
  for (let column = 1; column <= headers.length; column += 1) {
    const cell = worksheet.getCell(headerRow, column)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } }
    cell.font = { bold: true, color: { argb: headerFontColor } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  }
  worksheet.getRow(headerRow).height = 30

  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= headers.length; column += 1) {
      const cell = worksheet.getCell(row, column)
      const value = cell.value
      if (value instanceof Date) {
        cell.value = toLocalExcelDate(value)
        cell.numFmt = 'dd/mm/yyyy hh:mm'
      } else if (typeof value === 'string') {
        writeLiteral(cell, value)
      }
      cell.alignment = { vertical: 'middle' }
    }
  }

  return { firstRow: headerRow + 1, lastRow }
}

function addSectionTitle(worksheet, row, title, fillColor, fontColor) {
  worksheet.mergeCells(row, 1, row, 5)
  const cell = worksheet.getCell(row, 1)
  writeLiteral(cell, title)
  cell.font = { bold: true, color: { argb: fontColor }, size: 12 }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }
  cell.alignment = { vertical: 'middle' }
  worksheet.getRow(row).height = 24
}

function createOccurrenceSheet(workbook, modality, occurrence, generatedAt, usedNames, sheetIndex) {
  const event = occurrence.event
  const worksheet = workbook.addWorksheet(worksheetName(event.name, occurrence.starts_at, usedNames))
  const registrations = occurrence.registrations || []
  const confirmed = registrations
    .filter(registration => registration.situation === 'confirmed')
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
  const pending = confirmed.filter(registration => registration.payment !== 'paid')
  const paid = confirmed.filter(registration => registration.payment === 'paid')
  const waitlist = registrations
    .filter(registration => registration.situation === 'waitlist')
    .sort((left, right) => left.wait_position - right.wait_position)

  worksheet.mergeCells('A1:H1')
  writeLiteral(worksheet.getCell('A1'), `${event.name} · ${modality.name}`)
  worksheet.getCell('A1').font = { bold: true, color: { argb: 'FF1B4F1F' }, size: 16 }
  worksheet.getCell('A1').alignment = { vertical: 'middle', wrapText: true }
  worksheet.getRow(1).height = 28

  worksheet.mergeCells('A2:H2')
  writeLiteral(worksheet.getCell('A2'), `Relatório gerado em: ${formatLocalDateTime(generatedAt)}`)
  worksheet.getCell('A2').font = { bold: true, color: { argb: 'FF1A261B' }, size: 12 }
  worksheet.getRow(2).height = 22

  worksheet.mergeCells('A3:H3')
  writeLiteral(worksheet.getCell('A3'), `Data e horário do evento: ${formatLocalDateTime(occurrence.starts_at)}`)
  worksheet.getCell('A3').font = { color: { argb: 'FF4A505A' }, size: 11 }

  const summaryLabels = [
    'Total de inscritos', 'Pagos', 'Pendentes', 'Valor por pessoa',
    'Total arrecadado', 'Total pendente', 'Vagas', 'Lista de espera'
  ]
  summaryLabels.forEach((label, index) => {
    const cell = worksheet.getCell(5, index + 1)
    writeLiteral(cell, label)
    cell.font = { bold: true, color: { argb: 'FF1A261B' }, size: 9 }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EBDD' } }
  })

  const pendingHeaderRow = 9
  addSectionTitle(worksheet, 8, 'NÃO PAGARAM', 'FFFCE4D6', 'FF7F2704')
  const pendingRange = addTable(worksheet, {
    name: `Pending${sheetIndex}`,
    headerRow: pendingHeaderRow,
    headers: ['Nº', 'Nome', 'Telefone', 'Data da inscrição'],
    rows: pending.map((registration, index) => [
      index + 1, registration.person.name, registration.person.phone, new Date(registration.created_at)
    ]),
    headerColor: 'FFF4B183',
    headerFontColor: 'FF7F2704'
  })

  const paidTitleRow = pendingRange.lastRow + 3
  addSectionTitle(worksheet, paidTitleRow, 'PAGARAM', 'FF1B4F1F', 'FFFFFFFF')
  const paidRange = addTable(worksheet, {
    name: `Paid${sheetIndex}`,
    headerRow: paidTitleRow + 1,
    headers: ['Nº', 'Nome', 'Telefone', 'Data da inscrição', 'Data do pagamento'],
    rows: paid.map((registration, index) => [
      index + 1,
      registration.person.name,
      registration.person.phone,
      new Date(registration.created_at),
      registration.paid_at ? new Date(registration.paid_at) : null
    ]),
    headerColor: 'FF1B4F1F',
    headerFontColor: 'FFFFFFFF'
  })

  const waitlistTitleRow = paidRange.lastRow + 3
  addSectionTitle(worksheet, waitlistTitleRow, 'LISTA DE ESPERA', 'FFECE9E1', 'FF4A505A')
  const waitlistRange = addTable(worksheet, {
    name: `Waitlist${sheetIndex}`,
    headerRow: waitlistTitleRow + 1,
    headers: ['Posição', 'Nome', 'Telefone', 'Data de entrada na espera'],
    rows: waitlist.map(registration => [
      registration.wait_position,
      registration.person.name,
      registration.person.phone,
      new Date(registration.created_at)
    ]),
    headerColor: 'FFECE9E1',
    headerFontColor: 'FF4A505A'
  })

  const summaryValues = [
    { formula: 'SUM(B6:C6,H6)', result: registrations.length },
    { formula: countFormula(paidRange.firstRow, paidRange.lastRow), result: paid.length },
    { formula: countFormula(pendingRange.firstRow, pendingRange.lastRow), result: pending.length },
    occurrence.price_cents / 100,
    { formula: `SUM(I${paidRange.firstRow}:I${paidRange.lastRow})`, result: paid.length * occurrence.price_cents / 100 },
    { formula: `SUM(I${pendingRange.firstRow}:I${pendingRange.lastRow})`, result: pending.length * occurrence.price_cents / 100 },
    occurrence.seats,
    { formula: countFormula(waitlistRange.firstRow, waitlistRange.lastRow), result: waitlist.length }
  ]
  summaryValues.forEach((value, index) => {
    const cell = worksheet.getCell(6, index + 1)
    cell.value = typeof value === 'object' ? { formula: value.formula, result: value.result } : value
    cell.font = { bold: true, color: { argb: 'FF1B4F1F' }, size: 11 }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  for (const cell of ['D6', 'E6', 'F6']) worksheet.getCell(cell).numFmt = '"R$" #,##0.00'

  for (const row of [...Array.from({ length: pendingRange.lastRow - pendingRange.firstRow + 1 }, (_, index) => pendingRange.firstRow + index),
    ...Array.from({ length: paidRange.lastRow - paidRange.firstRow + 1 }, (_, index) => paidRange.firstRow + index)]) {
    const nameCell = worksheet.getCell(row, 2)
    worksheet.getCell(row, 9).value = {
      formula: `IF(AND(B${row}<>"",B${row}<>"Ninguém nesta lista"),$D$6,0)`,
      result: nameCell.value && nameCell.value !== 'Ninguém nesta lista' ? occurrence.price_cents / 100 : 0
    }
  }
  worksheet.getColumn(9).hidden = true
  worksheet.getColumn(1).width = 11
  worksheet.getColumn(2).width = 32
  worksheet.getColumn(3).width = 20
  worksheet.getColumn(4).width = 22
  worksheet.getColumn(5).width = 22
  worksheet.getColumn(7).width = 16
  worksheet.getColumn(8).width = 18
  worksheet.getColumn(6).width = 20
  worksheet.getColumn(3).numFmt = '@'
  worksheet.views = [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7' }]
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:6',
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  }
  worksheet.pageSetup.printArea = `A1:H${waitlistRange.lastRow}`
  workbook.calcProperties = { fullCalcOnLoad: true, forceFullCalc: true }
  return worksheet
}

export async function generateModalityReport({ modality, occurrences, generatedAt = new Date() }) {
  if (!occurrences.length) {
    const error = new Error('Não há eventos elegíveis para exportar.')
    error.code = 'REPORT_NO_OCCURRENCES'
    error.status = 404
    throw error
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ethos Tribo'
  workbook.created = generatedAt
  workbook.modified = generatedAt
  const usedNames = new Set()
  occurrences.forEach((occurrence, index) => createOccurrenceSheet(
    workbook, modality, occurrence, generatedAt, usedNames, index + 1
  ))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
