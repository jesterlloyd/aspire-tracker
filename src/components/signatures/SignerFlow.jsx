// src/components/signatures/SignerFlow.jsx
//
// SIGNATURES-PHASE2: what a signer sees, mobile first, always the plain Modern flow whatever
// the sender's Style (brief section 5). One component, two hosts: the public /sign page
// (a real `api` over /api/sig-signer) and the staff "Signer preview" (a fake `api` that
// changes nothing). Every rule it applies comes from sigModel; the server re-checks all
// of them, so this screen can make signing easy but cannot make it wrong.
//
// Steps: code -> consent -> sign -> done (or waiting / closed).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { unmetRequirements, fieldLabel, fieldType, checkRule, initialsOf, formatInZone, isAutoField, autoFieldValue } from '../../lib/signatures/sigModel'
import PdfPages from './PdfPages'
import './signerFlow.css'

const byPos = (a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x)
const PREFILL_OF = { name: 'name', email: 'email', title: 'title', org: 'org', phone: 'phone', addr: 'address' }

export default function SignerFlow({ api, preview = false }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(null) } catch (e) { setError(e.message) }
  }, [api])
  useEffect(() => { load() }, [load])

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn(); await load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (!state) return <Shell>{error ? <p className="sgn-err" role="alert">{error}</p> : <p className="sgn-hint">Loading…</p>}</Shell>

  return (
    <Shell sender={state.request?.sender_name}>
      {state.step === 'code' && <CodeStep state={state} api={api} busy={busy} run={run} error={error} />}
      {state.step === 'consent' && <ConsentStep state={state} api={api} busy={busy} run={run} error={error} />}
      {state.step === 'sign' && <SignStep state={state} api={api} busy={busy} run={run} error={error} preview={preview} />}
      {state.step === 'waiting' && (
        <div className="sgn-card"><h2>Not your turn yet</h2><p className="sgn-hint">Someone signs before you. We will email you when it is your turn.</p></div>
      )}
      {state.step === 'done' && <DoneStep state={state} api={api} />}
      {state.step === 'closed' && <div className="sgn-card"><h2>{state.request?.title}</h2><p>{state.message}</p></div>}
    </Shell>
  )
}

function Shell({ children, sender }) {
  return (
    <div className="sgn">
      <header className="sgn-brand"><i aria-hidden="true">A</i>ASPIRE Intelligence{sender ? <small>from {sender}</small> : null}</header>
      <main className="sgn-body">{children}</main>
    </div>
  )
}

// ── 1. Confirm it's you ─────────────────────────────────────────────────────────────
function CodeStep({ state, api, busy, run, error }) {
  const [sent, setSent] = useState(null)
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const refs = useRef([])
  const code = digits.join('')
  const send = () => run(async () => { const r = await api.sendCode(); setSent(r); setDigits(['', '', '', '', '', '']); setTimeout(() => refs.current[0]?.focus(), 30) })
  const setAt = (i, v) => {
    const clean = v.replace(/\D/g, '')
    if (clean.length > 1) { // pasted
      const next = clean.slice(0, 6).split('')
      setDigits([...next, ...Array(6 - next.length).fill('')])
      refs.current[Math.min(5, next.length)]?.focus(); return
    }
    const next = [...digits]; next[i] = clean; setDigits(next)
    if (clean && i < 5) refs.current[i + 1]?.focus()
  }
  return (
    <div className="sgn-card sgn-center">
      <h2>Confirm it's you</h2>
      <p className="sgn-hint">{state.request?.title} is ready for you. {sent ? `We sent a 6-digit code to ${sent.sentTo}. It expires in ${sent.ttlMinutes} minutes.` : 'We will email you a 6-digit code.'}</p>
      {sent ? (
        <>
          <div className="sgn-code" role="group" aria-label="One-time code">
            {digits.map((d, i) => (
              <input key={i} ref={el => { refs.current[i] = el }} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={6} value={d} aria-label={`Digit ${i + 1}`} onChange={e => setAt(i, e.target.value)}
                onKeyDown={e => { if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus() }} />
            ))}
          </div>
          <button type="button" className="sgn-link" onClick={send} disabled={busy}>Send a new code</button>
          {error && <p className="sgn-err" role="alert">{error}</p>}
          <div className="sgn-foot"><button type="button" className="sgn-btn sgn-pri" disabled={busy || code.length < 6} onClick={() => run(() => api.verify(code))}>Verify</button></div>
        </>
      ) : (
        <>
          {error && <p className="sgn-err" role="alert">{error}</p>}
          <div className="sgn-foot"><button type="button" className="sgn-btn sgn-pri" disabled={busy} onClick={send}>Email me a code</button></div>
        </>
      )}
    </div>
  )
}

// ── 2. Consent (its own step, never buried) ────────────────────────────────────────
function ConsentStep({ state, api, busy, run, error }) {
  const [opened, setOpened] = useState(!!state.sample_opened)
  const [readable, setReadable] = useState(false)
  const [agree, setAgree] = useState(false)
  const [declining, setDeclining] = useState(false)
  const d = state.disclosure || { title: 'Consent to electronic records and signatures', body: { points: [] }, version: '' }
  const openSample = () => run(async () => { await api.samplePdf(); setOpened(true) })
  if (declining) return <DeclineSheet api={api} run={run} busy={busy} onCancel={() => setDeclining(false)} />
  return (
    <div className="sgn-card">
      <h2>{d.title}</h2>
      {d.body?.intro && <p>{d.body.intro}</p>}
      <ul className="sgn-list">{(d.body?.points || []).map((p, i) => <li key={i}>{p}</li>)}</ul>
      <div className="sgn-sample">
        <span className="sgn-pdficon" aria-hidden="true">PDF</span>
        <span>Open this sample PDF to confirm your device can view the format.{' '}
          <button type="button" className="sgn-link" onClick={openSample} disabled={busy}>{opened ? 'Open it again' : 'Open sample PDF'}</button></span>
      </div>
      <label className="sgn-chk"><input type="checkbox" checked={readable} disabled={!opened} onChange={e => setReadable(e.target.checked)} />I opened the sample PDF and can read it.</label>
      <label className="sgn-chk"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />I agree to use electronic records and signatures.</label>
      <p className="sgn-fine">Disclosure v{d.version}</p>
      {error && <p className="sgn-err" role="alert">{error}</p>}
      <div className="sgn-foot">
        <button type="button" className="sgn-btn sgn-pri" disabled={busy || !opened || !readable || !agree} onClick={() => run(() => api.consent())}>Continue</button>
        <button type="button" className="sgn-btn" onClick={() => setDeclining(true)}>Decline to sign</button>
      </div>
    </div>
  )
}

// ── 3. Fill and sign ────────────────────────────────────────────────────────────────
function SignStep({ state, api, busy, run, error, preview }) {
  const doc = state.document
  const role = state.signer.role_key
  const mine = useMemo(() => doc.fields.filter(f => f.mine).sort(byPos), [doc.fields])
  const [values, setValues] = useState(() => ({ ...state.values }))
  const [adopted, setAdopted] = useState(null)
  const [adopting, setAdopting] = useState(null)   // the field that asked
  const [editing, setEditing] = useState(null)
  const [zoom, setZoom] = useState(false)
  const [menu, setMenu] = useState(null)           // null | 'more' | 'delegate' | 'decline'
  const [source, setSource] = useState(null)
  const [curId, setCurId] = useState(null)
  const wrap = useRef(null)

  useEffect(() => { api.open().catch(() => {}); api.document().then(u => setSource(u ? { url: u } : null)).catch(() => setSource(null)) }, [api])

  // Date and time signed show now; the server writes the real moment when you finish.
  const shown = useMemo(() => {
    const v = { ...values }
    for (const f of mine) if (isAutoField(f)) v[f.id] = autoFieldValue(f.type, new Date(), state.time_zone)
    for (const f of mine) if (f.type === 'sig' && adopted) v[f.id] = adopted.text
    for (const f of mine) if (f.type === 'ini' && adopted) v[f.id] = adopted.initials
    return v
  }, [values, mine, adopted, state.time_zone])
  const unmet = useMemo(() => unmetRequirements(doc.fields, shown, role), [doc.fields, shown, role])
  const next = unmet[0]
  const left = unmet.length

  const center = (id) => requestAnimationFrame(() => {
    const el = wrap.current?.querySelector(`[data-fid="${id}"]`)
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'center' })
    el?.focus({ preventScroll: true })
  })
  useEffect(() => { if (next) { setCurId(next.field.id); center(next.field.id) } }, [next?.field.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const fill = (f) => {
    setCurId(f.id)
    if (f.type === 'sig' || f.type === 'ini') { if (!adopted) setAdopting(f); return }
    if (isAutoField(f)) return
    if (f.type === 'check') { setValues(v => ({ ...v, [f.id]: v[f.id] === '✓' ? '' : '✓' })); return }
    if (f.type === 'radio') { setValues(v => ({ ...v, [f.group]: f.id })); return }
    if (!values[f.id] && PREFILL_OF[f.type] && state.prefill?.[PREFILL_OF[f.type]]) setValues(v => ({ ...v, [f.id]: state.prefill[PREFILL_OF[f.type]] }))
    setEditing(f)
  }

  const finish = () => run(async () => {
    const out = {}
    for (const f of mine) { if (f.type === 'radio') out[f.group] = values[f.group]; else if (!isAutoField(f) && f.type !== 'sig' && f.type !== 'ini') out[f.id] = values[f.id] }
    await api.finish(out, adopted)
  })

  return (
    <div className="sgn-sign">
      <div className="sgn-nextbar">
        <span>{left ? `${left} required field${left === 1 ? '' : 's'} left` : 'All fields done'}</span>
        <span className="sgn-row">
          <button type="button" className="sgn-btn sgn-sm" aria-pressed={zoom} onClick={() => setZoom(z => !z)}>{zoom ? 'Whole page' : 'Zoom in'}</button>
          <button type="button" className="sgn-btn sgn-sm" aria-haspopup="dialog" onClick={() => setMenu('more')}>More</button>
        </span>
      </div>
      <div ref={wrap} className={`sgn-docwrap${zoom ? ' sgn-zoom' : ''}`}>
        <PdfPages source={source} pageSizes={doc.page_sizes} className="sgn-stack" overlay={(n) => doc.fields.filter(f => (f.page || 1) === n).map(f => (
          <SignerField key={f.id} f={f} value={f.type === 'radio' ? values[f.group] : shown[f.id]} current={curId === f.id} onFill={fill} adopted={adopted} />
        ))} />
      </div>
      {next?.group && <p className="sgn-warn" role="status">{next.message}</p>}
      {state.others?.length > 0 && <p className="sgn-hint">Faded fields belong to {state.others.map(o => o.name).join(', ')}.</p>}
      {error && <p className="sgn-err" role="alert">{error}</p>}
      <div className="sgn-foot sgn-sticky">
        {left
          ? <button type="button" className="sgn-btn sgn-pri" onClick={() => fill(next.field)}>{`Fill: ${fieldLabel(next.field)}`}</button>
          : <button type="button" className="sgn-btn sgn-pri" disabled={busy} onClick={finish}>{busy ? 'Signing…' : 'Finish'}</button>}
      </div>
      {preview && <p className="sgn-fine">Preview: nothing you do here is saved or sent.</p>}

      {adopting && <AdoptSheet name={state.prefill?.name || state.signer.name} onCancel={() => setAdopting(null)}
        onAdopt={(a) => { setAdopted(a); setAdopting(null) }} />}
      {editing && <EditSheet f={editing} value={values[editing.id] || ''} onCancel={() => setEditing(null)}
        onSave={(v) => { setValues(x => ({ ...x, [editing.id]: v })); setEditing(null) }} />}
      {menu === 'more' && (
        <Sheet title="Options" onClose={() => setMenu(null)}>
          <button type="button" className="sgn-btn" onClick={() => setMenu('delegate')}>Someone else should sign this</button>
          <button type="button" className="sgn-btn" onClick={async () => { setMenu(null); const u = await api.document(true); if (u) window.open(u, '_blank', 'noopener') }}>Download to read first</button>
          <button type="button" className="sgn-btn" onClick={() => { setMenu(null); run(() => api.paperCopy()) }}>Request a paper copy</button>
          <button type="button" className="sgn-btn sgn-danger" onClick={() => setMenu('decline')}>Decline to sign</button>
        </Sheet>
      )}
      {menu === 'delegate' && <DelegateSheet run={run} api={api} busy={busy} onClose={() => setMenu(null)} />}
      {menu === 'decline' && <Sheet title="Decline to sign?" onClose={() => setMenu(null)}><DeclineSheet api={api} run={run} busy={busy} onCancel={() => setMenu(null)} inline /></Sheet>}
    </div>
  )
}

function SignerField({ f, value, current, onFill, adopted }) {
  const t = fieldType(f.type)
  const style = { '--c': `var(--sgn-${f.mine ? 'mine' : 'other'})`, left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }
  const filled = f.type === 'radio' ? value === f.id : value != null && value !== ''
  if (!f.mine) {
    return <div className={`sgn-f sgn-f-other${f.sender || filled ? ' sgn-f-filled' : ''}`} style={style} aria-hidden="true">{filled ? display(f, value) : ''}</div>
  }
  const label = `${fieldLabel(f)}${f.required || f.group ? ', required' : ''}${filled ? `, filled` : ''}`
  return (
    <button type="button" data-fid={f.id} className={`sgn-f sgn-f-mine sgn-f-${f.type}${filled ? ' sgn-f-filled' : ''}${current ? ' sgn-f-cur' : ''}`}
      style={style} aria-label={label} aria-pressed={f.type === 'check' || f.type === 'radio' ? filled : undefined} onClick={() => onFill(f)}>
      {filled ? (f.type === 'sig' && adopted?.kind === 'draw' ? <DrawnSig path={adopted.path} /> : display(f, value)) : (f.type === 'check' || f.type === 'radio' ? '' : t?.label)}
    </button>
  )
}

const display = (f, v) => f.type === 'check' ? '✓' : f.type === 'radio' ? '●' : String(v)
function DrawnSig({ path }) { return <svg viewBox="0 0 100 30" className="sgn-drawn" aria-hidden="true"><path d={path} /></svg> }

function Sheet({ title, children, onClose }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="sgn-scrim" onMouseDown={onClose}>
      <div className="sgn-sheet" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <h3>{title}</h3>{children}
      </div>
    </div>
  )
}

function EditSheet({ f, value, onSave, onCancel }) {
  const [v, setV] = useState(value)
  const problem = f.rule && f.rule !== 'none' ? checkRule(f.rule, v) : null
  const options = f.type === 'drop' ? (f.options || []) : null
  return (
    <Sheet title={fieldLabel(f)} onClose={onCancel}>
      {options
        ? <select autoFocus value={v} onChange={e => setV(e.target.value)} aria-label={fieldLabel(f)}><option value="">Choose…</option>{options.map(o => <option key={o}>{o}</option>)}</select>
        : <input autoFocus value={v} onChange={e => setV(e.target.value)} aria-label={fieldLabel(f)} inputMode={f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : undefined} />}
      {problem && <p className="sgn-err" role="alert">{problem}</p>}
      <div className="sgn-two">
        <button type="button" className="sgn-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="sgn-btn sgn-pri" disabled={!!problem} onClick={() => onSave(v.trim())}>Save</button>
      </div>
    </Sheet>
  )
}

function AdoptSheet({ name, onAdopt, onCancel }) {
  const [full, setFull] = useState(name || '')
  const [mode, setMode] = useState('type')
  const [path, setPath] = useState('')
  return (
    <Sheet title="Adopt your signature" onClose={onCancel}>
      <label className="sgn-lab" htmlFor="sgn-adopt-name">Full name</label>
      <input id="sgn-adopt-name" value={full} onChange={e => setFull(e.target.value)} />
      <div className="sgn-seg" role="group" aria-label="Signature style">
        <button type="button" aria-pressed={mode === 'type'} onClick={() => setMode('type')}>Type</button>
        <button type="button" aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}>Draw</button>
      </div>
      <div className="sgn-pad">
        {mode === 'type' ? <span className="sgn-typed">{full}</span> : <DrawPad onChange={setPath} />}
        <span className="sgn-base" aria-hidden="true" /><span className="sgn-x" aria-hidden="true">×</span>
      </div>
      {mode === 'draw' && <p className="sgn-fine">Drawing is optional: a typed signature is always available.</p>}
      <p className="sgn-fine">By selecting Adopt and sign, I agree that this signature and initials are my electronic signature, with the same effect as my handwritten signature on this document.</p>
      <div className="sgn-two">
        <button type="button" className="sgn-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="sgn-btn sgn-pri" disabled={!full.trim() || (mode === 'draw' && !path)}
          onClick={() => onAdopt({ kind: mode, text: full.trim(), initials: initialsOf(full), path: mode === 'draw' ? path : null })}>Adopt and sign</button>
      </div>
    </Sheet>
  )
}

// Strokes are kept in a 100 x 30 box, the same box the seal draws into.
function DrawPad({ onChange }) {
  const ref = useRef(null)
  const strokes = useRef([])
  useEffect(() => {
    const c = ref.current; const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1
    c.width = r.width * dpr; c.height = r.height * dpr
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.lineWidth = 2.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#1a2a7a'
    let down = false
    const pt = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top, b.width, b.height] }
    const start = (e) => { down = true; c.setPointerCapture(e.pointerId); const [px, py] = pt(e); x.beginPath(); x.moveTo(px, py); strokes.current.push([[px, py, ...pt(e).slice(2)]]) }
    const move = (e) => { if (!down) return; const p = pt(e); x.lineTo(p[0], p[1]); x.stroke(); strokes.current[strokes.current.length - 1].push(p) }
    const end = () => {
      if (!down) return; down = false
      const d = strokes.current.map(s => s.map(([px, py, w, h], i) => `${i ? 'L' : 'M'}${(px / w * 100).toFixed(1)} ${(py / h * 30).toFixed(1)}`).join(' ')).join(' ')
      onChange(d)
    }
    c.addEventListener('pointerdown', start); c.addEventListener('pointermove', move); c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end)
    return () => { c.removeEventListener('pointerdown', start); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', end); c.removeEventListener('pointercancel', end) }
  }, [onChange])
  return (
    <>
      <canvas ref={ref} className="sgn-canvas" aria-label="Draw your signature" />
      <button type="button" className="sgn-link sgn-clear" onClick={() => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); strokes.current = []; onChange('') }}>Clear</button>
    </>
  )
}

function DeclineSheet({ api, run, busy, onCancel, inline }) {
  const [reason, setReason] = useState('')
  const body = (
    <>
      <p className="sgn-hint">The sender is told, with your reason. Nothing you entered is kept.</p>
      <label className="sgn-lab" htmlFor="sgn-decl">Reason</label>
      <textarea id="sgn-decl" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="sgn-two">
        <button type="button" className="sgn-btn" onClick={onCancel}>Go back</button>
        <button type="button" className="sgn-btn sgn-danger" disabled={busy || !reason.trim()} onClick={() => run(() => api.decline(reason.trim()))}>Decline</button>
      </div>
    </>
  )
  return inline ? body : <div className="sgn-card"><h2>Decline to sign?</h2>{body}</div>
}

function DelegateSheet({ api, run, busy, onClose }) {
  const [f, setF] = useState({ name: '', email: '', reason: '' })
  return (
    <Sheet title="Who should sign?" onClose={onClose}>
      <p className="sgn-hint">The sender approves the change before the new signer gets it.</p>
      {['name', 'email', 'reason'].map(k => (
        <div key={k}><label className="sgn-lab" htmlFor={`sgn-dg-${k}`}>{k === 'name' ? 'Name' : k === 'email' ? 'Email' : 'Reason'}</label>
          <input id={`sgn-dg-${k}`} value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} /></div>
      ))}
      <div className="sgn-two">
        <button type="button" className="sgn-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="sgn-btn sgn-pri" disabled={busy || !f.name.trim() || !f.email.trim()} onClick={() => run(async () => { await api.delegate(f); onClose() })}>Send to the sender</button>
      </div>
    </Sheet>
  )
}

// ── 4. Done ─────────────────────────────────────────────────────────────────────────
function DoneStep({ state, api }) {
  const [err, setErr] = useState(null)
  const download = async () => {
    try { const u = await api.copy(); if (u) window.open(u, '_blank', 'noopener') } catch (e) { setErr(e.message) }
  }
  return (
    <div className="sgn-card sgn-center sgn-done">
      <span className="sgn-ring" aria-hidden="true">✓</span>
      <h2>You signed</h2>
      <p className="sgn-hint">Signed {formatInZone(state.signed_at, state.time_zone || 'America/Los_Angeles')}.{' '}
        {state.next_signer ? `Next, ${state.next_signer} signs. When everyone has signed, you get the sealed copy by email.` : 'You will get the sealed copy by email.'}</p>
      <button type="button" className="sgn-btn" onClick={download}>Download your copy</button>
      {err && <p className="sgn-err" role="alert">{err}</p>}
    </div>
  )
}
