// ASPIRE MESSAGES, PHASE 5B-i: the complete Student Portal Messages workspace.
//
// DORMANT: no routed portal page imports this. StudentPortal.jsx is unchanged,
// PortalShell.jsx carries no Messages navigation, and no portal route exposes it.
// Phase 5B-ii performs the activation.
//
// Client-side hiding is NOT the security boundary. Every read and write goes
// through an authenticated /api/portal/ endpoint that independently verifies an
// active Student Portal grant and an active student link against the caller's
// own JWT, and returns 401, 403, or a non-enumerating 404 otherwise. Removing
// this component's gate in devtools would reveal an empty shell whose every
// request fails.

import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'
import PortalMessagesInbox from './PortalMessagesInbox'
import PortalMessagesThread from './PortalMessagesThread'
import PortalNewMessageDrawer from './PortalNewMessageDrawer'
import PortalReplyComposer from './PortalReplyComposer'
import { markPortalConversationRead } from '../../lib/messages/portalMessagesApiClient'
import { portalThreadQueryKey } from '../../lib/messages/portalThreadState'
import {
  PORTAL_ACTIVE_POLL_MS, usePortalIsNarrow, usePortalUnreadCount,
} from '../../lib/messages/portalMessagesPolling'
import { formatUnread, unreadLabel } from '../../lib/messages/messagesConstants'
import { PORTAL_SUBTITLE, portalStatusIsClosed } from '../../lib/messages/portalMessagesConstants'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

export default function PortalMessagesWorkspace({
  active = true,
  api = { markPortalConversationRead },
}) {
  const qc = useQueryClient()
  const narrow = usePortalIsNarrow()
  const newBtnRef = useRef(null)

  const [selectedId, setSelectedId] = useState(null)
  const [conversation, setConversation] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // Mobile is list-first: the thread is a separate view, never a squeezed column.
  const [mobileView, setMobileView] = useState('list')

  const announce = useCallback((text) => {
    setAnnouncement('')
    // Re-set on the next tick so an identical consecutive message is still read.
    setTimeout(() => setAnnouncement(text), 30)
  }, [])

  const unread = usePortalUnreadCount({
    enabled: active,
    intervalMs: PORTAL_ACTIVE_POLL_MS,
  })

  const refreshInbox = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['portal_messages_list'] })
    qc.invalidateQueries({ queryKey: ['portal_messages_unread'] })
  }, [qc])

  const refreshThread = useCallback((id) => {
    if (id) qc.invalidateQueries({ queryKey: portalThreadQueryKey(id) })
  }, [qc])

  // Mark read only on an authoritative newest-page render, and only for the
  // conversation still selected. Never on an older-page load, never on hover,
  // and never with a client timestamp or a client profile id: the endpoint takes
  // only conversation_id.
  const handleMarkRead = useCallback(async (id) => {
    try {
      await api.markPortalConversationRead({ conversationId: id })
      // Clear unread for the row and refresh the authoritative total only after
      // the server confirms.
      refreshInbox()
    } catch {
      // Failure leaves unread state intact and recoverable: the badge is never
      // falsely cleared, and the next successful newest-page render retries.
    }
  }, [api, refreshInbox])

  const selectConversation = useCallback((id) => {
    setSelectedId(id)
    setConversation(null)
    if (narrow) setMobileView('thread')
  }, [narrow])

  const handleSent = useCallback((out, opts) => {
    if (opts?.refreshOnly) {
      refreshThread(selectedId)
      refreshInbox()
      return
    }
    refreshThread(selectedId)
    refreshInbox()
  }, [refreshThread, refreshInbox, selectedId])

  const handleStarted = useCallback((out) => {
    // Select the authoritative conversation the server created, then let the
    // thread query load it. Ordering comes from server timestamps on refetch.
    if (out?.conversation_id) {
      setSelectedId(out.conversation_id)
      setConversation(null)
      if (narrow) setMobileView('thread')
    }
    refreshInbox()
  }, [narrow, refreshInbox])

  const showList = !narrow || mobileView === 'list'
  const showThread = !narrow || mobileView === 'thread'
  const closed = portalStatusIsClosed(conversation?.status)

  return (
    <section className="ptl-card ptl-section ptl-msg-workspace">
      <div className="ptl-section-head ptl-msg-head">
        <div className="ptl-msg-head-text">
          <h2 className="ptl-section-title">Messages</h2>
          <p className="ptl-muted ptl-msg-subtitle">{PORTAL_SUBTITLE}</p>
        </div>
        <div className="ptl-msg-head-actions">
          {unread > 0 && (
            <span className="ptl-chip ptl-chip-wait ptl-msg-unread-summary">
              <span aria-hidden="true">{formatUnread(unread)} unread</span>
              <span style={srOnly}>{unreadLabel(unread)}</span>
            </span>
          )}
          <button
            ref={newBtnRef}
            type="button"
            className="ptl-btn-primary ptl-msg-new"
            onClick={() => setNewOpen(true)}
          >
            <MessageSquarePlus size={15} aria-hidden="true" /> New message
          </button>
        </div>
      </div>

      <div className={`ptl-msg-split${narrow ? ' ptl-msg-split-narrow' : ''}`}>
        {showList && (
          <div className="ptl-msg-pane ptl-msg-pane-list">
            <PortalMessagesInbox
              selectedId={selectedId}
              onSelect={selectConversation}
              onNewMessage={() => setNewOpen(true)}
              refreshMs={active ? PORTAL_ACTIVE_POLL_MS : false}
            />
          </div>
        )}

        {showThread && (
          <div className="ptl-msg-pane ptl-msg-pane-thread">
            <PortalMessagesThread
              conversationId={selectedId}
              showBack={narrow}
              onBack={() => setMobileView('list')}
              refreshMs={active ? PORTAL_ACTIVE_POLL_MS : false}
              onConversation={setConversation}
              onMarkRead={handleMarkRead}
              active={active}
            />
            {selectedId && (
              <PortalReplyComposer
                conversationId={selectedId}
                closed={closed}
                onSent={handleSent}
                announce={announce}
              />
            )}
          </div>
        )}
      </div>

      {/* Mounted only while open, so each open starts from a clean form while a
          failed submit still preserves what was typed. */}
      {newOpen && (
        <PortalNewMessageDrawer
          open
          onClose={() => setNewOpen(false)}
          onSent={handleStarted}
          announce={announce}
          returnFocusRef={newBtnRef}
        />
      )}

      <div role="status" aria-live="polite" style={srOnly}>{announcement}</div>
    </section>
  )
}
