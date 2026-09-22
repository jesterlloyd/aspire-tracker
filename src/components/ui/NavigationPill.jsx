import { ChevronLeft, RotateCw } from 'lucide-react'
import './navigationPill.css'

export function NavigationPill({
  children,
  icon: Icon,
  onClick,
  disabled = false,
  loading = false,
  ariaLabel,
  type = 'button',
  className = '',
  style,
}) {
  return (
    <button
      type={type}
      className={`nav-pill${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={style}
    >
      {Icon && <Icon className={loading ? 'nav-pill-icon nav-pill-icon-spin' : 'nav-pill-icon'} size={16} strokeWidth={2.25} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  )
}

export function BackPill({ children, label, ...props }) {
  return <NavigationPill icon={ChevronLeft} ariaLabel={props.ariaLabel || label} {...props}>{children || label}</NavigationPill>
}

export function RefreshPill({ loading = false, ...props }) {
  return (
    <NavigationPill icon={RotateCw} loading={loading} ariaLabel="Refresh" {...props}>
      {loading ? 'Refreshing…' : 'Refresh'}
    </NavigationPill>
  )
}
