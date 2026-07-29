// Owner/Admin workflow to configure a cohort's unit RESPONSE TARGETS (the denominator for the At a
// Glance responded/pending metric). Add targets from canonical unit choices, remove (auditable
// soft-delete), and restore removed targets. Targeting a unit never creates capacity or a response
// row; that only happens when the unit submits the form. All writes go through the staff-authorized
// server endpoint (owner/admin enforced server-side). Accessible: labelled dialog, keyboard operable.
import { useState, useEffect, useCallback } from 'react'
import { getCanonicalUnitNames } from '../lib/unitCatalog'
import { canonicalUnitKey } from '../lib/canonicalUnit'
import {
  listCohortResponseTargets, createCohortResponseTargets,
  deactivateCohortResponseTarget, reactivateCohortResponseTarget,
} from '../lib/cohortResponseTargetsClient'

export default function CohortResponseTargetsModal({ cohortId, cohortName, onClose, onChanged }) {
  const [targets, setTargets] = useState([])
  const [ready, setReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toAdd, setToAdd] = useState(() => new Set())

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
      const { ok, ready: r, targets: rows } = await listCohortResponseTargets(cohortId, { includeInactive: true })
      if (!alive) return
      setReady(r); setTargets(ok ? rows : []); setError(ok ? '' : 'Could not load response targets.'); setLoading(false)
    })()
    return () => { alive = false }
  }, [cohortId])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeCanon = new Set(targets.filter(t => t.is_active).map(t => canonicalUnitKey(t.unit_key)))
  const addable = getCanonicalUnitNames().filter(n => !activeCanon.has(canonicalUnitKey(n)))

  const toggleAdd = (name) => setToAdd(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  const doAdd = async () => {
    const names = [...toAdd]
    if (!names.length) return
    if (names.length > 5 && !window.confirm(`Add ${names.length} response targets to ${cohortName || 'this cohort'}?`)) return
    setSaving(true); setError('')
    const units = names.map(n => ({ unit_key: n, unit_name: n }))
    const { ok, json } = await createCohortResponseTargets(cohortId, units)
    setSaving(false)
    if (!ok) { setError(json.code === 'TARGETS_NOT_ENABLED' ? 'Response targets are not enabled yet.' : 'Could not add targets.'); return }
    setToAdd(new Set()); await refetch(); onChanged?.()
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
                <legend style={{ fontSize: 12, fontWeight: 700 }}>Add targets</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {addable.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>All catalog units are already active targets.</span>}
                  {addable.map(n => (
                    <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={toAdd.has(n)} onChange={() => toggleAdd(n)} />
                      {n}
                    </label>
                  ))}
                </div>
                <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={doAdd} disabled={!toAdd.size || saving}>
                  {saving ? 'Saving…' : `Add ${toAdd.size || ''} target${toAdd.size === 1 ? '' : 's'}`.trim()}
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
