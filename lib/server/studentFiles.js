// lib/server/studentFiles.js
//
// WAVE F-2 (Pass 1): the pure, deterministic core for student-file handling,
// shared by every upload, access, and cleanup endpoint. No I/O lives here, so it
// is fully unit-testable and the security-critical decisions (what path an
// object may live at, what a stored reference resolves to, what file types are
// allowed) exist in exactly one place.
//
// Design constraints this file enforces:
//   - The browser NEVER chooses an object path. Paths are always constructed
//     server-side from server-resolved cohort and student ids via canonicalPath.
//   - A stored resume_url/headshot_url may be EITHER a legacy full public URL
//     (pre Wave F-2) OR a canonical object path (post Pass 2 backfill).
//     parseStoredFileRef resolves both to an object path so the same access
//     endpoint works before and after the data migration, and before and after
//     the bucket is made private.
//   - Only an allow-listed set of extensions and MIME types is accepted, which
//     excludes executables, scripts, svg, html, and unknown binaries by
//     construction.

export const STUDENT_FILES_BUCKET = 'student-files';

// The two student file kinds. Limits match the current intake client
// (resume <=10MB, headshot <=5MB) and the existing accept="" attributes.
export const FILE_KIND_RULES = {
  resume: {
    exts: ['pdf', 'doc', 'docx'],
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxBytes: 10 * 1024 * 1024,
  },
  headshot: {
    exts: ['jpg', 'jpeg', 'png'],
    mimes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
  },
};

export const FILE_KINDS = Object.keys(FILE_KIND_RULES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// Lowercased final extension of a filename, or '' when there is none.
export function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filename || '').trim());
  return m ? m[1].toLowerCase() : '';
}

// Validate declared client file metadata for a kind. Returns { ok, ext } or
// { ok:false, error }. This is a declared-metadata check: the bytes travel
// browser -> storage via a signed URL and never transit the server, so magic
// byte sniffing is not possible here. Storage-level MIME/size caps are added at
// the Pass 3 cutover; until then this is the enforcement point.
export function validateFileMeta({ kind, filename, contentType, size } = {}) {
  const rules = FILE_KIND_RULES[kind];
  if (!rules) return { ok: false, error: 'invalid_kind' };

  const ext = extOf(filename);
  if (!ext || !rules.exts.includes(ext)) return { ok: false, error: 'invalid_extension' };

  const ct = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
  if (!ct || !rules.mimes.includes(ct)) return { ok: false, error: 'invalid_content_type' };

  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'invalid_size' };
  if (n > rules.maxBytes) return { ok: false, error: 'file_too_large' };

  return { ok: true, ext };
}

// The one canonical object path for a student file. Preserves the existing
// scheme (cohortId/studentId/kind.ext) so legacy stored URLs and rendering keep
// working. Rejects non-uuid ids and any traversal, so a caller cannot escape the
// student's own folder. Returns { ok, path } or { ok:false, error }.
export function canonicalPath(cohortId, studentId, kind, ext) {
  if (!isUuid(cohortId) || !isUuid(studentId)) return { ok: false, error: 'invalid_ids' };
  if (!FILE_KINDS.includes(kind)) return { ok: false, error: 'invalid_kind' };
  if (!/^[a-z0-9]+$/.test(String(ext || ''))) return { ok: false, error: 'invalid_extension' };

  const path = `${cohortId}/${studentId}/${kind}.${ext}`;
  // Defense in depth: exactly two slashes, no traversal, no leading slash.
  if (path.includes('..') || path.includes('\\') || path.includes('//')
    || path.startsWith('/') || (path.match(/\//g) || []).length !== 2) {
    return { ok: false, error: 'invalid_path' };
  }
  return { ok: true, path };
}

// The student's folder prefix (cohortId/studentId/), used for deletion cleanup.
export function studentFolderPrefix(cohortId, studentId) {
  if (!isUuid(cohortId) || !isUuid(studentId)) return { ok: false, error: 'invalid_ids' };
  return { ok: true, prefix: `${cohortId}/${studentId}` };
}

// Extract the object path from a legacy Supabase public URL for this bucket.
// Public URLs look like: <base>/storage/v1/object/public/student-files/<path>[?query]
// Returns the decoded path, or null if the URL is not a student-files object URL.
export function objectPathFromPublicUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const marker = `/object/public/${STUDENT_FILES_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  let rest = url.slice(at + marker.length);
  // Drop any query string (cache-busters like ?t=123) or fragment.
  const q = rest.search(/[?#]/);
  if (q !== -1) rest = rest.slice(0, q);
  if (!rest) return null;
  let decoded;
  try { decoded = decodeURIComponent(rest); } catch { return null; }
  // The path must not escape the bucket.
  if (decoded.includes('..') || decoded.includes('\\') || decoded.startsWith('/')) return null;
  return decoded;
}

// THE COMPATIBILITY RESOLVER. Given a stored resume_url/headshot_url value that
// may be a legacy full public URL or a canonical object path, resolve it to an
// object path plus a classification. Returns:
//   { kind: 'empty' }                                  no value stored
//   { kind: 'legacyPublicUrl', path, url }             a stored public URL
//   { kind: 'path', path }                             a stored canonical path
//   { kind: 'unknown' }                                a value we cannot resolve
// Callers mint a signed URL from `path` (works on a public OR private bucket),
// so the frontend behaves identically before and after the Pass 3 cutover.
export function parseStoredFileRef(value) {
  if (value == null || value === '') return { kind: 'empty' };
  const s = String(value).trim();
  if (!s) return { kind: 'empty' };

  if (/^https?:\/\//i.test(s)) {
    const path = objectPathFromPublicUrl(s);
    if (path) return { kind: 'legacyPublicUrl', path, url: s };
    return { kind: 'unknown' };
  }

  // Treat as a stored object path. Accept the canonical two-slash shape only.
  const clean = s.replace(/^\/+/, '');
  if (clean.includes('..') || clean.includes('\\') || clean.includes('//')
    || (clean.match(/\//g) || []).length !== 2) {
    return { kind: 'unknown' };
  }
  return { kind: 'path', path: clean };
}
