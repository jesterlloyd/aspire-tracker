const F = 'DM Sans, sans-serif'

export default function BroadcastsView() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '64px 24px', textAlign: 'center', fontFamily: F,
    }}>
      <div style={{
        fontSize: 17, fontWeight: 600,
        color: 'var(--color-accent-primary,#1D2567)', marginBottom: 10,
      }}>
        Broadcasts
      </div>
      <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 380, lineHeight: 1.6 }}>
        Cohort-wide announcements and evaluation pushes. Available in a future release.
      </div>
    </div>
  )
}
