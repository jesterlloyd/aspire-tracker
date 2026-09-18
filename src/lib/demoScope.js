// src/lib/demoScope.js
//
// DEMO-MODE-1: the boundary. One function, installed once on the one client in
// src/lib/supabase.js, which is why 121 call sites across 32 files did not have to be
// edited by hand and why the call site written next week inherits the boundary without
// knowing it exists.
//
// WHY NOT EDIT THE CALL SITES: because the failure mode is asymmetric. A missed filter
// is a real student's name on a projector in a ballroom. Hand-editing 121 reads and
// then trusting that nobody adds a 122nd is a plan that fails quietly and in public.
// Interception fails loudly, in one place, for every read at once.
//
// WHAT IT DOES, measured against supabase-js 2.105.1 rather than assumed:
//   .from('students').select('*')              GET    students?select=*&is_demo=eq.false
//   .from('students').update({...}).eq('id',x) PATCH  students?is_demo=eq.false&id=eq.x
//   .from('students').delete().eq('id', x)     DELETE students?is_demo=eq.false&id=eq.x
//   .from('students').insert({...})            POST   body carries is_demo
//
// The update and delete lines are the important ones. The mode is part of the WHERE
// clause, not a courtesy applied before it, so a write issued in demo mode cannot reach
// a real row even if the id it was handed belongs to one. That is a property of the
// generated SQL, not of anyone remembering to check.
//
// THREE THINGS THIS DOES NOT COVER, stated here rather than discovered later:
//
//   1. rpc(). PostgREST function calls carry no table to filter. There are 27 call
//      sites over 14 functions; the ones that read or write student data are listed in
//      DEMO_UNSCOPED_RPCS below and are handled in their own phase.
//   2. Embedded selects. In students?select=id,units(name) the filter applies to
//      students, not to the embedded units. This is harmless wherever the embed follows
//      a foreign key, because a demo row's parent and children are demo by
//      construction, and it is why the seed must never point a demo row at a real one.
//   3. Tables absent from the registry. They are unfiltered in both modes by design.
//      The registry is the honest statement of how far the boundary currently reaches.

import { isDemoMode } from './demoMode.js'
import { DEMO_BOUNDARY_LIVE } from './demoBoundaryFlag.js'
import { DEMO_SCOPED_TABLES } from '../../shared/demoTables.js'


/**
 * Every table the boundary filters. The list itself lives in shared/demoTables.js,
 * because the SERVER half of the boundary (lib/server/demoScope.js, which the portal
 * previews go through) filters on exactly the same set and a second copy would drift.
 * Re-exported here so every existing importer keeps its import path.
 */
export { DEMO_SCOPED_TABLES }

const SCOPED = new Set(DEMO_SCOPED_TABLES)

/**
 * The rpc functions that read or write people data and therefore sit OUTSIDE the
 * boundary. Listed so the gap is documented rather than implied. Nothing reads this
 * array at runtime; test/demoScope.test.mjs asserts it still matches the tree, so the
 * day someone adds a 15th function the list stops being quietly wrong.
 */
export const DEMO_UNSCOPED_RPCS = Object.freeze([
  'get_active_interviewers',
  'list_interview_rubrics_for_cohort',
  'record_student_disposition',
  'clear_student_disposition',
  'complete_disposition_followup',
  'get_all_user_profiles',
])

/** Is this table inside the boundary? */
export function isScopedTable(table) { return SCOPED.has(table) }

// Stamp the current mode onto a row, or onto every row of a batch. Written so an
// explicit is_demo passed by a caller loses: the mode decides, not the payload.
function stamp(values, demoOn) {
  if (Array.isArray(values)) return values.map(row => ({ ...row, is_demo: demoOn }))
  if (values && typeof values === 'object') return { ...values, is_demo: demoOn }
  return values
}

/**
 * Install the boundary on a Supabase client. Idempotent: installing twice is a no-op
 * rather than a double filter.
 *
 * The mode is read per call, not captured at install time, so flipping demo mode takes
 * effect on the next query without a reload.
 */
export function installDemoScope(client) {
  if (!DEMO_BOUNDARY_LIVE) return client
  return attachDemoScope(client)
}

/**
 * The mechanism, with no gate in front of it.
 *
 * Separated from installDemoScope so the tests can assert what the wrapper actually
 * generates without depending on the value of a flag that is false for most of this
 * feature's life. Production always goes through installDemoScope.
 */
export function attachDemoScope(client, modeFn = isDemoMode) {
  if (!client || client.__demoScopeInstalled) return client

  const origFrom = client.from.bind(client)

  client.from = (table) => {
    const qb = origFrom(table)
    if (!SCOPED.has(table)) return qb

    // Read per call, not captured at attach time, so flipping demo mode takes effect on
    // the next query rather than on the next reload. `modeFn` is a parameter only so the
    // tests can exercise both modes while DEMO_BOUNDARY_LIVE is false; production passes
    // nothing and gets isDemoMode.
    const demoOn = modeFn()
    const _select = qb.select.bind(qb)
    const _update = qb.update.bind(qb)
    const _delete = qb.delete.bind(qb)
    const _insert = qb.insert.bind(qb)
    const _upsert = qb.upsert.bind(qb)

    // .eq() returns the same builder, so every filter, order, range and modifier the
    // caller chains afterwards still applies. Verified against 2.105.1.
    qb.select = (...args) => _select(...args).eq('is_demo', demoOn)
    qb.update = (values, ...args) => _update(values, ...args).eq('is_demo', demoOn)
    qb.delete = (...args) => _delete(...args).eq('is_demo', demoOn)
    qb.insert = (values, ...args) => _insert(stamp(values, demoOn), ...args)
    qb.upsert = (values, ...args) => _upsert(stamp(values, demoOn), ...args)

    return qb
  }

  client.__demoScopeInstalled = true
  return client
}

/**
 * Does a realtime payload belong to the mode currently in force?
 *
 * `modeFn` is the same test seam attachDemoScope carries, for the same reason.
 *
 * Realtime is the one read path the query wrapper cannot reach: the server pushes rows
 * rather than answering a filtered request, so a real student edited by a colleague
 * mid-presentation would otherwise arrive in a demo view. Subscribers pass their
 * payload through this before acting on it.
 *
 * A payload with no is_demo (a table outside the registry, or a DELETE that carries
 * only the primary key) is treated as BELONGING, because dropping it would silently
 * break realtime for every unscoped table. Scoped tables are the ones that matter and
 * they carry the column.
 */
export function realtimePayloadInScope(payload, modeFn = isDemoMode) {
  if (!DEMO_BOUNDARY_LIVE) return true
  const row = payload?.new ?? payload?.old
  if (!row || typeof row !== 'object') return true
  if (!('is_demo' in row)) return true
  return Boolean(row.is_demo) === modeFn()
}
