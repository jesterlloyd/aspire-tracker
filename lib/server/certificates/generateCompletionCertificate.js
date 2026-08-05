// lib/server/certificates/generateCompletionCertificate.js
//
// ASPIRE-CERT-COMPLETION-TEMPLATE-1 - PURE, on-demand overlay of the ASPIRE Certificate of
// Completion. Given the static template PDF bytes plus the six display values, it overlays
// the text and returns the finished PDF bytes.
//
// This module performs NO database access, NO network I/O, and NO file I/O: the caller supplies
// templateBytes and every display string (see loadCertificateDisplayFields.js). It never assigns
// a certificate number and never touches certificate_sequences - the number is read from the
// certificates table by the caller and passed in verbatim.
//
// Template: public/certificates/templates/aspire-certificate-of-completion.pdf
//   Static, one-page, landscape US Letter (792 x 612 pt), flattened from the approved editable
//   template (AcroForm removed; artwork untouched). The six overlay boxes below are the exact
//   field rectangles of that editable template, so placement matches the approved design:
//     student_name     x=308 y=312 w=386 h=35   (centered under "PRESENTED WITH PRIDE TO")
//     clinical_unit    x=297 y=197 w=132 h=14   (grey band, under CLINICAL UNIT)
//     rotation_dates   x=454 y=197 w=143 h=14   (grey band, under ROTATION DATES)
//     hours_completed  x=622 y=197 w=91  h=14   (grey band, under HOURS)
//     certificate_id   x=25  y=39  w=113 h=13   (dark panel, under CERTIFICATE ID)
//     issue_date       x=620 y=25  w=55  h=12   (footer, between "Issued" and the divider)
//
// Colors and fonts follow the template's own field appearance intents: Helvetica in the deep
// teal-navy for the name and band values, white for the certificate ID on the dark panel, and
// muted slate for the issued date. Values auto-shrink to their boxes so long names and long
// unit labels are never clipped; a missing value renders as "-", matching the previous
// certificate module's fallback.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Deep teal-navy used by the template for the title and field text (0.090 0.231 0.290 rg).
const INK = rgb(0.090, 0.231, 0.290);
// White certificate ID on the dark left panel.
const WHITE = rgb(1, 1, 1);
// Muted slate footer text (0.376 0.459 0.494 rg).
const SLATE = rgb(0.376, 0.459, 0.494);

// Overlay boxes (PDF points, origin bottom-left). x/y/w are the approved template's field
// rects; base/min are the drawing sizes (auto-shrink stops at min rather than clipping).
const BOXES = {
  name:   { x: 308, y: 320, w: 386, base: 24,  min: 12 },
  unit:   { x: 297, y: 200, w: 132, base: 9.5, min: 6 },
  dates:  { x: 454, y: 200, w: 143, base: 9.5, min: 6 },
  hours:  { x: 622, y: 200, w: 91,  base: 9.5, min: 6 },
  certId: { x: 25,  y: 42,  w: 113, base: 7,   min: 5 },
  issued: { x: 622, y: 31.5, w: 46, base: 6.5, min: 5 },
};

function textOrDash(v) {
  return (typeof v === 'string' ? v.trim() : '') || '-';
}

// Largest size <= base at which the text fits the box width.
function fitSize(font, text, { w, base, min }) {
  let size = base;
  while (size > min && font.widthOfTextAtSize(text, size) > w) size -= 0.25;
  return size;
}

// Auto-shrink from base toward min; if the text still cannot fit at min, truncate
// with an ellipsis so no value ever overflows its column or the page frame.
function fitText(font, rawText, box) {
  let text = rawText;
  const size = fitSize(font, text, box);
  if (font.widthOfTextAtSize(text, size) > box.w) {
    while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, size) > box.w) {
      text = text.slice(0, -1).trimEnd();
    }
    text = `${text}…`;
  }
  return { text, size };
}

// Generate the finished certificate PDF (Uint8Array).
//   templateBytes - the static template PDF (ArrayBuffer / Uint8Array / Buffer)
//   studentName   - already-formatted display name (preferred-or-legal first + last)
//   certificateNumber - e.g. "ASPIRE-2026-052" (read from the certificates table; NOT generated)
//   clinicalUnit  - canonical matched unit display name, or null
//   rotationDates - preformatted range, e.g. "Jun 8 - Aug 18, 2026", or null
//   hoursCompleted - preformatted approved hours, e.g. "120.5", or null
//   issuedDate    - preformatted issue date, e.g. "Aug 4, 2026", or null
export async function generateCompletionCertificate({
  templateBytes, studentName, certificateNumber,
  clinicalUnit, rotationDates, hoursCompleted, issuedDate,
}) {
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPages()[0];

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);

  // Recipient name: centered in the band above the rule, auto-shrunk, never clipped.
  const name = fitText(helvetica, textOrDash(studentName), BOXES.name);
  page.drawText(name.text, {
    x: BOXES.name.x + (BOXES.name.w - helvetica.widthOfTextAtSize(name.text, name.size)) / 2,
    y: BOXES.name.y,
    size: name.size,
    font: helvetica,
    color: INK,
  });

  // Grey-band values, left-aligned under their printed column labels; the certificate ID
  // (white, dark panel) and issued date (slate, footer) share the same fit rules.
  for (const [key, value, color] of [
    ['unit', clinicalUnit, INK],
    ['dates', rotationDates, INK],
    ['hours', hoursCompleted, INK],
    ['certId', certificateNumber, WHITE],
    ['issued', issuedDate, SLATE],
  ]) {
    const box = BOXES[key];
    const fitted = fitText(helvetica, textOrDash(value), box);
    page.drawText(fitted.text, {
      x: box.x,
      y: box.y,
      size: fitted.size,
      font: helvetica,
      color,
    });
  }

  return pdf.save();
}
