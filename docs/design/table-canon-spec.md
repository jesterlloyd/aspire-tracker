# ASPIRE Intelligence: Table Canon

Every table in the app is one component, `DataSheet`, at one of three levels. Point every future build prompt at this file instead of restating the table rules.

REFERENCE: `docs/mockups/table-canon.html` in this repo. It renders all three levels on the same data, with each invariant shown as a live specimen. Open it before building.

---

## 1. Choosing a level

Three questions, in order. Stop at the first yes.

| Question | Level | Chrome |
|---|---|---|
| Does it stand alone at full width and hold a record you read or export? | **Full sheet** | Tractor holes, crease, paired bands |
| Does it sit inside a card, a panel, or a narrow column? | **Plain sheet** | Paired bands, rules, no holes |
| Is it five rows or fewer inside another component? | **Inline rows** | Paired bands only |

Tractor holes cost 76px of horizontal width and they announce a standing record. Spend them only where both conditions hold. If every table has holes, the holes stop meaning anything.

Current assignments:

- **Full sheet:** Evaluation Responses roster, Interviews Focus Table View, hours logs, audit trails, export previews.
- **Plain sheet:** Student Profiles documents / hours / evaluations, Placement Requests on At a Glance.
- **Inline rows:** Placement Capacity by service line, short summary lists inside KPI cards.

## 2. The boundary

**A row that exists to be acted on is not a table row. It is a slip, and it belongs on a clipboard.**

Release, Snooze, Dismiss, Assign, Match: these are decisions, so those rows are slips on a pressboard, per the Review & Release spec. Sorted, exported, read, expanded: those are printout rows. Do not convert a clipboard queue into a table, and do not put a decision button in a table row. An action in a table row may only open something elsewhere.

## 3. The invariants

These hold at all three levels. They matter more than the holes.

1. **Paired banding.** Rows 1 and 2 of every four take `--band`. Never single striping, which breaks down past about five columns.
   ```css
   .rbody .row:nth-child(4n+1), .rbody .row:nth-child(4n+2){ background: var(--band); }
   ```
   Implementation note (2026-09-19): `DataSheet` writes the band to the row as `data-band`, computed from the row's index within its page, because an expanded detail panel is a sibling row and would shift every `:nth-child` band below it. The rule is the same; only the selector differs.
2. **Name, middot, qualifier.** The first column is the entity plus its one distinguishing detail on a single line: `Adam Friedenthal · Accel BSN`. Never two stacked lines, never a separate column for the qualifier alone.
3. **One number, one column.** Every figure gets its own right-aligned column with `font-variant-numeric: tabular-nums`. Never pack values into a cell as a sentence (`CPS 4.00 · LA 3.80 · PR 3.75` is wrong).
4. **Every header sorts.** Headers are buttons. Clicking the active header reverses direction. The arrow renders only on the active column.
5. **Status is one word in a pill.** Four tones only: green settled, amber waiting on someone, blue in progress, grey inactive. A status needing a sentence goes in the expanded detail.
6. **Missing is an en dash** in muted ink, never an empty cell. An empty cell reads as a rendering bug.
7. **Expansion opens a bordered panel:** `--paper-2` background, 3px navy left border, label-value pairs with mono uppercase labels. Same shape everywhere.
8. **Pagination is a crease**, on the full sheet only: a full-bleed dashed rule with a soft gradient and the word "continued" on a `--paper` chip, every **ten** rows so the creases count by tens (Owner, 2026-09-20; the first build used eight). Not numbered page buttons.

## 4. Tokens

```
--paper:#FCFDFA;  --paper-2:#F1F4EE;  --paper-ink:#1B2140;  --paper-muted:#61667E;
--rule:rgba(30,42,110,.13);  --band:rgba(15,122,77,.045);
--hole:#EDEAE2;  --hole-in:#DAD5C8;
dark:
--paper:#1C1F2C;  --paper-2:#171A25;  --paper-ink:#E9EAF2;  --paper-muted:#A0A4BC;
--rule:rgba(159,176,245,.16);  --band:rgba(60,203,138,.055);
--hole:#12151F;  --hole-in:#0C0E16;
```

## 5. Level mechanics

**Full sheet**
```css
.ds[data-level="full"]{ border:1px solid var(--rule); border-radius:3px; padding:0 38px; overflow:hidden;
  box-shadow:0 1px 1px rgba(24,32,63,.1), 0 10px 26px rgba(24,32,63,.13); }
.holes{ position:absolute; top:0; bottom:0; width:38px; background:var(--hole);
  background-image:radial-gradient(circle at 19px 13px, var(--hole-in) 0 5.5px, transparent 6px);
  background-size:38px 26px; pointer-events:none; }
.holes.l{ left:0; border-right:1px dashed var(--rule); }
.holes.r{ right:0; border-left:1px dashed var(--rule); }
```
Crease every 10 rows. Header row sits on a 1.5px `--paper-ink` rule. Content is inset 20px inside the hole strips (`--ds-inset`), so a title never sits against the holes and a button never sits against the edge; the crease stays full-bleed.

**Plain sheet:** same rows, `border-radius:8px`, `padding:0 14px`, no holes, no crease, no outer shadow.

**Inline rows:** no background, no border, no padding, banding only. Header rule drops to 1px `--rule`.

## 6. Grid

Columns are declared once and reused by the header and every row, so they cannot drift. Each column declares a minimum width and a share of the spare width, and its track is `minmax(min, grow fr)`:
```js
const GRID = COLS.map(c => `minmax(${c.min}px, ${c.grow}fr)`).join(' ') + ' 28px';  // trailing 28px is the expand chevron
```
**Weighted spread** (Owner, 2026-09-20): every column grows from its minimum in proportion, so the name column stays widest (grow 2.2), the school next (1.4), the date and status less (1), and each figure least (0.7). Nothing bunches at one edge and the figures stay right-aligned under their headers. Text columns truncate with `text-overflow: ellipsis` and a `title` attribute. Rows never wrap, and the page never scrolls sideways. Below the width the visible columns need, drop the lowest-priority columns whole (priority 1 is never dropped) rather than shrinking all of them.

## 7. Accessibility

- Sort headers are buttons carrying the current direction in their accessible name.
- Expand chevrons use `aria-expanded` and an `aria-label` naming the row.
- Announce sort changes and row expansion through an `aria-live="polite"` region.
- Banding is decorative. Never encode meaning in it.
- Status pills carry their text, never color alone.
- Respect `prefers-reduced-motion`.

## 8. Inventory and rollout

Every table in the app, with its level. Build `DataSheet` during step 1, then convert the rest by swapping markup for the component. Do not restyle any of them separately.

| # | Table | Screen | Level | Notes |
|---|---|---|---|---|
| 1 | Evaluation Responses roster | Evaluation > Responses | **Full sheet** | Builds the component. Must come first. |
| 2 | Focus Table View | Interviews | **Full sheet** | Second true full-sheet table. Proves the component on a wider column set. |
| 3 | Rotation Activity log | Rotation > Activity, below the calendar | **Full sheet** | Shift records by student and unit. A standing record. |
| 4 | Preceptors roster | Rotation > Preceptors | **Full sheet** | Unless it sits inside a panel, in which case plain sheet. |
| 5 | CS-Link Access | wherever it currently lives | **Full sheet** | A compliance record, so it qualifies if it stands alone. Confirm where it renders before assigning. |
| 6 | Placement Requests | At a Glance | **Plain sheet** | Grouped by school inside a card. Keep the expand and collapse. |
| 7 | Student Profiles hours, documents, evaluations | Student Profiles | **Plain sheet** | Inside the chart binder. No holes, no crease. Do not touch the binder itself. |
| 8 | Placement Capacity | At a Glance | **Inline rows** | Five service lines inside a card. Banding only, no sheet chrome. |

### Not a table: Interview Recommendations

The recommendations list below the Interviews calendar is the boundary case from section 2. Apply the test before converting it:

- If each row **suggests a match and you act on it** (schedule, accept, dismiss), it is a queue of decisions. Build it as **slips on a clipboard**, matching Review & Release. Do not make it a `DataSheet`.
- If it only **reports** recommended pairings and any action opens another screen, it is a record. Plain sheet.

Decide this before writing code. Converting a decision queue into a table is the one mistake this canon exists to prevent.

### Order

1. Evaluation Responses (builds `DataSheet`)
2. Focus Table View
3. Rotation Activity, then Preceptors
4. At a Glance: Placement Requests, then Placement Capacity
5. Student Profiles lists
6. CS-Link Access
7. Interview Recommendations, after its level is settled

Steps 3 through 6 touch shipped code. Each is a markup swap, not a rewrite, but run them one screen per session so a regression is easy to isolate.
