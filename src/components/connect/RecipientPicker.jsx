// src/components/connect/RecipientPicker.jsx
// Phase 1 - Outreach "Send to one recipient" picker.
//
// Single-recipient only. Searches ACTIVE contacts and the current cohort's
// students (students with at least one usable email), and emits a normalized
// recipient on selection. The parent (OutreachView) navigates exactly like a
// deep link, so the existing recipient/enrichment pipeline is reused unchanged.
//
// Scope guards baked in here:
//   • Contacts are fetched with `is_active = true` (query-time) - inactive never appears.
//   • Students come from the parent's already-loaded array (no extra student fetch);
//     only those with a usable email are offered.
//   • No multi-select, no group/category selection, no saved audiences.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { categoryChipColors } from '../../lib/contactCategories'
import { supabase } from '../../lib/supabase'
import StudentAvatar from '../StudentAvatar'
import { ASPIRE_STATUS_CONFIG } from '../../lib/constants'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// CONTACTS-CANON-1: the category palette is the shared canonical module
// (legacy stored values resolve through canonicalCategory inside it).
function catChipStyle(category) {
  const cfg = categoryChipColors(category)
  return {
    display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '1px 6px',
    borderRadius: 4, background: cfg.bg, color: cfg.color,
    border: `1px solid ${cfg.border}`, fontFamily: F, textTransform: 'uppercase',
    letterSpacing: '0.06em', whiteSpace: 'nowrap', flexShrink: 0,
  }
}

function statusChipStyle(status) {
  const cfg = ASPIRE_STATUS_CONFIG[status] || { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' }
  return {
    display: 'inline-block', fontSize: 9, fontWeight: 700, padding: '1px 6px',
    borderRadius: 10, background: cfg.bg, color: cfg.text,
    border: `1px solid ${cfg.border}`, fontFamily: F, whiteSpace: 'nowrap', flexShrink: 0,
  }
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

function studentEmail(s) {
  return s?.personal_email || s?.school_email || null
}

/**
 * RecipientPicker
 * @param {object}   props
 * @param {Array}    props.students   already-loaded cohort students from the parent
 * @param {Function} props.onSelect   (recipient) => void - normalized recipient on pick
 * @param {Function} [props.onCancel] () => void - Esc / dismiss without a selection
 * @param {boolean}  [props.canCancel] whether dismiss is allowed (false on fresh empty entry)
 * @param {string}   [props.placeholder]
 */
export default function RecipientPicker({
  students = [],
  onSelect,
  onCancel,
  canCancel = false,
  placeholder = 'Search for a contact or student',
}) {
  const [query, setQuery]           = useState('')
  const [debounced, setDebounced]   = useState('')
  const [contacts, setContacts]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [activeIdx, setActiveIdx]   = useState(0)

  const inputRef   = useRef(null)
  const listRef    = useRef(null)
  const debounceRef = useRef(null)

  // ── Fetch active contacts once (query-time is_active filter) ────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('contacts')
      .select('id, full_name, preferred_name, email, role, category, avatar_url, organization, school_name')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        if (cancelled) return
        setContacts(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // ── Focus the input on mount ────────────────────────────────────────────────
  useEffect(() => { inputRef.current?.focus() }, [])

  // ── Debounce the query (matches universal-search 200–300ms pattern) ─────────
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  // ── Build the filtered, normalized result list ──────────────────────────────
  const results = useMemo(() => {
    const q = debounced.toLowerCase()
    if (!q) return []

    const contactMatches = contacts
      .filter(c => {
        const hay = [c.full_name, c.preferred_name, c.email, c.role, c.school_name, c.organization]
          .filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 8)
      .map(c => ({
        kind: 'contact',
        id: c.id,
        name: c.full_name,
        email: c.email || null,
        role: c.role || null,
        category: c.category || null,
        avatar_url: c.avatar_url || null,
        school: c.school_name || c.organization || null,
      }))

    const studentMatches = (students || [])
      .filter(s => !!studentEmail(s)) // only students with a usable email
      .filter(s => {
        const name = `${s.first_name || ''} ${s.last_name || ''}`
        const hay = [name, s.personal_email, s.school_email, s.school]
          .filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 8)
      .map(s => ({
        kind: 'student',
        id: s.id,
        name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
        email: studentEmail(s),
        school: s.school || null,
        status: s.status || null,
        raw: s, // for StudentAvatar (headshot_url falls back to initials)
      }))

    return [...contactMatches, ...studentMatches]
  }, [debounced, contacts, students])

  // Clamp the highlighted index whenever the result set changes
  useEffect(() => { setActiveIdx(0) }, [debounced])
  useEffect(() => {
    if (activeIdx > results.length - 1) setActiveIdx(Math.max(0, results.length - 1))
  }, [results.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted row in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const choose = useCallback((r) => {
    if (!r) return
    onSelect?.(r)
  }, [onSelect])

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (results[activeIdx]) { e.preventDefault(); choose(results[activeIdx]) }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (canCancel) onCancel?.()
      else { setQuery(''); setDebounced('') }
    }
  }, [results, activeIdx, choose, canCancel, onCancel])

  const showEmptyNoMatch = !!debounced && !loading && results.length === 0

  return (
    <div style={{
      background: '#ffffff', border: '1px solid rgba(29,37,103,0.10)',
      borderRadius: 12, padding: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      fontFamily: F,
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: NAVY,
        letterSpacing: '-0.01em', marginBottom: 2,
      }}>
        Choose a recipient
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 12 }}>
        Search active contacts and students
      </div>

      {/* Search input (combobox) */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="recipient-picker-listbox"
          aria-autocomplete="list"
          aria-label="Search for a contact or student"
          style={{
            width: '100%', padding: '10px 13px',
            border: '1.5px solid #e5e7eb', borderRadius: 8,
            fontSize: 13, fontFamily: F, color: '#191919',
            background: '#fff', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Results / states */}
      {!debounced && (
        <div style={{ fontSize: 11, color: '#9ca3af', padding: '14px 4px 4px', lineHeight: 1.6 }}>
          Start typing a name, email, role, or school to find a recipient.
        </div>
      )}

      {showEmptyNoMatch && (
        <div style={{ fontSize: 12, color: '#6b7280', padding: '14px 4px 4px' }}>
          No matching contacts or students found
        </div>
      )}

      {results.length > 0 && (
        <div
          ref={listRef}
          id="recipient-picker-listbox"
          role="listbox"
          aria-label="Recipient results"
          style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto' }}
        >
          {results.map((r, i) => {
            const isActive = i === activeIdx
            return (
              <div
                key={`${r.kind}:${r.id}`}
                data-idx={i}
                role="option"
                aria-selected={isActive}
                onClick={() => choose(r)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 10px', cursor: 'pointer', borderRadius: 7,
                  background: isActive ? '#EEF2FB' : 'transparent',
                }}
              >
                {/* Avatar */}
                {r.kind === 'student' ? (
                  <StudentAvatar student={r.raw} size={34} style={{ flexShrink: 0 }} />
                ) : (
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: NAVY, overflow: 'hidden', position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: F,
                  }}>
                    {r.avatar_url && (
                      <img
                        src={r.avatar_url} alt=""
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.currentTarget.style.display = 'none' }}
                      />
                    )}
                    {initials(r.name)}
                  </div>
                )}

                {/* Identity */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600, color: '#191919', fontFamily: F,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.name}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: '#6b7280', fontFamily: F,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.kind === 'contact'
                      ? [r.role, r.email].filter(Boolean).join(' · ')
                      : [r.school, r.email].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {r.kind === 'contact' && r.category && (
                      <span style={catChipStyle(r.category)}>{r.category}</span>
                    )}
                    {r.kind === 'student' && r.status && (
                      <span style={statusChipStyle(r.status)}>{r.status}</span>
                    )}
                  </div>
                </div>

                {/* Type indicator */}
                <span style={{
                  fontSize: 9, fontWeight: 700, color: '#9ca3af', fontFamily: F,
                  textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0,
                }}>
                  {r.kind === 'contact' ? 'Contact' : 'Student'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Cancel affordance - only when there is a previous recipient to fall back to */}
      {canCancel && (
        <button
          type="button"
          onClick={() => onCancel?.()}
          style={{
            marginTop: 12, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 600, color: '#6b7280', fontFamily: F, padding: 0,
          }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
