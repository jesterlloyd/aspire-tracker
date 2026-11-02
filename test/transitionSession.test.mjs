// TRANSITION-SESSION-1 (2026-11-02): Jorge Velasco's two-hour form session expired while he was
// still writing, and his repeated code requests then hit the limiter ("Too many requests").
// Every verified request now hands back a fresh session, and the limiter says what to do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { issueSession, checkSession, SESSION_MINUTES } from '../lib/server/ngrpTransitionCode.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const KEY = 'test-key'

test('a renewed session outlives the one it replaces', () => {
  const t0 = Date.parse('2026-11-02T17:00:00Z')
  const first = issueSession('a1', 'h1', t0, KEY)
  const later = t0 + (SESSION_MINUTES - 5) * 60_000
  const renewed = issueSession('a1', 'h1', later, KEY)
  const past = t0 + (SESSION_MINUTES + 30) * 60_000
  assert.equal(checkSession(first, 'a1', 'h1', past, KEY), false)
  assert.equal(checkSession(renewed, 'a1', 'h1', past, KEY), true)
})

test('the endpoint renews only after the session check, and the page keeps the newest', () => {
  const api = read('api/ngrp-transition.js')
  assert.ok(api.indexOf('const renewed = issueSession') > api.indexOf("if (action !== 'load') return res.status(401)"), 'never renewed for an unverified caller')
  assert.match(api, /res\.statusCode < 400/)
  assert.match(api, /Wait 10 minutes, then send one code/)
  const page = read('src/pages/NgrpTransitionFormPage.jsx')
  assert.match(page, /action !== 'verify_code' && typeof body\?\.session === 'string'/)
})
