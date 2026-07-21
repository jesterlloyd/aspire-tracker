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
// The atomic guarantees now live in the follow-up migration's RPCs, so the
// assertions about them read the committed SQL rather than the endpoint.
const rpcMigration = read('supabase/migrations/20260720000001_unit_leader_transactional_integrity.sql')
const rpcLive = rpcMigration.replace(/\/\*[\s\S]*?\*\//g, '')
const respondFn = rpcLive.slice(
  rpcLive.indexOf('CREATE OR REPLACE FUNCTION public.unit_placement_respond'),
  rpcLive.indexOf('CREATE OR REPLACE FUNCTION public.unit_capacity_submit'))
const capacityFn = rpcLive.slice(
  rpcLive.indexOf('CREATE OR REPLACE FUNCTION public.unit_capacity_submit'),
  rpcLive.indexOf('CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v2'))

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
  assert.match(milestones, /if \(!student\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  assert.match(nominations, /if \(!student\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  // Placement now denies inside the RPC, with the same non-enumerating result:
  // a missing request, a missing grant, and an out-of-scope unit all raise MS404.
  const notFounds = respondFn.match(/RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404'/g) || []
  assert.ok(notFounds.length >= 3, `expected 3 non-enumerating denials, saw ${notFounds.length}`)
})

test('every write endpoint uses a strict body allowlist', () => {
  for (const [name, src] of Object.entries(WORKFLOW)) {
    assert.match(src, /const allowed = new Set\(/, name)
    assert.match(src, /return res\.status\(400\)\.json\(\{ error: 'unexpected_field', field: k \}\)/, name)
  }
})

// ── ASPIRE retains final authority ──────────────────────────────────────────
test('a placement response never writes the ASPIRE decision columns', () => {
  const setClause = respondFn.slice(
    respondFn.indexOf('UPDATE public.unit_placement_requests'),
    respondFn.indexOf('RETURNING * INTO v_row'))
  assert.match(setClause, /unit_response\s+= p_unit_response/)
  assert.doesNotMatch(setClause, /aspire_status/)
  assert.doesNotMatch(setClause, /aspire_decided_by_profile_id/)
  assert.doesNotMatch(setClause, /aspire_decided_at/)
})

test('a placement response is refused once ASPIRE has decided, under a row lock', () => {
  assert.match(respondFn, /FOR UPDATE/)
  assert.match(respondFn, /v_row\.aspire_status <> 'open'/)
  assert.match(respondFn, /ASPIRE has already decided this request/)
  // The lock is taken BEFORE the guard, so two responses serialize.
  assert.ok(
    respondFn.indexOf('FOR UPDATE') < respondFn.indexOf("v_row.aspire_status <> 'open'"),
    'the row must be locked before the ASPIRE guard is evaluated')
})

test('the placement RPC re-derives authorization and writes history atomically', () => {
  assert.match(respondFn, /FROM public\.user_role_grants/)
  assert.match(respondFn, /FROM public\.user_unit_scopes/)
  assert.match(respondFn, /INSERT INTO public\.unit_placement_request_events/)
  // Update and history insert are in one function body, so one transaction.
  assert.ok(
    respondFn.indexOf('UPDATE public.unit_placement_requests') <
    respondFn.indexOf('INSERT INTO public.unit_placement_request_events'))
})

test('capacity never sets its own review status', () => {
  const insert = capacityFn.slice(
    capacityFn.indexOf('INSERT INTO public.unit_capacity_submissions'),
    capacityFn.indexOf('RETURNING * INTO v_new'))
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
test('a capacity correction supersedes and inserts atomically, under a row lock', () => {
  assert.match(capacityFn, /FOR UPDATE/)
  assert.match(capacityFn, /UPDATE public\.unit_capacity_submissions/)
  assert.match(capacityFn, /INSERT INTO public\.unit_capacity_submissions/)
  // The lock precedes every guard, which is what makes it race safe.
  assert.ok(
    capacityFn.indexOf('FOR UPDATE') < capacityFn.indexOf('v_prior.superseded_at IS NOT NULL'),
    'the prior row must be locked before its state is re-checked')
  // No compensating delete is needed once both writes are one transaction.
  assert.doesNotMatch(capacityFn, /DELETE FROM/i)
})

test('STALE WRITE: a capacity correction is refused once reviewed or superseded', () => {
  assert.match(capacityFn, /v_prior\.superseded_at IS NOT NULL/)
  assert.match(capacityFn, /already superseded/)
  assert.match(capacityFn, /v_prior\.review_status <> 'submitted'/)
  assert.match(capacityFn, /already reviewed/)
  // And the scope is re-derived inside the function, not trusted from the API.
  assert.match(capacityFn, /FROM public\.user_unit_scopes/)
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
test('AUDIT IS NEVER BEST EFFORT: each workflow has an atomic audit of record', () => {
  // placement and capacity: the audit is written by the RPC in the SAME
  // transaction, so they must NOT also duplicate into activity_logs.
  assert.match(placement, /db\.rpc\('unit_placement_respond'/)
  assert.doesNotMatch(placementCode, /emitUnitLeaderAudit/)
  assert.match(capacity, /db\.rpc\('unit_capacity_submit'/)
  assert.doesNotMatch(capacityCode, /emitUnitLeaderAudit/)

  // milestones and nominations: a single attributed INSERT into a table that is
  // never hard deleted IS the audit of record. activity_logs is supplementary.
  assert.match(milestones, /confirmed_by_profile_id: profile\.id/)
  assert.match(nominations, /nominated_by_profile_id: profile\.id/)

  // Reads emit nothing.
  assert.doesNotMatch(files, /emitUnitLeaderAudit/)
})

test('the audit module states plainly that it is NOT the audit of record', () => {
  assert.match(audit, /THIS IS NOT THE AUDIT OF RECORD/)
  assert.match(audit, /the domain row is the audit/)
})

// ── Atomicity ───────────────────────────────────────────────────────────────
test('a placement response goes through the atomic RPC, not a bare update', () => {
  assert.match(placement, /db\.rpc\('unit_placement_respond'/)
  // The non-atomic update-then-insert is gone.
  assert.doesNotMatch(placementCode, /\.from\('unit_placement_requests'\)[\s\S]{0,200}\.update\(/)
  assert.doesNotMatch(placementCode, /from\('unit_placement_request_events'\)/)
})

test('a capacity submission goes through the atomic RPC, not insert-then-supersede', () => {
  assert.match(capacity, /db\.rpc\('unit_capacity_submit'/)
  // The compensating-delete path is gone.
  assert.doesNotMatch(capacityCode, /\.delete\(\)/)
  assert.doesNotMatch(capacityCode, /superseded_at: now/)
})

test('RPC errors map to stable keys, never a raw database message', () => {
  const mapper = read('api/lib/unitLeaderRpcErrors.js')
  assert.match(mapper, /MS400: 400/)
  assert.match(mapper, /MS403: 403/)
  assert.match(mapper, /MS404: 404/)
  assert.match(mapper, /MS409: 409/)
  // Unknown codes fail closed to 500.
  assert.match(mapper, /\?\? 500/)
  assert.match(mapper, /\?\? 'internal_error'/)
  // The raw message is never returned.
  assert.doesNotMatch(mapper, /err\?\.message/)
})

test('the capacity backstop unique violation still maps to a conflict', () => {
  assert.match(capacity, /rpcErr\.code === '23505'/)
  assert.match(capacity, /duplicate_live_submission/)
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

// ── Direct-thread authorship (correction 3) ─────────────────────────────────
const threadFn = rpcLive.slice(rpcLive.indexOf('CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v2'))
const verifyRpc = read('db/audit/unit_leader_transactional_integrity_preflight_and_verification.sql')

test('APPLICATION-ONLY WAS IMPOSSIBLE: the old projection collapsed identity', () => {
  // The pre-existing RPC returned only author_type/label/name, with author_profile_id
  // and author_role consumed inside the CASE. The API could not recover the truth,
  // which is why this had to be a database change.
  const phase5 = read('supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql')
  assert.match(phase5, /CASE WHEN p\.author_role = 'staff' THEN 'staff' ELSE 'me' END/)
  assert.doesNotMatch(phase5, /'author_profile_id', p\.author_profile_id/)
})

test('authorship is now decided by IDENTITY, not by role', () => {
  assert.match(threadFn, /WHEN p\.author_profile_id = public\.portal_profile_id\(\) THEN 'me'/)
  assert.match(threadFn, /WHEN p\.author_profile_id = public\.portal_profile_id\(\) THEN 'You'/)
})

test('the three author types are me, staff, and participant', () => {
  const typeCase = threadFn.slice(threadFn.indexOf("'author_type'"), threadFn.indexOf("'author_label'"))
  assert.match(typeCase, /THEN 'me'/)
  assert.match(typeCase, /WHEN p\.author_role = 'staff' THEN 'staff'/)
  assert.match(typeCase, /ELSE 'participant'/)
})

test('a participant is labeled by their own display name, never You', () => {
  const labelCase = threadFn.slice(threadFn.indexOf("'author_label'"), threadFn.indexOf("'author_name'"))
  assert.match(labelCase, /SELECT up\.full_name FROM public\.user_profiles up/)
  // With a safe fallback per role if a profile name is missing.
  assert.match(labelCase, /WHEN 'unit_leader' THEN 'Unit Leader'/)
})

test('the acting role is projected so the UI can badge a Unit Leader', () => {
  assert.match(threadFn, /'author_role', p\.author_role/)
})

test('EXISTING student to ASPIRE Team authorship is preserved exactly', () => {
  // The viewing student matches by identity -> 'me'/'You', as before.
  // Staff still map to 'staff'/'ASPIRE Team', as before.
  const labelCase = threadFn.slice(threadFn.indexOf("'author_label'"), threadFn.indexOf("'author_name'"))
  assert.match(labelCase, /WHEN p\.author_role = 'staff' THEN 'ASPIRE Team'/)
  assert.match(threadFn, /EXISTING BEHAVIOR IS PRESERVED EXACTLY/)
})

test('no author email is ever projected', () => {
  assert.doesNotMatch(threadFn, /up\.email/)
})

test('the thread RPC keeps its signature, so grants survive CREATE OR REPLACE', () => {
  assert.match(threadFn, /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread_v2\(/)
  assert.doesNotMatch(rpcLive, /DROP FUNCTION IF EXISTS public\.messages_portal_get_thread_v2/)
})

// ── The follow-up migration itself ──────────────────────────────────────────
test('the follow-up migration is transactional with a reviewed rollback', () => {
  assert.match(rpcMigration, /BEGIN;[\s\S]*COMMIT;/)
  assert.match(rpcMigration, /Rollback\./)
  // The rollback restores the Phase 5 binary projection verbatim.
  assert.match(rpcMigration, /CASE WHEN p\.author_role = 'staff' THEN 'staff' ELSE 'me' END/)
  assert.match(rpcMigration, /DROP FUNCTION IF EXISTS public\.unit_capacity_submit/)
  assert.match(rpcMigration, /DROP FUNCTION IF EXISTS public\.unit_placement_respond/)
})

test('both new RPCs are service_role only', () => {
  for (const fn of ['unit_placement_respond', 'unit_capacity_submit']) {
    assert.match(rpcLive, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*FROM PUBLIC, anon, authenticated`))
    assert.match(rpcLive, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*TO service_role`))
  }
})

test('the follow-up migration does not touch Wave F-2 or the read/send split', () => {
  const sql = rpcLive.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(sql, /storage\.buckets|storage\.objects|student-files/)
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.message_participant_can_(read|send)/)
  assert.doesNotMatch(sql, /ALTER TABLE public\.user_unit_scopes/)
})

test('the follow-up preflight and verification are read only with stop conditions', () => {
  assert.doesNotMatch(verifyRpc, /^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.match(verifyRpc, /STOP CONDITIONS/)
  for (let i = 1; i <= 6; i++) assert.match(verifyRpc, new RegExp(`PREFLIGHT ${i}:`))
  assert.match(verifyRpc, /VERIFY 4: the author projection is now identity-based and three-way/)
  assert.match(verifyRpc, /STOP if is_binary_projection is still true/)
  // And it uses executable-pattern matching, not bare substrings.
  assert.match(verifyRpc, /prosrc ~\* 'FROM public\\\.user_unit_scopes'/)
})

test('no em dash in the follow-up migration or its verification', () => {
  assert.doesNotMatch(rpcMigration, /—/)
  assert.doesNotMatch(verifyRpc, /—/)
})

// ── The thread RPC ACL must be PRESERVED, not tightened ─────────────────────
// Traced after VERIFY 4b wrongly expected authenticated to be denied EXECUTE.
// The grant is intentional and load bearing: 20260716000006 explicitly REVOKEs
// from PUBLIC and anon and GRANTs to authenticated and service_role, and the sole
// production caller runs the RPC as the signed-in student so auth.uid() resolves.
const phase5Grant = read('supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql')
const threadEndpoint = read('api/portal/messages-thread.js')

test('ACL: the thread RPC grant to authenticated is explicit and intentional', () => {
  assert.match(phase5Grant,
    /REVOKE ALL ON FUNCTION public\.messages_portal_get_thread_v2\(uuid, integer, timestamptz, uuid\)\s*\n\s*FROM PUBLIC, anon;/)
  assert.match(phase5Grant,
    /GRANT EXECUTE ON FUNCTION public\.messages_portal_get_thread_v2\(uuid, integer, timestamptz, uuid\)\s*\n\s*TO authenticated, service_role;/)
})

test('ACL: the grant is LOAD BEARING because the caller runs as the student', () => {
  // getUserScopedDb is an anon-key client carrying the caller's JWT, so the
  // statement executes as `authenticated` and auth.uid() is that student.
  assert.match(threadEndpoint, /const db = getUserScopedDb\(req\)/)
  assert.match(threadEndpoint, /db\.rpc\('messages_portal_get_thread_v2', \{/)
  // It is NOT executed with the service-role client.
  assert.doesNotMatch(threadEndpoint, /getServiceDb\(\)[\s\S]{0,400}messages_portal_get_thread_v2/)
})

test('ACL: the function resolves the viewer from auth.uid(), so service_role would fail', () => {
  // portal_profile_id() reads auth.uid(); under service_role there is none, so the
  // thread would resolve no viewer and return nothing.
  const authz = read('supabase/migrations/20260712000007_phase2_authz_foundation.sql')
  const fn = authz.slice(authz.indexOf('CREATE OR REPLACE FUNCTION public.portal_profile_id'))
  assert.match(fn.slice(0, 400), /auth\.uid\(\)/)
  assert.match(threadFn, /public\.portal_profile_id\(\)/)
})

test('ACL: the follow-up migration does not REVOKE or re-GRANT the thread RPC', () => {
  // CREATE OR REPLACE preserves the ACL. Any explicit grant statement here would
  // risk narrowing it and breaking the Student Portal.
  assert.doesNotMatch(rpcLive, /REVOKE[^;]*messages_portal_get_thread_v2/)
  assert.doesNotMatch(rpcLive, /GRANT[^;]*messages_portal_get_thread_v2/)
})

test('ACL: VERIFY 4b expects the grant PRESERVED, and says why it is safe', () => {
  const v4b = verifyRpc.slice(
    verifyRpc.indexOf('-- ── VERIFY 4b:'), verifyRpc.indexOf('-- ── VERIFY 4c:'))
  assert.match(v4b, /authenticated EXECUTE IS INTENTIONAL AND LOAD BEARING/)
  assert.match(v4b, /authenticated_can_execute = TRUE/)
  assert.match(v4b, /anon_can_execute = FALSE/)
  assert.match(v4b, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/)
  assert.match(v4b, /STOP if authenticated_can_execute is false/)
  // And it explains why direct authenticated execution cannot leak another thread.
  assert.match(v4b, /my_message_conversation_ids\(\)/)
  assert.match(v4b, /A caller cannot/)
})

test('ACL: the two NEW RPCs correctly DENY authenticated, and the contrast is stated', () => {
  // They take p_actor_profile_id as a parameter and trust it, so they must only be
  // reachable through the service-role client after the API verified the caller.
  const v1 = verifyRpc.slice(verifyRpc.indexOf('-- ── VERIFY 1:'), verifyRpc.indexOf('-- ── VERIFY 1b:'))
  assert.match(v1, /authenticated_can_execute = false/)
  const v4b = verifyRpc.slice(
    verifyRpc.indexOf('-- ── VERIFY 4b:'), verifyRpc.indexOf('-- ── VERIFY 4c:'))
  assert.match(v4b, /Contrast VERIFY 1/)
  assert.match(v4b, /take p_actor_profile_id as a PARAMETER and trust it/)
})
