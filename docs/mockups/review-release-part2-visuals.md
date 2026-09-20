TASK (Part 2 of 2): Restyle Evaluation > Review & Release as a clipboard. This assumes Part 1 has shipped: six workflows, three states, the shared item shape, and one queue component. This task changes presentation only.

REFERENCE FILE: docs/mockups/review-release-mockup.html in this repo. Open it and read its CSS. The board, clip, slip, chain strip, stamp, and tape rules are all there with exact values. The spec below is the source of truth; the file shows the intended result.

SCOPE AND GUARDRAILS
- Change only the presentation layer. Do not touch detection, release, reminders, permissions, or logging.
- Reuse the tokens already added for the placement board, rubric book, student chart, and planner calendar. Do not duplicate them. Add only the board and tape tokens listed in section 1.
- Support light and dark mode. Respect prefers-reduced-motion.
- Keep every control from Part 1: tools row, policy toggle, Release, Remind, Fix, Jump, Not yet eligible, the Sent log, Undo.

## 1. TOKENS

Add these to the theme file, light then dark:

```
--board-a:#554E43;  --board-b:#403A31;  --board-c:#332E27;  --board-ink:#F1EBDE;
--tape:#EFE9DA;     --tape-ink:#3A3323; --tape-muted:#7A7052;
dark:
--board-a:#2E2A25;  --board-b:#24211C;  --board-c:#1B1815;  --board-ink:#F1EBDE;
--tape:#26231B;     --tape-ink:#EDE4CF; --tape-muted:#A89C7E;
```

Paper tokens (--paper #FDFCFA, --paper-2 #F4F2ED, --paper-ink, --paper-muted, --rule) already exist from the planner. Status colors (green #0F7A4D, amber #8F5A0A, red #A32A32, navy #1E2A6E and their soft tints) already exist from the KPI cards.

## 2. THE BOARD (main panel)

- Warm pressboard: background-color #443E35, background-image = inline SVG feTurbulence noise (baseFrequency .85, numOctaves 3, alpha .55) blended soft-light over linear-gradient(180deg, var(--board-a), var(--board-b) 58%, var(--board-c)).
- border-radius 9px. padding 44px 18px 18px. The 44px top leaves room under the clip.
- box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 2px 4px rgba(16,20,35,.3), 0 22px 48px rgba(16,20,35,.3).
- margin-top 14px so the clip has room above the panel. The rail gets the same margin-top and stretches to the board's height (grid align-items: stretch, rail align-content: start).
- All header text on the board uses --board-ink. Chips are translucent white (rgba(255,255,255,.1) fill, .2 border). The gate chip is warm: rgba(230,165,68,.16) fill, rgba(230,165,68,.4) border, text #F4D9A6.
- Tool buttons: rgba(255,255,255,.08) fill, rgba(255,255,255,.22) border, --board-ink text, radius 7px.

## 3. THE CLIP

- Centered on the board's top edge: width 190px, height 38px, top -13px, radius 8px 8px 13px 13px.
- Fill: linear-gradient(180deg,#F4F6F9 0%,#CDD3DC 16%,#A2AAB6 48%,#E2E7ED 72%,#878E97 100%).
- Shadow: 0 4px 7px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.95), inset 0 -2px 3px rgba(0,0,0,.28).
- A pressed line 23px from the top, 14px in from each side, 2px tall, dark-to-light gradient.
- Two rivets, 7px circles at 22px from each side, 9px from the top, radial highlight.
- Decorative: aria-hidden, no pointer events.

## 4. SLIPS (ready and blocked items)

- Paper: --paper background, square corners, padding 11px 14px 11px 18px, --paper-ink text.
- Shadow: 0 1px 1px rgba(0,0,0,.26), 0 7px 15px rgba(0,0,0,.24).
- Left band: 5px wide, full height. Ready = green. Blocked with a reminder or step-behind = amber. Blocked with a data fix, or older than 7 days = red.
- One sheet behind each slip: --paper-2, offset left 4px right -4px top 4px bottom -4px, brightness .97, shadow 0 2px 5px rgba(0,0,0,.26).
- Blocked slips use --paper-2 as their face so they read one step back from Ready.
- Top row: name in the display face 15px with the sub line under it in 12px muted; on the right, the stamp above the hours block.
- Hours block: mono, "96 / 180 h" with the threshold on a second 10px line. Workflow 1 shows "hours not required".
- Stamp: mono 9px, letter-spacing .1em, 1.5px border in currentColor, radius 3px, rotated -4deg, opacity .8. ok = green, soon = amber, late = red.
- Gap between rows: 8px. Slips are 10px apart in a stack.
- Removing a slip (release): translateX(30px) rotate(1.2deg) and fade over 220ms, then re-render. Jump target: a 1.2s amber outline pulse. Both skipped under reduced motion.

## 5. CHAIN STRIP

- Sits between the top row and the actions row, with a hairline rule above and below (--rule), padding 7px 0.
- Three nodes in a row, each flex 1 1 150px so they wrap to a column at narrow widths. Nodes after the first get a "›" separator at their left edge in --paper-muted.
- Each node: a mono 9.5px uppercase label, then a 12.5px value with a small mono badge.
  - done: badge "✓" in green-soft/green; value in --paper-ink.
  - this: badge "Now" in navy/white; value bold.
  - next: no badge; value in --paper-muted.
  - waiting: badge "Waiting" in amber-soft/amber; value bold amber.
  - fix: badge "Fix" in red-soft/red; value bold red.

## 6. ACTIONS ROW

- Ready: a paper button (Preview email, or "Read her feedback" on workflow 6) on the left, Release on the right. Release is solid green, white bold text, radius 6px, padding 4px 14px.
- Blocked: the blocker sentence in --paper-muted on the left, then the single action on the right. Remind and Fix are paper buttons. Jump is a text link in navy with an arrow.
- Paper button: rgba(30,42,110,.05) fill, --rule border, radius 6px, navy border on hover.

## 7. SECTION HEADERS AND NOT YET ELIGIBLE

- Section headers on the board: mono 10px uppercase, letter-spacing .13em, --board-ink at 78%, with a right-aligned caption in the body face at 45%.
- Not yet eligible: a dashed translucent block (rgba(255,255,255,.05) fill, rgba(255,255,255,.22) dashed border, radius 7px) with a "›" that rotates 90° when open. The list inside is mono 11px in two columns, one column below 700px.

## 8. SENT TAPE

- Full-bleed strip at the bottom of the board: margin 16px -18px -18px, padding 10px 18px 12px, --tape background, --tape-ink text, radius 0 0 9px 9px, a 2px dashed top border at rgba(0,0,0,.18) so it reads as a perforated tear line.
- Header: mono uppercase "Sent from this clipboard" on the left, "Track responses →" link on the right.
- Lines: three columns, time in mono 11px --tape-muted, description in 12.5px, recipient and submission state in mono 11px --tape-muted. tabular-nums. 1px separator at rgba(0,0,0,.08).
- The newest line carries Undo while the toast is live.

## 9. RAIL

- Keep the surface card style. Add: workflow name in 13.5px, "to student" in mono 11.5px muted beneath, badges on the right: green filled circle for ready, amber for blocked, mono 10.5px bold, 20px tall. Selected row is solid navy with white text.

## 10. RESPONSIVE

- Below 900px the rail stacks above the board and loses its top margin.
- Chain nodes wrap to one column below roughly 520px of slip width.
- The board never scrolls horizontally.

## 11. DONE WHEN

- The main panel renders as a pressboard clipboard with a steel clip, paper slips with colored bands and page stacks, a chain strip on every slip, and a perforated sent tape at the bottom.
- Blocked slips read one step back from Ready and their blocker is the first thing you see.
- The rail matches the board's height and top edge.
- Light and dark both hold contrast on the board, the slips, and the tape.
- Nothing from Part 1 stopped working.
- Tell me which files you changed.
