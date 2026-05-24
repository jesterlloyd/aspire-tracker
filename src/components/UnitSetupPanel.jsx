import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { SHIFT_OPTIONS, PATIENT_POPULATION_MAP, UNIT_DIVISION_MAP } from '../lib/constants'

function buildSetup(catalog, currentUnits) {
  const setup = {}
  for (const { unit_name, patient_population, division } of catalog) {
    const ex = currentUnits.find(u => u.unit_name === unit_name)
    setup[unit_name] = {
      checked:            !!(ex && ex.is_participating !== false),
      slots:              ex?.total_slots        ?? 1,
      shift:              ex?.shift_preference   ?? 'Either',
      contact:            ex?.contact_person     ?? '',
      preceptors:         ex?.preceptors         ?? '',
      considerations:     ex?.considerations     ?? '',
      patient_population: ex?.patient_population ?? patient_population ?? '',
      showConsiderations: !!(ex?.considerations),
      existingId:         ex?.id                 ?? null,
      division:           ex?.division ?? division ?? '',
    }
  }
  return setup
}

export default function UnitSetupPanel({ cohortId, currentUnits, students, onSaved, onClose }) {
  const initialized = useRef(false)
  const [setup,  setSetup]  = useState({})
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  // Fetch canonical unit names from the units table (all cohorts, deduplicated by unit_name)
  const { data: rawCatalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: ['unit-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units')
        .select('unit_name, division, patient_population')
        .order('division')
        .order('unit_name')
      if (error) throw error
      return data
    },
    staleTime: 5 * 60 * 1000,
  })

  // Deduplicate by unit_name, keeping the most complete record
  const catalog = useMemo(() => {
    const seen = new Map()
    for (const u of rawCatalog) {
      const prev = seen.get(u.unit_name)
      if (!prev || (!prev.patient_population && u.patient_population)) {
        seen.set(u.unit_name, u)
      }
    }
    return [...seen.values()]
  }, [rawCatalog])

  // Group by division for display
  const byDivision = useMemo(() => {
    const map = {}
    for (const u of catalog) {
      const div = u.division || 'Other'
      if (!map[div]) map[div] = []
      map[div].push(u)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])

  // Initialize setup state once when catalog first loads
  useEffect(() => {
    if (!initialized.current && catalog.length > 0) {
      initialized.current = true
      setSetup(buildSetup(catalog, currentUnits))
    }
  }, [catalog]) // eslint-disable-line react-hooks/exhaustive-deps

  const upd = useCallback((unitName, field, value) => {
    setSetup(prev => ({ ...prev, [unitName]: { ...prev[unitName], [field]: value } }))
  }, [])

  const handleSave = async () => {
    if (!cohortId) { setError('No active cohort.'); return }
    setSaving(true); setError(null)

    const toInsert = []
    const toUpdate = []

    for (const [unitName, cfg] of Object.entries(setup)) {
      if (cfg.checked) {
        const filledCount = cfg.existingId
          ? students.filter(s => s.matched_unit_id === cfg.existingId).length : 0
        const record = {
          unit_name:          unitName,
          contact_person:     cfg.contact,
          total_slots:        cfg.slots,
          slots_remaining:    Math.max(0, cfg.slots - filledCount),
          shift_preference:   cfg.shift,
          preceptors:         cfg.preceptors,
          considerations:     cfg.considerations,
          patient_population: cfg.patient_population || PATIENT_POPULATION_MAP[unitName] || '',
          division:           cfg.division || UNIT_DIVISION_MAP[unitName] || '',
          is_participating:   true,
          cohort_id:          cohortId,
        }
        if (cfg.existingId) toUpdate.push({ id: cfg.existingId, ...record })
        else toInsert.push(record)
      } else if (cfg.existingId) {
        toUpdate.push({ id: cfg.existingId, is_participating: false })
      }
    }

    let err = null
    for (const { id, ...data } of toUpdate) {
      const { error: e } = await supabase.from('units').update(data).eq('id', id)
      if (e) { err = e; break }
    }
    if (!err && toInsert.length) {
      const { error: e } = await supabase.from('units').insert(toInsert)
      if (e) err = e
    }

    if (err) { setError(err.message); setSaving(false); return }
    await onSaved()
    onClose()
  }

  const totalChecked = Object.values(setup).filter(v => v.checked).length

  return (
    <div className="fullscreen-panel-overlay" onClick={onClose}>
      <div className="fullscreen-panel" onClick={e => e.stopPropagation()}>
        <div className="fsp-header">
          <div>
            <h2 className="fsp-title">Unit Setup</h2>
            <p className="fsp-sub">{totalChecked} units selected as participating</p>
          </div>
          <button className="modal-close fsp-close" onClick={onClose}>×</button>
        </div>

        {error && <div className="error-msg" style={{ margin: '0 24px 16px' }}>{error}</div>}

        <div className="fsp-body">
          {catalogLoading ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
              Loading units…
            </div>
          ) : (
            byDivision.map(([division, units]) => (
              <div key={division} className="usp-division">
                <div className="usp-division-label">{division}</div>
                <div className="usp-unit-list">
                  {units.map(({ unit_name: unitName, patient_population: pop }) => {
                    const cfg = setup[unitName] || {}
                    return (
                      <div key={unitName} className={`usp-unit-row${cfg.checked ? ' usp-checked' : ''}`}>
                        <label className="usp-checkbox-label">
                          <input type="checkbox" checked={cfg.checked || false}
                            onChange={e => upd(unitName, 'checked', e.target.checked)} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span className="usp-unit-name">{unitName}</span>
                            {pop && <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{pop}</span>}
                          </div>
                        </label>

                        {cfg.checked && (
                          <div className="usp-unit-fields">
                            <div className="usp-field-group">
                              <label className="usp-field-label">Slots</label>
                              <input className="usp-input usp-input-sm" type="text" inputMode="numeric" pattern="[0-9]*"
                                value={cfg.slots}
                                onChange={e => upd(unitName, 'slots', parseInt(e.target.value) || 1)} />
                            </div>
                            <div className="usp-field-group">
                              <label className="usp-field-label">Shift</label>
                              <select className="usp-select" value={cfg.shift}
                                onChange={e => upd(unitName, 'shift', e.target.value)}>
                                {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="usp-field-group usp-field-grow">
                              <label className="usp-field-label">Contact Person</label>
                              <input className="usp-input" value={cfg.contact}
                                onChange={e => upd(unitName, 'contact', e.target.value)}
                                placeholder="Name" />
                            </div>
                            <div className="usp-field-group usp-field-grow">
                              <label className="usp-field-label">Preceptors</label>
                              <input className="usp-input" value={cfg.preceptors}
                                onChange={e => upd(unitName, 'preceptors', e.target.value)}
                                placeholder="Names, comma-separated" />
                            </div>
                            <div className="usp-considerations-toggle">
                              <button type="button" className="usp-considerations-btn"
                                onClick={() => upd(unitName, 'showConsiderations', !cfg.showConsiderations)}>
                                {cfg.showConsiderations ? '▾' : '▸'} Considerations
                              </button>
                              {cfg.showConsiderations && (
                                <textarea className="usp-textarea" rows={2}
                                  value={cfg.considerations}
                                  onChange={e => upd(unitName, 'considerations', e.target.value)}
                                  placeholder="Special requirements, scheduling notes…" />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="fsp-footer">
          <button type="button" className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : `Save ${totalChecked} Unit${totalChecked !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
