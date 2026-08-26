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
// SETTINGS-UNIFIED-DESIGN-1: information architecture pass. Appearance, Email
// Signature, and Tours & Help leave the rail and become subsettings reached
// from within General (see GeneralPanel.jsx); their routes, panels, and
// server behavior are unchanged, only rail presence changes. `inRail`
// (default true when omitted) controls rail membership; `routableSections`
// below intentionally ignores it so /settings/appearance, /settings/signature,
// and /settings/tours remain valid deep links. `about` is a new Workspace
// section that now owns the build/deployment metadata previously nested
// inside General.
export const SETTINGS_SECTIONS = [
  { key: 'appearance', label: 'Appearance',        path: '/settings/appearance', group: 'Personal',       implemented: true,  visible: () => true, inRail: false },     // per-user, device-local theme; now a General subsetting
  { key: 'signature',  label: 'Email Signature',   path: '/settings/signature',  group: 'Personal',       implemented: true,  visible: () => true, inRail: false },     // CONNECT-COMMS-1D: per-user manual Connect signature; now a General subsetting
  { key: 'general',    label: 'General',           path: '/settings/general',    group: 'Workspace',      implemented: true,  visible: () => true },
  { key: 'about',      label: 'About',             path: '/settings/about',      group: 'Workspace',      implemented: true,  inRail: false, visible: () => true }, // SETTINGS-UNIFIED-DESIGN-1B: General > Information > About; direct deep link preserved
  { key: 'accounts',   label: 'Accounts & Access', path: '/settings/accounts',   group: 'Administration', implemented: true,  visible: r => r.isAdmin }, // WS2.2: Owner/Admin only
  { key: 'communityBenefit', label: 'Community Benefit', path: '/settings/community-benefit', group: 'Administration', implemented: true, visible: r => r.isAdmin }, // NURSING-ACADEMICS-1: report + reporting inputs; Admin sees read-only, WRITES are Owner-only server-side
  { key: 'keith',      label: 'Keith',             path: '/settings/keith',      group: 'Administration', implemented: true,  visible: r => r.isAdmin },
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
  { key: 'knowledge',  label: 'Knowledge Center',  path: '/settings/knowledge',  implemented: true, inRail: false, visible: r => r.isAdmin }, // KT-3a-1: Owner/Admin only; legacy route // KEITH-SKILLS-1: Owner/Admin only (rail groups are contiguous, so this sits with the other Administration sections)
  { key: 'preceptorParity', label: 'Preceptor Parity', path: '/settings/preceptor-parity', group: 'Diagnostics', implemented: true, visible: r => r.isOwner }, // PRECEPTOR-INTEGRITY-1: read-only integrity monitor for out-of-band SQL drift, Owner only
  { key: 'tours',      label: 'Tours & Help',      path: '/settings/tours',      group: 'Support',        implemented: true,  visible: () => true, inRail: false },     // WS2.3: all authenticated users; now a General subsetting
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
// membership. SettingsShell uses this for path matching/normalization so subsettings
// (appearance/signature/tours) that were removed from the rail remain valid deep links.
export function routableSections(roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.implemented && s.visible(roleFlags))
}

// SETTINGS-VISUAL-DENSITY-1: ONE heading spec shared by the Settings column, the
// General master-list column, the detail pane, and the primary section panels, so
// every top-of-column heading sits on the same baseline (pure style const; this
// module stays non-component config).
export const SETTINGS_HEADING_STYLE = {
  margin: '0 0 14px', fontSize: 20, fontWeight: 700, lineHeight: '28px',
  letterSpacing: '-0.01em',
  color: 'var(--color-text-primary, #191919)', fontFamily: 'DM Sans, sans-serif',
}
