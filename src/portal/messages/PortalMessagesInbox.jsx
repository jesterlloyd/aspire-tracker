// ASPIRE MESSAGES, PHASE 5B-i: the student's conversation list.
//
// DORMANT: mounted only by PortalMessagesWorkspace, which no routed portal page
// renders yet.
//
// Reads go through the authenticated /api/portal/messages-list endpoint. The
// browser never calls a Supabase RPC directly, and client-side hiding is not the
// security boundary: the endpoint independently verifies active Student Portal
// access against the caller's own JWT.

import { useInfiniteQuery } from '@tanstack/react-query'
import { MessageSquarePlus, RefreshCw } from 'lucide-react'
import { listPortalConversations } from '../../lib/messages/portalMessagesApiClient'
import { appendPage, normalizeCursor } from '../../lib/messages/inboxState'
import {
  formatInboxTimestamp, formatFullTimestamp, formatUnread, unreadLabel, mapMessagesError,
} from '../../lib/messages/messagesConstants'
import {
  PORTAL_EMPTY_TITLE, PORTAL_EMPTY_BODY, portalStatusIsClosed, portalStatusLabel,
  mapPortalMessagesError,
} from '../../lib/messages/portalMessagesConstants'

const PAGE_SIZE = 25

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

export default function PortalMessagesInbox({
  selectedId,
  onSelect,
  onNewMessage,
  refreshMs,
  api = { listPortalConversations },
}) {
  const {
    data, isLoading, isError, error, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['portal_messages_list'],
    queryFn: ({ pageParam, signal }) =>
      api.listPortalConversations({ limit: PAGE_SIZE, cursor: pageParam, signal }),
    initialPageParam: null,
    // next_cursor is null at the last page, which ends pagination.
    getNextPageParam: (lastPage) => normalizeCursor(lastPage?.next_cursor) ?? undefined,
    // Background refresh must not blank the list, so previous pages are kept.
    refetchInterval: refreshMs || false,
    staleTime: 10 * 1000,
  })

  const rows = (data?.pages || []).reduce(
    (acc, page) => appendPage(acc, page?.conversations || []), [],
  )

  if (isLoading) {
    return <div className="ptl-muted ptl-loading">Loading your messages...</div>
  }

  if (isError) {
    return (
      <div className="ptl-card ptl-error">
        <p>{mapPortalMessagesError(error?.status) || mapMessagesError(error?.status)}</p>
        <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => refetch()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="ptl-empty ptl-msg-empty">
        <div className="ptl-card-title">{PORTAL_EMPTY_TITLE}</div>
        <p className="ptl-muted">{PORTAL_EMPTY_BODY}</p>
        <button type="button" className="ptl-btn ptl-msg-btn" onClick={onNewMessage}>
          <MessageSquarePlus size={15} aria-hidden="true" /> New message
        </button>
      </div>
    )
  }

  return (
    <div className="ptl-msg-list" role="list" aria-label="Your conversations">
      {rows.map((c) => {
        const unread = Number(c.unread_count) || 0
        const closed = portalStatusIsClosed(c.status)
        const selected = c.id === selectedId
        return (
          <button
            key={c.id}
            type="button"
            role="listitem"
            className={`ptl-msg-row${selected ? ' ptl-msg-row-selected' : ''}${unread > 0 ? ' ptl-msg-row-unread' : ''}`}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect?.(c.id)}
          >
            <div className="ptl-msg-row-top">
              <span className="ptl-msg-row-subject">{c.subject}</span>
              {/* Unread is carried by the count itself and by text, never by
                  color alone. */}
              {unread > 0 && (
                <span className="ptl-msg-unread-dot" aria-hidden="true">{formatUnread(unread)}</span>
              )}
              <span style={srOnly}>{unread > 0 ? unreadLabel(unread) : ''}</span>
            </div>
            <div className="ptl-msg-row-meta">
              {/* Closed state carries a text label, not only a color. */}
              <span className={`ptl-chip ${closed ? 'ptl-chip-soft' : 'ptl-chip-ok'}`}>
                {portalStatusLabel(c.status)}
              </span>
              {c.category && <span className="ptl-msg-row-cat">{c.category}</span>}
              <time
                className="ptl-msg-row-time"
                dateTime={c.last_message_at || undefined}
                title={formatFullTimestamp(c.last_message_at)}
              >
                <span aria-hidden="true">{formatInboxTimestamp(c.last_message_at)}</span>
                <span style={srOnly}>{formatFullTimestamp(c.last_message_at)}</span>
              </time>
            </div>
            {/* latest_preview is already a safe 160-character server-side
                projection; the browser never derives its own preview. */}
            {c.latest_preview && (
              <div className="ptl-msg-row-preview">{c.latest_preview}</div>
            )}
          </button>
        )
      })}

      {hasNextPage && (
        <button
          type="button"
          className="ptl-btn-outline ptl-btn-sm ptl-msg-loadmore"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading...' : 'Load more conversations'}
        </button>
      )}
    </div>
  )
}
