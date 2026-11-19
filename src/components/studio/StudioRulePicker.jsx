// src/components/studio/StudioRulePicker.jsx
//
// STUDIO-2: build an audience rule (src/lib/studio/audienceCatalog.js). The choices come from
// /api/studio audience_options in the request's population; the rule itself names no address, and
// the server resolves it when the sender asks to see the list.

import { useEffect, useState } from 'react'
import {
  POPULATIONS, RULE_STATUSES, STUDENT_EMAIL_ROUTES, FORM_FILTERS, LICENSE_FILTERS, HIRE_FILTERS,
  MAX_COHORTS, RESPONSE_STATES, sanitizeRule, ruleProblem,
} from '../../lib/studio/audienceCatalog'
import { studioApi } from '../../lib/studio/studioClient'

const toggleIn = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

export default function StudioRulePicker({ rule, onRule }) {
  const r = sanitizeRule(rule)
  const [opts, setOpts] = useState(null)
  const [error, setError] = useState('')
  const cohortKey = r.population === 'students' ? r.cohortIds.join(',') : ''

  useEffect(() => {
    let off = false
    studioApi('audience_options', { rule: { population: r.population, cohortIds: cohortKey ? cohortKey.split(',') : [] } })
      .then(o => { if (!off) { setOpts(o); setError('') } })
      .catch(e => { if (!off) setError(e.message || 'The choices could not be loaded.') })
    return () => { off = true }
  }, [r.population, cohortKey])

  // STUDIO-FILTERS-1: a live count, so a filter can be tried before anyone is reviewed. It asks the
  // same resolve the review does (reads only, nothing stored), half a second after the last change.
  const ruleKey = JSON.stringify(r)
  const [count, setCount] = useState(null)
  useEffect(() => {
    let off = false
    const ready = !ruleProblem(r)
    const t = setTimeout(() => {
      if (!ready) { setCount(null); return }
      setCount(c => ({ ...(c || {}), loading: true }))
      studioApi('audience_resolve', { rule: r })
        .then(res => { if (!off) setCount({ n: res.recipients.length, left: res.excluded.length }) })
        .catch(() => { if (!off) setCount(null) })
    }, 500)
    return () => { off = true; clearTimeout(t) }
  }, [ruleKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => onRule(sanitizeRule({ ...r, ...patch }))
  const pickPopulation = (population) => onRule(sanitizeRule({ population, cohortIds: r.cohortIds || [] }))

  return (
    <div className="st-rule">
      <div className="st-field">
        <span className="st-label" id="st-pop-label">Who</span>
        <div className="st-seg st-seg-fill" role="group" aria-labelledby="st-pop-label">
          {POPULATIONS.map(p => (
            <button key={p.key} type="button" aria-pressed={r.population === p.key} onClick={() => pickPopulation(p.key)}>{p.label}</button>
          ))}
        </div>
        <p className="st-hint">{POPULATIONS.find(p => p.key === r.population)?.line}</p>
      </div>
      {error && <p className="st-notice st-notice-bad">{error}</p>}

      {r.population === 'students' && (
        <>
          <CheckGroup label={`ASPIRE cohort (up to ${MAX_COHORTS})`} loading={!opts}
            items={(opts?.cohorts || []).map(c => ({ key: c.id, label: c.name, note: c.status }))}
            checked={r.cohortIds} onToggle={(id) => set({ cohortIds: toggleIn(r.cohortIds, id) })} />
          <CheckGroup label="Status" hint="None ticked means every status. Not Proceeding is never included by a rule."
            items={RULE_STATUSES.map(s => ({ key: s, label: s }))} checked={r.statuses} columns
            onToggle={(s) => set({ statuses: toggleIn(r.statuses, s) })} />
          {r.cohortIds.length > 0 && (
            <CheckGroup label="School" hint="None ticked means every school." loading={!opts}
              items={(opts?.schools || []).map(s => ({ key: s, label: s }))} checked={r.schools}
              onToggle={(s) => set({ schools: toggleIn(r.schools, s) })} empty="No schools on these cohorts' students." />
          )}
          <div className="st-field">
            <label className="st-label" htmlFor="st-route">Send to</label>
            <select id="st-route" className="st-select" value={r.emailRoute} onChange={e => set({ emailRoute: e.target.value })}>
              {STUDENT_EMAIL_ROUTES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <p className="st-hint">{STUDENT_EMAIL_ROUTES.find(o => o.key === r.emailRoute)?.line || ''}</p>
          </div>
        </>
      )}

      {r.population === 'alumni' && (
        <>
          <div className="st-field">
            <label className="st-label" htmlFor="st-cycle">Residency cohort</label>
            <select id="st-cycle" className="st-select" value={r.cycleId || ''} onChange={e => set({ cycleId: e.target.value || null })}>
              <option value="">Choose a residency cohort</option>
              {(opts?.cycles || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.status ? ` (${c.status})` : ''}</option>)}
            </select>
            <p className="st-hint">Each alumnus is emailed where Residency writes to them: Cedars-Sinai once hired, else the Transition Form's preferred email, else personal.</p>
          </div>
          <div className="st-field">
            <label className="st-label" htmlFor="st-form">Transition Form</label>
            <select id="st-form" className="st-select" value={r.form} onChange={e => set({ form: e.target.value })}>
              {FORM_FILTERS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <CheckGroup label="Licensure" hint="None ticked means anyone." items={LICENSE_FILTERS.map(o => ({ key: o.key, label: o.label }))}
            checked={r.license} columns onToggle={(k) => set({ license: toggleIn(r.license, k) })} />
          <div className="st-field">
            <label className="st-label" htmlFor="st-hired">Hire</label>
            <select id="st-hired" className="st-select" value={r.hired} onChange={e => set({ hired: e.target.value })}>
              {HIRE_FILTERS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </>
      )}

      {r.population === 'contacts' && (
        <>
          <CheckGroup label="Category" hint="None ticked means every active contact."
            items={(opts?.categories || []).map(c => ({ key: c, label: c }))} loading={!opts} checked={r.categories} columns
            onToggle={(c) => set({ categories: toggleIn(r.categories, c) })} />
          <CheckGroup label="Division" hint="Anyone who holds a unit in a ticked division. None ticked means every division."
            items={(opts?.divisions || []).map(d => ({ key: d, label: d }))} loading={!opts} checked={r.divisions} columns
            onToggle={(d) => set({ divisions: toggleIn(r.divisions, d) })} empty="No contact holds a unit yet." />
          <CheckGroup label="Unit" hint="Anyone who holds a ticked unit, as their own or a related unit. None ticked means every unit."
            items={(opts?.units || []).filter(u => !r.divisions.length || r.divisions.includes(u.division)).map(u => ({ key: u.name, label: u.name, note: u.division || '' }))}
            loading={!opts} checked={r.units} columns
            onToggle={(u) => set({ units: toggleIn(r.units, u) })} empty="No units in these divisions." />
          <CheckGroup label="Title" hint="None ticked means every title."
            items={(opts?.titles || []).map(t => ({ key: t, label: t }))} loading={!opts} checked={r.titles} columns
            onToggle={(t) => set({ titles: toggleIn(r.titles, t) })} />
          <label className="st-check st-field">
            <input type="checkbox" checked={r.leadsOnly} onChange={e => set({ leadsOnly: e.target.checked })} />
            <span>Unit leads only<small> Each unit's Associate Director, else its Director, as in Connect</small></span>
          </label>
          <fieldset className="st-field st-fieldset">
            <legend className="st-label">Response to a cohort's request</legend>
            <select className="st-select" aria-label="Cohort" value={r.response.cohortId || ''}
              onChange={e => set({ response: { cohortId: e.target.value || null, state: e.target.value ? (r.response.state === 'any' ? 'pending' : r.response.state) : 'any' } })}>
              <option value="">Any response (no filter)</option>
              {(opts?.cohorts || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.status ? ` (${c.status})` : ''}</option>)}
            </select>
            {r.response.cohortId && (
              <div className="st-seg st-seg-fill" role="group" aria-label="Response" style={{ marginTop: 8 }}>
                {RESPONSE_STATES.map(o => (
                  <button key={o.key} type="button" aria-pressed={r.response.state === o.key}
                    onClick={() => set({ response: { ...r.response, state: o.key } })}>{o.label}</button>
                ))}
              </div>
            )}
            <p className="st-hint">Unit leaders answer by their units' capacity request for that cohort, as At a Glance counts it. Academic Partners answer by whether their school has sent that cohort any students.</p>
          </fieldset>
        </>
      )}
      {count && (
        <p className="st-count" aria-live="polite">
          {count.loading && count.n == null ? 'Counting…' : `${count.n} ${count.n === 1 ? 'person matches' : 'people match'}${count.left ? `, ${count.left} left out` : ''}. See who it reaches to check every name.`}
        </p>
      )}
    </div>
  )
}

function CheckGroup({ label, hint, items, checked, onToggle, loading, columns, empty }) {
  return (
    <fieldset className="st-field st-fieldset">
      <legend className="st-label">{label}</legend>
      {loading ? <p className="st-hint">Loading…</p> : items.length === 0 ? <p className="st-hint">{empty || 'Nothing to choose yet.'}</p> : (
        <div className={`st-checks${columns ? ' st-checks-cols' : ''}`}>
          {items.map(i => (
            <label key={i.key} className="st-check">
              <input type="checkbox" checked={checked.includes(i.key)} onChange={() => onToggle(i.key)} />
              <span>{i.label}{i.note ? <small> {i.note}</small> : null}</span>
            </label>
          ))}
        </div>
      )}
      {hint && <p className="st-hint">{hint}</p>}
    </fieldset>
  )
}
