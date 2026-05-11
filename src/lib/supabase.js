import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://chhubyaxdhqoosglnwsn.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoaHVieWF4ZGhxb29zZ2xud3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODEwODcsImV4cCI6MjA5MzE1NzA4N30.QL_HtV8gc2gP63Uq8Ehg7NAgjtDUYLqKbWRL7cNJg5g'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'aspire-intelligence-auth',
    // Override Web Locks API to bypass lock conflict error.
    // Safe for a single-tab internal application.
    lock: async (name, acquireTimeout, fn) => {
      return await fn()
    },
  },
})
