// RESIDENCY-REFLECTION-1: the public NGRP Bi-Weekly Clinical Orientation
// Progress and Reflection Tool. Reached only through a personal tokenized link
// (fragment #t=..., stripped from the address bar on load). No account: the
// server resolves the one period from the token hash and nothing else.
//
// Same conventions as the Transition Form page: lazy token init, page CSS in
// <head>, no-referrer meta, one exhaustive `view` string, quiet autosave.
// The form itself is the paper tool, section for section, and the definition
// it renders from is the same one the server validates against.
//
// RESIDENCY-REFLECTION-2 (Owner, 2026-09-14): greyed sample answers in every
// text field, an (i) beside the four unfamiliar terms, the TSAM tier as a
// five-step choice, and the resident's schedule as a month calendar in every
// period. The calendar is the Student Portal's Plan Shift interaction, self-
// contained here because the portal stylesheet is not loaded on public pages:
// tap a day, Add or Dismiss; tap a marked day, Delete or Cancel. Marked days
// inside the period seed the shift cards below; a seeded card never blocks
// submission.
import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import {
  emptyReflection, EMPTY_SHIFT, EMPTY_GOAL, MAX_SHIFTS, MAX_GOALS, DIFFICULTY_AREAS,
  PLACEHOLDERS, HELP, TSAM_TIERS, SCHEDULE_SHIFTS, seedShiftCards, periodWindow,
} from '../lib/ngrp/ngrpReflectionForm.js'
import { monthGrid, monthLabel, pacificToday } from '../lib/rotationCalendarDates.js'
import { shiftBadge } from '../lib/shiftStatus.js'
import { shiftColor } from '../lib/ngrp/ngrpActivity.js'

const TOKEN_PATTERN = /^#t=([A-Za-z0-9_-]{43})$/
const F = "'Plus Jakarta Sans', system-ui, sans-serif"
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  .ngrpr-field select {
    font-size: 16px; font-family: ${F}; padding: 9px 11px; border: 1px solid #d7d2c8;
    border-radius: var(--aspire-radius-control); background: #fff; color: #191919; min-height: 40px;
  }
  .ngrpr-field input::placeholder, .ngrpr-field textarea::placeholder { color: #9CA3AF; opacity: 1; }
  .ngrpr-field input:focus, .ngrpr-field textarea:focus, .ngrpr-field select:focus { outline: 2px solid #4F6DA8; outline-offset: 1px; }
  .ngrpr-field label { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ngrpr-help { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid #4F6DA8; background: #fff; color: #4F6DA8; font-family: Georgia, serif; font-style: italic; font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ngrpr-help[aria-expanded="true"] { background: #4F6DA8; color: #fff; }
  .ngrpr-help:focus-visible { outline: 2px solid #4F6DA8; outline-offset: 2px; }
  .ngrpr-helpbox { grid-column: 1 / -1; background: #F5F7FB; border: 1px solid #D6DEEE; border-radius: var(--aspire-radius-control); padding: 12px 14px; font-size: 12.5px; color: #374151; line-height: 1.55; }
  .ngrpr-helpbox h4 { margin: 0 0 4px; font-size: 12.5px; color: #1D2567; }
  .ngrpr-helpbox p { margin: 0; }
  .ngrpr-tiers { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 4px 12px; margin: 10px 0 0; font-size: 12px; }
  .ngrpr-tiers .th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7785; font-weight: 700; }
  .ngrpr-tiers .tn { font-weight: 700; color: #1D2567; white-space: nowrap; }
  .ngrpr-cal { border: 1px solid #EFEDE8; border-radius: 12px; background: #FCFBF9; padding: 12px 14px 14px; }
  .ngrpr-cal-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 8px; }
  .ngrpr-cal-head h3 { margin: 0; font-size: 13.5px; font-weight: 700; color: #1D2567; }
  .ngrpr-cal-nav { display: flex; gap: 6px; }
  .ngrpr-cal-nav button { min-width: 40px; min-height: 36px; border: 1px solid #d1d5db; background: #fff; border-radius: var(--aspire-radius-control); font-family: ${F}; font-size: 15px; cursor: pointer; color: #374151; }
  .ngrpr-cal-nav button:focus-visible { outline: 2px solid #4F6DA8; outline-offset: 2px; }
  .ngrpr-cal-dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin: 0 0 4px; }
  .ngrpr-cal-dow span { text-align: center; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7785; font-weight: 700; }
  .ngrpr-cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  .ngrpr-day { min-height: 46px; border: 1px solid #E5E7EB; border-radius: var(--aspire-radius-control); background: #fff; font-family: ${F}; font-size: 13px; font-weight: 600; color: #374151; cursor: pointer; padding: 4px 2px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 3px; }
  .ngrpr-day.out { visibility: hidden; }
  .ngrpr-day.today { border-color: #1D2567; }
  .ngrpr-day.picked { outline: 2px solid #4F6DA8; outline-offset: 1px; }
  .ngrpr-day.in-period { background: #F5F7FB; }
  .ngrpr-day.on { border-color: transparent; color: #fff; }
  .ngrpr-day .tag { font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; line-height: 1; white-space: nowrap; }
  .ngrpr-day:focus-visible { outline: 2px solid #4F6DA8; outline-offset: 2px; }
  .ngrpr-daymenu { margin: 10px 0 0; background: #fff; border: 1px solid #D6DEEE; border-radius: var(--aspire-radius-control); padding: 10px 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
  .ngrpr-daymenu strong { color: #1D2567; }
  .ngrpr-daymenu .grow { flex: 1 1 auto; }
  .ngrpr-btn { min-height: 40px; padding: 0 16px; border-radius: var(--aspire-radius-control); border: 1px solid #1D2567; background: #1D2567; color: #fff; font-family: ${F}; font-size: 13px; font-weight: 700; cursor: pointer; }
  .ngrpr-btn.ghost { background: #fff; color: #1D2567; }
  .ngrpr-btn.danger { background: #B3282D; border-color: #B3282D; }
  .ngrpr-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .ngrpr-btn:focus-visible { outline: 2px solid #4F6DA8; outline-offset: 2px; }
  .ngrpr-cal-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 0; font-size: 11.5px; color: #6B7785; }
  .ngrpr-cal-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
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
  .ngrpr-goal-meta { display: flex; flex-direction: column; gap: 5px; }
  .ngrpr-goal-meta > label { font-size: 12px; font-weight: 600; color: #4A5560; }
  .ngrpr-goal .ngrpr-opt { min-height: 40px; padding: 0 14px; }
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
  // The resident's schedule: marks from the server, the month in view, the day
  // whose menu is open (with the shift a Variable resident picked for it), and
  // which (i) is open.
  const [schedule, setSchedule] = useState([])
  const [residentShift, setResidentShift] = useState(null)
  const [calMonth, setCalMonth] = useState(() => { const t = pacificToday(); return { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) - 1 } })
  const [dayPick, setDayPick] = useState(null)
  const [calBusy, setCalBusy] = useState(false)
  const [calError, setCalError] = useState('')
  const [helpOpen, setHelpOpen] = useState(null)
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
        const marks = Array.isArray(body.schedule) ? body.schedule : []
        setSchedule(marks)
        setResidentShift(body.residentShift || null)
        // Marked days inside this period become shift cards before the form
        // first renders, so the resident sees each day waiting for its reflection.
        if (body.state === 'form') merged.shifts = seedShiftCards(merged.shifts, marks, periodWindow({ opens_on: body.opensOn, due_on: body.dueOn }))
        setP(merged)
        setCalMonth({ year: Number(String(body.opensOn).slice(0, 4)), month: Number(String(body.opensOn).slice(5, 7)) - 1 })
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

  // The schedule writes go straight to the server (no autosave debounce): a
  // mark is one row, and the reply is the whole calendar. After an Add inside
  // this period the shift cards pick up the new day.
  const window_ = meta ? periodWindow({ opens_on: meta.opensOn, due_on: meta.dueOn }) : null
  const applySchedule = (marks) => {
    setSchedule(marks)
    if (view !== 'form' || !window_) return
    const next = { ...p, shifts: seedShiftCards(p.shifts, marks, window_) }
    if (next.shifts.length !== p.shifts.length) { setP(next); scheduleSave(next) }
  }
  const markDay = async (ymd, shift) => {
    if (calBusy) return
    setCalBusy(true); setCalError('')
    const { status, body } = await post('schedule_add', { date: ymd, shift: shift || undefined })
    setCalBusy(false)
    if (status === 200 && Array.isArray(body?.schedule)) { applySchedule(body.schedule); setDayPick(null); return }
    setCalError(body?.error || 'That day could not be saved. Please try again.')
  }
  const unmarkDay = async (ymd) => {
    if (calBusy) return
    setCalBusy(true); setCalError('')
    const { status, body } = await post('schedule_remove', { date: ymd })
    setCalBusy(false)
    if (status === 200 && Array.isArray(body?.schedule)) { setSchedule(body.schedule); setDayPick(null); return }
    setCalError(body?.error || 'That day could not be removed. Please try again.')
  }

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
  // The (i): one small round button per unfamiliar term, and one panel that
  // opens under the field it belongs to. The TSAM panel carries the tier ladder.
  // `inst` tells one shift card's TSAM (i) from another's, so only that card's
  // panel opens.
  const helpId = (key, inst) => (inst === undefined ? key : `${key}:${inst}`)
  const help = (key, inst) => (
    <button type="button" className="ngrpr-help" aria-label={`What is ${HELP[key].title}?`} aria-expanded={helpOpen === helpId(key, inst)}
      aria-controls={`help-${helpId(key, inst)}`} onClick={() => setHelpOpen(h => (h === helpId(key, inst) ? null : helpId(key, inst)))}>i</button>
  )
  const helpBox = (key, inst) => helpOpen === helpId(key, inst) && (
    <div className="ngrpr-helpbox" id={`help-${helpId(key, inst)}`} role="region" aria-label={HELP[key].title}>
      <h4>{HELP[key].title}</h4>
      <p>{HELP[key].body}</p>
      {HELP[key].tiers && (
        <div className="ngrpr-tiers">
          <span className="th">Tier</span><span className="th">You</span><span className="th">Your preceptor</span>
          {HELP[key].tiers.map(t => (
            <Fragment key={t.tier}>
              <span className="tn">Tier {t.tier}</span>
              <span>{t.orientee.join('; ')}</span>
              <span>{t.preceptor.join('; ')}</span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
  const text = ({ id, label, value, onChange, rows, hint, placeholder, helpKey }) => (
    <Fragment key={id}>
      <div className="ngrpr-field full">
        <label htmlFor={id}>{label}{helpKey && help(helpKey)}{hint && <span style={{ fontWeight: 400, color: '#6B7785' }}> · {hint}</span>}</label>
        {readOnly
          ? <div className="ngrpr-ro">{value || 'Not answered'}</div>
          : <textarea id={id} value={value} rows={rows || 3} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
      </div>
      {helpKey && helpBox(helpKey)}
    </Fragment>
  )

  // The resident's schedule. Marked days carry the hired shift's colour and
  // glyph; a Variable resident's marks carry the shift chosen for that day; a
  // resident with no shift on file yet sees plain ON.
  const today = pacificToday()
  const marked = new Map(schedule.map(m => [m.on_date, m]))
  const inPeriod = ymd => window_ && ymd >= window_.from && ymd <= window_.to
  const markStyle = m => {
    const shift = m.shift || (residentShift && residentShift !== 'Variable' ? residentShift : null)
    return { shift, color: shiftColor(shift), tag: shift ? shiftBadge(shift).label.split(' ')[0] : 'ON' }
  }
  const cells = monthGrid(calMonth.year, calMonth.month)
  const moveMonth = delta => setCalMonth(({ year, month }) => {
    const d = new Date(Date.UTC(year, month + delta, 1))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
  })
  const picked = dayPick ? marked.get(dayPick.ymd) : null
  const calendar = (
    <section className="ngrpr-sec">
      <h2>Your schedule</h2>
      <p className="lead">
        Tap each day you work, past or future, so your NPD-P mentor can see your schedule. Tap a day again to remove it.
        Days inside this period become shift cards below; fill in the ones you have worked.
      </p>
      <div className="ngrpr-cal">
        <div className="ngrpr-cal-head">
          <h3>{monthLabel(calMonth.year, calMonth.month)}</h3>
          <div className="ngrpr-cal-nav">
            <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
            <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
          </div>
        </div>
        <div className="ngrpr-cal-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
        <div className="ngrpr-cal-grid" role="grid" aria-label="Your working days">
          {cells.map(({ ymd, inMonth }) => {
            if (!inMonth) return <span key={ymd} className="ngrpr-day out" aria-hidden="true" />
            const m = marked.get(ymd)
            const s = m ? markStyle(m) : null
            const label = [fmtDay(ymd), m ? `working${s.shift ? `, ${s.shift} shift` : ''}` : 'not marked', inPeriod(ymd) ? 'in this period' : ''].filter(Boolean).join(', ')
            return (
              <button type="button" key={ymd}
                className={`ngrpr-day${m ? ' on' : ''}${ymd === today ? ' today' : ''}${dayPick?.ymd === ymd ? ' picked' : ''}${!m && inPeriod(ymd) ? ' in-period' : ''}`}
                style={m ? { background: s.color } : undefined}
                aria-label={label} aria-pressed={!!m}
                onClick={() => { setCalError(''); setDayPick(cur => (cur?.ymd === ymd ? null : { ymd, shift: m?.shift || null })) }}>
                <span>{Number(ymd.slice(8, 10))}</span>
                {m && <span className="tag">{s.tag}</span>}
              </button>
            )
          })}
        </div>
        {dayPick && (
          <div className="ngrpr-daymenu" role="group" aria-label={`${fmtDay(dayPick.ymd)} options`}>
            <strong className="grow">{fmtDay(dayPick.ymd)}</strong>
            {picked ? (
              <>
                <button type="button" className="ngrpr-btn danger" disabled={calBusy} onClick={() => unmarkDay(dayPick.ymd)}>Delete</button>
                <button type="button" className="ngrpr-btn ghost" disabled={calBusy} onClick={() => setDayPick(null)}>Cancel</button>
              </>
            ) : (
              <>
                {residentShift === 'Variable' && (
                  <span className="ngrpr-opts" role="group" aria-label="Shift for this day">
                    {SCHEDULE_SHIFTS.map(sh => (
                      <button key={sh} type="button" className={`ngrpr-opt${dayPick.shift === sh ? ' on' : ''}`} style={{ minHeight: 40, padding: '0 12px' }}
                        aria-pressed={dayPick.shift === sh} onClick={() => setDayPick(d => ({ ...d, shift: sh }))}>{shiftBadge(sh).label}</button>
                    ))}
                  </span>
                )}
                <button type="button" className="ngrpr-btn" disabled={calBusy || (residentShift === 'Variable' && !dayPick.shift)} onClick={() => markDay(dayPick.ymd, dayPick.shift)}>Add</button>
                <button type="button" className="ngrpr-btn ghost" disabled={calBusy} onClick={() => setDayPick(null)}>Dismiss</button>
              </>
            )}
          </div>
        )}
        {calError && <p className="ngrpr-error">{calError}</p>}
        <div className="ngrpr-cal-legend">
          {residentShift && residentShift !== 'Variable'
            ? <span><i style={{ background: shiftColor(residentShift) }} />{shiftBadge(residentShift).label} shift, as hired</span>
            : residentShift === 'Variable'
              ? SCHEDULE_SHIFTS.map(sh => <span key={sh}><i style={{ background: shiftColor(sh) }} />{shiftBadge(sh).label}</span>)
              : <span><i style={{ background: shiftColor(null) }} />Working (your shift is not on file yet)</span>}
          <span><i style={{ background: '#F5F7FB', border: '1px solid #D6DEEE' }} />This period</span>
        </div>
      </div>
    </section>
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
                  {readOnly ? <div className="ngrpr-ro">{p.about.unit}</div> : <input id="unit" value={p.about.unit} maxLength={120} placeholder={PLACEHOLDERS.unit} onChange={e => set('about', 'unit', e.target.value)} />}</div>
                <div className="ngrpr-field"><label htmlFor="pn">Preceptor name(s)</label>
                  {readOnly ? <div className="ngrpr-ro">{p.about.preceptor_names || 'Not answered'}</div> : <input id="pn" value={p.about.preceptor_names} maxLength={200} placeholder={PLACEHOLDERS.preceptor_names} onChange={e => set('about', 'preceptor_names', e.target.value)} />}</div>
                {text({ id: "aq", label: "Questions?", value: p.about.questions, onChange: v => set('about', 'questions', v), rows: 2, placeholder: PLACEHOLDERS.questions })}
              </div>
            </section>
          )}

          {calendar}

          <section className="ngrpr-sec">
            <h2>Your shifts</h2>
            <p className="lead">One card per shift, up to six for the period. Days you marked above are waiting here; fill each one in after you work it. A card you have not filled in never holds up your submission.</p>
            {p.shifts.map((s, i) => (
              <div className="ngrpr-shift" key={i}>
                <div className="ngrpr-shift-head">
                  <h3>Shift {i + 1}{s.date ? ` · ${fmtDay(s.date)}` : ''}</h3>
                  {!readOnly && p.shifts.length > 1 && <button type="button" className="ngrpr-link" onClick={() => removeShift(i)}>Remove</button>}
                </div>
                <div className="ngrpr-shift-grid">
                  <div className="ngrpr-field"><label htmlFor={`sd${i}`}>Date</label>
                    {readOnly ? <div className="ngrpr-ro">{s.date || 'Not answered'}</div> : <input id={`sd${i}`} type="date" value={s.date || ''} onChange={e => setShift(i, 'date', e.target.value)} />}</div>
                  <div className="ngrpr-field"><label htmlFor={`sp${i}`}># of patients</label>
                    {readOnly ? <div className="ngrpr-ro">{s.patients ?? 'Not answered'}</div> : <input id={`sp${i}`} type="number" min="0" max="99" inputMode="numeric" value={s.patients} placeholder="3" onChange={e => setShift(i, 'patients', e.target.value)} />}</div>
                  <div className="ngrpr-field"><label htmlFor={`st${i}`}>TSAM tier {help('tsam', i)}</label>
                    {readOnly ? <div className="ngrpr-ro">{s.tsam_tier ? `Tier ${s.tsam_tier}` : 'Not answered'}</div> : (
                      <select id={`st${i}`} value={s.tsam_tier || ''} onChange={e => setShift(i, 'tsam_tier', e.target.value ? Number(e.target.value) : '')}>
                        <option value="">Choose a tier</option>
                        {TSAM_TIERS.map(t => <option key={t.tier} value={t.tier}>Tier {t.tier}: {t.orientee.join(', ')}</option>)}
                      </select>
                    )}</div>
                  {helpBox('tsam', i)}
                </div>
                <div className="ngrpr-grid">
                  {text({ id: `dx${i}`, label: "Diagnoses this shift", value: s.diagnoses, onChange: v => setShift(i, 'diagnoses', v), rows: 2, placeholder: PLACEHOLDERS.diagnoses })}
                  {text({ id: `ww${i}`, label: "What went well", value: s.went_well, onChange: v => setShift(i, 'went_well', v), rows: 3, placeholder: PLACEHOLDERS.went_well })}
                  {text({ id: `im${i}`, label: "Areas for improvement", value: s.improve, onChange: v => setShift(i, 'improve', v), rows: 3, placeholder: PLACEHOLDERS.improve })}
                </div>
              </div>
            ))}
            {!readOnly && p.shifts.length < MAX_SHIFTS && <button type="button" className="ngrpr-link" onClick={addShift}>+ Add a shift</button>}
          </section>

          <section className="ngrpr-sec">
            <h2>Skills this period</h2>
            <div className="ngrpr-grid">
              {text({ id: "sc", label: "Communication skills", hint: "MDs, RNs, CPs, RTs, and others", value: p.skills.communication, onChange: v => set('skills', 'communication', v), placeholder: PLACEHOLDERS.communication })}
              {text({ id: "stk", label: "Technical skills", hint: "IVs, med admin, dressing changes, blood, foleys, and others", value: p.skills.technical, onChange: v => set('skills', 'technical', v), placeholder: PLACEHOLDERS.technical })}
            </div>
          </section>

          <section className="ngrpr-sec">
            <h2>Goals for this two-week period</h2>
            <p className="lead">If a goal is not met, carry it into the next period.</p>
            {p.goals.map((g, i) => (
              <div className="ngrpr-goal" key={i}>
                <div className="ngrpr-field"><label htmlFor={`g${i}`}>Goal {i + 1}</label>
                  {readOnly ? <div className="ngrpr-ro">{g.text || 'Not answered'}</div> : <input id={`g${i}`} value={g.text} maxLength={300} placeholder={PLACEHOLDERS.goal} onChange={e => setGoal(i, 'text', e.target.value)} />}</div>
                <div className="ngrpr-goal-meta">
                  <label id={`go${i}`}>Outcome</label>
                  <div className="ngrpr-opts" role="group" aria-labelledby={`go${i}`}>
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
              {text({ id: "ana", label: "How have you applied the ANA Scope and Standards and Ethics during your shifts?", helpKey: 'ana', hint: "name the standards you applied", value: p.development.ana_standards, onChange: v => set('development', 'ana_standards', v), rows: 4, placeholder: PLACEHOLDERS.ana_standards })}
              {text({ id: "car", label: "How are you practicing the Caritas Processes in caring for yourself and your patients?", helpKey: 'caritas', hint: "name the processes you practiced", value: p.development.caritas, onChange: v => set('development', 'caritas', v), rows: 4, placeholder: PLACEHOLDERS.caritas })}
            </div>
          </section>

          <section className="ngrpr-sec">
            <h2>Where are you finding it hard?</h2>
            <p className="lead">Tick any that apply this period. This is what your NPD-P uses to bring you the right support.</p>
            {DIFFICULTY_AREAS.map(a => (
              <Fragment key={a.key}>
                <label className="ngrpr-check">
                  <input type="checkbox" checked={p.difficulty_areas.includes(a.key)} disabled={readOnly} onChange={() => toggleArea(a.key)} />
                  <span>{a.label}{a.key === 'cs_link_documentation' && <> {help('cslink')}</>}{a.hint && <span className="hint">{a.hint}</span>}</span>
                </label>
                {a.key === 'cs_link_documentation' && helpBox('cslink')}
              </Fragment>
            ))}
          </section>

          <section className="ngrpr-sec">
            <h2>Anything else</h2>
            <div className="ngrpr-grid">
              {text({ id: "wk", label: "Scheduled New Grad workshop dates", value: p.workshops, onChange: v => setTop('workshops', v), rows: 2, placeholder: PLACEHOLDERS.workshops })}
              {text({ id: "sn", label: "Comments, questions, or concerns. What support do you need?", value: p.support_needed, onChange: v => setTop('support_needed', v), rows: 4, placeholder: PLACEHOLDERS.support_needed })}
              <div className="ngrpr-field full"><label>Orientation competencies on track? <span className="req">*</span></label>
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
