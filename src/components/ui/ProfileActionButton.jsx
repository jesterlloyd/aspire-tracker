// src/components/ui/ProfileActionButton.jsx
//
// Shared action button for Contact Profile and Student Profile heroes.
// PROFILE-ACTIONS-CONSISTENCY-1: the approved look is the NEL portal's contact
// actions (.ptl-na-contact-action in portal.css) - every AVAILABLE action is a
// solid nightfall button; only an unavailable one is a grey ghost. The old
// primary/secondary distinction is therefore visual history: both variants
// render the same solid style (the prop is kept so callers never change).
// linkedin keeps its brand treatment.
// Accepts either a button (onClick) or anchor (href) rendering mode.
// Uses the existing Tooltip component for disabled reasons and icon-only labels.

import Tooltip from './Tooltip'

const F    = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'

const SOLID = {
  background: NAVY, color: '#fff', border: `1px solid ${NAVY}`,
  hoverBg: '#151c55',
}

const VARIANT_STYLES = {
  primary:   SOLID,
  secondary: SOLID,
  linkedin: {
    background: '#fff', color: '#0A66C2', border: '1px solid rgba(10,102,194,0.25)',
    hoverBg: '#EFF6FF',
  },
}

// Mirrors .ptl-na-contact-action-disabled.
const DISABLED_STYLE = {
  background: '#eef0f4', color: '#9ca3af', border: '1px solid #d7dae4',
}

// Props:
//   variant        - 'primary' | 'secondary' | 'linkedin'
//   icon           - React node rendered at the start (string emoji or JSX element)
//   label          - button label text
//   iconOnly       - if true, hides the text label; shows label in tooltip
//   onClick        - used in button mode
//   href           - when set, renders an <a> tag
//   target / rel   - anchor props
//   disabled       - visually muted, non-clickable
//   disabledReason - tooltip shown when disabled
//   ariaLabel      - accessible label (defaults to label)

export default function ProfileActionButton({
  variant = 'secondary',
  icon,
  label,
  iconOnly = false,
  onClick,
  href,
  target,
  rel,
  disabled = false,
  disabledReason,
  ariaLabel,
}) {
  const v = disabled ? DISABLED_STYLE : (VARIANT_STYLES[variant] || VARIANT_STYLES.secondary)

  // Metrics mirror .ptl-na-contact-action: min-height 36, min-width 82, gap 7,
  // 12px/700 text, radius 8.
  const baseStyle = {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            7,
    padding:        iconOnly ? '7px 10px' : '7px 13px',
    minHeight:      36,
    minWidth:       iconOnly ? undefined : 82,
    borderRadius:   8,
    background:     v.background,
    color:          v.color,
    border:         v.border || 'none',
    fontFamily:     F,
    fontSize:       12,
    fontWeight:     700,
    cursor:         disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    transition:     'background 0.12s, opacity 0.12s',
    whiteSpace:     'nowrap',
    boxSizing:      'border-box',
    flexShrink:     0,
  }

  const hoverIn  = e => { if (!disabled && v.hoverBg) e.currentTarget.style.background = v.hoverBg }
  const hoverOut = e => { if (!disabled) e.currentTarget.style.background = v.background }

  const content = (
    <>
      {icon != null && (
        <span style={{ display: 'flex', alignItems: 'center', lineHeight: 1, fontSize: 15, flexShrink: 0 }}>
          {icon}
        </span>
      )}
      {!iconOnly && label && <span>{label}</span>}
    </>
  )

  const tooltipText = disabled
    ? (disabledReason || 'Unavailable')
    : (iconOnly && label ? label : undefined)

  const el = (href && !disabled) ? (
    <a
      href={href}
      target={target}
      rel={rel}
      aria-label={ariaLabel || label}
      style={baseStyle}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      style={baseStyle}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
    >
      {content}
    </button>
  )

  return tooltipText ? (
    <Tooltip label={tooltipText} placement="bottom">{el}</Tooltip>
  ) : el
}
