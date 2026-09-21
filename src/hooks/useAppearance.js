// APPEARANCE-STYLE-1 (2026-09-21): Style and Color mode for the signed-in person.
//
// useAppearance is what every control uses (Settings > Appearance, the header's light
// and dark button). It reads what is PAINTED, from ThemeContext, and writes a choice in
// three steps: paint it at once, save it to the account, and if the account refuses,
// put back what was there and report the failure so the control can say so.
//
// useAppearanceSync runs once, in the staff app, and is the other direction: when the
// account's stored choice arrives (sign-in, another device, the first read adopting the
// old device theme), it paints it. A key the account has not stored yet paints nothing
// until the account has actually been read, so the device's mirror is never overwritten
// by a default that was only a guess.
import { useCallback, useEffect } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { preferenceStore, useUserPreferenceSnapshot } from './useUserPreference'
import { APPEARANCE_COLOR_MODE, APPEARANCE_STYLE } from '../lib/userPreferences'
import { accountValue } from '../lib/appearance'

export function useAppearanceSync() {
  const { paintStyle, paintColorMode } = useTheme()
  const { prefs, synced } = useUserPreferenceSnapshot()
  const style = accountValue(prefs, synced, APPEARANCE_STYLE)
  const colorMode = accountValue(prefs, synced, APPEARANCE_COLOR_MODE)

  useEffect(() => { if (style) paintStyle(style) }, [style, paintStyle])
  useEffect(() => { if (colorMode) paintColorMode(colorMode) }, [colorMode, paintColorMode])
}

export function useAppearance() {
  const theme = useTheme()
  const { synced } = useUserPreferenceSnapshot()
  const { style, colorMode, paintStyle, paintColorMode } = theme

  // Resolves to { ok: true, saved } or { ok: false, error }. Never rejects.
  const choose = useCallback(async (key, next, shown, paint) => {
    const stored = preferenceStore.getSnapshot().prefs?.[key]
    paint(next)
    let result
    try {
      result = await preferenceStore.set(key, next)
    } catch (error) {
      result = { saved: 'browser', error }
    }
    if (result.error) {
      if (preferenceStore.restore(key, next, stored)) paint(shown)
      return { ok: false, error: result.error }
    }
    return { ok: true, saved: result.saved }
  }, [])

  const setStyle = useCallback(
    (next) => choose(APPEARANCE_STYLE, next, style, paintStyle),
    [choose, style, paintStyle])
  const setColorMode = useCallback(
    (next) => choose(APPEARANCE_COLOR_MODE, next, colorMode, paintColorMode),
    [choose, colorMode, paintColorMode])

  return {
    style: theme.style,
    colorMode: theme.colorMode,
    effectiveTheme: theme.effectiveTheme,
    systemTheme: theme.systemTheme,
    synced,
    setStyle,
    setColorMode,
  }
}
