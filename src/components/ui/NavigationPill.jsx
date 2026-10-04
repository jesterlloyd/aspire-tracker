import { ChevronLeft } from 'lucide-react'
import './navigationPill.css'

function RefreshIcon({ className, size = 16, strokeWidth = 2.25 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 8.5a8.5 8.5 0 0 0-14.9-3.3L3 8.5" />
      <path d="M3 3v5.5h5.5" />
      <path d="M3.5 15.5a8.5 8.5 0 0 0 14.9 3.3l2.6-3.3" />
      <path d="M21 21v-5.5h-5.5" />
    </svg>
  )
}

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
    <NavigationPill icon={RefreshIcon} loading={loading} ariaLabel="Refresh" {...props}>
      {loading ? 'Refreshing…' : 'Refresh'}
    </NavigationPill>
  )
}
