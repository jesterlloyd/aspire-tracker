// HOME-1 (Owner, 2026-09-25): Unit Setup is a compact table. One line per unit, grouped by
// service line: a checkbox, the unit and its patient population, a slots stepper and the shift.
// Contact, preceptors and considerations sit behind Details. A search, a Participating only
// switch, and a pinned summary (units, slots, proceeding students) make it one workflow:
// choose, size, check the total, save. handleSave is UNCHANGED: the same fields, written the
// same way (an unchecked unit is marked not participating, never deleted).
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'
import { SHIFT_OPTIONS, PATIENT_POPULATION_MAP, UNIT_DIVISION_MAP } from '../lib/constants'
import { buildSetup, setupTotals, divisionTotals, visibleDivisions, clampSlots, MIN_SLOTS, MAX_SLOTS } from '../lib/unitSetupModel'
import SegmentedPicker from './shared/SegmentedPicker'
import DetailDrawer from './ui/DetailDrawer'
import './unitSetup.css'

export default function UnitSetupPanel({ cohortId, currentUnits, students, onSaved, onClose }) {
  const initialized = useRef(false)
  const [setup,  setSetup]  = useState({})
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState('all')          // 'all' | 'participating'
  const [open, setOpen] = useState(() => new Set())  // units whose Details are open

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
      if (!prev || (!prev.patient_population && u.patient_population)) seen.set(u.unit_name, u)
    }
    return [...seen.values()]
  }, [rawCatalog])

  // Initialize setup state once when catalog first loads
  useEffect(() => {
    if (!initialized.current && catalog.length > 0) {
      initialized.current = true
      setSetup(buildSetup(catalog, currentUnits))
    }
  }, [catalog]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes, like every other panel.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const upd = useCallback((unitName, field, value) => {
    setSetup(prev => ({ ...prev, [unitName]: { ...prev[unitName], [field]: value } }))
  }, [])
  const toggleOpen = (name) => setOpen(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

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
      const { error: e } = await safeWrite(
        () => supabase.from('units').update(data).eq('id', id),
        { name: 'update unit setup' }
      )
      if (e) { err = e; break }
    }
    if (!err && toInsert.length) {
      const { error: e } = await safeWrite(
        () => supabase.from('units').insert(toInsert),
        { name: 'insert units setup' }
      )
      if (e) err = e
    }

    if (err) { setError(err.message); setSaving(false); return }
    await onSaved()
    onClose()
  }


  const totals = setupTotals(setup, students)
  const divisions = visibleDivisions(catalog, setup, { query, participatingOnly: view === 'participating' })

  const close = () => { if (!saving) onClose() }

  const footer = (
    <div className="us-foot">
      <p className={`us-summary${totals.covered ? ' is-covered' : ' is-short'}`} role="status">
        <b>{totals.units}</b> unit{totals.units === 1 ? '' : 's'} · <b>{totals.slots}</b> slot{totals.slots === 1 ? '' : 's'} · <b>{totals.proceeding}</b> proceeding student{totals.proceeding === 1 ? '' : 's'}
        <span className="us-verdict">{totals.covered
          ? (totals.spare ? `${totals.spare} spare slot${totals.spare === 1 ? '' : 's'}` : 'Every student has a slot')
          : `${totals.short} slot${totals.short === 1 ? '' : 's'} short`}</span>
      </p>
      <div className="us-actions">
        <button type="button" className="btn btn-outline-modal" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : `Save ${totals.units} Unit${totals.units !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )

  // HOME-1 (Owner, 2026-09-25): the app's standard side drawer, as School and Unit responses
  // use it, wider (860px) so each unit keeps one line. No accent edge.
  return (
    <DetailDrawer open title="Unit Setup" onClose={close} width={860} footer={footer}>
      <div className="us-panel">
        <p className="us-sub">Choose the units hosting this cohort and how many students each can take.</p>
        <div className="us-tools">
          <label className="us-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search units, populations or service lines" aria-label="Search units" />
          </label>
          <SegmentedPicker ariaLabel="Which units" value={view} onChange={setView} size="sm"
            options={[{ value: 'all', label: 'All units' }, { value: 'participating', label: `Participating only (${totals.units})` }]} />
        </div>

        {error && <div className="error-msg" role="alert" style={{ margin: '0 0 12px' }}>{error}</div>}

        <div className="us-body">
          {catalogLoading ? (
            <p className="us-empty">Loading units…</p>
          ) : divisions.length === 0 ? (
            <p className="us-empty">{view === 'participating' ? 'No units are participating yet.' : 'No units match this search.'}</p>
          ) : divisions.map(([division, units]) => {
            const dt = divisionTotals(units, setup)
            return (
              <section key={division} className="us-division" aria-label={division}>
                <div className="us-division-head">
                  <h3>{division}</h3>
                  <span>{dt.participating} of {dt.total} participating · {dt.slots} slot{dt.slots === 1 ? '' : 's'}</span>
                </div>
                <div className="us-cols" aria-hidden="true"><span /><span>Unit</span><span>Slots</span><span>Shift</span><span /></div>
                <ul className="us-rows">
                  {units.map(({ unit_name: unitName, patient_population: pop }) => {
                    const cfg = setup[unitName] || {}
                    const on = !!cfg.checked
                    const isOpen = open.has(unitName)
                    const detailId = `us-detail-${unitName.replace(/[^a-z0-9]/gi, '-')}`
                    return (
                      <li key={unitName} className={`us-row${on ? ' is-on' : ''}${isOpen ? ' is-open' : ''}`}>
                        <div className="us-line">
                          <input type="checkbox" className="us-check" checked={on} aria-label={`${unitName} participates`}
                            onChange={e => upd(unitName, 'checked', e.target.checked)} />
                          <div className="us-unit">
                            <span className="us-name">{unitName}</span>
                            {pop && <span className="us-pop" title={pop}>{pop}</span>}
                          </div>
                          <div className="us-stepper" aria-label={`${unitName} slots`}>
                            <button type="button" disabled={!on || cfg.slots <= MIN_SLOTS} aria-label={`Fewer slots for ${unitName}`}
                              onClick={() => upd(unitName, 'slots', clampSlots(cfg.slots - 1))}><Minus size={13} aria-hidden="true" /></button>
                            <input type="text" inputMode="numeric" disabled={!on} value={cfg.slots ?? ''} aria-label={`Slots for ${unitName}`}
                              onChange={e => upd(unitName, 'slots', clampSlots(e.target.value.replace(/\D/g, '') || MIN_SLOTS))} />
                            <button type="button" disabled={!on || cfg.slots >= MAX_SLOTS} aria-label={`More slots for ${unitName}`}
                              onClick={() => upd(unitName, 'slots', clampSlots(cfg.slots + 1))}><Plus size={13} aria-hidden="true" /></button>
                          </div>
                          <select className="us-select" disabled={!on} value={cfg.shift} aria-label={`Shift for ${unitName}`}
                            onChange={e => upd(unitName, 'shift', e.target.value)}>
                            {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button type="button" className="us-details-btn" disabled={!on} aria-expanded={on && isOpen} aria-controls={detailId}
                            onClick={() => toggleOpen(unitName)}>
                            {on && isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} Details
                          </button>
                        </div>
                        {on && isOpen && (
                          <div className="us-detail" id={detailId}>
                            <label><span>Contact person</span>
                              <input value={cfg.contact} onChange={e => upd(unitName, 'contact', e.target.value)} placeholder="Name" /></label>
                            <label><span>Preceptors</span>
                              <input value={cfg.preceptors} onChange={e => upd(unitName, 'preceptors', e.target.value)} placeholder="Names, comma-separated" /></label>
                            <label className="us-detail-wide"><span>Considerations</span>
                              <textarea rows={2} value={cfg.considerations} onChange={e => upd(unitName, 'considerations', e.target.value)} placeholder="Special requirements, scheduling notes…" /></label>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>

      </div>
    </DetailDrawer>
  )
}
