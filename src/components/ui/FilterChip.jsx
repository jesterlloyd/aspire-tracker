// UI-1: filter chip — extracted pixel-for-pixel from the shipped Knowledge
// Center state-filter chips (KT-3a-1). A small toggleable pill; active = solid
// accent, inactive = surface with default border. `count` (optional) renders a
// muted numeric suffix when provided.
export default function FilterChip({ label, active, onClick, count }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-border-default, #e5e7eb)'}`,
        background: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-bg-surface, #ffffff)',
        color: active ? '#ffffff' : 'var(--color-text-secondary, #6b7280)',
        fontFamily: 'DM Sans, sans-serif', fontSize: 12.5, fontWeight: active ? 600 : 500,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{ marginLeft: 5, fontSize: 11, opacity: 0.75 }}>{count}</span>
      )}
    </button>
  )
}
