// UI-1: section page-header — title + optional subtitle + optional access-note
// pill + optional right-aligned actions slot. Generalizes the shipped
// SettingsPageHeader (KT-3a-1) pixel-for-pixel; settings/SettingsPageHeader now
// delegates here. Governance register: calm, plain header (no gradient hero —
// heroes are reserved for people records).
export default function PageHeader({ title, subtitle, accessNote, actions }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{
          margin: 0, fontSize: 17, fontWeight: 700,
          color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
        }}>
          {title}
        </h2>
        {accessNote && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '2px 9px', borderRadius: 999,
            background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-accent-primary, #1D2567)',
            fontFamily: 'DM Sans, sans-serif', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {accessNote}
          </span>
        )}
        {actions && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>}
      </div>
      {subtitle && (
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', fontFamily: 'DM Sans, sans-serif' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
