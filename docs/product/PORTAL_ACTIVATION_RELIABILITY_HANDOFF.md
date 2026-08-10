# Portal Activation Reliability (PORTAL-ACTIVATION-RELIABILITY-1)

Status: **LEDGER MIGRATION APPLIED 2026-08-03 (V1-V7 PASSED). Production
configuration confirmed. App fix committed locally; release pending.**

> ## ⚠️ TTL history note: the durations in this document are HISTORICAL
>
> This handoff records the state of production on **2026-08-03**, when the
> Supabase Auth Email OTP expiration (`mailer_otp_exp`) was **3600 seconds
> (1 hour)**. Every mention of a 1-hour activation link below describes that
> configuration.
>
> **On 2026-08-10 the Owner set `mailer_otp_exp` to 86400 seconds (24 hours)
> in the production Supabase dashboard. That is the canonical value now.** The
> 3600-second figure is retained here only as the record of what was true
> during this work, and must not be read as current configuration.
>
> The user-facing duration is stated in exactly one place in code,
> `lib/server/activationLifetime.js`, which carries the full configuration
> history. The runtime authority is the Supabase dashboard, not this repository
> and not this document.

## Background

The 2026-08-03 read-only audit of the Academic Partner activation reports
(Alyssa Manlangit, Lucy Van Otterloo) confirmed four defects:

1. Invitation emails embedded the raw Supabase `/auth/v1/verify` URL, whose
   single-use token is consumed on GET, so email-security link scanners could
   burn a fresh link before the recipient clicked.
2. Any newer link of the same type silently invalidated earlier emailed links.
3. The email presented the months-away access-grant date as the activation
   deadline while the token's real lifetime was far shorter (one hour at the
   time of this work; see the TTL history note below for the current value).
4. An existing auth user without profile linkage hit a resend branch that
   provisioned access and reported success while emailing nothing.

## The fix (this commit)

- Scanner-safe activation: emails carry an ASPIRE-owned URL built from the
  token hash (`/auth/activate?token_hash=…&type=invite|recovery`); the page
  verifies ONLY on the explicit "Activate my account" click
  (`supabase.auth.verifyOtp`, one call site; page load makes zero verify
  requests). Expiry and single-use semantics unchanged; no token, hash, or
  link is ever logged or stored.
- Corrected branching: the unlinked-auth-user state mints a real
  recovery-type link; success messaging never claims a send that did not
  happen; existing identities, profiles, grants, and scopes are always
  preserved (no SQL cleanup, ever).
- Self-service expired page: "Email me a new link", "Set or reset password",
  and "Go to sign in", with non-enumerating wording.
- Truthful email copy: the activation link is stated with its real duration
  (1 hour at the time of this release, matching the then-current Email OTP
  expiration of 3600 seconds; superseded 2026-08-10, see the TTL history note
  below), single-use, and superseded by newer links; portal-access expiration
  is its own separate sentence.
- Privacy-safe diagnostics: the `portal_invitation_events` ledger plus the
  authenticated `/api/portal-activation-event` endpoint; every writer is
  strictly allowlisted and fully defensive.

## Production confirmations (Owner, 2026-08-03)

- `supabase/migrations/20260804000000_portal_invitation_events.sql` was
  applied manually in one transaction. **V1 through V7 all passed**: RLS
  enabled; the `is_active_owner_or_admin` helper present; exactly one policy
  (SELECT, authenticated, Owner/Admin-gated) with the expected definition;
  table privileges exactly as declared (authenticated read-only,
  service_role append-only, anon nothing); identity-sequence usage
  service-role only; all data-shape constraints present; zero secret-shaped
  columns.
- Email OTP expiration confirmed at **3600 seconds** *as of this release*:
  activation links lived 1 hour, and the invitation copy stated exactly that.
  **This value was superseded on 2026-08-10** (see the TTL history note below);
  it is recorded here as the state at the time of this work, not as current
  configuration.
- Redirect allow-list confirmed sufficient: `https://aspireintelligence.app/**`
  covers both `/auth/activate` and `/auth/reset-password`. No configuration
  change required.

## Remaining owner actions

- Approve running the read-only reporter diagnostics
  (`db/audit/portal_activation_diagnostics.sql`, D1-D7; fill in Lucy's address
  of record first) to pin the historical timelines.
- Approve the release of the app commit, then live-QC the activation states
  on production with mocked sessions (confirm step, explicit-click verify,
  expired self-service, recovery form).

## Ops guidance

SQL cleanup is retired as a recovery practice. Revocation never deletes
identities; re-inviting reissues a fresh link by design; and recipients can
self-serve a new link from the expired page. The invitation ledger makes any
future report answerable with one query (see D7 in the diagnostics file).
