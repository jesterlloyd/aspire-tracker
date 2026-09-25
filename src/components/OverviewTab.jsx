import { useState, useMemo, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Tooltip from './ui/Tooltip'
import { useQuery } from '@tanstack/react-query'
import { useUpdatedLabel } from './KPIBand'
import { supabase } from '../lib/supabase'
import { getAllUnitLeaders } from '../lib/unitLeaders'
import { unitNameKey } from '../lib/unitNameCanon'
import { displayName } from '../lib/utils'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_CONFIG } from '../lib/constants'
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions'
import { getUnit, DIVISION_ORDER, getEligibleUnits } from '../lib/unitCatalog'
import { computeUnitResponseMetrics } from '../lib/unitResponseMetrics'
import { listCohortResponseTargets, createCohortResponseTargets } from '../lib/cohortResponseTargetsClient'
import { buildCapacityOutreachRows } from '../lib/capacityOutreach'
import { UNIT_LEADERSHIP_ROLES } from '../lib/contactCategories'
import UnitSetupPanel from './UnitSetupPanel'
import { capacitySlotsFor, applyUnitSetup } from '../lib/capacitySlots'
import { canPerformMatching } from '../lib/permissions'
import { canonicalUnitKey } from '../lib/canonicalUnit'
import { writeLaunchContext, readLaunchContext, clearLaunchContext, LAUNCH_KINDS } from '../lib/connect/launchContext'
import { CAPACITY_RESPONSE_TEMPLATE_KEY, CAPACITY_REMINDER_TEMPLATE_KEY } from '../lib/connect/templateRegistry'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import StudentAvatar from './StudentAvatar'
import StatusLegendPopover from './StatusLegendPopover'
import UnitResponseDrawer from './UnitResponseDrawer'
import SchoolResponseDrawer from './SchoolResponseDrawer'
import { matchSchoolResponse } from '../lib/schoolResponseDisplay'
import { schoolGroupKey } from '../lib/schoolIdentity'
import { scopeInterviewsForViewer } from '../lib/interviewsToday'
import { buildSchoolSendPlan, buildStudentSendPlan, resolveSendResults } from '../lib/sendFormFlow'
import { toLocalDateStr } from '../lib/designTokens'
import { getUsHolidaysForRange } from '../lib/usHolidays'
import { mastheadItems, holidayItems } from '../lib/mastheadEvents'
import { resolvePreceptor } from '../lib/preceptor'
import { SURVEY_CATALOG } from '../lib/evaluation/surveyCatalog'
import { useSignaturesFlag } from './signatures/sigApi'
import { useFormsStatus } from './forms/formsApi'
import { Copy, Settings2, Send, BellRing, Mail } from 'lucide-react'

// ── HOME-1 (2026-09-24): At a Glance is the app home ─────────────────────────
// Two questions, in this order: what needs me (Needs you, one queue across every
// module) and what do I want to do (the launcher: actions, people, Keith). The
// pieces live in src/components/home/; every figure comes from src/lib/home/,
// which is pure and tested. This file keeps the Placement machinery it always had
// (unit responses, targets, the capacity outreach launches and their return
// confirmations, the two drawers, Set Up Units) and hands it to the Placement
// card at the bottom of the page.
import HomeBanner from './home/HomeBanner'
import NeedsYou from './home/NeedsYou'
import TodayCard from './home/TodayCard'
import CohortPulse from './home/CohortPulse'
import PlacementCard from './home/PlacementCard'
import RecentActivity from './home/RecentActivity'
import { ApplicationsOutreach, SurveysResults } from './home/PhaseCards'
import { derivePhase, pipelineCounts } from '../lib/home/cyclePhase'
import {
  messagesGroup, signaturesGroup, reviewReleaseGroup, formsDocsGroup, interviewsGroup, placementGroup,
} from '../lib/home/needsYouModel'
import { scheduleRows, onCampusGroups, dueTodayItems } from '../lib/home/todayModel'
import { hoursBar, midpointBar } from '../lib/home/cohortPulseModel'
import { placementSummary, capacityByServiceLine, requestsBySchool, REQUEST_FILTERS, requestCounts, filterRequestRows } from '../lib/home/placementSummaryModel'
import { NavigationPill } from './ui/NavigationPill'
import { allowedActions, personRows } from '../lib/home/launcherModel'
import { activityRows } from '../lib/home/recentActivityModel'
import { applicationsSummary, latestOutreachOpenRate, surveysSummary } from '../lib/home/phaseCardsModel'
import {
  loadMessagesNeedingYou, loadSignaturesList, loadReviewQueues, loadCatalogTracker, loadTodaysInterviews,
  loadRotationWindows, loadTodaysShifts, loadRecentActivity, loadLauncherContacts,
} from '../lib/home/homeLoaders'
import './home/home.css'

const WORKFLOWS = SURVEY_CATALOG.map(s => ({ key: s.key, label: s.label }))
const qStatus = (q) => (q.status === 'error' ? 'error' : q.status === 'success' ? 'ready' : 'loading')

// ── Placement Capacity rows (unchanged from the ledger they came from) ────────

function UnitResponseRow({ response, filledByUnit, units, primaryLeadMap, showToast, onView }) {
  const [expanded, setExpanded] = useState(false)
  // HOSTING-STATUS-SETUP-1: status follows Set Up Units (applyUnitSetup); response_status stays the form's.
  const status    = response.capacity_status
  const isHosting = status === 'hosting'
  const isDecline = status === 'not_hosting'
  const isPending = status === 'pending'
  const desc      = getUnit(response.unit_name)?.description
  const lead      = primaryLeadMap[unitNameKey(response.unit_name)]

  // UNIT-FORM-RESPONSE-VISIBILITY: lightweight submitter provenance line.
  const submitterLabel = (response.submitted_by_name || '').trim()
    || (response.submitted_by_email || '').trim()
    || (isPending ? null : 'Submitted')
  const tsIso   = response.last_updated_at || response.submitted_at
  const tsLabel = tsIso ? new Date(tsIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const provenance = [
    response.submitted
      ? [submitterLabel ? `Submitted by ${submitterLabel}` : null, tsLabel].filter(Boolean).join(' · ')
      : (response.synthetic && !isPending ? null : 'Awaiting response'),
    response.setup_note,
  ].filter(Boolean).join(' · ')

  const slotInfo = capacitySlotsFor(response, units)

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
              {/* CAPACITY-LIVE-SLOTS-1: the unit's live slots (Set Up Units), not the form offer. */}
              <span data-testid="capacity-slot-pill" style={{ background:'#C8D5C0', color:'#2D4A2B', fontSize:10.5, fontWeight:700, padding:'2px 8px', borderRadius:12, whiteSpace:'nowrap' }}>
                {slotInfo.slots} slot{slotInfo.slots === 1 ? '' : 's'}
              </span>
              {slotInfo.adjusted && response.response_status === 'submitted_hosting' && (
                <span data-testid="capacity-slot-offered" style={{ fontSize:10.5, color:'#9ca3af', whiteSpace:'nowrap' }}
                  title={`The unit leader offered ${slotInfo.offered}; capacity was changed in Set Up Units.`}>
                  {slotInfo.offered} offered
                </span>
              )}
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
                : `No unit lead is on file for ${response.unit_name}. Add the Associate Director in ASPIRE Connect, Contacts.`)}
              style={{ background:'none', border:'1px dashed #d1d5db', borderRadius:6, padding:'2px 7px', fontSize:10.5, color:'#9ca3af', cursor:'pointer', whiteSpace:'nowrap' }}>
              Remind
            </button>
          )}
          {response.submitted && (
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

export default function OverviewTab({ students, units, onStudentUpdate, cohortId, cohort, toast, currentUserId, onRefreshUnits, onOpenStudent, matches = null, communications = [] }) {
  // UNIT-POOL-REFINEMENT-1: unit setup moved here from the Placement Board. The
  // hosting decisions this panel tracks are what decide which units participate,
  // so the form that records that decision now lives beside them - and the
  // operational board can no longer add, remove, or reconfigure hosting units.
  const [showUnitSetup, setShowUnitSetup] = useState(false)
  const [unitStatusFilter, setUnitStatusFilter] = useState('hosting')
  // HOME-1: Requests by school's own filter, counted in students (Owner, 2026-09-25).
  const [requestFilter, setRequestFilter] = useState('all')
  // UNIT-FORM-RESPONSE-VISIBILITY: the unit_cohort_responses row open in the read-only detail drawer.
  const [selectedUnitResponse, setSelectedUnitResponse] = useState(null)
  // STAFF-SCHOOL-RESPONSE-VISIBILITY-1: the school (group key) open in the read-only School Form
  // Response drawer. The school NAME is stored (not the row) so a failed detail query still opens
  // the drawer with an honest error + Retry instead of silently doing nothing.
  const [responseDrawerSchool, setResponseDrawerSchool] = useState(null)
  const [localToast,       setLocalToast]       = useState(null)
  const { userProfile, isAdmin } = useAuth()

  // ASPIRE-CHART performance: the five workspace tabs stay mounted while
  // hidden, so these 60s polls used to run forever regardless of where the
  // user was. Polling now pauses while another route is visible; the cached
  // data stays available and refreshes on return.
  const location = useLocation()
  const onTodayRoute = location.pathname === '/aggregate'
  const navigate = useNavigate()

  // en-CA gives reliable YYYY-MM-DD in the user's local timezone
  const todayStr     = new Date().toLocaleDateString('en-CA')
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA') })()

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
  const unitResponseTargets = useMemo(() => targetData.targets || [], [targetData])

  // CAPACITY-FILTER-REMINDER-1: ONE metrics source powers the header pills and pending synthesis
  // (same computeUnitResponseMetrics({ targets: unitResponseTargets, responses: unitResponses })
  // contract as before; the prose summary line retired by Owner decision - pills are the indicators).
  const unitMetrics = useMemo(
    () => computeUnitResponseMetrics({ targets: unitResponseTargets, responses: unitResponses }),
    [unitResponseTargets, unitResponses])

  // Pending targets with NO response row of any kind get a synthetic pending row so they appear in
  // their correct catalog divisions (units are created lazily on submission, so a never-responding
  // target has no unit_cohort_responses row at all). Synthetic rows are display-only: pending
  // status, no slots, no unit_id, never written anywhere.
  const capacityRows = useMemo(() => {
    if (!unitMetrics.configured) return unitResponses
    const seen = new Set(unitResponses.map(r => canonicalUnitKey(r.unit_name)))
    const synthetic = (unitMetrics.pendingUnitNames || [])
      .filter(n => !seen.has(canonicalUnitKey(n)))
      .map(n => ({
        id: `pending-target-${canonicalUnitKey(n)}`,
        unit_name: n, response_status: 'pending',
        unit_id: null, slots_offered: null, synthetic: true,
      }))
    return synthetic.length ? [...unitResponses, ...synthetic] : unitResponses
  }, [unitMetrics, unitResponses])

  // HOSTING-STATUS-SETUP-1: every capacity surface (pills, filters, rows, division totals, the
  // pending reminder) reads capacity_status, which Set Up Units decides for units it knows.
  const capacityView = useMemo(() => applyUnitSetup(capacityRows, units), [capacityRows, units])

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

  // Unit leaders - ALL active Unit Leader contacts in ASPIRE Connect (UNIT-LEADERS-RETIRE-1),
  // as leader rows. CAPACITY-FILTER-REMINDER-1 preselects role-based recipients (Associate
  // Director, Assistant Nurse Manager, NPD Practitioner) per unit; the lead map below reads
  // the derived is_primary_lead (the unit's Associate Director, else its Director).
  const { data: unitLeadersData = [] } = useQuery({
    queryKey: ['unit_leader_contacts'],
    queryFn:  getAllUnitLeaders,
    staleTime: 300000,
  })

  // Build the lead map keyed on the unit-name canon, so '6NE' on a contact still finds the
  // '6 NE' response: unit key → { full_name, email }
  const primaryLeadMap = {}
  unitLeadersData.forEach(l => { const k = unitNameKey(l.unit_name); if (l.is_primary_lead && k && !primaryLeadMap[k]) primaryLeadMap[k] = l })


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
  // PROCEEDING-GAP-1 (Owner, 2026-09-10): Not Proceeding and Declined students never need a
  // slot, so the fifth card counts proceeding students only (src/lib/placementCoverage.js).
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

  // ── School grouping ────────────────────────────────────────
  // AP-SCHOOL-CANONICALIZATION-1 defensive safeguard: group Placement Requests by the school's
  // OPERATIVE identity (alias-aware), so a stored variant like "California State University,
  // Northridge" can never split a school into a second group beside "Cal State Northridge" even if
  // a stray variant reaches the data. Unknown school strings group by exactly what was stored.
  const schoolMap = {}
  students.forEach(s => {
    const key = schoolGroupKey(s.school) || 'Unknown School'
    if (!schoolMap[key]) schoolMap[key] = []
    schoolMap[key].push(s)
  })

  // ASPIRE-CHART approved Send Form semantics: opening a draft NEVER changes
  // status. The staff member confirms the email actually went out, and only
  // that confirmation writes 'Form Sent'. Cancel/close writes nothing. The
  // app cannot detect an Outlook send event and does not pretend to.
  const [sendFormPlan, setSendFormPlan] = useState(null)
  const [sendFormBusy, setSendFormBusy] = useState(false)

  // School send (ASPIRE-DESIGN-CORRECTION-1, Owner-directed 2026-07-29, superseding the earlier
  // coordinator-mediated decision): Send Forms to Students (the school-level batch action) opens
  // Connect with audience STUDENTS - the school's Pending Outreach students preselected - and the
  // Student Profile Form Invitation
  // template (/student-form link populated). The affected student ids ride in the return context;
  // statuses change only after the Owner confirms on return, and only for students Connect reported
  // as actually sent. No mailto.
  const handleSendSchool = (school, sStudents) => {
    const plan = buildSchoolSendPlan(school, sStudents)
    if (!plan) { showToast(`No Pending Outreach students at ${school}.`); return }
    writeLaunchContext({
      kind: LAUNCH_KINDS.SCHOOL_FORM,
      cohortId,
      cohortName: cohort?.name || '',
      source: 'at_a_glance_school_outreach',
      templateKey: 'student_profile_invitation',
      returnPath: '/aggregate',
      studentIds: plan.students.map(s => s.id),
      school,
    })
    navigate('/connect/outreach?launch=1')
  }

  // Direct single-student send: Students source, this student preselected. No mailto.
  const handleSendStudent = student => {
    if (!student) return
    writeLaunchContext({
      kind: LAUNCH_KINDS.STUDENT_FORM,
      cohortId,
      cohortName: cohort?.name || '',
      source: 'at_a_glance_student_outreach',
      templateKey: 'student_profile_invitation',
      returnPath: '/aggregate',
      studentIds: [student.id],
    })
    navigate('/connect/outreach?launch=1')
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
      // Decision fully executed: a Connect-launched confirmation can never reopen.
      clearLaunchContext()
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
    // Dismissed: clear any Connect-launched context so the confirmation never reopens; nothing was written.
    clearLaunchContext()
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
      // CAPACITY-FILTER-REMINDER-1: preselect the unit's full leadership (Associate Director,
      // Assistant Nurse Manager, Unit NPD-P), not just the primary lead.
      recipientRoles: UNIT_LEADERSHIP_ROLES,
    })
    const launchable = rows.filter(r => r.hasRecipient && !r.alreadyTarget)
    if (launchable.length === 0) {
      showToast('No unit leader recipients could be resolved. Add active unit leaders first.')
      return
    }
    writeLaunchContext({
      kind: LAUNCH_KINDS.CAPACITY_REQUEST,
      cohortId,
      cohortName: cohort?.name || '',
      source: 'at_a_glance_capacity',
      templateKey: CAPACITY_RESPONSE_TEMPLATE_KEY,
      returnPath: '/aggregate',
      units: launchable.map(r => ({ key: r.key, name: r.name, email: r.recipientEmail, emails: r.recipientEmails })),
    })
    navigate('/connect/outreach?launch=1')
  }

  // CAPACITY-FILTER-REMINDER-1: Pending filter → Send Reminder to Pending Units. Preselects ONLY
  // the pending units' Unit Leadership recipients with the reminder template. A reminder launch
  // NEVER changes target or response status and NEVER opens a return confirmation (the reminder
  // context is cleared silently on return).
  const handleLaunchPendingReminder = () => {
    const pendingCanon = new Set(
      capacityView.filter(r => r.capacity_status === 'pending').map(r => canonicalUnitKey(r.unit_name)))
    if (pendingCanon.size === 0) { showToast('No pending units right now.'); return }
    const rows = buildCapacityOutreachRows({
      catalog: getEligibleUnits(true),
      leads: unitLeadersData,
      activeTargetCanons: new Set(),
      recipientRoles: UNIT_LEADERSHIP_ROLES,
    })
    const launchable = rows.filter(r => pendingCanon.has(r.key) && r.hasRecipient)
    if (launchable.length === 0) {
      showToast('No unit leader recipients could be resolved for the pending units.')
      return
    }
    writeLaunchContext({
      kind: LAUNCH_KINDS.CAPACITY_REMINDER,
      cohortId,
      cohortName: cohort?.name || '',
      source: 'at_a_glance_capacity_pending',
      templateKey: CAPACITY_REMINDER_TEMPLATE_KEY,
      returnPath: '/aggregate',
      units: launchable.map(r => ({ key: r.key, name: r.name, email: r.recipientEmail, emails: r.recipientEmails })),
    })
    navigate('/connect/outreach?launch=1')
  }

  // ── Return confirmation (capacity): opens ONCE when the Owner returns to At a Glance from a
  // launched capacity request. Every decision (all / subset / not sent / close) clears the launch
  // context, so the modal can never reopen after a decision; a refresh before deciding re-offers the
  // same pending confirmation without duplicating writes (the target RPC is idempotent).
  const [capacityConfirm, setCapacityConfirm] = useState(null)          // the launch context under review
  const [capacityConfirmMode, setCapacityConfirmMode] = useState('choice') // 'choice' | 'identify'
  const [capacityChecked, setCapacityChecked] = useState(() => new Set())  // canonical keys (identify mode)
  const [capacityBusy, setCapacityBusy] = useState(false)

  useEffect(() => {
    if (location.pathname !== '/aggregate') return
    if (capacityConfirm || sendFormPlan) return   // a confirmation is already under review
    const ctx = readLaunchContext()
    if (!ctx || ctx.cohortId !== cohortId) return
    /* eslint-disable react-hooks/set-state-in-effect -- intentional one-shot open on return navigation, mirrors the composer draft-hydrate precedent */
    // HOME-1: Email Academic Partners is a reminder with nothing to confirm; returning retires it.
    if (ctx.kind === LAUNCH_KINDS.ACADEMIC_PARTNER_REQUEST) { clearLaunchContext(); return }
    if (ctx.kind === LAUNCH_KINDS.CAPACITY_REMINDER) {
      // A reminder is informational outreach only: no confirmation, no target write, no status
      // change. Returning simply retires the launch context.
      clearLaunchContext()
    } else if (ctx.kind === LAUNCH_KINDS.CAPACITY_REQUEST) {
      setCapacityConfirm(ctx)
      setCapacityConfirmMode('choice')
      // Preselect the identify list from the REAL per-recipient results when the composer recorded
      // them. A unit counts as sent when ANY of its leadership recipients was reported sent.
      const sent = new Set((ctx.sentEmails || []).map(e => String(e).toLowerCase()))
      setCapacityChecked(new Set(
        (ctx.units || []).filter(u => {
          const emails = (Array.isArray(u.emails) && u.emails.length ? u.emails : [u.email])
          return emails.some(e => sent.has(String(e || '').toLowerCase()))
        }).map(u => u.key),
      ))
    } else if (ctx.kind === LAUNCH_KINDS.STUDENT_FORM || ctx.kind === LAUNCH_KINDS.SCHOOL_FORM) {
      // Rebuild the confirm-gated Form Sent plan from CURRENT student data (never stale copies),
      // GATED ON REAL SEND EVIDENCE (the composer records per-recipient results into the context).
      // Both student flows now send to the students themselves (ASPIRE-DESIGN-CORRECTION-1 moved
      // the school flow's audience from the Academic Partner coordinator to the intended students):
      // only students whose email Connect reported as successfully sent may be confirmed;
      // failed/skipped/unsent students stay Pending Outreach.
      // Zero successes → a safe no-success result, nothing written, context cleared (no Mark as sent).
      const lowEmail = (e) => String(e || '').trim().toLowerCase()
      const sentSet = new Set((ctx.sentEmails || []).map(lowEmail))
      const ids = new Set(ctx.studentIds || [])
      const affected = students.filter(s => ids.has(s.id))
      const affectedSent = affected.filter(s =>
        sentSet.has(lowEmail(s.school_email)) || sentSet.has(lowEmail(s.personal_email)))
      if (affectedSent.length === 0) {
        clearLaunchContext()
        showToast('ASPIRE Connect did not report any successful student sends. No status was changed.')
        return
      }
      // School launches confirm the successfully sent group together; direct launches carry a
      // single student today, so only the successfully sent one is confirmable.
      const plan = ctx.kind === LAUNCH_KINDS.SCHOOL_FORM
        ? buildSchoolSendPlan(ctx.school, affectedSent)
        : buildStudentSendPlan(affectedSent[0])
      if (!plan) { clearLaunchContext(); return }
      setSendFormPlan(plan)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [location.pathname, cohortId, students, capacityConfirm, sendFormPlan])

  const closeCapacityConfirm = (msg) => {
    setCapacityConfirm(null)
    setCapacityConfirmMode('choice')
    setCapacityChecked(new Set())
    clearLaunchContext()
    if (msg) showToast(msg)
  }

  // Record the confirmed units as active response targets (atomic RPC: already-active skipped,
  // removed reactivated, one durable row per unit). On failure the modal STAYS open with the context
  // intact so the Owner can retry; nothing is partially cleared.
  const recordConfirmedCapacityUnits = async (units) => {
    if (!capacityConfirm) return
    if (!units.length) { closeCapacityConfirm('No units were marked as expected.'); return }
    setCapacityBusy(true)
    const payload = units.map(u => ({ unit_key: u.name, unit_name: u.name }))
    const { ok, json } = await createCohortResponseTargets(capacityConfirm.cohortId, payload)
    setCapacityBusy(false)
    if (!ok) {
      showToast(json?.code === 'TARGETS_NOT_ENABLED'
        ? 'Response targets are not enabled yet. Ask the Owner to apply the pending migration.'
        : 'Could not record the confirmed units. Please try again.')
      return
    }
    closeCapacityConfirm(`${units.length} unit${units.length === 1 ? '' : 's'} marked as expected to respond.`)
    refetchTargets()
  }

  // ── HOME-1: the page's own reads, one query per source, all in parallel ──────
  const { style } = useTheme()
  const classic = style !== 'modern'
  const { canInterview } = useAuth()
  const canManage = isAdmin && userProfile?.is_active !== false
  const sigFlag = useSignaturesFlag(canManage)
  const formsStatus = useFormsStatus(canManage)
  const today = todayStr
  const eventsTo = useMemo(() => { const d = new Date(`${today}T00:00:00`); d.setDate(d.getDate() + 90); return toLocalDateStr(d) }, [today])
  const unitNameById = useMemo(() => new Map((units || []).map(u => [u.id, u.unit_name])), [units])
  const unitNameFor = useCallback((id) => unitNameById.get(id) || '', [unitNameById])
  const studentsById = useMemo(() => new Map((students || []).map(s => [s.id, s])), [students])
  const divisionOf = useCallback((u) => u?.division || getUnit(u?.unit_name)?.division || UNIT_DIVISION_MAP[u?.unit_name] || 'Other', [])

  const qMessages = useQuery({ queryKey: ['home_messages'], queryFn: loadMessagesNeedingYou, enabled: canManage && onTodayRoute, refetchInterval: onTodayRoute ? 60000 : false, staleTime: 30000 })
  const qSig = useQuery({ queryKey: ['home_signatures'], queryFn: loadSignaturesList, enabled: canManage && sigFlag.allowed && onTodayRoute, staleTime: 30000 })
  const qRR = useQuery({ queryKey: ['home_review_queues', cohortId], queryFn: () => loadReviewQueues(cohortId), enabled: canManage && !!cohortId && onTodayRoute, staleTime: 60000 })
  const qCat = useQuery({ queryKey: ['home_catalog_tracker'], queryFn: loadCatalogTracker, enabled: canManage && onTodayRoute, staleTime: 30000 })
  const qIv = useQuery({ queryKey: ['home_interviews', cohortId, today], queryFn: () => loadTodaysInterviews(cohortId, today), enabled: !!cohortId && onTodayRoute, staleTime: 60000 })
  const qRot = useQuery({ queryKey: ['home_rotations', cohortId], queryFn: () => loadRotationWindows(cohortId), enabled: !!cohortId, staleTime: 300000 })
  const qShifts = useQuery({ queryKey: ['home_shifts', cohortId, today], queryFn: () => loadTodaysShifts(cohortId, today, yesterdayStr), enabled: !!cohortId && onTodayRoute, refetchInterval: onTodayRoute ? 60000 : false })
  const qEvents = useQuery({
    queryKey: ['aggregate_welcome_events', today, eventsTo],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/aspire-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'list', from: today, to: eventsTo }),
      })
      if (!res.ok) return []
      const json = await res.json().catch(() => ({}))
      return json.events || []
    },
    enabled: onTodayRoute, staleTime: 60000,
  })
  const qActivity = useQuery({ queryKey: ['home_activity'], queryFn: loadRecentActivity, enabled: onTodayRoute, refetchInterval: onTodayRoute ? 120000 : false, staleTime: 60000 })
  const qContacts = useQuery({ queryKey: ['home_contacts'], queryFn: loadLauncherContacts, enabled: onTodayRoute, staleTime: 300000 })

  const rotations = useMemo(() => qRot.data || [], [qRot.data])
  const phase = useMemo(() => derivePhase({ cohort, students, rotations, today }), [cohort, students, rotations, today])
  const phaseNeeds = (key) => phase.order.includes(key)
  const orderOf = (key) => 2 + phase.order.indexOf(key)

  const qOutreach = useQuery({
    queryKey: ['home_outreach_open_rate'],
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_log').select('subject, sent_at, opened_at, status')
        .eq('notification_type', 'bulk_message_sent').order('sent_at', { ascending: false }).limit(300)
      if (error) throw error
      return data || []
    },
    enabled: canManage && onTodayRoute && (phaseNeeds('recruit')), staleTime: 300000, retry: false,
  })

  const nowMs = Date.now()
  const preceptorNameFor = useCallback((s) => resolvePreceptor(s, qShifts.data?.preceptors || [])?.name || '', [qShifts.data])

  // Needs you: one group per source the viewer may use. A source the viewer cannot use
  // is not listed at all (never shown disabled); the six load in parallel.
  const scopedSlots = useMemo(() => {
    const slots = qIv.data?.slots || []
    return scopeInterviewsForViewer(slots, { blocksById: qIv.data?.blocksById || {}, viewerProfileId: userProfile?.id, isAdmin })
  }, [qIv.data, userProfile?.id, isAdmin])
  const interviewerNameFor = useCallback((slot) => qIv.data?.blocksById?.[slot.block_id]?.interviewer_name || slot.interviewer_name || '', [qIv.data])

  const sources = useMemo(() => {
    const out = []
    if (canManage && sigFlag.ready && sigFlag.allowed) out.push({ key: 'signatures', status: qStatus(qSig), retry: qSig.refetch,
      group: qSig.data ? signaturesGroup({ requests: qSig.data.requests, signers: qSig.data.signers, meId: qSig.data.me?.id || userProfile?.id, now: nowMs }) : null })
    if (canManage) out.push({ key: 'messages', status: qStatus(qMessages), retry: qMessages.refetch,
      group: qMessages.data ? messagesGroup({ conversations: qMessages.data, now: nowMs }) : null })
    if (canManage && cohortId) out.push({ key: 'reviewRelease', status: qStatus(qRR), retry: qRR.refetch,
      group: qRR.data ? reviewReleaseGroup({ queues: qRR.data.queues, workflows: WORKFLOWS, now: nowMs }) : null })
    if (canManage) out.push({ key: 'formsDocs', status: qStatus(qCat), retry: qCat.refetch,
      group: qCat.data ? formsDocsGroup({ trackerRows: qCat.data.rows, items: qCat.data.items, now: nowMs }) : null })
    if (cohortId) out.push({ key: 'interviews', status: qStatus(qIv), retry: qIv.refetch,
      group: qIv.data ? interviewsGroup({ slots: scopedSlots, students, communications, interviewerNameFor, displayName, now: nowMs }) : null })
    if (cohortId) out.push({ key: 'placement', status: qStatus(qRot), retry: qRot.refetch,
      group: qRot.data ? placementGroup({ students, units, rotations, schoolKey: schoolGroupKey, unitNameFor, displayName, today, now: nowMs }) : null })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, sigFlag.ready, sigFlag.allowed, qSig.status, qSig.data, qMessages.status, qMessages.data, qRR.status, qRR.data, qCat.status, qCat.data, qIv.status, qIv.data, qRot.status, qRot.data, scopedSlots, students, units, communications, rotations, cohortId, today])

  // Today
  const holidaysToday = useMemo(() => getUsHolidaysForRange(today, today), [today])
  const schedule = useMemo(() => scheduleRows({
    interviews: scopedSlots, events: qEvents.data || [], holidays: holidaysToday,
    dueItems: qCat.data ? dueTodayItems(qCat.data.rows, qCat.data.items, today) : [],
    interviewerNameFor, displayName, today, now: new Date(nowMs),
  }), [scopedSlots, qEvents.data, holidaysToday, qCat.data, interviewerNameFor, today, nowMs])
  const campus = useMemo(() => onCampusGroups({
    plans: qShifts.data?.plans || [], logs: (qShifts.data?.logs || []).filter(l => l.shift_date === today), students,
    preceptors: qShifts.data?.preceptors || [],
    assignedPreceptorShiftFor: (s) => resolvePreceptor(s, qShifts.data?.preceptors || [])?.shift_type || null,
    unitNameFor, preceptorNameFor, displayName, today, now: new Date(nowMs),
  }), [qShifts.data, students, unitNameFor, preceptorNameFor, today, nowMs])
  const mastheadChips = useMemo(
    () => [...mastheadItems(qEvents.data || [], today), ...holidayItems(holidaysToday)],
    [qEvents.data, today, holidaysToday],
  )

  // Cohort pulse
  const pipeline = useMemo(() => pipelineCounts(students), [students])
  const hours = useMemo(() => hoursBar({ students, rotations, schoolKey: schoolGroupKey, today }), [students, rotations, today])
  const midpoint = useMemo(() => {
    if (!qRR.data?.evidence) return null
    const ready = (qRR.data.queues?.preceptor?.items || []).filter(i => i.state === 'ready' && i.period === 'midpoint').length
    return midpointBar({ assignments: qRR.data.evidence.assignments, readyToRelease: ready })
  }, [qRR.data])

  // Placement
  const summary = useMemo(() => placementSummary({ students, units, matches, divisionOf }), [students, units, matches, divisionOf])
  const requestRows = useMemo(() => requestsBySchool({ students, schoolKey: schoolGroupKey }), [students])
  const requestTotals = useMemo(() => requestCounts(students), [students])
  const shownRequestRows = useMemo(() => filterRequestRows(requestRows, requestFilter), [requestRows, requestFilter])

  // HOME-1 (Owner, 2026-09-25): Email Academic Partners opens Send to Many with the Academic
  // Partner Placement Request template and every active Academic Partner contact selected
  // (OutreachView + BulkManualComposer apply it). Most useful before any request arrives.
  const handleEmailAcademicPartners = () => {
    const ok = writeLaunchContext({
      kind: LAUNCH_KINDS.ACADEMIC_PARTNER_REQUEST,
      cohortId,
      cohortName: cohort?.name || '',
      source: 'at_a_glance_requests',
      templateKey: 'academic_partner_placement',
      returnPath: '/aggregate',
    })
    if (!ok) { showToast('Could not open Outreach in this browser. Open ASPIRE Connect > Outreach and choose the template.'); return }
    navigate('/connect/outreach?launch=1')
  }

  // Phase cards
  const applications = useMemo(() => applicationsSummary(students, nowMs), [students, nowMs])
  const openRate = useMemo(() => (qOutreach.data ? latestOutreachOpenRate(qOutreach.data) : null), [qOutreach.data])
  const surveys = useMemo(() => surveysSummary({ queues: qRR.data?.queues || {}, evidence: qRR.data?.evidence || null, nowMs }), [qRR.data, nowMs])

  // Recent activity
  const activity = useMemo(() => activityRows(qActivity.data?.events || [], { id: userProfile?.id, email: userProfile?.email || qActivity.data?.viewer?.email }, nowMs), [qActivity.data, userProfile?.id, userProfile?.email, nowMs])

  // The launcher
  const actions = useMemo(() => allowedActions({
    isAdmin: canManage, canInterview, canMatch: canPerformMatching(userProfile), signatures: sigFlag.allowed, forms: formsStatus.enabled, isActive: userProfile?.is_active !== false,
  }), [canManage, canInterview, userProfile, sigFlag.allowed, formsStatus.enabled])
  const people = useMemo(() => personRows({ students, contacts: qContacts.data || [], unitNameFor, displayName }), [students, qContacts.data, unitNameFor])
  const go = useCallback((to) => { if (to) navigate(to) }, [navigate])
  const openStudent = useCallback((id) => { if (onOpenStudent) onOpenStudent(id); else navigate(`/students?student=${encodeURIComponent(id)}`) }, [onOpenStudent, navigate])
  const openPerson = useCallback((p) => {
    if (p.kind === 'student') openStudent(p.id.replace(/^student:/, ''))
    else go(p.to)
  }, [openStudent, go])
  const updatedLabel = useUpdatedLabel(cohortId)
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  // Placement > Capacity and requests: the service-line rows, and what an expanded row shows.
  const serviceLineRows = useMemo(() => {
    const base = capacityByServiceLine({ units, students, divisionOf, order: DIVISION_ORDER })
    const seen = new Set(base.map(r => r.serviceLine))
    const extra = []
    for (const r of capacityView) {
      const d = getUnit(r.unit_name)?.division || 'Other'
      if (!seen.has(d)) { seen.add(d); extra.push({ id: d, serviceLine: d, filled: 0, slots: 0, units: [] }) }
    }
    return [...base, ...extra]
  }, [units, students, divisionOf, capacityView])
  const capacityFiltered = useMemo(() => (unitStatusFilter === 'all' ? capacityView : capacityView.filter(r => r.capacity_status === unitStatusFilter)), [capacityView, unitStatusFilter])
  const renderCapacityDetail = (row) => {
    const rows = capacityFiltered.filter(r => (getUnit(r.unit_name)?.division || 'Other') === row.serviceLine)
      .sort((a, b) => a.unit_name.localeCompare(b.unit_name))
    if (!rows.length) return <div className="hm-pl-detail" style={{ color: 'var(--hm-muted)', fontSize: 12.5 }}>No units match the selected filter.</div>
    return (
      <div className="hm-pl-detail hm-pl-units">
        {rows.map(r => (
          <UnitResponseRow key={r.id} response={r} filledByUnit={filledByUnit} units={units}
            primaryLeadMap={primaryLeadMap} showToast={showToast} onView={setSelectedUnitResponse} />
        ))}
      </div>
    )
  }
  const renderRequestDetail = (row) => <SchoolStudents school={row.school} sStudents={row.list} />

  function SchoolStudents({ school, sStudents }) {
    const hasPending = sStudents.some(s => s.status === 'Pending Outreach')
    return (
      <div className="hm-pl-detail">
        {hasPending && (
          <div className="ov-school-actions">
            <button className="ov-send-btn" onClick={e => { e.stopPropagation(); handleSendSchool(school, sStudents) }}>
              Send Forms to Students
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
          const placedUnit = s.matched_unit_id ? unitNameFor(s.matched_unit_id) : null
          const isPending  = s.status === 'Pending Outreach'
          const req = parseFloat(s.hours_required || 0)
          const apv = parseFloat(s.approved_hours || 0)
          return (
            <div key={s.id} className="ov-student-row">
              <StudentAvatar student={s} size={32} />
              <div className="ov-student-info" style={{ flex:1 }}>
                <button type="button" className="ov-student-name hm-link" style={{ fontSize: 13 }} onClick={() => openStudent(s.id)}>{displayName(s)}</button>
                {s.school_email && <span className="ov-student-contact">{s.school_email}</span>}
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                {req > 0 && (
                  <span style={{ fontSize:11, fontWeight:600, color: apv / req >= 1 ? '#166534' : 'var(--hm-muted)', whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>
                    {apv}/{req} hrs
                  </span>
                )}
                {s.status && ovDispType ? (() => {
                  const c = DISPOSITION_PILL_COLORS[ovDispType] || DISPOSITION_PILL_COLORS['not_selected']
                  return <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:'var(--aspire-radius-pill)', background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:'nowrap' }}>{DISPOSITION_TYPES[ovDispType] || ovDispType}</span>
                })() : s.status ? (
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:'var(--aspire-radius-pill)', background:statusCfg.bg, color:statusCfg.text, border:`1px solid ${statusCfg.border}`, whiteSpace:'nowrap' }}>{s.status}</span>
                ) : null}
                {placedUnit && <span style={{ fontSize:11, color:'#166534', whiteSpace:'nowrap' }}>Placed: {placedUnit}</span>}
                {isPending && (
                  <button className="ov-send-btn ov-send-btn-sm" onClick={e => { e.stopPropagation(); handleSendStudent(s) }}>Send Form</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const capacityToolbar = (
    <div className="hm-pl-toolbar">
      {(() => {
        const n = (s) => capacityView.filter(r => r.capacity_status === s).length
        const chips = [
          { key:'all', label:'All', count: capacityView.length },
          { key:'hosting', label:'Hosting', count: n('hosting') },
          { key:'not_hosting', label:'Not Hosting', count: n('not_hosting') },
          { key:'pending', label:'Pending', count: n('pending') },
        ]
        return chips.map(c => (
          <button key={c.key} type="button" className="hm-fchip" aria-pressed={unitStatusFilter === c.key} onClick={() => setUnitStatusFilter(c.key)}>
            {c.label} <b>{unitResponsesLoading ? '…' : c.count}</b>
          </button>
        ))
      })()}
      <div className="hm-pl-toolbar-r">
        {isAdmin && unitStatusFilter === 'all' && (
          <NavigationPill icon={Send} onClick={handleLaunchCapacityRequest}>Send Capacity Request</NavigationPill>
        )}
        {isAdmin && unitStatusFilter === 'pending' && (
          <NavigationPill icon={BellRing} onClick={handleLaunchPendingReminder}>Send Reminder to Pending Units</NavigationPill>
        )}
        {canPerformMatching(userProfile) && (
          <NavigationPill icon={Settings2} className="hm-setup-pill" onClick={() => setShowUnitSetup(true)}>
            <span data-testid="overview-set-up-units">Set Up Units</span>
          </NavigationPill>
        )}
      </div>
    </div>
  )
  const requestsToolbar = (
    <div className="hm-pl-toolbar">
      {REQUEST_FILTERS.map(f => (
        <button key={f.key} type="button" className="hm-fchip" aria-pressed={requestFilter === f.key} onClick={() => setRequestFilter(f.key)}>
          {f.label} <b>{requestTotals[f.key]}</b>
        </button>
      ))}
      <StatusLegendPopover position="bottom-left" />
      <Tooltip label="Copy cohort summary" placement="bottom">
        <button onClick={handleCopyCohortSummary} aria-label="Copy cohort summary"
          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--hm-muted)', padding:'4px', display:'flex', alignItems:'center' }}>
          <Copy size={14} />
        </button>
      </Tooltip>
      {isAdmin && (
        <div className="hm-pl-toolbar-r">
          <NavigationPill icon={Mail} onClick={handleEmailAcademicPartners}>Email Academic Partners</NavigationPill>
        </div>
      )}
    </div>
  )
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
          <div style={{ background:'var(--chart-card,#fff)', borderRadius:14, border:'1px solid var(--chart-line)', boxShadow:'0 12px 40px rgba(15,23,42,0.22)', padding:'20px 22px', width:'min(440px, calc(100vw - 32px))', fontFamily:'Plus Jakarta Sans,sans-serif' }}>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--chart-ink)', marginBottom:8 }}>{sendFormPlan.confirmTitle}</div>
            <div style={{ fontSize:13, color:'var(--chart-ink-soft)', lineHeight:1.5, marginBottom:8 }}>{sendFormPlan.confirmBody}</div>
            <div style={{ fontSize:12, color:'var(--chart-ink-soft)', marginBottom:14 }}>
              {sendFormPlan.students.map(s => displayName(s)).join(' · ')}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={handleCancelFormSent} disabled={sendFormBusy}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Not sent
              </button>
              <button onClick={handleConfirmFormSent} disabled={sendFormBusy}
                style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--chart-navy)', color:'#fff', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                {sendFormBusy ? 'Saving…' : 'Mark as sent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CAPACITY-RESPONSE-OUTREACH-2 / ASPIRE-DESIGN-CORRECTION-1: return confirmation for a
          launched Unit Leader Capacity Request. The first step is COMPACT - title, one line of
          supporting copy, three decisions - visually matched to the student Form Sent dialog; the
          unit checklist appears only after Identify Units Sent. Only a confirmed unit becomes an
          expected responder; Not Sent / closing writes nothing. Shown once - every decision clears
          the launch context. */}
      {capacityConfirm && (
        <div role="dialog" aria-modal="true" aria-label="Were the capacity requests sent?"
          style={{ position:'fixed', inset:0, zIndex:9997, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(15,23,42,0.28)' }}>
          <div style={{ background:'var(--chart-card,#fff)', borderRadius:14, border:'1px solid var(--chart-line)', boxShadow:'0 12px 40px rgba(15,23,42,0.22)', padding:'20px 22px', width:'min(520px, calc(100vw - 32px))', fontFamily:'Plus Jakarta Sans,sans-serif' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, marginBottom:8 }}>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--chart-ink)' }}>Were the capacity requests sent?</div>
              <button onClick={() => closeCapacityConfirm('No units were marked as expected.')} disabled={capacityBusy}
                aria-label="Close without confirming"
                style={{ background:'none', border:'none', fontSize:18, lineHeight:1, color:'var(--chart-ink-soft)', cursor:'pointer', padding:2 }}>×</button>
            </div>
            <div style={{ fontSize:13, color:'var(--chart-ink-soft)', lineHeight:1.5, marginBottom:14 }}>
              Confirm whether the Unit Leader Capacity Request was sent. Only confirmed units will be counted as expected to respond.
            </div>
            {capacityConfirmMode === 'choice' ? (
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
                <button onClick={() => closeCapacityConfirm('No units were marked as expected.')} disabled={capacityBusy}
                  style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Not Sent
                </button>
                <button onClick={() => setCapacityConfirmMode('identify')} disabled={capacityBusy}
                  style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Identify Units Sent
                </button>
                <button onClick={() => recordConfirmedCapacityUnits(capacityConfirm.units || [])} disabled={capacityBusy}
                  style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--chart-navy)', color:'#fff', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  {capacityBusy ? 'Saving…' : 'Sent to All Selected Units'}
                </button>
              </div>
            ) : (
              <>
                {capacityConfirm.summary && (
                  <div style={{ fontSize:12, color:'var(--chart-ink-soft)', marginBottom:8 }}>
                    Connect reported: {capacityConfirm.summary.sent ?? 0} sent · {capacityConfirm.summary.skipped ?? 0} skipped · {capacityConfirm.summary.failed ?? 0} failed.
                  </div>
                )}
                <ul style={{ listStyle:'none', margin:'0 0 14px', padding:0, maxHeight:240, overflowY:'auto', border:'1px solid var(--chart-line)', borderRadius:10 }}>
                  {(capacityConfirm.units || []).map((u, i) => (
                    <li key={u.key} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--chart-line)' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, color:'var(--chart-ink)', padding:'8px 12px', cursor:'pointer' }}>
                        <input type="checkbox" checked={capacityChecked.has(u.key)}
                          onChange={() => setCapacityChecked(prev => {
                            const next = new Set(prev)
                            if (next.has(u.key)) next.delete(u.key); else next.add(u.key)
                            return next
                          })} />
                        {u.name}
                      </label>
                    </li>
                  ))}
                </ul>
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
                  <button onClick={() => setCapacityConfirmMode('choice')} disabled={capacityBusy}
                    style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                    Back
                  </button>
                  <button onClick={() => closeCapacityConfirm('No units were marked as expected.')} disabled={capacityBusy}
                    style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                    Not Sent
                  </button>
                  <button
                    onClick={() => recordConfirmedCapacityUnits((capacityConfirm.units || []).filter(u => capacityChecked.has(u.key)))}
                    disabled={capacityBusy || capacityChecked.size === 0}
                    style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--chart-navy)', color:'#fff', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor: capacityChecked.size === 0 ? 'not-allowed' : 'pointer', opacity: capacityChecked.size === 0 ? 0.6 : 1 }}>
                    {capacityBusy ? 'Saving…' : `Confirm ${capacityChecked.size} Unit${capacityChecked.size === 1 ? '' : 's'} Sent`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {/* ════════ HOME-1: the page ════════ */}
      <div className={`hm-page${classic ? ' hm-classic' : ''}`}>
        {classic && (
          <>
            <span className="hm-corner hm-corner-tl" aria-hidden="true" />
            <span className="hm-corner hm-corner-tr" aria-hidden="true" />
            <span className="hm-corner hm-corner-bl" aria-hidden="true" />
            <span className="hm-corner hm-corner-br" aria-hidden="true" />
          </>
        )}
        <HomeBanner
          classic={classic}
          fullName={userProfile?.full_name}
          userKey={currentUserId}
          items={mastheadChips}
          calendar={{ label: 'Open Calendar', onClick: () => navigate('/interviews') }}
          launcher={{ actions, people, canAskKeith: userProfile?.role !== 'viewer' || userProfile?.is_owner === true, onRun: (a) => go(a?.to), onOpenPerson: openPerson }}
        />

        <div className="hm-stack">
          <NeedsYou order={0} sources={sources} onNavigate={go} updatedLabel={updatedLabel} />

          <div className="hm-phase" style={{ order: 1 }} role="status">
            Cycle phase: <b>{phase.label}</b> · sections below are ordered for this phase
          </div>

          {phaseNeeds('recruit') && (
            <ApplicationsOutreach order={orderOf('recruit')} cohortName={cohort?.name} onNavigate={go}
              received={applications.received} thisWeek={applications.thisWeek} missingDocs={applications.missingDocs} openRate={openRate} />
          )}
          {phaseNeeds('evals') && (
            <SurveysResults order={orderOf('evals')} onNavigate={go}
              ready={surveys.ready} needReminder={surveys.needReminder} pairs={surveys.pairs} certificates={surveys.certificates} />
          )}

          <div className="hm-duo" style={{ order: orderOf('duo') }} data-sec="duo">
            <TodayCard dateLabel={dateLabel} schedule={schedule} scheduleLoading={qEvents.isPending && onTodayRoute}
              campus={campus} campusLoading={qShifts.isPending && !!cohortId}
              avatarFor={(id) => { const st = studentsById.get(id); return st?.headshot_url ? <StudentAvatar student={st} size={28} /> : null }}
              onNavigate={go} onOpenStudent={openStudent} />
            <CohortPulse cohortName={cohort?.name} pipeline={pipeline} currentStage={phase.stage} hours={hours} midpoint={midpoint} onNavigate={go} />
          </div>

          {phaseNeeds('placement') && (
            <PlacementCard order={orderOf('placement')} summary={summary}
              cap={`${summary.hostingUnits} hosting unit${summary.hostingUnits === 1 ? '' : 's'} · ${requestRows.length} school${requestRows.length === 1 ? '' : 's'}`}
              capacityRows={serviceLineRows} requestRows={shownRequestRows}
              capacityToolbar={capacityToolbar} requestsToolbar={requestsToolbar}
              renderCapacityDetail={renderCapacityDetail} renderRequestDetail={renderRequestDetail}
              onViewResponse={(school) => setResponseDrawerSchool(school)} onNavigate={go}
              notices={unitResponsesError ? (
                <div className="today-error" role="alert" style={{ margin: '0 20px 12px' }}>
                  <span>Unit responses could not load. The capacity panel may be incomplete.</span>
                  <button onClick={() => refetchUnitResponses()}>Retry</button>
                </div>
              ) : null} />
          )}

          <RecentActivity order={orderOf('activity')} rows={activity} onNavigate={go} />
        </div>
      </div>

      {showUnitSetup && (
        <UnitSetupPanel cohortId={cohortId} currentUnits={units} students={students}
          onSaved={async () => { await onRefreshUnits?.() }} onClose={() => setShowUnitSetup(false)} />
      )}

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
