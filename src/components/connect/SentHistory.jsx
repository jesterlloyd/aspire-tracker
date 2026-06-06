// src/components/connect/SentHistory.jsx
// Communication History Phase C.1 — Sent History MVP (read-only list).
//
// Honest outbound audit trail from notification_log. NOT an email client:
// no inbox, drafts, threads, replies, resend, or content retrieval.
// C.1 scope: last 30 days, 50/page, basic rows, loading/empty/error states,
// a simple Internal/System badge. Filters, row expansion, and enhanced visual
// treatment are deferred to C.2.

import { useState, useEffect, useCallback } from 'react'
import { Clock, Check, X, ChevronLeft, ChevronRight, Inbox, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const PER_PAGE = 50

// Presentation labels live in the frontend (per Owner correction): the API
// returns raw notification_type so wording changes don't touch the endpoint.
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

function formatSentAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
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

export default function SentHistory() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const fetchHistory = useCallback(async (targetPage) => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Your session expired. Please refresh and try again.')

      const res = await fetch(
        `/api/notification-log-query?page=${targetPage}&per_page=${PER_PAGE}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
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
  }, [])

  useEffect(() => { fetchHistory(page) }, [page, fetchHistory])

  // ── States ─────────────────────────────────────────────────────────────────
  const wrap = { fontFamily: F }

  if (loading) {
    return (
      <div style={{ ...wrap, padding: '48px 0', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        <div style={{
          width: 22, height: 22, margin: '0 auto 12px', borderRadius: '50%',
          border: '2.5px solid #e5e7eb', borderTopColor: NAVY, animation: 'spin 0.8s linear infinite',
        }} />
        Loading communication history…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...wrap, padding: '40px 0', textAlign: 'center' }}>
        <AlertCircle size={26} color="#dc2626" style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 14 }}>
          Unable to load communication history. Please try again.
        </div>
        <button
          onClick={() => fetchHistory(page)}
          style={{
            padding: '8px 18px', background: NAVY, border: 'none', borderRadius: 8,
            color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div style={{ ...wrap, padding: '56px 0', textAlign: 'center', color: '#9ca3af' }}>
        <Inbox size={30} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 13 }}>No communications in the last 30 days.</div>
      </div>
    )
  }

  // ── List ─────────────────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY }}>Sent History</h2>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {total.toLocaleString()} communication{total === 1 ? '' : 's'}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto' }}>Last 30 days</span>
      </div>

      {/* Rows */}
      <div style={{ border: '1px solid rgba(29,37,103,0.10)', borderRadius: 10, overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div
            key={row.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 14px',
              borderTop: i === 0 ? 'none' : '1px solid #f3f4f6', background: '#fff',
            }}
          >
            {/* Status */}
            <div style={{ flexShrink: 0, marginTop: 1 }} title={row.status || ''}>
              {row.status === 'sent' || row.status === 'delivered' || row.status === 'opened' || row.status === 'clicked'
                ? <Check size={16} color="#166534" />
                : row.status === 'failed' || row.status === 'bounced' || row.status === 'complained'
                  ? <X size={16} color="#dc2626" />
                  : <Clock size={16} color="#9ca3af" />}
            </div>

            {/* Recipient + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
                  {row.recipient_name || row.recipient_email || '(unknown recipient)'}
                </span>
                {row.recipient_display_category && (
                  <span style={catChipStyle(row.recipient_display_category)}>{row.recipient_display_category}</span>
                )}
                {row.recipient_display_school && (
                  <span style={{ fontSize: 11, color: '#6b7280' }}>{row.recipient_display_school}</span>
                )}
                {!row.recipient_type && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
                    textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
                  }}>
                    Internal/System
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.subject || '(No subject)'}
              </div>
            </div>

            {/* Type + status + time */}
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: NAVY }}>{messageTypeLabel(row.notification_type)}</div>
              {/* Show the true status value so non-sent states (queued, delivered,
                  bounced, etc.) are visible, not just inferred from the icon. */}
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, textTransform: 'capitalize' }}>
                {row.status || 'unknown'}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                <Clock size={11} /> {formatSentAt(row.sent_at)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7,
            fontSize: 12, fontWeight: 600, fontFamily: F,
            color: page <= 1 ? '#d1d5db' : '#374151', cursor: page <= 1 ? 'not-allowed' : 'pointer',
          }}
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Page {page} of {totalPages}</span>
        <button
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7,
            fontSize: 12, fontWeight: 600, fontFamily: F,
            color: page >= totalPages ? '#d1d5db' : '#374151', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
          }}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
