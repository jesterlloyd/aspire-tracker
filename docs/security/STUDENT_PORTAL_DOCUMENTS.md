# Student Portal: Desktop Home and Secure Documents (ASPIRE-STUDENT-HOME)

This note documents the desktop Student Portal redesign and the new Documents
area (ID badge status and Certificate of Completion download), including the
authenticated download architecture and its current backend limitation.

## Desktop layout

- The portal workspace widens from 1020px to a 1200px max (side padding and
  per-card text measures keep line lengths readable). Mobile width is unchanged.
- A purposeful 12-column grid on desktop:
  - Row 1: Profile hero (full width)
  - Row 2: Placement (7) + Clinical hours (5)
  - Row 3: Next steps timeline (8) + Need help (4)
  - Row 4: Evaluations (4) + Shift logs (4) + Documents (4)
- At <=1000px the rows collapse to a two-up layout; at <=760px everything
  stacks to a single column. The mobile hero, sticky Log a Shift / Contact
  actions, and typography are preserved.
- The hero gains a larger desktop avatar (~104px; mobile stays 72px), a stronger
  name, and a compact CURRENT STAGE / NEXT panel derived only from
  `students.status`. The stage panel is hidden on mobile.

All stage, timeline, and next-step copy is derived only from reliable ASPIRE
status data (`src/lib/portalProgress.js`, `src/lib/portalDocuments.js`, both
pure and unit-tested). No copy promises or guarantees placement, employment, or
residency admission.

## Documents card

### ID Badge (status only; no download)

There is **no server-side badge artifact anywhere in the platform.** The
Cedars-Sinai ID badge is a physical credential issued off-platform; the only
digital rendering is a **staff-only, client-side canvas tool**
(`src/lib/badgeGenerator.js`) that draws print PNGs in the browser from public
templates plus the student's headshot and rotation dates. Nothing is uploaded
or stored. `students.badge_created` is a bookkeeping flag, not a file.

The Documents card therefore shows badge **status only**, from
`deriveBadgeStatus({ badgeCreated, status })`, and never renders a download
button:

- `Created` - `badge_created = true`.
- `Processing` - not created yet, status is Placed / Active Rotation / Completed.
- `Not yet available` - otherwise (pre-placement).

### Certificate of Completion

`deriveCertificateStatus({ certificate, status, evaluations })`:

- `Available` - a `certificates` row exists with `certificate_unlocked_at` and a
  `certificate_number`. Shows the number, year, and unlock date plus a
  **Download Certificate** button.
- `Locked` - no certificate row and rotation not complete
  ("unlocks after your rotation is complete"), or rotation complete with an open
  post-rotation evaluation ("complete your post-rotation survey to unlock").
- `Processing` (eligible) - rotation complete, post-rotation evaluation done, but
  the certificate row is not present yet ("being finalized").
- `Unavailable` - off-ramp status (Declined / Not Proceeding).

Each lock reason is drawn only from existing certificate logic (the Casey-Fink
post-rotation gate that issues the certificate). Certificate eligibility checks
are never bypassed.

## Authenticated download architecture

New endpoints (both GET, `Authorization: Bearer <jwt>`):

- `api/portal/download-certificate.js` - functional.
- `api/portal/download-badge.js` - authorization boundary only; always returns a
  sanitized `badge_unavailable` because no badge artifact exists (see above).

Both endpoints:

1. Authenticate the JWT (`verifyPortalCaller`).
2. Require an ACTIVE `student` role grant (`hasActiveRoleGrant`).
3. Resolve the linked student **server-side** from `user_student_links`
   (`getActiveStudentLinks`); revoked/expired links resolve to an empty set and
   are denied. The request body and query string contribute nothing to
   authorization - no `student_id`, `certificate_id`, or path is ever read from
   the client.
4. Use the service role only on the server.
5. Return sanitized errors (generic codes; never a stack trace, provider error,
   `auth_user_id`, `user_profile_id`, storage path, or bucket name).

The certificate PDF is generated on demand from the `certificates` row plus the
static template (`generateParticipationCertificate`) and streamed as an
attachment. **Nothing is stored, so there is no storage path, bucket, or signed
URL involved or returned.** The endpoint never creates a certificate, assigns a
number, touches `certificate_sequences`, or issues via RPC. Downloads happen via
an authenticated `fetch` + blob in the client, so the portal tab is never
navigated and no identifier appears in a URL.

- **No raw storage URLs.** Certificates are rendered, not fetched from a bucket.
- **No public bucket requirement.** This work does not depend on badge or
  certificate storage being public.
- **Wave F-2 unchanged.** `20260712000014_phase0b_wave_f2_student_files_private.sql`
  (the gated student-files privatization) is not modified or applied here.

## Backend limitation (open)

- **Downloadable ID badge:** none exists. If a downloadable badge is ever added,
  wire it into `api/portal/download-badge.js` by resolving the artifact from the
  already-resolved linked student (never the client) and streaming it or
  redirecting to a short-lived signed URL. Do not make any badge storage public,
  and do not modify Wave F-2 as part of that work.

## Pilot verification (non-mutating)

Authenticated as the pilot student portal account (do not create accounts, send
invitations, or send email):

1. Load `/portal` on desktop (>=1280px). Confirm the 12-column layout: hero,
   Placement/Hours, Next steps/Need help, then Evaluations/Shift logs/Documents.
2. Confirm the hero shows the larger avatar, the CURRENT STAGE / NEXT panel, and
   that Edit Profile, Log a Shift, and Contact ASPIRE work.
3. Confirm the Documents card shows the ID Badge status (no download button) and
   the Certificate status. If the certificate is Available, click Download
   Certificate and confirm the PDF downloads without navigating the portal tab.
4. In dev tools, confirm the download request is `GET /api/portal/download-certificate`
   with an `Authorization` header and **no** query string, and that no storage
   URL is present anywhere in the card.
5. Resize to 768px and 390px: confirm the tablet two-up and mobile single-column
   layouts, the preserved sticky actions, and no horizontal overflow.
6. Negative checks (expected denials, no data mutated): an unauthenticated
   request returns 401; a caller without an active student grant returns 403; a
   revoked student returns `certificate_unavailable` / `badge_unavailable`.
