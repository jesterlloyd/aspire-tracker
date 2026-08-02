// MESSAGES-DOCK-1: the main app's lower-right Messages DOCK - the canonical
// launcher plus a docked Messages panel, replacing the earlier deep link to
// Connect > Messages. The panel hosts the ONE staff MessagesWorkspace in its
// docked single-pane mode (same inbox, thread host, New message dialog,
// permissions, unread query, read-state rules, and useThreadAutoScroll -
// nothing is duplicated), floating above the current page like the portals'
// docked ASPIRE Team panel and Keith's drawer.
//
// The lower-right corner is ONE explicit dock shared with Keith:
//   - opening one closes the other (floatingPanels open announcements);
//   - while Keith is open the launcher RELOCATES beside the Keith orb at the
//     bottom edge (below Keith's drawer), so no launcher, badge, or tooltip
//     can ever cover Keith's composer - and it still switches tools on click;
//   - while the Messages panel is open the launcher hides (the panel owns the
//     slot; the visible Keith orb below it switches back to Keith).
//
// Session behavior: the panel UNMOUNTS on close but the dock remembers the
// last selected conversation, so reopening restores that thread - the
// remounted thread host re-anchors to the latest message through
// useThreadAutoScroll.
// First open (no prior state) shows the conversation list with the existing
// New message action and the inbox's unread affordances. A restrained
// "Open in ASPIRE Connect" action deep-links to the full workspace; it is no
// longer the launcher's primary behavior.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, ExternalLink, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useStaffUnreadCount, IDLE_UNREAD_POLL_MS } from '../lib/messages/messagesPolling'
import { formatUnread, unreadLabel } from '../lib/messages/messagesConstants'
import { announceFloatingPanelOpen, onFloatingPanelOpen, announceFloatingPanelClosed, onFloatingPanelClosed } from '../lib/floatingPanels'
import MessagesWorkspace from './connect/messages/MessagesWorkspace'

const F = 'DM Sans, sans-serif'

export default function MainMessagesLauncher() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [keithOpen, setKeithOpen] = useState(false)
  const [hover, setHover] = useState(false)
  // The dock's memory of the last viewed conversation, surviving panel
  // close/reopen for the life of the session.
  const [lastSelectedId, setLastSelectedId] = useState(null)
  const launcherRef = useRef(null)
  // Same authorization the Connect Messages tab and header pin use.
  const canUseMessages = ['owner', 'admin'].includes(userProfile?.role) && userProfile?.is_active !== false
  const unread = useStaffUnreadCount({ intervalMs: IDLE_UNREAD_POLL_MS, enabled: canUseMessages })

  // ONE dock: another panel opening (Keith, UserMenu) closes this one; Keith's
  // open/closed edges reposition the launcher.
  useEffect(() => onFloatingPanelOpen((source) => {
    if (source !== 'main-messages') setOpen(false)
    if (source === 'keith') setKeithOpen(true)
  }), [])
  useEffect(() => onFloatingPanelClosed((source) => {
    if (source === 'keith') setKeithOpen(false)
  }), [])

  // Escape closes the panel and returns focus to the launcher.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        announceFloatingPanelClosed('main-messages')
        // The launcher is hidden while the panel is open, so focus lands on it
        // AFTER the close re-render mounts it again.
        setTimeout(() => launcherRef.current?.focus(), 0)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!canUseMessages) return null

  const openPanel = () => {
    announceFloatingPanelOpen('main-messages') // closes Keith / UserMenu first
    setOpen(true)
    setHover(false)
  }
  const closePanel = (restoreFocus = true) => {
    setOpen(false)
    announceFloatingPanelClosed('main-messages')
    // Deferred: the launcher remounts on close (it is hidden while open).
    if (restoreFocus) setTimeout(() => launcherRef.current?.focus(), 0)
  }
  const openInConnect = () => {
    closePanel(false)
    navigate('/connect/messages')
  }

  // Launcher geometry: idle = directly above the 60px Keith orb (24+60+12);
  // while Keith is open = beside the orb at the bottom edge, BELOW Keith's
  // drawer (which starts at bottom:96), so nothing covers the composer.
  const launcherPos = keithOpen
    ? { bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', right: '96px' }
    : { bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', right: '28px' }

  return (
    <>
      {hover && !open && !keithOpen && (
        <div style={{
          position: 'fixed', bottom: '158px', right: '28px',
          background: '#1D2567', color: '#fff', fontFamily: F, fontSize: 12, fontWeight: 500,
          padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap',
          zIndex: 1001, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(29,37,103,0.25)',
        }}>
          Messages
        </div>
      )}
      {!open && (
        <button
          type="button"
          ref={launcherRef}
          data-tour="main-messages-launcher"
          aria-label={unreadLabel(unread)}
          aria-expanded={open}
          onClick={openPanel}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(false)}
          style={{
            position: 'fixed', ...launcherPos,
            width: 52, height: 52, borderRadius: '50%',
            background: '#1D2567', color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(29,37,103,0.30)', zIndex: 1000,
          }}
        >
          <MessageCircle size={24} aria-hidden="true" />
          {unread > 0 && (
            <span aria-hidden="true" style={{
              position: 'absolute', top: -5, right: -5,
              minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
              background: '#DC1E34', color: '#fff', fontFamily: F, fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #fff', boxSizing: 'border-box',
            }}>
              {formatUnread(unread)}
            </span>
          )}
        </button>
      )}

      {open && (
        <>
          {/* Transparent backdrop: the page stays visible; clicking outside closes. */}
          <div onClick={() => closePanel(false)} style={{ position: 'fixed', inset: 0, zIndex: 998, background: 'transparent' }} />
          <div
            role="dialog"
            aria-label="Messages"
            style={{
              position: 'fixed', bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', right: 24,
              width: 'min(420px, calc(100vw - 32px))',
              height: 'min(720px, calc(100vh - 160px))',
              background: 'var(--bg-card, #fff)', borderRadius: 16,
              boxShadow: '0 18px 48px rgba(16,24,40,0.24)', zIndex: 999,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              border: '1px solid var(--border-input, rgba(29,37,103,0.10))',
            }}
          >
            <div style={{
              flexShrink: 0, background: '#1D2567', color: '#fff',
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <MessageCircle size={17} aria-hidden="true" />
              <span style={{ fontFamily: F, fontWeight: 700, fontSize: 14, flex: 1 }}>Messages</span>
              <button
                type="button"
                onClick={openInConnect}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', fontFamily: F, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '2px 4px' }}
              >
                <ExternalLink size={12} aria-hidden="true" /> Open in ASPIRE Connect
              </button>
              <button
                type="button"
                onClick={() => closePanel(true)}
                aria-label="Close messages"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', padding: 2 }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 0 0' }}>
              <MessagesWorkspace
                docked
                initialSelectedId={lastSelectedId}
                onSelectionChange={setLastSelectedId}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}
