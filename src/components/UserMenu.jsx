// TOPBAR-PROFILE-1 (2026-10-02): the staff profile menu, in four sections.
// Reference: docs/mockups/topbar-profile.html, brief docs/mockups/topbar-profile-brief.md.
//
//   1. Identity: one button (photo, name, work email, role pill, chevron) that opens
//      Settings > General > Profile. The photo controls that used to sit here live on that
//      page now (src/hooks/useMyAvatar.js, the same handlers).
//   2. Settings, with its shortcut: Cmd+, on a Mac, Ctrl+, elsewhere, from anywhere in the
//      staff app with the menu open or closed.
//   3. Preview as: the five portal previews that already existed (PORTAL-OWNER-SWITCHER),
//      the same routes, the same Owner/Admin gate; only their place and label changed.
//   4. Leave: Public site (new tab) and Sign out.
//
// Keyboard: opening by keyboard puts focus on the identity row; Up and Down move, Home
// and End jump, Escape closes and returns focus to the button. Layout: userMenu.css.
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAvatarUrl } from '../lib/getAvatar';
import { announceFloatingPanelOpen, onFloatingPanelOpen } from '../lib/floatingPanels';
import {
  LogOut, ChevronDown, ChevronRight, Settings, ExternalLink, GraduationCap,
  Building2, School, HeartHandshake, BriefcaseBusiness, Globe,
} from 'lucide-react';
import { CANONICAL_APP_URL } from '../lib/appUrl';
import { PORTAL_LINKS, STAFF_SETTINGS_PATH, STAFF_PROFILE_PATH } from '../lib/portalLinks';
import { preloadPortalApp } from '../lib/portalAppLoader';
import { confirmLeave } from '../lib/unsavedChanges';
import './userMenu.css';

const ROLE_LABELS = {
  owner:       { label: 'Owner',       bg: '#1D2567', color: '#ffffff' },
  admin:       { label: 'Admin',       bg: '#065f46', color: '#ffffff' },
  interviewer: { label: 'Interviewer', bg: '#92400e', color: '#ffffff' },
  viewer:      { label: 'Viewer',      bg: '#6b7280', color: '#ffffff' },
};

// The labels and paths live in src/lib/portalLinks.js so the portal profile menu
// offers the same destinations; only the icon choice is this menu's own.
const PORTAL_ICONS = {
  student: GraduationCap,
  unit_leader: Building2,
  academic_partner: School,
  nursing_academic: HeartHandshake,
  talent_acquisition: BriefcaseBusiness,
};

const MENU_ID = 'staff-profile-menu';
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const SETTINGS_SHORTCUT_LABEL = IS_MAC ? '⌘,' : 'Ctrl+,';

// Cmd+, (Mac) or Ctrl+, (elsewhere), with no other modifier.
function isSettingsShortcut(e) {
  return e.key === ',' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}

function Avatar({ profile, size, fallbackBg, initials }) {
  return (
    <span className="um-avatar" style={{ width: size, height: size }}>
      <img src={getAvatarUrl(profile)} alt="" aria-hidden="true"
        onError={e => { e.target.style.display='none'; e.target.parentNode.style.background=fallbackBg; e.target.parentNode.innerHTML=`<span class="um-avatar-initials">${initials}</span>` }} />
    </span>
  );
}

export default function UserMenu() {
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // PORTAL-PREFETCH: the Preview as group is in this menu, so opening it is the
  // earliest signal that a portal chunk may be wanted. Start it now; the click
  // then mounts an already-downloaded chunk instead of showing a loading screen.
  useEffect(() => {
    if (isOpen) preloadPortalApp();
  }, [isOpen]);

  // UI-0.5: mutual dismiss - close this dropdown when another floating panel
  // (e.g. the Keith panel) announces it is opening.
  useEffect(() => onFloatingPanelOpen(source => {
    if (source !== 'user-menu') setIsOpen(false);
  }), []);

  const close = useCallback((returnFocus) => {
    setIsOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // A page with unsaved edits (Settings > Profile) is asked before the menu leaves it.
  const go = useCallback(async (path) => {
    setIsOpen(false);
    if (await confirmLeave()) navigate(path);
  }, [navigate]);

  // Cmd+, / Ctrl+, opens Settings from anywhere in the staff app, menu open or closed.
  useEffect(() => {
    if (!userProfile) return undefined;
    const onKey = (e) => {
      if (!isSettingsShortcut(e)) return;
      e.preventDefault();
      go(STAFF_SETTINGS_PATH);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [userProfile, go]);

  // Escape closes from anywhere while open and gives focus back to the button.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  // Opened by keyboard: focus lands on the identity row.
  useEffect(() => {
    if (isOpen && focusFirst) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [isOpen, focusFirst]);

  const onMenuKeyDown = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : i < 0 ? 0
      : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[n].focus();
  };

  if (!userProfile) return null;

  const roleStyle = ROLE_LABELS[userProfile.role] || ROLE_LABELS.viewer;
  const roleLabel = userProfile.is_owner ? 'Owner' : roleStyle.label;
  const fullName = userProfile.full_name || '';
  const initials = fullName
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  // PORTAL-OWNER-SWITCHER: Owner/Admin use their existing staff identity to enter an
  // explicitly scoped portal preview (src/portal/PortalApp.jsx); nobody else sees the group.
  const canPreview = ['owner', 'admin'].includes(userProfile.role) && userProfile.is_active !== false;

  return (
    <div className="um-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="um-trigger"
        data-tour="user-profile"
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={MENU_ID}
        aria-label={`Account menu for ${fullName}`}
        onClick={(e) => {
          const next = !isOpen;
          if (next) announceFloatingPanelOpen('user-menu'); // UI-0.5: closes an open Keith panel
          // A click from the keyboard (Enter or Space) carries detail 0.
          setFocusFirst(next && e.detail === 0);
          setIsOpen(next);
        }}
      >
        <Avatar profile={userProfile} size={26} fallbackBg={roleStyle.bg} initials={initials} />
        <span className="um-trigger-text" aria-hidden="true">
          <span className="um-trigger-name">{fullName.split(' ')[0]}</span>
          <span className="um-trigger-role">{roleLabel}</span>
        </span>
        <ChevronDown size={12} aria-hidden="true" className="um-trigger-caret" />
      </button>

      {isOpen && (
        <>
          <div className="um-scrim" onClick={() => close(false)} aria-hidden="true" />
          <div
            ref={menuRef}
            id={MENU_ID}
            className="um-menu"
            role="menu"
            aria-label="Account menu"
            onKeyDown={onMenuKeyDown}
          >
            {/* 1. Identity, and the way to Profile. */}
            <button
              type="button"
              role="menuitem"
              className="um-id"
              aria-label={`Profile, ${fullName}, ${roleLabel}`}
              onClick={() => go(STAFF_PROFILE_PATH)}
            >
              <Avatar profile={userProfile} size={44} fallbackBg={roleStyle.bg} initials={initials} />
              <span className="um-id-text">
                <span className="um-id-name">{fullName}</span>
                <span className="um-id-email">{userProfile.email}</span>
                <span className="um-role" style={{ background: roleStyle.bg, color: roleStyle.color }}>{roleLabel}</span>
              </span>
              <ChevronRight size={16} aria-hidden="true" className="um-id-chev" />
            </button>

            {/* 2. Settings. */}
            <div className="um-sec" role="none">
              <button type="button" role="menuitem" className="um-item" onClick={() => go(STAFF_SETTINGS_PATH)}
                aria-keyshortcuts={IS_MAC ? 'Meta+Comma' : 'Control+Comma'}>
                <Settings size={16} strokeWidth={1.9} aria-hidden="true" className="um-ic" />
                <span className="um-item-text">Settings</span>
                <kbd className="um-kbd" aria-hidden="true">{SETTINGS_SHORTCUT_LABEL}</kbd>
              </button>
            </div>

            {/* 3. Preview as: the existing portal previews. */}
            {canPreview && (
              <div className="um-sec" role="group" aria-labelledby="um-preview-label">
                <div className="um-label" id="um-preview-label">Preview as</div>
                {PORTAL_LINKS.map(({ key, label, path }) => {
                  const Icon = PORTAL_ICONS[key];
                  return (
                    <button key={path} type="button" role="menuitem" className="um-item" onClick={() => go(path)}>
                      <Icon size={16} strokeWidth={1.9} aria-hidden="true" className="um-ic" />
                      <span className="um-item-text">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 4. Leave. PROFILE-MENU-AVATARS-1: Public site is the canonical domain in a new tab. */}
            <div className="um-sec" role="none">
              <a
                role="menuitem"
                className="um-item"
                href={CANONICAL_APP_URL}
                target="_blank" rel="noopener noreferrer"
                aria-label="Public site (opens in a new tab)"
                onClick={() => setIsOpen(false)}
              >
                <Globe size={16} strokeWidth={1.9} aria-hidden="true" className="um-ic" />
                <span className="um-item-text">Public site</span>
                <ExternalLink size={13} aria-hidden="true" className="um-ext" />
              </a>
              <button type="button" role="menuitem" className="um-item um-out" onClick={() => { setIsOpen(false); signOut(); }}>
                <LogOut size={16} strokeWidth={1.9} aria-hidden="true" className="um-ic" />
                <span className="um-item-text">Sign out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
