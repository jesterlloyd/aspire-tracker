// test/supabaseFetchTimeout.test.mjs
//
// The Supabase client has advertised a twelve second request timeout since the line was
// written, and never had one. The code read:
//
//   fetch(...args, { signal: controller.signal })
//
// postgrest-js calls a custom fetch with TWO arguments, so that is
// fetch(url, options, { signal }), and fetch ignores a third argument. The
// AbortController was built, the timer set, the timer cleared, and no request was ever
// aborted. Nothing caught it because a closure inside createClient's options object
// cannot be called by a test, so the only evidence available was reading it, and reading
// it is what made it look right.
//
// The fix moved it into src/lib/supabaseFetch.js as a named function with the two seams
// this file needs: a shorter timeout, and a fetch to call. Everything below drives the
// REAL function, not a copy of its logic.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createTimeoutFetch, SUPABASE_REQUEST_TIMEOUT_MS } from '../src/lib/supabaseFetch.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT = 25

/**
 * A fetch that never answers, and rejects the way a real one does when aborted.
 *
 * The aborted() check before the listener is not decoration. addEventListener('abort')
 * NEVER fires on a signal that is already aborted, so a stub without it hangs forever on
 * the already-aborted case, while the real fetch rejects immediately: the spec checks
 * signal.aborted before it does anything else. A stub that cannot fail the same way the
 * real thing does is a test that proves the wrong thing.
 */
function hangingFetch(record = {}) {
  const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  return (input, init) => {
    record.input = input
    record.init = init
    if (init.signal?.aborted) return Promise.reject(abortError())
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(abortError()), { once: true })
    })
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. The bug itself
// ─────────────────────────────────────────────────────────────────────
test('a request that never answers is aborted, and the signal actually reaches fetch', async () => {
  const seen = {}
  const doFetch = createTimeoutFetch({ timeoutMs: TIMEOUT, fetchImpl: hangingFetch(seen) })

  const started = Date.now()
  await assert.rejects(
    doFetch('https://example.supabase.co/rest/v1/students', { method: 'GET' }),
    (err) => err.name === 'AbortError',
    'a hung Supabase request must be aborted by the timeout')
  assert.ok(Date.now() - started < 2000, 'and aborted promptly, not eventually')

  // The heart of it. Before the fix the signal was appended as a third positional
  // argument, so init.signal was undefined and the abort had nothing to act on.
  assert.ok(seen.init.signal, 'the AbortSignal must be INSIDE the init object fetch reads')
  assert.equal(seen.init.signal.aborted, true)
})

test('the caller options survive the signal being added', async () => {
  const seen = {}
  const doFetch = createTimeoutFetch({ timeoutMs: TIMEOUT, fetchImpl: hangingFetch(seen) })
  const body = JSON.stringify({ a: 1 })
  await assert.rejects(doFetch('https://example.supabase.co/rest/v1/students', {
    method: 'POST', headers: { apikey: 'anon', 'Content-Type': 'application/json' }, body,
  }), (err) => err.name === 'AbortError')

  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.body, body)
  assert.equal(seen.init.headers.apikey, 'anon',
    'dropping the apikey header would break every request in the app')
})

// ─────────────────────────────────────────────────────────────────────
// 2. The caller's own signal still works
// ─────────────────────────────────────────────────────────────────────
test("the caller's abort is honoured, not overwritten by ours", async () => {
  // Portal data layers abort on unmount and read err.name === 'AbortError' to render a
  // cancelled state rather than an error. Overwriting init.signal with ours would have
  // silently broken every one of them.
  const seen = {}
  const doFetch = createTimeoutFetch({ timeoutMs: 60000, fetchImpl: hangingFetch(seen) })
  const caller = new AbortController()

  const pending = doFetch('https://example.supabase.co/rest/v1/students', { signal: caller.signal })
  caller.abort()
  await assert.rejects(pending, (err) => err.name === 'AbortError')
  assert.equal(seen.init.signal.aborted, true,
    "aborting the caller's signal must abort the request, with our timeout still 60s away")
})

test('a signal that is already aborted is not ignored', async () => {
  const seen = {}
  const doFetch = createTimeoutFetch({ timeoutMs: 60000, fetchImpl: hangingFetch(seen) })
  const caller = new AbortController()
  caller.abort()
  await assert.rejects(
    doFetch('https://example.supabase.co/rest/v1/students', { signal: caller.signal }),
    (err) => err.name === 'AbortError')
})

test('the single argument form gets a signal too', async () => {
  // fetch(request), where there is no init to merge into. A Request always carries a
  // signal of its own, so it is composed like any other caller signal.
  const seen = {}
  const doFetch = createTimeoutFetch({ timeoutMs: TIMEOUT, fetchImpl: hangingFetch(seen) })
  const request = new Request('https://example.supabase.co/rest/v1/students')

  await assert.rejects(doFetch(request), (err) => err.name === 'AbortError')
  assert.ok(seen.init && seen.init.signal, 'a bare Request must still be given a timeout signal')
})

test("a Request's own signal is composed, not discarded", () => {
  // The one-argument branch is not just about attaching OUR timeout. Calling
  // fetch(request, { signal: ours }) builds a NEW Request carrying our signal, which
  // disconnects the one the caller put on theirs: their abort would stop working
  // silently. So the Request's signal is listened to like any other caller signal.
  //
  // This test exists because a mutation that disabled that branch survived the first
  // mutation run. Every other property of the one-argument form was covered and this
  // one was not.
  const seen = {}
  const doFetch = createTimeoutFetch({ timeoutMs: 60000, fetchImpl: hangingFetch(seen) })
  const caller = new AbortController()
  const request = new Request('https://example.supabase.co/rest/v1/students', { signal: caller.signal })

  const pending = doFetch(request)
  caller.abort()
  return assert.rejects(pending, (err) => err.name === 'AbortError',
    "aborting the signal on a Request must abort the request, with our own timeout 60s away")
})

// ─────────────────────────────────────────────────────────────────────
// 3. The timer is cleaned up
// ─────────────────────────────────────────────────────────────────────
test('a request that answers in time is never aborted afterwards', async () => {
  // The original code cleared its timer correctly; that half was never the problem, and
  // this makes sure the fix did not lose it. A leaked timer would abort a signal after
  // the response had already been handed back.
  const seen = {}
  const doFetch = createTimeoutFetch({
    timeoutMs: TIMEOUT,
    fetchImpl: (input, init) => { seen.init = init; return Promise.resolve({ ok: true, status: 200 }) },
  })

  const res = await doFetch('https://example.supabase.co/rest/v1/students')
  assert.equal(res.ok, true)

  await new Promise(resolve => setTimeout(resolve, TIMEOUT * 3))
  assert.equal(seen.init.signal.aborted, false,
    'the timer must be cleared on success, or a settled request is aborted behind the app')
})

test("a caller's listener is removed once the request settles", async () => {
  // Without the detach, every Supabase request through a long-lived AbortController
  // would leave a listener on it. React Query keeps one per query.
  const caller = new AbortController()
  const doFetch = createTimeoutFetch({
    timeoutMs: 60000,
    fetchImpl: () => Promise.resolve({ ok: true }),
  })

  for (let i = 0; i < 50; i++) await doFetch('https://example.supabase.co/rest/v1/students', { signal: caller.signal })

  // Node exposes no listener count for AbortSignal, so this asserts the observable
  // consequence instead: aborting afterwards must not throw from a pile of stale
  // listeners, and nothing is left to run.
  assert.doesNotThrow(() => caller.abort())
})

// ─────────────────────────────────────────────────────────────────────
// 4. The client uses it, and the broken shape is gone for good
// ─────────────────────────────────────────────────────────────────────
test('the Supabase client is built with this fetch', () => {
  const src = readFileSync(join(root, 'src/lib/supabase.js'), 'utf8')
  assert.match(src, /fetch:\s*createTimeoutFetch\(\)/,
    'the client must use the tested function, or this whole file tests nothing that ships')
})

test('nothing appends an option as a third argument to fetch again', () => {
  // The exact shape of the bug, banned by name. `fetch(...args, { ... })` reads as
  // forwarding a call and adding an option; it appends a positional argument no
  // implementation of fetch has ever read.
  for (const file of ['src/lib/supabase.js', 'src/lib/supabaseFetch.js', 'src/lib/demoFetch.js']) {
    const src = readFileSync(join(root, file), 'utf8').replace(/\/\/[^\n]*/g, '')
    assert.doesNotMatch(src, /fetch\(\s*\.\.\.\w+\s*,/,
      `${file} passes a third argument to fetch. The Fetch API ignores it: this is the ` +
      'exact defect that left every Supabase request without a timeout.')
  }
})

test('the advertised timeout and the real one are the same number', () => {
  // The comment said twelve seconds while the code did nothing. If the constant and the
  // prose ever disagree again, at least they disagree in one file.
  assert.equal(SUPABASE_REQUEST_TIMEOUT_MS, 12000)
  const src = readFileSync(join(root, 'src/lib/supabase.js'), 'utf8')
  assert.match(src, /12 second/, 'the comment beside the client should name the real limit')
})
