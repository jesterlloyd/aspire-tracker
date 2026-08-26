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

// STUDENT-PHOTO-PERF-1: per-kind signed-URL lifetimes, one source of truth for
// every access endpoint. Headshots sign LONG (1 hour) so the URL stays stable
// across navigation and the browser image cache actually gets hits; the client
// photo cache (src/lib/studentPhotoCache.js) expires entries well before this.
// Resumes stay SHORT: they are minted fresh per click, never cached, and a
// resume link that leaks should die quickly. An unknown kind gets the short
// lifetime, failing safe.
export const SIGNED_URL_TTL_BY_KIND = { headshot: 3600, resume: 300 };

export function signedUrlTtlSeconds(kind) {
  return SIGNED_URL_TTL_BY_KIND[kind] || SIGNED_URL_TTL_BY_KIND.resume;
}

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

// The two student-file reference columns and the kind each one holds. Used so a caller can say
// "validate this column's value" without restating the mapping.
export const FILE_REF_COLUMNS = Object.freeze({ resume_url: 'resume', headshot_url: 'headshot' });

// S-03 WRITE-SIDE BINDING. resume_url and headshot_url were persisted from browser-supplied
// strings with only a trim applied, and nothing ever checked that the value described the student
// it was being stored on. This is the check that binds them.
//
// A stored reference is accepted ONLY when it is byte-identical to the canonical path derived
// server-side from THIS student's own cohort id and student id, for this kind, with an extension
// on that kind's allow-list. That is exactly what the three signed-upload endpoints already return
// (api/student-file-sign.js, api/student-intake-file-sign.js, api/portal/my-profile-file-sign.js),
// so a well-behaved client round-trips the server's own value and is unaffected.
//
// A mismatch is REJECTED, never silently rewritten to the canonical path. Rewriting would hide a
// client defect and would also quietly claim an object the caller may not have uploaded.
//
// Returns { ok: true, path } or { ok: false, error, message }, where message is safe to show a
// student or a coordinator and names no storage internals.
export function validateStoredFileRefForStudent({ value, column, cohortId, studentId } = {}) {
  const kind = FILE_REF_COLUMNS[column];
  if (!kind) return { ok: false, error: 'invalid_column', message: 'That file type is not recognized.' };

  const label = kind === 'resume' ? 'resume' : 'headshot';
  const generic = `We could not attach that ${label}. Please upload it again from this form.`;

  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return { ok: false, error: 'empty', message: generic };

  // A full URL is never an acceptable NEW value. Legacy stored public URLs still resolve on read
  // through parseStoredFileRef; they simply cannot be written any more.
  if (/^https?:\/\//i.test(s)) return { ok: false, error: 'url_not_accepted', message: generic };

  const ext = extOf(s);
  const rules = FILE_KIND_RULES[kind];
  if (!ext || !rules.exts.includes(ext)) {
    return { ok: false, error: 'invalid_extension', message: generic };
  }

  const cp = canonicalPath(cohortId, studentId, kind, ext);
  if (!cp.ok) return { ok: false, error: cp.error, message: generic };

  // Byte equality with the server-derived path. This is what rejects another student's path,
  // another cohort's path, a different kind's filename, and any traversal or encoding trick,
  // without needing a separate rule for each.
  if (s !== cp.path) return { ok: false, error: 'not_owned', message: generic };

  return { ok: true, path: cp.path };
}

// S-03 READ-SIDE BINDING, defense in depth for values persisted before the write-side check
// existed. Given an object path already resolved by parseStoredFileRef, does it belong to this
// student?
//
// The STUDENT id segment is the ownership boundary and is what this checks. The cohort segment is
// deliberately not compared: it adds no security (only flows carrying a student's own id ever
// wrote under that student's segment, so a path with the right student segment is that student's
// object regardless of which cohort folder it sits in) and comparing it would break any historical
// value whose cohort segment no longer matches a reassigned row. students.cohort_id is not
// writable through any application action today, so such drift should not exist, but a read guard
// that silently blanks a legitimate photo is a worse failure than one scoped to the invariant that
// actually matters.
export function refBelongsToStudent(path, studentId) {
  // A non-empty STRING id, deliberately not a uuid-format check. The security property is that the
  // path's student segment equals this student's id; requiring a particular id format would couple
  // the guard to something it does not depend on. The string type check is what matters: it fails
  // closed on null or undefined rather than letting String(undefined) match a literal segment.
  if (typeof path !== 'string' || !path) return false;
  if (typeof studentId !== 'string' || !studentId) return false;
  const segments = path.split('/');
  if (segments.length !== 3) return false;
  return segments[1].toLowerCase() === String(studentId).toLowerCase();
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
