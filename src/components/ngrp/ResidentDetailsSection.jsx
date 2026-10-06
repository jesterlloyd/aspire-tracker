// RESIDENTS-ONE-RECORD-1 (Owner, 2026-10-05): a resident is edited in one place, the applicant
// binder's Hiring sheet. This is the editor Residency > Residents had (title, preceptor, phone,
// separation), moved here unchanged in what it reads and saves (/api/ngrp-manage
// `resident_details_set`, rules in src/lib/ngrp/ngrpResidents.js). Residents is now the
// retention view, and a row there opens this sheet.
//
// It reads the resident from the same `residents` query the Residents tab uses, so the two
// cannot disagree, and it shows only once the hire is recorded.
import { useState } from 'react'
import { useNgrpResidents, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { POSITION_TITLES, OTHER_TITLE, dayOf } from '../../lib/ngrp/ngrpResidents'

const SOURCE_NOTE = { reflection: 'from their first reflection', form: 'from their Transition Form' }
const fmtDate = (v) => {
  const d = dayOf(v)
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const note = { margin: '4px 0 0', fontSize: 11, color: 'var(--text-caption)' }

function Header({ right }) {
  return (
    <h3 className="sp-section-hdr" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', rowGap: 6, margin: 0 }}>
      <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11 }}>Resident Details</span>
      {right}
    </h3>
  )
}

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ color: 'var(--text-caption)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text-heading)', textAlign: 'right', minWidth: 0 }}>{children}</span>
    </div>
  )
}

function Sourced({ value, source }) {
  if (!value) return <span style={{ fontWeight: 400, color: 'var(--text-caption)' }}>Not recorded</span>
  return <>{value}{source && SOURCE_NOTE[source] ? <span style={{ fontWeight: 400, color: 'var(--text-caption)' }}> ({SOURCE_NOTE[source]})</span> : null}</>
}

function Editor({ resident, detailsProvisioned, onClose, onSaved, toast }) {
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
    toast?.success?.('Resident updated', 'Their details are saved.')
    onSaved()
  }

  return (
    <form onSubmit={save} data-testid="resident-editor">
      {!detailsProvisioned && (
        <p style={{ ...note, margin: '0 0 10px', color: 'var(--aspire-warn)' }}>
          Title, preceptor and phone switch on once migration 20260919000000 is applied.
        </p>
      )}
      <div className="sp-grid-2">
        <div className="sp-field">
          <label className="sp-field-lbl" htmlFor="resident-title">Position/Title</label>
          <select id="resident-title" className="sp-select" value={titleChoice} disabled={!detailsProvisioned}
            onChange={e => setTitleChoice(e.target.value)}>
            <option value="">Not recorded</option>
            {POSITION_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
            <option value={OTHER_TITLE}>Other</option>
          </select>
          {titleChoice === OTHER_TITLE && (
            <input className="sp-input" style={{ marginTop: 8 }} value={otherTitle} maxLength={120}
              onChange={e => setOtherTitle(e.target.value)} placeholder="Type the title" aria-label="Other title" />
          )}
        </div>
        <div className="sp-field">
          <label className="sp-field-lbl" htmlFor="resident-preceptor">Preceptor</label>
          <input id="resident-preceptor" className="sp-input" value={preceptor} maxLength={200} disabled={!detailsProvisioned}
            onChange={e => setPreceptor(e.target.value)}
            placeholder={resident.preceptor.source === 'reflection' ? resident.preceptor.value : 'Preceptor name'} />
          <p style={note}>
            {resident.preceptor.source === 'reflection'
              ? 'Leave blank to use the names from their first reflection.'
              : 'Shows the names from their first reflection once they submit it.'}
          </p>
        </div>
        <div className="sp-field">
          <label className="sp-field-lbl" htmlFor="resident-phone">Phone</label>
          <input id="resident-phone" className="sp-input" value={phone} maxLength={40} disabled={!detailsProvisioned}
            onChange={e => setPhone(e.target.value)}
            placeholder={resident.phone.source === 'form' ? resident.phone.value : '(310) 555-0100'} />
          <p style={note}>
            {resident.phone.source === 'form'
              ? 'Leave blank to use the phone from their Transition Form.'
              : 'No phone on their Transition Form.'}
          </p>
        </div>
        <div className="sp-field">
          <label className="sp-field-lbl" htmlFor="resident-separated">Separated on</label>
          <input id="resident-separated" type="date" className="sp-input" value={separatedOn}
            min={dayOf(resident.hired_at) || undefined}
            onChange={e => setSeparatedOn(e.target.value)} />
          <p style={note}>Leave blank while they are still at Cedars-Sinai.</p>
        </div>
        <div className="sp-field">
          <label className="sp-field-lbl" htmlFor="resident-reason">Separation reason</label>
          <input id="resident-reason" className="sp-input" value={reason} maxLength={500} disabled={!separatedOn}
            onChange={e => setReason(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      {error && <p role="alert" style={{ ...note, color: 'var(--aspire-bad)', margin: '10px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        <button type="button" className="ngrp-linkbtn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

export default function ResidentDetailsSection({ row, cycle, canManage, toast }) {
  const hired = Boolean(row?.outcome?.hired_at)
  const data = useNgrpResidents(cycle?.id, { enabled: hired })
  const [editing, setEditing] = useState(false)
  if (!hired) return null
  const resident = data.residents.find(r => row.candidate_id && r.candidate_id === row.candidate_id) || null

  return (
    <section className="sp-section sp-card" data-testid="resident-details">
      <Header right={canManage && resident && !editing ? (
        <button type="button" className="ngrp-linkbtn" onClick={() => setEditing(true)}>Edit</button>
      ) : null} />
      {data.status === 'loading' && <p style={note}>Loading resident details…</p>}
      {data.status !== 'loading' && !resident && <p style={note}>Resident details could not be loaded. Refresh to try again.</p>}
      {resident && (editing ? (
        <Editor resident={resident} detailsProvisioned={data.detailsProvisioned} toast={toast}
          onClose={() => setEditing(false)} onSaved={() => { setEditing(false); data.refetch() }} />
      ) : (
        <>
          <Line label="Position/Title">{resident.position_title || <Sourced value="" />}</Line>
          <Line label="Preceptor"><Sourced value={resident.preceptor.value} source={resident.preceptor.source} /></Line>
          <Line label="Phone"><Sourced value={resident.phone.value} source={resident.phone.source} /></Line>
          <Line label="Affiliation">
            {resident.affiliated
              ? 'At Cedars-Sinai'
              : <>Separated {fmtDate(resident.separated_at)}{resident.separation_reason ? <span style={{ fontWeight: 400, color: 'var(--text-caption)' }}> · {resident.separation_reason}</span> : null}</>}
          </Line>
        </>
      ))}
    </section>
  )
}
