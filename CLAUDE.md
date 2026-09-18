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
   `borderRadius: 8` in JSX is a canon violation unless it is a pill
   (`var(--aspire-radius-pill)`), a circle (`50%`), or a chip inside a card.
   `test/uiCanonRatchet.test.mjs` counts literal radii across `src/` and fails if the
   count goes UP. Lower it when you can; never raise it.
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

## Materials (PLACEMENT-BOARD-FELT-1, 2026-09-17)

A **material** says what a surface is made of. It never sets structure: corner, gap and
edge still come from the table above, so a textured card is a card. The colours and
textures are tokens in `src/styles/aspireBrand.css` (`--aspire-board`, `--aspire-leather-cream`,
`--aspire-on-navy`, `--aspire-piping`, `--aspire-noise-*`, `--aspire-rank-*`); the classes
that apply them are in `src/styles/aspireMaterials.css`, which a screen imports where it
uses them (Rotation > Placement Board imports it through
`src/components/placement/placementBoard.css`). Textures are inline SVG noise, never
image files, and the materials look the same in light and dark mode; the page around them
follows the theme.

- `.material-board` (a PALE tint from the KPI filter family, textured with a soft-light
  whisper - it started as a deep blue felt and read too heavy), `.material-board-head`
  (a unit board's own header: one step deeper, nightfall ink, no piping),
  `.material-navy-flat` (a FLAT nightfall header with white ink and the gold piping below
  it; textured leather and its dashed stitching were cut the same day, for the same
  reason), `.material-leather-cream`, `.paper-note`, `.material-pin`, `.material-ribbon`.
- **Nightfall means a column header.** It marks the two column headers (Students and
  Units; Interviewees and Hiring Units on the Interview Board) and nothing else; a unit
  board's header is pastel, or the board out-weighs everything inside it and repeats the
  chrome above it.
- **A state class must beat `:hover`.** `.pb-unit:hover` is two selectors; `.pb-unit-focused`
  is one, so hover silently erased the selection ring exactly when the pointer was on the
  board it marked. Every selected/dragged/focused rule pairs itself with `:hover`.
- **Keep it quiet.** Every one of those corrections went the same way: less texture, less
  contrast, less weight. A material is a surface, not a statement; if a new one needs a
  multiply blend or a saturated ground to read, it is wrong for this app.
- **Paper is the one square surface.** `.paper-note` has `border-radius: 0` by Owner
  decision: a rounded sheet reads as a card. Cards, panels and controls keep the tokens.
- A rank is never colour alone: a pin shows its number, a ribbon and a chip show words.
  `--aspire-rank-*` are the nearest AA-passing shades to the approved mockup (white on
  them measures at least 4.5:1); `test/placementBoardFelt.test.mjs` re-measures them.
- The Students column shows every ELIGIBLE student, ordered by `orderPool`
  (`src/lib/placementBoardView.js`): preference for a focused unit, then interviewed
  before not-yet-interviewed, then last name. The ASPIRE Status pill is the readiness
  indicator; there is no readiness filter, and the availability pill appears only for
  Review or Highly restricted.
- The `pb-*` classes belong to both matching boards (see below). The Rotation board's
  unit cards still wear `embed-*` and `euc-*` for the parts it shares with Overview;
  never restyle those from a board sheet.

## One board, two vocabularies (INTERVIEW-BOARD-1, 2026-09-17)

There are two matching boards, and they are the same board: Rotation > Placement Board
(students to units) and Residency > Interview Board (interviewees to hiring units).
Owner's rule, in as many words: "all matching boards must be the same across the app".
Both wear `src/components/placement/placementBoard.css`, both put the people on the LEFT
and the boards on the RIGHT, and both drag through `src/components/placement/useBoardDrag.jsx`
(suppressed browser drag image, self-drawn ghost, a green (+) only over a board with room,
badge decided by a document-level `dragover` because `dragleave` arrives after the next
`dragover`). A change to the look or the interaction lands in the shared file and reaches
both, or it does not land.

The word **Pool** is not in either board's vocabulary (Owner, 2026-09-17): the columns are
Students / Units and Interviewees / Hiring Units. "Applicant Pool" survives elsewhere in
Residency because it names a membership rule (`lib/server/ngrpPool.js`), not a column.

What the two boards do NOT share is the cost of undoing. On the Placement Board an unmatch
is destructive, so the write is held (below). On the Interview Board unpairing writes one
nullable column, so it writes immediately and Undo simply pairs them again. Same gesture,
same ten seconds, different mechanism - do not unify them.

## The rubric is a book (RUBRIC-BOOK-1, 2026-09-17)

Interviews > a student's rubric is a bound two-page spread, built from the same materials
as the matching boards: a tan leather cover (`.material-leather-tan`), two white pages, a
seam, and an index down the fore edge. The left page is the candidate and never changes
while you write; the right page is the rubric. The stylesheet is
`src/components/rubric/rubricBook.css`, which imports the materials and reads the tokens;
nothing about the book lives in `index.css`.

- **The book is the Placement Board's column, and the PAGES flex** (Owner, revised
  2026-09-17). It sits inside `.app-main` with the board's own 20px gutter, and nothing
  is transform-scaled: the cover keeps one thickness, the index keeps its width, and the
  two pages share what is left at 42.5 / 57.5. Below `SPREAD_MIN` (1000px of stage) the
  book shows one page at a time rather than two too narrow to write in.
  `src/components/rubric/useBookScale.js` owns those numbers and also measures what is
  left below the shell's own top edge, so the whole book including its bottom cover is on
  screen whatever chrome sits above it. `test/rubricBook.test.mjs` re-measures all of it.
- **Read-only is the same book.** A finished rubric and a colleague's rubric render the
  same spread with the inputs replaced by their values. There is no second layout to keep
  in step.
- **The scoring guide lives in the head**, as a drawer above the scroller: "what does a
  4 mean?" is asked at the bottom of the page as often as at the top.
- **The head is one line and carries three things**: completion (counted against the same
  nine answers that gate Mark Complete), the scoring guide, and the live composite. The
  ASPIRE status is on the candidate page and the recommendation is Section 7's own answer;
  neither is repeated, and the save state sits in the toolbar so the head stays thin.
- **The candidate page opens with Background**, then Submitted Preferences, the Interest
  Statement, and Availability when the student answered those questions. The appointment
  is NOT repeated there: Section 1 owns it, and it is editable.
- **The flag lives on the student record, and this screen reads it.** It used to seed a
  local state from the prop once, write, and never refresh the roster, so leaving the
  rubric and returning showed a flag that had actually saved. **`onStudentUpdate` is
  `updateStudent(id, updates)`, a WRITER: called with no arguments it returns immediately.**
  Anything in this screen that means "refetch the student" must call `onRefreshStudents`,
  which the Interviews tab hands down and awaits. A refused write is caught and toasted: a Co-Lead cannot
  write this field at all, which was exactly the case that looked like it worked. The
  flag surfaces in Interviews as the Flagged card, the row chip and the Review Flag
  action.
- **The ribbon hangs from the book, not the page.** It is a grid item beside the pages
  that overhangs the top cover, so scrolling the candidate page never carries it away.
  **Pulling it IS the flag** (Owner, 2026-09-17), and a flag carries NO note.
  `flag_note` is no longer written; a note stored before this change is still shown until
  the flag is removed. The ribbon is a real button, so Enter, Space and a click do what
  the pull does.
- **The scale reads Limited, Developing, Adequate, Strong, Highly Aligned.** Only the
  words changed: the stored value is still the number, so the 12/15 and 8/15 thresholds,
  the averages, the score flag and every report are untouched.
- What a redesign may not quietly drop, and what the tests hold: the 30-second auto-save,
  the browser draft and its restore notice, Section 1 moving the real booking, and one
  rubric row per interviewer created on the first meaningful edit.

## The student record is a binder (STUDENT-CHART-1, 2026-09-18)

Student Profiles' detail panel is a black leather ring binder holding loose sheets. It is
the app's second bound object, and it is deliberately not the rubric's tan book: a book is
written once and closed, a binder is added to and taken from for months, which is what a
student record is. They share the leather grammar (`--aspire-noise-fine`, a thin board,
sharp paper) through `.material-leather-black` beside `.material-leather-tan`, and nothing
else. The chart lives in `src/components/student/`.

- **The binder is chrome. The form inside it is the one that was already there.** Every
  one of the fifteen sections is still editable in the same place, behind the same
  `canEdit`, saving down the same route. `studentChart.css` styles containers and never
  restyles `.sp-input`, `.sp-select` or `.sp-textarea`. A redesign that turns the chart
  read-only is a different product, not a refinement; `test/studentChart.test.mjs` fails if
  the fields disappear or if a section is dropped.
- **Seven sheets, in lifecycle order**, defined once in `chartSheets.js`: Profile,
  Background, Placement, Hours, Documents, Evaluations, Notes. The mockup drew five;
  fifteen sections do not fit five, and dropping ten was never on the table. Each sheet and
  its die-cut tab wear one tint, which is how a reader knows which tab opens what.
- **The index scrolls; it never mounts.** Every sheet is in the DOM all the time, so a
  half-typed field three sheets up survives a trip to the index and back. `.sc-scroller`
  must keep `position: relative`: a sheet's `offsetTop` is measured from its offsetParent,
  and without it every jump overshoots by the height of the name plate.
- **The binder holds still when the reader turns to another student.** `.profiles-panel-slide`
  carries no `key`, because keying it remounted the panel and replayed its slide-in on
  every click. Only what is written on the paper cross-fades.

### The chart gets the window (STUDENT-CHART-1, 2026-09-18)

The page scrolls. The KPI filter cards and the Profiles/CS-Link sub-tabs scroll away, the
search and filter bar pins to the top, and the split takes everything left in the
viewport. `.student-profiles-tab` used to be a fixed `calc(100vh - 164px)` box with
`overflow: hidden`, which left the chart 512px of a 950px window and an index rail 6px
shorter than its own tabs; it is 868px now. The height is measured by `useChartViewport`
and published as `--profiles-chart-h`, because the pinned bar wraps at narrow widths and
is not a constant. `.profiles-toolbar` must stay a DIRECT child of the tab: a sticky
element is bounded by its own parent, so inside the KPI wrapper it unsticks the moment
that wrapper scrolls past.

A section is part of the page, not a box on it. Fields sit on the sheet's tint with one
hairline rule between sections; only a real block keeps a container (`.sc-block`:
completion, the hours log, the document and evaluation lists). The sheet tint stays,
because a tab is the colour of the sheet it opens.

An index tab never shrinks below its own word (`flex: 0 0 auto`). Squeezing seven tabs to
fit clipped every label; below an 880px window they tighten instead, and below roughly
700px the rail scrolls. A rail that scrolls beats a word you cannot read.

Two cascade traps this cost, both found by measuring and neither visible in the source:
a `@media` query carries no specificity, so placed ABOVE the rules it modifies it does
nothing; and `--aspire-focus-ring` is a whole shorthand, so wrapping it in another one
produces invalid CSS the browser drops silently.

### The follow-up flag is not the interview flag (STUDENT-CHART-1)

Two ribbons, the same gesture, two different columns, and they must never be merged.

| | column | means | reaches |
|---|---|---|---|
| Interview rubric | `flagged_for_second_interview` | bring this candidate back for a second interview | Interview Recommendations, Action Center |
| Student chart | `flagged_for_followup` | come back to this student | the roster row, and nothing else |

Neither carries a note: the pull is the whole interaction. One component,
`src/components/rubric/FlagRibbon.jsx`, serves both; the rubric's values are its defaults,
so the chart passes `classPrefix` and its own labels and the rubric's call site is
unchanged.

`flagged_for_followup` is added by `db/migrations/20260921000000_student_followup_flag.sql`,
which is Owner-gated. The UI ships first and is correct on both sides of it:
`followUpFlagAvailable()` reads an absent column as "not enabled" and renders the ribbon
inert, and `/api/student-update`'s `set_followup_flag` turns Postgres' 42703 into a plain
409 instead of an opaque 500. `fetchStudents` selects `*`, so applying the migration
switches the ribbon on with no redeploy.

**`onUpdate` is a writer; `onRefreshStudents` is the refetch.** `onUpdate` is
`updateStudent(id, updates)`, which routes by field name and returns immediately when
called with nothing; it has no route for this column and refreshes nothing. The roster
reads the app's `students` array, so a flag write must paint locally AND await the refetch
or the roster keeps the old mark until a page reload. This exact mistake shipped in the
interview rubric in September 2026 and cost two review rounds. Both props are threaded from
`StudentProfilesTab`; do not collapse them.

## A colour pair travels together (STUDENT-PROFILE-INK-1, 2026-09-18)

Student Profiles had about forty pieces of text between 1:1 and 3:1 in dark mode. The
root cause is worth stating once, because it is the thing that makes dark mode rot:

**An ink and the surface behind it are one decision, and they must be made in the same
place.** A theme-aware ink on a fixed light box is invisible in dark. A fixed dark ink on
a theme-aware box is invisible in dark. Fixing only one half is worse than fixing
neither, because the result still measures badly and now looks deliberate.

So, when writing a colour in this app:

- **Neutral ink on a surface that follows the theme** reads a theme-aware token:
  `--text-heading`, `--text-caption`, `--text-muted`, `--color-text-placeholder`,
  `--color-accent-primary`. These live in `src/styles/theme.css` and have a value in both
  themes.
- **`index.css`'s legacy tokens are light-mode constants**, not theme values. `--raven`,
  `--nightfall`, `--sand`, `--pearl`, `--border`, `--border-lt` and index.css's own
  `--text-secondary` are never redefined for dark. Reaching for one of those is how this
  happened.
- **A literal ink is correct beside a literal background.** A chip, a source tag or a
  tinted notice is a pair that is meant to look the same in both themes; leave those
  alone. `test/studentChart.test.mjs` INK 1 encodes exactly this: a hardcoded ink is only
  flagged when nothing on the same element pins its surface.
- **Module-level colour constants are tokens too.** `const NAVY = '#1D2567'` in
  StudentUnitAssignments reached every call site at once and was invisible to a search for
  hardcoded `color:` values.
- **The materials layer is theme-independent.** A `.paper-note` is white in both themes, so
  the chart's dark ink is explicitly reset inside one. A light-blue link on white paper
  measured 1.65:1.

The chart redefines the ink tokens inside `.sc-paper` for dark, because its pages are
lighter than the app's dark surfaces and the app's inks are tuned for those.

Verified by sweeping every text node in the panel in a real browser, compositing
translucent backgrounds, and applying the WCAG large-text threshold: dark went from 280
failing samples to 0, and light from 147 to 126 with zero regressions.

## Placement rank (PLACEMENT-BOARD-FELT-1)

`matches.match_quality` stores `top_choice`, `second_choice`, `third_choice` or `other`,
decided ONCE at placement by `matchQualityFor` in `src/lib/placementDisplay.js`. Displays
read the stored value through `matchRankOf`; a rank is never re-derived from unit names,
and an absent value reads "Match rank not recorded". Placements made before 2026-09-17
stored a 3rd choice as `other` and keep it. Before shipping any change to these values,
run `db/audit/match_quality_third_choice_preflight.sql` (read-only): a CHECK constraint
or enum that does not list the new value would refuse the write in production.

## Unmatching is held, not undone (PLACEMENT-BOARD-FELT-1)

An unmatch cannot be reversed by placing the student again: it clears the primary
preceptor, reverts the ASPIRE status, and leaves the Notified confirmations keyed to a
deleted match row. So the board HOLDS the write for `UNDO_WINDOW_MS` instead of offering
an undo that would quietly lose all three: `src/lib/pendingUnmatch.js` owns the rules
(one hold at a time, commit before any other write, commit on cohort switch and on
unmount, Undo only while waiting). If the page closes inside the window nothing was
written and the student stays placed. Never replace this with a re-placement "undo".

**There is no confirmation dialog** (Owner, 2026-09-17). Pulling a pin pulls the student;
the window is the safeguard, which is why it is 10s and not 6. What the dialog used to
promise moved to the Undo toast, which names the consequences of the branch that WILL run
from the same `planUnmatch` - the successor unit for a survivor case, the cleared
preceptor for a final one - while the write can still be taken back. A dialog is dismissed
on reflex; an Undo that is still on screen is not.

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
