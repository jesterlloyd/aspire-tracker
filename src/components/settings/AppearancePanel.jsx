// WS2.4: Settings → Appearance panel. The Appearance control was consolidated here from
// the UserMenu dropdown and Settings → General so theme/display has a single canonical
// home. It reuses the existing ThemeToggle unchanged - theme persistence, data-theme
// behavior, the OS listener, and the public data-theme-lock all remain in ThemeContext.
// No new preference storage, accent color, or user_settings write is introduced.
import ThemeToggle from '../ThemeToggle'
import SurfaceCard from '../ui/SurfaceCard'

// SETTINGS-VISUAL-DENSITY-1: the heading is provided by the General master-detail hub
// (one shared baseline with Settings | General); the generic subtitle is removed. The
// operational guidance lives inside the card. Custom border card -> canonical SurfaceCard.
export default function AppearancePanel() {
  return (
    <section aria-label="Appearance">
      <SurfaceCard padding="16px 18px" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Theme</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }}>
            Choose Light, Dark, or follow your system setting.
          </div>
        </div>
        <ThemeToggle />
      </SurfaceCard>
    </section>
  )
}
