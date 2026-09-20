// src/lib/evaluation/reviewQueueAdapters.js
//
// REVIEW-RELEASE-1: one adapter per workflow, from that workflow's own classifier output
// to the shared queue shape (reviewQueueShape.js). Pure: every input is already loaded,
// nothing here reads or writes, and the classifiers are called exactly as the old panels
// called them. This is the "smallest unification that leaves each workflow's eligibility
// rule where it is" that the brief asked for: the rule stays in the detector, the SHAPE
// is decided here, and the queue never sees a detector.
//
// Each adapter returns { items, sent } where `items` are the three-state rows and `sent`
// are the sent-log lines for this workflow (newest first, uncapped; the queue keeps 5).
//
// THE CHAIN IS THE TRUTH THE SERVER WILL ENFORCE. Where an endpoint re-checks something
// before it sends (the post-rotation Casey-Fink needs Student Feedback submitted; the
// ASPIRE feedback needs Casey-Fink submitted AND the required activities recorded), that
// same thing is the Before node here, so the card never promises a release the server
// will refuse. Two of those checks are server facts this brief did not change and could
// not have: they are listed in the handoff.

import { classifyCohort, AUTO_PERIODS, PERIOD_LABELS } from './preceptorDueDetection.js'
import { classifyStudentEvalCohort } from './studentEvalDueDetection.js'
import { classifyCaseyFinkPostRotationCohort } from './caseyFinkPostRotationDueDetection.js'
import { classifyCaseyFinkPreRotationCohort } from './caseyFinkPreRotationDueDetection.js'
import { classifyPostRotationCohort } from './postRotationCertDueDetection.js'
import { caseyFinkPrerequisite, aspirePrerequisites, slugOf, STEP_SLUGS } from './postRotationSequence.js'
import { REMINDER_DAY_OFFSETS, RESPONSE_WINDOW_DAYS } from './reminderSchedule.js'
import { availableActions, rowIsReadOnly, isEligibleNow } from '../unitEvaluationReleaseActions.js'
import {
  node, stamp, blockedTone, daysBetween, shortDate, submissionLabel,
} from './reviewQueueShape.js'

const DAY_MS = 24 * 60 * 60 * 1000

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * When the NEXT scheduled reminder for a live assignment is due, from the ledger's own
 * rule (7, 14, 21 days after the original send, inside a 28-day window). The Owner chose
 * not to add a manual Remind yet, so a waiting card says when the system will nudge.
 * Returns an ISO string, or null when no reminder remains.
 */
export function nextReminderAt(assignment, nowMs = Date.now()) {
  const sentAt = assignment?.sent_at ? new Date(assignment.sent_at).getTime() : NaN
  if (!Number.isFinite(sentAt)) return null
  if (nowMs - sentAt >= RESPONSE_WINDOW_DAYS * DAY_MS) return null
  for (const days of REMINDER_DAY_OFFSETS) {
    const at = sentAt + days * DAY_MS
    if (at > nowMs) return new Date(at).toISOString()
  }
  return null
}

/** The Before node for a prerequisite that was SENT but not submitted. */
function waitingNode(label, sentAssignment, nowMs) {
  const sentOn = shortDate(sentAssignment?.sent_at, nowMs)
  return node('before', 'waiting', label, sentOn ? `Sent ${sentOn} · not submitted` : 'Sent · not submitted')
}

/** A "waiting" blocker's text, naming the reminder the system will send. */
function waitingBlocker(who, what, sentAssignment, nowMs) {
  const days = daysBetween(sentAssignment?.sent_at, nowMs)
  const next = nextReminderAt(sentAssignment, nowMs)
  const nextText = next ? `Next reminder ${shortDate(next, nowMs)}.` : 'No reminders remain.'
  const held = days === 0
    ? `${who} received the ${what} today.`
    : `${who} has had the ${what} for ${days} day${days === 1 ? '' : 's'}.`
  return `${held} ${nextText}`
}

/** The stamp on a waiting card: how long the prerequisite has been out. */
function waitingStamp(sentIso, nowMs) {
  const days = daysBetween(sentIso, nowMs)
  return days === 0 ? 'Sent today' : `Waiting ${days}d`
}

/** A "no email" fix blocker, for either recipient. */
function noEmailBlocker(whose) {
  return { text: `The ${whose} record has no email address.`, action: 'fix', target: { kind: whose } }
}

function personSub(...parts) {
  return parts.filter(Boolean).join(' · ')
}

/** A sent-log line from an assignment row. */
function sentLine({ assignment, name, step, recipient, nowMs, workflowId }) {
  return {
    id: assignment.id,
    workflowId,
    at: assignment.sent_at,
    who: name,
    step: step || null,
    recipient,
    submission: submissionLabel(assignment.completed_at, nowMs),
    completedAt: assignment.completed_at || null,
  }
}

function firstNameOnly(name = '') {
  const parts = String(name).trim().split(/\s+/)
  return parts[0] || name
}

// ── 1. Casey-Fink Readiness for Practice (Pre-Rotation) ─────────────────────────

export function adaptCaseyFinkPreRotation({ students, assignments, displayName, nowMs }) {
  const workflowId = 'caseyFinkPreRotation'
  const { rows } = classifyCaseyFinkPreRotationCohort({ students, assignments, displayName, nowMs })
  const items = []
  const sent = []

  for (const r of rows) {
    const sub = personSub(r.programType, r.unit ? `${r.aspireStatus}, ${r.unit}` : r.aspireStatus)
    const base = {
      id: `q:${r.studentId}`, workflowId,
      person: { name: r.studentName, sub },
      hours: null,
      studentId: r.studentId,
    }
    const after = node('after', 'next', 'Pairs with', 'Post-Rotation Casey-Fink at 100% hours')

    if (r.status === 'readiness_completed' || r.status === 'readiness_released') {
      sent.push(sentLine({ assignment: r.assignment, name: r.studentName, recipient: `to ${r.studentEmail || 'the student'}`, nowMs, workflowId }))
      continue
    }
    if (r.status === 'not_eligible') {
      items.push({ ...base, state: 'notEligible', stamp: stamp('soon', r.aspireStatus), chain: [], notEligibleDetail: r.aspireStatus })
      continue
    }
    if (r.status === 'eligible_for_review' || r.status === 'readiness_reissue') {
      const reissue = r.status === 'readiness_reissue'
      const thisNode = node('this', 'this', 'Pre-rotation Casey-Fink', reissue ? 'Reissue now' : 'Release now')
      const before = node('before', 'done', 'ASPIRE status', r.aspireStatus, 'interviewed')
      if (!r.sendable) {
        items.push({
          ...base, state: 'blocked',
          stamp: stamp('late', 'No student email'),
          chain: [before, node('before', 'fix', 'Student email', 'None on file'), node('after', 'next', 'Pre-rotation Casey-Fink', 'Waiting on email')],
          blocker: noEmailBlocker('student'),
        })
        continue
      }
      items.push({
        ...base, state: 'ready',
        stamp: stamp('ok', r.aspireStatus),
        chain: [before, thisNode, after],
        sendTo: r.studentEmail,
        release: { reissue, warnings: r.warnings },
      })
      continue
    }
    // readiness_attention: an existing assignment in a state the classifier will not act on.
    items.push({
      ...base, state: 'blocked',
      stamp: stamp('late', 'Needs review'),
      chain: [node('before', 'fix', 'Existing survey', r.warnings[0] || 'Needs support review'), node('this', 'next', 'Pre-rotation Casey-Fink', 'Waits on review'), after],
      blocker: { text: r.warnings[0] || 'The existing survey needs support review.', action: 'fix', target: { kind: 'student' } },
    })
  }
  return { items, sent }
}

// ── 2. Preceptor's Assessment of Student Readiness ───────────────────────────────

export function adaptPreceptor({ students, preceptors, assignments, displayName, nowMs }) {
  const workflowId = 'preceptor'
  const { rows } = classifyCohort({ students, preceptors, assignments, nowMs })
  const nameOf = typeof displayName === 'function' ? displayName : null
  const studentById = new Map(students.map(s => [s.id, s]))
  const items = []
  const sent = []

  // The classifier emits one row per (student, period). The Sent log reads the
  // assignments directly so a completed or in-flight period is listed with its dates.
  for (const a of assignments) {
    if (!a.sent_at) continue
    const s = studentById.get(a.student_id)
    const name = (nameOf && s) ? nameOf(s) : (rows.find(r => r.studentId === a.student_id)?.studentName || 'Student')
    const period = a.timepoint === 'midpoint' ? 'midpoint' : a.timepoint === 'post_rotation' ? 'end_of_rotation' : 'other_interim'
    sent.push(sentLine({
      assignment: a, name, step: PERIOD_LABELS[period], nowMs, workflowId,
      recipient: `to ${a.respondent_name || a.respondent_email || 'the preceptor'}`,
    }))
  }

  const seenStudent = new Set()
  for (const r of rows) {
    if (!r.period || !AUTO_PERIODS.includes(r.period)) continue
    if (r.classification === 'suppressed_existing') continue // on the Sent log, or superseded
    // One row per student. The classifier emits a row per period, midpoint first; the earlier
    // period is the gate, and a midpoint card already says what the end of rotation unlocks.
    if (seenStudent.has(r.studentId)) continue
    seenStudent.add(r.studentId)
    const s = studentById.get(r.studentId)
    const name = (nameOf && s) ? nameOf(s) : r.studentName
    const periodLabel = PERIOD_LABELS[r.period]
    const threshold = r.period === 'midpoint' ? r.midpointThreshold : r.endThreshold
    const base = {
      id: `q:${r.studentId}:${r.period}`, workflowId, period: r.period,
      person: { name, sub: personSub(periodLabel, r.preceptorName ? `preceptor ${r.preceptorName}` : 'no preceptor on file') },
      hours: { approved: r.approvedHours, required: r.hoursRequired, threshold },
      studentId: r.studentId,
    }
    const isMid = r.period === 'midpoint'
    const before = isMid
      ? node('before', 'done', 'Hours', `${r.approvedHours} of ${r.hoursRequired}`, '50% reached')
      : node('before', 'done', 'Hours', `${r.approvedHours} of ${r.hoursRequired}`, '100% reached')
    const thisLabel = isMid ? 'Midpoint assessment' : 'End of Rotation assessment'
    const after = isMid
      ? node('after', 'next', 'Unlocks', `End of Rotation at ${r.hoursRequired} h`)
      : node('after', 'next', 'Unlocks', 'Certificate of Appreciation')

    if (r.classification === 'not_due') {
      items.push({ ...base, state: 'notEligible', stamp: stamp('soon', 'Below threshold'), chain: [], nextGate: `${periodLabel} at ${Number.isInteger(threshold) ? threshold : Math.round(threshold * 10) / 10} h` })
      continue
    }
    if (r.classification === 'ineligible_hours') {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'Hours not set'),
        chain: [node('before', 'fix', 'Required hours', 'Not set'), node('this', 'next', thisLabel, 'Cannot evaluate'), after],
        blocker: { text: 'Required hours are not set on the student record.', action: 'fix', target: { kind: 'student' } },
      })
      continue
    }
    if (r.classification === 'due_unsendable') {
      const noPreceptor = /no preceptor/i.test(r.reason)
      const inactive = /inactive/i.test(r.reason)
      items.push({
        ...base, state: 'blocked',
        stamp: stamp('late', noPreceptor ? 'No preceptor' : inactive ? 'Preceptor inactive' : 'Email missing'),
        chain: [
          before,
          node('before', 'fix', noPreceptor ? 'Preceptor' : inactive ? 'Preceptor' : 'Preceptor email',
            noPreceptor ? 'Not assigned' : inactive ? 'Inactive' : 'None on file'),
          node('this', 'next', thisLabel, noPreceptor ? 'Cannot resolve preceptor' : 'Waiting on email'),
        ],
        blocker: {
          text: noPreceptor ? 'No preceptor on file, so there is no one to send to.' : inactive ? 'The preceptor on file is inactive.' : 'The preceptor record has no email address.',
          action: 'fix',
          target: { kind: noPreceptor ? 'student' : 'preceptor' },
        },
      })
      continue
    }
    // due_sendable
    items.push({
      ...base, state: 'ready',
      stamp: stamp('ok', 'Threshold met'),
      chain: [before, node('this', 'this', thisLabel, 'Release now'), after],
      sendTo: r.preceptorName || r.preceptorEmail,
      release: { period: r.period, preceptorEmail: r.preceptorEmail, preceptorName: r.preceptorName },
    })
  }
  return { items, sent }
}

// ── 3. Student's Feedback on Unit and Preceptor ──────────────────────────────────

export function adaptStudentFeedback({ students, preceptors, assignments, displayName, nowMs }) {
  const workflowId = 'student'
  const { rows } = classifyStudentEvalCohort({ students, preceptors, assignments, nowMs })
  const nameOf = typeof displayName === 'function' ? displayName : null
  const studentById = new Map(students.map(s => [s.id, s]))
  const items = []
  const sent = []

  for (const r of rows) {
    const s = studentById.get(r.studentId)
    const name = (nameOf && s) ? nameOf(s) : r.studentName
    const target = r.evaluatedTarget || {}
    const base = {
      id: `q:${r.studentId}`, workflowId,
      person: { name, sub: personSub(r.programType, target.unit) },
      hours: { approved: r.approvedHours, required: r.hoursRequired, threshold: r.hoursRequired },
      studentId: r.studentId,
    }
    const after = node('after', 'next', 'Unlocks', 'Casey-Fink · Unit leader release')

    if (r.classification === 'suppressed_existing') {
      const a = assignments.find(x => x.id === r.suppressing?.assignmentId)
      if (a?.sent_at) sent.push(sentLine({ assignment: a, name, recipient: `to ${r.studentEmail || 'the student'}`, nowMs, workflowId }))
      continue
    }
    if (r.classification === 'not_due') {
      items.push({ ...base, state: 'notEligible', stamp: stamp('soon', 'Below threshold'), chain: [] })
      continue
    }
    if (r.classification === 'ineligible_hours') {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'Hours not set'),
        chain: [node('before', 'fix', 'Required hours', 'Not set'), node('this', 'next', 'Student feedback', 'Cannot evaluate'), after],
        blocker: { text: 'Required hours are not set on the student record.', action: 'fix', target: { kind: 'student' } },
      })
      continue
    }
    const before = node('before', 'done', 'Hours', `${r.approvedHours} of ${r.hoursRequired}`, '100%')
    if (r.classification === 'due_unsendable') {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'No student email'),
        chain: [before, node('before', 'fix', 'Student email', 'None on file'), node('this', 'next', 'Student feedback', 'Waiting on email')],
        blocker: noEmailBlocker('student'),
      })
      continue
    }
    items.push({
      ...base, state: 'ready',
      stamp: stamp('ok', 'Hours complete'),
      chain: [before, node('this', 'this', 'Student feedback', 'Release now'), after],
      sendTo: r.studentEmail,
      release: {},
    })
  }
  return { items, sent }
}

// ── 4. Casey-Fink Readiness for Practice (Post-Rotation) ─────────────────────────

export function adaptCaseyFinkPostRotation({
  students, assignments, allAssignmentsByStudent, certificates, shiftMeta, displayName, nowMs,
}) {
  const workflowId = 'caseyFinkPostRotation'
  const { rows } = classifyCaseyFinkPostRotationCohort({ students, assignments, certificates, shiftMeta, displayName, nowMs })
  const items = []
  const sent = []

  for (const r of rows) {
    const all = allAssignmentsByStudent.get(r.studentId) || []
    const prereq = caseyFinkPrerequisite(all)
    const feedbackAsg = all.find(a => slugOf(a) === STEP_SLUGS.feedback && a.timepoint === 'post_rotation') || null
    const base = {
      id: `q:${r.studentId}`, workflowId,
      person: { name: r.studentName, sub: personSub(r.programType, r.unit) },
      hours: { approved: r.approvedHours, required: r.hoursRequired, threshold: r.hoursRequired },
      studentId: r.studentId,
    }
    const after = node('after', 'next', 'Unlocks', 'Certificate of Completion')

    if (r.status === 'certificate_unlocked' || r.status === 'readiness_completed' || r.status === 'readiness_released') {
      const a = assignments.find(x => x.student_id === r.studentId && x.sent_at)
      if (a) sent.push(sentLine({ assignment: a, name: r.studentName, recipient: `to ${r.studentEmail || 'the student'}`, nowMs, workflowId }))
      continue
    }
    if (r.status === 'not_eligible' || r.status === 'not_eligible_hours') {
      items.push({ ...base, state: 'notEligible', stamp: stamp('soon', r.status === 'not_eligible_hours' ? 'Hours not set' : 'Below threshold'), chain: [] })
      continue
    }
    if (r.status === 'readiness_attention') {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'Needs review'),
        chain: [node('before', 'fix', 'Existing survey', 'Needs support review'), node('this', 'next', 'Casey-Fink', 'Waits on review'), after],
        blocker: { text: 'The existing Casey-Fink assignment needs support review.', action: 'fix', target: { kind: 'student' } },
      })
      continue
    }
    // eligible_for_review | readiness_reissue
    const reissue = r.status === 'readiness_reissue'
    if (!prereq.ok) {
      if (prereq.code === 'feedback_missing') {
        items.push({
          ...base, state: 'blocked', stamp: stamp('soon', 'Step behind'),
          chain: [node('before', 'waiting', 'Student feedback', 'Not released yet'), node('this', 'next', 'Casey-Fink', 'Waits on feedback'), after],
          blocker: { text: 'The prerequisite is sitting in the Student Feedback stack.', action: 'jump',
            target: { workflowId: 'student', itemId: `q:${r.studentId}`, label: `Release ${firstNameOnly(r.studentName)}'s Student Feedback first` } },
        })
      } else {
        const tone = blockedTone({ sinceIso: feedbackAsg?.sent_at, nowMs })
        items.push({
          ...base, state: 'blocked', stamp: stamp(tone, waitingStamp(feedbackAsg?.sent_at, nowMs)),
          chain: [waitingNode('Student feedback', feedbackAsg, nowMs), node('this', 'next', 'Casey-Fink', 'Waits on feedback'), after],
          blocker: { text: waitingBlocker(firstNameOnly(r.studentName), 'feedback survey', feedbackAsg, nowMs), action: 'remind', target: { assignmentId: feedbackAsg?.id || null } },
        })
      }
      continue
    }
    const before = node('before', 'done', 'Student feedback', `Submitted ${shortDate(prereq.feedback?.completedAt, nowMs)}`)
    if (!r.sendable) {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'No student email'),
        chain: [before, node('before', 'fix', 'Student email', 'None on file'), node('this', 'next', 'Casey-Fink', 'Waiting on email')],
        blocker: noEmailBlocker('student'),
      })
      continue
    }
    items.push({
      ...base, state: 'ready',
      stamp: stamp('ok', 'Prerequisite done'),
      chain: [before, node('this', 'this', 'Casey-Fink', reissue ? 'Reissue now' : 'Release now'), after],
      sendTo: r.studentEmail,
      release: { reissue, warnings: r.warnings },
    })
  }
  return { items, sent }
}

// ── 5. Student's Feedback on ASPIRE ──────────────────────────────────────────────

export function adaptAspireFeedback({
  students, assignments, allAssignmentsByStudent, activityByStudent, ledgerDown, shiftMeta, displayName, nowMs,
  supportByStudent = new Map(), supportDown = false,
}) {
  const workflowId = 'postRotation'
  const { rows } = classifyPostRotationCohort({ students, assignments, shiftMeta, displayName, nowMs })
  const items = []
  const sent = []

  for (const r of rows) {
    const all = allAssignmentsByStudent.get(r.studentId) || []
    const pre = aspirePrerequisites(all, activityByStudent.get(r.studentId) || [], undefined, supportByStudent.get(r.studentId) || [])
    const prereq = ledgerDown ? { ...pre, ok: false, ledgerUnavailable: true } : pre
    const caseyAsg = all.find(a => slugOf(a) === STEP_SLUGS.caseyFink && a.timepoint === 'post_rotation') || null
    const base = {
      id: `q:${r.studentId}`, workflowId,
      person: { name: r.studentName, sub: personSub(r.programType, r.unit) },
      hours: { approved: r.approvedHours, required: r.hoursRequired, threshold: r.hoursRequired },
      studentId: r.studentId,
      activities: prereq.activities || [],
      supportDown,
    }
    const after = node('after', 'next', 'Then', 'Chain complete')

    if (r.status === 'evaluation_completed' || r.status === 'evaluation_released') {
      const a = assignments.find(x => x.student_id === r.studentId && x.sent_at)
      if (a) sent.push(sentLine({ assignment: a, name: r.studentName, recipient: `to ${r.studentEmail || 'the student'}`, nowMs, workflowId }))
      continue
    }
    // eligible_for_review (the classifier lists only eligible + in-flow rows)
    if (!prereq.ok) {
      const unmet = prereq.unmet || []
      const first = unmet[0]
      if (prereq.ledgerUnavailable) {
        items.push({
          ...base, state: 'blocked', stamp: stamp('late', 'Activities unverifiable'),
          chain: [node('before', 'fix', 'Required activities', 'Tracking not switched on'), node('this', 'next', 'ASPIRE feedback', 'Waits on activities'), after],
          blocker: { text: 'Required-activity tracking is not switched on yet, so activity prerequisites cannot be verified.', action: 'fix', target: { kind: 'student' } },
        })
        continue
      }
      if (first?.code === 'feedback_missing' || first?.code === 'feedback_incomplete') {
        // Feedback comes first in the sequence; point at it rather than at Casey-Fink.
        const feedbackAsg = all.find(a => slugOf(a) === STEP_SLUGS.feedback && a.timepoint === 'post_rotation') || null
        if (first.code === 'feedback_missing') {
          items.push({
            ...base, state: 'blocked', stamp: stamp('soon', 'Step behind'),
            chain: [node('before', 'waiting', 'Student feedback', 'Not released yet'), node('this', 'next', 'ASPIRE feedback', 'Waits on feedback'), after],
            blocker: { text: 'Student Feedback has not been released yet; it comes before Casey-Fink.', action: 'jump',
              target: { workflowId: 'student', itemId: `q:${r.studentId}`, label: `Release ${firstNameOnly(r.studentName)}'s Student Feedback first` } },
          })
        } else {
          const tone = blockedTone({ sinceIso: feedbackAsg?.sent_at, nowMs })
          items.push({
            ...base, state: 'blocked', stamp: stamp(tone, waitingStamp(feedbackAsg?.sent_at, nowMs)),
            chain: [waitingNode('Student feedback', feedbackAsg, nowMs), node('this', 'next', 'ASPIRE feedback', 'Waits on feedback'), after],
            blocker: { text: waitingBlocker(firstNameOnly(r.studentName), 'feedback survey', feedbackAsg, nowMs), action: 'remind', target: { assignmentId: feedbackAsg?.id || null } },
          })
        }
        continue
      }
      if (first?.code === 'casey_fink_missing') {
        items.push({
          ...base, state: 'blocked', stamp: stamp('soon', 'Step behind'),
          chain: [node('before', 'done', 'Student feedback', `Submitted ${shortDate(prereq.feedback?.completedAt, nowMs)}`), node('before', 'waiting', 'Casey-Fink', 'Not released yet'), node('this', 'next', 'ASPIRE feedback', 'Waits on Casey-Fink')],
          blocker: { text: 'Casey-Fink is ready to release on its own clipboard.', action: 'jump',
            target: { workflowId: 'caseyFinkPostRotation', itemId: `q:${r.studentId}`, label: `Release ${firstNameOnly(r.studentName)}'s Casey-Fink first` } },
        })
        continue
      }
      if (first?.code === 'casey_fink_incomplete') {
        const tone = blockedTone({ sinceIso: caseyAsg?.sent_at, nowMs })
        items.push({
          ...base, state: 'blocked', stamp: stamp(tone, waitingStamp(caseyAsg?.sent_at, nowMs)),
          chain: [waitingNode('Casey-Fink', caseyAsg, nowMs), node('this', 'next', 'ASPIRE feedback', 'Waits on Casey-Fink'), after],
          blocker: { text: waitingBlocker(firstNameOnly(r.studentName), 'Casey-Fink survey', caseyAsg, nowMs), action: 'remind', target: { assignmentId: caseyAsg?.id || null } },
        })
        continue
      }
      // Only activities remain. The record button lives on the card.
      const missing = unmet.filter(u => u.code === 'activity_incomplete')
      const done = (prereq.activities || []).filter(a => a.completed).length
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', `${missing.length} activit${missing.length === 1 ? 'y' : 'ies'} to record`),
        chain: [
          node('before', 'done', 'Casey-Fink', `Submitted ${shortDate(prereq.caseyFink?.completedAt, nowMs)}`),
          node('before', 'fix', 'Required activities', `${done} of ${(prereq.activities || []).length} recorded`),
          node('this', 'next', 'ASPIRE feedback', 'Waits on activities'),
        ],
        blocker: { text: `${missing.map(u => u.label).join(', ')} not recorded for this student.`, action: 'activity', target: { studentId: r.studentId } },
      })
      continue
    }
    const before = node('before', 'done', 'Casey-Fink', `Submitted ${shortDate(prereq.caseyFink?.completedAt, nowMs)}`)
    if (!r.studentEmail) {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'No student email'),
        chain: [before, node('before', 'fix', 'Student email', 'None on file'), node('this', 'next', 'ASPIRE feedback', 'Waiting on email')],
        blocker: noEmailBlocker('student'),
      })
      continue
    }
    items.push({
      ...base, state: 'ready',
      stamp: stamp('ok', 'Prerequisite done'),
      chain: [before, node('this', 'this', 'ASPIRE feedback', 'Release now'), after],
      sendTo: r.studentEmail,
      release: { warnings: r.warnings },
    })
  }
  // The classifier lists only eligible and in-flow students. The Not-yet rows are built
  // here from its own rule (below the required hours, or hours not set), so this stack
  // shows the same three states as the other four.
  const listed = new Set(rows.map(r => r.studentId))
  const nameOf = typeof displayName === 'function' ? displayName : (st) => `${st.first_name || ''} ${st.last_name || ''}`.trim()
  for (const st of students) {
    if (listed.has(st.id)) continue
    const approved = Number(st.approved_hours) || 0
    const required = Number(st.hours_required) || 0
    items.push({
      id: `q:${st.id}`, workflowId, state: 'notEligible', chain: [], studentId: st.id,
      person: { name: nameOf(st), sub: personSub(st.program_type, (st.matched_unit_name || '').trim()) },
      hours: { approved, required, threshold: required },
      stamp: stamp('soon', required > 0 ? 'Below threshold' : 'Hours not set'),
    })
  }

  return { items, sent }
}

// ── 6. Release Student's Feedback on Unit and Preceptor to Unit Leaders ──────────

/**
 * The Unit Leader release is not a survey send. Each row is one SUBMITTED response and the
 * lifecycle that puts its quantitative results in front of the unit's leader: moderation,
 * then release, seven days after the rotation ends. There is no email and no named
 * recipient; a unit leader sees it in their portal. The chain says exactly that.
 */
export function adaptUnitLeaderRelease({ rows, nowMs }) {
  const workflowId = 'unitLeaderRelease'
  const items = []
  const sent = []

  for (const r of rows || []) {
    const sub = [r.unit_key ? `Feedback on ${r.unit_key}` : 'Feedback', r.evaluated_preceptor ? `preceptor ${r.evaluated_preceptor}` : null].filter(Boolean).join(' · ')
    const base = {
      id: `r:${r.response_id}`, workflowId,
      person: { name: r.student_name || 'Student', sub },
      hours: null,
      responseId: r.response_id,
      row: r,
    }
    const before = node('before', 'done', 'Student feedback', r.rotation_end ? `Rotation ended ${shortDate(r.rotation_end, nowMs)}` : 'Submitted')
    const thisLabel = r.unit_key ? `Release to ${r.unit_key} leader` : 'Release to unit leader'
    const after = node('after', 'next', 'Then', 'Chain complete')
    const actions = availableActions(r, nowMs)

    if (r.release_state === 'released') {
      sent.push({
        id: r.response_id, workflowId, at: r.released_at, who: r.student_name || 'Student',
        step: r.unit_key || null, recipient: `to ${r.unit_key || 'unit'} leader`, submission: 'released', completedAt: r.released_at,
      })
      continue
    }
    if (rowIsReadOnly(r)) {
      const why = r.release_state === 'ineligible' ? 'Ineligible for release'
        : !r.evaluated_preceptor ? 'No preceptor on the response'
        : !r.eligible_at ? 'No eligibility date' : 'Legacy response'
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', why),
        chain: [node('before', 'fix', 'Response', why), node('this', 'next', thisLabel, 'Cannot release'), after],
        blocker: { text: `${why}. This response cannot be released.`, action: 'fix', target: { kind: 'response' } },
      })
      continue
    }
    if (!isEligibleNow(r, nowMs)) {
      items.push({ ...base, state: 'notEligible', stamp: stamp('soon', `Eligible ${shortDate(r.eligible_at, nowMs)}`), chain: [], notEligibleDetail: `eligible ${shortDate(r.eligible_at, nowMs)}` })
      continue
    }
    if (r.moderation_state === 'blocked') {
      items.push({
        ...base, state: 'blocked', stamp: stamp('late', 'Moderation blocked'),
        chain: [before, node('before', 'fix', 'Moderation', 'Blocked'), node('this', 'next', thisLabel, 'Held')],
        blocker: { text: 'This response was blocked in moderation. Clear it to release.', action: 'moderate', target: { responseId: r.response_id, actions } },
      })
      continue
    }
    if (r.moderation_state !== 'cleared') {
      items.push({
        ...base, state: 'blocked', stamp: stamp(blockedTone({ sinceIso: r.eligible_at, nowMs }), 'Not moderated'),
        chain: [before, node('before', 'fix', 'Moderation', 'Not yet reviewed'), node('this', 'next', thisLabel, 'Waits on moderation')],
        blocker: { text: 'Review the response and clear moderation before releasing.', action: 'moderate', target: { responseId: r.response_id, actions } },
      })
      continue
    }
    if (r.release_state === 'revoked') {
      items.push({
        ...base, state: 'ready', stamp: stamp('ok', 'Revoked · re-release'),
        chain: [before, node('this', 'this', thisLabel, 'Re-release now'), after],
        sendTo: r.unit_key ? `${r.unit_key} leader` : 'unit leader',
        release: { action: 'rerelease', actions },
      })
      continue
    }
    items.push({
      ...base, state: 'ready', stamp: stamp('ok', 'Cleared'),
      chain: [before, node('this', 'this', thisLabel, 'Release now'), after],
      sendTo: r.unit_key ? `${r.unit_key} leader` : 'unit leader',
      release: { action: 'release', actions },
    })
  }
  return { items, sent }
}
