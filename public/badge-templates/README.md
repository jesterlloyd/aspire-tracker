# Badge Templates

Drop the two approved Cedars-Sinai badge template files here before using the
"Download Badge" feature in the student profile drawer.

## Required files

| File | Contents |
|---|---|
| `front.png` | Front face: Cedars-Sinai logo top-left, "Student Nurse" top-right, large empty photo frame in center, red and gray geometric corners |
| `back.png` | Back face: ASPIRE logo and wordmark at top, QR code with "LOG YOUR SHIFTS" caption, "ISSUE DATE:" and "VALID UNTIL:" labels lower-left, Cedars-Sinai address at bottom |

## Dimensions

The badge generator renders at **750 x 1050 pixels** (2.5" x 3.5" at 300 DPI).

If your source templates are at a different pixel size, they will be scaled to
fit 750 x 1050 while preserving aspect ratio. Areas outside the template's
natural ratio are filled with white.

## Overlay coordinate tuning

If the student name, school, or dates don't land in the right position after
the first print test, open `src/lib/badgeGenerator.js` and adjust the
`FRONT` and `BACK` constant objects near the top of the file.
