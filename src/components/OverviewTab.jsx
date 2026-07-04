import React, { useState, useEffect, useMemo } from 'react'
import { openOutlookCompose } from '../lib/outlookCompose'
import Tooltip from './ui/Tooltip'
import { useQuery } from '@tanstack/react-query'
import { useUpdatedLabel, KPICell } from './KPIBand'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
import { getUnit, UNIT_CATALOG, DIVISION_ORDER } from '../lib/unitCatalog'
import StudentAvatar from './StudentAvatar'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import UnitResponseDrawer from './UnitResponseDrawer'
import StudentCard from './StudentCard'
import AggregateWelcome from './AggregateWelcome'
import { selectActiveWindowRows, mergeOnCampusNow } from '../lib/onCampusNow'
import { shiftTypeOf, shiftBadge, isOpenShift, openShiftMs, formatDuration, isClockoutMaybeOverdue } from '../lib/shiftStatus'
import { Clock, GraduationCap, MapPin, Users, Copy } from 'lucide-react'

// ── Capacity Coverage Gauge ───────────────────────────────────────────────────

// Returns SVG path for a filled annular sector.
// leftDegStart / leftDegEnd: degrees measured from the left end of the arch (0 = far left, 180 = far right).
function annularPath(cx, cy, innerR, outerR, leftDegStart, leftDegEnd) {
  const span = leftDegEnd - leftDegStart
  if (span < 0.01) return ''
  // Convert to standard math angles (0° = right, 90° = up): mathAngle = 180° - leftDeg
  const s = (180 - leftDegStart) * Math.PI / 180
  const e = (180 - leftDegEnd)   * Math.PI / 180
  const f = n => n.toFixed(3)
  const osx = cx + outerR * Math.cos(s), osy = cy - outerR * Math.sin(s)
  const oex = cx + outerR * Math.cos(e), oey = cy - outerR * Math.sin(e)
  const iex = cx + innerR * Math.cos(e), iey = cy - innerR * Math.sin(e)
  const isx = cx + innerR * Math.cos(s), isy = cy - innerR * Math.sin(s)
  const la = span > 179.9 ? 1 : 0  // large-arc-flag: 1 only for the full 180° baseline
  // Outer arc: sweep=1 (clockwise in SVG = left→top→right = through the arch top)
  // Inner arc: sweep=0 (counterclockwise in SVG = right→top→left = return along inner edge)
  return `M ${f(osx)} ${f(osy)} A ${outerR} ${outerR} 0 ${la} 1 ${f(oex)} ${f(oey)} L ${f(iex)} ${f(iey)} A ${innerR} ${innerR} 0 ${la} 0 ${f(isx)} ${f(isy)} Z`
}

// Cap circle at a segment boundary (rounded ends effect)
function CapCircle({ cx, cy, innerR, outerR, leftDeg, fill }) {
  const mathAngle = (180 - leftDeg) * Math.PI / 180
  const capR  = (outerR - innerR) / 2
  const capCx = cx + (innerR + capR) * Math.cos(mathAngle)
  const capCy = cy - (innerR + capR) * Math.sin(mathAngle)
  return <circle cx={capCx.toFixed(2)} cy={capCy.toFixed(2)} r={capR} fill={fill} />
}

// Gauge colors reference CSS variables so they switch with the theme
const GAUGE_COLORS = {
  sage:       'var(--gauge-segment-placed,   #C8D5C0)',
  periwinkle: 'var(--gauge-segment-awaiting, #D5DCEC)',
  chroma:     'var(--gauge-segment-over,     #F2D5E0)',
  baseline:   'var(--gauge-segment-base,     #EDEDEB)',
}

function CapacityCoverageGauge({ totalDemand, totalCapacity, placed, cohort }) {
  const reducedMotion = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const [progress, setProgress] = useState(reducedMotion ? 1 : 0)

  useEffect(() => {
    if (reducedMotion) return
    const start = performance.now()
    const dur = 700
    let raf
    const tick = now => {
      const t = Math.min((now - start) / dur, 1)
      const p = 1 - Math.pow(1 - t, 3)  // easeOutCubic
      setProgress(p)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Derived counts
  const noStudents = totalDemand === 0
  const noCapacity = totalCapacity === 0 && totalDemand > 0
  const awaiting   = noStudents ? 0 : Math.min(Math.max(0, totalCapacity - placed), Math.max(0, totalDemand - placed))
  const unmatched  = noStudents ? 0 : Math.max(0, totalDemand - totalCapacity)

  // Segment spans in degrees (0–180)
  const sageDeg      = noStudents ? 0 : (placed    / totalDemand) * 180
  const periwinkleDeg = noStudents ? 0 : (awaiting  / totalDemand) * 180
  const chromaDeg    = noStudents ? 0 : (unmatched  / totalDemand) * 180

  // Animated fill: total degrees revealed left-to-right
  const filled = 180 * progress

  // Each segment's animated right boundary
  const sageEnd      = Math.min(sageDeg, filled)
  const periwinkleEnd = Math.min(sageDeg + periwinkleDeg, filled)
  const chromaEnd    = Math.min(sageDeg + periwinkleDeg + chromaDeg, filled)

  // Rightmost active segment color (for animated cap)
  const lastColor = chromaEnd > sageDeg + periwinkleDeg ? GAUGE_COLORS.chroma
    : periwinkleEnd > sageDeg ? GAUGE_COLORS.periwinkle
    : sageEnd > 0 ? GAUGE_COLORS.sage
    : null

  // Center text
  let centerBig = '', centerSub = '', centerColor = '#475467'
  if (noStudents) {
    centerBig = '—'; centerSub = 'no students yet'; centerColor = '#98A2B3'
  } else if (noCapacity) {
    centerBig = String(totalDemand); centerSub = 'students, no capacity'; centerColor = '#930045'
  } else if (unmatched > 0) {
    centerBig = String(unmatched)
    centerSub = unmatched === 1 ? 'student over capacity' : 'students over capacity'
    centerColor = '#930045'
  } else if (totalCapacity === totalDemand) {
    centerBig = 'Balanced'; centerSub = 'capacity matches demand'; centerColor = '#2D4A2B'
  } else if (totalCapacity > totalDemand) {
    centerBig = String(totalCapacity - totalDemand); centerSub = 'buffer slots'; centerColor = '#2D4A2B'
  } else {
    centerBig = String(placed); centerSub = 'placed so far'; centerColor = '#2D4A2B'
  }

  const cx = 110, cy = 100, innerR = 70, outerR = 95
  const cohortName = cohort?.name || 'Cohort'

  const showChroma = !noStudents && (chromaDeg > 0 || noCapacity)
  const legend = [
    { color: GAUGE_COLORS.sage,       value: placed,    label: 'placed' },
    { color: GAUGE_COLORS.periwinkle, value: awaiting,  label: 'awaiting' },
    ...(showChroma ? [{ color: GAUGE_COLORS.chroma, value: unmatched, label: 'over cap' }] : []),
  ]

  return (
    <section style={{
      background: 'var(--bg-card,#fff)', border: '1px solid var(--border-card,rgba(29,37,103,0.08))', borderRadius: 14,
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden', fontFamily: 'DM Sans, sans-serif', height: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ padding: '11px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card,rgba(29,37,103,0.04))' }}>
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-caption,#475467)', fontWeight: 600 }}>Capacity Coverage</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted,#98A2B3)' }}>{cohortName} · live snapshot</div>
      </div>

      {/* Gauge left, legend right — wraps on narrow viewports */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: '6px 16px 10px', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto', width: 200 }}>
          <svg width="100%" viewBox="0 0 220 115" style={{ display: 'block' }}>
            {/* Baseline full arch in light gray */}
            <path d={annularPath(cx, cy, innerR, outerR, 0, 180)} fill={GAUGE_COLORS.baseline} stroke="rgba(25,25,25,0.05)" strokeWidth="0.5" />

            {/* Sage — placed */}
            {sageEnd > 0.1 && (
              <path d={annularPath(cx, cy, innerR, outerR, 0, sageEnd)} fill={GAUGE_COLORS.sage} stroke="rgba(25,25,25,0.04)" strokeWidth="0.5">
                <title>{placed} placed</title>
              </path>
            )}
            {/* Periwinkle — awaiting */}
            {periwinkleEnd > sageDeg + 0.1 && (
              <path d={annularPath(cx, cy, innerR, outerR, sageDeg, periwinkleEnd)} fill={GAUGE_COLORS.periwinkle} stroke="rgba(25,25,25,0.04)" strokeWidth="0.5">
                <title>{awaiting} awaiting placement (within capacity)</title>
              </path>
            )}
            {/* Chroma — over capacity */}
            {chromaEnd > sageDeg + periwinkleDeg + 0.1 && (
              <path d={annularPath(cx, cy, innerR, outerR, sageDeg + periwinkleDeg, chromaEnd)} fill={GAUGE_COLORS.chroma} stroke="rgba(25,25,25,0.04)" strokeWidth="0.5">
                <title>{unmatched} students over capacity (no slot available)</title>
              </path>
            )}

            {/* Rounded cap at the left end (fixed) */}
            {(sageEnd > 0.1 || noStudents) && (
              <CapCircle cx={cx} cy={cy} innerR={innerR} outerR={outerR} leftDeg={0} fill={noStudents ? GAUGE_COLORS.baseline : GAUGE_COLORS.sage} />
            )}
            {/* Rounded cap at the animated right end */}
            {lastColor && filled > 0.1 && (
              <CapCircle cx={cx} cy={cy} innerR={innerR} outerR={outerR} leftDeg={filled} fill={lastColor} />
            )}

            {/* Center text inside arch */}
            <text x={cx} y={cy - 27} textAnchor="middle" fontFamily="DM Sans, sans-serif"
              fontSize={centerBig.length > 5 ? 16 : 22} fontWeight="700" fill={centerColor}>
              {centerBig}
            </text>
            <text x={cx} y={cy - 10} textAnchor="middle" fontFamily="DM Sans, sans-serif"
              fontSize="9.5" fontWeight="500" fill="var(--text-muted,#98A2B3)">
              {centerSub}
            </text>
          </svg>
        </div>

        {/* Legend — vertically stacked to the right of the gauge */}
        {!noStudents && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '0 0 auto' }}>
            {legend.map(({ color, value, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-heading,#191919)' }}>{value}</span>
                <span style={{ fontSize: 11, color: 'var(--text-caption,#6b7280)' }}>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── On Campus Today — picture-card layout ────────────────────────────────────

function CampusStudentCard({ log, student, units, onSelectStudent }) {
  const [imgError, setImgError] = useState(false)
  if (!student) return null

  const hasPhoto  = !!(student.headshot_url && !imgError)
  const initials  = `${student.first_name?.[0] || ''}${student.last_name?.[0] || ''}`.toUpperCase()
  const unitName  = log.unit_name || units?.find(u => u.id === student.matched_unit_id)?.unit_name || '—'

  // SHIFT-VIS-1: badge derives from the shift actually being worked (shift_type for completed
  // rows, planned_shift_type for open rows); unknown → "Shift not specified" (never guessed).
  const shiftType = shiftTypeOf(log)
  const { label: shiftLabel, tone } = shiftBadge(shiftType)
  const BADGE_TONES = {
    day:         { bg:'#D1EFD8', color:'#166534' },
    night:       { bg:'#EDE9FE', color:'#5B21B6' },
    mid:         { bg:'#DCEFF8', color:'#1D2567' },
    variable:    { bg:'#E8EAF2', color:'#1D2567' },
    unspecified: { bg:'#F1EFEA', color:'#6b7280' },
  }
  const badge = { ...(BADGE_TONES[tone] || BADGE_TONES.unspecified), label: shiftLabel }

  // SHIFT-VIS-1: open-shift duration + hedged overdue (read-only; live clock_in → now).
  const openShift = isOpenShift(log)
  const openDur   = openShift ? formatDuration(openShiftMs(log)) : null
  const overdue   = openShift && isClockoutMaybeOverdue(log)

  return (
    <button
      onClick={() => onSelectStudent?.(student.id)}
      aria-label={`Open profile for ${student.first_name} ${student.last_name}`}
      style={{ borderRadius:12, border:'1px solid rgba(29,37,103,0.08)', overflow:'hidden',
        boxShadow:'0 1px 3px rgba(0,0,0,0.06)', transition:'transform 0.15s ease, box-shadow 0.15s ease',
        fontFamily:'DM Sans, sans-serif', background:'#fff', cursor:'pointer',
        padding:0, textAlign:'left', display:'block', width:'100%' }}
      onMouseEnter={e => { e.currentTarget.style.transform='scale(1.02)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.10)' }}
      onMouseLeave={e => { e.currentTarget.style.transform='scale(1)';    e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)' }}
      onMouseDown={e => { e.currentTarget.style.transform='scale(0.98)' }}
      onMouseUp={e => { e.currentTarget.style.transform='scale(1.02)' }}
    >
      {/* Photo: top 65% */}
      <div style={{ height:182, background:'#F4F1EC', position:'relative', overflow:'hidden' }}>
        {hasPhoto
          ? <img src={student.headshot_url} alt={`${student.first_name} ${student.last_name}`}
              onError={() => setImgError(true)}
              style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center',
              fontWeight:700, fontSize:36, color:'#9ca3af' }}>{initials}</div>
        }
        <span style={{ position:'absolute', top:8, right:8, background:badge.bg, color:badge.color,
          fontSize:10.5, fontWeight:700, padding:'2px 8px', borderRadius:20 }}>
          {badge.label}
        </span>
      </div>
      {/* Details: bottom 35% */}
      <div style={{ padding:'10px 12px 12px', background:'var(--bg-card,#fff)' }}>
        <div style={{ fontWeight:700, fontSize:14, color:'var(--text-heading,#0E1428)', marginBottom:2,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {student.first_name} {student.last_name}
        </div>
        <div style={{ fontSize:12, color:'var(--text-caption,#6b7280)', marginBottom:2,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {unitName}
        </div>
        {student.matched_preceptor && (
          <div style={{ fontSize:11, color:'#9ca3af', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            with {student.matched_preceptor}
          </div>
        )}
        {openShift ? (
          <div style={{ marginTop:6 }}>
            <div style={{ fontSize:11, color:'#475467', fontWeight:600 }}>
              Open {openDur}
            </div>
            {overdue && (
              <div style={{ marginTop:2, fontSize:10.5, fontWeight:600, color:'#92400e' }}>
                Clock-out may be overdue
              </div>
            )}
          </div>
        ) : (
          log.total_hours != null && (
            <div style={{ marginTop:6, fontSize:11, color:'#475467', fontWeight:500 }}>
              {log.total_hours} hrs logged
            </div>
          )
        )}
      </div>
    </button>
  )
}

// ── Program at a Glance band ──────────────────────────────────────────────────
// KPICell and useUpdatedLabel are shared — imported from ./KPIBand

function ProgramAtAGlance({ totalSlots, placedCount, slotsRemaining, studentsRequesting, gap, participatingUnits, activeSchools, cohort, cohortId }) {
  const placedPct = totalSlots > 0 ? Math.round((placedCount / totalSlots) * 100) : 0
  const updatedLabel = useUpdatedLabel(cohortId)
  return (
    <section style={{ background: 'var(--bg-card,#fff)', border: '1px solid var(--border-card,rgba(29,37,103,0.08))', borderRadius: 14, boxShadow: 'var(--shadow-card)', overflow: 'hidden', fontFamily: 'DM Sans, sans-serif', height: '100%', boxSizing: 'border-box' }}>
      {/* Eyebrow strip */}
      <div style={{ padding: '11px 22px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card,rgba(29,37,103,0.04))' }}>
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-caption,#475467)', fontWeight: 600 }}>
          Program at a Glance
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted,#98A2B3)', fontVariantNumeric: 'tabular-nums', maxWidth: 640 }}>
          {cohort?.name || 'Cohort'} · {studentsRequesting} students · {activeSchools} affiliated schools · {participatingUnits} hosting units · Updated {updatedLabel}
        </div>
      </div>
      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', background: 'var(--border-card,rgba(29,37,103,0.04))', gap: 1 }}>
        <KPICell value={totalSlots}          label="Total Slots"       sub={`${participatingUnits} units`} />
        <KPICell value={placedCount}         label="Slots Filled"      sub={`${placedPct}% of total capacity`} accent="sage" />
        <KPICell value={slotsRemaining}      label="Open Slots" />
        <KPICell value={studentsRequesting}  label="Student Requests"  sub={`${activeSchools} schools`} />
        <KPICell value={Math.abs(gap)}       label={gap > 0 ? 'Placement Gap' : 'Fully Covered'} sub={gap > 0 ? 'More requests than open slots' : 'Enough slots for all'} accent={gap > 0 ? 'warning' : 'sage'} />
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const DIVISIONS = ['Surgical', 'Medical', 'Critical Care', 'Specialty']

// ── Placement Capacity panel — division-grouped, filterable ──────────────────

function UnitResponseRow({ response, filledByUnit, units, primaryLeadMap, showToast, onView }) {
  const [expanded, setExpanded] = useState(false)
  const status    = response.response_status
  const isHosting = status === 'submitted_hosting'
  const isDecline = status === 'submitted_not_hosting'
  const isPending = status === 'pending'
  const desc      = getUnit(response.unit_name)?.description
  const lead      = primaryLeadMap[response.unit_name]

  // UNIT-FORM-RESPONSE-VISIBILITY: lightweight submitter provenance line.
  const submitterLabel = (response.submitted_by_name || '').trim()
    || (response.submitted_by_email || '').trim()
    || (isPending ? null : 'Submitted')
  const tsIso   = response.last_updated_at || response.submitted_at
  const tsLabel = tsIso ? new Date(tsIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const provenance = isPending
    ? 'Awaiting response'
    : [submitterLabel ? `Submitted by ${submitterLabel}` : null, tsLabel].filter(Boolean).join(' · ')

  const filledCount = (() => {
    const unitRow = units.find(u => u.id === response.unit_id)
    return unitRow ? (filledByUnit[unitRow.id] || 0) : 0
  })()

  return (
    <div style={{ opacity: isPending ? 0.6 : 1 }}>
      <div className="ucr-row">
        {/* Left: name + description */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:600, fontSize:12.5, color:'#0E1428', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {response.unit_name}
          </div>
          {desc && (
            <div style={{ fontSize:11, color:'#9ca3af', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {desc}
            </div>
          )}
          {provenance && (
            <div style={{ fontSize:10.5, color:'#b0b9c6', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {provenance}
            </div>
          )}
        </div>
        {/* Right: status badges */}
        <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
          {isHosting && (
            <>
              <span style={{ background:'#C8D5C0', color:'#2D4A2B', fontSize:10.5, fontWeight:700, padding:'2px 8px', borderRadius:12, whiteSpace:'nowrap' }}>
                {response.slots_offered} slot{response.slots_offered === 1 ? '' : 's'}
              </span>
              {filledCount > 0 && (
                <span style={{ fontSize:10.5, color:'#166534', whiteSpace:'nowrap' }}>{filledCount} placed</span>
              )}
              {response.shift_preference && (
                <span className="ov-shift-badge" style={{ fontSize:10.5 }}>{response.shift_preference}</span>
              )}
            </>
          )}
          {isDecline && (
            <button onClick={() => setExpanded(p => !p)}
              style={{ background:'#E8E8E8', color:'#555', fontSize:10.5, fontWeight:600, padding:'2px 9px', borderRadius:12, border:'none', cursor:'pointer', whiteSpace:'nowrap' }}>
              Not hosting {expanded ? '▴' : '▾'}
            </button>
          )}
          {isPending && (
            <button
              onClick={() => showToast(lead
                ? `Contact ${lead.full_name} at ${lead.email} for ${response.unit_name}.`
                : `No primary lead found for ${response.unit_name}. Check unit_leaders table.`)}
              style={{ background:'none', border:'1px dashed #d1d5db', borderRadius:6, padding:'2px 7px', fontSize:10.5, color:'#9ca3af', cursor:'pointer', whiteSpace:'nowrap' }}>
              Remind
            </button>
          )}
          {!isPending && (
            <button
              onClick={(e) => { e.stopPropagation(); onView?.(response) }}
              style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'2px 8px', fontSize:10.5, fontWeight:600, color:'var(--nightfall,#1D2567)', cursor:'pointer', whiteSpace:'nowrap' }}>
              View response
            </button>
          )}
        </div>
      </div>
      {isDecline && expanded && response.reason_for_zero && (
        <div style={{ margin:'0 18px 6px', padding:'6px 10px', fontSize:11.5, color:'#6b7280', borderLeft:'2px solid rgba(25,25,25,0.1)', background:'rgba(25,25,25,0.02)' }}>
          {response.reason_for_zero}
        </div>
      )}
    </div>
  )
}

function PlacementCapacityPanel({
  unitResponses, filledByUnit, units, unitGroupsOpen, toggleUnitGroup,
  primaryLeadMap, showToast, statusFilter, onView,
}) {
  const showAll = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('showAll')

  // Response lookup by unit name (unfiltered, for uninvited check)
  const responseByName = {}
  unitResponses.forEach(r => { responseByName[r.unit_name] = r })

  // Apply status filter
  const filtered = statusFilter === 'all' ? unitResponses : unitResponses.filter(r => {
    if (statusFilter === 'hosting')     return r.response_status === 'submitted_hosting'
    if (statusFilter === 'not_hosting') return r.response_status === 'submitted_not_hosting'
    if (statusFilter === 'pending')     return r.response_status === 'pending'
    return true
  })

  // Group by division, sort alpha within
  const byDiv = {}
  filtered.forEach(r => {
    const div = getUnit(r.unit_name)?.division || 'Other'
    if (!byDiv[div]) byDiv[div] = []
    byDiv[div].push(r)
  })
  Object.values(byDiv).forEach(arr => arr.sort((a, b) => a.unit_name.localeCompare(b.unit_name)))

  // Catalog names per division (for uninvited empty state)
  const catalogByDiv = {}
  UNIT_CATALOG.forEach(u => {
    if (!u.defaultEligible && !showAll) return
    if (!catalogByDiv[u.division]) catalogByDiv[u.division] = []
    catalogByDiv[u.division].push(u.name)
  })

  const divisionsToShow = DIVISION_ORDER.filter(div => {
    if (div === 'Emergency' && !showAll) return false
    if ((byDiv[div]?.length || 0) > 0) return true
    // Always show divisions that have catalog units when filter=all (for uninvited state)
    return statusFilter === 'all' && (catalogByDiv[div]?.length || 0) > 0
  })

  if (unitResponses.length === 0) {
    return <EmptyState icon={<MapPin />} heading="No unit responses yet" subtext="Unit leaders submit /unit-form to register their availability." />
  }
  if (filtered.length === 0 && statusFilter !== 'all') {
    return <div style={{ padding:'28px', textAlign:'center', fontSize:13, color:'#9ca3af' }}>No units match the selected filter.</div>
  }

  return (
    <div className="ov-groups">
      {divisionsToShow.map(div => {
        const divRows     = byDiv[div] || []
        const divHosting  = divRows.filter(r => r.response_status === 'submitted_hosting')
        const divSlots    = divHosting.reduce((s, r) => s + (r.slots_offered || 0), 0)
        const uninvited   = statusFilter === 'all'
          ? (catalogByDiv[div] || []).filter(name => !responseByName[name]).length
          : 0
        // collapsed by default; opens when explicitly set true
        const open = unitGroupsOpen[div] === true

        return (
          <div key={div} className="ov-group">
            <div className="ov-group-row" onClick={() => toggleUnitGroup(div)}>
              <span className="ov-chevron" style={{
                display:'inline-block', transition:'transform 0.15s ease',
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>▸</span>
              <span className="ov-group-name">{div}</span>
              <span style={{ flex:1 }} />
              {divSlots > 0 && (
                <span style={{ fontSize:10.5, color:'#6b7280', marginRight:6, whiteSpace:'nowrap' }}>
                  {divSlots} slot{divSlots !== 1 ? 's' : ''}
                </span>
              )}
              <span className="ov-group-badge">
                {divRows.length} unit{divRows.length !== 1 ? 's' : ''}
              </span>
            </div>

            {open && (
              <div className="ov-group-items">
                {divRows.map(r => (
                  <UnitResponseRow key={r.id} response={r} filledByUnit={filledByUnit}
                    units={units} primaryLeadMap={primaryLeadMap} showToast={showToast} onView={onView} />
                ))}
                {uninvited > 0 && (
                  <div style={{ padding:'5px 10px 2px', fontSize:11, color:'#b0b9c6', fontStyle:'italic' }}>
                    {uninvited} unit{uninvited !== 1 ? 's' : ''} in this division haven't been invited yet.
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

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
  openOutlookCompose({ bcc, subject: FORM_SUBJECT, body })
}

export default function OverviewTab({ students, units, onStudentUpdate, cohortId, cohort, toast, onSelectStudent }) {
  const [unitGroupsOpen,   setUnitGroupsOpen]   = useState({})
  const [schoolGroupsOpen, setSchoolGroupsOpen] = useState({})
  const [unitStatusFilter, setUnitStatusFilter] = useState('all')
  // UNIT-FORM-RESPONSE-VISIBILITY: the unit_cohort_responses row open in the read-only detail drawer.
  const [selectedUnitResponse, setSelectedUnitResponse] = useState(null)
  const [localToast,       setLocalToast]       = useState(null)
  const [campusOpen,       setCampusOpen]       = useState(false)

  // en-CA gives reliable YYYY-MM-DD in the user's local timezone
  const todayStr     = new Date().toLocaleDateString('en-CA')
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA') })()

  // On Campus Now — fetches today + yesterday logs so night shifts spanning midnight are included,
  // then filters in JS to only logs whose canonical shift window contains the current moment.
  const {
    data:      campusLogs = [],
    isLoading: campusLoading,
    refetch:   loadCampusLogs,
  } = useQuery({
    queryKey: ['on_campus_now', cohortId, todayStr],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select('*')
        .eq('cohort_id', cohortId)
        .in('shift_date', [yesterdayStr, todayStr])
        .in('status', ['Auto-Accepted', 'Approved'])
      if (error) throw error

      // KEITH-ON-CAMPUS-NOW-1: shared derivation (active-window filter + per-student dedup)
      // so Keith's server-side On Campus Now uses the exact same logic as this panel.
      return selectActiveWindowRows(data, new Date())
    },
    enabled:        !!cohortId,
    refetchInterval: 60 * 1000,
  })

  // On Campus Now — lifecycle source (S.5): students with a live in_progress
  // check-in from the /shift-log lifecycle. Runs on the same 60s cadence as the
  // time-window fallback above. Independent query so a failure here degrades to
  // fallback-only (and vice versa) rather than blanking the panel.
  const { data: campusLifecycleLogs = [] } = useQuery({
    queryKey: ['on_campus_now_lifecycle', cohortId],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('student_shift_logs')
        // SHIFT-VIS-1: also load lifecycle_state + planned_shift_type (read-only) so open-shift
        // cards can show the shift badge + open duration. No behavior change.
        // ON-CAMPUS-NOW-UX-1: also load unit_name so On Campus Now cards can show the current unit.
        .select('id, student_id, checked_in_at, lifecycle_state, planned_shift_type, unit_name')
        .eq('cohort_id', cohortId)
        .eq('lifecycle_state', 'in_progress')
        .order('checked_in_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled:        !!cohortId,
    refetchInterval: 60 * 1000,
  })

  // Hybrid merge: lifecycle rows take precedence (live check-ins, checked_in_at
  // DESC), then time-window fallback rows excluding any student already shown via
  // lifecycle — so a student appears at most once. S.6 will drop the fallback.
  const mergedCampusLogs = useMemo(
    () => mergeOnCampusNow(campusLifecycleLogs, campusLogs),
    [campusLifecycleLogs, campusLogs]
  )

  // Auto-expand the panel when shifts arrive for the first time
  useEffect(() => {
    if (mergedCampusLogs.length > 0) setCampusOpen(true)
  }, [mergedCampusLogs.length])

  // Unit Response Status — query unit_cohort_responses for current cohort
  const { data: unitResponses = [] } = useQuery({
    queryKey: ['unit_cohort_responses', cohortId],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('unit_cohort_responses')
        .select('*')
        .eq('cohort_id', cohortId)
        .order('unit_name')
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId,
    staleTime: 30000,
  })

  // Unit leaders — for primary lead contact in reminder affordance
  const { data: unitLeadersData = [] } = useQuery({
    queryKey: ['unit_leaders_all'],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('unit_leaders')
        .select('unit_name, full_name, email, role, is_primary_lead')
        .eq('is_active', true)
        .eq('is_primary_lead', true)
      if (error) throw error
      return data || []
    },
    staleTime: 300000,
  })

  // Build primary lead map: unit_name → { full_name, email }
  const primaryLeadMap = {}
  unitLeadersData.forEach(l => { primaryLeadMap[l.unit_name] = l })


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

  const toggleUnitGroup  = div => setUnitGroupsOpen(p => ({ ...p, [div]: p[div] !== true }))
  const expandAllUnits   = () => setUnitGroupsOpen(Object.fromEntries(DIVISION_ORDER.map(d => [d, true])))
  const collapseAllUnits = () => setUnitGroupsOpen({})

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

      {/* ASPIRE-WELCOME-AGGREGATE-3: program-time welcome band above the KPI dashboard (additive). */}
      <AggregateWelcome />

      {/* ════════ STICKY HEADER ════════ */}
      <div className="aggregate-sticky-header">

        {/* Program at a Glance + Capacity Coverage Gauge — two-column, stacks below ~900px */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 20, marginTop: 0, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div style={{ flex: '7 1 0', minWidth: 0 }}>
            <ProgramAtAGlance
              totalSlots={totalSlots}
              placedCount={placedCount}
              slotsRemaining={slotsRemaining}
              studentsRequesting={studentsRequesting}
              gap={gap}
              participatingUnits={participatingUnits}
              activeSchools={activeSchools}
              cohort={cohort}
              cohortId={cohortId}
            />
          </div>
          <div style={{ flex: '3 1 0', minWidth: 180 }}>
            <CapacityCoverageGauge
              totalDemand={totalStudents}
              totalCapacity={totalSlots}
              placed={placedCount}
              cohort={cohort}
            />
          </div>
        </div>

        {/* Frozen panel headers — two columns matching the panels below */}
        <div className="aggregate-panel-headers">
          <div className="aggregate-panel-hdr">
            <div>
              <div className="ov-panel-title">Placement Capacity</div>
              <div className="ov-panel-sub">
                {(() => {
                  const hosting    = unitResponses.filter(r => r.response_status === 'submitted_hosting')
                  const notHosting = unitResponses.filter(r => r.response_status === 'submitted_not_hosting')
                  const pending    = unitResponses.filter(r => r.response_status === 'pending')
                  const slots      = hosting.reduce((s, r) => s + (r.slots_offered || 0), 0)
                  const responded  = hosting.length + notHosting.length
                  const total      = unitResponses.length > 0 ? unitResponses.length : participating.length
                  return `${unitResponses.length > 0 ? responded : participating.length} of ${total} units responded · ${unitResponses.length > 0 ? slots : totalSlots} slots confirmed · ${pending.length} pending`
                })()}
              </div>
            </div>
            {/* Filter chips + Expand/Collapse */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:5 }}>
              {/* Status filter chips */}
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end' }}>
                {(() => {
                  const hostingCount    = unitResponses.filter(r => r.response_status === 'submitted_hosting').length
                  const notHostingCount = unitResponses.filter(r => r.response_status === 'submitted_not_hosting').length
                  const pendingCount    = unitResponses.filter(r => r.response_status === 'pending').length
                  const chips = [
                    { key:'all',         label:'All',         count: unitResponses.length, activeBg:'#1D2567', activeTxt:'#fff'    },
                    { key:'hosting',     label:'Hosting',     count: hostingCount,          activeBg:'#C8D5C0', activeTxt:'#2D4A2B' },
                    { key:'not_hosting', label:'Not hosting', count: notHostingCount,       activeBg:'#E8E8E8', activeTxt:'#555'    },
                    { key:'pending',     label:'Pending',     count: pendingCount,          activeBg:'#f3f4f6', activeTxt:'#6b7280' },
                  ]
                  return chips.map(c => {
                    const active = unitStatusFilter === c.key
                    return (
                      <button key={c.key} onClick={() => setUnitStatusFilter(c.key)}
                        style={{
                          padding:'2px 9px', borderRadius:20, fontSize:10.5, fontWeight: active ? 700 : 500,
                          border: active ? 'none' : '1px solid #e5e7eb',
                          background: active ? c.activeBg : '#fff',
                          color: active ? c.activeTxt : '#6b7280',
                          cursor:'pointer', whiteSpace:'nowrap', fontFamily:'DM Sans,sans-serif',
                        }}>
                        {c.label} ({c.count})
                      </button>
                    )
                  })
                })()}
              </div>
              {/* Expand / Collapse */}
              <div className="ov-expand-toggle">
                <button onClick={expandAllUnits}>Expand All</button>
                <span style={{ color:'var(--border)' }}>·</span>
                <button onClick={collapseAllUnits}>Collapse All</button>
              </div>
            </div>
          </div>
          <div className="aggregate-panel-hdr">
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span className="ov-panel-title">Placement Requests</span>
                <StatusLegendPopover position="bottom-left" />
                <Tooltip label="Copy cohort summary" placement="bottom">
                <button onClick={handleCopyCohortSummary} aria-label="Copy cohort summary"
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', padding:'4px', display:'flex', alignItems:'center' }}>
                  <Copy size={14} />
                </button>
                </Tooltip>
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

          {/* ── Placement Capacity panel (body only) ── */}
          <div className="ov-panel-body">
            {unitResponses.length > 0
              ? <PlacementCapacityPanel
                  unitResponses={unitResponses}
                  filledByUnit={filledByUnit}
                  units={units}
                  unitGroupsOpen={unitGroupsOpen}
                  toggleUnitGroup={toggleUnitGroup}
                  primaryLeadMap={primaryLeadMap}
                  showToast={showToast}
                  statusFilter={unitStatusFilter}
                  onView={setSelectedUnitResponse}
                />
              : <div className="ov-groups">
                  {/* Fallback to legacy view if no unit_cohort_responses rows yet */}
                  {DIVISIONS.map(div => {
                    const divUnits = unitsByDiv[div] || []
                    if (divUnits.length === 0) return null
                    const open       = unitGroupsOpen[div]
                    const divTotal   = divUnits.reduce((s, u) => s + (u.total_slots      || 0), 0)
                    const divFilled  = divUnits.reduce((s, u) => s + (filledByUnit[u.id] || 0), 0)
                    const divBadgeBg    = divFilled >= divTotal ? '#fee2e2' : '#dcfce7'
                    const divBadgeColor = divFilled >= divTotal ? '#991b1b' : '#166534'
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
                            {(unitsByDiv[div] || []).map(u => {
                              const filled    = filledByUnit[u.id] || 0
                              const total     = u.total_slots || 0
                              const isFull    = total > 0 && filled >= total
                              const slotBg    = isFull ? '#fee2e2' : '#dcfce7'
                              const slotColor = isFull ? '#991b1b' : '#166534'
                              return (
                                <div key={u.id} className="ov-unit-row">
                                  <div className="ov-unit-info">
                                    <span className="ov-unit-name">{u.unit_name}</span>
                                    {u.contact_person && <span className="ov-unit-contact">{u.contact_person}</span>}
                                  </div>
                                  <div className="ov-unit-badges">
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
                      subtext="Unit leaders submit the /unit-form to appear here." />
                  )}
                </div>
            }
          </div>

          {/* ── Placement Requests (body only) ── */}
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
                          const ovDispType = s.status === 'Not Proceeding' ? s.active_disposition?.disposition_type : null
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
                                {s.status && ovDispType ? (
                                  (() => {
                                    const c = DISPOSITION_PILL_COLORS[ovDispType] || DISPOSITION_PILL_COLORS['not_selected']
                                    return (
                                      <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>
                                        {DISPOSITION_TYPES[ovDispType] || ovDispType}
                                      </span>
                                    )
                                  })()
                                ) : s.status ? (
                                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:statusCfg.bg, color:statusCfg.text, border:`1px solid ${statusCfg.border}`, whiteSpace:'nowrap' }}>
                                    {s.status}
                                  </span>
                                ) : null}
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

        {/* ── On Campus Now — StudentCard grid, full-collapse when empty ── */}
        {!campusLoading && mergedCampusLogs.length > 0 && (
          <div style={{ margin:'20px 0 24px', fontFamily:'DM Sans, sans-serif' }}>
            {/* Section eyebrow */}
            <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:14 }}>
              <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                <span style={{
                  width:7, height:7, borderRadius:'50%', display:'inline-block',
                  background:'#22c55e', animation:'pulse 2s infinite', flexShrink:0,
                }} />
                <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase',
                  letterSpacing:'0.12em', color:'#0E1428' }}>
                  On Campus Now
                </span>
              </span>
              <span style={{ fontSize:11, color:'#9ca3af' }}>
                {new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' })}
                {' · '}
                {mergedCampusLogs.length} student{mergedCampusLogs.length !== 1 ? 's' : ''}
              </span>
            </div>
            {/* Card grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))',
              gap: 12,
            }}>
              {mergedCampusLogs.map(log => {
                const stu = students.find(s => s.id === log.student_id)
                if (!stu) return null
                // ON-CAMPUS-NOW-UX-1: prefer the current shift log / lifecycle row's unit;
                // fall back to the student's matched/assigned unit when the row has none.
                const unitName = log.unit_name
                  || units?.find(u => u.id === stu.matched_unit_id)?.unit_name
                  || null
                return (
                  <StudentCard
                    key={log.id}
                    variant="on-campus"
                    student={stu}
                    onClick={() => onSelectStudent?.(stu.id)}
                    variantProps={{
                      hoursCompleted: parseFloat(stu.approved_hours) || 0,
                      hoursRequired:  parseFloat(stu.hours_required)  || 200,
                      // SHIFT-VIS-1: shift badge + open-shift duration from the shift log (read-only).
                      shiftType: shiftTypeOf(log),
                      openShift: isOpenShift(log),
                      openDur:   isOpenShift(log) ? formatDuration(openShiftMs(log)) : null,
                      overdue:   isOpenShift(log) && isClockoutMaybeOverdue(log),
                      // ON-CAMPUS-NOW-UX-1: current unit (shift-log/lifecycle first, placement fallback).
                      unit:      unitName,
                    }}
                  />
                )
              })}
            </div>
          </div>
        )}

      </div>

      {/* UNIT-FORM-RESPONSE-VISIBILITY: read-only unit-form response detail (no fetch/edit). */}
      <UnitResponseDrawer
        open={!!selectedUnitResponse}
        response={selectedUnitResponse}
        onClose={() => setSelectedUnitResponse(null)}
      />
    </div>
  )
}
