// api/lib/taMessagingCapability.js
//
// TA-MESSAGES-1: is the private-messages migration (20261114000000_ta_private_messages.sql)
// applied? Proved by reading the column it adds. Read-only, service role, fails closed on any error,
// and never cached, so Talent Acquisition's Messages switches on the moment the Owner applies it.
// Before it, the private-message endpoints answer 409 not_enabled and the Residency Portal's
// Messages shows the prepared state.
export async function isPrivateMessagingCapable(db) {
  if (!db) return false
  try {
    const { error } = await db.from('conversations').select('visibility').limit(1)
    return !error
  } catch {
    return false
  }
}
