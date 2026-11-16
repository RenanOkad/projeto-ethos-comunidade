import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidModalityName, modalityDistance, normalizeModality, withCounts } from './event-utils.js'

test('counts and payment status only include registrations for the occurrence', () => {
  const registrations = [
    { occurrence_id: 'court', person_id: 'person-1', situation: 'confirmed', payment: 'paid' }
  ]

  const beach = withCounts({
    id: 'beach',
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    cutoff_hours: 5
  }, registrations, 'person-1')

  assert.equal(beach.confirmed_count, 0)
  assert.equal(beach.waiting_count, 0)
  assert.equal(beach.paid_count, 0)
  assert.equal(beach.my_situation, undefined)
  assert.equal(beach.my_payment, undefined)
})

test('modality normalization folds case, accents, punctuation, and spacing', () => {
  const variants = [' Vôlei ', 'Volei', 'vôlei', 'Võlei']
    .map(normalizeModality)

  assert.deepEqual(variants.map(modality => modality.slug), ['volei', 'volei', 'volei', 'volei'])
  assert.deepEqual(variants.map(modality => modality.name), ['Volei', 'Volei', 'Volei', 'Volei'])
  assert.deepEqual(normalizeModality('  Jiu---Jitsu!!  '), { name: 'Jiu Jitsu', slug: 'jiu-jitsu' })
  assert.equal(normalizeModality('!!!'), null)
})

test('similarity helper recognizes short spelling mistakes', () => {
  assert.ok(modalityDistance('ciclismo', 'ciclsimo') <= 2)
  assert.ok(modalityDistance('ciclismo', 'volei') > 2)
})

test('modality names accept letters and hyphens but reject unexpected symbols', () => {
  assert.equal(isValidModalityName('Vôlei de areia'), true)
  assert.equal(isValidModalityName('Xadrez 3x3'), true)
  assert.equal(isValidModalityName('Vôlei!'), false)
  assert.equal(isValidModalityName('A'), false)
})
