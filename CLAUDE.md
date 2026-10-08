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
- **Dark mode decides ink per style** (RUBRIC-DARK-INK-2, 2026-09-29). Classic's pages are white
  paper in both themes, so every ink on them (`--aspire-paper-ink`, `-soft`, `--aspire-ink`,
  `-soft`, `--aspire-th-color-inset`) is pinned to its light value on `.rb-spread`; a test holds
  the pins equal to theme.css and aspireBrand.css. Modern's pages follow the theme, so the same
  tokens (and navy, which is an ink here) are redefined for the dark page, and its fields are dark.
  Measured on the real screen before shipping: 0 failing text nodes or form values in all four
  style and theme combinations, both pages, editing and read-only (it was 62 + 22 and 97 + 12).
  No dark rule may name the book's answers, scores or buttons: it out-ranks their selected state.
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

An index tab does not travel when the scroll spy changes: the chart's current tab slid
6px, so the whole rail twitched the length of the record. The current tab is named by
colour and weight.

**The ribbon peeks, from a pinned top (RIBBON-MOTION-1, Owner, 2026-09-30).** This
replaced RIBBON-CALM-1's still ribbon, whose failure was that the rubric's hover grew its
PADDING and moved the target out from under the pointer. All three ribbons (rubric, chart,
address book) are one shape, `.material-flag-ribbon` in `aspireMaterials.css`, with the
tokens `--aspire-flag-ribbon-*` in `aspireBrand.css`: 40px resting, 48px while an
unflagged, enabled ribbon is pointed at ("you can pull this"), 92px flagged. HEIGHT
animates (0.28s ease), never a transform: scaling stretches the notch and the word, and
translating lifts the top off the leather it is sewn into. The notch is a fixed 10px, so it
keeps its shape at every length; the word sits 17px up from the tail (12 read too low) and rides down with
it; a drag lengthens the ribbon through `--flag-pull`. A flagged ribbon holds its length
on hover and only lifts its shadow. 60px wide so FLAGGED has about 6px either side (it ran
edge to edge at 48 and 54). The shape is scoped to `:root:not([data-style='modern'])`:
Modern restyles the same button as a pill and keeps its slide while dragged. Each book's
own rule only places and colours its ribbon. Reduced motion: no transition. Both books lift the
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
| Student chart | `students.flagged_for_followup` | come back to this student | the roster row, and nothing else (Interview Recommendations showed it too until 2026-09-30; the Owner removed it because it read as the interview flag the rubric then denied) |
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
the hand-seeded `public.unit_leaders` table NO LONGER EXISTS: the Owner applied
`supabase/migrations/20260923000000_drop_unit_leaders.sql` on 2026-09-20 (POST 1: present false,
policies 0, indexes 0). The 2026 hand seed stays in `db/migrations/seed_unit_leaders.sql` as the
record only; nothing recreates the table. The preflight the Owner ran first
(`db/audit/unit_leaders_vs_connect_preflight.sql`) found 26 of 28 units resolving the same lead
from Connect; Float Pool has no Associate Director in Connect yet, so its unit form confirms
with no CC until one is added in Contacts. Rows that only ever lived in the old table are not carried
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

## Student photos have a small copy (PHOTO-THUMBS-1, 2026-09-30)

Headshots averaged 1 MB and every avatar downloaded its original. Each headshot now has a small
copy beside it, `<cohort>/<student>/headshot-thumb.jpg` (256px on its shorter side, about 20 KB),
made by `lib/server/studentPhotoThumbs.js` and the ten-minute sweep `api/cron/photo-thumbs.js`
(which is also the one-time pass over existing photos; it never writes an original). Real and demo
students are swept separately, each through its own scoped client (DEMO-THUMBS-1).

- **The original is the record. The ID badge, Open and Download always get it.** They fetch through
  `fetchStudentFileUrl` / `fetchPortalHeadshotUrl`, which never ask for a small copy, and
  `test/photoThumbs.test.mjs` fails if either badge call site changes. An avatar asks with
  `useStudentFileUrl({ small: true })`; the Unit Leader and Academic Partner roster endpoints
  always prefer the copy (they draw no badge). The student's own portal endpoint is original-only.
- **No copy yet is never a missing photo**: every signer falls back to the original.
- **A replaced photo drops its old copy** at the four places a new headshot lands (staff replace
  cleanup, portal my-avatar, intake submit, portal my-profile); a daily deep run (09:00 UTC) drops
  any copy older than its original. A new upload path for headshots must call `dropHeadshotThumb`.
- Access is unchanged: same private bucket, same path guard, same signed-URL lifetime, and the
  folder delete removes the copy. `sharp` is imported only where a copy is made.

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

- UI work follows `docs/design/table-canon-spec.md` for any table, and the matching mockup in
  `docs/mockups/` for the screen being changed.
- Another session commits to `main` concurrently in the **same working tree**. Verify the
  baseline yourself, stage files **by name**, and for changes touching many files work in
  a `git worktree` off `origin/main` so their uncommitted work is never disturbed.
- Never apply SQL. Migrations are Owner-gated through `docs/security/OWNER_SQL_GATE.md`;
  verification queries go in `db/audit/`, numbered, one section at a time.
- Do not push without explicit approval.
- Leave the untracked `" 2."` / `" 3."` duplicate files alone.
- **`npm test` is green (7,536 of 7,536 on 2026-09-29; TEST-GREEN-1 set the rule on 2026-09-24); keep it that way.** Run it
  before every push and judge it by its EXIT CODE, not by eyeballing the summary. A push that
  turns it red is not a push: fix the code, or, when the change was deliberate, update the test
  in the same commit with a comment naming the commit that changed the behaviour. A test that
  reads source text (a regex over a .jsx or .css) is the usual casualty of a redesign; update
  its pattern to the new shape rather than deleting the assertion. Run it in a worktree with
  no `.env` too: a render test must not depend on the machine's Supabase settings.

## At a Glance is the home (HOME-1, 2026-09-24)

`/aggregate` answers two questions, in this order: what needs me (Needs you, one queue across
every module) and what do I want to do (the launcher). Reference: `docs/mockups/at-a-glance-home.html`.
The page is `src/components/OverviewTab.jsx` (it keeps the Placement machinery: unit responses,
targets, the capacity launches and their return confirmations, both drawers, Set Up Units); its
pieces are `src/components/home/`, its sheet `home.css`, and every figure comes from the pure,
tested modules in `src/lib/home/`. Nothing is computed in JSX.

- **The cycle phase is derived, never stored** (Owner, 2026-09-24): `derivePhase` in
  `cyclePhase.js` reads cohort status, student statuses and the `cohort_school_rotations`
  windows (the 1900-01-01 sentinel is unknown). It orders the sections with CSS `order`; Needs
  you is always first. No phase column exists; do not add one without the Owner.
- **"Behind on hours" is one rule** (Owner, 2026-09-24): `hoursPace` in `clinicalHours.js`.
  Expected hours = required x the elapsed share of the school's rotation window; behind = more
  than `BEHIND_TOLERANCE_PCT` (10) of the requirement short. No window, or before it starts, is
  unknown, never behind. Needs you and the Cohort pulse bar both read it.
- **A Needs you row is navigation, never a decision** (table canon section 2). Each of the six
  sources is its own query through its own module's endpoint and gate (`homeLoaders.js`), so one
  slow or failed source shows a skeleton or "Couldn't load ... Retry" and never blocks the rest.
  A source the viewer cannot use is not listed (never shown disabled). An empty source is hidden;
  "All caught up" shows only when every source loaded and every one is empty.
- **The Owner also sees Keith's Knowledge Center suggestions in Needs you** (KEITH-KNOWLEDGE-SELFCHECK-1
  Phase 3, 2026-09-30): `knowledgeGroup` reads `/api/keith-knowledge-check` `status` (titles only), and
  every row opens Settings > Keith > Knowledge Center on Keith's suggestions (`?filter=keith`). The
  check itself runs on the 1st and 15th (`api/cron/keith-knowledge-check.js`) and from Check now.
- **Review & Release has one queue builder**: `src/lib/evaluation/reviewQueueBuild.js`, read by
  the clipboard AND Needs you, so they cannot disagree about ready and blocked.
- **On this page only**, the Keith orb, the Messages dock launcher and the Feedback launcher are
  withheld (`hideLauncher` / `hidden`), and so is the header search, because the launcher is that
  field in larger form (Owner, 2026-09-24). Every other screen keeps all four. The header's
  ASPIRE Connect icon carries the needs-reply badge everywhere, unchanged. The launcher's
  "Ask Keith" row opens Keith's own drawer through `src/lib/keithBus.js` (`askKeith`). While that
  drawer is open, the orb shows here too, so Keith can be put away as everywhere else; closed, it
  is withheld again (KEITH-ORB-HOME-1, Owner, 2026-09-30).
- **The clock is the viewer's.** The banner draws the greeting, date and time by the viewer's
  clock in both styles; in Classic it hides the Masthead service's own greeting and clock inside
  the card's shadow root (`.mast-greet`, `.mast-date`, `.mast-clock`) and keeps its scenery and
  weather. The underlying city-time bug lives in the Skyline service, not this repo.
- **Classic is a desk, Modern turns it off.** Blotter, cognac corners, stitched edge, window
  frame and sill, manila folder with index cards, the Calendars' `.pl-rings` on the Today
  notepad, a paperclip, a loose sheet (Placement, with no stack under it since 2026-09-25), receipt tape, rubber stamps; all
  decoration is `aria-hidden` and hidden under `:root[data-style="modern"]`. Papers keep dark
  ink in Classic dark (the paper tokens are restated for `[data-theme="dark"] .hm-classic`,
  because `[data-theme="dark"] .hm-page` outranks `.hm-classic`). A gradient surface also sets a
  solid `background-color` (its darker stop) so a contrast sweep reads the real ground. Swept:
  every text node, all four combinations, zero failures, lowest 5.12:1.
- **Placement is one line plus a collapsed panel** holding two MIRRORED plain sheets (Owner,
  2026-09-25, overriding canon section 8's inline rows for capacity): the same three columns
  (a name, two right-aligned figures), toolbar rows of one height so the heads align. A
  school's View response opens from its expanded row, above its students.
- **Today opens on the view with something in it** (`defaultTodayView`): Schedule, else On
  campus today, else Schedule; the person's pick wins. The switch is the canonical
  `SegmentedPicker`.
- **Needs you fills its width**: `auto-fit` columns, so one or two areas span the card; a
  group shows 8 rows in two columns when alone, 5 with one other, else 3 (`rowsFor`).
- **The quick-action chips are a 3 x 2 grid** the width of the search field (2 columns on a
  phone).
- **The six chips and typed requests** (LAUNCHER-2, Owner, 2026-09-30): Send for signature, Send
  outreach, Schedule an interview, Upload a receipt (Owner only, as every Budget Tracker write
  is), Find a file, Find a contact; a viewer who cannot use one gets the next from
  `QUICK_ACTION_FALLBACK`. Build a form, Send a file and Add a contact are found by typing.
  `matchActions` in `launcherModel.js` is the ONE rule for a typed request: filler dropped, each
  action's `words` count with its title, offered at half the words, `strong` at all of them.
  Keith reads the same rule (the launcher hands it the action list through `askKeith`): a
  strong match is answered with a "→" button and no model call, a partial one puts the button
  under the model's reply. Keith still performs nothing itself. Find a file and Find a
  contact arrive as `?find=1`, which focuses the Catalog's and both Contacts drawings' search.
  Schedule an interview opens the Interviews worklist on Not Scheduled (`?filter=`, read on
  every arrival because that tab stays mounted): a student is scheduled by the row's
  scheduling link, not by booking a slot. Send a file (`/catalog?send=1`) and a person's Send
  a form (`?send=form&student=` or `&contact=`) put a "Choose ..." notice on the Catalog
  (Owner and Admin only); the chosen item's Send opens with that person ALONE in the To field
  (`personToken`, the To search's own token, or nobody), and nothing is sent from a link.
- **A planned shift works alongside its preceptor**: `student_shift_plans` stores the date and
  the preceptor's name, so its type is that preceptor's `shift_type` (matched by name), then the
  student's assigned preceptor's, then `students.shift_assigned`, then Day; Variable is skipped
  (`plannedShiftType`). A logged shift uses its own type.
- **Recent activity never shows the viewer's own work**: every source records an actor
  (a signer's `user_profile_id` and email, the form link's email, the assessment's
  `respondent_email`, the resolving profile, and the bulk send's `metadata.sent_by_email`),
  and `isViewersOwn` matches the viewer on profile id or email.
- **The welcome tour keeps its anchors**: while it runs, the four withheld controls come back
  (`hideHomeChrome` in StaffApp), because the tour skips a step whose anchor is missing.
- **Placement's actions are the canonical white button** (Owner, 2026-09-25): Set Up Units,
  Send Capacity Request and Send Reminder to Pending Units are `NavigationPill` (white at rest,
  grey on hover, nightfall when pressed), never a bespoke navy or outline button.
- **Requests by school filters students, not schools** (Owner, 2026-09-25): All, Placed (a
  `matched_unit_id`) and Needs outreach (status Pending Outreach only), from `REQUEST_FILTERS`
  in `placementSummaryModel.js`. The Academic Partner portal's "Needs Outreach" also counts
  Form Sent; the two are different questions and stay different.
- **Email Academic Partners opens a draft; it never sends.** The button writes the
  `ACADEMIC_PARTNER_REQUEST` launch context, so Outreach > Send to Many opens with the Academic
  Partner Placement Request template and every active Academic Partner contact with a valid
  email selected. The template asks for this cohort's requests through the portal button or the
  school form button, and carries `[Cohort Request Password]`, which the sender types over.
- **A required placeholder blocks the send**: `REQUIRED_PLACEHOLDERS` in
  `src/lib/connect/requiredPlaceholders.js`. The composer disables review and send and says
  which one is left; `/api/connect-send-bulk-message` refuses with 400 `unfilled_placeholder`
  on both paths. A password is never filled in by the app.
- **The Cohort pulse does not move** (Owner, 2026-09-25, reversing the wave the same day):
  the current stage is the one solid arrow, and nothing travels through the others.
- **Unit Setup is a compact table** (Owner, 2026-09-25): one line per unit grouped by service
  line (checkbox, unit, slots stepper, shift, Details), a search, All units | Participating
  only, and a pinned summary of units, slots and proceeding students with its verdict. The
  rules are `src/lib/unitSetupModel.js`; the sheet is `src/components/unitSetup.css`, on theme
  tokens, so the panel now follows dark mode. `handleSave` is unchanged: an unchecked unit is
  marked not participating, never deleted. A legacy 'Either' shift reads as No Preference
  (`ImportUnitsCSV` still writes 'Either').
  It opens in the standard side drawer (`DetailDrawer`, as School and Unit responses do) at
  860px, with no accent edge; service lines are sections on the drawer's white surface.
- **The Classic desk, round 3** (Owner, 2026-09-25): paper is square and lifts on a shadow,
  never an outline (notepad, report and loose sheets, tape, index cards, and the Placement
  sheets inside them); the folder, corners and window keep their shape. Recent Activity's
  tear is the Catalog's torn-sheet mask (catalog.css `.ctl-detail`) turned to the bottom
  edge, with the shadow on `.hm-tape-wrap` because a mask clips the element's own shadow;
  the wrapper also carries the section's phase `order`. Every inline SVG in a `url()` escapes
  `#` as `%23` or it silently draws nothing.
- **The desk is the mockup's** (Owner, 2026-09-25): blotter `#2A3886 / #1E2A6E / #18225C`
  (dark `#1E2766 / #151C4A / #0F1438`), cognac corners `#9A6236 / #7A4A26 / #5A351A` at 78px,
  a 2px cream stitch that is `.hm-classic::after` at the corners' layer so it runs OVER the
  leather, and 44px below the desk. The glass meets the wood on a dark inner edge; a white
  ring read as a hairline.
- **Placement is always above Recent Activity** (Owner, 2026-09-25), in every phase; the
  mockup put it last in Recruitment, Interviewing and Evaluation. `PHASES` in `cyclePhase.js`
  holds the orders and a test checks the pair in every one. The window's glass
  is a top sheen, a corner glare and two reflection bands under the greeting and launcher.
  Today and Cohort Pulse start on one line with the rings and the drawn wire clip
  overhanging, and the Today picker sits 12px under the double rule.
- **The segmented picker has a dark pair**: `--seg-active-ink` and `--seg-rest-ink`, defined in
  theme.css for dark only (white on the lifted accent was 3.03:1). Classic dark restates
  `--chart-warn-*` to their light pair, because its papers stay light.
- **The scenery shows in both styles** (Owner, 2026-09-25). `HomeBanner` renders one scene
  (the service's `<skyline-card>`, the viewer's greeting and clock, the launcher); Classic
  wraps it in a SQUARE wooden window with glass and a sill, Modern shows it as a card. The
  scene is `width: 100%; aspect-ratio: 5 / 1` and grows to fit its content, so it carries no
  overflow clip and no min-height (a ratio box with either stops growing, or turns a minimum
  height into an 880px width on a phone); the scenery layer (`.mast-host`) clips instead.
  The banner injects `.mast{margin-top:0;border-radius:0;box-shadow:none}` (all `!important`)
  into the card's shadow root with the clock rule: the service's own 16px margin pushed the
  scene down the window, and its own rounded, shadowed face under the scenery layer's clip
  drew a dark fringe at every corner. `.mast-host` is the ONE edge (navy fallback, radius,
  clip); the scene itself paints nothing.
- **A style switch never rebuilds the card** (Owner, 2026-09-25): the scene sits in one
  wrapper in both styles (`hm-window` or `hm-frameless`), so switching changes a class. The
  injection also re-runs for any `skyline-card` added to the scene later (a MutationObserver
  that only reacts to an added card), because a rebuilt card came up with the service's
  greeting over ours and the 16px gap until a reload.
- **The weather opens the city picker**: the content layer over the scenery is
  `pointer-events: none` and only the launcher takes clicks, and in Classic the banner sits
  at `z-index: 5` above the cards after it, so the service's picker covers the page.
- **The glass's reflection moves with scroll**: `.hm-window-glare` is twice the pane's width
  and slides by `--hm-glare-x`, which `useScrollGlare` sets from the window's position
  (any scroll container, rAF-throttled, off under reduced motion).
- **The quick actions show only while the launcher is in use** (Owner, 2026-09-25): from the
  field's focus until focus leaves the launcher, so the scenery is seen. A chip prevents
  mousedown so the field keeps focus and the click lands (Safari never focuses a clicked
  button); Escape on an empty field puts the launcher away. `.hm-chips[hidden]` must beat
  the grid's own `display`.
- **A new staff page starts at the top** (SCROLL-TOP-1, 2026-09-25): `useScrollTopOnRoute` in
  StaffApp scrolls the window up on a PATH change, never on the first load, Back/Forward or a
  query-only change. React Router keeps scroll by default, and Rotation's fixed-height
  workspace inherited At a Glance's offset (top under the header, blank page below).
- **Rotation > Activity is labelled Shift Log** (Owner, 2026-09-25) in the Rotation picker,
  the launcher and the Action Center button; the route stays `/rotation/activity`, and the
  calendar inside keeps the portals' shared title, Rotation Activity.
- **The clipboard clip is one material** (CLIP-1, Owner, 2026-09-26): `.material-clipboard-clip`
  in `aspireMaterials.css` is the small spring clip Action Center and Outreach > Recipients
  wore as two copies; each host only places it (and sets `display`, so Modern can hide it).
  At a Glance clips Cohort Pulse and Placement with it; Today keeps the Calendars' planner
  rings. Review & Release's 190px pressboard clamp is a different object. The Classic desk
  casts no outer shadow.
- `TodayMasthead.jsx` is retired; the staff masthead host is `HomeBanner` (both styles). Unit
  leaders use their own portal, not this page.

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
- **The paper is whiter than the mockup's** (Owner, 2026-09-30): `--ab-page` `#FFFEFC` and
  `--ab-page-2` `#FAF8F3`, from `#FEFCF8` and `#F7F3EC`. The old tint was 1.3 dE from the
  app background, the same colour to the eye, and it is what the search field, chips,
  letter tabs and notes block wear, so the page read as the background. Now 4.7 and 2.4 dE,
  a whisper of warmth kept. Dark mode is unchanged. Settings' Classic preview mirrors both.
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
- **Every cron that builds a service client wraps it**, and the one hand re-run
  (`api/admin/resend-coordinator-digest.js`; S-13 retired the interview-reminder one)
  reads what its cron reads. `test/demoDataBoundary2.test.mjs`
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
a document signed (Phase 2, behind `catalog.signatures`, off until Legal and IT approve; see
"Signatures are sealed" below) or collect a form (Phase 3, see "Forms are versioned and filed" below). The order is the Owner's, on purpose. Reference: `docs/mockups/catalog-mockup.html` with
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
  one class stronger than the canon. Forms and Signature templates rows, and the + New
  entries for them, render only when the kind is built (`CATALOG_FEATURES`) and, for
  signatures, when the server's flag admits the caller (`useSignaturesFlag`).
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
- **The list's action column is one width** (CATALOG-ALIGN-1, Owner, 2026-09-24):
  `--ctl-acts-w` fits Send for signature plus the menu, so Status lines up under its header in
  every row. Each row is its own grid; an `auto` last column let each button move Status.
- **Overdue is computed, never stored**: past due and not done (`completionStatus`).
- **Inks**: the app's `--text-muted` measures 4.05:1 on the page; the Catalog reads
  `--text-caption`. Wood inks were measured against the lightest gradient stop behind them
  (a sweep cannot see a gradient). Caveat, the checkout card's hand, is the fourth
  self-hosted OFL family (`public/fonts/caveat/`, Owner 2026-09-23), declared in `fonts.css`
  and not preloaded; nothing in the app loads a font from Google.
- `supabase/migrations/20260926000000_catalog_revamp_1.sql` is Owner-gated; the app runs on both
  sides of it (a missing column or table reads as "not enabled").

## Signatures are sealed (SIGNATURES-PHASE2, 2026-09-23)

The Catalog's Phase 2 is ASPIRE's own e-signature engine: prepare a PDF, place fields, send,
track, and seal. Reference: `docs/mockups/signatures-mockup.html` with
`docs/mockups/signatures-brief.md`. It is **behind `catalog.signatures`, OFF by default**, in
`feature_flags` (state `off` | `owner` | `on`; `owner` admits the Owner only, for testing in
production, `on` admits Owner and Admin). The flag is asked of the SERVER (`sig-staff` `flag`,
read by `useSignaturesFlag`); no client constant turns it on, and every entry point (the rail's
Signature templates and Signature requests, + New's Prepare, a signature item's Send, Edit
fields and Preview) is hidden until it answers yes. Both endpoints answer 404 while it is off.
Owner decisions, 2026-09-23: ASPIRE's own self-signed seal for now, codes by email only (no
SMS), PDF uploads only (no Word conversion), tamper-evident storage with `org_id` on every table.

- **Where things are.** Rules: `src/lib/signatures/sigModel.js` (pure, tested). Server:
  `lib/server/signatures/` (`engine.js` the lifecycle, `sealing.js` flatten + certificate page
  + seal, `cmsSigner.js` the CMS signature, `timestamp.js` RFC 3161, `sealProvider.js` the key,
  `verifySeal.js`, `tokens.js`, `mail.js`, `zip.js`). Endpoints: `api/sig-staff.js` (staff,
  Owner/Admin), `api/sig-signer.js` (public, rate-limited, token + code + session),
  `api/cron/sig-maintenance.js` (reminders, expiry, seal retries). Staff screens:
  `src/components/signatures/` at `/catalog/signatures` (Signature requests, Prepare and send,
  Signer preview). The signer's page is `/sign/*` (`src/pages/SignPage.jsx`, light-locked,
  mobile-first, `signerFlow.css`).
- **The key is behind a provider, never in code.** `sig_settings.seal_provider` names one entry
  in `PROVIDERS` (`sealProvider.js`); today `env_p12` reads `SIG_SEAL_P12_BASE64` and
  `SIG_SEAL_P12_PASSPHRASE` (make them with `scripts/signatures/generate-seal-certificate.mjs`).
  An AATL certificate in a cloud key vault is a new provider entry plus a settings row, with no
  change to sealing. A provider signs a digest; the private key never leaves it.
- **Every seal carries two RFC 3161 timestamps** from `sig_settings.tsa_url` (default DigiCert's
  free TSA; only a hash is sent). One is over the flattened content and is PRINTED on the
  certificate of completion; the other is over the signature value and EMBEDDED in the seal as
  an unsigned attribute. A PDF cannot contain its own seal's timestamp, so it needs both. Both
  go in the audit log. A TSA failure fails the seal, and the cron retries it (`seal_attempts`).
- **The audit log is the database's, not the app's.** `sig_events` is hash-chained per request by
  a trigger (the caller cannot supply or skip a hash), and UPDATE, DELETE and TRUNCATE are
  refused. `test/signaturesMigration.test.mjs` proves all of it on real Postgres (PGlite).
- **A link is not a login.** The emailed link is an HMAC of the signer and a link version
  (`SIG_TOKEN_SECRET`; only its SHA-256 is stored), then a 6-digit code by email (HMAC stored,
  10 minutes, 5 tries), then a 2-hour session. A completed, voided, declined or expired
  request closes every link (`linkIsLive`). `link_version` exists so one link can be revoked
  by bumping it; nothing bumps it yet, and a replaced signer is refused by status. A staff signer (matched by email to an active account) signs in the app with their
  password, never through a link.
- **Invitations are the engine's mail, not Outreach.** Each signer needs their own link, so the
  Catalog's Send for signature calls `sig-staff` `send` with the item's template; the mail goes
  through `createMailer()` (the demo guard) and is logged in `sig_events`, not
  `notification_log`. `test/demoMailer.test.mjs` pins every caller of the engine.
- **A template IS a Catalog item.** Saving one writes a `catalog_resources` row with
  `kind 'signature'` and `storage_path 'sig-template:<id>'`. Nothing may treat that path as a
  file: the open, attachment, personal-file and outreach readers all skip it. The detail panel
  offers Send for signature, Edit fields and Preview as signer instead of Open and Download.
- **Completion files the sealed PDF** onto each student's or school's record
  (`record_documents`, source `signature`) and emails it to every party. The sealed file's own
  hash cannot be printed inside it; it is shown in the app, the audit log and the email.
- **Not built, on purpose:** SMS codes, portal sign-in, Word upload, an address prefill source.
  The disclosure v1.0 text is a DRAFT for Legal. Migration
  `20260927000000_signatures_phase2.sql` is Owner-gated; checks in
  `db/audit/signatures_phase2_checks.sql`.

## Forms are versioned and filed (FORMS-PHASE3, 2026-09-24)

Catalog Phase 3: build a form, send each person a personal link, file every submission as a PDF
on the person's record. Reference: section 5 of `docs/mockups/catalog-brief.md` and the builder
in `docs/mockups/catalog-mockup.html`. Owner decisions (2026-09-23): **a form link is the whole
identity check** (no emailed code); **the Signature question is a simple typed or drawn
signature printed on the PDF**, and anything legally binding goes out as a Signature template;
the Parking form follows Parking Services' own form (received 2026-09-24).

- **Where things are.** Rules: `src/lib/forms/formModel.js` (pure, tested: question types,
  prefill sources, validation, answer text, CSV, the starter forms). Server:
  `lib/server/forms/` (`engine.js` the lifecycle, `formPdf.js`, `tokens.js`, `mail.js`).
  Endpoints: `api/form-staff.js` (Owner/Admin), `api/form-respond.js` (public, rate-limited),
  `api/cron/form-maintenance.js` (hourly: reminders, closing past-due links). Staff screens:
  `src/components/forms/` at `/catalog/forms/:id/edit` and `/catalog/forms/:id/responses`.
  The respondent's page is `/form#t=...` (`src/pages/FormPage.jsx`, light-locked, mobile first);
  `FormRenderer` is the ONE form component, so staff "Preview" is what respondents get.
- **Switched on by the database, not a flag.** `CATALOG_FEATURES.forms` is true; the Catalog
  shows forms only once `/api/form-staff` `status` reports the tables exist
  (`useFormsStatus`). Before `20260928000000_forms_phase3.sql` every entry point is hidden.
- **A published version is frozen.** Publishing copies the draft into `catalog_form_versions`,
  whose rows a trigger refuses to UPDATE. New links use the latest version; an assignment
  keeps the version it was sent with, so an answer is always read against the questions its
  respondent saw. The draft saves itself; nothing is sent until it is published.
- **A form's Catalog row is not a file.** `storage_path` is `form:<id>`, like `sig-template:`
  for signature templates. The open, attachment, personal-file and signature-import readers
  refuse both prefixes; a new reader of `catalog_resources` files must too.
- **The link.** HMAC of the assignment and a link version under `FORM_TOKEN_SECRET`, else
  `SIG_TOKEN_SECRET`, in the `form:` namespace (it can never open a signature request); only
  its SHA-256 is stored. A submit claims the assignment by compare-and-set before writing, so
  a double tap files one copy. Uploads are signed URLs into `form-files/uploads/<assignment>/`,
  and a submitted path outside that folder is dropped.
- **Prefill reads the Student Portal's own resolver** (`buildStudentPortalSummary`): legal and
  preferred name, phone, school, unit, rotation dates, preceptor; email is the address the
  link went to. The respondent may correct any of it.
- **Filing.** A submission's PDF goes to the student's (or school's) `record_documents`, source
  `form_submission`; with no record, to `form-files/submissions/`. A PDF failure is logged and
  never loses the answers, which are the record.
- **One tracker for both kinds.** `form-staff` `tracker` returns one completion row per person
  for forms AND signature requests; the Catalog's Out for completion and Overdue people read
  it through `completionStats`. Overdue is computed from `due_at`, never stored.
- **The Catalog panel says who it went to** (CATALOG-PEOPLE-1, Owner, 2026-09-24). A form's or
  signature template's detail panel lists every person (`CatalogPeople.jsx`, fed by
  `form-staff` `people` through `lib/server/forms/people.js`): one row per form link (voided
  left out) or per signature request (named by its first signer, drafts and voided left out),
  with the `completionStatus` word in a pill, a Done / Overdue bar, filters and Remind. Remind
  is each engine's own (`form-staff` `remind`, `sig-staff` `remind`, the latter only while the
  signatures flag admits the caller); a closed, expired or declined link is named, never reminded.
- **CSV.** One version's answers, formula-looking cells prefixed with `'` so no spreadsheet runs
  them, UTF-8 with a BOM for Excel.
- **Starter forms** come from + New > Add the starter forms (idempotent by `starter_key`):
  ScrubEx Request (the mockup's questions) and Student Parking Request (PARKING-FORM-1,
  2026-09-24: Parking Services' own "Students Parking Data" form, field for field; its labels are
  the CSV headers). Both publish. A never-published starter draft that still equals an earlier
  shipped draft (`RETIRED_STARTER_DRAFTS`) is replaced on the next install, as a new version if
  it was published; an edited one never is. A Catalog FILE already under a starter's slug keeps
  it (the ScrubEx PDF is `scrubex-request-form`, which the preceptor attachment reminder reads);
  the starter form takes `<slug>-form` (STARTER-SLUG-1), and a starter that is not added says why. **That automatic path is not enough on its own**
  (STARTER-RESET-1: the Owner's form had the old draft published as v1 and v2, so it never
  qualified). The builder therefore shows "Use the updated starter" whenever a starter form's
  draft differs from its starter (`starterUpdateFor`); one click replaces the DRAFT only
  (`form-staff` `use_starter`), and the person publishes it.
- **A form can file in its paper original's layout** (PARKING-PDF-1, 2026-09-24). The Parking
  request's PDF is drawn as Parking Services' "Students Parking Data (SPD)" page
  (`lib/server/forms/layouts/parkingSpd.js`, positions measured from their form), with the
  organization's document logo, else the shipped Cedars-Sinai PNG. Their PDF is NOT in the repo
  (it is public; Owner chose "redraw their layout"). `layoutFor` picks a layout by starter key
  and only while the answered version still has the layout's core questions; anything the
  layout has no box for is listed on a second page. Every other form keeps the plain PDF.
- **The paper original comes from the Catalog** (PAPER-ORIGINAL-1, Owner, 2026-09-24: "use the
  exact same form and put the fields in the textbox", picked from existing files like
  Signatures). The builder's Paper form card lists the Catalog's PDFs; `form-staff` `paper_set`
  COPIES the chosen one to `form-files/paper/<form id>.pdf` (the Catalog's copy is untouched)
  and accepts only the exact file the boxes were measured on (`PARKING_SPD_SHA256`). With it on
  file, a submission is that PDF with the answers stamped in its boxes; without it, the redrawn
  layout. A different edition of their form needs its boxes re-measured and a new hash.
- **ScrubEx is filed on Linen Services' form the same way** (SCRUBEX-PAPER-1, 2026-09-24,
  `layouts/scrubex.js`). Its questions are that form's (initials, names, department,
  occupation, badge barcode and expiry, one unisex size, scrub machines). Their PDF LOOKS
  fillable, but an iPhone re-save left the AcroForm pointing at widgets that are not on the
  page, so filling fields shows nothing: answers are typed at the page widgets' rectangles, the
  widgets and AcroForm are removed, and the iPhone white-out over "Nursing Education" becomes a
  white patch in the content under the Department answer. ScrubEx has NO redrawn copy
  (`needsPaper`): without their PDF on file, the plain PDF. `layouts/extraAnswers.js` is the one
  second-page list both layouts use.
- **An Outreach button can open a form** (OUTREACH-FORM-BUTTON-1, 2026-09-24). The Button dialog
  offers "A Catalog form" beside "A web address". The button marker stores the FORM
  (`data-form`, plus an optional `data-due` and `data-reminders`), never a link, because every
  form link is personal. `lib/server/forms/outreachButtons.js` is the only forms module the two
  Outreach endpoints import: the send checks every form is published before anyone is emailed,
  then gives each recipient their OWN link (their open assignment on that form if they have
  one, else a new one, audience "ASPIRE Connect Outreach"), and a failed email voids the link
  it made. A preview gets the bare `/form` address and creates nothing. Send-to-one refuses CC
  with a form button: a CC would hand the recipient's link to someone else.
- **A respondent can get their copy again** from the same link (`form-respond` `copy`), with
  Download and Print on the thank-you screen.
- **A form can say what happens next** (FORM-CONFIRMATION-1, 2026-09-24). The builder's "After
  they submit" text (`definition.confirmation`, 500 characters) shows on the thank-you screen,
  each email address in it a mailto link with the form's title as the subject
  (`confirmationParts`).
- **A form can send its filled PDF to an office** (FORM-FORWARD-1, Owner, 2026-09-24). Settings >
  "Email each filled PDF to" (`settings.forwardTo`, read from the form's CURRENT settings at
  submit, so a change needs no new version). On submit ASPIRE emails the PDF from
  `noreply@aspire-program.com` as "<sender> via ASPIRE Intelligence", CCs the respondent, and
  sets reply-to the sender (Owner's choice: the office's questions reach staff, not the
  student). Every attempt is a `notification_log` row of type `form_pdf_forwarded`, which is
  what Responses shows ("Sent to ..." or "Not sent ... Resend", `form-staff` `forward`). A demo
  submission is never forwarded. ScrubEx ships with grouplinenservices@cshs.org; applying a
  starter merges the starter's settings into the form's.
- **The no-account pages wear the organization's brand.** `/form` and `/sign` show the document
  logo and application title from Settings > Organization through `PublicBrand`, which reads
  the public `/api/organization-brand` (title, logo, alt text, and nothing else).
- **Responses has a Sheet** (FORM-SHEET-1, Owner, 2026-09-24: "an excel like or smartsheet
  like view"). People is the tracker; Sheet (`FormSheet.jsx`, `form-staff` `sheet`) is one row
  per submission and one column per question, read live: search, filters (a choice column by
  its options, "Other" by any Other answer), sort on every header (`SortHeader`), show or hide
  columns, a row opens the answers and PDF. Columns follow the LATEST version; a question only
  earlier versions asked keeps its column, marked earlier (`sheetFor`). Unlike DataSheet it
  SCROLLS sideways inside its frame with the header and name pinned, on purpose: a spreadsheet
  that drops columns is not one. **Export to Excel** (`sheet_xlsx`, `lib/server/forms/xlsx.js`)
  is a real .xlsx of exactly the rows and columns shown, in that order, every cell an inline
  string (no formulas), frozen header and autofilter, on the signatures ZIP writer
  (`zipStored(..., { keepPaths: true })`).
- **The Sheet is editable like Smartsheet** (FORM-SHEET-2, Owner, 2026-09-24: "also edit their
  answers"; migration `20260929000000_form_sheet.sql`, Owner-gated). A toolbar formats the
  selected cells (bold, italic, underline, text colour, fill, alignment, wrap, clear), groups
  rows by any column with counts, freezes the name plus up to three columns, and adds STAFF
  columns (text, checkbox, dropdown, date) whose values live in `form_sheet_cells`; headers
  drag to reorder and their edges resize; the layout lives in `form_sheet_views`. Double-click
  or Enter edits a cell. **A correction never changes the submission or its filed PDF**: it is
  an append-only `form_answer_corrections` row (a trigger refuses UPDATE and DELETE), laid over
  the answer by `withCorrections`, tagged Corrected with who, when, the original and an
  optional reason; putting it back is a new correction that ends the tag. Files and signatures
  are never correctable (`CORRECTABLE_TYPES`). Fills and inks are fixed pairs from
  `SHEET_FILLS`/`SHEET_INKS`, every ink at least 4.5:1 on every fill (a test measures them), so
  a formatted cell reads the same in dark mode. A bulk upsert sends every column, so a save
  merges with the stored cell and a format can never wipe a staff value. The Excel export
  carries the order, widths, formats, group rows (outlined, collapsible in Excel) and a
  Corrections column naming each change. Before the migration the Sheet is view-only and says
  so. The editor floats (`position: fixed`) so the scrolling frame never clips it.
- **The Sheet is a grid, not a table** (FORM-SHEET-3, Owner, 2026-09-24: "the grids really look
  like sheets"). Row numbers in a grey gutter, a hairline on every cell, a plain grey header in
  sentence case, compact unbanded rows, a bordered frame: it deliberately does NOT wear
  `.aspire-th` or the row band, which belong to tables. Clicking a header or a row number
  selects the column or row; the range is tinted and only the active cell ringed. Number and
  date formats (`$`, `%`, thousands comma, decimal places, four date styles) change how a value
  LOOKS (`displayValue`), never what is stored; a whole column's format lives on the column
  (`layout.colFormats`), so rows that arrive later wear it. The Σ row (`layout.summaries`: sum,
  average, min, max, count, count filled) summarises the rows shown. A File upload answer is a
  link that opens the file (`form-staff` `file_url`). Email is its own column (`@email`). In
  Excel, a formatted, number or summed column goes out as real numbers with the same number
  format, and the Σ row as real formulas (`=SUM(B2:B30)`) with their values worked out; answers
  are never written as formulas. No new database change: it all lives in the layout row.
- **An empty Sheet is still a sheet** (SHEET-EMPTY-1, Owner, 2026-09-24): before anyone
  submits, it shows the tools, the header and ten blank numbered rows, with the note above the
  grid, so columns, formats and the Σ row can be set up before the first answer.
- **The tab reads Answers, not Sheet** (FORMS-ANSWERS-TAB-1, Owner, 2026-10-02): People | Answers | Summary.
  Only the words changed, as with Budget Tracker's Expenses: the picker's key is still `sheet`, the
  component `FormSheet`, the action `sheet`, and the notes here that say "the Sheet" mean that tab. In
  copy say "in Answers", never "the Sheet".
- **Responses' header** (RESPONSES-CANON-1): People | Sheet | Summary is the shared
  `SegmentedPicker`; Remind all overdue shows on People only; the export is the navy button
  with the download icon, as in NE&L Portal > Contacts.
- **One export: Export to Excel** (EXPORT-ONE-1, Owner, 2026-09-24). Download CSV is gone: it
  held only the current version's answers as submitted, and the Excel export holds every
  version, corrections, staff columns and formats. The header button exports what the Sheet
  shows when the Sheet is open (the Sheet hands its view up through `viewRef`) and, on People
  or Summary, every answer in the Sheet's SAVED order, hidden columns and grouping
  (`sheetXlsx` with no `columnKeys`; a missing `groupBy` means the saved one, an explicit null
  means none). The Sheet has no export button of its own. The builder's toggle reads "Export
  answers (Excel)" and still keys on `settings.exportCsv`. The server's `csv` action stays and
  nothing in the app calls it.
- **Responses has a Summary** (FORM-SUMMARY-1, 2026-09-24), like Microsoft Forms, from
  `summaryFor` over the same answers: choice, checkbox and dropdown questions as horizontal
  bars (one hue, the Catalog navy; count and share at each tip in text ink; 16px bars, a
  named `--fsum-bar-end` radius; no legend, so colour carries no meaning alone), "Other" with
  what people wrote, short answers grouped with counts (case-insensitive), paragraphs latest
  first, numbers and dates as tiles. Measured light, dark and Classic: text at least 6.7:1,
  bars at least 5.6:1 on their card; no overflow at 375px.
- **"Other" with a text box** (FORM-OTHER-1): choice, checkbox and dropdown questions can set
  `allowOther`; the answer is stored as the text `Other: <typed>` so every reader shows it as
  written. One Other per checkbox answer, 200 characters.
- **Build a form can add a category** (FORM-CATEGORY-1): "+ New category…" creates a real
  Catalog category through the Owner-only `catalog-category-update` `create`; Admins see how to
  get one. Never free text: a label outside `catalog_categories` would never list.
- **Tables here follow `.aspire-th`.** Its grey on `#f9fafb` measures 4.37:1 (the app-wide header),
  noted, not changed. `--aspire-row-band` is a light-mode constant, so the Responses table bands
  from the Catalog surface instead.

## Receipts answer one question (RECEIPTS-REDESIGN-1, 2026-10-01)

Budget Tracker > Receipts > Filed, the receipt modal and the Subscriptions month grid answer one
question about every receipt: has it been submitted to Concur, and is it late? Reference:
`docs/mockups/receipts-redesign.html`. Every figure and word comes from `src/lib/budget/filedModel.js`
(pure, tested); the screens are `BudgetFiled.jsx`, `ReceiptModal.jsx` and `SubscriptionMonths.jsx`.

- **One drawing in both styles** (Owner, 2026-10-01, over the brief's "Modern only"): the manila
  folders are retired. Receipts stay white; what holds them (`.bud-holder`: an open month, a folder
  card, the modal's left column) is the tan paper of Rotation > Activity. The tan values are the
  `--aspire-paper-tan*` tokens in `aspireBrand.css`, read by the calendar too; they live there, not in
  theme.css, because the portals' calendars do not load theme.css. In dark the holder is the app's surface.
- **One 60-day rule**: `concurTiming` in `receiptChecks.js` (the owner's `concur_60_days` policy rule;
  late past the deadline, soon at `SOON_DAYS` 14 or fewer). The slip check, the Concur reminder, Keith's
  Concur draft, the chips, stamps and the grid all read it. Only Personal (Concur) receipts are counted
  anywhere; a P-card receipt is Paid and never shows a deadline or the Concur pieces.
- **A Stage change stamps its date wherever it is made** (`concurStamps` in the engine: the receipt, the
  Sheet, Close month) and writes a `budget_event`. A stamp prints the STORED date, never today's; a row
  marked before 20261101000000 with no change to take a date from shows none.
- **The modal's Mark submitted waits for the policy tick only when Keith's draft carries a warning**
  (`needsPolicyConfirm`), and only there: the Sheet and Close month do not ask (Owner, 2026-10-01).
  The tick is stored with who and when; a new draft clears it. Copy ticks are session memory.
- **Undo is `receipt_stage` backwards**, on the server, logged. Replace file and Delete receipt
  (RECEIPT-REPLACE-1) live in the modal's Details.
- **A replacement goes through review** (REPLACE-REVIEW-1, Owner, 2026-10-01: "it should still go through
  Keith review and not bypass that"). Replace file uploads a slip marked `replaces_receipt_id`; Keith
  reads it and it waits in To Review as a `ReplacementSlip`. The filed receipt keeps its file and says
  "Replacement pending review" until the slip is accepted there (`acceptReplacement`: the file swaps in
  place and the slip row goes) or rejected (nothing changes). A replacement never posts rows through
  the ordinary Accept, and one waits at a time. Do not bring back a direct swap.
- **Accepting a replacement updates the Sheet** (REPLACE-SHEET-1, Owner, 2026-10-01: "it should update it
  everywhere"). The slip is fully editable and shows, before Accept, which rows change; the rule is
  `replacementPlan` in `src/lib/budget/replaceModel.js`, read by the slip and run by the server. Rows the
  receipt POSTED are updated, added or removed to match the new reading (paired by category, then in
  order); a row the receipt was only ATTACHED to takes the new total and nothing else. Every change goes
  through `updateExpense`, so it is logged and Stage and payment stay. The filed name follows the new
  date, vendor and total, and Keith's Concur draft is cleared when the Sheet changed.
- **Months are the Owner's to open and close** (MONTH-CONTROL-1, Owner, 2026-10-01). A replacement never
  writes into a closed month: the slip names it and offers Reopen, and the server checks before anything
  is written. A replacement that changes nothing in the Sheet is not stopped. The Close card works in a
  closed year too (`closeView` and `BudgetClose` use `isStarted`). **Months close in any order**
  (MONTH-ANY-ORDER-1, Owner, 2026-10-02, reversing BUDGET-FIXES-1 item 2.4): the card opens on the oldest
  open month and any month that has started can be chosen.
- **Rejected receipts are listed in To Review**, each with View original, Back to review
  (`receipt_restore`) and Delete for good (`receipt_delete`, after a confirmation).
- **Keith never invents why a receipt is late**: `draft-late-note` must return `[REASON]` exactly once,
  or the draft is refused rather than shown.
- **Every folder still starts closed** (Owner, 2026-09-27), which the mockup's open September does not show.
- Stamps and LATE tabs are `aria-hidden`; the chip and the tracker say it in words. Grid cells carry
  their status as text. Swept: light and dark, modal with every branch open, zero failures.

## One confirmation (CONFIRM-DIALOG-1, 2026-10-01)

The browser's own confirm box ("aspireintelligence.app says") is gone. Every confirmation is
`confirmDialog()` from `src/components/shared/confirmDialog.jsx`: `if (!(await confirmDialog('Delete
this row?', { confirmLabel: 'Delete row', danger: true }))) return`. It resolves true or false, mounts
its own root on `<body>` (so the portals have it with no host), and sits above whatever asked. A
sentence after the first question mark becomes the explanation. Name the action on the button; a
destructive one is `danger` (red, focus starts on Cancel so Enter never deletes by reflex); when the
action itself is "cancel", say `cancelLabel: 'Keep booking'`. `test/confirmDialog.test.mjs` fails on
any `window.confirm` in `src/`. The Editable sheet's tail (Budget Tracker's Expected charges) starts
folded to one line with its count and total (TAIL-COLLAPSE-1).

## Budget Tracker: Expenses, and Subscriptions as one view (2026-10-02)

- **The tab is Expenses, not Sheet** (SHEET-IS-EXPENSES-1, Owner: "Sheet is the view. Expenses are what it
  is"). Only the words changed: the tab key is still `sheet`, the component `BudgetSheet`, and the generic
  Editable sheet keeps its name. Say "Show in Expenses", "in Expenses"; never "the Sheet" in Budget Tracker copy.
- **Subscriptions is one view** (SUBSCRIPTIONS-ONE-VIEW-1, Owner: see my subscriptions, when they are due,
  what they cost, their Concur status and whether they will be late, "in one view not two"). One summary
  line says the totals ONCE (`.bud-substrip`); one table (`SubscriptionMonths.jsx`) has a row per plan:
  cost, next charge, this year's months as Concur-status cells (a cell opens its receipt), per year.
  Decisions (approvals, renewals, overlaps) show only when one waits. The full editable sheet is under
  **Edit Plans**, folded unless there are no plans yet. Do not bring back the four tiles, the separate
  Charges by Month card, or the Platform Cost card on the Owner's view.
- **Leadership gets less** (Owner, 2026-10-02): a reader sees the totals line and the Platform Cost
  statement, never the plan-by-plan list, the months or the approval list.
- **KPI cards, a note, and a plan list for leadership** (SUBS-KPI-1, Owner, 2026-10-03). The Subscriptions
  totals are four `.bud-tile` KPI cards (Active, A month, A year, Due by Jun 30), as on Summary; the strip is
  retired. The platform cost is a plain note (`.bud-platnote`, the Platform tag and a sentence) in both views:
  never a card with a coloured left edge (Owner: "I hate that"). A reader also gets **Plans**, a read-only
  DataSheet (service, cost, next charge, per year) that leaves out plans awaiting approval or declined and
  shows no Concur status, months or decisions.
- **No Owner Note** (OWNER-NOTE-RETIRE-1, Owner, 2026-10-03): neither view has the card. "Reconciled through
  March 2026" (or "No month closed yet") ends the year line (`lastReconciled` in budgetModel). A note already
  saved stays in `owner_note`, unread; `set_note` is left in place.
- **A view-only sheet has no toolbar** (VIEW-ONLY-TOOLBAR-1): EditableSheet renders `.fs-toolbar` only when
  editable; search, filters and Columns stay. This applies to the Forms Answers sheet before its migration too.
- **The header's controls are one size** (HEADER-CONTROLS-1): the year picker and the header buttons share
  `--bud-act-w` (150px) and the 34px height, in Settings and in the NE&L portal.
- **A popover never lives in the Settings band's subtitle** (COST-CENTER-FIX-1): `.settings-page-sub` is a
  fixed 20px line with `overflow: hidden`, so the cost center editor is drawn on `<body>` (`createPortal`,
  `position: fixed` at the button). Its wrapper is `.bud-ccline`; `.bud-cc` is the Concur draft's list.

## The profile menu and Profile (TOPBAR-PROFILE-1, 2026-10-02)

Reference: `docs/mockups/topbar-profile.html`, brief `docs/mockups/topbar-profile-brief.md`.

- **The menu is four sections** (`src/components/UserMenu.jsx`, `userMenu.css`): an identity
  row that opens Settings > General > Profile; Settings with Cmd+, / Ctrl+, (from anywhere in
  the staff app); **Preview as**, the five portal previews that already existed, the same
  routes and the same active Owner/Admin gate; then Public site (new tab) and Sign out. The
  menu holds no photo controls. Keyboard: opened by keyboard, focus is on the identity row;
  arrows, Home, End; Escape returns focus to the button.
- **Portal previews were moved, not rebuilt** (Owner, 2026-10-02). There is no preview banner,
  person picker or server write guard; a preview is still `/portal/*` under the staff
  session, as PortalApp has always resolved it. Do not add those without the Owner.
- **Profile replaces Email Signature** (`ProfilePanel.jsx`, `profilePanel.css`):
  Photo (the old menu handlers, moved unchanged into `src/hooks/useMyAvatar.js`), Your
  Details, Connect Signature (`#signature`), one Save. `/settings/general/signature` and
  `/settings/signature` redirect to `/settings/general/profile#signature`.
- **Display name is the account's `full_name`**, written by the self-only RPC
  `update_my_profile` (`20261103000000_my_profile_name.sql`, Owner-gated), which also writes
  the signature in the same statement. Before it is applied the page falls back to
  `update_my_connect_signature` and says the account name did not change. full_name stays
  unwritable by a raw client update.
- **Two names are shown, never merged quietly.** Connect signs with
  `connect_signature.display_name`. When it differs from `full_name` the page says so and
  the signature keeps its own name until the person edits Display name.
  `db/audit/my_profile_name_conflicts.sql` lists every such account.
- **Signature off is not unsigned**: Connect falls back to a default block
  (`resolveSenderSignature`), and the preview says so.
- **Unsaved edits**: the staff app is a `<BrowserRouter>` (no `useBlocker`), so
  `src/lib/unsavedChanges.js` is asked by the controls that leave a Settings page (rail, list
  rows, breadcrumb, back link) and by the profile menu; a reload or closed tab gets the
  browser's own prompt. The workspace tabs do not ask.
- **Users & Access** is Accounts & Access renamed, at `/settings/users`;
  `/settings/accounts` redirects.
- **The top bar**: tooltips read Connect, Catalog, Action Center, Light or dark. Below 1100px
  the wordmark goes; below 560px the profile button is its photo alone, and the light/dark
  button now stays at every width. Scope and Search are NOT hidden below 860px, despite the
  brief: no screen offers either one in their place, so hiding them would strand phone users.

## Support stands on its own (SUPPORT-STANDALONE-1, 2026-10-04)

Phase 1 of the résumé review build (`docs/mockups/support-resume-review.html`, brief beside
it). Residency > Support > Before Residency never needs the Transition Form first (Owner:
"I may not send the transition form until two weeks before the application opens but they
may already be sending me their resume for review 5 weeks before").

- **An entry still points at an `ngrp_candidates` row, and that row is NOT the form.** It is
  the alumnus's enrollment in the cycle (cycle + student, workflow state only). Log group
  activity creates it when it is missing (`enrollStudents` in `lib/server/ngrpSupportLog.js`,
  through the table's UNIQUE (cycle_id, student_id)), and the later form send finds and
  reuses it. A bare candidate reads exactly like none: form_status 'not_sent'. No migration.
- **One panel logs Before Residency**: Log Group Activity (a drawer with `trapFocus`), one
  activity, one date (Today, Yesterday, Last event), an optional shared note, any number of
  alumni by STUDENT id, checked against the cycle's own roster on the server. A repeat is
  skipped and counted. The save returns its entry ids; the toast's Undo (10 s) voids exactly
  those, and only the caller's own (`void_batch`). Never delete.
- **Résumé Review is not a bulk activity** (removed by SUPPORT-OUTREACH-1): only an Outreach
  send logs it. Mentorship sessions keep their own record.
- **The Form column is a pill, never a gate**: Submitted, Pending (sent, opened, in progress),
  Not sent (none, or a send the provider never accepted). By Alumnus is the plain DataSheet.
- **The Score column is Phase 3.** The Résumé column opens the alumnus's Documents (below).

## Documents keep every version (STUDENT-DOCUMENTS-1, 2026-10-04)

Phase 2 of the résumé review build. An alumnus's Documents open in Residency, never in
Student Profiles (Owner, option B: alumni are in past cohorts and switching the staff
app's cohort to reach one is a side effect). Two ways in: the applicant drawer's Documents
section, and Support > By Alumnus's Résumé column (a date opens them, "Upload" when there is
none). `src/components/documents/StudentDocumentsDrawer.jsx`, rules in
`src/lib/documents/documentChecklist.js`, server in `lib/server/studentDocuments.js` behind
`api/student-documents.js`. Migration `20261104000000_student_documents.sql` is Owner-gated;
before it the drawer says so and the chart's Replace behaves as it always did.

- **The checklist is a table** (`student_document_types`), one NGRP list: five required,
  BLS / ACLS / licensure optional ("Not yet · After NCLEX"). No editor yet; change rows in SQL.
- **Replacing never deletes.** A version row has no DELETE grant and only `keith_check` may
  change. The résumé's CURRENT file stays `students.resume_url` in student-files (Interviews,
  Keith, the Unit Leader portal and the chart read it there); each version is its own copy in
  the private `student-documents` bucket, and the current one is mirrored to the canonical
  path. **The order is the safety**: keep the record's file as a version first, then mirror,
  then write the row, then repoint the record, then remove other extensions. The chart's
  résumé Replace calls `keep_record_resume` before it uploads and stops if that fails.
- **Same bytes are not a version** (409 `same_file`). A record that names a missing object
  holds nothing to keep; any other download failure stops the replace.
- **Who**: read Owner, Admin, Co-Lead; write Owner, Admin (the résumé's existing rule). Never
  Talent Acquisition: the section checks `useNgrpSurface().staffApp` and the endpoint the role.
- **Dates are typed and confirmed** in Phase 2 (transcript completion, card expiry): Upload
  stays disabled until the box "I checked this date against the file" is ticked, and
  `confirmed_by_profile_id` / `confirmed_at` are stored. Phase 3 has Keith read the date first.
- **Not yet**: Keith's checks and scores (Phase 3), Request through Outreach (Phase 4), the
  Student Portal mirror (after). A deleted student's document files are removed by
  `student-file-cleanup`'s `delete_student`, best-effort.

## Keith reviews résumés (RESUME-REVIEW-1, 2026-10-05)

Phase 3 of the résumé review build. `review-resume` is the SECOND Keith Skill that reads one
student's résumé (after `resume-interview-questions`), behind the same gates: the version must
be this student's résumé, `authorizeStudentResumeAccess` must pass, the bytes are extracted
server-side, contact details are redacted before Keith reads them, and the run goes through
`runKeithSkill` (on/off switch, roles, schema, usage, metadata-only audit, provenance).
Server: `lib/server/resumeReview.js` behind `api/student-documents.js` (`review_*` actions).
Screen: `src/components/documents/ResumeReviewDrawer.jsx`. Rules: `src/lib/documents/resumeReviewModel.js`.
Instructions: `skills/review-resume/SKILL.md`, seeded by `20261105000000_resume_reviews.sql`
(Owner-gated) and held equal to it by a test.

- **The score is the rubric's** (Owner: "rubric-based and objective"). Keith scores six
  categories 0 to 10; the composite (sum x 10 / 6, rounded) and the readiness (Highly
  Competitive at 80+ with none below 6, Needs Improvement below 65 or any category at 3 or
  below, else Competitive) are COMPUTED by `parseReview`, never the model's. The model's own
  number is kept as `model_score` for comparison and not shown.
- **Résumés only** (Owner, 2026-10-04). Keith reads no transcript, card or letter. A dated
  document's date is pre-filled WITHOUT AI when the picked PDF has text
  (`src/lib/documents/documentDates.js`, read in the browser); staff still confirm it.
- **Who**: running a score (a paid call) is Owner and Admin (`allowed_roles`); reading scores,
  reports and drafts is Owner, Admin and Co-Lead. Never Talent Acquisition, never the portal.
- **The quality route refuses `temperature`.** Do not add one to this Skill's route.
- **The Keith mark is the receipts' and comment themes' mark** (Owner, 2026-10-05: "so it's
  consistent"): `<KeithMark provenanceId>` beside the score on the résumé chip, each scored
  version, By Alumnus's Score, and the review's Score and Draft titles. Drafted is the orb;
  changing Keith's subject or text (not a checkbox) records `edit` (the pencil); a sent review
  records `accept` (the check, or the pencil stays if edited). The card is shown to Owner, Admin
  and Co-Lead only (`canSeeEntity` 'resume_review'); a Skill step is named by its Skill's row.
- **A row is written as 'scoring' before Keith is asked**, so closing the drawer loses nothing;
  a row still 'scoring' after 4 minutes reads as failed with Retry. An off Skill, a refused
  role or another student's version writes no row. The scoring steps after "Uploaded and
  filed" advance by elapsed time (one request does all of it); the panel says "usually under
  a minute".
- **The draft is composed, not stored whole**: Keith's body, the score sentence after the
  greeting (Include score), the rewritten bullets (Add rewritten bullets) and the reader's
  own sign-off (Connect signature name and credentials). Copying never logs support; Open in
  Outreach and the send-time log are SUPPORT-OUTREACH-1, below.

## Résumé Review is logged by the send (SUPPORT-OUTREACH-1, 2026-10-05)

Phase 4 of the résumé review build. A review's **Open in Outreach** and a missing document's
**Request** write a `SUPPORT_HANDOFF` launch context (`src/lib/documents/supportHandoffModel.js`)
and open Outreach's send-to-one composer on that student (`?launch=1&recipientType=student&
recipientId=`, so a refresh keeps the recipient). The handoff applies only while the composer is
addressed to that student, exactly like the placement handoff.

- **Nothing in the handoff is trusted.** `api/connect-send-direct-email.js` takes `support_ref`
  and `document_version_ids` and proves them in `lib/server/supportHandoff.js` BEFORE preview and
  before any mail client: the review is this recipient's and scored, the student is on that
  cycle's roster, a requested type exists, every attachment is a version of this student's own
  document (checked like a Catalog file). A failed claim sends nothing and logs nothing.
  `template_key` is now `support_resume_review` / `support_document_request`, accepted only with
  a handoff, and the student documents only travel with one.
- **To is the personal email** when one is on file (`emailSource: 'personal'`), else the
  ordinary routing with a warning. Only a verified handoff can ask for it; the recipient
  override fields are still refused.
- **The log is the send.** Only after a successful AND logged send does `recordSupportSend`
  write Résumé Review for the Pacific send date (source `outreach`, `source_ref` the log id),
  enrolling the alumnus if needed, and mark the review Sent. The live unique index makes a
  second send that day "already logged". A document request, a copy, a failed send: nothing.
  If the log write fails after the email went, the toast says so; it never fails the send.
- **Résumé Review is not in Log Group Activity any more** (`BULK_ACTIVITY_KEYS`). By Alumnus
  shows a message icon on a date an Outreach send logged, a Score column (the latest Keith
  score, ASPIRE team only), and the KPI reads "Logged from Outreach sends".
- **No scheduled sends exist in Outreach**, so "logs when it goes out" is simply "logs on send".
- `ngrp_support_entries.source` / `source_ref` arrive with 20261106000000 (Owner-gated); the app
  writes the same rows without them before it.

## Residency in the Student Portal (RESIDENCY-TAB-1, 2026-10-05)

Phase 5 of the résumé review build. For an ASPIRE alumnus (status Completed, decided by the
server) the Student Portal's fourth tab is **Residency** in place of Shift Log (Owner: "make it
a control center for them for residency preparation"); current students keep Shift Log, and an
Owner/Admin preview shows Shift Log. `src/portal/StudentResidency.jsx`, endpoint
`api/portal/my-residency.js`, reads in `lib/server/alumnusResidency.js`, words in
`src/lib/residencyTabModel.js`.

- **Sections**: a banner per open document request (a Documents Request sent in the last 90
  days that no later upload of that type answered), Key Dates (the residency cohort's dates),
  Application Documents (the staff checklist and upload path, `via: 'portal'`, history with
  upload dates, the date confirmed by them: "I checked this date against my document"),
  Transition Form (status words only, never the link; a provider-unaccepted send reads Not
  sent), Upcoming Events (the portal calendar feed's NGRP dates, Town Halls and interview
  window; Interview Bootcamp is not an event type), Support You've Had (activity and date).
- **Never on this tab**: a Keith score, report or draft, a staff note, who uploaded or
  confirmed a file, a path. Every shape is built field by field; a test holds the version keys.
- **Identity is the session**: grant, then links, then the Completed student among them; the
  request never names a student. A file opens only when its document is theirs.
- **Staff see what alumni did**: `api/student-documents.js` `activity` feeds a Needs you /
  Action Center group, Residency Documents: "uploaded a new résumé · Score now" (a current
  portal résumé with no review, 30 days) and "completed application documents" (required set
  complete through a portal upload, 14 days). One population (demo or real), filtered in
  memory. A row opens `/ngrp/profiles?student=<id>&docs=1`, which opens the applicant drawer
  and its Documents when the alumnus is on the selected residency cohort's roster.
- `residencyEligible` in PortalApp is declared ABOVE the command bar that reads it; a const
  read before its declaration takes the whole portal down (the 2026-10-04 incident's cousin).

## Résumé feedback is shared in words (RESUME-FEEDBACK-1, 2026-10-05)

The Owner read a sent review email ("Your résumé scored 58 of 100 ... three changes") and asked
what a student would do with that. Now:

- **Sending the review shares it.** A review with status `sent` appears on the alumnus's
  Residency tab as Résumé Feedback (`ResumeFeedbackCard` in `src/components/documents/`, shape from
  `studentFeedback` in `src/lib/documents/studentFeedbackModel.js`, read by `resumeFeedback`
  in `lib/server/alumnusResidency.js`). Copying a draft shares nothing.
- **Words, never the number** (Owner: "show words not the number"): the six areas are Strong
  (9 to 10), Solid (7 to 8), Developing (5 to 6), Needs work (below 5); readiness is its word,
  what it means, and what the next level asks. A sentence in Keith's notes that states a score
  is dropped whole and a bracketed "(8/10)" removed (`stripScores`); a test sweeps the shape.
- **The change since the last shared review**: "ASPIRE Positioning: Developing → Solid" and
  "Competitive, was Needs Improvement" (Owner: "yes!").
- What it shows: strengths first, the six areas with Keith's reason, where to start, what is
  missing, rewritten bullets (placeholders explained), section notes, words to weave in, what
  a recruiter notices, a checklist. Never the draft, staff edits, résumé text, provenance or score.
- **The email leads with strengths.** The optional sentence is "Include readiness" (starts off
  for new reviews) and reads "your résumé reads as Competitive for now", placed after the
  strengths; Open in Outreach adds a line linking to `/portal/residency`. Copy draft has no
  link, because copying shares nothing.
- **Staff preview the same card** (RESUME-FEEDBACK-PREVIEW-1, 2026-10-05): the review drawer's
  "Preview what [name] sees" renders `ResumeFeedbackCard` from the same `studentFeedback` call,
  against the review shared before this one, so the portal and the preview cannot drift. An
  unsent review reads "Shared when sent" (never its scoring date) and the bar says nothing is
  shared until it is sent. The card is white paper with pinned ink in both apps and themes.

## By Alumnus says where the résumé stands (RESUME-WORKSPACE-1, 2026-10-05)

Owner: the list made you click "Upload" to see a résumé that was already on file, and the score
could not be clicked. Now:

- **One Résumé column, in words**: No résumé, Not scored, Scoring, the score with its readiness
  and the Keith mark, or that plus "Sent Oct 5". It is the CURRENT résumé's state: a newer upload
  Keith has not read is Not scored. Rules: `src/lib/documents/resumeStatusModel.js`; the server
  builds the map (`lib/server/resumeStatus.js`, read by `api/ngrp-support.js` `summary` as
  `resumes`, never for Talent Acquisition; null on a read failure, which shows a dash). The
  separate Score column and the Résumé Review date column are gone for the ASPIRE team; Talent
  Acquisition keeps the date column.
- **The cell opens the résumé screen**: `StudentDocumentsDrawer only="resume"`, the résumé, its
  versions, the score and the review, and no checklist. The applicant drawer in Profiles &
  Interest still opens the whole Documents drawer.
- **The name opens the applicant** in Profiles & Interest (`/ngrp/profiles?student=<id>`).
- **A filter makes it a work queue**: All, No résumé, Needs score, Scored not sent, Sent, each with
  its count. On a phone the row scrolls rather than clipping.
- **Score again** on a scored résumé, after a confirm: a new review of the same file; the earlier
  one stays in the review's score history. The server always allowed it; the screen did not.

- **The draft opens with a thank-you** (RESUME-DRAFT-OPENING-1, Owner, 2026-10-05): right after
  the greeting, "Thank you for sending your résumé. I've reviewed it and run it against our ASPIRE
  résumé rubric. Here is my feedback." It says "uploading" when the version came from the Student
  Portal (`uploaded_via: 'portal'`). `openingLine` in resumeReviewModel.js, added by `composeDraft`
  for the drawer and the Outreach handoff alike, and skipped when Keith's body already thanks them.

## The applicant is the student's binder (APPLICANT-CHART-1, 2026-10-05)

Residency > Profiles & Interest opens each applicant in the Student Profiles binder, in a drawer
over the roster (Owner chose A over a split view). Owner: "do not invent new things - rather,
reuse". Reference: `docs/mockups/applicant-chart.html` (its own tabs and colours were NOT built;
the real chart's are).

- **Same parts, same files**: `.sc-binder` and its rings, the `.sc-plate`, the die-cut `.sc-index`
  tabs and `useChartScroll` (which now takes a sheet list), all from `src/components/student/`.
  The seven sheets are `APPLICANT_SHEETS` in `chartSheets.js`: Profile (id `applicant`), Application, Documents,
  Support, Interview, Hiring, Activity. Each borrows a Student Profiles tint by name (`data-tint`),
  so no colour is new; the tab rules sit BEFORE Modern's, which must still make every tab plain.
- **Every section the drawer had is on a sheet, unchanged in what it shows or saves**; `Section`
  is now the chart's `sp-section sp-card` (part of the page, not a box). The roster
  payload still strips emails to `has_email` (`sanitizeStudent`); contact details reach the
  chart only through its own `profile` read (RESIDENCY-APPLICANT-PROFILE-1, below). Documents is `StudentDocumentsBody`, the
  Documents drawer's own body, inline. Support lists that alumnus's live entries from the same
  query Residency > Support counts. The Residency Portal has no Documents sheet.
- **Inks are theme tokens now** (`--text-caption`, `--text-heading`, `--aspire-ok/warn/bad`): the
  drawer's literal greys measured 2.3 to 2.5:1 on white and failed on the dark sheets. Swept every
  text node in all four style and theme combinations: one failure left, the shared
  "Not Scheduled" pill (4.39:1), which is the app-wide pill and was left alone.
- **Not built, on purpose**: an Employment section (Cedars-Sinai email) waits for its own build;
  Town Hall and Bootcamp attendance sheets and the Advising log are next.

## Profiles & Interest is a split view (RESIDENCY-SPLIT-1, 2026-10-05)

Owner: follow the internship profile view, "list in the left, open profile by default on the
right", with the status table as its own tab "like the CS-Link Access tab". So Residency >
Profiles & Interest is now **Profiles | Application Status** (`?view=status`), above the same
KPI cards:

- **Profiles** is Student Profiles' split, reused class for class: `.profiles-toolbar` (pinned,
  measured by `useChartViewport` through `PinnedSplitFrame`, which mounts only once the roster
  has loaded because the hook measures on mount), `.profiles-slide-container`,
  `.profiles-list-narrow` with `.pl-row` rows (who / ranked units / Form and Status pills), and
  `.profiles-panel-slide` holding `ApplicantChart`, the Applicant chart embedded (no drawer). The
  chosen alumnus, else the first in the list, is always open; choosing one writes `?student=`.
  Interest and Eligibility moved onto the plate; Send / Resend Transition Form sits there too.
- **Application Status** is the roster table exactly as it was, with the checkboxes and bulk
  Send Transition Form. Clicking a name opens that alumnus in Profiles.
- The Interview Board still opens the same component as a drawer (`ApplicantDrawer`).
- **The list's scroll box is `position: relative` on purpose.** NgrpStatusPill's `.sr-only` labels
  are absolutely positioned; without a positioned ancestor inside the clipped list they escaped
  the clip and made the page scroll on past the binder (shipped in 9c46e722, fixed the same day).
  Any list of pills inside a clipped scroller needs the same.
- The neutral NgrpStatusPill ("Not Sent", "Not in Pool", "Not Scheduled") measures 4.39:1
  everywhere it appears; it is the shared pill and was left for its own fix.

## Residency mirrors Student Profiles (RESIDENCY-POLISH-1, 2026-10-05)

- **Profiles | Interest** (Owner chose it over Application Status): the tab's own two words.
  `?view=interest`; an old `?view=status` link still opens Interest.
- **Alumni Cohort View**, "N alumni shown · KPI cards work as quick filters", mirroring Student
  Cohort View, with the same **List | Grid** toggle. Grid is `StudentCard variant="applicant"`
  (the internship card, its strip being the roster Status pill; no completion badge, which
  measures the internship record and would mislead).
- **The residency follow-up flag** (RESIDENCY-FLAG-1, Owner chose a SEPARATE flag):
  `ngrp_candidates.flagged_for_followup` (`20261107000000_ngrp_followup_flag.sql`, Owner-gated),
  never `students.flagged_for_followup`. The chart wears the student chart's `FlagRibbon`
  (`classPrefix="sc-ribbon"`) and a flagged row its `pl-followup` mark. Written by
  `/api/ngrp-manage` `followup_flag_set` by STUDENT and cycle (an alumnus with no candidate row is
  enrolled first, roster checked server-side), refused to Talent Acquisition, 409 not_enabled
  before the migration. Talent Acquisition's payload drops the column; `followUpFlagProvisioned`
  is staff only. The candidate read tries the flag column first and falls back one tier.
- **Ends where the content ends**: `.pl-list.ngrp-pl-list` drops Student Profiles' 120px launcher
  padding (the list card sits clear of the launchers here); the Activity sheet has no 60vh floor,
  because `useChartScroll` now makes the LAST sheet current at the bottom of the scroller. Student
  Profiles keeps both, unchanged.
- **Switching to Residency opens At a Glance** (RESIDENCY-LANDING-1). It used to restore the last
  Residency tab. Internship still restores its own; a return path from Connect or the Catalog is
  its own navigation and still goes back.

## Talent Acquisition works in Residency (RESIDENCY-TA-1, 2026-10-05)

Owner: "the residency portal account can access - they should be able to log, flag, etc. and
then we will just have a log of who did what". HR has to want to use this, so it works for them.

- **Every alumnus, not form submitters only.** `narrowPayloadForTalentAcquisition` keeps the
  whole roster (it adds the pipeline counts); the submitted-only gates in ngrp-workspace `locate`
  and ngrp-manage's candidate actions are gone. The CSV export follows.
- **What they do now**: log support and attendance and remove entries THEY logged
  (`TA_WRITES` in ngrp-support); pull the one shared follow-up flag; see, open, upload and
  replace documents; read Keith's scores, reports and drafts and run a score. All for alumni
  (status Completed) only: `api/student-documents.js` proves the grant, checks every student,
  version and review it touches, and acts as role `talent_acquisition`, which Keith's
  `authorizeStudentResumeAccess` scopes to alumni (`ALUMNI_SCOPED_ROLES`) and the `review-resume`
  Skill lists once `20261108000000_residency_ta_access.sql` runs. Their Keith marks show too
  (`provenanceCards` with `talentAcquisition`, résumé reviews of alumni only).
- **What stays with the ASPIRE team**: sending (Open in Outreach and Request need ASPIRE Connect,
  which the portal has not; both hide on `canSendForms`), revoking form links, the mentor
  assignment, the reflection tool and reading residents' answers.
- **Settings > Residency Activity** (Owner and Admin, Program group): `ngrp_audit_events`, newest
  first, with who (name and team), action, alumnus, detail and cohort; filters by person, action
  group and alumnus; Export CSV of what is shown; one population (demo or real). Rows come from
  ngrp-manage `activity_log`; words from `src/lib/ngrp/residencyActivityModel.js`. New event types:
  support_logged, support_voided, followup_flagged, followup_unflagged, document_uploaded,
  resume_scored; the migration's CHECK and `NGRP_AUDIT_EVENTS` must match (a test compares them).

## Residency opens on what needs you (RESIDENCY-NEEDS-1, 2026-10-05)

Phase 2 of making Residency worth HR's time. Residency's At a Glance, for the ASPIRE team and
Talent Acquisition alike, opens (under the masthead, above the snapshot) on the staff home's own
`NeedsYou` component, wrapped in `.hm-page.ngrp-needs` for the home's tokens with its page
padding taken back. Four groups, built in `src/lib/ngrp/residencyNeedsModel.js` on the home's
`finish` shape: **Interviews** (scheduled this week, and past ones with no result: "Result due"),
**Offers** (extended, no answer; "Follow up" after 7 days), **Flagged** (the shared residency
flag), and **Residency Documents** (`residencyDocsGroup`, now taking the surface `base`). Every
row opens that alumnus in Profiles & Interest on the surface it was clicked in. The roster groups
read rows already loaded; documents are their own query (`loadDocumentActivity` in the documents
client), so the portal never downloads the staff home's loaders. Document rows now read
"Last, First" on the staff home too. Swept light and dark: zero failures.

## Settings groups, one breadcrumb, the staff menu in portals (NAV-POLISH-1, 2026-10-02)

- **The Settings rail is four groups** (Owner): Personal (General), Administration (Users &
  Access, Organization, Keith AI), Program (Community Benefit, Budget Tracker), Diagnostics
  (Demo Mode, Preceptor Parity). `SETTINGS_GROUPS` orders them; no role gate moved. The
  selection rail's group labels read `--text-caption` (`--text-muted` was 4.06-4.37:1 at
  10px), which Review & Release's rail shares.
- **One breadcrumb**: `src/components/shared/Breadcrumb.jsx` + `breadcrumb.css`. Every parent
  is a link, the page you are on is plain text with `aria-current`, the "/" is hidden
  decoration in caption ink. Settings drill-ins ("Settings / General / Profile"), Settings'
  full-screen pages ("Settings / Budget Tracker"), the Catalog's forms ("Catalog / Forms /
  <form> / Responses") and Signatures ("Catalog / Signatures") all use it. The white
  BackButton pill is only for LEAVING an area. "Forms" opens `/catalog?view=forms`, which the
  Catalog reads on every arrival. A form that fails to load offers the BackButton pill
  ("Back to Catalog"), not a trail.
- **Every portal menu has the staff menu's shape** (`ProfileMenu` in `PortalShell.jsx`;
  PORTAL-MENU-1 extended NAV-POLISH-1 to every portal user, Owner, 2026-10-02). Sections:
  the name row (a student's My Profile, a unit leader's Profile, plain where a portal has no
  profile page; an Owner or Admin's opens `/settings/general/profile`), staff only Settings
  with Cmd+, / Ctrl+, and Preview as, then Change Photo and Restart Welcome Tour, then Main
  App (staff), Public site, Sign out. Arrows, Home and End everywhere. Staff parts hang off
  `staff = Boolean(portalSwitcher)`, which only PortalApp's `staffMenu` (ownerAdmin)
  supplies. An Owner/Admin who also holds a real grant keeps their portal profile as
  "Portal profile". Sign out is quiet ink, no longer red. No email in the portal bundle.
- **Measuring tip**: a backgrounded browser pane does not finish CSS transitions, so a theme
  switch read through `getComputedStyle` can report the old ink. Inject
  `*{transition:none!important}` before a contrast sweep. Locally, portal previews and the
  forms API cannot run (Vite serves `api/` files as text); check those on the live site.

## The applicant's Profile sheet is the student's (RESIDENCY-APPLICANT-PROFILE-1, 2026-10-05)

Owner: put the applicant's information on the Profile sheet "similar to what is in Student
Profiles > Profile tab", reusing what exists. `src/components/ngrp/ApplicantProfileSheet.jsx`
draws Contact Information and Personal Information with StudentSidePanel's own markup and
classes (`sp-section-hdr`, `sp-field`, `sp-copyrow`, `sp-input`, the "Saved" badge) and saves
through the same writers (`updateContact`, `updateProfile` to `/api/student-update`, whose role
gates still decide). Residency Interest and Eligibility, Override included, moved unchanged to
the top of the Application sheet.

- **The roster still carries no emails.** One alumnus's details come from `/api/ngrp-workspace`
  `profile { cycle_id, student_id }`, which checks the alumnus is on that cohort's roster
  (Completed, from a source cohort) and shapes the answer in `lib/server/ngrpApplicantProfile.js`.
- **The ASPIRE team** sees contact and personal details; contact edits follow `student_manage`,
  name, date of birth, gender and GPA follow admin level, exactly as in Student Profiles.
- **Talent Acquisition** sees names always, and contact details only once the alumnus has
  submitted the Transition Form (the consent to share with Talent Acquisition); never date of
  birth, gender or GPA, never an edit. The sheet says why when contact is not shared yet.
- **No SSN** on this read for anyone; the residency has no use for it.


## Talent Acquisition's weekly digest (RESIDENCY-DIGEST-1, 2026-10-05)

Owner: the weekly digest is optional, "they have to activate in the app somewhere". The
Residency Portal has no ASPIRE Connect, so the switch is **Weekly digest email** in its profile
menu (a `menuitemcheckbox` in `ProfileMenu`, On / Off beside it, the menu stays open). It is the
per-person preference `notifications.residencyDigest` (`RESIDENCY_DIGEST` in
`src/lib/userPreferences.js`, fallback `off`), stored in `user_profiles.ui_preferences`, which a
person can write on their own row. No SQL. PortalApp declares the hook above every return.

- **The content is Residency's Needs you.** `src/lib/ngrp/residencyDigestModel.js` builds the
  sections from the SAME groups At a Glance shows (`interviewsGroup`, `offersGroup`,
  `flaggedGroup`, `residencyDocsGroup`) over every residency cohort in Planning or Active, with
  Residency Portal links. Up to 8 rows a group, then "and N more". Dates are Pacific (the two
  models' day formatters now pass `timeZone`, so a UTC server names the same day as the screen).
- **The cron** is `api/cron/residency-weekly-digest.js`, Mondays 15:00 UTC (8 AM PDT, 7 AM PST).
  Recipients: an active `talent_acquisition` grant, an active profile with an email, the switch
  on. A quiet week sends nothing. Once a week: anyone sent one in the last 5 days is skipped, and
  a failed dedupe read stops the run. `?dryRun=1` sends and logs nothing. Logged in
  `notification_log` as `residency_weekly_digest`, reply-to ngrp@cshs.org.
- **Connect > Automations lists it** (Residency Weekly Digest, default On) so the team can pause
  it and see its runs; the card's preview renders fake alumni through the same model and
  `lib/server/email/residencyDigestEmail.js`.

## A resident is one record; Residency's calendar says Calendar (2026-10-05)

**RESIDENTS-ONE-RECORD-1 (Owner).** Residency > Residents is the retention view (the four
KPIs, this cohort or Aggregate, the table) and edits nothing. A resident's title, preceptor,
phone and separation are kept on the applicant binder's **Hiring** sheet, in
`ResidentDetailsSection.jsx`: the editor Residents had, moved unchanged in what it reads
(the same `residents` query) and saves (`resident_details_set`), shown once the hire is recorded.
A Residents name (Support > By Alumnus's `sl-namebtn`) opens
`residentRecordPath(base, candidate_id)` = `profiles?candidate=<id>&sheet=hiring`; ProfilesTab's
candidate lookup switches the residency cohort for an Aggregate row. `?sheet=<id>` opens any
binder sheet. A deep-linked sheet is jumped to INSTANTLY and held in place while the sheets above
it load (a ResizeObserver, two seconds or until the reader scrolls): a single smooth jump landed
1,000px short once their data arrived.

**RESIDENCY-CALENDAR-1 (Owner).** Residency's third sub-tab reads **Calendar** (title "Residency
Calendar"): it holds program events, US holidays and residents' working days, and is named for
them, as Internship's Activity became Shift Log for its shifts. Not Shift Log: shifts are its
smaller half and come from the reflection tool, not a log. The route id stays `activity`.

## The applicant packet (APPLICANT-PACKET-1, 2026-10-05)

Adoption phase 4. Every applicant binder has **Download Packet** on its name plate (beside Send
Transition Form, for the ASPIRE team and Talent Acquisition alike): one PDF to hand to a hiring
unit. `src/lib/ngrp/applicantPacketModel.js` decides what is in it (pure, tested),
`applicantPacketPdf.js` draws it with pdf-lib, `applicantPacketClient.js` gathers and saves it.

- **Built in the browser.** Each file is fetched through the Documents drawer's own `list` and
  `open` actions, so it is checked against the caller exactly as opening it would be; nothing is
  copied into storage and no serverless response limit applies. pdf-lib loads only on press.
- **Order:** a summary page (who, contact only when the Profile sheet would show it, interest,
  eligibility, form, unit choices, pairing, interview, offer and hire, residency preparation,
  and "In This Packet" with each part's pages), the submitted Transition Form (the same
  `transitionSummaryRows` the binder's Review shows), then each document's CURRENT file in the
  checklist's order: PDF pages copied, a JPEG or PNG on a page of its own. A Word file, a missing
  document or a file that will not load is named in the list instead of failing the packet.
- **Left out on purpose:** Keith's score and review (an internal rubric) and preceptor feedback
  (released only by request). A test holds the model free of both.
- **Logged:** `packet_downloaded` in Settings > Residency Activity (Documents and résumés), via
  ngrp-manage, roster-checked. Migration `20261109000000_applicant_packet_audit.sql` widens the
  CHECK (Owner-gated); before it the packet still downloads and only the log line waits.
- `src/lib/pdf/pdfText.js` (`safe`, `wrap`) is now shared with Forms' filed PDFs.

## Residency tooltips and the Residency Portal's column (2026-10-05)

- **RESIDENCY-TOOLTIPS-1 (Owner).** Residency and its document drawers use the canonical
  `Tooltip` (`src/components/ui/Tooltip.jsx`), never an element's `title`. Where the trigger has
  visible text, pass `applyAriaLabel={false}` so the tooltip does not replace its accessible name;
  a button that can be disabled hangs its tooltip on a wrapping span (a disabled button fires no
  pointer events). `test/residencyPortalPolish.test.mjs` fails on an HTML element with `title=`
  in `src/components/ngrp/` or the two document drawers.
- **PORTALS-WIDE-1 (Owner, 2026-10-05: every portal like the staff app).** From 1024px up a
  portal's cards land exactly where the staff app's `.snap` cards do: `.ptl-main` is `.app-main`'s
  column less the cards' 40px (`min(100% - 180px, 1540px)`, `100% - 136px` from 1024 to 1440). It
  was 94vw capped at 1500px. Measured against `.app-main > .snap` at 1920, 1440 and 1100: same left
  edge and width. Top padding stays `--aspire-page-top`; phones and tablets are unchanged.
- **RESIDENCY-PORTAL-WIDTH-1 (Owner: "mimic the staff app? wider, much preferred").** The
  Residency Portal passes `mainWidth="app"` to PortalShell, so its `<main>` is `.ptl-main-app`:
  `.app-main`'s column at every width (140px of side room, 96 from 1440, 48 from 1024, 32 on
  phones). Other portals keep their narrower column.
- **The pinned split works in a portal now.** `useChartViewport` counts `.ptl-topsection` as
  sticky chrome (it only knew `.top-section`, so the search bar pinned over the portal header),
  and leaves room for whatever the page draws below the chart's tab (the portal footer and
  padding pushed the split 77px under the bar). Measured in a harness: bar at 112 under a 112px
  header, split at 170 at the end of the scroll.
- **RESIDENCY-PORTAL-SCROLL-2.** That was not enough on a short window: at 1000 x 645 (the Owner's)
  the header, a wrapped search bar and the footer plus padding left the split under its 420px floor,
  so the page scrolled it under the bar again. A page on `mainWidth="app"` now has no footer and no
  bottom padding, as the staff app has neither. Measured against the staff app in a harness with the
  real nesting at 1000 x 650: bar 120 vs 118, split 212-638 vs 210-638.
- **The interview Format is offered in every state** (Owner): it is often known before the time.

## Interview format (INTERVIEW-MODE-1, 2026-10-05)

Owner: Residency already pairs applicants with units (Interview Board) and records results (the
binder's Interview and Hiring sheets), so interview day needs only how it was held: **In person or
Virtual**, optional. `ngrp_candidates.interview_mode` (NULL, `in_person`, `virtual`), added by
Owner-gated `20261110000000_interview_mode.sql`; `INTERVIEW_MODES` (server) and
`INTERVIEW_MODE_LABELS` (`src/lib/ngrp/ngrpStates.js`) list the same values.

- The binder's Interview section offers **Format (optional)** beside the date for the states that
  keep a time; a state that never happened clears it. The choice shows only once the roster read
  reports `interviewModeProvisioned`; before the migration every interview still saves
  (`interview_set` retries without the column and answers `modeNotEnabled`).
- It reads on the Interview Board chip ("Completed · Virtual"), in the roster CSV (Interview,
  Interview Date in Pacific time, Interview Format) and in the applicant packet's Interview line.
- Next, its own project: an Interviews tab in the Unit Leader Portal (unit leaders run the
  interviews), reusing the internship's booking calendar and rubric book. Mockup first.

## Consent covers interviewing units (UNIT-SHARE-CONSENT-1, 2026-10-05)

Owner: widen the Transition Form's consent so the hiring units that interview an alumnus may see
their answers (the Unit Leader Portal will list applicants paired with a unit). The one box now
reads "...with Cedars-Sinai Talent Acquisition and with the hiring units that interview me..." and
records BOTH `attestation.consent_hr_share` and a new `attestation.consent_unit_share`; both are
required to submit. A revision without `consent_unit_share` was submitted under the narrower
wording, so a unit leader must never see its answers (the alumnus can revise until the deadline
and agree then). A draft saved before the change shows the box unticked. The binder's Review, the
packet and the CSV show the second consent beside the first. No migration: it lives in the
revision payload.

## Residency interviews (NGRP-INTERVIEWS-1, in phases from 2026-10-05)

Owner decisions: unit leaders interview the applicants Talent Acquisition paired with their unit,
from an Interviews tab in the Unit Leader Portal with an internship interviewer's abilities (open
times, see their interviewees, score with the rubric). Each interviewer sees only their own rubric
in full; the ASPIRE team and Talent Acquisition see every rubric and the panel result in the
binder. The panel result fills the binder's interview result; offer and hire stay with Talent
Acquisition. The unit opens times; Talent Acquisition or the alumnus books through a link
(provisional). Layout copies the internship Interviews tab: today's tiles on interview days, the
calendar, then the results table, each row opening the rubric book.

- **The rubric is the Owner's NGRP scoring sheet**, transcribed in `src/lib/ngrp/ngrpRubric.js`
  (pure, tested): Clinical Judgment, Professional Presence, Goal Alignment, five questions each plus
  Other, scored 1 to 5; composite 3 to 15; ranges 13-15 and 10-12 Recommend, 7-9 Recommend with
  Reservations, 3-6 Do Not Recommend at This Time; any domain at 1 or 2 is a "closer look". The
  panel AVERAGES completed composites (the sheet's rule, not the internship's majority vote) and
  flags divergence of 4 points or a split recommendation. Never renumber a question key.
- **Phase 1 tables** (`20261111000000_ngrp_interviews.sql`, Owner-gated, server-only):
  `ngrp_interview_rubrics` (UNIQUE candidate + interviewer, which the internship table lacks;
  composite GENERATED from the three scores; completed requires every score and a recommendation;
  no DELETE), `ngrp_interview_blocks` and `ngrp_interview_slots` (one booked slot per applicant per
  cohort). Eight `interview_*` audit types for Residency Activity. A PGlite test runs the migration.
- **Phase 2: results in the binder.** `loadApplicantsPayload` attaches each applicant's
  `interview_panel` (completed, in progress, average, recommendation, range, diverged, closer look)
  from `lib/server/ngrpInterviewRubrics.js`, and the roster never fails for it (a secondary read in a
  try). `ngrp-workspace` `rubrics` returns one applicant's full rubrics to the ASPIRE team and Talent
  Acquisition. The binder's Interview sheet shows a Panel result row and the Interview Rubrics
  section (`InterviewRubricsSection.jsx`): the internship book's `rub-rubric-card` cards with View
  for the questions asked and notes, the average with the sheet's range, and the divergence and
  closer-look notes. Inside the binder those cards follow the theme (`.ngrp-rubrics` in ngrp.css),
  because the binder's dark sheets redefine the internship card's fixed ink. The Interview Board chip
  and the roster CSV (Rubrics Completed, Panel Composite, Panel Recommendation) read the panel too.

- **Phase 3: the Unit Leader Portal's Interviews tab** (`src/portal/unit/UnitInterviewsWorkspace.jsx`,
  server `lib/server/ngrpUnitInterviews.js` behind `api/portal/unit-interviews.js`). Listed: only the
  applicants Talent Acquisition paired with the leader's units, plus a no-names count of those who
  ranked the unit first. A booked slot shows a name only when that applicant is paired with the
  unit. The rubric book (`NgrpRubricBook.jsx`) is the internship's `rubricBook.css` markup holding
  the NGRP sheet; an interviewer reads and writes ONLY their own row (upsert on candidate +
  interviewer), and the applicant page shows Transition Form answers only under
  `consent_unit_share`. Completing stamps `completed_at`, audits, and moves the candidate's
  `interview_status` to completed on the first completion. Opening times cuts a span into slots in
  Pacific time (DST-correct); removing a span with a booking, or blocking a booked slot, is a 409.
  An Owner/Admin preview reads and never writes (403 `preview_read_only`). No new SQL.
- **Calendar chips keep paper ink here.** `CanonicalActivityChip` takes an optional `ink`; this tab
  passes `var(--paper-ink)` so the type colour is the wash and the rule (planner rule 3), and the
  day panel's Block, Reopen and Remove are the planner's own `.pl-ghost`. The "Interviews Today"
  heading pins its ink on `.ptl-unit-page .mast-live-head`, because the portal page is cream in both
  themes while `--chart-ink` follows the staff theme (1.03:1 in dark, 4.05:1 subtitle in light).
  Swept light and dark: zero failures but the shared `.ptl-muted` (4.29) and `.ir-wl-th` (4.37).
- **Unit Leader nav (UNIT-NAV-ALPHA-1, Owner, 2026-10-06)**: Home reads At a Glance and stays first;
  every other tab is alphabetical through `alphabetizeNav` (Capacity, Evaluation, Interviews,
  Messages, Placement Requests, Preceptors). Phase 4 (booking by link) is provisional.
- **Phase 4: the interview schedule, on the calendars that already exist** (ONE-CALENDAR-1, Owner,
  2026-10-06: "why did you not use the Calendar in Calendar tab as the calendar for Interview
  scheduling, the way we used only 1 calendar in the main app? ... end-user experience". A separate
  Interview Schedule sub-tab and a second calendar on the Unit Leader's Interviews tab shipped for
  about an hour and were taken out the same day; do not bring either back). "The unit leaders can
  put their availability (time), since the interviews are only scheduled for 2 days each time. HR
  can add the times too and then HR books the interviewees."
  - **Residency > Calendar is the schedule.** `ActivityCalendar.jsx` reads `useInterviewSchedule`
    beside the events, holidays and residents' working days: every unit's times as chips in the
    month cells, in the day panel and the day modal as rows with the actions (Book, Block, Reopen,
    Cancel, Remove), + Open Times beside Add Event, the three interview entries in the legend, and a
    unit filter with the Paired Applicants sheet under the calendar. Booking lists the applicants
    paired with that unit (`bookingChoices`); one who holds a time is MOVED; an interview with a
    result is changed in the binder, never here. A booking writes the binder's interview
    (scheduled, the time, the span's format); Cancel opens the time and clears the binder only
    while it still holds that time. Talent Acquisition opens, books and cancels (the cohort's
    `canManage`); Add Event stays the staff app's. Server: `lib/server/ngrpInterviewSchedule.js`,
    reads through `ngrp-workspace` `schedule`, writes through `ngrp-manage` `schedule_*`. No SQL.
  - **The Unit Leader's one calendar is on At a Glance** (`UnitRotationCalendar.jsx`), with
    **Internship | Residency** beside **Month | Week**. Internship is the rotation activity it
    always was (tan paper); Residency (slate) is the unit's interview times with Open Times in the
    toolbar and Block, Reopen and Remove in the day panel, through the Interviews endpoint's own
    writes, which `HomeScreen` loads (`fetchUnitInterviews`) and hands down as `interviewActions`
    (null for an Owner/Admin preview). The Interviews tab keeps the tiles, the results and the
    rubric, and draws no calendar.
  - **ONE-CALENDAR-2 (Owner, 2026-10-06, same day):** the Internship | Residency picker is At a
    Glance's, at the top left above the calendar, where Student Profiles puts its picker; the
    calendar takes `mode` as a prop and keeps only Month | Week inside. Internship is the shift
    calendar over Your Students; Residency is the interview times over the unit's interview
    results (`UnitInterviewResults.jsx`, the one table the Interviews tab also draws), whose
    Open Rubric goes to `interviews?candidate=<id>`, which the Interviews tab reads on arrival.
    Residency's sub-tabs are Interview Board, Calendar, Residents: the Calendar follows the board
    that pairs the applicants it books. The Residency Calendar's table is the internship
    Interviews tab's own KPI cards and `ir-worklist` rows (Applicant, Appointment, Their Choice,
    Panel from the binder's `interview_panel`, Open Applicant), never a DataSheet.
  - **ONE-CALENDAR-3 (Owner, 2026-10-06):** the Residency view "should also show the residency
    events: application, cohort start date, interview dates". So it draws the cohort's key dates
    (`cycleDateItems` in `interviewScheduleModel.js` over the cycles the Interviews endpoint now
    returns with their dates: Application opens, Application deadline, Interviews begin and end,
    Residency starts; the licensure deadline is the alumnus's and stays off) and the ASPIRE
    events delivered to unit leaders (`usePortalCalendarEvents('unit_leader', range)` in
    `useMastheadFeed.js`, the masthead's own feed asked for the calendar's visible month or week,
    which the calendar reports through `onRangeChange`). Both are chips in the cells, rows in the
    day panel and the Week view's all-day row, in the Residency event grey with paper ink. The
    calendar stays props-only: At a Glance fetches, the calendar draws.
  - **One set of parts for both**: `src/components/ngrp/InterviewTimesControls.jsx` (the day-panel
    row, the Remove action, the month chips, the legend entries, the Open Times dialog and its
    button, the Book dialog), with the words and colours in `src/lib/ngrp/interviewScheduleModel.js`.
- **Every booking, move and cancel is emailed** (Owner chose alumnus + unit): the applicant at
  their residency address (`residencyRecipient`: the Transition Form's preferred email, else
  personal) and every unit leader with an active `unit_leader` grant and an active unit scope for
  that unit, each with an .ics (`lib/server/email/ngrpInterviewEmail.js`). One UID per applicant
  per cohort, so a move updates the same calendar event and a cancel cancels it (`METHOD:CANCEL`).
  From noreply, reply-to ngrp@cshs.org, through `createMailer()` (the demo guard), each send a
  `notification_log` row of type `ngrp_interview_notice`. A notice never fails the booking; the
  toast says who was emailed and who was not (`noticeSummary`). There is no self-booking by the
  alumnus: HR books.

## A portal has an ASPIRE Connect (PORTAL-CONNECT-1, 2026-10-07)

Owner: "look at the tabs, they're getting so many. We can cluster the contacts and messages
together to go inside the ASPIRE Connect app the way it is in the main staff app", for the NE&L
Portal and the Residency Portal alike, with Outreach and Automations to follow for Residency.
`src/portal/connect/PortalConnect.jsx` (rules in `portalConnectModel.js`) is the one shell:
`PortalConnectHeaderButton` is the staff header's Connect icon drawn by the shared
`ConnectIconButton` (`src/components/Header/ConnectIconButton.jsx`, the same 36px nightfall control,
pin badge and caret as HeaderActions; change the look in both), portaled into the shell's
`PortalHeaderControls` slot beside the scope picker; `PortalConnectPage` is the canonical
`SegmentedPicker` reading Contacts | Messages above the open workspace, Contacts kept mounted and
hidden as the NE&L sections always were.

- **NE&L**: Contacts and Messages left the section nav (At a Glance, Budget Tracker, Community
  Benefit, Evaluation remain, still alphabetized). Routes are `/portal/academics/connect/contacts`
  and `/connect/messages[/:thread]`; the old `/portal/academics/contacts` and `/messages` still
  resolve and are replaced on arrival (`naLegacyConnectPath`). The icon carries the unread count
  and opens Messages when something waits, else the last tab used (`aspire.portal-connect.lastTab`,
  in the sign-out registry). The floating Messages launcher stays everywhere but on Connect >
  Messages (`messagesRoutes.js` lists the new prefix). The tour's Contacts and Messages steps are
  one step on `[data-tour="portal-connect"]`.
- **Residency**: the same icon and page at `/portal/residency/connect/*`; on it no workspace tab
  is current (`ResidencyNav tab={null}`). Contacts is the NE&L directory ported as is: the server
  lets a `talent_acquisition` grant READ it through `verifyPortalContactsReader`
  (api/lib/nursingAcademicScope.js, the NE&L guard first, then the TA grant, view only), and the
  avatar upload and every write keep the NE&L-only guard. **Messages for Talent Acquisition is not
  built**: `api/lib/messagesAuth.js` admits four roles and who HR may message is an Owner decision,
  so the page shows the prepared state the NE&L Portal showed before its capability was switched on.
- **The page is drawn as the staff Connect is** (PORTAL-CONNECT-2, Owner, 2026-10-07, same day):
  on Connect the shell draws NO section nav and NO footer (`PortalShell connectPage`, which also
  drops the main's bottom padding); the page carries a back pill to the section the person came
  from (its path rides the router state `from` into Connect and along its tabs and threads; a
  pasted link goes home) and `PortalNavRefresh` on one row, then "ASPIRE Connect" with its line,
  then the Contacts | Messages picker. The row and the title scroll away, the picker pins under
  the nightfall header (`position: sticky; top` = the measured chrome, z-index 10 under the
  chrome's 20), and the body below it is `useChartViewport`'s height: Contacts is LOCKED to it
  (NA-CONTACTS-LOCK-1, Owner: "the panes are stuck or frozen, the contents are scrollable": the
  section is a flex column filling the body, the KPI cards and search row keep their height, the
  two panes take the rest and only the list and the record scroll); Messages keeps its own
  scrolling at no less than that height. `.ptl-connect` keeps 12px under the body so the end of
  the scroll puts the picker exactly under the header. NE&L keeps the page mounted hidden while
  on other sections, so the hook takes a `remeasureKey` (`${active}:${tab}`) and measures again
  when the page is shown: a hidden bar measured once would have left it with no height. Phones
  stack the panes and scroll as before. Measured in a harness with the real shells at 1440x900
  and 1000x700: picker top equals chrome bottom at the end of the scroll, body bottom is the
  window less 12, the page scrolls only by the row and the title.
- **A nested `.ptl-page` has no 100vh minimum** (NESTED-PAGE-1). PortalShell's wrapper is a
  `.ptl-page` and every portal's root is another one inside `<main>`; the inner one inherited
  `min-height: 100vh`, so every portal page scrolled by the chrome's height even when its content
  fit. That was the "space at the bottom". `.ptl-page .ptl-page { min-height: 0 }`.

## Every section nav is one size (NAV-CANON-1, 2026-10-07)

The Owner saw the Residency Portal's tabs smaller than the staff app's and asked what the canon was.
There was none: the staff app's `.chart-nav-tab` (chartTokens.css) said 17px and every portal's
`.ptl-nav-item` (portal.css) said 14px, and the only thing the two bars shared was the hairline. The
staff values are now the canon, as tokens in `src/styles/aspireBrand.css`: `--aspire-nav-size` 17px,
`-tablet` 15px at or below 1100px, `-narrow` 14px at or below 760px, the tab padding
(`--aspire-nav-tab-pad*`) and the bar's side inset (`--aspire-nav-inset*`, 32px then 12px). Both
rules read them, so all four portals (Student, Unit Leader, NE&L, Residency) now match the staff
app, and a change to the size lands in one place. The portals' phone bottom bar (under 760px) is a
different control and keeps its own 11.5px. `test/uiCanonRatchet.test.mjs` holds both rules to the
tokens.

## The chart measures the elements, never the document (VIEWPORT-REVERT-1, 2026-10-07)

`useChartViewport` sizes every pinned split: Student Profiles, Residency > Profiles & Interest
(and the Residency Portal's), Connect's address book and the Modern Contacts. The Owner found the Student Profiles split a third shorter than its
window with the KPI cards no longer scrolling away. RESIDENCY-PORTAL-WIDTH-1 had taught the hook to
leave room for what a page draws below the chart (a portal's footer) by reading
`document.scrollHeight - tab.bottom`, and the app shell's `min-height: 100vh` made the EMPTY space
under a short page count as trailing content; a warmed-up tab (display:none, 0px tall) took one
measurement at the 420px floor and that locked it: the split shrank until the page stopped scrolling.
`trailingBelow(tab)` now sums the in-flow siblings after the tab and every ancestor's bottom padding
up to `<body>`, a hidden bar is never measured (`if (!barH) return`), and `test/studentChart.test.mjs`
refuses `documentElement.scrollHeight` in the hook. Measured in a harness with the staff shell's
shape (sticky chrome, min-height 100vh, hidden sibling tabs, a fixed launcher): split = window minus
the pinned stack minus 12px, the KPI strip scrolls away, and the bar lands under the chrome at the
end of the scroll; the portal shape (padding plus footer, 77px) still gets its 77.

Three things that shipped with it, same day:

- **Residency > Calendar's table is laid out as the internship Interviews tab's** (CALENDAR-TABLE-1):
  the heading row, the KPI cards and the `ir-worklist` straight on the page, as wide as the calendar,
  with the canonical `EmptyState` when no one is paired. It used to sit inside a `.snap` card, which
  has no padding of its own, so everything was flush against a second card's edge 20px inside the
  calendar's. That was what "looks weird" and "still looks buggy" meant.
- **The Outreach preview fills its column in the Classic desk too** (PREVIEW-FILL-1). Classic kept a
  fixed 520px iframe under a scrolling panel while Modern expanded; a tall window showed a strip of the
  email. Both composers (send-to-one and bulk) now pass `outreach-preview-scroll outreach-preview-expand`
  in both styles, and the Classic sheet carries the same expand rules; 520px is the floor.
- **NE&L Portal > Contacts was NOT changed in the end.** A first cut sized its directory with the
  hook too (NA-CONTACTS-FILL-1); the Owner: "there was actually nothing wrong before ... now you just
  ruined the scrolling". Reverted the same day. Its cards stay content-sized, capped at 68vh.
- **The pinned toolbar sits under a portal's chrome** (PORTAL-TOOLBAR-Z-1): `.ptl-topsection` is
  z-index 20, the same as `.profiles-toolbar`, and the toolbar came later in the document, so in the
  Residency Portal it drew over the profile menu. `.ptl-page .profiles-toolbar` is 10 (ngrp.css).

## The planner has a Week view (ONE-CALENDAR-1, 2026-10-06)

`src/components/shared/CanonicalWeekView.jsx` is the one Week view, with its arithmetic in
`src/lib/calendarWeek.js` (pure, tested): seven Sunday-first columns, an all-day row for things
with a date and no clock (holidays, all-day events, residents' working days, a shift with no
check-in), and an hour grid for things with a start and an end. A host hands it `allDayOn(ymd)`
and `timedOn(ymd)` and it draws nothing of its own. The Residency Calendar and the Unit Leader's
calendar offer Month | Week through it (the Unit Leader's Internship week runs 6 AM to midnight,
because shifts run 7 to 7; the interview weeks keep 7 AM to 8 PM). An item that starts before
the first hour or ends after the last is clamped to the grid so its label stays in view.

**The week opens on its first entry, never on 7 AM.** The main app's Interviews week (its own
`WeekView` in `InterviewCalendar.jsx`, 140px an hour inside the planner's 560px box) opened at
7 AM with a day of 9:30 interviews 350px below the fold, which the Owner read as "the week view
is not showing schedules". Both week views now set their scroller to the first timed entry of
the week (`weekScrollTop`), 8 AM when there is none; `test/calendarWeek.test.mjs` pins the
numbers. The box is still the constant size the planner promises.

**The Unit Leader's At a Glance in dark mode is clean** (UL-DARK-1, 2026-10-07). The cause was one
pattern three times: a surface that follows the theme holding light-mode literal inks. The Modern
calendar shell turns dark but the portal's calendar primitives kept #374151 day numbers, a navy
name and #6b7280 notes; `plannerCalendar.css` now repoints those to the sheet's tokens under
`[data-theme="dark"] .canonical-calendar-modern`, exactly as planner rule 5 does for the planner
skin. The roster card (`--ptl-card`, dark in dark mode) had #191919 and #6b7280 inks; in dark they
read `--text-heading` / `--text-caption`. The masthead's empty line sits on the fixed cream page and
is pinned like its head. Swept every text node on the whole home (calendar Month and Week,
Internship and Residency, roster, interview results), transitions off: dark 0 failures, lowest
4.56:1. Light is unchanged except the shared inks below; its only failures are the mini calendar's
deliberately faint weekday letters, out-of-month and future numbers.

**Three shared near-misses fixed the same day:** the grey pill pair (GREY-PILL-1: `#6b7280` on
`#f3f4f6`, 4.39:1, in 28 files, now `#4b5563`, 6.87:1; `PILL_FAMILIES.mute` and every other place
that pairs the two); the table header ink (TH-INK-1: `--aspire-th-color` `#6b7785` to `#5f6b78`,
5.20:1 on the header band, and the dark worklist header reads that token instead of
`--color-text-muted`); and the portal's quiet text (PTL-MUTED-1: `.ptl-muted` `#6b7280` to
`#5b6472`, 5.31:1 on cream).

## The Action Center can dismiss (AC-DISMISS-1, 2026-10-07)

Owner: a way to dismiss notifications and actions, not only snooze them, and an end to the
actions that never leave.

- **Dismiss is "until it changes", never "forever".** An Action Center item is derived from live
  state, and some keys are broad (`rr:<workflow>` is every release of that workflow), so a
  permanent dismissal would hide future work. Dismiss writes an `action_snoozes` row keyed
  `<item key>@<sig>` for `DISMISS_DAYS` (90); `applySnoozes` hides an item when its key OR its
  dismiss key is snoozed. `sig` is set by `normalizeHomeQueue` (a row's own `sig`, else its pill
  and meta; a conversation's last message) and `normalizeSupportQueue` (the latest event). **A row
  whose words count down every day must set `sig`**, or its dismissal lasts a day: renewals (the
  date), Concur (deadline, receipt, late), messages (last message, flag), behind on hours (hours
  logged). No SQL. Urgent items are never dismissed. Every other item also gets Snooze, with In a
  week beside Tomorrow and Monday.
- **A blocked slip counts as work only when the team can act on it**: `needsStaff` in
  `reviewQueueShape.js`, read by Needs you and so by the Action Center. Not counted: a student still
  finishing a survey (`remind`, the reminders already run), a step behind (`jump`, counted on its
  own clipboard), and a response that can never be released until "won't release" exists. The
  clipboard still shows every slip. The words are "to fix", not "blocked by a prerequisite".
- **Won't release** (Unit Leader release only): a response `rowIsReadOnly` says can never be released
  offers Mark as won't release (confirmDialog) and moves to the tape, where Put back undoes it. The
  record is `evaluation_release_withholds`, written only by `ul_eval_withhold_response` /
  `ul_eval_unwithhold_response`, which refuse a releasable row; an undo stamps `undone_at` and the
  row stays. The guarded `evaluation_response_unit_release` table is untouched.
- **Notifications**: an x per row (a sibling of the row's button) and Clear read (read ones only),
  both with Undo, through `dismiss_staff_notifications` / `restore_staff_notifications` (the caller's
  own rows; a dismissed one is also read). The webhook no longer writes "Outreach delivered" notices.
- Migration `20261112000000_action_center_dismiss.sql` is Owner-gated; before it, notifications
  read as before with no x, and "won't release" is not offered. Checks:
  `db/audit/action_center_dismiss_checks.sql`.

## Moderation is one stack per unit (MODERATION-STACKS-1, 2026-10-07)

Evaluation > Review & Release > Release to Unit Leaders groups the responses waiting on moderation
into one stack per unit, the way Apple groups notifications by app (Owner). Reference:
`docs/mockups/moderation-stacks.html`. Rules: `src/lib/evaluation/moderationStacks.js` (pure).

- **A stack shows what the leader would see**: each response's allowlisted numbers, which the queue
  endpoint now reads from the response (`leaderSeesFromResponses`, the same `QUANTITATIVE_PATHS`
  allowlist the portal uses, never text) and returns as `leader_sees`, to Owner and Admin only. The
  overall rating is worded with the instrument's own anchors (Excellent to Poor).
- **"Clear and release N" is the two existing RPCs per response** (moderate cleared, then release),
  one response at a time, so the database still checks and logs each one; a refusal stops nothing
  else and the notice names the first reason. **Release all** covers every stack with more than one
  response; one confirmation lists the units and counts.
- **A single response is never anonymous**: its stack stands alone, says "Not anonymous", and is
  left out of Release all. **A Fair or Poor rating stays in** (Owner): the stack says "Worth a look"
  and nothing more.
- **Hold** is moderation blocked (Owner kept the word). A held response leaves the stack for Needs a
  fix, where Clear moderation releases it again, and `blockerOwner` reads it as `held`, so it is not
  counted in Needs you or the Action Center.
- **The sheets beneath peek out in Classic** (Owner: "peek sheets fine"), drawn as layered
  box-shadows because a pseudo-element under the card is painted over by the board. Modern draws
  the stack as a plain card.

## Unit leaders see the preceptor's answers in words (UL-CHOICE-WORDS-1, 2026-10-07)

Owner: "show answers as words". The Preceptor's Assessment stores its readiness and endorsement
answers as fixed phrases, and the release gate passed numbers only, so a released preceptor
response showed its unit leader nothing. Now a phrase passes **only when it is exactly one of the
question's own options**: `evaluation_unit_choice_keys` in the database
(`20261113000000_ul_eval_choice_answers.sql`, Owner-gated) and `CHOICE_OPTIONS` on the server
(`lib/server/unitEvaluations/config.js`, read from `preceptor_progress_validation.js`; a test holds
the two equal). `sanitizeQuantitative` keeps a listed phrase, `sanitizeChoiceCounts` shapes the
summary's `choice_counts`, and `assertUnitLeaderShape` throws on any other string, so a typed
comment can never reach a unit leader. The portal shows them as Preceptor Answers (each phrase with
its count) and in the response table and modal as written; Review & Release's stacks show the same
phrase. Never add a free-text path to either list.
