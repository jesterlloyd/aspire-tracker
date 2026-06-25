// src/components/connect/SentHistory.jsx
// Communication History Phase C.1 + C.2 — Sent History (read-only).
//
// Honest outbound audit trail from notification_log. NOT an email client:
// no inbox, drafts, threads, replies, resend, content retrieval, or batch grouping.
// C.2 adds: pseudo-folder filters, a Failed toggle, date-range presets + custom
// range (inclusive calendar-day), localStorage persistence, inline row expansion,
// and subtle Weekly Digest / Internal-System / Failed visual treatments.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Check, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Inbox, AlertCircle, Repeat, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const PER_PAGE = 50
const FILTER_STORAGE_KEY = 'aspire_sent_history_filters'

// Presentation labels live in the frontend (per Owner direction): the API returns
// raw notification_type so wording changes don't touch the endpoint.
const MESSAGE_TYPE_LABELS = {
  direct_message_sent:              'Direct Message',
  evaluation_invitation_sent:       'Survey Invitation',
  evaluation_invitation_test:       'Survey Invitation (Test)',
  coordinator_weekly_digest:        'Weekly Digest',
  coordinator_weekly_digest_test:   'Weekly Digest (Test)',
  interview_reminder:               'Interview Reminder',
  midpoint_checkin:                 'Midpoint Check-In',
  form_received:                    'Form Received',
  unit_form_received:               'Unit Form Received',
  teams_invite_reminder:            'Teams Invite Reminder',
  teams_invite_reminder_escalation: 'Teams Invite Escalation',
}
function messageTypeLabel(type) {
  return MESSAGE_TYPE_LABELS[type] || type || '—'
}

// Pseudo-folders — exclusive; map to API filters. 'internal_system' uses the
// orthogonal recipient_type_filter, the rest use notification_types.
const PSEUDO_FOLDERS = [
  { key: 'all',             label: 'All' },
  { key: 'direct_messages', label: 'Direct Messages', types: ['direct_message_sent'] },
  { key: 'surveys',         label: 'Surveys',          types: ['evaluation_invitation_sent', 'evaluation_invitation_test'] },
  { key: 'weekly_digests',  label: 'Weekly Digests',   types: ['coordinator_weekly_digest', 'coordinator_weekly_digest_test'] },
  { key: 'internal_system', label: 'Internal/System',  recipientTypeFilter: 'null' },
]

const DATE_RANGES = [
  { key: 'today',        label: 'Today' },
  { key: 'last_7_days',  label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'all_time',     label: 'All time' },
  { key: 'custom',       label: 'Custom…' },
]

const WEEKLY_DIGEST_TYPES = new Set(['coordinator_weekly_digest', 'coordinator_weekly_digest_test'])
const FAILED_STATUSES     = new Set(['failed', 'bounced', 'complained'])

// Inclusive LOCAL calendar-day range, computed in the browser (user/Pacific time).
// Returns full ISO instants: start = local 00:00 of the first day; end = local
// 00:00 of the day AFTER the last day (next-day-exclusive). The API uses
// `sent_at >= start` and `sent_at < end`, so the entire local end day is covered
// and no same-day message is dropped by a UTC boundary.
function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}
function startOfNextLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
}
function parseLocalDateStr(s) {
  // s is 'YYYY-MM-DD' (from a date <input>); build a LOCAL-midnight Date.
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}
function startDaysAgoLocal(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return startOfLocalDay(d)
}

function computeDateRange(range, customStart, customEnd) {
  const now = new Date()
  let startDate, endExclusive
  switch (range) {
    case 'today':        startDate = startOfLocalDay(now);   endExclusive = startOfNextLocalDay(now); break
    case 'last_7_days':  startDate = startDaysAgoLocal(7);   endExclusive = startOfNextLocalDay(now); break
    case 'last_30_days': startDate = startDaysAgoLocal(30);  endExclusive = startOfNextLocalDay(now); break
    case 'last_90_days': startDate = startDaysAgoLocal(90);  endExclusive = startOfNextLocalDay(now); break
    case 'all_time':     startDate = new Date(2020, 0, 1, 0, 0, 0, 0); endExclusive = startOfNextLocalDay(now); break
    case 'custom': {
      startDate    = customStart ? parseLocalDateStr(customStart) : startDaysAgoLocal(30)
      const endDay = customEnd   ? parseLocalDateStr(customEnd)   : now
      endExclusive = startOfNextLocalDay(endDay)
      break
    }
    default:             startDate = startDaysAgoLocal(30);  endExclusive = startOfNextLocalDay(now)
  }
  return { startISO: startDate.toISOString(), endISO: endExclusive.toISOString() }
}

function formatSentAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// Category chip colors — mirror ContactsView's CATEGORY_CHIP_STYLES for parity.
const CATEGORY_CHIP_STYLES = {
  'Academic Partners':  { color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  'Unit Leadership':    { color: '#0d7a8a', bg: '#E0F7FA', border: '#9dd6f2' },
  'Preceptors':         { color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  'BNI Team':           { color: '#5B21B6', bg: '#EDE9FE', border: '#C4B5FD' },
  'Nursing Executives': { color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  'Other':              { color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
}
function catChipStyle(category) {
  const cfg = CATEGORY_CHIP_STYLES[category] || CATEGORY_CHIP_STYLES['Other']
  return {
    display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '1px 6px',
    borderRadius: 4, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
  }
}

function readStoredFilters() {
  try {
    const saved = localStorage.getItem(FILTER_STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch { return {} }
}

// ── Expanded-row metadata ─────────────────────────────────────────────────────
function MetaRow({ k, v }) {
  if (v === null || v === undefined || v === '') return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ color: '#9ca3af', minWidth: 130, flexShrink: 0 }}>{k}</span>
      <span style={{ color: '#374151', wordBreak: 'break-word' }}>{String(v)}</span>
    </div>
  )
}

function RowMetadata({ row }) {
  // metadata may be flat (most writers) or nested under `context` (lib writers).
  const m = row.metadata || {}
  const ctx = (m && typeof m === 'object' && m.context) ? m.context : null
  const common = (
    <>
      <MetaRow k="Recipient email" v={row.recipient_email} />
      <MetaRow k="Recipient type" v={row.recipient_type || 'internal/system'} />
      <MetaRow k="Status" v={row.status} />
      <MetaRow k="Sent at" v={formatSentAt(row.sent_at)} />
    </>
  )

  let specific = null
  if (row.notification_type === 'direct_message_sent') {
    specific = <>
      <MetaRow k="Subject" v={row.subject} />
      <MetaRow k="Body format" v={m.body_format} />
      <MetaRow k="Sent by" v={m.sent_by_email} />
    </>
  } else if (row.notification_type?.startsWith('evaluation_invitation')) {
    specific = <>
      <MetaRow k="Instrument" v={m.instrument_id} />
      <MetaRow k="Timepoint" v={m.timepoint} />
      <MetaRow k="Source" v={m.source} />
    </>
  } else if (WEEKLY_DIGEST_TYPES.has(row.notification_type)) {
    specific = <>
      <MetaRow k="School" v={m.school || m.simulated_coordinator_school} />
      <MetaRow k="Window start" v={m.window_start} />
      <MetaRow k="Window end" v={m.window_end} />
      <MetaRow k="Transition count" v={m.transition_count} />
    </>
  } else if (ctx) {
    specific = Object.entries(ctx).map(([k, v]) => <MetaRow key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : v} />)
  }

  const hasSpecific = specific && (Array.isArray(specific) ? specific.length > 0 : true)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {common}
      {specific}
      {!hasSpecific && m && Object.keys(m).length > 0 && (
        <pre style={{
          margin: '6px 0 0', fontSize: 11, color: '#6b7280', background: '#f9fafb',
          border: '1px solid #f3f4f6', borderRadius: 6, padding: '8px 10px',
          overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace',
        }}>
          {JSON.stringify(m, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── Right-side "View message" drawer. Fetches one message's preview on demand (lightweight list
//    endpoint is untouched). HTML renders in a sandboxed iframe (no scripts); reconstructed automated
//    previews carry a "secure links removed" banner; manual/legacy rows show a graceful empty state. ──
function MessageDrawer({ detail, onClose, onRetry }) {
  const { loading, error, message } = detail
  const preview = message?.preview
  const isManual = message?.notification_type === 'direct_message_sent'
  const d = message?.delivery

  const field = (label, value) => value ? (
    <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 6 }}>
      <span style={{ color: '#9ca3af', minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#374151', wordBreak: 'break-word' }}>{value}</span>
    </div>
  ) : null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100%)', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', fontFamily: F }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Message</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', lineHeight: 1, padding: 2 }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading message…</div>
          ) : error ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#b91c1c', fontSize: 13 }}>
              Could not load this message.{' '}
              <button onClick={onRetry} style={{ background: 'none', border: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer', fontFamily: F, fontSize: 13, padding: 0, textDecoration: 'underline' }}>Retry</button>
            </div>
          ) : message ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: isManual ? '#EDE9FE' : '#f3f4f6', color: isManual ? '#5B21B6' : '#6b7280', border: `1px solid ${isManual ? '#C4B5FD' : '#e5e7eb'}`, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {isManual ? 'Manual' : 'System'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: NAVY }}>{messageTypeLabel(message.notification_type)}</span>
              </div>

              <div style={{ fontSize: 15, fontWeight: 700, color: '#191919', marginBottom: 10, lineHeight: 1.3 }}>{message.subject || '(No subject)'}</div>

              {field('To', message.recipient_name && message.recipient_email ? `${message.recipient_name} · ${message.recipient_email}` : (message.recipient_name || message.recipient_email))}
              {field('Status', d ? `${d.status}${d.opened_at ? ' · opened' : d.delivered_at ? ' · delivered' : ''}` : message.status)}
              {field('Sent', formatSentAt(message.sent_at))}
              {field('Resend ID', message.resend_email_id)}
              {d?.error_message && field('Error', d.error_message)}

              {/* Body */}
              <div style={{ marginTop: 14, borderTop: '1px solid #f1efe9', paddingTop: 14 }}>
                {preview?.available && preview.format === 'html' && preview.html ? (
                  <>
                    {preview.source === 'reconstructed' && (
                      <div style={{ fontSize: 11.5, color: '#475569', background: '#f6f8fc', border: '1px solid #d9e1f3', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }}>
                        {preview.notice}
                      </div>
                    )}
                    <iframe
                      srcDoc={preview.html}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      title="Message preview"
                      style={{ width: '100%', minHeight: 460, border: '1px solid #eee', borderRadius: 8, background: '#fff' }}
                    />
                  </>
                ) : preview?.available && preview.text ? (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5, color: '#374151', fontFamily: F, margin: 0 }}>{preview.text}</pre>
                ) : (
                  <div style={{ padding: '20px 16px', textAlign: 'center', background: '#fcfcfb', border: '1px solid #eee', borderRadius: 8, color: '#6b7280', fontSize: 12.5, lineHeight: 1.6 }}>
                    {preview?.notice || 'Message preview is not available for this item.'}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No message to show.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SentHistory() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [expandedRowIds, setExpandedRowIds] = useState(() => new Set())

  // "View message" drawer — fetches one message's preview on demand. Independent of the list query,
  // so opening/closing never refetches Sent History or disturbs pagination/filters.
  const [viewId, setViewId]   = useState(null)
  const [detail, setDetail]   = useState({ loading: false, error: false, message: null })
  const openMessage = useCallback(async (id) => {
    setViewId(id)
    setDetail({ loading: true, error: false, message: null })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No session')
      const res = await fetch(`/api/notification-log-message?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setDetail({ loading: false, error: false, message: json.message || null })
    } catch {
      setDetail({ loading: false, error: true, message: null })
    }
  }, [])
  const closeMessage = useCallback(() => {
    setViewId(null)
    setDetail({ loading: false, error: false, message: null })
  }, [])

  // Recipient constraint (Phase D.1 contact, D.2 student) — URL-based, ephemeral
  // (NOT persisted to localStorage). student_id takes precedence over contact_id
  // so the two never apply at once (no ambiguous combined constraint); a single
  // dismissable filter pill reflects the active constraint.
  const [searchParams, setSearchParams] = useSearchParams()
  const constrainedStudentId = searchParams.get('student_id') || null
  const constrainedContactId = searchParams.get('contact_id') || null
  const activeConstraint = constrainedStudentId
    ? { type: 'student', id: constrainedStudentId }
    : constrainedContactId
      ? { type: 'contact', id: constrainedContactId }
      : null
  const [pillName, setPillName] = useState('')

  // Filters — initialized from localStorage so the first fetch uses restored state.
  const stored = readStoredFilters()
  const [pseudoFolder,    setPseudoFolder]    = useState(stored.pseudoFolder || 'all')
  const [failedOnly,      setFailedOnly]      = useState(stored.failedOnly || false)
  const [dateRange,       setDateRange]       = useState(stored.dateRange || 'last_30_days')
  const [customStartDate, setCustomStartDate] = useState(stored.customStartDate || '')
  const [customEndDate,   setCustomEndDate]   = useState(stored.customEndDate || '')

  // Persist filters.
  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
      pseudoFolder, failedOnly, dateRange, customStartDate, customEndDate,
    }))
  }, [pseudoFolder, failedOnly, dateRange, customStartDate, customEndDate])

  // Filter setters reset page to 1 (batched with the filter change → single fetch).
  const changeFolder = (f) => { setPage(1); setPseudoFolder(f) }
  const changeFailed = (v) => { setPage(1); setFailedOnly(v) }
  const changeRange  = (r) => { setPage(1); setDateRange(r) }
  const changeCustomStart = (v) => { setPage(1); setCustomStartDate(v) }
  const changeCustomEnd   = (v) => { setPage(1); setCustomEndDate(v) }

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams()
    const { startISO, endISO } = computeDateRange(dateRange, customStartDate, customEndDate)
    params.set('start_date', startISO)
    params.set('end_date', endISO)

    const folder = PSEUDO_FOLDERS.find(f => f.key === pseudoFolder)
    if (folder?.recipientTypeFilter) params.set('recipient_type_filter', folder.recipientTypeFilter)
    else if (folder?.types) params.set('notification_types', folder.types.join(','))

    if (failedOnly) params.set('status_filter', 'failed')
    if (activeConstraint?.type === 'student') params.set('student_id', activeConstraint.id)
    else if (activeConstraint?.type === 'contact') params.set('contact_id', activeConstraint.id)
    params.set('page', String(page))
    params.set('per_page', String(PER_PAGE))
    return params.toString()
  }, [dateRange, customStartDate, customEndDate, pseudoFolder, failedOnly, page, constrainedStudentId, constrainedContactId])

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Your session expired. Please refresh and try again.')
      const res = await fetch(`/api/notification-log-query?${buildQueryString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      setRows(data.results || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 1)
    } catch (err) {
      setError(err.message || 'Unable to load communication history.')
    } finally {
      setLoading(false)
    }
  }, [buildQueryString])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Resolve the pill name from the first resolved row; stays stable across
  // sub-filters that may empty the result set. Falls back to "Selected contact".
  useEffect(() => {
    if (!activeConstraint) { setPillName(''); return }
    if (rows.length && rows[0].recipient_name) setPillName(rows[0].recipient_name)
  }, [activeConstraint?.id, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to page 1 when the recipient constraint changes (skip initial mount).
  const constraintMounted = useRef(false)
  useEffect(() => {
    if (!constraintMounted.current) { constraintMounted.current = true; return }
    setPage(1)
  }, [constrainedStudentId, constrainedContactId])

  const clearConstraint = () => {
    const next = new URLSearchParams(searchParams)
    if (activeConstraint?.type === 'student') next.delete('student_id')
    else if (activeConstraint?.type === 'contact') next.delete('contact_id')
    setSearchParams(next, { replace: true })
  }

  const toggleExpand = (id) => {
    setExpandedRowIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const rangeLabel = DATE_RANGES.find(r => r.key === dateRange)?.label || ''
  const wrap = { fontFamily: F }

  // ── Filter bar (always rendered above the list/states) ───────────────────────
  const chipBase = {
    padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
    fontFamily: F, cursor: 'pointer', border: '1px solid', transition: 'all 0.1s',
  }
  const FilterBar = (
    <div style={{ marginBottom: 16 }}>
      {activeConstraint && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 16, background: '#EEF2FB', border: '1px solid #c3cdf0', fontSize: 12, fontWeight: 600, color: NAVY, fontFamily: F }}>
            Showing communications for: {pillName || (activeConstraint.type === 'student' ? 'Selected student' : 'Selected contact')}
            <button onClick={clearConstraint} aria-label="Clear recipient filter" style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: NAVY }}>
              <X size={13} />
            </button>
          </span>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        {PSEUDO_FOLDERS.map(f => {
          const active = pseudoFolder === f.key
          return (
            <button
              key={f.key}
              onClick={() => changeFolder(f.key)}
              style={{
                ...chipBase,
                background: active ? NAVY : '#fff',
                color: active ? '#fff' : '#374151',
                borderColor: active ? NAVY : '#e5e7eb',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
          <span style={{ color: '#6b7280' }}>Date:</span>
          <select
            value={dateRange}
            onChange={e => changeRange(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, fontFamily: F, color: '#191919', background: '#fff' }}
          >
            {DATE_RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>

        {dateRange === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
            <input type="date" value={customStartDate} max={customEndDate || undefined}
              onChange={e => changeCustomStart(e.target.value)}
              style={{ padding: '4px 7px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, fontFamily: F }} />
            <span>to</span>
            <input type="date" value={customEndDate} min={customStartDate || undefined}
              onChange={e => changeCustomEnd(e.target.value)}
              style={{ padding: '4px 7px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, fontFamily: F }} />
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={failedOnly} onChange={e => changeFailed(e.target.checked)} style={{ accentColor: '#dc2626' }} />
          Show failed only
        </label>
      </div>
    </div>
  )

  // ── Body states ─────────────────────────────────────────────────────────────
  let body
  if (loading) {
    body = (
      <div style={{ padding: '48px 0', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        <div style={{ width: 22, height: 22, margin: '0 auto 12px', borderRadius: '50%', border: '2.5px solid #e5e7eb', borderTopColor: NAVY, animation: 'spin 0.8s linear infinite' }} />
        Loading communication history…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  } else if (error) {
    body = (
      <div style={{ padding: '40px 0', textAlign: 'center' }}>
        <AlertCircle size={26} color="#dc2626" style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 14 }}>Unable to load communication history. Please try again.</div>
        <button onClick={fetchHistory} style={{ padding: '8px 18px', background: NAVY, border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: 'pointer' }}>Retry</button>
      </div>
    )
  } else if (rows.length === 0) {
    body = (
      <div style={{ padding: '56px 0', textAlign: 'center', color: '#9ca3af' }}>
        <Inbox size={30} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 13 }}>No communications match these filters.</div>
      </div>
    )
  } else {
    body = (
      <>
        <div style={{ border: '1px solid rgba(29,37,103,0.10)', borderRadius: 10, overflow: 'hidden' }}>
          {rows.map((row, i) => {
            const isFailed   = FAILED_STATUSES.has(row.status)
            const isInternal = !row.recipient_type
            const isDigest   = WEEKLY_DIGEST_TYPES.has(row.notification_type)
            const isOk       = ['sent', 'delivered', 'opened', 'clicked'].includes(row.status)
            const expanded   = expandedRowIds.has(row.id)
            return (
              <div key={row.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #f3f4f6' }}>
                <div
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 14px',
                    background: isInternal ? '#fafafa' : '#fff',
                    borderLeft: isFailed ? '3px solid #dc2626' : '3px solid transparent',
                  }}
                >
                  {/* Status */}
                  <div style={{ flexShrink: 0, marginTop: 1 }} title={row.status || ''}>
                    {isOk ? <Check size={16} color="#166534" />
                      : isFailed ? <X size={16} color="#dc2626" />
                      : <Clock size={16} color="#9ca3af" />}
                  </div>

                  {/* Recipient + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                        {row.recipient_name || row.recipient_email || '(unknown recipient)'}
                      </span>
                      {row.recipient_display_category && <span style={catChipStyle(row.recipient_display_category)}>{row.recipient_display_category}</span>}
                      {row.recipient_display_school && <span style={{ fontSize: 11, color: '#6b7280' }}>{row.recipient_display_school}</span>}
                      {isInternal && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                          Internal/System
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#374151', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isDigest && (
                        <span title="Automated send" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#0d7a8a', flexShrink: 0 }}>
                          <Repeat size={11} /> Automated
                        </span>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.subject || '(No subject)'}</span>
                    </div>
                  </div>

                  {/* Type + status + time */}
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: NAVY }}>{messageTypeLabel(row.notification_type)}</div>
                    <div style={{ fontSize: 10, color: isFailed ? '#dc2626' : '#9ca3af', marginTop: 2, textTransform: 'capitalize' }}>
                      {row.status || 'unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      <Clock size={11} /> {formatSentAt(row.sent_at)}
                    </div>
                  </div>

                  {/* View message */}
                  <button
                    onClick={() => openMessage(row.id)}
                    aria-label="View message"
                    title="View message"
                    style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, marginTop: 1 }}
                  >
                    <Eye size={16} />
                  </button>

                  {/* Expand chevron */}
                  <button
                    onClick={() => toggleExpand(row.id)}
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                    aria-expanded={expanded}
                    style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, marginTop: 1 }}
                  >
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Expanded metadata (inline, not a modal) */}
                {expanded && (
                  <div style={{ padding: '10px 14px 14px 40px', background: '#fcfcfb', borderTop: '1px solid #f3f4f6' }}>
                    <RowMetadata row={row} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: F, color: page <= 1 ? '#d1d5db' : '#374151', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
            <ChevronLeft size={14} /> Previous
          </button>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: F, color: page >= totalPages ? '#d1d5db' : '#374151', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>
            Next <ChevronRight size={14} />
          </button>
        </div>
      </>
    )
  }

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY }}>Sent History</h2>
        {!loading && !error && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {total.toLocaleString()} communication{total === 1 ? '' : 's'}
          </span>
        )}
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto' }}>{rangeLabel}</span>
      </div>

      {FilterBar}
      {body}

      {viewId && <MessageDrawer detail={detail} onClose={closeMessage} onRetry={() => openMessage(viewId)} />}
    </div>
  )
}
