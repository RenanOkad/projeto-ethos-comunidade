import assert from 'node:assert/strict'
import test from 'node:test'
import { errorDetails } from './logger.js'

test('error details redact credentials and connection strings', () => {
  const details = errorDetails(new Error(
    'Request failed for postgres://db_user:db_password@db.example.test/app; SUPABASE_SECRET_KEY=sb_secret_example'
  ))

  assert.match(details.errorMessage, /\[string de conexão ocultada\]/)
  assert.match(details.errorMessage, /SUPABASE_SECRET_KEY=\[valor ocultado\]/)
  assert.doesNotMatch(details.errorMessage, /db_password|sb_secret_example/)
})
