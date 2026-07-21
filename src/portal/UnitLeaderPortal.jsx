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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
import { listPortalConversations } from '../lib/messages/portalMessagesApiClient'
import { formatInboxTimestamp, formatUnread } from '../lib/messages/messagesConstants'
import { UL_THREAD_ASPIRE_LABEL, ulDirectThreadLabel } from '../lib/messages/portalMessagesConstants'
import { firstNameOf } from '../lib/masthead'
import StudentDetailDrawer from './unit/StudentDetailDrawer'
import UnitRotationCalendar from './unit/UnitRotationCalendar'
import UnitShiftDayDrawer from './unit/UnitShiftDayDrawer'
import UnitEvaluationsPlaceholder from './unit/UnitEvaluationsPlaceholder'
import UnitStudentAvatar from './unit/UnitStudentAvatar'
import { stageToken } from './unit/unitStageTokens'
import { useUnitStudentPhotos } from './unit/useUnitStudentPhotos'
import { useAuth } from '../contexts/AuthContext'
import {
  UnitLeaderNav, UnitSwitcher, LoadingState, EmptyState, ErrorState, DeniedState,
  SectionHeading, Pill, TableSkeleton,
} from './unit/UnitLeaderChrome'
import {
  ALL_UNITS, EMPTY, orDash, studentName, sentenceCase, BUCKET_LABEL, ONBOARDING_LABEL,
  OUTSTANDING_LABEL, ASPIRE_AUTHORITY_NOTE,
  getRoster, getPlacementRequests, respondToPlacement,
  getCapacity, submitCapacity, getNominations, nominatePreceptor,
  confirmMilestone, startUnitConversation,
  getNotifications, setNotificationPreference, getShiftActivity,
} from './unit/unitLeaderApi'

/** A local clock time from an ISO timestamp, for check-in and check-out display. */
function fmtClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const MILESTONES = [
  { key: 'arrival', label: 'Arrival' },
  { key: 'unit_orientation', label: 'Unit orientation' },
  { key: 'preceptor_confirmation', label: 'Preceptor confirmed' },
  { key: 'rotation_conclusion', label: 'Rotation concluded' },
]

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
  useEffect(() => {
    const ac = new AbortController()
    let live = true
    loader(ac.signal).then(res => {
      if (!live || res.error === 'aborted') return
      // loadedAt is stamped HERE, in the resolver, not during render: reading
      // the clock while rendering is impure and makes output unstable.
      setState(res.ok
        ? { error: null, data: res.data, resolved: nonce, at: Date.now() }
        : { error: res, data: null, resolved: nonce, at: Date.now() })
    })
    return () => { live = false; ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return {
    loading: state.resolved !== nonce,
    error: state.error,
    data: state.data,
    loadedAt: state.at,
    refresh: () => setNonce(n => n + 1),
  }
}

export default function UnitLeaderPortal({ view = 'home', onNavigate, unread = 0, threadId, onSelectThread, onBackToList, composeIntent = null }) {
  const { userProfile } = useAuth()
  const [unitKey, setUnitKey] = useState(ALL_UNITS)

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

  const byBucket = useCallback(
    (b) => students.filter(s => s.bucket === b), [students])

  if (roster.loading) return <LoadingState label="Loading your units" />
  if (roster.error) {
    return (
      <ErrorState
        detail="Your units could not be loaded just now."
        onRetry={roster.refresh}
      />
    )
  }
  // No assigned unit is a permission state, not an empty one.
  if (unitKeys.length === 0) return <DeniedState />

  const shared = { unitKey, unitKeys, students, byBucket, acceptingCohort, refreshRoster: roster.refresh }

  // UL-POLISH P0: Messages, Report a Concern, and Profile are not unit-scoped
  // views (Messages ignores the unit filter entirely), so the switcher renders
  // only where narrowing means something. Never an authorization control.
  const UNIT_SCOPED_VIEWS = ['home', 'placements', 'capacity', 'students', 'preceptors']

  return (
    <>
      <UnitLeaderNav view={view} unread={unread} onNavigate={onNavigate} />
      <div className="ptl-page ptl-unit-page">
        {UNIT_SCOPED_VIEWS.includes(view) && (
          <UnitSwitcher unitKeys={unitKeys} value={unitKey} onChange={setUnitKey} />
        )}

        {view === 'home'       && <HomeScreen {...shared} profile={userProfile} onNavigate={onNavigate} onOpenThread={onSelectThread} />}
        {view === 'placements' && <PlacementScreen {...shared} />}
        {view === 'capacity'   && <CapacityScreen {...shared} />}
        {view === 'students'   && <StudentsScreen {...shared} onNavigate={onNavigate} onOpenThread={onSelectThread} />}
        {view === 'evaluations' && <UnitEvaluationsPlaceholder />}
        {view === 'preceptors' && <PreceptorScreen {...shared} />}
        {view === 'profile'    && <ProfileScreen unitKeys={unitKeys} profile={userProfile} />}
        {view === 'messages'   && (
          <AspireTeamComposer
            students={students}
            startOpen={composeIntent?.compose === 'aspire'}
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
    </>
  )
}

// ── Home: the locked priority order, now with hierarchy ─────────────────────
function HomeScreen({ unitKey, unitKeys, students, byBucket, profile, refreshRoster, onNavigate, onOpenThread }) {
  const placements = useEndpoint(s => getPlacementRequests(unitKey, s), [unitKey])
  const capacity = useEndpoint(s => getCapacity(unitKey, s), [unitKey])
  // The in-app feed is DERIVED server side from the caller's own authorized rows,
  // so Home and the feed can never disagree.
  const alerts = useEndpoint(s => getNotifications(unitKey, s), [unitKey])
  // Rotation activity for the calendar. Server-bounded to a rolling 90 days and
  // server-filtered to safe fields; nothing here can widen either.
  const activity = useEndpoint(s => getShiftActivity({}, s), [])
  const [dayOpen, setDayOpen] = useState(null)   // { ymd, shifts }
  // UL-POLISH P1: the latest threads, from the same endpoint the inbox uses.
  const recent = useEndpoint(
    (sig) => listPortalConversations({ limit: 3, signal: sig })
      .then((data) => ({ ok: true, data }))
      .catch(() => ({ ok: false, status: 0, data: null, error: 'request_failed' })),
    [])

  // Awaiting-response requests are surfaced by the derived feed, so they are not
  // recomputed here. openRequests is still needed for the capacity summary count.
  const openRequests = (placements.data?.requests || []).filter(r => r.aspire_status === 'open')
  const supportFlags = students.filter(s => s.support?.open_count > 0)
  const notifications = alerts.data?.notifications || []
  const liveCapacity = (capacity.data?.submissions || []).filter(c => c.is_live)
  const threads = (recent.data?.conversations || []).slice(0, 3)
  const shifts = activity.data?.shifts || []
  // A student currently checked in is the single most time-sensitive thing on this
  // screen, so it is promoted into the attention list rather than left to the grid.
  const onShiftNow = shifts.filter(x => x.state === 'in_progress')

  // UL-POLISH P1: the Compass welcome header replaces the literal "Home"
  // heading (the nav already says Home). Unit context is always visible here.
  const first = firstNameOf(profile?.full_name)
  const unitContext = unitKeys.length === 1 ? unitKeys[0]
    : unitKeys.length === 2 ? unitKeys.join(' and ')
    : `${unitKeys.length} assigned units`

  return (
    <>
      <SectionHeading focusKey="home">{first ? `Welcome, ${first}` : 'Welcome'}</SectionHeading>
      <p className="ptl-muted ptl-home-sub">Unit Leader · {unitContext}</p>

      <div className="ptl-grid ptl-home-grid">
        <div className="ptl-col-7 ptl-home-col">
          {/* 1. Needs your attention */}
          <section className="ptl-card" aria-labelledby="ul-attention">
            <h3 id="ul-attention" className="ptl-card-title">Needs your attention</h3>
            {alerts.loading ? (
              <LoadingState label="Loading your notifications" />
            ) : notifications.length === 0 && supportFlags.length === 0 && onShiftNow.length === 0 ? (
              <p className="ptl-muted">Nothing needs your attention right now.</p>
            ) : (
              <ul className="ptl-list ptl-attn-list">
                {/* Live first: a student on the unit right now outranks anything queued. */}
                {onShiftNow.map(x => (
                  <li key={`live-${x.id}`}>
                    <button type="button" className="ptl-attn-row"
                      onClick={() => setDayOpen({ ymd: x.shift_date, shifts: shifts.filter(y => y.shift_date === x.shift_date) })}>
                      <span className="ptl-attn-dot ptl-attn-dot-live" aria-hidden="true" />
                      <span className="ptl-attn-text">
                        <span className="ptl-attn-label">{x.student_name || 'A student'} is on shift now</span>
                        <span className="ptl-attn-sub">
                          {x.checked_in_at ? `Checked in ${fmtClock(x.checked_in_at)}` : 'Checked in'}
                          {x.preceptor_name ? ` · with ${x.preceptor_name}` : ''}
                        </span>
                      </span>
                      {x.unit_key && <span className="ptl-attn-unit">{x.unit_key}</span>}
                      <span className="ptl-attn-chevron" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
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
                {/* The support signal links to Students and carries only the fact
                    that a note exists, never its text. */}
                {supportFlags.map(s => (
                  <li key={s.id}>
                    <button type="button" className="ptl-attn-row" onClick={() => onNavigate?.('students')}>
                      <span className="ptl-attn-dot" aria-hidden="true" />
                      <span className="ptl-attn-text">
                        <span className="ptl-attn-label">{studentName(s)} raised a support note</span>
                        <span className="ptl-attn-sub">in the last {s.support.window_days} days</span>
                      </span>
                      {s.unit_key && <span className="ptl-attn-unit">{s.unit_key}</span>}
                      <span className="ptl-attn-chevron" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2. Rotation activity: what actually happened, never a schedule. */}
          <UnitRotationCalendar
            shifts={shifts}
            windowStart={activity.data?.window?.start}
            loading={activity.loading}
            onSelectDay={(ymd, dayShifts) => setDayOpen({ ymd, shifts: dayShifts })}
          />

          {/* 3. The roster, embedded. Students left the nav but not the product. */}
          <StudentRoster
            students={students}
            refreshRoster={refreshRoster}
            onNavigate={onNavigate}
            onOpenThread={onOpenThread}
            heading="Your students"
          />

          {/* 4. Capacity and placement, with numbers that go somewhere */}
          <section className="ptl-card" aria-labelledby="ul-cap">
            <h3 id="ul-cap" className="ptl-card-title">Capacity and placement</h3>
            {capacity.loading || placements.loading ? (
              <LoadingState label="Loading capacity and placement" />
            ) : (
              <div className="ptl-ulstat-row">
                <button type="button" className="ptl-ulstat" onClick={() => onNavigate?.('capacity')}>
                  <span className="ptl-ulstat-num">{liveCapacity.length}</span>
                  <span className="ptl-ulstat-label">live capacity submission{liveCapacity.length === 1 ? '' : 's'}</span>
                </button>
                <button type="button" className="ptl-ulstat" onClick={() => onNavigate?.('placements')}>
                  <span className="ptl-ulstat-num">{openRequests.length}</span>
                  <span className="ptl-ulstat-label">open placement request{openRequests.length === 1 ? '' : 's'}</span>
                </button>
              </div>
            )}
            <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>
          </section>

          {/* 3. Recent Messages: actual threads, not a promise */}
          <section className="ptl-card" aria-labelledby="ul-msg">
            <h3 id="ul-msg" className="ptl-card-title">Recent Messages</h3>
            {recent.loading ? (
              <LoadingState label="Loading recent messages" />
            ) : threads.length === 0 ? (
              <p className="ptl-muted">No messages yet. Conversations with the ASPIRE Team and your students appear here.</p>
            ) : (
              <ul className="ptl-list ptl-recent-list">
                {threads.map(c => (
                  <li key={c.id}>
                    <button type="button" className="ptl-recent-row" onClick={() => onOpenThread?.(c.id)}>
                      <span className="ptl-recent-text">
                        <span className="ptl-recent-context">
                          {c.direct_student_name ? ulDirectThreadLabel(c.direct_student_name) : UL_THREAD_ASPIRE_LABEL}
                        </span>
                        <span className="ptl-recent-subject">{c.subject}</span>
                      </span>
                      <span className="ptl-recent-meta">
                        {Number(c.unread_count) > 0 && (
                          <span className="ptl-nav-badge">{formatUnread(Number(c.unread_count))}</span>
                        )}
                        <time dateTime={c.last_message_at || undefined}>{formatInboxTimestamp(c.last_message_at)}</time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="ptl-btn" onClick={() => onNavigate?.('messages')}>
              Open Messages
            </button>
          </section>
        </div>

        <div className="ptl-col-5 ptl-home-col">
          {/* 4. Upcoming, 5. Active */}
          <BucketCard title="Upcoming students" bucket="upcoming" byBucket={byBucket} onNavigate={onNavigate} />
          <BucketCard title="Active rotations" bucket="active" byBucket={byBucket} onNavigate={onNavigate} />
        </div>
      </div>

      {dayOpen && (
        <UnitShiftDayDrawer
          ymd={dayOpen.ymd}
          shifts={dayOpen.shifts}
          onClose={() => setDayOpen(null)}
        />
      )}
    </>
  )
}

function BucketCard({ title, bucket, byBucket, onNavigate }) {
  const rows = byBucket(bucket)
  return (
    <section className="ptl-card" aria-labelledby={`ul-${bucket}`}>
      <h3 id={`ul-${bucket}`} className="ptl-card-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="ptl-muted">No {BUCKET_LABEL[bucket].toLowerCase()} students right now.</p>
      ) : (
        <>
          <ul className="ptl-list">
            {rows.slice(0, 5).map(s => (
              <li key={s.id}>{studentName(s)} <span className="ptl-muted">{orDash(s.unit_key)}</span></li>
            ))}
          </ul>
          {rows.length > 5 && (
            <button type="button" className="ptl-linklike" onClick={() => onNavigate?.('students')}>
              View all {rows.length}
            </button>
          )}
        </>
      )}
    </section>
  )
}

// ── Placement Requests ──────────────────────────────────────────────────────
function PlacementScreen({ unitKey }) {
  const { loading, error, data, loadedAt, refresh } = useEndpoint(s => getPlacementRequests(unitKey, s), [unitKey])
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
function CapacityScreen({ unitKey, unitKeys, acceptingCohort }) {
  const { loading, error, data, refresh } = useEndpoint(s => getCapacity(unitKey, s), [unitKey])
  const [form, setForm] = useState({ unit_key: '', period_label: '', shift: 'any', student_count: 0, notes: '' })
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)

  const rows = data?.submissions || []
  // Server-resolved, so the FIRST submission for a unit works. Falling back to an
  // existing row only helps a unit that has already submitted, which is exactly the
  // case that did not need help.
  const cohortId = acceptingCohort?.id || null

  const save = async (e) => {
    e.preventDefault()
    if (!cohortId) {
      setNotice({ tone: 'error', text: 'ASPIRE has not opened a cohort for submissions yet. Capacity can be submitted once one is open.' })
      return
    }
    setSaving(true)
    const res = await submitCapacity({
      unit_key: form.unit_key || (unitKey !== ALL_UNITS ? unitKey : unitKeys[0]),
      cohort_id: cohortId,
      period_label: form.period_label,
      shift: form.shift,
      student_count: Number(form.student_count),
      notes: form.notes,
    })
    setSaving(false)
    const summaryUnit = form.unit_key || (unitKey !== ALL_UNITS ? unitKey : unitKeys[0])
    setNotice(res.ok
      ? { tone: 'ok', text: `Capacity recorded for ${summaryUnit}: ${form.period_label}, ${form.shift} shift, ${Number(form.student_count)} student${Number(form.student_count) === 1 ? '' : 's'}. ASPIRE reviews it before it takes effect.` }
      : { tone: 'error', text: res.error === 'conflict' ? 'A live submission already exists for that period and shift.' : 'That submission could not be saved.' })
    if (res.ok) { refresh(); setForm(f => ({ ...f, period_label: '', student_count: 0, notes: '' })) }
  }

  if (loading) return <TableSkeleton label="Loading capacity" />
  if (error) return <ErrorState detail="Capacity could not be loaded." onRetry={refresh} />

  return (
    <>
      <SectionHeading focusKey="capacity">Capacity</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      <form className="ptl-card ptl-unit-form" onSubmit={save}>
        <h3 className="ptl-card-title">Submit capacity</h3>
        <p className="ptl-muted">
          Cohort: {acceptingCohort?.name ? acceptingCohort.name : EMPTY}
        </p>
        <div className="ptl-form-grid">
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="cap-unit">Unit</label>
            <select id="cap-unit" className="ptl-input ptl-input-full" value={form.unit_key || (unitKey !== ALL_UNITS ? unitKey : unitKeys[0])}
              onChange={e => setForm(f => ({ ...f, unit_key: e.target.value }))}>
              {unitKeys.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="cap-shift">Shift</label>
            <select id="cap-shift" className="ptl-input ptl-input-full" value={form.shift}
              onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}>
              {['any', 'day', 'evening', 'night', 'weekend'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="cap-period">Rotation period</label>
            <input id="cap-period" className="ptl-input ptl-input-full" required maxLength={120} value={form.period_label}
              onChange={e => setForm(f => ({ ...f, period_label: e.target.value }))} />
            <p className="ptl-field-help">For example, Fall 2026 first half.</p>
          </div>
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="cap-count">Number of students</label>
            <input id="cap-count" className="ptl-input ptl-input-full" type="number" min={0} max={99} required value={form.student_count}
              onChange={e => setForm(f => ({ ...f, student_count: e.target.value }))} />
            <p className="ptl-field-help">How many students this unit can host for the period and shift.</p>
          </div>
          <div className="ptl-field ptl-field-wide">
            <label className="ptl-label" htmlFor="cap-notes">Notes</label>
            <textarea id="cap-notes" className="ptl-input ptl-input-full" maxLength={2000} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="ptl-form-submit">
          <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>
          <button type="submit" className="ptl-btn" disabled={saving || !cohortId}>
            {saving ? 'Submitting' : 'Submit capacity'}
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No capacity submitted yet" detail="Your submissions and their ASPIRE review status appear here." />
      ) : (
        <div className="ptl-table-wrap">
          <table className="ptl-table">
            <caption className="ptl-visually-hidden">Capacity submissions and review status</caption>
            <thead>
              <tr><th scope="col">Unit</th><th scope="col">Period</th><th scope="col">Shift</th><th scope="col">Students</th><th scope="col">ASPIRE review</th><th scope="col">State</th></tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td data-label="Unit">{orDash(c.unit_key)}</td>
                  <td data-label="Period">{orDash(c.period_label)}</td>
                  <td data-label="Shift">{orDash(c.shift)}</td>
                  <td data-label="Students">{c.student_count}</td>
                  <td data-label="ASPIRE review"><Pill tone={c.awaiting_aspire_review ? 'warn' : 'ok'}>{c.awaiting_aspire_review ? 'Awaiting ASPIRE' : sentenceCase(c.review_status)}</Pill></td>
                  <td data-label="State">{c.is_live ? 'Live' : 'Superseded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── Students ────────────────────────────────────────────────────────────────

/** UL-POLISH P1: hours as a mini progress bar plus the exact numbers. */
function HoursCell({ hours }) {
  if (!hours || hours.required == null) return EMPTY
  const approved = hours.approved ?? 0
  const pct = hours.required > 0 ? Math.min(100, Math.round((approved / hours.required) * 100)) : 0
  return (
    <span className="ptl-hours-cell">
      <span className="ptl-mini-progress" role="img"
        aria-label={`${approved} of ${hours.required} required hours approved`}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="ptl-hours-text">{approved} of {hours.required}</span>
    </span>
  )
}

/**
 * The roster. ONE module, two mount points: embedded in Home, and standalone at
 * /portal/unit/students so that deep link keeps working after Students left the nav.
 * `heading` distinguishes them; everything else is identical, so the two can never drift.
 */
function StudentRoster({ students, refreshRoster, onNavigate, onOpenThread, heading = null }) {
  const photos = useUnitStudentPhotos(students)
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(null)          // duplicate-click protection
  const [openActions, setOpenActions] = useState(null)
  const [detailStudent, setDetailStudent] = useState(null)
  // The exact button that opened the drawer, so focus returns to the right ROW and
  // not merely to the top of the table.
  const detailTriggerRef = useRef(null)

  const openDetail = (student, triggerEl) => {
    detailTriggerRef.current = triggerEl || null
    setDetailStudent(student)
  }

  const rows = filter === 'all' ? students : students.filter(s => s.bucket === filter)

  const confirm = async (studentId, milestone) => {
    if (busy) return
    setBusy(`${studentId}:${milestone}`)
    const res = await confirmMilestone(studentId, milestone, '')
    setBusy(null)
    setNotice(res.ok
      ? { tone: 'ok', text: 'Milestone confirmed and recorded for ASPIRE.' }
      : { tone: 'error', text: res.error === 'conflict' ? 'That milestone is already confirmed.' : 'That could not be saved.' })
    if (res.ok) refreshRoster()
  }

  // ITEM 2: message a student directly. The endpoint re-verifies the active scope,
  // so this button is a convenience, never the authorization.
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
      // Open the created thread in Messages.
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

      <div className="ptl-card ptl-filterbar" role="group" aria-label="Filter students by stage">
        {['all', 'upcoming', 'active', 'completed'].map(f => (
          <button key={f} type="button"
            className={`ptl-filter-chip${filter === f ? ' ptl-filter-chip-active' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : BUCKET_LABEL[f]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No students in this view"
          detail="Students placed in your assigned units appear here, including those who completed within the last 90 days." />
      ) : (
        <ul className="ptl-stu-list" aria-label="Students in your assigned units">
          {rows.map(s => (
            <StudentRow
              key={s.id}
              student={s}
              photoUrl={photos.peek(s.id)}
              busy={busy}
              open={openActions === s.id}
              onToggleActions={() => setOpenActions(openActions === s.id ? null : s.id)}
              onOpen={openDetail}
              onConfirm={confirm}
              onMessage={messageStudent}
            />
          ))}
        </ul>
      )}

      {detailStudent && (
        <StudentDetailDrawer
          student={detailStudent}
          returnFocusRef={detailTriggerRef}
          onClose={() => setDetailStudent(null)}
        />
      )}
    </>
  )
}

/**
 * ITEM 4: student actions as a DISCLOSURE rather than a row of cramped buttons.
 *
 * Four milestone buttons plus Message side by side were unusable on a phone. A
 * single labelled toggle reveals a stacked, full-width menu instead. Every action
 * is preserved, each is a real button with a visible label, focus stays inside the
 * normal tab order, and the toggle reports its expanded state, so keyboard and
 * screen-reader users get the same affordance as pointer users.
 */
/**
 * Standalone Students view. Students is no longer a primary tab, but
 * /portal/unit/students remains a valid deep link and renders the same roster module
 * Home embeds, so a bookmark or an emailed link still works.
 */
function StudentsScreen(props) {
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
function StudentRow({ student: s, photoUrl, busy, open, onToggleActions, onOpen, onConfirm, onMessage }) {
  const rowRef = useRef(null)
  const stage = stageToken(s.bucket)
  const outstanding = s.onboarding?.outstanding || []
  return (
    <li className="ptl-stu-row">
      <button
        ref={rowRef}
        type="button"
        className="ptl-stu-rowbtn"
        aria-label={`Open details for ${studentName(s)}`}
        onClick={(e) => onOpen(s, e.currentTarget)}
      >
        <UnitStudentAvatar url={photoUrl} name={studentName(s)} size={44} />
        <span className="ptl-stu-idcol">
          <span className="ptl-stu-name">{studentName(s)}</span>
          <span className="ptl-stu-school">{orDash(s.school)}</span>
          <span className="ptl-stu-pill"
            style={{ background: stage.bg, color: stage.text, border: `1px solid ${stage.border}` }}>
            {BUCKET_LABEL[s.bucket] || EMPTY}
          </span>
        </span>
        <span className="ptl-stu-meta">
          <span><span className="ptl-stu-metak">Unit</span>{orDash(s.unit_key)}</span>
          <span><span className="ptl-stu-metak">Preceptor</span>{orDash(s.preceptor_name)}</span>
        </span>
        <span className="ptl-stu-hourscol"><HoursCell hours={s.hours} /></span>
        <span className="ptl-stu-onbcol">
          <Pill tone={s.onboarding?.state === 'ready' ? 'ok' : 'warn'}>
            {ONBOARDING_LABEL[s.onboarding?.state] || EMPTY}
          </Pill>
          {outstanding.length > 0 && (
            <span className="ptl-ochips">
              {outstanding.map(k => <span key={k} className="ptl-ochip">{OUTSTANDING_LABEL[k] || k}</span>)}
            </span>
          )}
        </span>
      </button>
      <StudentKebab
        student={s}
        busy={busy}
        open={open}
        onToggle={onToggleActions}
        onConfirm={onConfirm}
        onMessage={onMessage}
      />
    </li>
  )
}

/**
 * The row's overflow menu. One control in the Actions column, holding only the safe
 * Phase 1 actions: message the student, and confirm a milestone. No preceptor write
 * action appears here; those are gated to a later phase.
 */
function StudentKebab({ student, busy, open, onToggle, onConfirm, onMessage }) {
  const label = `Actions for ${studentName(student)}`
  return (
    <div className="ptl-stu-kebab">
      <button
        type="button"
        className="ptl-icon-btn ptl-stu-kebab-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="ptl-stu-menu" role="menu" aria-label={label}>
          <button
            type="button"
            role="menuitem"
            className="ptl-stu-menuitem"
            disabled={busy === `${student.id}:message`}
            onClick={() => onMessage(student)}
          >
            {busy === `${student.id}:message` ? 'Opening' : 'Message student'}
          </button>
          {MILESTONES.map(m => (
            <button
              key={m.key}
              type="button"
              role="menuitem"
              className="ptl-stu-menuitem"
              disabled={busy === `${student.id}:${m.key}`}
              onClick={() => onConfirm(student.id, m.key)}
            >
              {busy === `${student.id}:${m.key}` ? 'Saving' : `Confirm ${m.label.toLowerCase()}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Preceptor Assignments ───────────────────────────────────────────────────
function PreceptorScreen({ unitKey, students }) {
  const { loading, error, data, refresh } = useEndpoint(s => getNominations(unitKey, s), [unitKey])
  const [form, setForm] = useState({ student_id: '', proposed_name: '', note: '' })
  const [notice, setNotice] = useState(null)

  const nominate = async (e) => {
    e.preventDefault()
    const res = await nominatePreceptor({
      studentId: form.student_id,
      proposedName: form.proposed_name,
      note: form.note,
    })
    const nominee = students.find(s => s.id === form.student_id)
    setNotice(res.ok
      ? { tone: 'ok', text: `Nomination recorded: ${form.proposed_name} for ${studentName(nominee)}. ASPIRE confirms the preceptor.` }
      : { tone: 'error', text: res.error === 'conflict' ? 'A nomination is already open for that student.' : 'That nomination could not be saved.' })
    if (res.ok) { refresh(); setForm({ student_id: '', proposed_name: '', note: '' }) }
  }

  if (loading) return <TableSkeleton label="Loading preceptor assignments" />
  if (error) return <ErrorState detail="Preceptor assignments could not be loaded." onRetry={refresh} />

  const rows = data?.nominations || []
  return (
    <>
      <SectionHeading focusKey="preceptors">Preceptor Assignments</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}
      <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>

      <form className="ptl-card ptl-unit-form" onSubmit={nominate}>
        <h3 className="ptl-card-title">Nominate a preceptor</h3>
        <div className="ptl-form-grid">
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="nom-student">Student</label>
            <select id="nom-student" className="ptl-input ptl-input-full" required value={form.student_id}
              onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))}>
              <option value="">Select a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{studentName(s)}</option>)}
            </select>
          </div>
          <div className="ptl-field">
            <label className="ptl-label" htmlFor="nom-name">Proposed preceptor</label>
            <input id="nom-name" className="ptl-input ptl-input-full" required minLength={2} maxLength={120}
              value={form.proposed_name} onChange={e => setForm(f => ({ ...f, proposed_name: e.target.value }))} />
            <p className="ptl-field-help">The nurse you propose to precept this student.</p>
          </div>
          <div className="ptl-field ptl-field-wide">
            <label className="ptl-label" htmlFor="nom-note">Note</label>
            <textarea id="nom-note" className="ptl-input ptl-input-full" maxLength={2000} value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>
        </div>
        <div className="ptl-form-submit">
          <button type="submit" className="ptl-btn">Nominate</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No nominations yet" detail="Preceptor nominations and their ASPIRE confirmation status appear here." />
      ) : (
        <div className="ptl-table-wrap">
          <table className="ptl-table">
            <caption className="ptl-visually-hidden">Preceptor nominations</caption>
            <thead>
              <tr><th scope="col">Unit</th><th scope="col">Preceptor</th><th scope="col">Status</th></tr>
            </thead>
            <tbody>
              {rows.map(n => (
                <tr key={n.id}>
                  <td data-label="Unit">{orDash(n.unit_key)}</td>
                  <td data-label="Preceptor">{orDash(n.preceptor_name)}</td>
                  <td data-label="Status"><Pill tone={n.awaiting_aspire_confirmation ? 'warn' : 'ok'}>
                    {n.awaiting_aspire_confirmation ? 'Awaiting ASPIRE' : sentenceCase(n.status)}
                  </Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
