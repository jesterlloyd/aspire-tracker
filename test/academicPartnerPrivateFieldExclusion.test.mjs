// AP Phase 1, Commit 3 + secure-photo fast-follow: prove the Academic Partner roster endpoint keeps
// a tight response allowlist and never leaks a private field; that authorization and school scope are
// derived only from an active academic_partner grant + user_school_scopes (never a request
// parameter, and the WCU campuses stay isolated); and that the secure student-photo path exposes only
// a presence flag on the roster plus short-lived signed URLs from a SEPARATE server-mediated
// endpoint that authorizes on the SAME school scope, never a raw storage path.
//
// Modeled on test/unitLeaderPrivateFieldExclusion.test.mjs: exclusion is a SERVER property, so the
// guards read endpoint source and its .select() calls. Negative assertions run against
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

const roster = stripJs(read('api/portal/school-students.js'))     // AP roster endpoint
const scope = stripJs(read('api/lib/schoolScope.js'))             // shared AP authorization + scope
const photo = stripJs(read('api/portal/school-student-file-access.js')) // secure photo endpoint
const placement = stripJs(read('api/portal/school-placement-requests.js')) // placement request list + gated submit
const portalRaw = read('src/portal/AcademicPartnerPortal.jsx')
const portal = stripJs(portalRaw)                                 // AP roster UI
const hook = stripJs(read('src/portal/ap/useSchoolStudentPhotos.js'))   // client photo prefetch
const client = stripJs(read('src/portal/ap/academicPartnerApi.js'))     // client file-access fetch
const norm = (s) => String(s).toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim()

// ── Roster endpoint: allowlist, confirmed unit, no private field ─────────────────────────────────

test('confirmed unit resolves from matched_unit_id -> units.unit_name, never the legacy students.unit', () => {
  assert.match(roster, /matched_unit_id/)
  assert.doesNotMatch(roster, /'[^']*\bunit\b[^']*'/)   // no bare 'unit' string column anywhere
  assert.match(roster, /\.from\('units'\)\s*\.select\('id, unit_name'\)/)
  assert.match(roster, /unit_name: unitNameById\[s\.matched_unit_id\] \|\| null/)
  assert.doesNotMatch(roster, /unit_name: s\.unit\b/)
})

test('the response allowlist is exactly the Phase 1 roster fields; no private field is selected', () => {
  for (const col of ['id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
    'school', 'status', 'matched_unit_id', 'preceptor_name', 'term_dates',
    'hours_required', 'approved_hours', 'pending_hours']) {
    assert.match(roster, new RegExp(`'${col}'`), `roster must select ${col}`)
  }
  // No restricted / confidential field is ever selected or returned. headshot_url is deliberately
  // NOT in this list: it is handled by the has_photo test below (selected to derive a boolean, never
  // returned). Comment-stripped source, so a field explained in prose does not read as a leak.
  for (const forbidden of [
    'support_needed', 'learning_highlight', 'admin_notes', 'reviewed_by', 'reviewed_at',
    'review_reason', 'exception_flags', 'unit_override_reason', 'preceptor_override_note',
    'interview_outcome', 'interview_notes', 'rubric', 'ngrp', 'disposition',
    'gpa_verified', 'cumulative_gpa', 'bls_current', 'health_cleared', 'background_check',
    'ssn', 'date_of_birth', 'school_email', 'personal_email', 'phone',
    'resume_url', 'program_type',
  ]) {
    assert.ok(!roster.includes(forbidden), `endpoint must not reference ${forbidden}`)
  }
})

test('the roster exposes only a has_photo boolean; never headshot_url, a path, or a signed URL', () => {
  // headshot_url is selected ONLY to compute the presence flag, through the same hasFile()/
  // parseStoredFileRef pattern as the Unit Leader roster.
  assert.match(roster, /'headshot_url'/)                         // present in the select allowlist
  assert.match(roster, /function hasFile\(stored\)/)
  assert.match(roster, /parseStoredFileRef\(stored\)/)
  assert.match(roster, /has_photo: hasFile\(s\.headshot_url\)/)  // the ONLY use of the value
  // The value itself never leaves the server: no response key named headshot_url, and no signed URL,
  // public URL, or object path is ever constructed or returned by the roster.
  assert.doesNotMatch(roster, /headshot_url:/)                   // not a response entry key
  assert.doesNotMatch(roster, /signed_url|createSignedUrl|getPublicUrl|publicUrl|\.path\b/)
})

test('evaluation exposure stays counts-only (no evaluation content)', () => {
  assert.match(roster, /\.from\('evaluation_assignments'\)\s*\.select\('student_id, status, respondent_type'\)/)
  assert.doesNotMatch(roster, /response_json|answers|score|rubric|comment/)
})

// ── Shared authorization + school scope (api/lib/schoolScope.js) ──────────────────────────────────
// The roster and the photo endpoint both authorize through this one module, so a photo can never be
// signed on a different rule than the roster it appears in.

test('the roster, photo, and placement endpoints share ONE authorization + scope implementation', () => {
  // No endpoint re-implements the scope query; all call the shared helpers, so a placement request
  // is authorized on exactly the same rule (and same student set) as the roster.
  for (const [name, s] of [['roster', roster], ['photo', photo], ['placement', placement]]) {
    assert.match(s, /verifyPortalAcademicPartnerCaller\(req\)/, `${name} verifies via the shared helper`)
    assert.match(s, /resolveSchoolScopedStudents\(db, scopes,/, `${name} resolves scope via the shared helper`)
    assert.doesNotMatch(s, /\.from\('user_school_scopes'\)/, `${name} does not re-read scopes inline`)
    assert.doesNotMatch(s, /req\.query|req\.params/, `${name} never reads scope from the request`)
  }
})

test('school scope is derived from an active academic_partner grant + user_school_scopes only', () => {
  assert.match(scope, /hasActiveRoleGrant\(db, auth\.profile\.id, 'academic_partner'\)/)
  assert.match(scope, /\.from\('user_school_scopes'\)/)
  // Active-scope filter: not revoked, started, not expired.
  assert.match(scope, /r\.revoked_at === null/)
  assert.match(scope, /new Date\(r\.starts_at\) <= now/)
  assert.match(scope, /r\.expires_at == null \|\| new Date\(r\.expires_at\) > now/)
  // Nothing from the request influences scope: the helper never reads a query, body, or params.
  assert.doesNotMatch(scope, /req\.query|req\.body|req\.params/)
})

test('the shared helper fails closed: unauthenticated -> 401/403, non-partner -> 403', () => {
  assert.match(scope, /if \(!auth\.authenticated\)/)
  assert.match(scope, /if \(!isPartner\) return \{ ok: false, status: 403/)
  // An empty scope is a valid "sees nothing" result, and the roster returns an empty payload for it.
  assert.match(roster, /if \(scopes\.length === 0\) return res\.status\(200\)\.json\(\{ schools: \[\] \}\)/)
})

test('scope matching is EXACT normalized term membership, so WCU campuses cannot cross', () => {
  // The helper scopes by exact normalized term membership (terms.has(norm(student.school))), built
  // from resolveSchoolAliases(school_key). So a campus scope resolves only to its own terms.
  assert.match(scope, /terms\.has\(n\)/)
  assert.match(scope, /const n = norm\(s\.school\)/)

  const anaheim = resolveSchoolAliases('West Coast University Anaheim').map(norm)
  const noho = resolveSchoolAliases('West Coast University North Hollywood').map(norm)
  const parent = resolveSchoolAliases('West Coast University').map(norm)

  assert.ok(!anaheim.includes(norm('West Coast University North Hollywood')))
  assert.ok(!anaheim.includes(norm('West Coast University')))
  assert.ok(!anaheim.some(t => noho.includes(t)))            // the two campus term sets are disjoint
  assert.ok(!parent.includes(norm('West Coast University Anaheim')))
  assert.ok(!parent.includes(norm('West Coast University North Hollywood')))
})

// ── Secure photo endpoint (api/portal/school-student-file-access.js) ──────────────────────────────

test('the photo endpoint is POST-only and serves ONLY the approved profile photo (headshot)', () => {
  assert.match(photo, /if \(req\.method !== 'POST'\) return res\.status\(405\)/)
  assert.match(photo, /const ALLOWED_KINDS = new Set\(\['headshot'\]\)/)
  // No resume, onboarding document, or certificate is ever reachable through the AP endpoint.
  assert.doesNotMatch(photo, /'resume'|resume_url|onboarding|certificate/)
})

test('the photo path is derived server-side; the browser never supplies a path or a school', () => {
  // The stored reference is the ONLY source of the object path.
  assert.match(photo, /parseStoredFileRef\(student\.headshot_url\)/)
  // No request-supplied object path, and no school identifier is accepted as authorization input.
  assert.doesNotMatch(photo, /body\.path|item\.path|req\.query|school_key|body\.school/)
  // The authorized set is the intersection of the caller's scoped students with the requested ids.
  assert.match(photo, /resolveSchoolScopedStudents\(db, scopes, FILE_COLUMNS\)/)
  assert.match(photo, /if \(wanted\.has\(student\.id\)\) map\.set\(student\.id, student\)/)
})

test('the photo endpoint returns only a short-lived signed URL, never a raw or public path', () => {
  assert.match(photo, /const SIGNED_URL_TTL_SECONDS = 300/)
  assert.match(photo, /STUDENT_FILES_BUCKET/)
  assert.match(photo, /createSignedUrl\(ref\.path, SIGNED_URL_TTL_SECONDS\)/)
  assert.match(photo, /signed_url: signed\.signedUrl/)
  // No public URL is constructed, and the object path is used ONLY to sign, never returned.
  assert.doesNotMatch(photo, /getPublicUrl|publicUrl/)
  assert.doesNotMatch(photo, /json\([^)]*ref\.path|res\.status\(200\)\.json\(\{[^}]*path/)
})

test('the photo endpoint is non-enumerating: cross-school, revoked, expired, and missing all null out', () => {
  // A single null shape covers every failure: bad input, out-of-scope student, and a student with no
  // photo are indistinguishable, so the endpoint never leaks whether a student or a file exists.
  assert.match(photo, /const nullResult = \(studentId, kind\) => \(\{ student_id: studentId, kind, signed_url: null \}\)/)
  assert.match(photo, /const student = authorized\.get\(studentId\)\s*\n\s*if \(!student\) \{/)
  assert.match(photo, /if \(ref\.kind === 'empty' \|\| ref\.kind === 'unknown'\) \{\s*\n\s*results\.push\(nullResult/)
  assert.match(photo, /if \(signErr \|\| !signed\?\.signedUrl\) \{\s*\n\s*results\.push\(nullResult/)
})

// ── Roster UI: secure photo when available, initials fallback, no raw path, sort/filter unchanged ──

test('the roster avatar renders the securely resolved photo with the initials fallback preserved', () => {
  assert.match(portalRaw, /import UnitStudentAvatar from '\.\/unit\/UnitStudentAvatar'/)
  assert.match(portalRaw, /import \{ useSchoolStudentPhotos \} from '\.\/ap\/useSchoolStudentPhotos'/)
  assert.match(portalRaw, /const photos = useSchoolStudentPhotos\(roster\)/)
  assert.match(portalRaw, /<UnitStudentAvatar url=\{photos\.peek\(s\.id\)\} name=\{displayName\(s\)\} size=\{34\} \/>/)
  // The avatar itself keeps the initials fallback and never fetches (presentational only).
  const avatar = read('src/portal/unit/UnitStudentAvatar.jsx')
  assert.match(avatar, /function initials\(name\)/)
  assert.match(avatar, /const showPhoto = url && !failed/)
  assert.doesNotMatch(avatar, /fetch\(|createSignedUrl|storage\.from/)
})

test('the roster UI never renders a raw storage path or signed URL', () => {
  assert.doesNotMatch(portal, /headshot_url|storage\.from|createSignedUrl|signed_url|getPublicUrl|\.path\b/)
})

test('photos are requested only for students the server flagged has_photo, through the AP endpoint', () => {
  assert.match(hook, /s\?\.id && s\.has_photo && !peekStudentPhotoUrl\(apPhotoKey\(s\.id\)\)/)
  assert.match(hook, /getSchoolStudentFileUrlsBatch/)
  // Namespaced cache key so an AP-signed URL cannot collide with a UL- or staff-signed one.
  assert.match(hook, /ap:headshot:/)
  // The hook never resolves a path itself; it only primes the server-returned signed URL.
  assert.doesNotMatch(hook, /createSignedUrl|storage\.from|\.path\b/)
  // The client posts to the AP file endpoint and sends no school key as authority.
  assert.match(client, /'\/api\/portal\/school-student-file-access'/)
  assert.doesNotMatch(client, /school_key|unit_key/)
})

test('sorting and filtering are unchanged; the photo prefetch keys off the roster, not the sort', () => {
  // The client-side filter+sort pipeline is untouched.
  assert.match(portalRaw, /const rows = sortRoster\(filtered, sort\.column, sort\.direction\)/)
  assert.doesNotMatch(portalRaw, /fetch\([^)]*sort|[?&]sort=|order_by/)
  // The prefetch depends on the per-school roster (stable across sort/filter), never the sorted rows,
  // so changing sort or filter never re-signs photos.
  assert.match(portalRaw, /useSchoolStudentPhotos\(roster\)/)
  assert.doesNotMatch(portalRaw, /useSchoolStudentPhotos\(rows\)/)
})

// ── Placement request list endpoint (api/portal/school-placement-requests.js) ─────────────────────

test('the placement-request list selects a public-safe allowlist and no confidential field', () => {
  // The request list may show identity, cohort, status, rotation dates, unit, preceptor, hours, and
  // the submission timestamp. It must never select or return a confidential field.
  for (const col of ['id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
    'school', 'status', 'matched_unit_id', 'preceptor_name',
    'hours_required', 'approved_hours', 'pending_hours', 'created_at', 'cohort_school_rotation_id']) {
    assert.match(placement, new RegExp(`'${col}'`), `placement list must select ${col}`)
  }
  for (const forbidden of [
    'support_needed', 'learning_highlight', 'admin_notes', 'reviewed_by', 'review_reason',
    'exception_flags', 'unit_override_reason', 'preceptor_override_note',
    'interview_outcome', 'interview_notes', 'rubric', 'ngrp', 'disposition',
    'gpa_verified', 'cumulative_gpa', 'bls_current', 'health_cleared', 'background_check',
    'ssn', 'date_of_birth', 'personal_email', 'headshot_url', 'resume_url',
    'changes_requested', 'unit_comment', 'unit_response',
  ]) {
    assert.ok(!placement.includes(forbidden), `placement endpoint must not reference ${forbidden}`)
  }
  // Rotation dates come from the coordinator-owned rotation row, not any private student field.
  assert.match(placement, /\.from\('cohort_school_rotations'\)/)
  assert.match(placement, /rotation_start_date, rotation_end_date/)
})

test('the placement-request list evaluation/interview surface is absent (no scores or content)', () => {
  assert.doesNotMatch(placement, /evaluation_assignments|response_json|answers|score|rubric|interview/)
  // No Needs Clarification / Unit Leader changes_requested is exposed to the Academic Partner.
  assert.doesNotMatch(placement, /Needs Clarification|changes_requested/)
})

test('placement submission gates on provenance readiness AFTER the auth chain, and never writes inline', () => {
  // Method allowlist is GET + POST only; an empty scope returns an empty list (with the readiness hint).
  assert.match(placement, /req\.method !== 'GET' && req\.method !== 'POST'/)
  assert.match(placement, /if \(scopes\.length === 0\) return res\.status\(200\)\.json\(\{ schools: \[\], submission_enabled: submissionEnabled \}\)/)
  // The auth chain runs BEFORE the POST submission logic, so an unauthorized caller is rejected first.
  assert.match(placement, /verifyPortalAcademicPartnerCaller\(req\)[\s\S]*if \(req\.method === 'POST'\)/)
  // Fail-closed until the migration is applied, detected at runtime from the live schema.
  assert.match(placement, /const provenanceReady = await isPlacementProvenanceReady\(db\)/)
  assert.match(placement, /submission_not_enabled/)
  assert.match(placement, /provenance_pending_migration/)
  // The write goes through the shared helper (never an inline students insert/update in the endpoint).
  assert.match(placement, /performSchoolPlacementUpsert\(db,/)
  assert.doesNotMatch(placement, /\.insert\(|\.update\(|\.upsert\(/)
})
