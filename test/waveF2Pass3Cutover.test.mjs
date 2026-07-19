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

// ── Cutover behavior ─────────────────────────────────────────────────────────
test('cutover makes the bucket private (removes anonymous public read)', () => {
  assert.match(migration, /UPDATE storage\.buckets SET public = false WHERE id = 'student-files';/)
})

test('cutover drops every student-files policy (anon read/upload/update, broad authenticated)', () => {
  // Deterministic drop by name for policies whose definition names the bucket.
  assert.match(migration, /FROM pg_policies[\s\S]*?tablename\s*=\s*'objects'[\s\S]*?student-files/)
  assert.match(migration, /DROP POLICY IF EXISTS %I ON storage\.objects/)
  // Bucket-agnostic policies are deliberately NOT dropped (they affect other buckets).
  assert.match(migration, /bucket-agnostic/i)
})

test('cutover leaves ONLY service_role access; no anon/authenticated/PUBLIC grant', () => {
  assert.match(migration, /CREATE POLICY "student-files-service-role-all"[\s\S]*?TO service_role/)
  assert.doesNotMatch(migration, /TO (authenticated|anon|PUBLIC)\b/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO (authenticated|anon|PUBLIC)/)
  // The superseded broad-is_staff drafts are not reintroduced.
  assert.doesNotMatch(migration, /USING \([^)]*is_staff/)
})

test('cutover deletes/renames/moves NO storage object and modifies NO student reference', () => {
  assert.doesNotMatch(migration, /DELETE FROM storage\.objects/i)
  assert.doesNotMatch(migration, /UPDATE storage\.objects/i)
  assert.doesNotMatch(migration, /UPDATE public\.students/i)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i)
})

test('cutover is transactional and has a reviewed rollback', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/)
  assert.match(migration, /── Rollback ─/)
  assert.match(migration, /UPDATE storage\.buckets\s*\n\s*SET public = true/)
  assert.match(migration, /DROP POLICY IF EXISTS "student-files-service-role-all"/)
})

test('MIME/size limits are optional, gated on preflight, and match the app allow-list', () => {
  assert.match(migration, /OPTIONAL, GATED/)
  assert.match(migration, /file_size_limit\s*=\s*10485760/)
  for (const m of [
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png',
  ]) assert.ok(migration.includes(m), `allow-list includes ${m}`)
})

test('the superseded cutover drafts are removed and named as superseded', () => {
  assert.equal(existsSync(abs('supabase/migrations/20260718000001_DRAFT_DO_NOT_APPLY_wave_f2_pass3_private_cutover.sql')), false)
  assert.match(migration, /20260712000014_phase0b_wave_f2_student_files_private\.sql/)
  assert.match(migration, /Supersedes/i)
})

// ── Preflight ────────────────────────────────────────────────────────────────
test('preflight is read-only and covers all nine required checks', () => {
  assert.doesNotMatch(preflight, /\b(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/)
  assert.match(preflight, /PREFLIGHT 1: bucket privacy and configuration/)
  assert.match(preflight, /PREFLIGHT 2: every policy on storage\.objects/)
  assert.match(preflight, /PREFLIGHT 3: grants on storage\.objects and storage\.buckets/)
  assert.match(preflight, /PREFLIGHT 4: MIME types and file sizes/)
  assert.match(preflight, /PREFLIGHT 5: object paths OUTSIDE the canonical pattern/)
  assert.match(preflight, /PREFLIGHT 6: orphaned objects/)
  assert.match(preflight, /PREFLIGHT 7: student references whose object is MISSING/)
  assert.match(preflight, /PREFLIGHT 8: duplicate or conflicting object keys/)
  assert.match(preflight, /PREFLIGHT 9: public accessibility state BEFORE the cutover/)
  assert.match(preflight, /STOP CONDITIONS/)
})

test('verification proves private, service-role-only, objects intact, references intact', () => {
  assert.match(preflight, /VERIFY 1: the bucket is private/)
  assert.match(preflight, /VERIFY 2: only the service_role policy remains/)
  assert.match(preflight, /VERIFY 3: no storage object was deleted, renamed, or moved/)
  assert.match(preflight, /VERIFY 4: no student file reference was modified/)
  assert.match(preflight, /VERIFY 5: the Pass 2 rollback backup is still intact/)
})

// ── Application audit: nothing depends on public bucket access ───────────────
test('every read is a service-role signed URL behind authorization', () => {
  assert.match(access, /createSignedUrls\(/)
  assert.match(portal, /createSignedUrl\(/)
  // Role scopes unchanged by Pass 3.
  assert.match(access, /const isOwnerAdmin = role === 'owner' \|\| role === 'admin'/)
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
