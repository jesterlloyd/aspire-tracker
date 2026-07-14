// src/components/connect/ContactAutocomplete.jsx
// CONNECT-COMMS-1F: reusable contact typeahead for the Direct Message CC field.
//
// Searchable sources (all client-direct, against each table's EXISTING RLS - no new endpoint,
// no schema, no migration):
//   • contacts   - server-side .or(ilike) (mirrors App.jsx UNIVERSAL-SEARCH-1), is_active only
//   • preceptors - server-side .or(ilike) (global roster, authenticated read)
//   • students   - filtered client-side from the already-loaded `students` prop (no extra fetch);
//                  school + personal shown as SEPARATE clearly-labeled rows, school-first
//   • coordinator - the current student's denormalized clinical coordinator, when valid + matched
//
// This component NEVER resolves the primary To and never sends. It only surfaces suggestions and
// emits the chosen email up to the parent, which remains responsible for chip add/validation. The
// server (resolveCcList) stays the source of truth for CC validation/dedupe/drop-CC==To/cap-5.
//
// State design note: `loading` and the highlighted-row clamp are DERIVED (not stored + synced via
// effects), so this component holds no react-hooks/set-state-in-effect patterns. The only effects
// are the debounce timer, the async fetch (setState only inside the async callback), and a DOM
// scroll-into-view (no setState).
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { searchContacts } from '../../lib/contactSearch'
import StudentAvatar from '../StudentAvatar'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { getPrimaryCategory, categoryChipColors } from '../../lib/contactCategories'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const SOURCE_BADGE = {
  coordinator: { label: 'Coordinator', color: '#4338ca', bg: '#eef2ff', border: '#c7d2fe' },
  contact:     { label: 'Contact',     color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  preceptor:   { label: 'Preceptor',   color: '#0e4e6e', bg: '#E1F3FB', border: '#89CEEA' },
  student:     { label: 'Student',     color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

// PostgREST .or() splits on top-level commas and parentheses; ilike treats % and _ as wildcards.
// Strip those so a free-typed term is matched literally and can never break the filter string.
function sanitizeTerm(s) {
  return String(s || '').replace(/[,()%_\\*]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * ContactAutocomplete
 * @param {string}   value           controlled input text
 * @param {Function} onChange        (text) => void
 * @param {boolean}  [disabled]
 * @param {boolean}  [maxReached]    true once the CC cap (5) is hit - input is disabled with a hint
 * @param {string}   [placeholder]
 * @param {Array}    [students]      already-loaded cohort students (filtered client-side)
 * @param {object}   [coordinator]   { email, name } for the current student, or null
 * @param {Set}      [excludeEmails] normalized emails to hide (already-added CC + resolved To)
 * @param {Function} onSelect        (result) => void - a suggestion was chosen; result.email is added
 * @param {Function} onCommitManual  (text) => void - Enter/blur on free text with no active suggestion
 * @param {Function} onBackspaceEmpty () => void - Backspace on an empty input (remove last chip)
 */
export default function ContactAutocomplete({
  value,
  onChange,
  disabled = false,
  maxReached = false,
  placeholder = 'Add CC email…',
  students = [],
  coordinator = null,
  excludeEmails,
  onSelect,
  onCommitManual,
  onBackspaceEmpty,
  onPaste,
}) {
  const [debounced, setDebounced] = useState('')
  // `remote` carries the query it was fetched for (`key`) so `loading` can be derived and stale
  // results never render for a newer query.
  const [remote, setRemote]       = useState({ key: '', contacts: [], preceptors: [] })
  const [open, setOpen]           = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  const listRef     = useRef(null)
  const debounceRef = useRef(null)
  const reqRef      = useRef(0)

  // Stable exclude set (avoids a fresh Set identity in the results-memo deps each render).
  const exclude = useMemo(
    () => (excludeEmails instanceof Set ? excludeEmails : new Set()),
    [excludeEmails],
  )

  // Derived: we are loading whenever the searchable query has not yet been answered by `remote`.
  const loading = debounced.length >= 2 && remote.key !== debounced

  // ── Debounce the query (250ms; setState lives in the timer callback, not the effect body) ──
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(sanitizeTerm(value)), 250)
    return () => clearTimeout(debounceRef.current)
  }, [value])

  // ── Server-side reads for contacts + preceptors (min 2 chars). All setState is inside the
  //    async resolution, so the effect body performs no synchronous state update. ──
  useEffect(() => {
    if (debounced.length < 2) return // results memo ignores remote below 2 chars; loading derives false
    const id = ++reqRef.current
    const like = `%${debounced}%`
    Promise.all([
      // Shared single-source contacts search (see src/lib/contactSearch.js).
      searchContacts(debounced, { limit: 6 }),
      supabase.from('preceptors')
        .select('id, full_name, email, unit_name, shift_type')
        .or(`full_name.ilike.${like},email.ilike.${like},unit_name.ilike.${like}`)
        .limit(6),
    ]).then(([cRows, pRes]) => {
      if (id !== reqRef.current) return // a newer query superseded this one
      setRemote({ key: debounced, contacts: cRows || [], preceptors: pRes.data || [] })
    }).catch(() => {
      if (id !== reqRef.current) return
      setRemote({ key: debounced, contacts: [], preceptors: [] })
    })
  }, [debounced])

  // ── Merge + normalize + dedupe (by email) + drop excluded ────────────────────
  const results = useMemo(() => {
    if (debounced.length < 2) return []
    // Only use remote rows once they match the current query (else show "Searching…" via `loading`).
    const r = remote.key === debounced ? remote : { contacts: [], preceptors: [] }
    const ql = debounced.toLowerCase()
    const out = []
    const seen = new Set()

    const push = (row) => {
      if (!row.email || !isValidEmail(row.email)) return
      const norm = normalizeEmailForLookup(row.email)
      if (exclude.has(norm) || seen.has(norm)) return
      seen.add(norm)
      out.push({ ...row, norm })
    }

    // 1. Coordinator (highest priority - most relevant to the current recipient)
    if (coordinator?.email && isValidEmail(coordinator.email)) {
      const hay = [coordinator.name, coordinator.email].filter(Boolean).join(' ').toLowerCase()
      if (hay.includes(ql)) {
        push({ source: 'coordinator', key: `coord:${coordinator.email}`, name: coordinator.name || 'Clinical Coordinator',
          email: coordinator.email, secondary: coordinator.email })
      }
    }
    // 2. Contacts - carry the resolved primary category so the badge shows it (not generic "Contact")
    for (const c of r.contacts) {
      push({ source: 'contact', key: `contact:${c.id}`, name: c.full_name || c.preferred_name || c.email,
        email: c.email, avatarUrl: c.avatar_url || null, category: getPrimaryCategory(c) || '',
        secondary: [c.role || c.category, c.school_name || c.organization, c.email].filter(Boolean).join(' · ') })
    }
    // 3. Preceptors
    for (const p of r.preceptors) {
      push({ source: 'preceptor', key: `preceptor:${p.id}`, name: p.full_name || p.email,
        email: p.email, secondary: [p.unit_name, p.shift_type, p.email].filter(Boolean).join(' · ') })
    }
    // 4. Students - school-first; personal as a separate, clearly-labeled row (never silent)
    let stuCount = 0
    for (const s of students) {
      if (stuCount >= 6) break
      const name = `${s.first_name || ''} ${s.last_name || ''}`.trim()
      const hay = [name, s.school_email, s.personal_email, s.school].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(ql)) continue
      const before = out.length
      if (isValidEmail(s.school_email)) {
        push({ source: 'student', key: `stu-s:${s.id}`, name, email: s.school_email, raw: s,
          emailKind: 'School', secondary: [s.school, `School: ${s.school_email}`].filter(Boolean).join(' · ') })
      }
      if (isValidEmail(s.personal_email) && normalizeEmailForLookup(s.personal_email) !== normalizeEmailForLookup(s.school_email)) {
        push({ source: 'student', key: `stu-p:${s.id}`, name, email: s.personal_email, raw: s,
          emailKind: 'Personal', secondary: [s.school, `Personal: ${s.personal_email}`].filter(Boolean).join(' · ') })
      }
      if (out.length > before) stuCount++
    }

    return out.slice(0, 12)
  }, [debounced, remote, students, coordinator, exclude])

  // Derived clamp for the highlighted row - no effect needed (avoids set-state-in-effect).
  const safeActive = results.length ? Math.min(activeIdx, results.length - 1) : 0

  // Keep the highlighted row in view. DOM side effect only - no setState.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [safeActive])

  const choose = useCallback((r) => {
    if (!r) return
    onSelect?.(r)
    setOpen(false)
  }, [onSelect])

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true); setActiveIdx(Math.min(safeActive + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActiveIdx(Math.max(safeActive - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && results[safeActive]) choose(results[safeActive])
      else onCommitManual?.(value)
    } else if (e.key === ',' || e.key === ';') {
      e.preventDefault(); onCommitManual?.(value)
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false) }
    } else if (e.key === 'Backspace' && !value) {
      onBackspaceEmpty?.()
    }
    // Tab is intentionally NOT trapped - it moves focus and lets blur commit.
  }, [open, results, safeActive, value, choose, onCommitManual, onBackspaceEmpty])

  const term         = sanitizeTerm(value)
  const showHint     = open && term.length > 0 && term.length < 2
  const showLoading  = open && loading
  const showNoMatch  = open && !loading && debounced.length >= 2 && results.length === 0
  const manualIsEmail = isValidEmail(String(value || '').trim())
  const listboxId = 'cc-autocomplete-listbox'

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={e => { onChange?.(e.target.value); setActiveIdx(0); setOpen(true) }}
        onKeyDown={handleKey}
        onPaste={onPaste}
        onFocus={() => setOpen(true)}
        // Delay so a row's onClick registers before blur commits the typed text.
        onBlur={() => { setTimeout(() => setOpen(false), 120); if (value) onCommitManual?.(value) }}
        placeholder={maxReached ? 'Max 5 CC' : placeholder}
        disabled={disabled || maxReached}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[safeActive] ? `cc-opt-${safeActive}` : undefined}
        aria-label="Add a CC recipient by name or email"
        style={{ flex: '1 1 140px', minWidth: 140, border: 'none', outline: 'none', fontSize: 12.5, fontFamily: F, color: '#191919', background: 'transparent', padding: '3px 2px' }}
      />

      {(results.length > 0 || showHint || showLoading || showNoMatch) && open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Contact suggestions"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,0.12)', maxHeight: 320, overflowY: 'auto', padding: 4,
          }}
        >
          {showHint && (
            <div style={{ fontSize: 11.5, color: '#9ca3af', padding: '10px 10px', fontFamily: F }}>Type a name or email…</div>
          )}
          {showLoading && (
            <div style={{ fontSize: 11.5, color: '#9ca3af', padding: '10px 10px', fontFamily: F }}>Searching…</div>
          )}
          {showNoMatch && (
            <div style={{ fontSize: 12, color: '#6b7280', padding: '10px 10px', fontFamily: F }}>
              {manualIsEmail ? 'Press Enter to add this email.' : 'No matches.'}
            </div>
          )}
          {results.map((r, i) => {
            const isActive = i === safeActive
            // Contacts use the canonical per-category palette; other sources keep their source badge.
            const badge = (r.source === 'contact' && r.category)
              ? categoryChipColors(r.category)
              : (SOURCE_BADGE[r.source] || SOURCE_BADGE.contact)
            return (
              <div
                key={r.key}
                id={`cc-opt-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isActive}
                onMouseDown={e => e.preventDefault()} // keep input focus so onClick fires before blur
                onClick={() => choose(r)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px',
                  cursor: 'pointer', borderRadius: 7, background: isActive ? '#EEF2FB' : 'transparent',
                }}
              >
                {/* Avatar */}
                {r.source === 'student' && r.raw ? (
                  <StudentAvatar student={r.raw} size={30} style={{ flexShrink: 0 }} />
                ) : (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: NAVY,
                    overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: '#fff', fontFamily: F,
                  }}>
                    {r.avatarUrl && (
                      <img src={r.avatarUrl} alt="" onError={e => { e.currentTarget.style.display = 'none' }}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    {initials(r.name)}
                  </div>
                )}

                {/* Identity */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#191919', fontFamily: F, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: '#6b7280', fontFamily: F, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.secondary}
                  </div>
                </div>

                {/* Source badge (+ school/personal qualifier for students) */}
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, flexShrink: 0,
                  textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: F,
                  background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                }}>
                  {(r.source === 'contact' && r.category) ? r.category : badge.label}{r.source === 'student' && r.emailKind ? ` · ${r.emailKind}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
