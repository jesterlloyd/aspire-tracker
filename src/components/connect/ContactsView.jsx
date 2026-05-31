const F = 'DM Sans, sans-serif'

export default function ContactsView() {
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
        Contacts
      </div>
      <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 380, lineHeight: 1.6 }}>
        School coordinators, unit leaders, and program contacts. Available in a future release.
      </div>
    </div>
  )
}
