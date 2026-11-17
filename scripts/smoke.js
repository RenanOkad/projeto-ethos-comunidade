const occurrenceId = '00000000-0000-4000-8000-000000000001'
const resourceId = '00000000-0000-4000-8000-000000000002'
const invalidInvitationToken = 'smoke-invalid-invitation-token'

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

async function checkRoute(
  baseUrl,
  [method, path, body, resourceNotFoundExpected],
  expectedRoute404 = false,
  expectedMethodNotAllowed = false
) {
  const url = new URL(path, baseUrl)
  const headers = { Accept: 'application/json' }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    return { ok: false, message: `${method} ${path}: conexão falhou (${error.message})` }
  }
  const requestId = response.headers.get('x-request-id')
  const contentType = response.headers.get('content-type')
  let payload
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      message: `${method} ${path}: HTTP ${response.status}, resposta não JSON, x-request-id=${requestId || 'ausente'}`
    }
  }

  if (!isJson(contentType) || !requestId) {
    return {
      ok: false,
      message: `${method} ${path}: HTTP ${response.status}, JSON=${isJson(contentType)}, x-request-id=${requestId || 'ausente'}`
    }
  }
  if (response.status === 405) {
    if (expectedMethodNotAllowed && payload?.error?.code === 'METHOD_NOT_ALLOWED') {
      return { ok: true, message: `${method} ${path}: HTTP 405 JSON do app` }
    }
    return { ok: false, message: `${method} ${path}: método não atendido pelo app (405)` }
  }
  if (response.status === 404) {
    const code = payload?.error?.code
    if (expectedRoute404 ? code !== 'ROUTE_NOT_FOUND' : (!resourceNotFoundExpected || code === 'ROUTE_NOT_FOUND')) {
      return { ok: false, message: `${method} ${path}: rota não encontrada no app (${code || 'sem código'})` }
    }
  }
  if (payload?.requestId && payload.requestId !== requestId) {
    return { ok: false, message: `${method} ${path}: requestId do corpo difere do header` }
  }

  return { ok: true, message: `${method} ${path}: HTTP ${response.status}, requestId ${requestId}` }
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

  let failures = 0
  for (const route of routes) {
    const result = await checkRoute(baseUrl, route)
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.message}`)
    if (!result.ok) failures++
  }

  const unknown = await checkRoute(baseUrl, ['GET', '/api/__smoke_route_that_does_not_exist__'], true)
  console.log(`${unknown.ok ? 'PASS' : 'FAIL'} ${unknown.message}`)
  if (!unknown.ok) failures++

  const wrongMethod = await checkRoute(
    baseUrl,
    ['GET', `/api/occurrences/${occurrenceId}/join`],
    false,
    true
  )
  console.log(`${wrongMethod.ok ? 'PASS' : 'FAIL'} ${wrongMethod.message}`)
  if (!wrongMethod.ok) failures++

  console.log(`\n${routes.length + 2 - failures}/${routes.length + 2} verificações passaram.`)
  if (failures) process.exitCode = 1
}

main().catch(error => {
  console.error(`Smoke test falhou: ${error.message}`)
  process.exitCode = 1
})
