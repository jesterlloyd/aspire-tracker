// src/components/catalog/CatalogSendModal.jsx
//
// CATALOG-REVAMP-1 (Phase 1): Send. Every Catalog send is an Outreach bulk send
// (/api/connect-send-bulk-message) with the file attached by slug, the same request the
// Outreach composer makes, plus the item's id so the server writes the Catalog send log.
// Messages is never used (Owner, 2026-09-23).
//
// The To field holds tokens ("Fall 2026 cohort", "4 South students"); catalogModel turns
// them into the exact people list, which the modal shows before anything is sent. The
// server only verifies that list (BULK-EXACT-RECIPIENTS-1); it never widens it.
import { useMemo, useState } from 'react'
import { Paperclip, Link2, X, Send as SendIcon, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildPayloadRecipients } from '../../lib/connect/bulkAudience'
import {
  suggestTokens, defaultTokens, expandTokens, searchPeople, chunkRecipients, sendAsFor,
  defaultMessage, defaultSubject, messageForSend,
} from '../../lib/catalog/catalogModel'
import useModalFocus from './useModalFocus'

const SEND_ENDPOINT = '/api/connect-send-bulk-message'
const CONFIRM_PHRASE = 'SEND MESSAGES'

const REASON_TEXT = {
  email_mismatch: 'email on file changed',
  not_proceeding_not_acknowledged: 'Not Proceeding',
  duplicate: 'listed twice',
  contact_inactive: 'contact inactive',
  already_sent_in_batch: 'already sent',
}
const reasonText = (r) => REASON_TEXT[r] || String(r || '').replace(/^send_error: /, '').replace(/_/g, ' ')

export default function CatalogSendModal({ item, ctx, contactsLoading, onClose, onSent }) {
  const [tokens, setTokens] = useState(() => defaultTokens(item, ctx))
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState(() => defaultSubject(item))
  const [message, setMessage] = useState(() => defaultMessage(item))
  const [showPeople, setShowPeople] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)   // shown when anything was skipped or failed
  const dialogRef = useModalFocus(onClose, { disabled: sending })

  const suggestions = useMemo(() => {
    const on = new Set(tokens.map(t => t.key))
    return suggestTokens(item, ctx).filter(t => !on.has(t.key))
  }, [item, ctx, tokens])
  const hits = useMemo(() => {
    const on = new Set(tokens.map(t => t.key))
    return searchPeople(q, ctx).filter(t => !on.has(t.key))
  }, [q, ctx, tokens])
  const people = useMemo(() => expandTokens(tokens, ctx), [tokens, ctx])
  const sendAs = sendAsFor(item)
  const isLink = item.resource_type === 'external_link'

  const addToken = (t) => { setTokens(ts => [...ts, t]); setQ('') }
  const removeToken = (key) => setTokens(ts => ts.filter(t => t.key !== key))

  async function send() {
    setError(null)
    if (!people.length) { setError('Add at least one recipient.'); return }
    if (!subject.trim()) { setError('Add a subject.'); return }
    if (!message.trim()) { setError('Write a message.'); return }
    setSending(true)
    const totals = { sent: 0, skipped: [], failed: [], log: new Set() }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setError('Your session expired. Please sign in again.'); return }
      // Outreach takes at most 75 people per request; a larger send is several batches,
      // each its own logged send. They go one after another, never in parallel.
      for (const chunk of chunkRecipients(people)) {
        const res = await fetch(SEND_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            confirmation: CONFIRM_PHRASE,
            batch_id: crypto.randomUUID(),
            template_key: 'catalog_send',
            template_label: item.title,
            subject: subject.trim(),
            body: messageForSend(item, message),
            body_format: 'text',
            include_signature: true,
            attachment_slugs: item.resource_type === 'internal_file' ? [item.slug] : [],
            recipients: buildPayloadRecipients(chunk),
            catalog_resource_id: item.id,
            catalog_audience_labels: tokens.map(t => t.label),
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          const partial = totals.sent ? ` ${totals.sent} were sent before it stopped.` : ''
          setError(`${data?.error || `Send failed (HTTP ${res.status}).`}${partial}`)
          if (totals.sent) onSent?.({ sent: totals.sent, log: [...totals.log], keepOpen: true })
          return
        }
        totals.sent += data.summary?.sent || 0
        totals.skipped.push(...(data.skipped || []))
        totals.failed.push(...(data.failed || []))
        if (data.catalog_log) totals.log.add(data.catalog_log)
      }
      const outcome = { sent: totals.sent, log: [...totals.log] }
      if (totals.skipped.length || totals.failed.length) {
        setResult({ ...totals, log: outcome.log })
        onSent?.({ ...outcome, keepOpen: true })
      } else {
        onSent?.(outcome)
      }
    } catch {
      setError('Network error. Nothing further was sent; check Sent History before trying again.')
    } finally {
      setSending(false)
    }
  }

  const nameByEmail = useMemo(() => new Map(people.map(p => [p.email.toLowerCase(), p.name])), [people])

  return (
    <div className="modal-overlay" onMouseDown={() => !sending && onClose()}>
      <div ref={dialogRef} className="modal ctl-modal" role="dialog" aria-modal="true" aria-labelledby="ctl-send-title"
        onMouseDown={e => e.stopPropagation()}>
        <div className="ctl-mh">
          <div>
            <h2 id="ctl-send-title">Send {item.title}</h2>
            <p>Goes out through ASPIRE Connect and is logged.</p>
          </div>
          <button type="button" className="ctl-icon-btn" onClick={() => !sending && onClose()} aria-label="Close"><X size={16} /></button>
        </div>

        {result ? (
          <div className="ctl-mb">
            <p className="ctl-result-lead"><b>{result.sent}</b> sent. {result.skipped.length + result.failed.length} not sent:</p>
            <ul className="ctl-result-list">
              {[...result.skipped, ...result.failed].map((r, i) => (
                <li key={i}><span>{nameByEmail.get(String(r.email || '').toLowerCase()) || r.email}</span><span>{reasonText(r.reason)}</span></li>
              ))}
            </ul>
            <p className="ctl-hint">Every send, and every one not sent, is on this item's send log.</p>
          </div>
        ) : (
          <div className="ctl-mb">
            <div className="ctl-field">
              <span className="ctl-lab" id="ctl-to-label">To</span>
              <div className="ctl-tokens" role="group" aria-labelledby="ctl-to-label">
                {tokens.map(t => (
                  <span key={t.key} className="ctl-tok">
                    {t.label} ({t.count})
                    <button type="button" onClick={() => removeToken(t.key)} aria-label={`Remove ${t.label}`}>×</button>
                  </span>
                ))}
                <input value={q} onChange={e => setQ(e.target.value)} data-autofocus
                  placeholder={contactsLoading ? 'Loading contacts…' : 'Student, cohort, unit or school'}
                  aria-label="Add a recipient by name"
                  onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); addToken(hits[0]) } }} />
              </div>
              {hits.length > 0 && (
                <div className="ctl-hits" role="listbox" aria-label="Matching people">
                  {hits.map(h => (
                    <button key={h.key} type="button" role="option" aria-selected="false" onClick={() => addToken(h)}>
                      <b>{h.label}</b><small>{h.sub}</small>
                    </button>
                  ))}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="ctl-sugg">
                  {suggestions.map(s => (
                    <button key={s.key} type="button" onClick={() => addToken(s)}>+ {s.label} ({s.count})</button>
                  ))}
                </div>
              )}
              <div className="ctl-reach">
                <span><b>{people.length}</b> {people.length === 1 ? 'person' : 'people'} will receive this. Not Proceeding students and anyone without an email are left out.</span>
                {people.length > 0 && (
                  <button type="button" className="ctl-link" aria-expanded={showPeople} onClick={() => setShowPeople(v => !v)}>
                    {showPeople ? <>Hide list <ChevronUp size={13} /></> : <>Review list <ChevronDown size={13} /></>}
                  </button>
                )}
              </div>
              {showPeople && (
                <ul className="ctl-people-review">
                  {people.map(p => <li key={p.email}><span>{p.name || p.email}</span><small>{p.email}</small></li>)}
                </ul>
              )}
            </div>

            <div className="ctl-sendas">
              {isLink ? <Link2 size={18} /> : <Paperclip size={18} />}
              <span><b>Sends as: {sendAs.title}.</b> {sendAs.line}</span>
            </div>

            <div className="ctl-field">
              <label htmlFor="ctl-send-subject">Subject</label>
              <input id="ctl-send-subject" value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="ctl-field">
              <label htmlFor="ctl-send-msg">Message</label>
              <textarea id="ctl-send-msg" value={message} onChange={e => setMessage(e.target.value)} />
              <p className="ctl-hint">{'{first name}'} is replaced with each person's first name. Your email signature is added.</p>
            </div>
            {error && <div className="ctl-err" role="alert">{error}</div>}
          </div>
        )}

        <div className="ctl-mf">
          <small>Logged on this item and on each recipient's record.</small>
          <span className="ctl-mf-acts">
            {result ? (
              <button type="button" className="ctl-btn ctl-btn-pri" onClick={onClose}>Done</button>
            ) : (
              <>
                <button type="button" className="ctl-btn" onClick={onClose} disabled={sending}>Cancel</button>
                <button type="button" className="ctl-btn ctl-btn-pri" onClick={send} disabled={sending || !people.length}>
                  <SendIcon size={15} /> {sending ? 'Sending…' : `Send to ${people.length}`}
                </button>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
