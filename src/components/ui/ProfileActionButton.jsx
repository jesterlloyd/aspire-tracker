// src/components/ui/ProfileActionButton.jsx
//
// Shared action button for Contact Profile and Student Profile heroes.
// Supports primary (navy fill), secondary (outline), and linkedin variants.
// Accepts either a button (onClick) or anchor (href) rendering mode.
// Uses the existing Tooltip component for disabled reasons and icon-only labels.

import Tooltip from './Tooltip'

const F    = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const VARIANT_STYLES = {
  primary: {
    background: NAVY, color: '#fff', border: 'none',
    hoverBg: 'rgba(29,37,103,0.85)',
  },
  secondary: {
    background: '#fff', color: NAVY, border: '1px solid rgba(29,37,103,0.20)',
    hoverBg: '#EEF2FB',
  },
  linkedin: {
    background: '#fff', color: '#0A66C2', border: '1px solid rgba(10,102,194,0.25)',
    hoverBg: '#EFF6FF',
  },
}

const DISABLED_STYLE = {
  background: '#e5e7eb', color: '#9ca3af', border: '1px solid transparent',
}

// Props:
//   variant        — 'primary' | 'secondary' | 'linkedin'
//   icon           — React node rendered at the start (string emoji or JSX element)
//   label          — button label text
//   iconOnly       — if true, hides the text label; shows label in tooltip
//   onClick        — used in button mode
//   href           — when set, renders an <a> tag
//   target / rel   — anchor props
//   disabled       — visually muted, non-clickable
//   disabledReason — tooltip shown when disabled
//   ariaLabel      — accessible label (defaults to label)

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

  const baseStyle = {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            5,
    padding:        iconOnly ? '7px 10px' : '7px 14px',
    height:         34,
    borderRadius:   8,
    background:     v.background,
    color:          v.color,
    border:         v.border || 'none',
    fontFamily:     F,
    fontSize:       12,
    fontWeight:     600,
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
