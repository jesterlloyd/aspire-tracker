// UI-1: governance surface card — the white, borderless, soft-shadow card used
// across Settings / Knowledge Center (extracted pixel-for-pixel from the shipped
// KT-3a-1 surfaces). Non-interactive by design: no hover, no cursor, no elevation
// change. Reads theme.css variables so dark mode is not made worse.
export default function SurfaceCard({ as: Tag = 'div', padding, radius = 12, style, children, ...rest }) {
  return (
    <Tag
      style={{
        background: 'var(--color-bg-surface, #ffffff)',
        borderRadius: radius,
        boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
        ...(padding !== undefined ? { padding } : {}),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
