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
import { useRegisterPortalRefresh } from '../PortalRefresh'
import {
  PORTAL_ACTIVE_POLL_MS, usePortalIsNarrow, usePortalUnreadCount,
} from '../../lib/messages/portalMessagesPolling'
import { formatUnread, unreadLabel } from '../../lib/messages/messagesConstants'
import {
  PORTAL_SUBTITLE, UL_PORTAL_SUBTITLE, AP_PORTAL_SUBTITLE, PORTAL_SAFETY_NOTICE, portalStatusIsClosed,
} from '../../lib/messages/portalMessagesConstants'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

export default function PortalMessagesWorkspace({
  active = true,
  // UL-POLISH P0: 'student' (default, copy unchanged), 'unit_leader', or 'academic_partner'.
  variant = 'student',
  // ASPIRE-COMPASS: selection is URL-driven. threadId comes from
  // /portal/messages/:threadId; selecting and going back are navigations
  // handled by PortalApp, so refresh, back, and forward all work. An unknown
  // or unauthorized id simply fails closed through the thread query's
  // existing error mapping.
  threadId = null,
  onSelectThread,
  onBackToList,
  api = { markPortalConversationRead },
}) {
  const qc = useQueryClient()
  const narrow = usePortalIsNarrow()
  const newBtnRef = useRef(null)

  const selectedId = threadId
  const [conversation, setConversation] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // Mobile is list-first: the thread is a separate view, never a squeezed
  // column. The view now derives from the URL: a thread id means thread view.
  const mobileView = threadId ? 'thread' : 'list'

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

  // The shared portal Refresh re-fetches the inbox (and the open thread, if any). Registered only
  // while Messages is the active surface, since the Student portal keeps it mounted (display-toggled).
  const manualRefresh = useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: ['portal_messages_list'] }),
    qc.invalidateQueries({ queryKey: ['portal_messages_unread'] }),
    selectedId ? qc.invalidateQueries({ queryKey: portalThreadQueryKey(selectedId) }) : null,
  ]), [qc, selectedId])
  useRegisterPortalRefresh(manualRefresh, active)

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
    setConversation(null)
    onSelectThread?.(id)
  }, [onSelectThread])

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
      setConversation(null)
      onSelectThread?.(out.conversation_id)
    }
    refreshInbox()
  }, [onSelectThread, refreshInbox])

  const showList = !narrow || mobileView === 'list'
  const showThread = !narrow || mobileView === 'thread'
  const closed = portalStatusIsClosed(conversation?.status)
  // On a phone the thread is its own view, so the workspace header (heading,
  // subtitle, unread summary, New message) is not context there: it is a second
  // header stacked above "Back to messages" that pushes the conversation down a
  // full screen. Back plus the conversation subject is the context on that view,
  // and New message stays one tap away through Back. On desktop the header is
  // always shown, because the list and thread share one screen.
  const showHead = !narrow || mobileView === 'list'

  return (
    <section className="ptl-card ptl-section ptl-msg-workspace">
      {showHead && (
        <div className="ptl-section-head ptl-msg-head">
          <div className="ptl-msg-head-text">
            <h1 className="ptl-section-title">Messages</h1>
            <p className="ptl-muted ptl-msg-subtitle">{variant === 'unit_leader' ? UL_PORTAL_SUBTITLE : variant === 'academic_partner' ? AP_PORTAL_SUBTITLE : PORTAL_SUBTITLE}</p>
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
              className="ptl-btn ptl-msg-btn ptl-msg-new"
              onClick={() => setNewOpen(true)}
            >
              <MessageSquarePlus size={15} aria-hidden="true" /> New message
            </button>
          </div>
        </div>
      )}

      <p className="ptl-msg-guidance ptl-msg-workspace-guidance">{PORTAL_SAFETY_NOTICE}</p>

      <div className={`ptl-msg-split${narrow ? ' ptl-msg-split-narrow' : ''}`}>
        {showList && (
          <div className="ptl-msg-pane ptl-msg-pane-list">
            <PortalMessagesInbox
              variant={variant}
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
              variant={variant}
              conversationId={selectedId}
              showBack={narrow}
              onBack={() => onBackToList?.()}
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
