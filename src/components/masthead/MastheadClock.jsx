// MASTHEAD-LOCKSCREEN-1: the clock in the middle of the masthead, with the
// date above it. "Friday, 4 Sep" over "07:29"; twelve-hour, zero-padded, no
// AM/PM, the way the macOS lock screen writes it (Owner's reference). The
// labels and the width match live in src/lib/mastheadClock.js.
//
// Ticks on the minute boundary rather than every second, since there is no
// seconds display to justify the wakeups.
//
// MASTHEAD-CITY-TIME-1: a chosen city's masthead is a window onto that city,
// so the clock reads the city's zone from the shared weather query (the same
// payload that already moves the scene and the temperature there). Automatic
// and the viewer's own location keep the local clock.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clockLabel, dateLabel, fitWidths, mastheadTimeZone } from '../../lib/mastheadClock'
import { useWelcomeWeather } from '../WeatherScene'

export default function MastheadClock() {
  const [now, setNow] = useState(() => new Date())
  const { data, location } = useWelcomeWeather()
  const timeZone = mastheadTimeZone(data, location)
  const clockRef = useRef(null)
  const dateRef = useRef(null)

  useEffect(() => {
    let timer
    const arm = () => {
      const untilNextMinute = 60000 - (Date.now() % 60000) + 50
      timer = setTimeout(() => { setNow(new Date()); arm() }, untilNextMinute)
    }
    arm()
    return () => clearTimeout(timer)
  }, [])

  useLayoutEffect(() => {
    const fit = () => fitWidths(clockRef.current, dateRef.current)
    fit()
    window.addEventListener('resize', fit)
    // Fonts arriving after first paint change both widths; refit once they do.
    document.fonts?.ready?.then(fit)
    return () => window.removeEventListener('resize', fit)
  }, [now, timeZone])

  return (
    <div className="mast-centre">
      <div className="mast-date" ref={dateRef}>{dateLabel(now, timeZone)}</div>
      <time className="mast-clock" ref={clockRef} dateTime={now.toISOString()}>{clockLabel(now, timeZone)}</time>
    </div>
  )
}
