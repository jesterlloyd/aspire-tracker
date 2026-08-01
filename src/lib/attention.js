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

export const NOT_LOGGED_WINDOW_DAYS = 7

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
export function deriveEagerAttention({ students = [], matches = [], communications = [], activeCohort = null, canEdit = false, now = new Date() }) {
  const td = fmtLocalDate(now)
  const t48 = fmtLocalDate(new Date(now.getTime() + 48 * 3600 * 1000))

  // Always-visible tasks (not role-gated in the panel)
  // CONNECT-SCHEDULING-LINK-1: the task is resolved by a logged 'scheduling_link' communication, the
  // same hasSent() shape as interviewReminder/preceptorWelcome below. Before this, the predicate read
  // status + interview_scheduled_date only, so the item's own "mark done" (which writes exactly this
  // communication) could never clear it and the task persisted until the student booked a slot.
  const schedulingLink = students.filter(s =>
    s.status === 'Form Received' && !s.interview_scheduled_date &&
    !hasSent(communications, s.id, 'scheduling_link')
  )
  const interviewReminder = students.filter(s =>
    s.interview_scheduled_date >= td && s.interview_scheduled_date <= t48 &&
    !hasSent(communications, s.id, 'interview_reminder')
  )
  const preceptorWelcome = students.filter(s =>
    s.status === 'Placed' && s.matched_preceptor && !hasSent(communications, s.id, 'preceptor_welcome')
  )

  // canEdit-gated tasks (empty for non-editors so counting is uniform)
  const sendStudentForm = !canEdit ? [] : students.filter(s => s.status === 'Pending Outreach')
  const unitLeaderNotification = !canEdit ? [] : students.filter(s => {
    if (s.status !== 'Placed' || !s.matched_unit_id) return false
    const m = matches.find(m => m.student_id === s.id)
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
    count,
  }
}

/**
 * Lazy attention sets - need cohort shift logs and disposition data, fetched
 * only when a consumer has them. Loaded-flags gate each set to [] so a badge
 * never briefly over-counts (e.g. "Not Logged Recently" flagging everyone
 * before logs arrive).
 *
 * Retired here (approved shift-log semantics): the old act13 "Shift Log
 * Needs Review" task. Plain submitted logs are informational activity, not
 * required actions; they render in Rotation Activity only.
 */
export function deriveLazyAttention({
  students = [], shiftLogs = [], shiftLogsLoaded = false,
  dispositionFollowups = [], activeDispositionIds = [], dispositionLoaded = false,
  canEdit = false, now = new Date(),
}) {
  const cutoffIso = new Date(now.getTime() - NOT_LOGGED_WINDOW_DAYS * 24 * 3600 * 1000).toISOString()

  const notLoggedRecently = !shiftLogsLoaded ? [] : students
    .filter(s => {
      if (s.status !== 'Active Rotation') return false
      return !shiftLogs.find(l => l.student_id === s.id && l.submitted_at >= cutoffIso)
    })
    .map(s => {
      const lastLog = shiftLogs
        .filter(l => l.student_id === s.id)
        .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''))[0]
      const daysSince = lastLog
        ? Math.floor((now.getTime() - new Date(lastLog.submitted_at).getTime()) / (24 * 3600 * 1000))
        : null
      return { ...s, daysSince }
    })

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
    notLoggedRecently,
    dispositionFollowup,
    count: notLoggedRecently.length + dispositionFollowup.length,
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
