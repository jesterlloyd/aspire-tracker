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

import { useCallback, useEffect, useMemo, useState } from 'react'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
import { useAuth } from '../contexts/AuthContext'
import {
  UnitLeaderNav, UnitSwitcher, LoadingState, EmptyState, ErrorState, DeniedState,
  SectionHeading, Pill,
} from './unit/UnitLeaderChrome'
import {
  ALL_UNITS, EMPTY, orDash, studentName, BUCKET_LABEL, ONBOARDING_LABEL,
  OUTSTANDING_LABEL, ASPIRE_AUTHORITY_NOTE,
  getRoster, getPlacementRequests, respondToPlacement,
  getCapacity, submitCapacity, getNominations, nominatePreceptor,
  confirmMilestone, startUnitConversation,
} from './unit/unitLeaderApi'

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
  const [state, setState] = useState({ error: null, data: null, resolved: -1 })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    let live = true
    loader(ac.signal).then(res => {
      if (!live || res.error === 'aborted') return
      setState(res.ok
        ? { error: null, data: res.data, resolved: nonce }
        : { error: res, data: null, resolved: nonce })
    })
    return () => { live = false; ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return {
    loading: state.resolved !== nonce,
    error: state.error,
    data: state.data,
    refresh: () => setNonce(n => n + 1),
  }
}

export default function UnitLeaderPortal({ view = 'home', onNavigate, unread = 0, threadId, onSelectThread, onBackToList }) {
  const { userProfile } = useAuth()
  const [unitKey, setUnitKey] = useState(ALL_UNITS)

  const roster = useEndpoint(getRoster, [])
  const units = useMemo(() => roster.data?.units || [], [roster.data])
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

  const shared = { unitKey, unitKeys, students, byBucket, refreshRoster: roster.refresh }

  return (
    <>
      <UnitLeaderNav view={view} unread={unread} onNavigate={onNavigate} />
      <div className="ptl-page ptl-unit-page">
        <UnitSwitcher unitKeys={unitKeys} value={unitKey} onChange={setUnitKey} />

        {view === 'home'       && <HomeScreen {...shared} onNavigate={onNavigate} />}
        {view === 'placements' && <PlacementScreen {...shared} />}
        {view === 'capacity'   && <CapacityScreen {...shared} />}
        {view === 'students'   && <StudentsScreen {...shared} />}
        {view === 'preceptors' && <PreceptorScreen {...shared} />}
        {view === 'concern'    && <ConcernScreen {...shared} />}
        {view === 'profile'    && <ProfileScreen unitKeys={unitKeys} profile={userProfile} />}
        {view === 'messages'   && (
          <PortalMessagesWorkspace
            active
            threadId={threadId}
            onSelectThread={onSelectThread}
            onBackToList={onBackToList}
          />
        )}
      </div>
    </>
  )
}

// ── Home: the locked priority order ─────────────────────────────────────────
function HomeScreen({ unitKey, students, byBucket, onNavigate }) {
  const placements = useEndpoint(s => getPlacementRequests(unitKey, s), [unitKey])
  const capacity = useEndpoint(s => getCapacity(unitKey, s), [unitKey])

  const openRequests = (placements.data?.requests || []).filter(r => r.aspire_status === 'open')
  const awaitingResponse = openRequests.filter(r => r.unit_response === 'pending')
  const needsAttention = students.filter(s => s.support?.open_count > 0)
  const liveCapacity = (capacity.data?.submissions || []).filter(c => c.is_live)

  return (
    <>
      <SectionHeading focusKey="home">Home</SectionHeading>

      {/* 1. Needs your attention */}
      <section className="ptl-card" aria-labelledby="ul-attention">
        <h3 id="ul-attention" className="ptl-card-title">Needs your attention</h3>
        {needsAttention.length === 0 && awaitingResponse.length === 0 ? (
          <p className="ptl-muted">Nothing needs your attention right now.</p>
        ) : (
          <ul className="ptl-list">
            {awaitingResponse.length > 0 && (
              <li>
                <button type="button" className="ptl-linklike" onClick={() => onNavigate?.('placements')}>
                  {awaitingResponse.length} placement request
                  {awaitingResponse.length === 1 ? '' : 's'} awaiting your response
                </button>
              </li>
            )}
            {needsAttention.map(s => (
              <li key={s.id}>
                {studentName(s)} raised a support note in the last {s.support.window_days} days
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Upcoming, 3. Active */}
      <BucketCard title="Upcoming students" bucket="upcoming" byBucket={byBucket} onNavigate={onNavigate} />
      <BucketCard title="Active rotations" bucket="active" byBucket={byBucket} onNavigate={onNavigate} />

      {/* 4. Capacity and placement */}
      <section className="ptl-card" aria-labelledby="ul-cap">
        <h3 id="ul-cap" className="ptl-card-title">Capacity and placement</h3>
        {capacity.loading || placements.loading ? (
          <LoadingState label="Loading capacity and placement" />
        ) : (
          <ul className="ptl-list">
            <li>{liveCapacity.length} live capacity submission{liveCapacity.length === 1 ? '' : 's'}</li>
            <li>{openRequests.length} open placement request{openRequests.length === 1 ? '' : 's'}</li>
          </ul>
        )}
        <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>
      </section>

      {/* 5. Recent Messages */}
      <section className="ptl-card" aria-labelledby="ul-msg">
        <h3 id="ul-msg" className="ptl-card-title">Recent ASPIRE Messages</h3>
        <button type="button" className="ptl-btn" onClick={() => onNavigate?.('messages')}>
          Open Messages
        </button>
      </section>
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
  const { loading, error, data, refresh } = useEndpoint(s => getPlacementRequests(unitKey, s), [unitKey])
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)

  const act = async (id, response) => {
    const comment = response === 'changes_requested'
      ? window.prompt('What should change? A comment is required when requesting changes.') || ''
      : ''
    if (response === 'changes_requested' && !comment.trim()) {
      setNotice({ tone: 'error', text: 'A comment is required when requesting changes.' })
      return
    }
    setBusy(id)
    const res = await respondToPlacement(id, response, comment)
    setBusy(null)
    setNotice(res.ok
      ? { tone: 'ok', text: 'Your response was recorded. ASPIRE confirms the final placement.' }
      : { tone: 'error', text: res.error === 'conflict' ? 'ASPIRE has already decided this request.' : 'That response could not be saved.' })
    if (res.ok) refresh()
  }

  if (loading) return <LoadingState label="Loading placement requests" />
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
                <tr key={r.id}>
                  <td data-label="Unit">{orDash(r.unit_key)}</td>
                  <td data-label="Your response"><Pill tone={r.unit_response === 'pending' ? 'warn' : 'neutral'}>{r.unit_response.replace(/_/g, ' ')}</Pill></td>
                  <td data-label="ASPIRE status"><Pill tone={r.awaiting_aspire_confirmation ? 'warn' : 'ok'}>{r.awaiting_aspire_confirmation ? 'Awaiting ASPIRE' : r.aspire_status}</Pill></td>
                  <td data-label="Due">{orDash(r.due_at ? new Date(r.due_at).toLocaleDateString() : null)}</td>
                  <td data-label="Actions">
                    {r.aspire_status === 'open' ? (
                      <div className="ptl-actions">
                        <button type="button" className="ptl-btn" disabled={busy === r.id} onClick={() => act(r.id, 'accepted')}>Accept</button>
                        <button type="button" className="ptl-btn" disabled={busy === r.id} onClick={() => act(r.id, 'declined')}>Decline</button>
                        <button type="button" className="ptl-btn" disabled={busy === r.id} onClick={() => act(r.id, 'changes_requested')}>Request changes</button>
                      </div>
                    ) : <span className="ptl-muted">{EMPTY}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── Capacity ────────────────────────────────────────────────────────────────
function CapacityScreen({ unitKey, unitKeys }) {
  const { loading, error, data, refresh } = useEndpoint(s => getCapacity(unitKey, s), [unitKey])
  const [form, setForm] = useState({ unit_key: '', period_label: '', shift: 'any', student_count: 0, notes: '' })
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)

  const rows = data?.submissions || []
  const cohortId = rows[0]?.cohort_id || null

  const save = async (e) => {
    e.preventDefault()
    if (!cohortId) {
      setNotice({ tone: 'error', text: 'A cohort is not available yet, so capacity cannot be submitted.' })
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
    setNotice(res.ok
      ? { tone: 'ok', text: 'Capacity submitted. ASPIRE reviews it before it takes effect.' }
      : { tone: 'error', text: res.error === 'conflict' ? 'A live submission already exists for that period and shift.' : 'That submission could not be saved.' })
    if (res.ok) { refresh(); setForm(f => ({ ...f, period_label: '', student_count: 0, notes: '' })) }
  }

  if (loading) return <LoadingState label="Loading capacity" />
  if (error) return <ErrorState detail="Capacity could not be loaded." onRetry={refresh} />

  return (
    <>
      <SectionHeading focusKey="capacity">Capacity</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      <form className="ptl-card" onSubmit={save}>
        <h3 className="ptl-card-title">Submit capacity</h3>
        <label className="ptl-label" htmlFor="cap-unit">Unit</label>
        <select id="cap-unit" className="ptl-input" value={form.unit_key || (unitKey !== ALL_UNITS ? unitKey : unitKeys[0])}
          onChange={e => setForm(f => ({ ...f, unit_key: e.target.value }))}>
          {unitKeys.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        <label className="ptl-label" htmlFor="cap-period">Rotation period</label>
        <input id="cap-period" className="ptl-input" required maxLength={120} value={form.period_label}
          onChange={e => setForm(f => ({ ...f, period_label: e.target.value }))} />

        <label className="ptl-label" htmlFor="cap-shift">Shift</label>
        <select id="cap-shift" className="ptl-input" value={form.shift}
          onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}>
          {['any', 'day', 'evening', 'night', 'weekend'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className="ptl-label" htmlFor="cap-count">Number of students</label>
        <input id="cap-count" className="ptl-input" type="number" min={0} max={99} required value={form.student_count}
          onChange={e => setForm(f => ({ ...f, student_count: e.target.value }))} />

        <label className="ptl-label" htmlFor="cap-notes">Notes</label>
        <textarea id="cap-notes" className="ptl-input" maxLength={2000} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

        <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>
        <button type="submit" className="ptl-btn" disabled={saving}>{saving ? 'Submitting' : 'Submit capacity'}</button>
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
                  <td data-label="ASPIRE review"><Pill tone={c.awaiting_aspire_review ? 'warn' : 'ok'}>{c.awaiting_aspire_review ? 'Awaiting ASPIRE' : c.review_status}</Pill></td>
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
function StudentsScreen({ students, refreshRoster }) {
  const [filter, setFilter] = useState('all')
  const [notice, setNotice] = useState(null)

  const rows = filter === 'all' ? students : students.filter(s => s.bucket === filter)

  const confirm = async (studentId, milestone) => {
    const res = await confirmMilestone(studentId, milestone, '')
    setNotice(res.ok
      ? { tone: 'ok', text: 'Milestone confirmed and recorded for ASPIRE.' }
      : { tone: 'error', text: res.error === 'conflict' ? 'That milestone is already confirmed.' : 'That could not be saved.' })
    if (res.ok) refreshRoster()
  }

  return (
    <>
      <SectionHeading focusKey="students">Students</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}

      <div className="ptl-card ptl-filterbar" role="group" aria-label="Filter students by stage">
        {['all', 'upcoming', 'active', 'completed'].map(f => (
          <button key={f} type="button"
            className={`ptl-chip${filter === f ? ' ptl-chip-active' : ''}`}
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
        <div className="ptl-table-wrap">
          <table className="ptl-table">
            <caption className="ptl-visually-hidden">Students in your assigned units</caption>
            <thead>
              <tr>
                <th scope="col">Student</th><th scope="col">Unit</th><th scope="col">School</th>
                <th scope="col">Stage</th><th scope="col">Preceptor</th><th scope="col">Hours</th>
                <th scope="col">Onboarding</th><th scope="col">Milestones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id}>
                  <td data-label="Student">{studentName(s)}</td>
                  <td data-label="Unit">{orDash(s.unit_key)}</td>
                  <td data-label="School">{orDash(s.school)}</td>
                  <td data-label="Stage"><Pill>{BUCKET_LABEL[s.bucket] || EMPTY}</Pill></td>
                  <td data-label="Preceptor">{orDash(s.preceptor_name)}</td>
                  <td data-label="Hours">{s.hours ? `${s.hours.approved ?? 0}/${orDash(s.hours.required)}` : EMPTY}</td>
                  <td data-label="Onboarding">
                    <Pill tone={s.onboarding?.state === 'ready' ? 'ok' : 'warn'}>
                      {ONBOARDING_LABEL[s.onboarding?.state] || EMPTY}
                    </Pill>
                    {s.onboarding?.outstanding?.length > 0 && (
                      <span className="ptl-muted"> {s.onboarding.outstanding.map(k => OUTSTANDING_LABEL[k] || k).join(', ')}</span>
                    )}
                  </td>
                  <td data-label="Milestones">
                    <div className="ptl-actions">
                      {MILESTONES.map(m => (
                        <button key={m.key} type="button" className="ptl-btn ptl-btn-small"
                          onClick={() => confirm(s.id, m.key)}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
    setNotice(res.ok
      ? { tone: 'ok', text: 'Nomination recorded. ASPIRE confirms the preceptor.' }
      : { tone: 'error', text: res.error === 'conflict' ? 'A nomination is already open for that student.' : 'That nomination could not be saved.' })
    if (res.ok) { refresh(); setForm({ student_id: '', proposed_name: '', note: '' }) }
  }

  if (loading) return <LoadingState label="Loading preceptor assignments" />
  if (error) return <ErrorState detail="Preceptor assignments could not be loaded." onRetry={refresh} />

  const rows = data?.nominations || []
  return (
    <>
      <SectionHeading focusKey="preceptors">Preceptor Assignments</SectionHeading>
      {notice && <p className={`ptl-notice ptl-notice-${notice.tone}`} role="status">{notice.text}</p>}
      <p className="ptl-muted">{ASPIRE_AUTHORITY_NOTE}</p>

      <form className="ptl-card" onSubmit={nominate}>
        <h3 className="ptl-card-title">Nominate a preceptor</h3>
        <label className="ptl-label" htmlFor="nom-student">Student</label>
        <select id="nom-student" className="ptl-input" required value={form.student_id}
          onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))}>
          <option value="">Select a student</option>
          {students.map(s => <option key={s.id} value={s.id}>{studentName(s)}</option>)}
        </select>

        <label className="ptl-label" htmlFor="nom-name">Proposed preceptor</label>
        <input id="nom-name" className="ptl-input" required minLength={2} maxLength={120}
          value={form.proposed_name} onChange={e => setForm(f => ({ ...f, proposed_name: e.target.value }))} />

        <label className="ptl-label" htmlFor="nom-note">Note</label>
        <textarea id="nom-note" className="ptl-input" maxLength={2000} value={form.note}
          onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />

        <button type="submit" className="ptl-btn">Nominate</button>
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
                    {n.awaiting_aspire_confirmation ? 'Awaiting ASPIRE' : n.status}
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

      <form className="ptl-card" onSubmit={send}>
        <label className="ptl-label" htmlFor="con-student">Student</label>
        <select id="con-student" className="ptl-input" required value={studentId}
          onChange={e => pick(e.target.value)}>
          <option value="">Select a student</option>
          {students.map(s => <option key={s.id} value={s.id}>{studentName(s)} ({s.unit_key})</option>)}
        </select>

        <label className="ptl-label" htmlFor="con-subject">Subject</label>
        <input id="con-subject" className="ptl-input" required minLength={3} maxLength={120}
          value={subject} onChange={e => setSubject(e.target.value)} />

        <label className="ptl-label" htmlFor="con-body">Message</label>
        <textarea id="con-body" className="ptl-input" required minLength={1} maxLength={5000} rows={8}
          value={body} onChange={e => setBody(e.target.value)} />

        <button type="submit" className="ptl-btn" disabled={sending || !student}>
          {sending ? 'Sending' : 'Send to ASPIRE'}
        </button>
      </form>
    </>
  )
}

// ── Profile and unit context ────────────────────────────────────────────────
function ProfileScreen({ unitKeys, profile }) {
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
    </>
  )
}
