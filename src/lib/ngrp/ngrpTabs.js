// NGRP-WORKSPACE-2 (Owner): the Residency workspace's five tabs and their
// sub-tabs. Data-only module (not in a component file) so react-refresh stays
// happy and App.jsx can derive the active tab from the URL without importing a
// component.
//
// THE MNEMONIC IS A-S-PI-R-E, and the chips are multi-letter where they need to
// be, exactly as the Internship nav already does it ("SP" for Student Profiles,
// giving A-SP-I-R-E). Residency reads:
//
//   A   At a Glance            the cohort right now
//   S   Support                before residency | after residency
//   PI  Profiles & Interest    the roster: who they are AND where they are
//   R   Residency              placement board | activity
//   E   Evaluation             bootcamp evals, retention, Casey-Fink
//
// THERE IS NO SIXTH TAB. The old six spelled ASPIRE with one letter each, but
// Interviews only ever meant rubrics we do not keep, and Interest is a set of
// columns on the roster rather than a place of its own. Naming the roster
// "Profiles & Interest" says what it holds and gives the mnemonic its I back
// without inventing a page to hold a letter.
//
// Sub-tabs are a SECOND path segment (/ngrp/support/before). Every tab resolves
// to a default sub-tab, so a bare /ngrp/support is always a valid destination
// and never a dead route.

export const NGRP_TABS = [
  { id: 'overview',   label: 'At a Glance',         chip: 'A'  },
  { id: 'support',    label: 'Support',             chip: 'S',
    subTabs: [
      { id: 'before', label: 'Before residency' },
      { id: 'after',  label: 'After residency' },
    ] },
  { id: 'profiles',   label: 'Profiles & Interest', chip: 'PI' },
  { id: 'residency',  label: 'Residency',           chip: 'R',
    subTabs: [
      { id: 'board',    label: 'Placement board' },
      { id: 'activity', label: 'Activity' },
    ] },
  { id: 'evaluation', label: 'Evaluation',          chip: 'E'  },
]

export function isNgrpTabId(id) {
  return NGRP_TABS.some(t => t.id === id)
}

export function ngrpTab(id) {
  return NGRP_TABS.find(t => t.id === id) || null
}

export function ngrpSubTabs(tabId) {
  return ngrpTab(tabId)?.subTabs || []
}

// The sub-tab a bare tab path lands on: the first one, or null for a tab that
// has none.
export function defaultSubTab(tabId) {
  return ngrpSubTabs(tabId)[0]?.id || null
}

export function isNgrpSubTabId(tabId, subId) {
  return ngrpSubTabs(tabId).some(s => s.id === subId)
}

// NGRP-WORKSPACE-2: where the OLD tab ids go. These are live URLs people have
// bookmarked, and they are also what is sitting in every browser's saved
// last-tab key, so dropping them would strand real users on a dead route.
//
//   applicants -> profiles     the roster moved there, intact
//   planning   -> overview     its operating picture IS At a Glance
//   interviews -> residency    interviews are recorded beside placement now
export const LEGACY_NGRP_TABS = {
  applicants: 'profiles',
  planning: 'overview',
  interviews: 'residency',
}

// Resolve any historical id to a live one, or null when it was never a tab.
export function canonicalNgrpTab(id) {
  if (isNgrpTabId(id)) return id
  return LEGACY_NGRP_TABS[id] || null
}

// RESIDENCY-PORTAL-1: the same five tabs live at two addresses. The staff app
// mounts them under /ngrp; the Residency Portal (Talent Acquisition) mounts them
// under /portal/residency. The path helpers take the base, and it defaults to
// the staff one, so every existing caller behaves exactly as before.
export const NGRP_STAFF_BASE = '/ngrp'
export const RESIDENCY_PORTAL_BASE = '/portal/residency'

/**
 * The tab and sub-tab a pathname names.
 *
 * Returns { tab, subTab, redirect } where `redirect` is the path to replace the
 * current one with, or null when the URL is already canonical. A legacy id, a
 * missing sub-tab, or a sub-tab that does not belong to its tab all produce a
 * redirect rather than an error page.
 */
export function resolveNgrpPath(pathname, base = NGRP_STAFF_BASE) {
  // Only what follows the surface's base names a tab. A path outside the base
  // names nothing, so it resolves to the home tab like any unknown id.
  const path = String(pathname || '')
  const rest = path === base || path.startsWith(`${base}/`) ? path.slice(base.length) : ''
  const parts = rest.split('/').filter(Boolean)
  const rawTab = parts[0] || ''
  const rawSub = parts[1] || ''

  const tab = canonicalNgrpTab(rawTab)
  if (!tab) {
    const home = NGRP_TABS[0].id
    return { tab: home, subTab: defaultSubTab(home), redirect: ngrpPath(home, undefined, base) }
  }

  const sub = defaultSubTab(tab)
  if (!sub) {
    // A tab with no sub-tabs: any trailing segment is noise.
    const canonical = tab === rawTab && !rawSub
    return { tab, subTab: null, redirect: canonical ? null : ngrpPath(tab, undefined, base) }
  }
  const subTab = isNgrpSubTabId(tab, rawSub) ? rawSub : sub
  const canonical = tab === rawTab && subTab === rawSub
  return { tab, subTab, redirect: canonical ? null : ngrpPath(tab, subTab, base) }
}

export function ngrpPath(tabId, subTabId = undefined, base = NGRP_STAFF_BASE) {
  const sub = subTabId === undefined ? defaultSubTab(tabId) : subTabId
  return sub ? `${base}/${tabId}/${sub}` : `${base}/${tabId}`
}

// The valid tab named by a pathname, or null. Kept for callers that only need
// to know "which tab am I on" (App persists this).
export function ngrpTabFromPath(pathname) {
  const seg = String(pathname || '').split('/')[2] || ''
  return isNgrpTabId(seg) ? seg : null
}

// Where the Residency experience enters: the saved last-used tab when it still
// resolves (including a legacy id, which is the whole point), else At a Glance.
export function resolveNgrpEntryTab(saved) {
  return canonicalNgrpTab(saved) || NGRP_TABS[0].id
}

// The full entry path, sub-tab included, for the header's experience switch.
export function resolveNgrpEntryPath(saved) {
  return ngrpPath(resolveNgrpEntryTab(saved))
}
