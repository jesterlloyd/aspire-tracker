// Academic Partner messaging capability flag (fail-closed).
//
// AP <-> ASPIRE-Team messaging reuses the canonical portal messaging stack end to end (the same
// endpoints, the shared PortalMessagesWorkspace, the shared lower-right PortalTeamMessagesPanel
// launcher, the #DC1E34 unread badge, and the shared React-Query cache keys). No parallel tables,
// endpoints, or UI are introduced.
//
// The one thing that CANNOT be done without an Owner SQL migration: the database read/send predicates
// (message_participant_can_read / message_participant_can_send) and the general-team-start RPC
// (messages_start_general_team_conversation) admit only the student and unit_leader participant
// shapes; they must be extended to admit the academic_partner / school shape. The exact migration is
// documented as the Owner SQL gate in docs/product/PORTAL_COHORT_AND_MESSAGING_CONVERGENCE_HANDOFF.md.
//
// Until that migration is applied this flag stays FALSE, so the feature is fail-closed:
//   - the AP Messages tab shows an honest prepared state (no workspace, no polling),
//   - no lower-right Messages launcher mounts for an Academic Partner,
//   - the server refuses AP general-thread creation with 503 (never attempting the RPC),
//   - and even if a caller reaches the read endpoints, the DB predicates return an EMPTY inbox.
//
// Flipping this to true AFTER the Owner applies the migration activates the fully-wired canonical
// workspace + launcher for Academic Partners with no further code change.
export const AP_MESSAGING_ENABLED = false
