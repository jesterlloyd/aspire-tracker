// NGRP-RELEASE-2: applicant detail drawer, now operational. Identity is the
// canonical ASPIRE student record; cycle state renders from the composed
// candidate row (form lifecycle from ngrp_transition_assignments, prefs from
// the latest revision). Staff actions - send/resend, review the submitted
// form, override eligibility, confirm/withdraw the application, revoke the
// link - are explicit, audited server-side, and every consequential one has
// its own confirm step. Confirmation is the ONLY path to "Confirmed";
// nothing here (or anywhere) confirms automatically.
import { useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import StudentAvatar from '../StudentAvatar'
import NgrpStatusPill from './NgrpStatusPill'
import {
  FORM_STATES, INTEREST_STATES, ELIGIBILITY_STATES, APPLICATION_STATES,
  INTERVIEW_STATES, effectiveEligibility, formTimestamp,
} from '../../lib/ngrp/ngrpStates'
import { displayName } from '../../lib/utils'

const F = 'Plus Jakarta Sans, sans-serif'
const fmt = ts => {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const smallBtn = (primary = false, danger = false) => ({
  height: 30, padding: '0 12px', borderRadius: 8, fontFamily: F, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: primary || danger ? 'none' : '1px solid rgba(29,37,103,0.15)',
  background: danger ? '#FEF2F2' : primary ? '#1D2567' : '#fff',
  color: danger ? '#B3282D' : primary ? '#fff' : '#1D2567',
  ...(danger ? { border: '1px solid #FECACA' } : {}),
})

function Section({ title, tint, children, right }) {
  return (
    <section style={{ background: tint, borderRadius: 12, padding: '13px 15px', marginBottom: 10 }}>
      <h3 style={{
        margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #6b7280)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        paddingBottom: 8, borderBottom: '1px solid rgba(0,0,0,0.045)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ flex: 1 }}>{title}</span>
        {right}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ color: '#6B7785', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--raven, #191919)', textAlign: 'right', minWidth: 0 }}>{children}</span>
    </div>
  )
}

function FormLifecycle({ row }) {
  const steps = [
    { key: 'sent', label: 'Sent', at: row.form_sent_at },
    { key: 'opened', label: 'Opened', at: row.form_opened_at },
    { key: 'in_progress', label: 'Draft', at: row.form_last_saved_at },
    { key: 'submitted', label: 'Submitted', at: row.form_submitted_at },
  ]
  const orderIdx = { not_sent: -1, sent: 0, opened: 1, in_progress: 2, submitted: 3, revised: 3 }
  const reached = orderIdx[row.form_status] ?? -1
  return (
    <div style={{ display: 'flex', margin: '4px 0 6px' }} aria-hidden="true">
      {steps.map((s, i) => (
        <div key={s.key} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
          {i > 0 && <div style={{ position: 'absolute', top: 6, left: '-50%', width: '100%', height: 2, background: i <= reached ? '#2F7D5C' : '#E5E7EB' }} />}
          <div style={{
            width: 14, height: 14, borderRadius: '50%', margin: '0 auto 5px', position: 'relative', zIndex: 1,
            border: '2px solid #fff', background: i <= reached ? '#2F7D5C' : '#E5E7EB',
            boxShadow: `0 0 0 1px ${i <= reached ? '#2F7D5C' : '#D1D5DB'}`,
          }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: i <= reached ? '#1F3219' : '#9CA3AF' }}>{s.label}</div>
          <div style={{ fontSize: 9, color: '#9CA3AF' }}>{fmt(s.at) || '—'}</div>
        </div>
      ))}
    </div>
  )
}

const REQ_GLYPHS = { met: '✓', not_met: '✗', conditional: '◔', unknown: '·' }
const REQ_COLORS = { met: '#166534', not_met: '#991B1B', conditional: '#92400E', unknown: '#6B7280' }

// A compact read-only render of a submitted revision for staff review.
function RevisionSummary({ payload }) {
  if (!payload) return null
  const rows = []
  const push = (label, v) => { if (v !== undefined && v !== null && v !== '') rows.push([label, String(v)]) }
  push('Preferred email', payload.identity?.preferred_email)
  push('Preferred phone', payload.identity?.preferred_phone)
  push('CS employment', payload.identity?.cs_employment_status?.replace(/_/g, ' '))
  push('Degree', payload.education?.degree_type)
  push('Completion date', payload.education?.completion_date)
  push('GPA', payload.education?.gpa)
  push('US accredited', payload.education?.us_accredited === true ? 'Yes' : payload.education?.us_accredited === false ? 'No' : undefined)
  push('Precepted unit', payload.aspire?.precepted_unit)
  push('Rotation hours', payload.aspire?.rotation_hours)
  push('Prior NGRP application', payload.aspire?.prior_ngrp_applied === true ? `Yes${payload.aspire?.prior_ngrp_details ? ` - ${payload.aspire.prior_ngrp_details}` : ''}` : payload.aspire?.prior_ngrp_applied === false ? 'No' : undefined)
  push('CA RN license', payload.licensure?.ca_rn_status)
  push('License #', payload.licensure?.license_number)
  push('NCLEX scheduled', payload.licensure?.nclex_scheduled_date)
  push('Paid RN months', payload.licensure?.paid_rn_months)
  push('BLS', payload.licensure?.bls_status ? `${payload.licensure.bls_status}${payload.licensure.bls_issuer ? ` (${payload.licensure.bls_issuer})` : ''}${payload.licensure.bls_expiration ? ` exp ${payload.licensure.bls_expiration}` : ''}` : undefined)
  if (payload.licensure?.acls_required) push('ACLS', payload.licensure?.acls_status || 'required, not reported')
  push('Interest', payload.residency_interest?.interest?.replace(/_/g, ' '))
  push('Interest statement', payload.residency_interest?.interest_statement)
  push('Strengths', payload.residency_interest?.strengths_statement)
  const ready = Object.entries(payload.readiness || {}).filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, ' '))
  if (ready.length) push('Readiness checked', ready.join(', '))
  return (
    <div style={{ marginTop: 8 }}>
      {rows.map(([label, v]) => (
        <div key={label} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '3px 0', borderBottom: '1px dashed rgba(0,0,0,0.05)' }}>
          <span style={{ color: '#6B7785', flexShrink: 0, minWidth: 120 }}>{label}</span>
          <span style={{ color: '#191919', overflowWrap: 'anywhere' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function OverrideDialog({ open, onClose, onSubmit, busy }) {
  const [result, setResult] = useState('eligible')
  const [category, setCategory] = useState('documentation_verified')
  const [note, setNote] = useState('')
  if (!open) return null
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: 2098 }} />
      <div role="dialog" aria-modal="true" aria-label="Override eligibility" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(460px, calc(100vw - 32px))', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 2099, fontFamily: F,
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #F3F4F6', fontSize: 15, fontWeight: 700 }}>Override eligibility</div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <p style={{ margin: 0, fontSize: 12, color: '#6B7785' }}>
            The calculated result is never overwritten - the override becomes the effective result and
            is recorded with your name and timestamp.
          </p>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: '#4A5560' }}>Replacement result
            <select value={result} onChange={e => setResult(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, height: 34, padding: '0 8px', border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8, fontFamily: F, fontSize: 13 }}>
              <option value="eligible">Eligible</option>
              <option value="conditionally_eligible">Conditionally Eligible</option>
              <option value="not_eligible">Not Eligible</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: '#4A5560' }}>Reason category
            <select value={category} onChange={e => setCategory(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, height: 34, padding: '0 8px', border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8, fontFamily: F, fontSize: 13 }}>
              <option value="documentation_verified">Documentation verified outside the form</option>
              <option value="requirement_waived">Requirement waived</option>
              <option value="data_correction">Data correction</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: '#4A5560' }}>Narrative note (required)
            <textarea value={note} onChange={e => setNote(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 70, padding: 8, border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8, fontFamily: F, fontSize: 13, boxSizing: 'border-box' }} />
          </label>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={smallBtn()} onClick={onClose}>Cancel</button>
          <button type="button" style={smallBtn(true)} disabled={busy || !note.trim()}
            onClick={() => onSubmit({ result, reason_category: category, note: note.trim() })}>
            {busy ? 'Saving…' : 'Record override'}
          </button>
        </div>
      </div>
    </>
  )
}

// Thin wrapper: keying the body by the row id resets every transient state
// (review load, confirms, override dialog) by REMOUNT when the selected
// applicant changes - no reset effect needed.
// ── NGRP-INTERVIEW-HIRE-1 sections ─────────────────────────────────────────

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time; a stored timestamptz is
// UTC. Converting through the epoch keeps the displayed time the one the
// interview is actually at, rather than sliding it by the offset.
function toLocalInput(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = v => (v ? new Date(v).toISOString() : null)
const dateOnly = ts => (ts ? String(ts).slice(0, 10) : '')

const field = {
  height: 30, padding: '0 8px', border: '1px solid rgba(29,37,103,0.14)', borderRadius: 7,
  fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 12.5, background: '#fff', color: '#191919',
  width: '100%', boxSizing: 'border-box',
}

// Which states keep the time the interview was held at. 'scheduled' REQUIRES
// one; the states meaning it never happened drop it.
const KEEPS_TIME = ['scheduled', 'completed', 'decision_recorded', 'no_show']

function InterviewSection({ row, canManage, onSave }) {
  const [status, setStatus] = useState(row.interview_status || 'not_scheduled')
  const [at, setAt] = useState(toLocalInput(row.interview_at))
  const [busy, setBusy] = useState(false)
  const dirty = status !== (row.interview_status || 'not_scheduled') || at !== toLocalInput(row.interview_at)
  const needsTime = status === 'scheduled' && !at

  return (
    <Section title="Interview" tint="rgba(150,120,150,0.06)">
      <Row label="Status"><NgrpStatusPill config={INTERVIEW_STATES} value={row.interview_status} srPrefix="Interview" /></Row>
      {row.interview_at && <Row label="Held">{fmt(row.interview_at)}</Row>}
      {canManage && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5560' }}>Interview state</span>
            <select style={field} value={status} onChange={e => setStatus(e.target.value)}>
              {Object.entries(INTERVIEW_STATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          {KEEPS_TIME.includes(status) && (
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5560' }}>
                Date and time{status === 'scheduled' ? '' : ' (optional)'}
              </span>
              <input type="datetime-local" style={{ ...field, borderColor: needsTime ? '#B3282D' : field.border }}
                value={at} onChange={e => setAt(e.target.value)} />
            </label>
          )}
          {needsTime && <p style={{ margin: 0, fontSize: 11, color: '#B3282D' }}>A scheduled interview needs a date and time.</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...smallBtn(true), opacity: !dirty || needsTime || busy ? 0.5 : 1 }}
              disabled={!dirty || needsTime || busy}
              onClick={async () => {
                setBusy(true)
                await onSave({ status, interview_at: KEEPS_TIME.includes(status) ? fromLocalInput(at) : null })
                setBusy(false)
              }}
            >
              {busy ? 'Saving…' : 'Save interview'}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF' }}>
            No interview rubric or score is stored anywhere in ASPIRE.
          </p>
        </div>
      )}
    </Section>
  )
}

function OutcomeSection({ row, canManage, onSave }) {
  const o = row.outcome || {}
  const init = {
    offer_extended_at: toLocalInput(o.offer_extended_at),
    offer_accepted_at: toLocalInput(o.offer_accepted_at),
    hired_at: toLocalInput(o.hired_at),
    // A hire almost always lands in the unit HR assigned, so that is the
    // starting point rather than an empty box.
    hired_unit: o.hired_unit || row.assigned_unit || '',
    residency_start_date: dateOnly(o.residency_start_date),
  }
  const [form, setForm] = useState(init)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const dirty = JSON.stringify(form) !== JSON.stringify(init)
  const confirmed = row.application_status === 'confirmed'

  const problem =
    form.offer_accepted_at && !form.offer_extended_at ? 'Record the offer before recording that it was accepted.'
    : form.hired_at && !form.offer_accepted_at ? 'Record the accepted offer before recording the hire.'
    : form.hired_at && !form.hired_unit.trim() ? 'A hire needs the unit they were hired into.'
    : null

  return (
    <Section title="Residency Outcome" tint="rgba(110,150,135,0.075)">
      {!confirmed ? (
        <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>
          Only an applicant on the official NGRP list can carry an offer or a hire.
        </p>
      ) : (
        <>
          {o.hired_at
            ? <Row label="Hired">{fmt(o.hired_at)}{o.hired_unit ? ` · ${o.hired_unit}` : ''}</Row>
            : o.offer_accepted_at
              ? <Row label="Offer accepted">{fmt(o.offer_accepted_at)}</Row>
              : o.offer_extended_at
                ? <Row label="Offer extended">{fmt(o.offer_extended_at)}</Row>
                : <Row label="Status"><span style={{ fontWeight: 400, color: '#9CA3AF' }}>Nothing recorded yet</span></Row>}
          {o.residency_start_date && <Row label="Residency starts">{o.residency_start_date}</Row>}

          {canManage && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                ['offer_extended_at', 'Offer extended'],
                ['offer_accepted_at', 'Offer accepted'],
                ['hired_at', 'Hired'],
              ].map(([k, label]) => (
                <label key={k} style={{ display: 'block' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5560' }}>{label}</span>
                  <input type="datetime-local" style={field} value={form[k]} onChange={e => set(k, e.target.value)} />
                </label>
              ))}
              <label style={{ display: 'block' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5560' }}>Hired into unit</span>
                <input style={field} value={form.hired_unit} onChange={e => set('hired_unit', e.target.value)} placeholder="Unit name" />
              </label>
              <label style={{ display: 'block' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5560' }}>Residency start date</span>
                <input type="date" style={field} value={form.residency_start_date} onChange={e => set('residency_start_date', e.target.value)} />
              </label>
              {problem && <p style={{ margin: 0, fontSize: 11, color: '#B3282D' }}>{problem}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={{ ...smallBtn(true), opacity: !dirty || problem || busy ? 0.5 : 1 }}
                  disabled={!dirty || Boolean(problem) || busy}
                  onClick={async () => {
                    setBusy(true)
                    await onSave({
                      offer_extended_at: fromLocalInput(form.offer_extended_at),
                      offer_accepted_at: fromLocalInput(form.offer_accepted_at),
                      hired_at: fromLocalInput(form.hired_at),
                      hired_unit: form.hired_unit.trim() || null,
                      residency_start_date: form.residency_start_date || null,
                    })
                    setBusy(false)
                  }}
                >
                  {busy ? 'Saving…' : 'Save outcome'}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF' }}>
                A recorded hire is durable employment history. It is what excludes this alumnus from
                a later residency cohort, and it can never be deleted, only corrected.
              </p>
            </div>
          )}
        </>
      )}
    </Section>
  )
}

export default function ApplicantDrawer(props) {
  if (!props.open || !props.row) return null
  return <ApplicantDrawerBody key={props.row.id} {...props} />
}

function ApplicantDrawerBody({
  open, row, cycle, canManage, provisioned, onClose, actions = {},
}) {
  const [review, setReview] = useState(null)
  const [reviewState, setReviewState] = useState('idle')
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null) // 'confirm' | 'withdraw' | 'revoke'
  const s = row.student
  const elig = effectiveEligibility(row)
  const overridden = Boolean(row.eligibility_effective)
  const reasons = Array.isArray(row.eligibility_reasons) ? row.eligibility_reasons : []
  const prefs = [row.unit_preference_1, row.unit_preference_2, row.unit_preference_3]
  const hasForm = row.form_status !== 'not_sent'
  const hasSubmission = (row.form_revision_count || 0) > 0
  const gateNote = provisioned ? null : 'Available once the pending NGRP migration is applied'

  const loadReview = async () => {
    if (!actions.review || reviewState === 'loading') return
    setReviewState('loading')
    const res = await actions.review(row)
    if (res && res.ok !== false) { setReview(res); setReviewState('ready') }
    else setReviewState('error')
  }

  const guarded = async (fn) => { setBusy(true); try { await fn() } finally { setBusy(false); setConfirming(null) } }

  const confirmBar = (kind, text, run, danger = false) => (
    confirming === kind ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: danger ? '#B3282D' : '#4A5560', fontFamily: F }}>{text}</span>
        <button type="button" style={smallBtn(true)} disabled={busy} onClick={() => guarded(run)}>{busy ? 'Working…' : 'Yes'}</button>
        <button type="button" style={smallBtn()} onClick={() => setConfirming(null)}>No</button>
      </span>
    ) : null
  )

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={`${displayName(s)} · NGRP`}
      footer={canManage ? (
        <>
          {gateNote && <span style={{ marginRight: 'auto', fontSize: 11, color: '#9CA3AF' }}>{gateNote}</span>}
          {!gateNote && confirming === 'confirm' && confirmBar('confirm',
            'Place this alumnus on the official NGRP applicant list?',
            async () => { await actions.confirmApplication?.(row) })}
          {!gateNote && confirming !== 'confirm' && (
            <>
              <button type="button" style={smallBtn()} disabled={!provisioned}
                onClick={() => actions.sendForm?.(row)}>
                {hasForm ? 'Resend Form' : 'Send Transition Form'}
              </button>
              {row.application_status !== 'confirmed' && (
                <button type="button" style={smallBtn(true)} disabled={!provisioned}
                  onClick={() => setConfirming('confirm')}>
                  Confirm Application
                </button>
              )}
            </>
          )}
        </>
      ) : null}
    >
      {/* Identity hero - canonical ASPIRE student record */}
      <div style={{
        background: 'linear-gradient(160deg, #dceff8 0%, #f0f6fb 55%, #ffffff 100%)',
        borderRadius: 12, padding: '20px 16px 16px', textAlign: 'center', marginBottom: 12,
      }}>
        <StudentAvatar student={s} size={72} style={{ margin: '0 auto 10px', border: '4px solid #fff', boxShadow: '0 4px 18px rgba(29,37,103,0.16)' }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1D2567', lineHeight: 1.2 }}>{displayName(s)}</div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
          {[s.school, s.program_type].filter(Boolean).join(' · ')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
          {s.aspire_cohort && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#EDF0F7', color: '#4A5D8F' }}>
              ASPIRE · {s.aspire_cohort}
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#f0fdf4', color: '#14532d', border: '1px solid #4ade80' }}>
            ASPIRE Completed
          </span>
          {cycle && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#EDEEF4', color: '#1D2567' }}>
              {cycle.name}
            </span>
          )}
        </div>
      </div>

      <Section
        title="Transition Form" tint="rgba(96,120,170,0.055)"
        right={canManage && hasForm && provisioned ? (
          confirming === 'revoke'
            ? confirmBar('revoke', 'Revoke the live link? The alumnus loses access until a resend.', async () => { await actions.revokeLink?.(row) }, true)
            : <button type="button" style={{ ...smallBtn(false, true), height: 24, padding: '0 9px', fontSize: 11 }} onClick={() => setConfirming('revoke')}>Revoke link</button>
        ) : null}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <NgrpStatusPill config={FORM_STATES} value={row.form_status} srPrefix="Transition Form" />
          {row.form_status === 'revised' && (row.form_revision_count || 0) > 0 && (
            <span style={{ fontSize: 11, color: '#6B7785' }}>
              Revision {row.form_revision_count} · latest {fmt(row.form_revised_at) || '—'}
            </span>
          )}
        </div>
        <FormLifecycle row={row} />
        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#9CA3AF' }}>
          Alumni can revise a submitted form until the cycle deadline
          {cycle?.application_deadline ? ` (${cycle.application_deadline})` : ''}. Sending the form
          records “Transition Form Sent” - it is not an invitation to apply.
        </p>
        {hasSubmission && (
          <div style={{ marginTop: 10 }}>
            {reviewState === 'idle' && (
              <button type="button" style={smallBtn()} onClick={loadReview}>Review submitted form</button>
            )}
            {reviewState === 'loading' && <span style={{ fontSize: 12, color: '#6B7785', fontFamily: F }}>Loading submission…</span>}
            {reviewState === 'error' && <span style={{ fontSize: 12, color: '#B3282D', fontFamily: F }}>The submission could not load - try again.</span>}
            {reviewState === 'ready' && review?.latestRevision && (
              <>
                <Row label={`Revision ${review.latestRevision.revision_number}`}>{fmt(review.latestRevision.submitted_at)}</Row>
                <RevisionSummary payload={review.latestRevision.payload} />
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Residency Interest" tint="rgba(96,120,170,0.055)">
        <Row label="Interest"><NgrpStatusPill config={INTEREST_STATES} value={row.interest} /></Row>
        {row.interest === 'no_response' && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
            No response yet - a neutral state, not a decline.
          </p>
        )}
      </Section>

      <Section
        title="Eligibility" tint="rgba(110,150,135,0.075)"
        right={canManage && provisioned ? (
          <button type="button" style={{ ...smallBtn(), height: 24, padding: '0 9px', fontSize: 11 }} onClick={() => setOverrideOpen(true)}>Override…</button>
        ) : null}
      >
        <Row label="Calculated result">
          <NgrpStatusPill config={ELIGIBILITY_STATES} value={row.eligibility_calculated} />
        </Row>
        {overridden && (
          <>
            <Row label="Effective result (staff override)">
              <NgrpStatusPill config={ELIGIBILITY_STATES} value={elig} />
            </Row>
            <Row label="Override reason">
              <span style={{ fontWeight: 400, color: '#5A6170' }}>{row.eligibility_override_reason || '—'}</span>
            </Row>
            {row.eligibility_overridden_at && (
              <Row label={`Overridden${row.eligibility_overridden_by_name ? ` by ${row.eligibility_overridden_by_name}` : ''}`}>
                {fmt(row.eligibility_overridden_at)}
              </Row>
            )}
          </>
        )}
        {reasons.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            {reasons.map((r, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12,
                padding: '5px 0', borderBottom: i < reasons.length - 1 ? '1px dashed rgba(0,0,0,0.06)' : 'none',
              }}>
                <span aria-hidden="true" style={{ flexShrink: 0, width: 14, textAlign: 'center', color: REQ_COLORS[r.status] || (r.met ? '#166534' : '#92400e'), fontWeight: 700 }}>
                  {REQ_GLYPHS[r.status] || (r.met ? '✓' : '·')}
                </span>
                <span style={{ color: '#5A6170', flex: 1 }}>
                  {r.label}{r.detail ? <span style={{ color: '#9CA3AF' }}> - {r.detail}</span> : null}
                </span>
                {r.deadline && <span style={{ color: '#92400E', fontWeight: 600, whiteSpace: 'nowrap' }}>due {r.deadline}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
            Requirement detail appears once a submitted form has been evaluated for this cycle.
          </p>
        )}
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9CA3AF' }}>
          Optional support participation never affects eligibility. An eligible result is not an
          official application.
        </p>
      </Section>

      <Section title="Unit Preferences & Assignment" tint="rgba(212,184,138,0.10)">
        {prefs.some(Boolean) ? prefs.map((u, i) => u && (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' }}>
            <span style={{
              width: 20, height: 20, borderRadius: 6, background: '#EDEEF4', color: '#1D2567',
              fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{i + 1}</span>
            <span style={{ fontWeight: 600 }}>{u}</span>
          </div>
        )) : (
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>Ranked preferences arrive with the submitted Transition Form.</p>
        )}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', marginTop: 8, paddingTop: 8 }}>
          <Row label="HR-assigned unit">
            {row.assigned_unit
              ? <span>{row.assigned_unit}</span>
              : <span style={{ fontWeight: 400, color: '#6b7280' }}>No assignment</span>}
          </Row>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9CA3AF' }}>
            Ranked preferences are the alumnus’s request; HR selects the one assigned unit and interview.
          </p>
        </div>
      </Section>

      <Section
        title="Official Application" tint="rgba(150,120,150,0.06)"
        right={canManage && provisioned && row.application_status !== 'withdrawn' ? (
          confirming === 'withdraw'
            ? confirmBar('withdraw', 'Record a withdrawal? (Neutral, never a demerit.)', async () => { await actions.withdraw?.(row) })
            : <button type="button" style={{ ...smallBtn(), height: 24, padding: '0 9px', fontSize: 11 }} onClick={() => setConfirming('withdraw')}>Record withdrawal</button>
        ) : null}
      >
        <Row label="Status"><NgrpStatusPill config={APPLICATION_STATES} value={row.application_status} /></Row>
        {row.application_confirmed_at && <Row label="Confirmed">{fmt(row.application_confirmed_at)}</Row>}
        {row.application_withdrawn_at && <Row label="Withdrawn">{fmt(row.application_withdrawn_at)}</Row>}
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF' }}>
          Only “Confirmed” means this alumnus appears on the official NGRP applicant list - and only
          through the explicit action below, matched against the official list. A submitted form or an
          eligible result never confirms anything automatically.
        </p>
      </Section>

      {/* NGRP-INTERVIEW-HIRE-1: the interview record, editable here rather than
          on the board, because this drawer is already where one person's record
          is edited and a second editing surface would be a second truth.
          WORKFLOW state, so it writes to ngrp_candidates.
          NO RUBRIC AND NO SCORE, by explicit Owner decision: who was
          interviewed and what came of it, never how they were graded. */}
      <InterviewSection
        row={row}
        canManage={canManage && provisioned}
        onSave={fields => actions.setInterview?.(row, fields)}
      />

      {/* The DURABLE employment record, in its own table with RESTRICT foreign
          keys and DELETE revoked even from service_role. Only an applicant on
          the official list can carry one. */}
      <OutcomeSection
        row={row}
        canManage={canManage && provisioned}
        onSave={fields => actions.setOutcome?.(row, fields)}
      />

      <Section title="Activity" tint="rgba(120,124,134,0.05)">
        {row.candidate_id ? (
          <>
            {formTimestamp(row) && <Row label="Latest form activity">{fmt(formTimestamp(row))}</Row>}
            {reviewState === 'ready' && (review?.tokens || []).length > 0 && (
              <Row label="Latest link">
                <span style={{ fontWeight: 400, color: '#6B7785' }}>
                  #{review.tokens[0].token_hash_prefix} · issued {fmt(review.tokens[0].created_at)}
                  {review.tokens[0].revoked_at ? ' · revoked' : ''}
                </span>
              </Row>
            )}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>
            No NGRP activity yet for this cycle. A candidate record is created with the first
            NGRP action (for example, sending the Transition Form).
          </p>
        )}
      </Section>

      <OverrideDialog
        open={overrideOpen}
        busy={busy}
        onClose={() => setOverrideOpen(false)}
        onSubmit={fields => guarded(async () => { await actions.override?.(row, fields); setOverrideOpen(false) })}
      />
    </DetailDrawer>
  )
}
