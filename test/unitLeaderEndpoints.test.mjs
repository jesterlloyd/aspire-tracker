// UL-PORTAL: guards for the Unit Leader workflow endpoints.
//
// Every endpoint must authorize through the single source of truth, fail closed,
// never let a request widen scope, never let a Unit Leader action become an ASPIRE
// approval, and never leak whether an out-of-scope record exists.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const audit       = read('api/lib/unitLeaderAudit.js')
const files       = read('api/portal/unit-student-file-access.js')
const placement   = read('api/portal/unit-placement-requests.js')
const capacity    = read('api/portal/unit-capacity.js')
const milestones  = read('api/portal/unit-milestones.js')
const nominations = read('api/portal/unit-preceptor-nominations.js')
const staffFiles  = read('api/student-file-access.js')

// Executable JS only. Several of these files DESCRIBE the thing they must not do
// (for example capacity explains why it does not reuse unit_cohort_responses), so
// negative assertions must never run against prose.
const stripJs = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const capacityCode    = stripJs(capacity)
const filesCode       = stripJs(files)
const placementCode   = stripJs(placement)
const nominationsCode = stripJs(nominations)
const milestonesCode  = stripJs(milestones)

const WORKFLOW = {
  'unit-placement-requests.js': placement,
  'unit-capacity.js': capacity,
  'unit-milestones.js': milestones,
  'unit-preceptor-nominations.js': nominations,
}
const ALL_UL = { ...WORKFLOW, 'unit-student-file-access.js': files }

// ── Authorization: one source of truth, fail closed ─────────────────────────
test('every Unit Leader endpoint authorizes through verifyPortalUnitLeaderCaller', () => {
  for (const [name, src] of Object.entries(ALL_UL)) {
    assert.match(src, /verifyPortalUnitLeaderCaller/, name)
    assert.match(src, /if \(!auth\.ok\) return res\.status\(auth\.status\)/, name)
    // No endpoint open-codes the grant or scope lookup.
    assert.doesNotMatch(src, /hasActiveRoleGrant\(/, name)
    assert.doesNotMatch(src, /getActiveUnitScopes\(/, name)
  }
})

test('no Unit Leader endpoint authorizes by name, email, title, or is_staff', () => {
  for (const [name, src] of Object.entries(ALL_UL)) {
    assert.doesNotMatch(src, /is_staff/, name)
    assert.doesNotMatch(src, /\bcanEdit\b|\bisAdmin\b/, name)
    // Authorization never reads a display name.
    assert.doesNotMatch(src, /\.eq\('full_name'|\.eq\('email'/, name)
  }
})

test('an empty scope set yields an empty result, never an unscoped query', () => {
  for (const [name, src] of Object.entries(ALL_UL)) {
    if (name === 'unit-student-file-access.js') continue
    assert.match(src, /scopes\.length === 0\) return res\.status\(200\)/, name)
  }
})

test('a unit_key request parameter can only NARROW, never widen', () => {
  for (const [name, src] of Object.entries(WORKFLOW)) {
    assert.match(src, /narrowScopes\(scopes, requestedUnit\)/, name)
    // A null return is a denial, never a fallback to the full set.
    assert.match(src, /if \(effective === null\) return res\.status\(403\)/, name)
  }
})

test('list results are re-filtered by the scope cohort rule after fetch', () => {
  for (const [name, src] of Object.entries(WORKFLOW)) {
    assert.match(
      src,
      /s\.cohort_id === null \|\| s\.cohort_id === r\.cohort_id/,
      `${name} must apply the scope cohort restriction`)
  }
})

test('out-of-scope records are reported as not found, never as forbidden', () => {
  // Distinguishing them would confirm the record exists.
  assert.match(placement, /if \(!covered\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  assert.match(milestones, /if \(!student\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  assert.match(nominations, /if \(!student\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
})

test('every write endpoint uses a strict body allowlist', () => {
  for (const [name, src] of Object.entries(WORKFLOW)) {
    assert.match(src, /const allowed = new Set\(/, name)
    assert.match(src, /return res\.status\(400\)\.json\(\{ error: 'unexpected_field', field: k \}\)/, name)
  }
})

// ── ASPIRE retains final authority ──────────────────────────────────────────
test('a placement response never writes the ASPIRE decision columns', () => {
  // The LOAD query also uses .eq('id', requestId), so the closing anchor must be
  // searched for AFTER the update, not from the start of the file.
  const updStart = placementCode.indexOf('.update({')
  const update = placementCode.slice(
    updStart, placementCode.indexOf(".eq('id', requestId)", updStart))
  assert.ok(update.length > 0, 'update payload slice must not be empty')
  assert.match(update, /unit_response: response/)
  assert.doesNotMatch(update, /aspire_status/)
  assert.doesNotMatch(update, /aspire_decided_by_profile_id/)
  assert.doesNotMatch(update, /aspire_decided_at/)
})

test('a placement response is refused once ASPIRE has decided', () => {
  assert.match(placement, /if \(row\.aspire_status !== 'open'\)/)
  assert.match(placement, /already_decided/)
  // And the write itself is guarded, so a stale client cannot race it.
  assert.match(placement, /\.eq\('aspire_status', 'open'\)/)
})

test('capacity never sets its own review status', () => {
  const insert = capacityCode.slice(capacityCode.indexOf('.insert({'), capacityCode.indexOf('.select('))
  assert.doesNotMatch(insert, /review_status/)
  assert.doesNotMatch(insert, /reviewed_by_profile_id/)
  assert.doesNotMatch(insert, /reviewed_at/)
})

test('a nomination never writes the authoritative assignment table', () => {
  assert.doesNotMatch(nominationsCode, /from\('student_preceptor_assignments'\)/)
  assert.match(nominations, /A NOMINATION IS NOT AN ASSIGNMENT/)
})

test('every workflow response surfaces the ASPIRE state to the UI', () => {
  assert.match(placement, /awaiting_aspire_confirmation: r\.aspire_status === 'open'/)
  assert.match(capacity, /awaiting_aspire_review: r\.review_status === 'submitted'/)
  assert.match(nominations, /awaiting_aspire_confirmation: r\.status === 'nominated'/)
})

// ── Capacity: supersede, never overwrite ────────────────────────────────────
test('a capacity correction inserts a new row and supersedes the prior one', () => {
  assert.match(capacity, /supersedes_id: supersedesId/)
  assert.match(capacity, /\.update\(\{ superseded_at: now \}\)/)
  // The prior row is only retired AFTER the replacement exists.
  assert.ok(
    capacity.indexOf('.insert({') < capacity.indexOf('superseded_at: now'),
    'the replacement must be inserted before the prior row is superseded')
  // And a failure compensates rather than leaving no live submission.
  assert.match(capacity, /await db\.from\('unit_capacity_submissions'\)\.delete\(\)\.eq\('id', created\.id\)/)
})

test('a capacity correction is refused once reviewed or already superseded', () => {
  assert.match(capacity, /if \(p\.superseded_at\) return res\.status\(409\)\.json\(\{ error: 'already_superseded' \}\)/)
  assert.match(capacity, /if \(p\.review_status !== 'submitted'\)/)
  assert.match(capacity, /already_reviewed/)
})

test('capacity never touches the legacy public unit form path', () => {
  assert.doesNotMatch(capacityCode, /unit_cohort_responses/)
  assert.doesNotMatch(capacityCode, /from\('units'\)/)
})

// ── Milestones ──────────────────────────────────────────────────────────────
test('milestones are attributed, timestamped, and never hard deleted', () => {
  assert.match(milestones, /confirmed_by_profile_id: profile\.id/)
  assert.match(milestones, /confirmed_at: now/)
  assert.doesNotMatch(milestones, /\.delete\(\)/)
})

test('a Unit Leader cannot correct a milestone', () => {
  // Correction is Owner/Admin only; this endpoint never writes those columns.
  const insert = milestonesCode.slice(milestonesCode.indexOf('.insert({'), milestonesCode.indexOf('.select('))
  assert.doesNotMatch(insert, /corrected_by_profile_id/)
  assert.doesNotMatch(insert, /corrected_at/)
})

test('concluding a rotation stamps rotation_completed_at exactly once', () => {
  assert.match(milestones, /if \(milestone === 'rotation_conclusion'\)/)
  assert.match(milestones, /\.update\(\{ rotation_completed_at: now \}\)/)
  // Never move an existing conclusion.
  assert.match(milestones, /\.is\('rotation_completed_at', null\)/)
})

test('the milestone unit is derived from the student, never from the request', () => {
  assert.match(milestones, /unit_key: student\.unit_key/)
  const allowed = milestones.slice(milestones.indexOf('const allowed = new Set('))
  assert.doesNotMatch(allowed.slice(0, 120), /unit_key/)
})

// ── Nominations ─────────────────────────────────────────────────────────────
test('a named preceptor must belong to the student unit, checked server side', () => {
  assert.match(nominations, /from\('preceptors'\)/)
  assert.match(nominations, /if \(prec\.unit_name !== student\.unit_key\)/)
  assert.match(nominations, /preceptor_not_in_unit/)
  assert.match(nominations, /preceptor_inactive/)
})

// ── File access: Wave F-2 mediation ─────────────────────────────────────────
test('Unit Leader file access is a separate endpoint from the staff one', () => {
  // The staff endpoint still authorizes purely by user_profiles.role.
  assert.match(staffFiles, /staff_role_required/)
  assert.doesNotMatch(staffFiles, /verifyPortalUnitLeaderCaller/)
  assert.doesNotMatch(staffFiles, /user_unit_scopes/)
  // And the Unit Leader endpoint explains why it is separate.
  assert.match(files, /SEPARATE endpoint from api\/student-file-access\.js on purpose/)
})

test('the browser never supplies an object path and no public URL is returned', () => {
  assert.match(files, /parseStoredFileRef/)
  assert.doesNotMatch(filesCode, /getPublicUrl/)
  // The path comes from the stored student reference only.
  assert.match(files, /const stored = kind === 'resume' \? student\.resume_url : student\.headshot_url/)
  const allowed = files.slice(files.indexOf('const requested ='), files.indexOf('if (requested.length === 0)'))
  assert.doesNotMatch(allowed, /\bpath\b/)
})

test('Unit Leader file access is read only: no upload, replace, rename, or delete', () => {
  assert.doesNotMatch(filesCode, /createSignedUploadUrl|uploadToSignedUrl|\.upload\(|\.remove\(|\.move\(|\.copy\(/)
  assert.match(files, /Unit Leaders are READ ONLY/)
})

test('only headshot and resume are reachable, never onboarding documents', () => {
  assert.match(files, /const ALLOWED_KINDS = new Set\(\['headshot', 'resume'\]\)/)
  assert.match(files, /if \(!studentId \|\| !kind \|\| !ALLOWED_KINDS\.has\(kind\)\)/)
})

test('unauthorized file access returns a null url, never an error', () => {
  assert.match(files, /const nullResult = /)
  assert.match(filesCode, /if \(!student\) \{[\s\S]*?results\.push\(nullResult\(studentId, kind\)\)/)
  assert.match(files, /not leak whether a student or a file exists/)
})

test('no signed URL is persisted and responses are not cached', () => {
  assert.match(files, /res\.setHeader\('Cache-Control', 'no-store'\)/)
  assert.doesNotMatch(filesCode, /\.insert\(|\.update\(|\.upsert\(/)
})

test('the batch path resolves the authorized set once, not per student', () => {
  assert.match(files, /resolveUnitScopedStudents\(db, scopes\)/)
  assert.doesNotMatch(filesCode, /for \(const id of wanted\)/)
  assert.match(files, /MAX_BATCH/)
})

// ── Audit ───────────────────────────────────────────────────────────────────
test('every state-changing endpoint emits an audit record', () => {
  for (const [name, src] of Object.entries(WORKFLOW)) {
    assert.match(src, /emitUnitLeaderAudit\(db, profile, \{/, name)
  }
  // Reads do not.
  assert.doesNotMatch(files, /emitUnitLeaderAudit/)
})

test('audit records the acting role and unit context, not the portal role', () => {
  assert.match(audit, /user_role: 'unit_leader'/)
  assert.match(audit, /unit_key: unitKey/)
  assert.match(audit, /actor_profile_id: actor\?\.id/)
  assert.match(audit, /from_value: fromValue/)
  assert.match(audit, /to_value: toValue/)
  assert.match(audit, /aspire_status: aspireStatus/)
})

test('audit failure never fails the operation', () => {
  assert.match(audit, /try \{/)
  assert.match(audit, /catch \(err\) \{[\s\S]{0,200}console\.warn/)
  assert.match(audit, /Best effort by design/)
})

test('audit writes through the service-role client, since portal RLS forbids it', () => {
  assert.match(audit, /activity_logs RLS allows INSERT only under is_staff\(\)/)
})

test('no em dash in the Unit Leader endpoints', () => {
  for (const [name, src] of Object.entries({ ...ALL_UL, 'unitLeaderAudit.js': audit })) {
    assert.doesNotMatch(src, /—/, name)
  }
})
