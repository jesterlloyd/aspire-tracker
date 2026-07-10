// lib/server/certificates/generateParticipationCertificate.js
//
// ASPIRE-POSTROTATION-CERT-PDF-1 - PURE, on-demand overlay of the ASPIRE Certificate of
// Participation. Given the static template PDF bytes plus a student display name and a
// certificate number, it overlays those two pieces of text and returns the finished PDF bytes.
//
// This module performs NO database access, NO network I/O, and NO file I/O: the caller supplies
// templateBytes. It never assigns a certificate number and never touches certificate_sequences -
// the number is read from the certificates table by the caller and passed in verbatim.
//
// Template: public/certificates/templates/aspire-certificate-of-participation.pdf
//   Static, one-page, landscape US Letter (792 x 612 pt). The recipient name is centered in the
//   blank band under "THIS CERTIFICATE IS PROUDLY PRESENTED TO"; the certificate number sits
//   discreetly in the lower area, clear of the signatures, logos, and frame ornaments.
//
// Font: no licensed script/cursive font ships in the repo, so we use the built-in standard
// Times-Italic (elegant serif italic) for the name - no font files are added or embedded.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Name color #e1bb09.
const GOLD = rgb(0xe1 / 255, 0xbb / 255, 0x09 / 255);
// Muted slate for the discreet certificate number.
const NUMBER_COLOR = rgb(0.40, 0.44, 0.50);

// Layout constants (points; PDF origin bottom-left). Calibrated against a 792 x 612 render.
const NAME_BASELINE_Y = 300;   // sits in the blank band, above the horizontal rule
const NAME_MAX_WIDTH  = 560;   // keep the name within the gold frame with margin
const NAME_MAX_SIZE   = 34;
const NAME_MIN_SIZE   = 15;

const NUMBER_SIZE       = 9;
const NUMBER_RIGHT_EDGE = 690;  // right-aligned inside the frame, left of the corner ornament
const NUMBER_BASELINE_Y = 78;   // below the signature labels, above the frame bottom

// Overlay the name + certificate number onto the template and return the PDF bytes (Uint8Array).
//   templateBytes     - the static template PDF (ArrayBuffer / Uint8Array / Buffer)
//   studentName        - already-formatted display name (preferred-or-legal first + last)
//   certificateNumber  - e.g. "ASPIRE-2026-052" (read from the certificates table; NOT generated)
export async function generateParticipationCertificate({ templateBytes, studentName, certificateNumber }) {
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPages()[0];
  const { width } = page.getSize();

  const nameFont = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const numberFont = await pdf.embedFont(StandardFonts.Helvetica);

  // Recipient name: centered, auto-shrunk so long names are never clipped.
  const name = (typeof studentName === 'string' ? studentName.trim() : '') || '-';
  let size = NAME_MAX_SIZE;
  while (size > NAME_MIN_SIZE && nameFont.widthOfTextAtSize(name, size) > NAME_MAX_WIDTH) {
    size -= 0.5;
  }
  const nameWidth = nameFont.widthOfTextAtSize(name, size);
  page.drawText(name, {
    x: (width / 2) - (nameWidth / 2),
    y: NAME_BASELINE_Y,
    size,
    font: nameFont,
    color: GOLD,
  });

  // Certificate number: discreet, right-aligned in the lower area. No date is drawn.
  const num = (typeof certificateNumber === 'string' ? certificateNumber.trim() : '') || '-';
  const label = `Certificate No. ${num}`;
  const labelWidth = numberFont.widthOfTextAtSize(label, NUMBER_SIZE);
  page.drawText(label, {
    x: NUMBER_RIGHT_EDGE - labelWidth,
    y: NUMBER_BASELINE_Y,
    size: NUMBER_SIZE,
    font: numberFont,
    color: NUMBER_COLOR,
  });

  return pdf.save();
}
