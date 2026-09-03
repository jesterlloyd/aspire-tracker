// src/components/connect/messages/MessagesInbox.jsx
//
// ASPIRE MESSAGES, PHASE 4A: the staff conversation inbox.
//
// MOUNTED IN PRODUCTION: Phase 4B integrated this into ASPIRE Connect as the
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
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Filter, RotateCw, Flag, Inbox, AlertCircle } from 'lucide-react'
import {
  MESSAGE_CATEGORIES, STAFF_STATUSES, STAFF_STATUS_LABEL,
  UNREAD_BADGE_BG, UNREAD_BADGE_FG,
  formatUnread, unreadLabel, formatInboxTimestamp, formatFullTimestamp,
  participantAccessLabel, mapMessagesError,
} from '../../../lib/messages/messagesConstants'
import {
  DEFAULT_FILTERS, DEFAULT_VIEW, filtersAreDefault, serializeInboxQuery, appendPage,
  queryIdentity, debounce,
} from '../../../lib/messages/inboxState'
import RowActionsMenu from '../../shared/RowActionsMenu'
import * as defaultApi from '../../../lib/messages/messagesApiClient'

const F = 'Plus Jakarta Sans, sans-serif'
const PAGE_LIMIT = 25
const SEARCH_DEBOUNCE_MS = 300

const T = {
  accent: 'var(--color-accent-primary,#1D2567)',
  text: 'var(--text-primary,#0E1428)',
  muted: 'var(--text-secondary,#4A5560)',
  border: 'var(--border-input,rgba(29,37,103,0.10))',
  input: 'var(--bg-input,#fff)',
  danger: '#B3282D',
}

export default function MessagesInbox({
  selectedId = null,
  onSelect = () => {},
  refreshKey = 0,
  api = defaultApi,
  // MESSAGES-ARCHIVE-P1: announce (the workspace's shared live region) and
  // onSelectedRowChange (fired only when the currently OPEN conversation is
  // archived/unarchived out of view, so the parent can move the selection
  // without also flipping the mobile view to 'thread').
  announce = () => {},
  onSelectedRowChange = () => {},
  // MAIN-MESSAGES-HEADER-POLISH-1: an optional action node (the workspace's
  // New message button) rendered at the far right of the toolbar row that
  // holds the Active | Archived picker. The parent keeps the element, its
  // ref, and its dialog wiring; this component only positions it.
  toolbarAction = null,
}) {
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  // MESSAGES-ARCHIVE-P1: the list scope. NOT part of filters and NOT reset by
  // Reset filters (see inboxState's DEFAULT_VIEW comment) - it is which list you
  // are looking at, not a narrowing predicate over one list.
  const [view, setView] = useState(DEFAULT_VIEW)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [busyRowId, setBusyRowId] = useState(null)
  const [archiveError, setArchiveError] = useState(null)

  // Identity of the current server query. A change gives the list a new query
  // key, so pagination restarts and pages from different queries can never
  // interleave. View participates too, so switching Active/Archived also
  // resets pagination, exactly like a filter change.
  const identity = useMemo(() => queryIdentity({ filters, search, view }), [filters, search, view])

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
        filters, search, view, cursor: pageParam, limit: PAGE_LIMIT,
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

  // MESSAGES-ARCHIVE-P1: fail closed. Until a page confirms the migration is
  // applied, every archive affordance (the picker and every row's kebab) stays
  // hidden, so there is no dead control that would only 503.
  const archiveAvailable = (data?.pages || []).some((p) => p?.archive_available === true)

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
  // MESSAGES-ARCHIVE-P1: Reset filters narrows within the current view; it never
  // switches Active back from Archived, so view is deliberately untouched here.
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); clearSearch() }

  const hasFilters = !filtersAreDefault(filters)
  const showReset = hasFilters || !!search

  // MESSAGES-ARCHIVE-P1: archive or unarchive one row. Selection handling: if the
  // row being toggled is the OPEN conversation, moving it out of the current view
  // (archiving in Active, unarchiving in Archived - the only actions ever
  // offered) must not leave a dangling selection, so the next row takes over,
  // else the previous one, else the selection clears to the empty state. This
  // only touches selection through onSelectedRowChange, never onSelect, so the
  // mobile view never flips to 'thread' as a side effect of archiving from the
  // list.
  const handleArchiveToggle = async (row) => {
    if (busyRowId) return
    const nextArchived = !row.is_archived
    setBusyRowId(row.id)
    setArchiveError(null)
    try {
      await api.setConversationArchived(row.id, nextArchived)
      if (selectedId === row.id) {
        const idx = rows.findIndex((r) => r.id === row.id)
        const nextId = rows[idx + 1]?.id ?? rows[idx - 1]?.id ?? null
        onSelectedRowChange(nextId)
      }
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['messages_staff_unread'] })
      announce(nextArchived ? 'Conversation archived' : 'Conversation unarchived')
    } catch (err) {
      const message = mapMessagesError(err?.status)
      setArchiveError(message)
      announce(message)
    } finally {
      setBusyRowId(null)
      setOpenMenuId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: F }}>

      {/* MESSAGES-ARCHIVE-P1: the Active | Archived scope picker. Deliberately
          binary - 'all' exists server-side but is never offered here - and
          hidden entirely until the server confirms the migration is applied.
          MAIN-MESSAGES-HEADER-POLISH-1: the same toolbar row also carries the
          parent's action (New message) at the far right via normal flex, and
          the row still renders for the action alone when archive support is
          unavailable. */}
      {(archiveAvailable || toolbarAction) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10 }}>
          {archiveAvailable && (
          <div style={{
            display: 'inline-flex', borderRadius: 7, border: `1px solid ${T.border}`,
            overflow: 'hidden', flexShrink: 0,
          }}>
            <button
              type="button"
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
              style={{
                height: 32, padding: '0 13px', border: 'none', cursor: 'pointer',
                fontSize: 12, fontFamily: F, fontWeight: 500,
                background: view === 'active' ? T.accent : T.input,
                color: view === 'active' ? '#fff' : T.muted,
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
                fontSize: 12, fontFamily: F, fontWeight: 500,
                background: view === 'archived' ? T.accent : T.input,
                color: view === 'archived' ? '#fff' : T.muted,
              }}
            >
              Archived
            </button>
          </div>
          )}
          {toolbarAction && (
            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{toolbarAction}</div>
          )}
        </div>
      )}

      {archiveError && (
        <div style={{ paddingBottom: 8 }}>
          <span role="alert" style={{ fontSize: 11.5, color: T.danger, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AlertCircle size={12} aria-hidden="true" /> {archiveError}
          </span>
        </div>
      )}

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
          <EmptyBlock icon={<Inbox size={18} aria-hidden="true" />} title={emptyTitle({ search, hasFilters, view })} />
        )}

        {!isLoading && !loadError && rows.length > 0 && (
          <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onSelect={() => onSelect(row.id, row)}
                archiveAvailable={archiveAvailable}
                busy={busyRowId === row.id}
                menuOpen={openMenuId === row.id}
                onToggleMenu={() => setOpenMenuId((id) => (id === row.id ? null : row.id))}
                onCloseMenu={() => setOpenMenuId(null)}
                onArchiveToggle={handleArchiveToggle}
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

function emptyTitle({ search, hasFilters, view }) {
  if (search) return 'No conversations match your search.'
  if (hasFilters) return 'No conversations match these filters.'
  if (view === 'archived') return 'No archived conversations.'
  return 'No ASPIRE Messages yet.'
}

// One conversation row. Priority: participant identity, subject, latest
// activity, unread, then operational status.
//
// MESSAGES-ARCHIVE-P1: the row is a flex wrapper around the original row
// button (unchanged, still first in the DOM, still the sole thing aria-current
// describes) plus the shared RowActionsMenu kebab as a sibling, exactly the
// pattern src/portal/UnitLeaderPortal.jsx already uses for StudentActionsMenu:
// a button cannot nest inside a button, so the kebab lives beside it, and its
// wrapper stops click and keydown propagation so opening the menu never also
// activates the row.
export function ConversationRow({
  row, selected, onSelect,
  archiveAvailable = false, busy = false, menuOpen = false,
  onToggleMenu = () => {}, onCloseMenu = () => {}, onArchiveToggle = () => {},
}) {
  const unread = Number(row.unread_count) || 0
  const isUnread = unread > 0
  const accessActive = row.participant_access_active !== false
  const stamp = formatInboxTimestamp(row.last_message_at)

  return (
    <li style={{ display: 'flex', alignItems: 'stretch' }}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        style={{
          flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
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

      {archiveAvailable && (
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            display: 'flex', alignItems: 'center', flexShrink: 0, padding: '0 6px',
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <RowActionsMenu
            label={`Actions for conversation ${row.subject}`}
            open={menuOpen}
            onToggle={onToggleMenu}
            onClose={onCloseMenu}
            items={[
              {
                key: 'archive',
                label: busy
                  ? (row.is_archived ? 'Unarchiving' : 'Archiving')
                  : (row.is_archived ? 'Unarchive conversation' : 'Archive conversation'),
                disabled: busy,
                onSelect: () => onArchiveToggle(row),
              },
            ]}
          />
        </div>
      )}
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
