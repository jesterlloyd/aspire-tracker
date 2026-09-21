// APPEARANCE-STYLE-1 (2026-09-21): how the app looks for one person, in two independent
// choices that combine freely.
//
//   Style       classic | modern          what the workspaces are made of
//   Color mode  light | dark | system     which palette paints them
//
// Both are account preferences (src/lib/userPreferences.js), so they follow the person.
// The page, though, has to be painted before anyone is signed in, and a flash of the
// wrong theme on every load is worse than a flash on the first load of a new device. So
// the DEVICE keeps a mirror of what it last painted, in two localStorage keys the inline
// script in index.html reads before React exists.
//
// The mirror is NOT `aspire-theme`, the key the old device-local theme used. The old
// build wrote that key only when a person clicked a theme, so its presence means "this
// person chose", and the first load after this shipped adopts it into the account
// (legacyAppearance). If this build wrote its mirror there too, a Light painted only
// because nothing was chosen would read as a choice on the next load and could outvote
// a real Dark chosen on another device. So this build reads `aspire-theme` and never
// writes it.
//
// Two attributes on <html> carry the result:
//   data-theme="light|dark"      always the RESOLVED mode. Every dark rule in the app keys
//                                on [data-theme="dark"] and none on prefers-color-scheme,
//                                so System is resolved here rather than by removing the
//                                attribute (the brief's shape, which would switch dark
//                                mode off for every System user).
//   data-style="classic|modern"  Modern is a material switch. A screen keeps ONE component
//                                tree and turns its materials off under
//                                :root[data-style="modern"]; see CLAUDE.md.
//
// This module is pure and has no React: the context, the hooks, the Settings page, the
// header button and the tests all read the same rules from here.
import {
  APPEARANCE_COLOR_MODE, APPEARANCE_STYLE, USER_PREFERENCES, isValidPreferenceValue,
} from './userPreferences.js'

export const STYLES = USER_PREFERENCES[APPEARANCE_STYLE].values
export const COLOR_MODES = USER_PREFERENCES[APPEARANCE_COLOR_MODE].values
export const DEFAULT_STYLE = USER_PREFERENCES[APPEARANCE_STYLE].fallback
export const DEFAULT_COLOR_MODE = USER_PREFERENCES[APPEARANCE_COLOR_MODE].fallback

// The device mirror. index.html reads these keys by name; keep them in step.
export const DEVICE_COLOR_MODE_KEY = 'aspire-color-mode'
export const DEVICE_STYLE_KEY = 'aspire-style'
// The old device-local theme: read, as the migration's source and as the mirror's
// fallback before this build has painted anything on the device. Never written.
export const LEGACY_THEME_KEY = 'aspire-theme'

export const isStyle = (v) => STYLES.includes(v)
export const isColorMode = (v) => COLOR_MODES.includes(v)

function safeGet(storage, key) {
  try { return storage ? storage.getItem(key) : null } catch { return null }
}
function safeSet(storage, key, value) {
  try { if (storage) storage.setItem(key, value) } catch { /* private mode */ }
}

/** What this device last painted, with the defaults for anything missing or illegal. */
export function readDeviceAppearance(storage) {
  const mirrored = safeGet(storage, DEVICE_COLOR_MODE_KEY)
  const mode = isColorMode(mirrored) ? mirrored : safeGet(storage, LEGACY_THEME_KEY)
  const style = safeGet(storage, DEVICE_STYLE_KEY)
  return {
    colorMode: isColorMode(mode) ? mode : DEFAULT_COLOR_MODE,
    style: isStyle(style) ? style : DEFAULT_STYLE,
  }
}

export function writeDeviceAppearance(storage, { colorMode, style } = {}) {
  if (isColorMode(colorMode)) safeSet(storage, DEVICE_COLOR_MODE_KEY, colorMode)
  if (isStyle(style)) safeSet(storage, DEVICE_STYLE_KEY, style)
}

/**
 * The migration. Before this build the theme lived only in this browser, under
 * `aspire-theme`, written only when the person picked one. Handed to the preference
 * store as its legacy seed, it is adopted into the account the first time the account
 * is read without a color mode of its own, so a person who chose Dark keeps Dark. Style
 * has no legacy: it did not exist.
 */
export function legacyAppearance(storage) {
  const mode = safeGet(storage, LEGACY_THEME_KEY)
  return isColorMode(mode) ? { [APPEARANCE_COLOR_MODE]: mode } : {}
}

/**
 * What the account says to paint for one key: its stored value when legal; its fallback
 * once the account has been read and holds none; otherwise null, meaning nothing is
 * known yet and the device's own mirror must be left alone (useAppearanceSync).
 */
export function accountValue(prefs, synced, key) {
  const v = prefs ? prefs[key] : undefined
  if (isValidPreferenceValue(key, v)) return v
  return synced === true ? USER_PREFERENCES[key].fallback : null
}

/** light | dark, the mode actually painted. */
export function resolveColorMode(colorMode, systemIsDark) {
  if (colorMode === 'dark') return 'dark'
  if (colorMode === 'system') return systemIsDark ? 'dark' : 'light'
  return 'light'
}

/** The header button switches to the opposite of what is on screen, as an explicit choice. */
export const oppositeMode = (resolved) => (resolved === 'dark' ? 'light' : 'dark')
export const quickToggleLabel = (resolved) => `Switch to ${oppositeMode(resolved)} mode`

export const systemStatusLine = (systemIsDark) =>
  `Your computer is in ${systemIsDark ? 'dark' : 'light'} mode`

// The short confirmation a change shows. Sentences, not titles.
export function styleToast(style) {
  return style === 'modern' ? 'Modern style on' : 'Classic style on'
}
export function colorModeToast(colorMode) {
  if (colorMode === 'dark') return 'Dark mode'
  if (colorMode === 'system') return 'Matching your computer'
  return 'Light mode'
}

// Where Style applies, in the brief's order. `modern` is true once that screen's Modern
// overrides are built; until then Settings marks the row Coming, so the page never
// promises a switch that does not happen yet. A screen's own session flips its flag.
// Automations is deliberately absent: it has no equipment panel, so it already looks
// the same in both styles. Add it here when a material for it ships.
export const STYLE_SURFACES = Object.freeze([
  { key: 'placementBoard', label: 'Placement Board', material: 'Pinboard', modern: false },
  { key: 'studentProfiles', label: 'Student Profiles', material: 'Chart binder', modern: false },
  { key: 'interviewRubric', label: 'Interview Rubric', material: 'Bound book', modern: false },
  { key: 'calendars', label: 'Calendars', material: 'Desk planner', modern: false },
  { key: 'reviewRelease', label: 'Review & Release', material: 'Clipboard', modern: false },
  { key: 'responses', label: 'Evaluation Responses', material: 'Printout', modern: false },
  { key: 'contacts', label: 'Contacts', material: 'Address book', modern: true },
].map(Object.freeze))

/** Contacts is the one screen whose DRAWING follows Style: the book, or three columns. */
export const contactsUsesBook = (style) => style !== 'modern'
