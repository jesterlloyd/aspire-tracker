// HOME-1 (2026-09-24): the slim banner with the launcher.
//
// Both styles show the rotating scenery, the Masthead service's <skyline-card>
// (SkylineCard.jsx), at its own 5:1 shape (Owner, 2026-09-25). Classic sets it behind glass
// in a square wooden window with a sill; Modern shows it as a plain card. In both, the
// greeting, the date and the time are drawn here by the VIEWER's clock, the weather is the
// service's (clicking it opens the service's city picker), and the launcher sits centred.
//
// The clock bug the brief names (the scenery city's time on the clock) lives inside the
// Masthead service, not this repository. On this page the service's own date and clock
// are not shown: the banner draws the date and time itself, by the viewer's clock, under
// the greeting in both styles, and asks the card's open shadow root to keep its centre
// clock hidden (.mast-date, .mast-clock; if the service renames them the clock simply
// shows again behind the launcher, nothing breaks). The greeting and the weather stay
// the service's.

import { useEffect, useRef, useState } from 'react'
import SkylineCard from '../SkylineCard'
import Launcher from './Launcher'
import { greetingFor, dateTimeLine } from '../../lib/home/launcherModel'

function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const ms = 60000 - (Date.now() % 60000)
    let interval = null
    const first = setTimeout(() => { tick(); interval = setInterval(tick, 60000) }, ms)
    return () => { clearTimeout(first); if (interval) clearInterval(interval) }
  }, [])
  return now
}

// The greeting, the date and the clock are drawn by this banner in both styles (the
// service's greeting sits at a height that depends on the band, so drawing both halves
// here keeps them together); the weather and the scenery stay the service's.
// The service also gives its card a 16px top margin, which pushed the whole scene down and
// left a strip at the top of the window (Owner, 2026-09-25: "it looks lower"), and its own
// corner and shadow: the banner's scenery layer is the ONE edge that rounds and clips, because
// three stacked anti-aliased 12px curves (the navy fallback, the clip, the card's white face)
// left a dark fringe at every corner (Owner, 2026-09-25: "shadows in the edges").
const HIDE_SERVICE_CLOCK = '.mast-greet,.mast-date,.mast-clock{display:none!important}'
  + '.mast{margin-top:0!important;border-radius:0!important;box-shadow:none!important}'

// The glass's reflection travels as the page scrolls: the bands slide sideways by a share of
// how far the window has moved. Any scroll container counts (capture), and nothing moves
// under reduced motion.
const GLARE_RATE = 0.45
const GLARE_MAX = 420
function useScrollGlare(sceneRef, glareRef, enabled) {
  useEffect(() => {
    if (!enabled) return undefined
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    let frame = 0
    const paint = () => {
      frame = 0
      const scene = sceneRef.current
      const glare = glareRef.current
      if (!scene || !glare) return
      const x = Math.max(-GLARE_MAX, Math.min(GLARE_MAX, -scene.getBoundingClientRect().top * GLARE_RATE))
      glare.style.setProperty('--hm-glare-x', `${x.toFixed(1)}px`)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint) }
    paint()
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
    }
  }, [sceneRef, glareRef, enabled])
}

export default function HomeBanner({ classic, fullName, userKey, items, calendar, launcher }) {
  const now = useMinuteClock()
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || ''
  const sceneRef = useRef(null)
  const glareRef = useRef(null)
  useScrollGlare(sceneRef, glareRef, classic)

  // Hide the service's greeting and clock, and take back its margin and corner, once its shadow
  // root exists. Polls briefly because the element upgrades when its script arrives, which can
  // be after this mount. It runs again whenever a new card appears in the scene: a card built
  // after the first (a style switch used to rebuild it) came up with the service's own greeting
  // over ours and its 16px margin, until a reload (Owner, 2026-09-25).
  useEffect(() => {
    const host = sceneRef.current
    if (!host) return undefined
    let tries = 0
    let timer = null
    const tick = () => {
      let pending = false
      for (const card of host.querySelectorAll('skyline-card')) {
        const sr = card.shadowRoot
        if (!sr) { pending = true; continue }
        if (!sr.querySelector('style[data-hm-clock]')) {
          const st = document.createElement('style')
          st.setAttribute('data-hm-clock', '')
          st.textContent = HIDE_SERVICE_CLOCK
          sr.appendChild(st)
        }
      }
      if (pending && tries++ < 40) timer = setTimeout(tick, 250)
    }
    const start = () => { clearTimeout(timer); tries = 0; tick() }
    start()
    // Only a card being added matters; the clock and the launcher change this subtree all day.
    const isCard = (n) => n.nodeType === 1 && (n.localName === 'skyline-card' || n.querySelector?.('skyline-card'))
    const mo = new MutationObserver((records) => {
      if (records.some(r => [...r.addedNodes].some(isCard))) start()
    })
    mo.observe(host, { childList: true, subtree: true })
    return () => { clearTimeout(timer); mo.disconnect() }
  }, [])

  const scene = (
    <div className="hm-window-scene" ref={sceneRef}>
      <SkylineCard fullName={fullName} userKey={userKey} items={items} calendar={calendar} flush />
      {classic && (
        <div className="hm-window-glass" aria-hidden="true"><div className="hm-window-glare" ref={glareRef} /></div>
      )}
      {/* The greeting and the launcher sit over the scenery in normal flow, greeting first,
          so nothing overlaps at any width. */}
      <div className="hm-window-content">
        <div className="hm-hero-local hm-greet">
          {greetingFor(now, firstName)}
          <small><time dateTime={now.toISOString()}>{dateTimeLine(now)}</time></small>
        </div>
        <Launcher {...launcher} />
      </div>
    </div>
  )

  return (
    <section className={`hm-hero ${classic ? 'hm-hero-classic' : 'hm-hero-modern'}`} aria-label="Welcome">
      {/* One wrapper in both styles, so switching style keeps the same card in place instead of
          building a new one (only the wrapper's class changes). */}
      <div className={classic ? 'hm-window' : 'hm-frameless'}>{scene}</div>
      {classic && <div className="hm-sill" aria-hidden="true" />}
    </section>
  )
}
