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
// Preceptor Parity - a read-only migration diagnostic exposing raw ids -
// moves into an Owner-only Diagnostics group instead of sitting among
// product settings for every admin. Paths, panels, and server authorization
// are unchanged; this is grouping and rail visibility only.
export const SETTINGS_SECTIONS = [
  { key: 'appearance', label: 'Appearance',        path: '/settings/appearance', group: 'Personal',       implemented: true,  visible: () => true },     // per-user, device-local theme
  { key: 'signature',  label: 'Email Signature',   path: '/settings/signature',  group: 'Personal',       implemented: true,  visible: () => true },     // CONNECT-COMMS-1D: per-user manual Connect signature
  { key: 'general',    label: 'General',           path: '/settings/general',    group: 'Workspace',      implemented: true,  visible: () => true },
  { key: 'accounts',   label: 'Accounts & Access', path: '/settings/accounts',   group: 'Administration', implemented: true,  visible: r => r.isAdmin }, // WS2.2: Owner/Admin only
  { key: 'knowledge',  label: 'Knowledge Center',  path: '/settings/knowledge',  group: 'Administration', implemented: true,  visible: r => r.isAdmin }, // KT-3a-1: Owner/Admin only
  { key: 'preceptorParity', label: 'Preceptor Parity', path: '/settings/preceptor-parity', group: 'Diagnostics', implemented: true, visible: r => r.isOwner }, // PRECEPTOR-MODEL-2: read-only migration diagnostic, Owner only
  { key: 'tours',      label: 'Tours & Help',      path: '/settings/tours',      group: 'Support',        implemented: true,  visible: () => true },     // WS2.3: all authenticated users
  // Future sections (NOT rendered yet - no disabled/"coming soon" placeholders):
  { key: 'keith',     label: 'Keith',             path: '/settings/keith',     implemented: false, visible: r => r.isAdmin },
  { key: 'templates', label: 'Templates',         path: '/settings/templates', implemented: false, visible: r => r.isAdmin },
  { key: 'audit',     label: 'Audit History',     path: '/settings/audit',     implemented: false, visible: r => r.isOwner },
]

// Rail sections = implemented AND visible to the current role. In WS2.1 this is
// exactly [General] for every authenticated user.
export function visibleSections(roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.implemented && s.visible(roleFlags))
}
