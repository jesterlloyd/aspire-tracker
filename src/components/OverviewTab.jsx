import { useState } from 'react'
import { displayName } from '../lib/utils'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_CONFIG } from '../lib/constants'

const DIVISIONS = ['Surgical', 'Medical', 'Critical Care', 'Specialty']

const FORM_SUBJECT = 'Complete Your ASPIRE Intake Form | Cedars-Sinai'
const buildFormBody = (recipientName = 'ASPIRE Student') =>
`Dear ${recipientName},

Welcome to the ASPIRE Program at Cedars-Sinai. Your final semester is here, and we are excited to support your transition into practice.

Please complete your ASPIRE Intake Form using the link below. This form helps us learn your goals and unit interests and is the first step in matching you with the right clinical environment and preceptor.

Complete your form here: https://aspire-tracker.vercel.app/student-form

What happens next: After you submit, our team will invite you to a brief interview with Nursing Professional Development. From there, we will collaborate with unit leaders to match you with a unit and preceptor, then schedule you for orientation.

This link is for your use only. Please do not share or forward this email.

If you have any questions, simply reply to this email. We are here to help.

Warm regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Brawerman Nursing Institute | Cedars-Sinai Medical Center`

function openMailto(bcc, body) {
  const a = document.createElement('a')
  a.href = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(FORM_SUBJECT)}&body=${encodeURIComponent(body)}`
  a.click()
}

export default function OverviewTab({ students, units, onStudentUpdate }) {
  const [unitGroupsOpen,   setUnitGroupsOpen]   = useState({})
  const [schoolGroupsOpen, setSchoolGroupsOpen] = useState({})
  const [toast,            setToast]            = useState(null)
  const [imgErrors,        setImgErrors]        = useState({})

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Derived values ──────────────────────────────────────────
  const participating  = units.filter(u => u.is_participating)
  const totalSlots     = participating.reduce((s, u) => s + (u.total_slots     || 0), 0)
  const slotsRemaining = participating.reduce((s, u) => s + (u.slots_remaining || 0), 0)
  const totalStudents  = students.length
  const slotsFilled    = students.filter(s => s.matched_unit_id).length
  const placedCount    = slotsFilled
  const netRemaining   = totalSlots - slotsFilled
  const gap            = Math.abs(totalStudents - totalSlots)
  const isShort        = totalStudents > totalSlots

  // Map how many students are matched to each unit (by unit id)
  const filledByUnit = {}
  students.forEach(s => {
    if (s.matched_unit_id)
      filledByUnit[s.matched_unit_id] = (filledByUnit[s.matched_unit_id] || 0) + 1
  })

  // ── Unit grouping ──────────────────────────────────────────
  const unitsByDiv = {}
  DIVISIONS.forEach(d => { unitsByDiv[d] = [] })
  participating.forEach(u => {
    const div = u.division || UNIT_DIVISION_MAP[u.unit_name] || 'Medical'
    if (!unitsByDiv[div]) unitsByDiv[div] = []
    unitsByDiv[div].push(u)
  })
  Object.keys(unitsByDiv).forEach(div =>
    unitsByDiv[div].sort((a, b) => (a.unit_name || '').localeCompare(b.unit_name || ''))
  )

  const toggleUnitGroup   = div => setUnitGroupsOpen(p => ({ ...p, [div]: !p[div] }))
  const expandAllUnits    = () => setUnitGroupsOpen(Object.fromEntries(DIVISIONS.map(d => [d, true])))
  const collapseAllUnits  = () => setUnitGroupsOpen({})

  // ── School grouping ────────────────────────────────────────
  const schoolMap = {}
  students.forEach(s => {
    const key = s.school || 'Unknown School'
    if (!schoolMap[key]) schoolMap[key] = []
    schoolMap[key].push(s)
  })
  const schools = Object.keys(schoolMap).sort()

  const toggleSchoolGroup  = school => setSchoolGroupsOpen(p => ({ ...p, [school]: !p[school] }))
  const expandAllSchools   = () => setSchoolGroupsOpen(Object.fromEntries(schools.map(s => [s, true])))
  const collapseAllSchools = () => setSchoolGroupsOpen({})

  const getCoordinator = sStudents => {
    for (let i = sStudents.length - 1; i >= 0; i--) {
      const s = sStudents[i]
      if (s.school_coordinator_name)
        return { name: s.school_coordinator_name, email: s.school_coordinator_email }
    }
    return null
  }

  const handleSendSchool = async (school, sStudents) => {
    const emails = sStudents.map(s => s.school_email).filter(Boolean)
    openMailto(emails.join(';'), buildFormBody())
    if (onStudentUpdate)
      for (const s of sStudents) await onStudentUpdate(s.id, { status: 'Form Sent' })
    showToast(`Form sent to ${school}. Status updated to Form Sent.`)
  }

  const handleSendStudent = async student => {
    openMailto(student.school_email, buildFormBody(student.first_name || 'ASPIRE Student'))
    if (onStudentUpdate) await onStudentUpdate(student.id, { status: 'Form Sent' })
    showToast(`Form sent to ${displayName(student)}. Status updated to Form Sent.`)
  }

  // ── Hero card helper ───────────────────────────────────────
  const HeroCard = ({ value, label, bg, valueColor = 'var(--nightfall)', borderColor = 'var(--nightfall)' }) => (
    <div className="ov-hero-card" style={{ background: bg, borderLeft: `4px solid ${borderColor}` }}>
      <div className="ov-hero-num" style={{ color: valueColor }}>{value}</div>
      <div className="ov-hero-label" style={{ color: valueColor }}>{label}</div>
    </div>
  )

  return (
    <div className="overview-tab">
      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', top:80, right:24, zIndex:9999,
          background:'var(--nightfall)', color:'var(--pearl)',
          fontSize:14, fontWeight:500, padding:'12px 18px',
          borderRadius:6, boxShadow:'0 4px 16px rgba(0,0,0,0.25)', maxWidth:360,
        }}>{toast}</div>
      )}

      {/* ── Five hero cards ── */}
      <div className="ov-hero">
        <HeroCard value={totalSlots}    label="Total Slots"        bg="var(--pearl)"   />
        <HeroCard value={slotsFilled}   label="Slots Filled"       bg="#dcfce7"        valueColor="#166534" borderColor="#166534" />
        <HeroCard
          value={Math.max(0, netRemaining)} label="Slots Remaining"
          bg={netRemaining <= 0 ? '#fee2e2' : 'var(--marina)'}
          valueColor={netRemaining <= 0 ? '#991b1b' : 'var(--nightfall)'}
          borderColor={netRemaining <= 0 ? '#991b1b' : 'var(--nightfall)'}
        />
        <HeroCard value={totalStudents} label="Students Requesting" bg="var(--sand)"  valueColor="var(--raven)" borderColor="var(--raven)" />
        <HeroCard
          value={gap}
          label={isShort ? 'spots short' : 'fully covered'}
          bg={isShort ? '#fef3c7' : '#dcfce7'}
          valueColor={isShort ? '#92400e' : '#166534'}
          borderColor={isShort ? '#92400e' : '#166534'}
        />
      </div>

      <div className="ov-panels">

        {/* ── Clinical Placement Availability ── */}
        <div className="ov-panel">
          <div className="ov-panel-header">
            <div>
              <div className="ov-panel-title">Clinical Placement Availability</div>
              <div className="ov-panel-sub">
                {participating.length} Units · {totalSlots} Total Slots · {slotsRemaining} Remaining
              </div>
            </div>
            <div className="ov-expand-toggle">
              <button onClick={expandAllUnits}>Expand All</button>
              <span style={{ color:'var(--border)' }}>·</span>
              <button onClick={collapseAllUnits}>Collapse All</button>
            </div>
          </div>

          <div className="ov-groups">
            {DIVISIONS.map(div => {
              const divUnits = unitsByDiv[div] || []
              if (divUnits.length === 0) return null
              const open       = unitGroupsOpen[div]
              const divTotal   = divUnits.reduce((s, u) => s + (u.total_slots  || 0), 0)
              const divFilled  = divUnits.reduce((s, u) => s + (filledByUnit[u.id] || 0), 0)
              const divRemain  = divTotal - divFilled
              const divFull    = divRemain <= 0
              const divLow     = !divFull && divRemain <= divUnits.length
              const divBadgeBg    = divFull ? '#fee2e2' : divLow ? '#fef3c7' : '#dcfce7'
              const divBadgeColor = divFull ? '#991b1b' : divLow ? '#92400e' : '#166534'

              return (
                <div key={div} className="ov-group">
                  <div className="ov-group-row" onClick={() => toggleUnitGroup(div)}>
                    <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                    <span className="ov-group-name">{div}</span>
                    <span className="ov-group-badge" style={{ background: divBadgeBg, color: divBadgeColor }}>
                      {divFilled}/{divTotal} filled
                    </span>
                  </div>

                  {open && (
                    <div className="ov-group-items">
                      {divUnits.map(u => {
                        const filled    = filledByUnit[u.id] || 0
                        const total     = u.total_slots || 0
                        const remaining = total - filled
                        const isFull    = remaining <= 0
                        const isLow     = !isFull && remaining === 1
                        const slotBg    = isFull ? '#fee2e2' : isLow ? '#fef3c7' : '#dcfce7'
                        const slotColor = isFull ? '#991b1b' : isLow ? '#92400e' : '#166534'

                        return (
                          <div key={u.id} className="ov-unit-row"
                            style={{ background: isFull ? 'var(--sand)' : undefined }}>
                            <div className="ov-unit-info">
                              <span className="ov-unit-name">{u.unit_name}</span>
                              {u.contact_person && (
                                <span className="ov-unit-contact">{u.contact_person}</span>
                              )}
                              {/* Slot dots: filled = solid nightfall, open = dashed marina */}
                              <div style={{ display:'flex', gap:5, marginTop:4, flexWrap:'wrap' }}>
                                {Array.from({ length: total }, (_, i) => (
                                  <span key={i} style={{
                                    width:11, height:11, borderRadius:'50%', flexShrink:0,
                                    background:  i < filled ? 'var(--nightfall)' : 'transparent',
                                    border:      `1.5px ${i < filled ? 'solid var(--nightfall)' : 'dashed #b8d8eb'}`,
                                    display:'inline-block',
                                  }} />
                                ))}
                              </div>
                            </div>
                            <div className="ov-unit-badges">
                              {isFull && (
                                <span style={{ background:'#9ca3af', color:'#fff', fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap' }}>
                                  Full
                                </span>
                              )}
                              <span style={{ background:slotBg, color:slotColor, fontSize:12, fontWeight:500, padding:'2px 8px', borderRadius:4, whiteSpace:'nowrap' }}>
                                {filled} of {total} filled
                              </span>
                              {u.shift_preference && (
                                <span className="ov-shift-badge">{u.shift_preference}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {participating.length === 0 && (
              <p className="ov-empty">No participating units set up for this cohort.</p>
            )}
          </div>
        </div>

        {/* ── Student Placement Requests ── */}
        <div className="ov-panel">
          <div className="ov-panel-header">
            <div>
              <div className="ov-panel-title">Student Placement Requests</div>
              <div className="ov-panel-sub">
                {schools.length} School{schools.length !== 1 ? 's' : ''} · {totalStudents} Students · {placedCount} Placed
              </div>
            </div>
            <div className="ov-expand-toggle">
              <button onClick={expandAllSchools}>Expand All</button>
              <span style={{ color:'var(--border)' }}>·</span>
              <button onClick={collapseAllSchools}>Collapse All</button>
            </div>
          </div>

          <div className="ov-groups">
            {schools.map(school => {
              const sStudents = schoolMap[school]
              const open      = schoolGroupsOpen[school]
              const coord     = getCoordinator(sStudents)
              const placed    = sStudents.filter(s => s.matched_unit_id).length

              return (
                <div key={school} className="ov-group">
                  <div className="ov-group-row" onClick={() => toggleSchoolGroup(school)}>
                    <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <span className="ov-group-name">{school}</span>
                      {/* Coordinator info — always shown (Part 5) */}
                      {coord && (coord.name || coord.email) && (
                        <div className="ov-coord-line">
                          {coord.name}{coord.name && coord.email ? ' | ' : ''}{coord.email}
                        </div>
                      )}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                      {placed > 0 && (
                        <span style={{ background:'#dcfce7', color:'#166534', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>
                          {placed} placed
                        </span>
                      )}
                      <span className="ov-group-badge">
                        {sStudents.length} student{sStudents.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {open && (
                    <div className="ov-group-items">
                      <div className="ov-school-actions">
                        <button className="ov-send-btn"
                          onClick={e => { e.stopPropagation(); handleSendSchool(school, sStudents) }}>
                          Send Form to School
                        </button>
                      </div>
                      {[...sStudents].sort((a, b) => {
                        const la = (a.last_name || a.name || '').toLowerCase()
                        const lb = (b.last_name || b.name || '').toLowerCase()
                        if (la !== lb) return la.localeCompare(lb)
                        return (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase())
                      }).map(s => {
                        const statusCfg  = ASPIRE_STATUS_CONFIG[s.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
                        const placedUnit = s.matched_unit_id ? units.find(u => u.id === s.matched_unit_id)?.unit_name : null
                        const initials   = `${(s.first_name||'')[0]||''}${(s.last_name||'')[0]||''}`.toUpperCase() || '?'
                        return (
                          <div key={s.id} className="ov-student-row">
                            {/* Avatar */}
                            {s.headshot_url && !imgErrors[s.id]
                              ? <img src={s.headshot_url} alt="" onError={() => setImgErrors(p => ({...p, [s.id]:true}))}
                                  style={{ width:32, height:32, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                              : <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--nightfall)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{initials}</div>
                            }
                            {/* Info */}
                            <div className="ov-student-info" style={{ flex:1 }}>
                              <span className="ov-student-name">{displayName(s)}</span>
                              {s.personal_email && <span className="ov-student-contact">{s.personal_email}</span>}
                              {s.phone && <span style={{ fontSize:12, color:'#9ca3af' }}>{s.phone}</span>}
                            </div>
                            {/* Right: ASPIRE status + placed + send button */}
                            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                              {s.status && (
                                <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:statusCfg.bg, color:statusCfg.text, border:`1px solid ${statusCfg.border}`, whiteSpace:'nowrap' }}>
                                  {s.status}
                                </span>
                              )}
                              {placedUnit && (
                                <span style={{ fontSize:11, color:'#166534', whiteSpace:'nowrap' }}>
                                  Placed: {placedUnit}
                                </span>
                              )}
                              <button className="ov-send-btn ov-send-btn-sm"
                                onClick={e => { e.stopPropagation(); handleSendStudent(s) }}>
                                Send Form
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {students.length === 0 && (
              <p className="ov-empty">No students in this cohort yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
