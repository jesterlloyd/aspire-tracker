// src/components/connect/messages/MessagesWorkspace.jsx
//
// ASPIRE MESSAGES, PHASE 4B2B-I: the staff Messages workspace.
//
// MOUNTED IN PRODUCTION via Connect > Messages: Phase 4B2b-ii performed the
// final responsive and accessibility pass and joined the Connect tab model
// (ASPIRE-CHART corrected this header, which stale-claimed the workspace was
// dormant). There is no feature flag and no debug route.
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
import MessageBubble from '../../shared/MessageBubble'
import MessagesInbox from './MessagesInbox'
import NewMessageDialog from './NewMessageDialog'
import { ReplyComposer, ThreadManagementControls } from './ThreadActions'
import {
  STAFF_STATUS_LABEL,
  formatInboxTimestamp, participantAccessLabel, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import { appendPage } from '../../../lib/messages/inboxState'
import { useThreadAutoScroll } from '../../../lib/messages/useThreadAutoScroll'
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS
import { applyOptimisticReaction } from '../../../lib/messages/reactionConstants'
import {
  ACTIVE_POLL_MS, useDocumentVisible, useStaffUnreadCount, useIsNarrow,
} from '../../../lib/messages/messagesPolling'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'Plus Jakarta Sans, sans-serif'
const THREAD_PAGE_LIMIT = 50

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-primary,#0E1428)',
  muted: 'var(--text-secondary,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
}

// ── Workspace ───────────────────────────────────────────────────────────────

// MESSAGES-DOCK-1: `docked` renders the SAME workspace single-pane inside the
// main app's corner Messages panel - list-first like phone widths, regardless
// of the window size. `initialSelectedId` restores the last conversation a
// reopened panel was viewing (the panel unmounts on close, so the remounted
// ThreadPanel re-anchors to the latest message through useThreadAutoScroll),
// and `onSelectionChange` lets the dock remember that selection across
// close/reopen. The Connect workspace passes none of these and is unchanged.
export default function MessagesWorkspace({
  refreshKey = 0, api = defaultApi, onOpenStudent,
  docked = false, initialSelectedId = null, onSelectionChange,
}) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedIdState] = useState(initialSelectedId)
  const [newOpen, setNewOpen] = useState(false)
  // Reusable announcement region. Sends announce "Message sent."; management
  // actions announce a concise result. Message content is never announced.
  const [announcement, setAnnouncement] = useState('')
  const newBtnRef = useRef(null)
  const announce = useCallback((text) => setAnnouncement(String(text || '')), [])
  // Mobile is list-first. Selecting a conversation opens the thread view; Back
  // returns to the list with search, filters, and pagination intact (the inbox
  // stays mounted, so its state is never torn down).
  const [mobileView, setMobileView] = useState(initialSelectedId ? 'thread' : 'list')
  const narrow = useIsNarrow() || docked
  const setSelectedId = useCallback((id) => {
    setSelectedIdState(id)
    onSelectionChange?.(id)
  }, [onSelectionChange])
  // MAIN-MESSAGES-HEADER-POLISH-1: the returned count is no longer displayed
  // here (the tab badge and row badges communicate unread), but the hook call
  // stays: its subscription keeps the shared unread query polling at the
  // 30-second active cadence while the workspace is open.
  useStaffUnreadCount({ intervalMs: ACTIVE_POLL_MS, api })

  const onSelect = useCallback((id) => {
    setSelectedId(id)
    setMobileView('thread')
  }, [setSelectedId])

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
  }, [queryClient, setSelectedId])

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
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T.text, fontFamily: F }}>
              Messages
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: T.muted, lineHeight: 1.5, fontFamily: F }}>
              Communicate securely with active ASPIRE portal participants.
            </p>
            {/* MAIN-MESSAGES-HEADER-POLISH-1: no visible unread summary here.
                Unread is already communicated by the Messages tab badge (with
                its visually-hidden label) and the per-row badges; a third
                visible count was redundant. */}
          </div>
          {/* The Phase 4A inbox, reused verbatim (MESSAGES-ARCHIVE-P1 additions
              live inside MessagesInbox itself). announce shares the workspace's
              one live region; onSelectedRowChange moves the selection when the
              OPEN thread is archived/unarchived out of the current view,
              WITHOUT flipping the mobile view to 'thread' the way onSelect does. */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <MessagesInbox
              selectedId={selectedId}
              onSelect={onSelect}
              refreshKey={refreshKey}
              api={api}
              announce={announce}
              onSelectedRowChange={setSelectedId}
              toolbarAction={
                // MAIN-MESSAGES-HEADER-POLISH-1: the ONE New message button,
                // rendered by the inbox's toolbar row (right-aligned beside
                // Active | Archived). Defined here so newBtnRef, dialog state,
                // and NewMessageDialog's focus restoration are unchanged.
                <button
                  type="button"
                  ref={newBtnRef}
                  onClick={() => setNewOpen(true)}
                  style={{ ...primaryBtn, minHeight: 30 }}
                >
                  <Plus size={13} aria-hidden="true" /> New message
                </button>
              }
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
            ? <ThreadPanel conversationId={selectedId} api={api} announce={announce}
                onGone={() => { setSelectedId(null); setMobileView('list') }}
                onOpenStudent={onOpenStudent} />
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

export function ThreadPanel({ conversationId, api = defaultApi, announce = () => {}, onGone = () => {}, onOpenStudent }) {
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

  // MESSAGES-AUTOSCROLL-1: shared bottom-anchor management. `ready` flips once
  // the thread has data (the container is unmounted while isLoading, so the
  // anchor always runs against rendered messages). newestKey tracks the newest
  // message id: the reader's own send and incoming poll results both land as a
  // new newest id, pinning the bottom only while the reader is already there.
  const newestId = messages.length ? messages[messages.length - 1].id : null
  const {
    scrollRef: threadScrollRef, onScroll: onThreadScroll,
    showNewIndicator, jumpToLatest,
  } = useThreadAutoScroll({
    threadId: conversationId,
    ready: !isLoading && pages.length > 0,
    newestKey: newestId,
  })
  // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: fails closed, matching the
  // archiveAvailable convention - until a page confirms the migration is
  // applied, no reaction UI renders at all.
  const reactionsAvailable = pages.some((p) => p?.reactions_available === true)

  // One in-flight reaction request per message id, tracked in a ref for a
  // synchronous double-fire guard and mirrored into state so the disabled chip
  // actually re-renders.
  const reactionBusyRef = useRef(new Set())
  const [busyReactionIds, setBusyReactionIds] = useState(() => new Set())

  const setReaction = useCallback(async (messageId, nextKey) => {
    if (!messageId || reactionBusyRef.current.has(messageId)) return
    const threadQueryKey = ['messages_staff_thread', conversationId]
    reactionBusyRef.current.add(messageId)
    setBusyReactionIds(new Set(reactionBusyRef.current))

    const previous = queryClient.getQueryData(threadQueryKey)
    const applyToMessages = (msgs, reactions) => (msgs || []).map((m) => (
      m.id === messageId ? { ...m, reactions } : m
    ))

    // Optimistic flip first; the caller sees the change immediately.
    queryClient.setQueryData(threadQueryKey, (old) => (old ? {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        messages: applyToMessages(page.messages, applyOptimisticReaction(
          page.messages?.find((m) => m.id === messageId)?.reactions, nextKey,
        )),
      })),
    } : old))

    try {
      const result = await api.setMessageReaction({ messageId, reaction: nextKey })
      // Authoritative reconciliation: the server's fresh aggregation wins over
      // the optimistic guess.
      queryClient.setQueryData(threadQueryKey, (old) => (old ? {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          messages: applyToMessages(page.messages, result?.reactions),
        })),
      } : old))
    } catch (err) {
      // Revert to the exact pre-optimistic snapshot rather than guessing.
      queryClient.setQueryData(threadQueryKey, previous)
      announce(mapMessagesError(err?.status))
    } finally {
      reactionBusyRef.current.delete(messageId)
      setBusyReactionIds(new Set(reactionBusyRef.current))
    }
  }, [api, conversationId, queryClient, announce])

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
      <ThreadHeader conversation={conversation} api={api} announce={announce} onOpenStudent={onOpenStudent} />

      {/* MESSAGES-AUTOSCROLL-1: the relative wrapper hosts the floating "New
          messages" affordance without joining the scroll flow; the inner div
          stays the ONLY scrolling element (container-scoped scrollTop, never
          the page). */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={threadScrollRef} onScroll={onThreadScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 16px' }}>
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
            <MessageRow
              key={m.id}
              message={m}
              previous={messages[i - 1]}
              reactionsEnabled={reactionsAvailable}
              onSetReaction={setReaction}
              reactionsDisabled={busyReactionIds.has(m.id)}
            />
          ))}
        </ol>
      </div>
      {showNewIndicator && (
        <button
          type="button"
          onClick={jumpToLatest}
          style={{
            position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
            padding: '5px 14px', borderRadius: 20, border: '1px solid rgba(29,37,103,0.18)',
            background: '#1D2567', color: '#fff', fontFamily: F, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 4px 14px rgba(29,37,103,0.28)', zIndex: 2,
          }}
        >
          New messages ↓
        </button>
      )}
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

function ThreadHeader({ conversation: c, api, announce, onOpenStudent }) {
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
        {/* ASPIRE-CHART: the linked student is a real affordance - it opens
            the authorized staff student record (the same navigation the rest
            of the app uses). Falls back to the static chip when no navigator
            is provided (e.g. isolated mounts). */}
        {c.related_student_id && (onOpenStudent ? (
          <button
            type="button"
            onClick={() => onOpenStudent(c.related_student_id)}
            style={{ ...badge, cursor: 'pointer', background: 'transparent' }}
          >
            Open student record →
          </button>
        ) : (
          <span style={badge}>Student linked</span>
        ))}
      </div>
      <ThreadManagementControls conversation={c} api={api} announce={announce} />
    </header>
  )
}

function MessageRow({ message: m, previous, reactionsEnabled, onSetReaction, reactionsDisabled }) {
  const showDate = !previous || !sameDay(previous.created_at, m.created_at)
  return (
    <MessageBubble
      message={m}
      perspective="staff"
      container="li"
      showDate={showDate}
      dateLabel={formatInboxTimestamp(m.created_at)}
      timeMode="short"
      reactionsEnabled={reactionsEnabled}
      onSetReaction={onSetReaction}
      reactionsDisabled={reactionsDisabled}
    />
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
