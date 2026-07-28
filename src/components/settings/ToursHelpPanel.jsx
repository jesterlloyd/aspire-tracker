// WS2.3: Settings → Tours & Help panel. Visible to all authenticated users.
//
// Welcome Tour: reuses the EXISTING restart behavior (onRestartTour, threaded from
// App.jsx - the same closure the UserMenu entry used before WS2.4 removed it: switch
// to the At a Glance/overview workspace, then start CustomOnboardingTour). This panel
// adds NO new tour persistence/completion/version/role/target logic.
//
// Help: purely informational pointers to the existing floating Keith assistant and the
// existing Feedback button. No new feedback/help/ticketing system, no API or Supabase
// write. Visual structure mirrors GeneralPanel / AccountsAccessPanel (card on surface).
import { RotateCcw, Sparkles, MessageSquare } from 'lucide-react'

const cardStyle = {
  border: '1px solid var(--color-border-default, #e5e7eb)',
  borderRadius: 12,
  background: 'var(--color-bg-surface, #ffffff)',
}

export default function ToursHelpPanel({ onRestartTour }) {
  return (
    <section aria-labelledby="settings-tours-heading">
      <h2 id="settings-tours-heading" style={{
        margin: '0 0 4px', fontSize: 17, fontWeight: 700,
        color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
      }}>
        Tours & Help
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>
        Replay the guided tour or find your way to in-app help.
      </p>

      {/* Welcome Tour */}
      <div style={{
        ...cardStyle, padding: '16px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Welcome Tour</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }}>
            {/* WELCOME-TOUR-PORTALS-1: "Aggregate" renamed to "At a Glance" (ASPIRE-MASTHEAD) - stale copy corrected. */}
            Replay the guided walkthrough of the areas you use most. It opens on the At a Glance dashboard.
          </div>
        </div>
        <button
          type="button"
          onClick={onRestartTour}
          disabled={!onRestartTour}
          style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '9px 16px', borderRadius: 9,
            background: 'var(--color-accent-primary, #1D2567)', color: '#ffffff',
            border: 'none', cursor: onRestartTour ? 'pointer' : 'not-allowed',
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 600,
            opacity: onRestartTour ? 1 : 0.6, transition: 'opacity 0.15s, filter 0.15s',
          }}
          onMouseEnter={e => { if (onRestartTour) e.currentTarget.style.filter = 'brightness(1.12)' }}
          onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
        >
          <RotateCcw size={14} strokeWidth={2.2} />
          Restart Welcome Tour
        </button>
      </div>

      {/* Help */}
      <div style={{ ...cardStyle, padding: '16px 18px', marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #191919)', marginBottom: 12 }}>Help</div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Sparkles size={16} strokeWidth={2} color="var(--color-accent-primary, #1D2567)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.45 }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Ask Keith.</span>{' '}
            Your AI assistant floats in the bottom-right corner of every screen, open it for help with workflows, features, or who handles what.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12 }}>
          <MessageSquare size={16} strokeWidth={2} color="var(--color-accent-primary, #1D2567)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', lineHeight: 1.45 }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Share feedback.</span>{' '}
            Found a bug or have a suggestion? Use the Feedback button to send it directly to the program leads.
          </div>
        </div>
      </div>
    </section>
  )
}
