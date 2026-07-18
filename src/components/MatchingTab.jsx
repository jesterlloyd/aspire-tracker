import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import Tooltip from './ui/Tooltip'
import EmbedUnitCard from './EmbedUnitCard'
import StudentMatchingCard from './StudentMatchingCard'
import UnitSetupPanel from './UnitSetupPanel'
import ImportUnitsCSV from './ImportUnitsCSV'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
import MatchingBanner from './MatchingBanner'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import { Users, MapPin, ClipboardList, Info } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import RestrictedAccessOverlay from './RestrictedAccessOverlay'
import { canPerformMatching } from '../lib/permissions'
import { KPICell, useUpdatedLabel } from './KPIBand'
import { unitOpenSlots, totalOpenSlots, derivePrefCounts } from '../lib/placementDisplay'
// ── Unified Placement Overview - single panel replacing Placement at a Glance + Preference Match Ring ──

const PREF_SEGMENTS = [
  { key: 'top',         label: 'Top choice',   color: '#C8D5C0' },
  { key: 'second',      label: 'Second',       color: '#D5DCEC' },
  { key: 'other',       label: 'Other',        color: '#F4D9B6' },
  { key: 'notRecorded', label: 'Not recorded', color: '#E5E7EB' },
  { key: 'unmatched',   label: 'Unmatched',    color: '#F2D5E0' },
]

function SegmentedBar({ counts, total }) {
  if (!total) return <div style={{ height:9, borderRadius:5, background:'#f3f4f6' }} />
  const active = PREF_SEGMENTS.filter(s => counts[s.key] > 0)
  return (
    <div style={{ display:'flex', height:9, borderRadius:5, overflow:'hidden', background:'#f3f4f6', gap:1 }}>
      {active.map(s => (
        <div key={s.key} style={{ width:`${(counts[s.key] / total) * 100}%`, background:s.color, minWidth:4 }} />
      ))}
    </div>
  )
}

function PlacementOverview({ studentsCount, matchedCount, unmatchedCount, prefCounts, totalSlots, slotsRemaining, poolSchools, cohort, cohortId }) {
  const updatedLabel = useUpdatedLabel(cohortId)
  const schools = poolSchools?.length ?? 0
  // ASPIRE-CHART honest match rank: the headline claims a percentage only
  // over placements with a RECORDED rank; absent data is shown as absent,
  // never as "0% top choice".
  const recorded = prefCounts.top + prefCounts.second + prefCounts.other
  const topPct = recorded > 0 ? Math.round((prefCounts.top / recorded) * 100) : null

  const counts = {
    top:         prefCounts.top,
    second:      prefCounts.second,
    other:       prefCounts.other,
    notRecorded: prefCounts.notRecorded,
    unmatched:   studentsCount - matchedCount,
  }

  const matchedSub = (() => {
    const parts = []
    if (prefCounts.top    > 0) parts.push(`${prefCounts.top} top choice`)
    if (prefCounts.second > 0) parts.push(`${prefCounts.second} 2nd choice`)
    if (prefCounts.other  > 0) parts.push(`${prefCounts.other} other`)
    if (prefCounts.notRecorded > 0) parts.push(`${prefCounts.notRecorded} rank not recorded`)
    return parts.length > 0 ? parts.join(' · ') : 'Pending placement'
  })()

  return (
    <section style={{ background:'var(--bg-card,#fff)', border:'1px solid var(--border-card,rgba(29,37,103,0.08))', borderRadius:14, boxShadow:'var(--shadow-card)', overflow:'hidden', fontFamily:'DM Sans, sans-serif' }}>
      <div style={{ padding:'11px 22px 9px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border-card,rgba(29,37,103,0.04))' }}>
        <div style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--text-caption,#475467)', fontWeight:600 }}>Placement at a Glance</div>
        <div style={{ fontSize:11, color:'var(--text-muted,#98A2B3)', fontVariantNumeric:'tabular-nums' }}>
          {cohort?.name || 'Cohort'} · {schools} school{schools !== 1 ? 's' : ''} · Updated {updatedLabel}
        </div>
      </div>
      <div style={{ display:'flex', background:'var(--border-card,rgba(29,37,103,0.04))', gap:1 }}>
        <div style={{ flex:'1 1 0' }}><KPICell value={studentsCount}  label="Students"   sub={`${schools} school${schools !== 1 ? 's' : ''}`} /></div>
        <div style={{ flex:'1 1 0' }}><KPICell value={matchedCount}   label="Matched"    sub={matchedSub} accent="sage" /></div>
        <div style={{ flex:'1 1 0' }}><KPICell value={unmatchedCount} label="Unmatched"  sub="Pending placement" accent={unmatchedCount > 0 ? 'warning' : null} /></div>
        <div style={{ flex:'1 1 0' }}><KPICell value={slotsRemaining} label="Open Slots" sub={`of ${totalSlots} total`} /></div>
        <div style={{ flex:'1.6 1 0', minWidth:200, background:'var(--bg-card,#fff)', padding:'14px 20px', display:'flex', flexDirection:'column', justifyContent:'center', gap:6 }}>
          <div style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--text-caption,#475467)', fontWeight:700 }}>Preference Match</div>
          <div style={{ fontSize:16, fontWeight:700, color: topPct !== null ? 'var(--color-status-success,#2D4A2B)' : 'var(--text-muted,#98A2B3)', lineHeight:1.2 }}>
            {topPct !== null ? `${topPct}% received top choice` : matchedCount > 0 ? 'Match rank not recorded' : '-'}
          </div>
          <SegmentedBar counts={counts} total={studentsCount} />
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {PREF_SEGMENTS.map(seg => (
              <div key={seg.key} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'var(--text-caption,#6b7280)', whiteSpace:'nowrap' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:seg.color, display:'inline-block', flexShrink:0 }} />
                {seg.label} · {counts[seg.key]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export const getInterviewStatus = (s) => {
  if (s.auto_recommendation === 'Recommend')
    return { label: 'Recommended',     color: '#166534', bg: '#f0fdf4' }
  if (s.auto_recommendation === 'Do Not Recommend')
    return { label: 'Not Recommended', color: '#991b1b', bg: '#fef2f2' }
  if (parseFloat(s.avg_composite_score) > 0)
    return { label: 'Rubric Submitted',color: '#1e40af', bg: '#eff6ff' }
  if (s.interview_scheduled_date)
    return { label: 'Scheduled',       color: '#92400e', bg: '#fffbeb' }
  return null
}

// (MATCH_QUALITY_CONFIG removed: match-rank display now comes from the
// stored-rank config in lib/placementDisplay.js - one source, no duplicate.)

// Blacklist: exclude students who are already placed or finished
// (whitelist approach was too strict and excluded students with edge-case statuses)
const POOL_INELIGIBLE_STATUSES = new Set([
  'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding',
])

export default function MatchingTab({
  students, units, matches, cohortId, cohort,
  onMatch, onUnmatch, onUpdateMatch, onRefreshUnits, onDeleteUnit, highlightUnitId,
  focusMatchStudentId, onFocusMatchConsumed,
  toast,
}) {
  const [selectedStudent,   setSelectedStudent]   = useState(null)
  const cardRefs = useRef({})

  // ASPIRE-CHART interview-to-placement handoff: when Interviews routes here
  // with a student, pre-select them in the pool (the existing selection
  // mechanic; the scroll effect below brings the card into view). A student
  // who is not pool-eligible fails closed to no selection.
  useEffect(() => {
    if (!focusMatchStudentId) return
    const s = students.find(x => x.id === focusMatchStudentId)
    if (s) setSelectedStudent(s)
    onFocusMatchConsumed?.()
  }, [focusMatchStudentId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showUnitSetup,     setShowUnitSetup]     = useState(false)
  const [showImportUnits,   setShowImportUnits]   = useState(false)
  const [poolSearch,        setPoolSearch]        = useState('')
  const [poolSchool,        setPoolSchool]        = useState('')
  const [poolSort,          setPoolSort]          = useState('last_name_asc')
  const [divFilter,         setDivFilter]         = useState('')
  const [sortMode,          setSortMode]          = useState('alpha')
  const [fadingStudentIds,  setFadingStudentIds]  = useState(new Set())
  const [fadeInStudentIds,  setFadeInStudentIds]  = useState(new Set())
  // Focused unit drives Student Pool tier-sort without affecting placement logic
  const [focusedUnit,       setFocusedUnit]       = useState(null)

  const handleUnitFocus = (unit) =>
    setFocusedUnit(prev => prev?.id === unit.id ? null : unit)

  const participating   = units.filter(u => u.is_participating)
  const totalSlots      = participating.reduce((s, u) => s + (u.total_slots || 0), 0)
  // ASPIRE-CHART one capacity source: live match count vs configured totals,
  // the same calculation the placement guard uses. The stored slots_remaining
  // field is no longer a display source (its write path is unchanged).
  const slotsRemaining  = totalOpenSlots(participating, matches)
  const unitsWithOpen   = participating.filter(u => (unitOpenSlots(u, matches) ?? 0) > 0).length
  // AVAILABILITY-CANON-1D: read-only coordinator availability for the readiness badge.
  // Only the fields the badge/readiness helper needs; mapped by rotation id and passed to each
  // StudentMatchingCard. Skips safely when there is no cohort. No writes.
  const { data: rotationRows = [] } = useQuery({
    queryKey: ['cohort_rotation_avail', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('id, unavailable_weekdays, min_days_per_week, weekends_allowed, nights_allowed, blackout_dates')
        .eq('cohort_id', cohortId)
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const rotationById = useMemo(() => {
    const m = {}
    for (const r of rotationRows) m[r.id] = r
    return m
  }, [rotationRows])

  const matchedStudents = students.filter(s =>  s.matched_unit_id)
  // Pool only shows students who are unmatched AND have an eligible ASPIRE status
  // (excludes Placed, Active Rotation, Completed, Declined)
  const unmatchedAll    = students.filter(s => !s.matched_unit_id && !POOL_INELIGIBLE_STATUSES.has(s.status))
  const poolSchools     = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  // ASPIRE-CHART: counts come from STORED match ranks (shared module), never
  // from unit-name comparison - renaming a unit no longer rewrites history.
  const prefCounts = useMemo(() => derivePrefCounts(matchedStudents, matches), [matchedStudents, matches])

  // Filter + sort units
  let displayUnits = [...participating]
  if (divFilter) {
    displayUnits = displayUnits.filter(u =>
      (u.division || UNIT_DIVISION_MAP[u.unit_name] || 'Medical') === divFilter
    )
  }
  if (sortMode === 'alpha') {
    displayUnits.sort((a, b) => a.unit_name.localeCompare(b.unit_name))
  } else if (sortMode === 'division') {
    displayUnits.sort((a, b) => {
      const da = a.division || UNIT_DIVISION_MAP[a.unit_name] || 'Medical'
      const db = b.division || UNIT_DIVISION_MAP[b.unit_name] || 'Medical'
      return da.localeCompare(db) || a.unit_name.localeCompare(b.unit_name)
    })
  } else if (sortMode === 'most-available') {
    displayUnits.sort((a, b) => (unitOpenSlots(b, matches) ?? 0) - (unitOpenSlots(a, matches) ?? 0))
  }

  // Pool: include fading-out students temporarily for exit animation
  const poolBase = [
    ...unmatchedAll,
    ...students.filter(s => fadingStudentIds.has(s.id) && s.matched_unit_id),
  ]
  const filteredPool = poolBase.filter(s => {
    if (fadingStudentIds.has(s.id)) return true // always show during exit animation
    if (poolSearch && !`${s.first_name||''} ${s.last_name||''} ${s.name||''}`.toLowerCase().includes(poolSearch.toLowerCase())) return false
    if (poolSchool && s.school !== poolSchool) return false
    return true
  })

  // Choice tier for the currently focused unit (1–3 = preference rank, 4 = not picked)
  const tierOf = (student) => {
    if (!focusedUnit) return 4
    if (student.unit_preference_1 === focusedUnit.unit_name) return 1
    if (student.unit_preference_2 === focusedUnit.unit_name) return 2
    if (student.unit_preference_3 === focusedUnit.unit_name) return 3
    return 4
  }

  // Baseline sort (existing logic, unchanged)
  const baselinePool = [...filteredPool].sort((a, b) => {
    // Fading students stay sorted normally (they vanish in <300ms anyway)
    const la = (a.last_name || a.name || '').toLowerCase()
    const lb = (b.last_name || b.name || '').toLowerCase()
    switch (poolSort) {
      case 'last_name_desc': return lb.localeCompare(la)
      case 'school_asc':     return (a.school||'').localeCompare(b.school||'') || la.localeCompare(lb)
      case 'gpa_desc': {
        const ga = parseFloat(a.cumulative_gpa)||0, gb = parseFloat(b.cumulative_gpa)||0
        return gb - ga || la.localeCompare(lb)
      }
      case 'score_desc': {
        const sa = parseFloat(a.avg_composite_score)||0, sb = parseFloat(b.avg_composite_score)||0
        return sb - sa || la.localeCompare(lb)
      }
      case 'status': {
        const ia = ASPIRE_STATUS_SORT_ORDER.indexOf(a.status)
        const ib = ASPIRE_STATUS_SORT_ORDER.indexOf(b.status)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || la.localeCompare(lb)
      }
      default: return la.localeCompare(lb) // last_name_asc
    }
  })

  // When a unit is focused, stable-sort by tier on top of the baseline
  // (tier first, then baseline index preserves the existing sort within each tier)
  const sortedPool = focusedUnit
    ? baselinePool
        .map((s, i) => ({ s, tier: tierOf(s), i }))
        .sort((a, b) => a.tier - b.tier || a.i - b.i)
        .map(({ s }) => s)
    : baselinePool

  const selectedIndex = useMemo(() =>
    sortedPool.findIndex(s => s.id === selectedStudent?.id),
  [sortedPool, selectedStudent?.id]) // eslint-disable-line

  useEffect(() => {
    if (selectedStudent?.id && cardRefs.current[selectedStudent.id]) {
      cardRefs.current[selectedStudent.id].scrollIntoView({ behavior:'smooth', block:'nearest' })
    }
  }, [selectedStudent?.id])

  const handlePrevStudent = () => {
    if (selectedIndex > 0) handleStudentSelect(sortedPool[selectedIndex - 1])
  }
  const handleNextStudent = () => {
    if (selectedIndex < sortedPool.length - 1) handleStudentSelect(sortedPool[selectedIndex + 1])
  }

  const getDisplayUnits = useMemo(() => {
    if (!selectedStudent) return { preferred: [], others: displayUnits, hasFocus: false }
    const prefNames = [
      selectedStudent.unit_preference_1,
      selectedStudent.unit_preference_2,
      selectedStudent.unit_preference_3,
    ].filter(Boolean)
    const preferred = prefNames.map(name => displayUnits.find(u => u.unit_name === name)).filter(Boolean)
    const prefSet   = new Set(prefNames)
    const others    = displayUnits.filter(u => !prefSet.has(u.unit_name))
    return { preferred, others, hasFocus: preferred.length > 0 }
  }, [displayUnits, selectedStudent]) // eslint-disable-line

  useEffect(() => {
    const onKey = (e) => {
      if (!selectedStudent) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (selectedIndex < sortedPool.length - 1) handleStudentSelect(sortedPool[selectedIndex + 1])
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (selectedIndex > 0) handleStudentSelect(sortedPool[selectedIndex - 1])
      }
      if (e.key === 'Escape') setSelectedStudent(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedStudent?.id, selectedIndex, sortedPool]) // eslint-disable-line

  const handleStudentSelect = s => setSelectedStudent(prev => prev?.id === s.id ? null : s)

  const handleSlotClick = unit => {
    if (!selectedStudent || !canMatch) return
    // Use actual match count as the canonical capacity check so the guard
    // stays in sync with the EmbedUnitCard display (which also uses match count,
    // not the slots_remaining field). slots_remaining can drift if it was
    // initialised incorrectly or not updated atomically.
    const unitMatchCount = matches.filter(m => m.unit_id === unit.id).length
    if (unitMatchCount >= unit.total_slots) {
      console.log('[MatchingTab] placement blocked:', {
        unitId: unit.id, unitName: unit.unit_name,
        displayedCapacity: unit.total_slots,
        currentMatchCount: unitMatchCount,
        slotsRemainingField: unit.slots_remaining,
      })
      toast?.warning('No slots available', 'This unit has no remaining open slots.')
      return
    }
    const id = selectedStudent.id
    // Start exit animation
    setFadingStudentIds(prev => new Set([...prev, id]))
    setTimeout(() => {
      setFadingStudentIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }, 280)
    onMatch(selectedStudent, unit)
    setSelectedStudent(null)
  }

  const handleUnmatch = (student, unit) => {
    onUnmatch(student, unit)
    // Fade-in when student returns to pool
    const id = student.id
    setTimeout(() => {
      setFadeInStudentIds(prev => new Set([...prev, id]))
      setTimeout(() => {
        setFadeInStudentIds(prev => { const n = new Set(prev); n.delete(id); return n })
      }, 450)
    }, 80)
  }

  const exportCSV = () => {
    const headers = ['Student Name','School','School Email','Personal Email','Phone','Matched Unit','Match Quality','Preceptor Assigned','Shift Assigned','Unit Contact','Notes']
    const rows = matchedStudents.map(s => {
      const unit  = units.find(u => u.id === s.matched_unit_id)
      const match = matches.find(m => m.student_id === s.id)
      return [s.name, s.school, s.school_email, s.personal_email, s.phone,
        unit?.unit_name || '', match?.match_quality || s.match_quality || '',
        match?.preceptor_assigned || '', match?.shift_assigned || '',
        unit?.contact_person || '', match?.notes || '']
    })
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`aspire-matches-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const { userProfile } = useAuth()
  const canMatch = canPerformMatching(userProfile)

  const studentMap = useMemo(() => {
    const map = {}
    ;(students || []).forEach(s => { map[s.id] = s })
    return map
  }, [students])

  const studentsCount  = students.length
  const matchedCount   = matchedStudents.length
  const unmatchedCount = unmatchedAll.length

  return (
    <div className="matching-tab embed-tab" style={{ position: 'relative' }}>

      {/* Access overlay for non-matching roles - sits above everything (shared with Evaluation). */}
      {!canMatch && (
        <RestrictedAccessOverlay
          title="Placement decisions are made by the program leads."
          body="If you have a unit recommendation for a student, please include it in the interview rubric notes section. The program leads will review your recommendation during the matching process."
        />
      )}

      {/* ── Unified Placement Overview ── */}
      <PlacementOverview
        studentsCount={studentsCount}
        matchedCount={matchedCount}
        unmatchedCount={unmatchedCount}
        prefCounts={prefCounts}
        totalSlots={totalSlots}
        slotsRemaining={slotsRemaining}
        poolSchools={poolSchools}
        cohort={cohort}
        cohortId={cohortId}
      />

      {/* ── Matching board: two light panel cards ── */}
      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'row', gap:14 }}>

          {/* Left: Units panel */}
          <div className="embed-units-panel">
            {/* Light panel header */}
            <div className="embed-light-hdr">
              <span className="embed-panel-title-light">Unit Pool</span>
              <select value={divFilter} onChange={e => setDivFilter(e.target.value)} className="embed-light-select">
                <option value="">All Divisions</option>
                <option value="Surgical">Surgical</option>
                <option value="Medical">Medical</option>
                <option value="Critical Care">Critical Care</option>
                <option value="Specialty">Specialty</option>
              </select>
              <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="embed-light-select">
                <option value="alpha">A–Z</option>
                <option value="division">By Division</option>
                <option value="most-available">Most Available</option>
              </select>
              {(selectedStudent || focusedUnit) && (
                <span style={{ fontSize:11, color:'var(--text-muted,#9ca3af)', fontStyle:'italic', whiteSpace:'nowrap' }}>
                  {selectedStudent ? 'Reordered by preference' : `By preference for ${focusedUnit?.unit_name}`}
                </span>
              )}
              <div style={{ flex:1 }} />
              <button className="embed-light-btn" onClick={() => setShowUnitSetup(true)}>⚙ Set Up Units</button>
              <button className="embed-light-btn" onClick={exportCSV}>↓ Export CSV</button>
            </div>
            <div className="embed-units-body">
              {/* Unit Pool guide - shows when no unit is focused and no student selected */}
              {!focusedUnit && !selectedStudent && (
                <div style={{ margin:'10px 12px 0', background:'#FAFAF7', border:'1px dashed rgba(29,37,103,0.12)', borderRadius:10, padding:'10px 13px', fontSize:12, color:'#475467', display:'flex', alignItems:'center', gap:8, fontFamily:'DM Sans, sans-serif' }}>
                  <Info size={14} style={{ color:'#98A2B3', flexShrink:0 }} />
                  <span>Click a unit to surface students who picked it as their top choice, ranked by preference.</span>
                </div>
              )}

              {/* MatchingBanner - compact card, only when student selected */}
              {selectedStudent && (
                <div style={{ padding:'12px 16px 0' }}>
                  <MatchingBanner
                    student={selectedStudent}
                    units={participating}
                    matches={matches}
                    onClearSelection={() => setSelectedStudent(null)}
                  />
                </div>
              )}
              {participating.length === 0 ? (
                <EmptyState icon={<MapPin />}
                  heading="No units in the pool"
                  subtext="Use Set Up Units to add participating units and their available slots." />
              ) : (
                <div className="embed-unit-grid">
                  {getDisplayUnits.preferred.map(unit => (
                    <EmbedUnitCard
                      key={unit.id}
                      unit={unit}
                      matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                      matches={matches}
                      studentMap={studentMap}
                      selectedStudent={selectedStudent}
                      onSlotClick={() => handleSlotClick(unit)}
                      onUnmatch={student => handleUnmatch(student, unit)}
                      onUpdateMatch={onUpdateMatch}
                      onDelete={() => onDeleteUnit(unit)}
                      isHighlighted={highlightUnitId === unit.id}
                      isFocusedUnit={focusedUnit?.id === unit.id}
                      onFocusUnit={() => handleUnitFocus(unit)}
                    />
                  ))}
                  {getDisplayUnits.hasFocus && getDisplayUnits.others.length > 0 && (
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 4px', margin:'4px 0', gridColumn:'1 / -1' }}>
                      <div style={{ flex:1, height:'1px', background:'#e0e7ff' }} />
                      <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>
                        Other Available Units
                      </span>
                      <div style={{ flex:1, height:'1px', background:'#e0e7ff' }} />
                    </div>
                  )}
                  {getDisplayUnits.others.map(unit => (
                    <EmbedUnitCard
                      key={unit.id}
                      unit={unit}
                      matchedStudents={students.filter(s => s.matched_unit_id === unit.id)}
                      matches={matches}
                      studentMap={studentMap}
                      selectedStudent={selectedStudent}
                      onSlotClick={() => handleSlotClick(unit)}
                      onUnmatch={student => handleUnmatch(student, unit)}
                      onUpdateMatch={onUpdateMatch}
                      onDelete={() => onDeleteUnit(unit)}
                      isHighlighted={highlightUnitId === unit.id}
                      isFocusedUnit={focusedUnit?.id === unit.id}
                      onFocusUnit={() => handleUnitFocus(unit)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Student pool */}
          <div className="embed-students-panel">
            {/* Light panel header */}
            <div className="embed-light-hdr">
              <span className="embed-panel-title-light">Student Pool</span>
              <input
                className="embed-pool-search"
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                placeholder="Search…"
              />
              <select value={poolSchool} onChange={e => setPoolSchool(e.target.value)} className="embed-light-select">
                <option value="">All Schools</option>
                {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <Tooltip label="Sort students" placement="bottom">
              <select value={poolSort} onChange={e => setPoolSort(e.target.value)} className="embed-light-select" aria-label="Sort students">
                <option value="last_name_asc">Last Name A–Z</option>
                <option value="last_name_desc">Last Name Z–A</option>
                <option value="school_asc">School A–Z</option>
                <option value="gpa_desc">GPA High–Low</option>
                <option value="score_desc">Score High–Low</option>
                <option value="status">ASPIRE Status</option>
              </select>
              </Tooltip>
              <div style={{ flex:1 }} />
              <span style={{ fontSize:12, color:'var(--text-caption,#6b7280)', flexShrink:0, whiteSpace:'nowrap' }}>
                {selectedStudent
                  ? `${selectedIndex + 1} of ${sortedPool.length}`
                  : `${sortedPool.length} student${sortedPool.length !== 1 ? 's' : ''}`}
              </span>
              <StatusLegendPopover position="bottom-right" dark={false} />
              {sortedPool.length > 0 && (
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <Tooltip label="Previous student" placement="top">
                  <button onClick={handlePrevStudent} disabled={!selectedStudent || selectedIndex <= 0} aria-label="Previous student"
                    style={{ width:26, height:26, background:(!selectedStudent||selectedIndex<=0)?'var(--bg-hover,#f3f4f6)':'var(--color-status-info-bg,#e0e7ff)', border:'1px solid var(--border-divider,#d1d5db)', borderRadius:6, cursor:(selectedStudent&&selectedIndex>0)?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', opacity:(!selectedStudent||selectedIndex<=0)?0.4:1, transition:'all 0.15s ease' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary,#1D2567)" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  </Tooltip>
                  <Tooltip label="Next student" placement="top">
                  <button onClick={handleNextStudent} disabled={!selectedStudent||selectedIndex>=sortedPool.length-1} aria-label="Next student"
                    style={{ width:26, height:26, background:(!selectedStudent||selectedIndex>=sortedPool.length-1)?'var(--bg-hover,#f3f4f6)':'var(--color-status-info-bg,#e0e7ff)', border:'1px solid var(--border-divider,#d1d5db)', borderRadius:6, cursor:(selectedStudent&&selectedIndex<sortedPool.length-1)?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', opacity:(!selectedStudent||selectedIndex>=sortedPool.length-1)?0.4:1, transition:'all 0.15s ease' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary,#1D2567)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  </Tooltip>
                  {selectedStudent && <span style={{ fontSize:10, color:'var(--text-muted,#9ca3af)', whiteSpace:'nowrap' }}>↑↓·Esc</span>}
                </div>
              )}
            </div>
            <div className="embed-students-body">

              {/* Focused-unit summary strip */}
              {focusedUnit && (
                <div style={{
                  background: '#F4F1EC', padding: '10px 14px',
                  borderRadius: 10, margin: '12px 12px 0',
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  fontFamily: 'DM Sans, sans-serif', fontSize: 13,
                }}>
                  <span style={{ fontWeight: 600, color: '#1D2567', flexShrink: 0 }}>
                    Preferences for {focusedUnit.unit_name}:
                  </span>
                  <span style={{ color: '#059669', fontWeight: 600 }}>
                    {sortedPool.filter(s => tierOf(s) === 1).length}, 1st choice
                  </span>
                  <span style={{ color: '#B5895A', fontWeight: 600 }}>
                    {sortedPool.filter(s => tierOf(s) === 2).length}, 2nd
                  </span>
                  <span style={{ color: '#7C8FD9', fontWeight: 600 }}>
                    {sortedPool.filter(s => tierOf(s) === 3).length}, 3rd
                  </span>
                  <button
                    onClick={() => setFocusedUnit(null)}
                    style={{
                      marginLeft: 'auto', background: 'transparent',
                      border: '1px solid #d1d5db', borderRadius: 999,
                      padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                      fontFamily: 'DM Sans', color: '#6b7280',
                    }}
                  >Clear</button>
                </div>
              )}

              {/* Student Pool guide - shows when no student is selected */}
              {!selectedStudent && filteredPool.length > 0 && (
                <div style={{ margin:'10px 12px 0', background:'#FAFAF7', border:'1px dashed rgba(29,37,103,0.12)', borderRadius:10, padding:'10px 13px', fontSize:12, color:'#475467', display:'flex', alignItems:'center', gap:8, fontFamily:'DM Sans, sans-serif' }}>
                  <Info size={14} style={{ color:'#98A2B3', flexShrink:0 }} />
                  <span>Select a student to view their compatible units, ordered by their preferences.</span>
                </div>
              )}

              {filteredPool.length === 0 ? (
                unmatchedAll.length === 0
                  ? <EmptyState icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
                      heading="All students matched"
                      subtext="Every available student has been placed. Check the Student Profiles tab to review placements." />
                  : <EmptyState icon={<Users />}
                      heading="No students ready for matching"
                      subtext="Students appear here after completing their interview and being recommended for placement." />
              ) : (
                <div className="embed-student-grid">
                  {sortedPool.map(s => (
                    <div key={s.id} ref={el => { cardRefs.current[s.id] = el }}>
                      <StudentMatchingCard
                        student={s}
                        isSelected={selectedStudent?.id === s.id}
                        onSelect={handleStudentSelect}
                        isFading={fadingStudentIds.has(s.id)}
                        isFadingIn={fadeInStudentIds.has(s.id)}
                        units={participating}
                        matches={matches}
                        focusedUnit={focusedUnit}
                        rotation={rotationById[s.cohort_school_rotation_id]}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

      </div>{/* end matching board */}

      {showUnitSetup && (
        <UnitSetupPanel cohortId={cohortId} currentUnits={units} students={students}
          onSaved={onRefreshUnits} onClose={() => setShowUnitSetup(false)} />
      )}
      {showImportUnits && (
        <ImportUnitsCSV cohortId={cohortId} onImported={onRefreshUnits}
          onClose={() => setShowImportUnits(false)} />
      )}
    </div>
  )
}
