// Settings > Appearance (APPEARANCE-STYLE-1, 2026-09-21; the Owner's mockup,
// settings-appearance-mockup.html, is the reference).
//
// Two choices that combine freely, both saved to the person's account the moment they
// are made (no Save button): Style (Classic or Modern) and Color mode (Light, Dark or
// System). Each card is a real <input type="radio"> inside its <label>, so the arrow
// keys, one tab stop per group and a screen reader's "radio, 1 of 3" come from the
// browser. A change paints at once and confirms with a short toast; a save the account
// refuses puts the earlier choice back and says so.
//
// Below them: a small preview of Contacts, the one screen whose drawing follows Style
// today, and the list of screens Style reaches, each marked Coming until its Modern
// version is built (src/lib/appearance.js STYLE_SURFACES).
//
// The drawing is AppearanceSettings, on plain props, so it renders without a provider in
// the tests; AppearancePanel wires it to the account.
import { useId } from 'react'
import { useAppearance } from '../../hooks/useAppearance'
import { useToast } from '../../hooks/useToast'
import { ToastContainer } from '../Toast'
import SettingsPageHeader from './SettingsPageHeader'
import SurfaceCard from '../ui/SurfaceCard'
import {
  STYLE_SURFACES, styleToast, colorModeToast, systemStatusLine,
} from '../../lib/appearance'
import './appearanceSettings.css'

const STYLE_OPTIONS = [
  { value: 'classic', title: 'Classic', sub: 'Leather, paper, pins and brass' },
  { value: 'modern', title: 'Modern', sub: 'Clean surfaces, same layout' },
]
const MODE_OPTIONS = [
  { value: 'light', title: 'Light' },
  { value: 'dark', title: 'Dark' },
  { value: 'system', title: 'System', sub: 'Match my computer' },
]

function RadioCard({ name, value, checked, onChoose, title, sub, thumb }) {
  return (
    <label className="apx-rc">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChoose(value)}
      />
      <span className={`apx-th apx-th-${value}`} aria-hidden="true">{thumb}</span>
      <span className="apx-lab">
        <span>
          <b>{title}</b>
          {sub && <small>{sub}</small>}
        </span>
        <span className="apx-tick" aria-hidden="true">✓</span>
      </span>
    </label>
  )
}

// Thumbnails are pictures of a style or a palette, so their colours are fixed.
const THUMBS = {
  classic: <><i className="apx-th-gilt apx-th-gilt-l" /><i className="apx-th-gilt apx-th-gilt-r" /><span className="apx-th-pages"><i /><i /></span><i className="apx-th-ribbon" /></>,
  modern: <><i /><i /></>,
  light: <><i className="apx-th-bar" /><span className="apx-th-body"><i /><i /></span></>,
  dark: <><i className="apx-th-bar" /><span className="apx-th-body"><i /><i /></span></>,
  system: <><i className="apx-th-bar" /><span className="apx-th-body"><i /><i /></span></>,
}

const PREVIEW_NAMES = ['Esther Kere', 'Tony Kim', 'Gary Mittelberg', 'Karen Mills', 'Krystal Rodriguez']

// A miniature of Contacts in the chosen style: the address book in Classic, the three
// columns in Modern, with the flag drawn the way that style draws it.
function ContactsPreview({ style }) {
  return (
    <div className={`apx-pv apx-pv-${style}`} role="img"
      aria-label={style === 'modern'
        ? 'Preview: Contacts as plain panels, with a Flagged tag beside the open contact'
        : 'Preview: Contacts as a leather address book, with a ribbon marking the open contact'}>
      <i className="apx-pv-ribbon" />
      <div className="apx-pv-sheet">
        <div className="apx-pv-bar">Contacts</div>
        <div className="apx-pv-list">
          {PREVIEW_NAMES.map((n, i) => (
            <div key={n} className={`apx-pv-ent${i === 2 ? ' apx-pv-on' : ''}`}><i />{n}</div>
          ))}
        </div>
        <div className="apx-pv-rec">
          <div className="apx-pv-name">Gary Mittelberg<span className="apx-pv-flag">Flagged</span></div>
          <span className="apx-pv-badge">Assistant Professor</span>
          <i className="apx-pv-ln" /><i className="apx-pv-ln apx-pv-s" /><i className="apx-pv-ln" /><i className="apx-pv-ln apx-pv-s" />
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings({ style, colorMode, systemTheme, synced, onStyle, onColorMode }) {
  const uid = useId()
  const ids = {
    styleH: `${uid}-style-h`, styleD: `${uid}-style-d`,
    modeH: `${uid}-mode-h`, modeD: `${uid}-mode-d`,
    style: `${uid}-style`, mode: `${uid}-mode`,
  }
  return (
    <>
    {/* SETTINGS-BAND-1: the page's header band, outside the section's grid so the grid's
        gap cannot add to the band's own spacing. The intro is its one subtitle line. */}
    <SettingsPageHeader
      id={`${uid}-title`}
      title="Appearance"
      subtitle="How ASPIRE Intelligence looks for you. Your choices follow you to any device."
    />
    <section className="apx" aria-labelledby={`${uid}-title`}>

      <SurfaceCard className="apx-group" padding="18px 20px" role="radiogroup" aria-labelledby={ids.styleH} aria-describedby={ids.styleD}>
        <div className="apx-ghead">
          <div>
            <h3 id={ids.styleH}>Style</h3>
            <p id={ids.styleD}>
              Classic gives each workspace its own material: the placement board, the chart binder, the
              address book. Modern keeps every screen and every feature, with the materials turned off.
            </p>
          </div>
        </div>
        <div className="apx-cards apx-cards-2">
          {STYLE_OPTIONS.map(o => (
            <RadioCard key={o.value} name={ids.style} {...o} checked={style === o.value}
              onChoose={onStyle} thumb={THUMBS[o.value]} />
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard className="apx-group" padding="18px 20px" role="radiogroup" aria-labelledby={ids.modeH} aria-describedby={ids.modeD}>
        <div className="apx-ghead">
          <div>
            <h3 id={ids.modeH}>Color Mode</h3>
            <p id={ids.modeD}>Light or dark, for either style. System follows your computer and switches at sunset if it does.</p>
          </div>
          <span className="apx-now" data-testid="system-status">{systemStatusLine(systemTheme === 'dark')}</span>
        </div>
        <div className="apx-cards apx-cards-3">
          {MODE_OPTIONS.map(o => (
            <RadioCard key={o.value} name={ids.mode} {...o} checked={colorMode === o.value}
              onChoose={onColorMode} thumb={THUMBS[o.value]} />
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard className="apx-group" padding="18px 20px">
        <div className="apx-ghead">
          <div>
            <h3>Preview</h3>
            <p>Contacts in whichever style and mode you pick.</p>
          </div>
        </div>
        <div className="apx-previewwrap">
          <ContactsPreview style={style} />
          <div className="apx-pvnote">
            <b>What Modern changes</b>
            <ul>
              <li>Leather, felt, cork and brass become plain surfaces</li>
              <li>Paper grain, gilt edges and page stacks are removed</li>
              <li>Rings, pins and clips are hidden</li>
              <li>The ribbon becomes a Flagged tag</li>
            </ul>
            <b>What stays the same</b>
            <ul>
              <li>Every layout, button and shortcut</li>
              <li>Your data, flags and filters</li>
            </ul>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="apx-group" padding="18px 20px">
        <div className="apx-ghead">
          <div>
            <h3>Where Style Applies</h3>
            <p>
              Every crafted workspace switches together, and screens that are already flat look the same in
              both. A screen marked Coming keeps its material in both styles until its Modern version ships.
            </p>
          </div>
        </div>
        <ul className="apx-applies">
          {STYLE_SURFACES.map(s => (
            <li key={s.key} className="apx-ap">
              <span className={`apx-sw apx-sw-${s.key}`} aria-hidden="true" />
              <span className="apx-ap-text">{s.label}<small>{s.material}</small></span>
              {!s.modern && <span className="apx-coming">Coming</span>}
            </li>
          ))}
        </ul>
        <p className="apx-note">
          Contacts no longer has a layout setting of its own: Classic shows the address book, and Modern shows
          the three-column view.
        </p>
      </SurfaceCard>

      {synced === false && (
        <p className="apx-note apx-foot">For now your choices are saved in this browser only.</p>
      )}
    </section>
    </>
  )
}

export default function AppearancePanel() {
  const { style, colorMode, systemTheme, synced, setStyle, setColorMode } = useAppearance()
  const { toasts, removeToast, toast } = useToast()

  const onStyle = async (next) => {
    const r = await setStyle(next)
    if (r.ok) toast.success(styleToast(next), undefined, { duration: 2200 })
    else toast.error('Style not saved', 'Your earlier choice is back. Please try again.')
  }
  const onColorMode = async (next) => {
    const r = await setColorMode(next)
    if (r.ok) toast.success(colorModeToast(next), undefined, { duration: 2200 })
    else toast.error('Color mode not saved', 'Your earlier choice is back. Please try again.')
  }

  return (
    <>
      <AppearanceSettings
        style={style}
        colorMode={colorMode}
        systemTheme={systemTheme}
        synced={synced}
        onStyle={onStyle}
        onColorMode={onColorMode}
      />
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </>
  )
}
