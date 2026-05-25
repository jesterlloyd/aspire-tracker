import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://chhubyaxdhqoosglnwsn.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoaHVieWF4ZGhxb29zZ2xud3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODEwODcsImV4cCI6MjA5MzE1NzA4N30.QL_HtV8gc2gP63Uq8Ehg7NAgjtDUYLqKbWRL7cNJg5g'

// Populated by setQueryClient() called from main.jsx so we can invalidate after reconnect
let _queryClient = null
export function setQueryClient(qc) { _queryClient = qc }

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'aspire-intelligence-auth',
    storage: window?.localStorage,
    // Bypass Web Locks API entirely — prevents lock conflict errors
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
    fetch: (...args) => {
      // 12 second abort timeout on every Supabase request
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      return fetch(...args, { signal: controller.signal })
        .finally(() => clearTimeout(timeout))
    },
  },
})

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
  // Runs every 30s to match heartbeatIntervalMs — if the heartbeat detects a dead
  // connection, this will catch and recover it within the same window.
  setInterval(() => {
    if (document.visibilityState === 'visible') reconnectIfNeeded()
  }, 30000)

  // Expose for console diagnostics: window.supabase.realtime.isConnected()
  window.supabase = supabase
}
