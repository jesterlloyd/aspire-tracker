// WS2.4: Settings → Appearance panel. The Appearance control was consolidated here from
// the UserMenu dropdown and Settings → General so theme/display has a single canonical
// home. It reuses the existing ThemeToggle unchanged - theme persistence, data-theme
// behavior, the OS listener, and the public data-theme-lock all remain in ThemeContext.
// No new preference storage, accent color, or user_settings write is introduced.
import ThemeToggle from '../ThemeToggle'

export default function AppearancePanel() {
  return (
    <section aria-labelledby="settings-appearance-heading">
      <h2 id="settings-appearance-heading" style={{
        margin: '0 0 4px', fontSize: 17, fontWeight: 700,
        color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
      }}>
        Appearance
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        Control how ASPIRE Intelligence looks on this device.
      </p>

      {/* Appearance */}
      <div style={{
        border: '1px solid var(--color-border-default, #e5e7eb)',
        borderRadius: 12, padding: '16px 18px',
        background: 'var(--color-bg-surface, #ffffff)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Theme</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }}>
            Choose Light, Dark, or follow your system setting.
          </div>
        </div>
        <ThemeToggle />
      </div>
    </section>
  )
}
