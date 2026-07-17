// src/components/connect/messages/MessagesInbox.jsx
//
// ASPIRE MESSAGES, PHASE 4A: the staff conversation inbox.
//
// NOT MOUNTED IN PRODUCTION. Phase 4B integrates this into ASPIRE Connect as the
// Messages sub-tab once the thread workspace, composer, and management controls
// exist. Until then Connect.jsx, VALID_TABS, and the /connect redirect are
// untouched, so no incomplete Messages feature is reachable.
//
// Props:
//   selectedId          currently selected conversation id (externally managed)
//   onSelect(id, row)   selection callback
//   refreshKey          increments to force a reload (Connect soft-refresh)
//   api                 injected for tests; defaults to the real client
//
// The Me filter needs no profile id here: it is sent as a sentinel and resolved
// by the server from the verified caller, so a client-supplied id is never
// trusted.
//
// Search is SUBJECT ONLY, because that is what the applied server RPC supports.
// The label and placeholder say so rather than implying that message bodies or
// participant names are searched.
//
// Privacy: previews render as PLAIN TEXT only. There is no dangerouslySetInnerHTML,
// no Markdown, and no HTML parsing. Staff email is never displayed.

import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Search, Filter, RotateCw, Flag, Inbox, AlertCircle } from 'lucide-react'
import {
  MESSAGE_CATEGORIES, STAFF_STATUSES, STAFF_STATUS_LABEL,
  UNREAD_BADGE_BG, UNREAD_BADGE_FG,
  formatUnread, unreadLabel, formatInboxTimestamp, formatFullTimestamp,
  participantAccessLabel, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import {
  DEFAULT_FILTERS, filtersAreDefault, serializeInboxQuery, appendPage,
  queryIdentity, debounce,
} from '../../../lib/messages/inboxState'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'DM Sans, sans-serif'
const PAGE_LIMIT = 25
const SEARCH_DEBOUNCE_MS = 300

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-primary,#0E1428)',
  muted: 'var(--text-secondary,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
}

export default function MessagesInbox({
  selectedId = null,
  onSelect = () => {},
  refreshKey = 0,
  api = defaultApi,
}) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  // Identity of the current server query. A change gives the list a new query
  // key, so pagination restarts and pages from different queries can never
  // interleave.
  const identity = useMemo(() => queryIdentity({ filters, search }), [filters, search])

  // Debounced search: never one request per keystroke.
  const applySearch = useMemo(() => debounce((v) => setSearch(v), SEARCH_DEBOUNCE_MS), [])
  useEffect(() => () => applySearch.cancel(), [applySearch])
  const onSearchChange = (e) => { const v = e.target.value; setSearchInput(v); applySearch(v) }
  const clearSearch = () => { applySearch.cancel(); setSearchInput(''); setSearch('') }

  // Cursor pagination via React Query, the app's existing convention. It owns
  // request cancellation, stale-response handling, and the loading flags, so the
  // component keeps no manual request state. refreshKey participates in the key
  // so the Connect soft-refresh refetches without clearing filters or search.
  const {
    data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ['messages_staff_list', identity, refreshKey],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => {
      const { query } = serializeInboxQuery({
        filters, search, cursor: pageParam, limit: PAGE_LIMIT,
      })
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

  // Assignee options: active Owner/Admin only, from the narrow lookup. Cached
  // across filter changes; a failure degrades to no options rather than blocking
  // the inbox.
  const { data: assigneeData } = useQuery({
    queryKey: ['messages_assignee_options'],
    queryFn: ({ signal }) => api.listAssigneeOptions({ signal }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const assignees = assigneeData?.options || []

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); clearSearch() }

  const hasFilters = !filtersAreDefault(filters)
  const showReset = hasFilters || !!search

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: F }}>

      {/* Search */}
      <div style={{ padding: '0 0 10px' }}>
        <label htmlFor="msg-search" style={srOnly}>Search conversations by subject</label>
        <div style={{ position: 'relative' }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, color: T.muted }} />
          <input
            id="msg-search"
            type="search"
            value={searchInput}
            onChange={onSearchChange}
            placeholder="Search subjects"
            style={{
              width: '100%', height: 34, padding: '0 10px 0 30px', boxSizing: 'border-box',
              border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 13,
              fontFamily: F, color: T.text, background: T.input,
            }}
          />
        </div>
      </div>

      {/* Filters. Every control is a labeled native select, so keyboard use and
          screen-reader naming come for free. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingBottom: 10 }}>
        <Filter size={13} aria-hidden="true" style={{ color: T.muted }} />
        <FilterSelect id="msg-f-status" label="Status" value={filters.status} onChange={(v) => setFilter('status', v)}
          options={[{ value: 'all', label: 'All statuses' },
            ...STAFF_STATUSES.map((s) => ({ value: s, label: STAFF_STATUS_LABEL[s] }))]} />
        {/* Unassigned and Me are server-side v2 filter modes. Me is sent as a
            sentinel and resolved from the verified caller by the API. */}
        <FilterSelect id="msg-f-assignee" label="Assignee" value={filters.assignee} onChange={(v) => setFilter('assignee', v)}
          options={[{ value: 'all', label: 'All assignees' },
            { value: 'unassigned', label: 'Unassigned' },
            { value: 'me', label: 'Me' },
            ...assignees.filter((a) => !a.is_current_user).map((a) => ({ value: a.profile_id, label: a.display_name }))]} />
        <FilterSelect id="msg-f-category" label="Category" value={filters.category} onChange={(v) => setFilter('category', v)}
          options={[{ value: 'all', label: 'All categories' },
            { value: 'uncategorized', label: 'Uncategorized' },
            ...MESSAGE_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect id="msg-f-flagged" label="Follow up" value={filters.flagged} onChange={(v) => setFilter('flagged', v)}
          options={[{ value: 'all', label: 'All' },
            { value: 'flagged', label: 'Flagged' },
            { value: 'not_flagged', label: 'Not flagged' }]} />
        {showReset && (
          <button type="button" onClick={resetFilters} style={linkBtn}>Reset filters</button>
        )}
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
          <EmptyBlock icon={<Inbox size={18} aria-hidden="true" />} title={emptyTitle({ search, hasFilters })} />
        )}

        {!isLoading && !loadError && rows.length > 0 && (
          <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
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

function emptyTitle({ search, hasFilters }) {
  if (search) return 'No conversations match your search.'
  if (hasFilters) return 'No conversations match these filters.'
  return 'No ASPIRE Messages yet.'
}

// One conversation row. Priority: participant identity, subject, latest
// activity, unread, then operational status.
export function ConversationRow({ row, selected, onSelect }) {
  const unread = Number(row.unread_count) || 0
  const isUnread = unread > 0
  const accessActive = row.participant_access_active !== false
  const stamp = formatInboxTimestamp(row.last_message_at)

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          display: 'block', padding: '10px 12px', minHeight: 44,
          border: 'none', borderLeft: `3px solid ${selected ? T.accent : 'transparent'}`,
          borderBottom: `1px solid ${T.border}`,
          background: selected ? 'rgba(29,37,103,0.05)' : 'transparent',
          fontFamily: F,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {/* Unread is signalled by weight AND a dot AND accessible text, never
              by color alone. */}
          {isUnread && <span aria-hidden="true" style={dot} />}
          <span style={{
            flex: 1, minWidth: 0, fontSize: 13.5, color: T.text,
            fontWeight: isUnread ? 700 : 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={row.participant_name || 'Portal participant'}>
            {row.participant_name || 'Portal participant'}
          </span>
          <span style={{ fontSize: 11.5, color: T.muted, flexShrink: 0 }} title={formatFullTimestamp(row.last_message_at)}>
            {stamp}
          </span>
        </div>

        <div style={{
          marginTop: 2, fontSize: 12.5, color: T.text,
          fontWeight: isUnread ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={row.subject || ''}>
          {row.subject}
        </div>

        {/* Preview is plain text. No HTML is ever interpreted. */}
        {row.latest_preview && (
          <div style={{
            marginTop: 2, fontSize: 12, color: T.muted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={row.latest_preview}>
            {row.latest_preview}
          </div>
        )}

        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {isUnread && (
            <span style={{ ...badge, background: UNREAD_BADGE_BG, color: UNREAD_BADGE_FG }}>
              <span aria-hidden="true">{formatUnread(unread)}</span>
              <span style={srOnly}>{unreadLabel(unread)}</span>
            </span>
          )}
          <span style={badge}>{STAFF_STATUS_LABEL[row.status] || row.status}</span>
          {row.category && <span style={badge}>{row.category}</span>}
          {row.assignee_name && <span style={badge}>{row.assignee_name}</span>}
          {row.follow_up_flagged && (
            <span style={badge}>
              <Flag size={10} aria-hidden="true" /> Follow up
            </span>
          )}
          {!accessActive && (
            <span style={{ ...badge, borderStyle: 'dashed' }}>{participantAccessLabel(false)}</span>
          )}
        </div>
      </button>
    </li>
  )
}

function FilterSelect({ id, label, value, onChange, options }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <label htmlFor={id} style={srOnly}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
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
      <p style={{ margin: '0 0 10px', fontSize: 13, fontFamily: F }}>{title}</p>
      {children}
    </div>
  )
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
const dot = { width: 7, height: 7, borderRadius: '50%', background: T.accent, flexShrink: 0 }
const badge = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '1px 6px', borderRadius: 999, fontSize: 10.5, fontWeight: 600,
  border: `1px solid ${T.border}`, color: T.muted, fontFamily: F,
}
const selectStyle = {
  height: 28, padding: '0 6px', borderRadius: 6, fontSize: 12, fontFamily: F,
  border: `1px solid ${T.border}`, background: T.input, color: T.text, cursor: 'pointer',
}
const linkBtn = {
  background: 'none', border: 'none', padding: '4px 6px', minHeight: 28,
  fontSize: 12, color: T.accent, cursor: 'pointer', textDecoration: 'underline', fontFamily: F,
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
const bar = { height: 9, borderRadius: 4, background: 'rgba(29,37,103,0.08)' }
