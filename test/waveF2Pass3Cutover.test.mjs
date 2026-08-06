// WAVE F-2 PASS 3: guards for the private-bucket cutover.
//
// The cutover is pure SQL (no live DB here), so this file asserts the
// security-relevant shape of the committed migration and preflight, and re-proves the
// application audit: after privatization the app must still work, which is only true
// because every read is a service-role signed URL, every upload is a server-issued
// signed upload token, and nothing in the browser depends on public bucket access.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const abs  = (p) => join(here, '..', p)

const migration = read('supabase/migrations/20260719000003_wave_f2_pass3_private_bucket_cutover.sql')
const preflight = read('db/audit/wave_f2_pass3_preflight_and_verification.sql')
const access    = read('api/student-file-access.js')
const portal    = read('api/portal/student-file-access.js')
const staffSign = read('api/student-file-sign.js')
const intakeSign = read('api/student-intake-file-sign.js')
const cleanup   = read('api/student-file-cleanup.js')
const client    = read('src/lib/studentFileClient.js')
const cache     = read('src/lib/studentPhotoCache.js')
const auth      = read('src/contexts/AuthContext.jsx')

// The migration's executable body: everything outside the /* ... */ rollback comment.
const migrationLive = migration.replace(/\/\*[\s\S]*?\*\//g, '')

// ── Cutover behavior ─────────────────────────────────────────────────────────
test('cutover makes the bucket private (removes anonymous public read)', () => {
  assert.match(migration, /UPDATE storage\.buckets SET public = false WHERE id = 'student-files';/)
})

test('cutover drops only reviewed student-files policies, never a multi-bucket one', () => {
  assert.match(migration, /FROM pg_policies[\s\S]*?tablename\s*=\s*'objects'[\s\S]*?student-files/)
  assert.match(migration, /DROP POLICY IF EXISTS %I ON storage\.objects/)
  // The drop set excludes any policy that also names another existing bucket.
  assert.match(migration, /FROM storage\.buckets b\s*\n\s*WHERE b\.id <> 'student-files'/)
})

test('cutover creates NO storage policy at all, including no service-role policy', () => {
  // No executed CREATE POLICY statement. The only occurrences of that text are a
  // comment and the quoted format() template that GENERATES rollback SQL.
  assert.doesNotMatch(migrationLive, /^\s*CREATE POLICY/im)
  assert.doesNotMatch(migration, /student-files-service-role-all/)
  // No policy on storage.objects is granted to service_role (it bypasses RLS).
  assert.doesNotMatch(migrationLive, /ON storage\.objects[^;]{0,160}TO service_role/i)
  assert.doesNotMatch(migration, /TO (authenticated|anon|PUBLIC)\b/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO (authenticated|anon|PUBLIC)\b/)
  // The superseded broad-is_staff drafts are not reintroduced.
  assert.doesNotMatch(migration, /USING \([^)]*is_staff/)
  // The reason is stated, so the model stays legible to the next reader.
  assert.match(migration, /service_role bypasses RLS/i)
})

test('server-mediated access stays valid because the server uses the service role', () => {
  assert.match(migration, /createSignedUrls/)
  assert.match(migration, /createSignedUploadUrl/)
  assert.match(migration, /Signed URLs work on a PRIVATE\n--\s+bucket/)
})

test('cutover fails closed on bucket-agnostic or multi-bucket client-access policies', () => {
  assert.match(migration, /FAIL-CLOSED GATE/)
  assert.match(migrationLive, /RAISE EXCEPTION\s*\n?\s*'WAVE F-2 PASS 3 ABORTED/)
  assert.match(migrationLive, /roles && ARRAY\['anon', 'authenticated', 'public'\]::name\[\]/)
  assert.match(migrationLive, /bucket-agnostic/)
  // Such a policy is reported for a separate decision, never dropped automatically.
  assert.match(migration, /NOT dropped automatically/)
})

test('cutover deletes/renames/moves NO storage object and modifies NO student reference', () => {
  assert.doesNotMatch(migration, /DELETE FROM storage\.objects/i)
  assert.doesNotMatch(migration, /UPDATE storage\.objects/i)
  assert.doesNotMatch(migration, /UPDATE public\.students/i)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i)
})

test('cutover preserves every bucket setting except the public flag', () => {
  // Exactly one write to storage.buckets in the live body, and it sets only `public`.
  const bucketWrites = migrationLive.match(/UPDATE storage\.buckets[\s\S]*?;/g) || []
  assert.equal(bucketWrites.length, 1)
  assert.match(bucketWrites[0], /SET public = false WHERE id = 'student-files';/)
  // No MIME or size change is bundled with the privacy cutover, gated or otherwise.
  assert.doesNotMatch(migration, /file_size_limit\s*=/)
  assert.doesNotMatch(migration, /allowed_mime_types\s*=/)
  assert.doesNotMatch(migration, /OPTIONAL, GATED/)
})

test('cutover preserves the Pass 2 rollback backup table', () => {
  assert.doesNotMatch(migration, /wave_f2_pass2_url_backfill_backup[\s\S]{0,40}(DROP|DELETE|TRUNCATE)/i)
  assert.match(migration, /wave_f2_pass2_url_backfill_backup is intact/)
})

test('cutover is transactional and rolls back from exact captured policy definitions', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/)
  assert.match(migration, /── Rollback ─/)
  // The backup artifact is written inside the transaction, before the drop.
  assert.match(migrationLive, /CREATE TABLE IF NOT EXISTS public\.wave_f2_pass3_policy_backup/)
  assert.match(migrationLive, /restore_sql text\s+NOT NULL/)
  assert.ok(
    migrationLive.indexOf('wave_f2_pass3_policy_backup') < migrationLive.indexOf('DROP POLICY IF EXISTS %I'),
    'the policy backup is captured before any policy is dropped',
  )
  // Rollback replays the captured statement verbatim; it never reconstructs a policy.
  assert.match(migration, /EXECUTE b\.restore_sql/)
  assert.match(migration, /UPDATE storage\.buckets SET public = true WHERE id = 'student-files';/)
  assert.match(migration, /never guesses or reconstructs/i)
  // The executable rollback does not touch MIME or size either.
  const rollbackBody = migration.slice(migration.indexOf('── Rollback ─')).match(/\/\*[\s\S]*?\*\//)[0]
  assert.doesNotMatch(rollbackBody, /file_size_limit|allowed_mime_types/)
})

test('the policy backup table is server-mediated only', () => {
  assert.match(migrationLive, /ALTER TABLE public\.wave_f2_pass3_policy_backup ENABLE ROW LEVEL SECURITY/)
  assert.match(migrationLive, /REVOKE ALL ON public\.wave_f2_pass3_policy_backup FROM PUBLIC, anon, authenticated/)
  assert.match(migrationLive, /GRANT SELECT, INSERT ON public\.wave_f2_pass3_policy_backup TO service_role/)
})

test('the superseded cutover drafts are removed and named as superseded', () => {
  assert.equal(existsSync(abs('supabase/migrations/20260718000001_DRAFT_DO_NOT_APPLY_wave_f2_pass3_private_cutover.sql')), false)
  assert.match(migration, /20260712000014_phase0b_wave_f2_student_files_private\.sql/)
  assert.match(migration, /Supersedes/i)
})

// ── Preflight ────────────────────────────────────────────────────────────────
test('preflight is read-only and covers every required check', () => {
  // No statement in this file starts with a DDL/DML keyword (the only occurrence of
  // CREATE POLICY is inside a quoted format() template that GENERATES restore SQL).
  assert.doesNotMatch(preflight, /^\s*(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.match(preflight, /PREFLIGHT 1: bucket privacy and configuration/)
  assert.match(preflight, /PREFLIGHT 2: every policy on storage\.objects, with an explicit assessment/)
  assert.match(preflight, /PREFLIGHT 2b: exact restore SQL/)
  assert.match(preflight, /PREFLIGHT 3: grants on storage\.objects and storage\.buckets/)
  assert.match(preflight, /PREFLIGHT 4: MIME types and file sizes/)
  assert.match(preflight, /PREFLIGHT 5: object paths OUTSIDE the canonical pattern/)
  assert.match(preflight, /PREFLIGHT 6: orphaned objects/)
  assert.match(preflight, /PREFLIGHT 7: student references whose object is MISSING/)
  assert.match(preflight, /PREFLIGHT 8: duplicate or conflicting object keys/)
  assert.match(preflight, /PREFLIGHT 9: public accessibility state BEFORE the cutover/)
  assert.match(preflight, /STOP CONDITIONS/)
})

test('preflight 2 reports every attribute needed to judge a policy', () => {
  for (const column of [
    'policyname', 'cmd', 'permissive', 'p.roles',
    'using_expression', 'with_check_expression',
    'names_student_files', 'bucket_agnostic', 'grants_client_roles',
    'other_buckets_named', 'assessment',
  ]) assert.ok(preflight.includes(column), `preflight 2 reports ${column}`)
  assert.match(preflight, /'STOP: bucket-agnostic client access'/)
  assert.match(preflight, /'STOP: multi-bucket client access'/)
  assert.match(preflight, /zero rows whose assessment starts with 'STOP'/)
})

test('verification proves private, no client policy, unchanged objects/references/settings', () => {
  assert.match(preflight, /VERIFY 1: the bucket is private/)
  assert.match(preflight, /VERIFY 2: no policy grants direct client access to student-files/)
  assert.match(preflight, /VERIFY 2b: no unresolved bucket-agnostic client-access policy remains/)
  assert.match(preflight, /VERIFY 3: no storage object was deleted, renamed, or moved/)
  assert.match(preflight, /VERIFY 4: no student file reference was modified/)
  assert.match(preflight, /VERIFY 5: the Pass 2 rollback backup is still intact/)
  assert.match(preflight, /VERIFY 6: no bucket MIME or size setting changed/)
  assert.match(preflight, /VERIFY 7: the policy backup artifact captured the dropped policies/)
  // Expected values are stated, not left to interpretation.
  assert.match(preflight, /canonical_paths = 57/)
  assert.match(preflight, /remaining_http_values = 0/)
  assert.match(preflight, /missing_objects = 0/)
  assert.match(preflight, /headshot_url = 29 and resume_url = 27/)
  assert.match(preflight, /deliberately no service_role policy/)
  assert.match(preflight, /uses_is_staff/)
})

// ── Application audit: nothing depends on public bucket access ───────────────
test('every read is a service-role signed URL behind authorization', () => {
  // ROLE MATRIX UPDATED 2026-08-05 (approved): a Co-Lead is near-Owner for
  // student ACCESS and reads student files across ALL cohorts, so the
  // unrestricted branch is now owner|admin|co-lead (`isUnrestricted`, was
  // `isOwnerAdmin`). Interviewer stays entitlement-gated, Viewer stays
  // headshot-only, and upload/replace/delete stay Owner/Admin elsewhere.
  assert.match(access, /createSignedUrls\(/)
  assert.match(portal, /createSignedUrl\(/)
  // Role scopes unchanged by Pass 3.
  assert.match(access, /const isUnrestricted = role === 'owner' \|\| role === 'admin' \|\| role === 'co-lead'/)
  assert.match(access, /const isViewer = role === 'viewer'/)
  assert.match(access, /const isInterviewer = role === 'interviewer'/)
  assert.match(access, /activeEntitledCohortIds\(/)
  // No endpoint mints a public URL.
  for (const [name, src] of Object.entries({ access, portal, staffSign, intakeSign, cleanup })) {
    assert.doesNotMatch(src, /getPublicUrl/, `${name} must not mint public URLs`)
  }
})

test('every upload uses a server-issued signed upload token (works on a private bucket)', () => {
  assert.match(staffSign, /createSignedUploadUrl\(/)
  assert.match(intakeSign, /createSignedUploadUrl\(/)
  // The browser's ONLY storage call is uploadToSignedUrl, and it never posts a path.
  assert.match(client, /\.uploadToSignedUrl\(path, token, file/)
  assert.doesNotMatch(client, /\.getPublicUrl\(/)
  assert.doesNotMatch(client, /body: JSON\.stringify\(\{[^}]*\bpath\b/)
})

test('the photo cache holds signed URLs in memory only and clears on sign-out/role change', () => {
  assert.doesNotMatch(cache, /localStorage\.|sessionStorage\.|indexedDB\.|\.setItem\(/i)
  assert.match(cache, /export function setStudentPhotoCacheScope/)
  assert.match(cache, /export function clearStudentPhotoCache/)
  assert.match(auth, /setStudentPhotoCacheScope\(authScope\)/)
  assert.match(auth, /clearStudentPhotoCache\(\)/)
})

test('no em dash in the Pass 3 SQL files', () => {
  assert.doesNotMatch(migration, /—/)
  assert.doesNotMatch(preflight, /—/)
})
