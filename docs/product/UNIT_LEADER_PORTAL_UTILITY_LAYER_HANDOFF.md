# Unit Leader Portal Utility Layer Handoff

## Corrected Architecture

The Unit Leader portal utility layer now mirrors the main-app corner-panel model.

Shared feedback presentation:

- `src/components/shared/SharedFeedbackPanel.jsx`
- consumed by `src/components/FeedbackPanel.jsx`
- consumed by `src/portal/PortalFeedbackPanel.jsx`

Portal corner utilities:

- `src/portal/PortalUtilityLayer.jsx`
- `src/portal/PortalTeamMessagesPanel.jsx`
- `src/portal/usePortalDialogFocus.js`

`PortalShell` still accepts a `utilityLayer` prop and renders it once below the portal header. `PortalApp` supplies that prop in the Student and Unit Leader branches only.

Student receives the shared docked Messages utility plus shared portal feedback with `portalRole="student"` and `portalType="student"`. Unit Leader receives the shared docked Messages utility, shared portal feedback, and Unit Leader-only desktop notice behavior with `portalRole="unit_leader"` and `portalType="unit_leader"`.

No utility layer is mounted inside `UnitLeaderPortal.jsx`, `StudentPortal.jsx`, or `AcademicPartnerPortal.jsx`. Academic Partner still receives no utility layer.

## Matched Corner Design

The old white `Feedback / Bug` and `Messages` pill buttons were retired.

Normal Student and Unit Leader portal pages now show:

- lower-left circular magenta feedback launcher
- lower-right circular ASPIRE Team message launcher

The launchers have comparable size, elevation, placement, focus treatment, and tooltip/accessibility behavior. Opening one corner panel hides the other utility so the panels never overlap. Academic Partner remains without either launcher.

## Shared Feedback UI

The lower-left utility reuses the canonical main-app feedback experience:

- circular magenta launcher
- anchored panel above the launcher
- `Send Feedback` heading
- `Report a bug, suggest a feature, or ask a question.` description
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

Student and Unit Leader portals use the same shared UI through `src/portal/PortalFeedbackPanel.jsx`, but submit to the durable portal feedback backend:

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

The portal feedback adapter uses the shared request-ID helper in `src/lib/portalFeedbackApiClient.js`.

One stable request ID is retained per portal/utility intent across failed attempts and cleared only after success. Duplicate submit is blocked synchronously in the shared panel before React rerenders.

`409` request-ID conflicts and `429` rate limits produce safe user-facing messages. A saved submission with pending email delivery is treated as successful receipt.

## Shared Docked ASPIRE Team Messages Panel

The lower-right utility is shared by Student and Unit Leader. It is no longer a shortcut that navigates immediately to `/portal/messages`.

It is now a circular message-bubble launcher with the accessible name:

```text
Open messages with the ASPIRE Team
```

Opening it displays a docked panel anchored to the lower-right, following the Keith panel interaction pattern without using Keith identity or AI behavior.

Panel structure:

- header title `Messages`
- subtitle `ASPIRE Team`
- subtle `↺ New` action with accessible name `Start a new conversation`
- subtle `×` close control with accessible name `Close Messages`
- guidance notice above the conversation/composer
- scrollable conversation history
- composer pinned inside the panel with a circular blue paper-plane send action labelled `Send message`
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

The panel selects the most recent authorized `thread_kind: 'team_general'` conversation from the portal message list. It does not infer general-team state from `!direct_student_name`, and it does not auto-select `team_student_context` or `direct_student` rows.

For an initial ASPIRE Team message, the panel calls `startGeneralTeamConversation({ requestId, body })`, which posts only `request_id` and `body` to `POST /api/portal/team-messages-start`. It does not send student, unit, role, profile, subject, category, or destination fields. Opening the panel, clicking `New`, closing the panel, or canceling by leaving compose does not create a conversation; creation happens only on successful submit.

Each compose attempt uses a stable request id. Rapid double submit is blocked synchronously. Failed retries preserve both draft text and request id. Successful sends activate the returned thread and refresh the shared list/unread caches.

Existing `team_general` replies still use the existing thread, reply, and read APIs.

## Message Bubble Treatment

The docked panel, portal full Messages workspaces, and staff Connect Messages thread now share `src/components/shared/MessageBubble.jsx`.

Viewer-relative direction:

- portal perspective: portal-user messages align right with blue bubbles; ASPIRE/staff messages align left with gray bubbles
- staff perspective: staff messages align right with blue bubbles; portal participant messages align left with gray bubbles

- author/time metadata stays subdued inside the bubble
- Student and Unit Leader use the same bubble classes

Unit Leader full Messages now uses the broader Student-style available width, not the earlier narrow centered maximum.

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
- show the Student desktop notice
- activate Academic Partner utilities
- add attachments or screenshots
- change sender or Reply-To behavior
- push or deploy

## Verification

Recommended verification:

- `node --test test/unitLeaderPortalUtilityLayer.test.mjs`
- `node --test test/sharedDockedMessagesUi.test.mjs`
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
- Student and Unit Leader feedback both submit through `/api/portal/feedback-submit`
- Student and Unit Leader lower-right launchers open the docked panel, not the full Messages route
- Academic Partner has no launcher
- `Open full Messages` navigates to `/portal/messages`
- `New` starts compose without creating a backend row
- failed first-message retry preserves text and request id
- first-message success activates the returned `team_general` thread
- replies refresh thread/list/unread state through existing APIs

## Future Extension Points

Academic Partner Portal can later use the same feedback utility once that portal is ready. The Messages launcher must remain disabled for Academic Partner until Academic Partner Messages is actually built.
