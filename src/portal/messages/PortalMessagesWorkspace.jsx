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

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
  PORTAL_SUBTITLE, UL_PORTAL_SUBTITLE, AP_PORTAL_SUBTITLE, NA_PORTAL_SUBTITLE, TA_PORTAL_SUBTITLE, portalStatusIsClosed,
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
  // TA-MESSAGES-1: the private kinds this person may start a conversation with (empty: ASPIRE
  // Team only, as before). The host decides from the server capability and the person's role.
  privateKinds = [],
  api = { markPortalConversationRead },
}) {
  const qc = useQueryClient()
  const narrow = usePortalIsNarrow()
  const newBtnRef = useRef(null)

  const selectedId = threadId
  const [conversation, setConversation] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // MESSAGES-ARCHIVE-P1: the Active | Archived scope lives here, not in
  // PortalMessagesInbox, because the picker renders in this workspace's header.
  // archiveAvailable is reported UP from the inbox (it is the one making the
  // list request and seeing the server's archive_available flag), so the
  // picker stays hidden until the migration is confirmed applied.
  const [view, setView] = useState('active')
  const [archiveAvailable, setArchiveAvailable] = useState(false)
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

  // MESSAGES-ARCHIVE-P1: when the archived/unarchived row was the OPEN thread,
  // navigating back to the list is the simplest correct outcome on the portal
  // side. The alternative (jump to a next/previous thread, mirroring the staff
  // side) would require picking a thread across a URL-driven selection while
  // the list itself is about to refetch out from under it; Back to the list is
  // the same navigation the thread's own Back control already performs, so
  // there is no new behavior to learn, and it is never wrong regardless of what
  // the refetched list turns out to contain.
  const handleSelectedArchived = useCallback(() => {
    onBackToList?.()
  }, [onBackToList])

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

  // PORTAL-PHONE-MESSAGES-1 (Owner, 2026-10-08): on a phone an open thread fills the
  // screen down to the bottom bar, the messages scroll inside it, and the reply box sits at
  // its foot, as in a chat app. The height is the window less what sits above the pane and
  // the room the page keeps for the bottom bar (main's own bottom padding), so the page
  // itself does not scroll. Desktop keeps its 560px column.
  const phoneThread = narrow && showThread && Boolean(selectedId)
  const threadPaneRef = useRef(null)
  const [phoneThreadH, setPhoneThreadH] = useState(null)
  useLayoutEffect(() => {
    if (!phoneThread) return undefined
    const measure = () => {
      const pane = threadPaneRef.current
      if (!pane) return
      const top = pane.getBoundingClientRect().top + window.scrollY
      const main = pane.closest('main')
      const keep = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      setPhoneThreadH(Math.max(320, Math.round(window.innerHeight - top - keep)))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [phoneThread, selectedId])

  return (
    <section className="ptl-card ptl-section ptl-msg-workspace">
      {showHead && (
        <div className={`ptl-section-head ptl-msg-head${narrow ? ' ptl-msg-head-phone' : ''}`}>
          <div className="ptl-msg-head-text">
            <h1 className="ptl-section-title">Messages</h1>
            <p className="ptl-muted ptl-msg-subtitle">{variant === 'unit_leader' ? UL_PORTAL_SUBTITLE : variant === 'academic_partner' ? AP_PORTAL_SUBTITLE : variant === 'nursing_academic' ? NA_PORTAL_SUBTITLE : variant === 'talent_acquisition' ? TA_PORTAL_SUBTITLE : PORTAL_SUBTITLE}</p>
          </div>
          <div className="ptl-msg-head-actions">
            {unread > 0 && (
              <span className="ptl-chip ptl-chip-wait ptl-msg-unread-summary">
                <span aria-hidden="true">{formatUnread(unread)} unread</span>
                <span style={srOnly}>{unreadLabel(unread)}</span>
              </span>
            )}
            {/* PORTAL-PHONE-MESSAGES-1 (Owner, 2026-10-08): on a phone, New message is a
                compose button drawn like the Messages shortcut (same circle, same navy), at
                the top right of the heading. It opens the same New message drawer. */}
            {narrow ? (
              <button
                ref={newBtnRef}
                type="button"
                className="ptl-msg-compose"
                onClick={() => setNewOpen(true)}
                aria-label="New message"
              >
                <img src="/brand/messages-compose.png" alt="" aria-hidden="true" draggable="false" width={48} height={48} />
              </button>
            ) : (
              <button
                ref={newBtnRef}
                type="button"
                className="ptl-btn ptl-msg-btn ptl-msg-new"
                onClick={() => setNewOpen(true)}
              >
                <MessageSquarePlus size={15} aria-hidden="true" /> New message
              </button>
            )}
          </div>
        </div>
      )}

      {/* MESSAGES-ARCHIVE-P1: the Active | Archived scope picker. Deliberately
          binary; hidden entirely until archiveAvailable confirms the migration
          is applied, and hidden on the phone thread view along with the rest of
          the header (showHead gates both). */}
      {showHead && archiveAvailable && (
        <div style={{ display: 'flex', marginBottom: 12 }}>
          <div style={{
            display: 'inline-flex', borderRadius: 7, border: '1px solid #e3ded4', overflow: 'hidden',
          }}>
            <button
              type="button"
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
              style={{
                height: 32, padding: '0 13px', border: 'none', cursor: 'pointer',
                fontSize: 12, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 500,
                background: view === 'active' ? '#1D2567' : '#fff',
                color: view === 'active' ? '#fff' : '#4A5560',
              }}
            >
              Active
            </button>
            <button
              type="button"
              aria-pressed={view === 'archived'}
              onClick={() => setView('archived')}
              style={{
                height: 32, padding: '0 13px', border: 'none', cursor: 'pointer',
                fontSize: 12, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 500,
                background: view === 'archived' ? '#1D2567' : '#fff',
                color: view === 'archived' ? '#fff' : '#4A5560',
              }}
            >
              Archived
            </button>
          </div>
        </div>
      )}

      {/* MESSAGES-REFINE-2: the safety notice moved under the reply box (and it
          is already in New message), so the first thing a student sees is the
          conversation, not a paragraph of rules. */}

      <div className={`ptl-msg-split${narrow ? ' ptl-msg-split-narrow' : ''}`}>
        {showList && (
          <div className="ptl-msg-pane ptl-msg-pane-list">
            <PortalMessagesInbox
              variant={variant}
              selectedId={selectedId}
              onSelect={selectConversation}
              onNewMessage={() => setNewOpen(true)}
              refreshMs={active ? PORTAL_ACTIVE_POLL_MS : false}
              view={view}
              onArchiveAvailable={setArchiveAvailable}
              onArchiveChanged={refreshInbox}
              onSelectedArchived={handleSelectedArchived}
              announce={announce}
            />
          </div>
        )}

        {showThread && (
          <div
            ref={threadPaneRef}
            className={`ptl-msg-pane ptl-msg-pane-thread${phoneThread ? ' ptl-msg-pane-thread-phone' : ''}`}
            style={phoneThread && phoneThreadH ? { height: phoneThreadH } : undefined}
          >
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
                showNotice
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
          variant={variant}
          privateKinds={privateKinds}
        />
      )}

      <div role="status" aria-live="polite" style={srOnly}>{announcement}</div>
    </section>
  )
}
