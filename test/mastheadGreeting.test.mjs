// ASPIRE-MASTHEAD: functional tests for the deterministic greeting system,
// plus static guards for the A-name decision (tab renamed, mnemonic and
// route preserved).
// Run: node --test test/mastheadGreeting.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { greetingFor, firstNameOf, greetingLine } from '../src/lib/masthead.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const at = (h, m = 0) => new Date(2026, 6, 18, h, m)

test('four deterministic windows on local time', () => {
  assert.equal(greetingFor(at(5)).text, 'Good morning')
  assert.equal(greetingFor(at(11, 59)).text, 'Good morning')
  assert.equal(greetingFor(at(12)).text, 'Good afternoon')
  assert.equal(greetingFor(at(17, 59)).text, 'Good afternoon')
  assert.equal(greetingFor(at(18)).text, 'Good evening')
  assert.equal(greetingFor(at(23, 59)).text, 'Good evening')
  // Overnight is time-neutral: night-shift staff are at work, not up late.
  assert.equal(greetingFor(at(0)).text, 'Welcome back')
  assert.equal(greetingFor(at(4, 59)).text, 'Welcome back')
})

test('each window carries its wash key for the masthead tint', () => {
  assert.equal(greetingFor(at(8)).wash, 'morning')
  assert.equal(greetingFor(at(14)).wash, 'afternoon')
  assert.equal(greetingFor(at(20)).wash, 'evening')
  assert.equal(greetingFor(at(2)).wash, 'night')
})

test('name handling never invents a name', () => {
  assert.equal(firstNameOf('Jester Lloyd Bautista'), 'Jester')
  assert.equal(firstNameOf('  Anna  '), 'Anna')
  assert.equal(firstNameOf(''), '')
  assert.equal(firstNameOf(null), '')
  assert.equal(firstNameOf(undefined), '')
})

test('the heading composes with a name and stands alone without one', () => {
  assert.equal(greetingLine('Jester Lloyd Bautista', at(8)).heading, 'Good morning, Jester')
  assert.equal(greetingLine('', at(8)).heading, 'Good morning')
  assert.equal(greetingLine(null, at(2)).heading, 'Welcome back')
  // Never the old "Good morning, there" fallback.
  assert.doesNotMatch(greetingLine('', at(8)).heading, /there/)
})

test('the A-name decision: tab renamed, mnemonic and route preserved', async (t) => {
  const nav = read('src/components/UnifiedNav.jsx')
  const app = read('src/App.jsx')

  await t.test('the first workspace tab is At a Glance with the A chip', () => {
    assert.match(nav, /\{ id: 'overview',\s+label: 'At a Glance',\s+chip: 'A'\s+\}/)
    assert.doesNotMatch(nav, /label: 'Today'/)
  })

  await t.test('the /aggregate route is unchanged', () => {
    assert.match(app, /overview:\s+'\/aggregate'/)
  })

  await t.test('the document title follows the tab name', () => {
    assert.match(app, /overview: 'At a Glance', profiles: 'Student Profiles'/)
  })

  await t.test('the greeting is the visible h1, so the tab title never carries a name', () => {
    const masthead = read('src/components/TodayMasthead.jsx')
    assert.match(masthead, /greetingLine\(userProfile\?\.full_name\)/)
    assert.doesNotMatch(app, /full_name[\s\S]{0,80}document\.title/)
  })
})

test('the greeting clamps instead of wrapping (long names)', () => {
  const css = read('src/index.css')
  assert.match(css, /\.mast-greet \{[\s\S]*?text-overflow: ellipsis; white-space: nowrap;/)
})
