// TRANSITION-FORM-PREVIEW-1: the form preview is the real page on a sample load response.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transitionFormPreview } from '../src/lib/ngrp/transitionFormPreview.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('the preview carries the cohort configuration and a synthetic person', () => {
  const p = transitionFormPreview({
    cycle: { name: 'Winter 2027', application_deadline: '2026-11-05', application_checklist: null },
    units: [
      { unit_name: '6 NE', is_active: true, display_order: 2 },
      { unit_name: '5 North', is_active: true, display_order: 1 },
      { unit_name: 'Retired', is_active: false, display_order: 0 },
    ],
  })
  assert.equal(p.cycleName, 'Winter 2027')
  assert.deepEqual(p.units, ['5 North', '6 NE'])
  assert.ok(p.closeAt && p.closeAt.startsWith('2026-11-06'))
  assert.ok(p.checklist.length > 0)
  assert.equal(p.studentFullName, 'Jordan Avery')
  assert.match(p.suggestedEmail, /@example\.com$/)
  assert.equal(p.revisionCount, 0)
})

test('no cohort still renders a form with no close date', () => {
  const p = transitionFormPreview()
  assert.equal(p.closeAt, null)
  assert.deepEqual(p.units, [])
})

test('the page in preview mode calls no endpoint and never submits', () => {
  const page = read('src/pages/NgrpTransitionFormPage.jsx')
  assert.match(page, /if \(initial\.preview\) return\n\s+dirtyRef/)
  assert.match(page, /if \(submitting \|\| initial\.preview\) return/)
  assert.match(page, /disabled=\{submitting \|\| initial\.preview\}/)
  assert.match(page, /if \(!initial\.preview\) window\.history\.replaceState/)
})

test('the page renders the whole form, with the preview note and Submit off', async () => {
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  try {
    const { default: Page } = await vite.ssrLoadModule('/src/pages/NgrpTransitionFormPage.jsx')
    const preview = transitionFormPreview({
      cycle: { name: 'Winter 2027', application_deadline: '2026-11-05' },
      units: [{ unit_name: '5 North', is_active: true }],
    })
    const html = renderToStaticMarkup(React.createElement(Page, { preview }))
    assert.match(html, /NGRP Transition Form/)
    assert.match(html, /Winter 2027 residency cohort · Jordan Avery · open until November 5, 2026/)
    assert.match(html, /Preview with sample data/)
    // The ranked hiring units appear only after "Interested" is picked, as on the real form.
    assert.match(html, /5 · Residency interest/)
    assert.match(html, /7 · Attestation/)
    assert.match(html, /<button type="submit" class="ngrpf-submit" disabled="">Submit Transition Form<\/button>/)
    assert.doesNotMatch(html, /One moment|Link not available/)
  } finally {
    await vite.close()
  }
})

test('TRANSITION-FORM-READINESS-1: Online application stays official but is not on the form', async () => {
  const { formReadinessChecklist, DEFAULT_APPLICATION_CHECKLIST } = await import('../lib/server/ngrpEligibility.js')
  assert.ok(DEFAULT_APPLICATION_CHECKLIST.some(i => i.key === 'online_application'), 'still an official requirement')
  assert.deepEqual(formReadinessChecklist(null).map(i => i.key), ['resume', 'personal_statement', 'transcript', 'recommendation_letters'])
  const stored = [...DEFAULT_APPLICATION_CHECKLIST, { key: 'extra_1', label: 'Cover letter', required: true }]
  assert.deepEqual(formReadinessChecklist(stored).map(i => i.key).slice(-1), ['extra_1'])
  assert.ok(!formReadinessChecklist(stored).some(i => i.key === 'online_application'))
  const { validateSubmission } = await import('../lib/server/ngrpTransition.js')
  const r = validateSubmission({ readiness: { online_application: true, resume: true } }, { checklist: stored, requireComplete: false })
  assert.equal('online_application' in r.payload.readiness, false)
  assert.equal(r.payload.readiness.resume, true)
  assert.match(read('api/ngrp-transition.js'), /const checklist = formReadinessChecklist\(cycle\.application_checklist\)/)
})

test('TRANSITION-FORM-ACLS-1: the form names this cohort\'s ACLS units and points at the rankings', async () => {
  const { ACLS_REQUIRED_UNITS } = await import('../src/lib/unitCatalog.js')
  assert.ok(!ACLS_REQUIRED_UNITS.includes('3 SCCT'), '3 SCCT is not critical care (Owner)')
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
  try {
    const { default: Page } = await vite.ssrLoadModule('/src/pages/NgrpTransitionFormPage.jsx')
    const preview = transitionFormPreview({
      cycle: { name: 'Winter 2027', application_deadline: '2026-11-11' },
      units: ['6 NE', '3 SCCT', '5 SCCT', '4 North'].map(unit_name => ({ unit_name, is_active: true })),
    })
    const html = renderToStaticMarkup(React.createElement(Page, { preview }))
    assert.match(html, /The critical care units require ACLS: 6 NE, 5 SCCT\. It is usually needed by your residency start date, not to apply\./)
    assert.match(html, /Choose Interested to rank your top three hiring units\./)
    assert.doesNotMatch(html, /Online application/)
  } finally {
    await vite.close()
  }
})
