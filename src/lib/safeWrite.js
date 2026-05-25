import { ensureHealthyConnection } from './supabase'

/**
 * Wraps any Supabase write with a connection health check and a timeout.
 * Prevents the "save button stuck on Saving..." symptom caused by dead
 * WebSocket connections after extended app sessions.
 *
 * Layer 1 (ensureHealthyConnection): reconnects realtime and validates auth
 *   session before the write fires. Throws if the session is expired.
 *
 * Layer 2 (timeout): races the write against a 10-second deadline.
 *   If the write hangs, the timeout rejects with a retryable error message.
 *
 * Usage:
 *   const { data, error } = await safeWrite(
 *     () => supabase.from('table').insert(payload).select().single(),
 *     { name: 'add preceptor' }
 *   )
 *
 * For fire-and-forget (no await):
 *   safeWrite(() => supabase.from('table').update({...}).eq('id', id), { name: '...' })
 *     .catch(err => console.warn('[context] background write failed:', err.message))
 */
export async function safeWrite(writeFunction, options = {}) {
  const timeout      = options.timeout || 10000
  const operationName = options.name   || 'write'

  await ensureHealthyConnection()

  const writePromise   = writeFunction()
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`${operationName} timed out after ${timeout / 1000}s. The connection may be unstable. Please try again.`)),
      timeout
    )
  )

  return Promise.race([writePromise, timeoutPromise])
}
