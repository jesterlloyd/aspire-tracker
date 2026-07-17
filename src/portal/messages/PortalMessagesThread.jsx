// ASPIRE MESSAGES, PHASE 5B-i: the student's conversation thread.
//
// DORMANT: mounted only by PortalMessagesWorkspace.
//
// Uses the Phase 5A v2 endpoint through portalMessagesApiClient. The newest
// bounded page opens first and "Load earlier messages" pages BACKWARD, so the
// student lands on the message they were notified about rather than the first
// message ever sent.

import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { getPortalThreadPage } from '../../lib/messages/portalMessagesApiClient'
import {
  portalThreadQueryKey, prependOlderPage, nextThreadCursor, threadPageIsCurrent,
  PORTAL_THREAD_LIMIT_DEFAULT,
} from '../../lib/messages/portalThreadState'
import { formatFullTimestamp } from '../../lib/messages/messagesConstants'
import {
  PORTAL_NO_SELECTION, portalStatusIsClosed, portalStatusLabel, mapPortalMessagesError,
} from '../../lib/messages/portalMessagesConstants'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

export default function PortalMessagesThread({
  conversationId,
  onBack,
  showBack,
  refreshMs,
  onConversation,
  onMarkRead,
  // False while Messages is mounted but not the active portal view. The
  // workspace stays mounted so drafts and selection survive a view switch, so
  // this is what stops a hidden view from marking anything read.
  active = true,
  api = { getPortalThreadPage },
}) {
  const markedRef = useRef(null)

  const {
    data, isLoading, isError, error, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    // Conversation-scoped: React Query caches and cancels per conversation, so a
    // late response from a previous selection cannot land in this one.
    queryKey: portalThreadQueryKey(conversationId),
    queryFn: ({ pageParam, signal }) => api.getPortalThreadPage({
      conversationId, limit: PORTAL_THREAD_LIMIT_DEFAULT, cursor: pageParam, signal,
    }),
    initialPageParam: null,
    // has_more is authoritative. Inferring "more history" from a full page would
    // falsely offer another page whenever the oldest page is exactly limit long.
    getNextPageParam: (lastPage) => nextThreadCursor(lastPage) ?? undefined,
    enabled: Boolean(conversationId),
    refetchInterval: refreshMs || false,
    staleTime: 5 * 1000,
  })

  const pages = useMemo(() => data?.pages || [], [data])
  const newestPage = pages[0] || null
  const conversation = newestPage?.conversation || null

  // Pages arrive newest-first; each page is chronological within itself. Older
  // pages are PREPENDED so the merged thread stays chronological, with no
  // duplicate and no re-sort.
  const messages = useMemo(
    () => pages.reduce((acc, p) => prependOlderPage(acc, p?.messages || []), []),
    [pages],
  )

  useEffect(() => {
    if (conversation) onConversation?.(conversation)
  }, [conversation, onConversation])

  // Mark read ONLY after the newest page loads successfully, and only while this
  // conversation is still the selected one. Loading an older page must never
  // mark read, so the token is keyed on the newest message rather than on any
  // fetch completing.
  const newestAt = newestPage?.messages?.length
    ? newestPage.messages[newestPage.messages.length - 1]?.created_at
    : null

  useEffect(() => {
    // Gate BEFORE the token is recorded. Gating in the callback instead would
    // burn the token while hidden, so returning to Messages would never mark the
    // conversation read. `active` is a dependency, so the effect re-runs and
    // marks read once the view becomes visible again.
    if (!active) return
    if (!conversationId || !newestPage) return
    if (!threadPageIsCurrent(newestPage, conversationId)) return
    const token = `${conversationId}:${newestAt || 'empty'}`
    if (markedRef.current === token) return
    markedRef.current = token
    onMarkRead?.(conversationId)
  }, [active, conversationId, newestPage, newestAt, onMarkRead])

  if (!conversationId) {
    return <div className="ptl-empty ptl-msg-noselect"><p className="ptl-muted">{PORTAL_NO_SELECTION}</p></div>
  }

  if (isLoading) {
    return <div className="ptl-muted ptl-loading">Loading this conversation...</div>
  }

  if (isError) {
    return (
      <div className="ptl-card ptl-error">
        <p>{mapPortalMessagesError(error?.status)}</p>
        <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => refetch()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  }

  const closed = portalStatusIsClosed(conversation?.status)

  return (
    <div className="ptl-msg-thread">
      <div className="ptl-msg-thread-head">
        {showBack && (
          <button type="button" className="ptl-icon-btn ptl-msg-back" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" /> Back to messages
          </button>
        )}
        <h3 className="ptl-msg-thread-subject">{conversation?.subject}</h3>
        <div className="ptl-msg-thread-meta">
          <span className={`ptl-chip ${closed ? 'ptl-chip-soft' : 'ptl-chip-ok'}`}>
            {portalStatusLabel(conversation?.status)}
          </span>
          {conversation?.category && (
            <span className="ptl-msg-row-cat">{conversation.category}</span>
          )}
        </div>
      </div>

      <div className="ptl-msg-scroll">
        {hasNextPage && (
          <button
            type="button"
            className="ptl-btn-outline ptl-btn-sm ptl-msg-loadearlier"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load earlier messages'}
          </button>
        )}

        {messages.map((m) => {
          const fromStaff = m.author_type === 'staff'
          return (
            <article
              key={m.id}
              className={`ptl-msg-item ${fromStaff ? 'ptl-msg-item-staff' : 'ptl-msg-item-me'}`}
            >
              <div className="ptl-msg-item-head">
                {/* author_label is the server's own label: 'ASPIRE Team' or
                    'You'. The team label stays primary; an individual staff name
                    is secondary context and is never made more prominent. */}
                <span className="ptl-msg-author">{m.author_label}</span>
                {fromStaff && m.author_name && (
                  <span className="ptl-msg-author-name">{m.author_name}</span>
                )}
                <time
                  className="ptl-msg-time"
                  dateTime={m.created_at || undefined}
                  title={formatFullTimestamp(m.created_at)}
                >
                  <span aria-hidden="true">{formatFullTimestamp(m.created_at)}</span>
                  <span style={srOnly}>{`Sent ${formatFullTimestamp(m.created_at)}`}</span>
                </time>
              </div>
              {/* Plain text only. React escapes it, and whiteSpace: pre-wrap
                  preserves the student's line breaks without any HTML or
                  Markdown interpretation. */}
              <div className="ptl-msg-body">{m.body}</div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
