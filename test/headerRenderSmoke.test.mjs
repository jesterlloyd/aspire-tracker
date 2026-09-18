// test/headerRenderSmoke.test.mjs
//
// THE FIRST TEST IN THIS REPOSITORY THAT ACTUALLY RENDERS A COMPONENT.
//
// On 2026-09-18 the staff app went down in production because ScopePicker referenced
// `cohortIsDemo` without destructuring it. 6657 tests passed while the app was
// completely broken, and they passed because every one of them reads SOURCE. Not one
// of them ever called a component. A ReferenceError in a render body was, until this
// file, invisible to the entire suite.
//
// test/noUndefGate.test.mjs catches that specific class statically and cheaply, and it
// is the first line of defence. This is the second, and it catches what static analysis
// cannot: a component that throws for any reason at all when React actually calls it.
// A bad hook call, a null dereference on a default prop, an icon imported under the
// wrong name, a helper that returns undefined and is then destructured.
//
// HOW IT WORKS WITH NO NEW DEPENDENCIES
//
// There is no jsdom, no @testing-library, no esbuild in this project, and node cannot
// parse JSX. Vite can, and it is already here: createServer in middleware mode exposes
// ssrLoadModule, which transforms a .jsx file on demand and hands back the real module.
// react-dom/server then renders it to a string. No DOM is needed because nothing here
// asserts on behaviour, only that rendering does not throw and that the output contains
// what it should.
//
// WHAT IT COVERS, and the list IS the coverage
//
// Presentational components that take plain props: the scope family, where the incident
// happened. Components that need a router, a query client or auth context are NOT here,
// because scaffolding four providers to smoke-test one component buys less than it
// costs. If a component moves into that category, either give it props or leave it out
// and say so, rather than quietly weakening what a passing run means.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let vite
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})
after(async () => { await vite?.close() })

const load = (path) => vite.ssrLoadModule(path)

/** Render, and turn any throw into a readable failure naming the component. */
function render(Component, props, label) {
  try {
    return renderToStaticMarkup(React.createElement(Component, props))
  } catch (err) {
    assert.fail(
      `${label} threw while rendering: ${err.constructor.name}: ${err.message}\n\n` +
      'This is the failure mode that took production down on 2026-09-18. A component ' +
      'that throws on render takes its whole subtree with it, and neither the bundler ' +
      'nor a source-reading test will tell you.')
  }
}

const EXPERIENCES = [{ id: 'internship', label: 'Internship', sub: 'Senior Clinical Rotation' }]

test('ScopePicker renders for a real cohort', async () => {
  const { default: ScopePicker } = await load('/src/components/Header/scope/ScopePicker.jsx')
  const html = render(ScopePicker, {
    experiences: EXPERIENCES,
    activeExperience: 'internship',
    cohortLabel: 'Fall 2026',
    cohortStatus: 'Active',
    cohortPane: null,
  }, 'ScopePicker (real cohort)')

  assert.match(html, /Fall 2026/, 'the cohort name must reach the pill')
  assert.match(html, /Scope/, 'the control is labelled')
  // Active is green. Read from the rendered style, not from the tone table, so this
  // fails if the wiring between them breaks rather than only if the table changes.
  assert.match(html, /#5DD39E|rgb\(93, ?211, ?158\)/i, 'an Active cohort shows the green light')
})

test('ScopePicker renders for the demo cohort, with the purple light', async () => {
  const { default: ScopePicker } = await load('/src/components/Header/scope/ScopePicker.jsx')

  // cohortIsDemo is the prop whose absence from the destructure caused the outage.
  // Passing it exercises the exact line that threw.
  const html = render(ScopePicker, {
    experiences: EXPERIENCES,
    activeExperience: 'internship',
    cohortLabel: 'Demo Cohort',
    cohortStatus: 'Active',
    cohortIsDemo: true,
    cohortPane: null,
  }, 'ScopePicker (demo cohort)')

  assert.match(html, /Demo Cohort/)
  assert.match(html, /#A855F7|rgb\(168, ?85, ?247\)/i,
    'the demo cohort must turn the scope light purple; this is how demo mode announces itself')
  assert.doesNotMatch(html, /#5DD39E/i,
    'demo must WIN over status: the cohort is Active, but that is not what the light should say')
  assert.match(html, /data-cohort-status="demo"/,
    'the hook the light exposes for anyone inspecting it')
})

test('ScopePicker renders with only its required props', async () => {
  const { default: ScopePicker } = await load('/src/components/Header/scope/ScopePicker.jsx')
  // Every optional prop omitted. This is what catches a new prop that is read in the
  // body but has no default, which is the incident bug in its general form.
  const html = render(ScopePicker, {
    experiences: EXPERIENCES,
    activeExperience: 'internship',
    cohortLabel: 'Fall 2026',
  }, 'ScopePicker (minimal props)')
  assert.ok(html.length > 100, 'it should still render something substantial')
})

test('SeasonMark renders a mark for each season, and for the demo cohort', async () => {
  const { default: SeasonMark } = await load('/src/components/Header/scope/SeasonMark.jsx')

  for (const name of ['Summer 2026', 'Fall 2026', 'Winter 2027', 'Spring 2027']) {
    const html = render(SeasonMark, { name }, `SeasonMark(${name})`)
    assert.match(html, /<svg/, `${name} should get a season icon`)
  }

  // A name that states no season renders the FIXED-WIDTH EMPTY slot, which is what keeps
  // a mixed list from ragging.
  const blank = render(SeasonMark, { name: 'Demo Cohort' }, 'SeasonMark(no season)')
  assert.doesNotMatch(blank, /<svg/, 'a name stating no season gets no icon')
  assert.match(blank, /width:15px/, 'but still occupies the slot')

  // Unless it is the demo cohort, which has its own mark.
  const demo = render(SeasonMark, { name: 'Demo Cohort', isDemo: true }, 'SeasonMark(demo)')
  assert.match(demo, /<svg/, 'the demo cohort gets a mark like every other row')
})

test('the smoke test is real: it fails when a component throws', async () => {
  // A smoke test that cannot fail is worse than none, because it reports safety it does
  // not provide. This proves the harness catches a throwing component, using one built
  // here rather than by breaking a real file.
  const Exploding = () => { throw new ReferenceError('cohortIsDemo is not defined') }

  let caught = null
  try {
    render(Exploding, {}, 'Exploding (deliberate)')
  } catch (err) {
    caught = err
  }
  assert.ok(caught, 'render() must surface a throwing component as a test failure')
  assert.match(String(caught.message), /threw while rendering/)
  assert.match(String(caught.message), /cohortIsDemo is not defined/,
    'and the original error must survive into the message, or debugging starts from nothing')
})
