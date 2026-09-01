// MASTHEAD-SCENE-4: one shared subscription to the chosen masthead city.
//
// The scenery layer and the temperature trigger both need the value, and they
// live in different components, so the preference is published through a tiny
// module-level listener set. Writing it notifies every masthead on the page at
// once (staff card and portal card alike) - no context provider, no prop
// threading through hosts that never cared about scenery.

import { useEffect, useState } from 'react'
import { AUTO, readCityPreference, writeCityPreference } from '../../lib/mastheadCityPreference'

const listeners = new Set()

export function useCityPreference() {
  const [city, setCity] = useState(() => readCityPreference())

  useEffect(() => {
    const onChange = (next) => setCity(next)
    listeners.add(onChange)
    // Another tab changing the preference should reach this one too.
    const onStorage = () => setCity(readCityPreference())
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(onChange); window.removeEventListener('storage', onStorage) }
  }, [])

  const choose = (next) => {
    writeCityPreference(next)
    const value = next || AUTO
    for (const fn of listeners) fn(value)
  }

  // 'auto' reads as no override, which is what every consumer branches on.
  return { city: city === AUTO ? null : city, raw: city, choose }
}
