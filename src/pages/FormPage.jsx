// src/pages/FormPage.jsx
//
// FORMS-PHASE3: the public form page, /form#t=<token>. No account: the personal link is
// the identity check (Owner, 2026-09-23). The token rides in the fragment (never sent to a
// server log) and is taken out of the address bar on load. A half-filled form is kept in
// this browser only, keyed to the link, so closing the tab does not lose the answers.
import { useEffect, useMemo, useState } from 'react'
import FormRenderer from '../components/forms/FormRenderer'
import '../components/forms/formRespond.css'

const PATTERN = /^[A-Za-z0-9_-]{43}$/
function readToken() {
  const m = /^#t=([A-Za-z0-9_-]{43})$/.exec(window.location.hash)
  if (m) {
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* old browser */ }
    try { sessionStorage.setItem('aspire-form-token', m[1]) } catch { /* private mode */ }
    return m[1]
  }
  try { const t = sessionStorage.getItem('aspire-form-token'); return PATTERN.test(t || '') ? t : null } catch { return null }
}

async function call(token, action, extra = {}) {
  const res = await fetch('/api/form-respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, ...extra }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Try again in a moment.')
  return json
}

export default function FormPage() {
  const [token] = useState(readToken)
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)   // { submittedAt, pdf }

  useEffect(() => {
    if (!token) return
    call(token, 'state').then(setState).catch(e => setError(e.message))
  }, [token])

  const upload = async (file) => {
    const slot = await call(token, 'upload', { name: file.name, size: file.size })
    const { supabase } = await import('../lib/supabase')
    const up = await supabase.storage.from('form-files').uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type || 'application/octet-stream' })
    if (up.error) throw new Error(`Upload failed: ${up.error.message}`)
    return { path: slot.path, name: slot.name, size: file.size }
  }
  const submit = async (answers) => setDone(await call(token, 'submit', { answers }))
  const copyUrl = useMemo(() => done?.pdf ? URL.createObjectURL(new Blob([Uint8Array.from(atob(done.pdf), c => c.charCodeAt(0))], { type: 'application/pdf' })) : null, [done])

  let body
  if (!token) body = <Note title="This link is not complete">Open the most recent email about this form and use its Open the form button.</Note>
  else if (error) body = <Note title="This form cannot be opened">{error}</Note>
  else if (!state) body = <Note title="Loading the form…" />
  else if (done || state.state === 'done') {
    body = (
      <div className="frm-done" role="status">
        <span className="frm-tick" aria-hidden="true">✓</span>
        <h1>Thank you. Your answers are in.</h1>
        <p>{state.title || state.definition?.title} was submitted{(done?.submittedAt || state.submittedAt) ? ` on ${new Date(done?.submittedAt || state.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. You can close this page.</p>
        {copyUrl && <a className="frm-btn" href={copyUrl} target="_blank" rel="noopener">Open your copy (PDF)</a>}
      </div>
    )
  } else if (state.state === 'closed') body = <Note title={`${state.title} is closed`}>{state.message}</Note>
  else {
    body = <FormRenderer definition={state.definition} prefill={state.prefill} onSubmit={submit} onUpload={upload}
      draftKey={`aspire-form-draft:${token.slice(0, 16)}`} dueAt={state.dueAt} sender={state.sender} />
  }

  return (
    <div className="frm">
      <div className="frm-brand"><i aria-hidden="true">A</i>ASPIRE Intelligence</div>
      <main className="frm-main">{body}</main>
    </div>
  )
}

function Note({ title, children }) {
  return <div className="frm-done"><h1>{title}</h1>{children && <p>{children}</p>}</div>
}
