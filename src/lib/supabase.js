import { createClient } from '@supabase/supabase-js'
import { installDemoScope } from './demoScope.js'
import { installDemoApiHeader } from './demoFetch.js'
import { createTimeoutFetch } from './supabaseFetch.js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Populated by setQueryClient() called from main.jsx so we can invalidate after reconnect
let _queryClient = null
export function setQueryClient(qc) { _queryClient = qc }
// S-17: the sign-out cleanup reads it back to clear the cache. A getter rather than the
// useQueryClient hook, because AuthProvider also mounts in the public-site prerender,
// where there is no QueryClientProvider above it.
export function getQueryClient() { return _queryClient }

if (!supabaseUrl) {
  throw new Error('Missing required environment variable: VITE_SUPABASE_URL')
}
if (!supabaseAnonKey) {
  throw new Error('Missing required environment variable: VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'aspire-intelligence-auth',
    // typeof guard (not window?.) because `window` is an undeclared identifier
    // in Node, where the public-site prerender evaluates this module at build
    // time. Browser behavior is unchanged.
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    // Bypass Web Locks API entirely - prevents lock conflict errors
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
  realtime: {
    params: { eventsPerSecond: 10 },
    // Heartbeat keeps the WebSocket alive through idle timeouts and NAT expiry
    heartbeatIntervalMs: 30000,
    // Exponential backoff up to 10s between reconnect attempts
    reconnectAfterMs: (tries) => Math.min(tries * 1000, 10000),
  },
  global: {
    headers: { 'x-application-name': 'aspire-intelligence' },
    // A 12 second abort on every Supabase request. This was
    // written inline and was broken from the day it was written: it appended the signal
    // as a THIRD argument, which fetch ignores, so nothing was ever aborted. It lives in
    // its own module now because a closure inside an options object cannot be tested,
    // and this one needed to be.
    fetch: createTimeoutFetch(),
  },
})

// DEMO-MODE-1: installed here, on the line after the client exists, so no importer can
// ever hold an unfiltered client. Every read and write in src/ goes through this one
// object, which is why the boundary is one call rather than 121 edits. See
// src/lib/demoScope.js for what it covers and, just as importantly, what it does not.
installDemoScope(supabase)

// DEMO-MODE-2: the other half of the same boundary. The Supabase wrapper above covers
// every direct table read; this covers the /api/ endpoints the portals go through,
// which the wrapper cannot reach because they run on a server with no session. One
// header, added to same-origin /api/ requests only. See src/lib/demoFetch.js.
installDemoApiHeader()

export async function ensureHealthyConnection() {
  if (!supabase.realtime.isConnected() && !supabase.realtime.isConnecting()) {
    console.warn('[supabase] connection unhealthy, attempting reconnect')
    try {
      await supabase.realtime.connect()
    } catch (err) {
      console.error('[supabase] reconnect failed:', err)
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) {
    console.error('[supabase] auth session invalid:', error)
    throw new Error('Your session has expired. Please refresh the page to continue.')
  }

  return true
}

function reconnectIfNeeded() {
  if (!supabase.realtime.isConnected() && !supabase.realtime.isConnecting()) {
    supabase.realtime.connect()
    // Give the socket 1 second to establish, then flush stale query cache
    if (_queryClient) {
      setTimeout(() => _queryClient.invalidateQueries(), 1000)
    }
  }
}

if (typeof window !== 'undefined') {
  // Reconnect after laptop sleep, tab switch, or network restoration
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectIfNeeded()
  })
  window.addEventListener('online', reconnectIfNeeded)

  // Periodic health check: catches silent disconnects that don't trigger any browser event
  // (e.g. WebSocket dies while the tab is visible and the network appears online).
  // Runs every 30s to match heartbeatIntervalMs - if the heartbeat detects a dead
  // connection, this will catch and recover it within the same window.
  setInterval(() => {
    if (document.visibilityState === 'visible') reconnectIfNeeded()
  }, 30000)

  // Expose for console diagnostics: window.supabase.realtime.isConnected()
  window.supabase = supabase
}
