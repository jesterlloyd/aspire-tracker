// APPEARANCE-STYLE-1 (2026-09-21): the device's painter. It owns the two attributes on
// <html> (data-theme, always resolved to light or dark, and data-style) and the device
// mirror in localStorage that index.html paints from before React loads.
//
// It knows nothing about accounts, because it sits above AuthProvider and the public
// pages and portals use it too. The staff app's useAppearanceSync pushes the signed-in
// person's account choice into it; every control writes through useAppearance, never
// through here directly.
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import {
  readDeviceAppearance, writeDeviceAppearance, resolveColorMode, isColorMode, isStyle,
  DEFAULT_COLOR_MODE, DEFAULT_STYLE,
} from '../lib/appearance'

function browserStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'
const systemIsDark = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches

const ThemeContext = createContext({
  colorMode: DEFAULT_COLOR_MODE,
  effectiveTheme: 'light',
  systemTheme: 'light',
  style: DEFAULT_STYLE,
  paintColorMode: () => {},
  paintStyle: () => {},
})

export function ThemeProvider({ children }) {
  const [initial] = useState(() => readDeviceAppearance(browserStorage()))
  const [colorMode, setColorMode] = useState(initial.colorMode)
  const [style, setStyle] = useState(initial.style)
  // The OS setting is tracked whatever the mode, because Settings shows it live beside
  // the System card even while Light or Dark is chosen.
  const [systemDark, setSystemDark] = useState(systemIsDark)

  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY)
    if (!mq) return undefined
    const handler = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const effectiveTheme = resolveColorMode(colorMode, systemDark)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme)
  }, [effectiveTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-style', style)
  }, [style])

  // Paint a choice and remember it on this device. Illegal values are ignored.
  const paintColorMode = useCallback((next) => {
    if (!isColorMode(next)) return
    setColorMode(next)
    writeDeviceAppearance(browserStorage(), { colorMode: next })
  }, [])

  const paintStyle = useCallback((next) => {
    if (!isStyle(next)) return
    setStyle(next)
    writeDeviceAppearance(browserStorage(), { style: next })
  }, [])

  const value = useMemo(() => ({
    colorMode, effectiveTheme, systemTheme: systemDark ? 'dark' : 'light', style,
    paintColorMode, paintStyle,
  }), [colorMode, effectiveTheme, systemDark, style, paintColorMode, paintStyle])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
