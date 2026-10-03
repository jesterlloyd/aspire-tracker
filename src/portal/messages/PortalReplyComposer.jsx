// ASPIRE MESSAGES, PHASE 5B-i: the student's reply composer.
//
// DORMANT: mounted only by PortalMessagesWorkspace.
//
// MESSAGE-DRAFTS-1 (Owner, 2026-10-03): the draft is saved in this browser under
// the signed-in person's own id (useMessageDraft), so leaving Messages or closing
// the page mid-sentence loses nothing. It is removed when it is sent, emptied or
// discarded, and after seven days. Never in analytics, and background polling
// never clears it because the draft is not derived from any query result.

import { useRef, useState } from 'react'
import { useMessageDraft } from '../../lib/messages/useMessageDraft'
import { Send } from 'lucide-react'
import { replyToPortalConversation } from '../../lib/messages/portalMessagesApiClient'
import {
  MESSAGE_MAX_BODY_CHARS, normalizeBody, validateBodyValue,
} from '../../lib/messages/messagesConstants'
import {
  PORTAL_CLOSED_NOTICE, PORTAL_SEND_CONFIRMATION, PORTAL_SAFETY_NOTICE,
  mapPortalMessagesError, mapPortalConflict, portalConflictIsAccessLost,
} from '../../lib/messages/portalMessagesConstants'

export default function PortalReplyComposer({
  conversationId,
  closed,
  showNotice = false,
  onSent,
  announce,
  api = { replyToPortalConversation },
}) {
  const { draft, update, discard, saved } = useMessageDraft(conversationId ? `reply.${conversationId}` : null, { body: '' })
  const body = draft.body || ''
  const setBody = (value) => update({ body: value })
  const [pending, setPending] = useState(false)
  // Synchronous send mutex; see PortalNewMessageDrawer. React state alone cannot
  // block repeats that land inside a single tick.
  const sendingRef = useRef(false)
  const [err, setErr] = useState(null)
  // Set only when the server authoritatively reports that portal access to this
  // conversation is gone. The browser never guesses this.
  const [accessLost, setAccessLost] = useState(false)

  const normalized = normalizeBody(body)
  const check = validateBodyValue(body)
  const disabled = !conversationId || pending || !check.ok || accessLost

  async function send(e) {
    e?.preventDefault?.()
    // One Send activation produces one request, checked and set synchronously so
    // repeats within the same tick cannot slip through.
    if (sendingRef.current || pending) return
    if (!conversationId || !check.ok || accessLost) return

    sendingRef.current = true
    setPending(true)
    setErr(null)
    try {
      const out = await api.replyToPortalConversation({
        conversationId,
        body: normalized,
      })
      // Cleared only after authoritative success. No optimistic message is ever
      // inserted: the thread refetch is the single source of truth.
      discard()
      announce?.(out?.confirmation || PORTAL_SEND_CONFIRMATION)
      onSent?.(out)
    } catch (e2) {
      // The draft is preserved on EVERY failure path, including 409.
      if (e2?.status === 409) {
        setErr(mapPortalConflict(e2?.reason))
        // Only an authoritative access-lost conflict disables sending.
        if (portalConflictIsAccessLost(e2?.reason)) setAccessLost(true)
        onSent?.(null, { refreshOnly: true })
      } else {
        setErr(mapPortalMessagesError(e2?.status))
      }
    } finally {
      sendingRef.current = false
      setPending(false)
    }
  }

  return (
    <form className="ptl-msg-composer" onSubmit={send}>
      {closed && !accessLost && (
        <p className="ptl-compose-note ptl-msg-closed-note">{PORTAL_CLOSED_NOTICE}</p>
      )}

      {/* MESSAGES-REFINE-2: the label is for assistive technology; the field
          says what it is. */}
      <label className="ptl-label sr-only" htmlFor="ptl-reply-body">Reply</label>
      <div className="ptl-msg-compose-row">
        <textarea
          id="ptl-reply-body"
          className="ptl-input ptl-input-full ptl-msg-textarea"
          rows={2}
          value={body}
          maxLength={MESSAGE_MAX_BODY_CHARS}
          onChange={(e) => setBody(e.target.value)}
          disabled={accessLost}
          placeholder="Write a message"
          aria-describedby="ptl-reply-help"
        />
        <button type="submit" className="ptl-msg-send-circle" disabled={disabled} aria-label="Send message">
          <Send size={16} aria-hidden="true" />
        </button>
      </div>
      {/* The count shows once it matters (the last 500 characters); assistive
          technology always has it. */}
      <div
        className={`ptl-small${normalized.length > MESSAGE_MAX_BODY_CHARS - 500 ? '' : ' sr-only'}`}
        id="ptl-reply-help"
      >
        {`${normalized.length} of ${MESSAGE_MAX_BODY_CHARS} characters`}
      </div>
      {/* MESSAGES-REFINE-2: the safety notice sits where you write, not above
          the whole workspace. Opt-in: the Team Messages panel shows its own. */}
      {showNotice && <p className="ptl-msg-compose-notice">{PORTAL_SAFETY_NOTICE}</p>}

      {saved && !pending && (
        <p className="ptl-small ptl-msg-draft-note">
          Draft saved
          <button type="button" className="ptl-msg-draft-discard" onClick={discard}>Discard</button>
        </p>
      )}

      {err && <p className="ptl-form-error" role="alert">{err}</p>}

      {pending && <p className="ptl-small" role="status">Sending...</p>}
    </form>
  )
}
