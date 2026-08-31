// NGRP-RELEASE-2: the Planning tab - self-service residency-cohort
// configuration for authorized staff (ngrp_manage). Replaces the placeholder.
//
// Shape of the page: a readiness strip ("why can't this open for forms"),
// then six calm card sections - Basics, Source ASPIRE cohorts, Participating
// units, Eligibility rules, Application checklist, Retention benchmarks.
// Each section tracks its own unsaved changes visibly, discards only after
// an explicit confirm, and the consequential actions (create, activate,
// source-scope changes, opening a form-active status) go through a
// review/confirm dialog. Status is always an explicit staff action - nothing
// opens automatically on a date.
//
// The header's residency Cohort picker remains the ONE primary selector;
// Planning edits whatever cohort is selected there and never grows a second
// competing picker (creating a new cohort hands the selection back to App).
import { useState, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronUp, ChevronDown, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useNgrpPlanning, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { CYCLE_STATUSES } from '../../lib/ngrp/ngrpStates'

const F = 'DM Sans, sans-serif'

const inputStyle = {
  height: 34, padding: '0 10px', border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8,
  fontFamily: F, fontSize: 13, background: '#fff', color: '#191919', width: '100%', boxSizing: 'border-box',
}
const labelStyle = { fontSize: 11.5, fontWeight: 600, color: '#4A5560', display: 'block', marginBottom: 4 }
const btn = (primary = false, danger = false) => ({
  height: 32, padding: '0 14px', borderRadius: 8, fontFamily: F, fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', border: primary || danger ? 'none' : '1px solid rgba(29,37,103,0.15)',
  background: danger ? '#B3282D' : primary ? '#1D2567' : '#fff',
  color: primary || danger ? '#fff' : '#1D2567',
  display: 'inline-flex', alignItems: 'center', gap: 6,
})

function Field({ label, children, span2 = false }) {
  // The label WRAPS the control (implicit association), so every Field input
  // is screen-reader-labeled and clickable-by-label without per-input ids.
  return (
    <div style={{ gridColumn: span2 ? '1 / -1' : undefined }}>
      <label style={{ display: 'block' }}>
        <span style={labelStyle}>{label}</span>
        {children}
      </label>
    </div>
  )
}

function Card({ title, dirty, onSave, onDiscard, saving, children, footNote }) {
  // Only meaningful while dirty - deriving it avoids a reset effect.
  const [confirmDiscardRaw, setConfirmDiscard] = useState(false)
  const confirmDiscard = confirmDiscardRaw && dirty
  return (
    <section className="snap" style={{ margin: '0 0 14px', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1D2567' }}>{title}</h2>
        {dirty && (
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8B5E1A', background: '#FBF5E8', borderRadius: 999, padding: '2px 9px' }}>
            Unsaved changes
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {dirty && (confirmDiscard ? (
            <>
              <span style={{ fontSize: 12, color: '#92400e', alignSelf: 'center', fontFamily: F }}>Discard these changes?</span>
              <button type="button" style={btn(false, true)} onClick={() => { setConfirmDiscard(false); onDiscard() }}>Discard</button>
              <button type="button" style={btn()} onClick={() => setConfirmDiscard(false)}>Keep editing</button>
            </>
          ) : (
            <button type="button" style={btn()} onClick={() => setConfirmDiscard(true)}>Discard</button>
          ))}
          {dirty && !confirmDiscard && (
            <button type="button" style={btn(true)} disabled={saving} onClick={onSave}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
      {children}
      {footNote && <p style={{ margin: '12px 0 0', fontSize: 11.5, color: '#9CA3AF', fontFamily: F }}>{footNote}</p>}
    </section>
  )
}

function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', busy, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: 1998 }} />
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(520px, calc(100vw - 32px))', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 1999, fontFamily: F,
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ padding: '14px 20px', fontSize: 13, color: '#4A5560', lineHeight: 1.6 }}>{body}</div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={btn()} onClick={onCancel}>Cancel</button>
          <button type="button" style={btn(true)} disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </>
  )
}

const errText = errors => (errors || []).map(e => e.message).join(' ')

const cycleBasics = c => ({
  name: c?.name || '',
  status: c?.status || 'Planning',
  application_open_date: c?.application_open_date || '',
  application_deadline: c?.application_deadline || '',
  interview_window_start: c?.interview_window_start || '',
  interview_window_end: c?.interview_window_end || '',
  licensure_deadline: c?.licensure_deadline || '',
  residency_start_date: c?.residency_start_date || '',
  notes: c?.notes || '',
})
const rulesOf = c => {
  const r = c?.qualification_rules || {}
  return {
    gpa_min: r.gpa_min ?? 3.0,
    max_paid_rn_months: r.max_paid_rn_months ?? 9,
    completion_window_months: r.completion_window_months ?? 12,
    require_accreditation: r.require_accreditation === true,
    nclex_exception_enabled: r.nclex_exception_enabled !== false,
    license_deadline_override: r.conditional?.license?.deadline || '',
  }
}
const checklistOf = c => (Array.isArray(c?.application_checklist) && c.application_checklist.length
  ? c.application_checklist.map(i => ({ key: i.key, label: i.label, required: i.required !== false }))
  : null)
const benchmarksOf = c => ({
  traditional_pct: c?.retention_benchmarks?.traditional_pct ?? '',
  organization_pct: c?.retention_benchmarks?.organization_pct ?? '',
})

export default function PlanningTab({ cycle, cyclesCount, canManage, toast, onSelectCycle }) {
  const queryClient = useQueryClient()
  const planning = useNgrpPlanning(cycle?.id || null)
  const data = planning.data
  const [showCreate, setShowCreate] = useState(false)

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace'] })
  }, [queryClient])

  const serverCycle = data?.cycle || null
  const aspireCohorts = useMemo(() => {
    const list = data?.aspireCohorts || []
    return [...list].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  }, [data])

  // ── Access + loading states ────────────────────────────────────────────────
  if (!canManage) {
    return (
      <div className="snap" style={{ margin: '14px 0', padding: '22px 24px' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280', fontFamily: F }}>
          Planning requires NGRP management access.
        </p>
      </div>
    )
  }
  if (planning.status === 'loading') {
    return <div className="state-box"><div className="spinner" /><p>Loading Planning…</p></div>
  }
  if (planning.status === 'unprovisioned') {
    return (
      <div className="snap" style={{ margin: '14px 0', padding: '22px 24px', background: '#F3F4F6' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#4B5563', fontFamily: F }}>
          NGRP persistence is not provisioned yet - apply the pending migration, then reload.
        </p>
      </div>
    )
  }
  if (planning.status === 'error' || planning.status === 'stale') {
    return (
      <div className="ngrp-banner ngrp-banner-error" role="alert" style={{ marginTop: 14 }}>
        <b>Planning could not load.</b> This is a server or connection problem.{' '}
        <button type="button" className="ngrp-linkbtn" onClick={() => planning.refetch()}>Try again</button>
      </div>
    )
  }

  // ── First-time setup (no residency cohorts at all) ─────────────────────────
  if (!cycle || cyclesCount === 0) {
    return (
      <>
        <div className="snap" style={{ margin: '14px 0', padding: '26px 28px' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
            Set up your first residency cohort
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 13.5, color: '#4A5560', maxWidth: 620, lineHeight: 1.6, fontFamily: F }}>
            A residency cohort (for example “January 2027”) scopes everything in the Residency
            experience: which completed ASPIRE alumni appear in Applicants, the Transition Form
            window, participating units, and eligibility rules. Create it here - no SQL involved -
            then map its source ASPIRE cohorts and configure the rest at your own pace.
          </p>
          <button type="button" style={{ ...btn(true), height: 38, fontSize: 13.5 }} onClick={() => setShowCreate(true)}>
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" /> Create residency cohort
          </button>
        </div>
        {showCreate && (
          <CreateCycleDialog
            aspireCohorts={aspireCohorts}
            onClose={() => setShowCreate(false)}
            onCreated={(created) => {
              setShowCreate(false)
              toast?.success?.('Residency cohort created', `${created.name} is ready to configure.`)
              invalidate()
              onSelectCycle?.(created.id)
            }}
          />
        )}
      </>
    )
  }

  if (!serverCycle) return <div className="state-box"><div className="spinner" /><p>Loading cohort…</p></div>

  // The keyed editor re-baselines by REMOUNT whenever the server row changes
  // (the cohort-key remount pattern) - state initializers read props, so no
  // sync-setState effect exists anywhere in the section editors.
  return (
    <>
      <PlanningEditor
        key={`${serverCycle.id}:${serverCycle.updated_at || ''}:${(data?.units || []).length}:${(data?.sourceCohorts || []).map(c => c.id).join(',')}`}
        data={data}
        aspireCohorts={aspireCohorts}
        toast={toast}
        invalidate={invalidate}
        refetch={planning.refetch}
        onCreateAnother={() => setShowCreate(true)}
      />
      {showCreate && (
        <CreateCycleDialog
          aspireCohorts={aspireCohorts}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false)
            toast?.success?.('Residency cohort created', `${created.name} is ready to configure.`)
            invalidate()
            onSelectCycle?.(created.id)
          }}
        />
      )}
    </>
  )
}

function PlanningEditor({ data, aspireCohorts, toast, invalidate, refetch, onCreateAnother }) {
  const serverCycle = data.cycle
  const [basics, setBasics] = useState(() => cycleBasics(serverCycle))
  const [rules, setRules] = useState(() => rulesOf(serverCycle))
  const [checklist, setChecklist] = useState(() => checklistOf(serverCycle))
  const [benchmarks, setBenchmarks] = useState(() => benchmarksOf(serverCycle))
  const [sourceIds, setSourceIds] = useState(() => (data.sourceCohorts || []).map(c => c.id))
  const [units, setUnits] = useState(() => (data.units || []).map(u => ({ unit_name: u.unit_name, is_active: u.is_active, capacity: u.capacity ?? '' })))
  const [newUnit, setNewUnit] = useState('')
  const [saving, setSaving] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [confirm, setConfirm] = useState(null)
  const readiness = data?.readiness || { ok: false, reasons: [] }

  const basicsDirty = serverCycle && JSON.stringify(basics) !== JSON.stringify(cycleBasics(serverCycle))
  const rulesDirty = serverCycle && JSON.stringify(rules) !== JSON.stringify(rulesOf(serverCycle))
  const checklistDirty = serverCycle && JSON.stringify(checklist) !== JSON.stringify(checklistOf(serverCycle))
  const benchmarksDirty = serverCycle && JSON.stringify(benchmarks) !== JSON.stringify(benchmarksOf(serverCycle))
  const sourcesDirty = serverCycle && JSON.stringify([...sourceIds].sort()) !== JSON.stringify((data?.sourceCohorts || []).map(c => c.id).sort())
  const unitsDirty = serverCycle && JSON.stringify(units) !== JSON.stringify((data?.units || []).map(u => ({ unit_name: u.unit_name, is_active: u.is_active, capacity: u.capacity ?? '' })))

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
    application_checklist: checklist || undefined,
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
    toast?.success?.('Planning saved', `${sections} updated for ${res.cycle?.name || basics.name}.`)
    invalidate()
    refetch()
    return true
  }

  const requestSaveBasics = () => {
    const opensForms = ['Accepting Interest', 'Application Open'].includes(basics.status) && serverCycle.status !== basics.status
    if (opensForms) {
      setConfirm({
        title: `Open ${basics.name} for ${basics.status === 'Application Open' ? 'applications' : 'interest'}?`,
        body: 'Opening a residency cohort makes Transition Form sends possible. Status is an explicit staff action - confirm to proceed.',
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
    toast?.success?.('Source cohorts updated', 'The Applicants roster scope reflects the new mapping.')
    invalidate()
    refetch()
  }
  const requestSaveSources = () => {
    const names = aspireCohorts.filter(c => sourceIds.includes(c.id)).map(c => c.name)
    setConfirm({
      title: 'Change the source ASPIRE cohorts?',
      body: names.length
        ? `The Applicants roster for ${serverCycle.name} will draw completed alumni from: ${names.join(', ')}. Alumni outside these cohorts leave the roster scope immediately.`
        : `This removes EVERY source cohort from ${serverCycle.name} - the Applicants roster will be empty until cohorts are mapped again.`,
      confirmLabel: 'Update mapping',
      run: async () => { await saveSources() },
    })
  }

  const saveUnits = async () => {
    setSaving('units')
    const res = await postNgrpManage('units_set', {
      cycle_id: serverCycle.id,
      units: units.map((u, i) => ({ ...u, capacity: u.capacity === '' ? null : Number(u.capacity), display_order: i })),
    })
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

  const moveUnit = (i, delta) => {
    setUnits(prev => {
      const next = [...prev]
      const j = i + delta
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }


  return (
    <div style={{ margin: '14px 0 28px' }}>
      {/* Readiness strip: why this cohort can or cannot host form sends. */}
      <div className={`ngrp-banner ${readiness.ok ? 'ngrp-banner-info' : 'ngrp-banner-warn'}`} style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {readiness.ok
          ? <><CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span><b>Ready for Transition Form sends.</b> Deadline, source cohorts, and participating units are all configured.</span></>
          : <><AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span><b>Not ready for form sends yet:</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{readiness.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </span></>}
      </div>

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

      {/* 2 · Source ASPIRE cohorts */}
      <Card
        title="Source ASPIRE cohorts" dirty={sourcesDirty} saving={saving === 'sources'}
        onSave={requestSaveSources} onDiscard={() => setSourceIds((data?.sourceCohorts || []).map(c => c.id))}
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
                {c.name}{c.start_date ? ` · ${c.start_date.slice(0, 7)}` : ''}
              </button>
            )
          })}
          {!aspireCohorts.length && <span style={{ fontSize: 12.5, color: '#9CA3AF', fontFamily: F }}>No ASPIRE cohorts exist yet.</span>}
        </div>
      </Card>

      {/* 3 · Participating units */}
      <Card
        title="Participating units" dirty={unitsDirty} saving={saving === 'units'}
        onSave={saveUnits} onDiscard={() => setUnits((data?.units || []).map(u => ({ unit_name: u.unit_name, is_active: u.is_active, capacity: u.capacity ?? '' })))}
        footNote="These units (active ones, in this order) are the ONLY options the Transition Form offers as ranked preferences. Capacity is context for later phases - never an assignment."
      >
        {!data?.unitsProvisioned && (
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#4B5563', fontFamily: F }}>
            Unit configuration unlocks once the pending NGRP migration is applied.
          </p>
        )}
        {units.map((u, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <button type="button" aria-label={`Move ${u.unit_name} up`} disabled={i === 0} onClick={() => moveUnit(i, -1)} style={{ border: 'none', background: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#D1D5DB' : '#6B7785', padding: 1 }}><ChevronUp size={13} /></button>
              <button type="button" aria-label={`Move ${u.unit_name} down`} disabled={i === units.length - 1} onClick={() => moveUnit(i, 1)} style={{ border: 'none', background: 'none', cursor: i === units.length - 1 ? 'default' : 'pointer', color: i === units.length - 1 ? '#D1D5DB' : '#6B7785', padding: 1 }}><ChevronDown size={13} /></button>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: F, flex: 1 }}>{u.unit_name}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#4A5560', fontFamily: F, cursor: 'pointer' }}>
              <input type="checkbox" checked={u.is_active} onChange={e => setUnits(prev => prev.map((x, j) => j === i ? { ...x, is_active: e.target.checked } : x))} style={{ accentColor: '#1D2567' }} />
              Active
            </label>
            <input
              type="number" min="1" placeholder="Capacity" aria-label={`${u.unit_name} capacity`}
              value={u.capacity} onChange={e => setUnits(prev => prev.map((x, j) => j === i ? { ...x, capacity: e.target.value } : x))}
              style={{ ...inputStyle, width: 92 }}
            />
            <button type="button" aria-label={`Remove ${u.unit_name}`} onClick={() => setUnits(prev => prev.filter((_, j) => j !== i))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B3282D', padding: 4 }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            list="ngrp-unit-suggestions" placeholder="Add a unit (e.g. 5 SCCT)" value={newUnit}
            onChange={e => setNewUnit(e.target.value)} aria-label="Add a participating unit"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newUnit.trim()) { setUnits(prev => [...prev, { unit_name: newUnit.trim(), is_active: true, capacity: '' }]); setNewUnit('') } } }}
            style={{ ...inputStyle, maxWidth: 280 }}
          />
          <datalist id="ngrp-unit-suggestions">
            {(data?.unitNameSuggestions || []).filter(n => !units.some(u => u.unit_name.toLowerCase() === n.toLowerCase())).map(n => <option key={n} value={n} />)}
          </datalist>
          <button type="button" style={btn()} disabled={!newUnit.trim() || units.some(u => u.unit_name.toLowerCase() === newUnit.trim().toLowerCase())}
            onClick={() => { setUnits(prev => [...prev, { unit_name: newUnit.trim(), is_active: true, capacity: '' }]); setNewUnit('') }}>
            <Plus size={13} /> Add
          </button>
        </div>
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
        onSave={() => saveCycle('Application checklist')} onDiscard={() => setChecklist(checklistOf(serverCycle))}
        footNote="Shown to alumni in the Transition Form as an application-readiness snapshot. Structured items, not free text."
      >
        {(checklist || []).map((item, i) => (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <input
              value={item.label} aria-label={`Checklist item ${i + 1}`}
              onChange={e => setChecklist(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" aria-label={`Remove checklist item ${i + 1}`} onClick={() => setChecklist(prev => prev.filter((_, j) => j !== i))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#B3282D', padding: 4 }}><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" style={{ ...btn(), marginTop: 8 }}
          onClick={() => setChecklist(prev => [...(prev || []), { key: `item_${(prev?.length || 0) + 1}`, label: '', required: true }])}>
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

      {/* New-cohort creation stays available beside the selected one. */}
      <button type="button" style={btn()} onClick={onCreateAnother}>
        <Plus size={13} /> Create another residency cohort
      </button>

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

// Create dialog with its own review step: enter → review summary → create.
function CreateCycleDialog({ aspireCohorts, onClose, onCreated }) {
  const [step, setStep] = useState('edit')
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [start, setStart] = useState('')
  const [sourceIds, setSourceIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState([])

  const create = async () => {
    setBusy(true)
    setErrors([])
    const res = await postNgrpManage('cycle_create', {
      cycle: { name, status: 'Planning', application_deadline: deadline || null, residency_start_date: start || null },
      source_cohort_ids: sourceIds,
    })
    setBusy(false)
    if (!res.ok) { setErrors(res.errors.length ? res.errors : [{ message: res.error || 'Could not create the cohort.' }]); setStep('edit'); return }
    onCreated(res.cycle)
  }

  const names = aspireCohorts.filter(c => sourceIds.includes(c.id)).map(c => c.name)
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: 1998 }} />
      <div role="dialog" aria-modal="true" aria-label="Create residency cohort" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(560px, calc(100vw - 32px))', maxHeight: '86vh', overflowY: 'auto',
        background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 1999, fontFamily: F,
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 15, fontWeight: 700 }}>
          {step === 'edit' ? 'Create residency cohort' : 'Review and confirm'}
        </div>
        <div style={{ padding: '16px 20px' }}>
          {step === 'edit' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Name (e.g. August 2027)"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></Field>
              <Field label="Application closing date (needed before forms can send - can be set later)">
                <input type="date" style={inputStyle} value={deadline} onChange={e => setDeadline(e.target.value)} /></Field>
              <Field label="Residency start date (optional)">
                <input type="date" style={inputStyle} value={start} onChange={e => setStart(e.target.value)} /></Field>
              <div>
                <label style={labelStyle}>Source ASPIRE cohorts</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {aspireCohorts.map(c => {
                    const on = sourceIds.includes(c.id)
                    return (
                      <button key={c.id} type="button" aria-pressed={on}
                        onClick={() => setSourceIds(prev => on ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                        style={{ ...btn(), height: 32, background: on ? '#EDEEF4' : '#fff', border: on ? '1.5px solid #1D2567' : '1px solid rgba(29,37,103,0.15)', fontWeight: on ? 700 : 500 }}>
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              {errors.map((e2, i) => <p key={i} style={{ margin: 0, fontSize: 12.5, color: '#B3282D' }}>{e2.message}</p>)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#4A5560', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 8px' }}><b>{name}</b> will be created in <b>Planning</b> status (it never opens automatically).</p>
              <p style={{ margin: '0 0 8px' }}>Source ASPIRE cohorts: {names.length ? <b>{names.join(', ')}</b> : <i>none yet - the Applicants roster stays empty until cohorts are mapped</i>}.</p>
              <p style={{ margin: 0 }}>Application closes: {deadline ? <b>{deadline}</b> : <i>not set - required before Transition Forms can send</i>}.</p>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" style={btn()} onClick={step === 'edit' ? onClose : () => setStep('edit')}>{step === 'edit' ? 'Cancel' : 'Back'}</button>
          {step === 'edit'
            ? <button type="button" style={btn(true)} disabled={!name.trim()} onClick={() => setStep('review')}>Review</button>
            : <button type="button" style={btn(true)} disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create cohort'}</button>}
        </div>
      </div>
    </>
  )
}
