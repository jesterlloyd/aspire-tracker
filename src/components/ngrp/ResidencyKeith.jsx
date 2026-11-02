// RESIDENCY-KEITH-1 (Owner, 2026-11-01): Keith chat in the Residency Portal. It talks to
// /api/keith-residency, which reads only the open cohort's applicants and writes nothing
// (lib/server/keith/residencyChat.js). Haiku or Sonnet; no Keith settings here. The conversation
// lives in this tab only and starts over when the cohort changes.
//
// RESIDENCY-KEITH-2 (Owner, 2026-11-02: "why not reuse what was already existing?"): it is the staff
// app's Keith, drawn by the same KeithChatShell (orb in the lower right corner, the panel above it,
// the navy head, the input row, the model in the footer). Only the conversation and the endpoint are
// its own. portal.css moves the portal's Messages launcher up above the orb, as in the staff app.
import { useEffect, useRef, useState } from 'react'
import KeithChatShell, { KeithWelcome, KeithChips, KeithMessage, KeithTyping, KeithFooter, KeithRetry } from '../keith/KeithChatShell'
import { renderMarkdownLite } from '../../lib/keithMarkdown'
import { postNgrpKeith } from '../../lib/ngrp/useNgrpData'

const MODELS = ['haiku', 'sonnet']
const MODEL_LABELS = { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5' }
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
// Below 760px the portal's bottom bar takes the lowest 58px, so the orb and the panel sit above it.
const PHONE = '(max-width: 760px)'

function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE)
    if (!mq) return undefined
    const on = () => setPhone(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return phone
}

export default function ResidencyKeith({ cycle }) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState('haiku')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [replay, setReplay] = useState(0)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const phone = usePhone()
  const cycleId = cycle?.id || null

  // A new cohort is a new conversation: answers about one roster never carry into another.
  const [forCycle, setForCycle] = useState(cycleId)
  if (forCycle !== cycleId) { setForCycle(cycleId); setMessages([]) }

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [messages, busy, open])
  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // A retry passes the conversation before the question that failed, so it is asked once.
  const ask = async (text, before = messages) => {
    const q = String(text || '').trim()
    if (!q || busy || !cycleId) return
    const history = before.filter(m => !m.failed).map(({ role, content }) => ({ role, content }))
    const next = [...history, { role: 'user', content: q }]
    setMessages([...before, { role: 'user', content: q }]); setDraft(''); setBusy(true)
    const res = await postNgrpKeith('chat', { cycle_id: cycleId, chat_model: model, messages: next })
    setBusy(false)
    if (res.ok && res.answer) setMessages(m => [...m, { role: 'assistant', content: res.answer }])
    else setMessages(m => [...m, { role: 'assistant', failed: true, retry: q, content: FAIL_WORDS[res.code] || 'Keith could not answer. Try again.' }])
  }

  return (
    <KeithChatShell
      open={open}
      busy={busy}
      replay={replay}
      onReplay={() => setReplay(n => n + 1)}
      onToggle={() => setOpen(o => !o)}
      onClose={() => setOpen(false)}
      onNew={() => setMessages([])}
      launcherBottom={phone ? '82px' : '24px'}
      panelBottom={phone ? '154px' : '96px'}
      panelHeightGap={phone ? '218px' : '160px'}
      endRef={endRef}
      input={{
        ref: inputRef,
        value: draft,
        maxLength: 4000,
        onChange: e => setDraft(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft) } },
        placeholder: "Ask about this cohort's applicants…",
        canSend: Boolean(draft.trim()) && !busy && Boolean(cycleId),
        onSend: () => ask(draft),
      }}
      footer={<KeithFooter label={cycle?.name || 'No cohort'} models={MODELS} value={model} onChange={setModel} labels={MODEL_LABELS} />}
    >
      <KeithWelcome title="Ask Keith about your applicants">
        Keith reads {cycle?.name ? `${cycle.name}'s` : 'this cohort’s'} applicants: their forms, candidate
        scores, résumé reviews, shared preceptor feedback and interviews. Read only. Check anything that
        matters against the record.
      </KeithWelcome>

      {messages.length === 0 && <KeithChips chips={STARTERS} disabled={busy || !cycleId} onPick={ask} />}

      {messages.map((m, i) => (
        <KeithMessage
          key={i}
          fromUser={m.role === 'user'}
          ai={m.role === 'assistant' && !m.failed}
          body={m.role === 'assistant' && !m.failed ? renderMarkdownLite(m.content) : m.content}
          after={m.failed && <KeithRetry onClick={() => ask(m.retry, messages.slice(0, i - 1))} disabled={busy} />}
        />
      ))}

      {busy && <KeithTyping />}
    </KeithChatShell>
  )
}
