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

test('the browser never sends a path as authority; cohort id only for post-delete cleanup', () => {
  // Requests never carry an object path as authority.
  assert.doesNotMatch(src, /body: JSON\.stringify\(\{[^}]*\bpath\b/)
  // The signed path returned by the server is used only to upload to it.
  assert.match(src, /const \{ token, path \} = await res\.json\(\)/)
  // A cohort id is sent ONLY by the cleanup helper (uuid-validated server-side),
  // and only to scope delete_student cleanup after the student row is gone. It is
  // a scoping id the Owner/Admin caller already has full access to, not path
  // authority. No other request carries a cohort id.
  const cleanupIdx = src.indexOf('export async function cleanupStudentFiles')
  assert.ok(cleanupIdx > -1, 'cleanupStudentFiles present')
  assert.doesNotMatch(src.slice(0, cleanupIdx), /cohort_id/)
  assert.match(src.slice(cleanupIdx), /cohort_id: cohortId/)
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
  // Cleanup never throws into a delete/upload flow: network/auth failure is
  // caught and a non-ok response returns { ok: false } rather than throwing.
  assert.match(src, /best-effort and must never throw/)
  assert.match(src, /\} catch \{[\s\S]*?return \{ ok: false \}/)
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
