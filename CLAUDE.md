# CLAUDE.md (aspire-tracker)

Project rules for ASPIRE Intelligence. This extends the folder-level `Claude/CLAUDE.md`
and the workspace `05_AI/CLAUDE.md`; read those first. Everything below is specific to
this repository and applies to every session working in it, including parallel ones.

## Visual canon (UI-CONSISTENCY-1, 2026-09-03)

Every surface, staff app and every portal alike, resolves to one set of values, and
those values live in **one file**: `src/styles/aspireBrand.css`. Both halves of the app
import it. Do not restate a value in a component; read the token.

| What | Token | Value |
|---|---|---|
| Card corner | `--aspire-radius-card` | 12px |
| Control corner (buttons, inputs) | `--aspire-radius-control` | 10px |
| Space between sibling cards | `--aspire-gap-card` | 16px |
| Section nav to first card | `--aspire-page-top` | 24px |
| Table header size | `--aspire-th-size` | 11px, uppercase |
| Card edge | `--aspire-shadow-card` | the shadow IS the edge; cards have `border: 0` |
| Secondary nav hairline | `--aspire-nav-line` | shared by `.chart-nav` and `.ptl-nav` |

Rules that follow from the table:

1. **A card is one of three classes.** Staff: `.snap` (full-width section card) or
   `.ov-panel` (a panel inside a grid). Portal: `.ptl-card`. Do not write a new card rule;
   put the content inside one of these. If a genuinely new card class is unavoidable, it
   reads the four tokens above and has no border.
2. **Followers carry the top margin, cards never carry a bottom one.** A `.snap` has
   `margin: var(--aspire-gap-card) 20px 0`. Anything that comes after a card (`.ov-panels`,
   `.dashboard`, another card) supplies its own `margin-top: var(--aspire-gap-card)`.
   Vertical margins do not collapse in a flex column, so a bottom margin plus a top margin
   makes 32px, and a missing top margin makes 0px. Both have shipped; neither should again.
3. **No literal radii, gaps, or header sizes.** `border-radius: 8px` in CSS or
   `borderRadius: 8` in JSX is a canon violation unless it is a pill (`999px`), a circle
   (`50%`), or a chip inside a card. `test/uiCanonRatchet.test.mjs` counts literal radii
   across `src/` and fails if the count goes UP. Lower it when you can; never raise it.
4. **The navy `.tab-bar` is app-level brand chrome and stays navy.** Section navs
   (`.chart-nav`, `.ngrp` nav, `.ptl-nav`) are light with the shared hairline.
5. **Titles are Title Case; sentences are not.** Section, panel, card, chart and drawer
   titles: "Benefit Contribution by School", "Cohort Timeline". Empty states, prompts,
   toasts, aria-labels that read as sentences, and email prose stay sentence case:
   "No students match this filter", "Portal access granted."
6. **Measure, never compute.** Before claiming a spacing or radius is fixed, render the
   real stylesheets against the real sibling order and read `getComputedStyle` and
   `getBoundingClientRect`. Source reading missed two cascade overrides on the day this
   canon shipped; a browser caught both.

## Tables (UI-CONSISTENCY-3)

One header for every table, defined once in `src/styles/aspireTable.css`, which both
`index.css` and `PortalApp.jsx` import. A header cell is `<th className="aspire-th">`
(`aspire-th-right` / `aspire-th-center` for alignment). Do not write an inline `<th style>`
or a per-table header class; the ratchet counts inline header styles and fails if the
count rises.

A sortable column is `<SortHeader>` from `src/components/shared/SortHeader.jsx`. Its rule
is that the arrow appears only on the sorted column (up or down) and there is never a
resting glyph. The `<button>` it renders inherits the cell's caps, tracking and size from
the shared sheet; do not give it inline `font` or `color`. That inline `font: inherit`,
and the browser's own button defaults, are how sortable columns came to render in a
different case and size from their neighbours in three tables at once.

A table that sits inside a padded card (Academic Partner Students, NEL Student Detail, anything
on `.ptl-table` or `.ptl-na-table`) wears the inset band: `--aspire-th-bg-inset` with
`--aspire-th-color-inset` labels and top corners rounded on `--aspire-radius-control`. A table
that is the card (Unit Leader Your Students, Evaluation > Responses, the `.am-*` family) keeps
`--aspire-th-bg` as its top edge. Even rows carry `--aspire-row-band` everywhere, and hover still
wins. Both are Owner decisions from a rendered comparison on 2026-09-03 (UI-CONSISTENCY-6).

Student rosters share one column canon, in this order and with these labels: Student, ASPIRE
Status, Cohort, Rotation Timeline, Assigned Unit, Shift, Preceptor(s), Hours. Preceptor(s) is
`PreceptorList` (every active assignment with its role chip). Rotation Timeline reads the
coordinator-owned `cohort_school_rotations` row through the one `fmtShortDate` in
`src/portal/unit/unitLeaderApi.js`. A report table with columns of its own (NEL Student Detail)
leads with the shared columns in that order, shows ASPIRE Status as the canonical pill with the
legend, and keeps its numbers on the right. Table titles are Title Case ("Your Students",
"Student Detail").

## Student Portal on phones (STUDENT-PHONE-1)

Students open the portal on their phones first. Below 760px the Rotation Activity calendar is
the mini calendar plus its day panel: the month grid, its legend and its footnote hide, and the
title, description and month nav move above the mini calendar. Tablets and desktops keep the
full grid. Never reintroduce a sideways-scrolling grid on a phone, and Refresh stays desktop chrome (the
bottom bar hides it). The portal's Log a Shift gate
is the public flow's gate: Placed and Active Rotation. The ID badge has no server file; once
created it is rendered in the student's browser by `src/lib/badgeGenerator.js`.

Shift logging inside the portal is the Shift Log tab (`src/portal/StudentShiftLog.jsx`), which
reuses the public lifecycle's own views through a session-token transport to
`api/portal/my-shift-lifecycle.js`. That endpoint resolves the student from the token and its
active links, reads the school email server-side, and delegates every write to the public
handlers in `api/shift-log/` unchanged. Never accept `school_email` or an unlisted `student_id`
from the client, and never re-implement the shift-log rules in a second place. The public
`/shift-log` page stays for students without a portal account (STUDENT-SHIFT-TAB-1).

## New portal checklist

A new portal imports `src/styles/aspireBrand.css` (as `PortalApp.jsx` does), uses
`.ptl-card` for its cards, `.ptl-nav` for its section nav, and `.ptl-main` for its page
column so the first card lands at `--aspire-page-top`. Its tables use `.ptl-table`. If it
needs a component the other portals do not have, build it from the tokens, not from numbers.

## Student names

Display a student by `getStudentPreferredFullName` or `displayName` from
`src/lib/studentNameFormatters.js` / `src/lib/utils.js`. Never compose
`first_name + last_name` at a call site, and every `students` select that reads a name
also reads `preferred_first_name`. `test/studentPreferredNameSurfaces.test.mjs` enforces
both.

## Working in this repository

- Another session commits to `main` concurrently in the **same working tree**. Verify the
  baseline yourself, stage files **by name**, and for changes touching many files work in
  a `git worktree` off `origin/main` so their uncommitted work is never disturbed.
- Never apply SQL. Migrations are Owner-gated through `docs/security/OWNER_SQL_GATE.md`;
  verification queries go in `db/audit/`, numbered, one section at a time.
- Do not push without explicit approval.
- Leave the untracked `" 2."` / `" 3."` duplicate files alone.
