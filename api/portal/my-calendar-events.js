// EVENT-AUDIENCE-1: ASPIRE events for a signed-in student's portal calendar.
//
// THE FIRST PATH BY WHICH A STAFF-AUTHORED EVENT REACHES A STUDENT. Until this endpoint
// existed, aspire_events was readable only through api/aspire-events.js, which is gated to
// active internal users, so no student could see an event under any circumstances. That is
// why this file is deliberately narrow: it is a new disclosure surface, not a convenience.
//
// TWO INDEPENDENT GATES, both required:
//   1. audience = 'all'. The staff author opted the event in, per event.
//   2. event_type is in DELIVERED_TYPES below. A narrow allow-list of programme dates.
//
// Why two. Audience alone is one mistake away from an accident: "Everyone" is a single
// click, and the free-text types ('deadline', 'reminder', 'custom') are exactly where
// internal shorthand gets written. A note reading "chase Maria re: paperwork" mis-tagged
// Everyone must not reach a student, so the type has to opt in as well.
//
// FIELD ALLOW-LIST, not field exclusion. The response is BUILT from named fields rather
// than filtered, so a column added to aspire_events later cannot leak by default. Nothing
// about authorship, targeting, or internal flags is returned: not created_by, not
// updated_by, not audience, not cohort_id, not school, not is_milestone, not status.
//
// READ ONLY. No create, no update, no archive. Students author nothing here.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// Kept in sync with STUDENT_DELIVERED_TYPES in src/lib/aspireEvents.js (api/ imports do not
// resolve safely at the Vercel runtime, the same reason api/aspire-events.js keeps its own
// copies). A parity test pins the two lists together.
const DELIVERED_TYPES = ['ngrp_open', 'ngrp_deadline', 'interview_window', 'town_hall', 'orientation']

// The one audience that reaches a student today. 'cohort' and 'school' are valid values in
// the column but have no consumer; they are NOT accepted here, so an event carrying one is
// treated exactly like 'internal' rather than being quietly delivered.
const DELIVERED_AUDIENCE = 'all'

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
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const db = getServiceDb()

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: auth.reason || 'unauthenticated' })
  if (!(await hasActiveRoleGrant(db, auth.profile.id, 'student'))) {
    return res.status(403).json({ error: 'forbidden' })
  }
  // A profile with no LIVE student link is not a student any more (S-05 deactivation).
  const studentIds = await getActiveStudentLinks(db, auth.profile.id)
  if (studentIds.length === 0) return res.status(403).json({ error: 'forbidden' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const { from, to } = body
  if (!validYmd(from) || !validYmd(to)) return res.status(422).json({ error: 'invalid_range' })
  if (to < from) return res.status(422).json({ error: 'invalid_range' })
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > MAX_RANGE_DAYS) return res.status(422).json({ error: 'range_too_wide', max_days: MAX_RANGE_DAYS })

  // The range is inclusive of both endpoints: `to` names a day, and an event at any time on
  // that day belongs to it, so the upper bound is the START of the following day.
  const toExclusive = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString()

  const { data, error } = await db
    .from('aspire_events')
    .select('id, title, description, event_type, start_at, end_at, all_day, location, url, color')
    .eq('status', 'active')
    .eq('audience', DELIVERED_AUDIENCE)
    .in('event_type', DELIVERED_TYPES)
    .gte('start_at', `${from}T00:00:00Z`)
    .lt('start_at', toExclusive)
    .order('start_at', { ascending: true })
    .limit(200)

  if (error) {
    // A missing table means the feature is not provisioned, which is not an error the
    // student can act on: the calendar simply shows no events.
    if (migrationMissing(error)) return res.status(200).json({ events: [] })
    console.error('[my-calendar-events] query_failed:', error.message)
    return res.status(500).json({ error: 'internal_error' })
  }

  return res.status(200).json({ events: (data || []).map(publicShape) })
}
