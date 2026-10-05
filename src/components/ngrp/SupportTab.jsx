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
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, ExternalLink, MessageSquare } from 'lucide-react'
import { KPICell } from '../KPIBand'
import DetailDrawer from '../ui/DetailDrawer'
import DataSheet, { Pill, Missing } from '../shared/DataSheet'
import './supportLog.css'
import StudentDocumentsDrawer from '../documents/StudentDocumentsDrawer'
import KeithMark from '../keith/KeithMark'
import SegmentedPicker from '../shared/SegmentedPicker'
import { RESUME_FILTERS, matchesResumeFilter, resumeSortValue } from '../../lib/documents/resumeStatusModel'
import { useNgrpSurface } from '../../lib/ngrp/ngrpSurface'
import StudentAvatar from '../StudentAvatar'
// RESIDENCY-REFLECTION-1: the same drawer Profiles & Interest uses to preview
// the Transition Form email, rendering the same builder the send uses.
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { NGRP_REFLECTION_PREVIEW } from '../../lib/ngrp/reflectionPreviewFixture'
import { SAMPLE_PATH } from '../../lib/ngrp/reflectionSample'
import { useNgrpApplicants, useNgrpSupport, postNgrpSupport } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows } from '../../lib/ngrp/ngrpStates'
import { supportActivity, BULK_ACTIVITIES } from '../../lib/ngrp/ngrpSupportActivities'
import {
  beforeResidency, startOfResidency, duringResidency,
  formStatusPill, groupLogChoices, lastEventDay, dayBefore, GROUP_LOG_FILTERS,
} from '../../lib/ngrp/ngrpSupportView'
import {
  SESSION_FORMATS, sessionFormatLabel, sessionLoggerLabel,
  DURATION_MIN, DURATION_MAX, TOPICS_MAX, NEXT_STEPS_MAX,
} from '../../lib/ngrp/ngrpMentorshipSession'
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
  not_on_roster: 'One of those alumni is not in this residency cohort.',
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

// ── Log group activity (the ASPIRE team) ─────────────────────────────────────
// SUPPORT-STANDALONE-1 (Owner, 2026-10-04): one activity, one date, any number of
// alumni, and no transition form needed first. One save is one Undo for ten seconds.
const UNDO_MS = 10_000

// One choice from a short list, as chips that wrap on a phone (a segmented control
// four labels wide runs off a 375px drawer).
function ChipChoice({ options, value, onChange, ariaLabel }) {
  return (
    <div className="sl-chips" role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button key={o.value} type="button" className="sl-chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function LogGroupDrawer({ open, cycle, rows, entries, today, onClose, onSaved, toast }) {
  const [activity, setActivity] = useState(BULK_ACTIVITIES[0].key)
  const [occurredOn, setOccurredOn] = useState(today || '')
  const [filter, setFilter] = useState('all')
  const [picked, setPicked] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = supportActivity(activity)
  const lastEvent = lastEventDay(entries, activity)
  const yesterday = dayBefore(today)
  const shown = useMemo(
    () => groupLogChoices(rows, entries, { activity, filter })
      .sort((x, y) => displayName(x.student).localeCompare(displayName(y.student), undefined, { sensitivity: 'base' })),
    [rows, entries, activity, filter],
  )
  const shownIds = shown.map(r => r.student?.id || r.id)
  const allShownPicked = shownIds.length > 0 && shownIds.every(id => picked.has(id))

  const toggle = id => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const pickShown = () => setPicked((prev) => {
    const next = new Set(prev)
    if (allShownPicked) shownIds.forEach(id => next.delete(id)); else shownIds.forEach(id => next.add(id))
    return next
  })

  const undo = async (entryIds, what) => {
    const res = await postNgrpSupport('void_batch', { entry_ids: entryIds })
    if (!res.ok) { toast?.error?.('Not undone', errorText(res)); return }
    toast?.success?.('Undone', `${what} was removed. The record of it is kept.`)
    onSaved()
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await postNgrpSupport('record_attendance', {
      cycle_id: cycle.id, activity, occurred_on: occurredOn, note: note.trim() || null, student_ids: [...picked],
    })
    setBusy(false)
    if (!res.ok) { setError(errorText(res)); return }
    const what = `${act.label} on ${fmtDay(occurredOn)}`
    const skipped = res.alreadyRecorded ? ` ${plural(res.alreadyRecorded, 'was', 'were')} already logged and skipped.` : ''
    const ids = res.entryIds || []
    const message = `${plural(res.created, 'alumnus', 'alumni')} logged.${skipped}`
    if (ids.length) {
      toast?.success?.(`${act.label} logged`, message, { duration: UNDO_MS, action: { label: 'Undo', onClick: () => undo(ids, what) } })
    } else {
      toast?.info?.('Nothing new to log', `Everyone chosen already has ${what}.`)
    }
    setPicked(new Set())
    setNote('')
    onSaved()
    onClose()
  }

  const filterLabel = f => (f.key === 'not_yet' ? `No ${act.label} yet` : f.label)
  const footer = (
    <>
      <button type="button" className="sl-footbtn" style={btn()} onClick={onClose}>Cancel</button>
      <button type="submit" form="sl-log-form" className="sl-footbtn" style={btn(true)} disabled={busy || !occurredOn || picked.size === 0}>
        {busy ? 'Saving…' : picked.size ? `Log ${plural(picked.size, 'alumnus', 'alumni')}` : 'Log'}
      </button>
    </>
  )

  return (
    <DetailDrawer open={open} title="Log Group Activity" onClose={onClose} footer={footer} width={620} trapFocus>
      <form id="sl-log-form" className="sl-form" onSubmit={submit}>
        <fieldset className="sl-field">
          <legend className="sl-label">Activity</legend>
          <ChipChoice ariaLabel="Activity" value={activity} onChange={setActivity}
            options={BULK_ACTIVITIES.map(a => ({ value: a.key, label: a.label }))} />
        </fieldset>

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-date">Date</label>
          <div className="sl-daterow">
            <input id="sl-date" className="sl-input" type="date" value={occurredOn} max={today || undefined}
              onChange={e => setOccurredOn(e.target.value)} required />
            <div className="sl-chips" role="group" aria-label="Date shortcuts">
              {today && <button type="button" className="sl-chip" aria-pressed={occurredOn === today} onClick={() => setOccurredOn(today)}>Today</button>}
              {yesterday && <button type="button" className="sl-chip" aria-pressed={occurredOn === yesterday} onClick={() => setOccurredOn(yesterday)}>Yesterday</button>}
              {lastEvent && (
                <button type="button" className="sl-chip" aria-pressed={occurredOn === lastEvent} onClick={() => setOccurredOn(lastEvent)}>
                  Last event · {fmtDay(lastEvent)}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-note">Note for everyone (optional)</label>
          <input id="sl-note" className="sl-input" value={note} maxLength={1000} onChange={e => setNote(e.target.value)}
            placeholder="Anything worth remembering" />
        </div>

        <fieldset className="sl-field">
          <legend className="sl-label">Alumni · {picked.size} selected</legend>
          <div className="sl-rosterbar">
            <ChipChoice ariaLabel="Show" value={filter} onChange={setFilter}
              options={GROUP_LOG_FILTERS.map(f => ({ value: f.key, label: filterLabel(f) }))} />
            <button type="button" className="ngrp-linkbtn sl-selectall" onClick={pickShown} disabled={shownIds.length === 0}>
              {allShownPicked ? 'Clear shown' : 'Select all shown'}
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="sl-empty">No alumni match this filter.</p>
          ) : (
            <ul className="sl-roster">
              {shown.map((r) => {
                const id = r.student?.id || r.id
                const pill = formStatusPill(r.form_status)
                return (
                  <li key={id}>
                    <label className="sl-person">
                      <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} />
                      <span className="sl-person-name">
                        {displayName(r.student)}
                        {r.student?.aspire_cohort && <span className="sl-person-q"> · {r.student.aspire_cohort}</span>}
                      </span>
                      <Pill tone={pill.tone}>{pill.label}</Pill>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>
        {error && <p className="sl-error" role="alert">{error}</p>}
        <p className="sl-hint">The transition form never has to come first. Logging the same activity on the same day twice is skipped, not doubled.</p>
      </form>
    </DetailDrawer>
  )
}

function RecentEntries({ entries, rows, canRecord, onChanged, toast }) {
  const [open, setOpen] = useState(false)
  // By student, not candidate: an alumnus enrolled by Log group activity has a candidate
  // id the roster has not refetched yet, but always the same student id.
  const nameOf = useMemo(() => new Map(rows.map(r => [r.student?.id || r.id, displayName(r.student)])), [rows])
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
                  <td>{nameOf.get(e.student_id) || ''}</td>
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
const dash = <Missing />
function ActivityCell({ cell }) {
  if (!cell || cell.count === 0) return dash
  return (
    <span className="sl-cell">
      {cell.fromOutreach && <MessageSquare size={13} aria-label="Logged from an Outreach send" className="sl-cell-icon" />}
      {fmtDay(cell.last)}{cell.count > 1 && <span className="ds-dim"> ×{cell.count}</span>}
    </span>
  )
}

function BeforePanel({ cycle, rows, support, toast }) {
  const navigate = useNavigate()
  const [logging, setLogging] = useState(false)
  // STUDENT-DOCUMENTS-1: an alumnus's résumé opens here, in Residency, so the staff app's
  // cohort never changes to reach someone from a past cohort.
  const { staffApp } = useNgrpSurface()
  const canDocs = staffApp && support.canRecord
  const [resumeFor, setResumeFor] = useState(null)
  const [filter, setFilter] = useState('all')
  const view = useMemo(() => beforeResidency(rows, support.entries), [rows, support.entries])
  const entries = support.entries.filter(e => supportActivity(e.activity)?.phase === 'before')
  // RESUME-WORKSPACE-1 (Owner, 2026-10-05): one Résumé column says where each alumnus's résumé
  // stands, in words, and opens the résumé. It replaced an Outreach-date column that read
  // "Upload" for a résumé already on file, and a Score column that could not be clicked.
  // The ASPIRE team only; Talent Acquisition keeps the plain Résumé Review date.
  const resumes = canDocs ? support.resumes : null
  const statusOf = t => resumes?.[t.row.student?.id || t.row.id] || null
  const counts = useMemo(() => {
    const c = Object.fromEntries(RESUME_FILTERS.map(f => [f.key, 0]))
    for (const t of view.rows) for (const f of RESUME_FILTERS) if (matchesResumeFilter(resumes?.[t.row.student?.id || t.row.id], f.key)) c[f.key] += 1
    return c
  }, [view.rows, resumes])
  const shown = resumes ? view.rows.filter(t => matchesResumeFilter(statusOf(t), filter)) : view.rows

  const resumeColumn = {
    key: 'resume', label: 'Résumé', title: 'Résumé status', min: 170, grow: 1.4, priority: 2,
    sortValue: t => resumeSortValue(statusOf(t)),
    render: (t) => {
      const st = statusOf(t)
      const who = displayName(t.row.student)
      if (!st) return dash
      const sentDay = st.key === 'sent' ? (t.cells.resume_review?.last || st.sentAt) : null
      return (
        <button type="button" className="ngrp-linkbtn sl-cellbtn sl-resume" onClick={() => setResumeFor(t.row)}
          aria-label={`${who}: ${st.key === 'scored' || st.key === 'sent' ? `${st.score} of 100, ${st.readiness}${sentDay ? `, sent ${fmtDay(sentDay)}` : ', not sent'}` : st.label}. Open résumé`}>
          {st.key === 'scored' || st.key === 'sent' ? (
            <span className="sl-cell">
              {st.provenanceId && <KeithMark provenanceId={st.provenanceId} />}
              <b className="sl-score">{st.score}</b>
              <Pill tone={st.readiness === 'Highly Competitive' ? 'ok' : st.readiness === 'Competitive' ? 'info' : 'warn'}>{st.readiness}</Pill>
              {sentDay && <span className="sl-sent"><MessageSquare size={13} aria-hidden="true" className="sl-cell-icon" />Sent {fmtDay(sentDay)}</span>}
            </span>
          ) : <Pill tone={st.tone}>{st.key === 'scoring' ? 'Scoring…' : st.label}</Pill>}
        </button>
      )
    },
  }
  const shortLabel = { town_hall: 'Town Hall', interview_bootcamp: 'Bootcamp', placement_advising: 'Advising', resume_review: 'Résumé' }
  const columns = [
    { key: 'name', label: 'Alumnus', min: 170, grow: 2.2, priority: 1,
      sortValue: t => displayName(t.row.student),
      // The name opens the applicant in Profiles & Interest (?student=, as Needs you links it).
      render: t => (staffApp
        ? <button type="button" className="ngrp-linkbtn sl-namebtn" onClick={() => navigate(`/ngrp/profiles?student=${encodeURIComponent(t.row.student?.id || t.row.id)}`)}
            aria-label={`Open ${displayName(t.row.student)} in Profiles & Interest`}><Name row={t.row} /></button>
        : <Name row={t.row} />) },
    { key: 'form', label: 'Form', min: 92, grow: 0.8, priority: 2,
      sortValue: t => ['Submitted', 'Pending', 'Not sent'].indexOf(t.form.label), render: t => <Pill tone={t.form.tone}>{t.form.label}</Pill> },
    ...view.activities
      .filter(a => !(resumes && a.key === 'resume_review'))
      .map((a, i) => ({
        key: a.key, label: shortLabel[a.key] || a.label, title: a.label, min: 96, grow: 0.8, align: 'right', priority: i === 0 ? 2 : 3,
        sortValue: t => t.cells[a.key].last,
        render: t => <ActivityCell cell={t.cells[a.key]} />,
      })),
  ]
  if (resumes) columns.splice(2, 0, resumeColumn)
  const toolbar = resumes ? (
    <div className="sl-filter">
      <SegmentedPicker size="sm" ariaLabel="Show alumni by résumé status" value={filter} onChange={setFilter}
        options={RESUME_FILTERS.map(f => ({ value: f.key, label: `${f.label} ${counts[f.key]}` }))} />
    </div>
  ) : null
  return (
    <>
      <section className="snap" aria-label="Support before residency snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="sl-headtext">
            <span className="ov-panel-title">Support Before Residency</span>
            <span className="snap-sub">{cycle.name} · optional, never affects eligibility</span>
          </span>
          {support.canRecord && (
            <button type="button" className="sl-logbtn" style={btn(true)} onClick={() => setLogging(true)}>
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" /> Log Group Activity
            </button>
          )}
        </div>
        <div className="glance-kpis snap-kpis">
          <KPICell value={view.kpis.supported} label="Alumni Supported" sub={`of ${plural(view.kpis.alumni, 'alumnus', 'alumni')}`} accent="sage" />
          {view.activities.map(a => <KPICell key={a.key} value={view.kpis[a.key]} label={a.label} sub={a.key === 'resume_review' ? 'Logged from Outreach sends' : 'Alumni reached'} />)}
        </div>
      </section>

      {support.canRecord && (
        <LogGroupDrawer open={logging} cycle={cycle} rows={rows} entries={support.entries} today={support.today}
          onClose={() => setLogging(false)} onSaved={() => support.refetch()} toast={toast} />
      )}

      <section className="snap ngrp-glance-panel sl-sheet" aria-label="Support by alumnus">
        <DataSheet level="plain" title="By Alumnus" caption="Most recent date for each activity. The transition form never blocks a support entry."
          toolbar={toolbar} columns={columns} rows={shown} rowKey={t => t.row.id} defaultSort={{ key: 'name', dir: 'asc' }}
          emptyMessage={view.rows.length ? 'No alumni match this filter.' : 'No alumni in this residency cohort yet.'} />
      </section>

      <RecentEntries entries={entries} rows={rows} canRecord={support.canRecord} onChanged={support.refetch} toast={toast} />

      {canDocs && (
        <StudentDocumentsDrawer only="resume" open={Boolean(resumeFor)} student={resumeFor?.student} subline={resumeFor?.student?.aspire_cohort} cycle={cycle}
          onClose={() => { setResumeFor(null); support.refetch() }} toast={toast} />
      )}
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

// ── MENTORSHIP-1: At the Start of Residency, the ten-week reflection tool ────
function StartPanel({ cycle, rows, support, toast }) {
  const [openFor, setOpenFor] = useState(null)
  const [starting, setStarting] = useState(null)   // candidate_id awaiting confirm
  const [busy, setBusy] = useState(false)
  // Renders a synthetic copy of the reflection email. No network, no resident,
  // no token; it cannot send anything.
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const view = useMemo(
    () => startOfResidency(rows, { reflections: support.reflections, today: support.today }),
    [rows, support.reflections, support.today],
  )
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
      <section className="snap" aria-label="Support at the start of residency snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="ov-panel-title">Support at the Start of Residency</span>
          <span className="snap-sub">{cycle.name} · the Clinical Orientation Progress and Reflection Tool goes out every other Friday for ten weeks</span>
        </div>
        <div className="glance-kpis snap-kpis">
          <KPICell value={view.kpis.residents} label="Residents" sub="Hired, not separated" />
          <KPICell value={view.kpis.reflecting} label="Reflecting" sub="Started, still active" />
          <KPICell value={view.kpis.submitted} label="Reflections Submitted" sub="Across all residents" />
          <KPICell value={view.kpis.overdue} label="Periods Overdue" sub="Sent, past due, not submitted" accent={view.kpis.overdue ? 'warning' : undefined} />
          <KPICell value={view.kpis.complete} label="Completed" sub="Every period submitted" accent="sage" />
        </div>
      </section>

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
          {/* RESIDENCY-REFLECTION-3: the form itself, as a sample, for demos. */}
          <a
            href={SAMPLE_PATH}
            target="_blank"
            rel="noopener"
            title="Open a sample of the form"
            aria-label="Open a sample of the form"
            style={{
              width: 28, height: 28, flexShrink: 0, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
              borderRadius: 'var(--aspire-radius-control)', color: '#9ca3af',
            }}
          >
            <ExternalLink size={15} />
          </a>
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
                  <th className="aspire-th">Residency Start</th>
                  <th className="aspire-th">Reflections</th>
                  {support.canRecord && <th className="aspire-th aspire-th-right"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {view.residents.map(r => (
                  <tr key={r.row.id}>
                    <td><Name row={r.row} sub={r.row.outcome?.cs_email || 'No Cedars-Sinai email yet'} /></td>
                    <td>{r.row.outcome?.hired_unit || r.row.assigned_unit || ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.row.outcome?.residency_start_date ? fmtDay(r.row.outcome.residency_start_date) : <span className="ngrp-glance-muted">Not recorded</span>}</td>
                    <td><ReflectionCell resident={r} /></td>
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

// ── MENTORSHIP-1: During Residency, the mentorship record ────────────────────
// Every session between a resident (mentee) and their mentor. It replaces
// Cedars-Sinai's mentorship platform. The ASPIRE team logs sessions today; the
// record's shape (src/lib/ngrp/ngrpMentorshipSession.js) is the one a future
// mentor or resident self-logging path will write.
const SESSION_UNAVAILABLE = 'Session details switch on once migration 20260920000000 is applied.'

function SessionForm({ residents, today, preset, detailsReady, onDone, toast }) {
  const mentorOf = id => residents.find(r => r.row.candidate_id === id)?.mentor?.mentor_name || ''
  const [candidateId, setCandidateId] = useState(preset?.candidateId || '')
  const [mentorName, setMentorName] = useState(preset?.candidateId ? mentorOf(preset.candidateId) : '')
  const [occurredOn, setOccurredOn] = useState(today || '')
  const [format, setFormat] = useState('')
  const [duration, setDuration] = useState('')
  const [topics, setTopics] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [busy, setBusy] = useState(false)
  const area = { ...field, height: 'auto', minHeight: 68, padding: '8px 10px', resize: 'vertical', lineHeight: 1.45 }

  const chooseResident = (id) => {
    setCandidateId(id)
    if (!mentorName.trim()) setMentorName(mentorOf(id))
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const res = await postNgrpSupport('record', {
      activity: 'mentorship_session',
      candidate_id: candidateId,
      occurred_on: occurredOn,
      mentor_name: mentorName.trim() || null,
      session_format: format,
      duration_minutes: duration === '' ? null : Number(duration),
      topics,
      next_steps: nextSteps,
    })
    setBusy(false)
    if (res.ok && res.provisioned === false) { toast?.error?.('Not saved', SESSION_UNAVAILABLE); return }
    if (!res.ok) { toast?.error?.('Not saved', errorText(res)); return }
    const who = residents.find(r => r.row.candidate_id === candidateId)
    toast?.success?.('Session logged', `The mentorship session with ${who ? displayName(who.row.student) : 'the resident'} is on record.`)
    onDone()
  }

  return (
    <form className="snap ngrp-glance-panel" onSubmit={submit} style={{ padding: '16px 18px' }} aria-label="Log a mentorship session" data-testid="session-form">
      <div className="ov-panel-title" style={{ marginBottom: 12 }}>Log a Mentorship Session</div>
      {!detailsReady && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#92400E', fontFamily: F }}>{SESSION_UNAVAILABLE}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
        <label style={{ margin: 0 }}>
          <span style={label}>Resident</span>
          <select style={field} value={candidateId} onChange={e => chooseResident(e.target.value)} required disabled={Boolean(preset?.candidateId)}>
            <option value="">Choose…</option>
            {residents.map(r => <option key={r.row.candidate_id} value={r.row.candidate_id}>{displayName(r.row.student)}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>
          <span style={label}>Date</span>
          <input style={field} type="date" value={occurredOn} max={today || undefined} onChange={e => setOccurredOn(e.target.value)} required />
        </label>
        <label style={{ margin: 0 }}>
          <span style={label}>Mentor</span>
          <input style={field} value={mentorName} maxLength={120} onChange={e => setMentorName(e.target.value)} placeholder="Who led the session" />
        </label>
        <label style={{ margin: 0 }}>
          <span style={label}>Format</span>
          <select style={field} value={format} onChange={e => setFormat(e.target.value)} required>
            <option value="">Choose…</option>
            {SESSION_FORMATS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>
          <span style={label}>Duration (minutes)</span>
          <input style={field} type="number" inputMode="numeric" min={DURATION_MIN} max={DURATION_MAX} step={5}
            value={duration} onChange={e => setDuration(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <label style={{ display: 'block', margin: '0 0 12px' }}>
        <span style={label}>Topics discussed</span>
        <textarea style={area} value={topics} maxLength={TOPICS_MAX} required onChange={e => setTopics(e.target.value)}
          placeholder="For example: first weeks on nights, time management, a hard family conversation" />
      </label>
      <label style={{ display: 'block', margin: '0 0 12px' }}>
        <span style={label}>Next steps (optional)</span>
        <textarea style={area} value={nextSteps} maxLength={NEXT_STEPS_MAX} onChange={e => setNextSteps(e.target.value)}
          placeholder="What the resident will try before the next session" />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={btn()} onClick={onDone}>Cancel</button>
        <button type="submit" style={btn(true)} disabled={busy || !detailsReady || !candidateId || !occurredOn || !format || !topics.trim()}>
          {busy ? 'Saving…' : 'Log Session'}
        </button>
      </div>
    </form>
  )
}

function SessionLog({ sessions, rows, canRecord, onChanged, toast }) {
  const nameOf = useMemo(() => new Map(rows.map(r => [r.student?.id || r.id, displayName(r.student)])), [rows])
  const voidSession = async (entry) => {
    const res = await postNgrpSupport('void', { entry_id: entry.id })
    if (!res.ok) { toast?.error?.('Not voided', errorText(res)); return }
    toast?.success?.('Session voided', 'It no longer counts. The record of it is kept.')
    onChanged()
  }
  const muted = text => <span className="ngrp-glance-muted">{text}</span>
  return (
    <section className="snap ngrp-glance-panel" aria-label="Mentorship session log">
      <div className="aggregate-panel-hdr">
        <div>
          <div className="ov-panel-title">Session Log</div>
          <div className="ov-panel-sub">{plural(sessions.length, 'session')} on record, newest first</div>
        </div>
      </div>
      {sessions.length === 0 ? (
        <p className="ngrp-glance-empty">No mentorship sessions logged yet.</p>
      ) : (
        <div className="ngrp-glance-scroll">
          <table className="ngrp-glance-table" data-testid="session-log">
            <thead>
              <tr>
                <th className="aspire-th">Date</th>
                <th className="aspire-th">Resident</th>
                <th className="aspire-th">Mentor</th>
                <th className="aspire-th">Format</th>
                <th className="aspire-th aspire-th-right">Minutes</th>
                <th className="aspire-th">Topics Discussed</th>
                <th className="aspire-th">Next Steps</th>
                <th className="aspire-th">Logged By</th>
                {canRecord && <th className="aspire-th aspire-th-right"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {sessions.map(e => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.occurred_on)}</td>
                  <td>{nameOf.get(e.student_id) || ''}</td>
                  <td>{e.mentor_name || muted('Not recorded')}</td>
                  <td>{sessionFormatLabel(e.session_format) || muted('Not recorded')}</td>
                  <td className="num">{e.duration_minutes ?? ''}</td>
                  <td style={{ minWidth: 200, whiteSpace: 'pre-wrap' }}>{e.topics || e.note || muted('Not recorded')}</td>
                  <td style={{ minWidth: 180, whiteSpace: 'pre-wrap' }}>{e.next_steps || ''}</td>
                  <td>{sessionLoggerLabel(e.logged_by || 'aspire_team')}</td>
                  {canRecord && (
                    <td className="num">
                      <button type="button" className="ngrp-linkbtn" onClick={() => voidSession(e)}>Void</button>
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

function MentorshipPanel({ cycle, rows, support, toast }) {
  const [logging, setLogging] = useState(null)   // null | { candidateId? }
  const view = useMemo(
    () => duringResidency(rows, { entries: support.entries, mentors: support.mentors }),
    [rows, support.entries, support.mentors],
  )
  const hours = Math.round((view.kpis.minutes / 60) * 10) / 10
  return (
    <>
      <section className="snap" aria-label="Mentorship during residency snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="ov-panel-title">Mentorship During Residency</span>
          <span className="snap-sub">{cycle.name} · every session between a resident and their mentor, on record</span>
        </div>
        <div className="glance-kpis snap-kpis">
          <KPICell value={view.kpis.residents} label="Residents" sub="Hired, not separated" />
          <KPICell value={view.kpis.withMentor} label="With a Mentor" sub={`of ${plural(view.kpis.residents, 'resident')}`} accent="sage" />
          <KPICell value={view.kpis.sessions} label="Sessions Logged" sub="Across all residents" />
          <KPICell value={hours} label="Hours of Mentorship" sub="From recorded durations" />
          <KPICell value={view.kpis.withoutSession} label="No Session Yet" sub="Residents to reach" accent={view.kpis.withoutSession ? 'warning' : undefined} />
        </div>
      </section>

      {logging && (
        <SessionForm
          key={logging.candidateId || 'new'}
          residents={view.residents}
          today={support.today}
          preset={logging}
          detailsReady={support.sessionDetailsProvisioned}
          toast={toast}
          onDone={() => { setLogging(null); support.refetch() }}
        />
      )}

      <section className="snap ngrp-glance-panel" aria-label="Residents and their mentors">
        <div className="aggregate-panel-hdr ngrp-residents-hdr" data-testid="mentorship-hdr">
          <div>
            <div className="ov-panel-title">Residents</div>
            <div className="ov-panel-sub">Each resident&apos;s mentor and their latest session</div>
          </div>
          {support.canRecord && !logging && view.residents.length > 0 && (
            <button type="button" style={{ ...btn(true), whiteSpace: 'nowrap' }} onClick={() => setLogging({})}>
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" /> Log Session
            </button>
          )}
        </div>
        {view.residents.length === 0 ? (
          <p className="ngrp-glance-empty">No residents yet. Alumni appear here once their hire is recorded on the Interview Board.</p>
        ) : (
          <div className="ngrp-glance-scroll">
            <table className="ngrp-glance-table" data-testid="mentorship-residents">
              <thead>
                <tr>
                  <th className="aspire-th">Resident</th>
                  <th className="aspire-th">Unit</th>
                  <th className="aspire-th">Mentor</th>
                  <th className="aspire-th aspire-th-right">Sessions</th>
                  <th className="aspire-th">Latest Session</th>
                  {support.canRecord && <th className="aspire-th aspire-th-right"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {view.residents.map(r => (
                  <tr key={r.row.id}>
                    <td><Name row={r.row} /></td>
                    <td>{r.row.outcome?.hired_unit || r.row.assigned_unit || ''}</td>
                    <td><MentorCell resident={r} canRecord={support.canRecord} onSaved={support.refetch} toast={toast} /></td>
                    <td className="num">{r.sessions}</td>
                    <td>
                      {r.latest
                        ? <>{fmtDay(r.latest.occurred_on)}<span className="ngrp-glance-muted">{[sessionFormatLabel(r.latest.session_format), r.latest.duration_minutes ? `${r.latest.duration_minutes} min` : ''].filter(Boolean).map(s => ` · ${s}`).join('')}</span></>
                        : <span className="ngrp-glance-muted">No session yet</span>}
                    </td>
                    {support.canRecord && (
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="ngrp-linkbtn" onClick={() => setLogging({ candidateId: r.row.candidate_id })}>Log Session</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SessionLog sessions={view.sessions} rows={rows} canRecord={support.canRecord} onChanged={support.refetch} toast={toast} />
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
  // MENTORSHIP-1: Before Residency | At the Start of Residency | During Residency.
  if (subTab === 'start') return <StartPanel cycle={cycle} rows={rows} support={support} toast={toast} />
  if (subTab === 'during') return <MentorshipPanel cycle={cycle} rows={rows} support={support} toast={toast} />
  return <BeforePanel cycle={cycle} rows={rows} support={support} toast={toast} />
}
