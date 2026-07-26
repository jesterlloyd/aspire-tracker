// AP Phase 1, Commit 3: prove the Academic Partner roster endpoint resolves confirmed unit from the
// reliable matched_unit_id -> units path (never the legacy students.unit), keeps a tight response
// allowlist, never leaks a private field, derives school scope only from user_school_scopes (never a
// request parameter), isolates schools (including the WCU campuses), and fails closed on spoofing.
//
// Modeled on test/unitLeaderPrivateFieldExclusion.test.mjs: exclusion is a SERVER property, so the
// guards read the endpoint source and its .select() calls. Negative assertions run against
// comment-stripped source so a field NAMED in a comment to explain its exclusion is not a false leak.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveSchoolAliases } from '../api/lib/schoolAliases.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const src = stripJs(read('api/portal/school-students.js'))
const norm = (s) => String(s).toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim()

test('confirmed unit resolves from matched_unit_id -> units.unit_name, never the legacy students.unit', () => {
  // The students column allowlist reads matched_unit_id, not the legacy free-text unit column.
  assert.match(src, /matched_unit_id/)
  assert.doesNotMatch(src, /'[^']*\bunit\b[^']*'/)   // no bare 'unit' string column anywhere
  // A units lookup resolves the name; the response binds unit_name from that map, not from s.unit.
  assert.match(src, /\.from\('units'\)\s*\.select\('id, unit_name'\)/)
  assert.match(src, /unit_name: unitNameById\[s\.matched_unit_id\] \|\| null/)
  assert.doesNotMatch(src, /unit_name: s\.unit\b/)
})

test('the response allowlist is exactly the Phase 1 roster fields; no private field is selected', () => {
  // The students column allowlist (declared as a STUDENT_COLUMNS const, passed to .select()).
  for (const col of ['id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
    'school', 'status', 'matched_unit_id', 'preceptor_name', 'term_dates',
    'hours_required', 'approved_hours', 'pending_hours']) {
    assert.match(src, new RegExp(`'${col}'`), `roster must select ${col}`)
  }
  // No restricted / confidential field is ever selected or returned. (Comment-stripped source, so a
  // field explained in prose does not read as a leak.)
  for (const forbidden of [
    'support_needed', 'learning_highlight', 'admin_notes', 'reviewed_by', 'reviewed_at',
    'review_reason', 'exception_flags', 'unit_override_reason', 'preceptor_override_note',
    'interview_outcome', 'interview_notes', 'rubric', 'ngrp', 'disposition',
    'gpa_verified', 'cumulative_gpa', 'bls_current', 'health_cleared', 'background_check',
    'ssn', 'date_of_birth', 'school_email', 'personal_email', 'phone',
    'resume_url', 'headshot_url', 'program_type',
  ]) {
    assert.ok(!src.includes(forbidden), `endpoint must not reference ${forbidden}`)
  }
})

test('school scope is derived from user_school_scopes only; no request parameter widens it', () => {
  assert.match(src, /hasActiveRoleGrant\(db, auth\.profile\.id, 'academic_partner'\)/)
  assert.match(src, /\.from\('user_school_scopes'\)/)
  // Active-scope filter: not revoked, started, not expired.
  assert.match(src, /r\.revoked_at === null/)
  assert.match(src, /new Date\(r\.starts_at\) <= nowTs/)
  assert.match(src, /r\.expires_at == null \|\| new Date\(r\.expires_at\) > nowTs/)
  // Nothing from the request influences scope: no query string or body is read for a school/cohort.
  assert.doesNotMatch(src, /req\.query|req\.body|req\.params/)
})

test('empty or revoked scope returns nothing (fail closed), and unknown callers are rejected', () => {
  assert.match(src, /if \(scopes\.length === 0\) return res\.status\(200\)\.json\(\{ schools: \[\] \}\)/)
  // Not an active academic_partner grant -> 403; unauthenticated -> 401/403.
  assert.match(src, /if \(!isPartner\) return res\.status\(403\)/)
  assert.match(src, /if \(!auth\.authenticated\)/)
})

test('WCU campus aliases cannot cross campus boundaries (exact-term scoping)', () => {
  // The endpoint scopes by EXACT normalized term membership (terms.has(norm(student.school))),
  // built from resolveSchoolAliases(school_key). So a campus scope resolves only to its own terms.
  const anaheim = resolveSchoolAliases('West Coast University Anaheim').map(norm)
  const noho = resolveSchoolAliases('West Coast University North Hollywood').map(norm)
  const parent = resolveSchoolAliases('West Coast University').map(norm)

  // An Anaheim-scoped partner's terms do not include the North Hollywood or bare-parent school
  // strings, so a NoHo or parent student is never matched into an Anaheim scope.
  assert.ok(!anaheim.includes(norm('West Coast University North Hollywood')))
  assert.ok(!anaheim.includes(norm('West Coast University')))
  // And the two campus term sets are disjoint.
  assert.ok(!anaheim.some(t => noho.includes(t)))
  // The bare parent does not resolve to either campus (so a parent scope cannot pull a campus roster
  // via the alias group either).
  assert.ok(!parent.includes(norm('West Coast University Anaheim')))
  assert.ok(!parent.includes(norm('West Coast University North Hollywood')))
  // Confirm the endpoint really uses exact membership, not a substring match.
  assert.match(src, /terms\.has\(n\)/)
  assert.match(src, /const n = norm\(s\.school\)/)
})

test('evaluation exposure stays counts-only (no evaluation content)', () => {
  // The evaluation read selects only status-level fields and returns completed/pending counts.
  assert.match(src, /\.from\('evaluation_assignments'\)\s*\.select\('student_id, status, respondent_type'\)/)
  assert.doesNotMatch(src, /response_json|answers|score|rubric|comment/)
})
