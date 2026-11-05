// src/pages/ProgramNewsPage.jsx
//
// STUDIO-2 (Owner, 2026-11-05): where a Studio email's Unsubscribe link lands (/news#t=...). One
// switch, program news, on or off. The token travels in the fragment and is moved out of the
// address bar on arrival; the page shows only a masked address. It asks before turning news off
// rather than doing it on arrival, because mail security scanners open links on a person's behalf.
// Light-locked and built from the Forms page's sheet (formRespond.css), like every no-account page.

import { useEffect, useState } from 'react'
import PublicBrand from '../components/shared/PublicBrand'
import '../components/forms/formRespond.css'

const PATTERN = /^[0-9a-f-]{36}\.\d{1,5}\.[A-Za-z0-9_-]{32}$/i
const KEY = 'aspire-news-token'

function readToken() {
  const m = /^#t=(.+)$/.exec(window.location.hash)
  if (m && PATTERN.test(m[1])) {
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* old browser */ }
    try { sessionStorage.setItem(KEY, m[1]) } catch { /* private mode */ }
    return m[1]
  }
  try { const t = sessionStorage.getItem(KEY); return PATTERN.test(t || '') ? t : null } catch { return null }
}

async function call(token, action) {
  const res = await fetch('/api/program-news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'That did not work. Try again in a moment.')
  return json
}

export default function ProgramNewsPage() {
  const [token] = useState(readToken)
  const [state, setState] = useState(null)       // { email, optedOut }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (!token) return
    call(token, 'status').then(setState).catch(e => setError(e.message))
  }, [token])

  const flip = async (off) => {
    setBusy(true); setError(null)
    try { setState(await call(token, off ? 'unsubscribe' : 'resubscribe')); setChanged(true) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  let body
  if (!token) {
    body = <Note title="Program news from ASPIRE">To turn program news off, use the Unsubscribe link at the bottom of an ASPIRE email.</Note>
  } else if (!state) {
    body = error ? <Note title="This link does not work">{error}</Note> : <Note title="One moment" />
  } else if (state.optedOut) {
    body = (
      <div className="frm-done">
        {changed && <div className="frm-tick" aria-hidden="true">✓</div>}
        <h1>Program news is off</h1>
        <p>{state.email} will not get ASPIRE newsletters and announcements. Emails about your own forms, interviews and placement still arrive.</p>
        <div className="frm-copy"><button type="button" className="frm-btn" disabled={busy} onClick={() => flip(false)}>Turn program news back on</button></div>
        {error && <p className="frm-copy-note" role="alert">{error}</p>}
      </div>
    )
  } else {
    body = (
      <div className="frm-done">
        {changed && <div className="frm-tick" aria-hidden="true">✓</div>}
        <h1>{changed ? 'Program news is on' : 'Stop program news?'}</h1>
        <p>{changed
          ? `${state.email} will get ASPIRE newsletters and announcements again.`
          : `${state.email} gets ASPIRE newsletters and announcements. Emails about your own forms, interviews and placement are not affected.`}</p>
        {!changed && <div className="frm-copy"><button type="button" className="frm-btn frm-pri" disabled={busy} onClick={() => flip(true)}>Turn off program news</button></div>}
        {error && <p className="frm-copy-note" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="frm">
      <PublicBrand className="frm-brand" />
      <main className="frm-main" aria-live="polite">{body}</main>
    </div>
  )
}

function Note({ title, children }) {
  return <div className="frm-done"><h1>{title}</h1>{children && <p>{children}</p>}</div>
}
