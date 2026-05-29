import { useState } from 'react'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import { displayName } from '../lib/utils'
import { buildUnitLeaderEmail } from '../lib/emailUtils'
import { openMailtoLink } from '../lib/openLink'
import StudentAvatar from './StudentAvatar'
import { getUnit } from '../lib/unitCatalog'
import { CARD } from '../lib/designTokens'
import PreceptorAssignmentModal from './PreceptorAssignmentModal'

// ── Choice / match-quality config ────────────────────────────────────────────

const CHOICE_STYLES = {
  '1st': { border:'#059669', chipBg:'#D1FAE5', chipText:'#065F46', label:'★ 1st choice' },
  '2nd': { border:'#B5895A', chipBg:'#FCEFD4', chipText:'#7C5A1F', label:'★ 2nd choice' },
  '3rd': { border:'#7C8FD9', chipBg:'#E0E7FF', chipText:'#3730A3', label:'★ 3rd choice' },
}

const MATCH_QUALITY_CONFIG = {
  '1st':   { label:'★ Perfect Match',    color:'#065F46', bg:'#D1FAE5', border:'#059669' },
  '2nd':   { label:'2nd Choice Match',   color:'#7C5A1F', bg:'#FCEFD4', border:'#B5895A' },
  '3rd':   { label:'3rd Choice Match',   color:'#3730A3', bg:'#E0E7FF', border:'#7C8FD9' },
  'other': { label:'Manual placement',   color:'#6b7280', bg:'#f9fafb', border:'#e5e7eb' },
}

const resolveMatchedStudent = (match, studentMap) => {
  if (match?.student?.first_name) return match.student
  if (match?.student_id && studentMap?.[match.student_id]) return studentMap[match.student_id]
  return null
}

// ── Compact placement row ─────────────────────────────────────────────────────

function CompactPlacementRow({ student, match, unit, onUnmatch, onNotify, onAssignPreceptor }) {
  const [rowHovered, setRowHovered] = useState(false)
  const qKey = student.unit_preference_1 === unit.unit_name ? '1st'
    : student.unit_preference_2 === unit.unit_name ? '2nd'
    : student.unit_preference_3 === unit.unit_name ? '3rd'
    : 'other'
  const qCfg       = MATCH_QUALITY_CONFIG[qKey]
  const isNotified = !!match?.notification_sent
  const hasPreceptor = !!(student.preceptor_id || student.matched_preceptor)

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
        ) : null}
      </div>

      {/* Notify + unmatch controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        {isNotified
          ? <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}>✓</span>
          : <button
              title="Notify unit leader for this student"
              onClick={e => { e.stopPropagation(); onNotify(student, match) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#6b7280', padding: '0 2px', lineHeight: 1 }}>
              ✉
            </button>
        }
        <button
          title="Unmatch student"
          onClick={e => { e.stopPropagation(); onUnmatch(student) }}
          style={{ background: 'none', border: 'none', fontSize: 14, fontWeight: 600, color: '#d1d5db', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = '#dc1e34'}
          onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
        >
          ×
        </button>
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
  onSlotClick, onUnmatch, onUpdateMatch, onDelete, isHighlighted,
  isFocusedUnit, onFocusUnit,
}) {
  const [confirmUnmatch,  setConfirmUnmatch]  = useState(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)
  const [toast,           setToast]           = useState(null)
  const [cardHovered,     setCardHovered]     = useState(false)
  const [notifiedAt,      setNotifiedAt]      = useState(null)  // persists Zone-2 notify confirmation
  const [assignStudent,   setAssignStudent]   = useState(null)

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

  // Notification state
  const notifiedCount = matchedStudents.filter(s => {
    const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
    return !!m?.notification_sent
  }).length
  const allNotified  = filledCount > 0 && notifiedCount === filledCount
  const someNotified = notifiedCount > 0 && notifiedCount < filledCount

  // Build unnotified list for Zone-2 button label
  const unnotifiedStudents = matchedStudents.filter(s => {
    const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
    return !m?.notification_sent
  })

  const notifyButtonLabel = (() => {
    if (unnotifiedStudents.length === 1) return `Notify unit leader about ${unnotifiedStudents[0].first_name} →`
    if (unnotifiedStudents.length === 2) return `Notify unit leader about ${unnotifiedStudents[0].first_name} + ${unnotifiedStudents[1].first_name} →`
    return `Notify unit leader about ${unnotifiedStudents.length} students →`
  })()

  // ── Email helpers (logic unchanged) ──────────────────────────────────────

  const toEmailStudent = (s, m) => ({
    firstName:         s.first_name  || '',
    lastName:          s.last_name   || s.name || '',
    school:            s.school      || '',
    programType:       s.program_type     || '',
    termDates:         s.term_dates       || '',
    hoursRequired:     s.hours_required   || '',
    shiftPreference:   s.shift_availability || '',
    preceptorAssigned: m?.preceptor_assigned || '',
  })

  const handleNotifyOne = async (student, match) => {
    const emailStudent = toEmailStudent(student, match)
    openMailtoLink(buildUnitLeaderEmail({
      contactPersons: unit.contact_person || 'Unit Leader',
      contactEmails:  unit.contact_email  || '',
      unitName:       unit.unit_name,
      students:       [emailStudent],
      isMultiStudent: false,
    }))
    if (match) await onUpdateMatch(match.id, student.id, { notification_sent: true, notified_at: new Date().toISOString() })
    showToast(!unit.contact_email
      ? `No contact email on file for ${unit.unit_name}. Match marked as notified.`
      : `Email opened for ${displayName(student)}. Marked as notified.`)
  }

  const handleNotifyAll = async () => {
    const studs = unnotifiedStudents.map(s => {
      const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
      return toEmailStudent(s, m)
    })
    openMailtoLink(buildUnitLeaderEmail({
      contactPersons: unit.contact_person || 'Unit Leader',
      contactEmails:  unit.contact_email  || '',
      unitName:       unit.unit_name,
      students:       studs,
      isMultiStudent: true,
    }))
    const now = new Date().toISOString()
    for (const s of unnotifiedStudents) {
      const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
      if (m) await onUpdateMatch(m.id, s.id, { notification_sent: true, notified_at: now })
    }
    setNotifiedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    showToast(!unit.contact_email
      ? `No contact email on file for ${unit.unit_name}. ${unnotifiedStudents.length} match${unnotifiedStudents.length !== 1 ? 'es' : ''} marked as notified.`
      : `Email opened for ${unit.unit_name}. ${unnotifiedStudents.length} student${unnotifiedStudents.length !== 1 ? 's' : ''} marked as notified.`)
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
            <button
              onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
              title="Delete unit"
              style={{ background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: '#d1d5db', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = '#9ca3af'}
              onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
            >
              ✕
            </button>
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

          {/* Notify Zone-2 button — only when full and unnotified placements exist */}
          {isFull && filledCount > 0 && !allNotified && (
            <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
              {notifiedAt ? (
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  {'✓'} Unit leader notified {notifiedAt}
                </div>
              ) : (
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
              )}
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
                  onUnmatch={() => setConfirmUnmatch(student)}
                  onNotify={handleNotifyOne}
                  onAssignPreceptor={s => setAssignStudent(s)}
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
        onAssigned={() => setAssignStudent(null)}
      />
    </>
  )
}
