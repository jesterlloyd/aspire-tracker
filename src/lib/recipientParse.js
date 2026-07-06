// src/lib/recipientParse.js
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY Phase 2A - pure helpers for the multi-source bulk audience.
// No network, no React, no DOM: safe to unit-test in node. Reuses the app's canonical email
// primitives (isValidEmail + normalizeEmailForLookup) so dedupe matches the rest of Outreach.

import { isValidEmail } from './notifications/studentRecipient.js'
import { normalizeEmailForLookup } from './emailUtils.js'

// Delimiters mirror the server CC parser (resolveCcList): comma / semicolon / newline.
const SPLIT_RE = /[,;\n]+/

// First word of a full name (used for the [First Name] merge token). Empty string when unknown.
export function firstNameFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return parts[0] || ''
}

// Parse a single token into { name, email }.
//   "First Last <a@b.com>"  → { name: 'First Last', email: 'a@b.com' }
//   "a@b.com"               → { name: '',          email: 'a@b.com' }
// Surrounding quotes on the name are stripped. Returns null for empty input.
export function parseRecipientToken(tokenRaw) {
  const token = String(tokenRaw || '').trim()
  if (!token) return null
  const angle = token.match(/^(.*)<([^>]+)>\s*$/)
  if (angle) {
    const name = angle[1].trim().replace(/^["']+|["']+$/g, '').trim()
    return { name, email: angle[2].trim() }
  }
  return { name: '', email: token }
}

// Parse a free-text blob of recipients (comma / semicolon / newline separated).
// Returns { valid: NormalizedRecipient[], invalid: string[], duplicateCount }.
// `valid` entries are source:'manual' with no IDs; dedup is by normalized lowercase email.
export function parseRecipientText(text) {
  const tokens = String(text || '').split(SPLIT_RE)
  const valid = []
  const invalid = []
  const seen = new Set()
  let duplicateCount = 0
  for (const t of tokens) {
    const tok = String(t || '').trim()
    if (!tok) continue
    const parsed = parseRecipientToken(tok)
    if (!parsed || !isValidEmail(parsed.email)) { invalid.push(tok); continue }
    const normEmail = normalizeEmailForLookup(parsed.email)
    if (seen.has(normEmail)) { duplicateCount++; continue }
    seen.add(normEmail)
    valid.push({
      email: parsed.email.trim(),
      normEmail,
      name: parsed.name || '',
      firstName: firstNameFromName(parsed.name),
      school: null,
      source: 'manual',
      studentId: null,
      contactId: null,
    })
  }
  return { valid, invalid, duplicateCount }
}

// Combine recipients from all sources and dedupe by normalized email.
// Collision rule (documented): an ID-bearing record (student/contact) always wins over a
// pasted/manual record with the same email; among ID-bearing records the FIRST in input order
// wins (callers pass Students → Contacts → Paste, so a student record is kept over a contact
// sharing the same email - both already carry a name). Returns { recipients, duplicateCount }.
export function dedupeRecipients(list) {
  const byEmail = new Map()
  let duplicateCount = 0
  for (const r of list || []) {
    if (!r || !r.normEmail) continue
    const existing = byEmail.get(r.normEmail)
    if (!existing) { byEmail.set(r.normEmail, r); continue }
    duplicateCount++
    const existingHasId = existing.source !== 'manual'
    const incomingHasId = r.source !== 'manual'
    if (!existingHasId && incomingHasId) byEmail.set(r.normEmail, r)
    // otherwise keep the existing (first ID-bearing / first-seen) record
  }
  return { recipients: Array.from(byEmail.values()), duplicateCount }
}

// Tokens that map to the recipient's first name. Everything else stays a literal placeholder.
const FIRST_NAME_TOKENS = [
  '[Student First Name]',
  '[Clinical Coordinator First Name]',
  '[Preceptor First Name]',
  '[First Name]',
]

// Client-side merge for SAMPLE PREVIEW ONLY (Phase 2A). Substitutes first name and school when
// available; leaves all other [placeholders] intact. Server-rendered preview/merge arrives in 2B.
export function applyMergeFields(text, recipient) {
  let out = String(text || '')
  const fn = recipient?.firstName || ''
  const school = recipient?.school || ''
  // Greeting token ALWAYS resolves (never leaves a raw bracket in a sent email), whether or not a
  // first name is known: "Good morning {name}," with a name, or a plain "Good morning," without one.
  // Uses the same escaped/raw `fn` as the first-name tokens below (html mode escapes it upstream).
  out = out.split('[Clinical Coordinator Greeting]').join(fn ? `Good morning ${fn},` : 'Good morning,')
  if (fn) for (const tok of FIRST_NAME_TOKENS) out = out.split(tok).join(fn)
  if (school) out = out.split('[School]').join(school)
  return out
}
