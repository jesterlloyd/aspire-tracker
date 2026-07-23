# Unit Leader Portal Utility Layer Handoff

## Corrected Architecture

The Unit Leader portal utility layer now mirrors the main-app corner-panel model.

Shared feedback presentation:

- `src/components/shared/SharedFeedbackPanel.jsx`
- consumed by `src/components/FeedbackPanel.jsx`
- consumed by `src/portal/PortalFeedbackPanel.jsx`

Unit Leader corner utilities:

- `src/portal/PortalUtilityLayer.jsx`
- `src/portal/PortalTeamMessagesPanel.jsx`
- `src/portal/usePortalDialogFocus.js`

`PortalShell` still accepts a `utilityLayer` prop and renders it once below the portal header. `PortalApp` supplies that prop only in the Unit Leader branch with `portalRole="unit_leader"` and `portalType="unit_leader"`.

No utility layer is mounted inside `UnitLeaderPortal.jsx`, `StudentPortal.jsx`, or `AcademicPartnerPortal.jsx`.

## Matched Corner Design

The old white `Feedback / Bug` and `Messages` pill buttons were retired.

Normal Unit Leader portal pages now show:

- lower-left circular magenta feedback launcher
- lower-right circular ASPIRE Team message launcher

The launchers have comparable size, elevation, placement, focus treatment, and tooltip/accessibility behavior. Opening one corner panel hides the other utility so the panels never overlap.

## Shared Feedback UI

The lower-left utility reuses the canonical main-app feedback experience:

- circular magenta launcher
- anchored panel above the launcher
- `Send a Message` heading
- supporting description
- category cards
- message area
- contextual metadata note
- close control
- primary send action

The visible categories remain:

- `Bug Report`
- `Feature Idea`
- `Question`

The main app keeps its Outlook compose transport through `src/components/FeedbackPanel.jsx`.

The Unit Leader portal uses the same shared UI through `src/portal/PortalFeedbackPanel.jsx`, but submits to the durable portal feedback backend:

```text
POST /api/portal/feedback-submit
```

Category mapping:

- `Bug Report` -> backend `type: "bug"`
- `Feature Idea` -> backend `type: "feedback"`
- `Question` -> backend `type: "feedback"`

The selected category is preserved in the submitted message text. Bug reports collect expected behavior, actual behavior, reproduction steps, and viewport dimensions required by the backend.

## Feedback Payload Privacy

The feedback payload sends only:

- `request_id`
- `type`
- `message`
- `pathname`
- `section`
- `build_sha`
- `environment`
- bug-only `expected_behavior`
- bug-only `actual_behavior`
- bug-only `reproduction_steps`
- bug-only `viewport_width`
- bug-only `viewport_height`

The feedback payload does not include profile id, user id, role, unit, school, student id, preceptor id, actor profile id, email, message thread id, message content, evaluation content, user agent, IP address, raw errors, access tokens, screenshots, or attachments.

The backend remains authoritative for identity, role, and scope.

## Request-ID Lifecycle

The Unit Leader feedback adapter uses the shared request-ID helper in `src/lib/portalFeedbackApiClient.js`.

One stable request ID is retained across failed attempts and cleared only after success. Duplicate submit is blocked synchronously in the shared panel before React rerenders.

`409` request-ID conflicts and `429` rate limits produce safe user-facing messages. A saved submission with pending email delivery is treated as successful receipt.

## Docked ASPIRE Team Messages Panel

The lower-right utility is no longer a shortcut that navigates immediately to `/portal/messages`.

It is now a circular message-bubble launcher with the accessible name:

```text
Open messages with the ASPIRE Team
```

Opening it displays a docked panel anchored to the lower-right, following the Keith panel interaction pattern without using Keith identity or AI behavior.

Panel structure:

- header with `ASPIRE Team`
- supporting label `Messages`
- close control
- scrollable conversation history
- composer pinned inside the panel
- live-region announcements
- `Open full Messages` action

The full `/portal/messages` workspace remains available. The docked panel’s `Open full Messages` action navigates there.

## Messages Reuse

The docked panel reuses the existing portal Messages system:

- `src/lib/messages/portalMessagesApiClient.js`
- `PortalMessagesThread.jsx`
- `PortalReplyComposer.jsx`
- shared React Query keys:
  - `portal_messages_list`
  - `portal_messages_unread`
  - `portal_messages_thread`

It does not mount another unread polling hook. It uses the unread count owned by `PortalApp` and invalidates the shared unread/list caches after read and send actions.

The panel selects the existing ASPIRE Team conversation from the authorized portal message list. It marks read through the existing mark-read API and sends replies through the existing reply API.

For an initial ASPIRE Team message, the panel uses the existing Unit Leader message-start adapter path with `destination: "aspire"`. It does not introduce a new backend, table model, or browser-side direct table access.

## Overlay And Keyboard Suppression

Floating utilities hide when modal, drawer, bottom sheet, assignment manager, or other full-screen interactions are open.

On narrow viewports, launchers are suppressed while text inputs, textareas, or selects have focus unless the active corner panel itself owns the focus. Hidden controls are not rendered as focusable controls.

The desktop optimization notice behavior is unchanged.

## Responsive Behavior

Desktop/tablet:

- feedback panel docks above the lower-left magenta launcher
- ASPIRE Team Messages panel docks above the lower-right message launcher
- panels follow the Keith-style width and responsive height proportions

Phone/narrow viewports:

- launchers clear the Unit Leader bottom navigation
- panels become near-full-width bottom sheets
- safe-area insets are respected
- horizontal overflow is avoided
- composer remains inside the panel

## Accessibility

Both shared panels provide:

- keyboard activation
- visible focus states
- Escape close
- focus restoration to the initiating launcher
- accessible names
- 44px-or-larger launch targets
- live-region success/error announcements
- labelled form controls
- no focusable controls behind hidden panels

The Messages panel labels its conversation history and composer, and uses restrained live announcements for newly sent or loaded message state.

## Unchanged Boundaries

This correction did not:

- run SQL
- add or alter migrations
- create a new Messages backend
- add Academic Partner Messages
- activate Student utilities
- activate Academic Partner utilities
- add attachments or screenshots
- change sender or Reply-To behavior
- push or deploy

## Verification

Recommended verification:

- `node --test test/unitLeaderPortalUtilityLayer.test.mjs`
- `node --test test/portalFeedbackBackendFoundation.test.mjs`
- portal Messages tests
- Unit Leader portal tests
- changed-file ESLint
- `node --test test/*.test.mjs`
- production client/SSR build
- `git diff --check`

Live database verification is not part of this pass.

## Live QC Plan

Manual QA matrix:

- widths: 320px, 375px, 430px, 760px, 768px, 834px, 1023px, 1024px, 1280px
- portrait and landscape
- 200% browser zoom
- reduced viewport height
- software keyboard open
- every Unit Leader modal, drawer, sheet, and assignment-manager flow
- Messages list route
- Messages thread route

Confirm:

- notice appears below 1024px, not at 1024px or above
- notice is absent on Messages routes
- `Continue anyway` persists for the current account and role
- launchers do not cover final rows, pagination, or action buttons
- launchers hide behind overlays and during narrow text input
- opening feedback hides the message launcher
- opening messages hides the feedback launcher
- feedback retry preserves text
- rapid feedback submit cannot duplicate
- lower-right launcher opens the docked panel, not the full Messages route
- `Open full Messages` navigates to `/portal/messages`
- replies refresh thread/list/unread state through existing APIs

## Future Extension Points

Student Portal can later pass `enabled` and Student-specific reporter context into the same utility layer after product approval.

Academic Partner Portal can later use the same feedback utility once that portal is ready. The Messages launcher must remain disabled for Academic Partner until Academic Partner Messages is actually built.
