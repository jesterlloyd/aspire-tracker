// src/lib/demoFetch.js
//
// DEMO-MODE-2: how the server learns which population this browser is presenting.
//
// WHY A HEADER AND NOT A PARAMETER ON EACH CALL
//
// A Vercel function has no session and cannot discover a per-user browser preference,
// so the request has to carry it. Phase 4 did that by hand, on the two endpoints the
// Student Portal preview uses. The other four portals reach 25+ endpoints through four
// different client modules, plus one-off fetches in a dozen components, and several of
// them are POSTs whose body and query string are already spoken for.
//
// Editing 25 call sites is the plan that fails quietly: the failure mode is a real
// student's name on a projector in a ballroom, and the 26th call site written next
// month inherits nothing. So this goes where the Supabase boundary already is - one
// interception, applied to every request at once, inherited by anything added later.
//
// WHAT IT TOUCHES, and the narrowness is the safety argument:
//
//   ONLY same-origin requests whose path starts with /api/. Nothing else is altered in
//   any way. In particular Supabase's own traffic (a different origin) is untouched:
//   adding a custom header to a cross-origin request turns a simple request into a
//   preflighted one, which would be a self-inflicted outage on every read in the app.
//   Same-origin requests are never preflighted, so no endpoint needs to name this
//   header in Access-Control-Allow-Headers for it to arrive.
//
//   ONLY a header is added. Never the URL, the method, the body, or any other option.
//
//   An explicitly-set x-aspire-demo always wins, so a caller that wants to ask a
//   question about the other population still can.
//
// The value is demoScopeParam(): '1', '0', or null. Null means the boundary is not live
// in this build and the header is omitted entirely, which is what lets every endpoint
// keep behaving exactly as it did before is_demo existed. See lib/server/demoScope.js
// for why absent and false have to mean different things there.
//
// THIS IS NOT A SECURITY CONTROL. Every endpoint that reads the header has already
// verified an Owner/Admin or an explicitly granted portal caller, and the header can
// only narrow what they are already entitled to see. It decides which population a
// presentation looks at, nothing more.

import { demoScopeParam } from './demoMode.js'

export const DEMO_HEADER = 'x-aspire-demo'

/** Is this a same-origin /api/ request, and therefore ours to annotate? */
export function isOwnApiRequest(url, origin) {
  try {
    const resolved = new URL(url, origin)
    return resolved.origin === origin && resolved.pathname.startsWith('/api/')
  } catch {
    // An unparseable input is somebody else's problem; pass it through untouched.
    return false
  }
}

/**
 * Install the header on the global fetch. Idempotent.
 *
 * Returns the function that was replaced, so a test can restore it.
 */
export function installDemoApiHeader(scope = globalThis) {
  const original = scope?.fetch
  if (typeof original !== 'function') return null
  if (original.__demoHeaderInstalled) return original

  const patched = function fetch(input, init) {
    // Read per call, not captured at install time, so flipping demo mode takes effect
    // on the next request rather than on the next reload.
    const demo = demoScopeParam()
    if (demo === null) return original.call(this, input, init)

    const origin = scope?.location?.origin
    if (!origin) return original.call(this, input, init)

    try {
      const RequestCtor = scope.Request
      if (RequestCtor && input instanceof RequestCtor) {
        if (!isOwnApiRequest(input.url, origin)) return original.call(this, input, init)
        // A Request's headers are already materialized, so clone and set rather than
        // trying to merge an init that may not exist.
        const cloned = new RequestCtor(input, init)
        if (!cloned.headers.has(DEMO_HEADER)) cloned.headers.set(DEMO_HEADER, demo)
        return original.call(this, cloned)
      }

      const url = typeof input === 'string' ? input : input?.url ?? String(input ?? '')
      if (!isOwnApiRequest(url, origin)) return original.call(this, input, init)

      const headers = new Headers(init?.headers || {})
      if (!headers.has(DEMO_HEADER)) headers.set(DEMO_HEADER, demo)
      return original.call(this, input, { ...init, headers })
    } catch {
      // Anything unexpected about the arguments: send the request exactly as it was
      // asked for. A missing demo header shows the wrong population on a demo screen;
      // a thrown fetch breaks the app for everyone.
      return original.call(this, input, init)
    }
  }

  patched.__demoHeaderInstalled = true
  scope.fetch = patched
  return original
}
