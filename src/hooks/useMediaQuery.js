import { useEffect, useState } from 'react'

// STAFF-DEVICE-1 (2026-11-19): the staff app adapts to the screen's CURRENT width, never to a
// device model. A folded iPhone Duo is a phone; unfolded, or an iPad mini (744 points wide in
// portrait), it is a tablet, and the layout switches the moment the screen does. CSS uses the
// same number (`@media (max-width: 739.98px)`); test/staffDeviceLayout.test.mjs holds them equal.
export const PHONE_MAX_WIDTH = 739.98
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`

export function useMediaQuery(query) {
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false)
  const [matches, setMatches] = useState(read)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

export const usePhoneLayout = () => useMediaQuery(PHONE_QUERY)
