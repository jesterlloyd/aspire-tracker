TASK: Restyle the ASPIRE calendars as a desk planner: a two-ring notepad holding the mini calendar and day detail, and a stacked calendar sheet, both resting on a colored desk pad. One shared component, three paper themes, one theme per surface. Month and week views both keep working.

REFERENCE FILE: docs/mockups/planner-calendar-mockup.html in this repo. Open it first and read its CSS and markup. It is standalone, uses synthetic data, and carries all four calendar surfaces behind a switcher so you can see each theme. The spec below is the source of truth; the file shows the intended result.

## 0. SURFACE TO THEME MAPPING (read this first)

The planner is ONE component. The only thing that changes per surface is the paper theme, set by a `data-paper` attribute on the planner root (or on `:root`, as in the mockup).

| Surface in the app | Calendar | Paper theme | Desk pad |
|---|---|---|---|
| Interviews tab (main app calendar) | Interview scheduling, month + week | `slate` (default, no attribute needed) | cool gray-blue |
| Rotation > Activity | Clinical activity / shift log | `tan` | warm leather |
| Residency > Rotation > Activity | Residency workshops, town halls, bootcamps | `forest` | deep green |

Rules:
- The theme is a property of the surface, not a user setting. Do not ship a per-user paper picker. The mockup has a Slate/Tan/Forest override segment purely so I can compare them side by side; leave it out of the app, or keep it behind a dev flag only.
- Each surface sets its theme once, at the top of its page or container. Everything below inherits.
- The Nursing Education & Leadership portal rotation calendar uses `forest` as well for now. Flag it in your PR so I can confirm before you touch it.
- Student Portal home and Unit Leader home calendars are OUT OF SCOPE for this pass.

## SCOPE AND GUARDRAILS
- Build the shared planner component once, then adopt it surface by surface in the order above: Interviews, then Rotation > Activity, then Residency > Rotation > Activity. Ship Interviews first and let me see it before moving on.
- Change only the presentation layer. Keep the existing data model, API calls, availability and booking logic, permissions, and audit logging.
- Keep every current feature on every surface: the primary action button (Focus Table View on Interviews, Shift Log on Rotation, Residents on Residency), the person color chips, My schedule and Everyone's schedule, previous and next, Today, Add Availability, Add Event, the Month and Week toggle, the mini calendar, the Today panel, and any section that currently renders below the calendar (for example Interview Recommendations).
- Before writing code, list the calendar component files for all three surfaces and tell me which ones you will change, and which are already shared. If the three surfaces currently have three separate calendar implementations, say so and propose the smallest sane way to unify the shell while leaving each surface's data layer alone.
- Confirm where these live for each surface: entries per day with person and time, open availability slots, ASPIRE events, federal holidays, and the "fully booked" state. If any of those is derived rather than stored, say how.
- Reuse the tokens already added for the placement board, the rubric book, and the student chart. Do not duplicate them.
- Support light and dark mode. Respect prefers-reduced-motion.

## 1. LAYOUT
- The whole panel sits on a desk pad, with the mini calendar and Today panel as one sheet on the left (300px) and the calendar as a second sheet on the right, 16px apart.
- Below 960px the sheets stack: notepad first, then calendar. Hide the rings at that width.
- The calendar area is a FIXED height (560px) in both views. Switching Month and Week must not change the panel height. The month grid divides that height evenly across however many week rows the month needs (drive it with a `--weeks` custom property). The week view fills the same box and scrolls its hours inside.

## 2. THE DESK PAD (container)
- Pad padding is `20px 24px 28px 16px`. This is asymmetric on purpose: the page stacks under both sheets extend to the right and below, so the right and bottom margins need the extra room or the border looks pinched on the right. Do not normalize this to a single value.
- border-radius 6px.
- Background is a vertical gradient over a flat base color, with an inline SVG feTurbulence noise layer (baseFrequency .9, numOctaves 3, alpha .5) blended `soft-light`. Gradient stops come from the theme tokens: `linear-gradient(180deg, var(--pad-a), var(--pad-b) 55%, var(--pad-c))`.
- box-shadow: `inset 0 1px 0 rgba(255,255,255,.14), 0 2px 3px rgba(24,32,63,.35), 0 10px 22px rgba(24,32,63,.18)`.
- Dark mode: `linear-gradient(180deg,#2B3145,#1E2333 55%,#181C29)`, no noise, for every theme. The paper themes are a light-mode distinction.

## 3. PAPER THEME TOKENS

Define these three sets. Slate is the default on `:root`; the other two hang off `[data-paper="..."]`.

**slate** (default)
```
--paper:#FDFCFA; --paper-2:#F6F5F2; --paper-ink:#1B2140; --paper-muted:#61667E; --rule:rgba(30,42,110,.12);
--pad-a:#5A6280; --pad-b:#434A60; --pad-c:#373D51; --pad-d:#5A6280;
pad background-color:#4A5168;
```

**tan** — Rotation > Activity
```
--paper:#FBF3E2; --paper-2:#F3E8D0; --paper-ink:#3A2E1C; --paper-muted:#7A6647; --rule:rgba(120,90,40,.22);
--pad-a:#C9A470; --pad-b:#A87F4C; --pad-c:#8A6538; --pad-d:#BE9A66;
pad background-color:#A87F4C;
```

**forest** — Residency > Rotation > Activity
```
--paper:#F7F7F1; --paper-2:#EDEDE3; --paper-ink:#1E2A22; --paper-muted:#5C6A5E; --rule:rgba(30,60,40,.16);
--pad-a:#3E5A48; --pad-b:#2E4636; --pad-c:#23372A; --pad-d:#446250;
pad background-color:#2E4636;
```

Everything inside the sheets — headings, day numbers, rules, dashed separators, muted labels — reads from `--paper-ink`, `--paper-muted` and `--rule`, never from hardcoded values. That is what makes one component serve three surfaces.

Chip and status colors do NOT change per theme. Navy #1E2A6E, green #0F7A4D, amber #8F5A0A, red #A32A32 and the KPI tints stay constant across all three, so a scheduled item reads the same everywhere. Re-check chip contrast on tan and forest paper; if a chip fails, adjust the chip's text color, not the palette.

## 4. THE SHEETS
- Square corners. No rounded sheets, no torn edges, no punched holes.
- Sheet shadow: `0 1px 1px rgba(0,0,0,.32), 0 10px 24px rgba(0,0,0,.34)`.
- PAGE STACK under BOTH sheets: two pseudo-element sheets behind each one, filled with `var(--paper-2)`, each with `0 2px 4px rgba(0,0,0,.3)`.
  - Notepad: layer 1 `left:3px; right:-3px; top:6px; bottom:-3px; filter:brightness(.98)`; layer 2 `left:5px; right:-6px; top:10px; bottom:-7px; filter:brightness(.94)`.
  - Calendar sheet: layer 1 `left:3px; right:-3px; top:5px; bottom:-4px; filter:brightness(.98)`; layer 2 `left:6px; right:-7px; top:9px; bottom:-8px; filter:brightness(.94)`.
- The stack pseudo-elements live on a wrapper around the sheet, not on the sheet itself, so nothing clips the rings.

## 5. THE RINGS (notepad only)
- Two chrome rings straddle the TOP edge of the left sheet, centered, 120px apart.
- Each ring: 15px wide, 27px tall, radius 7px, at `top:-11px`, above the paper in z-order.
- Fill: `linear-gradient(90deg,#7F8794 0%,#DDE2EA 20%,#FFFFFF 36%,#C2C8D3 58%,#787F8B 80%,#AEB4BF 100%)`.
- Shading: `0 2px 3px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.9), inset -2px 0 3px rgba(0,0,0,.28)`.
- Each ring casts a blurred shadow onto the paper where it crosses the edge.
- Decorative: `aria-hidden`, `pointer-events:none`. The rings are the same chrome on all three themes.
- The calendar sheet has no rings and nothing holding it down.

## 6. LEFT SHEET: MINI CALENDAR AND DAY DETAIL
- Mini calendar with its own previous and next, so it can look ahead without moving the main grid.
- Under each mini day, up to three dots. The dot colors follow the surface's entry kinds: navy for scheduled/assigned, green for open or active, amber for an event or holiday.
- Today is a filled navy circle. The selected day gets a navy ring.
- Below a hairline rule: the label switches between "Today" and "Selected day," then the full date, then a count line, then the day's entries with time on the right and the person or location underneath. Empty days get a plain-language empty state for that surface ("No interviews or open slots on this day" / "No activity logged on this day" / "Nothing scheduled on this day").
- A legend closes the sheet, listing that surface's entry kinds: Interviews gets scheduled interview, open availability, ASPIRE event, federal holiday; Rotation gets its shift kinds; Residency gets workshop, town hall, bootcamp, holiday.

## 7. RIGHT SHEET: THE CALENDAR
- Header row: previous, next, Today on the left, the month or week title centered, the add actions, then the Month and Week toggle. Style these as paper controls: white at 55% over the sheet, hairline border in `--rule`, navy on hover. The active view segment is solid navy.
- MONTH: seven columns on ruled paper. Each cell shows the day number, then chips. Cap the chips at two rows; if more exist, show the first chip plus a "+N more" chip and drop the initials row for that cell. Cells clip their overflow. Today's number sits in a navy circle. Days outside the month fade to 40%.
- WEEK: a time gutter plus seven day columns, an all-day row, then hours 7 AM to 5 PM. Entries render as blocks with a colored left edge.
- Clicking any day in either view selects it and updates the left sheet. Clicking a mini calendar day also moves the main grid.

## 8. PER-SURFACE CONTENT DIFFERENCES

Same shell, different chips and different day detail. Keep whatever each surface renders today; do not invent new entry types.

- **Interviews (slate):** chips are "Fully booked" (red), "N scheduled" (pale blue), "N available" (pale green), event (sand with amber left edge), holiday (amber), then small colored interviewer initials. Primary button: Focus Table View.
- **Rotation > Activity (tan):** chips are the shift/activity entries already rendered there, with the unit or preceptor as the secondary line. Primary button: Shift Log.
- **Residency > Rotation > Activity (forest):** chips are Workshop (pale blue, navy left edge), Town hall (pale green, green left edge), Bootcamp (sand, amber left edge), Holiday (amber, no edge). Day detail shows title, time and location. Primary button: Residents.

## 9. FILTERS
- Clicking a person chip toggles that person out. Dim the chip and strike it through, and remove their entries from the month counts, the week blocks, the mini calendar dots, and the day detail.
- My schedule limits everything to the signed-in user. Everyone's schedule restores all.

## 10. ACCESSIBILITY
- Day cells and mini calendar days are buttons with `aria-pressed` and a full date `aria-label`.
- The view toggle and schedule toggle use `aria-pressed`. Controls show a visible 3px navy focus ring.
- Announce the selected day and the view change through an aria-live region.
- Check chip contrast on all three papers in both themes.

## 11. DONE WHEN
- All three surfaces render as a two-ring notepad and a stacked calendar sheet, with page stacks under both, and each one shows its assigned paper: Interviews slate, Rotation > Activity tan, Residency > Rotation > Activity forest.
- Only one calendar component exists; the theme is the only per-surface style difference.
- The right and bottom pad margins visually match the left and top (the asymmetric padding is doing its job).
- The panel height does not change between Month and Week on any surface.
- Person filters, My schedule, day selection, and mini calendar navigation all work on every surface.
- Every existing control and every section below the calendar still works.
- Tell me which files you changed, whether the three surfaces now share one component, and any data you could not find.
