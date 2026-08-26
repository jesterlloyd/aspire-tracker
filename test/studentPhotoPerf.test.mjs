// test/studentPhotoPerf.test.mjs
//
// STUDENT-PHOTO-PERF-1 guards:
//   1. The request coalescer collapses same-window photo fetches into one batch
//      call, dedupes identical items, chunks at the endpoint ceiling, and fails
//      every waiter on a batch error (behavioral, against the pure core).
//   2. useStudentFileUrl resolves mount-time photos through the coalescer, while
//      imperative open/download keep minting fresh single URLs per click.
//   3. Signed-URL lifetimes are per kind from ONE shared table: headshots sign
//      long (cacheable), resumes short, on every endpoint that signs them.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStudentFileBatcher } from '../src/lib/studentFileBatchCore.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Strip comments so prose never satisfies (or trips) a source assertion.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── 1. The coalescer core ───────────────────────────────────────────────────

const key = (i) => `${i.studentId}:${i.kind}`

test('all fetches queued within one window collapse into ONE batch call', async () => {
  const calls = []
  const batcher = createStudentFileBatcher({
    windowMs: 5,
    fetchBatch: async (items) => {
      calls.push(items)
      return new Map(items.map((i) => [key(i), `signed:${key(i)}`]))
    },
  })
  const urls = await Promise.all([
    batcher.queue({ studentId: 's1', kind: 'headshot' }),
    batcher.queue({ studentId: 's2', kind: 'headshot' }),
    batcher.queue({ studentId: 's3', kind: 'headshot' }),
  ])
  assert.equal(calls.length, 1, 'exactly one batch request')
  assert.equal(calls[0].length, 3)
  assert.deepEqual(urls, ['signed:s1:headshot', 'signed:s2:headshot', 'signed:s3:headshot'])
})

test('concurrent requests for the SAME item share one queue entry and one result', async () => {
  const calls = []
  const batcher = createStudentFileBatcher({
    windowMs: 5,
    fetchBatch: async (items) => {
      calls.push(items)
      return new Map(items.map((i) => [key(i), 'signed:same']))
    },
  })
  const p1 = batcher.queue({ studentId: 's1', kind: 'headshot' })
  const p2 = batcher.queue({ studentId: 's1', kind: 'headshot' })
  assert.equal(batcher.pending(), 1, 'identical items dedupe in the window')
  assert.deepEqual(await Promise.all([p1, p2]), ['signed:same', 'signed:same'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 1)
})

test('a missing/denied item resolves null, exactly like the single mode', async () => {
  const batcher = createStudentFileBatcher({
    windowMs: 5,
    fetchBatch: async () => new Map(), // endpoint returned no url for the item
  })
  assert.equal(await batcher.queue({ studentId: 'sX', kind: 'headshot' }), null)
})

test('oversized windows chunk at the endpoint batch ceiling', async () => {
  const calls = []
  const batcher = createStudentFileBatcher({
    windowMs: 5,
    maxBatch: 100,
    fetchBatch: async (items) => {
      calls.push(items.length)
      return new Map(items.map((i) => [key(i), 'u']))
    },
  })
  const pending = []
  for (let i = 0; i < 130; i++) pending.push(batcher.queue({ studentId: `s${i}`, kind: 'headshot' }))
  await Promise.all(pending)
  assert.deepEqual(calls, [100, 30], 'two chunks, both under the ceiling')
})

test('a batch failure rejects every waiter with the same error', async () => {
  const boom = Object.assign(new Error('unauthorized'), { status: 401 })
  const batcher = createStudentFileBatcher({
    windowMs: 5,
    fetchBatch: async () => { throw boom },
  })
  const results = await Promise.allSettled([
    batcher.queue({ studentId: 's1', kind: 'headshot' }),
    batcher.queue({ studentId: 's2', kind: 'headshot' }),
  ])
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected'])
  assert.equal(results[0].reason, boom)
  assert.equal(results[1].reason, boom)
})

test('requests queued AFTER a flush start a new window (no stale queue reuse)', async () => {
  const calls = []
  const batcher = createStudentFileBatcher({
    windowMs: 5,
    fetchBatch: async (items) => {
      calls.push(items.map(key))
      return new Map(items.map((i) => [key(i), `u:${key(i)}`]))
    },
  })
  assert.equal(await batcher.queue({ studentId: 'a', kind: 'headshot' }), 'u:a:headshot')
  assert.equal(await batcher.queue({ studentId: 'b', kind: 'headshot' }), 'u:b:headshot')
  assert.deepEqual(calls, [['a:headshot'], ['b:headshot']])
})

// ── 2. The wiring ───────────────────────────────────────────────────────────

test('useStudentFileUrl resolves through the coalescer; click paths stay single-shot', () => {
  const hook = stripComments(read('src/lib/useStudentFile.js'))
  assert.match(hook, /resolveStudentPhotoUrl\(key, \(\) => queueStudentFileUrl\(\{ studentId, kind \}\)\)/)
  // Imperative open/download mint a FRESH single URL per click (never cached,
  // never batched, so short resume lifetimes are never a problem).
  assert.match(hook, /openStudentFile[\s\S]*?fetchStudentFileUrl\(\{ studentId, kind \}\)/)
  assert.match(hook, /downloadStudentFile[\s\S]*?fetchStudentFileUrl\(\{ studentId, kind \}\)/)
})

test('the batcher binds the pure core to the real batch client', () => {
  const wiring = stripComments(read('src/lib/studentPhotoBatch.js'))
  assert.match(wiring, /createStudentFileBatcher\(\{ fetchBatch: fetchStudentFileUrls \}\)/)
  const core = stripComments(read('src/lib/studentFileBatchCore.js'))
  // The pure core must stay node-loadable: no supabase, no browser client import.
  assert.doesNotMatch(core, /supabase|studentFileClient/)
})

// ── 3. Per-kind signed-URL lifetimes ────────────────────────────────────────

test('one shared lifetime table: headshots 3600s, resumes 300s, unknown fails short', async () => {
  const { SIGNED_URL_TTL_BY_KIND, signedUrlTtlSeconds } = await import('../lib/server/studentFiles.js')
  assert.deepEqual(SIGNED_URL_TTL_BY_KIND, { headshot: 3600, resume: 300 })
  assert.equal(signedUrlTtlSeconds('headshot'), 3600)
  assert.equal(signedUrlTtlSeconds('resume'), 300)
  assert.equal(signedUrlTtlSeconds('certificate'), 300, 'unknown kind gets the short lifetime')
  assert.equal(signedUrlTtlSeconds(undefined), 300)
})

test('every signing endpoint takes its lifetime from the shared table', () => {
  // Staff: signs per-kind groups.
  const staff = stripComments(read('api/student-file-access.js'))
  assert.match(staff, /signedUrlTtlSeconds\(kind\)/)
  assert.doesNotMatch(staff, /SIGNED_URL_TTL_SECONDS\s*=\s*\d/)
  // Unit Leader: signs per item with the item's kind.
  const ul = stripComments(read('api/portal/unit-student-file-access.js'))
  assert.match(ul, /createSignedUrl\(ref\.path, signedUrlTtlSeconds\(kind\)\)/)
  // Academic Partner and Student Portal self: headshot-only endpoints.
  const ap = stripComments(read('api/portal/school-student-file-access.js'))
  assert.match(ap, /signedUrlTtlSeconds\('headshot'\)/)
  const self = stripComments(read('api/portal/student-file-access.js'))
  assert.match(self, /signedUrlTtlSeconds\('headshot'\)/)
})

test('client photo cache expires before the headshot lifetime and caches only headshot flows', () => {
  const cacheSrc = stripComments(read('src/lib/studentPhotoCache.js'))
  assert.match(cacheSrc, /const TTL_MS = 3300 \* 1000/)
  assert.ok(3300 < 3600)
  // Every mount-time hook that feeds the cache requests headshots; resumes are
  // click-time only (asserted above), so no cached URL can outlive its signature.
  const avatar = stripComments(read('src/components/StudentAvatar.jsx'))
  assert.match(avatar, /kind: 'headshot'/)
})
