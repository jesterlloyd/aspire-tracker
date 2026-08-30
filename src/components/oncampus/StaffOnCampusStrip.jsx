// src/components/oncampus/StaffOnCampusStrip.jsx
//
// The STAFF-side "On Campus Now" strip: staff-scoped rows plus the staff
// StudentAvatar, rendered by the shared OnCampusNow card.
//
// ROTATION-ACTIVITY-CALENDAR-1 extracted this verbatim from OverviewTab, where it
// had been the only implementation. Rotation > Activity now shows the same strip,
// and two copies of this row shape would have been two places for the badge, the
// open-duration, and the hedged overdue wording to drift apart. src/lib/onCampusRows.js
// already exists to stop the PORTAL card disagreeing with the staff card; this is
// the same argument applied to the staff app's two own surfaces.
//
// PRESENTATIONAL. It holds no data, runs no query, and performs no authorization.
// Each caller supplies rows it has already scoped, and decides what a click does.
//
// The open/overdue vocabulary comes entirely from lib/shiftStatus.js, the single
// source of truth shared with the Unit Leader portal and the (now unmounted)
// OpenShiftReview detector. "Clock-out may be overdue" stays hedged here for the
// same reason it is hedged there: it is an estimate from conservative thresholds,
// never a confirmed missed clock-out.

import OnCampusNow from './OnCampusNow'
import StudentAvatar from '../StudentAvatar'
import { displayName } from '../../lib/utils'
import { shiftTypeOf, shiftBadge, isOpenShift, openShiftMs, formatDuration, isClockoutMaybeOverdue } from '../../lib/shiftStatus'

/**
 * @param logs           shift-log rows already scoped by the caller (lifecycle in_progress,
 *                       optionally merged with the active-window fallback)
 * @param students       the caller's student list, for identity and the fallback unit
 * @param units          for resolving a unit name when the log itself carries none
 * @param onSelectStudent(studentId)  what a card click does; omit for non-clickable cards
 * @param onViewAll      optional "View all activity" link in the header
 * @param title/sub      header text; `sub` defaults to date + student count
 * @param emptyText      when set, an empty list renders this instead of nothing
 * @param flush          drop the card system's horizontal inset (hosts with their own padding)
 */
export default function StaffOnCampusStrip({
  logs = [],
  students = [],
  units = [],
  onSelectStudent = null,
  onViewAll = null,
  title = 'On Campus Now',
  sub = undefined,
  emptyText = null,
  flush = false,
}) {
  if (logs.length === 0 && !emptyText) return null

  const rows = logs.map(log => {
    const stu = students.find(s => s.id === log.student_id)
    if (!stu) return null
    // ON-CAMPUS-NOW-UX-1: prefer the current shift log / lifecycle row's unit;
    // fall back to the student's matched/assigned unit when the row has none.
    const unitName = log.unit_name
      || units?.find(u => u.id === stu.matched_unit_id)?.unit_name
      || null
    const { label: shiftLabel, tone } = shiftBadge(shiftTypeOf(log))
    const open = isOpenShift(log)
    const overdue = open && isClockoutMaybeOverdue(log)
    return {
      key: log.id,
      avatar: <StudentAvatar student={stu} size={38} />,
      name: displayName(stu),
      subLabel: `${unitName || 'Unit not set'}${stu.matched_preceptor ? ` · with ${stu.matched_preceptor}` : ''}`,
      badge: { label: shiftLabel, tone },
      statusText: open
        ? (overdue ? 'Clock-out may be overdue' : `Open ${formatDuration(openShiftMs(log))}`)
        : (log.total_hours != null ? `${log.total_hours} hrs logged` : null),
      statusWarn: overdue,
      onClick: onSelectStudent ? () => onSelectStudent(stu.id) : undefined,
      ariaLabel: onSelectStudent ? `Open profile for ${displayName(stu)}` : displayName(stu),
    }
  }).filter(Boolean)

  const resolvedSub = sub !== undefined
    ? sub
    : `${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      + ` · ${logs.length} student${logs.length !== 1 ? 's' : ''}`

  return (
    <OnCampusNow
      title={title}
      sub={resolvedSub}
      flush={flush}
      onViewAll={onViewAll}
      rows={rows}
      emptyText={emptyText}
    />
  )
}
