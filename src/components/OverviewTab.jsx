import { useState } from 'react'
import { displayName } from '../lib/utils'

const DIVISIONS = ['Surgical', 'Medical', 'Critical Care', 'Specialty']

function getDivision(unitName) {
  const n = (unitName || '').toLowerCase()
  if (n.includes('icu') || n.includes('ccu') || n.includes('scct') || n.includes('cmc') || n.includes('critical')) return 'Critical Care'
  if (n.includes('labor') || n.includes('delivery') || n.includes('nicu') || n.includes('picu') ||
      n.includes('pediatric') || n.includes('pacu') || n.includes('postpartum') ||
      n.includes('float') || n.includes('ob/') || n.includes('ob ')) return 'Specialty'
  if (n.includes('surgical') || n.includes('surgery') || n.includes('operating') ||
      n.includes('orthopedic') || n.includes('spine') || n.includes('neuro') ||
      n.includes('plastics') || n.includes('reconstruct')) return 'Surgical'
  return 'Medical'
}

export default function OverviewTab({ students, units }) {
  const participating = units.filter(u => u.is_participating)
  const totalSlots    = participating.reduce((s, u) => s + (u.total_slots || 0), 0)
  const totalStudents = students.length
  const gap           = totalSlots - totalStudents

  // Unit Supply — group by division
  const [unitGroupsOpen,   setUnitGroupsOpen]   = useState({})
  const [schoolGroupsOpen, setSchoolGroupsOpen] = useState({})

  const unitsByDiv = {}
  DIVISIONS.forEach(d => { unitsByDiv[d] = [] })
  participating.forEach(u => {
    const div = getDivision(u.unit_name)
    unitsByDiv[div] = [...(unitsByDiv[div] || []), u]
  })

  const toggleUnitGroup = div =>
    setUnitGroupsOpen(p => ({ ...p, [div]: !p[div] }))
  const expandAllUnits  = () => setUnitGroupsOpen(Object.fromEntries(DIVISIONS.map(d => [d, true])))
  const collapseAllUnits = () => setUnitGroupsOpen({})

  // Student Demand — group by school
  const schoolMap = {}
  students.forEach(s => {
    const key = s.school || 'Unknown School'
    schoolMap[key] = [...(schoolMap[key] || []), s]
  })
  const schools = Object.keys(schoolMap).sort()

  const toggleSchoolGroup = school =>
    setSchoolGroupsOpen(p => ({ ...p, [school]: !p[school] }))
  const expandAllSchools  = () => setSchoolGroupsOpen(Object.fromEntries(schools.map(s => [s, true])))
  const collapseAllSchools = () => setSchoolGroupsOpen({})

  // Gap card config
  const gapBg    = gap === 0 ? '#dcfce7' : gap > 0 ? '#dcfce7' : '#fef3c7'
  const gapColor = gap === 0 ? '#166534' : gap > 0 ? '#166534' : '#92400e'
  const gapLabel = gap === 0 ? 'Fully matched' : gap > 0 ? `${gap} spot${gap !== 1 ? 's' : ''} open` : `${Math.abs(gap)} spot${Math.abs(gap) !== 1 ? 's' : ''} short`

  return (
    <div className="overview-tab">

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

      {/* ── Two-panel row ── */}
      <div className="ov-panels">

        {/* ── Left: Unit Supply ── */}
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
              const open = unitGroupsOpen[div]
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

        {/* ── Right: Student Demand ── */}
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
              return (
                <div key={school} className="ov-group">
                  <div className="ov-group-row" onClick={() => toggleSchoolGroup(school)}>
                    <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                    <span className="ov-group-name">{school}</span>
                    <span className="ov-group-badge">{sStudents.length} student{sStudents.length !== 1 ? 's' : ''}</span>
                  </div>
                  {open && (
                    <div className="ov-group-items">
                      {sStudents.map(s => (
                        <div key={s.id} className="ov-student-row">
                          <div className="ov-student-info">
                            <span className="ov-student-name">{displayName(s)}</span>
                            <span className="ov-student-meta">
                              {[s.program_type, s.term_dates].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                          {s.hours_required > 0 && (
                            <span className="ov-hours-badge">{s.hours_required} hrs</span>
                          )}
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
