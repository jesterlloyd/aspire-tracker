import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  hasSeenPortalCohortHint,
  markPortalCohortHintSeen,
} from '../lib/portalCohortHint'

const TARGET = '[data-portal-cohort-picker="true"]'
const WIDTH = 224

function targetRect() {
  const target = document.querySelector(TARGET)
  if (!target || target.getClientRects().length === 0) return null
  const rect = target.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

function positionFor(rect) {
  const viewportWidth = window.innerWidth
  const left = Math.max(12, Math.min(rect.right - WIDTH, viewportWidth - WIDTH - 12))
  const top = rect.bottom + 10
  const arrowLeft = Math.max(20, Math.min(rect.left + rect.width / 2 - left, WIDTH - 20))
  return { top, left, '--ptl-cohort-hint-arrow-left': `${arrowLeft}px` }
}

export default function PortalCohortLoginHint({ enabled, userId, experience }) {
  const [position, setPosition] = useState(null)
  const dismissedRef = useRef(false)
  const dismiss = useCallback(() => {
    dismissedRef.current = true
    setPosition(null)
  }, [])

  useEffect(() => {
    if (!enabled || !userId || !experience || hasSeenPortalCohortHint(userId, experience)) {
      return undefined
    }
    dismissedRef.current = false

    let cancelled = false
    let findTimer = null
    let dismissTimer = null
    let attempts = 0

    const update = () => {
      if (cancelled || dismissedRef.current) return
      const rect = targetRect()
      if (!rect) {
        attempts += 1
        if (attempts < 30) findTimer = window.setTimeout(update, 150)
        return
      }
      setPosition(positionFor(rect))
      markPortalCohortHintSeen(userId, experience)
      dismissTimer = window.setTimeout(dismiss, 8000)
    }

    const reposition = () => {
      if (dismissedRef.current) return
      const rect = targetRect()
      setPosition(rect ? positionFor(rect) : null)
    }

    findTimer = window.setTimeout(update, 0)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      cancelled = true
      if (findTimer) window.clearTimeout(findTimer)
      if (dismissTimer) window.clearTimeout(dismissTimer)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [dismiss, enabled, userId, experience])

  if (!enabled || !position) return null
  return (
    <div className="ptl-cohort-login-hint" style={position}>
      <span role="status" aria-live="polite">Switch cohort view here</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss cohort switch hint">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
