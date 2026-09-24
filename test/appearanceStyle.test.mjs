// test/appearanceStyle.test.mjs
//
// APPEARANCE-STYLE-1 (2026-09-21): an app-wide Style (Classic / Modern) and a Color mode
// (Light / Dark / System), both per user, and a two-pane Settings > Appearance. What this
// file holds the build to:
//
//   1. The two preferences: legal values, Light as everyone's default (Owner), and the
//      account deciding what is painted once it has been read.
//   2. The migration: the old device-local theme is adopted into the account, so no one
//      who chose Dark is reset.
//   3. A refused save puts the earlier choice back, and only that.
//   4. The pre-paint script in index.html: it is RUN here, over every stored value, and
//      must agree with the module the app uses.
//   5. The page: native radios inside labels, the live OS line, the honest list.
//   6. The header button, the Flagged tag, and where they are wired.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  APPEARANCE_STYLE, APPEARANCE_COLOR_MODE, USER_PREFERENCES, preferenceValue,
  createUserPreferenceStore, preferenceCacheKey,
} from '../src/lib/userPreferences.js'
import {
  readDeviceAppearance, writeDeviceAppearance, legacyAppearance, accountValue,
  resolveColorMode, oppositeMode, quickToggleLabel, systemStatusLine, styleToast, colorModeToast,
  STYLE_SURFACES, contactsUsesBook, DEVICE_COLOR_MODE_KEY, DEVICE_STYLE_KEY, LEGACY_THEME_KEY,
} from '../src/lib/appearance.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }
}
const throwingStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }

// The same fake as contactsBook.test.mjs: records every call, answers from a script.
function fakeClient({ row = {}, readError = null, updateRows = 1, updateError = null } = {}) {
  const calls = []
  let stored = { ...row }
  const client = {
    from() {
      return {
        select() {
          return { eq(_c, uid) { return { async maybeSingle() {
            calls.push({ op: 'read', uid })
            if (readError) return { data: null, error: readError }
            return { data: { ui_preferences: { ...stored } }, error: null }
          } } } }
        },
        update(patch) {
          return { eq(_c, uid) { return { async select() {
            calls.push({ op: 'update', uid, prefs: patch.ui_preferences })
            if (updateError) return { data: null, error: updateError }
            if (updateRows > 0) stored = { ...patch.ui_preferences }
            return { data: Array.from({ length: updateRows }, () => ({ auth_user_id: uid })), error: null }
          } } } }
        },
      }
    },
  }
  return { client, calls, stored: () => stored }
}

// ── 1. The two preferences ─────────────────────────────────────────────────────

test('Style and Color mode are registered; Light is everyone\'s default color mode (Owner)', () => {
  assert.equal(APPEARANCE_STYLE, 'appearance.style')
  assert.equal(APPEARANCE_COLOR_MODE, 'appearance.colorMode')
  assert.deepEqual([...USER_PREFERENCES[APPEARANCE_STYLE].values], ['classic', 'modern'])
  assert.deepEqual([...USER_PREFERENCES[APPEARANCE_COLOR_MODE].values], ['light', 'dark', 'system'])
  assert.equal(USER_PREFERENCES[APPEARANCE_STYLE].fallback, 'classic')
  assert.equal(USER_PREFERENCES[APPEARANCE_COLOR_MODE].fallback, 'light',
    'not the brief\'s System: Light holds until the portals get a setting of their own')
  assert.equal(preferenceValue({ [APPEARANCE_COLOR_MODE]: 'sepia' }, APPEARANCE_COLOR_MODE), 'light')
})

test('the account decides what is painted, but only once it has actually been read', () => {
  // Nothing known yet: leave the device's own mirror alone.
  assert.equal(accountValue({}, null, APPEARANCE_STYLE), null)
  assert.equal(accountValue({}, false, APPEARANCE_COLOR_MODE), null, 'a failed read is not an answer')
  // Read, and the account holds nothing: the default.
  assert.equal(accountValue({}, true, APPEARANCE_STYLE), 'classic')
  assert.equal(accountValue({}, true, APPEARANCE_COLOR_MODE), 'light')
  // A stored choice always wins, read or cached.
  assert.equal(accountValue({ [APPEARANCE_STYLE]: 'modern' }, null, APPEARANCE_STYLE), 'modern')
  assert.equal(accountValue({ [APPEARANCE_COLOR_MODE]: 'system' }, true, APPEARANCE_COLOR_MODE), 'system')
  // A stored value this build does not know is not a choice.
  assert.equal(accountValue({ [APPEARANCE_STYLE]: 'retro' }, null, APPEARANCE_STYLE), null)
})

test('the device mirror: defaults, legal values only, and it survives blocked storage', () => {
  assert.deepEqual(readDeviceAppearance(memoryStorage()), { colorMode: 'light', style: 'classic' })
  assert.deepEqual(readDeviceAppearance(null), { colorMode: 'light', style: 'classic' })
  assert.deepEqual(readDeviceAppearance(throwingStorage), { colorMode: 'light', style: 'classic' })
  assert.deepEqual(readDeviceAppearance(memoryStorage({ [DEVICE_COLOR_MODE_KEY]: 'sepia', [DEVICE_STYLE_KEY]: 'retro' })),
    { colorMode: 'light', style: 'classic' })
  const s = memoryStorage()
  writeDeviceAppearance(s, { colorMode: 'system', style: 'modern' })
  assert.deepEqual(readDeviceAppearance(s), { colorMode: 'system', style: 'modern' })
  writeDeviceAppearance(s, { colorMode: 'sepia' })
  assert.equal(s.getItem(DEVICE_COLOR_MODE_KEY), 'system', 'an illegal value is never written')
  assert.doesNotThrow(() => writeDeviceAppearance(throwingStorage, { style: 'modern' }))
})

test('the mirror never writes the old theme key, so a painted default is never mistaken for a choice', () => {
  assert.equal(LEGACY_THEME_KEY, 'aspire-theme', 'the key the old device-local theme always used')
  assert.notEqual(DEVICE_COLOR_MODE_KEY, LEGACY_THEME_KEY)
  const s = memoryStorage()
  writeDeviceAppearance(s, { colorMode: 'light', style: 'classic' })
  assert.equal(s.getItem(LEGACY_THEME_KEY), null)
  assert.deepEqual(legacyAppearance(s), {}, 'nothing to adopt: Light was painted, not chosen')
  // Before this build has painted anything here, the old choice paints the page.
  assert.equal(readDeviceAppearance(memoryStorage({ [LEGACY_THEME_KEY]: 'dark' })).colorMode, 'dark')
  // Once it has, the mirror wins over the old key.
  assert.equal(readDeviceAppearance(memoryStorage({ [LEGACY_THEME_KEY]: 'dark', [DEVICE_COLOR_MODE_KEY]: 'light' })).colorMode, 'light')
  // The ThemeContext paints through the mirror only.
  assert.doesNotMatch(strip(read('src/contexts/ThemeContext.jsx')), /aspire-theme|LEGACY_THEME_KEY/)
})

test('resolving and switching: System follows the OS; the header always makes an explicit choice', () => {
  assert.equal(resolveColorMode('light', true), 'light')
  assert.equal(resolveColorMode('dark', false), 'dark')
  assert.equal(resolveColorMode('system', true), 'dark')
  assert.equal(resolveColorMode('system', false), 'light')
  assert.equal(resolveColorMode(undefined, true), 'light')
  assert.equal(oppositeMode('light'), 'dark')
  assert.equal(oppositeMode('dark'), 'light')
  assert.equal(quickToggleLabel('light'), 'Switch to dark mode')
  assert.equal(quickToggleLabel('dark'), 'Switch to light mode')
  assert.equal(systemStatusLine(true), 'Your computer is in dark mode')
  assert.equal(systemStatusLine(false), 'Your computer is in light mode')
  assert.equal(styleToast('modern'), 'Modern style on')
  assert.equal(styleToast('classic'), 'Classic style on')
  assert.equal(colorModeToast('dark'), 'Dark mode')
  assert.equal(colorModeToast('light'), 'Light mode')
  assert.equal(colorModeToast('system'), 'Matching your computer')
  assert.equal(contactsUsesBook('classic'), true)
  assert.equal(contactsUsesBook('modern'), false)
})

// ── 2. The migration ───────────────────────────────────────────────────────────

test('the old device theme is adopted into an account that has no color mode yet', async () => {
  for (const mode of ['dark', 'system', 'light']) {
    const device = memoryStorage({ [LEGACY_THEME_KEY]: mode })
    const { client, stored, calls } = fakeClient({ row: {} })
    const store = createUserPreferenceStore({ client, storage: memoryStorage(), legacy: () => legacyAppearance(device) })
    await store.ensure('u1')
    assert.equal(preferenceValue(store.getSnapshot().prefs, APPEARANCE_COLOR_MODE), mode, `${mode} is kept`)
    assert.deepEqual(stored(), { [APPEARANCE_COLOR_MODE]: mode }, 'and written to the account once')
    assert.equal(calls.filter(c => c.op === 'update').length, 1)
  }
})

test('the migration never overrides the account, never invents a Style, and ignores junk', async () => {
  const device = memoryStorage({ [LEGACY_THEME_KEY]: 'dark', [DEVICE_STYLE_KEY]: 'modern' })
  {
    const { client, calls } = fakeClient({ row: { [APPEARANCE_COLOR_MODE]: 'light' } })
    const store = createUserPreferenceStore({ client, storage: memoryStorage(), legacy: () => legacyAppearance(device) })
    await store.ensure('u1')
    assert.equal(preferenceValue(store.getSnapshot().prefs, APPEARANCE_COLOR_MODE), 'light', 'the account wins')
    assert.equal(calls.filter(c => c.op === 'update').length, 0)
  }
  {
    const { client, stored } = fakeClient({ row: {} })
    const store = createUserPreferenceStore({ client, storage: memoryStorage(), legacy: () => legacyAppearance(device) })
    await store.ensure('u1')
    assert.equal(stored()[APPEARANCE_STYLE], undefined, 'Style has no legacy: the device mirror is not a choice')
  }
  assert.deepEqual(legacyAppearance(memoryStorage({ [LEGACY_THEME_KEY]: 'sepia' })), {})
  assert.deepEqual(legacyAppearance(throwingStorage), {})
  {
    // A legacy seed that throws is ignored rather than taking the read down with it.
    const { client } = fakeClient({ row: {} })
    const store = createUserPreferenceStore({ client, storage: memoryStorage(), legacy: () => { throw new Error('x') } })
    await store.ensure('u1')
    assert.equal(store.getSnapshot().synced, true)
  }
})

test('this person\'s own cached choice outranks the device\'s old theme', async () => {
  const device = memoryStorage({ [LEGACY_THEME_KEY]: 'dark' })
  const cache = memoryStorage({ [preferenceCacheKey('u1')]: JSON.stringify({ [APPEARANCE_COLOR_MODE]: 'system' }) })
  const { client, stored } = fakeClient({ row: {} })
  const store = createUserPreferenceStore({ client, storage: cache, legacy: () => legacyAppearance(device) })
  await store.ensure('u1')
  assert.equal(stored()[APPEARANCE_COLOR_MODE], 'system')
})

// ── 3. A refused save ──────────────────────────────────────────────────────────

test('a refused save reports the error, and restore puts back exactly what was there', async () => {
  const { client } = fakeClient({ row: { [APPEARANCE_STYLE]: 'classic' }, updateError: { message: 'denied' } })
  const storage = memoryStorage()
  const store = createUserPreferenceStore({ client, storage })
  await store.ensure('u1')
  const result = await store.set(APPEARANCE_STYLE, 'modern')
  assert.ok(result.error, 'the failure is reported')
  assert.equal(preferenceValue(store.getSnapshot().prefs, APPEARANCE_STYLE), 'modern', 'set is optimistic')
  assert.equal(store.restore(APPEARANCE_STYLE, 'modern', 'classic'), true)
  assert.equal(preferenceValue(store.getSnapshot().prefs, APPEARANCE_STYLE), 'classic')
  assert.equal(JSON.parse(storage.getItem(preferenceCacheKey('u1')))[APPEARANCE_STYLE], 'classic', 'the cache too')
})

test('restore never undoes a newer choice, and can remove a key that was never stored', async () => {
  const { client } = fakeClient({ row: {} })
  const store = createUserPreferenceStore({ client, storage: memoryStorage() })
  await store.ensure('u1')
  await store.set(APPEARANCE_COLOR_MODE, 'dark')
  await store.set(APPEARANCE_COLOR_MODE, 'system')
  // The write for 'dark' failed late; 'system' is on screen now and must stay.
  assert.equal(store.restore(APPEARANCE_COLOR_MODE, 'dark', undefined), false)
  assert.equal(preferenceValue(store.getSnapshot().prefs, APPEARANCE_COLOR_MODE), 'system')
  assert.equal(store.restore(APPEARANCE_COLOR_MODE, 'system', undefined), true)
  assert.equal(Object.prototype.hasOwnProperty.call(store.getSnapshot().prefs, APPEARANCE_COLOR_MODE), false)
  assert.equal(store.restore('appearance.unknown', 'x', 'y'), false)
})

test('useAppearance writes through the store and restores on failure; the sync paints only known values', () => {
  const hook = strip(read('src/hooks/useAppearance.js'))
  assert.match(hook, /paint\(next\)\s*\n\s*let result/, 'paint first, then save')
  assert.match(hook, /if \(preferenceStore\.restore\(key, next, stored\)\) paint\(shown\)/)
  assert.match(hook, /return \{ ok: false, error: result\.error \}/)
  assert.match(hook, /useEffect\(\(\) => \{ if \(style\) paintStyle\(style\) \}/)
  assert.match(hook, /useEffect\(\(\) => \{ if \(colorMode\) paintColorMode\(colorMode\) \}/)
  // Staff only (Owner, 2026-09-21): the portals keep the device's appearance.
  // Read raw: a '/*' inside a string in StaffApp would make the comment stripper eat it.
  const staff = read('src/staff/StaffApp.jsx')
  assert.match(staff, /function MainApp\(\{ onLogout \}\) \{[\s\S]{0,400}\n  useAppearanceSync\(\)\n/)
  assert.doesNotMatch(strip(read('src/portal/PortalApp.jsx')), /useAppearanceSync/)
})

// ── 4. The pre-paint script ────────────────────────────────────────────────────

function bootScript() {
  const html = read('index.html')
  const m = /<script>\s*(\(function\(\) \{[\s\S]*?aspire-style[\s\S]*?\}\)\(\);)\s*<\/script>/.exec(html)
  assert.ok(m, 'index.html carries the pre-paint script')
  return m[1]
}

function runBoot({ theme, legacy, style, systemDark = false, blocked = false }) {
  const attrs = {}
  const seed = {}
  if (theme !== undefined) seed[DEVICE_COLOR_MODE_KEY] = theme
  if (legacy !== undefined) seed[LEGACY_THEME_KEY] = legacy
  if (style !== undefined) seed[DEVICE_STYLE_KEY] = style
  const storage = blocked ? throwingStorage : memoryStorage(seed)
  const ctx = {
    localStorage: storage,
    window: { matchMedia: q => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark }) },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v } } },
  }
  vm.runInNewContext(bootScript(), ctx)
  return { attrs, storage }
}

test('the pre-paint script agrees with the app\'s own rules for every stored value', () => {
  const modes = [undefined, 'light', 'dark', 'system', 'sepia']
  const styles = [undefined, 'classic', 'modern', 'retro']
  let n = 0
  for (const theme of modes) for (const legacy of modes) for (const style of styles) for (const systemDark of [false, true]) {
    const { attrs, storage } = runBoot({ theme, legacy, style, systemDark })
    const device = readDeviceAppearance(storage)
    const want = { 'data-theme': resolveColorMode(device.colorMode, systemDark), 'data-style': device.style }
    assert.deepEqual(attrs, want, JSON.stringify({ theme, legacy, style, systemDark }))
    n++
  }
  assert.equal(n, 200)
})

test('the pre-paint script always sets both attributes, even when storage is blocked', () => {
  const { attrs } = runBoot({ blocked: true, systemDark: true })
  assert.deepEqual(attrs, { 'data-theme': 'light', 'data-style': 'classic' })
})

test('data-theme is always the RESOLVED mode: the app\'s dark rules key on it and nothing else', () => {
  const ctx = strip(read('src/contexts/ThemeContext.jsx'))
  assert.match(ctx, /setAttribute\('data-theme', effectiveTheme\)/)
  assert.match(ctx, /setAttribute\('data-style', style\)/)
  assert.doesNotMatch(ctx, /removeAttribute\('data-theme'\)/)
  // The OS is tracked whatever the mode, for the live status line.
  assert.match(ctx, /addEventListener\('change', handler\)/)
  assert.doesNotMatch(ctx, /if \(theme !== 'system'\) return/)
})

// ── 5. The page ────────────────────────────────────────────────────────────────

let vite
before(async () => {
  // The Appearance page reaches the Supabase client, which refuses to load without a URL.
  // A render test talks to no database, so a placeholder is enough (and never overrides a real one).
  process.env.VITE_SUPABASE_URL ||= 'https://render-test.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY ||= 'render-test-anon-key'
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})
after(async () => { await vite?.close() })

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props))
const noop = () => {}

async function renderPage(props = {}) {
  const { AppearanceSettings } = await vite.ssrLoadModule('/src/components/settings/AppearancePanel.jsx')
  return render(AppearanceSettings, {
    style: 'classic', colorMode: 'light', systemTheme: 'light', synced: true,
    onStyle: noop, onColorMode: noop, ...props,
  })
}

test('every card is a native radio inside its label, one name per group, the choice checked', async () => {
  const html = await renderPage({ style: 'modern', colorMode: 'system' })
  // Each card's first child is its radio; attribute order is React's business, so read
  // the attributes rather than their order.
  const radios = [...html.matchAll(/<label class="apx-rc">(<input [^>]*\/?>)/g)].map(([, tag]) => ({
    type: /type="([^"]+)"/.exec(tag)?.[1],
    name: /name="([^"]+)"/.exec(tag)?.[1],
    value: /value="([^"]+)"/.exec(tag)?.[1],
    checked: / checked=""/.test(tag),
  }))
  assert.ok(radios.every(r => r.type === 'radio'))
  assert.deepEqual(radios.map(r => r.value), ['classic', 'modern', 'light', 'dark', 'system'])
  assert.equal(new Set(radios.map(r => r.name)).size, 2, 'Style and Color mode are separate groups')
  assert.equal(radios[0].name, radios[1].name)
  assert.deepEqual(radios.filter(r => r.checked).map(r => r.value), ['modern', 'system'])
  assert.equal((html.match(/role="radiogroup"/g) || []).length, 2)
  // Thumbnails and ticks are decoration: the label's words are the name.
  assert.equal((html.match(/class="apx-th [^"]*" aria-hidden="true"/g) || []).length, 5)
  assert.equal((html.match(/class="apx-tick" aria-hidden="true"/g) || []).length, 5)
})

test('the page says what the brief says, in the canon\'s case', async () => {
  const html = await renderPage()
  for (const text of [
    '>Appearance</h2>',
    'How ASPIRE Intelligence looks for you. Your choices follow you to any device.',
    '>Style</h3>', '>Color Mode</h3>', '>Preview</h3>', '>Where Style Applies</h3>',
    'Leather, paper, pins and brass', 'Clean surfaces, same layout', 'Match my computer',
    'Classic shows the address book and correspondence desk;',
  ]) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /Contacts Layout/)
  // SETTINGS-BAND-1: the intro is the band's one subtitle line, and the section's first
  // child is the first card.
  assert.match(html, /<header class="settings-page-head">[\s\S]*?>Appearance<\/h2>[\s\S]*?class="settings-page-sub">How ASPIRE Intelligence looks for you\. Your choices follow you to any device\.<\/p><\/header><section class="apx"[^>]*><div [^>]*class="apx-group"/)
})

test('the status line follows the OS, and says so when the account cannot be reached', async () => {
  assert.match(await renderPage({ systemTheme: 'dark' }), /data-testid="system-status">Your computer is in dark mode</)
  assert.match(await renderPage({ systemTheme: 'light' }), /data-testid="system-status">Your computer is in light mode</)
  assert.match(await renderPage({ synced: false }), /saved in this browser only/)
  assert.doesNotMatch(await renderPage({ synced: true }), /saved in this browser only/)
})

test('the preview draws the chosen style, and the flag the way that style draws it', async () => {
  assert.match(await renderPage({ style: 'classic' }), /class="apx-pv apx-pv-classic" role="img" aria-label="Preview: Contacts as a leather address book/)
  assert.match(await renderPage({ style: 'modern' }), /class="apx-pv apx-pv-modern" role="img" aria-label="Preview: Contacts as plain panels, with a Flagged tag/)
  const css = read('src/components/settings/appearanceSettings.css')
  assert.match(css, /\.apx-pv-modern \.apx-pv-ribbon \{ display: none; \}/)
  assert.match(css, /\.apx-pv-flag \{ display: none; \}/)
})

// CATALOG-REVAMP-1 added the Catalog (Classic is its bookcase, Modern its plain list).
test('the list is honest about every shipped Modern surface, and Automations is absent', async () => {
  assert.deepEqual(STYLE_SURFACES.map(s => s.key),
    ['placementBoard', 'studentProfiles', 'interviewRubric', 'calendars', 'reviewRelease', 'responses', 'contacts', 'outreach', 'catalog'])
  assert.deepEqual(STYLE_SURFACES.filter(s => s.modern).map(s => s.key),
    ['placementBoard', 'studentProfiles', 'interviewRubric', 'calendars', 'contacts', 'outreach', 'catalog'])
  assert.ok(!STYLE_SURFACES.some(s => /automation/i.test(s.key + s.label)), 'no equipment panel exists to switch')
  const html = await renderPage()
  assert.equal((html.match(/class="apx-ap"/g) || []).length, 9)
  assert.equal((html.match(/class="apx-coming">Coming</g) || []).length, 2)
  for (const realName of ['Esther Kere', 'Tony Kim', 'Gary Mittelberg', 'Karen Mills', 'Krystal Rodriguez']) {
    assert.doesNotMatch(html, new RegExp(realName))
  }
  assert.match(read('src/components/settings/appearanceSettings.css'), /\.apx-sw-catalog \{[\s\S]*?feTurbulence[\s\S]*?linear-gradient/)
})

test('the radio card state is drawn from the checked input, with a visible focus ring', () => {
  const css = read('src/components/settings/appearanceSettings.css')
  assert.match(css, /\.apx-rc:has\(input:checked\),\s*\.apx-rc:has\(input:checked\):hover \{\s*border-color: var\(--color-accent-primary/)
  assert.match(css, /\.apx-rc:has\(input:focus-visible\) \{\s*outline: 3px solid var\(--color-accent-primary[^;]*;\s*outline-offset: 2px;/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  // Corners read the canon or a radius named once at the top of the sheet.
  assert.doesNotMatch(css, /border-radius:\s*[0-9.]+px/)
})

// ── 6. The header button, the tag, and the wiring ──────────────────────────────

test('the header button shows what is on screen and names the switch it makes', async () => {
  const { ColorModeButtonView } = await vite.ssrLoadModule('/src/components/Header/ColorModeButton.jsx')
  const light = render(ColorModeButtonView, { resolved: 'light', onToggle: noop })
  const dark = render(ColorModeButtonView, { resolved: 'dark', onToggle: noop })
  assert.match(light, /aria-label="Switch to dark mode"/)
  assert.match(dark, /aria-label="Switch to light mode"/)
  assert.match(light, /lucide-sun/)
  assert.match(dark, /lucide-moon/)
  assert.match(light, /width:34px;height:34px/)
  // Hidden on phones, where the actions row cannot take a fifth icon; its display lives
  // in the stylesheet so that rule can win.
  assert.match(light, /class="chart-color-mode"/)
  assert.doesNotMatch(light, /display:flex/)
  const tokens = read('src/styles/chartTokens.css')
  assert.match(tokens, /\.chart-color-mode \{ display: flex; \}\s*@media \(max-width: 560px\) \{ \.chart-color-mode \{ display: none; \} \}/)
  const actions = strip(read('src/components/Header/HeaderActions.jsx'))
  assert.match(actions, /<ColorModeButton toast=\{toast\} \/>\s*<UserMenu \/>/, 'beside the other icon buttons, before the menu')
  const btn = strip(read('src/components/Header/ColorModeButton.jsx'))
  assert.match(btn, /setColorMode\(oppositeMode\(effectiveTheme\)\)/, 'from System it resolves first, then sets the opposite')
})

test('the Flagged tag is the ribbon\'s interaction without the pull', async () => {
  const { default: FlagTag } = await vite.ssrLoadModule('/src/components/shared/FlagTag.jsx')
  const on = render(FlagTag, { flagged: true, onFlag: noop, onUnflag: noop, labelOn: 'X is flagged', labelOff: 'Flag X' })
  const off = render(FlagTag, { flagged: false, onFlag: noop, onUnflag: noop, labelOn: 'X is flagged', labelOff: 'Flag X' })
  const inert = render(FlagTag, { flagged: false, disabled: true })
  assert.match(on, /class="flag-tag flag-tag-on" aria-pressed="true" aria-label="X is flagged"/)
  assert.match(on, />Flagged<\/button>/)
  assert.match(off, /aria-pressed="false" aria-label="Flag X"/)
  assert.match(off, />Flag<\/button>/)
  assert.match(inert, /disabled=""/)
  const css = read('src/components/shared/flagTag.css')
  assert.match(css, /\.flag-tag\.flag-tag-on,\s*\.flag-tag\.flag-tag-on:hover:not\(:disabled\) \{/, 'the state beats :hover')
})

test('Modern\'s Contacts keeps the flag: a tag, a row mark, and Flagged only', () => {
  const view = strip(read('src/components/connect/ContactsView.jsx'))
  assert.match(view, /<FlagTag\s+flagged=\{isContactFlagged\(contact\)\}\s+disabled=\{!flagAvailable\}\s+onFlag=\{\(\) => onFlag\(contact, true\)\}\s+onUnflag=\{\(\) => onFlag\(contact, false\)\}/)
  assert.match(view, /onFlag=\{onFlag\}\s+flagAvailable=\{flagAvailable\}/)
  assert.match(view, /<span className="sr-only">, flagged for follow-up<\/span>/)
  assert.match(view, /const filtered = flaggedOnly && flagAvailable \? dirFiltered\.filter\(isContactFlagged\) : dirFiltered/)
  assert.match(view, /data-testid="contacts-flagged-only"/)
  // The same write path as the book's ribbon.
  assert.equal((view.match(/setContactFollowUpFlag\(/g) || []).length, 1)
})

test('Messages and the retired pieces: no material, no old toggle, no General hub', () => {
  const hits = ['src/components/ThemeToggle.jsx', 'src/components/settings/GeneralPanel.jsx', 'src/components/connect/ContactsLayoutLink.jsx']
    .filter(p => { try { read(p); return true } catch { return false } })
  assert.deepEqual(hits, [])
  for (const f of ['MessagesWorkspace', 'MessagesInbox']) {
    assert.doesNotMatch(read(`src/components/connect/messages/${f}.jsx`), /material-|data-style/)
  }
})
