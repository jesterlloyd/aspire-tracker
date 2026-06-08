// EmailEntryView.jsx — initial school-email entry for the shift-log lifecycle.
import { useState } from 'react'

const F = 'DM Sans, sans-serif'
const JESTER = 'JesterLloyd.Bautista@cshs.org'

const INPUT = {
  width: '100%', minHeight: 52, fontSize: 16, padding: '0 14px', borderRadius: 12,
  border: '1px solid #e5e7eb', fontFamily: F, outline: 'none', boxSizing: 'border-box', display: 'block',
}
const BTN_PRIMARY = {
  width: '100%', minHeight: 52, fontSize: 16, fontWeight: 700, fontFamily: F,
  background: 'var(--nightfall, #1D2567)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
}

export default function EmailEntryView({ email, setEmail, onSubmit, loading }) {
  const [touched, setTouched] = useState(false)
  const trimmed = (email || '').trim()
  const looksValid = trimmed.includes('@') && trimmed.includes('.')

  const handleSubmit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (!trimmed || !looksValid) return
    onSubmit(trimmed)
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '28px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--nightfall,#1D2567)', textAlign: 'center', margin: '0 0 8px', fontFamily: F }}>
        ASPIRE Shift Log
      </h1>
      <p style={{ fontSize: 15, color: '#6b7280', textAlign: 'center', margin: '0 0 24px', lineHeight: 1.6, fontFamily: F }}>
        Enter your school email to check in, check out, or log a past shift.
      </p>

      {touched && trimmed && !looksValid && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 14px', fontSize: 14, color: '#991b1b', marginBottom: 16, fontFamily: F }}>
          Please enter a valid email address.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <input
          style={INPUT}
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="School email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your.name@school.edu"
        />
        <div style={{ marginTop: 12 }}>
          <button style={{ ...BTN_PRIMARY, opacity: (loading || !trimmed) ? 0.6 : 1 }} type="submit" disabled={loading || !trimmed}>
            {loading ? 'Looking up…' : 'Continue →'}
          </button>
        </div>
      </form>

      <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', margin: '20px 0 0', lineHeight: 1.6, fontFamily: F }}>
        Trouble signing in? Email{' '}
        <a href={`mailto:${JESTER}`} style={{ color: 'var(--nightfall,#1D2567)' }}>{JESTER}</a>.
      </p>
    </div>
  )
}
