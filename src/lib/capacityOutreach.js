// Capacity-response outreach: pure helpers for the Owner/Admin unit selector. The available-unit list
// is the canonical catalog (src/lib/unitCatalog), NEVER public.units, so a unit is shown even when it
// has no cohort row. Each unit resolves its active primary lead (recipient readiness) from unit_leaders.
// Identity is the canonical unit key (never a display label); aliases collapse to one row.
import { canonicalUnitKey } from './canonicalUnit.js'

// Build one row per canonical catalog unit with division, eligibility, recipient readiness, and whether
// it is already an active target.
//   catalog:            [{ name, division, defaultEligible }]  (unitCatalog getEligibleUnits(true))
//   leads:              [{ unit_name, email, is_primary_lead, is_active }]  (unit_leaders rows)
//   activeTargetCanons: iterable of canonical keys already active as targets
export function buildCapacityOutreachRows({ catalog = [], leads = [], activeTargetCanons } = {}) {
  const active = activeTargetCanons instanceof Set ? activeTargetCanons : new Set(activeTargetCanons || [])

  // Best active lead (with an email) per canonical unit key; prefer the primary lead.
  const leadByCanon = new Map()
  for (const l of leads) {
    if (!l || l.is_active === false) continue
    const c = canonicalUnitKey(l.unit_name)
    const email = (l.email || '').trim()
    if (!c || !email) continue
    const prev = leadByCanon.get(c)
    if (!prev || (l.is_primary_lead && !prev.is_primary_lead)) leadByCanon.set(c, { ...l, email })
  }

  const seen = new Set()
  const rows = []
  for (const u of catalog) {
    if (!u || !u.name) continue
    const key = canonicalUnitKey(u.name)
    if (!key || seen.has(key)) continue          // aliases / duplicates collapse
    seen.add(key)
    const lead = leadByCanon.get(key) || null
    rows.push({
      name: u.name,
      key,
      division: u.division || 'Other',
      defaultEligible: u.defaultEligible !== false,
      hasRecipient: !!lead,
      recipientEmail: lead ? lead.email : '',
      alreadyTarget: active.has(key),
    })
  }
  return rows
}

// Selection counts for the UI. A selected unit is "send-ready" only when it has a resolvable recipient;
// one without a recipient is "blocked" (visibly flagged, never silently sent/expected).
export function capacityOutreachCounts(rows, selectedKeys) {
  const sel = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || [])
  let selected = 0, sendReady = 0, blocked = 0
  for (const r of rows) {
    if (!sel.has(r.key)) continue
    selected += 1
    if (r.hasRecipient) sendReady += 1
    else blocked += 1
  }
  return { selected, sendReady, blocked }
}
