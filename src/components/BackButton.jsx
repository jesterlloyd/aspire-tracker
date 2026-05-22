// BackButton — the canonical back-navigation affordance for ASPIRE Intelligence.
// Use this component for every "go back" action in the app. Do not create
// custom back buttons; if a new context needs different behavior, extend
// this component with a new variant rather than forking it.
//
// Props:
//   label   (string, required)   — text shown after the chevron
//   onClick (function, required) — back action handler
//   variant ('default' | 'subtle', optional, default: 'default')
//             default: white pill with border, prominent placement
//             subtle:  transparent background, no border, inline use

import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'

export default function BackButton({ label, onClick, variant = 'default' }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const isSubtle = variant === 'subtle'

  const base = {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            '6px',
    padding:        '8px 16px',
    borderRadius:   999,
    border:         isSubtle ? 'none' : `1px solid ${hovered ? '#c8c8c8' : '#E5E5E5'}`,
    background:     hovered
                      ? '#F4F1EC'                       // sand on hover (both variants)
                      : isSubtle ? 'transparent' : '#ffffff',
    color:          '#191919',
    fontFamily:     'DM Sans, sans-serif',
    fontSize:       '14px',
    fontWeight:     500,
    cursor:         'pointer',
    userSelect:     'none',
    transition:     'background 150ms ease, border-color 150ms ease, transform 150ms ease',
    transform:      pressed ? 'scale(0.98)' : 'scale(1)',
    outline:        'none',
    // Focus visible ring handled via onFocus/onBlur + outline property below
  }

  return (
    <button
      type="button"
      aria-label={label}
      style={base}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={e  => { e.currentTarget.style.outline = '2px solid #1D2567'; e.currentTarget.style.outlineOffset = '2px' }}
      onBlur={e   => { e.currentTarget.style.outline = 'none' }}
    >
      <ChevronLeft size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
      {label}
    </button>
  )
}
