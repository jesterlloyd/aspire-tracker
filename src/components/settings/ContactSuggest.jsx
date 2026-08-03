// STAFF-INVITE-CONTACTS-1: the ONE saved-Contacts typeahead used by every
// Accounts & Access identity field.
//
// Extracted VERBATIM from GrantPortalAccessModal (behavior byte-identical) so
// the staff invite and the portal grant share one accessible combobox over one
// contacts source (src/lib/contactSearch.js -> the same authorized RLS path
// Outreach uses). There is no second contact directory and no second search.
//
// Accessibility contract (unchanged): role=combobox with aria-expanded,
// aria-controls, aria-autocomplete=list and aria-activedescendant; ArrowUp /
// ArrowDown move the active option, Enter selects, Escape closes the list
// without closing the surrounding modal.
import { useState } from 'react'
import { Contact as ContactIcon } from 'lucide-react'
import { useContactSearch, contactSubtitle } from '../../lib/contactSearch'

const F = 'DM Sans, sans-serif'
const field = { width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', boxSizing: 'border-box' }

// Local (not exported): this file exports the component only, so fast refresh
// stays intact. Callers that need the same display rule keep their own copy,
// exactly as GrantPortalAccessModal already does.
const contactName = (c) => c?.full_name || c?.preferred_name || c?.email || ''

export default function ContactSuggest({ id, value, onChange, onPick, placeholder, ariaLabel }) {
  const { rows, loading, debounced } = useContactSearch(value)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const safeActive = rows.length ? Math.min(activeIdx, rows.length - 1) : 0
  const showNoMatch = open && !loading && debounced.length >= 2 && rows.length === 0
  const choose = (c) => { onPick?.(c); setOpen(false) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActiveIdx(Math.min(safeActive + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(Math.max(safeActive - 1, 0)) }
    else if (e.key === 'Enter') { if (open && rows[safeActive]) { e.preventDefault(); choose(rows[safeActive]) } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false) } }
  }
  const listboxId = `${id}-listbox`
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} value={value}
        onChange={e => { onChange?.(e.target.value); setActiveIdx(0); setOpen(true) }}
        onKeyDown={onKey} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 130)}
        placeholder={placeholder} style={field}
        role="combobox" aria-expanded={open && rows.length > 0} aria-controls={listboxId} aria-autocomplete="list"
        aria-label={ariaLabel} aria-activedescendant={open && rows[safeActive] ? `${id}-opt-${safeActive}` : undefined} />
      {open && (rows.length > 0 || loading || showNoMatch) && (
        <div id={listboxId} role="listbox" aria-label="Saved contact suggestions"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.12)', maxHeight: 300, overflowY: 'auto', padding: 4 }}>
          {loading && <div style={{ fontSize: 11.5, color: '#9ca3af', padding: '10px' }}>Searching…</div>}
          {showNoMatch && <div style={{ fontSize: 12, color: '#6b7280', padding: '10px', lineHeight: 1.5 }}>No matching contact found. You can continue by entering the details manually.</div>}
          {rows.map((c, i) => {
            const isActive = i === safeActive
            return (
              <div key={c.id} id={`${id}-opt-${i}`} role="option" aria-selected={isActive}
                onMouseDown={e => e.preventDefault()} onClick={() => choose(c)} onMouseEnter={() => setActiveIdx(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', cursor: 'pointer', borderRadius: 7, background: isActive ? '#EEF2FB' : 'transparent' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: '#1D2567', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ContactIcon size={14} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#191919', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactName(c)}</div>
                  <div style={{ fontSize: 10.5, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactSubtitle(c)}</div>
                </div>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em', background: '#EEF2FB', color: '#1D2567', border: '1px solid #c3cdf0' }}>Saved contact</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
