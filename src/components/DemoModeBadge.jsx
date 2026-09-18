// DEMO-MODE-1: the marker that says the app is not showing real data.
//
// It sits beside the wordmark, in the one strip of chrome every surface shares, for two
// reasons that pull in opposite directions and both had to be satisfied.
//
//   IT MUST BE IMPOSSIBLE TO MISS while working. Presenting real student data believing
//   demo was on is the failure this feature exists to prevent, and its mirror image,
//   editing demo data believing it was real, wastes an afternoon.
//
//   IT MUST STAY OUT OF THE SCREENSHOT. A banner across the top appears in every full
//   window capture and has to be cropped out of each one by hand. Sitting in the top
//   left corner of the chrome means a capture of a card, a board, a chart or a drawer
//   never contains it, and a capture of the whole window contains it once, small.
//
// The styling is entirely in src/styles/demoMode.css, which both halves of the app
// import, because this badge appears in the staff header AND in every portal's chrome.
// Nothing here writes a radius or a colour; the sheet reads the tokens.
import { useEffect, useState } from 'react'
import { isDemoMode, subscribeDemoMode } from '../lib/demoMode'

export default function DemoModeBadge() {
  const [on, setOn] = useState(isDemoMode)

  useEffect(() => subscribeDemoMode(setOn), [])

  if (!on) return null

  return (
    <span
      className="demo-badge"
      // A live region: a screen reader announces the mode changing without the user
      // having to go looking for the badge.
      role="status"
      aria-live="polite"
      title="Demo mode is on. Every record on screen is fabricated."
    >
      <span className="demo-badge-dot" aria-hidden="true" />
      Demo
    </span>
  )
}
