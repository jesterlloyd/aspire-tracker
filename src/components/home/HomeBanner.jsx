// HOME-1 (2026-09-24): the slim banner with the launcher.
//
// Classic keeps the rotating scenery, which is the Masthead service's <skyline-card>
// (SkylineCard.jsx), cropped to a band inside a window frame; the greeting, the clock and
// the weather it draws are the service's own. Modern is a plain navy band with the
// greeting, the date and the time drawn here, by the VIEWER's clock and zone. In both,
// the launcher sits centred in the band.
//
// Delivery note: the clock bug the brief names (the scenery city's time on the clock)
// lives inside the Masthead service, not this repository. Modern's clock is local by
// construction; Classic's follows the service until the service is fixed.

import { useEffect, useState } from 'react'
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

export default function HomeBanner({ classic, fullName, userKey, items, calendar, launcher }) {
  const now = useMinuteClock()
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || ''
  return (
    <section className={`hm-hero ${classic ? 'hm-hero-classic' : 'hm-hero-modern'}`} aria-label="Welcome">
      {classic ? (
        <div className="hm-window">
          <div className="hm-window-glass" aria-hidden="true" />
          <div className="hm-window-scene">
            <SkylineCard fullName={fullName} userKey={userKey} items={items} calendar={calendar} flush />
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
