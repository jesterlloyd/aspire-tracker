// src/components/studio/StudioKeithDrawer.jsx
//
// STUDIO-3 (Phase 2b, 2026-11-05): Keith's interview. The sender says what they want to send; Keith
// asks at most MAX_QUESTIONS questions, one at a time, each with choices and counts, then shows the
// brief. "Design it" asks him for the design, which opens as a draft in the editor. Nothing here
// sends, and nothing here is saved until the design opens: the conversation lives in this drawer.
//
// Every answer passes the server's checks (lib/server/studio/studioKeith.js): a link is kept only if
// the sender typed it, a form only if it is a published Catalog form, an audience only from the
// catalog. The brief says when a link is still the sender's to add.

import { useCallback, useEffect, useRef, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import { studioApi } from '../../lib/studio/studioClient'
import { briefLines, MAX_QUESTIONS, ANSWER_MAX } from '../../lib/studio/keithStudio'

const newRef = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => Math.floor(Math.random() * 16).toString(16)))

export default function StudioKeithDrawer({ request, onClose, onDesigned }) {
  const ref = useRef(newRef())
  const [turns, setTurns] = useState([])
  const [step, setStep] = useState(null)        // { kind: 'question', ... } | { kind: 'brief', brief }
  const [picks, setPicks] = useState(() => new Set())
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState('asking')    // '' | 'asking' | 'designing'
  const [error, setError] = useState('')

  const ask = useCallback(async (nextTurns) => {
    setBusy('asking'); setError('')
    try {
      const r = await studioApi('keith_brief', { conversation: { request, turns: nextTurns }, design_ref: ref.current })
      setStep(r); setPicks(new Set()); setOther('')
    } catch (e) {
      setError(e?.message || 'Keith could not answer just now. Try again.')
    } finally {
      setBusy('')
    }
  }, [request])

  // The first question: set only when the answer arrives, never inside the effect itself.
  useEffect(() => {
    let off = false
    studioApi('keith_brief', { conversation: { request, turns: [] }, design_ref: ref.current })
      .then(r => { if (!off) { setStep(r); setBusy('') } })
      .catch(e => { if (!off) { setError(e?.message || 'Keith could not answer just now. Try again.'); setBusy('') } })
    return () => { off = true }
  }, [request])

  const answer = () => {
    const words = [...picks, other.trim()].filter(Boolean).join(', ').slice(0, ANSWER_MAX)
    if (!words || step?.kind !== 'question') return
    const next = [...turns, { question: step.question, answer: words }]
    setTurns(next)
    ask(next)
  }

  const pick = (label) => setPicks(prev => {
    const n = new Set(step?.multi ? prev : [])
    if (prev.has(label)) n.delete(label); else n.add(label)
    return n
  })

  const design = async () => {
    setBusy('designing'); setError('')
    try {
      const r = await studioApi('keith_design', { conversation: { request, turns }, brief: step.brief, design_ref: ref.current })
      onDesigned(r.design, r.design.subject || 'Keith’s draft')
    } catch (e) {
      setError(e?.message || 'Keith could not design it just now. Try again.')
      setBusy('')
    }
  }

  const answered = picks.size > 0 || other.trim()
  const footer = step?.kind === 'brief'
    ? (<>
      <button type="button" className="st-btn" onClick={onClose} disabled={busy === 'designing'}>Cancel</button>
      <button type="button" className="st-btn st-btn-primary" onClick={design} disabled={!!busy}>
        {busy === 'designing' ? 'Designing… (usually under a minute)' : 'Design it →'}
      </button>
    </>)
    : (<>
      <span className="st-sub" style={{ margin: '0 auto 0 0' }}>{`Keith asks ${MAX_QUESTIONS} questions at most`}</span>
      <button type="button" className="st-btn" onClick={onClose}>Cancel</button>
      <button type="button" className="st-btn st-btn-primary" onClick={answer} disabled={!!busy || !answered || step?.kind !== 'question'}>
        {busy === 'asking' ? 'Keith is thinking…' : 'Next →'}
      </button>
    </>)

  return (
    <DetailDrawer open title="Plan It With Keith" onClose={busy === 'designing' ? () => {} : onClose} width={620} trapFocus footer={footer}>
      <div className="st-scope st-keith">
        <p className="st-keith-request"><span className="st-label">You asked</span>{request}</p>
        {turns.map((t, i) => (
          <div key={i} className="st-keith-turn">
            <p className="st-keith-q">{t.question}</p>
            <p className="st-keith-a">{t.answer}</p>
          </div>
        ))}
        {error && (
          <p className="st-notice st-notice-bad" role="alert">
            {error} <button type="button" className="st-btn st-btn-sm" onClick={() => (step?.kind === 'brief' ? design() : ask(turns))}>Try again</button>
          </p>
        )}
        {!step && busy === 'asking' && <p className="st-empty" role="status">Keith is reading your request…</p>}

        {step?.kind === 'question' && (
          <fieldset className="st-fieldset st-keith-ask" aria-busy={busy === 'asking'}>
            <legend className="st-keith-q st-keith-q-now">{step.question}</legend>
            {step.why && <p className="st-sub">{step.why}</p>}
            {step.choices?.length > 0 && (
              <div className="st-keith-choices" role="group" aria-label={step.multi ? 'Choose any' : 'Choose one'}>
                {step.choices.map(c => (
                  <button key={c.label} type="button" className="st-keith-choice" aria-pressed={picks.has(c.label)} onClick={() => pick(c.label)} disabled={!!busy}>
                    {c.label}{c.count != null && <span className="st-keith-count">{c.count}</span>}
                  </button>
                ))}
              </div>
            )}
            {(step.allowOther || !step.choices?.length) && (
              <label className="st-field" style={{ display: 'block', marginTop: 12 }}>
                <span className="st-label">{step.choices?.length ? 'Something else' : 'Your answer'}</span>
                <input className="st-input" value={other} maxLength={ANSWER_MAX} onChange={e => setOther(e.target.value)} disabled={!!busy}
                  onKeyDown={e => { if (e.key === 'Enter' && answered) { e.preventDefault(); answer() } }} />
              </label>
            )}
            {step.multi && <p className="st-sub">Choose any that apply.</p>}
          </fieldset>
        )}

        {step?.kind === 'brief' && (
          <section className="st-keith-brief" aria-labelledby="st-keith-brief-h">
            <h3 id="st-keith-brief-h" className="st-h">The Brief</h3>
            <dl>
              {briefLines(step.brief).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
            </dl>
            {step.brief.points?.length > 0 && (
              <>
                <p className="st-label" style={{ marginTop: 12 }}>It will say</p>
                <ul>{step.brief.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </>
            )}
            {step.brief.action?.kind === 'link' && !step.brief.action.url && (
              <p className="st-notice">The button will have no link until you add one. Studio will not send until you do; Keith never makes up a link.</p>
            )}
            <p className="st-sub">The audience is Keith's proposal. You will review it, and every name, before anything is sent.</p>
          </section>
        )}
      </div>
    </DetailDrawer>
  )
}
