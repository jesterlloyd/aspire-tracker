// src/pages/FormPage.jsx
//
// FORMS-PHASE3: the public form page, /form#t=<token>. No account: the personal link is
// the identity check (Owner, 2026-09-23). The token rides in the fragment (never sent to a
// server log) and is taken out of the address bar on load. A half-filled form is kept in
// this browser only, keyed to the link, so closing the tab does not lose the answers.
import { useEffect, useMemo, useState } from 'react'
import FormRenderer from '../components/forms/FormRenderer'
import PublicBrand from '../components/shared/PublicBrand'
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
  const title = state?.title || state?.definition?.title || 'Form'
  // OUTREACH-FORM-BUTTON-1: the filed copy is the one just returned, or, when the link is opened
  // again later, fetched on demand from the same link.
  const [fetched, setFetched] = useState(null)   // { pdf, fileName }
  const [copyError, setCopyError] = useState(null)
  const pdf = done?.pdf || fetched?.pdf || null
  const copyUrl = useMemo(() => pdf ? URL.createObjectURL(new Blob([Uint8Array.from(atob(pdf), c => c.charCodeAt(0))], { type: 'application/pdf' })) : null, [pdf])
  const fileName = fetched?.fileName || `${title.replace(/[^\w .-]+/g, '').slice(0, 80) || 'Form'}.pdf`
  const canCopy = !!(done?.pdf || state?.copy)
  const ensureCopy = async () => {
    if (copyUrl) return copyUrl
    setCopyError(null)
    try {
      const r = await call(token, 'copy')
      setFetched(r)
      return URL.createObjectURL(new Blob([Uint8Array.from(atob(r.pdf), c => c.charCodeAt(0))], { type: 'application/pdf' }))
    } catch (e) { setCopyError(e.message); return null }
  }
  const download = async () => {
    const url = await ensureCopy()
    if (!url) return
    const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
  }
  // Print from a hidden frame where the browser allows it; a phone opens the PDF instead, and
  // its own share sheet prints it.
  const print = async () => {
    const url = await ensureCopy()
    if (!url) return
    if (window.matchMedia?.('(pointer: coarse)').matches) { window.open(url, '_blank', 'noopener'); return }
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    frame.src = url
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print() } catch { window.open(url, '_blank', 'noopener') }
      setTimeout(() => frame.remove(), 60000)
    }
    document.body.appendChild(frame)
  }

  let body
  if (!token) body = <Note title="This link is not complete">Open the most recent email about this form and use its Open the form button.</Note>
  else if (error) body = <Note title="This form cannot be opened">{error}</Note>
  else if (!state) body = <Note title="Loading the form…" />
  else if (done || state.state === 'done') {
    body = (
      <div className="frm-done" role="status">
        <span className="frm-tick" aria-hidden="true">✓</span>
        <h1>Thank you. Your answers are in.</h1>
        <p>{state.title || state.definition?.title} was submitted{(done?.submittedAt || state.submittedAt) ? ` on ${new Date(done?.submittedAt || state.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. </p>
        {canCopy && (
          <div className="frm-copy">
            <button type="button" className="frm-btn frm-pri" onClick={download}>Download your copy</button>
            <button type="button" className="frm-btn" onClick={print}>Print</button>
          </div>
        )}
        {canCopy && <p className="frm-copy-note">Open this link again any time to get your copy.</p>}
        {copyError && <p className="frm-copy-note" role="alert">{copyError}</p>}
      </div>
    )
  } else if (state.state === 'closed') body = <Note title={`${state.title} is closed`}>{state.message}</Note>
  else {
    body = <FormRenderer definition={state.definition} prefill={state.prefill} onSubmit={submit} onUpload={upload}
      draftKey={`aspire-form-draft:${token.slice(0, 16)}`} dueAt={state.dueAt} sender={state.sender} />
  }

  return (
    <div className="frm">
      <PublicBrand className="frm-brand" />
      <main className="frm-main">{body}</main>
    </div>
  )
}

function Note({ title, children }) {
  return <div className="frm-done"><h1>{title}</h1>{children && <p>{children}</p>}</div>
}
