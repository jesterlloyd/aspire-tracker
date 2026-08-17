import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import {
  MAX_ATTACHMENTS, MAX_TOTAL_BYTES, SENSITIVE_DATA_WARNING,
  addBlockedReason, attachmentSummary, typeLabel, formatBytes,
} from '../../lib/connect/outreachAttachments'

// OUTREACH-ATTACHMENTS-1 - the paperclip control for Direct and Bulk Outreach.
//
// PHASE 1 IS ASPIRE CATALOG ONLY. Everything offered here is an existing,
// ACTIVE internal file in the ASPIRE Catalog. There is no file input, because
// a local upload would need its own private bucket, metadata table and
// retention policy - designed, but held at the SQL gate.
//
// THE BROWSER NEVER SEES A STORAGE PATH. Options come from
// /api/outreach-attachment-options, which decides attachability server-side
// and returns { slug, title, category, type_label } only. Client state holds
// slugs and display text - no paths, no signed URLs, no bytes, no Base64.
// Sizes appear only once the server's own preview has resolved them.

const F = 'Poppins, -apple-system, BlinkMacSystemFont, sans-serif'

export default function AttachmentPicker({
  value = [],
  onChange,
  disabled = false,
  // Server-resolved sizes keyed by slug, from the preview response.
  resolvedSizes = null,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState(null)

  const { data: options = [], isLoading: loading, isError } = useQuery({
    queryKey: ['outreach_attachment_options'],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('no session')
      const res = await fetch('/api/outreach-attachment-options', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error('options failed')
      const bodyJson = await res.json()
      return Array.isArray(bodyJson?.options) ? bodyJson.options : []
    },
  })
  const loadError = isError ? 'Could not load the ASPIRE Catalog.' : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(r => `${r.title} ${r.category}`.toLowerCase().includes(q))
  }, [options, query])

  // Merge server-known sizes in, so the summary and chips show real numbers
  // once a preview has run.
  const items = useMemo(() => value.map(a => {
    const size = resolvedSizes?.[a.slug]
    return size != null ? { ...a, size_bytes: size } : a
  }), [value, resolvedSizes])

  const add = (r) => {
    const next = {
      slug: r.slug,
      title: r.title,
      type_label: r.type_label,
      size_bytes: null,           // authoritative size arrives with the preview
    }
    const blocked = addBlockedReason(items, next)
    if (blocked) { setNotice(blocked); return }
    setNotice(null)
    onChange?.([...value, next])
    setOpen(false)
    setQuery('')
  }

  const remove = (slug) => {
    setNotice(null)
    onChange?.(value.filter(a => a.slug !== slug))
  }

  const summary = attachmentSummary(items)
  const knownTotal = items.reduce((s, a) => s + (Number(a.size_bytes) || 0), 0)
  const overTotal = knownTotal > MAX_TOTAL_BYTES

  return (
    <div data-testid="attachment-picker" style={{ fontFamily: F }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="attachment-add"
          disabled={disabled || value.length >= MAX_ATTACHMENTS}
          onClick={() => setOpen(o => !o)}
          title={value.length >= MAX_ATTACHMENTS
            ? `You can attach up to ${MAX_ATTACHMENTS} files.`
            : 'Attach a file from the ASPIRE Catalog'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: F, fontSize: 12, fontWeight: 600,
            padding: '6px 11px', borderRadius: 8,
            border: '1px solid rgba(29,37,103,0.18)',
            background: '#fff', color: '#1D2567',
            cursor: (disabled || value.length >= MAX_ATTACHMENTS) ? 'not-allowed' : 'pointer',
            opacity: (disabled || value.length >= MAX_ATTACHMENTS) ? 0.55 : 1,
          }}
        >
          <span aria-hidden="true">📎</span> Attach from ASPIRE Catalog
        </button>
        {summary && (
          <span data-testid="attachment-summary"
            style={{ fontSize: 11.5, color: overTotal ? '#b91c1c' : '#6B7280' }}>
            {summary}
          </span>
        )}
      </div>

      {value.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {items.map(a => (
            <div key={a.slug} data-testid="attachment-chip"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 9px', borderRadius: 8,
                border: '1px solid rgba(29,37,103,0.10)', background: '#F8FAFC',
              }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                padding: '2px 6px', borderRadius: 4,
                background: '#E0E7FF', color: '#3730A3', flexShrink: 0,
              }}>{typeLabel(a)}</span>
              <span style={{
                fontSize: 12, color: '#1D2567', flex: 1, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }} title={a.title}>{a.title}</span>
              <span style={{ fontSize: 11, color: '#6B7280', flexShrink: 0 }}>
                {a.size_bytes != null ? formatBytes(a.size_bytes) : 'checking…'}
              </span>
              {!disabled && (
                <button type="button" data-testid="attachment-remove"
                  onClick={() => remove(a.slug)}
                  aria-label={`Remove ${a.title}`}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 14, lineHeight: 1 }}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {value.length > 0 && (
        <div data-testid="attachment-warning"
          style={{ marginTop: 8, fontSize: 11, lineHeight: 1.45, color: '#92400e' }}>
          {SENSITIVE_DATA_WARNING}
        </div>
      )}

      {notice && (
        <div data-testid="attachment-notice"
          style={{ marginTop: 6, fontSize: 11.5, color: '#b91c1c' }}>{notice}</div>
      )}

      {open && (
        <div data-testid="attachment-catalog"
          style={{
            marginTop: 8, border: '1px solid rgba(29,37,103,0.14)', borderRadius: 10,
            background: '#fff', boxShadow: '0 8px 24px rgba(29,37,103,0.10)', padding: 10,
          }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the ASPIRE Catalog…"
            aria-label="Search the ASPIRE Catalog"
            style={{
              width: '100%', boxSizing: 'border-box', fontFamily: F, fontSize: 12,
              padding: '7px 9px', borderRadius: 7, border: '1px solid rgba(29,37,103,0.16)',
              marginBottom: 8,
            }}
          />
          {loading && <div style={{ fontSize: 12, color: '#6B7280', padding: 6 }}>Loading the ASPIRE Catalog…</div>}
          {loadError && <div style={{ fontSize: 12, color: '#b91c1c', padding: 6 }}>{loadError}</div>}
          {!loading && !loadError && filtered.length === 0 && (
            <div style={{ fontSize: 12, color: '#6B7280', padding: 6 }}>
              {options.length === 0
                ? 'No attachable files in the ASPIRE Catalog yet. Add one in ASPIRE Catalog first.'
                : 'No files match that search.'}
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.map(r => {
              const already = value.some(a => a.slug === r.slug)
              return (
                <button
                  key={r.slug}
                  type="button"
                  data-testid="attachment-catalog-item"
                  disabled={already}
                  onClick={() => add(r)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    textAlign: 'left', padding: '7px 8px', borderRadius: 7,
                    border: 'none', background: already ? '#F1F5F9' : 'transparent',
                    cursor: already ? 'default' : 'pointer', fontFamily: F,
                    opacity: already ? 0.6 : 1,
                  }}
                >
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: '#E0E7FF', color: '#3730A3', flexShrink: 0,
                  }}>{r.type_label || 'FILE'}</span>
                  <span style={{ fontSize: 12, color: '#1D2567', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.title}
                  </span>
                  {already && <span style={{ fontSize: 10.5, color: '#6B7280' }}>Attached</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
