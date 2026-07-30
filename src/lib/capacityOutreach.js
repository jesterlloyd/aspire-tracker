// Capacity-response outreach: pure helpers for the Owner/Admin unit selector. The available-unit list
// is the canonical catalog (src/lib/unitCatalog), NEVER public.units, so a unit is shown even when it
// has no cohort row. Each unit resolves its active primary lead (recipient readiness) from unit_leaders.
// Identity is the canonical unit key (never a display label); aliases collapse to one row.
import { canonicalUnitKey } from './canonicalUnit.js'

// Build one row per canonical catalog unit with division, eligibility, recipient readiness, and whether
// it is already an active target.
//   catalog:            [{ name, division, defaultEligible }]  (unitCatalog getEligibleUnits(true))
//   leads:              [{ unit_name, email, role, is_primary_lead, is_active }]  (unit_leaders rows)
//   activeTargetCanons: iterable of canonical keys already active as targets
//   recipientRoles:     optional Set of role names (CAPACITY-FILTER-REMINDER-1). When provided, each
//                       row's recipientEmails collects EVERY active leader whose role is in the set
//                       (primary lead first, lowercased-deduped), falling back to the active primary
//                       lead when no role matches so no previously reachable unit becomes unreachable.
//                       Without it, behavior is unchanged: one best (primary-preferred) lead.
export function buildCapacityOutreachRows({ catalog = [], leads = [], activeTargetCanons, recipientRoles } = {}) {
  const active = activeTargetCanons instanceof Set ? activeTargetCanons : new Set(activeTargetCanons || [])
  const roles = recipientRoles instanceof Set ? recipientRoles : (recipientRoles ? new Set(recipientRoles) : null)

  // Active leads (with an email) per canonical unit key: best single lead (primary preferred) plus,
  // when recipientRoles is given, the full role-matched recipient list.
  const leadByCanon = new Map()
  const roleEmailsByCanon = new Map()
  for (const l of leads) {
    if (!l || l.is_active === false) continue
    const c = canonicalUnitKey(l.unit_name)
    const email = (l.email || '').trim()
    if (!c || !email) continue
    const prev = leadByCanon.get(c)
    if (!prev || (l.is_primary_lead && !prev.is_primary_lead)) leadByCanon.set(c, { ...l, email })
    if (roles && roles.has(l.role)) {
      if (!roleEmailsByCanon.has(c)) roleEmailsByCanon.set(c, [])
      roleEmailsByCanon.get(c).push({ email, isPrimary: !!l.is_primary_lead })
    }
  }

  const seen = new Set()
  const rows = []
  for (const u of catalog) {
    if (!u || !u.name) continue
    const key = canonicalUnitKey(u.name)
    if (!key || seen.has(key)) continue          // aliases / duplicates collapse
    seen.add(key)
    const lead = leadByCanon.get(key) || null
    // Role-matched recipients (primary first, deduped case-insensitively); fallback to the best lead.
    let recipientEmails = []
    if (roles) {
      const matched = (roleEmailsByCanon.get(key) || []).sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
      const dedup = new Set()
      for (const m of matched) {
        const low = m.email.toLowerCase()
        if (dedup.has(low)) continue
        dedup.add(low)
        recipientEmails.push(m.email)
      }
      if (recipientEmails.length === 0 && lead) recipientEmails = [lead.email]
    } else if (lead) {
      recipientEmails = [lead.email]
    }
    rows.push({
      name: u.name,
      key,
      division: u.division || 'Other',
      defaultEligible: u.defaultEligible !== false,
      hasRecipient: recipientEmails.length > 0,
      recipientEmail: recipientEmails[0] || '',
      recipientEmails,
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
