// NGRP-PLANNING-2: "+ Add Cohort" - lifted out of PlanningTab so the header's
// Scope picker and the Planning tab open the SAME dialog rather than growing
// two creation paths. Behavior is unchanged: enter, review, create, and the new
// cohort always lands in Planning status (it never opens on a date).
import { useState } from 'react'
import { useNgrpPlanning, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { F, inputStyle, labelStyle, btn } from '../../lib/ngrp/ngrpCohortForm'
import { Field, ModalShell } from './NgrpFormUi'

export default function CreateCohortDialog({ onClose, onCreated }) {
  // The dialog fetches its OWN ASPIRE cohort list (planning with no cycle_id),
  // so the header can open it without the Planning tab being mounted.
  const planning = useNgrpPlanning(null)
  const aspireCohorts = [...(planning.data?.aspireCohorts || [])]
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))

  const [step, setStep] = useState('edit')
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [start, setStart] = useState('')
  const [sourceIds, setSourceIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])

  const create = async () => {
    setBusy(true)
    setErrors([])
    const res = await postNgrpManage('cycle_create', {
      cycle: { name, status: 'Planning', application_deadline: deadline || null, residency_start_date: start || null },
      source_cohort_ids: sourceIds,
    })
    setBusy(false)
    if (!res.ok) { setErrors(res.errors.length ? res.errors : [{ message: res.error || 'Could not create the cohort.' }]); setStep('edit'); return }
    onCreated(res.cycle)
  }

  const names = aspireCohorts.filter(c => sourceIds.includes(c.id)).map(c => c.name)
  return (
    <ModalShell label="Add residency cohort" onClose={onClose} width={560}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 15, fontWeight: 700 }}>
        {step === 'edit' ? 'Add residency cohort' : 'Review and confirm'}
      </div>
      <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
        {step === 'edit' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Name (e.g. August 2027)"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Application closing date (needed before forms can send - can be set later)">
              <input type="date" style={inputStyle} value={deadline} onChange={e => setDeadline(e.target.value)} /></Field>
            <Field label="Residency start date (optional)">
              <input type="date" style={inputStyle} value={start} onChange={e => setStart(e.target.value)} /></Field>
            <div>
              <label style={labelStyle}>Source ASPIRE cohorts</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {aspireCohorts.map(c => {
                  const on = sourceIds.includes(c.id)
                  return (
                    <button key={c.id} type="button" aria-pressed={on}
                      onClick={() => setSourceIds(prev => on ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                      style={{ ...btn(), height: 32, background: on ? '#EDEEF4' : '#fff', border: on ? '1.5px solid #1D2567' : '1px solid rgba(29,37,103,0.15)', fontWeight: on ? 700 : 500 }}>
                      {c.name}
                    </button>
                  )
                })}
                {planning.status === 'loading' && !aspireCohorts.length && (
                  <span style={{ fontSize: 12.5, color: '#9CA3AF', fontFamily: F }}>Loading ASPIRE cohorts…</span>
                )}
                {planning.status !== 'loading' && !aspireCohorts.length && (
                  <span style={{ fontSize: 12.5, color: '#9CA3AF', fontFamily: F }}>No ASPIRE cohorts exist yet.</span>
                )}
              </div>
            </div>
            {errors.map((e2, i) => <p key={i} style={{ margin: 0, fontSize: 12.5, color: '#B3282D' }}>{e2.message}</p>)}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#4A5560', lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 8px' }}><b>{name}</b> will be created in <b>Planning</b> status (it never opens automatically).</p>
            <p style={{ margin: '0 0 8px' }}>Source ASPIRE cohorts: {names.length ? <b>{names.join(', ')}</b> : <i>none yet - the Applicants roster stays empty until cohorts are mapped</i>}.</p>
            <p style={{ margin: 0 }}>Application closes: {deadline ? <b>{deadline}</b> : <i>not set - required before Transition Forms can send</i>}.</p>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" style={btn()} onClick={step === 'edit' ? onClose : () => setStep('edit')}>{step === 'edit' ? 'Cancel' : 'Back'}</button>
        {step === 'edit'
          ? <button type="button" style={btn(true)} disabled={!name.trim()} onClick={() => setStep('review')}>Review</button>
          : <button type="button" style={btn(true)} disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Add cohort'}</button>}
      </div>
    </ModalShell>
  )
}
