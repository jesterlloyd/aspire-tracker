// SCROLL-TOP-1 (2026-09-25): a new page in the staff app starts at the top.
//
// React Router keeps the window's scroll position across navigations. At a Glance is a long
// page that scrolls the window; Rotation is a fixed-height workspace (100vh less the chrome)
// that scrolls inside itself. Following "Open shift log" from the Today card, which sits
// below the fold, carried the window's offset onto Rotation > Activity: its top hid under the
// header and blank page showed under it, until a reload.
//
// So a change of PATH scrolls the window to the top. Three things do not:
//   - the first render (the page has just loaded; the browser decides),
//   - Back and Forward (POP), which should land where the browser remembers,
//   - a query-only change (?student=, ?contactId=, ?tab=), which is a selection in place.
import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** Pure: does moving from `from` to `to` (paths) by `type` start the page at the top? */
export function shouldScrollTop(from, to, type) {
  if (from == null || from === to) return false
  return type !== 'POP'
}

export function useScrollTopOnRoute() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  const prev = useRef(null)
  useEffect(() => {
    const from = prev.current
    prev.current = pathname
    if (shouldScrollTop(from, pathname, type) && typeof window !== 'undefined') window.scrollTo(0, 0)
  }, [pathname, type])
}
