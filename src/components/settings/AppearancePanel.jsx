// WS2.4: Settings → Appearance panel. The Appearance control was consolidated here from
// the UserMenu dropdown and Settings → General so theme/display has a single canonical
// home. It reuses the existing ThemeToggle unchanged - theme persistence, data-theme
// behavior, the OS listener, and the public data-theme-lock all remain in ThemeContext.
//
// CONTACTS-BOOK-1 (2026-09-20): a second card, Contacts Layout, chooses between Classic
// and the Address book on ASPIRE Connect > Contacts. Unlike Theme it is per-USER, not
// per-device: it reads and writes appearance.contactsLayout through useUserPreference,
// the same store the link beside Refresh uses, so the two always agree.
import { useId } from 'react'
import ThemeToggle from '../ThemeToggle'
import SurfaceCard from '../ui/SurfaceCard'
import { useUserPreference } from '../../hooks/useUserPreference'
import { CONTACTS_LAYOUT } from '../../lib/userPreferences'

const CONTACTS_LAYOUT_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'book',    label: 'Address Book' },
]

const CARD_STYLE = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
}
const TITLE_STYLE = { fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }
const HINT_STYLE = { fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }

// A real radio group: native radios give arrow-key movement and one tab stop for free.
// The visible title labels the group; the segments are styled in index.css.
function ContactsLayoutCard() {
  const [layout, setLayout, { synced }] = useUserPreference(CONTACTS_LAYOUT)
  const titleId = useId()
  const hintId = useId()
  const name = useId()
  return (
    <SurfaceCard padding="16px 18px" style={CARD_STYLE}>
      {/* The text shrinks before the row wraps, so the control stays beside the title. */}
      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
        <div id={titleId} style={TITLE_STYLE}>Contacts Layout</div>
        <div id={hintId} style={HINT_STYLE}>
          ASPIRE Connect Contacts as three columns, or as an address book with the whole record on one page.
          {synced === false ? ' Saved in this browser for now.' : ''}
        </div>
      </div>
      <div role="radiogroup" aria-labelledby={titleId} aria-describedby={hintId} className="appearance-segmented">
        {CONTACTS_LAYOUT_OPTIONS.map(option => (
          <label key={option.value} className="appearance-segment">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={layout === option.value}
              onChange={() => setLayout(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </SurfaceCard>
  )
}

// SETTINGS-VISUAL-DENSITY-1: the heading is provided by the General master-detail hub
// (one shared baseline with Settings | General); the generic subtitle is removed. The
// operational guidance lives inside the card. Custom border card -> canonical SurfaceCard.
export default function AppearancePanel() {
  return (
    <section aria-label="Appearance" style={{ display: 'grid', gap: 'var(--aspire-gap-card)' }}>
      <SurfaceCard padding="16px 18px" style={CARD_STYLE}>
        <div style={{ minWidth: 0 }}>
          <div style={TITLE_STYLE}>Theme</div>
          <div style={HINT_STYLE}>
            Choose Light, Dark, or follow your system setting.
          </div>
        </div>
        <ThemeToggle />
      </SurfaceCard>
      <ContactsLayoutCard />
    </section>
  )
}
