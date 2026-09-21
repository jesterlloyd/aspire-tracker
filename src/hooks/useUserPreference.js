// USER-PREFERENCES-1: the one React entry to per-user preferences. Every control that
// shows or changes a preference reads it through this hook, so Settings and the screen
// it governs are subscribed to the same store and cannot disagree.
//
//   const [layout, setLayout, { synced }] = useUserPreference(CONTACTS_LAYOUT)
//
// `synced` is true when the choice follows the account, false when this build can only
// keep it in the browser (the column is not applied yet), null while loading.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { createUserPreferenceStore, preferenceValue } from '../lib/userPreferences'

function browserStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

const store = createUserPreferenceStore({ client: supabase, storage: browserStorage() })

export function useUserPreference(key) {
  const { user } = useAuth()
  const uid = user?.id || null

  useEffect(() => { store.ensure(uid) }, [uid])

  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // Before the effect above has run for this user, read their cached choice directly so
  // a person who chose a layout never sees the other one flash first.
  const prefs = snap.uid === uid ? snap.prefs : store.readCache(uid)
  const value = preferenceValue(prefs, key)

  const setValue = useCallback((next) => store.set(key, next), [key])

  return [value, setValue, { synced: snap.uid === uid ? snap.synced : null }]
}
