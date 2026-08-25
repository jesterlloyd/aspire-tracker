// PHASE2-PORTAL / ASPIRE-STUDENT-PORTAL: shared portal frame. Mobile-first,
// safe-area-aware header: a compact Cedars-Sinai + ASPIRE brand on the left and a
// single avatar / profile-menu button on the right. The full student name,
// Public site link, Edit Profile, and Sign out live inside the profile menu on
// mobile (the desktop header may surface a couple of them inline). Portals are
// focused, read-mostly surfaces; the staff shell is never loaded here.
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ExternalLink, Camera, UserRound, LogOut, RotateCcw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { PortalRefreshProvider } from './PortalRefresh'
import { PortalHeaderSlotsContext } from './PortalHeaderSlots'

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

function ProfileMenu({ userName, profileImageUrl, onEditProfile, onProfile, onChangePhoto, publicSiteUrl = '/', onRestartTour }) {
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [failedImageUrl, setFailedImageUrl] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const showPhoto = Boolean(profileImageUrl && failedImageUrl !== profileImageUrl)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    setTimeout(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus(), 10)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="ptl-menu-wrap">
      <button ref={btnRef} type="button" className="ptl-avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Open profile menu" data-tour="portal-profile-menu" onClick={() => setOpen(o => !o)}>
        <span className="ptl-avatar ptl-avatar-sm" aria-hidden="true">
          {showPhoto
            ? <img src={profileImageUrl} alt="" onError={() => setFailedImageUrl(profileImageUrl)} />
            : initials(userName)}
        </span>
        <ChevronDown size={15} className="ptl-avatar-caret" />
      </button>
      {open && (
        <div ref={menuRef} className="ptl-menu" role="menu" aria-label="Profile menu">
          {userName && <div className="ptl-menu-name">{userName}</div>}
          {onProfile
            ? <button role="menuitem" type="button" className="ptl-menu-item" onClick={() => { setOpen(false); onProfile() }}><UserRound size={15} /> Profile</button>
            : onEditProfile && <button role="menuitem" type="button" className="ptl-menu-item" onClick={() => { setOpen(false); onEditProfile() }}><UserRound size={15} /> My Profile</button>}
          {/* PROFILE-MENU-AVATARS-1: self-service photo management, wired per portal.
              The label "My Profile" above (student) matches the destination page and
              nav-tab name; the former "Edit Profile" wording predated the My Profile
              page. */}
          {onChangePhoto && (
            <button role="menuitem" type="button" className="ptl-menu-item" onClick={() => { setOpen(false); onChangePhoto() }}><Camera size={15} /> Change Photo</button>
          )}
          <a role="menuitem" className="ptl-menu-item" href={publicSiteUrl}
             {...(publicSiteUrl !== '/' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            <ExternalLink size={15} /> Public site
          </a>
          {/* WELCOME-TOUR-PORTALS-1: only rendered when the caller wires a restart handler, so
              a portal that has not adopted the tour yet keeps its existing menu unchanged. */}
          {onRestartTour && (
            <button role="menuitem" type="button" className="ptl-menu-item" onClick={() => { setOpen(false); onRestartTour() }}><RotateCcw size={15} /> Restart Welcome Tour</button>
          )}
          <button role="menuitem" type="button" className="ptl-menu-item ptl-menu-danger" onClick={() => { setOpen(false); signOut() }}><LogOut size={15} /> Sign out</button>
        </div>
      )}
    </div>
  )
}

export default function PortalShell({
  title,
  userName,
  onEditProfile,
  onProfile,
  onChangePhoto,
  publicSiteUrl,
  withTabBar = false,
  showHeaderName = false,
  headerVariant = 'light',
  logoSrc = '/Cedars-Sinai.png',
  profileImageUrl = null,
  nav = null,
  utilityLayer = null,
  onRestartTour,
  contentClassName = '',
  children,
}) {
  const nightfall = headerVariant === 'nightfall'
  const headerClass = `ptl-header${nightfall ? ' ptl-header-nightfall' : ''}`
  // The Nightfall header and the primary section nav form ONE sticky chrome block, mirroring the
  // main app's .top-section (which wraps .app-header + .chart-nav). The dark bar carries no shadow of
  // its own; the Nightfall shadow sits on this wrapper, beneath the combined header + nav, exactly
  // like the main app. On phones the nav is a fixed bottom bar, so the wrapper then holds only the
  // header (the nav positions itself away), and the shadow falls under the header.
  const chromeClass = `ptl-topsection${nightfall ? ' ptl-topsection-nightfall' : ''}`
  // Header slots filled by the active portal via createPortal: a scope line after the role subtitle,
  // and a right-aligned controls area (scope selectors / cohort picker) left of the profile menu.
  // Ref callbacks (not a setState-in-effect) publish the slot nodes to children through context.
  const [scopeSlot, setScopeSlot] = useState(null)
  const [controlsSlot, setControlsSlot] = useState(null)
  // The shared Refresh action lives in the nav row and re-fetches the active section's data. The
  // provider wraps both the nav (which renders the button) and the children (where each active
  // section registers its refetch), so any portal that passes a nav gets Refresh for free.
  return (
    <PortalRefreshProvider>
     <PortalHeaderSlotsContext.Provider value={{ scopeSlot, controlsSlot }}>
      <div className={`ptl-page${withTabBar ? ' ptl-page-tabbar' : ''}`}>
        <div className={chromeClass}>
          <header className={headerClass}>
            <div className="ptl-header-brand">
              <img src={logoSrc} alt="Cedars-Sinai" className="ptl-header-logo" />
              <span className="ptl-header-divider" aria-hidden="true" />
              <div className="ptl-header-title">
                <span className="ptl-header-aspire">ASPIRE</span>
                <span className="ptl-header-sub">{title}<span className="ptl-header-scope" ref={setScopeSlot} /></span>
              </div>
            </div>
            <div className="ptl-header-user">
              {/* WELCOME-TOUR-PORTALS-1: this span is the DOM wrapper every portal's school/cohort
                  scope selectors portal into (see PortalHeaderControls), so it is the outermost
                  wrapper for however many of those controls a given portal renders. */}
              <span className="ptl-header-controls" ref={setControlsSlot} data-tour="portal-scope-selector" />
              {/* UL-POLISH P2: the signed-in name beside the avatar at desktop
                  widths, opt-in per portal so student behavior is unchanged. */}
              {showHeaderName && userName && <span className="ptl-header-name">{userName}</span>}
              <ProfileMenu userName={userName} profileImageUrl={profileImageUrl}
                onEditProfile={onEditProfile} onProfile={onProfile} onChangePhoto={onChangePhoto}
                publicSiteUrl={publicSiteUrl}
                onRestartTour={onRestartTour} />
            </div>
          </header>
          {nav}
        </div>
        {utilityLayer}
        <main className={`ptl-main${contentClassName ? ` ${contentClassName}` : ''}`}>{children}</main>
        <footer className="ptl-footer">
          ASPIRE, Geri and Richard Brawerman Nursing Institute, Cedars-Sinai
        </footer>
      </div>
     </PortalHeaderSlotsContext.Provider>
    </PortalRefreshProvider>
  )
}
