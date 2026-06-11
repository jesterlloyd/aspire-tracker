// KT-3a-1: reusable governance state badge. Renders the four KT-1 lifecycle states
// (draft | active | deprecated | archived) as a small pill. Presentational only —
// reused by Knowledge Center (KT-3a-2) and Templates (KT-3b). Colors are drawn from
// the existing Cedars-Sinai status palette (sage/dawn/nightfall/neutral); no new
// tokens. No other lifecycle state is used in this system.
const STATE_STYLES = {
  draft:      { label: 'Draft',      bg: '#eef2fb', color: '#1D2567', dot: '#6b7fd7' },
  active:     { label: 'Active',     bg: '#EDF2E2', color: '#166534', dot: '#3f9142' },
  deprecated: { label: 'Deprecated', bg: '#FEF3C7', color: '#78350F', dot: '#d08700' },
  archived:   { label: 'Archived',   bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' },
}

export default function StateBadge({ state }) {
  const s = STATE_STYLES[state] || { label: state || 'Unknown', bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 9px', borderRadius: 999,
      background: s.bg, color: s.color,
      fontFamily: 'DM Sans, sans-serif', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      {s.label}
    </span>
  )
}
