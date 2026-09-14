// RESIDENCY-SUPPORT-1: the Support tab, before and during residency.
//
// Owner decisions, 2026-09-11. Before residency: Résumé Review, Town Hall,
// Interview Bootcamp, Placement Advising. During residency: Mentorship
// Sessions with the resident's assigned NPD-P and, since RESIDENCY-REFLECTION-1
// (Owner, 2026-09-13), the bi-weekly Clinical Orientation Progress and
// Reflection Tool, started here with a button and sent to each resident by
// personal link. It REPLACED the weekly email check-in this tab used to count.
// Only the ASPIRE team records support; Talent Acquisition sees it read-only.
// Taking part is always optional and never affects eligibility.
//
// Every number derives from the same roster rows the Profiles tab renders and
// the recorded entries (src/lib/ngrp/ngrpSupportView.js). A wrong entry is
// voided, never deleted.
import { Fragment, useMemo, useState } from 'react'
import { Plus, Eye } from 'lucide-react'
import { KPICell } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
// RESIDENCY-REFLECTION-1: the same drawer Profiles & Interest uses to preview
// the Transition Form email, rendering the same builder the send uses.
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { NGRP_REFLECTION_PREVIEW } from '../../lib/ngrp/reflectionPreviewFixture'
import { useNgrpApplicants, useNgrpSupport, postNgrpSupport } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows } from '../../lib/ngrp/ngrpStates'
import { activitiesFor, supportActivity } from '../../lib/ngrp/ngrpSupportActivities'
import { beforeResidency, duringResidency } from '../../lib/ngrp/ngrpSupportView'
import { DIFFICULTY_AREAS } from '../../lib/ngrp/ngrpReflectionForm'
import { displayName } from '../../lib/utils'
import { F, btn } from '../../lib/ngrp/ngrpCohortForm'

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const fmtDay = d => {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const field = {
  width: '100%', boxSizing: 'border-box', height: 34, padding: '0 10px',
  borderRadius: 'var(--aspire-radius-control)', border: '1px solid rgba(29,37,103,0.18)',
  fontFamily: F, fontSize: 13, background: '#fff',
}
const label = { display: 'block', fontSize: 11.5, fontWeight: 600, color: '#4A5560', margin: '0 0 4px', fontFamily: F }
const ERRORS = {
  already_recorded: 'That activity is already recorded for this alumnus on that date.',
  aspire_team_only: 'Only the ASPIRE team records support.',
  candidate_not_found: 'That alumnus is not in this residency cohort.',
  entry_not_found: 'That entry was already voided.',
}
const errorText = res => (res.errors || []).map(e => e.message).join(' ') || ERRORS[res.error] || 'It could not be saved.'

function Name({ row, sub }) {
  return (
    <div className="ngrp-glance-person">
      <StudentAvatar student={row.student} size={28} />
      <div className="ov-unit-info">
        <span className="ov-unit-name">
          {displayName(row.student)}
          {row.student?.aspire_cohort && <span className="ngrp-glance-cohort">{row.student.aspire_cohort}</span>}
        </span>
        {sub && <span className="ngrp-glance-muted">{sub}</span>}
      </div>
    </div>
  )
}

// ── Recording (the ASPIRE team) ──────────────────────────────────────────────
function RecordForm({ cycle, rows, today, phase, preset, onDone, toast }) {
  const acts = activitiesFor(phase)
  const [activity, setActivity] = useState(preset?.activity || acts[0].key)
  const [occurredOn, setOccurredOn] = useState(today || '')
  const [single, setSingle] = useState(preset?.candidateId || '')
  const [group, setGroup] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [mentorName, setMentorName] = useState(preset?.mentorName || '')
  const [busy, setBusy] = useState(false)
  const isGroup = supportActivity(activity)?.mode === 'group'
  const choices = rows.filter(r => r.candidate_id)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const base = { activity, occurred_on: occurredOn, note: note.trim() || null }
    const res = isGroup
      ? await postNgrpSupport('record_attendance', { ...base, cycle_id: cycle.id, candidate_ids: [...group] })
      : await postNgrpSupport('record', { ...base, candidate_id: single, mentor_name: mentorName.trim() || null })
    setBusy(false)
    if (!res.ok) { toast?.error?.('Not saved', errorText(res)); return }
    const what = supportActivity(activity).label
    toast?.success?.('Support recorded', isGroup
      ? `${what}: ${plural(res.created, 'alumnus', 'alumni')} recorded${res.alreadyRecorded ? `, ${res.alreadyRecorded} already on record` : ''}.`
      : `${what} is on record.`)
    onDone()
  }

  return (
    <form className="snap ngrp-glance-panel" onSubmit={submit} style={{ padding: '16px 18px' }} aria-label="Record support">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ margin: 0 }}>
          <span style={label}>Activity</span>
          <select style={field} value={activity} onChange={e => setActivity(e.target.value)} disabled={Boolean(preset?.activity)}>
            {acts.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>
          <span style={label}>Date</span>
          <input style={field} type="date" value={occurredOn} max={today || undefined} onChange={e => setOccurredOn(e.target.value)} required />
        </label>
        {!isGroup && (
          <label style={{ margin: 0 }}>
            <span style={label}>{phase === 'during' ? 'Resident' : 'Alumnus'}</span>
            <select style={field} value={single} onChange={e => setSingle(e.target.value)} required disabled={Boolean(preset?.candidateId)}>
              <option value="">Choose…</option>
              {choices.map(r => <option key={r.candidate_id} value={r.candidate_id}>{displayName(r.student)}</option>)}
            </select>
          </label>
        )}
        {activity === 'mentorship_session' && (
          <label style={{ margin: 0 }}>
            <span style={label}>Mentor</span>
            <input style={field} value={mentorName} maxLength={120} onChange={e => setMentorName(e.target.value)} placeholder="Who led the session" />
          </label>
        )}
      </div>
      {isGroup && (
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend style={label}>Who attended ({group.size} selected)</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 12px', maxHeight: 220, overflowY: 'auto' }}>
            {choices.map(r => (
              <label key={r.candidate_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontFamily: F, cursor: 'pointer' }}>
                <input type="checkbox" checked={group.has(r.candidate_id)} onChange={() => setGroup(prev => {
                  const next = new Set(prev)
                  if (next.has(r.candidate_id)) next.delete(r.candidate_id); else next.add(r.candidate_id)
                  return next
                })} />
                {displayName(r.student)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label style={{ display: 'block', margin: '0 0 12px' }}>
        <span style={label}>Note (optional)</span>
        <input style={field} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Anything worth remembering" />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={btn()} onClick={onDone}>Cancel</button>
        <button type="submit" style={btn(true)} disabled={busy || !occurredOn || (isGroup ? group.size === 0 : !single)}>
          {busy ? 'Saving…' : 'Record Support'}
        </button>
      </div>
    </form>
  )
}

function RecentEntries({ entries, rows, canRecord, onChanged, toast }) {
  const [open, setOpen] = useState(false)
  const nameOf = useMemo(() => new Map(rows.map(r => [r.candidate_id, displayName(r.student)])), [rows])
  if (entries.length === 0) return null
  const voidEntry = async (entry) => {
    const res = await postNgrpSupport('void', { entry_id: entry.id })
    if (!res.ok) { toast?.error?.('Not voided', errorText(res)); return }
    toast?.success?.('Entry voided', 'It no longer counts. The record of it is kept.')
    onChanged()
  }
  return (
    <section className="snap ngrp-glance-panel">
      <div className="aggregate-panel-hdr">
        <div>
          <div className="ov-panel-title">Recent Entries</div>
          <div className="ov-panel-sub">{plural(entries.length, 'entry', 'entries')} on record</div>
        </div>
        <div className="ov-expand-toggle"><button type="button" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button></div>
      </div>
      {open && (
        <div className="ngrp-glance-scroll">
          <table className="ngrp-glance-table">
            <thead>
              <tr>
                <th className="aspire-th">Date</th>
                <th className="aspire-th">Alumnus</th>
                <th className="aspire-th">Activity</th>
                <th className="aspire-th">Note</th>
                {canRecord && <th className="aspire-th aspire-th-right"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 50).map(e => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.occurred_on)}</td>
                  <td>{nameOf.get(e.candidate_id) || ''}</td>
                  <td>{supportActivity(e.activity)?.label}{e.mentor_name ? ` · ${e.mentor_name}` : ''}</td>
                  <td className="ngrp-glance-muted">{e.note || ''}</td>
                  {canRecord && (
                    <td className="num">
                      <button type="button" className="ngrp-linkbtn" onClick={() => voidEntry(e)}>Void</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Before residency ─────────────────────────────────────────────────────────
function BeforePanel({ cycle, rows, support, toast }) {
  const [recording, setRecording] = useState(false)
  const view = useMemo(() => beforeResidency(rows, support.entries), [rows, support.entries])
  const entries = support.entries.filter(e => supportActivity(e.activity)?.phase === 'before')
  return (
    <>
      <section className="snap" aria-label="Support before residency snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="ov-panel-title">Support Before Residency</span>
          <span className="snap-sub">{cycle.name} · optional, never affects eligibility</span>
        </div>
        <div className="glance-kpis snap-kpis">
          <KPICell value={view.kpis.supported} label="Alumni Supported" sub={`of ${plural(view.kpis.alumni, 'alumnus', 'alumni')}`} accent="sage" />
          {view.activities.map(a => <KPICell key={a.key} value={view.kpis[a.key]} label={a.label} sub="Alumni reached" />)}
        </div>
      </section>

      {recording && (
        <RecordForm cycle={cycle} rows={rows} today={support.today} phase="before" toast={toast}
          onDone={() => { setRecording(false); support.refetch() }} />
      )}

      <section className="snap ngrp-glance-panel" aria-label="Support by alumnus">
        <div className="aggregate-panel-hdr">
          <div>
            <div className="ov-panel-title">By Alumnus</div>
            <div className="ov-panel-sub">Most recent date for each activity</div>
          </div>
          {support.canRecord && !recording && (
            <button type="button" style={btn(true)} onClick={() => setRecording(true)}>
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" /> Record Support
            </button>
          )}
        </div>
        {view.rows.length === 0 ? (
          <p className="ngrp-glance-empty">No alumni in this residency cohort yet.</p>
        ) : (
          <div className="ngrp-glance-scroll">
            <table className="ngrp-glance-table">
              <thead>
                <tr>
                  <th className="aspire-th">Alumnus</th>
                  {view.activities.map(a => <th key={a.key} className="aspire-th aspire-th-center">{a.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {view.rows.map(({ row, cells }) => (
                  <tr key={row.id}>
                    <td><Name row={row} /></td>
                    {view.activities.map(a => (
                      <td key={a.key} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {cells[a.key].count > 0
                          ? <>{fmtDay(cells[a.key].last)}{cells[a.key].count > 1 && <span className="ngrp-glance-muted"> ×{cells[a.key].count}</span>}</>
                          : <span className="ngrp-glance-muted">Not yet</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RecentEntries entries={entries} rows={rows} canRecord={support.canRecord} onChanged={support.refetch} toast={toast} />
    </>
  )
}

// ── During residency ─────────────────────────────────────────────────────────
function MentorCell({ resident, canRecord, onSaved, toast }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(resident.mentor?.mentor_name || '')
  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {resident.mentor?.mentor_name || <span className="ngrp-glance-muted">Not assigned</span>}
        {canRecord && (
          <button type="button" className="ngrp-linkbtn" onClick={() => setEditing(true)}>
            {resident.mentor ? 'Change' : 'Assign'}
          </button>
        )}
      </span>
    )
  }
  const save = async () => {
    const res = await postNgrpSupport('set_mentor', { candidate_id: resident.row.candidate_id, mentor_name: name.trim() })
    if (!res.ok) { toast?.error?.('Not saved', errorText(res)); return }
    toast?.success?.('Mentor assigned', `${name.trim()} is mentoring ${displayName(resident.row.student)}.`)
    setEditing(false)
    onSaved()
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input style={{ ...field, height: 28, width: 170 }} value={name} maxLength={120} autoFocus
        onChange={e => setName(e.target.value)} placeholder="NPD-P name" aria-label="Mentor name" />
      <button type="button" style={btn(true)} disabled={!name.trim()} onClick={save}>Save</button>
      <button type="button" className="ngrp-linkbtn" onClick={() => setEditing(false)}>Cancel</button>
    </span>
  )
}

// ── RESIDENCY-REFLECTION-1: the bi-weekly reflection, per resident ──────────
const REFLECTION_ERRORS = {
  already_started: 'Reflections were already started for this resident.',
  not_a_resident: 'Only a hired, current resident can be started.',
  run_ended: 'This run has ended, so it cannot be started again.',
  run_not_found: 'No reflections have been started for this resident.',
  aspire_team_only: 'Only the ASPIRE team can do that.',
}
const reflectionError = res => REFLECTION_ERRORS[res.error] || errorText(res)

// What the resident has done so far, in one cell.
function ReflectionCell({ resident }) {
  const r = resident.reflection
  if (!r.started) return <span className="ngrp-glance-muted">Not started</span>
  const next = r.next
  const line = r.stopped ? 'Stopped'
    : r.done ? 'Complete'
    : next ? (next.sent_at ? `Period ${next.period_number} due ${fmtDay(next.due_on)}` : `Period ${next.period_number} goes out ${fmtDay(next.send_on)}`)
    : ''
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span>{r.submitted} of {r.total} submitted</span>
      {line && <span className="ngrp-glance-muted">{line}</span>}
      {r.overdue > 0 && <span className="ngrp-glance-pill ngrp-glance-pill-due">{plural(r.overdue, 'period')} overdue</span>}
    </span>
  )
}

// A submitted reflection, read-only, section for section as the tool lays it out.
function SubmissionView({ payload }) {
  const p = payload || {}
  const head = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6B7785', margin: '12px 0 4px', fontFamily: F }
  const txt = (label, v) => (v ? (
    <div key={label} style={{ fontSize: 12.5, margin: '0 0 5px', fontFamily: F }}>
      <span style={{ color: '#6B7785' }}>{label}: </span><span style={{ whiteSpace: 'pre-wrap' }}>{v}</span>
    </div>
  ) : null)
  const areaLabel = k => DIFFICULTY_AREAS.find(a => a.key === k)?.label || k
  return (
    <div style={{ padding: '6px 0 2px' }}>
      {p.about && (<><div style={head}>About</div>
        {txt('Unit', p.about.unit)}{txt('Preceptor(s)', p.about.preceptor_names)}{txt('Schedule', p.about.work_schedule)}{txt('Questions', p.about.questions)}</>)}
      <div style={head}>Shifts</div>
      {(p.shifts || []).length === 0 && <div className="ngrp-glance-muted" style={{ fontSize: 12.5 }}>None recorded</div>}
      {(p.shifts || []).map((s, i) => (
        <div key={i} style={{ borderLeft: '3px solid #EDEEF4', padding: '2px 0 2px 10px', margin: '0 0 8px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: F }}>
            Shift {i + 1}{s.date ? ` · ${fmtDay(s.date)}` : ''}{s.patients != null ? ` · ${s.patients} pts` : ''}{s.tsam_tier ? ` · TSAM Tier ${s.tsam_tier}` : ''}
          </div>
          {txt('Diagnoses', s.diagnoses)}{txt('Went well', s.went_well)}{txt('Improve', s.improve)}
        </div>
      ))}
      {(p.skills?.communication || p.skills?.technical) && (<><div style={head}>Skills</div>
        {txt('Communication', p.skills.communication)}{txt('Technical', p.skills.technical)}</>)}
      {(p.goals || []).length > 0 && (<><div style={head}>Goals</div>
        {p.goals.map((g, i) => txt(`Goal ${i + 1}${g.met ? ` (${g.met === 'met' ? 'met' : 'not met'}${g.carry_forward ? ', carried forward' : ''})` : ''}`, g.text))}</>)}
      {(p.development?.ana_standards || p.development?.caritas) && (<><div style={head}>Development</div>
        {txt('ANA Standards', p.development.ana_standards)}{txt('Caritas Processes', p.development.caritas)}</>)}
      <div style={head}>Finding it hard</div>
      {(p.difficulty_areas || []).length
        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{p.difficulty_areas.map(k => <span key={k} className="ngrp-glance-pill ngrp-glance-pill-due">{areaLabel(k)}</span>)}</div>
        : <div className="ngrp-glance-muted" style={{ fontSize: 12.5 }}>Nothing flagged</div>}
      {(p.workshops || p.support_needed || p.competencies_on_track != null) && (<><div style={head}>Anything else</div>
        {txt('Workshops', p.workshops)}{txt('Support needed', p.support_needed)}
        {p.competencies_on_track != null && txt('Competencies / Kahuna on track', p.competencies_on_track ? 'Yes' : 'No')}</>)}
    </div>
  )
}

// One resident's periods, with any submitted one openable.
function ReflectionsPanel({ resident, canRecord, onChanged, toast, onClose }) {
  const [openId, setOpenId] = useState(null)
  const [loaded, setLoaded] = useState({})
  const [busy, setBusy] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const r = resident.reflection
  const open = async (period) => {
    if (openId === period.id) { setOpenId(null); return }
    setOpenId(period.id)
    if (loaded[period.id]) return
    const res = await postNgrpSupport('reflection_view', { period_id: period.id })
    setLoaded(m => ({ ...m, [period.id]: res.ok ? (res.submission || null) : { error: reflectionError(res) } }))
  }
  const stop = async () => {
    setBusy(true)
    const res = await postNgrpSupport('reflection_stop', { candidate_id: resident.row.candidate_id })
    setBusy(false)
    if (!res.ok) { toast?.error?.('Not stopped', reflectionError(res)); return }
    toast?.success?.('Reflections stopped', `${displayName(resident.row.student)} will receive no further periods. Submitted reflections are kept.`)
    setConfirmStop(false)
    onChanged()
  }
  return (
    <section className="snap ngrp-glance-panel" aria-label={`Reflections for ${displayName(resident.row.student)}`}>
      <div className="aggregate-panel-hdr">
        <div>
          <div className="ov-panel-title">Reflections · {displayName(resident.row.student)}</div>
          <div className="ov-panel-sub">
            {r.submitted} of {r.total} submitted{r.stopped ? ' · stopped' : r.done ? ' · complete' : ''}
            {resident.run?.started_on ? ` · started ${fmtDay(resident.run.started_on)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {canRecord && !r.stopped && !r.done && (confirmStop ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: F }}>
              Stop sending periods? <button type="button" style={btn(true)} disabled={busy} onClick={stop}>{busy ? 'Stopping…' : 'Yes, stop'}</button>
              <button type="button" className="ngrp-linkbtn" onClick={() => setConfirmStop(false)}>No</button>
            </span>
          ) : (
            <button type="button" className="ngrp-linkbtn" onClick={() => setConfirmStop(true)}>Stop</button>
          ))}
          <button type="button" className="ngrp-linkbtn" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="ngrp-glance-scroll">
        <table className="ngrp-glance-table">
          <thead>
            <tr>
              <th className="aspire-th">Period</th>
              <th className="aspire-th">Opens</th>
              <th className="aspire-th">Due</th>
              <th className="aspire-th">Status</th>
              <th className="aspire-th aspire-th-right"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {resident.periods.map(p => (
              <Fragment key={p.id}>
                <tr>
                  <td>{p.period_number}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(p.opens_on)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(p.due_on)}</td>
                  <td>
                    {p.status === 'submitted' ? `Submitted ${fmtDay(p.submitted_at)}`
                      : p.sent_at ? (p.status === 'sent' ? 'Sent, not opened' : p.status === 'opened' ? 'Opened' : 'In progress')
                      : `Goes out ${fmtDay(p.send_on)}`}
                  </td>
                  <td className="num">
                    {p.status === 'submitted' && (
                      <button type="button" className="ngrp-linkbtn" onClick={() => open(p)}>{openId === p.id ? 'Hide' : 'Open'}</button>
                    )}
                  </td>
                </tr>
                {openId === p.id && (
                  <tr>
                    <td colSpan={5} style={{ background: '#FCFBF9' }}>
                      {!loaded[p.id] ? <span className="ngrp-glance-muted">Loading…</span>
                        : loaded[p.id].error ? <span style={{ color: '#B3282D' }}>{loaded[p.id].error}</span>
                        : <SubmissionView payload={loaded[p.id].payload} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DuringPanel({ cycle, rows, support, toast }) {
  const [sessionFor, setSessionFor] = useState(null)
  const [openFor, setOpenFor] = useState(null)
  const [starting, setStarting] = useState(null)   // candidate_id awaiting confirm
  const [busy, setBusy] = useState(false)
  // Renders a synthetic copy of the reflection email. No network, no resident,
  // no token; it cannot send anything.
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const view = useMemo(() => duringResidency(rows, {
    entries: support.entries, mentors: support.mentors, reflections: support.reflections, today: support.today,
  }), [rows, support.entries, support.mentors, support.reflections, support.today])
  const sessions = support.entries.filter(e => e.activity === 'mentorship_session')
  const reflectionsReady = support.reflections?.provisioned !== false
  const openResident = openFor ? view.residents.find(r => r.row.candidate_id === openFor) || null : null

  // Starting sends period 1 to the resident right now, so it asks first.
  const start = async (r) => {
    setBusy(true)
    const res = await postNgrpSupport('reflection_start', { candidate_id: r.row.candidate_id })
    setBusy(false)
    setStarting(null)
    if (!res.ok) { toast?.error?.('Not started', reflectionError(res)); return }
    toast?.success?.('Reflections started', `Period 1 of ${res.run?.period_count || 5} is on its way to ${displayName(r.row.student)}. The rest follow every other Friday.`)
    support.refetch()
  }

  return (
    <>
      <section className="snap" aria-label="Support during residency snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="ov-panel-title">Support During Residency</span>
          <span className="snap-sub">{cycle.name} · the bi-weekly reflection goes out every other Friday for ten weeks</span>
        </div>
        <div className="glance-kpis snap-kpis">
          <KPICell value={view.kpis.residents} label="Residents" sub="Hired, not separated" />
          <KPICell value={view.kpis.withMentor} label="With a Mentor" sub={`of ${plural(view.kpis.residents, 'resident')}`} accent="sage" />
          <KPICell value={view.kpis.reflecting} label="Reflecting" sub="Started, still active" />
          <KPICell value={view.kpis.submitted} label="Reflections Submitted" sub="Across all residents" />
          <KPICell value={view.kpis.overdue} label="Periods Overdue" sub="Sent, past due, not submitted" accent={view.kpis.overdue ? 'warning' : undefined} />
          <KPICell value={view.kpis.sessions} label="Mentorship Sessions" sub="Recorded" />
        </div>
      </section>

      {sessionFor && (
        <RecordForm cycle={cycle} rows={rows} today={support.today} phase="during" toast={toast}
          preset={{ activity: 'mentorship_session', candidateId: sessionFor.row.candidate_id, mentorName: sessionFor.mentor?.mentor_name || '' }}
          onDone={() => { setSessionFor(null); support.refetch() }} />
      )}

      <section className="snap ngrp-glance-panel" aria-label="Residents">
        <div className="aggregate-panel-hdr">
          <div>
            <div className="ov-panel-title">Residents</div>
            <div className="ov-panel-sub">
              {reflectionsReady
                ? 'Start sends period 1 now; periods 2 to 5 go out on their own, each due the Sunday that closes it'
                : 'Reflections switch on once migration 20260917000000 is applied'}
            </div>
          </div>
          {/* Always available: reading what the email says should not require
              starting a real resident first. The preview is synthetic. */}
          <button
            type="button"
            onClick={() => setShowEmailPreview(true)}
            title="Preview the reflection email"
            aria-label="Preview the reflection email"
            style={{
              width: 28, height: 28, flexShrink: 0, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', background: 'none',
              border: 'none', borderRadius: 'var(--aspire-radius-control)', cursor: 'pointer', color: '#9ca3af', padding: 0,
            }}
          >
            <Eye size={15} />
          </button>
        </div>
        {view.residents.length === 0 ? (
          <p className="ngrp-glance-empty">No residents yet. Alumni appear here once their hire is recorded on the placement board.</p>
        ) : (
          <div className="ngrp-glance-scroll">
            <table className="ngrp-glance-table">
              <thead>
                <tr>
                  <th className="aspire-th">Resident</th>
                  <th className="aspire-th">Unit</th>
                  <th className="aspire-th">Mentor</th>
                  <th className="aspire-th">Reflections</th>
                  <th className="aspire-th aspire-th-right">Sessions</th>
                  {support.canRecord && <th className="aspire-th aspire-th-right"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {view.residents.map(r => (
                  <tr key={r.row.id}>
                    <td><Name row={r.row} sub={r.row.outcome?.cs_email || 'No Cedars-Sinai email yet'} /></td>
                    <td>{r.row.outcome?.hired_unit || r.row.assigned_unit || ''}</td>
                    <td><MentorCell resident={r} canRecord={support.canRecord} onSaved={support.refetch} toast={toast} /></td>
                    <td><ReflectionCell resident={r} /></td>
                    <td className="num">{r.sessions}{r.lastSession && <span className="ngrp-glance-muted"> · {fmtDay(r.lastSession)}</span>}</td>
                    {support.canRecord && (
                      <td className="num" style={{ width: 'auto', whiteSpace: 'nowrap' }}>
                        {reflectionsReady && !r.reflection.started && (
                          starting === r.row.candidate_id ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: F, marginRight: 10 }}>
                              Send period 1 now?
                              <button type="button" style={btn(true)} disabled={busy} onClick={() => start(r)}>{busy ? 'Sending…' : 'Yes'}</button>
                              <button type="button" className="ngrp-linkbtn" onClick={() => setStarting(null)}>No</button>
                            </span>
                          ) : (
                            <button type="button" className="ngrp-linkbtn" style={{ marginRight: 10 }} onClick={() => setStarting(r.row.candidate_id)}>
                              Start Reflections
                            </button>
                          )
                        )}
                        {r.reflection.started && (
                          <button type="button" className="ngrp-linkbtn" style={{ marginRight: 10 }} onClick={() => setOpenFor(openFor === r.row.candidate_id ? null : r.row.candidate_id)}>
                            {openFor === r.row.candidate_id ? 'Hide' : 'View'}
                          </button>
                        )}
                        <button type="button" className="ngrp-linkbtn" onClick={() => setSessionFor(r)}>Record Session</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openResident && (
        <ReflectionsPanel resident={openResident} canRecord={support.canRecord} toast={toast}
          onChanged={support.refetch} onClose={() => setOpenFor(null)} />
      )}

      <RecentEntries entries={sessions} rows={rows} canRecord={support.canRecord} onChanged={support.refetch} toast={toast} />

      {showEmailPreview && (
        <AutomationEmailPreviewDrawer
          title="NGRP Bi-Weekly Reflection"
          entry={NGRP_REFLECTION_PREVIEW}
          footNote="The resident, the dates and the link are synthetic. Rendered with the same template Start and the Friday cron send. Period 1 goes out when you press Start; the rest follow every other Friday."
          onClose={() => setShowEmailPreview(false)}
        />
      )}
    </>
  )
}

export default function SupportTab({ cycle, subTab, toast }) {
  const applicants = useNgrpApplicants(cycle?.id)
  const support = useNgrpSupport(cycle?.id)
  const rows = useMemo(
    () => deriveApplicantRows(applicants.payload?.students, applicants.payload?.candidates),
    [applicants.payload],
  )

  if (!cycle) return null
  if (applicants.status === 'loading' || support.status === 'loading') {
    return <div className="state-box"><div className="spinner" /><p>Loading support…</p></div>
  }
  if (support.status === 'unprovisioned') {
    return (
      <div className="snap" style={{ margin: '14px 0', padding: '22px 24px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--raven, #191919)' }}>Support is almost ready</h2>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280', maxWidth: 640, lineHeight: 1.6 }}>
          Support tracking switches on once migration 20260914000000 is applied.
        </p>
      </div>
    )
  }
  if (support.status === 'error' || applicants.status === 'error') {
    return (
      <div className="ngrp-banner ngrp-banner-error" role="alert" style={{ marginTop: 14 }}>
        <b>Support could not load.</b> This is a server or connection problem.{' '}
        <button type="button" className="ngrp-linkbtn" onClick={() => { support.refetch(); applicants.refetch() }}>Try again</button>
      </div>
    )
  }
  return subTab === 'during'
    ? <DuringPanel cycle={cycle} rows={rows} support={support} toast={toast} />
    : <BeforePanel cycle={cycle} rows={rows} support={support} toast={toast} />
}
