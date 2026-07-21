// UL-PHASE1-VISUAL item 5: prove the Unit Leader endpoints never select or return a
// restricted field.
//
// The live acceptance review could not visually confirm exclusion, which is the point:
// exclusion here is a SERVER property, not a UI one. These guards read the four Unit
// Leader read endpoints and their shared scope module, and assert that no restricted
// column name appears in any Supabase select() or in any response object. Negative
// assertions run against comment-stripped source so a field NAMED in documentation to
// explain why it is excluded does not read as a leak.
//
// This is the network-layer complement to the render-layer guards in the other UL
// suites: those prove the components do not display restricted data; these prove the
// data never leaves the server in the first place.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { UL_STUDENT_COLUMNS } from '../api/lib/unitLeaderScopeRules.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// Every Unit Leader endpoint that reads student-derived data.
const ENDPOINTS = {
  roster:     'api/portal/unit-roster.js',
  detail:     'api/portal/unit-student-detail.js',
  shift:      'api/portal/unit-shift-activity.js',
  fileAccess: 'api/portal/unit-student-file-access.js',
  milestones: 'api/portal/unit-milestones.js',
}
const src = Object.fromEntries(Object.entries(ENDPOINTS).map(([k, p]) => [k, stripJs(read(p))]))
const scopeRules = stripJs(read('api/lib/unitLeaderScopeRules.js'))

// The text inside every .select(...) call, joined. A field here is genuinely read back.
function selectArgs(code) {
  const out = []
  const re = /\.select\(\s*([^)]*?)\)/g
  let m
  while ((m = re.exec(code)) !== null) out.push(m[1])
  return out.join(' ')
}
// Returned object keys, i.e. `field:` occurrences. A restricted field here is shipped.
function returnedKey(code, field) {
  return new RegExp(`\\b${field}\\s*:`).test(code)
}
// A field used ONLY as a filter argument (.not('f', ...), .neq('f', ...), .eq('f', ...))
// reads no value and ships nothing; that is the documented count-only pattern.

// The restricted student and shift columns. Any of these appearing in a Unit Leader
// endpoint's code is a defect, EXCEPT where a *_url column is used purely as input to a
// boolean hasFile() availability check (handled explicitly below).
const RESTRICTED_STUDENT = [
  'ssn', 'social_security', 'date_of_birth', 'cumulative_gpa', 'gpa_verified',
  'interview_outcome', 'interview_notes', 'rubric', 'ngrp', 'disposition',
  'admin_notes', 'internal_note', 'review_reason', 'learning_highlight',
  'bls_current', 'health_cleared', 'background_check',
]
// Fields the SHIFT endpoint specifically must not ship. school_email and attestation
// are shift-only exclusions: school_email is an APPROVED contact field in the detail
// endpoint, so it cannot be forbidden globally.
const RESTRICTED_SHIFT = [
  'support_needed', 'admin_notes', 'learning_highlight', 'unit_override_reason',
  'preceptor_override_note', 'exception_flags', 'reviewed_by', 'reviewed_at',
  'attestation', 'school_email',
]
// Fields that are private in EVERY Unit Leader response, regardless of endpoint.
const GLOBAL_FORBIDDEN = [
  ...RESTRICTED_STUDENT,
  'support_needed', 'unit_override_reason', 'preceptor_override_note',
  'exception_flags', 'reviewed_by',
]

// ── The column allowlist itself is clean ────────────────────────────────────
test('UL_STUDENT_COLUMNS excludes every restricted student field', () => {
  const cols = UL_STUDENT_COLUMNS.split(',').map(c => c.trim())
  for (const bad of RESTRICTED_STUDENT) {
    assert.ok(!cols.some(c => c === bad || c.includes(bad)),
      `the Unit Leader column allowlist must not include ${bad}`)
  }
  // It is an allowlist, so it names its columns explicitly rather than selecting all.
  assert.ok(cols.length > 0 && !cols.includes('*'))
})

test('the scope module never selects a restricted column', () => {
  for (const bad of RESTRICTED_STUDENT) {
    assert.ok(!scopeRules.includes(bad),
      `unitLeaderScopeRules must not reference ${bad}`)
  }
})

// ── Each endpoint's selects and responses ───────────────────────────────────
test('the roster endpoint neither selects nor returns a restricted field', () => {
  const sel = selectArgs(src.roster)
  for (const bad of RESTRICTED_STUDENT) {
    assert.ok(!sel.includes(bad), `roster must not SELECT ${bad}`)
    assert.ok(!returnedKey(src.roster, bad), `roster must not RETURN ${bad}`)
  }
  // support_needed is the one restricted field the roster touches, and only to COUNT
  // non-empty notes: it appears in .not()/.neq() filters, never in a select or a
  // returned key. Prove exactly that shape rather than forbidding the name outright.
  assert.ok(!sel.includes('support_needed'), 'the roster must never select the support text')
  assert.ok(!returnedKey(src.roster, 'support_needed'), 'the roster must never return the support text')
  assert.match(src.roster, /\.select\('student_id'\)/, 'the support query selects only the id, for a count')
  // The roster ships has_photo (a boolean), never the path.
  assert.match(src.roster, /has_photo: hasFile\(s\.headshot_url\)/)
  assert.ok(!/headshot_url:/.test(src.roster), 'the roster must not return the headshot path')
  assert.ok(!/resume_url/.test(src.roster))
})

test('the detail endpoint neither selects nor returns a restricted field', () => {
  for (const bad of RESTRICTED_STUDENT) {
    assert.ok(!src.detail.includes(bad), `detail must not reference ${bad}`)
  }
  // Files are booleans in the response, never paths.
  assert.match(src.detail, /has_photo: hasFile\(/)
  assert.match(src.detail, /has_resume: hasFile\(/)
  for (const pathField of ['headshot_url:', 'resume_url:', 'signed_url', 'getPublicUrl']) {
    assert.ok(!src.detail.includes(pathField), `detail must not return ${pathField}`)
  }
})

test('the shift endpoint neither selects nor returns a restricted field', () => {
  for (const bad of RESTRICTED_SHIFT) {
    assert.ok(!src.shift.includes(bad), `shift activity must not reference ${bad}`)
  }
  // It selects a fixed allowlist and never a wildcard.
  assert.match(src.shift, /\.select\(SAFE_COLUMNS\)/)
  assert.ok(!/\.select\('\*'\)/.test(src.shift))
})

test('the file-access endpoint returns only signed URLs, never paths', () => {
  // It legitimately reads headshot_url / resume_url server side to derive the object
  // path, but it must return a signed_url, never the stored path, and never a public URL.
  assert.ok(!src.fileAccess.includes('getPublicUrl'))
  assert.match(src.fileAccess, /createSignedUrl/)
  // And no restricted student field is touched here at all.
  for (const bad of RESTRICTED_STUDENT) {
    assert.ok(!src.fileAccess.includes(bad), `file access must not reference ${bad}`)
  }
})

test('the milestones endpoint carries no restricted field', () => {
  for (const bad of [...RESTRICTED_STUDENT, ...RESTRICTED_SHIFT]) {
    assert.ok(!src.milestones.includes(bad), `milestones must not reference ${bad}`)
  }
})

// ── One consolidated sweep, so a new endpoint cannot slip a field through ────
test('no Unit Leader read endpoint SELECTS or RETURNS any globally-forbidden field', () => {
  // GLOBAL_FORBIDDEN is the truly-private set. school_email and attestation are
  // deliberately NOT here: school_email is an approved contact field on the detail
  // endpoint. The shift endpoint's stricter list is checked in its own test above.
  for (const [name, code] of Object.entries(src)) {
    const sel = selectArgs(code)
    for (const bad of GLOBAL_FORBIDDEN) {
      assert.ok(!sel.includes(bad), `${name} must not select ${bad}`)
      assert.ok(!returnedKey(code, bad), `${name} must not return ${bad}`)
    }
  }
})

test('no Unit Leader endpoint ever selects a wildcard', () => {
  for (const [name, code] of Object.entries(src)) {
    assert.ok(!/\.select\(\s*['"`]\*['"`]\s*\)/.test(code),
      `${name} must not select('*')`)
  }
})
