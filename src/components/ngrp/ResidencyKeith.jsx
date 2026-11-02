// RESIDENCY-KEITH-1 (Owner, 2026-11-01): Keith chat in the Residency Portal. The header gets the
// Keith control beside ASPIRE Connect (the lower right belongs to Messages); it opens a side drawer
// that talks to /api/keith-residency, which reads only the open cohort's applicants and writes
// nothing (lib/server/keith/residencyChat.js). Haiku or Sonnet; no Keith settings here. The
// conversation lives in this tab only and starts over when the cohort changes.
import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import DetailDrawer from '../ui/DetailDrawer'
import SegmentedPicker from '../shared/SegmentedPicker'
import { renderMarkdownLite } from '../../lib/keithMarkdown'
import { postNgrpKeith } from '../../lib/ngrp/useNgrpData'
import { ORB_SRC } from '../keith/KeithMark'

const MODELS = [
  { value: 'haiku', label: 'Haiku 5.5', title: 'Quick answers' },
  { value: 'sonnet', label: 'Sonnet 5.5', title: 'Deeper reading and comparisons' },
]
const STARTERS = [
  'Who are the strongest fits for 6 NE?',
  'Which applicants have not submitted the Transition Form?',
  'Summarize the top five candidate scores.',
]
const FAIL_WORDS = {
  rate_limited: 'Keith has answered a lot in the last few minutes. Try again shortly.',
  timeout: 'That took too long. Try a narrower question.',
  cycle_not_found: 'This residency cohort could not be read.',
}

export function ResidencyKeithButton({ open, onClick }) {
  const rest = open ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'
  return (
    <Tooltip label="Keith" placement="bottom">
      <button
        type="button"
        aria-label="Ask Keith about this cohort's applicants"
        aria-expanded={open}
        onClick={onClick}
        className="ngrp-keith-btn"
        style={{
          background: rest,
          border: `1px solid ${open ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
        }}
      >
        <img src={ORB_SRC} alt="" width={20} height={20} draggable="false" />
      </button>
    </Tooltip>
  )
}

export function ResidencyKeithPanel({ open, onClose, cycle }) {
  const [model, setModel] = useState('haiku')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)
  const cycleId = cycle?.id || null

  // A new cohort is a new conversation: answers about one roster never carry into another.
  const [forCycle, setForCycle] = useState(cycleId)
  if (forCycle !== cycleId) { setForCycle(cycleId); setMessages([]); setError(null) }

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [messages, busy])

  const ask = async (text) => {
    const q = String(text || '').trim()
    if (!q || busy || !cycleId) return
    const next = [...messages, { role: 'user', content: q }]
    setMessages(next); setDraft(''); setBusy(true); setError(null)
    const res = await postNgrpKeith('chat', { cycle_id: cycleId, chat_model: model, messages: next })
    setBusy(false)
    if (res.ok && res.answer) setMessages(m => [...m, { role: 'assistant', content: res.answer }])
    else setError(FAIL_WORDS[res.code] || 'Keith could not answer. Try again.')
  }

  return (
    <DetailDrawer open={open} title="Keith" width={480} onClose={onClose}>
      <div className="ngrp-keith">
        <div className="ngrp-keith-bar">
          <SegmentedPicker options={MODELS} value={model} onChange={setModel} ariaLabel="Keith model" size="sm" />
          {messages.length > 0 && (
            <button type="button" className="ngrp-linkbtn" onClick={() => { setMessages([]); setError(null) }}>New chat</button>
          )}
        </div>
        <p className="ngrp-keith-scope">
          Keith reads {cycle?.name ? `${cycle.name}'s` : 'this cohort’s'} applicants: their forms, candidate scores,
          résumé reviews, shared preceptor feedback and interviews. Read only. Check anything that matters against the record.
        </p>
        <div className="ngrp-keith-log" aria-live="polite">
          {messages.length === 0 && (
            <div className="ngrp-keith-starters">
              {STARTERS.map(s => (
                <button key={s} type="button" className="ngrp-keith-starter" onClick={() => ask(s)} disabled={busy || !cycleId}>{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ngrp-keith-msg ngrp-keith-${m.role}`}>
              {m.role === 'assistant' ? renderMarkdownLite(m.content) : m.content}
            </div>
          ))}
          {busy && <div className="ngrp-keith-msg ngrp-keith-assistant ngrp-keith-wait" role="status">Reading the roster…</div>}
          {error && <p className="ngrp-keith-error" role="alert">{error}</p>}
          <div ref={endRef} />
        </div>
        <form className="ngrp-keith-input" onSubmit={e => { e.preventDefault(); ask(draft) }}>
          <textarea
            value={draft} rows={2} maxLength={4000}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft) } }}
            placeholder="Ask about this cohort's applicants"
            aria-label="Ask Keith"
          />
          <button type="submit" aria-label="Send" disabled={busy || !draft.trim() || !cycleId}><Send size={15} /></button>
        </form>
      </div>
    </DetailDrawer>
  )
}
