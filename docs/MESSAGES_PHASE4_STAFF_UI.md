# ASPIRE Messages, Phase 4: ASPIRE Connect Staff Interface

Phase 4 builds the staff-facing ASPIRE Messages interface inside ASPIRE Connect,
on top of the Phase 3 APIs already deployed in production. It is delivered in two
halves.

- Phase 4A (this document): the secure lookups, shared client and utilities, and
  the staff inbox component. Built, tested, and deployed as DORMANT code.
- Phase 4B (not started): Connect tab integration, the thread workspace, read
  state, polling, the new-conversation dialog, the reply composer, management
  controls, and responsive and accessibility refinements.

## Why the Messages tab is not exposed yet

An incomplete Messages feature must not reach production users. Phase 4A
therefore ships the inbox as dormant code: it is not imported by any routed page.
`src/pages/Connect.jsx` is byte-for-byte unchanged, `VALID_TABS` still contains
only `contacts`, `outreach`, and `broadcasts`, the bare `/connect` redirect is
untouched, and `/connect/messages` resolves to the existing default rather than a
half-built workspace. No feature flag was introduced. Tests assert all of this,
so the guarantee cannot regress silently.

Phase 4B mounts the component once the full operational workspace exists.

## Files

- `api/messages-staff-options.js`: the two narrow lookups.
- `src/lib/messages/messagesConstants.js`: categories, statuses, labels, unread
  formatting, Intl timestamps, safe error mapping.
- `src/lib/messages/inboxState.js`: filter serialization, cursor handling,
  duplicate-safe page appending, query identity, debounce.
- `src/lib/messages/messagesApiClient.js`: the authenticated browser client.
- `src/components/connect/messages/MessagesInbox.jsx`: the staff inbox.
- `test/messagesPhase4aInbox.test.mjs`: 49 pure and static guards.

## Assignment-options endpoint

`GET /api/messages-staff-options?kind=assignees`. Active Owner or Admin only,
reusing the Phase 3 `verifyStaffCaller`, which never uses `is_staff()` (so
interviewer and viewer are excluded) and denies an inactive Owner or Admin.

It selects only `id, full_name, role, is_active`, filters to `role in (owner,
admin)` and `is_active !== false`, and returns exactly four fields:
`profile_id`, `display_name`, `role`, `is_current_user`. It returns no email, no
`auth_user_id`, no permission internals, no role-grant history, and no student
records. Results are bounded at 50, which comfortably covers the Owner/Admin
list. Identity is `user_profiles.id`, preserving the three-identity model.

## Participant lookup decision

`api/list-portal-access.js` was inspected and **rejected** for this purpose. It
is a portal-access admin view: it returns all role grants including historical,
revoked, and expired ones, across all portal roles (unit_leader and
academic_partner included), together with emails, `last_login_at`, and unit and
school scope history. That is a general directory, not the narrow lookup this
phase requires, and reusing it would over-expose data.

`GET /api/messages-staff-options?kind=participants&q=` is the smallest dedicated
alternative. Same active Owner/Admin gate. It returns active Student Portal
participants only, applying the canonical active predicate (`revoked_at IS NULL`,
`starts_at <= now`, `expires_at IS NULL OR expires_at > now`), requiring an active
`user_student_links` row and an active profile. It never queries any other portal
role. Search is bounded (80 characters, minimum 2 to filter) and results are
capped at 20. Fields: `participant_profile_id`, `student_id`, `display_name`, a
single disambiguating `context` (student school), and `access_active`. The
student read is `id, school` only. Phase 4B consumes it; Phase 4A does not mount
a picker.

## API client

`messagesApiClient.js` follows the existing Connect convention: the Supabase
access token from the session, sent as a bearer token. It calls only the deployed
Phase 3 endpoint paths, never a Supabase RPC directly, and never touches
service-role credentials. Query values that are undefined, null, or empty are
dropped so "no filter" never becomes the string `null`. `AbortSignal` is
supported throughout.

A hard guard, `assertNoRoutingFields`, throws if a caller ever tries to send
`p_delivery`, `recipient_email`, `recipient_kind`, `recipient_profile_id`,
`event_type`, `idempotency_key`, a snapshot field, or `cta_path`. The trusted
server owns all notification routing and delivery construction. Errors carry only
an HTTP status and a short safe code; the client logs nothing.

## Inbox architecture

`MessagesInbox` takes `selectedId`, `onSelect`, `meProfileId`, `refreshKey`, and
an injectable `api`. Data flows through React Query, the app's existing
convention: `useInfiniteQuery` for the cursor-paginated list and `useQuery` for
the small cached assignee list. React Query owns request cancellation, stale
responses, and loading flags, so the component holds no manual request state.

Row priority is participant identity, then subject, then latest activity, then
unread, then operational status. Each row also carries category, assignee,
follow-up, and a portal-access badge when access is inactive. Previews render as
plain text; there is no `dangerouslySetInnerHTML`, no Markdown, and no HTML
parsing. Staff email is never displayed.

## Search

A debounced search input at 300 milliseconds, inside the approved 250 to 400
range, so there is no request per keystroke. It searches only the authorized
subject and participant fields the staff list endpoint exposes; message bodies
are never searched. Clearing restores the unfiltered list. A search change alters
the query identity, which restarts pagination.

## Filters and a known limitation

Status (All, Open, Waiting, Resolved), Assignee (All, Me, each active
Owner/Admin), Category (All, each approved category), and Follow up (All,
Flagged, Not flagged). All are labeled native selects, so keyboard use and
accessible naming are inherent. One Reset filters action clears filters and
search. Filters are reflected in the server request and preserved while paging.

**Unassigned and Uncategorized are not offered in Phase 4A.** The deployed
`messages_staff_list_conversations` RPC treats a null `p_assignee` or
`p_category` as "no filter", so it cannot express "is null". Client-filtering a
partial server page would corrupt cursor pagination and is explicitly disallowed,
and the RPC lives in an applied, locked migration. `serializeInboxQuery`
therefore returns these two selections in a `clientOnly` result instead of
sending a bogus parameter, and the inbox omits the options rather than shipping a
dead control. Enabling them needs a small corrective migration (a nullable-aware
predicate or a dedicated filter parameter) and is a Phase 4B decision for the
Owner.

## Pagination

The Phase 3 cursor model (`last_message_at` with a conversation id tie-breaker),
via Load more. The server limit is 25 with a hard cap of 100. Pages are flattened
through `appendPage`, which drops any row an overlapping page repeats and never
re-sorts, so server ordering stays authoritative. A malformed or partial cursor
normalizes to null rather than producing a bad request. Load more is disabled
while fetching.

## Unread presentation

Unread count is shown compactly (1 through 99, then 99+). Unread is never
conveyed by color alone: a row uses heavier participant and subject weight, a
dot, a count badge, and screen-reader text such as "3 unread messages". Phase 4A
does not write read pointers and never optimistically clears unread.

## Loading and error behavior

A restrained skeleton with an `aria-busy` region and a `role="status"` label for
the initial load, a separate Load more state, and three distinct empty states:
"No ASPIRE Messages yet.", "No conversations match these filters.", and "No
conversations match your search." Read errors map to safe copy with a keyboard
accessible Retry. Raw API errors, SQLSTATE, and provider text are never shown.

## Privacy controls

No message body, preview, draft, authorization header, or raw response is logged.
Nothing is written to localStorage or sessionStorage. No analytics or telemetry
was added. Previews are plain text only. Staff emails are never rendered.

## Accessibility

Labeled search and filters, native selects for keyboard operation, `aria-current`
on the selected row, accessible unread text, `aria-hidden` on decorative icons, a
`role="status"` loading announcement, 44 pixel minimum row touch targets, and
`title` attributes on truncated participant, subject, preview, and timestamp
content.

## Responsive foundation

The inbox is a fluid column with wrapping filters, truncating rows, and no
horizontal scrolling, so it is usable from phone to desktop width. The mobile
list-to-thread transition is Phase 4B, since it requires the thread workspace.

## Phase 4B integration contract

Phase 4B should: add `messages` to `VALID_TABS` and the tab bar between Outreach
and Automations (leaving the Automations `/connect/broadcasts` slug untouched),
route it at `/connect/messages`, and render `MessagesInbox` in the left column
with `selectedId`, `onSelect`, `meProfileId`, and the existing `refreshKey`. It
should gate the tab on an active Owner or Admin (`['owner','admin'].includes(role)`
plus `is_active !== false`), remembering that client hiding is not a security
boundary. The thread, composer, and management controls should reuse the typed
client functions already defined here (`getStaffThread`, `markStaffRead`,
`startStaffConversation`, `replyStaffConversation`, `manageStaffConversation`,
`listParticipantOptions`), which already carry the routing-field guard and error
mapping.

## Known limitations

- Unassigned and Uncategorized filters are unavailable pending a corrective
  migration (above).
- The inbox is dormant: not mounted, not routable.
- No read pointers, polling, thread, composer, or management actions in Phase 4A.
- Component tests are pure and static-source, matching the repository stack; no
  testing-library or jsdom was introduced.
