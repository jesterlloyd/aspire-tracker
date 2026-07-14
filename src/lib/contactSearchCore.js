// ASPIRE-PORTAL-CONTACTS: pure, dependency-free helpers for the shared Contacts
// search (no React, no Supabase import), so both the browser modules and the
// Node tests import the same logic. src/lib/contactSearch.js re-exports these
// alongside the query + hook that need the Supabase client.

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
