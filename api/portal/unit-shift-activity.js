// api/portal/unit-shift-activity.js
//
// UL-PHASE1: rotation activity for the Unit Leader calendar.
//
// WHAT THIS IS NOT. It is not a schedule. ASPIRE has no scheduled-shift data at all:
// api/shift-log/check-in.js stamps shift_date to Pacific TODAY at the moment a student
// checks in, and api/shift-log/submit-past-shift.js refuses a future date outright.
// Every row here is therefore an activity RECORD, either completed or in progress right
// now. The UI must never imply a future shift is booked.
//
// AUTHORIZATION. verifyPortalUnitLeaderCaller then resolveUnitScopedStudents, the same
// single source of truth every other Unit Leader endpoint uses. The client supplies a
// date range and nothing else that carries authority: student ids and unit keys are
// re-derived server side, and a student outside the caller's scope is invisible rather
// than refused, so this endpoint cannot be used to probe for students.
//
// THE FIELD ALLOWLIST IS THE POINT. student_shift_logs carries several free-text columns
// that Unit Leaders must never receive: support_needed (the private support narrative),
// admin_notes and reviewed_by (internal review), learning_highlight (the student's own
// reflection), and unit_override_reason / preceptor_override_note (free-text explanations
// of why a student deviated from their assignment). exception_flags encodes internal
// review state. SAFE_COLUMNS below is an explicit allowlist rather than a denylist, so a
// column added to the table later is excluded by default instead of leaking by default.
//
// shift_date IS TEXT, not date. Range filtering is lexicographic on YYYY-MM-DD, which
// sorts correctly for that format. Do not assume date semantics or rely on the database
// to coerce.

import {
  verifyPortalUnitLeaderCaller,
  resolveUnitScopedStudents,
} from '../lib/unitLeaderScope.js'

// The rolling window. A Unit Leader may look back 90 days and no further; there is
// nothing ahead to look at.
const WINDOW_DAYS = 90
const MAX_ROWS = 2000

// EXPLICIT ALLOWLIST. Everything not named here is excluded, including columns that do
// not exist yet. Never convert this to a denylist.
const SAFE_COLUMNS = [
  'id', 'student_id', 'shift_date', 'shift_type', 'total_hours', 'status',
  'lifecycle_state', 'checked_in_at', 'checked_out_at', 'expected_hours',
  'preceptor_name', 'planned_preceptor_name', 'planned_shift_type',
  'unit_name', 'planned_unit_name',
].join(', ')

/** Pacific YYYY-MM-DD, DST aware, matching how shift_date is written at check-in. */
function pacificDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

const isYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Shift a YYYY-MM-DD string by N days without timezone drift. */
function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, scopes } = auth

  // The window is computed from Pacific today, matching how shift_date is stamped.
  const today = pacificDateString()
  const windowStart = addDays(today, -WINDOW_DAYS)

  const from = typeof req.query?.from === 'string' ? req.query.from : windowStart
  const to = typeof req.query?.to === 'string' ? req.query.to : today
  if (!isYmd(from) || !isYmd(to)) return res.status(400).json({ error: 'invalid_date_range' })
  if (from > to) return res.status(400).json({ error: 'invalid_date_range' })
  // Bounded to the rolling window in BOTH directions. Asking for the future is refused
  // rather than silently returning nothing, because a caller expecting future shifts has
  // misunderstood what this endpoint is.
  if (from < windowStart) return res.status(400).json({ error: 'range_before_window', window_start: windowStart })
  if (to > today) return res.status(400).json({ error: 'range_in_future', window_end: today })

  let students
  try {
    ({ students } = await resolveUnitScopedStudents(db, scopes))
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
  if (students.length === 0) {
    return res.status(200).json({ window: { start: windowStart, end: today }, from, to, shifts: [] })
  }

  // Scope comes from the resolved set, never from the request.
  const byId = new Map(students.map(s => [s.id, s]))
  const { data, error } = await db
    .from('student_shift_logs')
    .select(SAFE_COLUMNS)
    .in('student_id', [...byId.keys()])
    .gte('shift_date', from)
    .lte('shift_date', to)
    .order('shift_date', { ascending: false })
    .limit(MAX_ROWS)
  if (error) return res.status(500).json({ error: 'internal_error' })

  const shifts = (data || []).map(r => {
    const s = byId.get(r.student_id)
    const inProgress = r.lifecycle_state === 'in_progress'
    return {
      id: r.id,
      student_id: r.student_id,
      // Denormalized for the calendar so the browser needs no second lookup, and taken
      // from the SCOPED student record rather than from the shift row.
      student_name: [s?.preferred_first_name || s?.first_name, s?.last_name].filter(Boolean).join(' ').trim() || null,
      unit_key: s?.unit_key || null,
      shift_date: r.shift_date,
      // Live shifts carry their planned values; completed shifts carry their recorded ones.
      shift_type: (inProgress ? r.planned_shift_type : r.shift_type) || null,
      preceptor_name: (inProgress ? r.planned_preceptor_name : r.preceptor_name) || null,
      unit_name: (inProgress ? r.planned_unit_name : r.unit_name) || null,
      checked_in_at: r.checked_in_at || null,
      checked_out_at: r.checked_out_at || null,
      hours: inProgress ? null : (r.total_hours ?? null),
      expected_hours: inProgress ? (r.expected_hours ?? null) : null,
      state: inProgress ? 'in_progress' : 'completed',
      // A presentation-level hours label only. Review metadata (reviewed_by,
      // reviewed_at, exception_flags) is never sent.
      hours_state: inProgress ? 'pending' : (r.status === 'approved' ? 'approved' : 'pending'),
    }
  })

  return res.status(200).json({
    window: { start: windowStart, end: today, days: WINDOW_DAYS },
    from,
    to,
    shifts,
  })
}
