import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'aspire-theme'
const VALID_THEMES = ['light', 'dark', 'system']

const ThemeContext = createContext({
  theme: 'light',
  effectiveTheme: 'light',
  setTheme: () => {},
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return VALID_THEMES.includes(stored) ? stored : 'light'
    } catch {
      return 'light'
    }
  })

  const getSystemIsDark = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches

  const resolveEffective = useCallback((t) => {
    if (t === 'system') return getSystemIsDark() ? 'dark' : 'light'
    return t
  }, [])

  const [effectiveTheme, setEffectiveTheme] = useState(() => resolveEffective(theme))

  // Apply data-theme to <html> whenever effectiveTheme changes
  useEffect(() => {
    const resolved = resolveEffective(theme)
    setEffectiveTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [theme, resolveEffective])

  // Listen for OS preference changes when theme === 'system'
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => {
      const resolved = e.matches ? 'dark' : 'light'
      setEffectiveTheme(resolved)
      document.documentElement.setAttribute('data-theme', resolved)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((t) => {
    if (!VALID_THEMES.includes(t)) return
    setThemeState(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
