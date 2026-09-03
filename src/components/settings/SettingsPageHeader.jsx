// KT-3a-1 -> UI-1 -> SETTINGS-VISUAL-DENSITY-1: the Settings page-header renders its
// own markup again (no longer a thin PageHeader alias) so the title uses the SHARED
// SETTINGS_HEADING_STYLE - putting Knowledge Center (and any other consumer) on the
// same baseline as the "Settings" column heading. Subtitle/accessNote/actions keep
// the PageHeader layout pixel-for-pixel.
import { SETTINGS_HEADING_STYLE } from './settingsSections'

export default function SettingsPageHeader({ title, subtitle, accessNote, actions }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ ...SETTINGS_HEADING_STYLE, margin: 0 }}>{title}</h2>
        {accessNote && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '2px 9px', borderRadius: 999,
            background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-accent-primary, #1D2567)',
            fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {accessNote}
          </span>
        )}
        {actions && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>}
      </div>
      {subtitle && (
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
