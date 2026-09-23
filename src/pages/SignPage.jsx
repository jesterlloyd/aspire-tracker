// src/pages/SignPage.jsx
//
// SIGNATURES-PHASE2: the public signing page, /sign#t=<token>. No account. The token rides
// in the fragment (never sent to a server or kept in a log) and is taken out of the address
// bar on load, like the other tokenized public pages. The session the code step issues is
// kept only in this page's memory: reloading means confirming the code again, on purpose.
import { useMemo, useRef, useState } from 'react'
import SignerFlow from '../components/signatures/SignerFlow'
import { LINK_TOKEN_PATTERN } from '../lib/signatures/linkToken'

function readToken() {
  const m = /^#t=([A-Za-z0-9_-]{43})$/.exec(window.location.hash)
  if (m) {
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* old browser */ }
    try { sessionStorage.setItem('aspire-sign-token', m[1]) } catch { /* private mode */ }
    return m[1]
  }
  try { const t = sessionStorage.getItem('aspire-sign-token'); return LINK_TOKEN_PATTERN.test(t || '') ? t : null } catch { return null }
}

const b64ToBlobUrl = (b64) => URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'application/pdf' }))

export default function SignPage() {
  const [token] = useState(readToken)
  const session = useRef(null)
  const api = useMemo(() => {
    const call = async (action, extra = {}) => {
      const res = await fetch('/api/sig-signer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, session: session.current, ...extra }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Something went wrong. Try again in a moment.')
      return json
    }
    return {
      state: () => call('state'),
      sendCode: () => call('send_code'),
      verify: async (code) => { const r = await call('verify_code', { code }); session.current = r.session },
      samplePdf: async () => { const r = await call('sample_pdf'); window.open(b64ToBlobUrl(r.pdf_base64), '_blank', 'noopener') },
      consent: () => call('consent', { opened_sample: true, agreed: true }),
      document: async (download = false) => (await call('document', { download })).url,
      open: () => call('open'),
      finish: (values, adopted) => call('finish', { values, adopted }),
      decline: (reason) => call('decline', { reason }),
      delegate: (d) => call('delegate', d),
      paperCopy: () => call('paper_copy'),
      copy: async () => { const r = await call('copy'); return r.url || (r.pdf_base64 ? b64ToBlobUrl(r.pdf_base64) : null) },
    }
  }, [token])

  if (!token) {
    return (
      <div className="sgn"><main className="sgn-body"><div className="sgn-card">
        <h2>This link is not complete</h2>
        <p>Open the most recent email about this document and use its Review document button.</p>
      </div></main></div>
    )
  }
  return <SignerFlow api={api} />
}
