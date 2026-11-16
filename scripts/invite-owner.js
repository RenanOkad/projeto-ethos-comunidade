import 'dotenv/config'
import { randomBytes, createHash } from 'node:crypto'
import { result, supabase } from '../server/db.js'
import { errorDetails, log } from '../server/logger.js'

try {
  log('info', 'owner_invite.started')
  const email = String(process.env.OWNER_EMAIL || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe OWNER_EMAIL com o e-mail do Murilo.')

  await result(supabase.from('invitations').update({ cancelled_at: new Date().toISOString() })
    .eq('role', 'owner').is('used_at', null).is('cancelled_at', null)
    .lte('expires_at', new Date().toISOString()))
  const [owners, existingInvites] = await Promise.all([
    result(supabase.from('organizers').select('id').eq('role', 'owner').eq('active', true).limit(1)),
    result(supabase.from('invitations').select('id').eq('role', 'owner').is('used_at', null)
      .is('cancelled_at', null).gt('expires_at', new Date().toISOString()).limit(1))
  ])
  if (owners.length) throw new Error('Já existe um owner ativo. O convite inicial não foi criado.')
  if (existingInvites.length) throw new Error('Já existe um convite de owner pendente.')

  const secret = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(secret).digest('hex')
  await result(supabase.from('invitations').insert({
    email, role: 'owner', token_hash: tokenHash,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
  }))
  log('info', 'owner_invite.created', { expiresInDays: 7 })
  const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`
  console.log(`Convite de owner (expira em 7 dias):\n${origin}/?convite=${encodeURIComponent(secret)}\n\nCompartilhe este link diretamente com o Murilo; ele define a própria senha.`)
} catch (error) {
  log('error', 'owner_invite.failed', errorDetails(error))
  process.exitCode = 1
}
