// ADD-ALUMNUS-1 (Owner, 2026-10-29): Residency > Profiles & Interest > Add alumnus. Owner and
// Admin only (the server refuses anyone else). Two ways in:
//   - Already in the app: search Completed alumni not on this roster and add one.
//   - New to the app: the application profile (lib/server/ngrpAddedAlumni.js PROFILE_KEYS), in
//     the ASPIRE cohort the Owner picks or a past cohort named here; then either fill in the
//     rest now or send the Student Portal invitation so they complete it themselves.
// Nothing here is ASPIRE intake; the Transition Form asks the rest.
import { useEffect, useState } from 'react'
import DetailDrawer from '../ui/DetailDrawer'
import SegmentedPicker from '../shared/SegmentedPicker'
import { Field } from './NgrpFormUi'
import { F, inputStyle, btn, errText } from '../../lib/ngrp/ngrpCohortForm'
import { postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { supabase } from '../../lib/supabase'
import { unitOptionLabel, getEligibleUnits } from '../../lib/unitCatalog'

const EMPTY = {
  first_name: '', last_name: '', preferred_first_name: '', personal_email: '', phone: '',
  school: '', program_type: '', estimated_graduation_date: '', precepted_unit: '',
}
const PROGRAMS = ['BSN', 'ABSN / Accelerated BSN', 'MSN (entry-level)', 'ADN', 'Other']
const NEW_COHORT = '__new__'
const note = { fontSize: 12, color: 'var(--text-caption)', fontFamily: F, lineHeight: 1.5, margin: 0 }

async function sendPortalInvite({ studentId, email, fullName }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/invite-portal-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ role: 'student', email, full_name: fullName, student_id: studentId }),
  })
  return res.status === 200 || res.status === 201 ? { ok: true } : { ok: false, status: res.status }
}

export default function AddAlumnusDrawer({ cycle, cohorts = [], onClose, onAdded, toast }) {
  const [mode, setMode] = useState('existing')

  // Already in the app
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busyId, setBusyId] = useState(null)
  useEffect(() => {
    if (mode !== 'existing' || query.trim().length < 2) return undefined
    const t = setTimeout(async () => {
      const r = await postNgrpManage('alumni_search', { cycle_id: cycle.id, query })
      setResults(r.ok ? r.results || [] : [])
    }, 300)
    return () => clearTimeout(t)
  }, [mode, query, cycle.id])
  const addExisting = async (s) => {
    setBusyId(s.id)
    const r = await postNgrpManage('alumni_add', { cycle_id: cycle.id, student_id: s.id })
    setBusyId(null)
    if (!r.ok) { toast?.error?.('Not added', r.status === 409 ? 'They are already on this roster.' : 'Please try again.'); return }
    toast?.success?.('Added to the roster', `${s.first_name} ${s.last_name} is on the ${cycle.name} roster.`)
    onAdded?.(s.id)
    setResults(prev => (prev || []).filter(x => x.id !== s.id))
  }

  // New to the app
  const [p, setP] = useState(EMPTY)
  const [cohortId, setCohortId] = useState('')
  const [newCohort, setNewCohort] = useState('')
  const [then, setThen] = useState('fill')
  const [errors, setErrors] = useState([])
  const [matches, setMatches] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }))
  const fieldErr = k => errors.find(e => e.field === k)?.message

  const createNew = async (confirmNew = false) => {
    setSaving(true); setErrors([])
    const body = { cycle_id: cycle.id, profile: p, confirm_new: confirmNew }
    if (cohortId === NEW_COHORT) body.new_cohort_name = newCohort
    else body.cohort_id = cohortId
    const r = await postNgrpManage('alumni_create', body)
    if (!r.ok) {
      setSaving(false)
      if (r.code === 'possible_match') { setMatches(r.matches || []); return }
      if (r.errors?.length) { setErrors(r.errors); return }
      toast?.error?.('Not added', r.status === 409 ? 'Add alumnus is not switched on yet.' : 'Please try again.')
      return
    }
    setMatches(null)
    const fullName = `${p.first_name} ${p.last_name}`.trim()
    let invited = false
    if (then === 'invite') {
      const inv = await sendPortalInvite({ studentId: r.student_id, email: p.personal_email, fullName })
      invited = inv.ok
      if (invited) await postNgrpManage('alumni_invited', { cycle_id: cycle.id, student_id: r.student_id })
      else toast?.warning?.('Added, invitation not sent', 'Send the Student Portal invitation from Settings > Users & Access.')
    }
    setSaving(false)
    toast?.success?.('Added to the roster', invited
      ? `${fullName} is on the roster and has a Student Portal invitation to complete their profile.`
      : `${fullName} is on the ${cycle.name} roster.`)
    onAdded?.(r.student_id)
    setP(EMPTY); setCohortId(''); setNewCohort('')
  }

  const canCreate = p.first_name.trim() && p.last_name.trim() && p.personal_email.trim()
    && (cohortId && (cohortId !== NEW_COHORT || newCohort.trim().length >= 3))
  const unitNames = getEligibleUnits().map(u => u.name)

  return (
    <DetailDrawer open title="Add Alumnus" width={640} trapFocus onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: F }}>
        <SegmentedPicker ariaLabel="How to add" value={mode} onChange={setMode}
          options={[{ value: 'existing', label: 'Already in the app' }, { value: 'new', label: 'New to the app' }]} />

        {mode === 'existing' && (<>
          <p style={note}>Completed ASPIRE alumni whose cohort is not part of {cycle.name}. Search by name or email.</p>
          <input style={inputStyle} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search alumni" aria-label="Search alumni" autoFocus />
          {results && results.length === 0 && query.trim().length >= 2 && (
            <p style={note}>No one matches. Use New to the app to add them.</p>
          )}
          {(results || []).map(s => (
            <div key={s.id} className="ngrp-add-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{s.last_name}, {s.preferred_first_name || s.first_name}</div>
                <div style={note}>{[s.cohort, s.school, s.personal_email].filter(Boolean).join(' · ')}</div>
              </div>
              <button type="button" style={btn(true)} disabled={busyId === s.id} onClick={() => addExisting(s)}>
                {busyId === s.id ? 'Adding…' : 'Add'}
              </button>
            </div>
          ))}
        </>)}

        {mode === 'new' && (<>
          <p style={note}>The details the residency application needs. They join the {cycle.name} roster and get the Transition Form like everyone else.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 14px' }}>
            <Field label="Legal first name *"><input style={inputStyle} value={p.first_name} onChange={e => set('first_name', e.target.value)} /></Field>
            <Field label="Legal last name *"><input style={inputStyle} value={p.last_name} onChange={e => set('last_name', e.target.value)} /></Field>
            <Field label="Preferred first name"><input style={inputStyle} value={p.preferred_first_name} onChange={e => set('preferred_first_name', e.target.value)} /></Field>
            <Field label="Personal email *"><input type="email" style={inputStyle} value={p.personal_email} onChange={e => set('personal_email', e.target.value)} /></Field>
            <Field label="ASPIRE cohort *">
              <select style={inputStyle} value={cohortId} onChange={e => setCohortId(e.target.value)}>
                <option value="">Choose a cohort…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW_COHORT}>+ A past cohort not listed…</option>
              </select>
            </Field>
            {cohortId === NEW_COHORT
              ? <Field label="Past cohort name *"><input style={inputStyle} value={newCohort} onChange={e => setNewCohort(e.target.value)} placeholder="e.g. Fall 2025" /></Field>
              : <div />}
          </div>
          {fieldErr('first_name') || fieldErr('last_name') || fieldErr('personal_email') || fieldErr('cohort')
            ? <p className="ngrp-add-error" role="alert">{errText(errors)}</p> : null}

          <SegmentedPicker ariaLabel="Then" value={then} onChange={setThen}
            options={[{ value: 'fill', label: 'Fill in the rest now' }, { value: 'invite', label: 'Send a portal link to fill it in' }]} />

          {then === 'fill' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 14px' }}>
              <Field label="Mobile phone"><input type="tel" style={inputStyle} value={p.phone} onChange={e => set('phone', e.target.value)} /></Field>
              <Field label="Nursing school"><input style={inputStyle} value={p.school} onChange={e => set('school', e.target.value)} /></Field>
              <Field label="Program">
                <select style={inputStyle} value={p.program_type} onChange={e => set('program_type', e.target.value)}>
                  <option value="">Select…</option>
                  {PROGRAMS.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Graduation or expected completion"><input type="date" style={inputStyle} value={p.estimated_graduation_date} onChange={e => set('estimated_graduation_date', e.target.value)} /></Field>
              <Field label="Unit they precepted on" span2>
                <select style={inputStyle} value={p.precepted_unit} onChange={e => set('precepted_unit', e.target.value)}>
                  <option value="">Select…</option>
                  {unitNames.map(u => <option key={u} value={u}>{unitOptionLabel(u)}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <p style={note}>
              We will send the Student Portal invitation to their personal email. Once they sign in, their
              Residency tab asks for the rest of their application profile.
            </p>
          )}

          {matches && (
            <div className="ngrp-add-match" role="alert">
              <p style={{ ...note, color: 'var(--text-heading)', fontWeight: 600 }}>This may be someone already in the app:</p>
              {matches.map(m => (
                <div key={m.id} style={note}>{m.last_name}, {m.first_name} · {[m.cohort, m.status, m.personal_email].filter(Boolean).join(' · ')}</div>
              ))}
              <p style={note}>If it is them, use Already in the app. If not, add them as a new person.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" style={btn(false)} onClick={() => { setMode('existing'); setQuery(p.last_name); setMatches(null) }}>Find them</button>
                <button type="button" style={btn(true)} disabled={saving} onClick={() => createNew(true)}>It is a different person</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" style={btn(true)} disabled={!canCreate || saving} onClick={() => createNew(false)}>
              {saving ? 'Adding…' : then === 'invite' ? 'Add and send the portal link' : 'Add to roster'}
            </button>
          </div>
        </>)}
      </div>
    </DetailDrawer>
  )
}
