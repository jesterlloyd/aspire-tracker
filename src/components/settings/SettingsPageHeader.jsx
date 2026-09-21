// KT-3a-1 -> UI-1 -> SETTINGS-VISUAL-DENSITY-1: the Settings page-header, with the title in
// the SHARED SETTINGS_HEADING_STYLE.
//
// SETTINGS-BAND-1 (Owner, 2026-09-21): it is now THE header band of every Settings page,
// and of the rail's own column ("Settings"). One fixed shape: a title line that also holds
// an access note and the page's actions, then ONE line for a subtitle or instruction,
// reserved even when a page has none. Every band is the same height, so the rail card and
// every page's first card start on one line, whatever the page's header carries. A
// subtitle is one sentence that fits one line (the tests hold them to 85 characters);
// longer guidance belongs in the page. Layout: settingsPageHeader.css.
import { SETTINGS_HEADING_STYLE } from './settingsSections'
import './settingsPageHeader.css'

export default function SettingsPageHeader({ as: Title = 'h2', id, title, subtitle, accessNote, accessNoteTitle, actions }) {
  return (
    <header className="settings-page-head">
      <div className="settings-page-head-row">
        <Title id={id} className="settings-page-title" style={{ ...SETTINGS_HEADING_STYLE, margin: 0 }}>{title}</Title>
        {accessNote && <span className="settings-page-note" title={accessNoteTitle}>{accessNote}</span>}
        {actions && <div className="settings-page-actions">{actions}</div>}
      </div>
      {/* The subtitle line is always there, empty or not: that is what keeps bands equal. */}
      <p className="settings-page-sub" aria-hidden={subtitle ? undefined : 'true'}>{subtitle || null}</p>
    </header>
  )
}
