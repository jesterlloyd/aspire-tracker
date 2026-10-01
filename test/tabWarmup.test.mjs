// test/tabWarmup.test.mjs
//
// TAB-WARMUP-1 (Owner, 2026-10-01). Measured on the live app: At a Glance, Student Profiles and
// Rotation all mounted at boot, so opening any one screen fired the requests of all three, about
// 120 in the first second. The opened screen now mounts alone and the others are warmed afterward.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WARM_TABS, WARM_FIRST_DELAY_MS, WARM_STEP_MS, nextWarmTab, warmDelay, withAllWarmTabs } from '../src/lib/tabWarmup.js'

const app = readFileSync(new URL('../src/staff/StaffApp.jsx', import.meta.url), 'utf8')

test('the rules: one hidden tab at a time, in order, the long wait first', () => {
  assert.deepEqual([...WARM_TABS], ['overview', 'profiles', 'rotation'])
  assert.equal(nextWarmTab(new Set(['rotation'])), 'overview', 'opened on Rotation: At a Glance is warmed first')
  assert.equal(nextWarmTab(new Set(['rotation', 'overview'])), 'profiles')
  assert.equal(nextWarmTab(new Set(['overview', 'profiles', 'rotation'])), null, 'nothing left: no timer is set')
  assert.equal(nextWarmTab(new Set(['settings'])), 'overview', 'a utility page warms all three, in order')
  assert.equal(nextWarmTab(new Set()), 'overview')
  // Interviews and Evaluation are their own chunks and stay visit-only: they are never warmed.
  assert.ok(!WARM_TABS.includes('interviews') && !WARM_TABS.includes('evaluation'))
  assert.equal(warmDelay(false), WARM_FIRST_DELAY_MS)
  assert.equal(warmDelay(true), WARM_STEP_MS)
  assert.ok(WARM_FIRST_DELAY_MS >= 2000, 'the opened screen gets the network to itself first')
})

test('the welcome tour gets every anchor at once, and a full set is returned as it was', () => {
  const some = new Set(['profiles', 'catalog'])
  assert.deepEqual([...withAllWarmTabs(some)].sort(), ['catalog', 'overview', 'profiles', 'rotation'])
  assert.equal(some.size, 2, 'the given set is not mutated')
  const all = new Set(['overview', 'profiles', 'rotation'])
  assert.equal(withAllWarmTabs(all), all, 'same object back: no re-render loop')
})

test('the staff app: each of the three mounts only once visited or warmed, and then stays', () => {
  for (const [tab, comp] of [['overview', 'OverviewTab'], ['profiles', 'StudentProfilesTab'], ['rotation', 'RotationTab']]) {
    const re = new RegExp(`\\{visitedTabs\\.has\\('${tab}'\\) && \\(\\s*<div style=\\{\\{ display: activeTab === '${tab}' \\? 'block' : 'none' \\}\\}>\\s*<${comp}\\b`)
    assert.match(app, re, tab)
  }
  // A clicked tab mounts on the render that activates it, never a frame later.
  assert.match(app, /if \(!visitedTabs\.has\(activeTab\)\) setVisitedTabs\(prev => new Set\(prev\)\.add\(activeTab\)\)/)
  // Nothing ever removes a tab from the visited set: a mounted tab stays mounted.
  assert.doesNotMatch(app, /visitedTabs\.delete|new Set\(\[activeTab\]\)|setVisitedTabs\(\(\) => new Set\(\)\)|setVisitedTabs\(new Set\(\)\)/)
  // The warm-up waits for the boot data, adds one tab per pass, and cleans up its timers.
  assert.match(app, /const bootReady = !loading && !dbError && cohorts\.length > 0/)
  assert.match(app, /if \(!bootReady \|\| tourRunning\) return undefined\s+const next = nextWarmTab\(visitedTabs\)\s+if \(!next\) return undefined/)
  assert.match(app, /\}, warmDelay\(warmedOnceRef\.current\)\)/)
  assert.match(app, /clearTimeout\(timer\)/)
  assert.match(app, /\}, \[bootReady, tourRunning, visitedTabs\]\)/)
  assert.match(app, /if \(tourRunning && nextWarmTab\(visitedTabs\)\) setVisitedTabs\(prev => withAllWarmTabs\(prev\)\)/)
  // bootReady reads cohorts, loading and dbError: all three are declared above it (a const read
  // above its declaration took the whole staff app down once before).
  const at = (s) => app.indexOf(s)
  for (const decl of ['const { data: cohorts = [] } = useQuery(', 'const [loading,', 'const [dbError,', 'const [tourRunning,']) {
    assert.ok(at(decl) > 0 && at(decl) < at('const bootReady ='), decl)
  }
})

test('a student opened from another screen still lands when Student Profiles was not mounted yet', () => {
  const tab = readFileSync(new URL('../src/components/StudentProfilesTab.jsx', import.meta.url), 'utf8')
  // The effect runs on mount as well as on change, so a tab mounted BY the jump reads the student.
  assert.match(tab, /if \(focusStudentId\) \{ setSelectedStudentId\(focusStudentId\); onClearFocusStudent\?\.\(\) \}\s+\}, \[focusStudentId\]\)/)
  assert.match(app, /onOpenStudent=\{\(id\) => \{ switchTab\('profiles'\); setFocusStudentId\(id\) \}\}/)
})

test('BADGE-DEFER-1: the bell badge\'s queue waits for the opened screen, except where it is needed at once', async () => {
  const { badgeQueueReady, BADGE_QUEUE_DELAY_MS } = await import('../src/lib/tabWarmup.js')
  assert.equal(badgeQueueReady({ activeTab: 'rotation' }), false, 'another screen: the queue waits')
  assert.equal(badgeQueueReady({ activeTab: 'settings' }), false)
  assert.equal(badgeQueueReady({ activeTab: 'overview' }), true, 'At a Glance reads the same queries for its own cards')
  assert.equal(badgeQueueReady({ activeTab: 'rotation', drawerOpen: true }), true, 'opening the Action Center never waits')
  assert.equal(badgeQueueReady({ activeTab: 'rotation', released: true }), true, 'once released it stays released')
  assert.equal(badgeQueueReady(), false)
  assert.ok(BADGE_QUEUE_DELAY_MS >= 1500 && BADGE_QUEUE_DELAY_MS <= 4000, 'long enough for the screen, short enough that the badge is not missed')
  // The staff app: the queue is gated, the release is one-way, and the timer waits for boot data.
  assert.match(app, /enabled: canEdit && badgeQueueOn,/)
  assert.match(app, /const badgeQueueOn = badgeQueueReady\(\{ activeTab, drawerOpen: showActionCenter, released: badgeQueueReleased \}\)/)
  assert.match(app, /if \(badgeQueueOn && !badgeQueueReleased\) setBadgeQueueReleased\(true\)/)
  assert.match(app, /if \(!bootReady \|\| badgeQueueReleased\) return undefined\s+const timer = setTimeout\(\(\) => setBadgeQueueReleased\(true\), BADGE_QUEUE_DELAY_MS\)/)
  assert.doesNotMatch(app, /setBadgeQueueReleased\(false\)/, 'nothing switches the queue back off')
  const at = (s) => app.indexOf(s)
  for (const decl of ['const [showActionCenter,', 'const bootReady =']) assert.ok(at(decl) > 0 && at(decl) < at('const badgeQueueOn ='), decl)
  assert.ok(at('const badgeQueueOn =') < at('const actionCenterQueue = useActionCenterQueue('))
  // The unread notifications count is a different, single read and is not deferred.
  assert.match(app, /const staffNotifications = useStaffNotifications\(\{ enabled: canEdit \}\)/)
})
