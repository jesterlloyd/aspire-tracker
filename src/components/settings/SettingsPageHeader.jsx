// KT-3a-1: reusable Settings section page-header (title + subtitle + optional access
// note pill). Mirrors the h2/subtitle pattern the existing Settings panels already
// use, so it reads consistently across sections. Reused by Knowledge Center now and
// by KT-3a-2 / KT-3b later. Presentational only.
export default function SettingsPageHeader({ title, subtitle, accessNote }) {
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
      </div>
      {subtitle && (
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', fontFamily: 'DM Sans, sans-serif' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
