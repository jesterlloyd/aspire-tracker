// src/portal/UnitLeaderPortal.jsx
//
// UL-PORTAL: the Unit Leader Portal, on the approved Compass shell.
//
// Every screen reads from a server endpoint that re-derives authorization from the
// caller's JWT. The browser holds no authority: the unit switcher only NARROWS an
// already-authorized set, and "All assigned units" simply omits the unit filter so
// the server returns exactly what the caller may see.
//
// ASPIRE keeps final authority for placements, capacity review, and preceptor
// confirmation. Every Unit Leader action is presented as recorded, never as decided.
//
// Excluded by construction, not by filtering: interview rubrics, readiness survey
// answers, certificates, uploaded onboarding documents, internal staff notes, and
// private support narratives are never requested by any call in this file.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
import { useRegisterPortalRefresh } from './PortalRefresh'
import { PortalHeaderScope, PortalHeaderControls } from './PortalHeaderSlots'
import GreetingMasthead from '../components/masthead/GreetingMasthead'
import OnCampusNow from '../components/oncampus/OnCampusNow'
import { useLastVisitLabel } from '../lib/lastVisit'
import { buildLiveShiftDisplay } from '../lib/onCampusRows'
import StatusLegendPopover from '../components/StatusLegendPopover'
import StudentActionsMenu from './unit/StudentActionsMenu'
import PreceptorList from './unit/PreceptorList'
import StudentDetailDrawer from './unit/StudentDetailDrawer'
import UnitShiftDayDrawer from './unit/UnitShiftDayDrawer'
import UnitStudentAvatar from './unit/UnitStudentAvatar'
import { statusToken } from './unit/unitStageTokens'
import { useUnitStudentPhotos } from './unit/useUnitStudentPhotos'
import { sortUnitLeaderStudentsByName } from './unit/unitLeaderStudentSort'
import { unitCohortOptions, studentInCohort, UL_ALL } from './unit/unitCohortScope'
import { deriveHoursCompletion } from './unit/hoursCompletion'
import { useAuth } from '../contexts/AuthContext'
import {
  LoadingState, EmptyState, ErrorState, DeniedState,
  SectionHeading, Pill, TableSkeleton,
} from './unit/UnitLeaderChrome'
import {
  ALL_UNITS, EMPTY, orDash, studentName, sentenceCase, ASPIRE_AUTHORITY_NOTE,
  getRoster, getPlacementRequests, respondToPlacement,
  submitParticipation,
  startUnitConversation,
  getNotifications, setNotificationPreference, getShiftActivity,
} from './unit/unitLeaderApi'
import {
  SUBMITTER_ROLES, SHIFT_PREFERENCE_OPTIONS, ALUMNI_HIRED_OPTIONS,
  ALUMNI_OUTCOME_OPTIONS, WOULD_CONSIDER_OPTIONS, PARTICIPATION_TEXT,
  emptyParticipation, isHostingParticipation, validateParticipation,
  participationReady, buildParticipationBody,
} from '../lib/unitParticipationForm'

const UnitRotationCalendar = lazy(() => import('./unit/UnitRotationCalendar'))
const UnitPreceptorsWorkspace = lazy(() => import('./unit/UnitPreceptorsWorkspace'))
const UnitLeaderPreceptorManager = lazy(() => import('./unit/UnitLeaderPreceptorManager'))
// UL-EVAL: the Evaluations workspace is lazy-loaded like the other heavy screens, so its
// chunk (and the shared reporting components) download only when a Unit Leader opens the tab.
const UnitEvaluationsWorkspace = lazy(() => import('./unit/UnitEvaluationsWorkspace'))

// A stable empty array so StudentRoster can call the photo hook with no work when a parent
// already supplies resolved photos (one batch for the whole Home instead of two).
const NO_PHOTO_STUDENTS = []

/**
 * One data hook: load, error, and refresh, with abort on unmount.
 *
 * `loading` is DERIVED rather than assigned, by comparing the nonce that has been
 * resolved against the one requested. That keeps the effect free of a synchronous
 * setState, which this repo forbids (react-hooks/set-state-in-effect), while still
 * showing a loading state on every refresh.
 */
function useEndpoint(loader, deps) {
  const [state, setState] = useState({ error: null, data: null, resolved: -1, at: 0 })
  const [nonce, setNonce] = useState(0)
  const refreshWaiters = useRef([])
  useEffect(() => {
    const ac = new AbortController()
    let live = true
    loader(ac.signal).then(res => {
      if (!live || res.error === 'aborted') return
      // loadedAt is stamped HERE, in the resolver, not during render: reading
      // the clock while rendering is impure and makes output unstable.
      setState(current => res.ok
        ? { error: null, data: res.data, resolved: nonce, at: Date.now() }
        : { error: res, data: current.data, resolved: nonce, at: Date.now() })
      const waiters = refreshWaiters.current.splice(0)
      waiters.forEach(resolve => resolve(res))
    })
    return () => { live = false; ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return {
    loading: state.resolved !== nonce,
    error: state.error,
    data: state.data,
    loadedAt: state.at,
    refresh: () => new Promise(resolve => {
      refreshWaiters.current.push(resolve)
      setNonce(n => n + 1)
    }),
  }
}

export default function UnitLeaderPortal({ view = 'home', onNavigate, threadId, onSelectThread, onBackToList, composeIntent = null }) {
  const { userProfile } = useAuth()
  const [unitKey, setUnitKey] = useState(ALL_UNITS)
  const [cohortSel, setCohortSel] = useState(null)   // null => the resolved default (newest active)

  const roster = useEndpoint(getRoster, [])
  const units = useMemo(() => roster.data?.units || [], [roster.data])
  // The server resolves the accepting cohort, so a unit with NO prior capacity
  // submission can still submit. Inferring it from existing rows would have made
  // the very first submission for a unit impossible.
  const acceptingCohort = roster.data?.accepting_cohort || null
  const unitKeys = useMemo(() => units.map(u => u.unit_key), [units])

  // Students across the current view, flattened with their unit.
  const students = useMemo(() => {
    const src = unitKey === ALL_UNITS ? units : units.filter(u => u.unit_key === unitKey)
    return src.flatMap(u => (u.students || []).map(s => ({ ...s, unit_key: u.unit_key })))
  }, [units, unitKey])

  // Cohort context. Only Home and Students are genuinely cohort-scoped: the roster mixes cohorts, and a
  // browser cohort choice NARROWS only within the already server-authorized set (it never widens it).
  // Placement Requests and Capacity act on the single server-resolved accepting cohort; Evaluations,
  // Preceptors, and Messages are not cohort-scoped, so no picker is offered there. The picker also
  // appears only when the authorized roster actually spans more than one cohort (never cosmetic).
  const UNIT_COHORT_SCOPED_VIEWS = ['home', 'students']
  const cohortView = UNIT_COHORT_SCOPED_VIEWS.includes(view)
  const { options: cohortOpts, defaultId: cohortDefault, currentIds: cohortCurrentIds, cohortCount } =
    useMemo(() => unitCohortOptions(students), [students])
  const cohortId = cohortOpts.some(o => o.id === cohortSel) ? cohortSel : cohortDefault
  const cohortScopedStudents = useMemo(
    () => (cohortView ? students.filter(s => studentInCohort(s, cohortId, cohortCurrentIds)) : students),
    [cohortView, students, cohortId, cohortCurrentIds],
  )
  // "All Cohorts" applies no narrowing, so Home's shift-derived surfaces keep their exact current
  // behavior; any narrower selection scopes them to the cohort's students too.
  const cohortNarrowed = cohortView && cohortId !== UL_ALL

  // UL-PERF: warm the lazy calendar chunk as soon as an authorized Unit Leader mounts
  // the portal, so it downloads in parallel with the roster bootstrap instead of only
  // after Home renders its Suspense boundary. Same specifier as the lazy() import
  // above, so both resolve one chunk; a failed prefetch is a no-op, since the Suspense
  // boundary still fetches on demand.
  useEffect(() => {
    import('./unit/UnitRotationCalendar').catch(() => {})
  }, [])

  // The section nav lives in the shell chrome now, so it is always present (Messages, Evaluations,
  // and More stay usable) while only the content area skeletons during the roster load.
  if (roster.loading && !roster.data) {
    return (
      <div className="ptl-page ptl-unit-page">
        <LoadingState label="Loading your units" />
      </div>
    )
  }
  if (roster.error && !roster.data) {
    return (
      <ErrorState
        detail="Your units could not be loaded just now."
        onRetry={roster.refresh}
      />
    )
  }
  // No assigned unit is a permission state, not an empty one.
  if (unitKeys.length === 0) return <DeniedState />

  const shared = { unitKey, unitKeys, students, acceptingCohort, refreshRoster: roster.refresh }

  // The switcher renders only where narrowing the unit view materially changes what the
  // page shows, and never as an authorization control. Placement Requests and Capacity
  // are deliberately excluded: Placement Requests already carries a Unit column on every
  // row and shows the full authorized set, and Capacity has its own in-form unit picker,
  // so a page-level selector there was redundant and could conflict with the form.
  const UNIT_SCOPED_VIEWS = ['home', 'students', 'preceptors']
  const showUnitPicker = unitKeys.length > 1 && UNIT_SCOPED_VIEWS.includes(view)
  // The cohort picker is genuinely scoped (Home/Students) AND only when there is more than one cohort
  // to choose between, so it is never a cosmetic global filter.
  const showCohortPicker = cohortView && cohortCount > 1

  return (
    <div className="ptl-page ptl-unit-page">
      {/* Unit and cohort scope live in the persistent Nightfall header. A single-unit leader sees the
          unit in the header subtitle (no page-level "Unit · X" row); a multi-unit leader gets an
          authorized unit selector, only on the unit-scoped views. The cohort picker sits beside it on
          the cohort-scoped views (Home, Students) when the roster spans multiple cohorts. */}
      {unitKeys.length === 1 && <PortalHeaderScope> · {unitKeys[0]}</PortalHeaderScope>}
      {(showUnitPicker || showCohortPicker) && (
        <PortalHeaderControls>
          {showUnitPicker && (
            <span className="ptl-header-ctl">
              <span className="ptl-header-ctl-label">Viewing</span>
              <select aria-label="Viewing units" value={unitKey} onChange={e => setUnitKey(e.target.value)}>
                <option value={ALL_UNITS}>All Assigned Units</option>
                {unitKeys.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </span>
          )}
          {showCohortPicker && (
            <span className="ptl-header-ctl">
              <span className="ptl-header-ctl-label">Cohort</span>
              <select aria-label="Cohort" value={cohortId} onChange={e => setCohortSel(e.target.value)}>
                {cohortOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </span>
          )}
        </PortalHeaderControls>
      )}

        {view === 'home'       && <HomeScreen {...shared} students={cohortScopedStudents} cohortNarrowed={cohortNarrowed} profile={userProfile} onNavigate={onNavigate} onOpenThread={onSelectThread} />}
        {view === 'placements' && <PlacementScreen {...shared} />}
        {view === 'capacity'   && <CapacityScreen {...shared} />}
        {view === 'students'   && <StudentsScreen {...shared} students={cohortScopedStudents} onNavigate={onNavigate} onOpenThread={onSelectThread} />}
        {view === 'evaluations' && (
          <Suspense fallback={<LoadingState label="Loading evaluations" />}>
            <UnitEvaluationsWorkspace unitKeys={unitKeys} />
          </Suspense>
        )}
        {view === 'preceptors' && <PreceptorScreen unitKey={unitKey} unitKeys={unitKeys} refreshRoster={roster.refresh} />}
        {view === 'profile'    && <ProfileScreen unitKeys={unitKeys} profile={userProfile} />}
        {view === 'messages' && composeIntent?.compose === 'aspire' && (
          <AspireTeamComposer
            students={students}
            startOpen
            onNavigate={onNavigate}
          />
        )}
        {view === 'messages'   && (
          <PortalMessagesWorkspace
            active
            variant="unit_leader"
            threadId={threadId}
            onSelectThread={onSelectThread}
            onBackToList={onBackToList}
          />
        )}
      </div>
  )
}

// ── Home: the locked priority order, now with hierarchy ─────────────────────
function HomeScreen({ unitKey, students, cohortNarrowed = false, profile, acceptingCohort, onNavigate, onOpenThread, refreshRoster }) {
  // The in-app feed is DERIVED server side from the caller's own authorized rows,
  // so Home and the feed can never disagree.
  const alerts = useEndpoint(s => getNotifications(unitKey, s), [unitKey])
  // Rotation activity for the calendar. Server-bounded to a rolling 90 days and
  // server-filtered to safe fields; nothing here can widen either.
  const activity = useEndpoint(s => getShiftActivity({}, s), [])
  const [dayOpen, setDayOpen] = useState(null)   // { ymd, shifts }

  // The shared portal Refresh re-fetches Home's three data paths: the roster (identity/hours), the
  // in-app feed, and the rotation calendar activity.
  useRegisterPortalRefresh(() => Promise.all([
    refreshRoster?.(), alerts.refresh(), activity.refresh(),
  ]))

  const notifications = alerts.data?.notifications || []
  const shifts = activity.data?.shifts || []
  // Shift-derived surfaces (On Campus Now + the rotation calendar) follow the header cohort selection:
  // when a specific cohort (or All Current) is active, they are narrowed to that cohort's students so
  // Home stays internally consistent; "All Cohorts" applies no narrowing and keeps the prior behavior.
  const scopedStudentIds = useMemo(() => new Set(students.map(s => s.id)), [students])
  const unitShifts = unitKey === ALL_UNITS ? shifts : shifts.filter(shift => shift.unit_key === unitKey)
  const visibleShifts = cohortNarrowed
    ? unitShifts.filter(shift => scopedStudentIds.has(shift.student_id))
    : unitShifts
  // A student currently checked in is the single most time-sensitive thing on this
  // screen, so it is promoted into the attention list rather than left to the grid.
  const onShiftNow = visibleShifts.filter(x => x.state === 'in_progress')

  // The shared greeting masthead replaces the plain "Welcome" heading. It reuses the main-app
  // masthead visual system (greeting, HTC weather scene, .mast* styling). The unit context is
  // shown once, above, by the UnitSwitcher's "Unit · X" line, so no second unit label sits
  // below the masthead. The greeting <h1> is the focus-on-navigation target, mirroring the
  // portal's SectionHeading behavior (programmatic focus, ring suppressed in CSS).
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )
  const lastVisitLine = useLastVisitLabel(profile?.id ? `aspire:lastVisit:portal:ul:${profile.id}` : null)
  const greetingRef = useRef(null)
  useEffect(() => {
    const el = greetingRef.current
    if (!el) return undefined
    el.dataset.programmaticFocus = 'true'
    el.focus()
    const clear = () => { delete el.dataset.programmaticFocus }
    el.addEventListener('blur', clear, { once: true })
    return () => { el.removeEventListener('blur', clear); clear() }
  }, [])

  // On Campus Now: the same canonical live-shift card the staff At a Glance dashboard uses,
  // built from the SAME shift-activity payload already loaded above (no extra request) and
  // scoped to the caller's authorized units. Photos resolve through the unit-scoped batch
  // (useUnitStudentPhotos, one batch for the whole Home). The open-shift duration / overdue
  // hedge reuse the pure shiftStatus helpers via a small shim (the UL row exposes `state`,
  // the helpers read `lifecycle_state`); the clock comes from when the data loaded, never a
  // render-time Date.now(). Clicking a card opens the canonical student profile drawer.
  const photos = useUnitStudentPhotos(students)
  const activityNow = activity.loadedAt || 0
  const [campusDetail, setCampusDetail] = useState(null)
  const campusTriggerRef = useRef(null)
  const openCampusDetail = (row) => {
    campusTriggerRef.current = typeof document !== 'undefined' ? document.activeElement : null
    const full = students.find(s => s.id === row.student_id)
    setCampusDetail(full || { id: row.student_id, first_name: row.student_name, unit_key: row.unit_key })
  }
  const campusRows = onShiftNow.map(x => ({
    ...buildLiveShiftDisplay(x, activityNow),
    key: x.id,
    avatar: <UnitStudentAvatar url={photos.peek(x.student_id)} name={x.student_name} size={38} />,
    onClick: () => openCampusDetail(x),
    ariaLabel: `Open profile for ${x.student_name || 'student'}`,
  }))

  // The attention strip renders ONLY when something is actionable. Live shifts moved to the
  // On Campus Now card above, so the strip is now the notifications queue only.
  const hasAttention = notifications.length > 0

  return (
    <>
      <GreetingMasthead
        fullName={profile?.full_name}
        dateLabel={dateLabel}
        contextLabel={acceptingCohort?.name || null}
        lastVisitLine={lastVisitLine}
        headingRef={greetingRef}
      />

      {/* On Campus Now: the canonical live-shift card, scoped to authorized units. */}
      <OnCampusNow
        title="On Campus Now"
        rows={campusRows}
        emptyText="No students from your units are on shift right now."
      />

      {/* The notifications queue, only when there is something to act on. */}
      {hasAttention && (
        <section className="ptl-card ptl-attn-strip" aria-label="Needs your attention">
          <ul className="ptl-list ptl-attn-list">
            {notifications.map(n => (
              <li key={n.id}>
                <button type="button" className="ptl-attn-row" onClick={() => onNavigate?.(n.section)}>
                  <span className="ptl-attn-dot" aria-hidden="true" />
                  <span className="ptl-attn-text">
                    <span className="ptl-attn-label">{n.label}</span>
                    <span className="ptl-attn-sub">{n.summary}</span>
                  </span>
                  {n.unit_key && <span className="ptl-attn-unit">{n.unit_key}</span>}
                  <span className="ptl-attn-chevron" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Suspense fallback={<LoadingState label="Loading rotation activity" />}>
        <UnitRotationCalendar
          shifts={visibleShifts}
          loading={activity.loading}
          onSelectDay={(ymd, dayShifts) => setDayOpen({ ymd, shifts: dayShifts })}
        />
      </Suspense>

      {/* Your Students, full width below. The Active-rotations and recent-threads cards
          are gone: the student table already represents active rotations, Messages
          has its own primary tab, and Capacity/Placement have dedicated routes. */}
      <StudentRoster
        students={students}
        photos={photos}
        onNavigate={onNavigate}
        onOpenThread={onOpenThread}
        refreshRoster={refreshRoster}
        heading="Your students"
      />

      {dayOpen && (
        <UnitShiftDayDrawer
          ymd={dayOpen.ymd}
          shifts={dayOpen.shifts}
          onClose={() => setDayOpen(null)}
        />
      )}

      {/* Clicking an On Campus Now card opens the canonical student profile drawer. No
          manage-assignments handler is passed, so that staff-style control stays hidden. */}
      {campusDetail && (
        <StudentDetailDrawer
          student={campusDetail}
          returnFocusRef={campusTriggerRef}
          onClose={() => setCampusDetail(null)}
        />
      )}
    </>
  )
}

// ── Placement Requests ──────────────────────────────────────────────────────
function PlacementScreen() {
  // Every request across the caller's authorized units, not a single-unit slice: the
  // page-level switcher was removed here because each row already carries its own Unit
  // column. ALL_UNITS omits the unit filter, so the server returns exactly the caller's
  // authorized set; it never widens scope.
  const { loading, error, data, loadedAt, refresh } = useEndpoint(s => getPlacementRequests(ALL_UNITS, s), [])
  // The shared portal Refresh re-fetches the placement-requests list (this screen's data path).
  useRegisterPortalRefresh(refresh)
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  // UL-POLISH P0: the change-request comment is an inline editor beneath the
  // request row (the old native prompt dialog lost the comment on cancel and
  // offered no context). Typed text survives a validation failure or a failed
  // save.
  const [editorFor, setEditorFor] = useState(null)
  const [comment, setComment] = useState('')

  const act = async (id, response, unitComment = '') => {
    if (busy) return
    setBusy(id)
    const res = await respondToPlacement(id, response, unitComment)
    setBusy(null)
    setNotice(res.ok
      ? { tone: 'ok', text: 'Your response was recorded. ASPIRE confirms the final placement.' }
      : { tone: 'error', text: res.error === 'conflict' ? 'ASPIRE has already decided this request.' : 'That response could not be saved.' })
    if (res.ok) {
      setEditorFor(null)
      setComment('')
      refresh()
    }
    return res.ok
  }

  const openEditor = (id) => {
    setEditorFor(id)
    setComment('')
    setNotice(null)
  }

  // UL-POLISH P1: after a response is recorded, the row shows one status chip
  // and a single Change response affordance; the three options return only
  // while changing. ASPIRE's authority and the append-only history are server
  // facts this state never touches.
  const [changingFor, setChangingFor] = useState(null)

  const sendChangeRequest = async (id) => {
    if (!comment.trim()) {
      setNotice({ tone: 'error', text: 'A comment is required when requesting changes.' })
      return
    }
    await act(id, 'changes_requested', comment.trim())
  }

  if (loading) return <TableSkeleton label="Loading placement requests" />
  if (error) return <ErrorState detail="Placement requests could not be loaded." onRetry={refresh} />

  const rows = data?.requests || []
  return (
    <>
      <SectionHeading focusKey="placements">Placement Requests</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}
      <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>
      {rows.length === 0 ? (
        <EmptyState title="No placement requests" detail="Requests from ASPIRE for your units appear here." />
      ) : (
        <div className="ptl-table-wrap">
          <table className="ptl-table">
            <caption className="ptl-visually-hidden">Placement requests for your assigned units</caption>
            <thead>
              <tr><th scope="col">Unit</th><th scope="col">Your response</th><th scope="col">ASPIRE status</th><th scope="col">Due</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <PlacementRow key={r.id} r={r} busy={busy} now={loadedAt}
                  editorOpen={editorFor === r.id}
                  changing={changingFor === r.id}
                  onStartChanging={() => setChangingFor(r.id)}
                  onStopChanging={() => setChangingFor(null)}
                  comment={comment} onComment={setComment}
                  onAct={async (...args) => { const ok = await act(...args); if (ok) setChangingFor(null); return ok }}
                  onOpenEditor={openEditor}
                  onCancelEditor={() => { setEditorFor(null); setComment('') }}
                  onSendChangeRequest={sendChangeRequest}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function PlacementRow({ r, busy, now, editorOpen, changing, onStartChanging, onStopChanging, comment, onComment, onAct, onOpenEditor, onCancelEditor, onSendChangeRequest }) {
  const isOpen = r.aspire_status === 'open'
  const hasResponded = r.unit_response !== 'pending'
  // Overdue carries a warning tone only while ASPIRE still awaits a response.
  // Measured against the moment this data loaded, so the row cannot change
  // meaning between two renders of the same response.
  const overdue = isOpen && r.due_at && new Date(r.due_at).getTime() < now
  const showOptions = isOpen && (!hasResponded || changing)
  return (
    <>
      <tr>
        <td data-label="Unit">{orDash(r.unit_key)}</td>
        <td data-label="Your response"><Pill tone={r.unit_response === 'pending' ? 'warn' : 'neutral'}>{sentenceCase(r.unit_response)}</Pill></td>
        <td data-label="ASPIRE status"><Pill tone={r.awaiting_aspire_confirmation ? 'warn' : 'ok'}>{r.awaiting_aspire_confirmation ? 'Awaiting ASPIRE' : sentenceCase(r.aspire_status)}</Pill></td>
        <td data-label="Due">
          {r.due_at
            ? <span className={overdue ? 'ptl-due-overdue' : undefined}>
                {new Date(r.due_at).toLocaleDateString()}{overdue ? ' · overdue' : ''}
              </span>
            : EMPTY}
        </td>
        <td data-label="Actions">
          {showOptions ? (
            <div className="ptl-actions">
              <button type="button" className="ptl-btn" disabled={busy === r.id} onClick={() => onAct(r.id, 'accepted')}>Accept</button>
              <button type="button" className="ptl-btn" disabled={busy === r.id} onClick={() => onAct(r.id, 'declined')}>Decline</button>
              <button type="button" className="ptl-btn" aria-expanded={editorOpen} disabled={busy === r.id} onClick={() => (editorOpen ? onCancelEditor() : onOpenEditor(r.id))}>Request changes</button>
              {hasResponded && (
                <button type="button" className="ptl-btn-outline ptl-btn-sm" disabled={busy === r.id} onClick={() => { onStopChanging(); onCancelEditor() }}>Keep current</button>
              )}
            </div>
          ) : isOpen && hasResponded ? (
            <button type="button" className="ptl-linklike" onClick={onStartChanging}>Change response</button>
          ) : <span className="ptl-muted">{EMPTY}</span>}
        </td>
      </tr>
      {editorOpen && (
        <tr className="ptl-editor-row">
          <td colSpan={5} data-label="Request changes">
            <div className="ptl-editor">
              <label className="ptl-label" htmlFor={`chg-${r.id}`}>What should change?</label>
              <textarea id={`chg-${r.id}`} className="ptl-input" rows={3} maxLength={2000}
                value={comment} onChange={e => onComment(e.target.value)} />
              <p className="ptl-editor-help">A comment is required when requesting changes. ASPIRE reviews it with your response.</p>
              <div className="ptl-editor-actions">
                <button type="button" className="ptl-btn-outline ptl-btn-sm" disabled={busy === r.id} onClick={onCancelEditor}>Cancel</button>
                <button type="button" className="ptl-btn ptl-btn-sm" disabled={busy === r.id} onClick={() => onSendChangeRequest(r.id)}>
                  {busy === r.id ? 'Sending' : 'Send request'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Capacity ────────────────────────────────────────────────────────────────
/**
 * The canonical Unit Availability form, the portal counterpart of the public /unit-form.
 * It uses the SAME shared definition (src/lib/unitParticipationForm.js) for options,
 * labels, helper text, and validation, and submits through unit-participation-submit,
 * which writes units + unit_cohort_responses, exactly the model the staff "At a Glance ->
 * Placement Capacity" panel reads. So a Unit Leader response lands where ASPIRE reviews it.
 *
 * Identity comes from the authenticated profile server side (no name/email fields). The
 * unit is prefilled and locked for a single-unit leader, and a picker restricted to
 * assigned units for a multi-unit leader; the endpoint independently rejects any unit
 * outside the caller's active scope.
 */
function CapacityScreen({ unitKeys, acceptingCohort, refreshRoster }) {
  // Capacity submits availability; its data path is the accepting cohort, derived from the roster.
  // The shared Refresh re-fetches the roster (the form's own draft state is untouched).
  useRegisterPortalRefresh(refreshRoster)
  const assignedUnits = unitKeys || []
  const singleUnit = assignedUnits.length === 1
  // The form's own unit picker is the only unit selection that matters for submission,
  // so Capacity no longer reads a page-level selector. One assigned unit is prefilled and
  // locked; several start unset so the leader chooses in the form. The endpoint independently
  // rejects any unit outside the caller's active scope either way.
  const initialUnit = singleUnit ? assignedUnits[0] : ''

  const [form, setForm] = useState(() => ({ ...emptyParticipation(), unit_name: initialUnit }))
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const cohortId = acceptingCohort?.id || null
  const hosting = isHostingParticipation(form)

  const submit = async (e) => {
    e.preventDefault()
    setNotice(null)
    if (!cohortId) {
      setNotice({ tone: 'error', text: 'ASPIRE has not opened a cohort for submissions yet. Availability can be submitted once one is open.' })
      return
    }
    const invalid = validateParticipation(form, { requireIdentity: false })
    if (invalid) { setNotice({ tone: 'error', text: invalid }); return }
    setSaving(true)
    const res = await submitParticipation(buildParticipationBody(form, { includeIdentity: false }))
    setSaving(false)
    if (res.ok) { setSubmitted(true); return }
    setNotice({
      tone: 'error',
      text: res.status === 403
        ? 'That unit is not in your access scope.'
        : (res.message || 'That response could not be saved.'),
    })
  }

  if (submitted) {
    return (
      <>
        <SectionHeading focusKey="capacity">Placement capacity</SectionHeading>
        <div className="ptl-card">
          <h3 className="ptl-card-title">Thank you, {form.unit_name}.</h3>
          <p className="ptl-muted">
            Your unit availability for {acceptingCohort?.name || 'this cohort'} was recorded. It
            now appears in the ASPIRE team's At a Glance placement capacity view.
          </p>
          <p>
            <button type="button" className="ptl-btn" onClick={() => {
              setSubmitted(false)
              setForm({ ...emptyParticipation(), unit_name: initialUnit })
            }}>
              Submit another response
            </button>
          </p>
        </div>
      </>
    )
  }

  const ready = participationReady(form, { requireIdentity: false })

  return (
    <>
      <SectionHeading focusKey="capacity">Placement capacity</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      <form className="ptl-card ptl-unit-form" onSubmit={submit}>
        <h3 className="ptl-card-title">Unit availability</h3>
        <p className="ptl-muted">Cohort: {acceptingCohort?.name ? acceptingCohort.name : EMPTY}</p>
        <p className="ptl-muted">
          This is the same unit availability form the ASPIRE team reviews in At a Glance.
        </p>

        <div className="ptl-form-grid">
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="cap-unit">{PARTICIPATION_TEXT.unitLabel}</label>
            {/* One assigned unit: prefilled and LOCKED (disabled). Several: a picker
                restricted to the caller's assigned units. The endpoint independently
                rejects any unit outside the caller's active scope either way. */}
            <select id="cap-unit" className="ptl-input ptl-input-full" value={form.unit_name} required
              disabled={singleUnit} aria-disabled={singleUnit}
              onChange={e => set('unit_name', e.target.value)}>
              {!singleUnit && <option value="">Select your assigned unit…</option>}
              {assignedUnits.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          <div className="ptl-field">
            <label className="ptl-label" htmlFor="cap-role">{PARTICIPATION_TEXT.roleLabel}</label>
            <select id="cap-role" className="ptl-input ptl-input-full" value={form.submitter_role} required
              onChange={e => set('submitter_role', e.target.value)}>
              <option value="">{PARTICIPATION_TEXT.rolePlaceholder}</option>
              {SUBMITTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="ptl-field ptl-field-wide">
            <label className="ptl-label" htmlFor="cap-slots">{PARTICIPATION_TEXT.slotsLabel}</label>
            <input id="cap-slots" className="ptl-input ptl-input-full" type="text" inputMode="numeric" pattern="[0-9]*"
              value={form.slots_offered} placeholder={PARTICIPATION_TEXT.slotsPlaceholder}
              onChange={e => set('slots_offered', e.target.value)} />
            <p className="ptl-field-help">{PARTICIPATION_TEXT.slotsHelp}</p>
          </div>

          {form.slots_offered !== '' && !hosting && (
            <div className="ptl-field ptl-field-wide">
              <label className="ptl-label" htmlFor="cap-reason">{PARTICIPATION_TEXT.reasonLabel}</label>
              <textarea id="cap-reason" className="ptl-input ptl-input-full" rows={3} value={form.reason_for_zero}
                placeholder={PARTICIPATION_TEXT.reasonPlaceholder}
                onChange={e => set('reason_for_zero', e.target.value)} />
            </div>
          )}

          {hosting && (
            <>
              <div className="ptl-field">
                <label className="ptl-label" htmlFor="cap-shift">{PARTICIPATION_TEXT.shiftLabel}</label>
                <select id="cap-shift" className="ptl-input ptl-input-full" value={form.shift_preference}
                  onChange={e => set('shift_preference', e.target.value)}>
                  <option value="">{PARTICIPATION_TEXT.shiftPlaceholder}</option>
                  {SHIFT_PREFERENCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="ptl-field ptl-field-wide">
                <label className="ptl-label" htmlFor="cap-preceptors">{PARTICIPATION_TEXT.preceptorsLabel}</label>
                <textarea id="cap-preceptors" className="ptl-input ptl-input-full" rows={3} value={form.preferred_preceptors}
                  placeholder={PARTICIPATION_TEXT.preceptorsPlaceholder}
                  onChange={e => set('preferred_preceptors', e.target.value)} />
              </div>
            </>
          )}

          <fieldset className="ptl-field ptl-field-wide ptl-fieldset">
            <legend className="ptl-label">{PARTICIPATION_TEXT.ngrpLabel}</legend>
            <div className="ptl-radio-row">
              <label className="ptl-radio">
                <input type="radio" name="cap-ngrp" checked={form.hiring_ngrp === true} onChange={() => set('hiring_ngrp', true)} />
                <span>Yes</span>
              </label>
              <label className="ptl-radio">
                <input type="radio" name="cap-ngrp" checked={form.hiring_ngrp === false} onChange={() => set('hiring_ngrp', false)} />
                <span>No</span>
              </label>
            </div>
          </fieldset>

          {form.hiring_ngrp === false && (
            <div className="ptl-field ptl-field-wide">
              <label className="ptl-label" htmlFor="cap-ngrp-reason">{PARTICIPATION_TEXT.ngrpReasonLabel}</label>
              <textarea id="cap-ngrp-reason" className="ptl-input ptl-input-full" rows={3} value={form.hiring_ngrp_reason}
                placeholder={PARTICIPATION_TEXT.ngrpReasonPlaceholder}
                onChange={e => set('hiring_ngrp_reason', e.target.value)} />
            </div>
          )}

          <fieldset className="ptl-field ptl-field-wide ptl-fieldset">
            <legend className="ptl-label">{PARTICIPATION_TEXT.alumniHiredLabel}</legend>
            <div className="ptl-radio-row">
              {ALUMNI_HIRED_OPTIONS.map(([v, l]) => (
                <label key={v} className="ptl-radio">
                  <input type="radio" name="cap-alumni" checked={form.has_fired_alumni === v} onChange={() => set('has_fired_alumni', v)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {form.has_fired_alumni === 'yes' && (
            <>
              <fieldset className="ptl-field ptl-field-wide ptl-fieldset">
                <legend className="ptl-label">{PARTICIPATION_TEXT.alumniOutcomeLabel}</legend>
                <div className="ptl-radio-row">
                  {ALUMNI_OUTCOME_OPTIONS.map(([v, l]) => (
                    <label key={v} className="ptl-radio">
                      <input type="radio" name="cap-outcome" checked={form.alumni_outcome === v} onChange={() => set('alumni_outcome', v)} />
                      <span>{l}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="ptl-field ptl-field-wide">
                <label className="ptl-label" htmlFor="cap-alumni-notes">{PARTICIPATION_TEXT.alumniNotesLabel}</label>
                <textarea id="cap-alumni-notes" className="ptl-input ptl-input-full" rows={3} value={form.alumni_notes}
                  placeholder={PARTICIPATION_TEXT.alumniNotesPlaceholder}
                  onChange={e => set('alumni_notes', e.target.value)} />
              </div>
            </>
          )}

          {form.has_fired_alumni === 'no' && (
            <fieldset className="ptl-field ptl-field-wide ptl-fieldset">
              <legend className="ptl-label">{PARTICIPATION_TEXT.wouldConsiderLabel}</legend>
              <div className="ptl-radio-row">
                {WOULD_CONSIDER_OPTIONS.map(([v, l]) => (
                  <label key={v} className="ptl-radio">
                    <input type="radio" name="cap-consider" checked={form.would_consider_alumni === v} onChange={() => set('would_consider_alumni', v)} />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="ptl-field ptl-field-wide">
            <label className="ptl-label" htmlFor="cap-considerations">{PARTICIPATION_TEXT.considerationsLabel}</label>
            <textarea id="cap-considerations" className="ptl-input ptl-input-full" rows={3} value={form.considerations}
              placeholder={PARTICIPATION_TEXT.considerationsPlaceholder}
              onChange={e => set('considerations', e.target.value)} />
          </div>
        </div>

        <div className="ptl-form-submit">
          <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>
          <button type="submit" className="ptl-btn" disabled={saving || !cohortId || !ready}>
            {saving ? 'Submitting' : 'Submit response'}
          </button>
        </div>
      </form>
    </>
  )
}

// ── Students ────────────────────────────────────────────────────────────────

/**
 * UL-POLISH P1: hours as a mini progress bar plus the exact numbers.
 *
 * A student can reach or exceed the required hours before the scheduled rotation end date; the
 * numbers stay UNCAPPED (e.g. 192 of 144), a single "Hours complete" indicator appears, and a
 * helper explains that the rotation remains active through its official end date. Canonical
 * lifecycle completion is reconciled server-side after that date has fully passed. This cell never
 * changes or substitutes for the stored status.
 */
function HoursCell({ hours, rotationEnd = null, todayYmd = null }) {
  if (!hours || hours.required == null) return EMPTY
  const c = deriveHoursCompletion({ hours, rotationEnd, todayYmd })
  const pct = c.validReq ? Math.min(100, Math.round((Math.max(0, c.approved) / c.required) * 100)) : 0
  return (
    <span className="ptl-hours-cell">
      <span className="ptl-mini-progress" role="img"
        aria-label={`${c.approved} of ${hours.required} required hours approved${c.complete ? '. Hours complete' : ''}`}>
        <i style={{ width: `${pct}%` }} />
      </span>
      {/* The numbers are never capped at the requirement: overage stays visible (e.g. 192 of 144). */}
      <span className="ptl-hours-text">{c.approved} of {hours.required}</span>
      {c.complete && <span className="ptl-hours-complete">Hours complete</span>}
      {c.endFuture && (
        <span className="ptl-hours-note">
          Required approved hours reached. Rotation remains active through {fmtShortDate(rotationEnd)}.
        </span>
      )}
    </span>
  )
}

/**
 * The roster. ONE module, two mount points: embedded in Home, and standalone at
 * /portal/unit/students so that deep link keeps working after Students left the nav.
 * `heading` distinguishes them; everything else is identical, so the two can never drift.
 */
/** A short rotation-timeline date, matching the drawer's date style. */
function fmtShortDate(ymd) {
  if (!ymd) return null
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function StudentRoster({ students, photos: providedPhotos = null, onNavigate, onOpenThread, refreshRoster, heading = null }) {
  // Reuse the parent's already-batched photos when provided (Home), otherwise resolve our own
  // (the standalone /portal/unit/students route). The hook is always called; a stable empty
  // input makes it a no-op when photos are supplied.
  const ownPhotos = useUnitStudentPhotos(providedPhotos ? NO_PHOTO_STUDENTS : students)
  const photos = providedPhotos || ownPhotos
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(null)          // duplicate-click protection
  const [openActions, setOpenActions] = useState(null)
  const [detailStudent, setDetailStudent] = useState(null)
  const [manager, setManager] = useState(null)
  const [assignmentRefreshKey, setAssignmentRefreshKey] = useState(0)
  const [nameSortDir, setNameSortDir] = useState('asc')
  // The exact element that opened the drawer, so focus returns to the right ROW.
  const detailTriggerRef = useRef(null)
  const managerTriggerRef = useRef(null)
  const sortedStudents = useMemo(
    () => sortUnitLeaderStudentsByName(students, nameSortDir),
    [students, nameSortDir],
  )
  // A stable local "today" (YYYY-MM-DD), read once on mount (not during render), used to compare each
  // student's canonical rotation end date against now for the hours-complete helper. Frozen for the
  // life of the mounted roster, like the Home masthead date.
  const todayYmd = useMemo(() => new Date().toLocaleDateString('en-CA'), [])

  const openDetail = (student, triggerEl) => {
    detailTriggerRef.current = triggerEl || null
    setDetailStudent(student)
  }

  const openManager = (student, initialAction, triggerEl) => {
    managerTriggerRef.current = triggerEl || null
    setManager({ student, initialAction })
  }

  const assignmentCommitted = async (_result, message) => {
    setNotice({ tone: 'ok', text: message })
    setAssignmentRefreshKey(value => value + 1)
    const refreshed = await refreshRoster?.()
    return refreshed?.ok !== false
  }

  // ONE table, the whole 90-day visibility window. The stage filters are gone: a Unit
  // Leader with a handful of students does not need to slice them, and the window is
  // already bounded server side to placed, active, and recently-completed students.
  const messageStudent = async (student) => {
    if (busy) return
    setBusy(`${student.id}:message`)
    const res = await startUnitConversation({
      destination: 'student',
      studentId: student.id,
      subject: `About your ASPIRE rotation on ${student.unit_key}`,
      category: 'Clinical rotation support',
      body: `Hello ${studentName(student)},\n\n`,
    })
    setBusy(null)
    if (res.ok) {
      setNotice({ tone: 'ok', text: 'Conversation opened.' })
      if (res.data?.conversation_id) onOpenThread?.(res.data.conversation_id)
      else onNavigate?.('messages')
      return
    }
    setNotice({
      tone: 'error',
      text: res.error === 'student_has_no_portal_account'
        ? 'That student does not have an ASPIRE portal account yet, so a direct conversation cannot be opened.'
        : res.status === 429
          ? 'You have started several conversations recently. Please try again shortly.'
          : 'That conversation could not be opened.',
    })
  }

  return (
    <>
      {heading
        ? <h3 className="ptl-card-title ptl-roster-heading">{heading}</h3>
        : <SectionHeading focusKey="students">Students</SectionHeading>}
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      {students.length === 0 ? (
        <EmptyState title="No students in your assigned units"
          detail="Students placed in your assigned units appear here, including those who completed within the last 90 days." />
      ) : (
        <div className="ptl-card ptl-stu-tablewrap">
          <table className="ptl-stu-table">
            <caption className="ptl-visually-hidden">Students in your assigned units, last 90 days</caption>
            <thead>
              <tr>
                <th scope="col" aria-sort={nameSortDir === 'asc' ? 'ascending' : 'descending'}>
                  <button type="button" className="ptl-stu-sort"
                    onClick={() => setNameSortDir(current => current === 'asc' ? 'desc' : 'asc')}
                    aria-label={`Sort students by name ${nameSortDir === 'asc' ? 'descending' : 'ascending'}`}>
                    <span>Student</span>
                    <span aria-hidden="true">{nameSortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                  </button>
                </th>
                <th scope="col">
                  {/* Shared ASPIRE Status Legend, same trigger/position/behavior as the Academic
                      Partner roster. Portal-safe audience mode (audience="unit_leader"): no NGRP
                      disposition reasons, interview recommendations, or staff-only readiness detail. */}
                  <span className="am-sort-th-inner">ASPIRE status<StatusLegendPopover audience="unit_leader" /></span>
                </th>
                <th scope="col">Preceptor(s)</th>
                <th scope="col">Shift</th>
                <th scope="col">Rotation</th>
                <th scope="col">Cohort</th>
                <th scope="col">Hours</th>
                <th scope="col"><span className="ptl-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map(s => (
                <StudentRow
                  key={s.id}
                  student={s}
                  photoUrl={photos.peek(s.id)}
                  todayYmd={todayYmd}
                  busy={busy}
                  open={openActions === s.id}
                  onToggleActions={() => setOpenActions(openActions === s.id ? null : s.id)}
                  onCloseActions={() => setOpenActions(null)}
                  onOpen={openDetail}
                  onMessage={messageStudent}
                  onManage={openManager}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailStudent && (
        <StudentDetailDrawer
          student={detailStudent}
          returnFocusRef={detailTriggerRef}
          assignmentRefreshKey={assignmentRefreshKey}
          suspended={!!manager}
          onManageAssignments={(student, triggerEl) => openManager(student, null, triggerEl)}
          onClose={() => setDetailStudent(null)}
        />
      )}

      {manager && (
        <Suspense fallback={<LoadingState label="Loading assignment manager" />}>
          <UnitLeaderPreceptorManager
            student={manager.student}
            initialAction={manager.initialAction}
            returnFocusRef={managerTriggerRef}
            onCommitted={assignmentCommitted}
            onClose={() => setManager(null)}
          />
        </Suspense>
      )}
    </>
  )
}

/**
 * Standalone Students view. Students is no longer a primary tab, but
 * /portal/unit/students remains a valid deep link and renders the same roster module
 * Home embeds, so a bookmark or an emailed link still works.
 */
function StudentsScreen(props) {
  // The roster IS this screen's data path; the shared Refresh re-fetches it.
  useRegisterPortalRefresh(props.refreshRoster)
  return <StudentRoster {...props} />
}

/**
 * A staff-style roster row: circular photo, identity with a stage pill, unit,
 * preceptor, hours, onboarding, and one kebab. The whole row is the open-profile
 * control; the kebab is a SEPARATE button that stops propagation, so the row is a
 * single primary affordance rather than the old stacked View-details plus Actions.
 *
 * The row is a <button> so keyboard users get Enter and Space for free. The kebab
 * lives OUTSIDE that button (a sibling in the <li>), because a button nested inside a
 * button is invalid HTML and resolves unpredictably.
 */
function StudentRow({
  student: s, photoUrl, todayYmd = null, busy, open, onToggleActions, onCloseActions, onOpen, onMessage, onManage,
}) {
  const status = statusToken(s.status)
  const rot = s.rotation ? `${fmtShortDate(s.rotation.start)} to ${fmtShortDate(s.rotation.end)}` : EMPTY
  // The whole row opens the profile; the Actions cell stops propagation so a kebab
  // click never doubles as a row click. Enter and Space activate the row for keyboard.
  const open_ = (el) => onOpen(s, el)
  return (
    <tr
      className="ptl-stu-trow"
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${studentName(s)}`}
      onClick={(e) => open_(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open_(e.currentTarget) } }}
    >
      <td data-label="Student">
        <span className="ptl-stu-idcell">
          <UnitStudentAvatar url={photoUrl} name={studentName(s)} size={40} />
          <span className="ptl-stu-idtext">
            <span className="ptl-stu-name">{studentName(s)}</span>
            <span className="ptl-stu-school">{orDash(s.school)}</span>
          </span>
        </span>
      </td>
      <td data-label="ASPIRE status">
        <span className="ptl-stu-pill"
          style={{ background: status.bg, color: status.text, border: `1px solid ${status.border}` }}>
          {orDash(s.status)}
        </span>
      </td>
      <td data-label="Preceptor(s)">
        <PreceptorList assignments={s.preceptors} fallbackName={s.preceptor_name}
          formatDate={fmtShortDate} empty={EMPTY} />
      </td>
      {/* DEPLOYED shift (primary preceptor's assigned shift), never a preference. A clear
          "Not assigned" reads better than a dash when no actual shift exists. */}
      <td data-label="Shift">{s.shift || 'Not assigned'}</td>
      <td data-label="Rotation">{rot}</td>
      <td data-label="Cohort">{orDash(s.cohort?.name)}</td>
      <td data-label="Hours"><HoursCell hours={s.hours} rotationEnd={s.rotation?.end} todayYmd={todayYmd} /></td>
      <td data-label="Actions" className="ptl-stu-actioncell"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {/* The menu renders through document.body so the table overflow cannot clip it.
            Replace and End remain row-specific actions inside the shared manager. */}
        <StudentActionsMenu
          label={`Actions for ${studentName(s)}`}
          open={open}
          onToggle={onToggleActions}
          onClose={onCloseActions}
          items={[
            {
              key: 'message',
              label: busy === `${s.id}:message` ? 'Opening' : 'Message student',
              disabled: busy === `${s.id}:message`,
              onSelect: () => onMessage(s),
            },
            {
              key: 'change-primary',
              label: 'Change Primary preceptor',
              onSelect: triggerEl => onManage(s, 'change_primary', triggerEl),
            },
            {
              key: 'add-secondary',
              label: 'Add Secondary preceptor',
              onSelect: triggerEl => onManage(s, 'add_secondary', triggerEl),
            },
            {
              key: 'add-coverage',
              label: 'Add Coverage preceptor',
              onSelect: triggerEl => onManage(s, 'add_coverage', triggerEl),
            },
          ]}
        />
      </td>
    </tr>
  )
}

function PreceptorScreen({ unitKey, unitKeys, refreshRoster }) {
  return (
    <Suspense fallback={<TableSkeleton label="Loading preceptors" />}>
      <UnitPreceptorsWorkspace unitKey={unitKey} unitKeys={unitKeys} onAssignmentsChanged={refreshRoster} />
    </Suspense>
  )
}

// ── Report a Concern ────────────────────────────────────────────────────────
/**
 * Message the ASPIRE Team, which absorbed Report a Concern.
 *
 * It was never a separate workflow: it posts to the same startUnitConversation endpoint
 * with destination 'aspire'. Losing its tab cost nothing, so it lives inside Messages and
 * opens expanded when reached from the retained /portal/unit/concern link.
 */
function AspireTeamComposer({ students, startOpen = false, onNavigate }) {
  const [open, setOpen] = useState(startOpen)
  if (!open) {
    return (
      <div className="ptl-card ptl-aspire-cta">
        <button type="button" className="ptl-btn ptl-btn-small" onClick={() => setOpen(true)}>
          Message the ASPIRE Team
        </button>
        <span className="ptl-muted">Raise a concern or ask a question about a student or your unit.</span>
      </div>
    )
  }
  return <ConcernScreen students={students} onDone={() => setOpen(false)} onNavigate={onNavigate} />
}

function ConcernScreen({ students }) {
  const [studentId, setStudentId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null)

  const student = students.find(s => s.id === studentId) || null

  // The draft is PREFILLED and fully editable. It carries only the student name and
  // unit as context. It never contains a support narrative, an internal note, a
  // rubric, a survey answer, a certificate, or an onboarding document.
  const prefill = (s) => {
    if (!s) return { subject: '', body: '' }
    return {
      subject: `Concern about ${studentName(s)} on ${s.unit_key}`,
      body:
        `Student: ${studentName(s)}\n` +
        `Unit: ${s.unit_key}\n\n` +
        'What I would like ASPIRE to know:\n',
    }
  }

  const pick = (id) => {
    setStudentId(id)
    const s = students.find(x => x.id === id) || null
    const p = prefill(s)
    setSubject(p.subject)
    setBody(p.body)
  }

  const send = async (e) => {
    e.preventDefault()
    if (sending) return              // duplicate-submission guard
    setSending(true)
    const res = await startUnitConversation({
      destination: 'aspire',
      studentId,
      subject,
      category: 'Clinical rotation support',
      body,
    })
    setSending(false)
    setNotice(res.ok
      ? { tone: 'ok', text: 'Your concern was sent to the ASPIRE Team. The student does not see this conversation.' }
      : { tone: 'error', text: res.status === 429 ? 'You have sent several messages recently. Please try again shortly.' : 'That concern could not be sent.' })
    if (res.ok) { setStudentId(''); setSubject(''); setBody('') }
  }

  return (
    <>
      <SectionHeading focusKey="concern">Report a Concern</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}
      <p className="ptl-muted">
        This opens a conversation with the ASPIRE Team. The student is not part of it.
      </p>

      <form className="ptl-card ptl-unit-form" onSubmit={send}>
        <div className="ptl-form-grid">
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="con-student">Student</label>
            <select id="con-student" className="ptl-input ptl-input-full" required value={studentId}
              onChange={e => pick(e.target.value)}>
              <option value="">Select a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{studentName(s)} ({s.unit_key})</option>)}
            </select>
            <p className="ptl-field-help">Choosing a student prefills the draft; everything stays editable.</p>
          </div>
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="con-subject">Subject</label>
            <input id="con-subject" className="ptl-input ptl-input-full" required minLength={3} maxLength={120}
              value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="ptl-field ptl-field-wide">
            <label className="ptl-label" htmlFor="con-body">Message</label>
            <textarea id="con-body" className="ptl-input ptl-input-full" required minLength={1} maxLength={5000} rows={8}
              value={body} onChange={e => setBody(e.target.value)} />
          </div>
        </div>
        <div className="ptl-form-submit">
          <button type="submit" className="ptl-btn" disabled={sending || !student}>
            {sending ? 'Sending' : 'Send to ASPIRE'}
          </button>
        </div>
      </form>
    </>
  )
}

// ── Profile and unit context ────────────────────────────────────────────────
function ProfileScreen({ unitKeys, profile }) {
  const prefs = useEndpoint(s => getNotifications(null, s), [])
  // The shared portal Refresh re-fetches this screen's notification preferences.
  useRegisterPortalRefresh(prefs.refresh)
  const [rows, setRows] = useState(null)
  const [notice, setNotice] = useState(null)

  const list = rows || prefs.data?.preferences || []

  const toggle = async (alertType, next) => {
    const res = await setNotificationPreference(alertType, next)
    if (res.ok) {
      setRows(res.data?.preferences || null)
      setNotice({ tone: 'ok', text: next ? 'Email turned on for that alert.' : 'Email turned off for that alert.' })
    } else {
      setNotice({ tone: 'error', text: 'That preference could not be saved.' })
    }
  }

  return (
    <>
      <SectionHeading focusKey="profile">Profile</SectionHeading>
      <section className="ptl-card">
        <h3 className="ptl-card-title">Your ASPIRE access</h3>
        <dl className="ptl-deflist">
          <dt>Name</dt><dd>{orDash(profile?.full_name)}</dd>
          <dt>Role</dt><dd>Unit Leader</dd>
          <dt>Assigned units</dt>
          <dd>{unitKeys.length > 0 ? unitKeys.join(', ') : EMPTY}</dd>
          <dt>Assignment status</dt><dd>Active</dd>
        </dl>
        <p className="ptl-muted">
          The ASPIRE team manages unit assignments. To change yours, contact ASPIRE.
        </p>
      </section>

      <section className="ptl-card" aria-labelledby="ul-prefs">
        <h3 id="ul-prefs" className="ptl-card-title">Notification preferences</h3>
        {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}
        <p className="ptl-muted">
          Every alert always appears in the portal. These settings control email only,
          so turning one off is how you unsubscribe from that email.
        </p>
        {prefs.loading ? (
          <LoadingState label="Loading your preferences" />
        ) : prefs.error ? (
          <ErrorState detail="Your preferences could not be loaded." onRetry={prefs.refresh} />
        ) : (
          <ul className="ptl-list ptl-preflist">
            {list.map(p => (
              <li key={p.alert_type}>
                {p.email_supported ? (
                  <label className="ptl-checkline">
                    <input
                      type="checkbox"
                      checked={p.email_enabled === true}
                      onChange={e => toggle(p.alert_type, e.target.checked)}
                    />
                    <span>{p.label}</span>
                  </label>
                ) : (
                  <span>{p.label} <span className="ptl-muted">(in portal only)</span></span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
