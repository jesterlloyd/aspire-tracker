// USER-PREFERENCES-1: the one React entry to per-user preferences. Every control that
// shows or changes a preference reads it through this module, so Settings and the screen
// it governs are subscribed to the same store and cannot disagree.
//
//   const [style, setStyle, { synced }] = useUserPreference(APPEARANCE_STYLE)
//
// `synced` is true when the choice follows the account, false when this build can only
// keep it in the browser (the column is not applied yet), null while loading.
//
// APPEARANCE-STYLE-1: the store is seeded with the old device-local theme
// (legacyAppearance), so the first read of an account with no color mode adopts it.
// useUserPreferenceSnapshot gives useAppearance the raw stored object, because it has to
// tell "the account chose Light" from "the account has not said".
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { createUserPreferenceStore, preferenceValue } from '../lib/userPreferences'
import { legacyAppearance } from '../lib/appearance'

function browserStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export const preferenceStore = createUserPreferenceStore({
  client: supabase,
  storage: browserStorage(),
  legacy: () => legacyAppearance(browserStorage()),
})

// The signed-in person's stored preferences: { uid, prefs, synced }. Before the store has
// been pointed at this person, their cached object is read directly so a choice never
// flashes its default first.
export function useUserPreferenceSnapshot() {
  const { user } = useAuth()
  const uid = user?.id || null

  useEffect(() => { preferenceStore.ensure(uid) }, [uid])

  const snap = useSyncExternalStore(preferenceStore.subscribe, preferenceStore.getSnapshot)
  return snap.uid === uid
    ? { uid, prefs: snap.prefs, synced: snap.synced }
    : { uid, prefs: preferenceStore.readCache(uid), synced: null }
}

export function useUserPreference(key) {
  const { prefs, synced } = useUserPreferenceSnapshot()
  const value = preferenceValue(prefs, key)
  const setValue = useCallback((next) => preferenceStore.set(key, next), [key])
  return [value, setValue, { synced }]
}
