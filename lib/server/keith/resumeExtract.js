// KEITH-P1: resume text extraction, server-only.
//
// Format dispatch by MAGIC BYTES, not by filename. The stored path's extension
// is metadata a client once declared; the bytes are what we actually have. A
// file named resume.pdf that is really a Word document extracts correctly here,
// and a file named resume.pdf that is really nothing at all is refused rather
// than half-parsed.
//
//   %PDF        -> unpdf (pure JS, serverless-oriented)
//   PK\x03\x04  -> DOCX via the zero-dependency extractor in docxExtract.js
//   \xD0\xCF... -> legacy .doc (OLE compound). NOT SUPPORTED, and deliberately
//                  so: a second binary format parser is a large attack surface
//                  for a format ASPIRE sees rarely. It returns an honest
//                  unreadable state that the skill surfaces to the interviewer.
//
// Every failure mode is a typed reason, never an exception and never a silent
// empty string. The skill's honesty requirement depends on being able to tell
// "this resume says little" from "we could not read this resume" - those are
// different sentences to an interviewer, and conflating them would let a
// parsing bug read as a thin candidate.

import { extractDocxText } from './docxExtract.js';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024; // matches the upload cap

// A document that extracts fewer than this many characters is treated as
// unreadable rather than thin. Scanned/image-only PDFs land here: they are
// valid PDFs that yield almost no text, and calling that a thin resume would
// blame the student for our missing OCR.
export const MIN_USABLE_CHARS = 200;

export const EXTRACT_REASONS = Object.freeze({
  EMPTY_FILE: 'empty_file',
  TOO_LARGE: 'too_large',
  LEGACY_DOC: 'legacy_doc_unsupported',
  UNKNOWN_FORMAT: 'unknown_format',
  NO_TEXT_LAYER: 'no_text_layer',
  CORRUPT: 'corrupt',
});

function toBuffer(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  return null;
}

/** Format sniffed from the leading bytes. */
export function sniffFormat(buffer) {
  const b = toBuffer(buffer);
  if (!b || b.length < 4) return 'unknown';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';   // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'docx'; // PK
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'doc';   // OLE compound
  return 'unknown';
}

async function extractPdfText(buffer) {
  try {
    // Imported lazily so the PDF engine is only loaded when a PDF is actually
    // processed; ordinary Keith chat never pays for it.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n') : String(text || '');
    const cleaned = merged.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned) return { ok: false, reason: EXTRACT_REASONS.NO_TEXT_LAYER };
    return { ok: true, text: cleaned };
  } catch {
    return { ok: false, reason: EXTRACT_REASONS.CORRUPT };
  }
}

/**
 * Extract text from resume bytes.
 * Returns { ok:true, text, format, chars } or { ok:false, reason, format }.
 */
export async function extractResumeText(input) {
  const buffer = toBuffer(input);
  if (!buffer || buffer.length === 0) {
    return { ok: false, reason: EXTRACT_REASONS.EMPTY_FILE, format: 'unknown' };
  }
  if (buffer.length > MAX_RESUME_BYTES) {
    return { ok: false, reason: EXTRACT_REASONS.TOO_LARGE, format: 'unknown' };
  }

  const format = sniffFormat(buffer);
  if (format === 'doc') return { ok: false, reason: EXTRACT_REASONS.LEGACY_DOC, format };
  if (format === 'unknown') return { ok: false, reason: EXTRACT_REASONS.UNKNOWN_FORMAT, format };

  const result = format === 'pdf'
    ? await extractPdfText(buffer)
    : await extractDocxText(buffer);

  if (!result.ok) {
    const reason = result.reason === 'empty' ? EXTRACT_REASONS.NO_TEXT_LAYER
      : result.reason === 'no_document_xml' || result.reason === 'not_a_zip' ? EXTRACT_REASONS.CORRUPT
        : result.reason === 'corrupt' ? EXTRACT_REASONS.CORRUPT
          : result.reason;
    return { ok: false, reason, format };
  }
  if (result.text.length < MIN_USABLE_CHARS) {
    return { ok: false, reason: EXTRACT_REASONS.NO_TEXT_LAYER, format, chars: result.text.length };
  }
  return { ok: true, text: result.text, format, chars: result.text.length };
}

/**
 * Interviewer-facing explanation for an extraction failure. Each states what to
 * do next, because "unreadable" with no next step just moves the problem.
 */
export function extractionFailureMessage(reason) {
  switch (reason) {
    case EXTRACT_REASONS.LEGACY_DOC:
      return 'This resume is in the older Word .doc format, which I cannot read. Ask the student to resend it as a PDF or .docx, or open the file from the student profile and review it directly.';
    case EXTRACT_REASONS.NO_TEXT_LAYER:
      return 'This resume has no readable text layer, which usually means it was scanned or saved as an image. Open it from the student profile to review it directly.';
    case EXTRACT_REASONS.TOO_LARGE:
      return 'This resume is too large for me to process. Open it from the student profile to review it directly.';
    case EXTRACT_REASONS.EMPTY_FILE:
      return 'The stored resume file is empty. Ask the student to upload it again.';
    case EXTRACT_REASONS.CORRUPT:
    case EXTRACT_REASONS.UNKNOWN_FORMAT:
    default:
      return 'I could not read this resume file. Open it from the student profile to review it directly, or ask the student to resend it as a PDF.';
  }
}
