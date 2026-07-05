// CRON-OBS-1 - Shared, BEST-EFFORT / NON-FATAL cron heartbeat helper.
//
// Writes one cron_runs row per run: insert 'running' at start, update 'success'/'error' at
// finish. EVERY cron_runs DB call here is wrapped so ANY failure (connection/constraint/timeout)
// is caught, logged, and SWALLOWED - it must NEVER block, fail, delay, or alter a cron's real
// work. Each write is individually non-fatal: a failed start insert returns null (the finish
// updates then skip gracefully); a failed finish update leaves at worst a stale 'running' row
// (itself diagnostic). These helpers NEVER catch the cron's own errors - callers pass an
// already-caught error's message; the cron's error continues through its normal path unchanged.
//
// Callers must pass the cron's existing SERVICE-ROLE client (bypasses RLS). `details` must carry
// COUNTS/operational metadata only - never PII, emails, links, tokens, headers, or secrets.

// Short, sanitized error text: strip URLs (may carry tokens) and bearer tokens, collapse
// whitespace, truncate. Callers pass err.message - NOT stack traces.
function sanitizeError(text) {
  if (text == null) return null
  let s = String(text)
  s = s.replace(/https?:\/\/\S+/gi, '[url]')
       .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
       .replace(/\s+/g, ' ')
       .trim()
  return s.slice(0, 300)
}

// Insert a 'running' row. Returns the new row id, or null if the insert failed (non-fatal).
export async function startCronRun(db, cronName) {
  try {
    const { data, error } = await db
      .from('cron_runs')
      .insert({ cron_name: cronName }) // started_at + status='running' come from column defaults
      .select('id')
      .single()
    if (error) {
      console.error('[cron-heartbeat] start insert failed (non-fatal):', error.message)
      return null
    }
    return data?.id ?? null
  } catch (e) {
    console.error('[cron-heartbeat] start insert threw (non-fatal):', e?.message)
    return null
  }
}

// Update the run row to 'success' with finished_at + details (counts only). No-op if no runId.
export async function finishCronRunSuccess(db, runId, details = null) {
  if (!runId) return // start insert failed → nothing to update; skip gracefully
  try {
    const { error } = await db
      .from('cron_runs')
      .update({ status: 'success', finished_at: new Date().toISOString(), details: details ?? null })
      .eq('id', runId)
    if (error) console.error('[cron-heartbeat] finish(success) update failed (non-fatal):', error.message)
  } catch (e) {
    console.error('[cron-heartbeat] finish(success) update threw (non-fatal):', e?.message)
  }
}

// Update the run row to 'error' with a sanitized error_text (+ optional details). No-op if no
// runId. This records the failure for observability; the cron's own error is handled by the
// caller exactly as before - this helper never rethrows or swallows it.
export async function finishCronRunError(db, runId, errorText, details = null) {
  if (!runId) return
  try {
    const { error } = await db
      .from('cron_runs')
      .update({
        status: 'error',
        finished_at: new Date().toISOString(),
        error_text: sanitizeError(errorText),
        details: details ?? null,
      })
      .eq('id', runId)
    if (error) console.error('[cron-heartbeat] finish(error) update failed (non-fatal):', error.message)
  } catch (e) {
    console.error('[cron-heartbeat] finish(error) update threw (non-fatal):', e?.message)
  }
}
