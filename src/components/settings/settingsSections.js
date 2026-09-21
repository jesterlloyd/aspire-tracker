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
// subsettings of a General hub, which gave Settings three panes. APPEARANCE-STYLE-1 first
// flattened everything into one rail, and the Owner sent it back (2026-09-21): the
// hierarchy is right, only the third pane was wrong.
//
// SETTINGS-HIERARCHY-1 (2026-09-21), the Apple System Settings pattern. The rail holds
// the top-level destinations only, in three groups: Workspace (General), Administration
// (Accounts & Access, Community Benefit, Keith) and Diagnostics (Demo Mode, Preceptor
// Parity). General and Keith are LIST pages: a grouped list of drill-in rows. A row opens
// its page in the same right pane, under a breadcrumb back to its parent, while the rail
// keeps the parent selected. A drill-in names its parent in `parent` and its row's grey
// line in `sub`; every one has its own route under the parent's.
//
// `inRail` (default true when omitted) controls rail membership; `routableSections`
// ignores it so every drill-in is a deep link. Old paths are redirected by
// LEGACY_SETTINGS_REDIRECTS, never dropped.
export const DEFAULT_SETTINGS_PATH = '/settings/general'

export const SETTINGS_GROUPS = ['Workspace', 'Administration', 'Diagnostics']

export const SETTINGS_SECTIONS = [
  { key: 'general',    label: 'General',           path: '/settings/general',    group: 'Workspace', implemented: true, visible: () => true },
  { key: 'accounts',   label: 'Accounts & Access', path: '/settings/accounts',   group: 'Administration', implemented: true, visible: r => r.isAdmin }, // WS2.2: Owner/Admin only
  { key: 'communityBenefit', label: 'Community Benefit', path: '/settings/community-benefit', group: 'Administration', implemented: true, visible: r => r.isAdmin }, // NURSING-ACADEMICS-1: report + reporting inputs; Admin sees read-only, WRITES are Owner-only server-side
  { key: 'keith',      label: 'Keith',             path: '/settings/keith',      group: 'Administration', implemented: true, visible: r => r.isAdmin },
  // DEMO-MODE-1: Owner only, and grouped with Diagnostics because it is the other
  // switch that changes what every screen reports rather than changing the program
  // itself. Per user, per device; nothing here is a workspace setting.
  { key: 'demoMode', label: 'Demo Mode', path: '/settings/demo-mode', group: 'Diagnostics', implemented: true, visible: r => r.isOwner },
  { key: 'preceptorParity', label: 'Preceptor Parity', path: '/settings/preceptor-parity', group: 'Diagnostics', implemented: true, visible: r => r.isOwner }, // PRECEPTOR-INTEGRITY-1: read-only integrity monitor for out-of-band SQL drift, Owner only

  // General's rows, alphabetical by label, visible to everyone.
  { key: 'about',      label: 'About',           sub: 'Version, build, and deployment details', path: '/settings/general/about',      parent: 'general', inRail: false, implemented: true, visible: () => true },
  { key: 'appearance', label: 'Appearance',      sub: 'Style and color mode',                   path: '/settings/general/appearance', parent: 'general', inRail: false, implemented: true, visible: () => true }, // per-user, follows the account (APPEARANCE-STYLE-1)
  { key: 'signature',  label: 'Email Signature', sub: 'Your Connect signature',                 path: '/settings/general/signature',  parent: 'general', inRail: false, implemented: true, visible: () => true }, // CONNECT-COMMS-1D
  { key: 'tours',      label: 'Tours & Help',    sub: 'Replay the welcome tour and find help',  path: '/settings/general/tours',      parent: 'general', inRail: false, implemented: true, visible: () => true }, // WS2.3

  // Keith's rows (SETTINGS-KEITH-NESTED-1, KEITH-USAGE-1), alphabetical, Owner/Admin like
  // Keith itself; api/keith-usage.js and the other endpoints remain the real authority.
  { key: 'keithKnowledge', label: 'Knowledge Center', sub: "Keith's governed knowledge and future Markdown vault", path: '/settings/keith/knowledge', parent: 'keith', inRail: false, implemented: true, visible: r => r.isAdmin },
  { key: 'keithSkills',    label: 'Skills',           sub: 'Governed capabilities, lifecycle, and usage',           path: '/settings/keith/skills',    parent: 'keith', inRail: false, implemented: true, visible: r => r.isAdmin },
  { key: 'keithUsage',     label: 'Usage & Cost',     sub: 'Keith activity, model usage, estimated spend, and operational health', path: '/settings/keith/usage', parent: 'keith', inRail: false, implemented: true, visible: r => r.isAdmin },

  // Future sections (NOT rendered yet - no disabled/"coming soon" placeholders):
  { key: 'templates', label: 'Templates',         path: '/settings/templates', implemented: false, visible: r => r.isAdmin },
  { key: 'audit',     label: 'Audit History',     path: '/settings/audit',     implemented: false, visible: r => r.isOwner },
]

// Every path Settings has ever published that is not a page any more, and where it lives
// now. The shell REPLACES the history entry, so Back never returns to a redirect.
export const LEGACY_SETTINGS_REDIRECTS = Object.freeze({
  '/settings': '/settings/general',
  '/settings/appearance': '/settings/general/appearance',
  '/settings/signature': '/settings/general/signature',
  '/settings/tours': '/settings/general/tours',
  '/settings/about': '/settings/general/about',
  '/settings/knowledge': '/settings/keith/knowledge', // KT-3a-1's Knowledge Center, under Keith since SETTINGS-KEITH-NESTED-1
})

// A list page's rows: the drill-ins under `parentKey` this role may open, in order.
export function childSections(parentKey, roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.parent === parentKey && s.implemented && s.visible(roleFlags))
}

// Rail sections = implemented AND visible to the current role AND not opted out of the
// rail (inRail !== false). This is the set SettingsShell renders as nav destinations.
export function visibleSections(roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.implemented && s.visible(roleFlags) && s.inRail !== false)
}

// Routable sections = implemented AND visible to the current role, regardless of rail
// membership. SettingsShell uses this for path matching, so every drill-in page is a
// deep link and an unknown or unauthorized path falls back to the default.
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
