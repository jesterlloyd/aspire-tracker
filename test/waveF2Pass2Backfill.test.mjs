// WAVE F-2 PASS 2: guards for the public-URL -> canonical-path backfill.
//
// The migration is pure SQL (no live DB here), so this file (a) runs a JavaScript
// MIRROR of the SQL recognition + extraction against every required edge case, and
// (b) asserts the security-relevant shape of the committed migration and preflight
// files. It also confirms, via the real resolver, that both stored forms resolve to
// the same object path (the compatibility resolver stays intact in Pass 2).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseStoredFileRef } from '../lib/server/studentFiles.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const migration = read('supabase/migrations/20260719000002_wave_f2_pass2_url_to_path_backfill.sql')
const preflight = read('db/audit/wave_f2_pass2_preflight_and_verification.sql')

// ── JS mirror of the SQL transform (kept in sync with the migration) ─────────
// SQL: regexp_replace(col, '^.*/storage/v1/object/public/student-files/', '') is
// greedy, so it strips up to and including the LAST marker; then '?'/'#' are dropped;
// then the strict <uuid>/<uuid>/<kind>.<ext> gate decides conversion.
const MARKER = '/storage/v1/object/public/student-files/'
const canon = (kind) => new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/${kind}\\.[a-z0-9]+$`,
  'i',
)
function pass2Convert(value, kind) {
  if (value == null || value === '') return value
  const at = value.lastIndexOf(MARKER)
  if (at === -1) return value
  const extracted = value.slice(at + MARKER.length).split('?')[0].split('#')[0]
  return canon(kind).test(extracted) ? extracted : value
}

const HOST = 'https://proj.supabase.co'
const C = '11111111-1111-4111-8111-111111111111'
const S = '22222222-2222-4222-8222-222222222222'
const publicUrl = (name) => `${HOST}/storage/v1/object/public/student-files/${C}/${S}/${name}`

test('recognized public URL -> canonical path (both kinds, cache-buster stripped)', () => {
  assert.equal(pass2Convert(publicUrl('resume.pdf'), 'resume'), `${C}/${S}/resume.pdf`)
  assert.equal(pass2Convert(publicUrl('headshot.jpg'), 'headshot'), `${C}/${S}/headshot.jpg`)
  assert.equal(pass2Convert(publicUrl('resume.docx') + '?t=1721400000', 'resume'), `${C}/${S}/resume.docx`)
})

test('already-canonical path is unchanged (idempotent)', () => {
  const path = `${C}/${S}/resume.pdf`
  assert.equal(pass2Convert(path, 'resume'), path)
  // Converting the result again is a no-op.
  assert.equal(pass2Convert(pass2Convert(publicUrl('resume.pdf'), 'resume'), 'resume'), `${C}/${S}/resume.pdf`)
})

test('other bucket, signed URL, external, and malformed are left unchanged', () => {
  const otherBucket = `${HOST}/storage/v1/object/public/avatars/${C}/${S}/resume.pdf`
  const signed = `${HOST}/storage/v1/object/sign/student-files/${C}/${S}/resume.pdf?token=abc.def.ghi`
  const external = 'https://example.com/whatever/resume.pdf'
  const malformed = 'not a url at all'
  for (const v of [otherBucket, signed, external, malformed]) {
    assert.equal(pass2Convert(v, 'resume'), v, `left unchanged: ${v}`)
  }
})

test('URL-encoded or non-canonical object name is left unchanged (resolver decodes at read time)', () => {
  const encoded = publicUrl('resume%20final.pdf')     // space -> not the canonical resume.<ext> name
  const weird   = publicUrl('resume.pdf.bak')          // extra segment
  assert.equal(pass2Convert(encoded, 'resume'), encoded)
  assert.equal(pass2Convert(weird, 'resume'), weird)
})

test('null and empty are unchanged', () => {
  assert.equal(pass2Convert(null, 'resume'), null)
  assert.equal(pass2Convert('', 'headshot'), '')
})

test('the compatibility resolver resolves BOTH forms to the same object path', () => {
  const url = publicUrl('resume.pdf')
  const path = pass2Convert(url, 'resume')
  const fromUrl = parseStoredFileRef(url)
  const fromPath = parseStoredFileRef(path)
  assert.equal(fromUrl.kind, 'legacyPublicUrl')
  assert.equal(fromPath.kind, 'path')
  assert.equal(fromUrl.path, fromPath.path) // identical object path -> identical access
})

// ── Migration + preflight static-source guards ───────────────────────────────
test('migration converts ONLY the two confirmed columns, recognized values only', () => {
  assert.match(migration, /UPDATE public\.students s\s*\n\s*SET resume_url =/)
  assert.match(migration, /UPDATE public\.students s\s*\n\s*SET headshot_url =/)
  // Recognition marker (public URL for student-files) and strict canonical gate.
  assert.match(migration, /\/storage\/v1\/object\/public\/student-files\//)
  assert.match(migration, /\/resume\\\.\[a-z0-9\]\+\$/)
  assert.match(migration, /\/headshot\\\.\[a-z0-9\]\+\$/)
  // No other table is written.
  assert.doesNotMatch(migration, /UPDATE public\.(?!students\b|wave_f2_pass2)/)
})

test('migration is transactional, idempotent, backed up, and reversible', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/)
  // Backup table preserves rollback information (additive, service-role only).
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.wave_f2_pass2_url_backfill_backup/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.wave_f2_pass2_url_backfill_backup FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT ON public\.wave_f2_pass2_url_backfill_backup TO service_role/)
  // Rollback restores only rows the migration changed.
  assert.match(migration, /SET resume_url = b\.old_value[\s\S]*s\.resume_url = b\.new_value/)
  // Idempotent: re-running finds no marker (converted values are bare paths).
  assert.match(migration, /~ '\/storage\/v1\/object\/public\/student-files\/'/)
})

test('migration touches NO storage object, bucket, or policy', () => {
  assert.doesNotMatch(migration, /storage\.objects|storage\.buckets|\.remove\(|DROP POLICY|CREATE POLICY|updateBucket|public\s*=\s*false/i)
  // No DELETE of student data either (it only UPDATEs the two url columns + inserts backup).
  assert.doesNotMatch(migration, /DELETE FROM public\.students/i)
})

test('preflight is read-only and covers the required distributions', () => {
  assert.doesNotMatch(preflight, /\b(UPDATE|INSERT|DELETE|ALTER|DROP|CREATE)\b/)
  assert.match(preflight, /nulls[\s\S]*empties[\s\S]*canonical_paths[\s\S]*recognized_public_urls[\s\S]*unrecognized/)
  assert.match(preflight, /would_remain_unchanged/)
  assert.match(preflight, /referencing_rows/)             // duplicate canonical paths
  assert.match(preflight, /distinct hosts/i)              // foreign-host check
})

test('no em dash in the Pass 2 SQL files', () => {
  assert.doesNotMatch(migration, /—/)
  assert.doesNotMatch(preflight, /—/)
})
