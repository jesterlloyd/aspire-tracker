// src/components/connect/messages/MessagesInbox.jsx
//
// ASPIRE MESSAGES, PHASE 4A: the staff conversation inbox.
// MOUNTED IN PRODUCTION in Connect > Messages and in the docked Messages drawer.
//
// MESSAGES-SIMPLIFY-1: staff see one thing at a glance, which threads need a
// reply. Two chips (Needs reply, the default, and All), one View done link,
// search, and rows that say who wrote last and who handled the thread. There is
// no status, assignee, category, or archive control here any more; the rules
// live in src/lib/messages/messagesTriage.js and on the server.
//
// Props:
//   selectedId          currently selected conversation id (externally managed)
//   onSelect(id, row)   selection callback
//   refreshKey          increments to force a reload (Connect soft-refresh)
//   api                 injected for tests; defaults to the real client
//
// Privacy: previews render as PLAIN TEXT only. There is no dangerouslySetInnerHTML,
// no Markdown, and no HTML parsing. Staff email is never displayed.

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search, RotateCw, Flag, Inbox, AlertCircle, Archive } from 'lucide-react'
import {
  UNREAD_BADGE_BG, UNREAD_BADGE_FG,
  formatUnread, unreadLabel, formatInboxTimestamp, formatFullTimestamp,
  participantAccessLabel, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import {
  DEFAULT_VIEW, serializeInboxQuery, appendPage, queryIdentity, debounce,
} from '../../../lib/messages/inboxState'
import { needsReply, previewPrefix, rowChip } from '../../../lib/messages/messagesTriage'
import { useAuth } from '../../../contexts/AuthContext'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'Plus Jakarta Sans, sans-serif'
const PAGE_LIMIT = 25
const SEARCH_DEBOUNCE_MS = 300

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-heading,#0E1428)',
  muted: 'var(--text-caption,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
}

const EMPTY_NOTE = {
  needs_reply: 'No one is waiting on a reply.',
  all: 'No open conversations right now.',
  done: 'Nothing has been moved to Done yet.',
}

export default function MessagesInbox({
  selectedId = null,
  onSelect = () => {},
  refreshKey = 0,
  api = defaultApi,
}) {
  const { userProfile } = useAuth() || {}
  const viewerId = userProfile?.id || null
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState(DEFAULT_VIEW)
  // The chip to return to when View done is closed.
  const [lastOpenView, setLastOpenView] = useState(DEFAULT_VIEW)

  const identity = useMemo(() => queryIdentity({ search, view }), [search, view])

  // Debounced search: never one request per keystroke.
  const applySearch = useMemo(() => debounce((v) => setSearch(v), SEARCH_DEBOUNCE_MS), [])
  useEffect(() => () => applySearch.cancel(), [applySearch])
  const onSearchChange = (e) => { const v = e.target.value; setSearchInput(v); applySearch(v) }

  const {
    data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ['messages_staff_list', identity, refreshKey],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => {
      const { query } = serializeInboxQuery({ search, view, cursor: pageParam, limit: PAGE_LIMIT })
      return api.listStaffConversations(query, { signal })
    },
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    staleTime: 30 * 1000,
    retry: 1,
  })

  // Flatten pages in SERVER order, dropping any row an overlapping page repeats.
  const rows = useMemo(
    () => (data?.pages || []).reduce((acc, page) => appendPage(acc, page?.conversations || []), []),
    [data],
  )
  const loadError = isError ? mapMessagesError(error?.status) : null
  const counts = data?.pages?.[0]?.counts || {}

  const chooseView = (next) => { setView(next); setLastOpenView(next) }
  const toggleDone = () => setView((current) => (current === 'done' ? lastOpenView : 'done'))
  const doneCount = counts.done
  const doneLabel = view === 'done'
    ? 'Back to open conversations'
    : (Number.isFinite(doneCount) ? `View done (${doneCount})` : 'View done')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: F }}>

      <div className="messages-quick-filters" role="group" aria-label="Filter messages">
        <QuickFilter
          label="Needs reply"
          count={counts.needs_reply}
          urgent
          pressed={view === 'needs_reply'}
          onClick={() => chooseView('needs_reply')}
        />
        <QuickFilter
          label="All"
          count={counts.all}
          pressed={view === 'all'}
          onClick={() => chooseView('all')}
        />
      </div>

      {/* Search */}
      <div style={{ padding: '0 0 8px' }}>
        <label htmlFor="msg-search" style={srOnly}>Search conversations by subject or sender</label>
        <div style={{ position: 'relative' }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, color: T.muted }} />
          <input
            id="msg-search"
            type="search"
            value={searchInput}
            onChange={onSearchChange}
            placeholder="Search subjects and senders"
            className="messages-focusable"
            style={{
              width: '100%', height: 34, padding: '0 10px 0 30px', boxSizing: 'border-box',
              border: `1px solid ${T.border}`, borderRadius: 'var(--aspire-radius-control)', fontSize: 13,
              fontFamily: F, color: T.text, background: T.input,
            }}
          />
        </div>
      </div>

      <div style={{ paddingBottom: 8 }}>
        <button
          type="button"
          className="messages-view-done messages-focusable"
          aria-pressed={view === 'done'}
          onClick={toggleDone}
        >
          <Archive size={13} aria-hidden="true" />
          {doneLabel}
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} aria-busy={isLoading ? 'true' : 'false'}>
        {isLoading && <ListSkeleton />}

        {!isLoading && loadError && (
          <EmptyBlock icon={<AlertCircle size={18} aria-hidden="true" />} title={loadError}>
            <button type="button" onClick={() => refetch()} style={primaryBtn}>
              <RotateCw size={13} aria-hidden="true" /> Retry
            </button>
          </EmptyBlock>
        )}

        {!isLoading && !loadError && rows.length === 0 && (
          search
            ? <EmptyBlock icon={<Inbox size={18} aria-hidden="true" />} title="No conversations match your search." />
            : (
              <EmptyBlock icon={<Inbox size={18} aria-hidden="true" />} title="All caught up">
                <p style={{ margin: 0, fontSize: 12.5, color: T.muted }}>{EMPTY_NOTE[view]}</p>
              </EmptyBlock>
            )
        )}

        {!isLoading && !loadError && rows.length > 0 && (
          <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                viewerId={viewerId}
                selected={row.id === selectedId}
                onSelect={() => onSelect(row.id, row)}
              />
            ))}
          </ul>
        )}

        {!isLoading && !loadError && hasNextPage && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              style={{ ...secondaryBtn, opacity: isFetchingNextPage ? 0.6 : 1 }}
            >
              {isFetchingNextPage ? 'Loading' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// One conversation row: who and when, the subject, who wrote last, and one chip
// (Needs reply, or who handled it).
export function ConversationRow({ row, viewerId = null, selected, onSelect }) {
  const unread = Number(row.unread_count) || 0
  const isUnread = unread > 0
  const accessActive = row.participant_access_active !== false
  const stamp = formatInboxTimestamp(row.last_message_at)
  const needs = needsReply(row)
  const chip = rowChip(row)
  const name = row.participant_name || 'Portal participant'

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="messages-row messages-focusable"
      >
        <span className="messages-row__top">
          {needs && <span aria-hidden="true" className="messages-row__dot" />}
          <span className="messages-row__name" style={{ fontWeight: isUnread ? 750 : 650 }} title={name}>
            {name}
          </span>
          {row.follow_up_flagged && (
            <span className="messages-row__flag" role="img" aria-label="Flagged for follow-up">
              <Flag size={13} fill="currentColor" aria-hidden="true" />
            </span>
          )}
          {isUnread && (
            <span style={{ ...countBadge, background: UNREAD_BADGE_BG, color: UNREAD_BADGE_FG }}>
              <span aria-hidden="true">{formatUnread(unread)}</span>
              <span style={srOnly}>{unreadLabel(unread)}</span>
            </span>
          )}
          <span className="messages-row__day" title={formatFullTimestamp(row.last_message_at)}>{stamp}</span>
        </span>

        <span className="messages-row__subject" style={{ fontWeight: isUnread ? 600 : 500 }} title={row.subject || ''}>
          {row.subject}
        </span>

        {/* Preview is plain text. No HTML is ever interpreted. */}
        {row.latest_preview && (
          <span className="messages-row__preview" title={row.latest_preview}>
            {previewPrefix(row, viewerId)}{row.latest_preview}
          </span>
        )}

        {(chip || !accessActive) && (
          <span className="messages-row__chips">
            {chip && <span className={`messages-row-chip messages-row-chip--${chip.kind}`}>{chip.label}</span>}
            {!accessActive && (
              <span className="messages-row-chip messages-row-chip--by" style={{ borderStyle: 'dashed' }}>
                {participantAccessLabel(false)}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  )
}

function QuickFilter({ label, count, pressed, onClick, urgent = false }) {
  const n = Number(count) || 0
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="messages-quick-filter messages-focusable"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`messages-quick-filter__count${urgent && n > 0 ? ' messages-quick-filter__count--hot' : ''}`}
        style={urgent && n > 0 ? { background: UNREAD_BADGE_BG, color: UNREAD_BADGE_FG } : undefined}
      >
        {n}
      </span>
      <span style={srOnly}>{n} {n === 1 ? 'conversation' : 'conversations'}</span>
    </button>
  )
}

function ListSkeleton() {
  return (
    <div>
      <span style={srOnly} role="status">Loading conversations</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden="true" style={{ padding: '12px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ ...bar, width: '45%' }} />
          <div style={{ ...bar, width: '70%', marginTop: 6 }} />
        </div>
      ))}
    </div>
  )
}

function EmptyBlock({ icon, title, children }) {
  return (
    <div style={{ padding: '36px 20px', textAlign: 'center', color: T.muted }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <p style={{ margin: '0 0 6px', fontSize: 13.5, fontWeight: 650, color: T.text, fontFamily: F }}>{title}</p>
      {children}
    </div>
  )
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
const countBadge = {
  display: 'inline-flex', alignItems: 'center', flexShrink: 0,
  padding: '1px 6px', borderRadius: 'var(--aspire-radius-pill)', fontSize: 10.5, fontWeight: 700, fontFamily: F,
}
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32,
  padding: '0 12px', borderRadius: 'var(--aspire-radius-control)', border: 'none', cursor: 'pointer',
  background: T.accent, color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const secondaryBtn = {
  minHeight: 32, padding: '0 14px', borderRadius: 'var(--aspire-radius-control)', cursor: 'pointer',
  border: `1px solid ${T.border}`, background: T.input, color: T.text,
  fontSize: 12.5, fontWeight: 600, fontFamily: F,
}
const bar = { height: 9, borderRadius: 4, background: 'rgba(29,37,103,0.08)' }
