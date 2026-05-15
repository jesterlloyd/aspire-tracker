import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_CONFIG } from '../lib/constants'
import StudentAvatar from './StudentAvatar'
import StatCard from './StatCard'
import CohortGantt from './CohortGantt'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import { Layers, CheckSquare, Clock, GraduationCap, AlertTriangle, MapPin, Users, Copy } from 'lucide-react'
import { calculatePriorities } from '../lib/priorities'

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

// All external navigation must use openLink helpers (src/lib/openLink.js)
function openMailto(bcc, body) {
  window.open(
    `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(FORM_SUBJECT)}&body=${encodeURIComponent(body)}`,
    '_blank'
  )
}

export default function OverviewTab({ students, units, onStudentUpdate, cohortId, cohort, toast }) {
  const [unitGroupsOpen,   setUnitGroupsOpen]   = useState({})
  const [schoolGroupsOpen, setSchoolGroupsOpen] = useState({})
  const [localToast,       setLocalToast]       = useState(null)
  const [campusOpen,       setCampusOpen]       = useState(false)
  const [campusLogs,       setCampusLogs]       = useState([])
  const [campusLoading,    setCampusLoading]    = useState(false)
  const [timelineExpanded, setTimelineExpanded] = useState(false)

  // Gantt data — cached across tab switches; only active when timeline is open
  const {
    data:      cohortEvents = [],
    isLoading: ganttLoading,
    error:     ganttErrorObj,
    refetch:   refetchGantt,
  } = useQuery({
    queryKey: ['program_events', cohortId],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('program_events').select('*').eq('cohort_id', cohortId)
      if (error) throw error
      return data || []
    },
    enabled:  !!cohortId && timelineExpanded,
  })
  const ganttError     = ganttErrorObj?.message ?? null
  const loadCohortEvents = refetchGantt

  const todayStr = (() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` })()

  const loadCampusLogs = async () => {
    if (!cohortId) return
    setCampusLoading(true)
    const { data } = await supabase.from('student_shift_logs')
      .select('*').eq('cohort_id', cohortId).eq('shift_date', todayStr).eq('status', 'approved')
    setCampusLogs(data || [])
    setCampusLoading(false)
    if ((data||[]).length > 0) setCampusOpen(true)
  }

  useEffect(() => { loadCampusLogs() }, [cohortId]) // eslint-disable-line

  const showToast = msg => { setLocalToast(msg); setTimeout(() => setLocalToast(null), 3000) }

  // ── Derived values ──────────────────────────────────────────
  const participating       = units.filter(u => u.is_participating)
  const totalSlots          = participating.reduce((s, u) => s + (u.total_slots     || 0), 0)
  const slotsRemaining      = participating.reduce((s, u) => s + (u.slots_remaining || 0), 0)
  const totalStudents       = students.length
  const slotsFilled         = students.filter(s => s.matched_unit_id).length
  const placedCount         = slotsFilled
  const netRemaining        = totalSlots - slotsFilled
  const gap                 = totalStudents - totalSlots  // positive = short on slots
  const isShort             = gap > 0
  const participatingUnits  = participating.length
  const studentsRequesting  = totalStudents
  const activeSchools       = Object.keys((() => { const m = {}; students.forEach(s => { if (s.school) m[s.school] = 1 }); return m })()).length
  const activeCount         = students.filter(s => s.status === 'Active Rotation').length
  const completedCount      = students.filter(s => s.status === 'Completed').length

  const handleCopyCohortSummary = async () => {
    const cohortName = cohort?.name || 'Unknown Cohort'
    const schoolCount = activeSchools
    const lines = [
      `ASPIRE ${cohortName} Cohort Summary`,
      `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      `Total Students: ${totalStudents}`,
      `Placed: ${placedCount} (${totalStudents ? Math.round((placedCount/totalStudents)*100) : 0}%)`,
      `Active Rotation: ${activeCount}`,
      `Completed: ${completedCount}`,
      `Open Slots: ${slotsRemaining} of ${totalSlots}`,
      `Schools: ${schoolCount} affiliated partner schools`,
    ].join('\n')
    await navigator.clipboard.writeText(lines)
    toast?.success('Cohort summary copied', 'Ready to paste into an email or report.')
  }

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

  // Only send to Pending Outreach students
  const handleSendSchool = async (school, sStudents) => {
    const pending = sStudents.filter(s => s.status === 'Pending Outreach')
    const emails  = pending.map(s => s.school_email).filter(Boolean)
    openMailto(emails.join(';'), buildFormBody())
    if (onStudentUpdate)
      for (const s of pending) await onStudentUpdate(s.id, { status: 'Form Sent' })
    showToast(`Form sent to ${school}. Status updated to Form Sent.`)
  }

  const handleSendStudent = async student => {
    openMailto(student.school_email, buildFormBody(student.first_name || 'ASPIRE Student'))
    if (onStudentUpdate) await onStudentUpdate(student.id, { status: 'Form Sent' })
    showToast(`Form sent to ${displayName(student)}. Status updated to Form Sent.`)
  }

  return (
    <div className="overview-tab">
      {/* Toast — fixed, lives outside scroll containers */}
      {localToast && (
        <div style={{
          position:'fixed', top:80, right:24, zIndex:9999,
          background:'var(--nightfall)', color:'var(--pearl)',
          fontSize:14, fontWeight:500, padding:'12px 18px',
          borderRadius:6, boxShadow:'0 4px 16px rgba(0,0,0,0.25)', maxWidth:360,
        }}>{localToast}</div>
      )}

      {/* ════════ STICKY HEADER ════════ */}
      <div className="aggregate-sticky-header">

        {/* Today's Priorities strip — first, most actionable */}
        <div style={{ marginBottom:'8px' }}>
        {(() => {
          const priorities = calculatePriorities(students, units)
          const cohortName = cohort?.name || 'this cohort'
          if (priorities.length === 0) return (
            <div style={{ background:'#f0fdf4', borderRadius:12, padding:'10px 18px', display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:'#16a34a', flexShrink:0 }} />
              <span style={{ fontFamily:'DM Sans,sans-serif', fontWeight:600, fontSize:13, color:'#166534' }}>
                All caught up. No urgent items for {cohortName}.
              </span>
            </div>
          )
          return (
            <div style={{ background:'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)', borderRadius:14, padding:'11px 18px', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              <span style={{ fontFamily:'DM Sans,sans-serif', fontWeight:700, fontSize:12, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.06em', marginRight:6, flexShrink:0 }}>
                Today's Priorities
              </span>
              {priorities.map((p, i) => (
                <React.Fragment key={i}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:p.bg, borderRadius:20, padding:'3px 10px', fontFamily:'DM Sans,sans-serif', fontWeight:700, fontSize:12, color:p.color, whiteSpace:'nowrap' }}>
                    <span style={{ fontWeight:800, fontSize:13 }}>{p.count}</span>
                    {p.label}
                  </span>
                  {i < priorities.length - 1 && (
                    <span style={{ color:'rgba(255,255,255,0.2)', fontSize:14, fontWeight:300 }}>·</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )
        })()}
        </div>

        {/* ── On Campus Today compact strip — second, contextual ── */}
        <div style={{ background:'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)', borderRadius:14, overflow:'hidden', boxShadow:'0 2px 12px rgba(29,37,103,0.07)', marginBottom:'4px' }}>
          {/* Header row */}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 24px', height:48, cursor:'pointer' }}
            onClick={() => setCampusOpen(p => !p)}>
            {campusLogs.length > 0
              ? <span style={{ width:8, height:8, borderRadius:'50%', background:'#4ade80', flexShrink:0, animation:'pulse 2s infinite', display:'inline-block' }} />
              : <span style={{ width:8, height:8, borderRadius:'50%', background:'#6b7280', flexShrink:0, display:'inline-block' }} />
            }
            <span style={{ fontSize:13, fontWeight:600, color: campusLogs.length>0 ? '#fff' : 'rgba(255,255,255,0.7)' }}>
              On Campus Today
            </span>
            {campusLogs.length > 0
              ? <span style={{ fontSize:11, fontWeight:700, padding:'0 8px', borderRadius:8, background:'rgba(255,255,255,0.15)', color:'#fff', height:20, display:'flex', alignItems:'center', flexShrink:0 }}>{campusLogs.length}</span>
              : <span style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginLeft:4 }}>No shifts logged today</span>
            }
            <div style={{ flex:1 }} />
            <button onClick={e => { e.stopPropagation(); loadCampusLogs() }}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'rgba(255,255,255,0.6)', lineHeight:1, padding:'0 4px' }}
              title="Refresh">↻</button>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>{campusOpen?'▲':'▼'}</span>
          </div>
          {/* Expanded student cards */}
          {campusOpen && campusLogs.length === 0 && (
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.04)' }}>
              <EmptyState compact icon={<Clock />}
                heading="No students on campus today"
                subtext="Students appear here after scanning the badge QR code and submitting a shift log." />
            </div>
          )}
          {campusOpen && campusLogs.length > 0 && (
            <div style={{ padding:'0 16px 12px', display:'flex', gap:12, overflowX:'auto' }}>
              {campusLogs.map(log => {
                const stu = students.find(s => s.id === log.student_id)
                if (!stu) return null
                const isNight = log.shift_type === 'Night'
                return (
                  <div key={log.id} style={{ width:160, flexShrink:0, background:'rgba(255,255,255,0.08)',
                    borderRadius:8, padding:12, border:'1px solid rgba(255,255,255,0.12)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <StudentAvatar student={stu} size={28} />
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {stu.last_name}{stu.last_name&&stu.first_name?', ':''}{stu.first_name}
                        </div>
                        <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {log.unit_name||'—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <span style={{ fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:10,
                        background:isNight?'rgba(255,255,255,0.1)':'#dceff8', color:isNight?'#fff':'#1d4ed8' }}>
                        {log.shift_type||'Day'}
                      </span>
                      <span style={{ fontSize:11, fontWeight:500, color:'#4ade80' }}>{log.total_hours} hrs</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Five hero stat cards */}
        <div className="stat-cards-row" style={{ padding:'12px 0', marginTop:'12px', marginBottom:'10px' }}>
          <StatCard
            value={totalSlots}
            label="Total Slots"
            sublabel={`${participatingUnits} units`}
            icon={Layers}
            colorScheme="nightfall"
          />
          <StatCard
            value={slotsFilled}
            label="Slots Placed"
            sublabel={`${Math.round((slotsFilled / totalSlots) * 100) || 0}% of total capacity`}
            icon={CheckSquare}
            colorScheme="green"
          />
          <StatCard
            value={slotsRemaining}
            label="Open Slots"
            icon={Clock}
            colorScheme={slotsRemaining === 0 ? 'red' : 'marina'}
          />
          <StatCard
            value={studentsRequesting}
            label="Student Requests"
            sublabel={`${activeSchools} schools`}
            icon={GraduationCap}
            colorScheme="neutral"
          />
          <StatCard
            value={Math.abs(gap)}
            label={gap > 0 ? 'Placement Gap' : 'Fully Covered'}
            sublabel={gap > 0 ? 'More requests than open slots' : 'Enough slots for all'}
            icon={AlertTriangle}
            colorScheme={gap > 0 ? 'amber' : 'darkgreen'}
          />
        </div>

        {/* Frozen panel headers — two columns matching the panels below */}
        <div className="aggregate-panel-headers">
          <div className="aggregate-panel-hdr">
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
          <div className="aggregate-panel-hdr">
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span className="ov-panel-title">Student Placement Requests</span>
                <StatusLegendPopover position="bottom-left" />
                <button onClick={handleCopyCohortSummary} title="Copy cohort summary"
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', padding:'4px', display:'flex', alignItems:'center' }}>
                  <Copy size={14} />
                </button>
              </div>
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
        </div>
      </div>

      {/* ════════ SCROLLABLE CONTENT ════════ */}
      <div className="aggregate-scrollable-content">

        <div className="ov-panels-body">

          {/* ── Clinical Placement Availability (body only) ── */}
          <div className="ov-panel-body">
            <div className="ov-groups">
              {DIVISIONS.map(div => {
                const divUnits = unitsByDiv[div] || []
                if (divUnits.length === 0) return null
                const open       = unitGroupsOpen[div]
                const divTotal   = divUnits.reduce((s, u) => s + (u.total_slots      || 0), 0)
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
                                {u.contact_person && <span className="ov-unit-contact">{u.contact_person}</span>}
                                <div style={{ display:'flex', gap:5, marginTop:4, flexWrap:'wrap' }}>
                                  {Array.from({ length: total }, (_, i) => (
                                    <span key={i} style={{
                                      width:11, height:11, borderRadius:'50%', flexShrink:0,
                                      background: i < filled ? 'var(--nightfall)' : 'transparent',
                                      border: `1.5px ${i < filled ? 'solid var(--nightfall)' : 'dashed #b8d8eb'}`,
                                      display:'inline-block',
                                    }} />
                                  ))}
                                </div>
                              </div>
                              <div className="ov-unit-badges">
                                {isFull && (
                                  <span style={{ background:'#9ca3af', color:'#fff', fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap' }}>Full</span>
                                )}
                                <span style={{ background:slotBg, color:slotColor, fontSize:12, fontWeight:500, padding:'2px 8px', borderRadius:4, whiteSpace:'nowrap' }}>
                                  {filled} of {total} filled
                                </span>
                                {u.shift_preference && <span className="ov-shift-badge">{u.shift_preference}</span>}
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
                <EmptyState icon={<MapPin />}
                  heading="No units configured"
                  subtext="Add participating units using the Set Up Units button to begin placement planning." />
              )}
            </div>
          </div>

          {/* ── Student Placement Requests (body only) ── */}
          <div className="ov-panel-body">
            <div className="ov-groups">
              {schools.map(school => {
                const sStudents  = schoolMap[school]
                const open       = schoolGroupsOpen[school]
                const coord      = getCoordinator(sStudents)
                const placed     = sStudents.filter(s => s.matched_unit_id).length
                const hasPending = sStudents.some(s => s.status === 'Pending Outreach')

                return (
                  <div key={school} className="ov-group">
                    <div className="ov-group-row" onClick={() => toggleSchoolGroup(school)}>
                      <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <span className="ov-group-name">{school}</span>
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
                        {/* Send Form to School — only when at least one student is Pending Outreach */}
                        {hasPending && (
                          <div className="ov-school-actions">
                            <button className="ov-send-btn"
                              onClick={e => { e.stopPropagation(); handleSendSchool(school, sStudents) }}>
                              Send Form to School
                            </button>
                          </div>
                        )}

                        {[...sStudents].sort((a, b) => {
                          const la = (a.last_name || a.name || '').toLowerCase()
                          const lb = (b.last_name || b.name || '').toLowerCase()
                          if (la !== lb) return la.localeCompare(lb)
                          return (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase())
                        }).map(s => {
                          const statusCfg  = ASPIRE_STATUS_CONFIG[s.status] || { bg:'#f3f4f6', text:'#6b7280', border:'#d1d5db' }
                          const placedUnit = s.matched_unit_id ? units.find(u => u.id === s.matched_unit_id)?.unit_name : null
                          const isPending  = s.status === 'Pending Outreach'

                          return (
                            <div key={s.id} className="ov-student-row">
                              <StudentAvatar student={s} size={32} />
                              {/* Info */}
                              <div className="ov-student-info" style={{ flex:1 }}>
                                <span className="ov-student-name">{displayName(s)}</span>
                                {s.school_email && <span className="ov-student-contact">{s.school_email}</span>}
                                {s.phone && <span style={{ fontSize:12, color:'#9ca3af' }}>{s.phone}</span>}
                              </div>
                              {/* Right: ASPIRE status + hours badge + placed label + Send Form */}
                              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                              {/* Hours progress badge */}
                              {(() => {
                                const req = parseFloat(s.hours_required||0)
                                const apv = parseFloat(s.approved_hours||0)
                                if (!req) return null
                                const pct = apv / req
                                const color = pct >= 1 ? '#166534' : pct >= 0.5 ? 'var(--nightfall)' : '#6b7280'
                                return (
                                  <span style={{ fontSize:11, fontWeight:600, color, whiteSpace:'nowrap' }}>
                                    {apv}/{req} hrs
                                  </span>
                                )
                              })()}
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
                                {/* Send Form button only shown for Pending Outreach students */}
                                {isPending && (
                                  <button className="ov-send-btn ov-send-btn-sm"
                                    onClick={e => { e.stopPropagation(); handleSendStudent(s) }}>
                                    Send Form
                                  </button>
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
              {students.length === 0 && (
                <EmptyState icon={<GraduationCap />}
                  heading="No student requests yet"
                  subtext="Students will appear here after their school coordinator submits the school form." />
              )}
            </div>
          </div>

        </div>

        {/* ── Program Timeline strip — below both panels ── */}
        <div style={{ background:'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)', borderRadius:14, overflow:'hidden', margin:'16px 0', boxShadow:'0 2px 12px rgba(29,37,103,0.07)' }}>
          {/* Collapsed header */}
          <div
            onClick={() => setTimelineExpanded(p => !p)}
            style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 20px', cursor:'pointer', userSelect:'none' }}
          >
            <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, transition:'background 0.2s ease',
              background: timelineExpanded ? '#9FAFF8' : 'rgba(255,255,255,0.4)' }} />
            <span style={{ fontFamily:'DM Sans,sans-serif', fontWeight:600, fontSize:13, color:'#ffffff' }}>
              Program Timeline
            </span>
            <span style={{ fontFamily:'DM Sans,sans-serif', fontSize:12, color:'rgba(255,255,255,0.5)', marginLeft:4 }}>
              {timelineExpanded ? 'Gantt chart view' : 'Click to expand'}
            </span>
            <span style={{ marginLeft:'auto', color:'rgba(255,255,255,0.5)', fontSize:12,
              transform: timelineExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s ease' }}>▼</span>
          </div>

          {/* Expanded Gantt */}
          {timelineExpanded && (
            <div style={{ borderTop:'1px solid rgba(255,255,255,0.1)', background:'#ffffff', padding:20 }}>
              {ganttLoading ? (
                <div style={{ textAlign:'center', padding:'28px 16px', color:'#9ca3af', fontFamily:'DM Sans', fontSize:13 }}>
                  <style>{`@keyframes gantt-spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }`}</style>
                  <div style={{ width:20, height:20, border:'2px solid #e5e7eb', borderTopColor:'#1D2567', borderRadius:'50%', animation:'gantt-spin 0.8s linear infinite', margin:'0 auto 12px' }} />
                  Loading program timeline…
                </div>
              ) : ganttError ? (
                <div style={{ background:'#fff1f2', border:'1px solid #fca5a5', borderRadius:10, padding:'16px 20px', textAlign:'center' }}>
                  <div style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:13, color:'#991b1b', marginBottom:6 }}>
                    Failed to load timeline
                  </div>
                  <div style={{ fontFamily:'DM Sans', fontSize:12, color:'#6b7280', marginBottom:14 }}>{ganttError}</div>
                  <button onClick={loadCohortEvents}
                    style={{ padding:'7px 18px', border:'none', borderRadius:8, background:'#1D2567', color:'#fff', fontFamily:'DM Sans', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                    Retry
                  </button>
                </div>
              ) : cohortEvents.length === 0 ? (
                <EmptyState icon={<Clock />}
                  heading="No timeline events yet for this cohort"
                  subtext="Events will appear automatically as students progress (form received, interviewed, placed). You can also log dates manually from the Student Profiles tab." />
              ) : (
                <>
                  <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
                    <button onClick={loadCohortEvents}
                      style={{ padding:'4px 12px', border:'1px solid #e5e7eb', borderRadius:6, background:'#f9fafb', fontFamily:'DM Sans', fontSize:11, color:'#6b7280', cursor:'pointer' }}>
                      ↻ Refresh
                    </button>
                  </div>
                  <CohortGantt students={students} events={cohortEvents} cohort={cohort} />
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
