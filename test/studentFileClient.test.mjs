// WAVE F-2 (Pass 1): guards for the browser student-file client. Static-source,
// because the module imports the Supabase client (like messagesApiClient); the
// classifier logic itself is the client mirror of the server parseStoredFileRef,
// which is behaviorally tested in studentFilesCore.test.mjs.
//
// Run: node --test test/studentFileClient.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../src/lib/studentFileClient.js'), 'utf8')

test('reads are server-mediated through the access endpoints', () => {
  assert.match(src, /fetch\('\/api\/student-file-access'/)
  assert.match(src, /fetch\('\/api\/portal\/student-file-access'/)
  // Batch and single read helpers exist for lists and single cards.
  assert.match(src, /export async function fetchStudentFileUrls\(/)
  assert.match(src, /export async function fetchStudentFileUrl\(/)
  assert.match(src, /export async function fetchPortalHeadshotUrl\(/)
})

test('uploads use server-issued signed tokens, never a direct storage upload', () => {
  assert.match(src, /fetch\('\/api\/student-intake-file-sign'/)
  assert.match(src, /fetch\('\/api\/student-file-sign'/)
  assert.match(src, /\.uploadToSignedUrl\(path, token, file, \{ upsert: true, contentType: file\.type \}\)/)
  // No direct .upload( to student-files remains in the client helper.
  assert.doesNotMatch(src, /\.from\('student-files'\)\.upload\(/)
})

test('the browser never sends a path or cohort id as authority', () => {
  // Requests carry school_email or student_id + kind + declared file metadata only.
  assert.doesNotMatch(src, /body: JSON\.stringify\(\{[^}]*\bpath\b/)
  assert.doesNotMatch(src, /cohort_id/)
  // The signed path returned by the server is used only to upload to it.
  assert.match(src, /const \{ token, path \} = await res\.json\(\)/)
})

test('auth: staff/portal reads and staff uploads carry the bearer JWT; intake does not', () => {
  assert.match(src, /async function authHeader\(\)/)
  assert.match(src, /supabase\.auth\.getSession\(\)/)
  // Intake sign is anonymous (no Authorization header).
  const intake = src.slice(src.indexOf('signAndUploadIntakeFile'), src.indexOf('signAndUploadStaffFile'))
  assert.doesNotMatch(intake, /Authorization/)
  // Staff sign carries it.
  const staff = src.slice(src.indexOf('signAndUploadStaffFile'), src.indexOf('cleanupStudentFiles'))
  assert.match(staff, /Authorization: await authHeader\(\)/)
})

test('error and cleanup behavior', () => {
  // Safe, user-facing error copy; nothing internal leaked.
  assert.match(src, /export function mapStudentFileError\(status\)/)
  for (const code of ['401', '403', '404', '413', '422', '429']) {
    assert.ok(src.includes(`case ${code}:`), `missing error mapping for ${code}`)
  }
  // Cleanup never throws into a delete/upload flow.
  assert.match(src, /\/\/ Cleanup is best-effort; never throw/)
  assert.match(src, /if \(!res\.ok\) return \{ ok: false \}/)
})

test('classifier mirrors the server semantics', () => {
  assert.match(src, /export function classifyStoredFileRef\(value\)/)
  assert.match(src, /\/object\/public\/\$\{BUCKET\}\//)
  assert.match(src, /\(clean\.match\(\/\\\/\/g\) \|\| \[\]\)\.length !== 2/)
})

test('privacy and hygiene', () => {
  assert.doesNotMatch(src, /console\.(log|info|debug)/)
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/)
  assert.doesNotMatch(src, /—/)
  assert.doesNotMatch(src, /ASPIRE Program/)
})
