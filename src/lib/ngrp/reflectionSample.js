// src/lib/ngrp/reflectionSample.js
//
// RESIDENCY-REFLECTION-3 (Owner, 2026-09-14): a SAMPLE of the reflection form,
// for showing the NGRP team what a resident sees without hiring anyone, minting
// a token, or sending an email.
//
// Opening /ngrp/reflection#sample renders the real page with a made-up resident
// and an in-memory stand-in for the endpoint: load answers with the fixture,
// autosave and the schedule edits change only this object, and Submit runs the
// SAME validateReflection the server runs, then shows the thank-you screen.
// Nothing reaches /api/ngrp-reflection. There is no token, so nothing here can
// ever be mistaken for, or turned into, a real link.
//
// Browser-safe and pure, so the tests exercise the responder directly.
import { buildSchedule, closesOn, validateReflection, PERIOD_COUNT } from './ngrpReflectionForm.js'

export const SAMPLE_HASH = '#sample'
export const SAMPLE_PATH = '/ngrp/reflection#sample'

export function isSampleHash(hash) {
  return hash === SAMPLE_HASH
}

// The same worked example the email preview uses: started Friday 2026-09-18,
// so period 1 is due Sunday October 4, and the tests already pin those dates.
const SCHEDULE = buildSchedule({ startedOn: '2026-09-18' })
const PERIOD = SCHEDULE[0]

export const SAMPLE_RESIDENT = Object.freeze({
  residentName: 'Jordan',
  residentFullName: 'Jordan Avery',
  unit: '5 SCCT',
  residentShift: 'Night',
})

// Four working days: two before the period, two inside it (those two seed
// shift cards), so the calendar and the seeding both show on first open.
const SAMPLE_MARKS = ['2026-09-15', '2026-09-16', '2026-09-21', '2026-09-22']

export function sampleLoad(marks) {
  return {
    state: 'form',
    ...SAMPLE_RESIDENT,
    periodNumber: PERIOD.period_number,
    periodCount: PERIOD_COUNT,
    opensOn: PERIOD.opens_on,
    dueOn: PERIOD.due_on,
    closesOn: closesOn(PERIOD),
    base: null,
    baseKind: 'none',
    submittedAt: null,
    schedule: marks.map(on_date => ({ on_date, shift: null })),
  }
}

/**
 * An in-memory stand-in for the public endpoint, with the endpoint's own shape:
 * { status, body }. One instance per page open; state lives in the closure.
 */
export function createSampleResponder() {
  let marks = [...SAMPLE_MARKS]
  let submitted = false
  return async (action, extra = {}) => {
    switch (action) {
      case 'load':
        return { status: 200, body: sampleLoad(marks) }
      case 'save_draft':
        return { status: 200, body: { saved: true, savedAt: new Date().toISOString() } }
      case 'schedule_add': {
        const d = typeof extra.date === 'string' ? extra.date : ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { status: 422, body: { error: 'Choose a valid date.' } }
        if (!marks.includes(d)) marks = [...marks, d].sort()
        return { status: 200, body: { ok: true, schedule: marks.map(on_date => ({ on_date, shift: null })) } }
      }
      case 'schedule_remove':
        marks = marks.filter(m => m !== extra.date)
        return { status: 200, body: { ok: true, schedule: marks.map(on_date => ({ on_date, shift: null })) } }
      case 'submit': {
        if (submitted) return { status: 409, body: { error: 'Already submitted.' } }
        const v = validateReflection(extra.payload, { periodNumber: PERIOD.period_number, requireComplete: true })
        if (!v.ok) return { status: 422, body: { errors: v.errors } }
        submitted = true
        return { status: 200, body: { success: true, submittedAt: new Date().toISOString() } }
      }
      default:
        return { status: 400, body: { error: 'Invalid request body' } }
    }
  }
}
