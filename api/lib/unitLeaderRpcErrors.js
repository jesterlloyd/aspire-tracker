// api/lib/unitLeaderRpcErrors.js
//
// UL-PORTAL: map the SQLSTATE codes raised by the Unit Leader RPCs to HTTP.
//
// Mirrors the convention already used by api/lib/messagesApi.js so the two families
// behave identically: MS400 -> 400, MS403 -> 403, MS404 -> 404, MS409 -> 409.
//
// The mapper deliberately returns a STABLE, non-descriptive error key rather than
// the database message. A raw message can name a table, a column, or a constraint,
// and an out-of-scope caller should learn nothing about what exists.

const STATUS_BY_CODE = {
  MS400: 400,
  MS403: 403,
  MS404: 404,
  MS409: 409,
}

const ERROR_BY_CODE = {
  MS400: 'invalid_request',
  MS403: 'forbidden',
  MS404: 'not_found',
  MS409: 'conflict',
}

/** HTTP status for a Supabase RPC error. Unknown codes fail closed to 500. */
export function mapRpcStatus(err) {
  return STATUS_BY_CODE[err?.code] ?? 500
}

/** Stable error key for a Supabase RPC error. Never the raw database message. */
export function mapRpcError(err) {
  return ERROR_BY_CODE[err?.code] ?? 'internal_error'
}
