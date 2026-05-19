import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { UNITS_BY_DIVISION, PATIENT_POPULATION_MAP } from '../lib/constants'

const PAGE_TITLE = 'ASPIRE Program: Unit Availability Form'

// Units ineligible for ASPIRE student placement
const ASPIRE_INELIGIBLE = new Set(['Emergency Department', 'Operating Room'])

const SUBMITTER_ROLES = [
  'Associate Director',
  'Acting Associate Director',
  'Executive Director',
  'Assistant Nurse Manager',
  'NPD Practitioner',
  'Clinical Nurse Specialist',
  'Charge Nurse',
  'Other',
]

const SHIFT_OPTIONS = [
  'Day Shift',
  'Night Shift',
  'Mid Shift',
  'Either / No Preference',
]

const empty = {
  unit_name:              '',
  submitter_name:         '',
  submitter_email:        '',
  submitter_role:         '',
  slots_offered:          '',
  shift_preference:       '',
  preferred_preceptors:   '',
  considerations:         '',
  reason_for_zero:        '',
  hiring_ngrp:            null,
  hiring_ngrp_reason:     '',
  has_fired_alumni:       '',
  alumni_outcome:         '',
  alumni_notes:           '',
  would_consider_alumni:  '',
}

export default function UnitFormPage() {
  const showAll        = new URLSearchParams(window.location.search).has('showAll')
  const [cohortId,     setCohortId]     = useState(null)
  const [cohortName,   setCohortName]   = useState('')
  const [open,         setOpen]         = useState(null)

  const [form,         setForm]         = useState(empty)
  const [existingRow,  setExistingRow]  = useState(null)   // unit_cohort_responses row if found
  const [lookingUp,    setLookingUp]    = useState(false)  // pre-fill lookup in progress
  const [submitting,   setSubmitting]   = useState(false)
  const [submitted,    setSubmitted]    = useState(false)
  const [error,        setError]        = useState(null)

  useEffect(() => {
    document.title = 'ASPIRE Intelligence'
    supabase.from('cohorts').select('id, name').eq('accepting_submissions', true)
      .limit(1).single()
      .then(({ data }) => {
        if (data) { setCohortId(data.id); setCohortName(data.name); setOpen(true) }
        else setOpen(false)
      })
  }, [])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  // Pre-fill from unit_cohort_responses when unit is selected
  const handleUnitChange = useCallback(async (unitName) => {
    set('unit_name', unitName)
    setExistingRow(null)
    if (!unitName || !cohortId) return

    setLookingUp(true)
    try {
      // Find units row for this unit_name + cohort
      const { data: unitsRow } = await supabase
        .from('units')
        .select('id')
        .eq('cohort_id', cohortId)
        .eq('unit_name', unitName)
        .limit(1)
        .maybeSingle()

      if (!unitsRow) { setLookingUp(false); return }

      // Find response row
      const { data: responseRow } = await supabase
        .from('unit_cohort_responses')
        .select('*')
        .eq('cohort_id', cohortId)
        .eq('unit_id', unitsRow.id)
        .maybeSingle()

      if (responseRow && responseRow.response_status !== 'pending') {
        setExistingRow(responseRow)
        setForm({
          unit_name:             unitName,
          submitter_name:        responseRow.submitted_by_name  || '',
          submitter_email:       responseRow.submitted_by_email || '',
          submitter_role:        responseRow.submitted_by_role  || '',
          slots_offered:         responseRow.slots_offered != null ? String(responseRow.slots_offered) : '',
          shift_preference:      responseRow.shift_preference   || '',
          preferred_preceptors:  responseRow.preferred_preceptors || '',
          considerations:        responseRow.considerations     || '',
          reason_for_zero:       responseRow.reason_for_zero   || '',
          hiring_ngrp:           responseRow.hiring_new_grads_ngrp ?? null,
          hiring_ngrp_reason:    responseRow.hiring_new_grads_reason || '',
          has_fired_alumni:      responseRow.has_hired_aspire_alumni || '',
          alumni_outcome:        responseRow.aspire_alumni_outcome || '',
          alumni_notes:          responseRow.aspire_alumni_notes || '',
          would_consider_alumni: responseRow.would_consider_aspire_alumni || '',
        })
      }
    } catch (err) {
      console.error('[UnitForm] prefill error:', err)
    }
    setLookingUp(false)
  }, [cohortId])

  const slotsNum = parseInt(form.slots_offered) || 0
  const isHosting = slotsNum > 0

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)

    if (!form.unit_name) return setError('Please select your unit or department.')
    if (!form.submitter_name.trim()) return setError('Please enter your name.')
    if (!form.submitter_email.trim()) return setError('Please enter your email address.')
    if (!form.submitter_role) return setError('Please select your role.')
    if (form.slots_offered === '') return setError('Please enter the number of slots (enter 0 if not hosting).')
    if (!isHosting && form.hiring_ngrp === null) return setError('Please answer the NGRP hiring question.')
    if (isHosting && form.hiring_ngrp === null) return setError('Please answer the NGRP hiring question.')

    setSubmitting(true)
    try {
      // 1. Upsert the units row (ensures matching board has a record)
      let unitId
      const { data: existingUnit } = await supabase
        .from('units')
        .select('id')
        .eq('cohort_id', cohortId)
        .eq('unit_name', form.unit_name.trim())
        .limit(1)
        .maybeSingle()

      if (existingUnit) {
        unitId = existingUnit.id
        await supabase.from('units').update({
          contact_person:   form.submitter_name.trim(),
          contact_email:    form.submitter_email.trim(),
          is_participating: isHosting,
          total_slots:      isHosting ? slotsNum : 0,
          slots_remaining:  isHosting ? slotsNum : 0,
          shift_preference: form.shift_preference,
          preceptors:       form.preferred_preceptors.trim(),
          considerations:   form.considerations.trim(),
        }).eq('id', unitId)
      } else {
        const { data: newUnit, error: unitErr } = await supabase.from('units').insert({
          unit_name:          form.unit_name.trim(),
          contact_person:     form.submitter_name.trim(),
          contact_email:      form.submitter_email.trim(),
          is_participating:   isHosting,
          total_slots:        isHosting ? slotsNum : 0,
          slots_remaining:    isHosting ? slotsNum : 0,
          shift_preference:   form.shift_preference,
          preceptors:         form.preferred_preceptors.trim(),
          considerations:     form.considerations.trim(),
          patient_population: PATIENT_POPULATION_MAP[form.unit_name.trim()] || '',
          cohort_id:          cohortId,
        }).select('id').single()

        if (unitErr) throw unitErr
        unitId = newUnit.id
      }

      // 2. Upsert unit_cohort_responses
      const now = new Date().toISOString()
      const prevCount = existingRow?.submission_count || 0
      const upsertData = {
        cohort_id:                    cohortId,
        unit_id:                      unitId,
        unit_name:                    form.unit_name.trim(),
        response_status:              isHosting ? 'submitted_hosting' : 'submitted_not_hosting',
        submitted_by_name:            form.submitter_name.trim(),
        submitted_by_email:           form.submitter_email.trim(),
        submitted_by_role:            form.submitter_role,
        slots_offered:                isHosting ? slotsNum : 0,
        shift_preference:             form.shift_preference || null,
        preferred_preceptors:         form.preferred_preceptors.trim() || null,
        considerations:               form.considerations.trim() || null,
        reason_for_zero:              !isHosting ? (form.reason_for_zero.trim() || null) : null,
        hiring_new_grads_ngrp:        form.hiring_ngrp,
        hiring_new_grads_reason:      form.hiring_ngrp === false ? (form.hiring_ngrp_reason.trim() || null) : null,
        has_hired_aspire_alumni:      form.has_fired_alumni || null,
        aspire_alumni_outcome:        form.has_fired_alumni === 'yes' ? (form.alumni_outcome || null) : null,
        aspire_alumni_notes:          form.has_fired_alumni === 'yes' ? (form.alumni_notes.trim() || null) : null,
        would_consider_aspire_alumni: form.has_fired_alumni === 'no'  ? (form.would_consider_alumni || null) : null,
        submission_count:             prevCount + 1,
        submitted_at:                 existingRow?.submitted_at || now,
        last_updated_at:              now,
      }

      const { error: upsertErr } = await supabase
        .from('unit_cohort_responses')
        .upsert(upsertData, { onConflict: 'cohort_id,unit_id' })

      if (upsertErr) throw upsertErr

      // 3. Fire-and-forget notification
      fetch('/api/unit-form-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohortId,
          cohortName,
          unitName:            form.unit_name.trim(),
          submitterName:       form.submitter_name.trim(),
          submitterEmail:      form.submitter_email.trim(),
          submitterRole:       form.submitter_role,
          slotsOffered:        isHosting ? slotsNum : 0,
          shiftPreference:     form.shift_preference || null,
          preferredPreceptors: form.preferred_preceptors.trim() || null,
          considerations:      form.considerations.trim() || null,
          reasonForZero:       !isHosting ? (form.reason_for_zero.trim() || null) : null,
          hiringNgrp:          form.hiring_ngrp,
          hiringNgrpReason:    form.hiring_ngrp === false ? (form.hiring_ngrp_reason.trim() || null) : null,
          hasFiredAlumni:      form.has_fired_alumni || null,
          alumniOutcome:       form.alumni_outcome || null,
          alumniNotes:         form.alumni_notes.trim() || null,
          wouldConsiderAlumni: form.would_consider_alumni || null,
        }),
      }).catch(err => console.warn('[UnitForm] notification failed (non-fatal):', err))

      setSubmitted(true)
    } catch (err) {
      console.error('[UnitForm] submit error:', err)
      setError('Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  // ── Loading / closed / submitted states ────────────────────────────────────

  if (open === null) return (
    <div className="uf-page">
      <div className="uf-card" style={{ textAlign:'center', padding:'60px 40px' }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <p style={{ color:'var(--text-secondary)' }}>Loading…</p>
      </div>
    </div>
  )

  if (open === false) return (
    <div className="uf-page">
      <div className="uf-card" style={{ textAlign:'center', padding:'56px 40px' }}>
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <h2 className="uf-title" style={{ marginBottom:12 }}>{PAGE_TITLE}</h2>
        <p style={{ color:'var(--text-secondary)', fontSize:15, lineHeight:1.6 }}>
          Submissions are not currently open. Please contact the ASPIRE team for more information.
        </p>
      </div>
    </div>
  )

  if (submitted) return (
    <div className="uf-page">
      <div className="uf-card uf-card-confirm">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-confirm-icon">✓</div>
        <h2 className="uf-confirm-title">
          {isHosting ? `Thank you, ${form.unit_name}.` : 'Response recorded.'}
        </h2>
        <p className="uf-confirm-msg">
          {isHosting
            ? `Your unit's availability has been recorded for ${cohortName}. Confirmation sent to ${form.submitter_email}.`
            : `We've noted that ${form.unit_name} is unable to host this cohort. Thank you for the honest response.`}
        </p>
        {existingRow && (
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginTop:8 }}>
            This was an update to your previous submission.
          </p>
        )}
      </div>
    </div>
  )

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <div className="uf-page">
      <div className="uf-card">
        <img src="/Cedars-Sinai.png" alt="Cedars-Sinai" height="44" className="uf-logo" />
        <div className="uf-header">
          <h1 className="uf-title">{PAGE_TITLE}</h1>
          {cohortName && <div className="uf-cohort-badge">{cohortName}</div>}
          <p style={{ fontSize:15, color:'var(--raven)', textAlign:'center', lineHeight:1.65 }}>
            Thank you for your interest in hosting senior student nurses through the ASPIRE Program.
            Please complete this form to indicate your unit's response for the upcoming cohort.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ margin:'0 0 8px' }}>{error}</div>}

          {/* ── SECTION 1: Identify ── */}
          <div className="uf-section-header">Section 1: Identify</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Select Your Unit or Department *</label>
              <select className="uf-input" value={form.unit_name}
                onChange={e => handleUnitChange(e.target.value)}>
                <option value="">Select your unit or department…</option>
                {Object.entries(UNITS_BY_DIVISION).map(([division, units]) => (
                  <optgroup key={division} label={division}>
                    {units
                      .filter(u => showAll || !ASPIRE_INELIGIBLE.has(u))
                      .map(u => {
                        const desc = PATIENT_POPULATION_MAP[u]
                        return <option key={u} value={u}>{desc ? `${u} - ${desc}` : u}</option>
                      })}
                  </optgroup>
                ))}
              </select>
              {form.unit_name && PATIENT_POPULATION_MAP[form.unit_name] && (
                <p className="uf-unit-pop">{PATIENT_POPULATION_MAP[form.unit_name]}</p>
              )}
              {lookingUp && (
                <p style={{ fontSize:13, color:'#9ca3af', marginTop:4 }}>Checking for previous response…</p>
              )}
              {existingRow && !lookingUp && (
                <div style={{ marginTop:8, padding:'10px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, fontSize:13, color:'#1e40af' }}>
                  We have a previous response on file for <strong>{form.unit_name}</strong>. You can update it below.
                </div>
              )}
            </div>

            <div className="uf-field">
              <label className="uf-label">Your Name *</label>
              <input className="uf-input" value={form.submitter_name}
                onChange={e => set('submitter_name', e.target.value)}
                placeholder="e.g. Jane Smith, RN" />
            </div>

            <div className="uf-field">
              <label className="uf-label">Your Email Address *</label>
              <input className="uf-input" type="email" value={form.submitter_email}
                onChange={e => set('submitter_email', e.target.value)}
                placeholder="you@cshs.org" />
            </div>

            <div className="uf-field">
              <label className="uf-label">Your Role *</label>
              <select className="uf-input" value={form.submitter_role}
                onChange={e => set('submitter_role', e.target.value)}>
                <option value="">Select your role…</option>
                {SUBMITTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* ── SECTION 2: Capacity ── */}
          <div className="uf-section-header">Section 2: Capacity</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Number of students your unit can host this cohort *</label>
              <input className="uf-input uf-input-sm" type="text" inputMode="numeric" pattern="[0-9]*"
                value={form.slots_offered}
                onChange={e => set('slots_offered', e.target.value)}
                placeholder="Enter 0 if unable to host" />
              <p style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>Enter 0 if your unit is unable to host students this cycle.</p>
            </div>

            {/* Not hosting: reason */}
            {form.slots_offered !== '' && !isHosting && (
              <div className="uf-field">
                <label className="uf-label">Reason for not hosting this cycle (optional)</label>
                <textarea className="uf-textarea" rows={3} value={form.reason_for_zero}
                  onChange={e => set('reason_for_zero', e.target.value)}
                  placeholder="Help us understand the context so we can plan better. Anything you share stays internal." />
              </div>
            )}

            {/* Hosting: additional capacity fields */}
            {isHosting && (
              <>
                <div className="uf-field">
                  <label className="uf-label">Shift preference</label>
                  <select className="uf-input" value={form.shift_preference}
                    onChange={e => set('shift_preference', e.target.value)}>
                    <option value="">Select a preference…</option>
                    {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="uf-field">
                  <label className="uf-label">Preferred preceptors (optional)</label>
                  <textarea className="uf-textarea" rows={3} value={form.preferred_preceptors}
                    onChange={e => set('preferred_preceptors', e.target.value)}
                    placeholder="Optional — you can leave this blank if preceptor assignments aren't finalized yet." />
                </div>
              </>
            )}
          </div>

          {/* ── SECTION 3: NGRP Hiring ── */}
          <div className="uf-section-header">Section 3: NGRP Hiring Intent</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Does your unit plan to hire new graduate RNs for the upcoming NGRP cohort? *</label>
              <div className="uf-radio-group">
                <label className="uf-radio-label">
                  <input type="radio" name="hiring_ngrp"
                    checked={form.hiring_ngrp === true}
                    onChange={() => set('hiring_ngrp', true)} />
                  <span>Yes</span>
                </label>
                <label className="uf-radio-label">
                  <input type="radio" name="hiring_ngrp"
                    checked={form.hiring_ngrp === false}
                    onChange={() => set('hiring_ngrp', false)} />
                  <span>No</span>
                </label>
              </div>
            </div>

            {form.hiring_ngrp === false && (
              <div className="uf-field">
                <label className="uf-label">Why not? (required)</label>
                <textarea className="uf-textarea" rows={3} value={form.hiring_ngrp_reason}
                  onChange={e => set('hiring_ngrp_reason', e.target.value)}
                  placeholder="e.g. staffing freeze, budget constraints, recent hire cohort not yet onboarded" />
              </div>
            )}
          </div>

          {/* ── SECTION 4: ASPIRE Alumni ── */}
          <div className="uf-section-header">Section 4: ASPIRE Alumni Experience <span style={{ fontWeight:400, fontSize:13, color:'#9ca3af' }}>(optional)</span></div>
          <div className="uf-section">
            <p style={{ fontSize:13, color:'#6b7280', margin:'0 0 12px', lineHeight:1.6 }}>
              Share your experience if you'd like. This helps us understand the long-term impact of the program.
            </p>

            <div className="uf-field">
              <label className="uf-label">Has your unit ever hired an ASPIRE participant into the NGRP?</label>
              <div className="uf-radio-group">
                {[['yes','Yes'],['no','No'],['not_sure','Not sure']].map(([v, l]) => (
                  <label key={v} className="uf-radio-label">
                    <input type="radio" name="has_fired_alumni"
                      checked={form.has_fired_alumni === v}
                      onChange={() => set('has_fired_alumni', v)} />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>

            {form.has_fired_alumni === 'yes' && (
              <>
                <div className="uf-field">
                  <label className="uf-label">How was the experience?</label>
                  <div className="uf-radio-group">
                    {[['successful','Successful'],['mixed','Mixed'],['would_not_hire_again','Would not hire again']].map(([v, l]) => (
                      <label key={v} className="uf-radio-label">
                        <input type="radio" name="alumni_outcome"
                          checked={form.alumni_outcome === v}
                          onChange={() => set('alumni_outcome', v)} />
                        <span>{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="uf-field">
                  <label className="uf-label">Anything you'd like to share? (optional)</label>
                  <textarea className="uf-textarea" rows={3} value={form.alumni_notes}
                    onChange={e => set('alumni_notes', e.target.value)}
                    placeholder="e.g. how the student transitioned, standout qualities, lessons learned" />
                </div>
              </>
            )}

            {form.has_fired_alumni === 'no' && (
              <div className="uf-field">
                <label className="uf-label">Would you consider hiring an ASPIRE alumnus in the future?</label>
                <div className="uf-radio-group">
                  {[['yes','Yes'],['no','No'],['maybe','Maybe']].map(([v, l]) => (
                    <label key={v} className="uf-radio-label">
                      <input type="radio" name="would_consider_alumni"
                        checked={form.would_consider_alumni === v}
                        onChange={() => set('would_consider_alumni', v)} />
                      <span>{l}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── SECTION 5: Additional Notes ── */}
          <div className="uf-section-header">Section 5: Additional Notes</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">Any other considerations or requirements? (optional)</label>
              <textarea className="uf-textarea" rows={3} value={form.considerations}
                onChange={e => set('considerations', e.target.value)}
                placeholder="e.g. scheduling requirements, dress code, skill level preferences, anything else we should know" />
            </div>
          </div>

          <div className="uf-submit-row">
            <button type="submit" className="uf-submit-btn"
              disabled={submitting || !form.unit_name || !form.submitter_name || !form.submitter_email || !form.submitter_role || form.slots_offered === ''}>
              {submitting ? 'Submitting…' : existingRow ? 'Update Response' : 'Submit Response'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
