# Evaluation Server-Side Modules

## Server-only boundary

These modules live under `lib/server/evaluation/` and are never imported by any file under `src/`. They run only inside Vercel serverless functions (`api/evaluation-token-validate.js` and `api/evaluation-submit.js`). Importing any of these modules from browser-side code is a design error and will cause build failures or runtime crashes in the browser environment.

## Pepper secrets

`EVALUATION_TOKEN_PEPPER` is the HMAC key used to hash raw survey tokens before they are stored in `evaluation_assignment_tokens.token_hash`. This secret must remain stable across deployments for the lifetime of any outstanding token. Rotating `EVALUATION_TOKEN_PEPPER` invalidates all outstanding survey tokens immediately; any student holding a valid link will receive an invalid response upon next visit.

`EVALUATION_RATE_LIMIT_PEPPER` is the HMAC key used to derive per-IP rate-limit bucket keys. Raw or truncated IP addresses are never stored; only the HMAC hex digest is written to `evaluation_rate_limit_counters.bucket_key`. Rotating `EVALUATION_RATE_LIMIT_PEPPER` resets all rate-limit bucket history and is operationally safe; it does not affect outstanding tokens or submitted responses.

## Required Supabase configuration

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are validated at module load by `supabase_admin.js`. If either variable is missing or empty, the module throws a named startup error rather than deferring the failure to a later request. The service-role key is never logged, never returned to clients, and is never imported from any file under `src/`. All evaluation endpoint database operations use this single exported client.

## Raw-token hygiene

Raw survey tokens appear only in transit: as a transient variable during token generation, and in the URL fragment that the future public survey page reads from the browser address bar. Raw tokens are never persisted in any table column, never included in any log line, and never returned in any API response body. Only the HMAC-SHA256 hex hash (`token_hash`) and the first eight characters of that hash (`token_hash_prefix`) are ever stored or logged for audit and support correlation.

## Logging policy

- Endpoint code never logs request bodies.
- Endpoint code never logs validation error arrays.
- Endpoint code never logs response bodies.
- If a log line is emitted at all, it may include only: request method, request path, a generic outcome label (one of: `success`, `400`, `410`, `422`, `429`, `500`, `405`, `validation_failed`, `slug_unsupported`, `slug_consistency_failure`, `validate_rpc_error`, `submit_rpc_error`, `lookup_error`, `unhandled`), and the hash prefix when one is available.
- No log line may contain raw tokens, secrets, student-identifying data, or specific validation error contents.

## No permanent IP or user-agent storage

`ip_submitted`, `user_agent`, `ip_used_first`, and `user_agent_used_first` remain `NULL` in the schema for the MVP. IP values are used at request time for rate-limit bucket-key derivation under HMAC, then discarded. No IP address or user-agent string is written to any table row.

## Preview-only QA boundary

QA fixtures, synthetic tokens, and the `EVALUATION_QA_MODE='1'` flag exist only inside the Supabase Preview Branch `evaluation-stage2b-qa` and the Vercel Preview environment scoped to the `feature/evaluation-stage-2b` branch. Production never sees the QA instrument slug (`qa_test_instrument`), the QA mode flag, or the Preview pepper values. The production Casey-Fink registry row remains at `permission_status = 'pending'` during QA; it is never authorized solely for QA purposes.

## Endpoint test checklist (for manual Preview QA)

Run these test cases against the Preview deployment after the feature branch is auto-deployed:

- **Happy-path validate** — valid raw token against a sent assignment with an authorized QA instrument; expect 200 with survey context including `firstName`, `instrumentSlug`, `sections`, `requiredItemCodes`, `optionalItemCodes`.
- **Happy-path submit** — valid raw token with a well-formed 60-item QA response payload; expect 200 with `{ success: true, submittedAt: ... }`.
- **Repeat validate after submit** — re-use the same raw token after successful submission; expect 200 with `{ completed: true }`.
- **Repeat submit after submit** — re-submit the same token; expect 410 generic.
- **Malformed token** — send a token that fails `isWellFormedRawToken` (e.g. too short, wrong charset); expect 400.
- **Unknown token** — send a well-formed 43-character base64url string that matches no `token_hash`; expect 410 generic.
- **Expired assignment** — token linked to an assignment whose `expires_at` has passed; expect 410 specific ("response window has closed").
- **Revoked assignment** — token linked to a revoked assignment; expect 410 generic.
- **Validate with unsupported slug** — token linked to an instrument not in the allowlist (QA mode off, or slug not recognized); expect 422 without `opened_at` being set.
- **Submit with unsupported slug** — same condition on the submit endpoint; expect 422.
- **Response with out-of-range S1 value** — submit with one S1 item set to `5`; expect 422 generic.
- **Response missing a required S2 item** — submit with S2_Q03 absent; expect 422 generic.
- **Response with S4_COMMENT over 2000 characters (trimmed)** — expect 422 generic.
- **Submit with qa_test_instrument slug when QA mode is enabled** — should succeed if assignment and token are valid.
- **Rate limit** — send 21 validate requests from the same IP within 60 seconds; the 21st should return 429. Prerequisites: all 21 requests use tokens unknown to the database so each reaches rate-limit check; alternatively, use a scripted loop against a single valid or invalid token.

Token generation for QA (one-time, Owner-only): run the `generateToken()` export from `lib/server/evaluation/tokens.js` in a local Node invocation with the Preview `EVALUATION_TOKEN_PEPPER` set, then insert the resulting `hash` and `hashPrefix` into the Preview Branch alongside a matching assignment row.
