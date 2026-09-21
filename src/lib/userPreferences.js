// USER-PREFERENCES-1 (CONTACTS-BOOK-1, 2026-09-20): per-user interface preferences.
//
// A preference is a choice about how the app LOOKS to one person, and it follows that
// person to every device they sign in on. So it lives on their own profile row
// (user_profiles.ui_preferences, a jsonb object) and not in the browser. Theme is the
// exception on purpose: it stays device-local in ThemeContext, because a phone and a
// desktop can reasonably want different themes.
//
// Every key is registered here, with the values it may hold and the value everyone
// gets until they choose. A key that is not registered is never written by this
// build, and a stored value that is not legal reads as the fallback, so a bad row can
// never put the app in a state it does not have. Other screens add their own
// `appearance.*` key below; nothing else needs to change.
//
// The column is Owner-gated (supabase/migrations/20260924000000_user_ui_preferences.sql).
// Until it is applied the read answers 42703 (undefined column) and the store keeps
// the choice in this browser only. When the column arrives, the first load adopts
// whatever this browser chose for any key the account has not stored yet, so nobody
// who opted in early is quietly switched back.

export const CONTACTS_LAYOUT = 'appearance.contactsLayout'

export const USER_PREFERENCES = Object.freeze({
  [CONTACTS_LAYOUT]: Object.freeze({ values: Object.freeze(['classic', 'book']), fallback: 'classic' }),
})

const UNDEFINED_COLUMN = '42703'

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function isKnownPreference(key) {
  return Object.prototype.hasOwnProperty.call(USER_PREFERENCES, key)
}

export function isValidPreferenceValue(key, value) {
  return isKnownPreference(key) && USER_PREFERENCES[key].values.includes(value)
}

// The value a person sees: their stored choice when it is legal, else the fallback.
export function preferenceValue(prefs, key) {
  if (!isKnownPreference(key)) throw new Error(`Unknown preference: ${key}`)
  const v = isPlainObject(prefs) ? prefs[key] : undefined
  return isValidPreferenceValue(key, v) ? v : USER_PREFERENCES[key].fallback
}

// Registered keys with legal values in `local` that `server` does not hold yet. This
// is the one-time adoption when the column first appears; a key the account already
// stores always wins, whatever this browser remembers.
export function keysToAdopt(server, local) {
  const out = {}
  if (!isPlainObject(local)) return out
  const s = isPlainObject(server) ? server : {}
  for (const key of Object.keys(USER_PREFERENCES)) {
    if (s[key] === undefined && isValidPreferenceValue(key, local[key])) out[key] = local[key]
  }
  return out
}

export const preferenceCacheKey = (uid) => `aspire:ui-preferences:${uid}`

// One store per client. `client` is a supabase client (the real one in the app, a fake
// in the tests); `storage` is Storage-like and may be null or throw. State:
//   uid     whose preferences these are (null before sign-in)
//   prefs   the stored object, unknown keys included and preserved on write
//   synced  true once the account row was read; false when this build can only keep
//           the choice in the browser (column absent, or the read failed); null while
//           the first read is in flight
export function createUserPreferenceStore({ client, storage }) {
  let state = { uid: null, prefs: {}, synced: null }
  const listeners = new Set()
  let writes = Promise.resolve()

  const emit = (next) => { state = next; listeners.forEach((l) => l()) }

  const readCache = (uid) => {
    if (!uid || !storage) return {}
    try {
      const parsed = JSON.parse(storage.getItem(preferenceCacheKey(uid)) || 'null')
      return isPlainObject(parsed) ? parsed : {}
    } catch { return {} }
  }
  const writeCache = (uid, prefs) => {
    if (!uid || !storage) return
    try { storage.setItem(preferenceCacheKey(uid), JSON.stringify(prefs)) } catch { /* private mode */ }
  }

  const readRow = (uid) => client
    .from('user_profiles')
    .select('ui_preferences')
    .eq('auth_user_id', uid)
    .maybeSingle()

  // `.select()` after the update returns the rows actually written. A row the self
  // policy refused comes back as an empty list with no error, and must not read as saved.
  const writeRow = async (uid, prefs) => {
    const { data, error } = await client
      .from('user_profiles')
      .update({ ui_preferences: prefs })
      .eq('auth_user_id', uid)
      .select('auth_user_id')
    if (error) return error
    if (!Array.isArray(data) || data.length === 0) return { message: 'No profile row was updated' }
    return null
  }

  async function load(uid) {
    let result
    try { result = await readRow(uid) } catch (err) { result = { error: err } }
    if (state.uid !== uid) return
    const { data, error } = result
    if (error) {
      emit({ ...state, synced: false, reason: error.code === UNDEFINED_COLUMN ? 'unavailable' : 'error' })
      return
    }
    const server = isPlainObject(data?.ui_preferences) ? data.ui_preferences : {}
    const adopted = keysToAdopt(server, readCache(uid))
    const prefs = { ...server, ...adopted }
    writeCache(uid, prefs)
    emit({ uid, prefs, synced: true })
    if (Object.keys(adopted).length > 0) {
      writes = writes.then(() => writeRow(uid, prefs)).catch(() => {})
      await writes
    }
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot() { return state },
    readCache,

    // Idempotent per user: the first call for a uid starts the read, later calls are no-ops.
    ensure(uid) {
      if (!uid || state.uid === uid) return null
      emit({ uid, prefs: readCache(uid), synced: null })
      return load(uid)
    },

    // The choice shows at once; the account write follows, one at a time, re-reading the
    // row first so a key another device wrote since this tab loaded is kept.
    // Resolves to { saved: 'account' | 'browser' } and never rejects.
    set(key, value) {
      if (!isValidPreferenceValue(key, value)) {
        return Promise.reject(new Error(`Illegal value for ${key}: ${String(value)}`))
      }
      const { uid } = state
      const prefs = { ...state.prefs, [key]: value }
      emit({ ...state, prefs })
      writeCache(uid, prefs)
      if (!uid || state.synced !== true) return Promise.resolve({ saved: 'browser' })
      const job = writes.then(async () => {
        const { data, error } = await readRow(uid)
        if (error) return { saved: 'browser', error }
        const fresh = isPlainObject(data?.ui_preferences) ? data.ui_preferences : {}
        const writeError = await writeRow(uid, { ...fresh, [key]: value })
        return writeError ? { saved: 'browser', error: writeError } : { saved: 'account' }
      }).catch((error) => ({ saved: 'browser', error }))
      writes = job
      return job
    },
  }
}
