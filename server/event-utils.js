export function normalizeModality(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
  const slug = normalized.replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) return null
  const name = slug.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  return { name, slug }
}

export function isValidModalityName(value) {
  const name = String(value ?? '').trim()
  const ascii = name.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return name.length >= 2 && name.length <= 80 && /^[a-zA-Z0-9\s-]+$/.test(ascii)
}

export function modalityDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1]
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1)
      ))
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

export function withCounts(occurrence, registrations, personId = null) {
  const currentRegistrations = registrations.filter(registration => registration.occurrence_id === occurrence.id)
  const own = currentRegistrations.find(registration => registration.person_id === personId)
  return {
    ...occurrence,
    confirmed_count: currentRegistrations.filter(registration => registration.situation === 'confirmed').length,
    waiting_count: currentRegistrations.filter(registration => registration.situation === 'waitlist').length,
    paid_count: currentRegistrations.filter(registration => registration.situation === 'confirmed' && registration.payment === 'paid').length,
    my_situation: own?.situation,
    my_wait_position: own?.wait_position,
    my_payment: own?.payment,
    notice_seen: own?.notice_seen,
    closedForJoin: new Date(occurrence.starts_at).getTime() - Date.now() <= occurrence.cutoff_hours * 3600000
  }
}
