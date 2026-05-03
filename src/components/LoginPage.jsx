import { useState } from 'react'

const PASSWORD = 'aspire2026'

export default function LoginPage({ onSuccess }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = e => {
    e.preventDefault()
    if (value === PASSWORD) {
      sessionStorage.setItem('aspire_auth', '1')
      onSuccess()
    } else {
      setError(true)
      setValue('')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="login-logo" />
        <h1 className="login-title">ASPIRE Program Tracker</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">Enter access code</label>
            <input
              type="password"
              className={`login-input${error ? ' login-input-error' : ''}`}
              value={value}
              onChange={e => { setValue(e.target.value); setError(false) }}
              autoFocus
              placeholder="••••••••••"
              autoComplete="current-password"
            />
            {error && (
              <p className="login-error">Incorrect access code. Please try again.</p>
            )}
          </div>
          <button type="submit" className="login-btn">Sign In</button>
        </form>
      </div>
    </div>
  )
}
