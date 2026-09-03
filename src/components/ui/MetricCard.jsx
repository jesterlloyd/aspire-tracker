// UI-1: PASSIVE summary metric card (governance register) - extracted from the
// shipped Knowledge Center summary cards (KT-3a-1).
//
// CANON: this is variant="summary" ONLY. It is informational: no onClick prop,
// no hover lift, no pointer cursor, no selected/active state, no button
// semantics. The interactive quick-filter KPI card (pastel tint/solid/halo,
// click-to-filter - the KPIBand operational pattern) is a DIFFERENT component
// and is deliberately NOT built here; it stays the live pattern in the
// operational workspaces until a later coherence pass. Do not flatten the two.
import SurfaceCard from './SurfaceCard'

export default function MetricCard({ label, value, sub, badge }) {
  return (
    <SurfaceCard padding="14px 16px" style={{ flex: '1 1 140px', minWidth: 120, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      {(badge || label) && (
        <div style={{ marginBottom: 8 }}>
          {badge || (
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary, #6b7280)' }}>{label}</span>
          )}
        </div>
      )}
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary, #191919)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 3 }}>{sub}</div>
      )}
    </SurfaceCard>
  )
}
