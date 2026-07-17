// src/components/connect/messages/MessagesWorkspace.jsx
//
// ASPIRE MESSAGES, PHASE 4B2B-I: the staff Messages workspace.
//
// NOT MOUNTED IN PRODUCTION. Phase 4B2b-ii performs the final responsive and
// accessibility pass and only then exposes this as the Connect Messages sub-tab. Until then Connect.jsx, App.jsx, VALID_TABS, and the
// /connect redirect are untouched, so no incomplete Messages feature is
// reachable. There is no feature flag and no debug route.
//
// Composition: the left panel reuses the Phase 4A MessagesInbox verbatim (no
// parallel inbox exists). The right panel is the thread, built on the Stage A
// messages_staff_get_thread_v2 contract: the newest bounded page opens first and
// "Load earlier messages" pages backward.
//
// Privacy: message bodies render as PLAIN TEXT via white-space: pre-wrap. There
// is no dangerouslySetInnerHTML, no Markdown, and no HTML parsing. No email is
// displayed. Nothing is logged or persisted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RotateCw, Flag, MessageSquare, AlertCircle, Plus } from 'lucide-react'
import MessagesInbox from './MessagesInbox'
import NewMessageDialog from './NewMessageDialog'
import { ReplyComposer, ThreadManagementControls } from './ThreadActions'
import {
  STAFF_STATUS_LABEL, formatUnread, unreadLabel, formatFullTimestamp,
  formatInboxTimestamp, participantAccessLabel, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import { appendPage } from '../../../lib/messages/inboxState'
import {
  ACTIVE_POLL_MS, useDocumentVisible, useStaffUnreadCount, useIsNarrow,
} from '../../../lib/messages/messagesPolling'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'DM Sans, sans-serif'
const THREAD_PAGE_LIMIT = 50

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-primary,#0E1428)',
  muted: 'var(--text-secondary,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
}

// ── Workspace ───────────────────────────────────────────────────────────────

export default function MessagesWorkspace({ refreshKey = 0, api = defaultApi }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  // Reusable announcement region. Sends announce "Message sent."; management
  // actions announce a concise result. Message content is never announced.
  const [announcement, setAnnouncement] = useState('')
  const newBtnRef = useRef(null)
  const announce = useCallback((text) => setAnnouncement(String(text || '')), [])
  // Mobile is list-first. Selecting a conversation opens the thread view; Back
  // returns to the list with search, filters, and pagination intact (the inbox
  // stays mounted, so its state is never torn down).
  const [mobileView, setMobileView] = useState('list')
  const narrow = useIsNarrow()
  const unread = useStaffUnreadCount({ intervalMs: ACTIVE_POLL_MS, api })

  const onSelect = useCallback((id) => {
    setSelectedId(id)
    setMobileView('thread')
  }, [])

  const backToList = useCallback(() => setMobileView('list'), [])

  // After an authoritative start: refresh the inbox, select the new conversation
  // (its authoritative thread then loads), and return focus to the trigger.
  const onCreated = useCallback((conversationId) => {
    queryClient.invalidateQueries({ queryKey: ['messages_staff_list'] })
    queryClient.invalidateQueries({ queryKey: ['messages_staff_unread'] })
    if (conversationId) {
      setSelectedId(conversationId)
      setMobileView('thread')
    }
    newBtnRef.current?.focus()
  }, [queryClient])

  const closeNew = useCallback(() => { setNewOpen(false); newBtnRef.current?.focus() }, [])

  const showList = !narrow || mobileView === 'list'
  const showThread = !narrow || mobileView === 'thread'

  return (
    <div style={{
      display: 'flex', height: '100%', minHeight: 0, fontFamily: F,
      // Phone width never renders a compressed two-column split.
      flexDirection: narrow ? 'column' : 'row',
    }}>
      {showList && (
        <div style={{
          display: 'flex', flexDirection: 'column', minHeight: 0,
          width: narrow ? '100%' : 380,
          flexShrink: 0,
          borderRight: narrow ? 'none' : `1px solid ${T.border}`,
          padding: '0 14px',
        }}>
          <div style={{ paddingBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T.text, fontFamily: F }}>
                Messages
              </h2>
              <button
                type="button"
                ref={newBtnRef}
                onClick={() => setNewOpen(true)}
                style={{ ...primaryBtn, marginLeft: 'auto', minHeight: 30 }}
              >
                <Plus size={13} aria-hidden="true" /> New message
              </button>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: T.muted, lineHeight: 1.5, fontFamily: F }}>
              Communicate securely with active ASPIRE portal participants.
            </p>
            {unread > 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: T.accent, fontWeight: 600 }}>
                <span aria-hidden="true">{formatUnread(unread)} unread</span>
                <span style={srOnly}>{unreadLabel(unread)}</span>
              </p>
            )}
          </div>
          {/* The Phase 4A inbox, reused verbatim. */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <MessagesInbox
              selectedId={selectedId}
              onSelect={onSelect}
              refreshKey={refreshKey}
              api={api}
            />
          </div>
        </div>
      )}

      {showThread && (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {narrow && (
            <div style={{ padding: '8px 14px 0' }}>
              <button type="button" onClick={backToList} style={backBtn}>
                <ArrowLeft size={14} aria-hidden="true" /> Back to messages
              </button>
            </div>
          )}
          {selectedId
            ? <ThreadPanel conversationId={selectedId} api={api} announce={announce} onGone={() => setSelectedId(null)} />
            : <NoSelection />}
        </div>
      )}

      <NewMessageDialog
        open={newOpen}
        onClose={closeNew}
        onCreated={onCreated}
        announce={announce}
        api={api}
      />

      {/* Polite announcements for sends and management results. Never carries
          message content or unnecessary participant detail. */}
      <div role="status" aria-live="polite" style={srOnly}>{announcement}</div>
    </div>
  )
}

function NoSelection() {
  return (
    <div style={{ ...centered, color: T.muted }}>
      <MessageSquare size={20} aria-hidden="true" />
      <p style={{ margin: '8px 0 0', fontSize: 13, fontFamily: F }}>
        Select a conversation to review messages and respond.
      </p>
    </div>
  )
}

// ── Thread ──────────────────────────────────────────────────────────────────

export function ThreadPanel({ conversationId, api = defaultApi, announce = () => {}, onGone = () => {} }) {
  const queryClient = useQueryClient()
  const visible = useDocumentVisible()
  const markedRef = useRef(null)

  // The query key is scoped by conversation id, so a response for a previously
  // selected conversation can never populate a newer selection. React Query also
  // aborts the in-flight request via the passed signal.
  const {
    data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ['messages_staff_thread', conversationId],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => api.getStaffThread({
      conversation_id: conversationId,
      limit: THREAD_PAGE_LIMIT,
      cursor_ts: pageParam?.cursor_ts,
      cursor_id: pageParam?.cursor_id,
    }, { signal }),
    // v2 returns the authoritative BACKWARD cursor: the oldest message of the
    // page. Paging therefore walks toward older history.
    getNextPageParam: (lastPage) => (lastPage?.has_more ? lastPage?.next_cursor ?? undefined : undefined),
    refetchInterval: visible ? ACTIVE_POLL_MS : false,
    refetchOnWindowFocus: true,
    staleTime: 10 * 1000,
    retry: 1,
    enabled: !!conversationId,
  })

  const pages = useMemo(() => data?.pages || [], [data])
  // Page 0 is the NEWEST bounded page; each later page is OLDER. Reverse the page
  // order, then merge, so the flattened array runs oldest to newest overall while
  // each page stays chronological. appendPage drops any id an overlapping page
  // repeats.
  const messages = useMemo(
    () => [...pages].reverse().reduce((acc, p) => appendPage(acc, p?.messages || []), []),
    [pages],
  )
  const conversation = pages[0]?.conversation || null
  const loadError = isError ? mapMessagesError(error?.status) : null

  // A conversation that became inaccessible clears the selection safely and
  // leaves the inbox intact.
  useEffect(() => {
    if (isError && error?.status === 404) onGone()
  }, [isError, error, onGone])

  // Mark read ONLY after the newest page has successfully loaded and rendered,
  // and only once per conversation per newest-message. Loading an older page
  // never triggers it: this depends on the newest page's last message, not on
  // page count. The endpoint sends no timestamp and no profile id; the server
  // derives both.
  const newestAt = pages[0]?.messages?.length
    ? pages[0].messages[pages[0].messages.length - 1]?.created_at
    : null
  useEffect(() => {
    if (isLoading || isError || !conversationId || !newestAt) return
    const token = `${conversationId}:${newestAt}`
    if (markedRef.current === token) return
    markedRef.current = token
    api.markStaffRead(conversationId)
      .then(() => {
        // Only after mark-read SUCCEEDS does local unread state clear.
        queryClient.invalidateQueries({ queryKey: ['messages_staff_unread'] })
        queryClient.invalidateQueries({ queryKey: ['messages_staff_list'] })
      })
      .catch(() => {
        // Non-fatal: the thread stays usable and unread reconciles on a later
        // refresh. Allow a retry on the next render pass.
        markedRef.current = null
      })
  }, [api, conversationId, newestAt, isLoading, isError, queryClient])

  if (isLoading) {
    return (
      <div style={centered}>
        <span role="status" style={{ fontSize: 13, color: T.muted, fontFamily: F }}>
          Loading conversation
        </span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ ...centered, color: T.muted }}>
        <AlertCircle size={18} aria-hidden="true" />
        <p style={{ margin: '8px 0 10px', fontSize: 13, fontFamily: F }}>{loadError}</p>
        <button type="button" onClick={() => refetch()} style={primaryBtn}>
          <RotateCw size={13} aria-hidden="true" /> Retry
        </button>
      </div>
    )
  }

  if (!conversation) return <NoSelection />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ThreadHeader conversation={conversation} api={api} announce={announce} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px' }}>
        {hasNextPage && (
          <div style={{ textAlign: 'center', paddingBottom: 10 }}>
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              style={{ ...secondaryBtn, opacity: isFetchingNextPage ? 0.6 : 1 }}
            >
              {isFetchingNextPage ? 'Loading' : 'Load earlier messages'}
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 13, color: T.muted, fontFamily: F }}>
            No messages are available in this conversation.
          </p>
        )}

        <ol role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {messages.map((m, i) => (
            <MessageRow key={m.id} message={m} previous={messages[i - 1]} />
          ))}
        </ol>
      </div>

      {/* Sending is blocked when portal access is inactive; history stays
          readable and every management action stays available. */}
      <ReplyComposer
        conversationId={conversationId}
        accessActive={conversation.participant_access_active !== false}
        api={api}
        announce={announce}
      />
    </div>
  )
}

function ThreadHeader({ conversation: c, api, announce }) {
  const accessActive = c.participant_access_active !== false
  return (
    <header style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: T.text }}>
          {c.participant_name || 'Portal participant'}
        </span>
        {/* Access state carries text, never color alone. */}
        <span style={{ ...badge, borderStyle: accessActive ? 'solid' : 'dashed' }}>
          {participantAccessLabel(accessActive)}
        </span>
      </div>
      <p style={{ margin: '3px 0 0', fontSize: 13, color: T.text, fontWeight: 600 }}>{c.subject}</p>
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        <span style={badge}>{STAFF_STATUS_LABEL[c.status] || c.status}</span>
        {c.category && <span style={badge}>{c.category}</span>}
        {c.assignee_name && <span style={badge}>{c.assignee_name}</span>}
        {c.follow_up_flagged && (
          <span style={badge}><Flag size={10} aria-hidden="true" /> Follow up</span>
        )}
        {c.related_student_id && <span style={badge}>Student linked</span>}
      </div>
      <ThreadManagementControls conversation={c} api={api} announce={announce} />
    </header>
  )
}

function MessageRow({ message: m, previous }) {
  const isStaff = m.author_role === 'staff'
  const showDate = !previous || !sameDay(previous.created_at, m.created_at)
  return (
    <>
      {showDate && (
        <li aria-hidden="true" style={{ textAlign: 'center', margin: '12px 0 8px' }}>
          <span style={{ fontSize: 11, color: T.muted, fontFamily: F }}>
            {formatInboxTimestamp(m.created_at)}
          </span>
        </li>
      )}
      <li style={{ padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: isStaff ? T.accent : T.text }}>
            {m.author_name || (isStaff ? 'ASPIRE Team' : 'Portal participant')}
          </span>
          <span style={{ ...badge, padding: '0 5px' }}>{isStaff ? 'ASPIRE Team' : 'Participant'}</span>
          <time
            dateTime={m.created_at}
            title={formatFullTimestamp(m.created_at)}
            style={{ marginLeft: 'auto', fontSize: 11, color: T.muted }}
          >
            <span aria-hidden="true">{formatInboxTimestamp(m.created_at)}</span>
            <span style={srOnly}>{formatFullTimestamp(m.created_at)}</span>
          </time>
        </div>
        {/* Plain text with preserved line breaks. Never interpreted as HTML. */}
        <p style={{
          margin: '4px 0 0', fontSize: 13, lineHeight: 1.6, color: T.text,
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: F,
        }}>
          {m.body}
        </p>
      </li>
    </>
  )
}

function sameDay(a, b) {
  if (!a || !b) return false
  const da = new Date(a); const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return da.toDateString() === db.toDateString()
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
const centered = {
  flex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
}
const badge = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '1px 6px', borderRadius: 999, fontSize: 10.5, fontWeight: 600,
  border: `1px solid ${T.border}`, color: T.muted, fontFamily: F,
}
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32,
  padding: '0 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
  background: T.accent, color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const secondaryBtn = {
  minHeight: 32, padding: '0 14px', borderRadius: 7, cursor: 'pointer',
  border: `1px solid ${T.border}`, background: T.input, color: T.text,
  fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const backBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44,
  padding: '0 4px', border: 'none', background: 'none', cursor: 'pointer',
  color: T.accent, fontSize: 13, fontWeight: 600, fontFamily: F,
}
