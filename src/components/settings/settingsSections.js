// WS2.1: Settings section registry.
//
// Only `general` is ACTIVE/implemented in WS2.1. `visible(roleFlags)` encodes the
// FUTURE per-role visibility so later phases (WS2.2+) can flip a section on by
// setting implemented:true — without duplicating authorization logic. NOTE: this
// client-side visibility is for navigation only; it is NOT a substitute for the
// server-side authorization each future panel's data operations must enforce.
export const SETTINGS_SECTIONS = [
  { key: 'general',   label: 'General',           path: '/settings/general',   implemented: true,  visible: () => true },
  { key: 'accounts',  label: 'Accounts & Access', path: '/settings/accounts',  implemented: true,  visible: r => r.isAdmin }, // WS2.2: Owner/Admin only
  { key: 'tours',     label: 'Tours & Help',      path: '/settings/tours',     implemented: true,  visible: () => true },     // WS2.3: all authenticated users
  // Future sections (NOT rendered yet — no disabled/"coming soon" placeholders):
  { key: 'keith',     label: 'Keith',             path: '/settings/keith',     implemented: false, visible: r => r.isAdmin },
  { key: 'templates', label: 'Templates',         path: '/settings/templates', implemented: false, visible: r => r.isAdmin },
  { key: 'audit',     label: 'Audit History',     path: '/settings/audit',     implemented: false, visible: r => r.isOwner },
]

// Rail sections = implemented AND visible to the current role. In WS2.1 this is
// exactly [General] for every authenticated user.
export function visibleSections(roleFlags) {
  return SETTINGS_SECTIONS.filter(s => s.implemented && s.visible(roleFlags))
}
