import { useState } from 'react'
import { displayName } from '../lib/utils'
import { UNIT_DIVISION_MAP } from '../lib/constants'

const DIVISIONS = ['Surgical Division', 'Medical Division', 'Critical Care Division', 'Specialty']

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
  const participating = units.filter(u => u.is_participating)
  const totalSlots    = participating.reduce((s, u) => s + (u.total_slots || 0), 0)
  const totalStudents = students.length
  const gap           = totalSlots - totalStudents

  const [unitGroupsOpen,   setUnitGroupsOpen]   = useState({})
  const [schoolGroupsOpen, setSchoolGroupsOpen] = useState({})
  const [toast, setToast] = useState(null)

  const showToast = msg => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // Unit Supply — exact division lookup
  const unitsByDiv = {}
  DIVISIONS.forEach(d => { unitsByDiv[d] = [] })
  participating.forEach(u => {
    const div = UNIT_DIVISION_MAP[u.unit_name] || 'Medical Division'
    if (!unitsByDiv[div]) unitsByDiv[div] = []
    unitsByDiv[div].push(u)
  })

  const toggleUnitGroup   = div => setUnitGroupsOpen(p => ({ ...p, [div]: !p[div] }))
  const expandAllUnits    = () => setUnitGroupsOpen(Object.fromEntries(DIVISIONS.map(d => [d, true])))
  const collapseAllUnits  = () => setUnitGroupsOpen({})

  // Student Demand — group by school
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
      if (s.school_coordinator_name) return { name: s.school_coordinator_name, email: s.school_coordinator_email }
    }
    return null
  }

  const handleSendSchool = async (school, sStudents) => {
    const emails = sStudents.map(s => s.school_email).filter(Boolean)
    openMailto(emails.join(';'), buildFormBody())
    if (onStudentUpdate) {
      for (const s of sStudents) {
        await onStudentUpdate(s.id, { status: 'Form Sent' })
      }
    }
    showToast(`Form sent to ${school}. Status updated to Form Sent.`)
  }

  const handleSendStudent = async student => {
    openMailto(student.school_email, buildFormBody(student.first_name || 'ASPIRE Student'))
    if (onStudentUpdate) await onStudentUpdate(student.id, { status: 'Form Sent' })
    showToast(`Form sent to ${displayName(student)}. Status updated to Form Sent.`)
  }

  const gapBg    = gap === 0 ? '#dcfce7' : gap > 0 ? '#dcfce7' : '#fef3c7'
  const gapColor = gap === 0 ? '#166534' : gap > 0 ? '#166534' : '#92400e'
  const gapLabel = gap === 0
    ? 'Fully matched'
    : gap > 0 ? `${gap} spot${gap !== 1 ? 's' : ''} open`
    : `${Math.abs(gap)} spot${Math.abs(gap) !== 1 ? 's' : ''} short`

  return (
    <div className="overview-tab">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 80, right: 24, zIndex: 9999,
          background: 'var(--nightfall)', color: 'var(--pearl)',
          fontSize: 14, fontWeight: 500, padding: '12px 18px',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          maxWidth: 360,
        }}>
          {toast}
        </div>
      )}

      {/* ── Hero bar ── */}
      <div className="ov-hero">
        <div className="ov-hero-card" style={{ background: 'var(--nightfall)' }}>
          <div className="ov-hero-num" style={{ color: 'var(--pearl)' }}>{totalSlots}</div>
          <div className="ov-hero-label" style={{ color: 'rgba(255,255,255,0.75)' }}>ASPIRE Spots Available</div>
        </div>
        <div className="ov-hero-card" style={{ background: 'var(--marina)' }}>
          <div className="ov-hero-num" style={{ color: 'var(--nightfall)' }}>{totalStudents}</div>
          <div className="ov-hero-label" style={{ color: 'var(--nightfall)', opacity: 0.75 }}>Student Requests</div>
        </div>
        <div className="ov-hero-card" style={{ background: gapBg }}>
          <div className="ov-hero-num" style={{ color: gapColor }}>{Math.abs(gap)}</div>
          <div className="ov-hero-label" style={{ color: gapColor, opacity: 0.85 }}>{gapLabel}</div>
        </div>
      </div>

      <div className="ov-panels">

        {/* ── Unit Supply ── */}
        <div className="ov-panel">
          <div className="ov-panel-header">
            <div>
              <div className="ov-panel-title">Unit Supply</div>
              <div className="ov-panel-sub">{participating.length} Units · {totalSlots} Slots Available</div>
            </div>
            <div className="ov-expand-toggle">
              <button onClick={expandAllUnits}>Expand All</button>
              <span style={{ color: 'var(--border)' }}>·</span>
              <button onClick={collapseAllUnits}>Collapse All</button>
            </div>
          </div>
          <div className="ov-groups">
            {DIVISIONS.map(div => {
              const divUnits = unitsByDiv[div] || []
              if (divUnits.length === 0) return null
              const open      = unitGroupsOpen[div]
              const slotTotal = divUnits.reduce((s, u) => s + (u.total_slots || 0), 0)
              return (
                <div key={div} className="ov-group">
                  <div className="ov-group-row" onClick={() => toggleUnitGroup(div)}>
                    <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                    <span className="ov-group-name">{div}</span>
                    <span className="ov-group-badge">{slotTotal} slot{slotTotal !== 1 ? 's' : ''}</span>
                  </div>
                  {open && (
                    <div className="ov-group-items">
                      {divUnits.map(u => (
                        <div key={u.id} className="ov-unit-row">
                          <div className="ov-unit-info">
                            <span className="ov-unit-name">{u.unit_name}</span>
                            {u.patient_population && (
                              <span className="ov-unit-contact" style={{ fontStyle: 'italic' }}>{u.patient_population}</span>
                            )}
                            {u.contact_person && (
                              <span className="ov-unit-contact">{u.contact_person}</span>
                            )}
                          </div>
                          <div className="ov-unit-badges">
                            <span className="ov-slots-badge">{u.slots_remaining ?? u.total_slots} open</span>
                            {u.shift_preference && (
                              <span className="ov-shift-badge">{u.shift_preference}</span>
                            )}
                          </div>
                        </div>
                      ))}
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

        {/* ── Student Demand ── */}
        <div className="ov-panel">
          <div className="ov-panel-header">
            <div>
              <div className="ov-panel-title">Student Demand</div>
              <div className="ov-panel-sub">{schools.length} School{schools.length !== 1 ? 's' : ''} · {totalStudents} Students</div>
            </div>
            <div className="ov-expand-toggle">
              <button onClick={expandAllSchools}>Expand All</button>
              <span style={{ color: 'var(--border)' }}>·</span>
              <button onClick={collapseAllSchools}>Collapse All</button>
            </div>
          </div>
          <div className="ov-groups">
            {schools.map(school => {
              const sStudents = schoolMap[school]
              const open      = schoolGroupsOpen[school]
              const coord     = getCoordinator(sStudents)
              return (
                <div key={school} className="ov-group">
                  <div className="ov-group-row" onClick={() => toggleSchoolGroup(school)}>
                    <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="ov-group-name">{school}</span>
                      {coord && (
                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 1 }}>
                          {coord.name}{coord.email ? ` · ${coord.email}` : ''}
                        </div>
                      )}
                    </div>
                    <span className="ov-group-badge" style={{ flexShrink: 0 }}>
                      {sStudents.length} student{sStudents.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {open && (
                    <div className="ov-group-items">
                      <div className="ov-school-actions">
                        <button className="ov-send-btn"
                          onClick={e => { e.stopPropagation(); handleSendSchool(school, sStudents) }}>
                          Send Form to School
                        </button>
                      </div>
                      {sStudents.map(s => (
                        <div key={s.id} className="ov-student-row">
                          <div className="ov-student-info">
                            <span className="ov-student-name">{displayName(s)}</span>
                            <span className="ov-student-meta">
                              {[s.program_type, s.term_dates].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {s.hours_required > 0 && (
                              <span className="ov-hours-badge">{s.hours_required} hrs</span>
                            )}
                            <button className="ov-send-btn ov-send-btn-sm"
                              onClick={e => { e.stopPropagation(); handleSendStudent(s) }}>
                              Send Form
                            </button>
                          </div>
                        </div>
                      ))}
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
