// src/lib/placementContacts.js
//
// STUDENT-PORTAL-PRECEPTOR-CONTACT-1: pure, dependency-light rules for the
// Student Portal's preceptor contact details and Email Preceptor compose. No
// I/O, so the summary endpoint and the portal UI share one copy and node tests
// import it directly.
//
// This module is imported by the browser, so it carries no catalog imports; the
// Connect leadership selector lives in placementLeadership.js (server-used).
//
// Sources (Owner decisions 2026-09-16):
//   Preceptors - every ACTIVE student_preceptor_assignments row, with email and
//                phone from the preceptor profile ASPIRE Connect shows.
//   Leadership - ASPIRE Connect contacts in the Unit Leader category whose
//                units (unit_name + related_units) include the student's unit.
//                The legacy unit_leaders table is deliberately NOT read here.

export const PRECEPTOR_ROLE_ORDER = Object.freeze(['primary', 'secondary', 'coverage'])
export const PRECEPTOR_ROLE_LABEL = Object.freeze({
  primary: 'Primary',
  secondary: 'Secondary',
  coverage: 'Coverage',
})

export const ASPIRE_TEAM_EMAIL = 'aspire@cshs.org'

const clean = (v) => String(v || '').trim()
const emailKey = (v) => clean(v).toLowerCase()
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(v))
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })

// Active assignments -> display rows, Primary first, then Secondary, then
// Coverage, then by name. One row per preceptor (a preceptor holding two roles
// keeps the higher one). `rows` are { role, preceptor: { id, full_name, email,
// phone } }; `profilePhoneByEmail` fills a phone the preceptor row lacks from
// the matching Connect contact.
export function orderPreceptorContacts(rows, profilePhoneByEmail = {}) {
  const rank = (role) => {
    const i = PRECEPTOR_ROLE_ORDER.indexOf(role)
    return i === -1 ? PRECEPTOR_ROLE_ORDER.length : i
  }
  const byId = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const p = row?.preceptor
    const name = clean(p?.full_name)
    if (!p?.id || !name) continue
    const current = byId.get(p.id)
    if (current && rank(current.role) <= rank(row.role)) continue
    const email = isEmail(p.email) ? clean(p.email) : null
    const phone = clean(p.phone) || (email ? clean(profilePhoneByEmail[emailKey(email)]) : '') || null
    byId.set(p.id, {
      id: p.id,
      name,
      role: PRECEPTOR_ROLE_ORDER.includes(row.role) ? row.role : null,
      email,
      phone,
    })
  }
  return [...byId.values()].sort((a, b) => (rank(a.role) - rank(b.role)) || byName(a.name, b.name))
}

// The preceptors a student can actually email (an address on file).
export function emailablePreceptors(preceptors) {
  return (Array.isArray(preceptors) ? preceptors : []).filter(p => isEmail(p?.email))
}

// Recipients for one Email Preceptor compose. `choice` is a preceptor id or
// 'all'. To = the chosen preceptor(s); Cc = unit leadership then the ASPIRE
// team, with anyone already on To removed and duplicates dropped. Returns null
// when the choice resolves to nobody with an email.
export function buildPreceptorRecipients({ preceptors, leadership, choice } = {}) {
  const pool = emailablePreceptors(preceptors)
  const chosen = choice === 'all' ? pool : pool.filter(p => p.id === choice)
  if (!chosen.length) return null
  const toKeys = new Set()
  const to = []
  for (const p of chosen) {
    const k = emailKey(p.email)
    if (!toKeys.has(k)) { toKeys.add(k); to.push(clean(p.email)) }
  }
  const ccKeys = new Set()
  const cc = []
  for (const addr of [...(Array.isArray(leadership) ? leadership : []).map(l => l?.email), ASPIRE_TEAM_EMAIL]) {
    if (!isEmail(addr)) continue
    const k = emailKey(addr)
    if (toKeys.has(k) || ccKeys.has(k)) continue
    ccKeys.add(k)
    cc.push(clean(addr))
  }
  return { to, cc }
}
