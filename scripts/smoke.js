import { randomUUID } from 'node:crypto'

const occurrenceId = '00000000-0000-4000-8000-000000000001'
const resourceId = '00000000-0000-4000-8000-000000000002'
const invalidInvitationToken = 'smoke-invalid-invitation-token'
const testSessionCookies = []

const routes = [
  ['GET', '/api/health'],
  ['GET', '/api/me'],
  ['POST', '/api/signup', {}],
  ['POST', '/api/login', { phone: '00000000000', pin: '000000' }],
  ['POST', '/api/organizer/login', { email: 'smoke@example.invalid', password: 'not-a-real-password' }],
  ['POST', '/api/invitations/accept', {}],
  ['GET', `/api/invitations/${invalidInvitationToken}`, undefined, true],
  ['POST', '/api/logout', {}],
  ['GET', '/api/events'],
  ['GET', '/api/modalities'],
  ['GET', '/api/my-registrations'],
  ['GET', `/api/occurrences/${occurrenceId}`],
  ['POST', `/api/occurrences/${occurrenceId}/join`, {}],
  ['POST', `/api/occurrences/${occurrenceId}/leave`, {}],
  ['POST', `/api/registrations/${resourceId}/notice-seen`, {}],
  ['PATCH', '/api/profile', {}],
  ['PATCH', '/api/profile/pin', {}],
  ['GET', '/api/admin/events'],
  ['POST', '/api/admin/events', {}],
  ['PATCH', `/api/admin/occurrences/${occurrenceId}`, {}],
  ['PATCH', `/api/admin/events/${resourceId}/close`, {}],
  ['PATCH', `/api/admin/registrations/${resourceId}/payment`, {}],
  ['DELETE', `/api/admin/registrations/${resourceId}`],
  ['GET', '/api/admin/people'],
  ['POST', `/api/admin/people/${resourceId}/reset-pin`, {}],
  ['DELETE', `/api/admin/people/${resourceId}`],
  ['GET', '/api/admin/audit'],
  ['GET', '/api/admin/modalities'],
  ['GET', '/api/admin/modalities/preview?name=Smoke%20Test'],
  ['POST', '/api/admin/modalities', {}],
  ['PATCH', `/api/admin/modalities/${resourceId}`, {}],
  ['PATCH', `/api/admin/modalities/${resourceId}/status`, {}],
  ['POST', `/api/admin/modalities/${resourceId}/merge`, {}],
  ['DELETE', `/api/admin/modalities/${resourceId}`],
  ['GET', '/api/owner/organizers'],
  ['POST', '/api/owner/invitations', {}],
  ['DELETE', `/api/owner/invitations/${resourceId}`],
  ['DELETE', `/api/owner/organizers/${resourceId}`],
  ['PATCH', '/api/owner/settings', {}]
]

function isJson(contentType) {
  return /^application\/json(?:\s*;|$)/i.test(contentType || '')
}

function appHeaders(cookie) {
  const headers = { Accept: 'application/json' }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }
  if (cookie) headers.Cookie = cookie
  return headers
}

async function request(baseUrl, method, path, body, cookie) {
  const url = new URL(path, baseUrl)
  const headers = appHeaders(cookie)
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(url, init)
  } catch {
    return { ok: false, message: `${method} ${path}: conexão falhou` }
  }

  const requestId = response.headers.get('x-request-id')
  const contentType = response.headers.get('content-type')
  let payload
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      message: `${method} ${path}: HTTP ${response.status}, resposta não JSON, x-request-id=${requestId || 'ausente'}`,
      status: response.status
    }
  }

  if (!isJson(contentType) || !requestId) {
    return {
      ok: false,
      message: `${method} ${path}: HTTP ${response.status}, JSON=${isJson(contentType)}, x-request-id=${requestId || 'ausente'}`,
      status: response.status
    }
  }
  if (response.status >= 500) {
    return {
      ok: false,
      message: `${method} ${path}: HTTP ${response.status}, erro do servidor (${payload?.error?.code || 'sem código'}), requestId ${requestId}`,
      status: response.status,
      payload,
      requestId
    }
  }
  if (payload?.requestId && payload.requestId !== requestId) {
    return {
      ok: false,
      message: `${method} ${path}: requestId do corpo difere do header`,
      status: response.status,
      payload,
      requestId
    }
  }

  return { ok: true, status: response.status, payload, requestId, response }
}

async function requestXlsx(baseUrl, path, cookie) {
  const url = new URL(path, baseUrl)
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: appHeaders(cookie),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    })
  } catch {
    return { ok: false, message: `GET ${path}: conexão falhou` }
  }
  const requestId = response.headers.get('x-request-id')
  const contentType = response.headers.get('content-type') || ''
  if (response.status >= 500) {
    return { ok: false, message: `GET ${path}: HTTP ${response.status}, erro do servidor, requestId ${requestId || 'ausente'}` }
  }
  if (response.status !== 200 || !/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet(?:\s*;|$)/i.test(contentType)) {
    const payload = await response.json().catch(() => null)
    return {
      ok: false,
      message: `GET ${path}: HTTP ${response.status}, content-type ${contentType || 'ausente'}, erro ${payload?.error?.code || 'sem código'}, requestId ${requestId || 'ausente'}`
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || !requestId) {
    return { ok: false, message: `GET ${path}: arquivo XLSX inválido ou requestId ausente` }
  }
  return { ok: true, requestId }
}

async function checkRoute(baseUrl, [method, path, body], expectedRoute404 = false, expectedMethodNotAllowed = false) {
  const result = await request(baseUrl, method, path, body)
  if (!result.ok) return result
  const code = result.payload?.error?.code

  if (result.status === 405) {
    if (expectedMethodNotAllowed && code === 'METHOD_NOT_ALLOWED') {
      return { ok: true, message: `${method} ${path}: HTTP 405 JSON do app` }
    }
    return { ok: false, message: `${method} ${path}: HTTP 405 inesperado (${code || 'sem código'})` }
  }
  if (expectedMethodNotAllowed) {
    return { ok: false, message: `${method} ${path}: esperado 405 JSON do app; recebido HTTP ${result.status}` }
  }
  if (result.status === 404) {
    if (expectedRoute404) {
      if (code !== 'ROUTE_NOT_FOUND') {
        return { ok: false, message: `${method} ${path}: esperado ROUTE_NOT_FOUND; recebido ${code || 'sem código'}` }
      }
    } else if (code === 'ROUTE_NOT_FOUND' || !code) {
      return { ok: false, message: `${method} ${path}: rota não encontrada no app (${code || 'sem código'})` }
    }
  }
  if (expectedRoute404 && result.status !== 404) {
    return { ok: false, message: `${method} ${path}: esperado HTTP 404 JSON do app; recebido HTTP ${result.status}` }
  }

  return { ok: true, message: `${method} ${path}: HTTP ${result.status}, requestId ${result.requestId}` }
}

function sessionCookie(response) {
  const value = response.headers.get('set-cookie') || ''
  const cookie = value.split(';', 1)[0]
  if (!cookie.startsWith('ethos_session=')) return null
  testSessionCookies.push(cookie)
  return cookie
}

function registrationsFor(detail, personId) {
  return (detail?.registrations || []).filter(registration => registration.person_id === personId)
}

function requireStatus(result, statuses, label) {
  if (!result.ok) throw new Error(`${label}: ${result.message}`)
  if (!statuses.includes(result.status)) {
    throw new Error(`${label}: HTTP ${result.status} inesperado (${result.payload?.error?.code || 'sem código'})`)
  }
  return result
}

async function credentialedFlow(baseUrl) {
  const variables = [
    'SMOKE_PERSON_PHONE',
    'SMOKE_PERSON_PIN',
    'SMOKE_ORGANIZER_EMAIL',
    'SMOKE_ORGANIZER_PASSWORD',
    'SMOKE_OCCURRENCE_ID'
  ]
  const supplied = variables.filter(name => process.env[name])
  if (supplied.length === 0) {
    console.log('SKIP fluxos autenticados: configure as variáveis SMOKE_* para habilitá-los.')
    return 0
  }
  if (supplied.length !== variables.length) {
    console.error(`FAIL fluxos autenticados: configure todas as variáveis ${variables.join(', ')}.`)
    return 1
  }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(process.env.SMOKE_OCCURRENCE_ID)) {
    console.error('FAIL fluxos autenticados: SMOKE_OCCURRENCE_ID deve ser um UUID.')
    return 1
  }

  const personLogin = requireStatus(
    await request(baseUrl, 'POST', '/api/login', {
      phone: process.env.SMOKE_PERSON_PHONE,
      pin: process.env.SMOKE_PERSON_PIN
    }),
    [200],
    'Login de participante'
  )
  const personCookie = sessionCookie(personLogin.response)
  const personId = personLogin.payload?.user?.id
  if (!personCookie || !personId) throw new Error('Login de participante: sessão ou usuário não retornados.')
  console.log('PASS POST /api/login: credenciais de teste autenticadas')

  const organizerLogin = requireStatus(
    await request(baseUrl, 'POST', '/api/organizer/login', {
      email: process.env.SMOKE_ORGANIZER_EMAIL,
      password: process.env.SMOKE_ORGANIZER_PASSWORD
    }),
    [200],
    'Login de organizador'
  )
  const organizerCookie = sessionCookie(organizerLogin.response)
  if (!organizerCookie) throw new Error('Login de organizador: cookie de sessão não retornado.')
  console.log('PASS POST /api/organizer/login: credenciais de teste autenticadas')

  const occurrencePath = `/api/occurrences/${process.env.SMOKE_OCCURRENCE_ID}`
  const initialDetail = requireStatus(
    await request(baseUrl, 'GET', occurrencePath, undefined, personCookie),
    [200],
    'Carregamento inicial do detalhe'
  ).payload
  console.log('PASS GET detalhe: ocorrência existente alcançada pelo participante')

  const modalityId = initialDetail.occurrence?.modality_id
  if (!modalityId) throw new Error('Fixture inválido: o detalhe não retornou a modalidade da ocorrência.')
  const reportPath = `/api/admin/modalities/${modalityId}/report.xlsx`
  requireStatus(
    await request(baseUrl, 'GET', reportPath, undefined, personCookie),
    [403],
    'Negação do relatório para participante'
  )
  const report = await requestXlsx(baseUrl, reportPath, organizerCookie)
  if (!report.ok) throw new Error(`Relatório XLSX do organizador: ${report.message}`)
  console.log(`PASS GET relatório XLSX: HTTP 200, content-type XLSX, requestId ${report.requestId}`)

  const missingOccurrence = await request(
    baseUrl,
    'GET',
    `/api/occurrences/${randomUUID()}`,
    undefined,
    personCookie
  )
  if (!missingOccurrence.ok || missingOccurrence.status !== 404 ||
      missingOccurrence.payload?.error?.code !== 'RESOURCE_NOT_FOUND') {
    throw new Error('GET ocorrência inexistente: esperado 404 RESOURCE_NOT_FOUND JSON do app.')
  }
  console.log('PASS GET ocorrência inexistente: 404 JSON do app')

  if (process.env.SMOKE_RUN_MUTATIONS !== '1') {
    console.log('SKIP join/leave/remoção: defina SMOKE_RUN_MUTATIONS=1 para habilitar operações destrutivas no fixture de teste.')
    return 0
  }

  const occurrence = initialDetail.occurrence
  const currentRegistrations = registrationsFor(initialDetail, personId)
  const confirmedCount = (initialDetail.registrations || []).filter(row => row.situation === 'confirmed').length
  const cutoffAt = new Date(occurrence.starts_at).getTime() - Number(occurrence.cutoff_hours || 0) * 3600000
  if (currentRegistrations.length) {
    throw new Error('Fixture inválido: o participante de teste já está inscrito; não alterei essa inscrição.')
  }
  if (!occurrence.open || cutoffAt <= Date.now() || confirmedCount >= occurrence.seats) {
    throw new Error('Fixture inválido: use uma ocorrência aberta, antes do fechamento e com vaga confirmada disponível.')
  }

  const cleanup = async () => {
    const detailResult = await request(baseUrl, 'GET', occurrencePath, undefined, organizerCookie)
    if (!detailResult.ok || detailResult.status !== 200) {
      throw new Error(`Limpeza do fixture: ${detailResult.message || `HTTP ${detailResult.status}`}`)
    }
    const registration = registrationsFor(detailResult.payload, personId)[0]
    if (!registration) return
    const removeResult = await request(
      baseUrl,
      'DELETE',
      `/api/admin/registrations/${registration.id}`,
      undefined,
      organizerCookie
    )
    requireStatus(removeResult, [200], 'Limpeza da inscrição de teste')
  }

  try {
    const joined = requireStatus(
      await request(baseUrl, 'POST', `${occurrencePath}/join`, {}, personCookie),
      [201],
      'Entrada no evento'
    )
    if (joined.payload?.situation !== 'confirmed') {
      throw new Error('Fixture inválido: o participante não obteve vaga confirmada; teste de leave cancelado.')
    }
    console.log('PASS POST join: participante entrou em vaga confirmada')

    const afterJoin = requireStatus(
      await request(baseUrl, 'GET', occurrencePath, undefined, personCookie),
      [200],
      'Recarregamento do detalhe após join'
    ).payload
    if (!registrationsFor(afterJoin, personId).some(row => row.situation === 'confirmed')) {
      throw new Error('Recarregamento após join: inscrição confirmada não apareceu.')
    }
    console.log('PASS GET detalhe após join')

    requireStatus(
      await request(baseUrl, 'POST', `${occurrencePath}/leave`, {}, personCookie),
      [200],
      'Saída do evento'
    )
    const afterLeave = requireStatus(
      await request(baseUrl, 'GET', occurrencePath, undefined, personCookie),
      [200],
      'Recarregamento do detalhe após leave'
    ).payload
    if (registrationsFor(afterLeave, personId).length) {
      throw new Error('Recarregamento após leave: a inscrição do participante ainda aparece.')
    }
    console.log('PASS POST leave e GET detalhe após leave')

    const joinedAgain = requireStatus(
      await request(baseUrl, 'POST', `${occurrencePath}/join`, {}, personCookie),
      [201],
      'Nova entrada antes do teste de remoção pelo organizador'
    )
    if (joinedAgain.payload?.situation !== 'confirmed') {
      throw new Error('Fixture inválido: não foi possível recuperar a vaga confirmada para testar remoção.')
    }
    const organizerDetail = requireStatus(
      await request(baseUrl, 'GET', occurrencePath, undefined, organizerCookie),
      [200],
      'Carregamento do detalhe pelo organizador'
    ).payload
    const registration = registrationsFor(organizerDetail, personId)[0]
    if (!registration) throw new Error('Detalhe do organizador: inscrição de teste não foi encontrada.')

    requireStatus(
      await request(baseUrl, 'DELETE', `/api/admin/registrations/${registration.id}`, undefined, organizerCookie),
      [200],
      'Remoção da inscrição pelo organizador'
    )
    const afterRemoval = requireStatus(
      await request(baseUrl, 'GET', occurrencePath, undefined, organizerCookie),
      [200],
      'Recarregamento do detalhe após remoção'
    ).payload
    if (registrationsFor(afterRemoval, personId).length) {
      throw new Error('Recarregamento após remoção: a inscrição do participante ainda aparece.')
    }
    console.log('PASS DELETE inscrição e GET detalhe após remoção')
  } finally {
    await cleanup()
  }

  return 0
}

async function main() {
  const input = process.argv[2]
  if (!input) {
    console.error('Uso: npm run smoke -- <URL-base>')
    process.exitCode = 2
    return
  }

  let baseUrl
  try {
    baseUrl = new URL(input.endsWith('/') ? input : `${input}/`)
  } catch {
    console.error('Informe uma URL-base válida, incluindo https://.')
    process.exitCode = 2
    return
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    console.error('A URL-base deve usar HTTP ou HTTPS.')
    process.exitCode = 2
    return
  }

  let routeFailures = 0
  for (const route of routes) {
    const result = await checkRoute(baseUrl, route)
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.message}`)
    if (!result.ok) routeFailures++
  }

  const unauthenticatedReport = await request(
    baseUrl,
    'GET',
    `/api/admin/modalities/${resourceId}/report.xlsx`
  )
  const reportAuthOk = unauthenticatedReport.ok && [401, 403].includes(unauthenticatedReport.status)
  console.log(`${reportAuthOk ? 'PASS' : 'FAIL'} GET relatório XLSX sem sessão: ${unauthenticatedReport.status || 'sem resposta'}, requestId ${unauthenticatedReport.requestId || 'ausente'}`)
  if (!reportAuthOk) routeFailures++

  const unknown = await checkRoute(baseUrl, ['GET', '/api/__smoke_route_that_does_not_exist__'], true)
  console.log(`${unknown.ok ? 'PASS' : 'FAIL'} ${unknown.message}`)
  if (!unknown.ok) routeFailures++

  const wrongMethod = await checkRoute(
    baseUrl,
    ['GET', `/api/occurrences/${occurrenceId}/join`],
    false,
    true
  )
  console.log(`${wrongMethod.ok ? 'PASS' : 'FAIL'} ${wrongMethod.message}`)
  if (!wrongMethod.ok) routeFailures++

  let flowFailures = 0
  try {
    flowFailures += await credentialedFlow(baseUrl)
  } catch (error) {
    console.error(`FAIL fluxos autenticados: ${error.message}`)
    flowFailures++
  }
  for (const cookie of testSessionCookies) {
    const logout = await request(baseUrl, 'POST', '/api/logout', {}, cookie)
    if (!logout.ok || logout.status !== 200) {
      console.error(`FAIL logout da sessão de teste: ${logout.message || `HTTP ${logout.status}`}`)
      flowFailures++
    } else {
      console.log('PASS POST /api/logout: sessão de teste encerrada')
    }
  }

  console.log(`\nRotas: ${routes.length + 2 - routeFailures}/${routes.length + 2} passaram; fluxos: ${flowFailures ? 'com falha' : 'sem falha'}.`)
  if (routeFailures || flowFailures) process.exitCode = 1
}

main().catch(error => {
  console.error(`Smoke test falhou: ${error.message}`)
  process.exitCode = 1
})
