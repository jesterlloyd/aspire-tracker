// RESIDENTS-1 (Owner, 2026-09-14): Residency > Residents.
//
// The hired new grads (unit, shift, hire date, position/title, preceptor, email
// and phone) and whether each is still at Cedars-Sinai, which makes this the
// retention tracker too. Per residency cohort by default, following the Scope
// picker, with an Aggregate view across every cohort.
//
// One component, mounted by NgrpWorkspace, so the staff app and the Residency
// Portal show the same page. Rows come from api/ngrp-support.js `residents`
// (Talent Acquisition narrowed like every Residency surface); edits go through
// api/ngrp-manage.js `resident_details_set`. The shared rules live in
// src/lib/ngrp/ngrpResidents.js.
import { useMemo, useState } from 'react'
import { KPICell } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import SegmentedTabs from '../ui/SegmentedTabs'
import { useNgrpResidents, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import {
  POSITION_TITLES, OTHER_TITLE, RESIDENTS_SCOPES, retentionSummary, dayOf,
} from '../../lib/ngrp/ngrpResidents'
import { shiftBadge } from '../../lib/shiftStatus'
import { displayName } from '../../lib/utils'
import { F, btn } from '../../lib/ngrp/ngrpCohortForm'

const fmtDate = (v) => {
  const d = dayOf(v)
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const field = {
  width: '100%', boxSizing: 'border-box', height: 34, padding: '0 10px',
  borderRadius: 'var(--aspire-radius-control)', border: '1px solid rgba(29,37,103,0.18)',
  fontFamily: F, fontSize: 13, background: '#fff',
}
const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 600, color: '#4A5560', margin: '0 0 4px', fontFamily: F }
const hint = { margin: '4px 0 0', fontSize: 11, color: '#6B7280', fontFamily: F }
const pill = (bg, color) => ({
  display: 'inline-block', padding: '2px 9px', borderRadius: 'var(--aspire-radius-pill, 999px)', fontSize: 11, fontWeight: 600,
  background: bg, color, whiteSpace: 'nowrap', fontFamily: F,
})
const SOURCE_NOTE = {
  reflection: 'from their first reflection',
  form: 'from their Transition Form',
}

function Muted({ children }) {
  return <span className="ngrp-glance-muted">{children}</span>
}

function Affiliation({ resident }) {
  if (resident.affiliated) {
    return <span data-testid="resident-affiliated" style={pill('#DCEBDD', '#2D4A2B')}>At Cedars-Sinai</span>
  }
  return (
    <span data-testid="resident-separated" title={resident.separation_reason || undefined}>
      <span style={pill('#ECECEC', '#4B5563')}>Separated</span>
      <Muted> {fmtDate(resident.separated_at)}</Muted>
    </span>
  )
}

function Sourced({ value, source }) {
  if (!value) return <Muted>Not recorded</Muted>
  return (
    <>
      {value}
      {source && SOURCE_NOTE[source] && <div className="ngrp-glance-muted" style={{ fontSize: 11 }}>{SOURCE_NOTE[source]}</div>}
    </>
  )
}

function ResidentEditor({ resident, detailsProvisioned, onClose, onSaved, toast }) {
  const storedTitle = resident.position_title || ''
  const [titleChoice, setTitleChoice] = useState(
    !storedTitle ? '' : POSITION_TITLES.includes(storedTitle) ? storedTitle : OTHER_TITLE,
  )
  const [otherTitle, setOtherTitle] = useState(POSITION_TITLES.includes(storedTitle) ? '' : storedTitle)
  const [preceptor, setPreceptor] = useState(resident.preceptor.source === 'record' ? resident.preceptor.value : '')
  const [phone, setPhone] = useState(resident.phone.source === 'record' ? resident.phone.value : '')
  const [separatedOn, setSeparatedOn] = useState(dayOf(resident.separated_at) || '')
  const [reason, setReason] = useState(resident.separation_reason || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const name = displayName(resident.student)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await postNgrpManage('resident_details_set', {
      candidate_id: resident.candidate_id,
      position_title: titleChoice === OTHER_TITLE ? otherTitle : titleChoice,
      preceptor_name: preceptor,
      phone,
      separated_on: separatedOn,
      separation_reason: reason,
    })
    setBusy(false)
    if (res.ok && res.provisioned === false) {
      setError('Title, preceptor and phone are not available until migration 20260919000000 is applied.')
      return
    }
    if (!res.ok) {
      setError((res.errors || []).map(x => x.message).join(' ') || 'It could not be saved.')
      return
    }
    toast?.success?.('Resident updated', `${name}'s details are saved.`)
    onSaved()
  }

  return (
    <form className="snap ngrp-glance-panel" onSubmit={save} aria-label={`Edit ${name}`} data-testid="resident-editor"
      style={{ padding: '16px 18px' }}>
      <div className="ov-panel-title" style={{ marginBottom: 4 }}>{name}</div>
      <div className="ov-panel-sub" style={{ marginBottom: 12 }}>
        {[resident.cohort_name, resident.unit, resident.hired_at ? `Hired ${fmtDate(resident.hired_at)}` : null].filter(Boolean).join(' · ')}
      </div>
      {!detailsProvisioned && (
        <p style={{ ...hint, margin: '0 0 12px', color: '#92400E' }}>
          Title, preceptor and phone switch on once migration 20260919000000 is applied.
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="resident-title">Position/Title</label>
          <select id="resident-title" style={field} value={titleChoice} disabled={!detailsProvisioned}
            onChange={e => setTitleChoice(e.target.value)}>
            <option value="">Not recorded</option>
            {POSITION_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
            <option value={OTHER_TITLE}>Other</option>
          </select>
          {titleChoice === OTHER_TITLE && (
            <input style={{ ...field, marginTop: 8 }} value={otherTitle} maxLength={120}
              onChange={e => setOtherTitle(e.target.value)} placeholder="Type the title" aria-label="Other title" />
          )}
        </div>
        <div>
          <label style={labelStyle} htmlFor="resident-preceptor">Preceptor</label>
          <input id="resident-preceptor" style={field} value={preceptor} maxLength={200} disabled={!detailsProvisioned}
            onChange={e => setPreceptor(e.target.value)}
            placeholder={resident.preceptor.source === 'reflection' ? resident.preceptor.value : 'Preceptor name'} />
          <p style={hint}>
            {resident.preceptor.source === 'reflection'
              ? 'Leave blank to use the names from their first reflection.'
              : 'Shows the names from their first reflection once they submit it.'}
          </p>
        </div>
        <div>
          <label style={labelStyle} htmlFor="resident-phone">Phone</label>
          <input id="resident-phone" style={field} value={phone} maxLength={40} disabled={!detailsProvisioned}
            onChange={e => setPhone(e.target.value)}
            placeholder={resident.phone.source === 'form' ? resident.phone.value : '(310) 555-0100'} />
          <p style={hint}>
            {resident.phone.source === 'form'
              ? 'Leave blank to use the phone from their Transition Form.'
              : 'No phone on their Transition Form.'}
          </p>
        </div>
        <div>
          <label style={labelStyle} htmlFor="resident-separated">Separated on</label>
          <input id="resident-separated" type="date" style={field} value={separatedOn}
            min={dayOf(resident.hired_at) || undefined}
            onChange={e => setSeparatedOn(e.target.value)} />
          <p style={hint}>Leave blank while they are still at Cedars-Sinai.</p>
        </div>
        <div>
          <label style={labelStyle} htmlFor="resident-reason">Separation reason</label>
          <input id="resident-reason" style={field} value={reason} maxLength={500} disabled={!separatedOn}
            onChange={e => setReason(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      {error && <p role="alert" style={{ ...hint, color: '#B3282D', margin: '12px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
        <button type="button" className="ngrp-linkbtn" onClick={onClose}>Cancel</button>
        <button type="submit" style={btn(true)} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

export default function ResidentsTab({ cycle, canManage, toast }) {
  const [scope, setScope] = useState(RESIDENTS_SCOPES.COHORT)
  const [editingId, setEditingId] = useState(null)
  const aggregate = scope === RESIDENTS_SCOPES.AGGREGATE
  const data = useNgrpResidents(cycle?.id, { scope })
  const summary = useMemo(() => retentionSummary(data.residents), [data.residents])
  const editing = editingId ? data.residents.find(r => r.candidate_id === editingId) || null : null
  const scopeLabel = aggregate ? 'All residency cohorts' : (cycle?.name || 'This cohort')

  const body = (() => {
    if (data.status === 'loading') return <p className="ngrp-glance-empty">Loading residents…</p>
    if (data.status === 'unauthorized') return <p className="ngrp-glance-empty">Your account cannot see residents.</p>
    if (data.status === 'unprovisioned') return <p className="ngrp-glance-empty">Residents appear once the NGRP support migration is applied.</p>
    if (data.status === 'error') return <p className="ngrp-glance-empty">Residents could not be loaded. Refresh to try again.</p>
    if (data.residents.length === 0) {
      return (
        <p className="ngrp-glance-empty">
          {aggregate
            ? 'No residents yet. New grads appear here once their hire is recorded on the Placement Board.'
            : `No residents in ${cycle?.name || 'this cohort'} yet. New grads appear here once their hire is recorded on the Placement Board.`}
        </p>
      )
    }
    return (
      <div className="ngrp-glance-scroll">
        <table className="ngrp-glance-table" data-testid="residents-table">
          <thead>
            <tr>
              <th className="aspire-th">Resident</th>
              {aggregate && <th className="aspire-th">Cohort</th>}
              <th className="aspire-th">Unit</th>
              <th className="aspire-th">Shift</th>
              <th className="aspire-th">Hire Date</th>
              <th className="aspire-th">Position/Title</th>
              <th className="aspire-th">Preceptor</th>
              <th className="aspire-th">Email/Phone</th>
              <th className="aspire-th">Affiliation</th>
              {canManage && <th className="aspire-th aspire-th-right"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {data.residents.map(r => (
              <tr key={r.candidate_id}>
                <td>
                  <div className="ngrp-glance-person">
                    <StudentAvatar student={r.student} size={28} />
                    <div className="ov-unit-info">
                      <span className="ov-unit-name">{displayName(r.student)}</span>
                    </div>
                  </div>
                </td>
                {aggregate && <td>{r.cohort_name}</td>}
                <td>{r.unit || <Muted>Not recorded</Muted>}</td>
                <td>{r.shift ? shiftBadge(r.shift).label : <Muted>Not recorded</Muted>}</td>
                <td>
                  {fmtDate(r.hired_at)}
                  {r.residency_start_date && <div className="ngrp-glance-muted" style={{ fontSize: 11 }}>Starts {fmtDate(r.residency_start_date)}</div>}
                </td>
                <td>{r.position_title || <Muted>Not recorded</Muted>}</td>
                <td><Sourced value={r.preceptor.value} source={r.preceptor.source} /></td>
                <td>
                  {r.cs_email || r.personal_email || <Muted>No email</Muted>}
                  <div className="ngrp-glance-muted" style={{ fontSize: 11 }}>
                    {r.phone.value || 'No phone'}
                    {r.phone.value && r.phone.source === 'form' ? ` (${SOURCE_NOTE.form})` : ''}
                  </div>
                </td>
                <td><Affiliation resident={r} /></td>
                {canManage && (
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="ngrp-linkbtn" onClick={() => setEditingId(r.candidate_id)}>Edit</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  })()

  return (
    <>
      <section className="snap" aria-label="Residents snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="ov-panel-title">Residents</span>
          <span className="snap-sub">{scopeLabel} · hired new grads and who is still at Cedars-Sinai</span>
        </div>
        <div className="glance-kpis snap-kpis ngrp-residents-kpis" data-testid="residents-kpis">
          <KPICell value={summary.hired} label="Residents Hired" sub={aggregate ? 'Across all cohorts' : 'This cohort'} />
          <KPICell value={summary.affiliated} label="At Cedars-Sinai" sub="No separation recorded" accent="sage" />
          <KPICell value={summary.separated} label="Separated" sub="Left Cedars-Sinai" accent={summary.separated ? 'warning' : undefined} />
          <KPICell
            value={summary.rate === null ? '0%' : `${summary.rate}%`}
            label="Retention"
            sub={summary.rate === null ? 'No residents yet' : `${summary.affiliated} of ${summary.hired} still here`}
          />
        </div>
      </section>

      {editing && (
        <ResidentEditor
          key={editing.candidate_id}
          resident={editing}
          detailsProvisioned={data.detailsProvisioned}
          toast={toast}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); data.refetch() }}
        />
      )}

      <section className="snap ngrp-glance-panel" aria-label="Hired new grads">
        <div className="aggregate-panel-hdr ngrp-residents-hdr" data-testid="residents-hdr">
          <div>
            <div className="ov-panel-title">Hired New Grads</div>
            <div className="ov-panel-sub">
              {aggregate ? 'Every residency cohort' : `Residents hired in ${cycle?.name || 'this cohort'}`}
            </div>
          </div>
          <SegmentedTabs
            label="Residents scope"
            items={[
              { key: RESIDENTS_SCOPES.COHORT, label: cycle?.name || 'This Cohort' },
              { key: RESIDENTS_SCOPES.AGGREGATE, label: 'Aggregate' },
            ]}
            value={scope}
            onChange={(key) => { setScope(key); setEditingId(null) }}
          />
        </div>
        {body}
      </section>
    </>
  )
}
