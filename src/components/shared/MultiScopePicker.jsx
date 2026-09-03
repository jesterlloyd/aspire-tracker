// CONTACTS-CANON-1: the accessible multi-select chip picker over a static
// catalog, moved VERBATIM from GrantPortalAccessModal so the contacts editors
// (staff Add/Edit Contact and the portal contacts editor) can share the exact
// component - the same extraction pattern ContactSuggest already followed.
//
// A selected value that is NOT in the options catalog still renders as a
// removable chip (label falls back to the raw value), which is exactly the
// legacy-passthrough behavior the canonical contacts model needs: an old
// free-text unit stays visible and removable, but new picks come only from
// the catalog.

import { useState, useMemo } from 'react'
import { X } from 'lucide-react'

const DEFAULT_INPUT_STYLE = {
  width: '100%', padding: '8px 10px', border: '1px solid #d5d9e2', borderRadius: 8,
  fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, boxSizing: 'border-box',
}

export default function MultiScopePicker({ id, options, selected, onChange, placeholder, inputStyle = DEFAULT_INPUT_STYLE }) {
  const [term, setTerm] = useState('')
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase()
    return options.filter(o => !selected.includes(o.value) && (!t || o.label.toLowerCase().includes(t) || (o.hint || '').toLowerCase().includes(t))).slice(0, 8)
  }, [options, selected, term])
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: selected.length ? 8 : 0 }}>
        {selected.map(v => {
          const o = options.find(x => x.value === v)
          return (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#eef2fb', color: '#1D2567', fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 16 }}>
              {o?.label || v}
              <button type="button" aria-label={`Remove ${o?.label || v}`} onClick={() => onChange(selected.filter(s => s !== v))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1D2567', display: 'flex', padding: 0 }}><X size={12} /></button>
            </span>
          )
        })}
      </div>
      <input id={id} value={term} onChange={e => setTerm(e.target.value)} placeholder={placeholder}
        role="combobox" aria-expanded={filtered.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" style={inputStyle} />
      {term.trim() && filtered.length > 0 && (
        <ul id={`${id}-list`} role="listbox" style={{ listStyle: 'none', margin: '6px 0 0', padding: 4, border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 180, overflowY: 'auto', background: '#fff' }}>
          {filtered.map(o => (
            <li key={o.value} role="option" aria-selected={false} tabIndex={0}
              onClick={() => { onChange([...selected, o.value]); setTerm('') }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange([...selected, o.value]); setTerm('') } }}
              style={{ padding: '7px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ fontWeight: 600, color: '#1D2567' }}>{o.label}</span>
              {o.hint && <span style={{ color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
