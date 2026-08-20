// ASPIRE-CHART: the canonical attention engine.
//
// One source of truth for every Action Center predicate. Before this module,
// the same predicates lived in FOUR places (ActionCenter's actionItems, the
// eager mirror in App.jsx, the lazy mirror in App.jsx, and a fourth separate
// support query) with a literal "Keep the two in sync" comment. Both the
// closed bell badge (App.jsx) and the open panel (ActionCenter.jsx) now
// derive from these functions, so the two counts cannot drift.
//
// Channel rules (approved attention architecture):
// - Action Center owns unresolved, actionable operational items only.
// - Messages unread stays in the Messages system (never counted here).
// - Support-needed requests count here AND render in Rotation Activity, but
//   both surfaces share lib/support/supportRequests.js fingerprints, and the
//   Action Center total counts each unread request exactly once.
// - A plain submitted shift log is INFORMATIONAL: it renders in Rotation
//   Activity as activity, and (approved shift-log semantics) it no longer
//   inflates the required-action count, because the staff app deliberately
//   offers no per-shift approval action. The former "Shift Log Needs Review"
//   task is retired. A shift carrying support-needed text remains actionable.
//
// Everything here is pure: no I/O, no Date.now() defaults (callers pass
// `now`), so both consumers and the tests exercise identical logic.

import { getCsLinkStatus } from './utils.js'
import { resolveAutomationState, requiresHuman, isPassiveStatus } from './automationOwnership.js'
import { hasCompletedRequiredHours } from './clinicalHours.js'
import {
  notificationStateFor, notificationStateIndex, NOTIFICATION_TARGETS,
} from './placementNotificationState.js'

// ── Weekly shift-logging canon (NO-SHIFT-WEEK-1) ────────────────────────────
// The operational expectation is that an Active Rotation student logs at least
// one shift each Sunday-Saturday week. The old rule ("no log submitted in the
// last 7 rolling days") measured the wrong things twice: it read submitted_at
// (so a past shift entered late looked recent, and a Sunday logger drifted in
// and out of the flag midweek), and an arbitrary rolling window is not how the
// program actually thinks about attendance. The canon is now the completed
// calendar week: a student is flagged when the most recently CLOSED Sun-Sat
// week contains zero valid shifts, judged by shift_date (the day the shift
// happened), never by when the row was submitted.
export const WEEK_LENGTH_DAYS = 7

/** The most recently completed Sunday-Saturday week, as local 'YYYY-MM-DD'. */
export function lastCompletedWeek(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // getDay(): 0 = Sunday. The last completed Saturday is (weekday + 1) days back.
  const end = new Date(today); end.setDate(today.getDate() - (today.getDay() + 1))
  const start = new Date(end); start.setDate(end.getDate() - 6)
  return { start: fmtLocalDate(start), end: fmtLocalDate(end) }
}

/** Every local date of a week as 'YYYY-MM-DD' (for blackout coverage checks). */
export function weekDates(week) {
  const [y, m, d] = week.start.split('-').map(Number)
  return Array.from({ length: WEEK_LENGTH_DAYS }, (_, i) =>
    fmtLocalDate(new Date(y, m - 1, d + i)))
}

// Shift rows that count as a real logged shift. ASPIRE has no canceled or
// deleted shift rows (see lib/server/shiftOrdinals.js) - in_progress and
// completed both count; unexpected lifecycle states are excluded defensively.
// A Rejected approval status is the one taxonomy value meaning "this log was
// not accepted", so it cannot fill a week.
const VALID_LIFECYCLE = new Set(['completed', 'in_progress'])
const REJECTED = new Set(['Rejected', 'rejected'])
export function isCountableShift(l) {
  if (l?.lifecycle_state != null && !VALID_LIFECYCLE.has(l.lifecycle_state)) return false
  return !REJECTED.has(l?.status)
}

/** The local calendar day a shift happened: shift_date, else the submission day. */
export function shiftDayOf(l) {
  if (l?.shift_date) return l.shift_date
  if (l?.submitted_at) return fmtLocalDate(new Date(l.submitted_at))
  return null
}

// The '1900-01-01' sentinel in cohort_school_rotations means "window pending
// admin review" and must read as unknown, never as a real start date.
const ROTATION_SENTINEL = '1900-01-01'
const knownDate = (d) => (d && d !== ROTATION_SENTINEL ? d : null)

// Statuses where an interview reminder is meaningless regardless of what date
// is still on the student record (withdrawn, declined, or already finished).
const REMINDER_TERMINAL_STATUSES = new Set(['Not Proceeding', 'Declined', 'Completed'])

export function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const hasSent = (communications, sid, type) =>
  communications.some(c => c.student_id === sid && c.type === type)

/**
 * Eager attention sets - computable from the always-loaded cohort data
 * (students, matches, communications, activeCohort). Returns the raw student
 * lists per task so the panel can render items and the badge can count them.
 */
export function deriveEagerAttention({
  students = [], matches = [], communications = [], activeCohort = null, canEdit = false, now = new Date(),
  // PRECEPTOR-NOTIFICATION-ACTION-CENTER-1: Unit Pool owns the durable,
  // placement-specific answer to "has this preceptor been notified?". Until
  // that ledger has loaded, omit this task instead of briefly manufacturing a
  // false reminder from an empty array.
  placementNotifications = [], placementNotificationsLoaded = false,
  // ACTION-OWNERSHIP-1: automation-backed state. `reminderDeliveries` are
  // notification_log rows (where the cron actually records its sends);
  // `deliveriesLoaded` gates them exactly like shiftLogsLoaded gates the lazy
  // sets, so a slow query can never manufacture a false "not sent" action.
  reminderDeliveries = [], deliveriesLoaded = false, interviewRemindersEnabled = true,
  // ACTION-OWNERSHIP-2: the rows the interview-reminder cron actually reads. It
  // selects interview_sessions with a non-null slot_id and targets
  // interview_slots.slot_date - it never looks at students.interview_scheduled_date.
  // Passing them here lets ownership be judged against the automation's OWN
  // view of the world instead of a column it cannot see.
  ivSessions = [], ivSlots = [],
}) {
  const td = fmtLocalDate(now)

  // studentId -> the slot date the cron would target for them. Absent means the
  // interview was never booked through the scheduler, so the cron has no send
  // scheduled for that student at all.
  const slotDateById = new Map(ivSlots.map(sl => [sl.id, sl.slot_date]))
  const bookedInterviewDate = new Map()
  for (const sess of ivSessions) {
    if (!sess?.student_id || !sess?.slot_id) continue
    const d = slotDateById.get(sess.slot_id)
    if (d) bookedInterviewDate.set(sess.student_id, d)
  }

  // Always-visible tasks (not role-gated in the panel)
  // CONNECT-SCHEDULING-LINK-1: the task is resolved by a logged 'scheduling_link' communication, the
  // same hasSent() shape as the legacy preceptor fallback below. Before this, the predicate read
  // status + interview_scheduled_date only, so the item's own "mark done" (which writes exactly this
  // communication) could never clear it and the task persisted until the student booked a slot.
  const schedulingLink = students.filter(s =>
    s.status === 'Form Received' && !s.interview_scheduled_date &&
    !hasSent(communications, s.id, 'scheduling_link')
  )
  // ACTION-OWNERSHIP-1: interview reminders are owned by
  // api/cron/interview-reminders.js. This no longer asks "is an interview
  // near and is there no communications row?" - that question produced an
  // unresolvable card, because the cron writes to notification_log and never
  // to communications, so an automated send could not clear it and the item
  // outlived the interview.
  //
  // It now asks who owns the work. Only exceptions (send failed, window
  // passed unsent, automation off) are actions; a scheduled or delivered
  // reminder is status, and a past interview is nothing at all.
  const reminderStates = students
    // A student who has withdrawn, declined, or finished does not need an
    // interview reminder, even if a stale interview date is still on the
    // record. Excluding terminal statuses rather than whitelisting the active
    // ones keeps a legitimately-booked student visible whatever their stage.
    .filter(s => s.interview_scheduled_date && !REMINDER_TERMINAL_STATUSES.has(s.status))
    .map(s => {
      // The automation's event date is the BOOKED slot date, because that is
      // what the cron matches on. Fall back to the student record only so a
      // staff-typed interview still has a sensible reminder moment; that case
      // is flagged automationScheduled:false so it is never reported as a miss.
      const booked = bookedInterviewDate.get(s.id) || null
      return {
      student: s,
      ...resolveAutomationState({
        actionKey: 'interview_reminder',
        eventDate: booked || s.interview_scheduled_date,
        automationScheduled: !!booked,
        todayDate: td,
        now,
        deliveries: reminderDeliveries.filter(d => d.student_id === s.id),
        manualLogs: communications.filter(c => c.student_id === s.id),
        deliveriesLoaded,
        automationEnabled: interviewRemindersEnabled,
      }),
      }
    })

  // Counted: a person must act.
  const interviewReminder = reminderStates
    .filter(r => requiresHuman(r.state))
    .map(r => ({ ...r.student, automationState: r.state, automationSpec: r.spec }))
  // Never counted: shown as passive status only.
  // Only genuinely automated reminders belong in the passive "handled
  // automatically" list. A staff-typed interview is not automated, so listing
  // it there would claim a send that is never coming.
  const interviewReminderScheduled = reminderStates
    .filter(r => isPassiveStatus(r.state) && r.automationScheduled !== false)
    .map(r => ({ ...r.student, automationState: r.state, scheduledFor: r.scheduledFor }))
  const placementNotificationIndex = notificationStateIndex(placementNotifications)
  const preceptorWelcome = !placementNotificationsLoaded ? [] : students.flatMap(s => {
    if (s.status !== 'Placed' || hasSent(communications, s.id, 'preceptor_welcome')) return []

    const studentMatches = matches.filter(m => m.student_id === s.id)
    // A pre-ledger student with no match row cannot be checked against Unit
    // Pool's placement ledger. Keep the legacy reminder visible until the
    // placement is repaired or its old communication record exists.
    if (studentMatches.length === 0) {
      return s.matched_preceptor ? [{
        ...s,
        attentionMatchId: null,
        attentionUnitId: s.matched_unit_id || null,
        attentionPreceptorId: s.preceptor_id || null,
        attentionPreceptorName: s.matched_preceptor,
      }] : []
    }

    return studentMatches.flatMap(match => {
      // Match-level assignment is authoritative. Student-level fields are safe
      // only when this student has exactly one placement; otherwise they could
      // name a different unit's preceptor.
      const singlePlacement = studentMatches.length === 1
      const preceptorId = match.preceptor_id || (singlePlacement ? s.preceptor_id : null)
      const preceptorName = match.preceptor_assigned || (singlePlacement ? s.matched_preceptor : '')
      if (!preceptorId && !preceptorName) return []

      const state = preceptorId
        ? notificationStateFor(placementNotificationIndex, {
            target: NOTIFICATION_TARGETS.PRECEPTOR,
            matchId: match.id,
            preceptorId,
          })
        : null
      if (state?.confirmed) return []

      return [{
        ...s,
        attentionMatchId: match.id,
        attentionUnitId: match.unit_id,
        attentionPreceptorId: preceptorId || null,
        attentionPreceptorName: preceptorName || 'Assigned preceptor',
      }]
    })
  })

  // canEdit-gated tasks (empty for non-editors so counting is uniform)
  const sendStudentForm = !canEdit ? [] : students.filter(s => s.status === 'Pending Outreach')
  const unitLeaderNotification = !canEdit ? [] : students.filter(s => {
    if (s.status !== 'Placed' || !s.matched_unit_id) return false
    // UNIT-POOL-REFINEMENT-1: the task is about the student's PRIMARY unit, so
    // its notified state must read that unit's match - the first match by
    // student alone could be a multi-unit student's other placement.
    const m = matches.find(m => m.student_id === s.id && m.unit_id === s.matched_unit_id)
    return m && !m.notification_sent
  })
  // CS-Link "not started": canonical derivation (utils.getCsLinkStatus), the
  // same source as Student Profiles. The status whitelist already excludes
  // Not Proceeding / withdrawn students.
  const csLinkNotStarted = !canEdit ? [] : students.filter(s =>
    ['Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation'].includes(s.status) &&
    getCsLinkStatus(s) === 'not_started'
  )
  const badgeNotCreated = !canEdit ? [] : students.filter(s => s.status === 'Placed' && !s.badge_created)
  const noPreceptor = !canEdit ? [] : students.filter(s =>
    ['Placed', 'Active Rotation'].includes(s.status) &&
    !s.preceptor_id &&
    (!s.matched_preceptor || !s.matched_preceptor.trim())
  )
  const selectionDecision = !canEdit ? [] : students.filter(s =>
    s.interview_outcome === 'Do Not Recommend' && s.status === 'Interviewed'
  )

  const placedStudents = students.filter(s => s.status === 'Placed')
  const orientationComplete = !!activeCohort?.orientation_sent_at ||
    communications.some(c => c.type === 'orientation_email')
  const orientationDue = !!(canEdit && activeCohort && !orientationComplete && placedStudents.length > 0)

  const count =
    schedulingLink.length + interviewReminder.length + preceptorWelcome.length +
    sendStudentForm.length + unitLeaderNotification.length + csLinkNotStarted.length +
    badgeNotCreated.length + noPreceptor.length + selectionDecision.length +
    (orientationDue ? 1 : 0)

  return {
    schedulingLink, interviewReminder, preceptorWelcome,
    sendStudentForm, unitLeaderNotification, csLinkNotStarted,
    badgeNotCreated, noPreceptor, selectionDecision,
    orientationDue, placedStudents, orientationComplete,
    // Passive automation status. Deliberately outside `count`: it is
    // visibility, not work. Keep it out of any badge total.
    interviewReminderScheduled,
    count,
  }
}

/**
 * Lazy attention sets - need cohort shift logs and disposition data, fetched
 * only when a consumer has them. Loaded-flags gate each set to [] so a badge
 * never briefly over-counts (e.g. "No Shift Logged Last Week" flagging
 * everyone before logs arrive).
 *
 * Retired here (approved shift-log semantics): the old act13 "Shift Log
 * Needs Review" task. Plain submitted logs are informational activity, not
 * required actions; they render in Rotation Activity only.
 */
export function deriveLazyAttention({
  students = [], shiftLogs = [], shiftLogsLoaded = false,
  schoolRotations = [],
  dispositionFollowups = [], activeDispositionIds = [], dispositionLoaded = false,
  canEdit = false, now = new Date(),
}) {
  const week = lastCompletedWeek(now)

  // NO-SHIFT-WEEK-1. Only 'Active Rotation' students can qualify, which is
  // also what excludes every terminal status (Completed, Not Proceeding,
  // Declined, Withdrawn...) - a student who exited the rotation is not
  // expected to log anything. The remaining guards prevent flagging a week
  // the student was not genuinely expected to work:
  //   - rotation window (cohort_school_rotations by school): the missed week
  //     must sit fully inside [rotation_start_date, rotation_end_date];
  //     partial first/last weeks never flag. The 1900-01-01 sentinel means
  //     the window is unknown, in which case the student's own earliest shift
  //     must predate the week - a student with no history and no window reads
  //     as "not started", not as "not logging".
  //   - blackouts: a week fully covered by school blackout_dates plus the
  //     student's personal_blackout_dates is an approved break, not a miss.
  //   - resolution is derived, never dismissed: a valid shift dated INSIDE
  //     the week (including a late "Log a Past Shift" entry) clears it, and
  //     so does any valid shift dated AFTER the week - a student who has
  //     already resumed logging is not an operational concern.
  const noShiftLastWeek = !shiftLogsLoaded ? [] : students
    // Monitoring eligibility, checked BEFORE the weekly rule runs:
    //   - 'Active Rotation' excludes every terminal status (Completed, Not
    //     Proceeding, Declined) - a student who exited is not expected to log.
    //   - HOURS-COMPLETE-1: a student who has met their required hours is
    //     equally not expected to log, even while their administrative status
    //     still reads Active Rotation. Production showed five such students
    //     (132/132, 108/108) carrying the green Complete badge in Rotation
    //     Activity while the Action Center still asked about last week. The
    //     answer comes from hasCompletedRequiredHours, the SAME determination
    //     behind that badge, so the two surfaces cannot disagree. An unknown
    //     requirement (hours_required 0 or missing) is not completion and
    //     keeps the student monitored.
    .filter(s => s.status === 'Active Rotation' && !hasCompletedRequiredHours(s))
    .map(s => {
      const days = shiftLogs
        .filter(l => l.student_id === s.id && isCountableShift(l))
        .map(shiftDayOf).filter(Boolean).sort()
      if (days.some(d => d >= week.start && d <= week.end)) return null // week is covered
      if (days.some(d => d > week.end)) return null                     // already resumed

      const rot = schoolRotations.find(r => r.school_name === s.school)
      const rotStart = knownDate(rot?.rotation_start_date)
      const rotEnd = knownDate(rot?.rotation_end_date)
      if (rotStart) {
        if (rotStart > week.start) return null // rotation began mid-week or later
      } else if (!days.length || days[0] >= week.start) {
        return null // no window and no prior history: cannot have missed a week
      }
      if (rotEnd && rotEnd < week.end) return null // rotation ended mid-week or earlier

      const blackout = new Set([
        ...(Array.isArray(rot?.blackout_dates) ? rot.blackout_dates : []),
        ...(Array.isArray(s.personal_blackout_dates) ? s.personal_blackout_dates : []),
      ])
      if (blackout.size && weekDates(week).every(d => blackout.has(d))) return null

      const lastShiftDay = days.length ? days[days.length - 1] : null
      return { ...s, lastShiftDay, missedWeek: week }
    })
    .filter(Boolean)

  // Disposition follow-ups: keep a pending row only while its disposition is
  // still active (a cleared disposition orphans rows without deleting them),
  // grouped one item per student.
  const dispositionFollowup = (() => {
    if (!canEdit || !dispositionLoaded) return []
    const activeIds = new Set(activeDispositionIds)
    const grouped = new Map()
    for (const f of dispositionFollowups) {
      if (!activeIds.has(f.disposition_id)) continue
      const s = students.find(st => st.id === f.student_id)
      if (!s) continue
      if (!grouped.has(f.student_id)) grouped.set(f.student_id, { student: s, followups: [] })
      grouped.get(f.student_id).followups.push(f)
    }
    return Array.from(grouped.values())
  })()

  return {
    noShiftLastWeek,
    dispositionFollowup,
    count: noShiftLastWeek.length + dispositionFollowup.length,
  }
}

/**
 * The one closed-badge total: eager + lazy + unread support requests. The
 * support count comes from lib/support/supportRequests.js (the same
 * fingerprint source the panel and Rotation Activity use), so a support
 * request is counted exactly once no matter how many surfaces render it.
 */
export function attentionBadgeTotal({ eager, lazy, supportUnreadCount = 0 }) {
  return (eager?.count || 0) + (lazy?.count || 0) + supportUnreadCount
}
