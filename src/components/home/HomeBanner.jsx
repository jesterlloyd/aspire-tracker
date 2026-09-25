// HOME-1 (2026-09-24): the slim banner with the launcher.
//
// Classic keeps the rotating scenery, which is the Masthead service's <skyline-card>
// (SkylineCard.jsx), cropped to a band inside a window frame; the greeting, the clock and
// the weather it draws are the service's own. Modern is a plain navy band with the
// greeting, the date and the time drawn here, by the VIEWER's clock and zone. In both,
// the launcher sits centred in the band.
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
const HIDE_SERVICE_CLOCK = '.mast-greet,.mast-date,.mast-clock{display:none!important}'

export default function HomeBanner({ classic, fullName, userKey, items, calendar, launcher }) {
  const now = useMinuteClock()
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || ''
  const sceneRef = useRef(null)

  // Hide the service's date and clock once its shadow root exists. Polls briefly because
  // the element upgrades when its script arrives, which can be after this mount.
  useEffect(() => {
    if (!classic) return undefined
    let tries = 0
    const tick = () => {
      const el = sceneRef.current?.querySelector('skyline-card')
      const sr = el?.shadowRoot
      if (sr) {
        if (!sr.querySelector('style[data-hm-clock]')) {
          const st = document.createElement('style')
          st.setAttribute('data-hm-clock', '')
          st.textContent = HIDE_SERVICE_CLOCK
          sr.appendChild(st)
        }
        return
      }
      if (tries++ < 40) timer = setTimeout(tick, 250)
    }
    let timer = setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [classic])
  return (
    <section className={`hm-hero ${classic ? 'hm-hero-classic' : 'hm-hero-modern'}`} aria-label="Welcome">
      {classic ? (
        <div className="hm-window">
          <div className="hm-window-glass" aria-hidden="true" />
          <div className="hm-window-scene" ref={sceneRef}>
            <SkylineCard fullName={fullName} userKey={userKey} items={items} calendar={calendar} flush />
          </div>
          <div className="hm-hero-local hm-greet">
            {greetingFor(now, firstName)}
            <small><time dateTime={now.toISOString()}>{dateTimeLine(now)}</time></small>
          </div>
        </div>
      ) : (
        <div className="hm-hero-top">
          <div className="hm-greet">
            {greetingFor(now, firstName)}
            <small>{dateTimeLine(now)}</small>
          </div>
        </div>
      )}
      <Launcher {...launcher} />
      {classic && <div className="hm-sill" aria-hidden="true" />}
    </section>
  )
}
