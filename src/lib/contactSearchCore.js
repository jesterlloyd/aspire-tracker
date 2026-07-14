// ASPIRE-PORTAL-CONTACTS: pure, dependency-free helpers for the shared Contacts
// search (no React, no Supabase import), so both the browser modules and the
// Node tests import the same logic. src/lib/contactSearch.js re-exports these
// alongside the query + hook that need the Supabase client.
import { getPrimaryCategory } from './contactCategories.js'

// Columns needed for both the CC picker and portal autofill (adds unit_name for
// unit-leader scope suggestions; harmless to the CC picker, which ignores it).
export const CONTACT_SEARCH_COLUMNS =
  'id, full_name, preferred_name, email, role, category, avatar_url, organization, school_name, unit_name'

// PostgREST .or() splits on top-level commas/parens; ilike treats % and _ as
// wildcards. Strip those so a free-typed term matches literally and cannot break
// the filter string. (Identical to ContactAutocomplete's sanitizeTerm.)
export function sanitizeContactTerm(s) {
  return String(s || '').replace(/[,()%_\\*]/g, ' ').replace(/\s+/g, ' ').trim()
}

// A short display subtitle for a contact suggestion (role/title, unit, school,
// email) using only the fields this workflow needs.
export function contactSubtitle(c) {
  return [c.role, c.unit_name, c.school_name || c.organization, c.email].filter(Boolean).join(' · ')
}

// Map a free-text affiliation string (e.g. contact.unit_name / school_name,
// possibly comma-, semicolon-, or slash-separated) to the catalog keys that
// exist in `optionValues`. Case-insensitive exact match per token; unknown
// tokens are dropped so we never submit an invented scope key. Convenience only.
export function matchCatalogKeys(text, optionValues) {
  if (!text) return []
  const set = new Map(optionValues.map(v => [v.toLowerCase(), v]))
  const out = []
  for (const tok of String(text).split(/[,;/]/).map(s => s.trim()).filter(Boolean)) {
    const hit = set.get(tok.toLowerCase())
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

// Normalize a school term the way api/lib/schoolAliases.js does: lowercase,
// punctuation to spaces, collapse whitespace. So "California State University,
// Los Angeles", "Cal State LA", and "CSULA" all compare cleanly.
export function normalizeSchoolTerm(s) {
  return String(s || '').toLowerCase().replace(/[.,&/\-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Map free-text school affiliation(s) (contact.school_name, contact.organization,
// or any structured affiliation field) to canonical school keys, using each
// option's approved aliases. Matching is normalized EXACT equality per token, so
// aliases resolve but a bare/ambiguous value never guesses a specific campus.
// `sources` may be a string or an array of strings; multiple distinct canonical
// matches are all returned. Splits only on ; / | (never comma, which appears
// inside canonical names).
export function matchSchoolKeys(sources, schoolOptions) {
  const inputs = (Array.isArray(sources) ? sources : [sources]).filter(Boolean)
  const tokens = []
  for (const s of inputs) {
    for (const part of String(s).split(/[;/|]/)) {
      const n = normalizeSchoolTerm(part)
      if (n) tokens.push(n)
    }
  }
  if (!tokens.length) return []
  const out = []
  for (const opt of schoolOptions || []) {
    const terms = [opt.value, ...(opt.aliases || [])].map(normalizeSchoolTerm)
    if (tokens.some(t => terms.includes(t)) && !out.includes(opt.value)) out.push(opt.value)
  }
  return out
}

// A "reliable" contact-to-student link is an EXACT email match to EXACTLY ONE
// student (school_email or personal_email). Zero or multiple matches, or a
// name-only resemblance, are never treated as a link. `students` is a list of
// candidate rows already fetched under the staff-authorized students RLS.
export function pickReliableStudent(email, students) {
  const norm = (e) => String(e || '').trim().toLowerCase()
  const target = norm(email)
  if (!target) return null
  const hits = []
  const seen = new Set()
  for (const s of students || []) {
    if (norm(s.school_email) === target || norm(s.personal_email) === target) {
      if (!seen.has(s.id)) { seen.add(s.id); hits.push(s) }
    }
  }
  return hits.length === 1 ? hits[0] : null
}

// Map a saved contact's CANONICAL category (getPrimaryCategory, which honors the
// stored contacts.category and falls back to role inference) to a supported
// portal role. Returns null for unsupported or ambiguous categories (Preceptors,
// BNI Team, Nursing Executives, Other) so the caller preserves the current role
// and requires explicit selection. Never infers from a loose name match.
const CATEGORY_TO_PORTAL_ROLE = new Map([
  ['unit leadership', 'unit_leader'],
  ['unit leader', 'unit_leader'],
  ['unit leaders', 'unit_leader'],
  ['academic partners', 'academic_partner'],
  ['academic partner', 'academic_partner'],
  ['student', 'student'],
  ['students', 'student'],
])
export function inferPortalRoleFromContact(contact) {
  if (!contact) return null
  const cat = getPrimaryCategory(contact)
  if (!cat) return null
  return CATEGORY_TO_PORTAL_ROLE.get(String(cat).toLowerCase().trim()) || null
}

// Best login email for a student, in the documented priority order:
//   1. an exact linked saved-contact email (passed in when a contact drove the
//      selection), 2. student school email, 3. student personal email.
// Returns null when none is available (the caller then requires manual entry).
export function bestStudentLoginEmail(student, contactEmail) {
  const pick = (v) => (v && String(v).trim()) ? String(v).trim() : null
  return pick(contactEmail) || pick(student?.school_email) || pick(student?.personal_email) || null
}
