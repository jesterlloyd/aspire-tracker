// UI-1: generic status badge pill - mechanics extracted from the shipped
// Knowledge Center StateBadge (KT-3a-1) pixel-for-pixel. Domain-agnostic: the
// caller supplies a colorMap ({ [value]: { label, bg, color, dot } }); domain
// color maps live near their domain code (e.g. settings/StateBadge for the
// governance lifecycle states). Unknown values fall back to a neutral gray pill.
const FALLBACK = { bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' }

export default function StatusBadge({ value, colorMap = {}, dot = true }) {
  const s = colorMap[value] || { label: value || 'Unknown', ...FALLBACK }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 9px', borderRadius: 999,
      background: s.bg, color: s.color,
      fontFamily: 'DM Sans, sans-serif', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />}
      {s.label}
    </span>
  )
}
