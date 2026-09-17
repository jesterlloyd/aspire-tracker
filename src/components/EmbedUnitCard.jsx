import { useState, useCallback, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import Tooltip from './ui/Tooltip'
import { displayName } from '../lib/utils'
import {
  buildUnitLeaderPlacementMessage, normalizeEmailForLookup, escapeLikePattern,
} from '../lib/emailUtils'
import { openMailtoLink } from '../lib/openLink'
import { supabase } from '../lib/supabase'
import {
  buildPlacementFacts, missingSummary, resolveUnitLeaderGreetingName, toNoticeStudent,
  studentNaturalName,
} from '../lib/placementCommunication'
import { writeLaunchContext, LAUNCH_KINDS } from '../lib/connect/launchContext'
import { resolveRequiredAttachments } from '../lib/connect/catalogAttachments'
import { Mail } from 'lucide-react'
import { BADGE_COUNT_BG, BADGE_COUNT_FG } from '../lib/badgeTokens'
import StudentAvatar from './StudentAvatar'
import { getUnit } from '../lib/unitCatalog'
import PreceptorAssignmentModal from './PreceptorAssignmentModal'
import { MATCH_RANK_CONFIG, matchRankOf } from '../lib/placementDisplay'
import { pinFor, RANK_TONE } from '../lib/placementBoardView'
import NotificationControl from './placement/NotificationControl'
import { NOTIFICATION_TARGETS, notificationStateFor } from '../lib/placementNotificationState'
import { planUnmatch } from '../lib/unmatchPlan'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'

// PLACEMENT-BOARD-FELT-1 (2026-09-17): a unit is a board. Stitched navy leather
// on top (name, chips, capacity, unit-leader status), blue felt below, where
// each placement is a white paper note held by a push pin. Pulling the pin is
// the unmatch control; it only ever OPENS the confirmation dialog below.
// Visual rules live in src/components/placement/placementBoard.css.

// ASPIRE-CHART honest match rank: display comes from the STORED match_quality
// (lib/placementDisplay), never re-derived from unit names - renaming a unit
// must not rewrite placement history, and absent data says so explicitly.

const resolveMatchedStudent = (match, studentMap) => {
  if (match?.student?.first_name) return match.student
  if (match?.student_id && studentMap?.[match.student_id]) return studentMap[match.student_id]
  return null
}

// ── Pinned note ───────────────────────────────────────────────────────────────
//
// One placement. The pin shows the STORED rank (1, 2, 3, or a dot for other and
// not recorded) and is a real button. The note's two action rows share ONE
// two-column grid, so the preceptor and unit-leader controls always sit on one
// vertical line, whatever width the names beside them render at.

function PinnedNote({
  student, match, unit, onUnmatch, onNotify, onAssignPreceptor, placement, onEmailPreceptor,
  unitLeaderNotifyState, preceptorNotifyState, unitLeaderName, canCorrect,
  onConfirmNotified, onCorrectNotified,
  tilt, isPulling, isPinningIn, canDrag, onDragStart, onDragEnd,
}) {
  const qCfg       = MATCH_RANK_CONFIG[matchRankOf(student, match)]
  const pin        = pinFor(student, match)
  const name       = getStudentPreferredFullName(student)
  // PLACEMENT-COMMUNICATION-HANDOFF-1: presence comes ONLY from the PLACEMENT's
  // resolved preceptor (this student, in THIS unit). The student-level fields are
  // deliberately not consulted here: for a multi-unit student they name whoever
  // was assigned on a DIFFERENT unit, so reading them would show - and offer to
  // email - the wrong person about this rotation. A placement that names nobody
  // shows the existing Assign preceptor action and no envelope.
  const preceptorName = placement?.preceptorName || ''
  const preceptorEmail = placement?.preceptorEmail || ''
  const hasPreceptor = !!preceptorName

  const wrapClass = [
    'pb-pinned',
    tilt === 'b' ? 'pb-tilt-b' : 'pb-tilt-a',
    isPulling ? 'pb-pull' : '',
    isPinningIn ? 'pb-pin-in' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={wrapClass}>
      <span className="pb-pin-anchor">
        <Tooltip label="Pull pin" placement="top">
          <button
            type="button"
            data-testid="pull-pin"
            className={`material-pin material-rank-${pin.tone} pb-pin`}
            aria-label={`Pull pin: unmatch ${name} from ${unit.unit_name}`}
            onClick={e => { e.stopPropagation(); onUnmatch(student) }}
          >
            <span aria-hidden="true">{pin.glyph}</span>
          </button>
        </Tooltip>
      </span>

      <div
        className="paper-note pb-note pb-pinned-note"
        data-testid="placement-row"
        data-match-id={match?.id || ''}
        data-pb-note=""
        draggable={!!canDrag}
        onDragStart={canDrag ? (e => onDragStart?.(e, student, match)) : undefined}
        onDragEnd={canDrag ? onDragEnd : undefined}
      >
        <div className="pb-note-id">
          <StudentAvatar student={student} size={40} />
          <div className="pb-note-id-text">
            <div className="pb-note-name">{name}</div>
            {student.school && <div className="pb-note-school material-soft">{student.school}</div>}
          </div>
        </div>

        <div className="pb-note-chips">
          {student.shift_assigned && (
            <span className="pb-chip">
              {student.shift_assigned === 'Day'       ? '☀ Day'
              : student.shift_assigned === 'Night'    ? '☾ Night'
              : student.shift_assigned === 'Mid'      ? '◐ Mid'
              : student.shift_assigned === 'Variable' ? '☀ / ☾ Variable'
              : student.shift_assigned}
            </span>
          )}
          <span
            className="pb-chip pb-rank-chip"
            data-testid="placement-rank-chip"
            style={{ background: qCfg.bg, color: qCfg.color, borderColor: qCfg.border }}
          >
            {qCfg.label}
          </span>
        </div>

        <div className="pb-note-rows">
          {/* ── Preceptor line ── */}
          <div className="pb-note-row-label">
            {!hasPreceptor && onAssignPreceptor ? (
              <button
                type="button"
                className="pb-link"
                onClick={e => { e.stopPropagation(); onAssignPreceptor(student) }}
              >
                + Assign preceptor
              </button>
            ) : !hasPreceptor ? (
              <span className="pb-warn">
                {'⚠'} Preceptor needed
              </span>
            ) : (
              /* PRECEPTOR-ASSIGNMENT-PROJECTION-1: matched_preceptor is the
                 trigger-maintained projection of the canonical preceptors row, so
                 the name is available without the board loading the roster.
                 Clicking re-opens the same assignment modal to change it. */
              <button
                type="button"
                data-testid="placement-preceptor-name"
                className="pb-link pb-preceptor"
                onClick={e => { e.stopPropagation(); onAssignPreceptor?.(student) }}
                disabled={!onAssignPreceptor}
                title={onAssignPreceptor ? 'Change preceptor' : undefined}
              >
                {'\u{1F464}'} {preceptorName}
              </button>
            )}
          </div>
          <div className="pb-note-row-action">
            {hasPreceptor && onEmailPreceptor ? (
              /* PLACEMENT-NOTIFICATION-CONTROL-1: one shared control, identical to
                 the unit-leader line's. The envelope opens the ASPIRE Connect
                 handoff and writes nothing; the check is the only path to notified
                 state, and it always asks first. */
              <NotificationControl
                target={NOTIFICATION_TARGETS.PRECEPTOR}
                state={preceptorNotifyState}
                personName={preceptorName}
                studentName={studentNaturalName(student)}
                unitName={unit.unit_name}
                disabledReason={preceptorEmail ? '' : `No email address on file for ${preceptorName || 'this preceptor'}. Add one in Rotation → Preceptors first.`}
                onOpenDraft={() => onEmailPreceptor(student, match, placement)}
                onConfirm={() => onConfirmNotified?.({
                  target: NOTIFICATION_TARGETS.PRECEPTOR, student, match, placement,
                })}
                onCorrect={canCorrect ? (reason) => onCorrectNotified?.({
                  target: NOTIFICATION_TARGETS.PRECEPTOR, student, match, placement, reason,
                }) : null}
              />
            ) : <span aria-hidden="true" />}
          </div>

          {/* ── Unit-leader line: was this unit's leader told about THIS student ── */}
          <div className="pb-note-row-label material-soft">Unit Leader</div>
          <div className="pb-note-row-action">
            <NotificationControl
              target={NOTIFICATION_TARGETS.UNIT_LEADER}
              state={unitLeaderNotifyState}
              personName={unitLeaderName}
              studentName={studentNaturalName(student)}
              unitName={unit.unit_name}
              onOpenDraft={() => onNotify(student, match)}
              onConfirm={() => onConfirmNotified?.({
                target: NOTIFICATION_TARGETS.UNIT_LEADER, student, match, placement,
              })}
              onCorrect={canCorrect ? (reason) => onCorrectNotified?.({
                target: NOTIFICATION_TARGETS.UNIT_LEADER, student, match, placement, reason,
              }) : null}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Open slot ─────────────────────────────────────────────────────────────────
//
// Not a button: the whole board is the placement target (click, Enter, or drop).

function OpenSlot() {
  return <div className="pb-open-slot" aria-hidden="true">Open slot</div>
}

// ── Main card ─────────────────────────────────────────────────────────────────

export default function EmbedUnitCard({
  unit, matchedStudents, matches, studentMap, selectedStudent,
  onUnmatch, isHighlighted,
  isFocusedUnit, onPreceptorAssigned,
  // PLACEMENT-BOARD-FELT-1: the board surface. All optional, so the card still
  // renders without them. onActivate is a click or Enter on the board (place the
  // selected student, or focus the unit); highlightRank ribbons the selected
  // student's 1st/2nd/3rd choice; the drag handlers belong to MatchingTab, which
  // owns what is being dragged.
  onActivate = null, highlightRank = null, isDimmed = false, isDropTarget = false,
  canDrag = false, onNoteDragStart = null, onNoteDragEnd = null,
  onBoardDragOver = null, onBoardDragLeave = null, onBoardDrop = null,
  pullingMatchId = null, pinningStudentIds = null,
  // A pinned note dragged back to the Student Pool asks THIS card to open its
  // unmatch dialog, the same one the pin opens. { studentId, unitId }
  pullRequest = null, onPullRequestConsumed = null,
  // PLACEMENT-COMMUNICATION-HANDOFF-1 canonical inputs. All optional: without
  // them the card still renders, the notice simply reports the values it could
  // not resolve instead of inventing them.
  rotationRows = [], preceptorsById = null, unitLeaders = [],
  cohortId = null, cohortName = '',
  // PLACEMENT-NOTIFICATION-CONTROL-1: the shared confirmation ledger index and
  // the two writers. Both rows read the same index and call the same handlers.
  // UNIT-POOL-REFINEMENT-1: unit names for the branched unmatch dialog (the
  // successor's name when a primary removal promotes a surviving placement).
  unitNameById = null,
  notificationIndex = null, canCorrectNotifications = false,
  onConfirmNotified = null, onCorrectNotified = null,
  // UNIT-POOL-REFINEMENT-1: the batch writer for the consolidated confirmation.
  // Same endpoint, same semantics as the per-row confirm - just N of them, with
  // an honest {ok, failed} summary instead of a per-call toast.
  onBatchConfirmNotified = null,
}) {
  const navigate = useNavigate()
  const hintId = useId()
  const [pinConfirm,      setPinConfirm]      = useState(null)
  const [toast,           setToast]           = useState(null)
  const [assignStudent,   setAssignStudent]   = useState(null)
  // The unit-leader notice awaiting confirmation, when the placement is missing
  // canonical values. { students, missing, message, onConfirm } - see handleNotify*.
  const [notifyPreview,   setNotifyPreview]   = useState(null)
  // UNIT-POOL-REFINEMENT-1: the consolidated unit-leader flow.
  //   { step: 'review',  rows, missing }  - who WILL be included, before any draft opens
  //   { step: 'confirm', rows, matchIds } - the exact set the opened draft named,
  //                                          frozen at open time so a match created
  //                                          or replaced afterwards can never join
  const [notifyFlow, setNotifyFlow] = useState(null)
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [notifyErrors, setNotifyErrors] = useState(null)
  const [preceptorHandoff, setPreceptorHandoff] = useState(null)  // 'busy' | { error }

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const unitMeta  = getUnit(unit.unit_name)
  const desc      = unitMeta?.description || null

  const filledCount = matchedStudents.length
  const emptyCount  = Math.max(0, unit.total_slots - filledCount)
  const isFull      = emptyCount === 0

  // The student whose unmatch dialog is open: from this board's pin, or from a
  // pinned note dragged back to the Student Pool (PLACEMENT-BOARD-FELT-1). Both
  // open the SAME dialog, plan and copy. Closing it clears whichever opened it.
  const pulledRaw = pullRequest && String(pullRequest.unitId) === String(unit.id)
    ? matchedStudents.find(s => s.id === pullRequest.studentId) || null
    : null
  const pulledStudent = pulledRaw
    ? resolveMatchedStudent(matches.find(m => m.student_id === pulledRaw.id && m.unit_id === unit.id), studentMap) || pulledRaw
    : null
  const confirmUnmatch = pinConfirm || pulledStudent
  const setConfirmUnmatch = (student) => {
    setPinConfirm(student)
    if (!student && pullRequest) onPullRequestConsumed?.()
  }

  // Notification state - derived from the SAME confirmation ledger the rows
  // render, so the count can never disagree with the statuses beside it.
  const unitLeaderConfirmed = (student) => {
    const m = matches.find(mm => mm.student_id === student.id && mm.unit_id === unit.id)
    if (!m) return false
    return notificationStateFor(notificationIndex,
      { target: NOTIFICATION_TARGETS.UNIT_LEADER, matchId: m.id },
      { legacyNotified: !!m.notification_sent }).confirmed
  }
  const notifiedCount = matchedStudents.filter(unitLeaderConfirmed).length
  const allNotified  = filledCount > 0 && notifiedCount === filledCount

  // Build unnotified list for Zone-2 button label
  const unnotifiedStudents = matchedStudents.filter(s => !unitLeaderConfirmed(s))

  // UNIT-POOL-REFINEMENT-1 (group envelope): the consolidated action exists
  // ONLY when it consolidates - two or more unnotified placements. With exactly
  // one, the student row's own envelope and check are the action, and a
  // card-level duplicate would just be a second way to do the same thing. The
  // count is the number of placements the notice will include (the unnotified
  // ones), never the filled-slot total.
  const groupNotifyLabel = `Notify Unit Leader About ${unnotifiedStudents.length} Students`

  // ── Canonical placement facts (PLACEMENT-COMMUNICATION-HANDOFF-1) ─────────
  //
  // One resolved record per (student, THIS unit). Keyed by student id so a row,
  // an email, and the preceptor handoff can never read a different student's
  // values, and so two students on the same unit cannot cross-populate.
  const recipientEmails = String(unit.contact_email || '')
    .split(/[;,]/).map(e => e.trim()).filter(Boolean)
  const leaderGreeting = resolveUnitLeaderGreetingName({ unit, leaders: unitLeaders, recipientEmails })

  const factsFor = useCallback((student) => {
    const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id) || null
    // Every placement this student holds in the cohort. It is the evidence that
    // decides whether a student-level preceptor may stand in for a placement that
    // names nobody - never assumed, always counted.
    const studentMatches = matches.filter(m => m.student_id === student.id)
    return buildPlacementFacts({ student, unit, match, rotationRows, preceptorsById, studentMatches })
  }, [matches, unit, rotationRows, preceptorsById])

  const placementByStudent = {}
  for (const s of matchedStudents) placementByStudent[s.id] = factsFor(s)

  // Open the compose window. THAT IS ALL IT DOES.
  //
  // WHY NOTHING IS WRITTEN HERE. Opening a compose deeplink proves only that a
  // draft was handed to Outlook. It does not prove the draft was sent - the
  // sender may edit it, close it, or abandon it - so recording "unit leader
  // notified" at this moment records something nobody has verified. The unit
  // then reads as informed when it has not been, and every downstream reader
  // (the card's own count, the Action Center task, the attention engine) inherits
  // that false claim. So this function performs ZERO database writes: the notified
  // state is set only by the explicit confirmation below, after a human says the
  // email actually went.
  const openUnitLeaderNotice = (studentRows, { multi }) => {
    const message = buildUnitLeaderPlacementMessage({
      contactEmails:  unit.contact_email || '',
      unitName:       unit.unit_name,
      greetingName:   leaderGreeting.name,
      students:       studentRows.map(r => toNoticeStudent(r.facts)),
      isMultiStudent: multi,
    })
    openMailtoLink(message.url)
    // Nothing else. The check control beside each name is the only path to
    // notified state, and it asks before it records.

    const who = multi
      ? `${unit.unit_name} (${studentRows.length} student${studentRows.length !== 1 ? 's' : ''})`
      : displayName(studentRows[0].student)
    if (!unit.contact_email) {
      showToast(`No contact email on file for ${unit.unit_name}. The draft opened without a recipient, and nothing was recorded.`)
    } else if (message.tooLong) {
      // Honest about a real limit rather than pretending the draft opened whole.
      showToast(`Draft opened for ${who}. It is unusually long (${message.urlLength} characters) - check that Outlook kept all of it. Nothing has been recorded yet.`)
    } else {
      showToast(`Draft opened for ${who}. Use the check beside the name once it has actually been sent.`)
    }
  }

  // A notice is only opened once the Owner has SEEN what is missing. With every
  // canonical value resolved it opens immediately (no extra click); with a gap it
  // names each one first.
  const reviewThenNotify = (studentRows, { multi }) => {
    const missing = []
    const seen = new Set()
    for (const r of studentRows) {
      for (const m of r.facts.missing) {
        const key = multi ? `${r.student.id}:${m.key}` : m.key
        if (seen.has(key)) continue
        seen.add(key)
        missing.push(multi ? { ...m, label: `${r.facts.studentName || displayName(r.student)}: ${m.label}` } : m)
      }
    }
    if (missing.length === 0) { openUnitLeaderNotice(studentRows, { multi }); return }
    setNotifyPreview({ studentRows, multi, missing })
  }

  const rowsFor = (list) => list.map(student => ({
    student,
    match: matches.find(m => m.student_id === student.id && m.unit_id === unit.id) || null,
    facts: placementByStudent[student.id] || factsFor(student),
  }))

  const handleNotifyOne = (student) => reviewThenNotify(rowsFor([student]), { multi: false })

  // ── UNIT-POOL-REFINEMENT-1: the consolidated action ALWAYS reviews first ──
  //
  // The single-student envelope keeps its existing behavior (open immediately,
  // gaps named when they exist) - it names one person the user just looked at.
  // The consolidated action is different: it decides WHO is included, so the
  // exact list is shown before any draft opens. Included: this unit's current
  // matched placements whose unit-leader notification is not yet confirmed.
  const handleNotifyAll = () => {
    const rows = rowsFor(unnotifiedStudents)
    const missing = []
    for (const r of rows) {
      for (const m of r.facts.missing) {
        missing.push({ ...m, label: `${r.facts.studentName || displayName(r.student)}: ${m.label}` })
      }
    }
    setNotifyErrors(null)
    setNotifyFlow({ step: 'review', rows, missing })
  }

  // Open the ONE draft for the reviewed set, then hold the exact match ids it
  // named. Opening records nothing; the confirm step below is the only writer,
  // and it can only ever write for these ids.
  const openConsolidatedDraft = () => {
    const rows = notifyFlow?.rows || []
    if (!rows.length) { setNotifyFlow(null); return }
    openUnitLeaderNotice(rows, { multi: rows.length > 1 })
    setNotifyFlow({
      step: 'confirm',
      rows,
      matchIds: rows.map(r => r.match?.id).filter(Boolean),
    })
  }

  // The batch confirmation: one human act, N ledger writes through the SAME
  // endpoint every individual check uses. The endpoint re-proves each placement
  // and is idempotent by effect, so a retry after partial failure re-records
  // nothing that already succeeded. Never atomic - the endpoint is per-match -
  // so partial failure is REPORTED, never papered over: rows that succeeded
  // show confirmed (their writes landed), rows that failed stay actionable.
  const confirmConsolidated = async () => {
    if (!onBatchConfirmNotified || notifyBusy || !notifyFlow?.rows?.length) return
    setNotifyBusy(true)
    setNotifyErrors(null)
    try {
      const result = await onBatchConfirmNotified(
        notifyFlow.rows.map(r => ({ student: r.student, match: r.match })),
      )
      if (result?.failed?.length) {
        setNotifyErrors(result.failed)
      } else {
        setNotifyFlow(null)
      }
    } finally {
      setNotifyBusy(false)
    }
  }

  // ── Preceptor envelope → ASPIRE Connect (never a mailto) ─────────────────
  //
  // Opening Connect SENDS NOTHING. It writes a session-scoped launch context and
  // navigates; no email leaves, no notification is written, nobody is marked
  // notified. The context carries this exact (cohort, student, unit, preceptor),
  // so a second row - or another cohort - can never inherit it.
  const handleEmailPreceptor = async (student, match, facts) => {
    const placement = facts || factsFor(student)
    const email = placement.preceptorEmail
    if (!email) {
      showToast(`No email address on file for ${placement.preceptorName || 'this preceptor'}. Add one in Rotation → Preceptors first.`)
      return
    }
    setPreceptorHandoff('busy')
    // The Outreach composer addresses a CONTACT (its send endpoint resolves the
    // address server-side from contact_id), so the preceptor has to exist as an
    // active contact. Preceptors sync to Contacts on save; when one predates that,
    // say so and point at the repair tool instead of opening an unsendable draft.
    const norm = normalizeEmailForLookup(email)
    const { data, error } = await supabase
      .from('contacts')
      .select('id, full_name, preferred_name, email')
      .eq('is_active', true)
      .ilike('email', escapeLikePattern(norm))
    setPreceptorHandoff(null)
    if (error) {
      showToast('Contacts could not be checked just now. Nothing was sent; please try again.')
      return
    }
    const contact = (data || []).find(c => normalizeEmailForLookup(c.email) === norm) || null
    if (!contact) {
      showToast(`${placement.preceptorName || 'This preceptor'} is not in Connect → Contacts yet, so a draft cannot be addressed to them. Use Contacts → Sync preceptors, then try again.`)
      return
    }

    // The documents this template promises, resolved BEFORE the draft is written,
    // through the same endpoint and the same resolver the attachment picker uses.
    // Resolving here rather than in the composer means the merged copy is written
    // once, already knowing whether it may say "attached" - there is no moment in
    // which the draft claims a document it has not checked for.
    // A Catalog that could not be READ is reported as unavailable, never as
    // "the documents are missing" - those are different facts, and only one of
    // them is the Owner's to fix.
    const catalogOptions = await (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return null
        const res = await fetch('/api/outreach-attachment-options', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return null
        const payload = await res.json()
        return Array.isArray(payload?.options) ? payload.options : null
      } catch { return null }
    })()
    const attachments = resolveRequiredAttachments(catalogOptions)

    const written = writeLaunchContext({
      kind: LAUNCH_KINDS.PRECEPTOR_ASSIGNMENT,
      cohortId,
      cohortName,
      source: 'placement_board_unit_pool',
      templateKey: 'preceptor_assignment',
      returnPath: '/rotation',
      recipient: {
        contactId: contact.id,
        preceptorId: placement.preceptorId || null,
        name: contact.full_name || placement.preceptorName || '',
        email: contact.email || email,
      },
      placementRef: { studentId: student.id, unitId: unit.id, matchId: match?.id || null },
      attachments,
      placement: {
        // Natural reading order here: the preceptor is being written TO about
        // this student, not handed a roster line.
        studentName:   placement.studentNaturalName || placement.studentName,
        school:        placement.school,
        unit:          unit.unit_name,
        schedule:      placement.termDates,
        hoursRequired: placement.hoursRequired,
        // Shift is a first-class assignment field in the email summary.
        shift:         placement.assignedShift ? `${placement.assignedShift} shift` : '',
        preceptorFirstName: (contact.preferred_name || contact.full_name || placement.preceptorName || '')
          .trim().split(/\s+/)[0] || '',
      },
    })
    if (!written) {
      showToast('This browser blocked session storage, so the placement details could not be carried over.')
      return
    }
    // PLACEMENT-NOTIFICATION-CONTROL-1: no marker is written here, and no
    // question is asked afterwards. Opening a draft says nothing about whether
    // anyone was notified, so the board no longer records that it happened. The
    // check beside this envelope is the only way to claim a notification, and
    // it is available whenever staff actually know - not only on the one return
    // trip that a session-scoped marker happened to survive.
    navigate('/connect/outreach?launch=1', {
      state: { fromContact: { id: contact.id, name: contact.full_name, email: contact.email } },
    })
  }


  const boardClasses = [
    'pb-unit',
    isFocusedUnit ? 'pb-unit-focused' : '',
    isDropTarget ? 'pb-unit-drop' : '',
    isDimmed ? 'pb-unit-dimmed' : '',
    isHighlighted ? 'pb-unit-flash' : '',
  ].filter(Boolean).join(' ')

  const boardHint = selectedStudent
    ? `Press Enter to place ${getStudentPreferredFullName(selectedStudent)} on ${unit.unit_name}.`
    : `Press Enter to show the students who picked ${unit.unit_name}.`

  const shiftChips = (() => {
    const sp = unit.shift_preference
    if (!sp || !sp.trim())               return [<span key="s" className="pb-chip material-chip">Shift not specified</span>]
    if (sp === 'Day Shift')              return [<span key="d" className="pb-chip material-chip">☀ Day</span>]
    if (sp === 'Night Shift')            return [<span key="n" className="pb-chip material-chip">☾ Night</span>]
    if (sp === 'Either / No Preference') return [
      <span key="d" className="pb-chip material-chip">☀ Day</span>,
      <span key="n" className="pb-chip material-chip">☾ Night</span>,
    ]
    return [<span key="v" className="pb-chip material-chip">Verify shift</span>]
  })()

  return (
    <>
      {/* Toast */}
      {toast && <div className="pb-card-toast" role="status">{toast}</div>}

      <section
        className={boardClasses}
        data-pb-board=""
        data-unit-id={unit.id}
        role="group"
        tabIndex={0}
        aria-label={`${unit.unit_name} board, ${filledCount} of ${unit.total_slots} filled`}
        aria-describedby={hintId}
        // A click inside a portalled dialog (NotificationControl) still bubbles
        // through React to here; only a click on the board itself activates it.
        onClick={e => { if (e.currentTarget.contains(e.target)) onActivate?.() }}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault()
            onActivate?.()
          }
        }}
        onDragOver={onBoardDragOver || undefined}
        onDragLeave={onBoardDragLeave || undefined}
        onDrop={onBoardDrop || undefined}
      >
        <span id={hintId} className="sr-only">{boardHint}</span>

        {/* ── Leather header: identity, capacity, unit-leader status ── */}
        <header className="material-leather-navy pb-unit-hdr">
          <div className="pb-unit-hdr-top">
            <h3 className="pb-unit-name">{unit.unit_name}</h3>
            {/* Owner, 2026-09-17: the division pill left the board. The Division
                filter in the Unit Pool header is where a division is chosen. */}
            <div className="pb-unit-chips">{shiftChips}</div>
          </div>
          {desc && <div className="pb-unit-desc material-soft">{desc}</div>}

          {/* Capacity + the group envelope + the all-notified summary, one line.
              The envelope opens the SAME review-then-draft-then-confirm flow. */}
          <div className="pb-unit-capacity">
            <span className="pb-unit-capacity-text material-soft">
              {filledCount} of {unit.total_slots} filled{isFull ? ' · Full' : ` · ${emptyCount} open`}
            </span>
            {unnotifiedStudents.length >= 2 && (
              <span onClick={e => e.stopPropagation()} className="pb-unit-envelope">
                <Tooltip label={groupNotifyLabel} placement="top">
                  <button
                    type="button"
                    className="pb-icon-btn"
                    data-testid="notify-unit-leader-consolidated"
                    aria-label={groupNotifyLabel}
                    onClick={handleNotifyAll}
                  >
                    <Mail size={15} strokeWidth={2} aria-hidden="true" />
                    <span
                      data-testid="notify-consolidated-count"
                      aria-hidden="true"
                      className="pb-count-badge"
                      style={{ background: BADGE_COUNT_BG, color: BADGE_COUNT_FG }}>
                      {unnotifiedStudents.length}
                    </span>
                  </button>
                </Tooltip>
              </span>
            )}
            {filledCount > 0 && allNotified && (
              <span
                data-testid="unit-leader-all-notified"
                className="pb-unit-notified material-ok"
                title={`The unit leader has been notified for ${filledCount === 1 ? 'this placement' : `all ${filledCount} placements`}. Preceptor notification is tracked per row.`}>
                ✓ Unit Leader Notified · {notifiedCount} of {filledCount}
              </span>
            )}
          </div>
        </header>

        {/* ── Felt body: pinned notes, then open slots ── */}
        <div className="material-felt pb-unit-body">
          {highlightRank && (
            <span
              className={`material-ribbon material-rank-${RANK_TONE[highlightRank]} pb-ribbon`}
              data-testid="choice-ribbon"
            >
              #{highlightRank} choice{isFull ? ' · Full' : ''}
            </span>
          )}
          {matchedStudents.map((raw, i) => {
            const match   = matches.find(m => m.student_id === raw.id && m.unit_id === unit.id)
            const student = resolveMatchedStudent(match, studentMap) || raw
            return (
              <PinnedNote
                key={student.id}
                student={student}
                match={match}
                unit={unit}
                tilt={i % 2 === 0 ? 'a' : 'b'}
                isPulling={!!match && match.id === pullingMatchId}
                isPinningIn={!!pinningStudentIds?.has?.(student.id)}
                canDrag={canDrag}
                onDragStart={(e, s, m) => onNoteDragStart?.(e, s, m, unit)}
                onDragEnd={onNoteDragEnd}
                placement={placementByStudent[student.id] || factsFor(student)}
                onUnmatch={() => setConfirmUnmatch(student)}
                onNotify={handleNotifyOne}
                onAssignPreceptor={s => setAssignStudent(s)}
                onEmailPreceptor={preceptorHandoff === 'busy' ? undefined : handleEmailPreceptor}
                /* Both states are judged against the placement as it stands
                   NOW: this match row's id, and for the preceptor the person
                   currently resolved for it. A recreated match or a replaced
                   preceptor therefore starts unnotified, because neither can
                   match an older confirmation. */
                unitLeaderNotifyState={notificationStateFor(notificationIndex, {
                  target: NOTIFICATION_TARGETS.UNIT_LEADER, matchId: match?.id,
                }, { legacyNotified: !!match?.notification_sent })}
                preceptorNotifyState={notificationStateFor(notificationIndex, {
                  target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: match?.id,
                  preceptorId: (placementByStudent[student.id] || factsFor(student)).preceptorId,
                })}
                unitLeaderName={leaderGreeting.name || unit.contact_person || ''}
                canCorrect={canCorrectNotifications}
                onConfirmNotified={onConfirmNotified}
                onCorrectNotified={onCorrectNotified}
              />
            )
          })}
          {Array.from({ length: emptyCount }).map((_, i) => <OpenSlot key={i} />)}
        </div>
      </section>

      {/* PLACEMENT-COMMUNICATION-HANDOFF-1: gaps are shown BEFORE the draft opens.
          The message will print "To be confirmed" for each of these, so the Owner
          decides knowingly - nothing is guessed, and nothing is silently omitted. */}
      {notifyPreview && (
        <div className="modal-overlay" onClick={() => setNotifyPreview(null)}>
          <div className="modal confirm-delete-modal" data-testid="notify-missing-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Some placement details are not on file</h2>
              <button className="modal-close" onClick={() => setNotifyPreview(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 10px' }}>
                {missingSummary(notifyPreview.missing)} The notice to {unit.unit_name} will say
                {' '}<strong>To be confirmed</strong> for {notifyPreview.missing.length === 1 ? 'it' : 'them'}.
              </p>
              <ul data-testid="notify-missing-list" style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 13, color: '#4b5563', lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
                {notifyPreview.missing.map(m => <li key={`${m.key}-${m.label}`}>{m.label}</li>)}
              </ul>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setNotifyPreview(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                data-testid="notify-open-anyway"
                onClick={() => {
                  const p = notifyPreview
                  setNotifyPreview(null)
                  openUnitLeaderNotice(p.studentRows, { multi: p.multi })
                }}>
                Open the email anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── UNIT-POOL-REFINEMENT-1: the consolidated review + confirmation ── */}
      {/* STEP 1 - review. Exactly who will be included, with the canonical
          facts the notice will print, BEFORE any draft opens. Gaps are named
          inline ("To be confirmed"), so the missing-details modal's honesty
          survives inside this richer surface. Cancel records nothing. */}
      {notifyFlow?.step === 'review' && (
        <div className="modal-overlay" onClick={() => setNotifyFlow(null)}>
          <div className="modal confirm-delete-modal" data-testid="notify-review-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2>Notify {unit.unit_name}&rsquo;s Unit Leader</h2>
              <button className="modal-close" onClick={() => setNotifyFlow(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 10px' }}>
                One email to {leaderGreeting.name || 'the unit leader'} will describe{' '}
                {notifyFlow.rows.length === 1 ? 'this placement' : `these ${notifyFlow.rows.length} placements`}.
                Placements already confirmed as notified are not included.
              </p>
              <div data-testid="notify-review-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                {notifyFlow.rows.map(r => {
                  const f = r.facts
                  const fact = (label, value) => (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#9ca3af' }}>{label} </span>
                      {value || 'To be confirmed'}
                    </span>
                  )
                  return (
                    <div key={r.student.id} style={{ border: '1px solid #eef0f4', borderRadius: 8, padding: '8px 11px', fontFamily: 'Plus Jakarta Sans,sans-serif' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1D2567' }}>{f.studentName || displayName(r.student)}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 11.5, color: '#4b5563', marginTop: 3 }}>
                        {fact('School', f.school)}
                        {fact('Program', f.program)}
                        {fact('Rotation', f.termDates)}
                        {fact('Hours', f.hoursRequired)}
                        {fact('Shift', f.assignedShift || f.shiftPreference)}
                        {fact('Availability', f.availability)}
                        {fact('Preceptor', f.preceptorName)}
                      </div>
                    </div>
                  )
                })}
              </div>
              {notifyFlow.missing.length > 0 && (
                <p data-testid="notify-review-gaps" style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 11.5, color: '#92400e', lineHeight: 1.6, margin: '10px 0 0' }}>
                  The notice will say <strong>To be confirmed</strong> for:{' '}
                  {notifyFlow.missing.map(m => m.label).join(' · ')}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setNotifyFlow(null)}>Cancel</button>
              <button className="btn btn-primary" data-testid="notify-review-open" onClick={openConsolidatedDraft}>
                Open Email Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 - after the draft opened. Opening recorded NOTHING; this is
          where a person says the email actually went, for exactly the set the
          draft named. "Not Yet" closes with zero writes; the rows'own controls
          remain. The confirm writes through the same endpoint as every
          individual check - idempotent per placement, partial failure named. */}
      {notifyFlow?.step === 'confirm' && (
        <div className="modal-overlay" onClick={() => !notifyBusy && setNotifyFlow(null)}>
          <div className="modal confirm-delete-modal" data-testid="notify-batch-confirm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Was the Email Sent?</h2>
              <button className="modal-close" onClick={() => !notifyBusy && setNotifyFlow(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 8px' }}>
                The draft to <strong>{leaderGreeting.name || `${unit.unit_name}'s unit leader`}</strong> named{' '}
                {notifyFlow.rows.length === 1 ? 'this placement' : `these ${notifyFlow.rows.length} placements`}:
              </p>
              <ul data-testid="notify-batch-students" style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 12.5, color: '#4b5563', lineHeight: 1.7, margin: '0 0 8px', paddingLeft: 18 }}>
                {notifyFlow.rows.map(r => <li key={r.student.id}>{studentNaturalName(r.student)}</li>)}
              </ul>
              <p style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 12, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
                Confirming marks {notifyFlow.rows.length === 1 ? 'that placement' : `all ${notifyFlow.rows.length} placements`}{' '}
                as unit-leader notified on the Placement Board. Preceptors are not affected.
              </p>
              {notifyErrors && (
                <div data-testid="notify-batch-errors" role="alert" style={{ marginTop: 10, background: '#FEF2F2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 11px', fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 12, color: '#991b1b', lineHeight: 1.6 }}>
                  {notifyErrors.length === notifyFlow.rows.length
                    ? 'Nothing was recorded.'
                    : 'Some placements were recorded; these were not:'}
                  <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                    {notifyErrors.map(f => <li key={f.name}>{f.name}: {f.reason}</li>)}
                  </ul>
                  You can retry - placements already recorded are never double-counted.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" data-testid="notify-batch-notyet" disabled={notifyBusy} onClick={() => setNotifyFlow(null)}>
                Not Yet
              </button>
              <button className="btn btn-primary" data-testid="notify-batch-confirm" disabled={notifyBusy} onClick={confirmConsolidated}>
                {notifyBusy
                  ? 'Recording…'
                  : notifyFlow.rows.length === 1
                    ? 'Mark the Unit Leader as Notified for This Placement'
                    : `Mark the Unit Leader as Notified for These ${notifyFlow.rows.length} Placements`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNIT-POOL-REFINEMENT-1: the unmatch confirmation names the student,
          the unit, and the consequences OF THE BRANCH THAT WILL ACTUALLY RUN -
          the same planUnmatch the removal itself consumes, so the dialog can
          never promise one behavior while the code performs another. Nothing
          changes before "Unmatch Student" is pressed; Cancel closes with zero
          writes. */}
      {confirmUnmatch && (() => {
        const unmatchMatch = matches.find(m => m.student_id === confirmUnmatch.id && m.unit_id === unit.id)
        const unmatchPlanned = planUnmatch({ student: confirmUnmatch, match: unmatchMatch, matches })
        const successorName = unmatchPlanned.kind === 'primary_with_survivor'
          ? (unitNameById?.[unmatchPlanned.successor?.unit_id] || 'their remaining placement')
          : null
        return (
        <div className="modal-overlay" onClick={() => setConfirmUnmatch(null)}>
          <div className="modal confirm-delete-modal" data-testid="unmatch-confirm-modal" data-plan-kind={unmatchPlanned.kind} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Unmatch Student</h2>
              <button className="modal-close" onClick={() => setConfirmUnmatch(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-delete-warning" style={{ marginBottom: 8 }}>
                Remove <strong>{studentNaturalName(confirmUnmatch)}</strong> from{' '}
                <strong>{unit.unit_name}</strong>?
              </p>
              <ul style={{ fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 12.5, color: '#4b5563', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
                {unmatchPlanned.kind === 'additional' && (<>
                  <li>This {unit.unit_name} placement ends and its slot reopens.</li>
                  <li>Their primary placement is unchanged - the student stays placed,
                      and their status does not change.</li>
                  <li>The primary preceptor relationship is not touched; this
                      placement&rsquo;s own preceptor ends with it.</li>
                  <li>Notification records for this placement stay in the audit
                      history but no longer apply.</li>
                </>)}
                {unmatchPlanned.kind === 'primary_with_survivor' && (<>
                  <li>This {unit.unit_name} placement ends and its slot reopens.</li>
                  <li><strong>{successorName}</strong> becomes their primary placement -
                      the student stays placed, and their status does not change.</li>
                  <li>The primary preceptor relationship, which described this
                      placement, is ended - never transferred. The surviving
                      placement&rsquo;s own preceptor is untouched.</li>
                  <li>Notification records for this placement stay in the audit
                      history but no longer apply. The surviving placement&rsquo;s
                      records are unaffected.</li>
                </>)}
                {unmatchPlanned.kind === 'final' && (<>
                  <li>The placement ends and the slot reopens.</li>
                  <li>The student returns to the pool with their pre-match status.</li>
                  <li>The preceptor assignment for this placement is cleared.</li>
                  <li>Unit-leader and preceptor notification records for this placement
                      stay in the audit history but no longer apply, because the
                      placement they describe ends.</li>
                </>)}
              </ul>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" data-testid="unmatch-cancel" onClick={() => setConfirmUnmatch(null)}>Cancel</button>
              <button className="btn btn-destructive-filled" data-testid="unmatch-confirm" onClick={() => { onUnmatch(confirmUnmatch); setConfirmUnmatch(null) }}>
                Unmatch Student
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      <PreceptorAssignmentModal
        isOpen={!!assignStudent}
        onClose={() => setAssignStudent(null)}
        student={assignStudent}
        /* PRECEPTOR-ASSIGNMENT-PROJECTION-1: the assigned preceptor was
           previously discarded here, so the board stayed stale until a manual
           refresh. It now flows to App's canonical students state, which is
           what this board renders from. */
        onAssigned={(preceptor) => {
          if (assignStudent?.id) onPreceptorAssigned?.(assignStudent.id, preceptor)
          setAssignStudent(null)
        }}
      />
    </>
  )
}
