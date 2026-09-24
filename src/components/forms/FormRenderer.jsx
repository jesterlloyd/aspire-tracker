// src/components/forms/FormRenderer.jsx
//
// FORMS-PHASE3: the form as a respondent answers it. One component for the public page
// (/form) and for staff "Preview as student", so what staff preview is what people get.
// Mobile first and light-locked (formRespond.css): a respondent is often a student on a
// phone. Answers ASPIRE already has arrive filled in and stay editable; before submitting,
// the respondent reviews every answer and can go back to change one (brief section 5).
import { useEffect, useMemo, useRef, useState } from 'react'
import { takesAnswer, answerIssues, answerText } from '../../lib/forms/formModel'
import './formRespond.css'

const readDraft = (key) => { try { return key ? JSON.parse(localStorage.getItem(key) || 'null') : null } catch { return null } }
const writeDraft = (key, v) => { try { if (key) localStorage.setItem(key, JSON.stringify(v)) } catch { /* private mode: no draft */ } }
const dropDraft = (key) => { try { if (key) localStorage.removeItem(key) } catch { /* nothing to drop */ } }

export default function FormRenderer({ definition, prefill = {}, onSubmit, onUpload, draftKey = null, preview = false, dueAt = null, sender = null }) {
  const questions = useMemo(() => definition?.questions || [], [definition])
  const [answers, setAnswers] = useState(() => ({ ...prefill, ...(readDraft(draftKey) || {}) }))
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('fill')       // fill | review
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const firstBad = useRef(null)

  useEffect(() => { if (!preview) writeDraft(draftKey, answers) }, [answers, draftKey, preview])
  const set = (id, v) => { setAnswers(a => ({ ...a, [id]: v })); setErrors(e => { const n = { ...e }; delete n[id]; return n }) }

  const review = () => {
    const issues = answerIssues(definition, answers)
    setErrors(issues)
    const bad = questions.find(q => issues[q.id])
    if (bad) {
      firstBad.current = bad.id
      requestAnimationFrame(() => document.getElementById(`frm-q-${bad.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      return
    }
    setStep('review'); window.scrollTo({ top: 0 })
  }
  const submit = async () => {
    setBusy(true); setError(null)
    try { await onSubmit?.(answers); dropDraft(draftKey) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const count = Object.keys(errors).length
  return (
    <div className="frm-sheet">
      <header className="frm-head">
        <h1>{definition.title}</h1>
        {definition.description && <p>{definition.description}</p>}
        {(dueAt || sender) && <p className="frm-meta">{sender ? `From ${sender}` : ''}{sender && dueAt ? ' · ' : ''}{dueAt ? `Due ${new Date(dueAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}</p>}
        {preview && <p className="frm-preview">Preview: answers are samples, and nothing is saved or sent.</p>}
      </header>

      {step === 'fill' && (
        <form className="frm-body" noValidate onSubmit={(e) => { e.preventDefault(); review() }}>
          {count > 0 && <p className="frm-err" role="alert">{count === 1 ? 'One answer needs attention.' : `${count} answers need attention.`}</p>}
          {questions.map(q => q.type === 'section'
            ? <div key={q.id} className="frm-section"><h2>{q.label}</h2>{q.help && <p>{q.help}</p>}</div>
            : <Question key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} prefilled={q.prefill && prefill[q.id] != null && answers[q.id] === prefill[q.id]}
                onChange={(v) => set(q.id, v)} onUpload={onUpload} preview={preview} />)}
          <div className="frm-actions"><button type="submit" className="frm-btn frm-pri">Review answers</button></div>
        </form>
      )}

      {step === 'review' && (
        <div className="frm-body">
          <p className="frm-hint">Check your answers. Change one with Edit, or submit.</p>
          <dl className="frm-review">
            {questions.filter(takesAnswer).map(q => (
              <div key={q.id}><dt>{q.label}</dt><dd>{q.type === 'signature' && answers[q.id]?.kind === 'draw'
                ? <SigPreview path={answers[q.id].path} />
                : (answerText(q, answers[q.id]) || <span className="frm-none">No answer</span>)}</dd></div>
            ))}
          </dl>
          {error && <p className="frm-err" role="alert">{error}</p>}
          <div className="frm-actions">
            <button type="button" className="frm-btn" onClick={() => setStep('fill')} disabled={busy}>Edit</button>
            <button type="button" className="frm-btn frm-pri" onClick={submit} disabled={busy || preview}>{busy ? 'Submitting…' : preview ? 'Submit (off in preview)' : 'Submit'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Question({ q, value, error, prefilled, onChange, onUpload, preview }) {
  const id = `frm-q-${q.id}`
  const describedBy = [q.help ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined
  const common = { id: `${id}-in`, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined }
  const grouped = q.type === 'choice' || q.type === 'checkboxes' || q.type === 'signature'
  const Label = grouped ? 'legend' : 'label'
  const Wrap = grouped ? 'fieldset' : 'div'
  return (
    <Wrap className={`frm-q${error ? ' frm-q-bad' : ''}`} id={id}>
      <Label className="frm-label" {...(grouped ? {} : { htmlFor: `${id}-in` })}>{q.label}{q.required && <span className="frm-req" aria-label="required"> *</span>}</Label>
      {q.help && <p className="frm-help" id={`${id}-help`}>{q.help}</p>}
      {prefilled && <p className="frm-filled">Filled in from your ASPIRE record. Change it if it is wrong.</p>}
      <Control q={q} value={value} onChange={onChange} common={common} onUpload={onUpload} preview={preview} />
      {error && <p className="frm-qerr" id={`${id}-err`}>{error}</p>}
    </Wrap>
  )
}

function Control({ q, value, onChange, common, onUpload, preview }) {
  switch (q.type) {
    case 'paragraph': return <textarea {...common} rows={4} value={value || ''} onChange={e => onChange(e.target.value)} />
    case 'number': return <input {...common} type="number" inputMode="decimal" min={q.min ?? undefined} max={q.max ?? undefined} value={value ?? ''} onChange={e => onChange(e.target.value)} className="frm-num" />
    case 'date': return <input {...common} type="date" value={value || ''} onChange={e => onChange(e.target.value)} className="frm-date" />
    case 'dropdown': return (
      <select {...common} value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">Choose…</option>{(q.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>)
    case 'choice': return (
      <div className="frm-opts" role="radiogroup" aria-describedby={common['aria-describedby']}>
        {(q.options || []).map(o => <label key={o} className={`frm-opt${value === o ? ' frm-on' : ''}`}><input type="radio" name={common.id} checked={value === o} onChange={() => onChange(o)} /><span>{o}</span></label>)}
      </div>)
    case 'checkboxes': {
      const list = Array.isArray(value) ? value : []
      return (
        <div className="frm-opts" aria-describedby={common['aria-describedby']}>
          {(q.options || []).map(o => <label key={o} className={`frm-opt${list.includes(o) ? ' frm-on' : ''}`}><input type="checkbox" checked={list.includes(o)} onChange={e => onChange(e.target.checked ? [...list, o] : list.filter(x => x !== o))} /><span>{o}</span></label>)}
        </div>)
    }
    case 'file': return <FileControl common={common} value={value} onChange={onChange} onUpload={onUpload} preview={preview} />
    case 'signature': return <SignatureControl value={value} onChange={onChange} labelId={common.id} />
    default: return <input {...common} type="text" value={value || ''} onChange={e => onChange(e.target.value)} autoComplete="off" />
  }
}

function FileControl({ common, value, onChange, onUpload, preview }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const pick = async (file) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setErr('Files can be up to 10 MB.'); return }
    setBusy(true); setErr(null)
    try { onChange(preview ? { path: 'preview', name: file.name, size: file.size } : await onUpload(file)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="frm-file">
      <label className="frm-btn" htmlFor={common.id}>{busy ? 'Uploading…' : value?.name ? 'Replace file' : 'Choose a file'}</label>
      <input {...common} className="frm-sr" type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx" onChange={e => pick(e.target.files?.[0])} />
      <span className="frm-hint">{value?.name ? `${value.name} is attached.` : 'PDF, photo or Word file, up to 10 MB.'}</span>
      {err && <span className="frm-qerr">{err}</span>}
    </div>
  )
}

// A simple typed or drawn signature printed on the form's PDF (Owner, 2026-09-23). A
// legally binding signature is a Signature template, not a form question.
function SignatureControl({ value, onChange, labelId }) {
  const kind = value?.kind || 'type'
  return (
    <div className="frm-sig">
      <div className="frm-seg" role="group" aria-label="How to sign">
        <button type="button" aria-pressed={kind === 'type'} onClick={() => onChange({ kind: 'type', text: value?.text || '' })}>Type</button>
        <button type="button" aria-pressed={kind === 'draw'} onClick={() => onChange({ kind: 'draw', path: '', text: value?.text || '' })}>Draw</button>
      </div>
      {kind === 'type'
        ? <>
            <input id={labelId} type="text" value={value?.text || ''} onChange={e => onChange({ kind: 'type', text: e.target.value })} placeholder="Type your full name" autoComplete="name" />
            {value?.text && <div className="frm-sigline" aria-hidden="true">{value.text}</div>}
          </>
        : <DrawPad value={value} onChange={onChange} />}
    </div>
  )
}

function DrawPad({ value, onChange }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const [path, setPath] = useState(value?.path || '')
  const at = (e) => {
    const r = ref.current.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width * 100).toFixed(1), ((e.clientY - r.top) / r.height * 30).toFixed(1)]
  }
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true; const [x, y] = at(e); setPath(p => `${p}M${x} ${y} `) }
  const move = (e) => { if (!drawing.current) return; const [x, y] = at(e); setPath(p => `${p}L${x} ${y} `) }
  const up = () => { if (!drawing.current) return; drawing.current = false; setPath(p => { onChange({ kind: 'draw', path: p.trim(), text: value?.text || '' }); return p }) }
  const clear = () => { setPath(''); onChange({ kind: 'draw', path: '', text: value?.text || '' }) }
  return (
    <div className="frm-draw">
      <svg ref={ref} viewBox="0 0 100 30" className="frm-pad" role="img" aria-label="Signature pad. Draw with your finger or mouse."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}>
        <line x1="4" y1="25" x2="96" y2="25" className="frm-padline" />
        <path d={path} className="frm-ink" />
      </svg>
      <button type="button" className="frm-link" onClick={clear}>Clear</button>
    </div>
  )
}

const SigPreview = ({ path }) => <svg viewBox="0 0 100 30" className="frm-sigprev" aria-label="Drawn signature"><path d={path} className="frm-ink" /></svg>

