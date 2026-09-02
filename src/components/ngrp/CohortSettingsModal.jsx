// NGRP-PLANNING-2: "Edit Cohort" for the Residency experience.
//
// WHY THIS IS A MODAL OFF THE HEADER, not a workspace tab.
// The Internship experience has always administered its cohorts from the Scope
// picker: pick a cohort, then Edit Cohort / Add Cohort right under the list.
// Residency did the same job in a whole workspace tab, so the two experiences
// taught two different habits for the same act. These six cards are the
// residency answer to ManageCohortModal - same place in the interface, same
// gesture - and the Planning tab is freed to be the cohort's OPERATING picture
// instead of its settings form.
//
// Everything about the editing contract is carried over unchanged from the
// Planning tab: each card tracks its own unsaved changes visibly, discards only
// after an explicit confirm, and every consequential action (activation, source
// scope, opening a form-active status) goes through a review dialog. Status is
// always an explicit staff action - nothing opens automatically on a date.
//
// The editor REMOUNTS on a server-row change (the cohort-key remount pattern):
// state initializers read props, so no sync-setState effect exists anywhere.
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Lock } from 'lucide-react'
import { useNgrpPlanning, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { CYCLE_STATUSES, FORM_ACTIVE_STATUSES } from '../../lib/ngrp/ngrpStates'
import { DEFAULT_APPLICATION_CHECKLIST } from '../../../lib/server/ngrpEligibility.js'
import { compareCohortsChrono } from '../../lib/cohortSeason'
import {
  F, inputStyle, btn, errText,
  cycleBasics, rulesOf, benchmarksOf,
  unitRoster, unitRosterByDivision, unitsToSave, unitsMissingSpots, unitDescription,
  checklistExtrasOf, buildChecklist,
} from '../../lib/ngrp/ngrpCohortForm'
import { Field, Card, ConfirmDialog, ModalShell } from './NgrpFormUi'
import SeasonMark from '../Header/scope/SeasonMark'

export default function CohortSettingsModal({ cycle, canManage, toast, onClose }) {
  const queryClient = useQueryClient()
  const planning = useNgrpPlanning(cycle?.id || null)
  const data = planning.data
  const serverCycle = data?.cycle || null

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace'] })
  }, [queryClient])

  // COHORT-ORDER-1: program order (Summer 2026, Fall 2026, Winter 2027), read
  // from the cohort NAME. Sorting on the free-text start_date column put Winter
  // above Fall alphabetically.
  const aspireCohorts = [...(data?.aspireCohorts || [])].sort(compareCohortsChrono)

  let body
  if (!canManage) {
    body = <Notice>Editing a residency cohort requires NGRP management access.</Notice>
  } else if (planning.status === 'loading') {
    body = <div className="state-box"><div className="spinner" /><p>Loading cohort settings…</p></div>
  } else if (planning.status === 'unprovisioned') {
    body = <Notice>NGRP persistence is not provisioned yet - apply the pending migration, then reload.</Notice>
  } else if (planning.status === 'error' || planning.status === 'stale') {
    body = (
      <div className="ngrp-banner ngrp-banner-error" role="alert">
        <b>Cohort settings could not load.</b> This is a server or connection problem.{' '}
        <button type="button" className="ngrp-linkbtn" onClick={() => planning.refetch()}>Try again</button>
      </div>
    )
  } else if (!serverCycle) {
    body = <div className="state-box"><div className="spinner" /><p>Loading cohort…</p></div>
  } else {
    body = (
      <CohortSettingsEditor
        key={`${serverCycle.id}:${serverCycle.updated_at || ''}:${(data?.units || []).length}:${(data?.sourceCohorts || []).map(c => c.id).join(',')}`}
        data={data}
        aspireCohorts={aspireCohorts}
        toast={toast}
        invalidate={invalidate}
        refetch={planning.refetch}
      />
    )
  }

  return (
    <ModalShell
      label={`Cohort settings${serverCycle?.name ? ` - ${serverCycle.name}` : ''}`}
      onClose={onClose}
      width={840}
      /* A stray click on the backdrop must not throw away half-typed
         configuration; the header X and Escape are the deliberate exits. */
      dismissOnBackdrop={false}
    >
      <div style={{ flexShrink: 0, padding: '16px 22px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#8B8F99' }}>Residency cohort settings</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1D2567', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {serverCycle?.name || cycle?.name || 'Cohort'}
          </div>
        </div>
        <button
          type="button" aria-label="Close cohort settings" onClick={onClose}
          style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#6B7785', padding: 6, lineHeight: 0, borderRadius: 8 }}
        >
          <X size={18} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '16px 22px 22px', overflowY: 'auto', background: 'var(--sand, #FAF9F7)' }}>
        {body}
      </div>
    </ModalShell>
  )
}

function Notice({ children }) {
  return (
    <div className="snap" style={{ padding: '20px 22px' }}>
      <p style={{ margin: 0, fontSize: 13, color: '#6b7280', fontFamily: F }}>{children}</p>
    </div>
  )
}

function CohortSettingsEditor({ data, aspireCohorts, toast, invalidate, refetch }) {
  const serverCycle = data.cycle
  const [basics, setBasics] = useState(() => cycleBasics(serverCycle))
  const [rules, setRules] = useState(() => rulesOf(serverCycle))
  // Only the EXTRAS are editable state: the five official requirements are fixed
  // and are re-attached at save time, so they cannot be edited out by accident.
  const [extras, setExtras] = useState(() => checklistExtrasOf(serverCycle))
  const [benchmarks, setBenchmarks] = useState(() => benchmarksOf(serverCycle))
  const [sourceIds, setSourceIds] = useState(() => (data.sourceCohorts || []).map(c => c.id))
  const [units, setUnits] = useState(() => unitRoster(data))
  const [saving, setSaving] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [confirm, setConfirm] = useState(null)

  const basicsDirty = serverCycle && JSON.stringify(basics) !== JSON.stringify(cycleBasics(serverCycle))
  const rulesDirty = serverCycle && JSON.stringify(rules) !== JSON.stringify(rulesOf(serverCycle))
  const checklistDirty = serverCycle && JSON.stringify(extras) !== JSON.stringify(checklistExtrasOf(serverCycle))
  const benchmarksDirty = serverCycle && JSON.stringify(benchmarks) !== JSON.stringify(benchmarksOf(serverCycle))
  const sourcesDirty = serverCycle && JSON.stringify([...sourceIds].sort()) !== JSON.stringify((data.sourceCohorts || []).map(c => c.id).sort())
  const unitsDirty = serverCycle && JSON.stringify(units) !== JSON.stringify(unitRoster(data))
  // A ticked unit that will not say how many it is hiring blocks the save.
  const missingSpots = unitsMissingSpots(units)

  // ── Save handlers ──────────────────────────────────────────────────────────
  const buildCyclePayload = () => ({
    ...basics,
    notes: basics.notes || null,
    application_open_date: basics.application_open_date || null,
    application_deadline: basics.application_deadline || null,
    interview_window_start: basics.interview_window_start || null,
    interview_window_end: basics.interview_window_end || null,
    licensure_deadline: basics.licensure_deadline || null,
    residency_start_date: basics.residency_start_date || null,
    qualification_rules: {
      gpa_min: Number(rules.gpa_min),
      max_paid_rn_months: Number(rules.max_paid_rn_months),
      completion_window_months: Number(rules.completion_window_months),
      require_accreditation: rules.require_accreditation,
      nclex_exception_enabled: rules.nclex_exception_enabled,
      conditional: { license: { enabled: rules.nclex_exception_enabled, deadline: rules.license_deadline_override || null } },
    },
    application_checklist: buildChecklist(DEFAULT_APPLICATION_CHECKLIST, extras),
    retention_benchmarks: {
      traditional_pct: benchmarks.traditional_pct === '' ? null : Number(benchmarks.traditional_pct),
      organization_pct: benchmarks.organization_pct === '' ? null : Number(benchmarks.organization_pct),
    },
  })

  const saveCycle = async (sections) => {
    setSaving('cycle')
    setFieldErrors({})
    const res = await postNgrpManage('cycle_update', { cycle_id: serverCycle.id, cycle: buildCyclePayload() })
    setSaving(null)
    if (!res.ok) {
      const map = {}
      for (const e of res.errors) map[e.field] = e.message
      setFieldErrors(map)
      toast?.error?.('Not saved', errText(res.errors) || 'The configuration could not be saved.')
      return false
    }
    if (res.recalc && !res.recalc.ok) {
      // The cycle saved, but eligibility recalculation partially failed -
      // never let that read as a clean success (stale eligibility is real).
      toast?.error?.('Saved, with a recalculation problem',
        `${sections} updated, but eligibility recalculation failed for ${res.recalc.failed} candidate(s). Run Recalculate from the applicant drawer, or save again.`)
    } else {
      toast?.success?.('Cohort settings saved', `${sections} updated for ${res.cycle?.name || basics.name}.`)
    }
    invalidate()
    refetch()
    return true
  }

  const requestSaveBasics = () => {
    // NGRP-CYCLE-STATUS-CANON: reads the shared vocabulary rather than restating which
    // statuses open forms. The list moved once already; it must not need finding twice.
    const opensForms = FORM_ACTIVE_STATUSES.includes(basics.status) && serverCycle.status !== basics.status
    if (opensForms) {
      setConfirm({
        title: `Activate ${basics.name}?`,
        body: 'Activating a residency cohort makes Transition Form sends possible. Status is an explicit staff action - confirm to proceed.',
        confirmLabel: `Set status to ${basics.status}`,
        run: () => saveCycle('Cohort basics'),
      })
      return
    }
    saveCycle('Cohort basics')
  }

  const saveSources = async () => {
    setSaving('sources')
    const res = await postNgrpManage('sources_set', { cycle_id: serverCycle.id, cohort_ids: sourceIds })
    setSaving(null)
    if (!res.ok) { toast?.error?.('Not saved', errText(res.errors) || 'The source mapping could not be saved.'); return }
    toast?.success?.('Participating cohorts updated', 'The Profiles & Interest roster scope reflects the new mapping.')
    invalidate()
    refetch()
  }
  const requestSaveSources = () => {
    const names = aspireCohorts.filter(c => sourceIds.includes(c.id)).map(c => c.name)
    setConfirm({
      title: 'Change which ASPIRE cohorts participate?',
      body: names.length
        ? `The Applicants roster for ${serverCycle.name} will draw completed alumni from: ${names.join(', ')}. Alumni outside these cohorts leave the roster scope immediately.`
        : `This removes EVERY participating ASPIRE cohort from ${serverCycle.name} - the Profiles & Interest roster will be empty until cohorts are chosen again.`,
      confirmLabel: 'Update mapping',
      run: async () => { await saveSources() },
    })
  }

  const saveUnits = async () => {
    setSaving('units')
    const res = await postNgrpManage('units_set', { cycle_id: serverCycle.id, units: unitsToSave(units) })
    setSaving(null)
    if (!res.ok) { toast?.error?.('Not saved', errText(res.errors) || 'The unit list could not be saved.'); return }
    toast?.success?.('Participating units updated', 'The Transition Form ranked-preference list reflects the change.')
    invalidate()
    refetch()
  }

  const requestActivate = () => {
    setConfirm({
      title: `Make ${serverCycle.name} the active residency cohort?`,
      body: 'The active cohort is the default the workspace opens to. Any other active cohort is deactivated - explicit selections in the header picker are unaffected.',
      confirmLabel: 'Set active',
      run: async () => {
        const res = await postNgrpManage('cycle_set_active', { cycle_id: serverCycle.id })
        if (!res.ok) { toast?.error?.('Not changed', res.error || 'Could not set the active cohort.'); return }
        toast?.success?.('Active cohort set', `${serverCycle.name} is now the default.`)
        invalidate(); refetch()
      },
    })
  }

  return (
    <div>
      {/* 1 · Basics */}
      <Card
        title="Residency cohort basics" dirty={Boolean(basicsDirty)} saving={saving === 'cycle'}
        onSave={requestSaveBasics} onDiscard={() => { setBasics(cycleBasics(serverCycle)); setFieldErrors({}) }}
        footNote="Status is an explicit staff action - a cohort never opens automatically when a date arrives."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px 16px' }}>
          <Field label="Name"><input style={inputStyle} value={basics.name} onChange={e => setBasics(b => ({ ...b, name: e.target.value }))} />
            {fieldErrors.name && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#B3282D' }}>{fieldErrors.name}</p>}</Field>
          <Field label="Status">
            <select style={inputStyle} value={basics.status} onChange={e => setBasics(b => ({ ...b, status: e.target.value }))}>
              {/* NGRP-CYCLE-STATUS-CANON: a row still holding one of the retired nine
                  values (this app deployed, migration 20260905000000 not yet applied)
                  would otherwise have NO matching option. A select whose value matches
                  nothing displays its first option, so opening the modal and saving any
                  unrelated field would silently rewrite the status to Planning. The
                  legacy value is offered as a selectable option, marked, so the rewrite
                  is a choice rather than an accident. Disappears on its own once the
                  data is canonical. */}
              {!CYCLE_STATUSES.includes(basics.status) && basics.status && (
                <option value={basics.status}>{basics.status} (retired status)</option>
              )}
              {CYCLE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {fieldErrors.status && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#B3282D' }}>{fieldErrors.status}</p>}</Field>
          <Field label="Application opens"><input type="date" style={inputStyle} value={basics.application_open_date} onChange={e => setBasics(b => ({ ...b, application_open_date: e.target.value }))} /></Field>
          <Field label="Application closes">
            <input type="date" style={inputStyle} value={basics.application_deadline} onChange={e => setBasics(b => ({ ...b, application_deadline: e.target.value }))} />
            {fieldErrors.application_deadline && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#B3282D' }}>{fieldErrors.application_deadline}</p>}</Field>
          <Field label="Interview window starts"><input type="date" style={inputStyle} value={basics.interview_window_start} onChange={e => setBasics(b => ({ ...b, interview_window_start: e.target.value }))} /></Field>
          <Field label="Interview window ends">
            <input type="date" style={inputStyle} value={basics.interview_window_end} onChange={e => setBasics(b => ({ ...b, interview_window_end: e.target.value }))} />
            {fieldErrors.interview_window_end && <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#B3282D' }}>{fieldErrors.interview_window_end}</p>}</Field>
          <Field label="Licensure deadline"><input type="date" style={inputStyle} value={basics.licensure_deadline} onChange={e => setBasics(b => ({ ...b, licensure_deadline: e.target.value }))} /></Field>
          <Field label="Residency start date"><input type="date" style={inputStyle} value={basics.residency_start_date} onChange={e => setBasics(b => ({ ...b, residency_start_date: e.target.value }))} /></Field>
          <Field label="Notes" span2>
            <textarea style={{ ...inputStyle, height: 64, padding: '8px 10px', resize: 'vertical' }} value={basics.notes} onChange={e => setBasics(b => ({ ...b, notes: e.target.value }))} /></Field>
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          {serverCycle.is_active ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: '#166534', background: '#DCFCE7', borderRadius: 999, padding: '3px 10px', fontFamily: F }}>
              Active (workspace default)
            </span>
          ) : (
            <button type="button" style={btn()} onClick={requestActivate}>Make this the active cohort</button>
          )}
        </div>
      </Card>

      {/* 2 · ASPIRE cohorts participating */}
      <Card
        title="ASPIRE cohorts participating" dirty={sourcesDirty} saving={saving === 'sources'}
        onSave={requestSaveSources} onDiscard={() => setSourceIds((data.sourceCohorts || []).map(c => c.id))}
        footNote="Applicants shows every Completed student across these cohorts (chronological below). No cohort or student data is duplicated - this is a mapping only."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {aspireCohorts.map(c => {
            const on = sourceIds.includes(c.id)
            return (
              <button key={c.id} type="button" aria-pressed={on}
                onClick={() => setSourceIds(prev => on ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                style={{
                  ...btn(), height: 34,
                  background: on ? '#EDEEF4' : '#fff',
                  border: on ? '1.5px solid #1D2567' : '1px solid rgba(29,37,103,0.15)',
                  fontWeight: on ? 700 : 500,
                }}>
                {/* Name only (Owner). The name already states season and year;
                    cohorts.start_date is free text and was the source of the
                    ragged "May 4, " label. Nothing reads it here now. */}
                <SeasonMark name={c.name} />
                {c.name}
              </button>
            )
          })}
          {!aspireCohorts.length && <span style={{ fontSize: 12.5, color: '#9CA3AF', fontFamily: F }}>No ASPIRE cohorts exist yet.</span>}
        </div>
      </Card>

      {/* 3 · Participating units */}
      <Card
        title="Participating units" dirty={unitsDirty} saving={saving === 'units'}
        onSave={saveUnits} onDiscard={() => setUnits(unitRoster(data))}
        saveDisabledReason={missingSpots.length
          ? `Set the number of new grads being hired for ${missingSpots.join(', ')} before saving.`
          : null}
        footNote="Every unit is listed; pick the ones hiring into this cohort and say how many new grads each is taking. Picked units are the ONLY options the Transition Form offers as ranked preferences, in the order shown. Unpicking keeps the number for next cycle. The total is what At a Glance reports as Seats."
      >
        {!data.unitsProvisioned && (
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#4B5563', fontFamily: F }}>
            Unit configuration unlocks once the pending NGRP migration is applied.
          </p>
        )}
        {/* Tiles, not rows (Owner). Twenty-nine full-width rows with a checkbox,
            a name, a number and two arrows each ate the card. A tile is the same
            control the ASPIRE cohorts above use - pick or do not pick - and it
            only grows the number box once it has been picked, so the unpicked
            majority stays small enough to scan as a block. */}
        {/* Grouped by division (Owner), because that is how the units are
            grouped on the org chart and therefore where someone looks for one.
            The group order doubles as the order the Transition Form offers the
            picked units in. */}
        <div className="ngrp-unitdivs" role="group" aria-label="Participating units">
          {unitRosterByDivision(units).map(group => (
            <div key={group.division} className="ngrp-unitdiv">
              <div className="ngrp-unitdiv-name">{group.division}</div>
              <div className="ngrp-unittiles">
                {group.units.map(u => {
                  const i = units.indexOf(u)
                  const needsSpots = u.is_active && !(Number(u.capacity) > 0)
                  const desc = unitDescription(u.unit_name)
                  return (
                    <div
                      key={u.unit_name}
                      className={`ngrp-unittile${u.is_active ? ' ngrp-unittile-on' : ''}${needsSpots ? ' ngrp-unittile-err' : ''}`}
                    >
                      {/* The label wraps the control, so the whole tile is the
                          hit target and the checkbox stays the real, focusable
                          input. */}
                      <label className="ngrp-unittile-pick">
                        <input
                          type="checkbox" className="sr-only"
                          checked={u.is_active}
                          aria-label={`${u.unit_name} is participating and hiring`}
                          onChange={e => setUnits(prev => prev.map((x, j) => j === i ? { ...x, is_active: e.target.checked } : x))}
                        />
                        {/* The catalog description is a tooltip rather than a
                            second line: it disambiguates 5 SCCT from 6 SCCT
                            without making every tile two lines tall. */}
                        <span className="ngrp-unittile-name" title={desc || undefined}>{u.unit_name}</span>
                      </label>
                      {u.is_active && (
                        <input
                          type="number" min="1"
                          className="ngrp-unittile-num"
                          aria-label={`New grads ${u.unit_name} is hiring`}
                          aria-invalid={needsSpots || undefined}
                          value={u.capacity}
                          onChange={e => setUnits(prev => prev.map((x, j) => j === i ? { ...x, capacity: e.target.value } : x))}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 600, color: '#1D2567', fontFamily: F }}>
          {units.filter(u => u.is_active).reduce((n, u) => n + (Number(u.capacity) > 0 ? Number(u.capacity) : 0), 0)} new
          grads across {units.filter(u => u.is_active).length} hiring unit{units.filter(u => u.is_active).length === 1 ? '' : 's'}
        </p>
      </Card>

      {/* 4 · Eligibility rules */}
      <Card
        title="Eligibility rules" dirty={rulesDirty} saving={saving === 'cycle'}
        onSave={() => saveCycle('Eligibility rules')} onDiscard={() => setRules(rulesOf(serverCycle))}
        footNote="Results are always explainable per rule - never a score - and optional support participation is never an input. Recalculation runs automatically when these rules or the cohort dates change."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px 16px' }}>
          <Field label="Minimum nursing GPA">
            <input type="number" step="0.01" min="0" max="4" style={inputStyle} value={rules.gpa_min}
              onChange={e => setRules(r => ({ ...r, gpa_min: e.target.value }))} /></Field>
          <Field label="Paid RN experience must be under (months)">
            <input type="number" min="1" style={inputStyle} value={rules.max_paid_rn_months}
              onChange={e => setRules(r => ({ ...r, max_paid_rn_months: e.target.value }))} /></Field>
          <Field label="Program completed within (months)">
            <input type="number" min="1" style={inputStyle} value={rules.completion_window_months}
              onChange={e => setRules(r => ({ ...r, completion_window_months: e.target.value }))} /></Field>
          <Field label="Licensure conditional deadline (override)">
            <input type="date" style={inputStyle} value={rules.license_deadline_override}
              onChange={e => setRules(r => ({ ...r, license_deadline_override: e.target.value }))} />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9CA3AF', fontFamily: F }}>
              Blank uses the cohort's licensure deadline, or 21 days before the interview window.
            </p></Field>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontFamily: F, cursor: 'pointer' }}>
            <input type="checkbox" checked={rules.nclex_exception_enabled}
              onChange={e => setRules(r => ({ ...r, nclex_exception_enabled: e.target.checked }))} style={{ accentColor: '#1D2567', width: 15, height: 15 }} />
            <span><b>NCLEX exception:</b> a scheduled NCLEX on or before the licensure deadline makes an otherwise-passing applicant <i>Conditionally Eligible</i>.</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontFamily: F, cursor: 'pointer' }}>
            <input type="checkbox" checked={rules.require_accreditation}
              onChange={e => setRules(r => ({ ...r, require_accreditation: e.target.checked }))} style={{ accentColor: '#1D2567', width: 15, height: 15 }} />
            <span><b>External applicant accreditation:</b> require confirmation of an accredited US nursing program.</span>
          </label>
        </div>
      </Card>

      {/* 5 · Application checklist */}
      <Card
        title="Required application checklist" dirty={checklistDirty} saving={saving === 'cycle'}
        onSave={() => saveCycle('Application checklist')} onDiscard={() => setExtras(checklistExtrasOf(serverCycle))}
        footNote="Shown to alumni in the Transition Form as an application-readiness snapshot. Structured items, not free text."
      >
        {/* The five published requirements are FIXED. They are the program's
            official application requirements, so they are shown as what they are
            rather than as five editable rows one click from being deleted out of
            the alumni-facing form. */}
        <div className="ngrp-cl-kicker">Official program requirements</div>
        <ul className="ngrp-cl-official">
          {DEFAULT_APPLICATION_CHECKLIST.map(item => (
            <li key={item.key}>
              <Lock size={11} strokeWidth={2.4} aria-hidden="true" />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p className="ngrp-cl-note">
          Set by the program and the same for every cohort. Alumni tick these off on the
          Transition Form as a readiness snapshot, not as the application itself.
        </p>

        <div className="ngrp-cl-kicker" style={{ marginTop: 16 }}>Additional items for this cohort</div>
        {extras.length === 0 && (
          <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#9CA3AF', fontFamily: F }}>
            None. Add anything this cohort needs beyond the requirements above.
          </p>
        )}
        {extras.map((item, i) => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <input
              value={item.label} aria-label={`Additional checklist item ${i + 1}`}
              onChange={e => setExtras(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" aria-label={`Remove additional item ${i + 1}`} onClick={() => setExtras(prev => prev.filter((_, j) => j !== i))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B3282D', padding: 4 }}><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" style={{ ...btn(), marginTop: 8 }}
          onClick={() => setExtras(prev => [...prev, { key: `extra_${Date.now()}`, label: '', required: true }])}>
          <Plus size={13} /> Add item
        </button>
      </Card>

      {/* 6 · Retention benchmarks */}
      <Card
        title="Retention benchmarks" dirty={benchmarksDirty} saving={saving === 'cycle'}
        onSave={() => saveCycle('Retention benchmarks')} onDiscard={() => setBenchmarks(benchmarksOf(serverCycle))}
        footNote="Configuration only for this release - the Evaluation dashboard reads these in a later phase."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px 16px' }}>
          <Field label="Traditional residency retention benchmark (%)">
            <input type="number" min="0" max="100" style={inputStyle} value={benchmarks.traditional_pct}
              onChange={e => setBenchmarks(b => ({ ...b, traditional_pct: e.target.value }))} /></Field>
          <Field label="Organization-wide retention benchmark (%)">
            <input type="number" min="0" max="100" style={inputStyle} value={benchmarks.organization_pct}
              onChange={e => setBenchmarks(b => ({ ...b, organization_pct: e.target.value }))} /></Field>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.confirmLabel}
        busy={saving !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => { const run = confirm.run; setConfirm(null); await run() }}
      />
    </div>
  )
}
