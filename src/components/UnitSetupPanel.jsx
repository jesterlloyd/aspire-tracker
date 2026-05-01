import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { UNIT_ROSTER, SHIFT_OPTIONS } from '../lib/constants'

function buildInitialSetup(currentUnits) {
  const setup = {}
  for (const units of Object.values(UNIT_ROSTER)) {
    for (const name of units) {
      const ex = currentUnits.find(u => u.unit_name === name)
      setup[name] = {
        checked:          !!(ex && ex.is_participating !== false),
        slots:            ex?.total_slots       ?? 1,
        shift:            ex?.shift_preference  ?? 'Either',
        contact:          ex?.contact_person    ?? '',
        preceptors:       ex?.preceptors        ?? '',
        considerations:   ex?.considerations    ?? '',
        showConsiderations: !!(ex?.considerations),
        existingId:       ex?.id                ?? null,
      }
    }
  }
  return setup
}

export default function UnitSetupPanel({ cohortId, currentUnits, students, onSaved, onClose }) {
  const [setup,   setSetup]   = useState(() => buildInitialSetup(currentUnits))
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  const upd = useCallback((unitName, field, value) => {
    setSetup(prev => ({
      ...prev,
      [unitName]: { ...prev[unitName], [field]: value },
    }))
  }, [])

  const handleSave = async () => {
    if (!cohortId) { setError('No active cohort.'); return }
    setSaving(true)
    setError(null)

    const toInsert = []
    const toUpdate = []

    for (const [unitName, cfg] of Object.entries(setup)) {
      if (cfg.checked) {
        const filledCount = cfg.existingId
          ? students.filter(s => s.matched_unit_id === cfg.existingId).length
          : 0
        const record = {
          unit_name:       unitName,
          contact_person:  cfg.contact,
          total_slots:     cfg.slots,
          slots_remaining: Math.max(0, cfg.slots - filledCount),
          shift_preference: cfg.shift,
          preceptors:      cfg.preceptors,
          considerations:  cfg.considerations,
          is_participating: true,
          cohort_id:       cohortId,
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

    if (err) {
      setError(err.message)
      setSaving(false)
      return
    }
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
          {Object.entries(UNIT_ROSTER).map(([division, units]) => (
            <div key={division} className="usp-division">
              <div className="usp-division-label">{division}</div>
              <div className="usp-unit-list">
                {units.map(unitName => {
                  const cfg = setup[unitName] || {}
                  return (
                    <div key={unitName} className={`usp-unit-row${cfg.checked ? ' usp-checked' : ''}`}>
                      <label className="usp-checkbox-label">
                        <input
                          type="checkbox"
                          checked={cfg.checked || false}
                          onChange={e => upd(unitName, 'checked', e.target.checked)}
                        />
                        <span className="usp-unit-name">{unitName}</span>
                      </label>

                      {cfg.checked && (
                        <div className="usp-unit-fields">
                          <div className="usp-field-group">
                            <label className="usp-field-label">Slots</label>
                            <input
                              className="usp-input usp-input-sm"
                              type="number"
                              min="1"
                              max="20"
                              value={cfg.slots}
                              onChange={e => upd(unitName, 'slots', parseInt(e.target.value) || 1)}
                            />
                          </div>
                          <div className="usp-field-group">
                            <label className="usp-field-label">Shift</label>
                            <select
                              className="usp-select"
                              value={cfg.shift}
                              onChange={e => upd(unitName, 'shift', e.target.value)}
                            >
                              {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div className="usp-field-group usp-field-grow">
                            <label className="usp-field-label">Contact Person</label>
                            <input
                              className="usp-input"
                              value={cfg.contact}
                              onChange={e => upd(unitName, 'contact', e.target.value)}
                              placeholder="Name"
                            />
                          </div>
                          <div className="usp-field-group usp-field-grow">
                            <label className="usp-field-label">Preceptors</label>
                            <input
                              className="usp-input"
                              value={cfg.preceptors}
                              onChange={e => upd(unitName, 'preceptors', e.target.value)}
                              placeholder="Names, comma-separated"
                            />
                          </div>
                          <div className="usp-considerations-toggle">
                            <button
                              type="button"
                              className="usp-considerations-btn"
                              onClick={() => upd(unitName, 'showConsiderations', !cfg.showConsiderations)}
                            >
                              {cfg.showConsiderations ? '▾' : '▸'} Considerations
                            </button>
                            {cfg.showConsiderations && (
                              <textarea
                                className="usp-textarea"
                                rows={2}
                                value={cfg.considerations}
                                onChange={e => upd(unitName, 'considerations', e.target.value)}
                                placeholder="Special requirements, scheduling notes…"
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
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
