// RESIDENCY-DIGEST-1: Talent Acquisition's opt-in weekly Residency digest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { digestRecipients, grantIsActive, AUTOMATION_KEY, CRON_NAME } from '../api/cron/residency-weekly-digest.js'
import { buildDigestSections, digestItemCount, digestCycles } from '../src/lib/ngrp/residencyDigestModel.js'
import { buildResidencyDigestEmail } from '../lib/server/email/residencyDigestEmail.js'
import { preferenceValue, RESIDENCY_DIGEST } from '../src/lib/userPreferences.js'
import { AUTOMATION_CATALOG } from '../src/lib/automationCatalog.js'
import { getPreviewFixture } from '../src/lib/notifications/previewFixtures.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const NOW = new Date('2026-10-12T15:00:00Z')
const H = 3_600_000

test('DIGEST 1: off until the person turns it on', () => {
  assert.equal(preferenceValue({}, RESIDENCY_DIGEST), 'off')
  assert.equal(preferenceValue({ [RESIDENCY_DIGEST]: 'on' }, RESIDENCY_DIGEST), 'on')
  assert.equal(preferenceValue({ [RESIDENCY_DIGEST]: 'yes' }, RESIDENCY_DIGEST), 'off')
})

test('DIGEST 2: recipients hold an active grant, an active profile, an email, and the switch on', () => {
  const on = { [RESIDENCY_DIGEST]: 'on' }
  const grants = [
    { user_profile_id: 'a' }, { user_profile_id: 'b' }, { user_profile_id: 'c' }, { user_profile_id: 'd' },
    { user_profile_id: 'e', expires_at: '2026-10-01T00:00:00Z' },
    { user_profile_id: 'f', starts_at: '2026-11-01T00:00:00Z' },
    { user_profile_id: 'g', revoked_at: '2026-10-01T00:00:00Z' },
  ]
  const profiles = [
    { id: 'a', email: 'A@cshs.org', full_name: 'Ann A', ui_preferences: on },
    { id: 'b', email: 'b@cshs.org', ui_preferences: {} },
    { id: 'c', email: '', ui_preferences: on },
    { id: 'd', email: 'd@cshs.org', is_active: false, ui_preferences: on },
    { id: 'e', email: 'e@cshs.org', ui_preferences: on },
    { id: 'f', email: 'f@cshs.org', ui_preferences: on },
    { id: 'g', email: 'g@cshs.org', ui_preferences: on },
    { id: 'z', email: 'z@cshs.org', ui_preferences: on },
  ]
  assert.deepEqual(digestRecipients(grants, profiles, NOW), [{ id: 'a', email: 'a@cshs.org', name: 'Ann A' }])
  assert.equal(grantIsActive({ expires_at: null }, NOW), true)
})

const rows = [
  { id: 'c1', student: { id: 's1', first_name: 'Jordan', last_name: 'Reyes' }, interview_status: 'scheduled', interview_at: new Date(NOW.getTime() + 50 * H).toISOString(), assigned_unit: '6 NE' },
  { id: 'c2', student: { id: 's2', first_name: 'Avery', last_name: '<b>Chen</b>' }, flagged_for_followup: true },
]

test('DIGEST 3: the sections are At a Glance\'s groups, linked into the Residency Portal', () => {
  const docs = { uploads: [{ version_id: 'v', student_id: 's9', first_name: 'M', last_name: 'D', uploaded_at: NOW.toISOString() }], completions: [] }
  const sections = buildDigestSections({
    cohorts: [{ cycle: { id: 'x', name: 'Winter 2027' }, rows }, { cycle: { id: 'y', name: 'Summer 2027' }, rows: [] }],
    docs, now: NOW.getTime(),
  })
  assert.equal(sections.length, 1, 'a cohort with nothing in it is left out')
  assert.deepEqual(sections[0].groups.map(g => g.key), ['residencyInterviews', 'residencyFlagged', 'residencyDocs'])
  for (const g of sections[0].groups) for (const r of g.rows) assert.match(r.to, /^\/portal\/residency\//)
  assert.equal(digestItemCount(sections), 3)
  assert.equal(digestItemCount(buildDigestSections({ cohorts: [{ cycle: { id: 'y' }, rows: [] }], docs: null })), 0, 'a quiet week')
  assert.deepEqual(digestCycles([{ status: 'Planning' }, { status: 'Active' }, { status: 'Completed' }, { status: 'Archived' }]).map(c => c.status), ['Planning', 'Active'])
})

test('DIGEST 4: the email links each name, escapes it, and says how to stop it', () => {
  const sections = buildDigestSections({ cohorts: [{ cycle: { id: 'x', name: 'Winter 2027' }, rows }], now: NOW.getTime() })
  const { subject, html } = buildResidencyDigestEmail({ sections, recipientName: 'Taylor Brooks', weekOf: 'October 12', baseUrl: 'https://aspireintelligence.app' })
  assert.equal(subject, 'Residency this week: 2 items need attention (week of October 12)')
  assert.match(html, /Hi Taylor,/)
  assert.match(html, /href="https:\/\/aspireintelligence\.app\/portal\/residency\/profiles\?student=s1"/)
  assert.ok(!html.includes('<b>Chen</b>'), 'a name is escaped')
  assert.match(html, /turn off Weekly digest email/)
  assert.ok(!/—/.test(html), 'no em dashes')
})

test('DIGEST 5: wired as an automation, scheduled Monday 8 AM Pacific, previewed through the real builder', () => {
  assert.equal(AUTOMATION_KEY, 'residency_weekly_digest')
  assert.equal(CRON_NAME, 'residency-weekly-digest')
  const vercel = JSON.parse(read('vercel.json'))
  assert.deepEqual(vercel.crons.find(c => c.path === '/api/cron/residency-weekly-digest'), { path: '/api/cron/residency-weekly-digest', schedule: '0 15 * * 1' })
  assert.equal(vercel.functions['api/cron/residency-weekly-digest.js'].maxDuration, 60)
  assert.ok(AUTOMATION_CATALOG.some(a => a.id === AUTOMATION_KEY && a.cronName === CRON_NAME && a.automationKey === AUTOMATION_KEY))
  assert.match(read('src/components/connect/AutomationView.jsx'), /\{ id: 'residency_weekly_digest', title: 'Residency Weekly Digest',/)
  assert.match(read('api/automation-settings.js'), /\{ key: 'residency_weekly_digest', label: 'Residency Weekly Digest',[\s\S]{0,300}defaultEnabled: true \}/)
  const fx = getPreviewFixture('residency_weekly_digest')
  const out = fx.render()
  assert.match(out.subject, /^Residency this week: \d+ items need attention/)
  assert.match(out.html, /Open the Residency Portal/)
})

test('DIGEST 6: the switch lives in the Residency Portal profile menu, and its hook sits above every return', () => {
  const shell = read('src/portal/PortalShell.jsx')
  assert.match(shell, /role="menuitemcheckbox" aria-checked=\{weeklyDigest\.on\}/)
  assert.match(shell, /\[role="menuitemcheckbox"\]/, 'arrow keys reach it')
  const app = read('src/portal/PortalApp.jsx')
  const hook = app.indexOf('useUserPreference(RESIDENCY_DIGEST)')
  const body = app.slice(app.indexOf('export default function PortalApp'))
  assert.ok(hook > 0 && app.indexOf('export default function PortalApp') < hook)
  assert.ok(body.indexOf('useUserPreference(RESIDENCY_DIGEST)') < body.indexOf('\n  if ('), 'no early return before the hook')
  assert.match(app, /weeklyDigest=\{residencyDigest\}/)
})
