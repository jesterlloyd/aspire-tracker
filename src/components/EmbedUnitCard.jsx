import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Tooltip from './ui/Tooltip'
import { UNIT_DIVISION_MAP } from '../lib/constants'
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
import StudentAvatar from './StudentAvatar'
import { getUnit } from '../lib/unitCatalog'
import { CARD } from '../lib/designTokens'
import PreceptorAssignmentModal from './PreceptorAssignmentModal'
import { MATCH_RANK_CONFIG, matchRankOf } from '../lib/placementDisplay'
import NotificationControl from './placement/NotificationControl'
import { NOTIFICATION_TARGETS, notificationStateFor } from '../lib/placementNotificationState'

// ── Choice / match-quality config ────────────────────────────────────────────

const CHOICE_STYLES = {
  '1st': { border:'#059669', chipBg:'#D1FAE5', chipText:'#065F46', label:'★ 1st choice' },
  '2nd': { border:'#B5895A', chipBg:'#FCEFD4', chipText:'#7C5A1F', label:'★ 2nd choice' },
  '3rd': { border:'#7C8FD9', chipBg:'#E0E7FF', chipText:'#3730A3', label:'★ 3rd choice' },
}

// ASPIRE-CHART honest match rank: display comes from the STORED match_quality
// (lib/placementDisplay), never re-derived from unit names - renaming a unit
// must not rewrite placement history, and absent data says so explicitly.

const resolveMatchedStudent = (match, studentMap) => {
  if (match?.student?.first_name) return match.student
  if (match?.student_id && studentMap?.[match.student_id]) return studentMap[match.student_id]
  return null
}

// ── Compact placement row ─────────────────────────────────────────────────────

function CompactPlacementRow({
  student, match, unit, onUnmatch, onNotify, onAssignPreceptor, placement, onEmailPreceptor,
  unitLeaderNotifyState, preceptorNotifyState, unitLeaderName, canCorrect,
  onConfirmNotified, onCorrectNotified,
}) {
  const [rowHovered, setRowHovered] = useState(false)
  const qCfg       = MATCH_RANK_CONFIG[matchRankOf(student, match)]
  // PLACEMENT-COMMUNICATION-HANDOFF-1: presence comes ONLY from the PLACEMENT's
  // resolved preceptor (this student, in THIS unit). The student-level fields are
  // deliberately not consulted here: for a multi-unit student they name whoever
  // was assigned on a DIFFERENT unit, so reading them would show - and offer to
  // email - the wrong person about this rotation. A placement that names nobody
  // shows the existing Assign preceptor action and no envelope.
  const preceptorName = placement?.preceptorName || ''
  const preceptorEmail = placement?.preceptorEmail || ''
  const hasPreceptor = !!preceptorName

  return (
    <div
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 4px',
        borderRadius: 6,
        background: rowHovered ? '#F4F1EC' : 'transparent',
        transition: 'background 120ms ease',
        minHeight: 36,
      }}
    >
      <StudentAvatar student={student} size={24} style={{ flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name · shift */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 13, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
            {student.first_name} {student.last_name}
          </span>
          {student.shift_assigned && (
            <span style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 11, fontWeight: 500, color: '#9CA3AF', border: '1px solid #E5E7EB', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
              {student.shift_assigned === 'Day'       ? '☀ Day'
              : student.shift_assigned === 'Night'    ? '☾ Night'
              : student.shift_assigned === 'Mid'      ? '◐ Mid'
              : student.shift_assigned === 'Variable' ? '☀ / ☾ Variable'
              : student.shift_assigned}
            </span>
          )}
          <span style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: qCfg.bg, color: qCfg.color, border: `1px solid ${qCfg.border}`, whiteSpace: 'nowrap' }}>
            {qCfg.label}
          </span>
        </div>
        {/* Preceptor status */}
        {!hasPreceptor && onAssignPreceptor ? (
          <button
            onClick={e => { e.stopPropagation(); onAssignPreceptor(student) }}
            style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 11, color: '#1D2567', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 1, textDecoration: 'underline', textAlign: 'left' }}
          >
            + Assign preceptor
          </button>
        ) : !hasPreceptor ? (
          <div style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 11, color: '#B45309', marginTop: 1 }}>
            {'⚠'} Preceptor needed
          </div>
        ) : (
          /* PRECEPTOR-ASSIGNMENT-PROJECTION-1: an assigned preceptor used to
             render NOTHING here, so the board could not show who was assigned.
             matched_preceptor is the trigger-maintained projection of the
             canonical preceptors row, so the name is available without the
             board loading the preceptor roster. Clicking re-opens the same
             assignment modal to change it. */
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <button
              data-testid="placement-preceptor-name"
              onClick={e => { e.stopPropagation(); onAssignPreceptor?.(student) }}
              disabled={!onAssignPreceptor}
              title={onAssignPreceptor ? 'Change preceptor' : undefined}
              style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 11, color: '#4b5563', background: 'none',
                border: 'none', padding: 0, textAlign: 'left',
                cursor: onAssignPreceptor ? 'pointer' : 'default' }}
            >
              {'\u{1F464}'} {preceptorName}
            </button>
            {/* PLACEMENT-NOTIFICATION-CONTROL-1: one shared control, identical
                to the unit-leader row's. The envelope opens the ASPIRE Connect
                handoff and writes nothing; the check is the only path to
                notified state, and it always asks first. */}
            {onEmailPreceptor && (
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
            )}
          </div>
        )}
      </div>

      {/* Notify + unmatch controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        {/* The SAME shared control for the unit leader, so the two rows cannot
            drift in shape, size, wording or meaning again. */}
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
        <Tooltip label="Unmatch student" placement="top">
        <button
          aria-label="Unmatch student"
          onClick={e => { e.stopPropagation(); onUnmatch(student) }}
          style={{ background: 'none', border: 'none', fontSize: 14, fontWeight: 600, color: '#d1d5db', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = '#dc1e34'}
          onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
        >
          ×
        </button>
        </Tooltip>
      </div>
    </div>
  )
}

// ── Compact open slot button ──────────────────────────────────────────────────

function CompactOpenSlot({ selectedStudent, compat, onClick }) {
  const [hovered, setHovered] = useState(false)
  const isReady = !!selectedStudent && !!onClick
  return (
    <button
      onClick={isReady ? e => { e.stopPropagation(); onClick() } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        width: '100%', height: 32,
        borderRadius: 8,
        border: `1px solid ${hovered && isReady ? '#c8c8c8' : '#E5E5E5'}`,
        background: hovered && isReady ? '#F4F1EC' : '#ffffff',
        fontFamily: 'DM Sans,sans-serif', fontSize: 13, fontWeight: 500,
        color: isReady ? '#191919' : '#9ca3af',
        cursor: isReady ? 'pointer' : 'default',
        transition: 'background 150ms ease, border-color 150ms ease',
        outline: 'none',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      {isReady ? 'Place in this slot' : '+ Open slot'}
    </button>
  )
}

// ── Main card ─────────────────────────────────────────────────────────────────

export default function EmbedUnitCard({
  unit, matchedStudents, matches, studentMap, selectedStudent,
  onSlotClick, onUnmatch, onDelete, isHighlighted,
  isFocusedUnit, onFocusUnit, onPreceptorAssigned,
  // PLACEMENT-COMMUNICATION-HANDOFF-1 canonical inputs. All optional: without
  // them the card still renders, the notice simply reports the values it could
  // not resolve instead of inventing them.
  rotationRows = [], preceptorsById = null, unitLeaders = [],
  cohortId = null, cohortName = '',
  // PLACEMENT-NOTIFICATION-CONTROL-1: the shared confirmation ledger index and
  // the two writers. Both rows read the same index and call the same handlers.
  notificationIndex = null, canCorrectNotifications = false,
  onConfirmNotified = null, onCorrectNotified = null,
}) {
  const navigate = useNavigate()
  const [confirmUnmatch,  setConfirmUnmatch]  = useState(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)
  const [toast,           setToast]           = useState(null)
  const [cardHovered,     setCardHovered]     = useState(false)
  const [assignStudent,   setAssignStudent]   = useState(null)
  // The unit-leader notice awaiting confirmation, when the placement is missing
  // canonical values. { students, missing, message, onConfirm } - see handleNotify*.
  const [notifyPreview,   setNotifyPreview]   = useState(null)
  const [preceptorHandoff, setPreceptorHandoff] = useState(null)  // 'busy' | { error }

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const unitMeta  = getUnit(unit.unit_name)
  const desc      = unitMeta?.description || null
  const division  = unit.division || UNIT_DIVISION_MAP[unit.unit_name] || unitMeta?.division || null

  const filledCount = matchedStudents.length
  const emptyCount  = Math.max(0, unit.total_slots - filledCount)
  const isFull      = emptyCount === 0

  // Choice level for the currently selected student
  const compat = selectedStudent
    ? (selectedStudent.unit_preference_1 === unit.unit_name ? '1st'
      : selectedStudent.unit_preference_2 === unit.unit_name ? '2nd'
      : selectedStudent.unit_preference_3 === unit.unit_name ? '3rd'
      : null)
    : null
  const choiceStyle = compat ? CHOICE_STYLES[compat] : null

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
  const someNotified = notifiedCount > 0 && notifiedCount < filledCount

  // Build unnotified list for Zone-2 button label
  const unnotifiedStudents = matchedStudents.filter(s => !unitLeaderConfirmed(s))

  const notifyButtonLabel = (() => {
    if (unnotifiedStudents.length === 1) return `Notify unit leader about ${unnotifiedStudents[0].first_name} →`
    if (unnotifiedStudents.length === 2) return `Notify unit leader about ${unnotifiedStudents[0].first_name} + ${unnotifiedStudents[1].first_name} →`
    return `Notify unit leader about ${unnotifiedStudents.length} students →`
  })()

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
  const handleNotifyAll = () => reviewThenNotify(rowsFor(unnotifiedStudents), { multi: true })

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
        // Additional Notes stays empty unless there is a real, appropriate note.
        // The shift the placement actually carries is the only one that qualifies.
        notes:         placement.assignedShift ? `${placement.assignedShift} shift` : '',
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

  // ── Card border / shadow / opacity ────────────────────────────────────────

  const borderColor = choiceStyle
    ? choiceStyle.border
    : isFocusedUnit
    ? '#1D2567'
    : '#E5E5E5'

  const borderLeft = choiceStyle || isFocusedUnit
    ? `3px solid ${borderColor}`
    : '1px solid #E5E5E5'

  const boxShadow = (isFocusedUnit || isHighlighted)
    ? '0 4px 16px rgba(29,37,103,0.18)'
    : cardHovered
    ? CARD.shadowHover
    : CARD.shadowRest

  const transform = (isFocusedUnit || cardHovered) ? `translateY(${CARD.hoverLiftPx}px)` : 'none'

  // Incompatible: when a student is selected but this unit is not one of their choices
  const isIncompatible = !!selectedStudent && !compat
  const cardOpacity = isIncompatible ? (isFull ? 0.45 : 0.7) : 1

  return (
    <>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 80, right: 24, zIndex: 9999,
          background: 'var(--nightfall)', color: 'var(--pearl)',
          fontSize: 13, fontWeight: 500, padding: '10px 16px',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          maxWidth: 340, lineHeight: 1.5,
        }}>{toast}</div>
      )}

      <div
        style={{
          position: 'relative',
          background: '#ffffff',
          borderRadius: CARD.radius,
          border: `1px solid ${borderColor}`,
          borderLeft,
          boxShadow,
          opacity: cardOpacity,
          transform,
          transition: `box-shadow ${CARD.hoverDuration} ease, transform ${CARD.hoverDuration} ease, opacity ${CARD.hoverDuration} ease, border-color ${CARD.hoverDuration} ease`,
          cursor: 'pointer',
          animation: isHighlighted ? 'unit-highlight 2s ease-out' : undefined,
          fontFamily: 'DM Sans,sans-serif',
          overflow: 'hidden',
        }}
        onMouseEnter={() => setCardHovered(true)}
        onMouseLeave={() => setCardHovered(false)}
        onClick={() => onFocusUnit?.()}
      >

        {/* ── Zone 1: Identity ── */}
        <div style={{ padding: '16px 14px 10px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16, color: '#191919', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
              {unit.unit_name}
            </div>
            {desc && (
              <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {desc}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {division && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#475467', border: '1px solid #E5E5E5', borderRadius: 6, padding: '2px 7px', background: '#fafafa', whiteSpace: 'nowrap' }}>
                {division}
              </span>
            )}
            {(() => {
              const sp = unit.shift_preference
              const s = { fontSize: 10, fontWeight: 500, color: '#475467', border: '1px solid #E5E5E5', borderRadius: 6, padding: '2px 7px', background: '#fafafa', whiteSpace: 'nowrap' }
              if (!sp || !sp.trim())           return <span style={s}>Shift not specified</span>
              if (sp === 'Day Shift')          return <span style={s}>☀ Day</span>
              if (sp === 'Night Shift')        return <span style={s}>☾ Night</span>
              if (sp === 'Either / No Preference') return <><span style={s}>☀ Day</span><span style={s}>☾ Night</span></>
              return <span style={s}>Verify shift</span>
            })()}
            {isFocusedUnit && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#1D2567', border: '1px solid #c7d2fe', borderRadius: 6, padding: '2px 7px', background: '#e0e7ff', whiteSpace: 'nowrap' }}>
                Filtering
              </span>
            )}
            <Tooltip label="Delete unit" placement="top">
            <button
              onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
              aria-label="Delete unit"
              style={{ background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: '#d1d5db', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#9ca3af'}
              onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
            >
              ✕
            </button>
            </Tooltip>
          </div>
        </div>

        {/* ── Zone 2: Capacity ── */}
        <div style={{ padding: '0 14px 12px' }}>
          {/* Dot indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
            {Array.from({ length: Math.max(unit.total_slots, 1) }).map((_, i) => (
              i < filledCount
                ? <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#86EFAC', flexShrink: 0, display: 'inline-block' }} />
                : <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid #E5E7EB', flexShrink: 0, display: 'inline-block' }} />
            ))}
            {/* Choice chip inline */}
            {choiceStyle && (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: choiceStyle.chipBg, color: choiceStyle.chipText, whiteSpace: 'nowrap' }}>
                {choiceStyle.label}
              </span>
            )}
          </div>

          {/* Text descriptor */}
          <div style={{ fontSize: 12, color: '#9ca3af' }}>
            {filledCount} of {unit.total_slots} filled{isFull ? ' · Full' : ` · ${emptyCount} open`}
          </div>

          {/* Notify Zone-2 button - only when full and unnotified placements exist */}
          {/* The transient "notified at HH:MM" line is gone: the row statuses and
              the count beside them come from the ledger, so they already say
              this - accurately, and after a refresh. */}
          {isFull && filledCount > 0 && !allNotified && (
            <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={handleNotifyAll}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '6px 12px', borderRadius: 8,
                    background: '#1D2567', border: 'none',
                    fontFamily: 'DM Sans,sans-serif', fontSize: 13, fontWeight: 600,
                    color: '#ffffff', cursor: 'pointer',
                    transition: 'background 150ms ease',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141928'}
                  onMouseLeave={e => e.currentTarget.style.background = '#1D2567'}
                >
                  {notifyButtonLabel}
                </button>
            </div>
          )}
        </div>

        {/* ── Zone 3: Placements ── */}
        {(filledCount > 0 || emptyCount > 0) && (
          <div style={{ borderTop: '1px solid rgba(29,37,103,0.06)', padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {matchedStudents.map(raw => {
              const match   = matches.find(m => m.student_id === raw.id && m.unit_id === unit.id)
              const student = resolveMatchedStudent(match, studentMap) || raw
              return (
                <CompactPlacementRow
                  key={student.id}
                  student={student}
                  match={match}
                  unit={unit}
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
            {/* Notify summary for non-full units */}
            {!isFull && filledCount > 0 && !allNotified && (
              <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 4px' }}>
                {notifiedCount} of {filledCount} notified
              </div>
            )}
            {Array.from({ length: emptyCount }).map((_, i) => (
              <CompactOpenSlot
                key={i}
                selectedStudent={selectedStudent}
                compat={compat}
                onClick={selectedStudent ? onSlotClick : undefined}
              />
            ))}
          </div>
        )}
      </div>

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
              <p style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 10px' }}>
                {missingSummary(notifyPreview.missing)} The notice to {unit.unit_name} will say
                {' '}<strong>To be confirmed</strong> for {notifyPreview.missing.length === 1 ? 'it' : 'them'}.
              </p>
              <ul data-testid="notify-missing-list" style={{ fontFamily: 'DM Sans,sans-serif', fontSize: 13, color: '#4b5563', lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
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

      {/* Unmatch confirmation modal */}
      {confirmUnmatch && (
        <div className="modal-overlay" onClick={() => setConfirmUnmatch(null)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Unmatch Student</h2>
              <button className="modal-close" onClick={() => setConfirmUnmatch(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-delete-warning">
                Unmatch <strong>{displayName(confirmUnmatch)}</strong> from <strong>{unit.unit_name}</strong>? Their preceptor and shift assignment will also be cleared.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmUnmatch(null)}>Cancel</button>
              <button className="btn btn-destructive-filled" onClick={() => { onUnmatch(confirmUnmatch); setConfirmUnmatch(null) }}>
                Yes, Unmatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete {unit.unit_name}?</h2>
              <button className="modal-close" onClick={() => setConfirmDelete(false)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-delete-warning">
                This action cannot be undone. Any students matched to this unit will be returned to unmatched.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-destructive-filled" onClick={() => { setConfirmDelete(false); onDelete?.() }}>Delete</button>
            </div>
          </div>
        </div>
      )}

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
