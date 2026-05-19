import { useState } from 'react'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import { displayName } from '../lib/utils'
import { buildUnitLeaderEmail } from '../lib/emailUtils'
import { openMailtoLink } from '../lib/openLink'
import StudentAvatar from './StudentAvatar'
import { getUnit } from '../lib/unitCatalog'

const resolveMatchedStudent = (match, slot, studentMap) => {
  if (match?.student?.first_name) return match.student
  if (match?.student_id && studentMap?.[match.student_id]) return studentMap[match.student_id]
  if (slot?.booked_by_student_id && studentMap?.[slot.booked_by_student_id]) return studentMap[slot.booked_by_student_id]
  return null
}

const CHOICE_STYLES = {
  '1st': { accentBorder:'#059669', badgeBg:'#D1FAE5', badgeText:'#065F46', bodyTint:'#F0FDF4', label:'★ 1st choice' },
  '2nd': { accentBorder:'#B5895A', badgeBg:'#FCEFD4', badgeText:'#7C5A1F', bodyTint:'#FDF8EC', label:'★ 2nd choice' },
  '3rd': { accentBorder:'#7C8FD9', badgeBg:'#E0E7FF', badgeText:'#3730A3', bodyTint:'#EFF3FE', label:'★ 3rd choice' },
}

const MATCH_QUALITY_CONFIG = {
  '1st':   { label: '★ 1st Choice Match', color: '#065F46', bg: '#D1FAE5', border: '#059669' },
  '2nd':   { label: '2nd Choice Match',   color: '#7C5A1F', bg: '#FCEFD4', border: '#B5895A' },
  '3rd':   { label: '3rd Choice Match',   color: '#3730A3', bg: '#E0E7FF', border: '#7C8FD9' },
  'other': { label: 'Other Match',        color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}


export default function EmbedUnitCard({
  unit, matchedStudents, matches, studentMap, selectedStudent,
  onSlotClick, onUnmatch, onUpdateMatch, onDelete, isHighlighted,
  isFocusedUnit, onFocusUnit,
}) {
  const [confirmUnmatch, setConfirmUnmatch] = useState(null)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [toast,          setToast]          = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const filledCount = matchedStudents.length
  const emptyCount  = Math.max(0, unit.total_slots - filledCount)
  const isFull      = emptyCount === 0

  const compat = selectedStudent
    ? (selectedStudent.unit_preference_1 === unit.unit_name ? '1st'
      : selectedStudent.unit_preference_2 === unit.unit_name ? '2nd'
      : selectedStudent.unit_preference_3 === unit.unit_name ? '3rd'
      : null)
    : null

  const choiceStyle = compat ? CHOICE_STYLES[compat] : null
  const bgTint      = choiceStyle ? choiceStyle.bodyTint : '#ffffff'

  const fillBadge = isFull
    ? <span className="euc-fill-badge euc-fill-full">Full</span>
    : <span className="euc-fill-badge euc-fill-open">{emptyCount} of {unit.total_slots} open</span>

  // Notification counts
  const notifiedCount = matchedStudents.filter(s => {
    const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
    return !!m?.notification_sent
  }).length
  const allNotified  = filledCount > 0 && notifiedCount === filledCount
  const someNotified = notifiedCount > 0 && notifiedCount < filledCount

  // Build student payload for email
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
    const mailto = buildUnitLeaderEmail({
      contactPersons: unit.contact_person || 'Unit Leader',
      contactEmails:  unit.contact_email  || '',
      unitName:       unit.unit_name,
      students:       [emailStudent],
      isMultiStudent: false,
    })
    openMailtoLink(mailto)
    // Always mark as notified — the mailto opened regardless of whether email is configured
    if (match) {
      const notifiedAt = new Date().toISOString()
      await onUpdateMatch(match.id, student.id, { notification_sent: true, notified_at: notifiedAt })
    }
    if (!unit.contact_email) {
      showToast(`No contact email on file for ${unit.unit_name} — add one in unit settings. Match marked as notified.`)
    } else {
      showToast(`Email opened for ${displayName(student)}. Marked as notified.`)
    }
  }

  const handleNotifyAll = async () => {
    const unnotified = matchedStudents.filter(s => {
      const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
      return !m?.notification_sent
    })
    const studs = unnotified.map(s => {
      const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
      return toEmailStudent(s, m)
    })
    const mailto = buildUnitLeaderEmail({
      contactPersons: unit.contact_person || 'Unit Leader',
      contactEmails:  unit.contact_email  || '',
      unitName:       unit.unit_name,
      students:       studs,
      isMultiStudent: true,
    })
    openMailtoLink(mailto)
    // Always mark all unnotified matches — the mailto opened regardless of email config
    const notifiedAt = new Date().toISOString()
    for (const s of unnotified) {
      const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
      if (m) await onUpdateMatch(m.id, s.id, { notification_sent: true, notified_at: notifiedAt })
    }
    if (!unit.contact_email) {
      showToast(`No contact email on file for ${unit.unit_name} — add one in unit settings. ${unnotified.length} match${unnotified.length !== 1 ? 'es' : ''} marked as notified.`)
    } else {
      showToast(`Email opened for ${unit.unit_name}. ${unnotified.length} student${unnotified.length !== 1 ? 's' : ''} marked as notified.`)
    }
  }

  return (
    <>
      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', top:80, right:24, zIndex:9999,
          background:'var(--nightfall)', color:'var(--pearl)',
          fontSize:13, fontWeight:500, padding:'10px 16px',
          borderRadius:6, boxShadow:'0 4px 16px rgba(0,0,0,0.25)',
          maxWidth:340, lineHeight:1.5,
        }}>{toast}</div>
      )}

      <div className="euc-card" style={{
        background: bgTint,
        border: choiceStyle
          ? `2px solid ${choiceStyle.accentBorder}`
          : isFocusedUnit
          ? '2px solid #1D2567'
          : selectedStudent
          ? '1px solid #f3f4f6'
          : '1px solid #e0e7ff',
        boxShadow: isFocusedUnit
          ? '0 0 0 3px rgba(29,37,103,0.18)'
          : isHighlighted ? '0 0 0 2px var(--nightfall), 0 0 0 4px rgba(29,37,103,0.3)' : undefined,
        opacity: selectedStudent && !compat && !isFull ? 0.82 : 1,
        animation: isHighlighted ? 'unit-highlight 2s ease-out' : undefined,
        transition: 'all 0.2s ease',
        cursor: !selectedStudent ? 'pointer' : undefined,
      }}
        onClick={!selectedStudent ? () => onFocusUnit?.() : undefined}
      >
        {/* Header — always Nightfall regardless of choice level */}
        <div className="euc-header" style={{
          background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
        }}>
          <span className="euc-name" title={unit.unit_name} style={{ display:'flex', flexDirection:'column', gap:1, minWidth:0 }}>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{unit.unit_name}</span>
            {getUnit(unit.unit_name)?.description && (
              <span style={{ fontSize:10, fontWeight:400, opacity:0.7, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {getUnit(unit.unit_name).description}
              </span>
            )}
          </span>
          <div className="euc-header-right">
            {choiceStyle && (
              <span style={{ background: choiceStyle.badgeBg, fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color: choiceStyle.badgeText, padding:'2px 8px', borderRadius:'999px', flexShrink:0, whiteSpace:'nowrap' }}>
                {choiceStyle.label}
              </span>
            )}
            {fillBadge}
            {/* Notify Unit Leader button / All Notified badge */}
            {filledCount > 0 && (
              allNotified
                ? <span style={{ fontSize:11, fontWeight:500, color:'#166534', whiteSpace:'nowrap' }}>✓ All Notified</span>
                : <button
                    onClick={handleNotifyAll}
                    style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:4,
                      border:'1.5px solid var(--nightfall)', background:'var(--pearl)',
                      color:'var(--nightfall)', cursor:'pointer', display:'flex',
                      alignItems:'center', gap:4, whiteSpace:'nowrap', flexShrink:0 }}>
                    ✉ {someNotified ? 'Notify Remaining' : 'Notify Unit Leader'}
                  </button>
            )}
            <button className="euc-del-btn" onClick={() => setConfirmDelete(true)} title="Delete unit">✕</button>
          </div>
        </div>

        {/* Slots */}
        <div className="euc-slots">
          {matchedStudents.map(raw => {
            const match   = matches.find(m => m.student_id === raw.id && m.unit_id === unit.id)
            const student = resolveMatchedStudent(match, null, studentMap) || raw
            return (
              <FilledSlotPill
                key={student.id}
                student={student}
                match={match}
                unit={unit}
                onUnmatch={() => setConfirmUnmatch(student)}
                onUpdateMatch={onUpdateMatch}
                onNotify={handleNotifyOne}
              />
            )
          })}
          {Array.from({ length: emptyCount }).map((_, i) => (
            <EmptySlotPill
              key={i}
              selectedStudent={selectedStudent}
              compat={compat}
              onClick={selectedStudent ? onSlotClick : undefined}
            />
          ))}
        </div>

        {/* Notification summary */}
        {filledCount > 0 && (
          <div style={{ fontSize:11, color:'#6b7280', padding:'6px 14px 10px', borderTop:'1px solid var(--border-lt)' }}>
            {notifiedCount} of {filledCount} placement{filledCount !== 1 ? 's' : ''} notified
          </div>
        )}
      </div>

      {/* Unmatch confirmation */}
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

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete {unit.unit_name}?</h2>
              <button className="modal-close" onClick={() => setConfirmDelete(false)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-delete-warning">This action cannot be undone. Any students matched to this unit will be returned to unmatched.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-modal" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-destructive-filled" onClick={() => { setConfirmDelete(false); onDelete?.() }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FilledSlotPill({ student, match, unit, onUnmatch, onNotify }) {
  const qKey = student.unit_preference_1 === unit.unit_name ? '1st'
    : student.unit_preference_2 === unit.unit_name ? '2nd'
    : student.unit_preference_3 === unit.unit_name ? '3rd'
    : 'other'
  const qCfg = MATCH_QUALITY_CONFIG[qKey]

  const isNotified   = !!match?.notification_sent
  const hasPreceptor = !!student.matched_preceptor
  const hasShift     = !!student.shift_assigned

  return (
    <div style={{ background:'#ffffff', border:'1px solid #f3f4f6', borderRadius:'8px', padding:'8px 10px', marginBottom:'6px' }}>
      {/* Row 1: avatar + name + notification + unmatch */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'5px' }}>
        <StudentAvatar student={student} size={28} />
        <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'12px', color:'#1D2567', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {student.first_name} {student.last_name}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
          {isNotified ? (
            <span style={{ fontFamily:'DM Sans', fontSize:'10px', fontWeight:600, color:'#16a34a' }}>✓</span>
          ) : (
            <>
              <span style={{ fontFamily:'DM Sans', fontSize:'9px', color:'#d97706' }}>⚠</span>
              <button title="Notify unit leader" onClick={e => { e.stopPropagation(); onNotify(student, match) }}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#6b7280', padding:'0 1px', lineHeight:1 }}>✉</button>
            </>
          )}
          <button className="euc-sf-unmatch" onClick={onUnmatch} title="Unmatch student">×</button>
        </div>
      </div>
      {/* Row 2: match quality + preceptor + shift */}
      <div style={{ display:'flex', alignItems:'center', gap:'5px', flexWrap:'wrap' }}>
        <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'9px', background:qCfg.bg, color:qCfg.color, border:`1px solid ${qCfg.border}`, padding:'1px 6px', borderRadius:'20px', flexShrink:0 }}>
          {qCfg.label}
        </span>
        <span style={{ fontFamily:'DM Sans', fontSize:'10px', color: hasPreceptor ? '#374151' : '#d97706' }}>
          {hasPreceptor ? `👤 ${student.matched_preceptor}` : '⚠ Preceptor needed'}
        </span>
        {hasShift && (
          <span style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#6b7280' }}>· {student.shift_assigned}</span>
        )}
      </div>
    </div>
  )
}

function EmptySlotPill({ selectedStudent, compat, onClick }) {
  const [hovered, setHovered] = useState(false)
  const isReady = !!selectedStudent && !!onClick

  return (
    <div
      onClick={isReady ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px dashed ${hovered && isReady ? '#94a3b8' : '#CBD5E1'}`,
        background: hovered && isReady ? '#f8fafc' : '#fafafa',
        borderRadius:'8px', padding:'8px 12px', marginBottom:'6px',
        cursor: isReady ? 'pointer' : 'default',
        display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
        transition:'all 0.15s ease',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'13px', color:'#94a3b8' }}>
        {isReady ? 'Place in this slot' : 'Open Slot'}
      </span>
    </div>
  )
}
