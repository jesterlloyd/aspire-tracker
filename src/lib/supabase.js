import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://chhubyaxdhqoosglnwsn.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoaHVieWF4ZGhxb29zZ2xud3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODEwODcsImV4cCI6MjA5MzE1NzA4N30.QL_HtV8gc2gP63Uq8Ehg7NAgjtDUYLqKbWRL7cNJg5g'

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
