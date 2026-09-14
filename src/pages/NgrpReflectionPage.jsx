// RESIDENCY-REFLECTION-1: the public NGRP Bi-Weekly Clinical Orientation
// Progress and Reflection Tool. Reached only through a personal tokenized link
// (fragment #t=..., stripped from the address bar on load). No account: the
// server resolves the one period from the token hash and nothing else.
//
// Same conventions as the Transition Form page: lazy token init, page CSS in
// <head>, no-referrer meta, one exhaustive `view` string, quiet autosave.
// The form itself is the paper tool, section for section, and the definition
// it renders from is the same one the server validates against.
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  emptyReflection, EMPTY_SHIFT, EMPTY_GOAL, MAX_SHIFTS, MAX_GOALS, DIFFICULTY_AREAS,
} from '../lib/ngrp/ngrpReflectionForm.js'

const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/
const F = "'Plus Jakarta Sans', system-ui, sans-serif"

const CSS = `
  .ngrpr-page { min-height: 100vh; background: #F4F1EC; font-family: ${F}; color: #191919; padding: 24px 14px 64px; }
  .ngrpr-shell { max-width: 760px; margin: 0 auto; }
  .ngrpr-mast { background: #1D2567; color: #fff; border-radius: 14px 14px 0 0; padding: 22px 26px; }
  .ngrpr-mast h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
  .ngrpr-mast p { margin: 0; font-size: 13px; color: rgba(255,255,255,0.75); }
  .ngrpr-card { background: #fff; border: 1px solid #e8e4dc; border-top: none; border-radius: 0 0 14px 14px; padding: 24px 26px; }
  .ngrpr-note { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1D4ED8; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; margin: 0 0 18px; }
  .ngrpr-sec { margin: 0 0 26px; }
  .ngrpr-sec h2 { font-size: 14px; font-weight: 700; color: #1D2567; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 2px solid #EDEEF4; padding-bottom: 7px; margin: 0 0 6px; }
  .ngrpr-sec .lead { font-size: 12.5px; color: #4A5560; margin: 0 0 12px; line-height: 1.5; }
  .ngrpr-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 16px; }
  .ngrpr-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .ngrpr-field.full { grid-column: 1 / -1; }
  .ngrpr-field label { font-size: 12px; font-weight: 600; color: #4A5560; }
  .ngrpr-field .req { color: #B3282D; }
  .ngrpr-field input, .ngrpr-field textarea {
    font-size: 16px; font-family: ${F}; padding: 9px 11px; border: 1px solid #d7d2c8;
    border-radius: var(--aspire-radius-control); background: #fff; color: #191919;
  }
  .ngrpr-field textarea { min-height: 84px; resize: vertical; }
  .ngrpr-field input:focus, .ngrpr-field textarea:focus { outline: 2px solid #4F6DA8; outline-offset: 1px; }
  .ngrpr-shift { border: 1px solid #EFEDE8; border-radius: 12px; padding: 14px 16px; margin: 0 0 12px; background: #FCFBF9; }
  .ngrpr-shift-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 10px; }
  .ngrpr-shift-head h3 { margin: 0; font-size: 13px; font-weight: 700; color: #1D2567; }
  .ngrpr-shift-grid { display: grid; grid-template-columns: 1.2fr 0.8fr 0.8fr; gap: 10px 12px; margin: 0 0 10px; }
  .ngrpr-opts { display: flex; flex-wrap: wrap; gap: 8px; }
  .ngrpr-opt { display: flex; align-items: center; gap: 7px; border: 1px solid #d1d5db; border-radius: var(--aspire-radius-control); padding: 8px 14px; min-height: 44px; font-size: 13.5px; cursor: pointer; background: #fff; font-weight: 600; color: #374151; }
  .ngrpr-opt.on { border-color: #1D2567; background: #1D2567; color: #fff; }
  .ngrpr-opt:focus-visible { outline: 2px solid #4F6DA8; outline-offset: 2px; }
  .ngrpr-check { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; font-size: 13.5px; cursor: pointer; min-height: 40px; }
  .ngrpr-check input { width: 17px; height: 17px; margin-top: 2px; accent-color: #1D2567; flex-shrink: 0; }
  .ngrpr-check .hint { display: block; font-size: 11.5px; color: #6B7785; }
  .ngrpr-link { background: none; border: none; color: #1D2567; font-family: ${F}; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 6px 0; text-decoration: underline; }
  .ngrpr-goal { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: start; margin: 0 0 10px; }
  .ngrpr-goal-meta { display: flex; flex-direction: column; gap: 6px; }
  .ngrpr-error { color: #B3282D; font-size: 12.5px; margin: 4px 0 0; }
  .ngrpr-submitrow { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .ngrpr-submit { min-height: 52px; width: 100%; border: none; border-radius: 10px; background: #1D2567; color: #fff; font-family: ${F}; font-size: 15.5px; font-weight: 700; cursor: pointer; }
  .ngrpr-submit:disabled { opacity: 0.55; cursor: not-allowed; }
  .ngrpr-saved { font-size: 12px; color: #6B7785; text-align: center; min-height: 16px; }
  .ngrpr-state { max-width: 560px; margin: 12vh auto 0; background: #fff; border: 1px solid #e8e4dc; border-radius: 14px; padding: 34px 30px; text-align: center; }
  .ngrpr-state h1 { font-size: 19px; margin: 0 0 10px; color: #1D2567; }
  .ngrpr-state p { font-size: 14px; color: #4A5560; margin: 0; line-height: 1.6; }
  .ngrpr-ro { background: #F9FAFB; border: 1px solid #EFEDE8; border-radius: var(--aspire-radius-control); padding: 9px 11px; font-size: 13.5px; color: #4A5560; white-space: pre-wrap; min-height: 20px; }
  @media (max-width: 620px) {
    .ngrpr-grid, .ngrpr-shift-grid, .ngrpr-goal { grid-template-columns: minmax(0, 1fr); }
    .ngrpr-card, .ngrpr-mast { padding: 18px 16px; }
  }
`

const fmtDay = ymd => {
  if (!ymd) return ''
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function mergeBase(base) {
  const out = emptyReflection()
  if (!base || typeof base !== 'object') return out
  if (base.about) out.about = { ...out.about, ...base.about }
  if (Array.isArray(base.shifts) && base.shifts.length) {
    out.shifts = base.shifts.slice(0, MAX_SHIFTS).map(s => ({ ...EMPTY_SHIFT, ...s, date: s?.date || '', patients: s?.patients ?? '' }))
  }
  if (base.skills) out.skills = { ...out.skills, ...base.skills }
  if (Array.isArray(base.goals)) {
    const goals = base.goals.slice(0, MAX_GOALS).map(g => ({ ...EMPTY_GOAL, ...g }))
    while (goals.length < MAX_GOALS) goals.push({ ...EMPTY_GOAL })
    out.goals = goals
  }
  if (base.development) out.development = { ...out.development, ...base.development }
  if (Array.isArray(base.difficulty_areas)) out.difficulty_areas = [...base.difficulty_areas]
  if (typeof base.workshops === 'string') out.workshops = base.workshops
  if (typeof base.support_needed === 'string') out.support_needed = base.support_needed
  if (typeof base.competencies_on_track === 'boolean') out.competencies_on_track = base.competencies_on_track
  return out
}

const preventImplicitSubmit = e => {
  if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA' && e.target.type !== 'submit') e.preventDefault()
}

export default function NgrpReflectionPage() {
  const [initial] = useState(() => {
    const match = TOKEN_PATTERN.exec(window.location.hash)
    return { rawToken: match ? match[1] : null, valid: !!match }
  })
  const [view, setView] = useState(initial.valid ? 'loading' : 'invalid')
  const [meta, setMeta] = useState(null)
  const [p, setP] = useState(() => emptyReflection())
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
    const s = document.createElement('style'); s.id = 'ngrpr-css'; s.textContent = CSS; document.head.appendChild(s)
    window.history.replaceState(null, '', window.location.pathname)
    return () => { document.head.removeChild(m); const el = document.getElementById('ngrpr-css'); if (el) document.head.removeChild(el) }
  }, [])

  const post = useCallback(async (action, extra = {}) => {
    const res = await fetch('/api/ngrp-reflection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: initial.rawToken, ...extra }),
    })
    let body = null
    try { body = await res.json() } catch { /* non-JSON */ }
    return { status: res.status, body }
  }, [initial.rawToken])

  useEffect(() => {
    if (!initial.valid) return
    let cancelled = false
    ;(async () => {
      const { status, body } = await post('load')
      if (cancelled) return
      if (status === 200 && body) {
        setMeta(body)
        const merged = mergeBase(body.base)
        if (body.periodNumber === 1 && !merged.about.unit && body.unit) merged.about.unit = body.unit
        setP(merged)
        setRestoredDraft(body.baseKind === 'draft')
        setView(body.state === 'submitted' ? 'submitted' : body.state === 'closed' ? 'closed' : 'form')
      } else if (status === 410) { setErrorMessage(body?.error || ''); setView('invalid') }
      else if (status === 429) setView('rate_limited')
      else setView('error')
    })()
    return () => { cancelled = true }
  }, [initial.valid, post])

  const scheduleSave = useCallback((next) => {
    dirtyRef.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const { status } = await post('save_draft', { payload: next })
      if (status === 200) setSavedLine(`Saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
    }, 1500)
  }, [post])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const change = mutate => setP(prev => { const next = mutate(structuredClone(prev)); scheduleSave(next); return next })
  const set = (section, field, value) => change(n => { n[section][field] = value; return n })
  const setTop = (field, value) => change(n => { n[field] = value; return n })
  const setShift = (i, field, value) => change(n => { n.shifts[i][field] = value; return n })
  const addShift = () => change(n => { if (n.shifts.length < MAX_SHIFTS) n.shifts.push({ ...EMPTY_SHIFT }); return n })
  const removeShift = i => change(n => { n.shifts.splice(i, 1); if (!n.shifts.length) n.shifts.push({ ...EMPTY_SHIFT }); return n })
  const setGoal = (i, field, value) => change(n => { n.goals[i][field] = value; return n })
  const toggleArea = key => change(n => {
    n.difficulty_areas = n.difficulty_areas.includes(key) ? n.difficulty_areas.filter(k => k !== key) : [...n.difficulty_areas, key]
    return n
  })

  const showErrors = errs => {
    setErrors(errs)
    requestAnimationFrame(() => { errorSummaryRef.current?.scrollIntoView({ block: 'center' }); errorSummaryRef.current?.focus() })
  }

  const submit = async () => {
    if (submitting) return
    setSubmitting(true); setErrors([]); clearTimeout(saveTimer.current)
    const { status, body } = await post('submit', { payload: p })
    setSubmitting(false)
    if (status === 200 && body?.success) { setMeta(m => ({ ...m, submittedAt: body.submittedAt })); setView('thank_you'); return }
    if (status === 422) { showErrors(body?.errors || [{ message: 'Please review the required parts and try again.' }]); return }
    if (status === 409) { setView('submitted'); return }
    if (status === 410) { setErrorMessage(body?.error || ''); setView('closed_late'); return }
    if (status === 429) { showErrors([{ message: 'Too many requests. Wait a minute and try again; your draft is saved.' }]); return }
    showErrors([{ message: 'Something went wrong. Your draft is saved; please try again.' }])
  }

  const n = meta?.periodNumber
  const total = meta?.periodCount
  const readOnly = view === 'submitted'

  if (view !== 'form' && view !== 'submitted') {
    const copy = {
      loading:      ['One moment…', 'Opening your reflection.'],
      invalid:      ['Link not available', errorMessage || 'This reflection link is no longer valid. If you were sent a newer one, use that; otherwise contact the ASPIRE team.'],
      rate_limited: ['Too many requests', 'Please try again in a minute.'],
      error:        ['Something went wrong', 'Please try again shortly. If this keeps happening, contact the ASPIRE team.'],
      closed:       ['This period has closed', `Period ${n} of ${total} closed on ${fmtDay(meta?.closesOn)}. Your NPD-P mentor can still see anything you saved, and your next period will arrive on its own.`],
      closed_late:  ['This period has closed', errorMessage || 'The period closed before this was saved. Anything you saved earlier is kept.'],
      thank_you:    ['Thank you!', `Period ${n} of ${total} is submitted. ${n < total ? `Period ${n + 1} will reach you by email the Friday before it opens.` : 'That was the last one; well done on finishing orientation.'}`],
    }[view] || ['', '']
    return (
      <div className="ngrpr-page">
        <div className="ngrpr-state" role="status"><h1>{copy[0]}</h1><p>{copy[1]}</p></div>
      </div>
    )
  }

  // Plain JSX helpers, deliberately NOT components: a component defined inside
  // render remounts on every keystroke and the textarea loses focus. Same rule
  // the Transition Form page follows.
  const opt = (value, label, current, onPick) => (
    <button key={String(value)} type="button" className={`ngrpr-opt${current === value ? ' on' : ''}`}
      aria-pressed={current === value} disabled={readOnly} onClick={() => onPick(value)}>{label}</button>
  )
  const text = ({ id, label, value, onChange, rows, hint }) => (
    <div className="ngrpr-field full" key={id}>
      <label htmlFor={id}>{label}{hint && <span style={{ fontWeight: 400, color: '#6B7785' }}> · {hint}</span>}</label>
      {readOnly
        ? <div className="ngrpr-ro">{value || 'Not answered'}</div>
        : <textarea id={id} value={value} rows={rows || 3} onChange={e => onChange(e.target.value)} />}
    </div>
  )

  return (
    <div className="ngrpr-page">
      <div className="ngrpr-shell">
        <div className="ngrpr-mast">
          <h1>NGRP Clinical Orientation Progress and Reflection Tool</h1>
          <p>{meta?.residentFullName}{meta?.unit ? ` · ${meta.unit}` : ''} · Period {n} of {total} · {fmtDay(meta?.opensOn)} to {fmtDay(meta?.dueOn)}</p>
        </div>
        <form className="ngrpr-card" onKeyDown={preventImplicitSubmit} onSubmit={e => { e.preventDefault(); submit() }}>
          {readOnly && (
            <p className="ngrpr-note">You submitted this period on {new Date(meta.submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. It is shown here for your records and cannot be changed.</p>
          )}
          {!readOnly && restoredDraft && <p className="ngrpr-note">Welcome back. Your saved answers were restored.</p>}
          {!readOnly && (
            <p className="ngrpr-note" style={{ background: '#F9FAFB', border: '1px solid #EFEDE8', color: '#4A5560' }}>
              Fill this in as you go. It saves on its own. Submit it by <strong>{fmtDay(meta?.dueOn)}</strong>; the link stays open until {fmtDay(meta?.closesOn)}.
              This is to promote your learning, reflective nursing practice, and communication with your preceptor(s).
            </p>
          )}

          {n === 1 && (
            <section className="ngrpr-sec">
              <h2>About you</h2>
              <p className="lead">So your unit NPD-P and your NPD-P mentor know where to find you.</p>
              <div className="ngrpr-grid">
                <div className="ngrpr-field"><label htmlFor="unit">Unit <span className="req">*</span></label>
                  {readOnly ? <div className="ngrpr-ro">{p.about.unit}</div> : <input id="unit" value={p.about.unit} maxLength={120} onChange={e => set('about', 'unit', e.target.value)} />}</div>
                <div className="ngrpr-field"><label htmlFor="pn">Preceptor name(s)</label>
                  {readOnly ? <div className="ngrpr-ro">{p.about.preceptor_names || 'Not answered'}</div> : <input id="pn" value={p.about.preceptor_names} maxLength={200} onChange={e => set('about', 'preceptor_names', e.target.value)} />}</div>
                {text({ id: "ws", label: "Current work schedule (next two weeks)", value: p.about.work_schedule, onChange: v => set('about', 'work_schedule', v), rows: 3 })}
                {text({ id: "aq", label: "Questions?", value: p.about.questions, onChange: v => set('about', 'questions', v), rows: 2 })}
              </div>
            </section>
          )}

          <section className="ngrpr-sec">
            <h2>Your shifts</h2>
            <p className="lead">One entry per shift, up to six for the period. Add each one after you work it.</p>
            {p.shifts.map((s, i) => (
              <div className="ngrpr-shift" key={i}>
                <div className="ngrpr-shift-head">
                  <h3>Shift {i + 1}</h3>
                  {!readOnly && p.shifts.length > 1 && <button type="button" className="ngrpr-link" onClick={() => removeShift(i)}>Remove</button>}
                </div>
                <div className="ngrpr-shift-grid">
                  <div className="ngrpr-field"><label htmlFor={`sd${i}`}>Date {i === 0 && <span className="req">*</span>}</label>
                    {readOnly ? <div className="ngrpr-ro">{s.date || 'Not answered'}</div> : <input id={`sd${i}`} type="date" value={s.date || ''} onChange={e => setShift(i, 'date', e.target.value)} />}</div>
                  <div className="ngrpr-field"><label htmlFor={`sp${i}`}># of patients</label>
                    {readOnly ? <div className="ngrpr-ro">{s.patients ?? 'Not answered'}</div> : <input id={`sp${i}`} type="number" min="0" max="99" inputMode="numeric" value={s.patients} onChange={e => setShift(i, 'patients', e.target.value)} />}</div>
                  <div className="ngrpr-field"><label htmlFor={`st${i}`}>TSAM tier</label>
                    {readOnly ? <div className="ngrpr-ro">{s.tsam_tier || 'Not answered'}</div> : <input id={`st${i}`} value={s.tsam_tier} maxLength={20} onChange={e => setShift(i, 'tsam_tier', e.target.value)} />}</div>
                </div>
                <div className="ngrpr-grid">
                  {text({ label: "Diagnoses this shift", value: s.diagnoses, onChange: v => setShift(i, 'diagnoses', v), rows: 2 })}
                  {text({ label: "What went well", value: s.went_well, onChange: v => setShift(i, 'went_well', v), rows: 3 })}
                  {text({ label: "Areas for improvement", value: s.improve, onChange: v => setShift(i, 'improve', v), rows: 3 })}
                </div>
              </div>
            ))}
            {!readOnly && p.shifts.length < MAX_SHIFTS && <button type="button" className="ngrpr-link" onClick={addShift}>+ Add a shift</button>}
          </section>

          <section className="ngrpr-sec">
            <h2>Skills this period</h2>
            <div className="ngrpr-grid">
              {text({ id: "sc", label: "Communication skills", hint: "MDs, RNs, CPs, RTs, and others", value: p.skills.communication, onChange: v => set('skills', 'communication', v) })}
              {text({ id: "stk", label: "Technical skills", hint: "IVs, med admin, dressing changes, blood, foleys, and others", value: p.skills.technical, onChange: v => set('skills', 'technical', v) })}
            </div>
          </section>

          <section className="ngrpr-sec">
            <h2>Goals for this two-week period</h2>
            <p className="lead">If a goal is not met, carry it into the next period.</p>
            {p.goals.map((g, i) => (
              <div className="ngrpr-goal" key={i}>
                <div className="ngrpr-field"><label htmlFor={`g${i}`}>Goal {i + 1}</label>
                  {readOnly ? <div className="ngrpr-ro">{g.text || 'Not answered'}</div> : <input id={`g${i}`} value={g.text} maxLength={300} onChange={e => setGoal(i, 'text', e.target.value)} />}</div>
                <div className="ngrpr-goal-meta">
                  <div className="ngrpr-opts" role="group" aria-label={`Goal ${i + 1} outcome`}>
                    {opt('met', 'Met', g.met, v => setGoal(i, 'met', g.met === v ? null : v))}
                    {opt('not_met', 'Not met', g.met, v => setGoal(i, 'met', g.met === v ? null : v))}
                  </div>
                  {g.met === 'not_met' && (
                    <label className="ngrpr-check" style={{ padding: 0, minHeight: 0 }}>
                      <input type="checkbox" checked={g.carry_forward} disabled={readOnly} onChange={e => setGoal(i, 'carry_forward', e.target.checked)} />
                      <span>Carry to next period</span>
                    </label>
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className="ngrpr-sec">
            <h2>Professional and personal development</h2>
            <div className="ngrpr-grid">
              {text({ id: "ana", label: "How have you applied the ANA Scope and Standards and Ethics during your shifts?", hint: "name the standards you applied", value: p.development.ana_standards, onChange: v => set('development', 'ana_standards', v), rows: 4 })}
              {text({ id: "car", label: "How are you practicing the Caritas Processes in caring for yourself and your patients?", hint: "name the processes you practiced", value: p.development.caritas, onChange: v => set('development', 'caritas', v), rows: 4 })}
            </div>
          </section>

          <section className="ngrpr-sec">
            <h2>Where are you finding it hard?</h2>
            <p className="lead">Tick any that apply this period. This is what your NPD-P uses to bring you the right support.</p>
            {DIFFICULTY_AREAS.map(a => (
              <label className="ngrpr-check" key={a.key}>
                <input type="checkbox" checked={p.difficulty_areas.includes(a.key)} disabled={readOnly} onChange={() => toggleArea(a.key)} />
                <span>{a.label}{a.hint && <span className="hint">{a.hint}</span>}</span>
              </label>
            ))}
          </section>

          <section className="ngrpr-sec">
            <h2>Anything else</h2>
            <div className="ngrpr-grid">
              {text({ id: "wk", label: "Scheduled New Grad workshop dates", value: p.workshops, onChange: v => setTop('workshops', v), rows: 2 })}
              {text({ id: "sn", label: "Comments, questions, or concerns. What support do you need?", value: p.support_needed, onChange: v => setTop('support_needed', v), rows: 4 })}
              <div className="ngrpr-field full"><label>Orientation competencies / Kahuna on track? <span className="req">*</span></label>
                <div className="ngrpr-opts" role="group" aria-label="Orientation competencies on track">
                  {opt(true, 'Yes', p.competencies_on_track, v => setTop('competencies_on_track', v))}
                  {opt(false, 'No', p.competencies_on_track, v => setTop('competencies_on_track', v))}
                </div></div>
            </div>
          </section>

          {errors.length > 0 && (
            <div ref={errorSummaryRef} tabIndex={-1} role="alert" aria-label="Please complete the following before submitting"
              style={{ background: '#FDECEC', border: '1px solid #FCA5A5', borderRadius: 10, padding: '10px 14px', margin: '0 0 14px', outline: 'none' }}>
              <p className="ngrpr-error" style={{ margin: 0, fontWeight: 700 }}>Please complete the following before submitting:</p>
              {errors.map((e2, i) => <p key={i} className="ngrpr-error" style={{ margin: '4px 0 0' }}>{e2.message}</p>)}
            </div>
          )}

          {!readOnly && (
            <div className="ngrpr-submitrow">
              <button type="submit" className="ngrpr-submit" disabled={submitting}>
                {submitting ? 'Submitting…' : `Submit period ${n}`}
              </button>
              <div className="ngrpr-saved" aria-live="polite">{savedLine}</div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
