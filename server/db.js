import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const anonKey = process.env.SUPABASE_ANON_KEY

if (!url || !secretKey) {
  throw new Error('Configuração Supabase ausente: crie um arquivo .env na raiz (copie .env.example) e preencha SUPABASE_URL e SUPABASE_SECRET_KEY.')
}

export const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
})

export function createAuthClient() {
  if (!anonKey) throw new Error('Configure SUPABASE_ANON_KEY no ambiente do servidor para o login de organizadores.')
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  })
}

export async function result(query) {
  const { data, error } = await query
  if (error) {
    const failure = new Error(error.message)
    failure.code = error.code
    throw failure
  }
  return data
}

export async function rpc(name, parameters) {
  return result(supabase.rpc(name, parameters))
}
