import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { getEvaluationPreviewFixture } from '../../lib/evaluation/evaluationPreviewFixtures'
import SurveyPreviewDrawer from './SurveyPreviewDrawer'
import ReviewReleaseQueue, { ReleaseConfirm, ActivityDialog, ModerateConfirm } from './ReviewReleaseQueue'
import { SURVEY_CATALOG, SURVEY_WORKFLOWS, surveyByKey } from '../../lib/evaluation/surveyCatalog'
import { RELEASE_ROUTES } from '../../lib/evaluation/releaseRouting'
import { postReleaseAction } from '../../lib/evaluationReviewApi'
import { ACTION_API, ACTION_STATUS_MESSAGE } from '../../lib/unitEvaluationReleaseActions'
import { loadCohortEvidence, loadUnitLeaderQueue } from '../../lib/evaluation/reviewQueueLoaders'
import {
  adaptCaseyFinkPreRotation, adaptPreceptor, adaptStudentFeedback,
  adaptCaseyFinkPostRotation, adaptAspireFeedback, adaptUnitLeaderRelease,
} from '../../lib/evaluation/reviewQueueAdapters'
import { countsOf, sumCounts, isToday, EMPTY_COUNTS } from '../../lib/evaluation/reviewQueueShape'
import {
  LAST_WORKFLOW_STORAGE_KEY,
  UNIT_LEADER_RELEASE_KEY, isReviewReleaseNavKey, resolveEffectiveNavKey, resolveInitialNavKey,
} from '../../lib/evaluation/workflowSelection'

// REVIEW-RELEASE-1: Review & Release as six workflows in one queue.
//
// This shell owns three things and nothing else: WHICH workflow is selected (the same
// deterministic, counts-free resolver as before: URL, then last opened, then first in
// order), the DATA every workflow needs (loaded once per cohort through the same reads the
// old panels made, then handed to one adapter per workflow), and the ACTIONS a card can
// take (release, moderate, record an activity), each of which still calls the workflow's
// own endpoint with the workflow's own pre-send guard and post-send tripwire.
//
// Detection logic did not move. Each adapter calls the classifier its panel called, on
// the rows its panel loaded, and translates the answer into the shared shape the queue
// renders. Business logic, eligibility, release, previews, and certificate gating are
// unchanged; the page shows the same facts with one vocabulary.
//
// EVERY WORKFLOW DETECTS ALL THE TIME, selected or not, because the rail badges and the
// summary line add up all six. That was true of the old panels too (mounted and hidden);
// it is now one query rather than four.

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'
const WORKSPACE_ID = 'survey-automation-workspace'

// Workflows in display order, DERIVED from the shared catalog so the navigator, the
// survey preview, and the release routing cannot drift apart.
const WORKFLOWS = SURVEY_CATALOG.map(s => ({ key: s.key, label: s.label, title: s.title, recipient: s.recipient, to: s.to, group: s.group }))
const SURVEY_KEYS = SURVEY_WORKFLOWS.map(s => s.key)

const CSS = `
/* LAYOUT-SHELL-CONSISTENCY-1 / EVAL-RR-RAIL-C-1 (Owner-approved Option C): a 232px
   Settings-style rail + flexible right workspace. REVIEW-RELEASE-1 widens the rail to
   270px because the six names are the Owner's full names, and stretches it to the
   workspace's height (section 5: same height, same top edge, not sticky). */
.rr-layout { display:grid; grid-template-columns:270px minmax(0, 1fr); gap:20px; align-items:stretch; }
.rr-nav {
  min-width:0; display:flex; flex-direction:column; gap:2px; align-content:start;
  background:#fff; border:1px solid #e8e4dc; border-radius:14px; padding:10px;
  box-shadow:0 1px 3px rgba(25,25,25,0.06);
}
.rr-nav-mobile { display:none; }
.rr-workspace {
  min-width:0; background:#fff; border:1px solid #e8e4dc; border-radius:14px;
  box-shadow:0 1px 3px rgba(25,25,25,0.06); padding:16px 20px 20px;
}
/* EVAL-RR-RAIL-C-1: compact navigation rows. Selected = FILLED nightfall navy with
   white text (the Settings selected treatment); hover is a light tint; focus stays a
   distinct blue outline (separate from selection). */
.rr-row-select {
  width:100%; display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; text-align:left;
  padding:9px 10px; margin:0; cursor:pointer; background:transparent; border:none; border-radius:9px; font-family:${F};
}
.rr-row-select:hover { background:#f3f4fa; }
.rr-row-select.sel { background:${NAVY}; }
.rr-row-select.sel:hover { background:${NAVY}; }
.rr-row-label { min-width:0; font-size:13.5px; font-weight:600; color:#1f2430; line-height:1.3; }
.rr-row-label small { display:block; font-size:11.5px; font-weight:500; color:#6b7280; }
.rr-row-select.sel .rr-row-label { color:#fff; }
.rr-row-select.sel .rr-row-label small { color:rgba(255,255,255,0.7); }
/* Right-aligned count badges: green = ready to release, amber = needs a fix. Hidden at 0. */
.rr-cnt { display:inline-flex; gap:4px; }
.rr-cnt i { font-style:normal; font-size:10.5px; font-weight:700; min-width:20px; height:20px; border-radius:999px; display:grid; place-items:center; padding-inline:5px; color:#fff; }
.rr-cnt .r { background:#166534; }
.rr-cnt .b { background:#b45309; }
.rr-nav-group {
  font-size:10.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;
  color:#6b7280; padding:6px 10px 4px; margin:0;
}
.rr-nav .rr-nav-group:not(:first-child) { margin-top:8px; border-top:1px solid #f0ede6; padding-top:12px; }
.rr-tool-primary {
  display:inline-flex; align-items:center; gap:7px; padding:8px 14px; background:${NAVY}; color:#fff;
  border:1px solid ${NAVY}; border-radius:9px; font-size:12.5px; font-weight:700; font-family:${F}; cursor:pointer;
}
.rr-tool-primary:hover { background:#161d52; }
.rr-tool-secondary {
  display:inline-flex; align-items:center; gap:6px; padding:7px 12px; background:#fff; color:${NAVY};
  border:1px solid #d7ddf5; border-radius:9px; font-size:12.5px; font-weight:600; font-family:${F}; cursor:pointer;
}
.rr-tool-secondary:hover { background:#f7f9ff; }
.rr-tool-secondary:disabled { opacity:0.6; cursor:default; }
.rr-tool-test {
  display:inline-flex; align-items:center; gap:6px; padding:7px 12px; background:#fff; color:#92400e;
  border:1px dashed #e0b877; border-radius:9px; font-size:12.5px; font-weight:600; font-family:${F}; cursor:pointer;
}
.rr-tool-test:hover { background:#fffaf0; }
.rr-tool-primary:focus-visible, .rr-tool-secondary:focus-visible, .rr-tool-test:focus-visible, .rr-row-select:focus-visible {
  outline:3px solid #93c5fd; outline-offset:2px;
}
@media (max-width: 640px) {
  .rr-tool-primary, .rr-tool-secondary, .rr-tool-test { flex:1 1 auto; justify-content:center; }
}
@media (max-width: 900px) {
  .rr-layout { grid-template-columns:1fr; }
  .rr-nav { display:none; }
  .rr-nav-mobile { display:block; width:100%; }
  .rr-workspace { width:100%; }
}
`

function WorkflowNavRow({ w, counts, selected, onSelect }) {
  const ready = counts?.ready || 0
  const blocked = counts?.blocked || 0
  const srBits = [w.label, `to ${w.to}`]
  if (ready > 0) srBits.push(`${ready} ready to release`)
  if (blocked > 0) srBits.push(`${blocked} need a fix`)
  return (
    <button
      type="button"
      className={`rr-row-select${selected ? ' sel' : ''}`}
      aria-pressed={selected}
      aria-current={selected ? 'true' : undefined}
      aria-label={srBits.join(', ')}
      onClick={onSelect}
    >
      <span className="rr-row-label">{w.label}<small>to {w.to}</small></span>
      <span className="rr-cnt" aria-hidden="true">
        {ready > 0 && <i className="r" title="Ready">{ready}</i>}
        {blocked > 0 && <i className="b" title="Needs a fix">{blocked}</i>}
      </span>
    </button>
  )
}

export default function SurveyAutomationDashboard({ cohortId, onTrackResponses }) {
  const { isOwner, isAdmin } = useAuth()
  const canView = isOwner || isAdmin

  // DETERMINISTIC SELECTION. Precedence is URL, then the last workflow this user opened,
  // then the first in displayed order. Counts are never an input (ROUTING-HOTFIX-1B).
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlKey = searchParams.get('workflow')
  const [selected, setSelected] = useState(() => {
    let storedKey = null
    try { storedKey = localStorage.getItem(LAST_WORKFLOW_STORAGE_KEY) } catch { /* storage unavailable */ }
    return resolveInitialNavKey({ urlKey, storedKey, order: WORKFLOWS.map(w => w.key) })
  })
  const selectWorkflow = useCallback((key) => {
    if (!isReviewReleaseNavKey(key)) return
    setSelected(key)
    try { localStorage.setItem(LAST_WORKFLOW_STORAGE_KEY, key) } catch { /* storage unavailable */ }
    // replace, so switching workflows does not fill the back stack with every click
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('workflow', key); return n }, { replace: true })
  }, [setSearchParams])
  const current = isReviewReleaseNavKey(urlKey) ? urlKey : selected
  const effective = resolveEffectiveNavKey(current)
  const workflow = surveyByKey(effective)

  // ── Detection: one cohort read for the surveys, one endpoint read for the UL release ──
  const evidence = useQuery({
    queryKey: ['review_release_evidence', cohortId],
    queryFn: () => loadCohortEvidence(cohortId),
    enabled: !!cohortId && canView,
    refetchOnWindowFocus: false,
  })
  const ulQueue = useQuery({
    queryKey: ['review_release_unit_leader'],
    queryFn: ({ signal }) => loadUnitLeaderQueue(signal),
    enabled: canView,
    refetchOnWindowFocus: false,
  })

  // Every workflow's items, in the shared shape, from its own adapter over its own rows.
  const queues = useMemo(() => {
    const out = {}
    const ev = evidence.data
    if (ev) {
      const shared = { students: ev.students, displayName: ev.displayName, nowMs: ev.detectedAtMs }
      out.caseyFinkPreRotation = adaptCaseyFinkPreRotation({ ...shared, assignments: ev.forWorkflow.caseyFinkPreRotation })
      out.preceptor = adaptPreceptor({ ...shared, preceptors: ev.preceptors, assignments: ev.forWorkflow.preceptor })
      out.student = adaptStudentFeedback({ ...shared, preceptors: ev.preceptors, assignments: ev.forWorkflow.student })
      out.caseyFinkPostRotation = adaptCaseyFinkPostRotation({
        ...shared, assignments: ev.forWorkflow.caseyFinkPostRotation, allAssignmentsByStudent: ev.allAssignmentsByStudent,
        certificates: ev.certificates, shiftMeta: ev.shiftMeta,
      })
      out.postRotation = adaptAspireFeedback({
        ...shared, assignments: ev.forWorkflow.postRotation, allAssignmentsByStudent: ev.allAssignmentsByStudent,
        activityByStudent: ev.activityByStudent, ledgerDown: ev.ledgerDown, shiftMeta: ev.shiftMeta,
      })
    }
    if (ulQueue.data) {
      out.unitLeaderRelease = adaptUnitLeaderRelease({ rows: ulQueue.data.rows, nowMs: ulQueue.data.detectedAtMs })
    }
    return out
  }, [evidence.data, ulQueue.data])

  const counts = useMemo(() => {
    const c = {}
    for (const w of WORKFLOWS) c[w.key] = queues[w.key] ? countsOf(queues[w.key].items) : null
    return c
  }, [queues])
  const totals = useMemo(() => sumCounts(counts), [counts])
  const sentToday = useMemo(() => {
    let n = 0
    for (const q of Object.values(queues)) for (const line of (q?.sent || [])) if (isToday(line.at)) n += 1
    return n
  }, [queues])

  // Per-workflow UI state is keyed by the workflow it belongs to, so switching (by rail,
  // by URL, or by a jump) reads as empty for the newcomer without an effect that clears
  // it: an effect that sets state on a key change renders twice, and this repo forbids
  // the pattern. `identityHold` is deliberately NOT keyed: a tripwire holds every
  // workflow until detection is re-run.
  const [notice, setNoticeRaw] = useState(null)              // { key, tone, text }
  const setNotice = useCallback((n) => setNoticeRaw(n ? { key: effective, ...n } : null), [effective])
  const noticeFor = notice && notice.key === effective ? notice : null
  const [identityHold, setIdentityHold] = useState(false)

  const rerun = useCallback(() => {
    setNoticeRaw(null); setIdentityHold(false)
    evidence.refetch(); ulQueue.refetch()
  }, [evidence, ulQueue])

  // ── Survey tools (unchanged behavior) ──────────────────────────────────────────────
  const [previewKey, setPreviewKey] = useState(null)
  const [surveyPreviewKey, setSurveyPreviewKey] = useState(null)
  const EMPTY_TEST = { busy: false, note: '', url: '' }
  const [testRaw, setTestRaw] = useState({ key: null, ...EMPTY_TEST })
  const testState = testRaw.key === effective ? testRaw : EMPTY_TEST
  const setTestState = useCallback((t) => setTestRaw({ key: effective, ...t }), [effective])

  const sendTestToMe = useCallback(async (workflowKey) => {
    setTestState({ busy: true, note: '', url: '' })
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const res = await fetch('/api/evaluation-send-survey-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workflow_key: workflowKey }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setTestState({ busy: false, url: '', note: res.status === 403 ? 'Only an Owner or Admin can send a test.' : 'The test could not be sent.' })
        return
      }
      // SAME-ORIGIN ONLY. The emailed link is rewritten by the organization's URL isolation,
      // which is a security control and not something to work around. The in-app path is
      // therefore primary: reduce the returned URL to a RELATIVE route and navigate inside the
      // SPA. The email remains a secondary convenience.
      let path = ''
      try {
        const u = new URL(body?.test_url || '', window.location.origin)
        if (u.origin === window.location.origin) path = `${u.pathname}${u.search}`
      } catch { path = '' }
      setTestState({
        busy: false,
        url: path,
        note: body?.email_sent
          ? 'Test ready. Use Open test now. A TEST email was also sent as a backup, though your organization may isolate that link. Nothing was released.'
          : 'Test ready. Use Open test now. Nothing was released.',
      })
    } catch {
      setTestState({ busy: false, url: '', note: 'The test could not be sent.' })
    }
  }, [setTestState])

  const tools = useMemo(() => ({
    onPreviewSurvey: () => setSurveyPreviewKey(effective),
    onPreviewEmail: () => setPreviewKey(effective),
    onSendTest: () => sendTestToMe(effective),
    onOpenTest: () => navigate(testState.url),
    onCopyTest: () => { try { navigator.clipboard?.writeText(`${window.location.origin}${testState.url}`) } catch { /* clipboard unavailable */ } },
    testState,
  }), [effective, sendTestToMe, navigate, testState])

  // ── Actions ─────────────────────────────────────────────────────────────────────────
  // ROUTING-HOTFIX-1B: `identityHold` (declared above) is set only when the post-send
  // identity tripwire fires. A tripwire failure means a release may already have completed
  // against an unexpected workflow, so release is HALTED until the operator re-runs
  // detection and verifies. The three dialogs below are keyed the same way the notice is:
  // an open dialog belongs to the workflow it was opened on.
  const [confirmRaw, setConfirmRaw] = useState(null)
  const [moderateRaw, setModerateRaw] = useState(null)
  const [activityRaw, setActivityRaw] = useState(null)
  const confirmItem = confirmRaw && confirmRaw.workflowId === effective ? confirmRaw : null
  const moderateItem = moderateRaw && moderateRaw.workflowId === effective ? moderateRaw : null
  const activityItem = activityRaw && activityRaw.workflowId === effective ? activityRaw : null
  const setConfirmItem = setConfirmRaw
  const setModerateItem = setModerateRaw
  const setActivityItem = setActivityRaw
  const [activitySaving, setActivitySaving] = useState(false)
  const [activityMsg, setActivityMsg] = useState(null)
  const [busyItemId, setBusyItemId] = useState(null)

  const authHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return null
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
  }, [])

  // Release ONE item through ITS workflow's endpoint, with the pre-send guard the server
  // requires and the post-send identity tripwire. The preceptor workflow adds its period
  // and (optionally) a canonical redirect; the Unit Leader release goes through the RPC
  // action path instead of an email endpoint.
  const doRelease = useCallback(async (item, { redirectId } = {}) => {
    if (!item || identityHold) return
    setBusyItemId(item.id); setNotice(null)
    try {
      if (item.workflowId === UNIT_LEADER_RELEASE_KEY) {
        const key = item.release?.action === 'rerelease' ? 'rerelease' : 'release'
        const meta = ACTION_API[key]
        const res = await postReleaseAction({ action: meta.action, responseId: item.responseId, decision: meta.decision })
        const status = res.data?.status || res.error
        setNotice({ tone: res.ok && res.data?.ok ? 'ok' : 'err', text: `${item.person.name}: ${ACTION_STATUS_MESSAGE[status] || 'That action could not be completed.'}` })
        if (res.ok) ulQueue.refetch()
        return
      }
      const route = RELEASE_ROUTES[item.workflowId]
      const headers = await authHeaders()
      if (!headers) { setNotice({ tone: 'err', text: 'Your session expired. Please sign in again.' }); return }
      const body = item.workflowId === 'preceptor'
        ? {
            student_id: item.studentId,
            period: item.release?.period,
            ...(item.release?.preceptorEmail ? { expected_preceptor_email: item.release.preceptorEmail } : {}),
            ...(redirectId ? { redirect_preceptor_id: redirectId } : {}),
          }
        : { student_id: item.studentId, expected_instrument_slug: route.instrumentSlug }
      const res = await fetch(route.endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
      const payload = await res.json().catch(() => ({}))
      if (res.ok && payload.released) {
        if (item.workflowId !== 'preceptor' && (payload.instrument_slug !== route.instrumentSlug || payload.timepoint !== route.timepoint)) {
          setIdentityHold(true)
          setNotice({ tone: 'err', text: `Release identity mismatch for ${item.person.name}. The server reported ${payload.instrument_slug}/${payload.timepoint}, not the expected ${route.instrumentSlug}/${route.timepoint}. This release may have completed and an email may have been sent. Do NOT retry: verify in the send log first, since retrying could send a duplicate. Re-run detection to confirm the current state.` })
        } else {
          const to = payload.student_email || payload.preceptor_name || payload.preceptor_email || item.sendTo || 'the recipient'
          setNotice({ tone: 'ok', text: `${payload.reissued ? 'Reissued' : 'Released'}. ${route.workflowTitle} sent to ${to} for ${item.person.name}.` })
        }
      } else {
        setNotice({ tone: 'err', text: `Release refused for ${item.person.name}: ${payload.reason || payload.error || 'no longer eligible'}` })
      }
    } catch {
      setNotice({ tone: 'err', text: 'Network error. Do not retry until you verify the Sent log; the provider may have received the request.' })
    } finally {
      setBusyItemId(null)
      setConfirmItem(null)
      evidence.refetch()
    }
  }, [identityHold, authHeaders, evidence, ulQueue, setNotice, setConfirmItem])

  async function decideModeration(actionKey) {
    const item = moderateItem
    if (!item) return
    setBusyItemId(item.id); setNotice(null)
    const meta = ACTION_API[actionKey]
    const res = await postReleaseAction({ action: meta.action, responseId: item.responseId, decision: meta.decision })
    const status = res.data?.status || res.error
    setNotice({ tone: res.ok && res.data?.ok ? 'ok' : 'err', text: `${item.person.name}: ${ACTION_STATUS_MESSAGE[status] || 'That action could not be completed.'}` })
    setBusyItemId(null); setModerateItem(null)
    if (res.ok) ulQueue.refetch()
  }

  // Records or corrects ONE activity for ONE student. Never releases or sends anything.
  const submitActivity = useCallback(async ({ activity, reason }) => {
    const item = activityItem
    if (!item || !activity) return
    setActivitySaving(true); setActivityMsg(null)
    try {
      const headers = await authHeaders()
      if (!headers) throw new Error('Session expired, refresh and try again.')
      const correcting = activity.completed
      const res = await fetch('/api/student-activity-completion', {
        method: 'POST', headers,
        body: JSON.stringify({ student_id: item.studentId, activity_key: activity.key, action: correcting ? 'reverse' : 'complete', ...(correcting ? { reason } : {}) }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Could not record the activity.')
      setActivityMsg({ tone: 'ok', text: payload.recorded ? `${activity.label} ${correcting ? 'correction recorded' : 'marked complete'} for ${item.person.name}.` : (payload.message || 'No change was needed.') })
      await evidence.refetch()
    } catch (err) {
      setActivityMsg({ tone: 'err', text: err.message || 'Could not record the activity.' })
    } finally {
      setActivitySaving(false)
    }
  }, [activityItem, authHeaders, evidence])

  // Keep the open activity dialog on the freshest version of its item after a refetch.
  const activityItemLive = useMemo(() => {
    if (!activityItem) return null
    return (queues.postRotation?.items || []).find(i => i.id === activityItem.id) || activityItem
  }, [activityItem, queues])

  const onAction = useCallback((item) => {
    const b = item.blocker
    if (!b) return
    if (b.action === 'activity') { setActivityMsg(null); setActivityItem(item); return }
    if (b.action === 'moderate') { setModerateItem(item); return }
    if (b.action === 'fix') {
      // Opens the record that needs fixing. Student Profiles takes the student; the
      // preceptor directory and Responses are the other two homes.
      if (b.target?.kind === 'preceptor') navigate('/rotation?tab=preceptors')
      else if (b.target?.kind === 'response') onTrackResponses?.(workflow)
      else if (item.studentId) navigate(`/students?student=${encodeURIComponent(item.studentId)}`)
    }
  }, [navigate, onTrackResponses, workflow, setActivityItem, setModerateItem])

  // A jump switches the rail to the workflow that holds the prerequisite and flashes it.
  const [highlightItemId, setHighlightItemId] = useState(null)
  const flashTimer = useRef(null)
  const onJump = useCallback((target) => {
    if (!target?.workflowId) return
    selectWorkflow(target.workflowId)
    setHighlightItemId(target.itemId || null)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setHighlightItemId(null), 1400)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectWorkflow])
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const previewWorkflow = WORKFLOWS.find(w => w.key === previewKey)
  const q = queues[effective] || { items: [], sent: [] }
  const loading = effective === UNIT_LEADER_RELEASE_KEY ? ulQueue.isFetching : evidence.isFetching
  const error = effective === UNIT_LEADER_RELEASE_KEY ? ulQueue.error : evidence.error
  const detectedAtMs = effective === UNIT_LEADER_RELEASE_KEY ? (ulQueue.data?.detectedAtMs || 0) : (evidence.data?.detectedAtMs || 0)

  if (!canView) {
    return (
      <div style={{ padding: '32px 20px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        Review and Release is visible to Owner/Admin only.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 20px 28px', fontFamily: F }}>
      <style>{CSS}</style>

      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: '0 0 2px' }}>Review & Release</h2>
        {/* Section 5: the summary line, totals across all six workflows. */}
        <p role="status" className="rr-summary" style={{ fontSize: 12.5, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
          <b style={{ color: totals.ready > 0 ? '#166534' : '#191919' }}>{totals.ready}</b> ready to release {'·'}{' '}
          <b style={{ color: totals.blocked > 0 ? '#92400e' : '#191919' }}>{totals.blocked}</b> need a fix or a reminder {'·'}{' '}
          <b style={{ color: '#191919' }}>{sentToday}</b> sent today {'·'} across {WORKFLOWS.length} workflows
        </p>
      </div>

      {/* Narrow-screen selector (replaces the left rail below 900px). */}
      <select
        className="rr-nav-mobile"
        aria-label="Select Review and Release workflow"
        value={effective}
        onChange={(e) => selectWorkflow(e.target.value)}
        style={{ marginBottom: 14, padding: '9px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontFamily: F, color: '#191919', background: '#fff' }}
      >
        <optgroup label="Survey workflows">
          {WORKFLOWS.filter(w => w.group === 'survey').map(w => {
            const c = counts[w.key] || EMPTY_COUNTS
            return <option key={w.key} value={w.key}>{w.label} - {c.ready} ready, {c.blocked} need a fix</option>
          })}
        </optgroup>
        <optgroup label="Unit leader release">
          {WORKFLOWS.filter(w => w.group === 'unitLeader').map(w => {
            const c = counts[w.key] || EMPTY_COUNTS
            return <option key={w.key} value={w.key}>{w.label} - {c.ready} ready, {c.blocked} need a fix</option>
          })}
        </optgroup>
      </select>

      <div className="rr-layout">
        <nav className="rr-nav" aria-label="Survey workflows">
          <p className="rr-nav-group">Survey workflows</p>
          {WORKFLOWS.filter(w => w.group === 'survey').map(w => (
            <WorkflowNavRow key={w.key} w={w} counts={counts[w.key]} selected={effective === w.key} onSelect={() => selectWorkflow(w.key)} />
          ))}
          <p className="rr-nav-group">Unit leader release</p>
          {WORKFLOWS.filter(w => w.group === 'unitLeader').map(w => (
            <WorkflowNavRow key={w.key} w={w} counts={counts[w.key]} selected={effective === w.key} onSelect={() => selectWorkflow(w.key)} />
          ))}
        </nav>

        <section id={WORKSPACE_ID} className="rr-workspace">
          <ReviewReleaseQueue
            workflow={workflow}
            items={q.items}
            sent={q.sent}
            detectedAtMs={detectedAtMs}
            loading={loading}
            error={error}
            busyItemId={busyItemId}
            notice={noticeFor}
            highlightItemId={highlightItemId}
            releaseLocked={identityHold}
            onRerun={rerun}
            onRelease={(item) => { setNotice(null); setConfirmItem(item) }}
            onAction={onAction}
            onJump={onJump}
            onTrackResponses={onTrackResponses}
            tools={tools}
          />
          {identityHold && (
            <p role="alert" style={{ marginTop: 12, fontSize: 12.5, color: '#991b1b' }}>
              Release is paused on this screen until you re-run detection and verify the Sent log.
            </p>
          )}
        </section>
      </div>

      {confirmItem && (
        <ReleaseConfirm item={confirmItem} workflow={workflow} releasing={busyItemId === confirmItem.id}
          onCancel={() => setConfirmItem(null)} onConfirm={(opts) => doRelease(confirmItem, opts)} />
      )}
      {moderateItem && (
        <ModerateConfirm item={moderateItem} busy={busyItemId === moderateItem.id} onCancel={() => setModerateItem(null)} onDecide={decideModeration} />
      )}
      {activityItemLive && (
        <ActivityDialog item={activityItemLive} saving={activitySaving} message={activityMsg}
          onCancel={() => { setActivityItem(null); setActivityMsg(null) }} onSubmit={submitActivity} />
      )}

      {surveyPreviewKey && SURVEY_KEYS.includes(surveyPreviewKey) && (
        <SurveyPreviewDrawer workflowKey={surveyPreviewKey} onClose={() => setSurveyPreviewKey(null)} />
      )}
      {previewKey && SURVEY_KEYS.includes(previewKey) && (
        <AutomationEmailPreviewDrawer
          title={previewWorkflow?.title}
          entry={getEvaluationPreviewFixture(previewKey)}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </div>
  )
}
