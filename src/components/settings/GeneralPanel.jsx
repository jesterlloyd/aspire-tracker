// SETTINGS-UNIFIED-DESIGN-1C: Settings -> General is a responsive MASTER-DETAIL hub.
//
// Desktop (>768px): three panes across the Settings page - the primary rail (owned by
// SettingsShell), then this panel's MIDDLE pane (one flat, ALPHABETICAL subsettings
// list: About, Appearance, Email Signature, Tours & Help) and RIGHT pane (the selected
// subsetting's content). About is selected and shown automatically when General opens
// with no subKey; selecting a row navigates to its real route so the right pane updates
// while the rail keeps General highlighted. No grouped eyebrows and no Back affordance
// on desktop - the master list is always visible.
//
// Narrow (<=768px): the previous drill-down pattern - /settings/general shows the list;
// a selected subsetting shows its content with a Back-to-General affordance. Three
// columns are never squeezed side by side on a phone.
//
// The subsetting routes (/settings/about, /settings/appearance, /settings/signature,
// /settings/tours) are unchanged and deep-linkable; SettingsShell resolves them to this
// component via `subKey`, which selects the matching middle-pane row. AboutPanel,
// AppearancePanel, SignaturePanel, and ToursHelpPanel render unmodified.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronLeft, Monitor, PenLine, Info, BadgeInfo } from 'lucide-react'
import AppearancePanel from './AppearancePanel'
import SignaturePanel from './SignaturePanel'
import ToursHelpPanel from './ToursHelpPanel'
import AboutPanel from './AboutPanel'
import SurfaceCard from '../ui/SurfaceCard'

// One flat list, ALPHABETICAL by label: About, Appearance, Email Signature, Tours & Help.
// (No Preferences/Support/Information grouping - the master list is short enough to scan.)
const SUBSETTINGS = [
  { key: 'about',      path: '/settings/about',      icon: BadgeInfo, label: 'About',           description: 'Version, build, and deployment details' },
  { key: 'appearance', path: '/settings/appearance', icon: Monitor,   label: 'Appearance',      description: 'Theme for this device' },
  { key: 'signature',  path: '/settings/signature',  icon: PenLine,   label: 'Email Signature', description: 'Your Connect signature' },
  { key: 'tours',      path: '/settings/tours',      icon: Info,      label: 'Tours & Help',    description: 'Replay the welcome tour and find help' },
]

// Same breakpoint as the shell's rail-stacking rule, so the whole Settings page
// collapses coherently instead of pane by pane.
function useIsNarrow(bp = 768) {
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth <= bp : false)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth <= bp)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [bp])
  return narrow
}

function SubsettingsList({ activeKey }) {
  const navigate = useNavigate()
  return (
    <SurfaceCard as="nav" aria-label="General subsettings" radius={12} padding={0}>
      {SUBSETTINGS.map((row, ri) => {
        const Icon = row.icon
        const active = row.key === activeKey
        return (
          <button
            key={row.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={`${row.label}: ${row.description}`}
            onClick={() => navigate(row.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '13px 16px', border: 'none', cursor: 'pointer',
              background: active ? 'var(--color-accent-primary, #1D2567)' : 'transparent',
              borderTop: ri === 0 ? 'none' : '1px solid var(--color-border-subtle, #f3f4f6)',
              fontFamily: 'DM Sans, sans-serif',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-hover, #f1efe9)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
          >
            <Icon size={17} strokeWidth={2} style={{ flexShrink: 0, color: active ? '#ffffff' : 'var(--color-accent-primary, #1D2567)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: active ? '#ffffff' : 'var(--color-text-primary, #191919)' }}>
                {row.label}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: active ? 'rgba(255,255,255,0.75)' : 'var(--color-text-secondary, #6b7280)', marginTop: 1 }}>
                {row.description}
              </span>
            </span>
            <ChevronRight size={16} strokeWidth={2} style={{ flexShrink: 0, color: active ? 'rgba(255,255,255,0.8)' : 'var(--color-text-secondary, #9ca3af)' }} />
          </button>
        )
      })}
    </SurfaceCard>
  )
}

// Narrow-only: the drill-down back affordance. Desktop master-detail has no Back -
// the master list stays visible beside the content.
function BackToGeneral() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/settings/general')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16,
        padding: '4px 6px 4px 2px', border: 'none', background: 'transparent', cursor: 'pointer',
        fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 600,
        color: 'var(--color-accent-primary, #1D2567)',
      }}
    >
      <ChevronLeft size={16} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      General
    </button>
  )
}

function SubsettingContent({ subKey, onRestartTour }) {
  if (subKey === 'appearance') return <AppearancePanel />
  if (subKey === 'signature')  return <SignaturePanel />
  if (subKey === 'tours')      return <ToursHelpPanel onRestartTour={onRestartTour} />
  return <AboutPanel />
}

export default function GeneralPanel({ subKey, onRestartTour }) {
  const narrow = useIsNarrow()

  // Narrow drill-down: list-only at /settings/general; content + Back on a subsetting.
  if (narrow) {
    if (subKey) {
      return (
        <div>
          <BackToGeneral />
          <SubsettingContent subKey={subKey} onRestartTour={onRestartTour} />
        </div>
      )
    }
    return (
      <section aria-labelledby="settings-general-heading">
        <h2 id="settings-general-heading" style={{
          margin: '0 0 4px', fontSize: 17, fontWeight: 700,
          color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
        }}>
          General
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
          Preferences, support, and information for your ASPIRE Intelligence workspace.
        </p>
        <SubsettingsList activeKey={null} />
      </section>
    )
  }

  // Desktop master-detail: middle list + right content, side by side. With no subKey
  // (Settings/General just opened) About is selected and displayed automatically -
  // display-only default; the URL stays /settings/general until a row is chosen.
  const selectedKey = subKey || 'about'
  return (
    <section aria-labelledby="settings-general-heading">
      <h2 id="settings-general-heading" style={{
        margin: '0 0 4px', fontSize: 17, fontWeight: 700,
        color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
      }}>
        General
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        Preferences, support, and information for your ASPIRE Intelligence workspace.
      </p>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 256px', minWidth: 232 }}>
          <SubsettingsList activeKey={selectedKey} />
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <SubsettingContent subKey={selectedKey} onRestartTour={onRestartTour} />
        </div>
      </div>
    </section>
  )
}
