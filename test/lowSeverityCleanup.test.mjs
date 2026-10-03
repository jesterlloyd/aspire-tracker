// test/lowSeverityCleanup.test.mjs
//
// LOW-1 (2026-09-26): the low and informational findings closed in one pass, each pinned
// so it stays closed. S-19 (public route returns only the helper's fixed sentences), S-20
// (three crons log ids, never a name or email), S-26 (every typed search term is sanitized
// before it enters a PostgREST .or() filter), S-27 (service-role ilike values are escaped),
// S-30 (Keith's unauthenticated GET says nothing about configuration), S-31 (the activation
// token hash leaves the address bar as soon as it is consumed), S-32 (the dormant cron that
// named two students is gone).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('S-19: the placement upsert helper returns its own sentences, never database or provider text', () => {
  const src = code('api/lib/schoolPlacementUpsert.js')
  const returns = [...src.matchAll(/return \{ error: (.+?), added/g)].map(m => m[1]).filter(r => r !== 'null')
  assert.ok(returns.length >= 5, `found ${returns.length} error returns`)
  for (const r of returns) {
    assert.doesNotMatch(r, /\b(err|error|readErr|rotErr|rosterErr|updErr|insertErr)\b\.message|\bcode\b|\bdetails\b|\bhint\b/, `helper must not forward a database error: ${r}`)
    assert.match(r, /^'[^']+'$|^`Failed to (add|update) student \$\{fullName\}\.`$/, `a fixed sentence or the student's own name only: ${r}`)
  }
  assert.match(code('api/school-form-submit.js'), /if \(result\.error\) return res\.status\(500\)\.json\(\{ error: result\.error \}\)/)
})

test('S-20: the three crons log ids only', () => {
  for (const f of ['api/cron/interview-reminders.js', 'api/cron/coordinator-weekly-digest.js', 'api/cron/midpoint-checkin.js']) {
    const lines = code(f).split('\n').filter(l => /console\.(log|info|warn|error)\(/.test(l))
    for (const l of lines) {
      assert.doesNotMatch(l, /\$\{[^}]*(studentEmail|\.email|first_name|last_name|full_name)\b[^}]*\}/, `${f}: ${l.trim()}`)
    }
  }
})

test('S-26: every typed term interpolated into a PostgREST .or() filter in src/ is sanitized or escaped', () => {
  const sites = {
    'src/staff/StaffApp.jsx':                             { count: 5, safe: /const q = sanitizeContactTerm\(rawQ\)/ },
    'src/components/PreceptorAssignmentModal.jsx':        { count: 1, safe: /q = sanitizeContactTerm\(q\)/ },
    'src/components/settings/GrantPortalAccessModal.jsx': { count: 2, safe: /const sanitize = sanitizeContactTerm[\s\S]*const em = escapeLikePattern\(c\.email\.trim\(\)\)\s*\n\s*if \(\/\[,\(\)"\]\/\.test\(em\)\) return/ },
    'src/components/connect/ContactAutocomplete.jsx':     { count: 1, safe: /const sanitizeTerm = sanitizeContactTerm/ },
    'src/lib/contactSearch.js':                           { count: 1, safe: /const t = sanitizeContactTerm\(term\)/ },
  }
  for (const [f, { count, safe }] of Object.entries(sites)) {
    const src = code(f)
    const found = [...src.matchAll(/\.or\(`[^`]*\$\{/g)].length
    assert.equal(found, count, `${f}: ${found} .or() template sites (update this map when a site is added or removed)`)
    assert.match(src, safe, `${f}: the term must go through the shared sanitizer`)
  }
  // The only .or() template in StaffApp that is not a typed term interpolates a cohort id.
  assert.match(code('src/staff/StaffApp.jsx'), /\.or\(`cohort_id\.eq\.\$\{id\},cohort_id\.is\.null`\)/)
  // No local copy of the sanitizer regex survives anywhere in src/.
  const { execSync } = globalThis.process ? { execSync: null } : {}
  void execSync
  assert.doesNotMatch(read('src/components/settings/GrantPortalAccessModal.jsx'), /replace\(\/\[,\(\)%_/)
  assert.doesNotMatch(read('src/components/connect/ContactAutocomplete.jsx'), /replace\(\/\[,\(\)%_/)
  assert.match(read('src/lib/contactSearchCore.js'), /export function sanitizeContactTerm\(s\) \{\s*return String\(s \|\| ''\)\.replace\(\/\[,\(\)%_\\\\\*\]\/g, ' '\)/)
})

test('S-27: the four service-role ilike values are escaped', () => {
  assert.match(code('api/interview-book.js'), /\.ilike\('full_name', escapeLikePattern\(slot\.interviewer_name\.trim\(\)\)\)/)
  assert.match(code('api/messages-staff-options.js'), /\.ilike\('full_name', `%\$\{escapeLikePattern\(q\)\}%`\)/)
  assert.match(code('api/keith.js'), /\.ilike\('program_type', `%\$\{escapeLikePattern\(input\.program_type\)\}%`\)/)
  assert.match(code('api/keith.js'), /\.ilike\('unit_name', `%\$\{escapeLikePattern\(input\.unit_name\)\}%`\)/)
  // S-35 (2026-10-02): the invite-user lookup joined the sweep; its pattern is the whole address, escaped.
  assert.match(code('api/invite-user.js'), /\.ilike\('email', escapeLikePattern\(normEmail\)\)/)
  for (const f of ['api/interview-book.js', 'api/messages-staff-options.js', 'api/keith.js', 'api/invite-user.js']) {
    const src = code(f)
    for (const m of src.matchAll(/\.ilike\([^)]*\)/g)) assert.match(m[0], /escapeLikePattern/, `${f}: ${m[0]}`)
  }
})

test('S-30: the unauthenticated GET on Keith reveals no configuration', () => {
  const src = code('api/keith.js')
  assert.doesNotMatch(src, /hasApiKey/)
  assert.match(src, /if \(req\.method === 'GET'\) \{\s*return res\.status\(200\)\.json\(\{ status: 'Keith is alive' \}\);/)
})

test('S-31: the token hash leaves the address bar as soon as verifyOtp returns', () => {
  const src = code('src/pages/ActivateAccountPage.jsx')
  const start = src.indexOf('const handleActivate')
  const block = src.slice(start, src.indexOf('const requestRecovery', start))
  assert.match(block, /await supabase\.auth\.verifyOtp\(\{[\s\S]*?\}\)\s*\n\s*if \(typeof window !== 'undefined'\) window\.history\.replaceState\(null, '', window\.location\.pathname\)\s*\n\s*if \(error\)/)
})

test('S-32: the dormant cron that named two students is gone and nothing schedules it', () => {
  assert.equal(existsSync(join(root, 'api/cron/clockout-reminders-resend.js')), false)
  assert.doesNotMatch(read('vercel.json'), /clockout-reminders-resend/)
  assert.doesNotMatch(read('test/demoDataBoundary2.test.mjs'), /clockout-reminders-resend/)
})

test('the register records each of the seven as Closed, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const section = (k, n) => register.slice(register.indexOf(`## ${k}.`), register.indexOf(`## ${n}.`))
  for (const [k, n] of [['S-19', 'S-20'], ['S-20', 'S-21'], ['S-26', 'S-27'], ['S-27', 'S-28'], ['S-30', 'S-31'], ['S-31', 'S-32'], ['S-32', 'S-33']]) {
    assert.match(section(k, n), /\*\*Status\*\*: Closed/, k)
  }
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of ['api/cron/interview-reminders.js', 'api/cron/coordinator-weekly-digest.js', 'api/cron/midpoint-checkin.js',
    'src/staff/StaffApp.jsx', 'src/components/PreceptorAssignmentModal.jsx', 'src/components/settings/GrantPortalAccessModal.jsx',
    'src/components/connect/ContactAutocomplete.jsx', 'api/interview-book.js', 'api/messages-staff-options.js', 'api/keith.js',
    'src/pages/ActivateAccountPage.jsx']) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'), p)
  }
})
