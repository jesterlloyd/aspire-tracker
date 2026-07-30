// Owner/Admin workflow to configure a cohort's unit RESPONSE TARGETS (the denominator for the At a
// Glance responded/pending metric). Add targets from canonical unit choices, remove (auditable
// soft-delete), and restore removed targets. Targeting a unit never creates capacity or a response
// row; that only happens when the unit submits the form. All writes go through the staff-authorized
// server endpoint (owner/admin enforced server-side). Accessible: labelled dialog, keyboard operable.
import { useState, useEffect, useCallback } from 'react'
import { getEligibleUnits } from '../lib/unitCatalog'
import { canonicalUnitKey } from '../lib/canonicalUnit'
import { getAllUnitLeaders } from '../lib/unitLeaders'
import { buildCapacityOutreachRows, capacityOutreachCounts } from '../lib/capacityOutreach'
import {
  listCohortResponseTargets, createCohortResponseTargets,
  deactivateCohortResponseTarget, reactivateCohortResponseTarget,
} from '../lib/cohortResponseTargetsClient'

export default function CohortResponseTargetsModal({ cohortId, cohortName, onClose, onChanged }) {
  const [targets, setTargets] = useState([])
  const [leads, setLeads] = useState([])
  const [ready, setReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toAdd, setToAdd] = useState(() => new Set())   // canonical keys selected to add
  // Manual-fallback guard: the Owner must explicitly confirm the units were already contacted OUTSIDE
  // ASPIRE Connect before this modal will record them. The normal path is Send capacity request.
  const [confirmContacted, setConfirmContacted] = useState(false)

  const refetch = useCallback(async () => {
    // All state updates happen AFTER the await so the mount effect never triggers a synchronous render.
    const { ok, ready: r, targets: rows } = await listCohortResponseTargets(cohortId, { includeInactive: true })
    setReady(r)
    setTargets(ok ? rows : [])
    setError(ok ? '' : 'Could not load response targets.')
    setLoading(false)
  }, [cohortId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [t, l] = await Promise.all([
        listCohortResponseTargets(cohortId, { includeInactive: true }),
        getAllUnitLeaders().catch(() => []),
      ])
      if (!alive) return
      setReady(t.ready); setTargets(t.ok ? t.targets : []); setLeads(Array.isArray(l) ? l : [])
      setError(t.ok ? '' : 'Could not load response targets.'); setLoading(false)
    })()
    return () => { alive = false }
  }, [cohortId])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeCanon = new Set(targets.filter(t => t.is_active).map(t => canonicalUnitKey(t.unit_key)))
  // Full canonical catalog (all 28 units) with division + recipient readiness; NOT public.units.
  const rows = buildCapacityOutreachRows({ catalog: getEligibleUnits(true), leads, activeTargetCanons: activeCanon })
  const addableRows = rows.filter(r => !r.alreadyTarget)
  const counts = capacityOutreachCounts(addableRows, toAdd)

  const toggleAdd = (key) => setToAdd(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const doAdd = async () => {
    const chosen = addableRows.filter(r => toAdd.has(r.key))
    if (!chosen.length) return
    if (chosen.length > 5 && !window.confirm(`Mark ${chosen.length} units as already contacted for ${cohortName || 'this cohort'}? This records them as expected responders without sending anything.`)) return
    setSaving(true); setError('')
    const units = chosen.map(r => ({ unit_key: r.name, unit_name: r.name }))
    const { ok, json } = await createCohortResponseTargets(cohortId, units)
    setSaving(false)
    if (!ok) { setError(json.code === 'TARGETS_NOT_ENABLED' ? 'Response targets are not enabled yet.' : 'Could not add targets.'); return }
    setToAdd(new Set()); setConfirmContacted(false); await refetch(); onChanged?.()
  }

  const setActive = async (t, active) => {
    setSaving(true); setError('')
    const { ok, json } = active
      ? await reactivateCohortResponseTarget(cohortId, t.id)
      : await deactivateCohortResponseTarget(cohortId, t.id)
    setSaving(false)
    if (!ok) { setError(json.code === 'TARGETS_NOT_ENABLED' ? 'Response targets are not enabled yet.' : 'Could not update the target.'); return }
    await refetch(); onChanged?.()
  }

  const active = targets.filter(t => t.is_active)
  const inactive = targets.filter(t => !t.is_active)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Configure response targets" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configure response targets{cohortName ? ` — ${cohortName}` : ''}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-msg" role="alert">{error}</div>}
          {!ready && !loading && (
            <div className="error-msg" role="alert">Response targets are not enabled yet. Ask the Owner to apply the pending migration.</div>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
            Targets are the units expected to respond for this cohort. Pending equals active targets without a
            submitted response. Adding a target never creates capacity or a response.
          </p>

          {loading ? <p>Loading…</p> : (
            <>
              <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }} disabled={!ready || saving}>
                <legend style={{ fontSize: 12, fontWeight: 700 }}>Mark units as already contacted (manual fallback)</legend>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                  For outreach completed outside ASPIRE Connect. The normal path is Send capacity request
                  on At a Glance. Selected {counts.selected} · {counts.sendReady} with a resolvable lead ·
                  {' '}{counts.blocked} without. Marking a unit sends no email and creates no capacity or response.
                </p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {addableRows.length === 0 && <li style={{ fontSize: 12, color: 'var(--text-secondary)' }}>All catalog units are already active targets.</li>}
                  {addableRows.map(r => (
                    <li key={r.key}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <input type="checkbox" checked={toAdd.has(r.key)} onChange={() => toggleAdd(r.key)}
                          aria-label={`${r.name}${r.hasRecipient ? '' : ', no recipient'}`} />
                        <span style={{ flex: 1 }}>{r.name}</span>
                        <span style={{ fontSize: 10, color: '#6b7280' }}>{r.division}{r.defaultEligible ? '' : ' · default-ineligible'}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: r.hasRecipient ? '#166534' : '#92400e' }}>
                          {r.hasRecipient ? 'Recipient ✓' : 'No recipient'}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, marginTop: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmContacted} onChange={e => setConfirmContacted(e.target.checked)}
                    style={{ marginTop: 2 }} />
                  <span>I confirm these units already received the capacity request outside ASPIRE Connect.</span>
                </label>
                <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={doAdd}
                  disabled={!counts.selected || !confirmContacted || saving}>
                  {saving ? 'Saving…' : 'Mark units as already contacted'}
                </button>
              </fieldset>

              <div className="form-field">
                <span style={{ fontSize: 12, fontWeight: 700 }}>Active targets ({active.length})</span>
                <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {active.length === 0 && <li style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No active targets yet.</li>}
                  {active.map(t => (
                    <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                      <span>{t.unit_name}</span>
                      <button className="btn btn-outline-modal" onClick={() => setActive(t, false)} disabled={saving} aria-label={`Remove ${t.unit_name}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              </div>

              {inactive.length > 0 && (
                <div className="form-field">
                  <span style={{ fontSize: 12, fontWeight: 700 }}>Removed targets ({inactive.length})</span>
                  <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {inactive.map(t => (
                      <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                        <span>{t.unit_name}</span>
                        <button className="btn btn-outline-modal" onClick={() => setActive(t, true)} disabled={saving} aria-label={`Restore ${t.unit_name}`}>Restore</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
