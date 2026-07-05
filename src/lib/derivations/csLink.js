// KLD-1: canonical CS-Link summary for Keith. The per-student derivation
// (getCsLinkStatus) and the five-category labels (CS_LINK_STATUS_CONFIG) already live
// in src/lib/utils.js and drive the Student Profiles → CS-Link Access table (see
// AccessTab.jsx). This module REUSES them verbatim - the single source stays utils.js,
// so the UI needs no change - and only adds a cohort-level aggregator for Keith.
// Pure: no React, no fetch, no browser APIs (utils.js has no top-level browser refs).
import { getCsLinkStatus, CS_LINK_STATUS_CONFIG } from '../utils.js';

export { getCsLinkStatus, CS_LINK_STATUS_CONFIG };

// Fixed display order, matching the CS-Link Access table's category strip.
export const CS_LINK_ORDER = ['not_started', 'stage1_pending', 'account_active', 'cslink_pending', 'complete'];

// Returns the five canonical categories with plain labels and counts, in table order.
// These are the ONLY CS-Link categories Keith may report; the legacy single-boolean
// "Needs CS-Link" derivation is retired.
export function summarizeCsLink(students = []) {
  const list = Array.isArray(students) ? students : [];
  const counts = { not_started: 0, stage1_pending: 0, account_active: 0, cslink_pending: 0, complete: 0 };
  for (const s of list) {
    const key = getCsLinkStatus(s);
    counts[key] = (counts[key] || 0) + 1;
  }
  return CS_LINK_ORDER.map(key => ({
    key,
    // strip the leading check glyph from the "✓ CS-Link Active" label for prose
    label: (CS_LINK_STATUS_CONFIG[key]?.label || key).replace(/^✓\s*/, ''),
    count: counts[key] || 0,
  }));
}
