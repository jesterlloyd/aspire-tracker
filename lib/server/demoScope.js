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

// ─────────────────────────────────────────────────────────────────────────────
// DEMO-MODE-2: the same boundary, applied to a whole service client.
//
// Phase 4 filtered the Student Portal preview by filtering the ONE endpoint that
// decides its population, and that worked because everything downstream is scoped by
// the student id chosen there. The other four portals are not built that way: the Unit
// Leader, Academic Partner and Nursing Education & Leadership previews each resolve
// their own scope inside their own roster endpoints, and there are 15, 4 and 6 of them
// respectively. Filtering each read by hand is the plan that fails quietly, in public,
// the first time someone adds a 26th endpoint.
//
// So the boundary goes where the browser's already is: on the client, once, wrapping
// .from(). This is the same mechanism as src/lib/demoScope.js (attachDemoScope) and
// reads the same registry, with one difference that matters: THREE STATES. A null scope
// returns the client untouched, so an endpoint called by a build that does not know
// about demo mode behaves exactly as it did before.
// ─────────────────────────────────────────────────────────────────────────────

import { DEMO_SCOPED_TABLES } from '../../shared/demoTables.js'
import { DEMO_EMAIL_DOMAIN, isDemoEmail } from '../../shared/demoIdentity.js'

const SCOPED = new Set(DEMO_SCOPED_TABLES)

/** Is this table inside the boundary? */
export function isDemoScopedTable(table) { return SCOPED.has(table) }

// Stamp the mode onto a row, or onto every row of a batch. An explicit is_demo passed
// by a caller LOSES: the mode decides, not the payload. (The database's inheritance
// triggers then overrule both for child rows, which is the intended order.)
function stamp(values, demoOn) {
  if (Array.isArray(values)) return values.map(row => ({ ...row, is_demo: demoOn }))
  if (values && typeof values === 'object') return { ...values, is_demo: demoOn }
  return values
}

/**
 * Apply the demo boundary to a service-role client.
 *
 * A null scope returns the client untouched. Any other scope wraps .from() so that
 * every read and write against a table in the registry carries is_demo in its WHERE
 * clause, and every insert is stamped.
 *
 * THIS MUTATES THE CLIENT, and that is safe for exactly one reason: getServiceDb()
 * calls createClient() and returns a NEW client on every call, so the wrapper never
 * outlives the request that asked for it. A warm Vercel container reuses the module,
 * not the client. If getServiceDb ever starts caching a singleton, this function must
 * become a non-mutating wrapper on the same day, or one demo request would scope every
 * later request in that container. test/demoPortalScope.test.mjs pins that property.
 *
 * Idempotent: wrapping an already-wrapped client is a no-op rather than a double
 * filter (`.eq('is_demo', x)` twice would still be correct, but a second wrap with a
 * DIFFERENT scope would silently return nothing, and that is worth refusing outright).
 */
export function scopedServiceDb(db, scope) {
  if (scope === null || scope === undefined) return db
  if (!db || typeof db.from !== 'function') return db
  if (db.__demoScopeInstalled) return db

  const demoOn = Boolean(scope)
  const origFrom = db.from.bind(db)

  db.from = (table) => {
    const qb = origFrom(table)
    if (!SCOPED.has(table)) return qb

    // .eq() returns the same builder, so every filter, order, range and modifier the
    // caller chains afterwards still applies. Only methods the builder HAS are wrapped:
    // a real PostgREST builder has all five, and a test's fake that has four must not be
    // turned into a TypeError by the one it left out (DEMO-DATA-2 put crons behind this).
    const wrap = (name, fn) => {
      if (typeof qb[name] !== 'function') return
      const orig = qb[name].bind(qb)
      qb[name] = (...args) => fn(orig, ...args)
    }
    wrap('select', (orig, ...args) => orig(...args).eq('is_demo', demoOn))
    wrap('update', (orig, values, ...args) => orig(values, ...args).eq('is_demo', demoOn))
    wrap('delete', (orig, ...args) => orig(...args).eq('is_demo', demoOn))
    wrap('insert', (orig, values, ...args) => orig(stamp(values, demoOn), ...args))
    wrap('upsert', (orig, values, ...args) => orig(stamp(values, demoOn), ...args))

    return qb
  }

  db.__demoScopeInstalled = true
  db.__demoScope = demoOn
  return db
}

/**
 * Which population is this client restricted to? true, false, or null for a client
 * that carries no boundary at all.
 *
 * Exists so a helper five layers below an endpoint can ask the client it was handed,
 * instead of every caller in between threading a scope parameter it does not otherwise
 * use. The client already knows; this is how it says so.
 */
export function demoScopeOf(db) {
  if (!db || !db.__demoScopeInstalled) return null
  return db.__demoScope
}

/**
 * The boundary for one request: read the scope off it and apply it to the client.
 * The single call every portal scope resolver makes.
 */
export function serviceDbForRequest(db, req) {
  return scopedServiceDb(db, demoScopeFromRequest(req))
}

/**
 * DEMO-DATA-2 (Owner, 2026-09-21: "we're not supposed to mix real and fake data"): the
 * client for anything that AGGREGATES people. A count, a list across cohorts, a digest,
 * Keith's context, a cron's sweep.
 *
 * ONE population, always, and never "no filter". A request that explicitly says demo
 * (x-aspire-demo: 1, or ?demo=1) reads demo rows; every other case reads REAL rows: a
 * request that says 0, a request that says nothing, and a cron that has no request at
 * all. serviceDbForRequest's third state ("absent means do not filter") was right only
 * before is_demo existed; for a total or a list it means "both", which is the bug.
 *
 * A by-id action (open this student, send to this contact) does not need this: the id
 * already pins the population. Use it where a demo row could otherwise ride along.
 */
export function populationDb(db, req = null) {
  return scopedServiceDb(db, populationOf(req))
}

/** The population a request presents under DEMO-DATA-2's rule: true for demo, else false. */
export function populationOf(req = null) {
  return (req ? demoScopeFromRequest(req) : null) === true
}

/**
 * Keep only the rows whose subject student is inside the population being presented.
 *
 * For tables the boundary cannot filter because they have no is_demo column. The
 * residency tables (ngrp_candidates, ngrp_residency_outcomes and their children) are
 * the case this exists for: they carry no is_demo of their own, but every one of them
 * is ABOUT a student, and the student IS inside the boundary. So the join decides.
 *
 * Without this, a residency row whose student has been filtered away does not
 * disappear: it renders with a blank name and its own columns intact, which in the
 * Residents tab means a real Cedars-Sinai address and hire unit on a demo screen. The
 * absent name is what makes it easy to miss.
 *
 * A null scope returns the rows untouched, like every other function here.
 */
export function narrowToStudents(rows, studentIds, scope, keyOf = (row) => row.student_id) {
  if (scope === null || scope === undefined) return rows || []
  const allowed = studentIds instanceof Set ? studentIds : new Set(studentIds || [])
  return (rows || []).filter(row => row && allowed.has(keyOf(row)))
}

/**
 * The same narrowing when the student arrives EMBEDDED rather than as an id
 * (DEMO-DATA-2): a root table with no is_demo of its own, such as program_events, read
 * with `students!inner(..., is_demo)`. The client wrapper filters the ROOT table and
 * never an embed, so without this a demo student's event rides into a real
 * coordinator's digest. A row whose embed is missing is dropped: it cannot say which
 * population it belongs to.
 */
export function narrowByEmbed(rows, scope, pick) {
  if (scope === null || scope === undefined) return rows || []
  return (rows || []).filter(row => {
    const parent = row ? pick(row) : null
    return !!parent && Boolean(parent.is_demo) === Boolean(scope)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO-DATA-2: the send log.
//
// notification_log has no is_demo, and cannot be given one cheaply: forty writers put
// rows in it. So a row's population is decided the way the mailer decides a message's:
// a row is DEMO when it was addressed to a demo person, or when the student it is about
// is a demo student (an interviewer's reminder about a demo candidate is a demo row even
// though the interviewer is real). Every other row is real. The two helpers below are the
// same rule twice: once as PostgREST filters, for a paginated list whose count must be
// exact, and once in memory, for a short list read through a scoped client.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The rule as `.or()` arguments, one per call: apply every string returned, each with its
 * own `.or()`, and PostgREST ANDs them. NULLs are spelled out on purpose: `not.ilike` and
 * `not.in` are NULL, not true, for a NULL column, and a NULL is a row PostgREST drops.
 *
 * @param {boolean} scope            true for demo rows, false for real ones
 * @param {Iterable<string>} demoStudentIds  every demo student's id (a small set)
 * @returns {string[]}
 */
export function sendLogPopulationFilters(scope, demoStudentIds = []) {
  const ids = [...new Set([...demoStudentIds].filter(id => typeof id === 'string' && UUID.test(id)))]
  const demoAddress = `recipient_email.ilike.*@${DEMO_EMAIL_DOMAIN}`
  if (scope) {
    return [ids.length ? `${demoAddress},student_id.in.(${ids.join(',')})` : demoAddress]
  }
  const out = [`recipient_email.is.null,recipient_email.not.ilike.*@${DEMO_EMAIL_DOMAIN}`]
  if (ids.length) out.push(`student_id.is.null,student_id.not.in.(${ids.join(',')})`)
  return out
}

/**
 * The same rule in memory, for rows read through a client carrying a scope. The students
 * read goes through that client, so it returns exactly the population's students: a
 * student id it does not return belongs to the other population. A failed read returns
 * nothing: a list that cannot tell the two apart shows neither.
 */
export async function narrowSendLog(db, rows) {
  const scope = demoScopeOf(db)
  if (scope === null) return rows || []
  const list = (rows || []).filter(Boolean)
  const ids = [...new Set(list.map(r => r.student_id).filter(Boolean))]
  const inPopulation = new Set()
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('students').select('id').in('id', ids.slice(i, i + 300))
    if (error) return []
    for (const s of data || []) inPopulation.add(s.id)
  }
  return list.filter(row => {
    const aboutDemoStudent = !!row.student_id && (scope ? inPopulation.has(row.student_id) : !inPopulation.has(row.student_id))
    const isDemoRow = isDemoEmail(row.recipient_email) || aboutDemoStudent
    return isDemoRow === scope
  })
}
