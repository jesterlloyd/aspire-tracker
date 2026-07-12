// PHASE2-PORTAL: shared portal frame (header, identity, sign out).
// Deliberately minimal: portals are focused, read-mostly surfaces. The staff
// app shell (tabs, Action Center, Keith) is never loaded in this chunk.

import { useAuth } from '../contexts/AuthContext'

export default function PortalShell({ title, userName, children }) {
  const { signOut } = useAuth()
  return (
    <div className="ptl-page">
      <header className="ptl-header">
        <div className="ptl-header-brand">
          <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="30" />
          <div className="ptl-header-title">
            <span className="ptl-header-aspire">ASPIRE</span>
            <span className="ptl-header-sub">{title}</span>
          </div>
        </div>
        <div className="ptl-header-user">
          {userName ? <span className="ptl-header-name">{userName}</span> : null}
          <a className="ptl-header-link" href="/">Public site</a>
          <button className="ptl-btn-outline ptl-btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="ptl-main">{children}</main>
      <footer className="ptl-footer">
        ASPIRE, Geri and Richard Brawerman Nursing Institute, Cedars-Sinai
      </footer>
    </div>
  )
}
