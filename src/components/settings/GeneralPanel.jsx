// WS2.1: Settings → General panel. Re-homes the Appearance control by reusing the
// existing ThemeToggle (unchanged). No new preference storage; theme persistence,
// data-theme behavior, OS listener, and public data-theme-lock all stay in ThemeContext.
import ThemeToggle from '../ThemeToggle'

export default function GeneralPanel() {
  return (
    <section aria-labelledby="settings-general-heading">
      <h2 id="settings-general-heading" style={{
        margin: '0 0 4px', fontSize: 17, fontWeight: 700,
        color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
      }}>
        General
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        Global preferences for how ASPIRE Intelligence looks and behaves.
      </p>

      {/* Appearance */}
      <div style={{
        border: '1px solid var(--color-border-default, #e5e7eb)',
        borderRadius: 12, padding: '16px 18px',
        background: 'var(--color-bg-surface, #ffffff)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Appearance</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }}>
            Choose Light, Dark, or follow your system setting.
          </div>
        </div>
        <ThemeToggle />
      </div>
    </section>
  )
}
