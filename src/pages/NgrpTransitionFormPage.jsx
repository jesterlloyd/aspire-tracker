// NGRP-RELEASE-2: the public NGRP Transition Form. Reached only through a
// personal tokenized link (fragment #t=..., stripped from the address bar on
// load - fragments never reach a server). No portal account is involved; the
// server resolves the one assignment from the token hash and nothing else.
//
// Follows the public evaluation-page conventions: lazy token init, page CSS
// injected into <head>, no-referrer meta, one exhaustive `view` string, and
// quiet behavior - the autosave line updates in place, and there is never a
// "draft restored" toast (a single static line notes a restored draft once).
import { useState, useEffect, useRef, useCallback } from 'react'
import { DEFAULT_APPLICATION_CHECKLIST } from '../../lib/server/ngrpEligibility.js'

const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/
const F = "'DM Sans', system-ui, sans-serif"

const EMPTY_PAYLOAD = {
  identity: { preferred_email: '', preferred_phone: '', cs_employment_status: null },
  education: { school: '', program: '', degree_type: '', completion_date: '', gpa: '', us_accredited: null },
  aspire: { aspire_cohort: '', precepted_unit: '', rotation_hours: '', prior_ngrp_applied: null, prior_ngrp_details: '' },
  licensure: {
    ca_rn_status: null, license_number: '', nclex_scheduled_date: '', paid_rn_months: '',
    bls_status: null, bls_issuer: '', bls_expiration: '',
    acls_required: false, acls_status: null, acls_issuer: '', acls_expiration: '',
  },
  residency_interest: { interest: null, unit_preferences: ['', '', ''], interest_statement: '', strengths_statement: '' },
  readiness: {},
  attestation: { accurate: false, consent_followup: false },
}

function mergePayload(base) {
  if (!base || typeof base !== 'object') return structuredClone(EMPTY_PAYLOAD)
  const out = structuredClone(EMPTY_PAYLOAD)
  for (const section of Object.keys(out)) {
    if (base[section] && typeof base[section] === 'object') {
      out[section] = { ...out[section], ...base[section] }
    }
  }
  const prefs = base?.residency_interest?.unit_preferences
  out.residency_interest.unit_preferences = [prefs?.[0] || '', prefs?.[1] || '', prefs?.[2] || '']
  return out
}

const CSS = `
  .ngrpf-page { min-height: 100vh; background: #F4F1EC; font-family: ${F}; color: #191919; padding: 24px 14px 64px; }
  .ngrpf-shell { max-width: 720px; margin: 0 auto; }
  .ngrpf-mast { background: #1D2567; color: #fff; border-radius: 14px 14px 0 0; padding: 22px 26px; }
  .ngrpf-mast h1 { margin: 0 0 4px; font-size: 21px; font-weight: 700; }
  .ngrpf-mast p { margin: 0; font-size: 13px; color: rgba(255,255,255,0.75); }
  .ngrpf-card { background: #fff; border: 1px solid #e8e4dc; border-top: none; border-radius: 0 0 14px 14px; padding: 24px 26px; }
  .ngrpf-note { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1D4ED8; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; margin: 0 0 18px; }
  .ngrpf-sec { margin: 0 0 26px; }
  .ngrpf-sec h2 { font-size: 14px; font-weight: 700; color: #1D2567; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 2px solid #EDEEF4; padding-bottom: 7px; margin: 0 0 14px; }
  .ngrpf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .ngrpf-field { display: flex; flex-direction: column; gap: 5px; }
  .ngrpf-field.full { grid-column: 1 / -1; }
  .ngrpf-field label { font-size: 12px; font-weight: 600; color: #4A5560; }
  .ngrpf-field .req { color: #B3282D; }
  .ngrpf-field input, .ngrpf-field select, .ngrpf-field textarea {
    font-size: 16px; /* FORMS-MOBILE-RESPONSIVE: prevent iOS auto-zoom */
    font-family: ${F}; padding: 9px 11px; border: 1px solid #d7d2c8; border-radius: 8px; background: #fff; color: #191919;
  }
  .ngrpf-field textarea { min-height: 96px; resize: vertical; }
  .ngrpf-field input:focus, .ngrpf-field select:focus, .ngrpf-field textarea:focus { outline: 2px solid #4F6DA8; outline-offset: 1px; }
  .ngrpf-opts { display: flex; flex-wrap: wrap; gap: 8px; }
  .ngrpf-opt { display: flex; align-items: center; gap: 7px; border: 1px solid #d7d2c8; border-radius: 999px; padding: 8px 14px; min-height: 44px; font-size: 13.5px; cursor: pointer; background: #fff; }
  .ngrpf-opt.on { border-color: #1D2567; background: #EDEEF4; font-weight: 600; }
  .ngrpf-check { display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; font-size: 13.5px; cursor: pointer; min-height: 44px; }
  .ngrpf-check input { width: 17px; height: 17px; margin-top: 2px; accent-color: #1D2567; }
  .ngrpf-static { background: #F9FAFB; border: 1px solid #EFEDE8; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; color: #4A5560; }
  .ngrpf-error { color: #B3282D; font-size: 12.5px; margin: 4px 0 0; }
  .ngrpf-submitrow { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .ngrpf-submit { min-height: 52px; width: 100%; border: none; border-radius: 10px; background: #1D2567; color: #fff; font-family: ${F}; font-size: 15.5px; font-weight: 700; cursor: pointer; }
  .ngrpf-submit:disabled { opacity: 0.55; cursor: not-allowed; }
  .ngrpf-saved { font-size: 12px; color: #6B7785; text-align: center; min-height: 16px; }
  .ngrpf-state { max-width: 560px; margin: 12vh auto 0; background: #fff; border: 1px solid #e8e4dc; border-radius: 14px; padding: 34px 30px; text-align: center; }
  .ngrpf-state h1 { font-size: 19px; margin: 0 0 10px; color: #1D2567; }
  .ngrpf-state p { font-size: 14px; color: #4A5560; margin: 0; line-height: 1.6; }
  @media (max-width: 620px) { .ngrpf-grid { grid-template-columns: 1fr; } .ngrpf-card, .ngrpf-mast { padding: 18px 16px; } }
`

// Server error fields → the input that fixes them (the pill-group fields
// scroll to the summary only; their labels carry the group name).
const FIELD_TO_INPUT_ID = {
  'identity.preferred_email': 'pe',
  'education.completion_date': 'cd',
  'education.gpa': 'gpa',
  'licensure.license_number': 'ln',
  'licensure.nclex_scheduled_date': 'nd',
  'licensure.paid_rn_months': 'pm',
  'licensure.bls_issuer': 'bi',
  'licensure.bls_expiration': 'be',
  'licensure.acls_issuer': 'ai',
  'residency_interest.unit_preferences': 'pref0',
  'residency_interest.interest_statement': 'is',
}
const focusField = id => {
  const el = document.getElementById(id)
  if (el) { el.scrollIntoView({ block: 'center' }); el.focus() }
}

const preventImplicitSubmit = e => {
  if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA' && e.target.type !== 'submit') {
    e.preventDefault()
  }
}

export default function NgrpTransitionFormPage() {
  const [initial] = useState(() => {
    const match = TOKEN_PATTERN.exec(window.location.hash)
    return { rawToken: match ? match[1] : null, valid: !!match }
  })
  const [view, setView] = useState(initial.valid ? 'loading' : 'invalid')
  const [meta, setMeta] = useState(null)
  const [payload, setPayload] = useState(() => structuredClone(EMPTY_PAYLOAD))
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [savedLine, setSavedLine] = useState('')
  const [errors, setErrors] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const saveTimer = useRef(null)
  const dirtyRef = useRef(false)
  const errorSummaryRef = useRef(null)

  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m)
    const s = document.createElement('style'); s.id = 'ngrpf-css'; s.textContent = CSS; document.head.appendChild(s)
    window.history.replaceState(null, '', window.location.pathname)
    return () => { document.head.removeChild(m); const el = document.getElementById('ngrpf-css'); if (el) document.head.removeChild(el) }
  }, [])

  const post = useCallback(async (action, extra = {}) => {
    const res = await fetch('/api/ngrp-transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: initial.rawToken, ...extra }),
    })
    let body = null
    try { body = await res.json() } catch { /* non-JSON */ }
    return { status: res.status, body }
  }, [initial.rawToken])

  // Load once.
  useEffect(() => {
    if (!initial.valid) return
    let cancelled = false
    ;(async () => {
      const { status, body } = await post('load')
      if (cancelled) return
      if (status === 200 && body) {
        setMeta(body)
        setPayload(mergePayload(body.base || {
          identity: { preferred_email: body.suggestedEmail || '' },
          education: { school: body.school || '', program: body.program || '' },
          aspire: { aspire_cohort: body.aspireCohort || '' },
        }))
        setRestoredDraft(body.baseKind === 'draft')
        setView(body.state === 'closed' ? 'closed' : 'form')
      } else if (status === 410) { setErrorMessage(body?.error || 'This form link is no longer valid.'); setView('invalid') }
      else if (status === 429) setView('rate_limited')
      else setView('error')
    })()
    return () => { cancelled = true }
  }, [initial.valid, post])

  // Quiet debounced autosave: updates the single active draft only.
  const scheduleSave = useCallback((nextPayload) => {
    dirtyRef.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const { status } = await post('save_draft', { payload: nextPayload })
      if (status === 200) {
        setSavedLine(`Draft saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
      }
    }, 1500)
  }, [post])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const update = (section, field, value) => {
    setPayload(prev => {
      const next = { ...prev, [section]: { ...prev[section], [field]: value } }
      scheduleSave(next)
      return next
    })
  }
  const updatePref = (index, value) => {
    setPayload(prev => {
      const prefs = [...prev.residency_interest.unit_preferences]
      prefs[index] = value
      const next = { ...prev, residency_interest: { ...prev.residency_interest, unit_preferences: prefs } }
      scheduleSave(next)
      return next
    })
  }

  // Accessible error surfacing: the summary receives focus so screen readers
  // announce it, and each field-specific entry jumps to its input.
  const showErrors = (errs) => {
    setErrors(errs)
    requestAnimationFrame(() => {
      errorSummaryRef.current?.scrollIntoView({ block: 'center' })
      errorSummaryRef.current?.focus()
    })
  }

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setErrors([])
    clearTimeout(saveTimer.current)
    const { status, body } = await post('submit', { payload })
    setSubmitting(false)
    if (status === 200 && body?.success) { setMeta(m => ({ ...m, revisionNumber: body.revisionNumber })); setView('thank_you'); return }
    if (status === 422) { showErrors(body?.errors || [{ message: 'Please review the required fields and try again.' }]); return }
    if (status === 410) { setErrorMessage(body?.error || 'The window for this Transition Form has closed.'); setView('closed_late'); return }
    if (status === 429) { showErrors([{ message: 'Too many requests - wait a minute and try again. Your draft is saved.' }]); return }
    showErrors([{ message: 'Something went wrong. Your draft is saved - please try again.' }])
  }

  // ── Non-form states ─────────────────────────────────────────────────────────
  if (view !== 'form') {
    const stateCopy = {
      loading:      ['One moment…', 'Opening your Transition Form.'],
      invalid:      ['Link not available', errorMessage || 'This form link is no longer valid. If you believe this is an error, contact the ASPIRE team for a fresh link.'],
      rate_limited: ['Too many requests', 'Please try again in a minute.'],
      error:        ['Something went wrong', 'Please try again shortly. If this keeps happening, contact the ASPIRE team.'],
      closed:       ['This form window has closed',
        meta?.submittedAt
          ? `Your submitted form is safe with the ASPIRE team${meta?.revisionCount > 1 ? ` (revision ${meta.revisionCount})` : ''}. No further changes can be made.`
          : 'The window for this Transition Form has closed. Contact the ASPIRE team if you still intend to participate.'],
      closed_late:  ['This form window has closed', errorMessage || 'The window closed before this change was saved. Your previously submitted form, if any, is retained.'],
      thank_you:    ['Thank you!', `Your Transition Form has been ${meta?.revisionNumber > 1 ? 'updated' : 'submitted'}. The ASPIRE team will review your information and follow up about next steps. You can revise it from the same link until the window closes.`],
    }[view] || ['', '']
    return (
      <div className="ngrpf-page">
        <div className="ngrpf-state" role="status">
          <h1>{stateCopy[0]}</h1>
          <p>{stateCopy[1]}</p>
        </div>
      </div>
    )
  }

  // ── The form ────────────────────────────────────────────────────────────────
  const p = payload
  const units = meta?.units || []
  const checklist = meta?.checklist?.length ? meta.checklist : DEFAULT_APPLICATION_CHECKLIST
  // The close instant is Pacific end-of-day; format it in America/Los_Angeles
  // so the page shows the SAME calendar date staff configured.
  const closeDate = meta?.closeAt ? new Date(meta.closeAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : null
  const interested = p.residency_interest.interest === 'interested'
  const isRevise = (meta?.revisionCount || 0) > 0
  const prefDupes = new Set(p.residency_interest.unit_preferences.filter(Boolean)).size !== p.residency_interest.unit_preferences.filter(Boolean).length

  // Plain JSX helper (deliberately not a component: no remount, no focus
  // loss, and no component creation during render).
  const opt = (section, field, value, label) => (
    <button
      key={String(value)}
      type="button"
      className={`ngrpf-opt${p[section][field] === value ? ' on' : ''}`}
      aria-pressed={p[section][field] === value}
      onClick={() => update(section, field, value)}
    >{label}</button>
  )

  return (
    <div className="ngrpf-page">
      <div className="ngrpf-shell">
        <div className="ngrpf-mast">
          <h1>NGRP Transition Form</h1>
          <p>
            {meta?.cycleName ? `${meta.cycleName} residency cohort · ` : ''}
            {meta?.studentFullName || ''}
            {closeDate ? ` · open until ${closeDate}` : ''}
          </p>
        </div>
        <form className="ngrpf-card" onKeyDown={preventImplicitSubmit} onSubmit={e => { e.preventDefault(); submit() }}>
          {isRevise && (
            <p className="ngrpf-note">
              You submitted this form {meta?.submittedAt ? `on ${new Date(meta.submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : 'previously'}.
              Submitting again saves a new revision - your earlier submission is kept for the ASPIRE team.
            </p>
          )}
          {!isRevise && restoredDraft && (
            <p className="ngrpf-note">Welcome back - your saved draft was restored.</p>
          )}
          <p className="ngrpf-note" style={{ background: '#F9FAFB', border: '1px solid #EFEDE8', color: '#4A5560' }}>
            This form records your information and residency interest for the ASPIRE team. Completing
            it is not an application to the residency program.
          </p>

          <section className="ngrpf-sec">
            <h2>1 · Identity &amp; contact</h2>
            <div className="ngrpf-grid">
              <div className="ngrpf-field full"><label>Name · school · ASPIRE cohort</label>
                <div className="ngrpf-static">{[meta?.studentFullName, meta?.school, meta?.aspireCohort].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="ngrpf-field"><label htmlFor="pe">Preferred email <span className="req">*</span></label>
                <input id="pe" type="email" value={p.identity.preferred_email} onChange={e => update('identity', 'preferred_email', e.target.value)} /></div>
              <div className="ngrpf-field"><label htmlFor="pp">Preferred phone</label>
                <input id="pp" type="tel" value={p.identity.preferred_phone} onChange={e => update('identity', 'preferred_phone', e.target.value)} /></div>
              <div className="ngrpf-field full"><label>Current Cedars-Sinai employment</label>
                <div className="ngrpf-opts" role="group" aria-label="Current Cedars-Sinai employment">
                  {opt('identity', 'cs_employment_status', 'not_employed', 'Not employed at CS')}
                  {opt('identity', 'cs_employment_status', 'per_diem', 'Per diem')}
                  {opt('identity', 'cs_employment_status', 'part_time', 'Part time')}
                  {opt('identity', 'cs_employment_status', 'full_time', 'Full time')}
                  {opt('identity', 'cs_employment_status', 'other', 'Other')}
                </div></div>
            </div>
          </section>

          <section className="ngrpf-sec">
            <h2>2 · Education</h2>
            <div className="ngrpf-grid">
              <div className="ngrpf-field"><label htmlFor="sch">School</label>
                <input id="sch" value={p.education.school} onChange={e => update('education', 'school', e.target.value)} /></div>
              <div className="ngrpf-field"><label htmlFor="prg">Nursing program</label>
                <input id="prg" value={p.education.program} onChange={e => update('education', 'program', e.target.value)} /></div>
              <div className="ngrpf-field"><label htmlFor="deg">Degree type</label>
                <select id="deg" value={p.education.degree_type} onChange={e => update('education', 'degree_type', e.target.value)}>
                  <option value="">Select…</option>
                  {['BSN', 'ABSN / Accelerated BSN', 'MSN (entry-level)', 'ADN', 'Other'].map(d => <option key={d} value={d}>{d}</option>)}
                </select></div>
              <div className="ngrpf-field"><label htmlFor="cd">Program completion / graduation date</label>
                <input id="cd" type="date" value={p.education.completion_date || ''} onChange={e => update('education', 'completion_date', e.target.value)} /></div>
              <div className="ngrpf-field"><label htmlFor="gpa">Nursing GPA</label>
                <input id="gpa" type="number" step="0.01" min="0" max="4" value={p.education.gpa} onChange={e => update('education', 'gpa', e.target.value)} /></div>
              <div className="ngrpf-field"><label>US accredited nursing program?</label>
                <div className="ngrpf-opts" role="group" aria-label="US accredited program">
                  {opt('education', 'us_accredited', true, 'Yes')}
                  {opt('education', 'us_accredited', false, 'No')}
                </div></div>
            </div>
          </section>

          <section className="ngrpf-sec">
            <h2>3 · ASPIRE experience</h2>
            <div className="ngrpf-grid">
              <div className="ngrpf-field"><label htmlFor="pu">Precepted unit</label>
                <input id="pu" value={p.aspire.precepted_unit} onChange={e => update('aspire', 'precepted_unit', e.target.value)} /></div>
              <div className="ngrpf-field"><label htmlFor="rh">Completed rotation hours / shifts</label>
                <input id="rh" type="number" min="0" value={p.aspire.rotation_hours} onChange={e => update('aspire', 'rotation_hours', e.target.value)} /></div>
              <div className="ngrpf-field full"><label>Have you applied to NGRP before?</label>
                <div className="ngrpf-opts" role="group" aria-label="Prior NGRP application">
                  {opt('aspire', 'prior_ngrp_applied', true, 'Yes')}
                  {opt('aspire', 'prior_ngrp_applied', false, 'No')}
                </div></div>
              {p.aspire.prior_ngrp_applied === true && (
                <div className="ngrpf-field full"><label htmlFor="pnd">Which cohort(s), and what happened?</label>
                  <input id="pnd" value={p.aspire.prior_ngrp_details} onChange={e => update('aspire', 'prior_ngrp_details', e.target.value)} /></div>
              )}
            </div>
          </section>

          <section className="ngrpf-sec">
            <h2>4 · Licensure &amp; certifications</h2>
            <div className="ngrpf-grid">
              <div className="ngrpf-field full"><label>California RN license <span className="req">*</span></label>
                <div className="ngrpf-opts" role="group" aria-label="California RN license status">
                  {opt('licensure', 'ca_rn_status', 'active', 'Active')}
                  {opt('licensure', 'ca_rn_status', 'pending', 'Pending / NCLEX ahead')}
                  {opt('licensure', 'ca_rn_status', 'none', 'Not yet started')}
                </div></div>
              {p.licensure.ca_rn_status === 'active' && (
                <div className="ngrpf-field"><label htmlFor="ln">License number</label>
                  <input id="ln" value={p.licensure.license_number} onChange={e => update('licensure', 'license_number', e.target.value)} /></div>
              )}
              {p.licensure.ca_rn_status === 'pending' && (
                <div className="ngrpf-field"><label htmlFor="nd">Scheduled NCLEX date</label>
                  <input id="nd" type="date" value={p.licensure.nclex_scheduled_date || ''} onChange={e => update('licensure', 'nclex_scheduled_date', e.target.value)} /></div>
              )}
              <div className="ngrpf-field"><label htmlFor="pm">Months of paid RN experience (as of the application date)</label>
                <input id="pm" type="number" min="0" value={p.licensure.paid_rn_months} onChange={e => update('licensure', 'paid_rn_months', e.target.value)} /></div>
              <div className="ngrpf-field full"><label>BLS</label>
                <div className="ngrpf-opts" role="group" aria-label="BLS status">
                  {opt('licensure', 'bls_status', 'active', 'Active')}
                  {opt('licensure', 'bls_status', 'expired', 'Expired')}
                  {opt('licensure', 'bls_status', 'none', 'None yet')}
                </div></div>
              {p.licensure.bls_status === 'active' && (<>
                <div className="ngrpf-field"><label htmlFor="bi">BLS issuer</label>
                  <input id="bi" value={p.licensure.bls_issuer} onChange={e => update('licensure', 'bls_issuer', e.target.value)} placeholder="e.g. American Heart Association" /></div>
                <div className="ngrpf-field"><label htmlFor="be">BLS expiration</label>
                  <input id="be" type="date" value={p.licensure.bls_expiration || ''} onChange={e => update('licensure', 'bls_expiration', e.target.value)} /></div>
              </>)}
              <div className="ngrpf-field full">
                <label className="ngrpf-check">
                  <input type="checkbox" checked={p.licensure.acls_required} onChange={e => update('licensure', 'acls_required', e.target.checked)} />
                  <span>A unit I intend to rank requires ACLS</span>
                </label>
              </div>
              {p.licensure.acls_required && (<>
                <div className="ngrpf-field"><label>ACLS</label>
                  <div className="ngrpf-opts" role="group" aria-label="ACLS status">
                    {opt('licensure', 'acls_status', 'active', 'Active')}
                    {opt('licensure', 'acls_status', 'expired', 'Expired')}
                    {opt('licensure', 'acls_status', 'none', 'None yet')}
                  </div></div>
                {p.licensure.acls_status === 'active' && (
                  <div className="ngrpf-field"><label htmlFor="ai">ACLS issuer</label>
                    <input id="ai" value={p.licensure.acls_issuer} onChange={e => update('licensure', 'acls_issuer', e.target.value)} /></div>
                )}
              </>)}
            </div>
          </section>

          <section className="ngrpf-sec">
            <h2>5 · Residency interest</h2>
            <div className="ngrpf-grid">
              <div className="ngrpf-field full"><label>Are you interested in the NGRP residency? <span className="req">*</span></label>
                <div className="ngrpf-opts" role="group" aria-label="Residency interest">
                  {opt('residency_interest', 'interest', 'interested', 'Interested')}
                  {opt('residency_interest', 'interest', 'undecided', 'Undecided')}
                  {opt('residency_interest', 'interest', 'not_interested', 'Not interested')}
                </div></div>
              {interested && (<>
                {[0, 1, 2].map(i => (
                  <div className="ngrpf-field" key={i}>
                    <label htmlFor={`pref${i}`}>Ranked unit preference {i + 1} <span className="req">*</span></label>
                    <select id={`pref${i}`} value={p.residency_interest.unit_preferences[i]} onChange={e => updatePref(i, e.target.value)}>
                      <option value="">Select a unit…</option>
                      {units.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                ))}
                {prefDupes && <p className="ngrpf-error ngrpf-field full">Each ranked unit must be different.</p>}
              </>)}
              {p.residency_interest.interest && p.residency_interest.interest !== 'not_interested' && (<>
                <div className="ngrpf-field full"><label htmlFor="is">Why are you interested in these units / this residency?</label>
                  <textarea id="is" value={p.residency_interest.interest_statement} onChange={e => update('residency_interest', 'interest_statement', e.target.value)} /></div>
                <div className="ngrpf-field full"><label htmlFor="ss">What strengths would you bring?</label>
                  <textarea id="ss" value={p.residency_interest.strengths_statement} onChange={e => update('residency_interest', 'strengths_statement', e.target.value)} /></div>
              </>)}
            </div>
          </section>

          <section className="ngrpf-sec">
            <h2>6 · Application readiness</h2>
            <p style={{ fontSize: 13, color: '#4A5560', margin: '0 0 8px' }}>
              These are the materials the official application will require. Check what you already
              have ready - this is a readiness snapshot, not the application itself.
            </p>
            {checklist.map(item => (
              <label className="ngrpf-check" key={item.key}>
                <input type="checkbox" checked={p.readiness[item.key] === true}
                  onChange={e => update('readiness', item.key, e.target.checked)} />
                <span>{item.label}</span>
              </label>
            ))}
          </section>

          <section className="ngrpf-sec">
            <h2>7 · Attestation</h2>
            <label className="ngrpf-check">
              <input type="checkbox" checked={p.attestation.accurate}
                onChange={e => update('attestation', 'accurate', e.target.checked)} />
              <span>I confirm the information I provided is accurate to the best of my knowledge. <span className="req">*</span></span>
            </label>
            <label className="ngrpf-check">
              <input type="checkbox" checked={p.attestation.consent_followup}
                onChange={e => update('attestation', 'consent_followup', e.target.checked)} />
              <span>I consent to the ASPIRE team following up with me about the residency pathway. <span className="req">*</span></span>
            </label>
          </section>

          {errors.length > 0 && (
            <div ref={errorSummaryRef} tabIndex={-1} role="alert" aria-label="Please fix the following before submitting"
              style={{ background: '#FDECEC', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 14px', margin: '0 0 14px', outline: 'none' }}>
              <p className="ngrpf-error" style={{ margin: 0, fontWeight: 700 }}>Please fix the following before submitting:</p>
              {errors.map((e2, i) => {
                const targetId = FIELD_TO_INPUT_ID[e2.field]
                return targetId ? (
                  <button key={i} type="button" className="ngrpf-error" onClick={() => focusField(targetId)}
                    style={{ display: 'block', margin: '4px 0 0', background: 'none', border: 'none', padding: 0, textAlign: 'left', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {e2.message}
                  </button>
                ) : (
                  <p key={i} className="ngrpf-error" style={{ margin: '4px 0 0' }}>{e2.message}</p>
                )
              })}
            </div>
          )}

          <div className="ngrpf-submitrow">
            <button type="submit" className="ngrpf-submit" disabled={submitting}>
              {submitting ? 'Submitting…' : isRevise ? 'Submit revision' : 'Submit Transition Form'}
            </button>
            <div className="ngrpf-saved" aria-live="polite">{savedLine}</div>
          </div>
        </form>
      </div>
    </div>
  )
}
