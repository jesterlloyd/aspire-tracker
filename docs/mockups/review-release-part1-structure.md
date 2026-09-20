TASK (Part 1 of 2): Reorganize Evaluation > Review & Release so every survey workflow uses one detection model, one set of states, and one queue component. Rename the workflows, add a new Pre-Rotation Casey-Fink workflow, and surface blockers in plain words. Keep the current visual styling; Part 2 restyles it.

REFERENCE FILE: docs/mockups/review-release-mockup.html in this repo. Open it and read the WF data array in the script. It defines the six workflows, their triggers and gates, and the three states an item can be in. The spec below is the source of truth; the file shows the intended result.

## 0. BEFORE WRITING CODE

- List every file behind Review & Release: the left rail, each workflow's detection query, each workflow's table, the release endpoint, the suppression logic, and the Responses tab. Tell me which ones you will change.
- Confirm where these live and whether they are stored or derived: student hours approved and required, ASPIRE status (Applied, Offered, Interviewed, Placed, Active Rotation, and any others), survey send records, survey submission records, preceptor email, unit assignment, unit leader assignment.
- Confirm whether the four existing workflows share a detection service or each run their own. If each runs its own, propose the smallest unification that leaves each workflow's eligibility rule where it is but returns results in the shared shape defined in section 3.
- Do not change the release endpoint, eligibility re-check on the server, permissions, or audit logging. This is a reorganization of what the page shows and how it names things.

## 1. WORKFLOWS AND NAMES

Six workflows in this order. The left rail shows them in this order, grouped as Survey workflows (1 to 5) and Unit leader release (6).

| # | New name | Current name | Recipient | Trigger (who appears) | Gate (what release unlocks) |
|---|---|---|---|---|---|
| 1 | Casey-Fink Readiness for Practice (Pre-Rotation) | new | Student | ASPIRE status is Interviewed, Placed, or Active Rotation | None. Baseline for the post-rotation comparison. |
| 2 | Preceptor's Assessment of Student Readiness | Preceptor Readiness | Preceptor | Midpoint at 50% of required hours; End of Rotation at 100% | End of Rotation unlocks the preceptor's Certificate of Appreciation |
| 3 | Student's Feedback on Unit and Preceptor | Student Feedback | Student | 100% of required hours | Prerequisite for workflows 4 and 6 |
| 4 | Casey-Fink Readiness for Practice (Post-Rotation) | Casey-Fink Post-Rotation | Student | Workflow 3 submitted | Unlocks Certificate of Completion |
| 5 | Student's Feedback on ASPIRE | ASPIRE Rotation Feedback | Student | Workflow 4 submitted | None |
| 6 | Release Student's Feedback on Unit and Preceptor to Unit Leaders | Release to Unit Leaders | Unit leader | Workflow 3 submitted | None. Forwards the student's submitted response to that unit's leader. |

Rules:
- Rename in the UI, the rail, email subjects, and any user-facing string. Do not rename database tables, enum values, or API routes unless it is trivial and safe. If a rename touches stored data, tell me and stop.
- Workflow 1 is new. It needs its own detection (ASPIRE status, not hours), its own email template, and its own send and submission records. Model it on workflow 4. Any student with status Interviewed, Placed, or Active Rotation who has no send record appears as Ready. Applied and Offered students appear under Not yet eligible. Do not make workflow 1 a hard prerequisite for workflow 4; show the relationship only.
- Workflow 2 has two periods (Midpoint, End of Rotation). One item per student per period, as today.

## 2. THE DEPENDENCY CHAIN

Every item carries a three-node chain that the UI renders on the card:
- **Before**: the prerequisite this release depends on, with its state (done with date, sent but not submitted with date, not released yet, or a data fix needed).
- **This**: the release itself.
- **After**: what this release unlocks, or "Chain complete" when nothing follows.

Chains per workflow:
1. ASPIRE status → Pre-Rotation Casey-Fink → Pairs with Post-Rotation at 100% hours
2. Midpoint: Hours at 50% → Midpoint assessment → End of Rotation at 100%. End of Rotation: Midpoint submitted → End of Rotation assessment → Certificate of Appreciation
3. Hours at 100% → Student feedback → Post-Rotation Casey-Fink and Unit leader release
4. Student feedback submitted → Post-Rotation Casey-Fink → Certificate of Completion
5. Post-Rotation Casey-Fink submitted → ASPIRE feedback → Chain complete
6. Student feedback submitted → Forward to [unit leader name], [unit] → Chain complete

When the Before node is a data problem (no unit, no preceptor email, no student email, no unit leader assigned), the chain shows that problem as the Before node, so the person reads the blocker without opening anything.

## 3. THREE STATES, ONE SHAPE

Replace today's Ready / Needs attention / Suppressed with these three. Every workflow returns items in the same shape:

```
{
  id, workflowId, period?,            // period only for workflow 2
  person: { name, sub },              // sub = program and unit, or feedback target for workflow 6
  hours: { approved, required, threshold } | null,   // null for workflow 1
  state: 'ready' | 'blocked' | 'notEligible',
  stamp: { tone: 'ok'|'soon'|'late', text },          // short human label, see below
  chain: [ { role:'before'|'this'|'after', status:'done'|'this'|'next'|'waiting'|'fix', label, detail } ],
  blocker?: { text, action: 'remind'|'fix'|'jump', target? }, // blocked items only
  sendTo?: string                                     // ready items only
}
```

- **ready**: every prerequisite is met and the recipient can be resolved. Card shows Release.
- **blocked**: eligible by hours or status, but something a person can do today is missing. Exactly one blocker per item, in plain words, with exactly one action:
  - `remind`: the prerequisite survey was sent and not submitted. Action sends a reminder email through the existing path and stamps the card "Reminded today." Do not allow a second reminder within 3 days.
  - `fix`: a data problem. Action opens the record that needs fixing (student profile, preceptor record, unit).
  - `jump`: the prerequisite has not been released yet and is sitting Ready on another workflow's queue. Action switches the rail to that workflow and highlights that item. Carry the target workflow id and item id.
- **notEligible**: below the hours threshold, or not yet interviewed for workflow 1. Do not render these as rows. Render one collapsed line with the count and the reason, expandable to a compact list of names with hours (or status for workflow 1).

Items already sent for this period do NOT appear in any of the three states. They appear on the Sent log (section 4) and, when a downstream workflow depends on them, as a Waiting node on that downstream item's chain. This replaces the Suppressed (existing) table.

Stamp text examples: "Threshold met", "Hours complete", "Prerequisite done", "Active rotation", "Placed", "Interviewed", "Waiting 6d", "Step behind", "No unit on file", "Email missing", "No unit leader". Tone: ok for ready, soon for waiting or step behind, late for data fixes and anything older than 7 days.

## 4. SENT LOG PER WORKFLOW

Each workflow keeps a per-workflow log of releases, newest first: time, person, period or step, recipient, and submission state ("submitted Sep 12" or "not yet submitted"). Show the most recent 5 on the page with a link to the Responses tab filtered to that workflow. Today's releases show a time; older ones show a date.

Release behavior:
- Release removes the item from Ready, writes the log line, and shows a toast with Undo for 6 seconds. Undo is only offered if the send has not left the outbox; if sends are synchronous, offer Undo only as "Mark as not sent" with a clear label, or drop Undo. Tell me which applies in this codebase.
- Re-run detection refreshes every workflow's queue and updates the timestamp.

## 5. PAGE HEADER AND RAIL

- Page summary line under the title: "N ready to release · N need a fix or a reminder · N sent today · across 6 workflows." Counts are totals across all workflows.
- Rail: each workflow shows its name, "to student/preceptor/unit leader" in small text, a green badge with the ready count, and an amber badge with the blocked count. Hide a badge when its count is 0.
- Rail is the same height as the main panel and starts at the same top edge. Not sticky.

## 6. MAIN PANEL, TOP TO BOTTOM

1. Workflow name, with the old name beside it in small text for one release cycle so people can find things, then remove it.
2. Three chips: To: [recipient], Trigger: [rule], and the gate in a warm-toned chip.
3. One tool row: Preview survey, Preview email, Send test to me, Re-run detection, and "Detected [timestamp]" right-aligned.
4. One line: "Human-approved sends only." plus a "How release works" link that expands the workflow's policy paragraph inline. Collapsed by default.
5. Ready to release (N), then the Ready items.
6. Needs a fix or a reminder (N), then the Blocked items. Omit the section when empty.
7. Not yet eligible (N), collapsed.
8. Sent from this clipboard, the log.

Move the long description paragraph and the "human-approved sends only" box out of the top of the page; they become the collapsed policy text.

## 7. ACCESSIBILITY

- Release, Remind, Fix, and Jump are buttons with clear labels. Jump reads "Release her Student Feedback first →" or similar, naming the prerequisite.
- The rail is a group of buttons with aria-pressed. Switching workflows announces the workflow name.
- The collapsed policy and Not yet eligible blocks are native details/summary or an equivalent with aria-expanded.
- Toasts use role=status.

## 8. DONE WHEN

- All six workflows appear in the rail in the order above with the new names.
- Workflow 1 exists, detects on ASPIRE status, and can release a Pre-Rotation Casey-Fink survey.
- Every workflow returns items in the shared shape and renders through one queue component.
- Every blocked item states its blocker in plain words and has one working action.
- Jump links move to the right workflow and highlight the right item.
- Sent items no longer appear as a Suppressed table; they appear on the log and as Waiting nodes downstream.
- The summary counts, rail badges, and section counts agree.
- Tell me which files you changed, whether Undo is real or a label, and any data you could not find.
