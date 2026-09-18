// DEMO-MODE-1: Settings > Demo Mode.
//
// The whole user-facing surface of the feature is this one switch, which is the point.
// A presenter about to walk on stage should not have to configure anything.
//
// Owner only, and per user per device, for the same reason the masthead city is
// (sessionKeys.js): a shared workstation must not hand the next person a mode they did
// not choose. The rail entry is visible only to the Owner because demo mode changes
// what every screen in the app reports, and someone finding it by accident during real
// work would have a bad afternoon.
//
// The panel is deliberately talkative about what the boundary does NOT cover. A
// presenter needs to know which screens are safe before the room is full, not after.
import { useEffect, useState } from 'react'
import SurfaceCard from '../ui/SurfaceCard'
import Toggle from '../ui/Toggle'
import { useAuth } from '../../contexts/AuthContext'
import { isDemoMode, isDemoModeAvailable, setDemoMode, subscribeDemoMode } from '../../lib/demoMode'
import { DEMO_SCOPED_TABLES } from '../../lib/demoScope'
import { SETTINGS_HEADING_STYLE } from './settingsSections'

const TEXT_PRIMARY = 'var(--color-text-primary, #191919)'
const TEXT_SECONDARY = 'var(--color-text-secondary, #6b7280)'

function Line({ children }) {
  return (
    <li style={{ fontSize: 12.5, color: TEXT_SECONDARY, lineHeight: 1.6, marginBottom: 4 }}>
      {children}
    </li>
  )
}

export default function DemoModePanel() {
  const { user } = useAuth()
  const [on, setOn] = useState(isDemoMode)
  const available = isDemoModeAvailable()

  // The switch reflects the mode even when something else changed it (the reconcile on
  // sign-in, or a second tab), rather than holding its own disagreeing copy.
  useEffect(() => subscribeDemoMode(setOn), [])

  const handleChange = (next) => {
    if (!available) return
    setDemoMode(next, user?.id)
  }

  return (
    <section aria-label="Demo Mode">
      <h2 style={SETTINGS_HEADING_STYLE}>Demo Mode</h2>

      <SurfaceCard padding="16px 18px">
        <Toggle
          size="lg"
          checked={on}
          onChange={handleChange}
          disabled={!available}
          label="Demo mode"
          description={
            !available
              ? 'Not available yet. The database migration this depends on has not been applied.'
              : on
                ? 'On. Every screen is showing fabricated demo records. Nothing you do here touches real data.'
                : 'Off. The app is showing real students, schools, units and contacts.'
          }
        />
      </SurfaceCard>

      {/* The switch cannot be armed before the column it filters on exists, so the panel
          says what is missing rather than leaving a dead control with no explanation. */}
      {!available && (
        <SurfaceCard padding="16px 18px" style={{ marginTop: 'var(--aspire-gap-card, 16px)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 6 }}>
            Waiting on One Migration
          </div>
          <div style={{ fontSize: 12.5, color: TEXT_SECONDARY, lineHeight: 1.6 }}>
            Demo mode reads an <code>is_demo</code> marker that every record carries. Until
            <code> 20260921000000_demo_mode_foundation.sql</code> is applied and the boundary
            is switched on, the control above stays off. Everything below describes what it
            will do once it is running.
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard padding="16px 18px" style={{ marginTop: 'var(--aspire-gap-card, 16px)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 8 }}>
          What Demo Mode Changes
        </div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <Line>
            Every read is filtered to demo records, so no real name, email, school or
            unit appears on screen.
          </Line>
          <Line>
            Every write is filtered the same way. A change you make while presenting
            cannot reach a real record, even by accident.
          </Line>
          <Line>
            Email is held rather than sent. You can open and show a message without
            anyone receiving it.
          </Line>
          <Line>
            Scheduled jobs skip demo records entirely, and demo records never appear in
            a report or a count.
          </Line>
        </ul>
      </SurfaceCard>

      <SurfaceCard padding="16px 18px" style={{ marginTop: 'var(--aspire-gap-card, 16px)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 8 }}>
          Before You Present
        </div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <Line>
            The marker beside the ASPIRE wordmark is on screen whenever demo mode is
            running. If you do not see it, you are looking at real data.
          </Line>
          <Line>
            The boundary currently covers {DEMO_SCOPED_TABLES.length} record types.
            Settings, email templates and the knowledge library are workspace
            configuration and are shown as they really are in both modes.
          </Line>
          <Line>
            Demo mode is a presentation tool, not a privacy control. It decides what this
            app draws on screen. It is not a substitute for the access rules that protect
            the data itself.
          </Line>
        </ul>
      </SurfaceCard>
    </section>
  )
}
