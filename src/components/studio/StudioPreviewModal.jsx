// src/components/studio/StudioPreviewModal.jsx
//
// STUDIO-1: "Preview as sent". The SERVER renders the design exactly as the send will (your
// resolved signature, the organization's logo, form buttons with the bare form address) for you as
// the sample recipient. Nothing is sent, logged or archived: it is the bulk endpoint's preview mode.

import { useEffect, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import { studioSend } from '../../lib/studio/studioClient'
import { useAuth } from '../../contexts/AuthContext'

export default function StudioPreviewModal({ design, onClose }) {
  const { userProfile } = useAuth()
  const [state, setState] = useState({ html: '', error: '', loading: true })
  const [width, setWidth] = useState(640)

  useEffect(() => {
    let off = false
    const email = String(userProfile?.email || '').trim()
    const first = String(userProfile?.full_name || '').trim().split(/\s+/)[0] || ''
    studioSend({ preview: true, subject: design.subject, body: JSON.stringify(design), recipient: { source: 'manual', email, firstName: first, name: userProfile?.full_name || '' } })
      .then(r => { if (!off) setState({ html: r.html, error: '', loading: false }) })
      .catch(e => { if (!off) setState({ html: '', error: e.message, loading: false }) })
    return () => { off = true }
  }, [design, userProfile])

  return (
    <DetailDrawer open title="Preview as Sent" onClose={onClose} width={760} trapFocus>
      <div className="st-scope">
        <div className="st-row-between" style={{ marginBottom: 12 }}>
          <p className="st-sub" style={{ margin: 0 }}>Drawn by the server, with you as the recipient. {design.subject ? `Subject: ${design.subject}` : 'No subject yet.'}</p>
          <div className="st-seg" role="group" aria-label="Preview width">
            <button type="button" aria-pressed={width === 640} onClick={() => setWidth(640)}>Desktop</button>
            <button type="button" aria-pressed={width === 375} onClick={() => setWidth(375)}>Phone</button>
          </div>
        </div>
        {state.loading && <p className="st-sub">Rendering…</p>}
        {state.error && <p className="st-notice st-notice-bad">{state.error}</p>}
        {state.html && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <iframe title="Email preview" className="st-preview-frame" style={{ width, maxWidth: '100%' }} srcDoc={state.html} sandbox="" />
          </div>
        )}
      </div>
    </DetailDrawer>
  )
}
