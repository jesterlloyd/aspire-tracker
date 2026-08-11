// lib/server/certificates/generatePreceptorCertificate.js
//
// PRECEPTOR-CERT-1 - PURE, on-demand population of the ASPIRE Certificate of
// Appreciation. Given the canonical editable template's bytes plus the six display
// values, it returns the finished PDF. NO database access, NO network I/O, NO
// file I/O: the caller supplies templateBytes and every display string (see
// loadPreceptorCertificateDisplayFields.js). It never assigns a certificate
// number and never touches certificate_sequences.
//
// Template: public/certificates/templates/aspire-certificate-of-preceptor-appreciation.pdf
//   The supplied canonical editable template, stored byte-identical: one page,
//   landscape US Letter (792 x 612 pt), exactly six AcroForm text fields
//   (certificate_id, preceptor_name, clinical_unit, rotation_dates,
//   student_or_cohort, issue_date). The template is the single source of
//   PLACEMENT truth: rects, font sizes, and colors are read from its own
//   fields at generation time - nothing here repositions or restyles a field.
//
// Output modes:
//   flatten: false - the governed internal variant for Owner/Admin: the six
//            AcroForm fields are FILLED and left editable. Verified to render
//            correctly (Poppler rasterization, values in place and styled).
//   flatten: true (default) - the presentation PDF for the preceptor, with no
//            editable form controls. NOTE ON METHOD, from verification against
//            the real template: pdf-lib's form.flatten() produced structurally
//            valid output whose values two independent rasterizers (Quartz,
//            Poppler) nevertheless refused to paint - text extraction found
//            every value, screens showed one of six, even after repairing the
//            template's unlinked widgets and bracketing its content streams.
//            Rather than ship a certificate that renders viewer-dependently,
//            the flattened variant uses the SAME approach as the production
//            Certificate of Completion (ASPIRE-CERT-COMPLETION-TEMPLATE-1):
//            draw each value directly on the page at the template's own field
//            rectangle, in the field's own DA font size and color
//            (auto-shrinking to fit, never clipping), then remove the form
//            entirely.

import { PDFDocument, PDFName, StandardFonts, rgb, grayscale } from 'pdf-lib';

// The template's six fields, exactly. Population is restricted to this set so
// a future template revision that adds fields cannot be silently half-filled.
export const PRECEPTOR_CERT_FIELDS = Object.freeze([
  'certificate_id',
  'preceptor_name',
  'clinical_unit',
  'rotation_dates',
  'student_or_cohort',
  'issue_date',
]);

function textOrDash(v) {
  return (typeof v === 'string' ? v.trim() : '') || '-';
}

// Parse a field's /DA string for its font size and color intent.
//   "/Helvetica 14 Tf 0.090 0.231 0.290 rg" -> { size: 14, color: rgb(...) }
//   "/Helvetica 5 Tf 1 g"                   -> { size: 5,  color: grayscale(1) }
function parseDefaultAppearance(da) {
  const s = String(da || '');
  const sizeMatch = s.match(/\/\S+\s+([\d.]+)\s+Tf/);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : 10;
  const rgMatch = s.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  if (rgMatch) {
    return { size, color: rgb(parseFloat(rgMatch[1]), parseFloat(rgMatch[2]), parseFloat(rgMatch[3])) };
  }
  const gMatch = s.match(/([\d.]+)\s+g(?![a-z])/);
  if (gMatch) return { size, color: grayscale(parseFloat(gMatch[1])) };
  return { size, color: rgb(0, 0, 0) };
}

// Largest size <= base at which the text fits the width (auto-shrink, floor 4pt),
// mirroring the Completion certificate's never-clip contract.
function fitSize(font, text, width, base) {
  let size = base;
  while (size > 4 && font.widthOfTextAtSize(text, size) > width) size -= 0.25;
  return size;
}

/**
 * Populate the Certificate of Appreciation.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} templateBytes - the canonical template PDF
 * @param {object} fields - { certificateId, preceptorName, clinicalUnit,
 *                            rotationDates, studentOrCohort, issueDate }
 * @param {object} [opts]  - { flatten = true }
 * @returns {Promise<Uint8Array>} finished PDF bytes
 */
export async function generatePreceptorCertificate(templateBytes, fields, opts = {}) {
  const { flatten = true } = opts;
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();

  const values = {
    certificate_id:    textOrDash(fields.certificateId),
    preceptor_name:    textOrDash(fields.preceptorName),
    clinical_unit:     textOrDash(fields.clinicalUnit),
    rotation_dates:    textOrDash(fields.rotationDates),
    student_or_cohort: textOrDash(fields.studentOrCohort),
    issue_date:        textOrDash(fields.issueDate),
  };

  const helv = await doc.embedFont(StandardFonts.Helvetica);

  if (!flatten) {
    // Governed internal variant: fill the template's own fields, leave them
    // editable. getTextField throws if the template ever loses one of its six
    // fields - a loud failure instead of a silently blank certificate.
    for (const name of PRECEPTOR_CERT_FIELDS) {
      form.getTextField(name).setText(values[name]);
    }
    form.updateFieldAppearances(helv);
    return doc.save();
  }

  // Presentation variant: read each field's rect + DA from the template, then
  // draw the values directly and remove the form.
  const page = doc.getPage(0);

  const placements = PRECEPTOR_CERT_FIELDS.map((name) => {
    const field = form.getTextField(name); // throws loudly if missing
    const widget = field.acroField.getWidgets()[0];
    const rect = widget.getRectangle();
    const da = field.acroField.dict.get(PDFName.of('DA')) || widget.dict.get(PDFName.of('DA'));
    return { name, rect, ...parseDefaultAppearance(da) };
  });

  // Remove the form BEFORE drawing: widget annotations come off the page and
  // the AcroForm entry is dropped, so no editable controls (and no duplicate
  // appearances) survive in the presentation PDF.
  page.node.delete(PDFName.of('Annots'));
  doc.catalog.delete(PDFName.of('AcroForm'));

  for (const p of placements) {
    const text = values[p.name];

    if (p.name === 'issue_date') {
      // FOOTER ALIGNMENT (Owner correction 2026-08-10): the template's own DA
      // put the date at 4pt on a lower baseline than the artwork's static
      // "Issued", so the footer read as two misaligned pieces. The artwork's
      // "Issued" measures 6.5pt slate with its baseline at 31.0pt (pdftotext
      // -bbox against the stored template: x 602-620.7, y-span 575.6-582.4
      // top-origin). The date now sits on that same baseline at that same
      // size, starting one clean word-gap after "Issued", auto-shrinking only
      // if a long date would collide with the divider.
      const base = 6.5;
      const x = p.rect.x + 5;
      // The field rect (620..675) overlaps the artwork's "|" divider at
      // x=670.1 (same bbox measurement), so the usable width ends a clean
      // 2pt short of the divider, not at the rect edge.
      const avail = 668 - x;
      const size = fitSize(helv, text, avail, base);
      page.drawText(text, { x, y: 31, size, font: helv, color: p.color });
      continue;
    }

    const size = fitSize(helv, text, p.rect.width - 2, p.size);
    // Vertical centering matching the template's own appearance placement
    // (verified against its generated Tm values within ~0.1pt).
    const baseline = p.rect.y + (p.rect.height - size) / 2 + size * 0.141;
    // NAME ALIGNMENT (Owner correction 2026-08-10): the honoree's name centers
    // horizontally in its field at EVERY auto-shrunk size; all other values
    // keep the template's left alignment under their left-aligned labels.
    const x = p.name === 'preceptor_name'
      ? p.rect.x + (p.rect.width - helv.widthOfTextAtSize(text, size)) / 2
      : p.rect.x + 1;
    page.drawText(text, { x, y: baseline, size, font: helv, color: p.color });
  }

  return doc.save();
}
