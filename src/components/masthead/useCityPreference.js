// MASTHEAD-SCENE-4: one shared subscription to the chosen masthead city.
//
// The scenery layer and the temperature trigger both need the value, and they
// live in different components, so the preference is published through a tiny
// module-level listener set. Writing it notifies every masthead on the page at
// once (staff card and portal card alike) - no context provider, no prop
// threading through hosts that never cared about scenery.
//
// MASTHEAD-CITY-PER-USER-1: the value is stored per signed-in user, so the hook
// needs the user id. It reads it from AuthContext, which main.jsx mounts above
// both the staff app and every portal, rather than taking a prop: the masthead
// is rendered by hosts that have no reason to know about identity.

import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { AUTO, readCityPreference, writeCityPreference } from '../../lib/mastheadCityPreference'

const listeners = new Set()

// MASTHEAD-TIMELAPSE-1: a counter, not a boolean, so that re-picking the city
// you already have still registers as a pick. That is the Owner's on-demand
// replay: the value does not change, the sequence does, and the sweep runs.
// It exists here because `choose` is the ONLY explicit pick in the system -
// the value also moves on load, on an account switch and on another tab's
// write, and none of those should trigger a sweep.
let pickSeq = 0

export function useCityPreference() {
  const { user } = useAuth()
  const userId = user?.id || null
  const [city, setCity] = useState(() => readCityPreference(userId))

  // Re-read whenever the account changes. This is the shared-workstation case
  // the per-user key exists for: signing out and back in as someone else does
  // not necessarily remount this hook, and without this the new user would keep
  // looking at the previous user's city until the page happened to reload.
  //
  // Adjusted DURING RENDER rather than in an effect. React documents this as the
  // way to reset state when an input changes ("You Might Not Need an Effect");
  // the effect version sets state after paint, which both trips the repo's
  // set-state-in-effect rule and shows the previous account's city for a frame.
  const [seenUser, setSeenUser] = useState(userId)
  if (seenUser !== userId) {
    setSeenUser(userId)
    setCity(readCityPreference(userId))
  }

  const [seenPick, setSeenPick] = useState(pickSeq)

  useEffect(() => {
    const onChange = (next, seq) => { setCity(next); setSeenPick(seq) }
    listeners.add(onChange)
    // Another tab changing the preference should reach this one too.
    const onStorage = () => setCity(readCityPreference(userId))
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(onChange); window.removeEventListener('storage', onStorage) }
  }, [userId])

  const choose = (next) => {
    writeCityPreference(userId, next)
    const value = next || AUTO
    pickSeq += 1
    for (const fn of listeners) fn(value, pickSeq)
  }

  // 'auto' reads as no override, which is what every consumer branches on.
  // pickSeq is 0 until the viewer picks, so a consumer can tell a pick from the
  // value simply arriving.
  return { city: city === AUTO ? null : city, raw: city, choose, pickSeq: seenPick }
}
