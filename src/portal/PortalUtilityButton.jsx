export default function PortalUtilityButton({
  side,
  label,
  badge = 0,
  current = false,
  onClick,
  buttonRef,
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`ptl-utility-button ptl-utility-button-${side}${current ? ' ptl-utility-button-current' : ''}`}
      aria-current={current ? 'page' : undefined}
      aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
      onClick={onClick}
    >
      <span className="ptl-utility-label">{label}</span>
      {badge > 0 && <span className="ptl-utility-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}
