# MESSAGES-LIFECYCLE-PHASE3-REACTIONS-DISCOVERY

Status: DISCOVERY AND RECOMMENDATION ONLY. Nothing in this document is
implemented. No SQL has been applied, no runtime code changed, no production
data touched. This is the decision record for whether and how ASPIRE Messages
gets reactions.

Recommendation up front: **GO, with a deliberately minimal scope.** Three
labeled reactions, one reaction per user per message, mutable (toggle and
replace), no email notifications, no unread or archive side effects, rendered
in the shared `MessageBubble` so all four surfaces get it at once. The
strongest justification is noise reduction: today the only way a student can
say "got it" or "thank you" is a full reply, which bumps `last_message_at`,
resurfaces archived threads, increments staff unread badges, and can trigger a
notification email. A reaction does none of that. If that noise is not
currently a felt problem, deferring is also safe: nothing else depends on this
phase.

## 1. What was inspected (2026-07-29, at a515213)

### 1a. Message model

- `public.messages` is append-only and immutable: id, conversation_id,
  author_profile_id, author_role (five-kind CHECK including 'preceptor',
  which has no portal surface yet), body (1 to 5000 chars), created_at.
  No edit or delete columns exist, and no application role holds UPDATE,
  DELETE, or TRUNCATE (verified in production, Phase 0 record).
- `conversation_events` is an append-only lifecycle log with a CLOSED
  event_type CHECK (created, status_change, assignment_change, resolved,
  reopened, flagged, participant_access_changed). Reactions are NOT a
  lifecycle event and should not extend this list.
- Precedent for mutable per-user state alongside immutable content already
  exists three times: `staff_conversation_reads`,
  `participant_conversation_reads`, and `message_conversation_visibility`
  (archive). All are RLS-enabled-no-policy, service-role-grant-only tables
  mutated exclusively through SECURITY DEFINER RPCs. Reactions fit this
  category exactly: they are per-user presentation state, not message content.
  The written append-only guarantee (`docs/MESSAGES_PHASE1_FOUNDATION.md`)
  covers `messages` and `conversation_events`; a reactions table does not
  weaken it, and the implementation must state that boundary in the migration
  header.

### 1b. Authorization boundaries

- Portal reads flow through caller-JWT SECURITY DEFINER RPCs gated by
  `my_message_conversation_ids()` (participant membership, `removed_at IS
  NULL`, live access checks). Staff reads flow through the staff-gated thread
  and list RPCs. Writes (start, reply, archive) are service-role-only RPCs
  reached through API endpoints that verify the caller first
  (`verifyPortalMessagesCaller`, staff auth) and pass the VERIFIED actor kind,
  never a client-supplied one.
- A reaction write must reuse this exact shape: endpoint verifies caller,
  service-role RPC re-authorizes (staff check for staff, participant
  membership for portal kinds) before touching a row. The archive RPC
  (`messages_set_conversation_archived`) is the template.

### 1c. Realtime behavior

There is no realtime. Both staff and portal poll at 30 seconds
(`ACTIVE_POLL_MS`, `PORTAL_ACTIVE_POLL_MS`) with visibility gating, via
react-query `refetchInterval`. Consequence: a reaction becomes visible to the
other party on their next poll, up to ~30s later. That is acceptable for an
acknowledgement gesture and requires no new infrastructure. The reactor's own
UI should update optimistically so their action feels instant.

### 1d. UI surfaces

- One shared bubble component renders messages everywhere:
  `src/components/shared/MessageBubble.jsx`, used by the staff
  `MessagesWorkspace` and the portal `PortalMessagesThread` (Student, Unit
  Leader, and Academic Partner all mount the same portal thread component).
  Adding a reactions row to `MessageBubble` covers all four surfaces in one
  place.
- Established interaction primitives: `RowActionsMenu` (portal-rendered
  popover, full keyboard and focus management), `.ptl-*` portal styles (never
  shared across components per the polish rule), badge tokens in
  `src/lib/badgeTokens.js`, focus-visible rings, 44px touch targets on
  mobile, and the sr-only span pattern already inside `MessageBubble`.

### 1e. Notification pipeline implications

- `message_notification_deliveries.event_type` is a CLOSED CHECK (five types
  in production: new_conversation, portal_reply, staff_reply,
  unit_leader_message, student_to_unit_leader_message). Emitting reaction
  emails would
  require a migration to that CHECK plus delivery-worker and template work,
  and would recreate exactly the noise reactions exist to remove.
- The no-body snapshot allowlist (`deliveryLogic.js`) and rate-limit
  infrastructure (`rateLimitUtil.js`, portal reply 429s) exist and are
  reusable; reactions need at most the rate limiter.

### 1f. Audit and retention interactions

- The purge runbook committed in Phase 2
  (`docs/security/MESSAGES_PURGE_POSTURE.md`) enumerates the complete FK web.
  A reactions table adds one row to that web. With `ON DELETE CASCADE` from
  `messages`, the existing purge transaction still succeeds (it deletes
  messages explicitly, cascading their reactions), but the purge document's
  FK table, impact preview, export, and verification blocks must be amended
  in the same implementation commit.
- Archive interplay is the sharpest correctness edge found: unread counts and
  the archived state are DERIVED from `conversations.last_message_at` and the
  read pointers. A reaction MUST NOT update `conversations.last_message_at`,
  MUST NOT advance or reset any read pointer, and MUST NOT resurface an
  archived thread. If a reaction bumped `last_message_at`, it would
  auto-unarchive threads and inflate unread badges, breaking the Phase 1
  archive contract. This must be pinned by static regression tests exactly
  the way the archive race-safety rules are pinned.

## 2. Recommended design

### 2a. Reaction set: three, labeled, ASPIRE-voiced

| Key | Glyph | Label (tooltip and screen reader) |
| --- | --- | --- |
| `acknowledge` | a check mark | "Got it" |
| `thanks` | a folded-hands or heart-hands glyph | "Thank you" |
| `celebrate` | a small confetti or star glyph | "Celebrate" |

Rationale: `acknowledge` and `thanks` are the two replies that actually
generate inbox noise today; `celebrate` covers offer, hire, and milestone
moments that are core to ASPIRE's arc. Deliberately excluded: a question
reaction (a question deserves a reply, not a glyph), negative or ambiguous
reactions (thumbs-down, emphasis), and any open emoji picker. The keys are a
database CHECK allowlist, so scope creep requires a migration, not a UI edit.
Glyph choices are an implementation-time design decision; the keys and labels
above are the contract. Every glyph always ships with its text label in the
accessible name; the glyph alone is never the meaning.

### 2b. Interaction pattern (not Apple's)

No long-press, no double-tap, no balloon overlaying the bubble.

- A quiet "Add reaction" ghost icon button sits in the bubble's meta row,
  visible on hover or focus-within on desktop and always visible on touch
  layouts. Activating it opens a small anchored popover (same portal-rendered,
  keyboard-complete pattern as `RowActionsMenu`) containing the three labeled
  reaction buttons; Escape closes, focus returns to the trigger.
- Existing reactions render as a chips row along the bubble's bottom edge:
  glyph plus count per reaction key. The caller's own reaction chip is
  visually distinct (filled versus outline) and is itself a toggle button, so
  removing or switching never requires reopening the popover.
- Accessibility: each chip is a `button` with `aria-pressed` for the caller's
  own state and an accessible name like "Thank you, 2 reactions, including
  yours"; the popover buttons carry the labels from 2a; all targets meet the
  44px mobile minimum; announcements piggyback on the existing sr-only
  pattern in `MessageBubble`.

### 2c. Semantics

- One reaction per user per message. Tapping the same reaction removes it;
  tapping a different one replaces it. This keeps the chips row bounded (at
  most three chips) and the data model a single row.
- Mutable, hard-delete on removal. Reactions are presentation state, like
  read pointers; they carry no audit obligation. No history table, no
  tombstones, no conversation_events entries.
- Who may react: any active staff member, and any conversation participant
  whose membership is live (`removed_at IS NULL`), in every conversation they
  can read. All four current roles (staff, student, unit_leader,
  academic_partner) react through the same RPC with their verified actor
  kind. Reacting to one's own message is permitted (harmless, and forbidding
  it buys nothing but edge cases).
- No notifications of any kind: no email, no unread increment, no
  `last_message_at` change, no archive resurfacing, no badge changes.
  Visibility is polling-only plus optimistic local update.

### 2d. Schema (drafted for the future migration, NOT to be applied now)

One table:

```
public.message_reactions (
  message_id   uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  reaction_key text NOT NULL CHECK (reaction_key IN ('acknowledge','thanks','celebrate')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, profile_id)
)
```

RLS enabled with no policies; grants to service_role only (SELECT, INSERT,
UPDATE, DELETE); index on `(message_id)` beyond the PK is unnecessary (the PK
leads on message_id). CASCADE from `messages` is deliberate: reactions never
outlive their message, and the Phase 2 purge transaction remains valid.

One write RPC, service-role only, following the archive template:

```
messages_set_message_reaction(
  p_actor_profile_id uuid,
  p_actor_kind       text,   -- 'staff' | 'student' | 'unit_leader' | 'academic_partner'
  p_message_id       uuid,
  p_reaction_key     text    -- allowlisted key, or NULL to remove
)
```

The RPC re-authorizes (staff check or participant membership on the message's
conversation), then upserts or deletes the caller's single row. It touches
NOTHING else: no conversations update, no read pointers, no events. Plain
row-level upsert semantics suffice; there is no cross-row derivation here, so
the FOR UPDATE serialization the archive phase needed does not apply.

Reads: new thread RPC versions `messages_staff_get_thread_v3` and
`messages_portal_get_thread_v3` (distinct names per the repo's PostgREST
overload rule), identical to v2 plus a per-message
`reactions: [{ key, count, mine }]` aggregation computed for the verified
caller. v2 stays in place for rollback, matching the v1/v2/v3 convention.

### 2e. API and client

- Staff: a new `react` action on the existing `api/messages-staff-manage.js`
  (the archive action's pattern).
- Portal: a new `POST /api/portal/messages-react` mirroring
  `api/portal/messages-archive.js` (verified caller, verified actorKind,
  service-role RPC). Apply the existing portal rate-limit utility with a
  generous bucket to blunt toggle spam.
- Both thread endpoints prefer v3 with PGRST202/42883 fallback to v2 and
  report `reactions_available` so the UI hides the affordance entirely until
  the Owner has applied the migration; deploy order stays safe in both
  directions, exactly like `archive_available`.

## 3. Risks

1. **Archive and unread contamination** (highest): any implementation that
   touches `conversations.last_message_at` or read pointers breaks Phase 1
   derivations. Mitigation: the RPC's scope is one table; static regression
   tests assert the migration never references `last_message_at` or the read
   tables inside the reaction RPC.
2. **Scope creep** toward an emoji picker or per-message threads. Mitigation:
   the CHECK allowlist and this document's recommendation stand as the
   decision record; expanding the set is a new Owner-gated migration.
3. **Perceived latency**: the other party sees a reaction up to 30s late.
   Mitigation: optimistic update for the actor; accepted for recipients
   (reactions are non-urgent by definition here).
4. **Purge runbook drift**: implementing without amending
   `MESSAGES_PURGE_POSTURE.md` leaves the FK web table incomplete. Mitigation:
   the amendment is a named deliverable of the implementation task, and the
   purge doc's own regression test should gain the new table.
5. **Professional-tone risk** of emoji in a clinical-program tool: mitigated
   by the three-item labeled set; there is no free-form input.
6. **Dead-feature risk**: if usage is negligible, three chips of UI dilute the
   bubble. Mitigation: chips render only when reactions exist; the add
   affordance is quiet; removal is a single migration plus UI deletion if it
   never earns its place.

## 4. Migration strategy and phased plan

One additive Owner-gated migration (table + write RPC + two v3 thread RPCs),
registered in `OWNER_SQL_GATE.md` with signature-exact verification blocks
(EXECUTE matrices, PUBLIC-grantee check, append-only 4c re-run) and inline
rollback (drop table, drop RPCs; v2 keeps serving). Runtime readiness probes
make apply-then-deploy and deploy-then-apply both safe.

Implementation phases, mirroring the archive task's successful shape:

- **Phase 3A (one task)**: migration draft + both endpoints + client flag
  plumbing + `MessageBubble` chips and popover + all four surfaces + static
  regression tests (allowlist, no-last_message_at rule, purge-doc amendment,
  a11y contract) + purge-doc FK amendment. Local commit, Owner gate, push,
  deploy, mocked-harness smoke of all surfaces.
- **Phase 3B (optional, later, data-informed)**: only if usage shows a real
  gap: consider surfacing a reaction indicator in inbox rows. Not designed
  here; do not build speculatively.

Estimated scale is comparable to or smaller than the archive phase: one
table, one write RPC, two read RPC versions, one shared component, no
notification work, no race-serialization work.

## 5. Go/no-go

**GO**, with the scope pinned to sections 2a through 2e, on these conditions:

1. Reactions never generate notifications and never touch unread, archive, or
   `last_message_at` derivations (non-negotiable, test-pinned).
2. The set stays at the three allowlisted keys unless a future Owner-gated
   decision expands it.
3. The purge posture document is amended in the same commit that creates the
   table.

Priority is honest-to-modest: this is a quality-of-life and noise-reduction
feature, not a correctness or safety need. It should queue behind any open
correctness work, but it is well-shaped, low-risk, and every pattern it needs
(per-user state table, versioned RPCs, readiness probes, kebab-adjacent
popover, mocked-harness smoke) already exists and is proven in production.
