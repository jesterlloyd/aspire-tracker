// SETTINGS-UNIFIED-DESIGN-1: Settings -> General is now the subsettings HUB for
// Appearance, Email Signature, and Tours & Help - three sections that left the rail
// (see settingsSections.js `inRail: false`) and moved here as an iPhone-Settings-style
// grouped list. Their routes (/settings/appearance, /settings/signature, /settings/tours)
// are unchanged and still deep-linkable; SettingsShell resolves them to this component
// with a `subKey` prop telling it which nested panel to show, plus a back affordance to
// return to the hub. AppearancePanel, SignaturePanel, and ToursHelpPanel are rendered
// unmodified - no behavior, persistence, or props beyond what they already accepted.
//
// The former About content (build/deployment metadata) has moved OUT of General into
// its own AboutPanel.jsx / rail destination; this file no longer imports buildInfo or
// renders any About UI.
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronLeft, Monitor, PenLine, Info } from 'lucide-react'
import AppearancePanel from './AppearancePanel'
import SignaturePanel from './SignaturePanel'
import ToursHelpPanel from './ToursHelpPanel'
import SurfaceCard from '../ui/SurfaceCard'

// Grouped subsettings list, iPhone Settings-style. Icons match the ones the rail used for
// these sections before SETTINGS-UNIFIED-DESIGN-1 (Monitor/PenLine/Info).
const GROUPS = [
  {
    title: 'Preferences',
    rows: [
      { key: 'appearance', path: '/settings/appearance', icon: Monitor, label: 'Appearance', description: 'Theme for this device' },
      { key: 'signature',  path: '/settings/signature',  icon: PenLine, label: 'Email Signature', description: 'Your Connect signature' },
    ],
  },
  {
    title: 'Support',
    rows: [
      { key: 'tours', path: '/settings/tours', icon: Info, label: 'Tours & Help', description: 'Replay the welcome tour and find help' },
    ],
  },
]

const eyebrowStyle = {
  margin: '0 0 6px', padding: '0 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
  textTransform: 'uppercase', color: 'var(--color-text-secondary, #9ca3af)', fontFamily: 'DM Sans, sans-serif',
}

function SubsettingsList() {
  const navigate = useNavigate()

  return (
    <div>
      {GROUPS.map((group, gi) => (
        <div key={group.title} style={{ marginTop: gi === 0 ? 0 : 22 }}>
          <div style={eyebrowStyle}>{group.title}</div>
          <SurfaceCard radius={12} padding={0}>
            {group.rows.map((row, ri) => {
              const Icon = row.icon
              return (
                <button
                  key={row.key}
                  type="button"
                  aria-label={`${row.label}: ${row.description}`}
                  onClick={() => navigate(row.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                    padding: '13px 16px', border: 'none', cursor: 'pointer', background: 'transparent',
                    borderTop: ri === 0 ? 'none' : '1px solid var(--color-border-subtle, #f3f4f6)',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  <Icon size={17} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--color-accent-primary, #1D2567)' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>
                      {row.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 1 }}>
                      {row.description}
                    </span>
                  </span>
                  <ChevronRight size={16} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--color-text-secondary, #9ca3af)' }} />
                </button>
              )
            })}
          </SurfaceCard>
        </div>
      ))}
    </div>
  )
}

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

export default function GeneralPanel({ subKey, onRestartTour }) {
  if (subKey === 'appearance') {
    return (
      <div>
        <BackToGeneral />
        <AppearancePanel />
      </div>
    )
  }
  if (subKey === 'signature') {
    return (
      <div>
        <BackToGeneral />
        <SignaturePanel />
      </div>
    )
  }
  if (subKey === 'tours') {
    return (
      <div>
        <BackToGeneral />
        <ToursHelpPanel onRestartTour={onRestartTour} />
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
        Preferences and support for your ASPIRE Intelligence workspace.
      </p>

      <SubsettingsList />
    </section>
  )
}
