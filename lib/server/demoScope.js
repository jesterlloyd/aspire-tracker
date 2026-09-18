// lib/server/demoScope.js
//
// DEMO-MODE-1: the server half of the boundary, for the endpoints the browser wrapper
// cannot reach.
//
// WHY THE SERVER HAS TO BE TOLD
//
// Demo mode is a per-user browser preference. A Vercel function has no session state
// and no way to discover it, so the request carries it. That is fine HERE and would not
// be fine in general, because of what this flag can and cannot do:
//
//   It cannot widen anything. Every endpoint that reads it has ALREADY verified the
//   caller is an Owner or an Admin, who can see every student either way. Passing
//   demo=1 narrows the result to fabricated rows; passing demo=0 narrows it to real
//   ones. Neither answer contains a row the caller could not otherwise fetch.
//
//   It is not a security control, and nothing in this file should ever be cited as one.
//   It decides which population a presentation looks at. Authorization is done by
//   verifyOwnerAdminCaller before this is consulted, every time.
//
// WHY ABSENT IS NOT THE SAME AS FALSE
//
// Three states, not two, and the third is the one that matters:
//
//   demo absent  the caller's build has the boundary switched off, which is the state
//                of the world until 20260921000000 is applied. Apply NO filter at all:
//                is_demo does not exist yet, and filtering on a column that is not
//                there is a 400 on a screen that worked yesterday.
//   demo=0       real rows only.
//   demo=1       fabricated rows only.
//
// The client sends the parameter only when DEMO_BOUNDARY_LIVE is true, so "absent"
// and "the column does not exist" are the same condition, and the safe behaviour for
// both is identical: behave exactly as this endpoint did before demo mode existed.

/**
 * Read the demo scope from a request.
 *
 * Returns true (demo rows), false (real rows), or null (the caller's build has no
 * boundary; do not filter).
 *
 * Accepts the query parameter or the header, because some callers are fetches with a
 * query string and some are POSTs whose body is already spoken for.
 */
export function demoScopeFromRequest(req) {
  const raw = req?.query?.demo ?? req?.headers?.['x-aspire-demo']
  if (raw === undefined || raw === null || raw === '') return null
  const value = String(Array.isArray(raw) ? raw[0] : raw).trim().toLowerCase()
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  // Anything else is a malformed parameter. Treat it as absent rather than guessing:
  // guessing true hides real work, guessing false shows real people during a demo.
  return null
}

/**
 * Apply the scope to a PostgREST query builder.
 *
 * A null scope returns the query untouched, which is what keeps this safe to deploy
 * before the migration is applied.
 */
export function applyDemoScope(query, scope) {
  if (scope === null || scope === undefined) return query
  return query.eq('is_demo', scope)
}

/**
 * Does a row belong to the population the caller asked for?
 *
 * For endpoints that fetch by an explicit id rather than listing. A null scope admits
 * everything, for the same reason applyDemoScope does nothing.
 *
 * This exists because an id can outlive the mode that produced it: a preview student id
 * held in component state, or a bookmarked URL, would otherwise open a real student's
 * portal in the middle of a demo.
 */
export function rowInDemoScope(row, scope) {
  if (scope === null || scope === undefined) return true
  if (!row || typeof row !== 'object') return false
  return Boolean(row.is_demo) === scope
}
