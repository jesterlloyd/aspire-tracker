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
as the matching boards: the address book's cognac cover (tan until CONTACTS-BOOK-3, its
own pebbled hide until BOOK-COVER-1 made the two books one cover), two white pages, a
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

## How a bound thing shows its pages (BOOK-FORE-1, 2026-09-19)

Three objects in this app hold paper, and they do not all show it the same way. One
sheet, `src/styles/pageStack.css`, holds both forms; a surface says where its top sheet
sits with four inset tokens and picks the form that matches what it IS.

- **`material-pagestack`, offset sheets.** Loose paper on a surface: two sheets peeking
  down and to the right. The six calendars (on a desk pad) use this. Whatever holds it
  must reserve the overhang on its RIGHT and BOTTOM padding.
- **`material-forestack`, a fore edge.** A sewn block seen edge-on: many thin page edges
  packed tight, on both sides, exactly the pages' height, and NOTHING at the bottom,
  because an open book has no loose bottom edge. Both books use this. Whatever holds it
  reserves `--fore-w` on each side. **`material-forestack-right`** drops the left block:
  the student chart wears it (BOOK-COVER-2, Owner, 2026-09-21: "the stack should only be
  present in the right side, remove it from the bottom"), because its rings hold the
  left and the loose edges can only show at the open one.

**Pitch and contrast fight each other.** A fore edge at a ~2px pitch is sub-pixel on a 1x
display. Wide contrast between adjacent lines aliases into a barcode, which is why the
book's first fore edge was thrown out; a narrow range of four tones at four unequal
widths blurs into paper instead. Judge one magnified, never at 1x.

**The spine is the fold.** The rubric's cover is one leather with a darker band of the same
leather down the gutter and the crease inside it (Owner, from the macOS Contacts book:
only the spine is dark). Since BOOK-COVER-2 it is a subtle translucent crease that both
books wear (`.material-book-spine`, see "Both books wear one cover" below); an opaque band
read as a stripe, and near-black read as a gap rather than as leather turning. The band aligns with `.rb-seam`, which sits on the boundary between
the two page columns and is NOT the geometric centre of the cover, so it is a child of
the spread and not a background on the leather. One page has no gutter, so single-page
mode has no fold.

**A drop shadow must fit the room it has.** `.profiles-detail-col` is `overflow-y: auto`,
and that clips BOTH axes. The binder's `0 16px 34px` needed about fifty pixels of
clearance, so its sides were cut flush while its bottom smeared onto the page below. A
shadow on anything inside a scroll container carries a negative spread and stays under
its object.

**One edge per sheet, and the chart's is none.** A border AND a ring shadow is two rules,
and the pair holds the page apart from the sheets behind it. The ring went on 2026-09-19;
the chart's border went too on 2026-09-21 (Owner: "remove as well the hairline outline
present around the page"). White paper on black leather needs no rule.

## The student record is a binder (STUDENT-CHART-1, 2026-09-18)

Student Profiles' detail panel is a black leather ring binder holding loose sheets. It is
the app's second bound object, and it is deliberately not the rubric's tan book: a book is
written once and closed, a binder is added to and taken from for months, which is what a
student record is. They share the leather grammar (`--aspire-noise-fine`, a thin board,
sharp paper) through `.material-leather-black` beside the books' cognac, and nothing
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
- **A section lives on the sheet that its neighbours point at.** Placement already told the
  reader to "use Program Disposition to record dispositions", so Program Disposition is on
  the Placement sheet, not under Notes. Placement is where a student's standing is decided
  and a disposition is the end of that story; Notes is notes.

### A column is a promise (STUDENT-CHART-1, 2026-09-18)

Things that repeat down a sheet line up, and the value is what fills the row, never the
control beside it.

- **Contact Information is one column of values.** `.sp-copyrow` gives the value cell
  (`.sp-input` or `.sp-readonly` alike) `flex: 1 1 auto; min-width: 0` and the copy button
  `flex: none`, so the buttons land on one vertical line instead of chasing the length of
  each address.
- **Documents is `name | what is on file | ↓ Download | Replace`.** The two action columns
  are fixed widths (`--sc-doc-dl`, `--sc-doc-rep`) and the button fills its column, so
  every Download is the same size in the same place. A row with nothing to replace still
  holds the replace column. Uploaded documents (Resume, Headshot) get both controls;
  GENERATED ones (ID Badge, Certificate of Completion) get Download alone, and the reason
  a disabled row is disabled reads in the row rather than only in a tooltip.
- **Download and Replace are one CSS rule.** Two rules drift. A `<button>` also brings the
  browser's own font with it, so the shared rule takes it back with `font-family: inherit`
  and pins `line-height`, or a label containing "↓" renders a pixel taller than its
  neighbour.
- **Availability is one comparison, not two halves.** A row per constraint, a column per
  source (Program / Student), each column keeping its `SourceTag`. A dash means "this side
  does not set this constraint"; the formatters' "Not provided" means "this side was asked
  and has not answered". Still no risk logic: the table reports both sides, it does not
  judge the fit.
- **One GPA rule for every surface**, `gpaBand` + `GPA_BAND_COLORS` in `src/lib/constants.js`:
  3.5+ green, 3.0-3.49 amber, below ASPIRE's 3.0 floor RED. A surface that paints its own
  thresholds will paint the floor grey and hide it, which is what the chart's name plate
  did until it was made to read the canon.

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

### Nothing moves that the reader did not move (RIBBON-CALM-1, 2026-09-18)

A ribbon does not grow when you point at it, and an index tab does not travel when the
scroll spy changes. Both shipped doing exactly that: the rubric's ribbon added 6px of
padding on hover, so the thing you were about to click moved out from under the pointer,
and the chart's current tab slid 6px, so the whole rail twitched the length of the record.
Hover lifts a shadow; the current tab is named by colour and weight. Both books lift the
same scroll shadow on their top bar (`.sc-plate-lifted` and `.rb-head-lifted` are the same
declaration, and a test asserts they stay identical).

**A `:hover` rule must sit AFTER the state rules it has to beat.** `.sc-ribbon:hover` and
`.sc-ribbon[aria-pressed="false"]` have identical specificity, so source order decides;
written above, the hover shadow silently never applied. Same trap as a `@media` query
placed above the rules it modifies.

### Two things are pinned above the chart, not one (STUDENT-CHART-1)

`.top-section` (the app header plus the section nav) is `position: sticky`, so the
toolbar has to pin BELOW it and the chart's height has to subtract both. Pinning the
toolbar at `top: 0` put it behind the header and hid the binder's first 40px; the chart
looked cut off because its top was under the chrome. `useChartViewport` measures the
chrome rather than trusting `--app-chrome-height`, which says 112px where the real height
is 110.

### The follow-up flag is not the interview flag (STUDENT-CHART-1)

Three ribbons, the same gesture, three different columns, and they must never be merged.

| | column | means | reaches |
|---|---|---|---|
| Interview rubric | `students.flagged_for_second_interview` | bring this candidate back for a second interview | Interview Recommendations, Action Center |
| Student chart | `students.flagged_for_followup` | come back to this student | the roster row, and nothing else |
| Contacts | `contacts.flagged_for_followup` | come back to this person | Contacts only: the book's ribbon, entry mark and Flagged only in Classic style; the three columns' Flagged tag, row mark and Flagged only in Modern (APPEARANCE-STYLE-1) |

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

**A sweep only sees what the record renders.** The first sweep ran against a student with
no CS-Link status, so only step 1 existed and the tick labels were never sampled: they were
`var(--raven)` on a dark step, 1.15:1, and passed the audit by being absent. A sweep's
student needs every conditional branch open, and a background the sweep cannot read is a
sample it will score against the wrong surface (a `linear-gradient` between two identical
stops is a solid fill that `backgroundColor` reports as transparent, which made the flag
ribbon look like a failure it was not).

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

## Calendars are one planner (PLANNER-CALENDAR-1, 2026-09-19)

All six calendars are the same object: a two-ring notepad holding the mini calendar and
the day panel, a stacked sheet holding the calendar, both on a coloured desk pad. One
component, `CanonicalCalendarFoundation`, one stylesheet, `src/components/shared/
plannerCalendar.css`, which the component imports so it reaches BOTH bundles (neither
`index.css` nor `portal.css` does).

1. **Paper follows the subject, not the audience.** `paper="slate"` Interviews,
   `"tan"` anything about shifts (staff Rotation Activity, Unit Leader, Student Portal),
   `"forest"` anything about the residency or academics. A shift reads the same sheet
   whoever opens it. Omitting `paper` renders the old shell, unchanged.
2. **The box is a constant size.** `.pl-calbox` is a fixed height and the views fit
   INSIDE it: a month grid divides it by `--weeks`, a week view and the Academics
   timeline scroll within it, and the notepad's day panel scrolls too. Nothing about the
   panel moves when the view, the month or the selected day changes. The notepad's sheet
   is `position: absolute` above 960px precisely so the CALENDAR sizes the row.
3. **Colour is a shape, never the ink.** An event's type colour is a 3px left rule and a
   wash; the text is `--paper-ink`. Painting text in a colour staff chose makes contrast
   a property of that choice, and three event colours already failed on white.
4. **A pale fixed fill keeps a fixed ink.** `--paper-muted` lifts to a pale grey in dark,
   so a themed ink on a fixed pale card is unreadable there. Theme the ink only where the
   background is the paper.
5. **Anything that reads a portal literal needs a planner rule.** The portal calendars
   predate the planner; `--ptl-ink`, `--ptl-muted` and `--ptl-line` are redefined on
   `.pl-planner` (a descendant definition always wins for its subtree), and the rules
   that hardcode a colour are repointed by name.

## Review & Release is one queue on a clipboard (REVIEW-RELEASE-1 and 2, 2026-09-19)

Evaluation > Review & Release is six workflows in one rail (five surveys and the Unit
Leader release), one detection model, one queue. Adapters in
`src/lib/evaluation/reviewQueueAdapters.js` turn each classifier's rows into the shape in
`reviewQueueShape.js` (ready / blocked / not yet, a three-node chain, one blocker with one
action); the four classifiers are untouched and the release endpoints keep every guard.
`ReviewReleaseQueue.jsx` renders the shape and knows nothing about detection;
`SurveyAutomationDashboard.jsx` owns the loads, the actions and the board.

- **No manual Remind, no Undo** (Owner, 2026-09-19). A waiting slip quotes the ledger's
  next reminder date; sends are synchronous. Do not add either back with the visuals.
- **One Not-yet row per student per workflow.** The preceptor classifier emits a row per
  period; the adapter keeps the earlier period and names the next gate.
- **The board is a pressboard clipboard** (`src/components/evaluation/reviewReleaseClipboard.css`),
  presentation only. Corners come from the canon tokens; the three chip radii the mockup
  needs are named once at the top of the sheet and read by var(). Paper is square, and a
  slip has NO stack under it: one student is one sheet, already on a clipboard (Owner,
  2026-09-19).
- **The rail is pinned, at its own height.** `position: sticky; top: var(--app-chrome-height)`,
  `align-items: start`; it does not stretch to the board (Owner, 2026-09-19, reversing the
  brief). Below 900px it is static and stacks above the board.
- **The four tools are icon buttons on the board's head**, the canon from Residency >
  Support, each on the shared `Tooltip` (`tone="contrast"`, the black semi-transparent
  bubble the pull pin uses): the eye previews the email, the square-arrow opens a sample
  of the survey, the paper plane sends a test to me, the arrows re-run detection. A slip
  carries no preview. The head is the name with its timepoint as a smaller qualifier
  (no "new", no old name), one mono meta line, and the detection stamp.
- **The required activities are recorded on the slip** (Owner, 2026-09-20). The
  Required activities node in the chain is a chevron toggle; the area it opens lists
  Résumé Review, Town Hall, Interview Bootcamp in Residency > Support's order, each with
  the date it happened. An activity counts as done if the ledger
  (`student_activity_completions`) OR a live `ngrp_support_entries` row for that student
  says so, on the card (`aspirePrerequisites(..., supportEntries)`) and in the release
  endpoint's gate. Support is the secondary source: a failed read leaves the ledger alone
  to decide. The slip records into the ledger with the date; a completion that exists
  only in Support is corrected in Support. There is no activity dialog any more.
- **The retired panels are gone.** The four `*AutomationPanel.jsx` files and
  `UnitEvaluationReleaseConsole.jsx` were deleted on 2026-09-20; their tests now pin the
  adapters, the queue and the dashboard.
- **`students.status` is the ASPIRE status.** There is no `students.aspire_status`; that
  name belongs to `unit_preceptor_responses`, and selecting it took every detection down
  on 2026-09-19. `test/reviewReleaseQueue.test.mjs` now refuses any students column that
  no other production select names.
- **Paper is one definition.** `--aspire-paper*` and `--aspire-rule` live in `theme.css`,
  light and dark; the planner's slate paper and the clipboard both read them. Status
  inks are `--aspire-ok/warn/bad` with `-soft` tints; the board and the tape are
  `--aspire-pressboard-*` and `--aspire-tape-*`, all theme-aware, all in `theme.css`.
- **JetBrains Mono is the third self-hosted family** (`--aspire-mono`, SIL OFL, subset
  like the other two, NOT preloaded: only this screen sets it, and a face declaration is
  lazy). `test/typographyFonts.test.mjs` pins all three.
- **Measure ink on the board against its lightest tone.** The mockup's 45 to 62 percent
  inks read 3.3:1 to 3.7:1; every translucent ink on the board is at or above 78 percent
  and the tape's muted ink is `#675E44`, not the mockup's `#7A7052` (4.06:1). The harness
  sweep is 58 classes in both themes; a new one belongs on that list.
- **Motion defers.** A released slip slides off before the refetch, a jump target pulses
  once; under `prefers-reduced-motion` the CSS and the refetch hold both stand down.
- **Every workflow can send an expired or revoked survey again (SURVEY-REISSUE-2, Owner,
  2026-09-20).** One rule, `isReissuableAssignment` in `src/lib/evaluation/assignmentReissue.js`
  (expired, lapsed past `expires_at`, revoked or non-responder, never completed or live), read
  by all five detectors and all five release endpoints; the Casey-Fink name is an alias of it.
  The three detectors that used to classify an expired row as "Owner resend decision required"
  now offer it for reissue while the trigger still holds (an expired midpoint is still
  superseded once the end threshold is reached; below the hours gate the row is blocked). The
  card is Ready with a **Reissue** button and a "Link expired" / "Link revoked" stamp. The
  endpoints reuse the row through `lib/server/evaluation/assignmentReissue.js` (claim by
  compare-and-set, retire every historical token but one and rotate the survivor, activate
  under the claim, restore on any failure), require the row to be the student's current
  cohort's and still reissuable at release time, skip the historical notification_log dedup
  only for a reissue, and echo `reissued`. The preceptor core excludes the reissue row from
  its own idempotency check. The two Casey-Fink endpoints keep their pinned inline copy of
  the same steps. Nothing about a completed response is ever touched.
- An identity-echo mismatch after a send sets `identityHold`, which disables every
  Release on the board until Re-run detection.

## A survey has one name (SURVEY-NAMES-1, 2026-09-20)

The four instruments are named in `src/lib/evaluation/surveyNames.js` and nowhere else:
Casey-Fink Readiness for Practice, Preceptor's Assessment of Student Readiness, Student's
Feedback on Unit and Preceptor, Student's Feedback on ASPIRE. Everything that prints a name
reads that module: the Review & Release catalog composes its labels and titles from it, the
four respondent pages take their heading from it, the invitation, reminder and certificate
emails name the survey from it in the body, and the reminder ledger, the Responses packet, the
Unit Leader and Student portals and the staff response viewers map the slug through it.
`test/surveyNames.test.mjs` sweeps `api/`, `lib/` and `src/` for the retired spellings.

- **Only Casey-Fink carries a timepoint in its title**, because it is the one instrument
  given twice: `surveyLabel(slug, timepoint)` is the "(Pre-Rotation)" form the rail and prose
  use, `surveyTitle` is the ", Pre-Rotation" form for meta lines. The respondent page shows
  the qualifier as a smaller word beside the name, the way the clipboard head does, and only
  once the token has said which administration this is. `TIMEPOINT_QUALIFIERS` is the one
  timepoint vocabulary (Pre-Rotation, Midpoint, Post-Rotation); the packet, the response
  viewer, the Student Portal and the Casey-Fink token endpoint all read it.
- **Email subjects stay sentences** (Owner, 2026-09-20): "Complete Your ASPIRE Readiness
  Survey", "Share Your ASPIRE Rotation Feedback". The body names the survey. The student
  invitation and its reminder now agree on "Preceptor and Unit".
- **`evaluation_instruments.display_name` is not rendered any more.** Readers that used it
  pass it as the FALLBACK to `surveyName(slug, display_name)`; the CSV export keeps it on
  purpose. Renaming the stored values is a separate, Owner-gated decision
  (`db/audit/survey_display_names_audit.sql` lists them beside what the app shows).
- **Out of scope, on purpose**: Connect's "Student Casey-Fink Survey" send mode keeps its own
  name (it names a mode, not the instrument), the Action Center's orientation draft links a
  separate Microsoft Forms readiness survey, and Keith's retrieval aliases keep the old
  spellings because the governed documents still use them.

## Unit leadership is Connect (UNIT-LEADERS-RETIRE-1, 2026-09-20)

"Whatever is in ASPIRE Connect > Contacts is the canon" (Owner). Unit leadership is read from
Connect contacts in the Unit Leader category, active, with an email, and from nowhere else;
the hand-seeded `public.unit_leaders` table is read by NOTHING. Its drop is
`supabase/migrations/20260923000000_drop_unit_leaders.sql` (Owner-gated, refuses to run while
anything out of band depends on the table; checks in `db/audit/unit_leaders_drop_checks.sql`).
The Owner ran `db/audit/unit_leaders_vs_connect_preflight.sql` on 2026-09-20 before it was
written: 26 of 28 units resolve the same lead, and Float Pool has no Associate Director in
Connect yet. Rows that only ever lived in the old table are not carried
over.

- **One adapter, the old shape.** `src/lib/unitLeadersFromConnect.js` turns contacts into the
  rows the six readers always understood (`unit_name, full_name, preferred_name, email, role,
  role_qualifier, is_primary_lead`), one row per unit a contact holds (`unit_name` plus
  `related_units`), so notification routing, the placement greeting, the Overview lead map,
  the capacity outreach selector, the board and Keith kept their logic. Browser readers go
  through `src/lib/unitLeaders.js`; server readers select `UNIT_LEADER_CONTACT_COLUMNS` with
  the service role and run the same adapter. Do not add a reader that queries `contacts` for
  leadership on its own.
- **The lead is derived, never flagged.** The unit's Associate Director (interim or acting),
  else its Director, else an Executive Director over it; ties break on name. An ANM or an
  NPD Practitioner is never promoted, so a unit with only those has no lead and the surface
  says so ("No unit lead is on file for X. Add the Associate Director in ASPIRE Connect,
  Contacts."). The Student Portal's `placementLeadership.js` reads the same contacts for a
  narrower purpose (who is copied on Email Preceptor) and keeps its own tiering on purpose.
- **The CC rule did not change**, it moved: `selectUnitFormCc` is the pure form of what
  `resolveUnitFormReceived` did (the lead submitted it: copy ANM, NPD-P, CNS; anyone else:
  copy the lead; never the submitter). Unit names compare through `unitNameKey`, so a
  contact filed under '6NE' still routes the '6 NE' form.
- `test/unitLeadersFromConnect.test.mjs` sweeps `api/`, `lib/` and `src/` for any
  `from('unit_leaders')` and fails on one.

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

## Every table is one component (TABLE-CANON-1, 2026-09-19)

`docs/design/table-canon-spec.md` is the standard and `docs/mockups/table-canon.html` renders
it. The component is `src/components/shared/DataSheet.jsx` with `dataSheet.css`, at one of
three levels the spec's three questions decide: **full** (stands alone, holds a record you
read or export: tractor holes, a crease every ten rows, paired bands), **plain** (inside a
card or panel: bands and rules, no holes), **inline** (five rows or fewer: bands only). The
eight invariants hold at every level; convert other screens by swapping markup, one screen per
session, in the spec's order. Evaluation > Responses is the first build.

- **Banding is `data-band`, not `:nth-child`.** An expanded detail panel is a sibling row and
  shifts every `:nth-child` band below it; the component writes rows 1 and 2 of every four from
  the row's index within its page, so the rhythm holds whatever is open.
- **The wrapper around a sheet is a block, never a grid.** A grid column sizes to its items'
  min-content, so the roster's minimum width stretched the packet past a 375px viewport and
  nothing ever shrank. A block lets the sheet measure itself and drop columns by `priority`
  (1 is never dropped; the highest number goes first). Nothing shrinks, nothing scrolls sideways.
- **Columns are a weighted spread** (Owner, 2026-09-20): a column is `min` plus `grow`, its
  track `minmax(min, grow fr)`, so every column grows from its minimum in proportion
  (name 2.2, school 1.4, date and status 1, each figure 0.7) and nothing bunches at one
  edge. Content is inset `--ds-inset` (20px on a full sheet) inside the hole strips; the
  crease is full-bleed and comes every ten rows so the "continued" lines count by tens.
- **A preceptor-answered instrument names its Respondent** (Owner, 2026-09-20): who
  answered, or who a pending survey is waiting on, as a column between School and Status;
  its six figures tighten to 48px minimums to make room. Student-answered instruments have
  no such column.
- **Status before Date, and Date is the status's own timestamp** (Owner, 2026-09-20).
  `statusDate` in the packet model decides: Completed shows submitted, Sent shows sent,
  Opened shows opened, Expired shows when the window closed, Revoked when it was recalled.
  A filter set from elsewhere (a "See who") is a chip in the head with a "Show all" word,
  never a bare ×: a way back that is not seen is not a way back.
- **Sort lives in `dataSheetSort.js`.** `sortRows` is what the sheet uses and what an export
  that mirrors the view must call; nulls sort last in both directions; the arrow renders only
  on the active column.
- **The sheet family reads `theme.css`**: `--paper`, `--paper-2`, `--paper-ink`, `--paper-muted`,
  `--rule`, `--band`, `--hole`, `--hole-in`, `--grid`, `--grid-5`, `--up`, `--same`, `--down`,
  `--on-seg`, `--pill-*`, light then dark. Radii: `--aspire-radius-sheet` (3px),
  `--aspire-radius-sheet-plain` (8px), `--aspire-radius-filetab` (9px). `--aspire-radius-tab`
  is the student chart's die-cut index tab and a different shape. Chart-mark radii (a bar
  segment's ends, a delta chip) are component properties on `.rp-packet`, not brand tokens.
- **One paper family** (Owner, 2026-09-20). `--paper`, `--paper-2`, `--paper-ink`,
  `--paper-muted` and `--rule` alias the clipboard's `--aspire-paper` tokens in both themes,
  so the sheet and the Review & Release slips are the same slate paper. The mockup's faintly
  green sheet is not used; do not reintroduce a second paper.

## Evaluation > Responses is a printed packet (RESPONSES-PACKET-1, 2026-09-19)

Four instrument file tabs on a gridded analysis sheet, a continuous-feed roster (the
DataSheet, full level), and a bubble sheet behind every row. The reference is
`docs/mockups/responses-packet-mockup.html`; the parts are `src/components/evaluation/
ResponsesPacket.jsx`, `BubbleSheet.jsx`, `responsesPacket.css`, and the tab.

- **The sheet sits in a manila folder, not on a stack** (Owner, 2026-09-20). `.rp-folder` is
  a plain frame (`--folder*` tokens, both themes) whose top band carries the four tabs.
  **Every tab is the sheet's paper** (Owner, 2026-09-20): paper-coloured, no grid, the
  sheet's own rule for its edge. The four share the width equally (`flex: 1 1 0`), so the
  last one ends at the sheet's right edge and no title stands out. The selected tab rises to
  the sheet with a -1px overlap that erases the sheet's top border beneath it, so pressing a
  tab means "I am looking at this paper"; the others sit 3px lower and behind, with muted ink.
  Hierarchy is position and shadow, never colour. There is no band between the tabs and the
  sheet, and no tab is manila. A tab is a wrapper
  (`.rp-tab`) around its button (`.rp-tab-main`) because the square-arrow at its top right
  (`.rp-tab-preview`) is a second button: it opens the same read-only SurveyPreviewDrawer
  Review & Release opens, with the same icon and tooltip. The mockup's offset sheet behind
  the paper and its -11px tab overlap are gone.
- **The grid is subtle**: `--grid` and `--grid-5` are about 40% lighter than the mockup so
  the squares never compete with a bar or a label. Present, never loud.
- **No Paired scores button.** Every assignment is a roster row, so a matched student's pre
  and post rows already sit together; the button only hid the unmatched and its way back was
  invisible. The Matched pairs figure stays in the basis line.

- **An expired row's "Send again" opens Review & Release; it never sends** (SURVEY-REISSUE-2,
  Owner, 2026-09-20). The button sits in the row's expanded detail, where a status that
  needs a sentence goes ("This link expired before an answer was submitted."), and only when
  `reissueTarget` in the packet model names a workflow and slip for that instrument and
  timepoint (a preceptor Other / Interim period has none: that is a manual send). It sets the
  same `?workflow` deep link the rail uses and hands the dashboard an `arriveAt`, which
  flashes and scrolls to that student's slip once the evidence is in. The reissue itself is
  confirmed on the clipboard, under the endpoint's guards, and lands on its Sent log.
- **The Responses tab names instruments; Review & Release names workflows.** Two lists, on
  purpose. Casey-Fink is ONE instrument at two timepoints here (its tab says "Pre-Rotation and
  Post-Rotation") and two workflows there. `src/lib/evaluationLabels.js` holds the four names.
- **Every number comes from `src/lib/evaluation/responsesPacketModel.js`**, which is pure and
  tested without a browser. Nothing is computed in JSX. It reads the stored Casey-Fink Section I
  means and computes the other instruments' subscale means from item answers at read time; it
  never writes a score.
- **A pair is decided once**, in `caseyFinkResponsesByStudent`: a completed pre-rotation and a
  completed post-rotation response with all three scores in range. The comparison, the
  "baseline only" follow-up and the bubble sheet read the same map, so the students the sheet
  counts are the students the roster can open.
- **The basis line comes before the finding.** Assigned and the pairing count are navy; nonzero
  unfinished work (Awaiting, Baseline only, Expired) is amber; every zero is muted. A paired
  instrument appends Expired and Revoked only when nonzero: a denominator that hides them
  misleads.
- **Distribution first, means second.** The stacked bar is the primary mark; the delta is an
  outline chip, never a filled pill. **The down segment is amber, textured, gapped and
  labelled, and the Table view toggle exists because the neutral segment sits below 3:1.**
  Never make it red: green against red measures dE 4.2 under deuteranopia.
- **Casey-Fink item text is licensed.** The bubble sheet shows item numbers only for it
  (`itemText: 'licensed'`); the other three resolve stems from the stored definition or the
  instrument module, and no stem is copied into the repo. The Owner/Admin response viewer is
  still the place to read a Casey-Fink item in full.
- **Each instrument carries its scoring rule, and the sheet prints it** (Owner, 2026-09-20:
  use what is canon in the instrument; create a rule where none exists). Casey-Fink follows its
  published 2024 scoring instructions: a subscale is the mean of its items on the 1 to 4
  agreement scale, higher is more agreement, and no individual item is an outcome measure
  (the bubble sheet says so). The preceptor instrument's bands are its own anchors: 4 and 5
  meeting or exceeding the expected student level, 3 developing, 2 needing close support, and
  **1 is "Not Observed / Unable to Assess", excluded from every mean and count** like an N/A.
  The two student instruments had no rule on file, so `LIKERT_BANDS` is the ASPIRE rule: a
  mean of 4.0 or above reads as agreed, 3.0 to 3.9 neutral, below 3.0 disagreed. Anchors come
  from the stored definitions in `lib/server/evaluation/content/`; never invent a scale.
- The CSV export keeps its columns, its filename and its old timepoint words; only its rows
  changed to mirror the roster. The roster's timepoint filter offers one option per label
  (`timepointMatches`), so "Pre-Rotation" is never listed twice.

## Contacts can be an address book (CONTACTS-BOOK-1, 2026-09-20)

ASPIRE Connect > Contacts has two drawings: the three-zone screen (`ClassicContacts`) and
the **Address book** (`src/components/connect/ContactsBook.jsx` and `contactsBook.css`),
bound in cognac leather, the same leather as the Interview Rubric (CONTACTS-BOOK-3; it was
oxblood before). The reference is `docs/mockups/contacts-book-mockup.html`, with its brief
beside it. **Since APPEARANCE-STYLE-1 (2026-09-21) there is no Contacts layout setting:
Style decides.** Classic style is the address book, Modern style is the three columns, so
the address book is everyone's default. Mind the name: `ClassicContacts` was the classic
LAYOUT before the book existed, and it is the MODERN style's Contacts now.

- **One data hook, two drawings.** `useContactsDirectory` holds the contacts, the three
  queries, the selection restore order (URL, then this browser's last contact, then the
  first) and the filter. ContactsView calls it ONCE and hands the same `dir` to whichever
  layout is chosen, so switching keeps the open contact, the category and the search. The
  book fetches nothing (a test forbids it) and is split out through `lazyReload`, so a
  person on Classic never downloads it.
- **Classic is frozen.** Its markup moved into `ClassicContacts` unchanged except the call
  sites that now name the shared action (select, Deactivate). A harness rendered it beside
  the pre-change build: every element's geometry and computed style matched at 1440, 900
  and 700px, light and dark. Change Classic only on purpose. Two changes since were on
  purpose: **Repair Preceptor Contacts is gone from both layouts** (CONTACTS-BOOK-2, Owner),
  modal and all, the automatic sync in `PreceptorFormModal` being the only preceptor
  writer; and it carries the follow-up flag (APPEARANCE-STYLE-1), because Modern keeps
  every feature: a `FlagTag` under the name, a mark on the row, and Flagged only beside
  Show inactive, all on the same `handleFlag` write the ribbon uses. Its panels are fixed
  light in dark mode, as they always were; Modern + Dark Contacts shows them that way.
- **A preference follows the person, not the browser.** `src/lib/userPreferences.js` is
  the registry (every key, its legal values, its default) and the store;
  `useUserPreference(key)` (or, for Style and Color mode, `useAppearance`) is the only way a
  component reads or writes one, so two controls can never disagree. The column is
  `user_profiles.ui_preferences` (`20260924000000_user_ui_preferences.sql`, applied 2026-09-20).
  Without it the choice is kept in the browser and Settings says so; with it, the first
  load adopts that browser's choice and the account wins from then on. A new `appearance.*`
  key is one line in the registry. `appearance.contactsLayout` is retired: nothing reads
  it, and rows that stored it keep the key. The color mode is NOT device-local any more;
  see "Style is a material switch" below.
- **The book files by last name**, reading the DISPLAYED name (`contactsBookModel.js`):
  the last word, less a credential after a comma or a Jr/III suffix. A category change that
  hides the open record opens the first entry instead; typing does not.
- **The A-Z index is a scrubber, never a filter** (CONTACTS-BOOK-2, Owner). A letter scrolls
  the list to its header and the whole list stays scrollable; the open record does not
  change. Press and drag (mouse or finger) scrubs through the letters. **The bubble shows
  only for a press, a drag or a keyboard jump** (CONTACTS-BOOK-3, Owner); hover lifts a
  letter on a paper face and a shadow and never goes dark. The bubble is black at 55% over
  a 2px blur (the mockup), dead centre of the list, a SIBLING of the scroller so it never
  scrolls. The column captures the pointer and is
  `touch-action: none`; a letter with no entries is disabled and `pointer-events: none`,
  so a drag passes over it to `nearestLetter`. Letters are buttons (Enter jumps); there is
  no pressed state, because a jump is not a toggle.
- **On the book, the page scrolls and the picker pins** (CONTACTS-BOOK-2, Owner): the back
  row, title and subtitle scroll away, the Contacts | Outreach | Messages | Automations
  picker pins under the app chrome, and the book is everything left in the window. Connect
  reuses the student chart's `useChartViewport` (chrome + picker measured, the rest
  published as `--connect-book-h`). The picker is its own block in the page column
  because a sticky element is bounded by its parent. Classic and every other tab keep the
  fixed `calc(100dvh - 128px)` page.
- **The book lists every contact** (CONTACTS-BOOK-3, Owner): inactive ones are marked
  ("· inactive", muted ink, never Classic's 60% opacity) and can be opened and reactivated
  in the book; there is no Show inactive toggle there. Classic keeps its toggle. Both apply
  the one pure filter in `src/lib/connect/contactsDirectoryFilter.js` with their own rule.
- **The follow-up ribbon** (CONTACTS-BOOK-3): the canonical `FlagRibbon` sewn into the
  cover over the record, with the rubric's state sentence under the organization, a mark
  on the list entry, and a Flagged only chip. `.ab-ribbon` is `.sc-ribbon` value for value
  (a test holds them equal). The column is Owner-gated
  (`20260925000000_contact_followup_flag.sql`); without it the ribbon is inert and says so.
- **A contact's status is not its record.** `/api/contacts-upsert` routes a body of
  `{ id }` plus only `is_active` / `flagged_for_followup` through
  `api/lib/contactStatusUpdate.js`, before the record validation. Until CONTACTS-BOOK-3
  every Deactivate and Reactivate (which send `{ id, is_active }`) was refused for having
  no `full_name`, in both layouts.
- **The plate wears Student Profiles' icons** (Mail, Phone, Pencil at 15px) and LinkedIn is
  `/linkedin-logo.svg` on a fixed white face (a blue wordmark goes muddy on dark paper).
- **The pages sit on the rubric's own fore edge** (`.material-forestack`, untouched) on
  both sides (Owner, 2026-09-21: "I like the stack you used in interview rubric"; a
  gold-tinted copy was tried first and dropped). The gilt hairline is its own element
  (`.material-cover-tooling`, shared with the rubric) because the cover's pseudo-elements
  are the stack.
- **Where the book leaves the mockup, on purpose.** The cover's deep drop has a negative
  spread (the pane is a scroll container). Dark mode lifts the cognac used as INK
  (`--ab-accent`), because the cover tones sit too close to the dark paper. The open
  entry's subline reads `--ab-mute-on-tint`. Copy visible emails stays, quietly, on the
  count row. Swept: every text node, both themes, every branch open, zero failures.
- **The link beside Refresh is retired** (APPEARANCE-STYLE-1). Refresh stands alone again.

## Style is a material switch (APPEARANCE-STYLE-1, 2026-09-21)

Two per-user choices that combine freely, both in `user_profiles.ui_preferences` through the
registry: **Style** `appearance.style` (`classic` | `modern`, default classic) and **Color
mode** `appearance.colorMode` (`light` | `dark` | `system`, default **light**: the brief said
System, the Owner kept Light until the portals get a setting of their own or a toggle in
place of Refresh). The rules live in `src/lib/appearance.js`; the reference is the Owner's
`settings-appearance-mockup.html`.

- **Modern turns materials off; it never forks a screen.** Every screen keeps ONE component
  tree. Its material rules go quiet under `:root[data-style="modern"]`, mostly as token
  overrides, with `display: none` only for pure decoration (pins, rings, clips, gilt, page
  stacks, tractor holes). Layout, data, actions, shortcuts, permissions and status colours
  do not change. A ribbon becomes `src/components/shared/FlagTag.jsx`, the same flag with the
  same write. Contacts is the one exception, because its two drawings already existed.
- **Where it applies is a list with an honesty flag.** `STYLE_SURFACES` names the seven
  screens with a material; Settings marks any whose Modern is not built as **Coming**. As of
  this build only Contacts switches. A session that builds a screen's Modern flips its
  `modern` flag in the same commit. Automations has no equipment panel, so it is not on the
  list; add it when a material for it ships. Messages stays a plain chat in both styles.
- **`data-theme` is always the RESOLVED mode** (`light` | `dark`). Every dark rule keys on
  `[data-theme="dark"]` and none on `prefers-color-scheme`, so System is resolved in
  ThemeContext rather than by removing the attribute (the brief's shape would switch dark
  mode off for every System user). `data-style` sits beside it.
- **Paint before React, from the device; correct from the account.** index.html paints from
  a device mirror (`aspire-color-mode`, `aspire-style`) before first paint, and
  `useAppearanceSync` (staff app only; the portals keep the device's appearance, Owner) paints
  the account's choice once it has been read. A key the account has not stored paints
  nothing until the read has happened. A new device therefore shows its default for a
  moment after sign-in the first time, and never again.
- **The migration reads `aspire-theme` and never writes it.** The old build wrote that key
  only when a person clicked a theme, so it means "chosen"; the store's `legacy` seed adopts
  it into an account with no color mode. The mirror has its own key because a Light painted
  only as the default, written to `aspire-theme`, would read as a choice on the next load
  and could outvote a real Dark from another device (found in the harness, fixed before
  commit). `test/appearanceStyle.test.mjs` runs the index.html script over 200 stored states.
- **A refused save puts the earlier choice back.** `useAppearance` paints, saves, and on an
  error calls `store.restore(key, from, to)`, which undoes only if `from` is still on screen.
- **Settings lives in "Settings is Apple's System Settings" below**; Appearance is General's
  row at `/settings/general/appearance`.
- **The header's light/dark button** (`ColorModeButton`) shows what is painted and sets the
  opposite as an explicit choice, System included. It hides below 560px, where a fifth icon
  crushed the brand from 87px to 41px; Settings still switches there.

## Settings is Apple's System Settings (SETTINGS-HIERARCHY-1, 2026-09-21)

Two panes, never three. The Owner reference is `settings-appearance-mockup (1).html` with
`settings-hierarchy-fix-prompt.md`; this reversed a one-day-old flat rail.

- **The rail is the top-level destinations only**: Workspace (General), Administration
  (Accounts & Access, Community Benefit, Keith), Diagnostics (Demo Mode, Preceptor Parity),
  each still behind the role gate it always had. Icons are the ones Settings already used,
  monochrome, no tile.
- **General and Keith are list pages**: one grouped `SurfaceCard` list of drill-in rows
  (icon, title, grey line, chevron), each a real `<button>`. General's rows are About,
  Appearance, Email Signature, Tours & Help; Keith's are Knowledge Center, Skills, Usage &
  Cost. A drill-in is a registry entry with `parent` and `sub` in `settingsSections.js`;
  `childSections(parent, roleFlags)` is the list. There is no GeneralPanel and no KeithPanel.
- **A drill-in opens in the same right pane**, under a breadcrumb (`‹ General / Appearance`,
  `aria-current="page"` on the last part), at its own route under its parent
  (`/settings/general/appearance`, `/settings/keith/skills`), with the PARENT selected in
  the rail (`current.parent || current.key`). Back and Forward work because every step is a
  real route.
- **Old paths redirect, with replace**: `LEGACY_SETTINGS_REDIRECTS` maps `/settings`,
  `/settings/appearance|signature|tours|about` and `/settings/knowledge`; anything else
  unknown, or not this role's, falls to `/settings/general`. `/settings/keith` is the Keith
  list now, not a redirect to Knowledge Center.
- **The left selection canon is ONE sheet: `src/styles/selectionRail.css`.** It was Review &
  Release's rail (`.rr-nav`, `.rr-nav-group`, `.rr-row-select`, `.rr-row-label`), moved out of
  `reviewReleaseClipboard.css` verbatim, with the three variables it reads now defined on the
  rail itself. Both screens import it. A computed-style fingerprint of Review & Release's
  rail (17 elements, 19 properties, both themes, 1440 and 820px) matched `main` exactly. A
  host places the rail and may add a column to its rows (Settings adds an icon); it never
  restates the rail's look. Where a screen stacks is the host's: Settings stacks at 900px,
  where the canon's own rail stops being sticky.
- **A drill-in's heading is its row's name.** The Skills workspace was titled "Keith" from
  when it was all of Keith's settings; under "‹ Keith / Skills" it is titled Skills (Owner:
  content may change where the hierarchy needs it to make sense).
- **Every page opens with the same header band (SETTINGS-BAND-1, Owner, 2026-09-21)**:
  `SettingsPageHeader`, which the rail's column wears too ("Settings", as an h1). One fixed
  shape: a 36px title line (title, an access note, the page's actions) and ONE 20px
  subtitle line, reserved even when empty, then `--aspire-gap-card`. Equal bands put
  "Settings" and every page title on one baseline and the rail card and every page's
  first card on one line, measured on all 13 pages in both CSS load orders down to 1000px.
  Rules that keep it true: a page draws no title of its own; a subtitle is one sentence of
  85 characters or fewer (a test counts them), and longer guidance moves into the page
  (Preceptor Parity's method is a closing How This Check Works card); the band renders in
  loading and error states too; an action row must fit beside its title, so an edit that
  belongs to one card sits on that card (Community Benefit's rate and hours buttons are
  on Reporting Inputs; its band keeps the fiscal year and the export). A drill-in's
  breadcrumb rides the back link's row, over the page column. Below about 1000px a page
  whose actions cannot fit wraps them and drops below the line; nothing overflows.
- **A destination reads the same size in the rail and in a list**: a list row's title is
  set exactly like a rail label (13.5px, 600), icons 16px on both sides.
- **An override must win in either load order, because the build does not promise one.**
  `selectionRail.css` is its own CSS chunk; on the live site Settings' sheet loaded FIRST,
  an equal-specificity `.settings-rail-row` lost to `.rr-row-select`, and every label slid
  right. The harness had loaded them the other way, and my "identical to main" fingerprint
  glued the sheets in the order I expected. So a host override carries one class more than
  the canon rule (`.rr-row-select.settings-rail-row`), the canon's own 900px unpin lives in
  its sheet after its base rule, and verification renders BOTH orders and compares them.

## A report is one population (DEMO-DATA-1, 2026-09-21)

"We're not supposed to mix real and fake data" (Owner). Demo students were being summed
into Settings > Community Benefit, because its two staff endpoints read through the raw
service client, outside the demo boundary. Now:

- `api/lib/communityBenefitData.js` scopes any client that arrives WITHOUT a boundary to
  real rows (`scopedServiceDb(client, false)`); a boundary a caller already applied (demo
  or real) is kept. The staff report and export join the boundary through
  `serviceDbForRequest`, like the Nursing Academics copies, so a demo shows demo rows only.
- Capstone hours have no `is_demo`; they follow their cohort (`capstoneRowsInScope`).
  `cohort_id` is an FK with ON DELETE SET NULL, so a row naming a cohort outside the
  scoped list names the other population's cohort, and a row naming none is real.
- "No header, no filter" (lib/server/demoScope.js) was right only before is_demo existed.
  Anything that AGGREGATES real people into a number or a list must not inherit it.

### The audit (DEMO-DATA-2, 2026-09-21)

All 76 server files that read boundary tables through a raw client were audited. About 60
act on one record the UI chose inside the boundary (an id, a token, the caller's own
row) and are correct as they are: the id already pins the population. The rest are fixed,
and the rules they follow are these.

- **`populationDb(db, req)` is the client for anything that sweeps or aggregates.** An
  explicit `x-aspire-demo: 1` (or `?demo=1`) reads demo rows; everything else reads REAL
  rows, including a request that says nothing and a cron that has no request. It mutates
  the client, so wrap a client built for this request or a module-level client whose scope
  never changes (a cron's). Never wrap a shared client with a request-dependent scope.
- **Every cron that builds a service client wraps it**, and the two hand re-runs
  (`api/admin/resend-*`) read what their crons read. `test/demoDataBoundary2.test.mjs`
  sweeps `api/cron/` and fails on a bare `createClient`; the five exempt crons (queue
  workers, a two-id correction, a per-student rpc) are listed there with the reason.
- **The wrapper filters the ROOT table, never an embed.** A root with no `is_demo`
  (program_events) read with `students!inner(...)` must select the student's `is_demo`
  and run `narrowByEmbed`, or a demo student's event reaches a real coordinator's digest.
- **notification_log has no `is_demo`.** A row is demo when it was addressed to a demo
  address, or when its subject student is a demo student (a real interviewer's reminder
  about a demo candidate is a demo row). `sendLogPopulationFilters` is that rule as
  PostgREST filters, inside `applyFilters`, so Sent History's list, exact count and KPIs
  agree; `narrowSendLog` is the same rule in memory (Keith's recent communications).
  Both spell out NULLs: `not.ilike` and `not.in` drop a NULL row.
- **`sendNotification` sends through `createMailer()`.** It used to construct Resend
  itself, so its thirteen call sites bypassed the demo recipient guard.
  `test/demoMailer.test.mjs` now sweeps `src/` too.
- **Demo units carry real unit names** ('6 NE', '5 North'), so anything that resolves
  people BY UNIT crosses populations unless it is scoped: the unit form's CC
  (`recipients.js`, real only), the Student Portal's leadership (the student's own
  population), Keith's roster, and Unit Leader alerts (`unit-leader-decisions.js` sends
  none for a demo row; nominations have no `is_demo`, so their cohort answers).
- **A server-side insert made in a demo session stamps `is_demo`.** The browser stamps
  its own inserts; `api/contacts-upsert.js` now stamps its one.
- Found and left alone: `api/list-portal-access.js` reads contact avatars by email, and a
  demo address never matches a real account, so nothing can show.

## Both books wear one cover (BOOK-COVER-1, 2026-09-21)

"Use the same exact cover you're using in address book" (Owner). The Interview Rubric and
the Contacts address book are one cover, defined once:

- **The leather is `.material-leather-cognac`** (the fine grain) and **the gilt rule is
  `.material-cover-tooling`**, a span first inside the cover. Both live in
  `aspireMaterials.css`. The rubric's pebbled hide and `--aspire-noise-hide` are deleted:
  one cover cannot have two grains.
- **The corner and the boards are tokens** in `aspireBrand.css`: `--aspire-radius-book`
  (8px), `--aspire-book-board` (15px above and below the pages), `--aspire-book-board-x`
  (16px of leather outside the stack) and `--aspire-book-stack-w` (13px of fore edge).
  `--rb-*` and `--ab-*` read them; neither book writes a number. `useBookScale.js`
  mirrors them for its arithmetic, and a test holds the two equal.
- **The page stack is exactly the pages' height** (`--fore-crop: 0px`, Owner: "the same
  height (top and bottom) as the pages"). Both books read it.
- **Pages are square in both books** (Owner: "because they're pages"). The address book
  used to round its paper on `--aspire-radius-sheet`.
- **The rubric's head spans the page AND the index**, and the index starts below it. The
  head is a child of `.rb-spread` in a row of its own (`grid-template-rows: auto
  minmax(0, 1fr)`), not of the rubric page; the candidate page, the seam, the spine and
  the ribbon run both rows. The scoring guide drawer stays inside the page, so opening
  it never moves the index. On the candidate's side of single-page mode the head is
  hidden and its row collapses. The head's narrow rule asks the spread
  (`@container rb-spread`), because it left the page's container.
- **The index is the page's own paper**: the rail and the tabs are `--aspire-page` with a
  hairline edge, not the tinted strip they were.
- **A border paints over the background.** The head's bottom hairline stayed light grey
  across the shading at the gutter, where the band above and the fold below are both
  dark, so it read as a white stroke exactly where the paper turns. The head has no
  bottom border; the band's own edge is the line, and the lift shadow draws it once the
  page scrolls.
- **The spine is a crease, and both books have one** (BOOK-COVER-2, Owner, 2026-09-21:
  "keep it for both but make it subtle. it's meant to be a shadow or a crease when a book
  is folded"). `.material-book-spine` is three translucent steps of the leather's darkest
  brown (`--aspire-book-spine-edge / -spine / -crease`, alpha 0.07 / 0.18 / 0.34, one
  value in both themes, because a shadow darkens with the leather under it), 28px wide
  (`--aspire-book-spine-w`). Each book only places it on its own fold: the rubric's as a
  grid item on the seam, the address book's absolutely at 38%, and it hides where the
  address book's pages stack. It used to be an opaque near-black band.
- **The rubric's tabs come straight off the page**: no inset and no rule between the page
  and the index, the chart's minimal `--aspire-radius-tab` on the outer corners, and the
  current tab open on its page side so it joins the page. The tab is turned 180deg, so
  the box's right side is the page side.
- **Not shared, on purpose:** the address book keeps its own paper and ink (it follows the
  theme; the rubric's white pages do not).

## The Catalog is a bookcase (CATALOG-REVAMP-1, 2026-09-23)

The ASPIRE Catalog (`/catalog`) is where staff find a resource and send it (Phase 1), collect
a form (Phase 2) or get a document signed (Phase 3, behind `catalog.signatures`, off until
Legal and IT approve). Reference: `docs/mockups/catalog-mockup.html` with
`docs/mockups/catalog-brief.md`. Every rule lives in `src/lib/catalog/catalogModel.js`, which is
pure and tested without a browser; the page computes nothing in JSX.

- **Style decides the drawing, never the data.** Classic is an iBooks bookcase (covers on
  maple shelves, a sheet torn from a pad for details, a library checkout card for the send
  history); Modern is the plain list and panel. One component tree, one sheet
  (`src/components/catalog/catalog.css`, Classic keyed on `.ctl-classic`). Counts, order,
  actions and keys are identical in both. It is on `STYLE_SURFACES` with `modern: true`.
- **Send is Outreach, never Messages** (Owner, 2026-09-23). A Catalog send is exactly an
  Outreach bulk send (`/api/connect-send-bulk-message`, the file attached by slug) plus
  `catalog_resource_id`, which makes that endpoint write `catalog_sends` and
  `catalog_send_recipients` after the batch, best-effort, recording sent, skipped and failed.
  The To field's tokens are expanded to people in the browser and shown before sending; the
  server only verifies that list. Not Proceeding students are never in a group token.
  `{first name}` in the modal becomes Outreach's `[First Name]`. Over 75 people is several
  batches, each its own logged send.
- **Who**: Owner and Admin send and manage (Outreach's roles); an Interviewer browses and opens
  files only. Widen it in `CatalogPage` (`canManage`) and the Outreach endpoint together.
- **The left list is the selection canon** (`selectionRail.css`), with `.rr-row-select.ctl-rail-row`
  one class stronger than the canon. Forms and Signature documents rows, and the + New
  entries for them, render only when `CATALOG_FEATURES` says the kind is built.
- **Featured is Pinned.** `is_featured` is folded into `is_pinned` by the migration and read by
  nothing. The four stat tiles and the Featured Collections, Recent Updates and Pinned Resources
  panels are gone; the header summary line counts live from active rows.
- **Categories come from `catalog_categories` less retired ones** (`api/lib/catalogCategories.js`);
  no writer hardcodes a list. `forms` is retired, not deleted: its rows stay valid and Manage
  categories lists them for reassignment. Slugs never change.
- **Audience is one value** in the existing `audience text[]`: everyone, students, preceptors,
  schools, staff ("Staff only" reads bold red).
- **A record holds documents now.** `record_documents` + the private `record-documents` bucket
  are a student's or school's filed files, shown as rows in the chart's Documents list (same
  columns) and in the school drawer, opened only through `/api/record-document-open`. Sends
  that reached a record show under "Sent from the Catalog". Schools are keyed by the operative
  name (`schoolIdentity.js`).
- **A personal file moves only on a confirm.** `/api/catalog-personal-files` finds Catalog files
  named for a student (first AND last name), and moves one only for `confirm: true` and a
  student the review offered for that file; it copies, records, hides the row, and deletes the
  Catalog copy last, after the record's copy is confirmed at the same size.
- **Overdue is computed, never stored**: past due and not done (`completionStatus`).
- **Inks**: the app's `--text-muted` measures 4.05:1 on the page; the Catalog reads
  `--text-caption`. Wood inks were measured against the lightest gradient stop behind them
  (a sweep cannot see a gradient). Caveat, the checkout card's hand, loads from Google Fonts
  only when a Classic send history is drawn, with a cursive fallback.
- `supabase/migrations/20260926000000_catalog_revamp_1.sql` is Owner-gated; the app runs on both
  sides of it (a missing column or table reads as "not enabled").
