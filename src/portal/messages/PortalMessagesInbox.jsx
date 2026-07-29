// ASPIRE MESSAGES, PHASE 5B-i: the student's conversation list.
//
// DORMANT: mounted only by PortalMessagesWorkspace, which no routed portal page
// renders yet.
//
// Reads go through the authenticated /api/portal/messages-list endpoint. The
// browser never calls a Supabase RPC directly, and client-side hiding is not the
// security boundary: the endpoint independently verifies active Student Portal
// access against the caller's own JWT.

import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus, RefreshCw } from 'lucide-react'
import {
  listPortalConversations, portalSetConversationArchived,
} from '../../lib/messages/portalMessagesApiClient'
import { appendPage, normalizeCursor } from '../../lib/messages/inboxState'
import { PORTAL_INBOX_PAGE_SIZE } from '../../lib/messages/portalMessagesPolling'
import {
  formatInboxTimestamp, formatFullTimestamp, formatUnread, unreadLabel, mapMessagesError,
} from '../../lib/messages/messagesConstants'
import {
  PORTAL_EMPTY_TITLE, PORTAL_EMPTY_BODY, portalStatusIsClosed, portalStatusLabel,
  mapPortalMessagesError, UL_THREAD_ASPIRE_LABEL, ulDirectThreadLabel,
} from '../../lib/messages/portalMessagesConstants'
import RowActionsMenu from '../../components/shared/RowActionsMenu'

// One page size shared with the Home preview hook: both observers use the
// SAME query key, so the query function must be identical or the cache would
// thrash between two shapes.
const PAGE_SIZE = PORTAL_INBOX_PAGE_SIZE

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

export default function PortalMessagesInbox({
  variant = 'student',
  selectedId,
  onSelect,
  onNewMessage,
  refreshMs,
  api = { listPortalConversations, portalSetConversationArchived },
  // MESSAGES-ARCHIVE-P1:
  //   view              'active' (default) or 'archived' - the workspace owns
  //                      the Active | Archived picker and passes the scope down.
  //   onArchiveAvailable(bool) reports whether the server has the migration
  //                      applied, so the workspace can show or hide its picker.
  //   onArchiveChanged   called after a successful archive/unarchive so the
  //                      workspace can run its existing refresh path (list plus
  //                      unread), rather than this component inventing its own.
  //   onSelectedArchived called only when the row just archived/unarchived was
  //                      the OPEN (URL-selected) thread, so the workspace can
  //                      navigate back to the list.
  //   announce           the workspace's shared live region.
  view = 'active',
  onArchiveAvailable = () => {},
  onArchiveChanged = () => {},
  onSelectedArchived = () => {},
  announce = () => {},
}) {
  const qc = useQueryClient()
  const [openMenuId, setOpenMenuId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  // The default 'active' request keeps the EXACT same query key the Home
  // preview hook and the docked ASPIRE Team panel already share; only the
  // Archived scope gets a bucket of its own, so nothing outside this component
  // is affected by adding a view.
  const queryKey = view === 'archived' ? ['portal_messages_list', 'archived'] : ['portal_messages_list']

  const {
    data, isLoading, isError, error, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      api.listPortalConversations({
        limit: PAGE_SIZE, cursor: pageParam, view: view === 'archived' ? 'archived' : undefined, signal,
      }),
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

  // Fail closed: until a page confirms the migration is applied, the workspace
  // hides its picker and every row hides its kebab.
  const archiveAvailable = (data?.pages || []).some((p) => p?.archive_available === true)
  useEffect(() => {
    onArchiveAvailable(archiveAvailable)
  }, [archiveAvailable]) // eslint-disable-line react-hooks/exhaustive-deps

  // Archive or unarchive one row. The current binary view means every action
  // offered here always removes the row from the list you are looking at
  // (Archive only shows in Active, Unarchive only shows in Archived), so if it
  // was the open thread, the workspace navigates back to the list rather than
  // this component guessing at a next selection across a URL-driven view.
  //
  // Invalidating ['portal_messages_list'] here is a PREFIX match, so it covers
  // both this list's own query key (view active or archived) without this
  // component needing to know its own key format twice. onArchiveChanged then
  // runs the workspace's fuller refresh path (e.g. the open thread's own
  // cache), which this component has no visibility into.
  const handleArchiveToggle = async (row) => {
    if (busyId) return
    const nextArchived = !row.is_archived
    setBusyId(row.id)
    try {
      await api.portalSetConversationArchived({ conversationId: row.id, archived: nextArchived })
      if (selectedId === row.id) onSelectedArchived()
      qc.invalidateQueries({ queryKey: ['portal_messages_list'] })
      qc.invalidateQueries({ queryKey: ['portal_messages_unread'] })
      onArchiveChanged()
      announce(nextArchived ? 'Conversation archived' : 'Conversation unarchived')
    } catch (err) {
      announce(mapPortalMessagesError(err?.status) || mapMessagesError(err?.status))
    } finally {
      setBusyId(null)
      setOpenMenuId(null)
    }
  }

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
    // MESSAGES-ARCHIVE-P1: the Archived scope gets its own plain empty state;
    // the approved PORTAL_EMPTY_TITLE/BODY copy and its New message affordance
    // stay exactly as authored for the Active (default) scope.
    if (view === 'archived') {
      return (
        <div className="ptl-empty ptl-msg-empty">
          <div className="ptl-card-title">No archived conversations</div>
        </div>
      )
    }
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
          // MESSAGES-ARCHIVE-P1: a flex wrapper holds the original row button
          // (unchanged, still first in the DOM, still role="listitem") plus the
          // shared RowActionsMenu kebab as a sibling - a button cannot nest
          // inside a button. The wrapper stops click/keydown propagation so
          // opening the menu never also selects the row.
          <div key={c.id} style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
            <button
              key={c.id}
              type="button"
              role="listitem"
              className={`ptl-msg-row${selected ? ' ptl-msg-row-selected' : ''}${unread > 0 ? ' ptl-msg-row-unread' : ''}`}
              style={{ flex: 1, minWidth: 0 }}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect?.(c.id)}
            >
              {/* UL-POLISH P0: a Unit Leader inbox card names its participant so
                  direct student threads and ASPIRE Team threads never look
                  interchangeable. direct_student_name comes from the caller's own
                  participant row server-side; students never receive the field. */}
              {variant === 'unit_leader' && (
                <div className="ptl-msg-row-context">
                  {c.direct_student_name ? ulDirectThreadLabel(c.direct_student_name) : UL_THREAD_ASPIRE_LABEL}
                </div>
              )}
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

            {archiveAvailable && (
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
              >
                <RowActionsMenu
                  label={`Actions for conversation ${c.subject}`}
                  open={openMenuId === c.id}
                  onToggle={() => setOpenMenuId((id) => (id === c.id ? null : c.id))}
                  onClose={() => setOpenMenuId(null)}
                  items={[
                    {
                      key: 'archive',
                      label: busyId === c.id
                        ? (c.is_archived ? 'Unarchiving' : 'Archiving')
                        : (c.is_archived ? 'Unarchive conversation' : 'Archive conversation'),
                      disabled: busyId === c.id,
                      onSelect: () => handleArchiveToggle(c),
                    },
                  ]}
                />
              </div>
            )}
          </div>
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
