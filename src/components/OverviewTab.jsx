import { useState, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { openOutlookCompose } from '../lib/outlookCompose'
import { appUrl } from '../lib/appUrl'
import Tooltip from './ui/Tooltip'
import { useQuery } from '@tanstack/react-query'
import { useUpdatedLabel, KPICell } from './KPIBand'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/utils'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
import { getUnit, UNIT_CATALOG, DIVISION_ORDER, getEligibleUnits } from '../lib/unitCatalog'
import { computeUnitResponseMetrics, formatUnitResponseSummary } from '../lib/unitResponseMetrics'
import { listCohortResponseTargets } from '../lib/cohortResponseTargetsClient'
import CohortResponseTargetsModal from './CohortResponseTargetsModal'
import { buildCapacityOutreachRows } from '../lib/capacityOutreach'
import { canonicalUnitKey } from '../lib/canonicalUnit'
import { writeLaunchContext, LAUNCH_KINDS } from '../lib/connect/launchContext'
import { CAPACITY_RESPONSE_TEMPLATE_KEY } from '../lib/connect/templateRegistry'
import { useAuth } from '../contexts/AuthContext'
import StudentAvatar from './StudentAvatar'
import OnCampusNow from './oncampus/OnCampusNow'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import UnitResponseDrawer from './UnitResponseDrawer'
import SchoolResponseDrawer from './SchoolResponseDrawer'
import { matchSchoolResponse } from '../lib/schoolResponseDisplay'
import TodayMasthead from './TodayMasthead'
import { selectActiveWindowRows, mergeOnCampusNow } from '../lib/onCampusNow'
import { shiftTypeOf, shiftBadge, isOpenShift, openShiftMs, formatDuration, isClockoutMaybeOverdue } from '../lib/shiftStatus'
import { buildSchoolSendPlan, buildStudentSendPlan, resolveSendResults } from '../lib/sendFormFlow'
import { GraduationCap, MapPin, Copy } from 'lucide-react'

// ── ASPIRE-MASTHEAD: Placement Snapshot ──────────────────────────────────────
// Program at a Glance and the Capacity Coverage gauge told one supply-and-
// demand story in two disconnected visual languages. This card merges them:
// the KPI row above, the capacity composition bar below, one Updated clock,
// and one number source. Open slots derive from the LIVE placement count
// (total_slots minus matched students), closing the last display consumer of
// the drift-prone stored slots_remaining field per the one-capacity-source
// contract. The bar keeps the gauge's composition math; only the shape
// changed (and the gauge's intro animation retired with it).
// KPICell and useUpdatedLabel are shared - imported from ./KPIBand

const SEGMENT_COLORS = {
  placed:   'var(--gauge-segment-placed,   #C8D5C0)',
  awaiting: 'var(--gauge-segment-awaiting, #D5DCEC)',
  over:     'var(--gauge-segment-over,     #F2D5E0)',
}

function PlacementSnapshot({ totalSlots, placedCount, openSlots, studentsRequesting, gap, participatingUnits, activeSchools, cohort, cohortId }) {
  const updatedLabel = useUpdatedLabel(cohortId)
  const totalDemand = studentsRequesting
  const placedPct = totalSlots > 0 ? Math.round((placedCount / totalSlots) * 100) : 0

  const noStudents = totalDemand === 0
  const noCapacity = totalSlots === 0 && totalDemand > 0
  const awaiting   = noStudents ? 0 : Math.min(Math.max(0, totalSlots - placedCount), Math.max(0, totalDemand - placedCount))
  const unmatched  = noStudents ? 0 : Math.max(0, totalDemand - totalSlots)
  const pctOf = n => noStudents ? 0 : (n / totalDemand) * 100

  const barLabel = noStudents
    ? 'No students yet'
    : `${placedCount} placed, ${awaiting} awaiting placement, ${unmatched} over capacity, of ${totalDemand} student requests`

  return (
    <section className="snap" aria-label="Placement snapshot">
      <div className="snap-head">
        <span className="snap-title">Placement Snapshot</span>
        <span className="snap-sub">
          {cohort?.name || 'Cohort'} · {studentsRequesting} students · {activeSchools} affiliated schools · {participatingUnits} hosting units · Updated {updatedLabel}
        </span>
      </div>
      {/* KPI grid - column count lives in CSS (.glance-kpis) so it can reflow */}
      <div className="glance-kpis snap-kpis">
        <KPICell value={totalSlots}         label="Total Slots"      sub={`${participatingUnits} units`} />
        <KPICell value={placedCount}        label="Slots Filled"     sub={`${placedPct}% of total capacity`} accent="sage" />
        <KPICell value={openSlots}          label="Open Slots" />
        <KPICell value={studentsRequesting} label="Student Requests" sub={`${activeSchools} schools`} />
        <KPICell value={Math.abs(gap)}      label={gap > 0 ? 'Placement Gap' : 'Fully Covered'} sub={gap > 0 ? 'More requests than open slots' : 'Enough slots for all'} accent={gap > 0 ? 'warning' : 'sage'} />
      </div>
      <div className="snap-bar-zone">
        <div className="snap-bar-top">
          <span className="snap-bar-label">Capacity coverage</span>
          <span className="snap-bar-read">
            {noStudents ? 'No students yet'
              : noCapacity ? `${totalDemand} student${totalDemand === 1 ? '' : 's'} · no capacity confirmed`
              : <>{placedPct}% filled <span>· {placedCount} of {totalSlots} confirmed slots</span></>}
          </span>
        </div>
        <div className="snap-bar" role="img" aria-label={barLabel}>
          {!noStudents && placedCount > 0 && (
            <i style={{ width: `${pctOf(placedCount)}%`, background: SEGMENT_COLORS.placed }} title={`${placedCount} placed`} />
          )}
          {!noStudents && awaiting > 0 && (
            <i style={{ width: `${pctOf(awaiting)}%`, background: SEGMENT_COLORS.awaiting }} title={`${awaiting} awaiting placement (within capacity)`} />
          )}
          {!noStudents && unmatched > 0 && (
            <i style={{ width: `${pctOf(unmatched)}%`, background: SEGMENT_COLORS.over }} title={`${unmatched} students over capacity (no slot available)`} />
          )}
        </div>
        {!noStudents && (
          <div className="snap-legend">
            <span><i style={{ background: SEGMENT_COLORS.placed }} /><b>{placedCount}</b> placed</span>
            <span><i style={{ background: SEGMENT_COLORS.awaiting }} /><b>{awaiting}</b> awaiting placement</span>
            {(unmatched > 0 || noCapacity) && (
              <span><i style={{ background: SEGMENT_COLORS.over }} /><b>{unmatched}</b> over capacity</span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ── ASPIRE-MASTHEAD: On Campus Now, promoted ─────────────────────────────────
// The page's only real-time human signal moves directly under the attention
// digest as a compact live strip. The photo-card grid retired from this page
// (photos remain on profiles); the honest live-window logic, shift badges,
// and hedged overdue wording are unchanged. Renders nothing when empty.
function OnCampusStrip({ mergedCampusLogs, students, units, onSelectStudent, onOpenActivity }) {
  if (!mergedCampusLogs.length) return null
  // Rows are built here from staff-scoped data (+ the staff StudentAvatar) and rendered by the
  // shared OnCampusNow card, so the At a Glance dashboard and the Unit Leader portal render the
  // identical card. The output is unchanged: same .mast-live-* classes, same data, same text.
  const rows = mergedCampusLogs.map(log => {
    const stu = students.find(s => s.id === log.student_id)
    if (!stu) return null
    // ON-CAMPUS-NOW-UX-1: prefer the current shift log / lifecycle row's unit;
    // fall back to the student's matched/assigned unit when the row has none.
    const unitName = log.unit_name
      || units?.find(u => u.id === stu.matched_unit_id)?.unit_name
      || null
    const { label: shiftLabel, tone } = shiftBadge(shiftTypeOf(log))
    const open = isOpenShift(log)
    const overdue = open && isClockoutMaybeOverdue(log)
    return {
      key: log.id,
      avatar: <StudentAvatar student={stu} size={38} />,
      name: displayName(stu),
      subLabel: `${unitName || 'Unit not set'}${stu.matched_preceptor ? ` · with ${stu.matched_preceptor}` : ''}`,
      badge: { label: shiftLabel, tone },
      statusText: open
        ? (overdue ? 'Clock-out may be overdue' : `Open ${formatDuration(openShiftMs(log))}`)
        : (log.total_hours != null ? `${log.total_hours} hrs logged` : null),
      statusWarn: overdue,
      onClick: () => onSelectStudent?.(stu.id),
      ariaLabel: `Open profile for ${displayName(stu)}`,
    }
  }).filter(Boolean)
  const sub = `${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    + ` · ${mergedCampusLogs.length} student${mergedCampusLogs.length !== 1 ? 's' : ''}`
  return <OnCampusNow title="On Campus Now" sub={sub} onViewAll={onOpenActivity} rows={rows} />
}

// ─────────────────────────────────────────────────────────────────────────────

const DIVISIONS = ['Surgical', 'Medical', 'Critical Care', 'Specialty']

// ── Placement Capacity panel - division-grouped, filterable ──────────────────

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
            <button type="button" className="ov-group-row" onClick={() => toggleUnitGroup(div)} aria-expanded={!!open}>
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
            </button>

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

Welcome to ASPIRE at Cedars-Sinai. Your final semester is here, and we are excited to support your transition into practice.

Please complete your ASPIRE Intake Form using the link below. This form helps us learn your goals and unit interests and is the first step in matching you with the right clinical environment and preceptor.

Complete your form here: ${appUrl('/student-form')}

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

// ── ASPIRE-CHART: attention digest ───────────────────────────────────────────
// Today leads with what needs a human. Counts come from the SAME canonical
// attention engine as the bell badge and the Action Center panel (App passes
// its derived sets down), so this strip can never disagree with either. Each
// chip opens the Action Center, where every item carries its action.
function AttentionDigest({ attention, onOpenActionCenter }) {
  if (!attention) return null
  const { eager, lazy, supportUnreadCount = 0 } = attention
  const groups = [
    { key: 'decisions', label: 'Decisions needed', count: (eager?.selectionDecision?.length || 0) + (lazy?.dispositionFollowup?.length || 0) },
    { key: 'support', label: 'Support requests', count: supportUnreadCount },
    { key: 'interviews', label: 'Interview outreach', count: (eager?.schedulingLink?.length || 0) + (eager?.interviewReminder?.length || 0) },
    { key: 'placement', label: 'Placement setup', count: (eager?.unitLeaderNotification?.length || 0) + (eager?.preceptorWelcome?.length || 0) + (eager?.noPreceptor?.length || 0) + (eager?.badgeNotCreated?.length || 0) + (eager?.orientationDue ? 1 : 0) },
    { key: 'cslink', label: 'CS-Link access', count: eager?.csLinkNotStarted?.length || 0 },
    { key: 'outreach', label: 'Student outreach', count: eager?.sendStudentForm?.length || 0 },
    { key: 'rotation', label: 'Rotation follow-up', count: lazy?.notLoggedRecently?.length || 0 },
  ].filter(g => g.count > 0)

  if (groups.length === 0) {
    return (
      <div className="today-digest" role="status">
        <span className="chart-chip chart-chip-ok">All caught up · nothing needs your attention right now</span>
      </div>
    )
  }
  return (
    <div className="today-digest">
      <span className="today-digest-lead">Needs attention</span>
      {groups.map(g => (
        <button key={g.key} className="today-digest-btn" onClick={onOpenActionCenter}
          aria-label={`${g.label}: ${g.count} open ${g.count === 1 ? 'action' : 'actions'}. Open Action Center.`}>
          <span>{g.label}</span>
          <span className="today-digest-count" aria-hidden="true">{g.count > 99 ? '99+' : g.count}</span>
        </button>
      ))}
      <button className="today-digest-open" onClick={onOpenActionCenter}>Open Action Center →</button>
    </div>
  )
}

export default function OverviewTab({ students, units, onStudentUpdate, cohortId, cohort, toast, onSelectStudent, attention, onOpenActionCenter, currentUserId }) {
  const [unitGroupsOpen,   setUnitGroupsOpen]   = useState({})
  const [schoolGroupsOpen, setSchoolGroupsOpen] = useState({})
  const [unitStatusFilter, setUnitStatusFilter] = useState('all')
  // UNIT-FORM-RESPONSE-VISIBILITY: the unit_cohort_responses row open in the read-only detail drawer.
  const [selectedUnitResponse, setSelectedUnitResponse] = useState(null)
  // STAFF-SCHOOL-RESPONSE-VISIBILITY-1: the school (group key) open in the read-only School Form
  // Response drawer. The school NAME is stored (not the row) so a failed detail query still opens
  // the drawer with an honest error + Retry instead of silently doing nothing.
  const [responseDrawerSchool, setResponseDrawerSchool] = useState(null)
  const [localToast,       setLocalToast]       = useState(null)
  const [targetsModalOpen, setTargetsModalOpen] = useState(false)
  const [pendingListOpen,  setPendingListOpen]  = useState(false)
  const { isAdmin } = useAuth()

  // ASPIRE-CHART performance: the five workspace tabs stay mounted while
  // hidden, so these 60s polls used to run forever regardless of where the
  // user was. Polling now pauses while another route is visible; the cached
  // data stays available and refreshes on return.
  const onTodayRoute = useLocation().pathname === '/aggregate'
  const navigate = useNavigate()

  // en-CA gives reliable YYYY-MM-DD in the user's local timezone
  const todayStr     = new Date().toLocaleDateString('en-CA')
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA') })()

  // On Campus Now - fetches today + yesterday logs so night shifts spanning midnight are included,
  // then filters in JS to only logs whose canonical shift window contains the current moment.
  const {
    data:      campusLogs = [],
    isLoading: campusLoading,
    error:     campusError,
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
    refetchInterval: onTodayRoute ? 60 * 1000 : false,
  })

  // On Campus Now - lifecycle source (S.5): students with a live in_progress
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
    refetchInterval: onTodayRoute ? 60 * 1000 : false,
  })

  // Hybrid merge: lifecycle rows take precedence (live check-ins, checked_in_at
  // DESC), then time-window fallback rows excluding any student already shown via
  // lifecycle - so a student appears at most once. S.6 will drop the fallback.
  const mergedCampusLogs = useMemo(
    () => mergeOnCampusNow(campusLifecycleLogs, campusLogs),
    [campusLifecycleLogs, campusLogs]
  )

  // Unit Response Status - query unit_cohort_responses for current cohort
  const { data: unitResponses = [], error: unitResponsesError, isLoading: unitResponsesLoading, refetch: refetchUnitResponses } = useQuery({
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

  // Explicit per-cohort outreach targets (the denominator for responded/pending), read ONLY through the
  // staff-authorized server endpoint (the table's RLS denies the browser directly). FAIL CLOSED: until
  // the Owner migration is applied AND a cohort's targets are configured, `targets` is empty and the
  // summary shows an honest "targets not set" state rather than a misleading "0 pending".
  const { data: targetData = { ready: false, targets: [] }, refetch: refetchTargets } = useQuery({
    queryKey: ['cohort_unit_response_targets', cohortId],
    queryFn: async () => {
      const { ready, targets } = await listCohortResponseTargets(cohortId)
      return { ready, targets }
    },
    enabled: !!cohortId,
    staleTime: 30000,
    retry: false,
  })
  const unitResponseTargets = targetData.targets || []

  // STAFF-SCHOOL-RESPONSE-VISIBILITY-1: full school placement responses for the active cohort,
  // powering the read-only School Form Response drawer. DISTINCT query key from the date-only
  // ['cohort_rotation_range', ...] consumers (CohortBar/ManageCohortModal), which must stay bounded
  // to the two date columns. Read-only select with an EXPLICIT allowlist: exactly the fields the
  // response association and SchoolResponseDrawer render - never audit columns (created_by,
  // updated_by) or unrelated future columns. Independent failure never blocks the student list.
  const SCHOOL_RESPONSE_FIELDS = [
    'id', 'cohort_id', 'school_name', 'coordinator_name', 'coordinator_email',
    'rotation_start_date', 'rotation_end_date',
    'unavailable_weekdays', 'min_days_per_week', 'weekends_allowed', 'nights_allowed',
    'blackout_dates', 'scheduling_notes', 'created_at', 'updated_at',
  ].join(', ')
  const {
    data: schoolResponses = [],
    error: schoolResponsesError,
    isLoading: schoolResponsesLoading,
    refetch: refetchSchoolResponses,
  } = useQuery({
    queryKey: ['cohort_school_responses', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select(SCHOOL_RESPONSE_FIELDS)
        .eq('cohort_id', cohortId)
        .order('school_name')
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId,
    staleTime: 30000,
  })

  // Unit leaders - for primary lead contact in reminder affordance
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
  const totalStudents       = students.length
  const slotsFilled         = students.filter(s => s.matched_unit_id).length
  const placedCount         = slotsFilled
  const netRemaining        = totalSlots - slotsFilled
  // ASPIRE-MASTHEAD (D6): open slots display from the LIVE placement count,
  // never the stored slots_remaining field (one-capacity-source contract).
  const openSlotsLive       = Math.max(0, netRemaining)
  const gap                 = totalStudents - totalSlots  // positive = short on slots
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
      `Open Slots: ${openSlotsLive} of ${totalSlots}`,
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

  // ASPIRE-CHART approved Send Form semantics: opening a draft NEVER changes
  // status. The staff member confirms the email actually went out, and only
  // that confirmation writes 'Form Sent'. Cancel/close writes nothing. The
  // app cannot detect an Outlook send event and does not pretend to.
  const [sendFormPlan, setSendFormPlan] = useState(null)
  const [sendFormBusy, setSendFormBusy] = useState(false)

  const handleSendSchool = (school, sStudents) => {
    const plan = buildSchoolSendPlan(school, sStudents)
    if (!plan) { showToast(`No Pending Outreach students at ${school}.`); return }
    openMailto(plan.emails.join(';'), buildFormBody())
    setSendFormPlan(plan)
  }

  const handleSendStudent = student => {
    const plan = buildStudentSendPlan(student)
    openMailto(student.school_email, buildFormBody(student.first_name || 'ASPIRE Student'))
    setSendFormPlan(plan)
  }

  const handleConfirmFormSent = async () => {
    if (!sendFormPlan || !onStudentUpdate) { setSendFormPlan(null); return }
    setSendFormBusy(true)
    const results = []
    for (const s of sendFormPlan.students) {
      const error = await onStudentUpdate(s.id, { status: 'Form Sent' })
      results.push({ student: s, error })
    }
    const outcome = resolveSendResults(sendFormPlan, results)
    setSendFormBusy(false)
    if (outcome.status === 'done') {
      setSendFormPlan(null)
      showToast(`${outcome.succeeded.length === 1 ? displayName(outcome.succeeded[0]) : `${outcome.succeeded.length} students`} marked as Form Sent.`)
    } else {
      // Partial failure: keep only the failed students pending so Mark as
      // sent can be retried for exactly those records.
      setSendFormPlan(outcome.plan)
      showToast(`${outcome.failed.length} status update${outcome.failed.length === 1 ? '' : 's'} failed. You can retry.`)
    }
  }

  const handleCancelFormSent = () => {
    setSendFormPlan(null)
    showToast('No status was changed.')
  }

  // ── CAPACITY-RESPONSE-OUTREACH-2: Send capacity request (launch → Connect → confirm on return) ──
  // Launching writes ONLY the session launch context and navigates to ASPIRE Connect → Outreach →
  // Send to Many with the cohort, Unit Leadership recipients, and the Unit Leader Capacity Request
  // template preselected. No email is sent here, and no unit becomes a target until the Owner
  // confirms on return. Launched units = catalog units with a resolvable ACTIVE primary lead that
  // are not already active targets.
  const handleLaunchCapacityRequest = () => {
    const activeCanon = new Set((unitResponseTargets || []).map(t => canonicalUnitKey(t.unit_key)))
    const rows = buildCapacityOutreachRows({
      catalog: getEligibleUnits(true),
      leads: unitLeadersData,
      activeTargetCanons: activeCanon,
    })
    const launchable = rows.filter(r => r.hasRecipient && !r.alreadyTarget)
    if (launchable.length === 0) {
      showToast('No unit leader recipients could be resolved. Add unit leads or mark units as already contacted.')
      setTargetsModalOpen(true)
      return
    }
    writeLaunchContext({
      kind: LAUNCH_KINDS.CAPACITY_REQUEST,
      cohortId,
      cohortName: cohort?.name || '',
      source: 'at_a_glance_capacity',
      templateKey: CAPACITY_RESPONSE_TEMPLATE_KEY,
      returnPath: '/aggregate',
      units: launchable.map(r => ({ key: r.key, name: r.name, email: r.recipientEmail })),
    })
    navigate('/connect/outreach?launch=1')
  }

  return (
    <div className="overview-tab">
      {/* Toast - fixed, lives outside scroll containers */}
      {localToast && (
        <div style={{
          position:'fixed', top:80, right:24, zIndex:9999,
          background:'var(--nightfall)', color:'var(--pearl)',
          fontSize:14, fontWeight:500, padding:'12px 18px',
          borderRadius:6, boxShadow:'0 4px 16px rgba(0,0,0,0.25)', maxWidth:360,
        }}>{localToast}</div>
      )}

      {/* ASPIRE-CHART: confirm-gated Send Form. Rendered as a small dialog so
          the decision (did the email actually go out?) is explicit. */}
      {sendFormPlan && (
        <div role="dialog" aria-modal="true" aria-label={sendFormPlan.confirmTitle}
          style={{ position:'fixed', inset:0, zIndex:9997, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(15,23,42,0.28)' }}>
          <div style={{ background:'var(--chart-card,#fff)', borderRadius:14, border:'1px solid var(--chart-line)', boxShadow:'0 12px 40px rgba(15,23,42,0.22)', padding:'20px 22px', width:'min(440px, calc(100vw - 32px))', fontFamily:'DM Sans,sans-serif' }}>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--chart-ink)', marginBottom:8 }}>{sendFormPlan.confirmTitle}</div>
            <div style={{ fontSize:13, color:'var(--chart-ink-soft)', lineHeight:1.5, marginBottom:8 }}>{sendFormPlan.confirmBody}</div>
            <div style={{ fontSize:12, color:'var(--chart-ink-soft)', marginBottom:14 }}>
              {sendFormPlan.students.map(s => displayName(s)).join(' · ')}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={handleCancelFormSent} disabled={sendFormBusy}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'DM Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Not sent
              </button>
              <button onClick={handleConfirmFormSent} disabled={sendFormBusy}
                style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--chart-navy)', color:'#fff', fontFamily:'DM Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                {sendFormBusy ? 'Saving…' : 'Mark as sent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ ASPIRE-MASTHEAD: briefing masthead, then triage, then the
          live campus signal, then the merged snapshot. Everything orientation
          lives in the masthead card; the page says hello exactly once. ════════ */}
      <TodayMasthead students={students} cohort={cohort} cohortId={cohortId}
        currentUserId={currentUserId} onTodayRoute={onTodayRoute} />
      <AttentionDigest attention={attention} onOpenActionCenter={onOpenActionCenter} />
      <OnCampusStrip
        mergedCampusLogs={campusLoading ? [] : mergedCampusLogs}
        students={students} units={units}
        onSelectStudent={onSelectStudent}
        onOpenActivity={() => navigate('/rotation/activity')}
      />

      <PlacementSnapshot
        totalSlots={totalSlots} placedCount={placedCount} openSlots={openSlotsLive}
        studentsRequesting={studentsRequesting} gap={gap}
        participatingUnits={participatingUnits} activeSchools={activeSchools}
        cohort={cohort} cohortId={cohortId}
      />

      {/* ════════ STICKY LEDGER HEADERS ════════
          Slimmed by owner decision D5: the masthead, digest, and snapshot
          scroll away; only these thin panel headers stay pinned (their
          subtitles keep the counts in view while scrolling the ledgers). */}
      <div className="aggregate-sticky-header">
        {/* Frozen panel headers - two columns matching the panels below */}
        <div className="aggregate-panel-headers">
          <div className="aggregate-panel-hdr">
            <div>
              <div className="ov-panel-title">Placement Capacity</div>
              {(() => {
                // Do not show a misleading "0 pending" before the response data has settled.
                if (unitResponsesError) return <div className="ov-panel-sub">Unit responses are unavailable right now.</div>
                if (unitResponsesLoading) return <div className="ov-panel-sub">Loading unit responses…</div>
                // Denominator = the cohort's explicit outreach targets (fail-closed to "not set").
                const m = computeUnitResponseMetrics({ targets: unitResponseTargets, responses: unitResponses })
                const hasPending = m.configured && m.pendingUnitCount > 0 && m.pendingUnitNames.length > 0
                const hasOrphans = m.orphanResponseCount > 0
                return (
                  <div className="ov-panel-sub">
                    <span>{formatUnitResponseSummary(m)}</span>
                    {isAdmin && (
                      <button type="button" onClick={handleLaunchCapacityRequest}
                        title="Open ASPIRE Connect → Outreach → Send to Many with the capacity request preselected"
                        style={{ marginLeft: 8, background: 'none', border: 'none', color: '#1D2567', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', padding: 0, fontWeight: 700 }}>
                        Send capacity request
                      </button>
                    )}
                    {isAdmin && (
                      <button type="button" className="ov-linkish" onClick={() => setTargetsModalOpen(true)}
                        style={{ marginLeft: 8, background: 'none', border: 'none', color: '#1D2567', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>
                        Configure response targets
                      </button>
                    )}
                    {hasPending && (
                      <>
                        {' · '}
                        <button type="button" aria-expanded={pendingListOpen} aria-controls="ov-pending-units"
                          onClick={() => setPendingListOpen(o => !o)}
                          style={{ background: 'none', border: 'none', color: '#6b7280', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>
                          {m.pendingUnitCount} pending{pendingListOpen ? ' ▴' : ' ▾'}
                        </button>
                        {pendingListOpen && (
                          <ul id="ov-pending-units" style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: '#6b7280' }}>
                            {m.pendingUnitNames.map((n, i) => <li key={`p${i}`}>{n}</li>)}
                            {hasOrphans && (
                              <li style={{ marginTop: 4, listStyle: 'none', color: '#92400e' }}>
                                Orphan responses (no target): {m.orphanUnitNames.join(', ')}
                              </li>
                            )}
                          </ul>
                        )}
                      </>
                    )}
                    {!hasPending && hasOrphans && (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                        {m.orphanResponseCount} response{m.orphanResponseCount === 1 ? '' : 's'} without a target: {m.orphanUnitNames.join(', ')}
                      </div>
                    )}
                  </div>
                )
              })()}
              {targetsModalOpen && (
                <CohortResponseTargetsModal
                  cohortId={cohortId}
                  cohortName={cohort?.name}
                  onClose={() => setTargetsModalOpen(false)}
                  onChanged={() => refetchTargets()}
                />
              )}
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

        {/* ASPIRE-CHART honest error states: a failed query must never
            masquerade as "nothing needs attention". */}
        {(unitResponsesError || campusError) && (
          <div className="today-error" role="alert">
            <span>
              {unitResponsesError ? 'Unit responses could not load. The Placement Capacity panel may be incomplete. ' : ''}
              {campusError ? 'On Campus Now could not load. ' : ''}
            </span>
            <button onClick={() => { if (unitResponsesError) refetchUnitResponses(); if (campusError) loadCampusLogs() }}>
              Retry
            </button>
          </div>
        )}

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
                        <button type="button" className="ov-group-row" onClick={() => toggleUnitGroup(div)} aria-expanded={!!open}>
                          <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                          <span className="ov-group-name">{div}</span>
                          <span className="ov-group-badge" style={{ background: divBadgeBg, color: divBadgeColor }}>
                            {divFilled}/{divTotal} filled
                          </span>
                        </button>
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
                    {/* STAFF-SCHOOL-RESPONSE-VISIBILITY-1: the header row is a flex wrapper so the
                        accordion toggle and View response are SEPARATE buttons (never nested);
                        View response opens the read-only drawer without expanding the group. The
                        toggle keeps the ORIGINAL full-row hit area - chevron, school info,
                        coordinator line, AND both badges all expand/collapse the group. */}
                    <div className="ov-group-row ov-school-row">
                      <button type="button" className="ov-school-toggle" onClick={() => toggleSchoolGroup(school)} aria-expanded={!!open}>
                        <span className="ov-chevron">{open ? '▾' : '▸'}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <span className="ov-group-name">{school}</span>
                          {coord && (coord.name || coord.email) && (
                            <div className="ov-coord-line">
                              {coord.name}{coord.name && coord.email ? ' | ' : ''}{coord.email}
                            </div>
                          )}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
                          {placed > 0 && (
                            <span style={{ background:'#dcfce7', color:'#166534', fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20 }}>
                              {placed} placed
                            </span>
                          )}
                          <span className="ov-group-badge">
                            {sStudents.length} student{sStudents.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </button>
                      <button type="button" className="ov-view-response-btn"
                        onClick={e => { e.stopPropagation(); setResponseDrawerSchool(school) }}>
                        View response
                      </button>
                    </div>

                    {open && (
                      <div className="ov-group-items">
                        {/* Send Form to School - only when at least one student is Pending Outreach */}
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

      </div>

      {/* UNIT-FORM-RESPONSE-VISIBILITY: read-only unit-form response detail (no fetch/edit). */}
      <UnitResponseDrawer
        open={!!selectedUnitResponse}
        response={selectedUnitResponse}
        onClose={() => setSelectedUnitResponse(null)}
      />

      {/* STAFF-SCHOOL-RESPONSE-VISIBILITY-1: read-only school placement response detail. */}
      {(() => {
        if (!responseDrawerSchool) return null
        const group = schoolMap[responseDrawerSchool] || []
        const drawerResponse = matchSchoolResponse(responseDrawerSchool, group, schoolResponses)
        // Every student associated with the response: canonical rotation-id links first, plus this
        // school group's legacy rows that predate the link. Students linked to a DIFFERENT
        // response are never pulled in.
        const drawerStudents = drawerResponse
          ? [
              ...students.filter(s => s.cohort_school_rotation_id === drawerResponse.id),
              ...group.filter(s => !s.cohort_school_rotation_id),
            ]
          : group
        return (
          <SchoolResponseDrawer
            open
            onClose={() => setResponseDrawerSchool(null)}
            schoolName={responseDrawerSchool}
            response={drawerResponse}
            students={drawerStudents}
            loading={schoolResponsesLoading}
            error={schoolResponsesError}
            onRetry={refetchSchoolResponses}
          />
        )
      })()}
    </div>
  )
}
