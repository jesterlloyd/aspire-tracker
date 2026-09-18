// src/lib/supabaseFetch.js
//
// The request timeout for the Supabase client, as a named function rather than a
// closure inside createClient's options, so it can be tested. It could not be before,
// and it was broken for as long as it existed.
//
// THE BUG THIS FILE FIXES
//
//   fetch(...args, { signal: controller.signal })
//
// postgrest-js invokes a custom fetch with TWO arguments (verified in
// node_modules/@supabase/postgrest-js/dist/index.mjs: `await _fetch(_this.url.toString(),
// { ... })`), so that expression evaluated to fetch(url, options, { signal }). The Fetch
// API ignores a third argument. The AbortController was constructed, the timer was set
// and dutifully cleared, and nothing was ever aborted: every Supabase request in this app
// has been able to hang indefinitely since the line was written, under a comment
// promising a twelve second limit.
//
// It reads as correct, which is the whole problem. `...args` looks like it is forwarding
// the call and appending an option; what it actually does is append a positional argument
// nobody reads.
//
// WHY THE CALLER'S SIGNAL IS COMPOSED RATHER THAN OVERWRITTEN
//
// Passing { ...init, signal: ours } would drop a signal the caller supplied, and several
// call sites here do supply one: every aborted-on-unmount fetch in the portal data layers
// passes its own. So the caller's signal is listened to and mirrored onto ours. Aborting
// theirs aborts the request, exactly as it did before, and the timeout still applies on
// top of it.
//
// AbortSignal.any() would express this in one line. It is not used: Safari only shipped
// it in 17.4 and this app is opened on hospital workstations and personal phones, so the
// listener is the honest choice.

export const SUPABASE_REQUEST_TIMEOUT_MS = 12000

/**
 * Build the fetch the Supabase client uses.
 *
 * `timeoutMs` and `fetchImpl` exist for the tests. Production passes neither, and the
 * global fetch is resolved at CALL time rather than captured here, which is what the
 * original closure did and what lets src/lib/demoFetch.js install its header afterwards.
 */
export function createTimeoutFetch({ timeoutMs = SUPABASE_REQUEST_TIMEOUT_MS, fetchImpl = null } = {}) {
  return function supabaseFetch(input, init) {
    const run = fetchImpl || globalThis.fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // Either call form can carry the caller's own signal: fetch(url, { signal }) or
    // fetch(request), where a Request always has one.
    const fromInit = init?.signal
    const fromRequest = (!fromInit && typeof Request !== 'undefined' && input instanceof Request)
      ? input.signal
      : null
    const callerSignal = fromInit || fromRequest

    let detach = () => {}
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort()
      } else {
        const onAbort = () => controller.abort()
        callerSignal.addEventListener('abort', onAbort, { once: true })
        detach = () => callerSignal.removeEventListener('abort', onAbort)
      }
    }

    // Spreading an absent init yields { signal }, which is the correct way to attach one
    // to a bare Request. Every other option the caller set survives untouched.
    return run(input, { ...init, signal: controller.signal })
      .finally(() => { clearTimeout(timer); detach() })
  }
}
