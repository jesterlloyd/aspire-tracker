// api/lib/outreachAttachments.js
//
// OUTREACH-ATTACHMENTS-1 - resolving Outreach email attachments, server-side.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. The client never says WHICH FILE to
// attach in any way the server has to trust. It sends catalog resource SLUGS.
// Everything else - the storage path, the bytes, the filename, the size, the
// content type - is resolved here from catalog_resources and the private
// 'aspire-catalog' bucket, using the same slug-only contract as
// api/catalog-resource-open.js. A browser-supplied storage path, URL, or
// Base64 blob is never accepted and never forwarded to Resend.
//
// WHY BYTES AND NOT A HOSTED PATH. Resend can fetch an attachment from a URL,
// but that would mean minting a URL for a private object and handing it to a
// third party. Instead the server downloads the object itself and passes the
// bytes inline, so nothing about the private bucket ever leaves this process.
//
// RESOLVE ONCE, SEND MANY. resolveAttachments() is called ONCE per request,
// before the Resend client is constructed. The returned array is then passed
// unchanged to every individual send in a bulk batch, so every recipient
// provably receives the same reviewed bytes - the file is never re-resolved
// per recipient.
//
// FAIL BEFORE ANY SEND. Every failure mode here (unknown slug, inactive
// resource, wrong resource type, missing object, bad extension, bad magic
// bytes, too many files, too large) returns { ok: false } to a caller that
// has not yet created a Resend client and has not yet emailed anyone.

const BUCKET = 'aspire-catalog';

// ── Limits ──────────────────────────────────────────────────────────────────
// Resend's ceiling is 40 MB AFTER Base64 encoding. Base64 inflates by ~4/3, so
// 40 MB encoded is ~30 MB of raw bytes. ASPIRE stops well short of that:
//
//   - per file    10 MB - the same cap catalog-resource-upload.js already
//                         enforces, so no catalog file can exceed it anyway.
//   - all files   10 MB raw total => ~13.4 MB encoded, about a third of the
//                         provider ceiling. That headroom covers the encoded
//                         HTML body and headers that ride along in the same
//                         request, and keeps peak function memory small.
//   - count        5    - a plain sanity bound on one email.
export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const RESEND_ENCODED_CEILING_BYTES = 40 * 1024 * 1024;

// ── Type allowlist ────────────────────────────────────────────────────────────
//
// VALIDATION AUDIT (OUTREACH-ATTACHMENTS-1, correction pass).
//
// The first cut checked only a magic-byte prefix. That is honest for PDF and
// images, but NOT for Office files:
//
//   - Every OOXML file (.docx/.xlsx/.pptx) is a ZIP, so a "PK\x03\x04" prefix
//     proves only "some zip" - a .docm, an encrypted workbook, a renamed
//     archive, or a corrupt file all pass it.
//   - Legacy .doc/.xls/.ppt share ONE OLE2 compound-file signature with each
//     other AND with encrypted OOXML. A prefix check cannot tell them apart at
//     all.
//
// Two changes follow, so no claim here outruns the check behind it:
//
//   1. OOXML is validated as a real container: the ZIP central directory is
//      parsed and the format's own required parts must be present. Macro
//      -enabled and malformed containers are rejected by name and structure;
//      encrypted OOXML is rejected earlier because it is OLE2, not a ZIP.
//   2. Legacy doc/xls/ppt are REMOVED from Phase 1. They cannot be verified
//      apart, and shipping them would mean asserting more than we check.
//
// No dependency was added: reading a central directory is a bounded parse of a
// documented structure, and a zip library would be a far larger surface than
// the ~70 lines below.
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// Required part inside each OOXML container, beyond [Content_Types].xml.
const OOXML_REQUIRED_PART = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};

export const ALLOWED_TYPES = {
  pdf:  { mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]], verify: verifyPdf },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [ZIP_MAGIC], verify: verifyOoxml },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [ZIP_MAGIC], verify: verifyOoxml },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: [ZIP_MAGIC], verify: verifyOoxml },
  png:  { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], verify: null },
  jpg:  { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]], verify: verifyJpeg },
  jpeg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]], verify: verifyJpeg },
};

/** Types deliberately NOT accepted, with the reason, so the gap is explicit. */
export const REJECTED_TYPES = Object.freeze({
  doc: 'Legacy Word files share one OLE signature with .xls and .ppt and cannot be told apart.',
  xls: 'Legacy Excel files share one OLE signature with .doc and .ppt and cannot be told apart.',
  ppt: 'Legacy PowerPoint files share one OLE signature with .doc and .xls and cannot be told apart.',
  docm: 'Macro-enabled documents are not emailed.',
  xlsm: 'Macro-enabled workbooks are not emailed.',
  pptm: 'Macro-enabled presentations are not emailed.',
});

/** A PDF must open with %PDF- and carry an EOF marker near its end. */
function verifyPdf(bytes) {
  if (bytes.length < 8) return 'file is truncated';
  if (bytes[4] !== 0x2d) return 'missing PDF version marker';       // '-'
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
  if (!tail.includes('%%EOF')) return 'missing PDF end-of-file marker';
  return null;
}

/** A JPEG must end with the EOI marker FF D9. */
function verifyJpeg(bytes) {
  if (bytes.length < 4) return 'file is truncated';
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return 'missing JPEG end marker';
  }
  return null;
}

/**
 * Names in a ZIP central directory, or null when the structure is unreadable.
 * Bounded and defensive: every offset is range-checked, so a hostile or
 * corrupt file yields null rather than throwing or over-reading.
 */
export function zipEntryNames(bytes) {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  // The End Of Central Directory record lives in the last 64KB+22 bytes.
  const scanFrom = Math.max(0, bytes.length - (0xffff + 22));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0 || cdOffset + cdSize > bytes.length) return null;

  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length) return null;
    if (bytes.readUInt32LE(p) !== CD_SIG) return null;
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const nameStart = p + 46;
    if (nameStart + nameLen > bytes.length) return null;
    names.push(bytes.subarray(nameStart, nameStart + nameLen).toString('utf8'));
    p = nameStart + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * A real OOXML container of the expected kind: parseable central directory,
 * the format's own required parts, and no macro project.
 */
function verifyOoxml(bytes, ext) {
  const names = zipEntryNames(bytes);
  if (!names) return 'file is not a readable Office document';
  if (!names.includes('[Content_Types].xml')) return 'file is not a valid Office document';
  if (names.some(n => /(^|\/)vbaProject\.bin$/i.test(n))) {
    return 'macro-enabled files cannot be emailed';
  }
  const required = OOXML_REQUIRED_PART[ext];
  if (required && !names.includes(required)) {
    return `file is not a valid ${ext.toUpperCase()} document`;
  }
  return null;
}

/** Lowercase extension of a filename, or '' when there is none. */
export function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * A filename safe to put in a MIME header: no path separators, no control
 * characters, no leading dots, bounded length. Returns '' when nothing usable
 * survives, which the caller treats as a hard failure rather than inventing a
 * name.
 */
export function safeFilename(name) {
  const base = String(name || '')
    .split(/[\\/]/).pop()            // strip any path the value may carry
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')            // control characters
    .replace(/["\r\n]/g, '')                     // header-breaking characters
    .replace(/^\.+/, '')
    .trim();
  return base.slice(0, 150);
}

/** Does the buffer start with one of the allowed signatures for this type? */
export function matchesMagic(bytes, ext) {
  const spec = ALLOWED_TYPES[ext];
  if (!spec) return false;
  return spec.magic.some(sig => sig.every((b, i) => bytes[i] === b));
}

/** Human-readable size, used in errors and in the UI's metadata. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Normalise the client's requested slugs: strings only, trimmed, de-duplicated
 * in first-seen order, count-capped. Cannot ADD a slug the client did not send.
 */
export function normaliseSlugs(input) {
  if (input == null) return { slugs: [], error: null };
  if (!Array.isArray(input)) return { slugs: [], error: 'Attachments must be a list.' };
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return { slugs: [], error: 'Invalid attachment reference.' };
    const s = raw.trim();
    if (!s) continue;
    if (s.length > 200) return { slugs: [], error: 'Invalid attachment reference.' };
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_ATTACHMENTS) {
    return { slugs: [], error: `You can attach up to ${MAX_ATTACHMENTS} files.` };
  }
  return { slugs: out, error: null };
}

/**
 * Resolve catalog slugs into Resend-ready attachments.
 *
 * @returns {Promise<{ok: true, attachments: Array, summary: Array}
 *                 | {ok: false, status: number, error: string}>}
 *
 * attachments[] entries are shaped for Resend: { filename, content, contentType }
 * where content is Base64. summary[] is the SAME list without bytes - safe for
 * previews, audit metadata and Sent History.
 */
// The caller ALWAYS supplies the service-role client. This module deliberately
// imports no Supabase client of its own, so it stays a pure, testable rule
// layer that cannot reach the database except through what it is handed.
export async function resolveAttachments({ db, slugs } = {}) {
  const { slugs: wanted, error: slugErr } = normaliseSlugs(slugs);
  if (slugErr) return { ok: false, status: 400, error: slugErr };
  // The overwhelmingly common case: no attachments. It must not depend on a
  // database client at all, so an ordinary message can never be blocked by
  // attachment plumbing.
  if (wanted.length === 0) return { ok: true, attachments: [], summary: [] };
  if (!db) return { ok: false, status: 500, error: 'Attachment lookup is unavailable.' };

  // 1) Resolve every slug against catalog_resources. Active internal files only.
  const { data: rows, error: lookupErr } = await db
    .from('catalog_resources')
    .select('slug, title, storage_path, resource_type, is_active, file_type_label')
    .in('slug', wanted);

  if (lookupErr) return { ok: false, status: 500, error: 'Could not look up attachments.' };

  const bySlug = new Map((rows || []).map(r => [r.slug, r]));
  const attachments = [];
  const summary = [];
  let total = 0;

  // Iterate the CLIENT's order so the email matches what was reviewed, but only
  // ever using rows the database actually returned.
  for (const slug of wanted) {
    const row = bySlug.get(slug);
    if (!row) return { ok: false, status: 404, error: `Attachment is no longer available: ${slug}` };
    if (row.is_active !== true) {
      return { ok: false, status: 404, error: `Attachment is no longer available: ${row.title || slug}` };
    }
    if (row.resource_type !== 'internal_file' || !row.storage_path) {
      return { ok: false, status: 400, error: `Only ASPIRE Catalog files can be attached: ${row.title || slug}` };
    }

    const ext = extensionOf(row.storage_path);
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, ext)) {
      return { ok: false, status: 400, error: `This file type cannot be emailed: ${row.title || slug}` };
    }

    // 2) Download the object with the service role. The path came from the
    //    database, never from the caller.
    let blob;
    try {
      const { data, error: dlErr } = await db.storage.from(BUCKET).download(row.storage_path);
      if (dlErr || !data) {
        return { ok: false, status: 502, error: `Could not read attachment: ${row.title || slug}` };
      }
      blob = data;
    } catch {
      return { ok: false, status: 502, error: `Could not read attachment: ${row.title || slug}` };
    }

    const bytes = Buffer.from(await blob.arrayBuffer());

    // 3) Content checks on the REAL bytes.
    if (bytes.length === 0) {
      return { ok: false, status: 400, error: `Attachment is empty: ${row.title || slug}` };
    }
    if (bytes.length > MAX_FILE_BYTES) {
      return {
        ok: false, status: 413,
        error: `${row.title || slug} is ${formatBytes(bytes.length)}, over the ${formatBytes(MAX_FILE_BYTES)} limit for one file.`,
      };
    }
    if (!matchesMagic(bytes, ext)) {
      return {
        ok: false, status: 400,
        error: `${row.title || slug} does not look like a valid ${ext.toUpperCase()} file.`,
      };
    }
    // Beyond the prefix: the format's own structure must hold up. This is what
    // makes the OOXML claim real rather than "it is some zip".
    const verify = ALLOWED_TYPES[ext].verify;
    if (verify) {
      const why = verify(bytes, ext);
      if (why) {
        return { ok: false, status: 400, error: `${row.title || slug}: ${why}.` };
      }
    }

    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      return {
        ok: false, status: 413,
        error: `Attachments total more than ${formatBytes(MAX_TOTAL_BYTES)}. Remove one and try again.`,
      };
    }

    // 4) Filename sent to the recipient: the stored object's own name.
    const filename = safeFilename(row.storage_path.split('/').pop());
    if (!filename || extensionOf(filename) !== ext) {
      return { ok: false, status: 400, error: `Attachment has an unusable filename: ${row.title || slug}` };
    }

    const contentType = ALLOWED_TYPES[ext].mime;
    attachments.push({ filename, content: bytes.toString('base64'), contentType });
    // No bytes, no paths, no URLs - this is what may be archived and shown.
    summary.push({
      slug: row.slug,
      title: row.title || filename,
      filename,
      content_type: contentType,
      size_bytes: bytes.length,
      size_label: formatBytes(bytes.length),
      source: 'catalog',
    });
  }

  return { ok: true, attachments, summary };
}
