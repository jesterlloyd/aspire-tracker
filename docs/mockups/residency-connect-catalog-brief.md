# Residency Portal: Connect and Catalog (TA-CONNECT-1)

Mockup: `residency-connect-catalog.html` (four frames). Owner decisions, 2026-10-07:

- Talent Acquisition (HR) may message anyone with a portal and Messages: the ASPIRE team, unit
  leaders, alumni.
- A message to a unit leader or an alumnus is **private**: only HR and that person see it. A message
  to the ASPIRE team goes to the shared team inbox, as every portal's does today.
- Outreach works like the staff composer: recipients from Contacts or typed, CC, sent through Resend.
- Catalog is **not** part of Connect. It is the staff Catalog app, ported, with its own header icon.
  HR browses, opens, sends resources, sends forms and sends for signature. Managing items stays with
  the ASPIRE team.

## What exists today (from the code)

- Every portal conversation is "one portal person and the ASPIRE team". Staff are never participant
  rows; the team side is implicit, and the staff inbox (`messages_staff_list_conversations_v5`,
  `messages_staff_needs_reply_count_v2`) lists every conversation with no filter.
- A unit leader can already start a direct thread with a student (two participant rows). Those
  threads appear in the staff inbox today. They are NOT private.
- `talent_acquisition` is excluded from messaging on purpose (20260911000000 line 26): the role and
  scope CHECKs on the messages tables do not list it, and `verifyPortalMessagesCaller` does not
  admit it.
- Outreach's endpoints (`connect-send-direct-email`, `connect-send-bulk-message`) and every Catalog
  endpoint (`catalog-*`, `form-staff`, `sig-staff`) are Owner/Admin only, and both screens read
  `contacts`, `students` and `catalog_resources` straight from the browser, which RLS refuses for a
  portal account.

## Build, in three phases (each its own push)

**Phase 1: Messages.** One Owner-gated migration:
- `talent_acquisition` joins the participant, author and created-by role CHECKs, with scope
  `general` (like NE&L).
- A conversation gets an explicit `visibility` (`team` default, `private`), and the staff list,
  needs-reply count, unread count and thread read skip `private` rows. A private thread has exactly
  two participants (the existing two-participant trigger already enforces it).
- `message_participant_can_read/send` admit a TA participant on a private thread while the TA grant
  is active, and the counterpart while their own portal access is active.
- New start RPC: TA opens a private thread with one unit leader (active `unit_leader` grant) or one
  alumnus (Completed, on a residency roster, with an active Student Portal link).
Then: `verifyPortalMessagesCaller` admits TA last; `api/portal/ta-messages-start.js`; the New Message
drawer gets the To choice for TA only; the inbox and thread show a Private tag; the unit leader and
student inboxes show and answer these threads; the email notice says a message is waiting, with the
portal link. The Residency Portal mounts `PortalMessagesWorkspace` in its Connect and the utility
layer's launcher.

**Phase 2: Outreach.** No SQL. Portal endpoints that call the SAME send code with a TA caller:
recipients are proved on the server (the NE&L contacts directory HR already reads, the alumni on a
residency roster they can see, or a typed address), CC as staff have it (send-to-one, up to 5),
From noreply as "<name> via ASPIRE", reply-to the sender, `notification_log` rows tagged with the
sender. The composer reads its lists from those endpoints instead of the browser. Sent history shows
HR's own sends.

**Phase 3: Catalog.** Probably one small migration (RLS read of active `catalog_resources` and
`catalog_categories` for a TA grant, or a read endpoint instead: decided in the build).
`/portal/residency/catalog` and a header icon beside Connect; the Catalog's endpoints admit TA for
browse, open, send, send form, people and remind; manage actions stay Owner/Admin. Signatures stay
behind `catalog.signatures`: HR sees Send for signature only when the flag admits them.

## Open questions

1. **Unit leader to student direct threads** appear in the staff inbox today. Keep that as is (only
   HR's are private), or make those private too?
2. **May a unit leader or an alumnus START a private thread with HR**, or only answer one HR opened?
   The mockup assumes answer only.
3. **Signatures for HR when the flag is on**: the flag's `on` state admits Owner and Admin. Add HR to
   `on`, or a separate state?
