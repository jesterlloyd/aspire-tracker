// src/portal/PortalTermsGate.jsx
//
// PORTAL-TERMS-1: the Terms of Use and Confidentiality Agreement, shown after sign-in and before
// any portal renders. One text for every portal (src/lib/portalTerms.js). Accept is enabled only
// once the box is ticked; Decline signs the person out, and the next sign-in asks again.
//
// A page that stands on its own, so it carries one title at --aspire-page-title-size
// (PAGE-TITLE-1). The card is a .ptl-card; nothing here restates a radius or a gap.

import { useId, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  PORTAL_TERMS_AGREE_LABEL, PORTAL_TERMS_INTRO, PORTAL_TERMS_SECTIONS, PORTAL_TERMS_TITLE, PORTAL_TERMS_VERSION,
} from '../lib/portalTerms'

function versionLabel(v) {
  const d = new Date(`${v}T12:00:00`)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function PortalTermsGate({ onAccept, saving, error }) {
  const { signOut } = useAuth()
  const [agreed, setAgreed] = useState(false)
  const boxId = useId()
  const titleId = useId()
  return (
    <div className="ptl-page ptl-terms-page">
      <main className="ptl-card ptl-terms-card" aria-labelledby={titleId}>
        <h1 id={titleId} className="ptl-terms-title">{PORTAL_TERMS_TITLE}</h1>
        <p className="ptl-terms-meta">ASPIRE Portal · Effective {versionLabel(PORTAL_TERMS_VERSION)}</p>
        <div className="ptl-terms-scroll" tabIndex={0} aria-label="Agreement text">
          <p className="ptl-terms-p">{PORTAL_TERMS_INTRO}</p>
          {PORTAL_TERMS_SECTIONS.map(s => (
            <section key={s.heading} className="ptl-terms-section">
              <h2 className="ptl-terms-h2">{s.heading}</h2>
              {s.body.map((p, i) => <p key={i} className="ptl-terms-p">{p}</p>)}
            </section>
          ))}
        </div>
        <label className="ptl-terms-agree" htmlFor={boxId}>
          <input id={boxId} type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span>{PORTAL_TERMS_AGREE_LABEL}</span>
        </label>
        {error && <p className="ptl-terms-error" role="alert">{error}</p>}
        <div className="ptl-terms-actions">
          <button type="button" className="ptl-btn-outline" onClick={signOut} disabled={saving}>Decline and Sign Out</button>
          <button type="button" className="ptl-btn ptl-terms-accept" onClick={onAccept} disabled={!agreed || saving}>
            {saving ? 'Saving…' : 'Accept and Continue'}
          </button>
        </div>
      </main>
    </div>
  )
}
