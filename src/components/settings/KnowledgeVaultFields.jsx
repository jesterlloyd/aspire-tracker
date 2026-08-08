// KNOWLEDGE-VAULT-1: the vault authoring controls, extracted so the entry
// drawer and the revision panel share ONE implementation of each field rather
// than drifting into two.
//
// Nothing here talks to the server. These are controlled inputs; the hosting
// component owns state and saving.
import { useState, useMemo } from 'react'
import { X, Eye, Pencil } from 'lucide-react'
import { renderMarkdownLite } from '../../lib/keithMarkdown'

const secondary = 'var(--color-text-secondary, #6b7280)'
const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-text-primary, #374151)', marginBottom: 5,
}
const hintStyle = { fontWeight: 500, color: secondary, marginLeft: 6 }
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--color-border-default, #e5e7eb)',
  background: 'var(--color-bg-surface, #ffffff)',
  color: 'var(--color-text-primary, #191919)',
  fontFamily: 'DM Sans, sans-serif', fontSize: 13, outline: 'none',
}

/**
 * Chip input for aliases and tags.
 *
 * Terms commit on Enter, comma, or blur - the three things people actually do.
 * Duplicates are rejected case-insensitively because that is exactly how
 * retrieval and wikilink resolution compare them; storing "CS-Link" and
 * "cs-link" separately would look like two aliases and behave like one.
 */
export function TermChips({ label, hint, values, onChange, placeholder, max, disabled }) {
  const [draft, setDraft] = useState('')
  const list = Array.isArray(values) ? values : []

  function commit(raw) {
    const term = String(raw || '').trim().replace(/,+$/, '')
    if (!term) return
    if (list.length >= max) return
    if (list.some(v => v.toLowerCase() === term.toLowerCase())) { setDraft(''); return }
    onChange([...list, term])
    setDraft('')
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>
        {label}
        {hint && <span style={hintStyle}>{hint}</span>}
      </label>
      <div style={{
        ...inputStyle, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        padding: '6px 8px', minHeight: 38, opacity: disabled ? 0.6 : 1,
      }}>
        {list.map(term => (
          <span key={term} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-accent-primary, #1D2567)',
            borderRadius: 999, padding: '2px 4px 2px 9px', fontSize: 12, fontWeight: 600,
          }}>
            {term}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(list.filter(v => v !== term))}
                aria-label={`Remove ${term}`}
                style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', padding: 2, color: 'inherit' }}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            )}
          </span>
        ))}
        {!disabled && list.length < max && (
          <input
            type="text"
            value={draft}
            onChange={e => {
              const v = e.target.value
              if (v.includes(',')) { commit(v); return }
              setDraft(v)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
              // Backspace on an empty draft removes the last chip - the
              // behavior every chip input has, and people expect it.
              else if (e.key === 'Backspace' && !draft && list.length) onChange(list.slice(0, -1))
            }}
            onBlur={() => commit(draft)}
            placeholder={list.length ? '' : placeholder}
            aria-label={label}
            style={{ flex: '1 1 90px', minWidth: 90, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'DM Sans, sans-serif', background: 'transparent' }}
          />
        )}
      </div>
      <div style={{ fontSize: 11, color: secondary, marginTop: 3 }}>
        {list.length}/{max} · Enter or comma to add
      </div>
    </div>
  )
}

/**
 * Markdown body editor with a live preview toggle.
 *
 * Edit and Preview are separate views rather than a split pane: the drawer is
 * ~520px wide, and two 240px columns would make both useless. The toggle keeps
 * the full width for whichever one you are actually using.
 */
export function MarkdownBodyEditor({ value, onChange, format, onFormatChange, resolveWikilink, disabled, hint }) {
  const [preview, setPreview] = useState(false)
  const isMarkdown = format === 'markdown'
  const rendered = useMemo(
    () => (preview && isMarkdown ? renderMarkdownLite(value || '', { resolveWikilink }) : null),
    [preview, isMarkdown, value, resolveWikilink],
  )

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>
          Body
          {hint && <span style={hintStyle}>{hint}</span>}
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Format is a real governed field, so it is an explicit control, not
              a guess based on whether the text happens to contain a '#'. */}
          <label style={{ fontSize: 12, color: secondary, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              checked={isMarkdown}
              disabled={disabled}
              onChange={e => onFormatChange(e.target.checked ? 'markdown' : 'plain')}
            />
            Markdown
          </label>
          {isMarkdown && (
            <button
              type="button"
              onClick={() => setPreview(p => !p)}
              aria-pressed={preview}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none',
                cursor: 'pointer', color: 'var(--color-accent-primary, #1D2567)',
                fontFamily: 'DM Sans, sans-serif', fontSize: 12.5, fontWeight: 600, padding: 0,
              }}
            >
              {preview ? <Pencil size={13} /> : <Eye size={13} />}
              {preview ? 'Edit' : 'Preview'}
            </button>
          )}
        </div>
      </div>

      {preview && isMarkdown ? (
        <div style={{
          ...inputStyle, minHeight: 220, lineHeight: 1.55,
          background: 'var(--color-bg-app, #faf8f4)', overflowX: 'auto',
        }}>
          {value?.trim()
            ? rendered
            : <span style={{ color: secondary }}>Nothing to preview yet.</span>}
        </div>
      ) : (
        <textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          aria-label="Body"
          style={{
            ...inputStyle, minHeight: 220, resize: 'vertical', lineHeight: 1.5,
            fontFamily: isMarkdown ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'DM Sans, sans-serif',
            fontSize: isMarkdown ? 12.5 : 13,
          }}
        />
      )}
      {isMarkdown && !preview && (
        <div style={{ fontSize: 11, color: secondary, marginTop: 3 }}>
          Markdown: # headings, **bold**, lists, | tables |, and [[Page Name]] to link another entry.
        </div>
      )}
    </div>
  )
}

/** review_date + confidence, the two review-governance fields. */
export function ReviewFields({ reviewDate, confidence, onReviewDate, onConfidence, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ flex: '1 1 150px', minWidth: 140 }}>
        <label style={labelStyle}>
          Review by
          <span style={hintStyle}>optional</span>
        </label>
        <input
          type="date"
          value={reviewDate || ''}
          disabled={disabled}
          onChange={e => onReviewDate(e.target.value || null)}
          aria-label="Review by date"
          style={inputStyle}
        />
      </div>
      <div style={{ flex: '1 1 150px', minWidth: 140 }}>
        <label style={labelStyle}>
          Confidence
          <span style={hintStyle}>optional</span>
        </label>
        <select
          value={confidence || ''}
          disabled={disabled}
          onChange={e => onConfidence(e.target.value || null)}
          aria-label="Confidence"
          style={inputStyle}
        >
          <option value="">Not stated</option>
          <option value="verified">Verified</option>
          <option value="provisional">Provisional</option>
        </select>
      </div>
    </div>
  )
}

const LINK_STATUS_COPY = {
  broken: 'No entry matches this name',
  ambiguous: 'Matches more than one entry',
  self: 'Links to this same entry',
}

/**
 * Outgoing links + backlinks + the per-entry link checker.
 * Read-only: fixing a link means editing the body, which is the whole point of
 * showing the author exactly which text failed to resolve.
 */
export function EntryLinksPanel({ links, loading, onOpenEntry }) {
  const outgoing = links?.outgoing || []
  const backlinks = links?.backlinks || []
  const problems = outgoing.filter(l => l.status === 'broken' || l.status === 'ambiguous')

  const sectionLabel = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
    color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 8,
  }
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999,
    padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: '1px solid transparent', background: 'var(--color-bg-elevated, #eef2fb)',
    color: 'var(--color-accent-primary, #1D2567)', fontFamily: 'DM Sans, sans-serif',
  }

  if (loading) {
    return <div style={{ marginTop: 22, fontSize: 13, color: secondary }}>Loading links…</div>
  }
  if (!outgoing.length && !backlinks.length) {
    return (
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)' }}>
        <div style={sectionLabel}>Links</div>
        <div style={{ fontSize: 12.5, color: secondary }}>
          No links yet. Write <code style={{ fontFamily: 'ui-monospace, monospace' }}>[[Another Entry]]</code> in the body to connect this page to another.
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)' }}>
      {problems.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '10px 12px', borderRadius: 9,
          background: '#fffbeb', border: '1px solid #fcd34d', color: '#7c4a03', fontSize: 12.5,
        }}>
          <strong>{problems.length} link{problems.length === 1 ? '' : 's'} did not resolve.</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {problems.map(l => (
              <li key={l.target_text} style={{ marginBottom: 2 }}>
                <code style={{ fontFamily: 'ui-monospace, monospace' }}>[[{l.target_text}]]</code>
                {' — '}{LINK_STATUS_COPY[l.status] || l.status}
              </li>
            ))}
          </ul>
          {/* The author meeting a false broken link is exactly who needs to
              know the escape hatch, so it is stated here rather than buried in
              help text elsewhere. */}
          <div style={{ marginTop: 6 }}>
            Showing the syntax on purpose? Wrap it in backticks
            {' — '}
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>`[[Example]]`</code>
            {' '}is an example, not a link.
          </div>
        </div>
      )}

      {outgoing.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={sectionLabel}>Links to ({outgoing.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {outgoing.map(l => (
              l.target ? (
                <button key={l.target_text} type="button" style={chip} onClick={() => onOpenEntry?.(l.target)}>
                  {l.target.title}
                  {l.target.state !== 'active' && (
                    <span style={{ fontWeight: 500, opacity: 0.7 }}>({l.target.state})</span>
                  )}
                </button>
              ) : (
                <span key={l.target_text} style={{
                  ...chip, cursor: 'default', background: '#fffbeb',
                  color: '#b45309', border: '1px dashed #f59e0b',
                }}>
                  {l.target_text}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      {backlinks.length > 0 && (
        <div>
          <div style={sectionLabel}>Linked from ({backlinks.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {backlinks.map(b => (
              <button key={b.source.id} type="button" style={chip} onClick={() => onOpenEntry?.(b.source)}>
                {b.source.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
