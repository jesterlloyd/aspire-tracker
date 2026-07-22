import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getUnitsByDivision, getUnit, DIVISION_ORDER } from '../lib/unitCatalog'
import {
  SUBMITTER_ROLES, SHIFT_PREFERENCE_OPTIONS, ALUMNI_HIRED_OPTIONS,
  ALUMNI_OUTCOME_OPTIONS, WOULD_CONSIDER_OPTIONS, PARTICIPATION_TEXT,
  emptyParticipation, participationSlots, isHostingParticipation, validateParticipation,
} from '../lib/unitParticipationForm'

const PAGE_TITLE = 'ASPIRE: Unit Availability Form'

// Field options, labels, empty state, and validation are the CANONICAL definitions shared
// with the Unit Leader Portal Capacity screen (src/lib/unitParticipationForm.js), so the
// public form and the portal form cannot drift. Computed from unitCatalog at module load;
// ?showAll=true renders all 27 including ED/OR.
const empty = emptyParticipation()

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
      // PHASE0B-WAVE-D: pre-fill moved server-side. The endpoint resolves the
      // accepting cohort itself and returns only the allow-listed pre-fill
      // fields for this unit, so the anon SELECT policies on units and
      // unit_cohort_responses can be dropped.
      const lookupRes = await fetch('/api/unit-form-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_name: unitName }),
      })
      const lookupData = await lookupRes.json().catch(() => ({}))
      const responseRow = (lookupRes.ok && lookupData.found) ? lookupData.response : null

      if (responseRow) {
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

  const slotsNum = participationSlots(form)
  const isHosting = isHostingParticipation(form)

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)

    // Shared canonical validation (identity required for the public form).
    const invalid = validateParticipation(form, { requireIdentity: true })
    if (invalid) return setError(invalid)

    setSubmitting(true)

    // UI safety timeout: fires at 12s regardless of what Supabase does.
    // Guards against abortSignal not propagating correctly through maybeSingle
    // chains (observed Supabase v2 issue where the await hangs and catch/finally
    // never run, leaving the button permanently stuck on "Submitting...").
    let uiResetFired = false
    const uiTimeoutId = setTimeout(() => {
      uiResetFired = true
      console.warn('[UnitForm] UI safety timeout fired at 12s')
      setSubmitting(false)
      setError("We're experiencing a technical issue with form submissions. We're working on a fix. In the meantime, please email your responses directly to JesterLloyd.Bautista@cshs.org and we'll log them manually. Sorry for the inconvenience.")
    }, 12000)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      // PHASE0B-WAVE-D: submission moved server-side. The endpoint resolves
      // the accepting cohort itself, upserts the units row and the
      // unit_cohort_responses row, and owns submission_count / submitted_at /
      // last_updated_at, so the anon write policies on both tables can be
      // dropped. Field mapping is unchanged from the previous client upsert.
      const submitRes = await fetch('/api/unit-form-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          unit_name:             form.unit_name.trim(),
          submitter_name:        form.submitter_name.trim(),
          submitter_email:       form.submitter_email.trim(),
          submitter_role:        form.submitter_role,
          slots_offered:         slotsNum,
          shift_preference:      form.shift_preference,
          preferred_preceptors:  form.preferred_preceptors.trim(),
          considerations:        form.considerations.trim(),
          reason_for_zero:       form.reason_for_zero.trim(),
          hiring_ngrp:           form.hiring_ngrp,
          hiring_ngrp_reason:    form.hiring_ngrp_reason.trim(),
          has_fired_alumni:      form.has_fired_alumni,
          alumni_outcome:        form.alumni_outcome,
          alumni_notes:          form.alumni_notes.trim(),
          would_consider_alumni: form.would_consider_alumni,
        }),
      })
      const submitData = await submitRes.json().catch(() => ({}))
      if (!submitRes.ok) {
        throw new Error(submitData.message || 'Something went wrong. Please try again.')
      }

      clearTimeout(timeoutId)
      clearTimeout(uiTimeoutId)
      if (uiResetFired) {
        // UI already showed a timeout error; don't override with success.
        // The write likely completed anyway - data is safe on the server.
        console.warn('[UnitForm] submit completed after UI timeout already fired')
        return
      }

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
      clearTimeout(timeoutId)
      clearTimeout(uiTimeoutId)
      if (uiResetFired) return  // UI already handled the timeout; don't override
      console.error('[UnitForm] submit error:', err)
      setError(err.name === 'AbortError' ? 'Submit timed out. Please try again.' : (err.message || 'Something went wrong. Please try again.'))
    } finally {
      clearTimeout(timeoutId)
      clearTimeout(uiTimeoutId)
      if (!uiResetFired) setSubmitting(false)
    }
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
            Thank you for your interest in hosting senior student nurses through ASPIRE.
            Please complete this form to indicate your unit's response for the upcoming cohort.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="uf-form">
          {error && <div className="error-msg" style={{ margin:'0 0 8px' }}>{error}</div>}

          {/* ── SECTION 1: Identify ── */}
          <div className="uf-section-header">Section 1: Identify</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">{PARTICIPATION_TEXT.unitLabel} *</label>
              <select className="uf-input" value={form.unit_name}
                onChange={e => handleUnitChange(e.target.value)}>
                <option value="">Select your unit or department…</option>
                {(() => {
                  const grouped = getUnitsByDivision(showAll)
                  return DIVISION_ORDER.filter(d => grouped[d]).map(division => (
                    <optgroup key={division} label={division}>
                      {grouped[division].map(u => (
                        <option key={u.name} value={u.name}>
                          {u.name}, {u.description}
                        </option>
                      ))}
                    </optgroup>
                  ))
                })()}
              </select>
              {form.unit_name && getUnit(form.unit_name) && (
                <p className="uf-unit-pop">{getUnit(form.unit_name).description}</p>
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
              <label className="uf-label">{PARTICIPATION_TEXT.nameLabel} *</label>
              <input className="uf-input" value={form.submitter_name}
                onChange={e => set('submitter_name', e.target.value)}
                placeholder="e.g. Jane Smith, RN" />
            </div>

            <div className="uf-field">
              <label className="uf-label">{PARTICIPATION_TEXT.emailLabel} *</label>
              <input className="uf-input" type="email" value={form.submitter_email}
                onChange={e => set('submitter_email', e.target.value)}
                placeholder="you@cshs.org" />
            </div>

            <div className="uf-field">
              <label className="uf-label">{PARTICIPATION_TEXT.roleLabel} *</label>
              <select className="uf-input" value={form.submitter_role}
                onChange={e => set('submitter_role', e.target.value)}>
                <option value="">{PARTICIPATION_TEXT.rolePlaceholder}</option>
                {SUBMITTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* ── SECTION 2: Capacity ── */}
          <div className="uf-section-header">Section 2: Capacity</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">{PARTICIPATION_TEXT.slotsLabel} *</label>
              <input className="uf-input uf-input-sm" type="text" inputMode="numeric" pattern="[0-9]*"
                value={form.slots_offered}
                onChange={e => set('slots_offered', e.target.value)}
                placeholder={PARTICIPATION_TEXT.slotsPlaceholder} />
              <p style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>{PARTICIPATION_TEXT.slotsHelp}</p>
            </div>

            {/* Not hosting: reason */}
            {form.slots_offered !== '' && !isHosting && (
              <div className="uf-field">
                <label className="uf-label">{PARTICIPATION_TEXT.reasonLabel}</label>
                <textarea className="uf-textarea" rows={3} value={form.reason_for_zero}
                  onChange={e => set('reason_for_zero', e.target.value)}
                  placeholder={PARTICIPATION_TEXT.reasonPlaceholder} />
              </div>
            )}

            {/* Hosting: additional capacity fields */}
            {isHosting && (
              <>
                <div className="uf-field">
                  <label className="uf-label">{PARTICIPATION_TEXT.shiftLabel}</label>
                  <select className="uf-input" value={form.shift_preference}
                    onChange={e => set('shift_preference', e.target.value)}>
                    <option value="">{PARTICIPATION_TEXT.shiftPlaceholder}</option>
                    {SHIFT_PREFERENCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="uf-field">
                  <label className="uf-label">{PARTICIPATION_TEXT.preceptorsLabel}</label>
                  <textarea className="uf-textarea" rows={3} value={form.preferred_preceptors}
                    onChange={e => set('preferred_preceptors', e.target.value)}
                    placeholder={PARTICIPATION_TEXT.preceptorsPlaceholder} />
                </div>
              </>
            )}
          </div>

          {/* ── SECTION 3: NGRP Hiring ── */}
          <div className="uf-section-header">Section 3: NGRP Hiring Intent</div>
          <div className="uf-section">
            <div className="uf-field">
              <label className="uf-label">{PARTICIPATION_TEXT.ngrpLabel} *</label>
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
                <label className="uf-label">{PARTICIPATION_TEXT.ngrpReasonLabel}</label>
                <textarea className="uf-textarea" rows={3} value={form.hiring_ngrp_reason}
                  onChange={e => set('hiring_ngrp_reason', e.target.value)}
                  placeholder={PARTICIPATION_TEXT.ngrpReasonPlaceholder} />
              </div>
            )}
          </div>

          {/* ── SECTION 4: ASPIRE Alumni ── */}
          <div className="uf-section-header">Section 4: ASPIRE Alumni Experience <span style={{ fontWeight:400, fontSize:13, color:'#9ca3af' }}>(optional)</span></div>
          <div className="uf-section">
            <p style={{ fontSize:13, color:'#6b7280', margin:'0 0 12px', lineHeight:1.6 }}>
              {PARTICIPATION_TEXT.alumniIntro}
            </p>

            <div className="uf-field">
              <label className="uf-label">{PARTICIPATION_TEXT.alumniHiredLabel}</label>
              <div className="uf-radio-group">
                {ALUMNI_HIRED_OPTIONS.map(([v, l]) => (
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
                  <label className="uf-label">{PARTICIPATION_TEXT.alumniOutcomeLabel}</label>
                  <div className="uf-radio-group">
                    {ALUMNI_OUTCOME_OPTIONS.map(([v, l]) => (
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
                  <label className="uf-label">{PARTICIPATION_TEXT.alumniNotesLabel}</label>
                  <textarea className="uf-textarea" rows={3} value={form.alumni_notes}
                    onChange={e => set('alumni_notes', e.target.value)}
                    placeholder={PARTICIPATION_TEXT.alumniNotesPlaceholder} />
                </div>
              </>
            )}

            {form.has_fired_alumni === 'no' && (
              <div className="uf-field">
                <label className="uf-label">{PARTICIPATION_TEXT.wouldConsiderLabel}</label>
                <div className="uf-radio-group">
                  {WOULD_CONSIDER_OPTIONS.map(([v, l]) => (
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
              <label className="uf-label">{PARTICIPATION_TEXT.considerationsLabel}</label>
              <textarea className="uf-textarea" rows={3} value={form.considerations}
                onChange={e => set('considerations', e.target.value)}
                placeholder={PARTICIPATION_TEXT.considerationsPlaceholder} />
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
