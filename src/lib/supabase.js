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

  // Expose for console diagnostics: window.supabase.realtime.isConnected()
  window.supabase = supabase
}
