// ASPIRE-CHART: static-source guards for the Catalog/Settings/Connect polish
// and the performance pass (hidden-tab poll gating, memoized contexts).
// Run: node --test test/chartPolishPerformance.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

test('Catalog: honest access copy, no inert Manage labels', () => {
  const cat = read('src/components/catalog/CatalogPage.jsx')
  assert.match(cat, /available to Owner, Admin, and Interviewer accounts/)
  assert.doesNotMatch(cat, /available to Owner\/Admin only/)
  assert.doesNotMatch(cat, />Manage<\/span>/)
})

test('Settings: personal vs workspace vs administration vs owner diagnostics', () => {
  const sections = read('src/components/settings/settingsSections.js')
  assert.match(sections, /key: 'appearance'[^\n]*group: 'Personal'/)
  assert.match(sections, /key: 'signature',\s*label: 'Email Signature'[^\n]*group: 'Personal'/)
  assert.match(sections, /key: 'general'[^\n]*group: 'Workspace'/)
  // The migration diagnostic is Owner-only and lives under Diagnostics.
  assert.match(sections, /key: 'preceptorParity'[^\n]*group: 'Diagnostics'[^\n]*visible: r => r\.isOwner/)
  // Server-authorization reminder retained.
  assert.match(sections, /NOT a substitute for the\s*\n\/\/ server-side authorization/)
})

test('Messages: the linked student is a real, wired affordance', () => {
  const ws = read('src/components/connect/messages/MessagesWorkspace.jsx')
  assert.match(ws, /onOpenStudent\(c\.related_student_id\)/)
  assert.match(ws, /Open student record →/)
  assert.match(ws, /<ThreadPanel[\s\S]{0,220}?onOpenStudent=\{onOpenStudent\}/)
  const connect = read('src/pages/Connect.jsx')
  assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} onOpenStudent=\{onNavigateToStudent\} \/>/)
  // Cross-route focus never writes the URL from a stale route closure.
  const spt = read('src/components/StudentProfilesTab.jsx')
  const focusEffect = spt.slice(spt.indexOf('cross-route focus'), spt.indexOf('Mark profile as read'))
  assert.match(focusEffect, /setSelectedStudentId\(focusStudentId\)/)
  assert.doesNotMatch(focusEffect, /selectStudent\(|updateUrl\(/)
})

test('Messages: no stale NOT MOUNTED headers remain', () => {
  for (const f of ['MessagesWorkspace', 'MessagesInbox', 'ThreadActions', 'NewMessageDialog']) {
    const src = read(`src/components/connect/messages/${f}.jsx`)
    assert.doesNotMatch(src, /NOT MOUNTED IN PRODUCTION/, `${f} header is current`)
    assert.match(src, /MOUNTED IN PRODUCTION/, `${f} states its real status`)
  }
})

test('performance: hidden-tab polling pauses', () => {
  const overview = read('src/components/OverviewTab.jsx')
  assert.match(overview, /const onTodayRoute = useLocation\(\)\.pathname === '\/aggregate'/)
  assert.equal((overview.match(/refetchInterval: onTodayRoute \? 60 \* 1000 : false/g) || []).length, 2)
  const activity = read('src/components/RotationActivity.jsx')
  assert.match(activity, /const onActivityRoute = useLocation\(\)\.pathname === '\/rotation\/activity'/)
  assert.equal((activity.match(/refetchInterval: onActivityRoute \? 60 \* 1000 : false/g) || []).length, 2)
})

test('performance: context values are memoized', () => {
  const auth = read('src/contexts/AuthContext.jsx')
  assert.match(auth, /const value = useMemo\(\(\) => \(\{/)
  assert.match(auth, /\}\), \[user, userProfile, loading, signOut, refreshUserProfile, interviewerCohortIds\]\);/)
  assert.match(auth, /const signOut = useCallback\(/)
  const presence = read('src/contexts/PresenceContext.jsx')
  assert.match(presence, /const value = useMemo\(\(\) => \(\{ onlineUserIds \}\), \[onlineUserIds\]\)/)
})
