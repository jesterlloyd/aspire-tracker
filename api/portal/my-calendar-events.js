// EVENT-AUDIENCE-1 / EVENT-AUDIENCE-2: ASPIRE events for a signed-in portal user.
//
// THE ONE PATH BY WHICH A STAFF-AUTHORED EVENT LEAVES THE STAFF APP. Until this endpoint
// existed, aspire_events was readable only through api/aspire-events.js, which is gated to
// active internal users, so no outside user could see an event under any circumstances.
// That is why this file is deliberately narrow: it is a disclosure surface, not a
// convenience. AUDIENCE-2 widened it from students to every portal role, one role per
// request, with the same shape of gate for each.
//
// TWO INDEPENDENT GATES, both required:
//   1. The event's `audiences` set names the caller's role. The staff author ticked that
//      role, per event, in "Who sees this".
//   2. event_type is in DELIVERED_TYPES. A narrow allow-list of programme dates.
//
// Why two. A tick is one click, and the free-text types ('deadline', 'reminder', 'custom')
// are exactly where internal shorthand gets written. A note reading "chase Maria re:
// paperwork" mis-ticked for Unit Leaders must not reach a unit, so the type has to opt in
// as well. The list is shared by every outside audience; widen it per role only when a
// role has a named need.
//
// THE ROLE IS THE CALLER'S CLAIM, VERIFIED. The body names the role the portal is
// rendering; the endpoint verifies the caller holds an ACTIVE grant for exactly that
// role (S-05 deactivation), and for students an active student link as well. A profile
// with two roles asking as the wrong one gets 403, not the union.
//
// FIELD ALLOW-LIST, not field exclusion. The response is BUILT from named fields rather
// than filtered, so a column added to aspire_events later cannot leak by default. Nothing
// about authorship or targeting is returned: not created_by, not updated_by, not the
// audience set, not cohort_id, not school, not status. The one flag that IS returned is
// `in_masthead`, a boolean computed from show_on_welcome, because the masthead needs it
// and it says nothing about anyone but the event.
//
// BEFORE THE MIGRATION IS APPLIED (Owner-gated), the `audiences` column does not exist.
// The query then falls back to the AUDIENCE-1 rule exactly: audience = 'all' delivers to
// students, and to no other role. Nothing widens until the column is there.
//
// READ ONLY. No create, no update, no archive. Portal users author nothing here.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'
import { PORTAL_DELIVERED_TYPES as DELIVERED_TYPES, PORTAL_AUDIENCE_VALUES } from '../../src/lib/aspireEvents.js'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// The maximum span a single request may ask for. A calendar shows one month; this allows
// generous padding without letting one call enumerate the whole table.
const MAX_RANGE_DAYS = 120

function validYmd(value) {
  if (typeof value !== 'string' || !YMD_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
}

function migrationMissing(error) {
  return ['42P01', 'PGRST205'].includes(error?.code)
}
function columnMissing(error) {
  return ['42703', 'PGRST204'].includes(error?.code)
}

// Built from named fields. Never a spread of the row.
function publicShape(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || null,
    event_type: row.event_type,
    start_at: row.start_at,
    end_at: row.end_at || null,
    all_day: row.all_day === true,
    location: row.location || null,
    url: row.url || null,
    color: row.color || null,
    in_masthead: row.show_on_welcome === true,
  }
}

const SELECT = 'id, title, description, event_type, start_at, end_at, all_day, location, url, color, show_on_welcome'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const db = getServiceDb()

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: auth.reason || 'unauthenticated' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  // The role defaults to student so the AUDIENCE-1 caller (the student calendar) needs no change.
  const role = typeof body.role === 'string' && body.role ? body.role : 'student'
  if (!PORTAL_AUDIENCE_VALUES.includes(role)) return res.status(422).json({ error: 'invalid_role' })

  if (!(await hasActiveRoleGrant(db, auth.profile.id, role))) {
    return res.status(403).json({ error: 'forbidden' })
  }
  // A profile with no LIVE student link is not a student any more (S-05 deactivation).
  if (role === 'student') {
    const studentIds = await getActiveStudentLinks(db, auth.profile.id)
    if (studentIds.length === 0) return res.status(403).json({ error: 'forbidden' })
  }

  const { from, to } = body
  if (!validYmd(from) || !validYmd(to)) return res.status(422).json({ error: 'invalid_range' })
  if (to < from) return res.status(422).json({ error: 'invalid_range' })
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > MAX_RANGE_DAYS) return res.status(422).json({ error: 'range_too_wide', max_days: MAX_RANGE_DAYS })

  // The range is inclusive of both endpoints: `to` names a day, and an event at any time on
  // that day belongs to it, so the upper bound is the START of the following day.
  const toExclusive = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString()

  const base = () => db
    .from('aspire_events')
    .select(SELECT)
    .eq('status', 'active')
    .in('event_type', DELIVERED_TYPES)
    .gte('start_at', `${from}T00:00:00Z`)
    .lt('start_at', toExclusive)
    .order('start_at', { ascending: true })
    .limit(200)

  // Gate 1, the set form: the caller's role is IN the event's audiences.
  let { data, error } = await base().contains('audiences', [role])

  if (error && columnMissing(error)) {
    // The AUDIENCE-2 column is not there yet. Fall back to the AUDIENCE-1 rule exactly:
    // audience = 'all' reaches students, and reaches nobody else.
    if (role !== 'student') return res.status(200).json({ events: [] })
    ;({ data, error } = await base().eq('audience', 'all'))
  }

  if (error) {
    // A missing table means the feature is not provisioned, which is not an error the
    // caller can act on: the calendar simply shows no events.
    if (migrationMissing(error)) return res.status(200).json({ events: [] })
    console.error('[my-calendar-events] query_failed:', error.message)
    return res.status(500).json({ error: 'internal_error' })
  }

  return res.status(200).json({ events: (data || []).map(publicShape) })
}
