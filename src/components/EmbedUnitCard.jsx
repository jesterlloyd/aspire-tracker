import { useState, useRef } from 'react'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import { displayName } from '../lib/utils'
import { buildUnitLeaderEmail } from '../lib/emailUtils'
import { updateStudent } from '../lib/studentProxy'

const COMPAT_LABEL = {
  green:  { text: '★ 1st Choice', color: '#16a34a' },
  yellow: { text: '★ 2nd Choice', color: '#ca8a04' },
  blue:   { text: '★ 3rd Choice', color: '#0369a1' },
}

function openMailto(href) {
  const a = document.createElement('a')
  a.href = href
  a.click()
}

export default function EmbedUnitCard({
  unit, matchedStudents, matches, selectedStudent,
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
    ? (selectedStudent.unit_preference_1 === unit.unit_name ? 'green'
      : selectedStudent.unit_preference_2 === unit.unit_name ? 'yellow'
      : selectedStudent.unit_preference_3 === unit.unit_name ? 'blue'
      : null)
    : null

  const glow   = compat === 'green'  ? '0 0 0 3px #16a34a'
               : compat === 'yellow' ? '0 0 0 3px #ca8a04'
               : compat === 'blue'   ? '0 0 0 3px #0369a1'
               : undefined
  const bgTint = compat === 'green'  ? '#f0fdf4'
               : compat === 'yellow' ? '#fefce8'
               : compat === 'blue'   ? '#eff6ff'
               : '#ffffff'
  const compatInfo = compat ? COMPAT_LABEL[compat] : null

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
    openMailto(mailto)
    if (!unit.contact_email) {
      showToast(`No email address found for ${unit.unit_name}. Please add a contact email in unit settings.`)
      return
    }
    if (match) {
      const notifiedAt = new Date().toISOString()
      await onUpdateMatch(match.id, student.id, { notification_sent: true, notified_at: notifiedAt })
    }
    showToast(`Email opened for ${displayName(student)}. Marked as notified.`)
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
    openMailto(mailto)
    if (!unit.contact_email) {
      showToast(`No email address found for ${unit.unit_name}. Please add a contact email in unit settings.`)
      return
    }
    const notifiedAt = new Date().toISOString()
    for (const s of unnotified) {
      const m = matches.find(m => m.student_id === s.id && m.unit_id === unit.id)
      if (m) await onUpdateMatch(m.id, s.id, { notification_sent: true, notified_at: notifiedAt })
    }
    showToast(`Email opened for ${unit.unit_name}. ${unnotified.length} student${unnotified.length !== 1 ? 's' : ''} marked as notified.`)
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
        boxShadow: isHighlighted ? '0 0 0 2px var(--nightfall), 0 0 0 4px rgba(29,37,103,0.3)' : glow,
        opacity: selectedStudent && isFull ? 0.5 : 1,
        animation: isHighlighted ? 'unit-highlight 2s ease-out' : undefined,
      }}>
        {/* Header */}
        <div className="euc-header">
          <span className="euc-name" title={unit.unit_name}>{unit.unit_name}</span>
          <div className="euc-header-right">
            {compatInfo && (
              <span className="euc-compat-label" style={{ color: compatInfo.color }}>
                {compatInfo.text}
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
          {matchedStudents.map(student => {
            const match = matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
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

function FilledSlotPill({ student, match, unit, onUnmatch, onUpdateMatch, onNotify }) {
  const [preceptor, setPreceptor] = useState(match?.preceptor_assigned || '')
  const [shift,     setShift]     = useState(match?.shift_assigned     || '')
  const timerRef = useRef(null)

  const quality = student.unit_preference_1 === unit.unit_name ? 'top'
    : student.unit_preference_2 === unit.unit_name ? '2nd'
    : student.unit_preference_3 === unit.unit_name ? '3rd'
    : null
  const qBadge = quality === 'top' ? { text:'★ 1st', bg:'#dcfce7', color:'#166534' }
    : quality === '2nd'             ? { text:'★ 2nd', bg:'#fef3c7', color:'#92400e' }
    : quality === '3rd'             ? { text:'★ 3rd', bg:'#eff6ff', color:'#0369a1' }
    : null

  const savePreceptor = val => {
    setPreceptor(val)
    if (!match) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onUpdateMatch(match.id, student.id, { preceptor_assigned: val })
      updateStudent(student.id, { matched_preceptor: val })
        .catch(err => console.error('preceptor proxy save:', err.message))
    }, 500)
  }
  const saveShift = val => {
    setShift(val)
    if (match) {
      onUpdateMatch(match.id, student.id, { shift_assigned: val })
      updateStudent(student.id, { shift_assigned: val })
        .catch(err => console.error('shift proxy save:', err.message))
    }
  }

  const isNotified  = !!match?.notification_sent
  const notifiedDate = match?.notified_at
    ? new Date(match.notified_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : null

  return (
    <div className="euc-slot-filled">
      <div className="euc-sf-top">
        <div className="euc-sf-left" style={{ flex:1, minWidth:0 }}>
          {qBadge && (
            <span className="euc-quality-star" style={{ background: qBadge.bg, color: qBadge.color }}>
              {qBadge.text}
            </span>
          )}
          <span className="euc-sf-name">{displayName(student)}</span>
          {isNotified && notifiedDate && (
            <span style={{ fontSize:10, color:'#166534', marginTop:1 }}>Notified {notifiedDate}</span>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
          {isNotified
            ? <span title={`Unit leader notified on ${notifiedDate}`}
                style={{ fontSize:12, color:'#166534', lineHeight:1, cursor:'default' }}>✓</span>
            : <button
                title="Notify unit leader about this placement"
                onClick={e => { e.stopPropagation(); onNotify(student, match) }}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#6b7280', padding:'0 2px', lineHeight:1 }}>
                ✉
              </button>
          }
          <button className="euc-sf-unmatch" onClick={onUnmatch} title="Unmatch student">×</button>
        </div>
      </div>
      <div className="euc-sf-row">
        <span className="euc-sf-lbl">Preceptor:</span>
        <input
          className="euc-sf-input"
          value={preceptor}
          onChange={e => savePreceptor(e.target.value)}
          placeholder="Assign preceptor…"
          onClick={e => e.stopPropagation()}
        />
      </div>
      <div className="euc-sf-row">
        <span className="euc-sf-lbl">Shift:</span>
        <select className="euc-sf-select" value={shift} onChange={e => saveShift(e.target.value)} onClick={e => e.stopPropagation()}>
          <option value="">—</option>
          <option value="Day">Day</option>
          <option value="Night">Night</option>
          <option value="Either">Either</option>
          <option value="Day and Night">Day and Night</option>
        </select>
      </div>
    </div>
  )
}

function EmptySlotPill({ selectedStudent, compat, onClick }) {
  const [showTip, setShowTip] = useState(false)
  const isReady = !!selectedStudent && !!onClick

  const tipQuality = compat === 'green'  ? 'Perfect match'
                   : compat === 'yellow' ? '2nd choice'
                   : compat === 'blue'   ? '3rd choice'
                   : ''

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => isReady && setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}>
      <div
        className={`euc-slot-empty${isReady ? ' euc-slot-ready' : ''}`}
        onClick={isReady ? onClick : undefined}>
        {isReady
          ? `Match ${displayName(selectedStudent)} here →`
          : '+ Open Slot'}
      </div>
      {showTip && (
        <div className="euc-slot-tooltip">
          <div>Match {displayName(selectedStudent)} here</div>
          {tipQuality && <div style={{ fontSize:10, opacity:0.8, marginTop:2 }}>{tipQuality}</div>}
        </div>
      )}
    </div>
  )
}
