// PHASE2-PORTAL / ASPIRE-STUDENT-PORTAL: shared portal frame. Mobile-first,
// safe-area-aware header: a compact Cedars-Sinai + ASPIRE brand on the left and a
// single avatar / profile-menu button on the right. The full student name,
// Public site link, Edit Profile, and Sign out live inside the profile menu on
// mobile (the desktop header may surface a couple of them inline). Portals are
// focused, read-mostly surfaces; the staff shell is never loaded here.
import { useState, useRef, useEffect } from 'react'
import {
  ChevronDown, ChevronRight, ExternalLink, Camera, UserRound, LogOut, RotateCcw, House,
  Settings, Check, GraduationCap, Building2, School, HeartHandshake, BriefcaseBusiness, Globe,
} from 'lucide-react'
import { PORTAL_LINKS } from '../lib/portalLinks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PortalRefreshProvider } from './PortalRefresh'
import { PortalHeaderSlotsContext } from './PortalHeaderSlots'

// PORTAL-SWITCHER-1: the same icon per portal as the staff UserMenu, so a portal is
// recognizable from either menu. The labels and paths come from the shared list.
const PORTAL_ICONS = {
  student: GraduationCap,
  unit_leader: Building2,
  academic_partner: School,
  nursing_academic: HeartHandshake,
  talent_acquisition: BriefcaseBusiness,
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

// PORTAL-MENU-1 (Owner, 2026-10-02): every portal's profile menu has the staff menu's shape
// (src/components/UserMenu.jsx, TOPBAR-PROFILE-1), in sections separated by one rule:
//   1. identity: the person's name, and the way to their profile when the portal has one
//      (a student's My Profile, a unit leader's Profile; plain text where there is none).
//      An Owner or Admin's identity opens their Profile in the main app instead.
//   2. staff only (NAV-POLISH-1): Settings with Cmd+, / Ctrl+,, then Preview as, the
//      portals with the one in view checked and inert.
//   3. the person's own actions: Change Photo, Restart Welcome Tour (and, for an Owner or
//      Admin who also holds a real portal grant, their portal profile), as each is wired.
//   4. the way out: Main App (staff), Public site, Sign out.
// Arrows, Home and End move through it; Escape closes it. The email stays out: no staff or
// student email is handled in the portal bundle (test/messagesPhase5biiPortalActivation).
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

function ProfileMenu({
  userName, roleLabel, profileImageUrl, onEditProfile, onProfile, onChangePhoto,
  publicSiteUrl = '/', mainAppUrl, settingsUrl, portalSwitcher = null,
  onRestartTour, portalUserActionsEnabled = true,
}) {
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
  // NAV-POLISH-1: Cmd+, / Ctrl+, opens Settings from a portal too, for the staff who have it.
  useEffect(() => {
    if (!portalSwitcher || !settingsUrl) return undefined
    const onKey = (e) => {
      if (e.key !== ',' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      window.location.assign(settingsUrl)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [portalSwitcher, settingsUrl])
  // Up, Down, Home and End through the items (an inert current portal is skipped).
  const onMenuKeyDown = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement)
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? 0
      : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[n].focus()
  }

  const staff = Boolean(portalSwitcher)
  const close = () => setOpen(false)
  // The person's own portal profile: a student's My Profile, a unit leader's Profile.
  const ownProfile = portalUserActionsEnabled
    ? (onProfile ? { word: 'Profile', go: onProfile } : onEditProfile ? { word: 'My Profile', go: onEditProfile } : null)
    : null
  // Staff see their role under the name; a portal user sees where the row goes ("My Profile"),
  // so the name row reads as the way to their profile and the tour's "Open My Profile" holds.
  const idText = (
    <span className="ptl-menu-id-text">
      {userName && <span className="ptl-menu-name">{userName}</span>}
      {roleLabel && <span className="ptl-menu-role">{roleLabel}</span>}
      {!staff && ownProfile && <span className="ptl-menu-id-sub" aria-hidden="true">{ownProfile.word}</span>}
    </span>
  )
  const idChev = <ChevronRight size={16} aria-hidden="true" className="ptl-menu-id-chev" />
  let identity = null
  if (staff && portalSwitcher.profileUrl) {
    identity = (
      <a role="menuitem" className="ptl-menu-id ptl-menu-id-link" href={portalSwitcher.profileUrl}
         aria-label={`Profile, ${userName || ''}${roleLabel ? `, ${roleLabel}` : ''}`}>
        {idText}{idChev}
      </a>
    )
  } else if (!staff && ownProfile) {
    identity = (
      <button role="menuitem" type="button" className="ptl-menu-id ptl-menu-id-link"
              aria-label={`${ownProfile.word}, ${userName || ''}`} onClick={() => { close(); ownProfile.go() }}>
        {idText}{idChev}
      </button>
    )
  } else if (userName || roleLabel) {
    identity = <div className="ptl-menu-id ptl-menu-id-static">{idText}</div>
  }
  // An Owner or Admin's identity row opens the main app, so their own portal profile (when
  // they also hold a real grant) is listed with their other personal actions, named
  // "Portal profile" so it cannot be mistaken for the row above it.
  const personal = [
    staff && ownProfile && (
      <button key="profile" role="menuitem" type="button" className="ptl-menu-item" onClick={() => { close(); ownProfile.go() }}><UserRound size={15} /> Portal profile</button>
    ),
    // PROFILE-MENU-AVATARS-1: self-service photo management, wired per portal.
    portalUserActionsEnabled && onChangePhoto && (
      <button key="photo" role="menuitem" type="button" className="ptl-menu-item" onClick={() => { close(); onChangePhoto() }}><Camera size={15} /> Change Photo</button>
    ),
    // WELCOME-TOUR-PORTALS-1: only when the portal wires a restart handler.
    portalUserActionsEnabled && onRestartTour && (
      <button key="tour" role="menuitem" type="button" className="ptl-menu-item" onClick={() => { close(); onRestartTour() }}><RotateCcw size={15} /> Restart Welcome Tour</button>
    ),
  ].filter(Boolean)
  const external = publicSiteUrl !== '/'

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
        <div ref={menuRef} className={`ptl-menu ptl-menu-sectioned${staff ? ' ptl-menu-wide ptl-menu-staff' : ''}`}
             role="menu" aria-label="Profile menu" onKeyDown={onMenuKeyDown}>
          {identity}
          {staff && settingsUrl && (
            <div className="ptl-menu-group" role="none">
              <a role="menuitem" className="ptl-menu-item" href={settingsUrl} aria-keyshortcuts={IS_MAC ? 'Meta+Comma' : 'Control+Comma'}>
                <Settings size={15} /> Settings
                <kbd className="ptl-menu-kbd" aria-hidden="true">{IS_MAC ? '⌘,' : 'Ctrl+,'}</kbd>
              </a>
            </div>
          )}
          {/* PORTAL-SWITCHER-1: Owner/Admin cross straight to another portal. The portal
              being viewed is marked and does not navigate. */}
          {staff && (
            <div className="ptl-menu-group" role="group" aria-labelledby="ptl-preview-label">
              <div className="ptl-menu-group-label" id="ptl-preview-label">Preview as</div>
              {PORTAL_LINKS.map(({ key, label, path }) => {
                const Icon = PORTAL_ICONS[key]
                if (key === portalSwitcher.currentKey) {
                  return (
                    <span key={key} role="menuitem" aria-current="page" aria-disabled="true" tabIndex={-1}
                          className="ptl-menu-item ptl-menu-item-current">
                      <Icon size={15} /> {label}
                      <Check size={14} className="ptl-menu-check" aria-hidden="true" />
                    </span>
                  )
                }
                return (
                  <a key={key} role="menuitem" className="ptl-menu-item" href={path}>
                    <Icon size={15} /> {label}
                  </a>
                )
              })}
            </div>
          )}
          {personal.length > 0 && <div className="ptl-menu-group" role="none">{personal}</div>}
          <div className="ptl-menu-group" role="none">
            {staff && mainAppUrl && (
              <a role="menuitem" className="ptl-menu-item" href={mainAppUrl}>
                <House size={15} /> Main App
              </a>
            )}
            <a role="menuitem" className="ptl-menu-item" href={publicSiteUrl}
               {...(external ? { target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Public site (opens in a new tab)' } : {})}>
              <Globe size={15} /> Public site
              {external && <ExternalLink size={13} className="ptl-menu-ext" aria-hidden="true" />}
            </a>
            <button role="menuitem" type="button" className="ptl-menu-item ptl-menu-quiet" onClick={() => { close(); signOut() }}><LogOut size={15} /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PortalShell({
  title,
  userName,
  roleLabel,
  settingsUrl,
  portalSwitcher = null,
  onEditProfile,
  onProfile,
  onChangePhoto,
  publicSiteUrl,
  mainAppUrl,
  portalUserActionsEnabled = true,
  withTabBar = false,
  showHeaderName = false,
  headerVariant = 'light',
  logoSrc = '/Cedars-Sinai.png',
  homePath = '/portal',
  homeLabel = 'Home',
  profileImageUrl = null,
  previewProfileImageUrl = null,
  nav = null,
  utilityLayer = null,
  onRestartTour,
  children,
}) {
  const [organization, setOrganization] = useState(null)
  const [organizationResolved, setOrganizationResolved] = useState(false)
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) {
        if (live) setOrganizationResolved(true)
        return
      }
      fetch('/api/organization-settings', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(response => response.ok ? response.json() : null)
        .then(data => { if (live && data?.organization) setOrganization(data.organization) })
        .catch(() => {})
        .finally(() => { if (live) setOrganizationResolved(true) })
    }).catch(() => {
      if (live) setOrganizationResolved(true)
    })
    return () => { live = false }
  }, [])
  const nightfall = headerVariant === 'nightfall'
  const headerClass = `ptl-header${nightfall ? ' ptl-header-nightfall' : ''}`
  const resolvedProfileImageUrl = previewProfileImageUrl || profileImageUrl
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
              <a
                href={homePath}
                className="ptl-header-logo-link"
                aria-label={`Go to ${homeLabel} and refresh the portal`}
              >
                {organizationResolved
                  ? <img src={(nightfall ? organization?.header_logo_url : organization?.document_logo_url) || logoSrc} alt={organization?.logo_alt_text || 'Cedars-Sinai'} className="ptl-header-logo" />
                  : <span className="ptl-header-logo-placeholder" aria-hidden="true" />}
              </a>
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
              <ProfileMenu userName={userName} roleLabel={roleLabel}
                profileImageUrl={resolvedProfileImageUrl}
                onEditProfile={onEditProfile} onProfile={onProfile} onChangePhoto={onChangePhoto}
                publicSiteUrl={publicSiteUrl} mainAppUrl={mainAppUrl} settingsUrl={settingsUrl}
                portalSwitcher={portalSwitcher}
                portalUserActionsEnabled={portalUserActionsEnabled} onRestartTour={onRestartTour} />
            </div>
          </header>
          {nav}
        </div>
        {utilityLayer}
        <main className="ptl-main">{children}</main>
        <footer className="ptl-footer">
          {organization?.display_name || 'Cedars-Sinai'} · ASPIRE Intelligence
        </footer>
      </div>
     </PortalHeaderSlotsContext.Provider>
    </PortalRefreshProvider>
  )
}
