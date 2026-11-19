import { useLayoutEffect, useRef, useState } from 'react'

// STAFF-DEVICE-1: on a phone a record (the student or applicant binder) is its own screen and
// takes the window below wherever it starts, so the binder's own scroller and index tabs keep
// working. The staff header and a portal's header are not constants on a phone, so the height is
// measured from the panel's real top, on open, on resize and on rotation. Read by Student
// Profiles and Residency > Profiles & Interest; CSS reads it as --profiles-phone-record-h.
export function usePhoneRecordHeight(active) {
  const ref = useRef(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    if (!active) return undefined
    const measure = () => {
      const el = ref.current
      if (!el || !el.offsetParent) return
      const top = el.getBoundingClientRect().top + window.scrollY
      setHeight(Math.max(360, Math.round(window.innerHeight - top - 12)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])
  return [ref, active && height ? height : 0]
}
