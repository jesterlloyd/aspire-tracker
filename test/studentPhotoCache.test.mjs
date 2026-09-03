// WAVE F-2 (photo performance): the shared signed-photo cache + in-flight dedup.
// The cache module is self-contained (no React, no network), so it is unit-tested
// directly. Static-source guards confirm the hooks use it and that nothing weakens
// the private-file design (memory only, no public URL, no persisted signed URL).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  setStudentPhotoCacheScope, clearStudentPhotoCache,
  peekStudentPhotoUrl, resolveStudentPhotoUrl, studentPhotoCacheSize,
} from '../src/lib/studentPhotoCache.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const reset = () => { setStudentPhotoCacheScope('test-scope'); clearStudentPhotoCache() }

test('repeated requests for the same path share ONE signing request (dedup)', async () => {
  reset()
  let calls = 0
  const fetcher = () => { calls++; return new Promise((r) => setTimeout(() => r('SIGNED_A'), 5)) }
  const [a, b, c] = await Promise.all([
    resolveStudentPhotoUrl('s1:headshot:p1', fetcher),
    resolveStudentPhotoUrl('s1:headshot:p1', fetcher),
    resolveStudentPhotoUrl('s1:headshot:p1', fetcher),
  ])
  assert.equal(calls, 1, 'only one signing request for concurrent callers')
  assert.equal(a, 'SIGNED_A'); assert.equal(b, 'SIGNED_A'); assert.equal(c, 'SIGNED_A')
})

test('a warm entry is reused (list<->grid, At a Glance<->Profiles, On Campus Now)', async () => {
  reset()
  let calls = 0
  const fetcher = () => { calls++; return Promise.resolve('SIGNED_B') }
  await resolveStudentPhotoUrl('s2:headshot:p2', fetcher)   // cold
  assert.equal(peekStudentPhotoUrl('s2:headshot:p2'), 'SIGNED_B') // warm read, no request
  const again = await resolveStudentPhotoUrl('s2:headshot:p2', fetcher) // remount / other view
  assert.equal(again, 'SIGNED_B')
  assert.equal(calls, 1, 'reuse resolves with zero new signing requests')
})

test('different canonical paths remain isolated', async () => {
  reset()
  await resolveStudentPhotoUrl('s3:headshot:pA', () => Promise.resolve('URL_A'))
  await resolveStudentPhotoUrl('s4:headshot:pB', () => Promise.resolve('URL_B'))
  assert.equal(peekStudentPhotoUrl('s3:headshot:pA'), 'URL_A')
  assert.equal(peekStudentPhotoUrl('s4:headshot:pB'), 'URL_B')
  // A replacement (changed stored ref) is a different key -> re-signs, not a stale hit.
  assert.equal(peekStudentPhotoUrl('s3:headshot:pA_v2'), null)
})

test('cache clears on active-role change and on sign-out', async () => {
  setStudentPhotoCacheScope('user1:prof1:owner:active'); clearStudentPhotoCache()
  await resolveStudentPhotoUrl('s5:headshot:p5', () => Promise.resolve('URL5'))
  assert.equal(studentPhotoCacheSize(), 1)
  setStudentPhotoCacheScope('user1:prof1:viewer:active') // role change
  assert.equal(studentPhotoCacheSize(), 0, 'role change clears the cache')
  await resolveStudentPhotoUrl('s5:headshot:p5', () => Promise.resolve('URL5'))
  setStudentPhotoCacheScope(null) // sign-out (user -> null)
  assert.equal(studentPhotoCacheSize(), 0, 'sign-out clears the cache')
})

test('401 and 403 are not cached, and an auth error clears the cache', async () => {
  reset()
  await resolveStudentPhotoUrl('s6:headshot:p6', () => Promise.resolve('URL6'))
  assert.equal(studentPhotoCacheSize(), 1)
  const err = Object.assign(new Error('forbidden'), { status: 403 })
  await assert.rejects(() => resolveStudentPhotoUrl('s7:headshot:p7', () => Promise.reject(err)))
  assert.equal(studentPhotoCacheSize(), 0, '403 is not cached and clears the scope')
  assert.equal(peekStudentPhotoUrl('s7:headshot:p7'), null)
})

test('a null (denied) result is not cached', async () => {
  reset()
  await resolveStudentPhotoUrl('s8:headshot:p8', () => Promise.resolve(null))
  assert.equal(peekStudentPhotoUrl('s8:headshot:p8'), null)
  assert.equal(studentPhotoCacheSize(), 0)
})

test('cache entries expire BEFORE the server signed-URL TTL', () => {
  // STUDENT-PHOTO-PERF-1: only headshots enter this cache, so the cache TTL is
  // bounded by the shared HEADSHOT lifetime, one source of truth on the server.
  const cacheSrc = read('src/lib/studentPhotoCache.js')
  assert.match(cacheSrc, /const TTL_MS = 3300 \* 1000/)
  const kinds = read('lib/server/studentFiles.js')
  assert.match(kinds, /SIGNED_URL_TTL_BY_KIND = \{ headshot: 3600, resume: 300 \}/)
  assert.ok(3300 < 3600, 'cache TTL is strictly less than the headshot signed-URL TTL')
})

test('cache is memory-only (no persistent browser storage) and holds no service-role secret', () => {
  const cacheSrc = read('src/lib/studentPhotoCache.js')
  // No persistent-storage API is used (comments may explain the rule).
  // UI-CONSISTENCY-1 (Owner decision, 2026-09-03): the cache now mirrors to
  // sessionStorage so a fresh page load renders every headshot instantly. The
  // posture this test guards is therefore no longer "no browser storage"; it is
  // the BOUNDED form of it, and each bound below is a line of code, not a promise:
  //   - sessionStorage only. localStorage and IndexedDB stay forbidden: they outlive the tab.
  //   - every read checks the entry's authorization scope and drops the whole snapshot
  //     on a mismatch, so one user's signed URLs never warm another's roster.
  //   - every read checks expiry, so a URL is never served past its signed lifetime.
  //   - storage is optional: absent, full or blocked, the module stays memory-only.
  assert.doesNotMatch(cacheSrc, /localStorage\.|indexedDB\./i, 'never a store that outlives the tab')
  assert.match(cacheSrc, /snap\.scope !== scope[^\n]*removeItem\(STORE_KEY\)/, 'a foreign scope is discarded, not ignored')
  assert.match(cacheSrc, /e\.expiresAt > now\) cache\.set\(key, e\)/, 'only unexpired entries rehydrate')
  assert.match(cacheSrc, /typeof sessionStorage !== 'undefined' \? sessionStorage : null/, 'storage is optional')
  assert.match(cacheSrc, /rehydrate\(\)\n\s+persist\(\)/, 'the scope change is the only moment storage is read')
  assert.doesNotMatch(cacheSrc, /SERVICE_ROLE_KEY\s*=|['"]service_role['"]/)
})

test('the read hooks resolve through the shared cache and warm-render from it', () => {
  const hook = read('src/lib/useStudentFile.js')
  // STUDENT-PHOTO-PERF-1: mount-time staff fetches go through the coalescer.
  assert.match(hook, /resolveStudentPhotoUrl\(key, \(\) => queueStudentFileUrl\(\{ studentId, kind \}\)\)/)
  assert.match(hook, /resolveStudentPhotoUrl\(key, \(\) => fetchPortalHeadshotUrl\(\)\)/)
  assert.match(hook, /peekStudentPhotoUrl\(key\)/)               // instant warm render
  // key includes the stored ref so a replacement re-signs, and the same student reuses.
  assert.match(hook, /`\$\{studentId\}:\$\{kind\}:\$\{refreshKey \?\? ''\}`/)
  // No public URL is reintroduced in the read path.
  assert.doesNotMatch(hook, /getPublicUrl|publicUrlForPath/)
})

test('AuthContext scopes the cache to the auth context and clears on sign-out', () => {
  const auth = read('src/contexts/AuthContext.jsx')
  assert.match(auth, /setStudentPhotoCacheScope\(authScope\)/)
  assert.match(auth, /user\.id\}:\$\{userProfile\?\.id[\s\S]*?userProfile\?\.role[\s\S]*?active/)
  assert.match(auth, /clearStudentPhotoCache\(\); \/\/ drop every signed photo URL immediately on sign-out/)
})
