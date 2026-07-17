// ASPIRE MESSAGES, PHASE 5B-i: the student's reply composer.
//
// DORMANT: mounted only by PortalMessagesWorkspace.
//
// The draft lives in React state only. It is never written to localStorage,
// sessionStorage, IndexedDB, or analytics, and background polling never clears
// it because the draft is not derived from any query result.

import { useState } from 'react'
import { Send } from 'lucide-react'
import { replyToPortalConversation } from '../../lib/messages/portalMessagesApiClient'
import {
  MESSAGE_MAX_BODY_CHARS, normalizeBody, validateBodyValue,
} from '../../lib/messages/messagesConstants'
import {
  PORTAL_SAFETY_NOTICE, PORTAL_CLOSED_NOTICE, PORTAL_SEND_CONFIRMATION,
  mapPortalMessagesError, mapPortalConflict, portalConflictIsAccessLost,
} from '../../lib/messages/portalMessagesConstants'

export default function PortalReplyComposer({
  conversationId,
  closed,
  onSent,
  announce,
  api = { replyToPortalConversation },
}) {
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState(null)
  // Set only when the server authoritatively reports that portal access to this
  // conversation is gone. The browser never guesses this.
  const [accessLost, setAccessLost] = useState(false)

  const normalized = normalizeBody(body)
  const check = validateBodyValue(body)
  const disabled = !conversationId || pending || !check.ok || accessLost

  async function send(e) {
    e?.preventDefault?.()
    // One Send activation produces one request. A pending send is ignored
    // outright, covering repeated clicks and repeated Enter.
    if (pending) return
    if (!conversationId || !check.ok || accessLost) return

    setPending(true)
    setErr(null)
    try {
      const out = await api.replyToPortalConversation({
        conversationId,
        body: normalized,
      })
      // Cleared only after authoritative success. No optimistic message is ever
      // inserted: the thread refetch is the single source of truth.
      setBody('')
      announce?.(out?.confirmation || PORTAL_SEND_CONFIRMATION)
      onSent?.(out)
    } catch (e2) {
      // The draft is preserved on EVERY failure path, including 409.
      if (e2?.status === 409) {
        setErr(mapPortalConflict(e2?.code))
        // Only an authoritative access-lost conflict disables sending.
        if (portalConflictIsAccessLost(e2?.code)) setAccessLost(true)
        onSent?.(null, { refreshOnly: true })
      } else {
        setErr(mapPortalMessagesError(e2?.status))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="ptl-msg-composer" onSubmit={send}>
      {closed && !accessLost && (
        <p className="ptl-compose-note ptl-msg-closed-note">{PORTAL_CLOSED_NOTICE}</p>
      )}

      <label className="ptl-label" htmlFor="ptl-reply-body">Reply</label>
      <textarea
        id="ptl-reply-body"
        className="ptl-input ptl-input-full ptl-msg-textarea"
        rows={4}
        value={body}
        maxLength={MESSAGE_MAX_BODY_CHARS}
        onChange={(e) => setBody(e.target.value)}
        disabled={accessLost}
        aria-describedby="ptl-reply-help ptl-reply-safety"
      />
      <div className="ptl-small" id="ptl-reply-help">
        {`${normalized.length} of ${MESSAGE_MAX_BODY_CHARS} characters`}
      </div>

      <p className="ptl-compose-note ptl-msg-safety" id="ptl-reply-safety">{PORTAL_SAFETY_NOTICE}</p>

      {err && <p className="ptl-form-error" role="alert">{err}</p>}

      <div className="ptl-form-actions">
        <button type="submit" className="ptl-btn-primary" disabled={disabled}>
          <Send size={15} aria-hidden="true" /> {pending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  )
}
