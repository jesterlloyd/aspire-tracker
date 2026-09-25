// test/s17SignOutCleanup.test.mjs
//
// S-17: the next person on a shared workstation inherits nothing.
//
//   * SWEEP: every setItem() in src/ is found, the key it writes is resolved (a literal,
//     a template's static prefix, a constant, a key-builder function, or the argument a
//     wrapper's callers pass), and the registry in src/lib/signOutCleanup.js must classify
//     it. A new key with no row fails the suite. An unresolvable key fails the suite.
//   * sign-out clears the React Query cache and removes every 'clear' key from both
//     stores; 'keyed', 'preference', 'mechanism', 'public' and 'auth' keys survive.
//   * switching users leaves no prior user's drafts readable through the app: what
//     survives is either keyed by the leaving user's id or holds no personal data.
//   * AuthContext calls the cleanup on sign-out, on SIGNED_OUT (expiry included), on a
//     SIGNED_IN for a different user, and on a restored session for a different user.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORAGE_KEY_REGISTRY, classifyStorageKey, clearClientStateOnSignOut } from '../src/lib/signOutCleanup.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(p, 'utf8')
// Line comments first: a `//` comment can contain `/*` (StaffApp.jsx line 10 does), and
// stripping block comments first would swallow real code up to the next `*/`.
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (/ \d\.(jsx?|mjs)$/.test(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.js', '.jsx'].includes(extname(name))) out.push(p)
  }
  return out
}

// ── A small resolver for "what static prefix does this expression write?" ───────

function importedFrom(fileSrc, file, ident) {
  const m = fileSrc.match(new RegExp(`import\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`))
  if (!m) return null
  let target = resolve(dirname(file), m[1])
  for (const cand of [target, `${target}.js`, `${target}.jsx`, join(target, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

const MAX_DEPTH = 8

// Returns { prefix } for a resolvable expression, { param: name } when the expression is
// a bare identifier defined only as a function parameter, or { unresolved: expr }.
function resolveExpr(expr, file, depth = 0) {
  const src = stripComments(read(file))
  const e = expr.trim()
  if (depth > MAX_DEPTH) return { unresolved: e }
  let m
  if ((m = e.match(/^['"]([^'"]*)['"]/))) return { prefix: m[1] }
  if ((m = e.match(/^`([^`]*)`/))) {
    const body = m[1]
    const dollar = body.indexOf('${')
    const staticPart = dollar === -1 ? body : body.slice(0, dollar)
    if (staticPart) return { prefix: staticPart }
    // `${CONST}rest`: resolve the leading interpolation and use its prefix.
    const inner = body.match(/^\$\{([^}]+)\}/)
    if (inner) {
      const r = resolveExpr(inner[1], file, depth + 1)
      return r.prefix !== undefined ? r : { unresolved: e }
    }
    return { unresolved: e }
  }
  if ((m = e.match(/^([A-Za-z_$][\w$]*)\s*\(/))) {
    const name = m[1]
    // An arrow with an expression body: `const f = (a) => EXPR`. The body must NOT be
    // scanned for "return" (a template body contains `{`, and a lazy scan would run on
    // to some later function's return statement).
    const arrow = src.match(new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(?[^=)]*\\)?\\s*=>\\s*`))
    const fn = src.match(new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`))
    const candidates = []
    if (arrow) {
      const after = src.slice(arrow.index + arrow[0].length)
      if (after.startsWith('{')) {
        const body = after.slice(0, Math.max(after.indexOf('\n}'), 0) || 2000)
        for (const rm of body.matchAll(/return\s+([^;\n]+)/g)) candidates.push(rm[1])
      } else {
        candidates.push(after.split('\n')[0])
      }
    } else if (fn) {
      const after = src.slice(fn.index + fn[0].length)
      const body = after.slice(0, Math.max(after.indexOf('\n}'), 0) || 2000)
      for (const rm of body.matchAll(/return\s+([^;\n]+)/g)) candidates.push(rm[1])
    }
    for (const c of candidates) {
      const r = resolveExpr(c.trim().replace(/\)\s*$/, ''), file, depth + 1)
      if (r.prefix !== undefined) return r
    }
    if (!arrow && !fn) {
      const from = importedFrom(src, file, name)
      if (from) return resolveExpr(e, from, depth + 1)
    }
    return { unresolved: e }
  }
  if ((m = e.match(/^[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)$/))) return resolveExpr(m[1], file, depth + 1)
  if ((m = e.match(/^([A-Za-z_$][\w$]*)$/))) {
    const name = m[1]
    const def = src.match(new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`))
    if (def) return resolveExpr(def[1].trim(), file, depth + 1)
    const from = importedFrom(src, file, name)
    if (from) return resolveExpr(e, from, depth + 1)
    return { param: name }
  }
  // a ternary or a guard around a key (`x ? \`prefix${id}\` : null`): take its first literal
  const first = e.match(/`[^`]*`|'[^']*'|"[^"]*"/)
  if (first && first.index > 0) return resolveExpr(first[0], file, depth + 1)
  return { unresolved: e }
}

// The first argument of every setItem() call in a file, with the enclosing function's
// name and parameter list so a bare parameter can be traced to the wrapper's callers.
function setItemSites(file) {
  const src = stripComments(read(file))
  const sites = []
  const re = /\.setItem\(\s*/g
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 0, arg = ''
    for (; i < src.length; i += 1) {
      const c = src[i]
      if (c === '(' || c === '[' || c === '{') depth += 1
      if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1 }
      if (c === ',' && depth === 0) break
      arg += c
    }
    // nearest enclosing function header above the call
    const before = src.slice(0, m.index)
    const fnHeaders = [...before.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)/g)]
    const last = fnHeaders.at(-1)
    sites.push({ arg: arg.trim(), fnName: last ? (last[1] || last[3]) : null, params: last ? (last[2] || last[4] || '') : '' })
  }
  return sites
}

function resolveSite(site, file, seen = new Set()) {
  const r = resolveExpr(site.arg, file)
  if (r.prefix !== undefined || r.unresolved) return [r]
  // a parameter of the enclosing wrapper: resolve what each caller passes in that slot
  const params = site.params.split(',').map((p) => p.trim().replace(/=.*$/, '').trim())
  const idx = params.indexOf(r.param)
  if (!site.fnName || idx === -1 || seen.has(site.fnName)) {
    // Not a wrapper parameter: perhaps a component prop. Resolve what each JSX caller passes.
    const passes = []
    for (const other of walk(join(root, 'src'))) {
      const osrc = stripComments(read(other))
      const propRe = new RegExp(`\\b${r.param}=\\{`, 'g')
      let pm
      while ((pm = propRe.exec(osrc))) {
        let i = pm.index + pm[0].length, depth = 0, cur = ''
        for (; i < osrc.length; i += 1) {
          const ch = osrc[i]
          if (ch === '{' || ch === '(' || ch === '[') depth += 1
          if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) break; depth -= 1 }
          cur += ch
        }
        passes.push(...resolveSite({ arg: cur.trim(), fnName: null, params: '' }, other, seen))
      }
    }
    return passes.length ? passes : [{ unresolved: `${r.param} (parameter of ${site.fnName || '?'})` }]
  }
  seen.add(site.fnName)
  const src = stripComments(read(file))
  const out = []
  const callRe = new RegExp(`\\b${site.fnName}\\(`, 'g')
  let c
  while ((c = callRe.exec(src))) {
    if (src.slice(c.index - 9, c.index).match(/function\s*$/)) continue
    let i = c.index + c[0].length, depth = 0, cur = ''
    const args = []
    for (; i < src.length; i += 1) {
      const ch = src[i]
      if (ch === '(' || ch === '[' || ch === '{' || ch === '`') depth += (ch === '`' && cur.includes('`') ? -1 : 1)
      if ((ch === ')' || ch === ']' || ch === '}') && depth === 0) break
      if (ch === ')' || ch === ']' || ch === '}') depth -= 1
      if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    args.push(cur.trim())
    const passed = args[idx]
    if (passed === undefined || passed === '') continue
    if (passed === r.param) continue
    out.push(...resolveSite({ arg: passed, fnName: null, params: '' }, file, seen))
  }
  return out.length ? out : [{ unresolved: `${r.param} (parameter of ${site.fnName}, no caller found)` }]
}

test('SWEEP: every storage key the app writes is classified by the registry', () => {
  const problems = []
  let writes = 0
  for (const file of walk(join(root, 'src'))) {
    const rel = file.slice(root.length + 1)
    for (const site of setItemSites(file)) {
      writes += 1
      const results = resolveSite(site, file)
      for (const r of results) {
        if (r.unresolved) { problems.push(`${rel}: cannot resolve the key written by setItem(${site.arg}) [${r.unresolved}]`); continue }
        if (r.prefix === '') { problems.push(`${rel}: setItem(${site.arg}) writes a key with no static prefix`); continue }
        const entry = STORAGE_KEY_REGISTRY.find((en) => en.prefix.startsWith(r.prefix) || r.prefix.startsWith(en.prefix))
        if (!entry) problems.push(`${rel}: setItem(${site.arg}) writes '${r.prefix}...' and src/lib/signOutCleanup.js does not classify it`)
      }
    }
  }
  assert.ok(writes >= 30, `expected to find the app's storage writes, found ${writes}`)
  assert.deepEqual(problems, [], 'every storage key needs a row in STORAGE_KEY_REGISTRY:\n' + problems.join('\n'))
})

test('the registry is well formed: known classes, unique prefixes, no prefix shadows a longer one wrongly', () => {
  const classes = new Set(['clear', 'keyed', 'preference', 'mechanism', 'public', 'auth'])
  const seen = new Set()
  for (const en of STORAGE_KEY_REGISTRY) {
    assert.ok(classes.has(en.cls), `${en.prefix}: unknown class ${en.cls}`)
    assert.ok(['local', 'session', 'both'].includes(en.store), `${en.prefix}: unknown store`)
    assert.ok(en.holds && en.holds.length > 10, `${en.prefix}: say what it holds`)
    assert.ok(!seen.has(en.prefix), `${en.prefix}: listed twice`)
    seen.add(en.prefix)
  }
  // Every 'keyed' row really does carry an id in its key: its prefix ends where the id starts.
  for (const en of STORAGE_KEY_REGISTRY.filter((e) => e.cls === 'keyed')) {
    assert.match(en.prefix, /[:.\-]$/, `${en.prefix}: a keyed prefix must end at the separator before the id`)
  }
  // The longest prefix wins, so the armed marker and the per-user demo key classify apart.
  assert.equal(classifyStorageKey('aspire:demoMode').cls, 'mechanism')
  assert.equal(classifyStorageKey('aspire:demoMode:u1').cls, 'keyed')
  assert.equal(classifyStorageKey('something-else'), null)
})

// ── Behaviour ───────────────────────────────────────────────────────────────

function fakeStore(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    get length() { return map.size },
    key(i) { return [...map.keys()][i] ?? null },
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
    keys() { return [...map.keys()] },
  }
}

const A = '11111111-aaaa-4aaa-8aaa-111111111111'
const B = '22222222-bbbb-4bbb-8bbb-222222222222'

function browserAfterUserA() {
  const local = fakeStore({
    'aspire-intelligence-auth': '{"access_token":"..."}',
    'aspire_interviewers_v1': '[{"full_name":"Ivy Interviewer","email":"ivy@x.org"}]',
    'aspire.connect.contacts.lastContactId': 'contact-9',
    'aspire.connect.lastTab': 'outreach',
    'aspire.portalFeedback.requestId.v1:default': 'req-1',
    'aspire_active_tab': 'rotation',
    [`aspire.connect.outreach.directDraft.v1.${A}.cohort-1.student:s-7`]: '{"subject":"Hi","body":"Dear student"}',
    [`aspire.connect.outreach.bulkDraft.v1.${A}.cohort-1.message`]: '{"subject":"All","body":"Everyone"}',
    [`aspire.rubric.draft.s-7.${A}`]: '{"summary_comments":"strong"}',
    [`aspire:activeCohort:${A}`]: 'cohort-1',
    [`aspire:lastActiveTab:${A}`]: 'interviews',
    [`aspire:ui-preferences:${A}`]: '{"appearance.style":"classic"}',
    'aspire-color-mode': 'dark',
    'aspire-style': 'classic',
    'aspire.connect.richCompose': 'off',
    'aspire_sent_history_filters': '{"dateRange":"last_30_days"}',
    'aspire:lastAuthenticatedUserId': A,
    'aspire:demoMode': '1',
    [`aspire:demoMode:${A}`]: '1',
    'aspire-form-draft:abcdef0123456789': '{"q1":"public respondent answer"}',
  })
  const session = fakeStore({
    'aspire.connect.launchContext.v1': '{"student_id":"s-7","name":"Sam Student","email":"sam@school.edu"}',
    'aspire:studentPhotoCache:v1': '{"scope":"a","entries":[["s-7",{"url":"https://signed/x"}]]}',
    'onboarding_tour_snoozed:staff': 'true',
    'onboarding_tour_snoozed': 'true',
    [`aspire:portal:cohort-hint:${A}:student`]: 'true',
    'aspire:chunk-reload:StaffApp': '1700000000000',
    'aspire-form-token': 'tok',
  })
  return { local, session }
}

test('sign-out clears the query cache and removes every key that holds people or place', () => {
  const { local, session } = browserAfterUserA()
  const queryClient = { cleared: 0, clear() { this.cleared += 1 } }
  const result = clearClientStateOnSignOut({ queryClient, local, session })
  assert.equal(queryClient.cleared, 1, 'React Query cache cleared')
  assert.equal(result.cacheCleared, true)
  for (const gone of ['aspire_interviewers_v1', 'aspire.connect.contacts.lastContactId', 'aspire.connect.lastTab', 'aspire.portalFeedback.requestId.v1:default', 'aspire_active_tab']) {
    assert.equal(local.getItem(gone), null, `${gone} removed`)
  }
  for (const gone of ['aspire.connect.launchContext.v1', 'aspire:studentPhotoCache:v1', 'onboarding_tour_snoozed:staff', 'onboarding_tour_snoozed', `aspire:portal:cohort-hint:${A}:student`]) {
    assert.equal(session.getItem(gone), null, `${gone} removed`)
  }
  assert.equal(result.removed.length, 10)
  // Every removed key was classified 'clear'; nothing else was touched.
  for (const k of result.removed) assert.equal(classifyStorageKey(k).cls, 'clear')
})

test('harmless preferences, the sign-in mechanism, public-page state and the user\'s own keyed drafts survive', () => {
  const { local, session } = browserAfterUserA()
  clearClientStateOnSignOut({ queryClient: null, local, session })
  for (const kept of ['aspire-color-mode', 'aspire-style', 'aspire.connect.richCompose', 'aspire_sent_history_filters',
    'aspire:lastAuthenticatedUserId', 'aspire:demoMode', 'aspire-form-draft:abcdef0123456789', 'aspire-intelligence-auth',
    `aspire:activeCohort:${A}`, `aspire:ui-preferences:${A}`, `aspire:demoMode:${A}`,
    `aspire.connect.outreach.directDraft.v1.${A}.cohort-1.student:s-7`, `aspire.connect.outreach.bulkDraft.v1.${A}.cohort-1.message`, `aspire.rubric.draft.s-7.${A}`]) {
    assert.notEqual(local.getItem(kept), null, `${kept} kept`)
  }
  for (const kept of ['aspire:chunk-reload:StaffApp', 'aspire-form-token']) assert.notEqual(session.getItem(kept), null, `${kept} kept`)
  // The Supabase session key is supabase-js's to remove, not ours; it is classified, not cleared here.
  assert.equal(classifyStorageKey('aspire-intelligence-auth').cls, 'auth')
})

test('after a switch to user B, nothing left in storage is readable as B\'s and nothing unkeyed names a person', () => {
  const { local, session } = browserAfterUserA()
  clearClientStateOnSignOut({ queryClient: { clear() {} }, local, session })
  // What survives is keyed to A (B's readers build their keys from B's id), or holds no personal data.
  for (const k of [...local.keys(), ...session.keys()]) {
    const entry = classifyStorageKey(k)
    assert.ok(entry, `${k} is classified`)
    assert.notEqual(entry.cls, 'clear', `${k} should have been removed`)
    if (entry.cls === 'keyed') {
      assert.ok(k.includes(A), `${k} carries the leaving user's id`)
      assert.ok(!k.includes(B), `${k} is not B's`)
    } else {
      const v = local.getItem(k) ?? session.getItem(k) ?? ''
      assert.doesNotMatch(v, /Ivy|Sam|@x\.org|@school\.edu|signed\//, `${k} holds no person: ${v}`)
    }
  }
  // And a second call is a no-op: idempotent.
  const again = clearClientStateOnSignOut({ queryClient: null, local, session })
  assert.deepEqual(again.removed, [])
})

test('the cleanup never throws when storage is missing or broken', () => {
  assert.doesNotThrow(() => clearClientStateOnSignOut({ queryClient: null, local: null, session: null }))
  const broken = { get length() { throw new Error('no') }, key() { throw new Error('no') }, removeItem() { throw new Error('no') } }
  assert.doesNotThrow(() => clearClientStateOnSignOut({ queryClient: { clear() { throw new Error('no') } }, local: broken, session: broken }))
})

// ── Wiring ──────────────────────────────────────────────────────────────────

test('AuthContext forgets the previous user on sign-out, on SIGNED_OUT, on a SIGNED_IN as someone else, and on a restored session for someone else', () => {
  const auth = read(join(root, 'src/contexts/AuthContext.jsx'))
  assert.match(auth, /import \{ clearClientStateOnSignOut \} from '\.\.\/lib\/signOutCleanup'/)
  assert.match(auth, /clearClientStateOnSignOut\(\{ queryClient: getQueryClient\(\) \}\)/)
  const signOutFn = auth.slice(auth.indexOf('const signOut = useCallback('), auth.indexOf('}, []);', auth.indexOf('const signOut = useCallback(')))
  assert.match(signOutFn, /forgetPreviousUser\('sign out'\)[\s\S]*await supabase\.auth\.signOut\(\)/, 'cleared BEFORE the network call')
  const signedOut = auth.slice(auth.indexOf("event === 'SIGNED_OUT'"), auth.indexOf("event === 'TOKEN_REFRESHED'"))
  assert.match(signedOut, /forgetPreviousUser\('signed out'\)/)
  const signedIn = auth.slice(auth.indexOf("event === 'SIGNED_IN'"), auth.indexOf("event === 'SIGNED_OUT'"))
  assert.match(signedIn, /previous && previous !== session\.user\.id\) forgetPreviousUser\('account switch'\)/)
  assert.match(signedIn, /currentUserIdRef\.current \|\| lastAuthenticatedUserId\(\)/, 'a switch is detected within the tab and across the browser')
  const restore = auth.slice(auth.indexOf('const initAuth = async'), auth.indexOf('initAuth();'))
  assert.match(restore, /previous && previous !== session\.user\.id\) forgetPreviousUser\('account switch on restore'\)/)
  const supa = read(join(root, 'src/lib/supabase.js'))
  assert.match(supa, /export function getQueryClient\(\) \{ return _queryClient \}/)
})

test('the register records S-17 as closed, and no changed file carries an em dash', () => {
  const register = read(join(root, 'docs/security/FINDINGS_REGISTER.md'))
  const s17 = register.slice(register.indexOf('## S-17.'), register.indexOf('## S-18.'))
  assert.match(s17, /\*\*Status\*\*: CLOSED\./)
  assert.match(s17, /signOutCleanup\.js/)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of ['src/lib/signOutCleanup.js', 'src/contexts/AuthContext.jsx', 'test/s17SignOutCleanup.test.mjs']) {
    assert.doesNotMatch(read(join(root, p)), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(join(root, p)), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s17, dash)
})
