// UI-1: governance/admin button primitive, based on shipped Settings / Knowledge
// Center pixels (Plus Jakarta Sans 13/600, radius 9, navy accent) and the established
// button variants. The universal DISABLED treatment reproduces the shipped
// Knowledge Center "New Entry" pixels exactly (elevated background, secondary
// text, 0.6 opacity, not-allowed cursor) regardless of variant.
const VARIANTS = {
  primary:     { background: 'var(--color-accent-primary, #1D2567)', color: '#ffffff',                              border: 'none' },
  secondary:   { background: 'var(--color-bg-elevated, #eef2fb)',     color: 'var(--color-accent-primary, #1D2567)', border: 'none' },
  quiet:       { background: 'transparent',                            color: 'var(--color-text-secondary, #6b7280)', border: 'none' },
  destructive: { background: '#fef2f2',                                color: '#dc2626',                              border: '1px solid #fecaca' },
}

const SIZES = {
  md: { padding: '8px 14px', fontSize: 13 },
  sm: { padding: '6px 10px', fontSize: 12 },
}

export default function Button({ variant = 'primary', size = 'md', icon, disabled, children, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.primary
  const s = SIZES[size] || SIZES.md
  const disabledStyle = disabled ? {
    background: 'var(--color-bg-elevated, #eef2fb)',
    color: 'var(--color-text-secondary, #6b7280)',
    border: 'none',
    cursor: 'not-allowed',
    opacity: 0.6,
  } : {}
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        borderRadius: 9, cursor: 'pointer',
        fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 600,
        ...v, ...s, ...disabledStyle, ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
