import express from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAuthClient, result, rpc, supabase } from './db.js'
import { isValidModalityName, modalityDistance, normalizeModality, withCounts } from './event-utils.js'
import { errorDetails, log } from './logger.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const production = process.env.NODE_ENV === 'production'
const appUrl = process.env.APP_URL || 'http://localhost:5173'
const configuredOrigin = production ? '' : new URL(appUrl).origin
const SESSION_DAYS = 365
function requestPath(req) {
  const route = req.route?.path
  if (route) return `${req.baseUrl}${Array.isArray(route) ? route[0] : route}`
  return req.originalUrl.split('?')[0].replace(/(\/api\/invitations\/)[^/]+/i, '$1:token')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
}

function errorCodeFor(status) {
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'RESOURCE_NOT_FOUND'
  if (status === 405) return 'METHOD_NOT_ALLOWED'
  if (status === 409) return 'CONFLICT'
  if (status === 422) return 'VALIDATION_ERROR'
  if (status === 429) return 'TOO_MANY_REQUESTS'
  return 'INTERNAL_ERROR'
}

app.disable('x-powered-by')
app.set('trust proxy', production ? 1 : false)
app.use((req, res, next) => {
  const requestId = randomUUID()
  const startedAt = process.hrtime.bigint()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  res.on('finish', () => {
    const status = res.statusCode
    log(status >= 400 ? 'error' : 'info', 'http.request', {
      requestId,
      method: req.method,
      path: requestPath(req),
      ...(req.logRouteParams ? { routeParams: req.logRouteParams } : {}),
      status,
      ...(status >= 400 ? {
        errorCode: res.locals.apiErrorCode || errorCodeFor(status),
        ...(res.locals.apiErrorMessage
          ? { errorMessage: errorDetails(new Error(res.locals.apiErrorMessage)).errorMessage }
          : {})
      } : {}),
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
    })
  })
  next()
})
app.param('id', (req, _res, next, id) => {
  req.logRouteParams = { ...req.logRouteParams, id }
  next()
})
app.param('token', (req, _res, next) => {
  req.logRouteParams = { ...req.logRouteParams, token: '[redacted]' }
  next()
})
app.use(express.json({ limit: '32kb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
  const origin = req.get('origin')
  if (origin) {
    let requestOrigin
    try {
      requestOrigin = new URL(origin)
    } catch {
      return fail(res, 403, 'Origem não permitida.')
    }

    const isLocalDevelopmentOrigin = !production &&
      requestOrigin.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(requestOrigin.hostname)
    const expectedOrigin = production ? `${req.protocol}://${req.get('host')}` : configuredOrigin
    if (requestOrigin.origin !== expectedOrigin && !isLocalDevelopmentOrigin) {
      return fail(res, 403, 'Origem não permitida.')
    }
  }
  next()
})

const now = () => new Date().toISOString()
const logRequest = (req, event, fields = {}, level = 'info') => log(level, event, { requestId: req.requestId, ...fields })
const hash = (value) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const fail = (res, status, message, code, details) => {
  const normalizedStatus = status === 400 ? 422 : status
  const errorCode = code || errorCodeFor(normalizedStatus)
  res.locals.apiErrorCode = errorCode
  res.locals.apiErrorMessage = message
  return res.status(normalizedStatus).json({
    error: { code: errorCode, message, ...(details ? { details } : {}) },
    requestId: res.getHeader('X-Request-Id')
  })
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const normalizeTime = (value) => {
  const time = String(value || '')
  return /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(time) ? time.slice(0, 5) : ''
}
const cookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2))
const cookieOptions = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${production ? '; Secure' : ''}`
const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 13) return ''
  return digits.startsWith('55') ? digits : `55${digits}`
}
const money = (value) => Math.round(Number(value) * 100)
const recordAudit = async (actorKind, actorId, action, targetKind, targetId, details = {}) =>
  result(supabase.from('audit').insert({
    actor_kind: actorKind, actor_id: actorId || null, action, target_kind: targetKind,
    target_id: targetId || null, details
  }))

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date)
}

function dateAtLocalTime(date, time) {
  const result = new Date(`${date}T${time}:00-03:00`)
  return Number.isNaN(result.getTime()) ? null : result
}

function nextWeekday(weekday, from = new Date()) {
  const today = localDate(from)
  const date = new Date(`${today}T12:00:00-03:00`)
  let delta = (weekday - date.getDay() + 7) % 7
  if (delta === 0) delta = 7
  date.setDate(date.getDate() + delta)
  return localDate(date)
}

function occurrenceTimes(date, startTime, endTime) {
  const startsAt = dateAtLocalTime(date, startTime)
  let endsAt = dateAtLocalTime(date, endTime)
  if (!startsAt || !endsAt) return null
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400000)
  return { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }
}

async function setting(key) {
  const row = await result(supabase.from('settings').select('value').eq('key', key).maybeSingle())
  return row?.value || ''
}

async function writeSession(res, personId = null, organizerId = null) {
  const rawToken = token()
  const { error } = await supabase.from('sessions').insert({
    token_hash: hash(rawToken),
    kind: organizerId ? 'organizer' : 'person',
    person_id: personId,
    organizer_id: organizerId,
    expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()
  })
  if (error) throw new Error(error.message)
  res.setHeader('Set-Cookie', `ethos_session=${encodeURIComponent(rawToken)}; ${cookieOptions}`)
}

async function auth(req, res, next) {
  try {
    const rawToken = cookies(req.headers.cookie).ethos_session
    if (!rawToken) return fail(res, 401, 'Entre para continuar.')
    const session = await result(supabase.from('sessions').select('*').eq('token_hash', hash(rawToken)).maybeSingle())
    if (!session || session.expires_at <= now()) {
      if (session) await result(supabase.from('sessions').delete().eq('token_hash', session.token_hash))
      return fail(res, 401, 'Sua sessão expirou. Entre novamente.')
    }

    const isPerson = session.kind === 'person'
    const subjectId = isPerson ? session.person_id : session.organizer_id
    const subject = isPerson
      ? await result(supabase.from('people').select('id,name,phone,pin_reset_required').eq('id', subjectId).maybeSingle())
      : await result(supabase.from('organizers').select('id,user_id,name,email,role,active').eq('id', subjectId).maybeSingle())
    if (!subject || (!isPerson && !subject.active)) {
      await result(supabase.from('sessions').delete().eq('token_hash', session.token_hash))
      return fail(res, 401, 'Sua sessão não está mais ativa.')
    }
    req.user = { ...subject, kind: isPerson ? 'person' : 'organizer' }
    next()
  } catch (error) { next(error) }
}

const requirePerson = (req, res, next) => req.user?.kind === 'person' ? next() : fail(res, 403, 'Acesso exclusivo para participantes.')
const requireOrganizer = (req, res, next) => req.user?.kind === 'organizer' ? next() : fail(res, 403, 'Acesso exclusivo para organizadores.')
const requireOwner = (req, res, next) => req.user?.kind === 'organizer' && req.user.role === 'owner' ? next() : fail(res, 403, 'Esta ação é exclusiva do owner.')

const loginKeys = (identity, ip) => [hash(identity), hash(`${identity}:${ip}`)]
async function loginIsBlocked(keys) {
  const rows = await result(supabase.from('login_attempts').select('blocked_until').in('attempt_key', keys))
  return rows.some((row) => row.blocked_until && row.blocked_until > now())
}
const recordBadLogin = (keys) => rpc('record_login_failure', { p_attempt_keys: keys })
const clearBadLogin = (keys) => rpc('clear_login_failures', { p_attempt_keys: keys })

app.get('/api/health', wrap(async (req, res) => {
  const schemaQuery = (table, columns) => supabase.from(table).select(columns, { head: true }).limit(0)
  const schemaChecks = [
    { name: 'settings', query: schemaQuery('settings', 'key,value') },
    { name: 'modalities', query: schemaQuery('modalities', 'id,name,slug,archived_at') },
    { name: 'events', query: schemaQuery('events', 'id,modality_id') },
    { name: 'occurrences', query: schemaQuery('occurrences', 'id,event_id,starts_at,ends_at') },
    { name: 'occurrence_event_modality_join', query: supabase.from('occurrences')
      .select('id,events!inner(id,modality_id,modalities!inner(id,archived_at))', { head: true }).limit(0) },
    { name: 'registrations', query: schemaQuery('registrations', 'id,occurrence_id,person_id,situation,payment,wait_position,notice_seen,promoted_at,created_at') },
    { name: 'people', query: schemaQuery('people', 'id,name,phone') },
    { name: 'sessions', query: schemaQuery('sessions', 'token_hash,kind,person_id,organizer_id,expires_at') },
    { name: 'organizers', query: schemaQuery('organizers', 'id,user_id,name,email,role,active') },
    { name: 'invitations', query: schemaQuery('invitations', 'id,email,role,token_hash,expires_at,used_at,cancelled_at') },
    { name: 'audit', query: schemaQuery('audit', 'id,actor_kind,actor_id,action,target_kind,target_id,details,created_at') }
  ]
  const results = await Promise.all(schemaChecks.map(async ({ name, query }) => ({
    name,
    ...await query
  })))
  const checks = Object.fromEntries(results.map(({ name, error }) => [name, error ? 'error' : 'ok']))
  const failed = results.filter(({ error }) => error)
  if (failed.length) {
    for (const { name, error } of failed) {
      log('error', 'health.schema_check.failed', {
        requestId: req.requestId,
        query: name,
        ...errorDetails(error)
      })
    }
    return fail(res, 503, 'Não foi possível conectar ao Supabase. Confira a configuração do servidor.',
      'SERVICE_UNAVAILABLE', { database: 'supabase', checks })
  }
  res.json({ ok: true, database: 'supabase', checks })
}))
app.get('/api/me', (req, res, next) => {
  if (!cookies(req.headers.cookie).ethos_session) return res.json({ user: null })
  auth(req, res, () => {
    const { id, name, kind, phone, email, role, pin_reset_required } = req.user
    res.json({ user: kind === 'person'
      ? { id, name, phone, kind, pinResetRequired: Boolean(pin_reset_required) }
      : { id, name, email, role, kind } })
  })
})

app.post('/api/logout', auth, wrap(async (req, res) => {
  const rawToken = cookies(req.headers.cookie).ethos_session
  await result(supabase.from('sessions').delete().eq('token_hash', hash(rawToken)))
  res.setHeader('Set-Cookie', `ethos_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? '; Secure' : ''}`)
  res.json({ ok: true })
}))

app.post('/api/signup', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim()
  const phone = normalizePhone(req.body.phone)
  const pin = String(req.body.pin || '')
  if (name.length < 2 || name.length > 100 || !phone || !/^\d{6}$/.test(pin)) return fail(res, 400, 'Confira o nome, telefone e PIN de 6 dígitos.')
  const { data: person, error } = await supabase.from('people').insert({
    name, phone, pin_hash: await bcrypt.hash(pin, 12)
  }).select('id,name,phone').single()
  if (error?.code === '23505') return fail(res, 409, 'Não foi possível criar o cadastro. Confira os dados ou entre com seu telefone e PIN.')
  if (error) throw new Error(error.message)
  await writeSession(res, person.id)
  logRequest(req, 'person.signup.completed')
  res.status(201).json({ user: { ...person, kind: 'person' } })
}))

app.post('/api/login', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone)
  const keys = loginKeys(`person:${phone}`, req.ip)
  if (await loginIsBlocked(keys)) return fail(res, 429, 'Muitas tentativas. Tente novamente em 10 minutos.')
  const person = phone && await result(supabase.from('people').select('*').eq('phone', phone).maybeSingle())
  if (!person || !(await bcrypt.compare(String(req.body.pin || ''), person.pin_hash))) {
    if (await recordBadLogin(keys)) return fail(res, 429, 'Muitas tentativas. Tente novamente em 10 minutos.')
    logRequest(req, 'person.login.rejected')
    return fail(res, 401, 'Não encontramos esse cadastro, confira os dados.')
  }
  await clearBadLogin(keys)
  await result(supabase.from('people').update({ last_seen: now() }).eq('id', person.id))
  await writeSession(res, person.id)
  logRequest(req, 'person.login.completed')
  res.json({ user: { id: person.id, name: person.name, phone: person.phone, kind: 'person', pinResetRequired: person.pin_reset_required } })
}))

app.post('/api/organizer/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const keys = loginKeys(`organizer:${email}`, req.ip)
  if (await loginIsBlocked(keys)) return fail(res, 429, 'Muitas tentativas. Tente novamente em 10 minutos.')
  const authClient = createAuthClient()
  const { data, error } = await authClient.auth.signInWithPassword({
    email, password: String(req.body.password || '')
  })
  if (error || !data.user) {
    const invalidCredentials = error?.code === 'invalid_credentials' ||
      error?.code === 'email_not_confirmed' || error?.status === 400
    if (error && !invalidCredentials) {
      log('error', 'organizer.login.auth_failed', {
        requestId: req.requestId,
        ...errorDetails(error)
      })
      return fail(res, 500, 'Não foi possível concluir. Tente novamente.')
    }
    if (await recordBadLogin(keys)) return fail(res, 429, 'Muitas tentativas. Tente novamente em 10 minutos.')
    logRequest(req, 'organizer.login.rejected')
    return fail(res, 401, 'E-mail ou senha incorretos.')
  }
  const organizer = await result(supabase.from('organizers').select('id,name,email,role,active')
    .eq('user_id', data.user.id).maybeSingle())
  if (!organizer || !organizer.active) {
    await authClient.auth.signOut()
    return fail(res, 401, 'E-mail ou senha incorretos.')
  }
  await clearBadLogin(keys)
  await writeSession(res, null, organizer.id)
  logRequest(req, 'organizer.login.completed', { role: organizer.role })
  res.json({ user: { id: organizer.id, name: organizer.name, email: organizer.email, role: organizer.role, kind: 'organizer' } })
}))

app.post('/api/invitations/accept', wrap(async (req, res) => {
  logRequest(req, 'invitation.accept.started')
  const inviteToken = String(req.body.token || '')
  const email = String(req.body.email || '').trim().toLowerCase()
  const name = String(req.body.name || '').trim()
  const password = String(req.body.password || '')
  if (!inviteToken || name.length < 2 || name.length > 100 || password.length < 12 ||
      password.length > 200 || password !== req.body.confirmPassword) {
    return fail(res, 400, 'Informe seu nome e uma senha de pelo menos 12 caracteres. As senhas precisam ser iguais.')
  }
  const tokenHash = hash(inviteToken)
  const invitation = await result(supabase.from('invitations').select('*')
    .eq('token_hash', tokenHash).is('used_at', null).is('cancelled_at', null).gt('expires_at', now()).maybeSingle())
  if (!invitation || invitation.email.toLowerCase() !== email) return fail(res, 400, 'Este convite não é válido ou já expirou. Peça um novo ao owner.')

  const authAdmin = supabase.auth.admin
  const { data: created, error: createError } = await authAdmin.createUser({
    email, password, email_confirm: true, user_metadata: { name }
  })
  let authUser = created?.user
  let createdAuthUser = !createError && Boolean(authUser)

  if (createError || !authUser) {
    const status = createError?.status
    const code = createError?.code
    const alreadyExists = code === 'user_already_exists' || code === 'email_exists' ||
      /already (?:been )?(?:registered|used)|user already exists/i.test(createError?.message || '')

    if (alreadyExists) {
      logRequest(req, 'invitation.auth_user.already_exists')
      let existingAuthUser = null
      for (let page = 1; !existingAuthUser; page += 1) {
        const { data, error: listError } = await authAdmin.listUsers({ page, perPage: 1000 })
        if (listError) {
          log('error', 'invitation.auth_user.lookup_failed', {
            requestId: req.requestId,
            status: listError.status,
            code: listError.code
          })
          return fail(res, 502, 'Não foi possível localizar a conta existente no Supabase Auth. Peça ao owner para verificar o terminal da API.')
        }
        existingAuthUser = data.users.find((user) => user.email?.toLowerCase() === email) || null
        if (data.users.length < 1000) break
      }

      if (!existingAuthUser) {
        logRequest(req, 'invitation.auth_user.lookup_empty', {}, 'warn')
        return fail(res, 502, 'O Supabase Auth sinalizou uma conta existente, mas não foi possível localizá-la. Peça ao owner para verificar o terminal da API.')
      }

      const [linkedByUser, linkedByEmail] = await Promise.all([
        result(supabase.from('organizers').select('id').eq('user_id', existingAuthUser.id).maybeSingle()),
        result(supabase.from('organizers').select('id').ilike('email', email).maybeSingle())
      ])
      if (linkedByUser || linkedByEmail) {
        return fail(res, 409, 'Esta conta já está vinculada a um organizador. Peça ao owner para verificar o acesso antes de continuar.')
      }

      const { data: updated, error: updateError } = await authAdmin.updateUserById(existingAuthUser.id, {
        password, email_confirm: true, user_metadata: { name }
      })
      if (updateError || !updated.user) {
        log('error', 'invitation.auth_user.password_update_failed', {
          requestId: req.requestId,
          status: updateError?.status,
          code: updateError?.code
        })
        if (updateError?.code === 'weak_password') {
          return fail(res, 400, 'A senha não atende aos requisitos de segurança do Supabase. Tente uma senha diferente, com pelo menos 12 caracteres.')
        }
        return fail(res, 502, 'O Supabase Auth não conseguiu definir a senha deste convite. Peça ao owner para verificar o terminal da API.')
      }

      authUser = updated.user
      createdAuthUser = false
      logRequest(req, 'invitation.auth_user.password_set')
    } else {
      log('error', 'invitation.auth_user.create_failed', { requestId: req.requestId, status, code })
      if (code === 'weak_password' || /password.*(weak|length|characters|requirements)/i.test(createError?.message || '')) {
        return fail(res, 400, 'A senha não atende aos requisitos de segurança do Supabase. Tente uma senha diferente, com pelo menos 12 caracteres.')
      }
      if (status === 401 || status === 403) {
        return fail(res, 500, 'O servidor não conseguiu autenticar no Supabase Auth. Peça ao owner para verificar a SUPABASE_SECRET_KEY no .env.')
      }
      if (status === 429) return fail(res, 429, 'O Supabase limitou tentativas de criação. Aguarde alguns minutos e tente novamente.')
      return fail(res, 502, 'O Supabase Auth não conseguiu criar o acesso. Peça ao owner para conferir o terminal da API usando o código e status registrados.')
    }
  }

  if (createdAuthUser) logRequest(req, 'invitation.auth_user.created')
  let organizer
  try {
    organizer = await rpc('accept_organizer_invitation', {
      p_token: inviteToken, p_name: name, p_user_id: authUser.id, p_email: email
    })
  } catch (error) {
    if (createdAuthUser) {
      const { error: deleteError } = await authAdmin.deleteUser(authUser.id)
      if (deleteError) {
        log('error', 'invitation.auth_user.cleanup_failed', {
          requestId: req.requestId,
          status: deleteError.status,
          code: deleteError.code
        })
      }
    }
    if (error.code === 'P0002' || error.code === '23505') {
      return fail(res, 400, 'Este convite não é válido ou já expirou. Peça um novo ao owner.')
    }
    throw error
  }
  await writeSession(res, null, organizer.id)
  logRequest(req, 'invitation.accept.completed', { role: organizer.role })
  res.status(201).json({ ok: true })
}))

app.get('/api/invitations/:token', wrap(async (req, res) => {
  const invitation = await result(supabase.from('invitations').select('email')
    .eq('token_hash', hash(req.params.token)).is('used_at', null)
    .is('cancelled_at', null).gt('expires_at', now()).maybeSingle())
  if (!invitation) return fail(res, 404, 'Este convite não é válido ou já expirou.')
  res.json({ email: invitation.email })
}))

async function registrationsByOccurrence(occurrenceIds) {
  if (!occurrenceIds.length) return []
  return result(supabase.from('registrations').select('id,occurrence_id,person_id,situation,payment,wait_position,notice_seen')
    .in('occurrence_id', occurrenceIds))
}

async function occurrenceDetailQuery(req, queryName, query) {
  try {
    return await query
  } catch (error) {
    log('error', 'occurrence.detail.query_failed', {
      requestId: req.requestId,
      query: queryName,
      ...errorDetails(error)
    })
    throw error
  }
}

app.get('/api/events', auth, wrap(async (req, res) => {
 let query = supabase.from('occurrences')
   .select('*,events!inner(name,modality_id,type,active,modalities!inner(id,name,slug,archived_at))')
    .eq('events.active', true).eq('open', true)
    .gte('starts_at', new Date(Date.now() - 86400000).toISOString())
    .order('starts_at')
  const occurrences = await result(query)
  const registrations = await registrationsByOccurrence(occurrences.map((occurrence) => occurrence.id))
  const events = occurrences.map((occurrence) => {
    const { events: event, ...row } = occurrence
    return withCounts({
      ...row, name: event.name, modality_id: event.modality_id,
      modality: event.modalities.name, modality_archived_at: event.modalities.archived_at,
      type: event.type
    }, registrations, req.user.kind === 'person' ? req.user.id : null)
  })
  res.json({ events })
}))

app.get('/api/modalities', auth, wrap(async (_req, res) => {
  const modalities = await result(supabase.from('modalities')
    .select('id,name,slug,archived_at').is('archived_at', null).order('name'))
  res.json({ modalities })
}))

app.get('/api/admin/modalities', auth, requireOrganizer, wrap(async (_req, res) => {
  const rows = await result(supabase.from('modalities')
    .select('id,name,slug,archived_at,created_at,events(count)').order('name'))
  res.json({ modalities: rows.map(({ events, ...modality }) => ({
    ...modality, event_count: events?.[0]?.count ?? 0
  })) })
}))

app.get('/api/admin/modalities/preview', auth, requireOrganizer, wrap(async (req, res) => {
  if (!isValidModalityName(req.query.name)) {
    return fail(res, 400, 'Use de 2 a 80 letras, números, espaços ou hífens.')
  }
  const normalized = normalizeModality(req.query.name)
  if (!normalized || normalized.name.length < 2 || normalized.name.length > 80) {
    return fail(res, 400, 'Informe uma modalidade válida com 2 a 80 caracteres.')
  }
  const modalities = await result(supabase.from('modalities')
    .select('id,name,slug,archived_at,events(count)').order('name'))
  const exact = modalities.find(modality => modality.slug === normalized.slug) || null
  const similar = modalities.filter(modality => modality.slug !== normalized.slug &&
    modalityDistance(modality.slug, normalized.slug) <= Math.max(2, Math.floor(normalized.slug.length * 0.2)))
    .map(({ events, ...modality }) => ({ ...modality, event_count: events?.[0]?.count ?? 0 }))
  const exactResult = exact
    ? (({ events, ...modality }) => ({ ...modality, event_count: events?.[0]?.count ?? 0 }))(exact)
    : null
  res.json({ normalized, exact: exactResult, similar })
}))

app.post('/api/admin/modalities', auth, requireOrganizer, wrap(async (req, res) => {
  if (!isValidModalityName(req.body.name)) {
    return fail(res, 400, 'Use de 2 a 80 letras, números, espaços ou hífens.')
  }
  const normalized = normalizeModality(req.body.name)
  if (!normalized || normalized.name.length < 2 || normalized.name.length > 80) {
    return fail(res, 400, 'Informe uma modalidade válida com 2 a 80 caracteres.')
  }

  const existing = await result(supabase.from('modalities').select('id,name,slug,archived_at')
    .eq('slug', normalized.slug).maybeSingle())
  if (existing) return res.json({ modality: existing, created: false })

  try {
    const modality = await result(supabase.from('modalities').insert(normalized)
      .select('id,name,slug,archived_at,created_at').single())
    await recordAudit('organizer', req.user.id, 'create_modality', 'modality', modality.id, {
      name: modality.name, slug: modality.slug
    })
    return res.status(201).json({ modality, created: true })
  } catch (error) {
    if (error.code !== '23505') throw error
    const modality = await result(supabase.from('modalities').select('id,name,slug,archived_at')
      .eq('slug', normalized.slug).single())
    res.json({ modality, created: false })
  }
}))

app.patch('/api/admin/modalities/:id', auth, requireOrganizer, wrap(async (req, res) => {
  if (!isValidModalityName(req.body.name)) {
    return fail(res, 400, 'Use de 2 a 80 letras, números, espaços ou hífens.')
  }
  const normalized = normalizeModality(req.body.name)
  if (!normalized || normalized.name.length < 2 || normalized.name.length > 80) {
    return fail(res, 400, 'Informe um nome válido com 2 a 80 caracteres.')
  }
  let modality
  try {
    modality = await result(supabase.from('modalities')
      .update(normalized).eq('id', req.params.id)
      .select('id,name,slug,archived_at,created_at').maybeSingle())
  } catch (error) {
    if (error.code === '23505') return fail(res, 409, 'Já existe outra modalidade com esse nome normalizado.')
    throw error
  }
  if (!modality) return fail(res, 404, 'Modalidade não encontrada.')
  await recordAudit('organizer', req.user.id, 'rename_modality', 'modality', modality.id, {
    name: modality.name, slug: modality.slug
  })
  res.json({ modality })
}))

app.patch('/api/admin/modalities/:id/status', auth, requireOrganizer, wrap(async (req, res) => {
  if (typeof req.body.archived !== 'boolean') return fail(res, 400, 'Informe se a modalidade deve ser arquivada.')
  const { data: modality, error } = await supabase.from('modalities')
    .update({ archived_at: req.body.archived ? now() : null }).eq('id', req.params.id)
    .select('id,name,slug,archived_at,created_at').maybeSingle()
  if (error) {
    const failure = new Error(error.message)
    failure.code = error.code
    throw failure
  }
  if (!modality) return fail(res, 404, 'Modalidade não encontrada.')
  await recordAudit('organizer', req.user.id, req.body.archived ? 'archive_modality' : 'reactivate_modality',
    'modality', modality.id, { name: modality.name })
  res.json({ modality })
}))

app.post('/api/admin/modalities/:id/merge', auth, requireOwner, wrap(async (req, res) => {
  const targetId = String(req.body.target_id || '')
  if (!targetId || targetId === req.params.id) return fail(res, 400, 'Escolha outra modalidade como destino.')
  const targetModality = await result(supabase.from('modalities')
    .select('id,name,archived_at').eq('id', targetId).maybeSingle())
  if (!targetModality) return fail(res, 404, 'Modalidade de destino não encontrada.')
  if (targetModality.archived_at) return fail(res, 409, 'Reative a modalidade de destino antes de mesclar.')
  const affected = await rpc('merge_modalities', {
    p_source_id: req.params.id, p_target_id: targetId
  })
  const modalities = await result(supabase.from('modalities')
    .select('id,name,slug,archived_at').in('id', [req.params.id, targetId]))
  const source = modalities.find(modality => modality.id === req.params.id)
  const target = modalities.find(modality => modality.id === targetId)
  await recordAudit('organizer', req.user.id, 'merge_modalities', 'modality', req.params.id, {
    source: source?.name || req.params.id, target: target?.name || targetId, event_count: String(affected)
  })
  res.json({ affected, target })
}))

app.delete('/api/admin/modalities/:id', auth, requireOwner, wrap(async (req, res) => {
  const modality = await result(supabase.from('modalities').select('name').eq('id', req.params.id).maybeSingle())
  if (!modality) return fail(res, 404, 'Modalidade não encontrada.')
  await rpc('delete_unused_modality', { p_modality_id: req.params.id })
  await recordAudit('organizer', req.user.id, 'delete_modality', 'modality', req.params.id, { name: modality.name })
  res.json({ ok: true })
}))

app.get('/api/my-registrations', auth, requirePerson, wrap(async (req, res) => {
  const registrations = await result(supabase.from('registrations').select('*').eq('person_id', req.user.id))
  if (!registrations.length) return res.json({ registrations: [] })
  const occurrenceIds = registrations.map((registration) => registration.occurrence_id)
  const occurrences = await result(supabase.from('occurrences').select('*,events!inner(name,modality_id,type,modalities!inner(id,name,slug,archived_at))')
    .in('id', occurrenceIds).order('starts_at'))
  const counts = await registrationsByOccurrence(occurrenceIds)
  res.json({ registrations: occurrences.map((occurrence) => {
    const { events: event, ...row } = occurrence
    const own = registrations.find((registration) => registration.occurrence_id === row.id)
    return { ...withCounts({
      ...row, name: event.name, modality_id: event.modality_id,
      modality: event.modalities.name, modality_archived_at: event.modalities.archived_at,
      type: event.type
    }, counts, req.user.id), ...own, occurrence_id: row.id }
  }) })
}))

app.get('/api/occurrences/:id', auth, wrap(async (req, res) => {
  const occurrence = await occurrenceDetailQuery(req, 'occurrence_with_event_and_modality',
    result(supabase.from('occurrences').select('*,events!inner(name,modality_id,type,modalities!inner(id,name,slug,archived_at))')
      .eq('id', req.params.id).maybeSingle()))
  if (!occurrence) return fail(res, 404, 'Este evento não foi encontrado.')
  const { events: event, ...row } = occurrence
  const registrations = await occurrenceDetailQuery(req, 'registrations_for_occurrence',
    result(supabase.from('registrations').select('*')
      .eq('occurrence_id', occurrence.id).order('wait_position', { ascending: true, nullsFirst: true })
      .order('created_at')))
  const personIds = [...new Set(registrations.map((registration) => registration.person_id))]
  const people = personIds.length
    ? await occurrenceDetailQuery(req, 'people_for_registrations',
      result(supabase.from('people').select('id,name,phone').in('id', personIds)))
    : []
  const organizer = req.user.kind === 'organizer'
  const peopleById = new Map(people.map((person) => [person.id, person]))
  const rows = registrations.map((registration) => {
    const person = peopleById.get(registration.person_id)
    return {
      id: registration.id, situation: registration.situation, payment: registration.payment,
      wait_position: registration.wait_position, created_at: registration.created_at,
      promoted_at: registration.promoted_at, notice_seen: registration.notice_seen,
      name: person?.name || 'Pessoa removida', person_id: registration.person_id,
      ...(organizer ? { phone: person?.phone } : {})
    }
  }).sort((left, right) => left.situation === right.situation
    ? (left.situation === 'confirmed' ? left.created_at.localeCompare(right.created_at) : left.wait_position - right.wait_position)
    : left.situation === 'confirmed' ? -1 : 1)
  const [ownerName, ownerWhatsapp] = await Promise.all([
    occurrenceDetailQuery(req, 'owner_name_setting', setting('owner_name')),
    occurrenceDetailQuery(req, 'owner_whatsapp_setting', setting('owner_whatsapp'))
  ])
  res.json({
    occurrence: {
      ...row, name: event.name, modality_id: event.modality_id,
      modality: event.modalities.name, modality_archived_at: event.modalities.archived_at,
      type: event.type
    },
    registrations: rows,
    closedForJoin: new Date(row.starts_at).getTime() - Date.now() <= row.cutoff_hours * 3600000,
    ownerName, ownerWhatsapp
  })
}))

app.post('/api/occurrences/:id/join', auth, requirePerson, wrap(async (req, res) => {
  const resultRows = await rpc('join_occurrence', {
    p_occurrence_id: req.params.id, p_person_id: req.user.id
  })
  res.status(201).json({ situation: resultRows[0]?.situation })
}))

app.post('/api/occurrences/:id/leave', auth, requirePerson, wrap(async (req, res) => {
  const promotedPersonId = await rpc('leave_occurrence', {
    p_occurrence_id: req.params.id, p_person_id: req.user.id
  })
  res.json({ ok: true, promoted: Boolean(promotedPersonId) })
}))

app.post('/api/registrations/:id/notice-seen', auth, requirePerson, wrap(async (req, res) => {
  const { data, error } = await supabase.from('registrations').update({ notice_seen: true })
    .eq('id', req.params.id).eq('person_id', req.user.id).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return fail(res, 404, 'Aviso não encontrado.')
  res.json({ ok: true })
}))

app.patch('/api/profile', auth, requirePerson, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim()
  if (name.length < 2 || name.length > 100) return fail(res, 400, 'Informe seu nome completo.')
  await result(supabase.from('people').update({ name }).eq('id', req.user.id))
  await recordAudit('person', req.user.id, 'update_profile', 'person', req.user.id)
  res.json({ ok: true })
}))

app.patch('/api/profile/pin', auth, requirePerson, wrap(async (req, res) => {
  const person = await result(supabase.from('people').select('pin_hash').eq('id', req.user.id).single())
  const currentPin = String(req.body.currentPin || '')
  const newPin = String(req.body.newPin || '')
  if (!(await bcrypt.compare(currentPin, person.pin_hash)) || !/^\d{6}$/.test(newPin)) {
    return fail(res, 400, 'Confira o PIN atual e informe um novo PIN de 6 dígitos.')
  }
  await result(supabase.from('people').update({
    pin_hash: await bcrypt.hash(newPin, 12), pin_reset_required: false
  }).eq('id', req.user.id))
  await recordAudit('person', req.user.id, 'change_pin', 'person', req.user.id)
  res.json({ ok: true })
}))

app.get('/api/admin/events', auth, requireOrganizer, wrap(async (_req, res) => {
  const occurrences = await result(supabase.from('occurrences')
    .select('*,events!inner(id,name,modality_id,type,weekday,start_time,end_time,active,modalities!inner(id,name,slug,archived_at))')
    .eq('events.active', true).order('starts_at', { ascending: false }))
  const registrations = await registrationsByOccurrence(occurrences.map((occurrence) => occurrence.id))
  const events = occurrences.map((occurrence) => {
    const { events: event, ...row } = occurrence
    return withCounts({ ...row, event_id: event.id, name: event.name,
      modality_id: event.modality_id, modality: event.modalities.name,
      modality_archived_at: event.modalities.archived_at,
      type: event.type, weekday: event.weekday, start_time: event.start_time, end_time: event.end_time }, registrations)
  })
  res.json({ events })
}))

app.post('/api/admin/events', auth, requireOrganizer, wrap(async (req, res) => {
  const input = req.body
  const name = String(input.name || '').trim()
  const modalityId = String(input.modality_id || '').trim()
  const startTime = normalizeTime(input.startTime)
  const endTime = normalizeTime(input.endTime)
  const seats = Number(input.seats)
  const cutoff = Number(input.cutoffHours ?? 5)
  const price = Number(input.price)
  if (name.length < 2 || name.length > 120 || !modalityId ||
      !startTime || !endTime ||
      !Number.isInteger(seats) || seats < 1 || seats > 1000 || !Number.isInteger(cutoff) || cutoff < 0 || cutoff > 168 ||
      !Number.isSafeInteger(money(price)) || price < 0 || !['recorrente', 'sazonal'].includes(input.type)) {
    return fail(res, 400, 'Confira os dados do evento e tente novamente.')
  }
  const recurring = input.type === 'recorrente'
  const weekday = Number(input.weekday)
  if (recurring && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) return fail(res, 400, 'Escolha o dia da semana.')
  const date = recurring ? nextWeekday(weekday) : String(input.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!recurring && date < localDate())) return fail(res, 400, 'Escolha uma data futura válida.')
  const times = occurrenceTimes(date, startTime, endTime)
  if (!times || new Date(times.starts_at) <= new Date()) return fail(res, 400, 'O horário do evento precisa ser futuro.')

  const modality = await result(supabase.from('modalities').select('id,archived_at').eq('id', modalityId).maybeSingle())
  if (!modality) return fail(res, 400, 'Selecione uma modalidade válida.')
  if (modality.archived_at) return fail(res, 409, 'Reative a modalidade antes de usá-la em um evento.')
  const pixKey = String(input.pixKey || '').trim().slice(0, 200)
  const location = String(input.location || '').trim().slice(0, 200)
  const event = await result(supabase.from('events').insert({
    name, modality_id: modality.id, type: input.type, weekday: recurring ? weekday : null,
    start_time: startTime, end_time: endTime, seats, price_cents: money(price),
    pix_key: pixKey, location, cutoff_hours: cutoff
  }).select().single())
  try {
    await result(supabase.from('occurrences').insert({
      event_id: event.id, ...times, seats, price_cents: money(price),
      pix_key: pixKey || await setting('default_pix'), location, cutoff_hours: cutoff
    }))
    await recordAudit('organizer', req.user.id, 'create_event', 'event', event.id, { name, type: event.type })
  } catch (error) {
    await supabase.from('events').delete().eq('id', event.id)
    throw error
  }
  res.status(201).json({ ok: true })
}))

app.patch('/api/admin/occurrences/:id', auth, requireOrganizer, wrap(async (req, res) => {
  const input = req.body
  const occurrence = await result(supabase.from('occurrences').select('*,events!inner(id,name,modality_id,type,weekday,modalities!inner(archived_at))')
    .eq('id', req.params.id).maybeSingle())
  if (!occurrence) return fail(res, 404, 'Evento não encontrado.')
  if (occurrence.starts_at <= now()) return fail(res, 409, 'Ocorrências passadas ou já iniciadas não podem ser editadas.')
  const name = String(input.name || '').trim()
  const modalityId = String(input.modality_id || '').trim()
  const startTime = normalizeTime(input.startTime)
  const endTime = normalizeTime(input.endTime)
  const seats = Number(input.seats)
  const cutoff = Number(input.cutoffHours)
  const price = Number(input.price)
  const recurring = occurrence.events.type === 'recorrente'
  const weekday = Number(input.weekday)
  const invalidFields = [
    ...(name.length < 2 || name.length > 120 ? ['name'] : []),
    ...(!modalityId ? ['modality_id'] : []),
    ...(!startTime ? ['startTime'] : []),
    ...(!endTime ? ['endTime'] : []),
    ...(!Number.isInteger(seats) || seats < 1 || seats > 1000 ? ['seats'] : []),
    ...(!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 168 ? ['cutoffHours'] : []),
    ...(!Number.isSafeInteger(money(price)) || price < 0 ? ['price'] : []),
    ...(recurring && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) ? ['weekday'] : [])
  ]
  if (invalidFields.length) {
    logRequest(req, 'event.edit.validation_failed', { fields: invalidFields }, 'warn')
    return fail(res, 400, 'Confira os dados do evento e tente novamente.')
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(occurrence.starts_at))
  const times = occurrenceTimes(date, startTime, endTime)
  if (!times || new Date(times.starts_at) <= new Date()) return fail(res, 400, 'O novo horário precisa ser futuro.')
  const confirmed = await result(supabase.from('registrations').select('id')
    .eq('occurrence_id', occurrence.id).eq('situation', 'confirmed'))
  if (confirmed.length > seats) return fail(res, 409, `Há ${confirmed.length} pessoas confirmadas. O limite não pode ser menor que esse número.`)

  const modality = await result(supabase.from('modalities').select('id,archived_at').eq('id', modalityId).maybeSingle())
  if (!modality) return fail(res, 400, 'Selecione uma modalidade válida.')
  if (modality.archived_at && modality.id !== occurrence.events.modality_id) {
    return fail(res, 409, 'Reative a modalidade antes de usá-la em outro evento.')
  }
  const pixKey = String(input.pixKey || '').trim().slice(0, 200)
  const location = String(input.location || '').trim().slice(0, 200)
  const { events: event } = occurrence
  const updateOccurrence = await supabase.from('occurrences').update({
    ...times, seats, price_cents: money(price), pix_key: pixKey || await setting('default_pix'),
    location, cutoff_hours: cutoff
  }).eq('id', occurrence.id)
  if (updateOccurrence.error) throw new Error(updateOccurrence.error.message)
  const updateEvent = await supabase.from('events').update({
    name, modality_id: modality.id, weekday: recurring ? weekday : null,
    start_time: startTime, end_time: endTime,
    seats, price_cents: money(price), pix_key: pixKey, location, cutoff_hours: cutoff
  }).eq('id', event.id)
  if (updateEvent.error) throw new Error(updateEvent.error.message)
  await recordAudit('organizer', req.user.id, 'edit_event', 'event', event.id, { occurrence_id: occurrence.id, name })
  res.json({ ok: true })
}))

app.patch('/api/admin/events/:id/close', auth, requireOrganizer, wrap(async (req, res) => {
  const event = await result(supabase.from('events').select('id').eq('id', req.params.id).maybeSingle())
  if (!event) return fail(res, 404, 'Evento não encontrado.')
  await result(supabase.from('events').update({ active: false }).eq('id', event.id))
  await result(supabase.from('occurrences').update({ open: false }).eq('event_id', event.id).gt('starts_at', now()))
  await recordAudit('organizer', req.user.id, 'close_event_series', 'event', event.id)
  res.json({ ok: true })
}))

app.patch('/api/admin/registrations/:id/payment', auth, requireOrganizer, wrap(async (req, res) => {
  if (typeof req.body.paid !== 'boolean') return fail(res, 400, 'Informe o novo status do pagamento.')
  await rpc('set_registration_payment', {
    p_registration_id: req.params.id, p_paid: req.body.paid, p_organizer_id: req.user.id
  })
  res.json({ ok: true })
}))

app.delete('/api/admin/registrations/:id', auth, requireOrganizer, wrap(async (req, res) => {
  const promotedPersonId = await rpc('remove_registration', {
    p_registration_id: req.params.id, p_organizer_id: req.user.id
  })
  res.json({ ok: true, promoted: Boolean(promotedPersonId) })
}))

app.get('/api/admin/people', auth, requireOrganizer, wrap(async (_req, res) => {
  const people = await result(supabase.from('people').select('id,name,phone,created_at,last_seen').order('name'))
  res.json({ people })
}))

app.post('/api/admin/people/:id/reset-pin', auth, requireOrganizer, wrap(async (req, res) => {
  const person = await result(supabase.from('people').select('id').eq('id', req.params.id).maybeSingle())
  if (!person) return fail(res, 404, 'Pessoa não encontrada.')
  const temporaryPin = String(randomInt(100000, 1000000))
  await result(supabase.from('people').update({
    pin_hash: await bcrypt.hash(temporaryPin, 12), pin_reset_required: true
  }).eq('id', person.id))
  await recordAudit('organizer', req.user.id, 'reset_pin', 'person', person.id)
  res.json({ temporaryPin })
}))

app.delete('/api/admin/people/:id', auth, requireOrganizer, wrap(async (req, res) => {
  await rpc('remove_person', { p_person_id: req.params.id, p_organizer_id: req.user.id })
  res.json({ ok: true })
}))

app.get('/api/admin/audit', auth, requireOrganizer, wrap(async (_req, res) => {
  const entries = await result(supabase.from('audit').select('*').order('created_at', { ascending: false }).limit(300))
  const organizerIds = [...new Set(entries.filter((entry) => entry.actor_kind === 'organizer').map((entry) => entry.actor_id).filter(Boolean))]
  const personIds = [...new Set(entries.filter((entry) => entry.actor_kind === 'person').map((entry) => entry.actor_id).filter(Boolean))]
  const [organizers, people] = await Promise.all([
    organizerIds.length ? result(supabase.from('organizers').select('id,name').in('id', organizerIds)) : [],
    personIds.length ? result(supabase.from('people').select('id,name').in('id', personIds)) : []
  ])
  const names = new Map([...organizers, ...people].map((person) => [person.id, person.name]))
  res.json({ entries: entries.map((entry) => ({ ...entry, actor_name: names.get(entry.actor_id) || entry.actor_kind })) })
}))

app.get('/api/owner/organizers', auth, requireOwner, wrap(async (_req, res) => {
  const [organizers, invitations, whatsapp, defaultPix] = await Promise.all([
    result(supabase.from('organizers').select('id,name,email,role,created_at').eq('active', true).order('role').order('name')),
    result(supabase.from('invitations').select('id,email,role,expires_at,created_at')
      .is('used_at', null).is('cancelled_at', null).gt('expires_at', now()).order('created_at', { ascending: false })),
    setting('owner_whatsapp'), setting('default_pix')
  ])
  res.json({ organizers, invitations, whatsapp, defaultPix })
}))

app.post('/api/owner/invitations', auth, requireOwner, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Informe um e-mail válido que ainda não tenha acesso.')
  const organizer = await result(supabase.from('organizers').select('id').ilike('email', email).maybeSingle())
  if (organizer) return fail(res, 400, 'Informe um e-mail válido que ainda não tenha acesso.')
  const inviteToken = await rpc('create_admin_invitation', { p_email: email, p_owner_id: req.user.id })
  logRequest(req, 'invitation.admin.created')
  res.status(201).json({ link: `${req.protocol}://${req.get('host')}/?convite=${encodeURIComponent(inviteToken)}` })
}))

app.delete('/api/owner/invitations/:id', auth, requireOwner, wrap(async (req, res) => {
  await rpc('cancel_invitation', { p_invitation_id: req.params.id, p_owner_id: req.user.id })
  res.json({ ok: true })
}))

app.delete('/api/owner/organizers/:id', auth, requireOwner, wrap(async (req, res) => {
  await rpc('remove_organizer', { p_organizer_id: req.params.id, p_owner_id: req.user.id })
  res.json({ ok: true })
}))

app.patch('/api/owner/settings', auth, requireOwner, wrap(async (req, res) => {
  await rpc('update_owner_settings', {
    p_whatsapp: String(req.body.whatsapp || ''),
    p_default_pix: String(req.body.defaultPix || ''),
    p_owner_id: req.user.id
  })
  res.json({ ok: true })
}))

app.use('/api', (req, res) => {
  const path = req.originalUrl.split('?')[0]
  const matchedLayer = app._router.stack.find(layer =>
    layer.route && layer.route.path !== '*' && layer.match(path)
  )
  if (matchedLayer) {
    req.logRouteParams = Object.fromEntries(Object.entries(matchedLayer.params || {})
      .map(([name, value]) => [name, name === 'token' ? '[redacted]' : value]))
    const allowedMethods = Object.keys(matchedLayer.route.methods)
      .filter(method => matchedLayer.route.methods[method])
      .map(method => method.toUpperCase())
    if (allowedMethods.includes('GET') && !allowedMethods.includes('HEAD')) allowedMethods.push('HEAD')
    res.setHeader('Allow', allowedMethods.join(', '))
    return fail(res, 405, 'Este método não é permitido para esta rota.')
  }
  fail(res, 404, 'Rota da API não encontrada.', 'ROUTE_NOT_FOUND')
})

let recurrenceBusy = false
async function runRecurrenceJob() {
  if (recurrenceBusy) return
  recurrenceBusy = true
  const startedAt = process.hrtime.bigint()
  log('info', 'recurrence.started')
  try {
    await rpc('create_due_recurring_occurrences')
    log('info', 'recurrence.completed', {
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
    })
  } catch (error) {
    log('error', 'recurrence.failed', errorDetails(error))
  } finally { recurrenceBusy = false }
}
if (process.env.VERCEL !== '1') {
  const recurrenceTimer = setInterval(() => {
    void runRecurrenceJob()
  }, 60 * 60 * 1000)
  recurrenceTimer.unref()
  void runRecurrenceJob()
} else {
  log('info', 'recurrence.disabled', { reason: 'serverless_runtime' })
}

const dist = resolve('dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(resolve(dist, 'index.html')))
}
app.use((error, req, res, _next) => {
  const mappedStatus = error.code === '42501' ? 403
    : error.code === 'P0002' ? 404
      : error.code === '23505' || error.code === '23514' || error.code === 'P0001' ? 409
        : error.code === '22023' ? 422 : null
  const rawStatus = mappedStatus || (Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500)
  const status = rawStatus === 400 ? 422 : rawStatus
  const errorCode = status === 409 && error.code === '23505' && /lista deste evento/i.test(error.message)
    ? 'ALREADY_REGISTERED'
    : errorCodeFor(status)
  const safeMessage = status === 500 ? 'Não foi possível concluir. Tente novamente.' : error.message
  res.locals.apiErrorCode = errorCode
  res.locals.apiErrorMessage = error.message
  log(status >= 500 ? 'error' : 'warn', 'api.error', {
    requestId: req.requestId,
    method: req.method,
    path: requestPath(req),
    status,
    errorCode,
    ...errorDetails(error)
  })
  if (res.headersSent) return
  res.status(status).json({
    error: { code: errorCode, message: safeMessage },
    requestId: req.requestId
  })
})
if (process.env.VERCEL !== '1') {
  app.listen(port, () => log('info', 'server.started', { port, environment: production ? 'production' : 'development' }))
}

export default app
