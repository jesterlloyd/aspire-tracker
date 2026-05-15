import { useState } from 'react'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import { displayName } from '../lib/utils'
import { buildUnitLeaderEmail } from '../lib/emailUtils'
import { openMailtoLink } from '../lib/openLink'
import StudentAvatar from './StudentAvatar'

const resolveMatchedStudent = (match, slot, studentMap) => {
  if (match?.student?.first_name) return match.student
  if (match?.student_id && studentMap?.[match.student_id]) return studentMap[match.student_id]
  if (slot?.booked_by_student_id && studentMap?.[slot.booked_by_student_id]) return studentMap[slot.booked_by_student_id]
  return null
}

const CHOICE_STYLES = {
  '1st': { accentBorder:'#059669', badgeBg:'#D1FAE5', badgeText:'#065F46', bodyTint:'#F0FDF4', label:'★ 1st Choice' },
  '2nd': { accentBorder:'#B5895A', badgeBg:'#FCEFD4', badgeText:'#7C5A1F', bodyTint:'#FDF8EC', label:'★ 2nd Choice' },
  '3rd': { accentBorder:'#7C8FD9', badgeBg:'#E0E7FF', badgeText:'#3730A3', bodyTint:'#EFF3FE', label:'★ 3rd Choice' },
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
          : selectedStudent
          ? '1px solid #f3f4f6'
          : '1px solid #e0e7ff',
        boxShadow: isHighlighted ? '0 0 0 2px var(--nightfall), 0 0 0 4px rgba(29,37,103,0.3)' : undefined,
        opacity: selectedStudent && !compat && !isFull ? 0.82 : 1,
        animation: isHighlighted ? 'unit-highlight 2s ease-out' : undefined,
        transition: 'all 0.2s ease',
      }}>
        {/* Header — always Nightfall regardless of choice level */}
        <div className="euc-header" style={{
          background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
        }}>
          <span className="euc-name" title={unit.unit_name}>{unit.unit_name}</span>
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
    <div style={{ background:'#ffffff', border:'1px solid #f3f4f6', borderRadius:'8px', padding:'10px 12px', marginBottom:'6px' }}>
      {/* Match quality + notification */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
        <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', background:qCfg.bg, color:qCfg.color, border:`1px solid ${qCfg.border}`, padding:'2px 8px', borderRadius:'20px' }}>
          {qCfg.label}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <span style={{ fontFamily:'DM Sans', fontSize:'9px', fontWeight:600, color: isNotified ? '#16a34a' : '#d97706', display:'flex', alignItems:'center', gap:'3px' }}>
            {isNotified ? '✓ Unit notified' : '⚠ Notification pending'}
          </span>
          {!isNotified && (
            <button title="Notify unit leader" onClick={e => { e.stopPropagation(); onNotify(student, match) }}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'#6b7280', padding:'0 2px', lineHeight:1 }}>✉</button>
          )}
          <button className="euc-sf-unmatch" onClick={onUnmatch} title="Unmatch student">×</button>
        </div>
      </div>
      {/* Avatar + name row */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px' }}>
        <StudentAvatar student={student} size={36} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'12px', color:'#1D2567', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {student.first_name} {student.last_name}
          </div>
          {student.school && (
            <div style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#9ca3af', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {student.school}
            </div>
          )}
        </div>
      </div>
      {/* Preceptor + shift flags */}
      <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
        <span style={{ fontFamily:'DM Sans', fontSize:'9px', fontWeight:600, color: hasPreceptor ? '#374151' : '#d97706', background: hasPreceptor ? '#f3f4f6' : '#fffbeb', padding:'2px 7px', borderRadius:'20px' }}>
          {hasPreceptor ? `👤 ${student.matched_preceptor}` : '⚠ Preceptor needed'}
        </span>
        <span style={{ fontFamily:'DM Sans', fontSize:'9px', fontWeight:600, color: hasShift ? '#374151' : '#d97706', background: hasShift ? '#f3f4f6' : '#fffbeb', padding:'2px 7px', borderRadius:'20px' }}>
          {hasShift ? `${student.shift_assigned} shift` : '⚠ Shift not set'}
        </span>
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
        border: `1.5px dashed ${hovered && isReady ? '#a5b4fc' : '#c7d2fe'}`,
        background: hovered && isReady ? '#f0f3ff' : '#f8f9ff',
        borderRadius:'8px', padding:'8px 12px', marginBottom:'6px',
        cursor: isReady ? 'pointer' : 'default',
        display:'flex', alignItems:'center', justifyContent:'center', gap:'6px',
        transition:'all 0.15s ease',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color:'#a5b4fc' }}>
        {isReady ? 'Place in this slot' : 'Open Slot'}
      </span>
    </div>
  )
}
