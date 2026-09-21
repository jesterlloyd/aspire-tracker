// WS2.1: Settings section registry.
//
// Only `general` is ACTIVE/implemented in WS2.1. `visible(roleFlags)` encodes the
// FUTURE per-role visibility so later phases (WS2.2+) can flip a section on by
// setting implemented:true - without duplicating authorization logic. NOTE: this
// client-side visibility is for navigation only; it is NOT a substitute for the
// server-side authorization each future panel's data operations must enforce.
// `group` drives the rail's visual grouping (KT-3a-1). Order of the existing four
// sections is unchanged; Knowledge Center is added next to Accounts & Access (both
// Owner/Admin governance sections).
// ASPIRE-CHART (approved): groups now separate PERSONAL preferences (this
// account, this device) from WORKSPACE information and ADMINISTRATION, and
// Preceptor Parity - a read-only integrity monitor exposing raw ids -
// moves into an Owner-only Diagnostics group instead of sitting among
// product settings for every admin. Paths, panels, and server authorization
// are unchanged; this is grouping and rail visibility only.
//
// SETTINGS-UNIFIED-DESIGN-1 made Appearance, Email Signature, Tours & Help and About
// subsettings of a General hub, which gave Settings three panes.
//
// APPEARANCE-STYLE-1 (2026-09-21): back to two panes. The General hub is gone and its
// four pages are rail destinations again, in three groups: You (what is yours alone),
// Workspace (what the program runs on) and Diagnostics. Every page, its route and its
// server authorization are unchanged; each keeps the role gate it had. A row's `sub` is
// the grey line under its label. /settings/general no longer exists as a page: the shell
// sends it, and any unknown /settings path, to DEFAULT_SETTINGS_PATH.
// `inRail` (default true when omitted) still controls rail membership, and
// `routableSections` below ignores it so Keith's workspaces and the legacy Knowledge
// Center path stay valid deep links.
export const DEFAULT_SETTINGS_PATH = '/settings/appearance'

export const SETTINGS_GROUPS = ['You', 'Workspace', 'Diagnostics']

export const SETTINGS_SECTIONS = [
  { key: 'appearance', label: 'Appearance',        sub: 'Style and color mode',   path: '/settings/appearance', group: 'You', implemented: true, visible: () => true },     // per-user, follows the account (APPEARANCE-STYLE-1)
  { key: 'signature',  label: 'Email Signature',   sub: 'Your Connect signature', path: '/settings/signature',  group: 'You', implemented: true, visible: () => true },     // CONNECT-COMMS-1D: per-user manual Connect signature
  { key: 'tours',      label: 'Tours & Help',      sub: 'Replay the welcome tour', path: '/settings/tours',     group: 'You', implemented: true, visible: () => true },     // WS2.3: all authenticated users
  { key: 'accounts',   label: 'Accounts & Access', path: '/settings/accounts',   group: 'Workspace', implemented: true, visible: r => r.isAdmin }, // WS2.2: Owner/Admin only
  { key: 'communityBenefit', label: 'Community Benefit', path: '/settings/community-benefit', group: 'Workspace', implemented: true, visible: r => r.isAdmin }, // NURSING-ACADEMICS-1: report + reporting inputs; Admin sees read-only, WRITES are Owner-only server-side
  { key: 'keith',      label: 'Keith',             path: '/settings/keith',      group: 'Workspace', implemented: true, visible: r => r.isAdmin },
  // SETTINGS-KEITH-NESTED-1: Keith is now a PARENT destination with its own
  // secondary navigation, following the Settings > General master-detail pattern.
  // These two are its workspaces: routable and deep-linkable, never in the rail.
  // KEITH-USAGE-1: workspaces listed alphabetically (Knowledge Center, Skills,
  // Usage & Cost), matching the Settings > General convention. Usage & Cost is
  // Owner/Admin like its siblings; api/keith-usage.js is the real authority.
  { key: 'keithKnowledge', label: 'Knowledge Center', path: '/settings/keith/knowledge', implemented: true, inRail: false, visible: r => r.isAdmin },
  { key: 'keithSkills',    label: 'Skills',           path: '/settings/keith/skills',    implemented: true, inRail: false, visible: r => r.isAdmin },
  { key: 'keithUsage',     label: 'Usage & Cost',     path: '/settings/keith/usage',     implemented: true, inRail: false, visible: r => r.isAdmin },
  // Knowledge Center is no longer a top-level destination; it lives under Keith.
  // The old path stays ROUTABLE so existing links, bookmarks and any saved deep
  // link keep working - SettingsShell redirects it to /settings/keith/knowledge.
  { key: 'knowledge',  label: 'Knowledge Center',  path: '/settings/knowledge',  implemented: true, inRail: false, visible: r => r.isAdmin }, // KT-3a-1: Owner/Admin only; legacy route
  // DEMO-MODE-1: Owner only, and grouped with Diagnostics because it is the other
  // switch that changes what every screen reports rather than changing the program
  // itself. Per user, per device; nothing here is a workspace setting.
  { key: 'demoMode', label: 'Demo Mode', path: '/settings/demo-mode', group: 'Diagnostics', implemented: true, visible: r => r.isOwner },
  { key: 'preceptorParity', label: 'Preceptor Parity', path: '/settings/preceptor-parity', group: 'Diagnostics', implemented: true, visible: r => r.isOwner }, // PRECEPTOR-INTEGRITY-1: read-only integrity monitor for out-of-band SQL drift, Owner only
  // About is for everyone, so for a person who is not the Owner it is the whole of
  // Diagnostics.
  { key: 'about',      label: 'About',             sub: 'Version and build',      path: '/settings/about',      group: 'Diagnostics', implemented: true, visible: () => true },
  // Future sections (NOT rendered yet - no disabled/"coming soon" placeholders):
  { key: 'templates', label: 'Templates',         path: '/settings/templates', implemented: false, visible: r => r.isAdmin },
  { key: 'audit',     label: 'Audit History',     path: '/settings/audit',     implemented: false, visible: r => r.isOwner },
]

// Rail sections = implemented AND visible to the current role AND not opted out of the
// rail (inRail !== false). This is the set SettingsShell renders as nav destinations.
export function visibleSections(roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.implemented && s.visible(roleFlags) && s.inRail !== false)
}

// Routable sections = implemented AND visible to the current role, regardless of rail
// membership. SettingsShell uses this for path matching/normalization so Keith's
// workspaces and the legacy Knowledge Center path remain valid deep links.
export function routableSections(roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.implemented && s.visible(roleFlags))
}

// SETTINGS-VISUAL-DENSITY-1: ONE heading spec shared by every panel heading, so the
// top of every Settings page sits on the same baseline (pure style const; this module
// stays non-component config).
export const SETTINGS_HEADING_STYLE = {
  margin: '0 0 14px', fontSize: 20, fontWeight: 700, lineHeight: '28px',
  letterSpacing: '-0.01em',
  color: 'var(--color-text-primary, #191919)', fontFamily: 'Plus Jakarta Sans, sans-serif',
}
