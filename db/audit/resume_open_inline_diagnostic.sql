-- RUBRIC-BOOK-1 diagnostic: why a resume DOWNLOADS instead of opening in the tab
--
-- READ-ONLY through Section 3. Section 4 is a repair and is Owner-gated; do not run
-- it until Sections 1 to 3 have been read.
--
-- WHAT WE ALREADY KNOW FROM THE CODE, so the query only has to answer what is left:
--   - the click path opens a tab: openStudentFile() does window.open(url, '_blank')
--     (src/lib/useStudentFile.js), so nothing in the app asks for a download;
--   - the signed URL is minted WITHOUT the download flag
--     (api/student-file-access.js), unlike the Catalog's download mode, which passes
--     { download: true } deliberately;
--   - current uploads send the file's own type
--     (uploadToSignedUrl(..., { contentType: file.type }) in src/lib/studentFileClient.js).
-- So the browser is deciding from the STORED object's mime type. A PDF stored as
-- application/octet-stream (an older upload path, or a PUT with no Content-Type)
-- downloads no matter what the app does.
--
-- Run one section at a time and read the result before moving on.

-- ── Section 1. What mime types are stored for resumes? ───────────────────────
-- Expected healthy result: every row reads application/pdf, application/msword or
-- the wordprocessingml type. Any application/octet-stream (or NULL) is a file the
-- browser cannot render, and that is the defect.
SELECT COALESCE(o.metadata ->> 'mimetype', '(none)') AS stored_mimetype,
       COUNT(*)                                       AS objects,
       MIN(o.created_at)                              AS oldest,
       MAX(o.created_at)                              AS newest
FROM   storage.objects o
WHERE  o.bucket_id = 'student-files'
  AND  o.name LIKE '%/resume/%'
GROUP  BY 1
ORDER  BY objects DESC;

-- ── Section 2. Name the offenders, with their extension ─────────────────────
-- A .pdf stored as octet-stream is repairable (Section 4). A .doc or .docx is not a
-- defect at all: no browser renders Word inline, so those will always download.
SELECT o.name                                              AS object_path,
       lower(right(o.name, 5))                             AS tail,
       COALESCE(o.metadata ->> 'mimetype', '(none)')       AS stored_mimetype,
       pg_size_pretty((o.metadata ->> 'size')::bigint)     AS size,
       o.created_at,
       o.updated_at
FROM   storage.objects o
WHERE  o.bucket_id = 'student-files'
  AND  o.name LIKE '%/resume/%'
  AND  COALESCE(o.metadata ->> 'mimetype', '') <> 'application/pdf'
ORDER  BY o.created_at;

-- ── Section 3. How many students would notice? ──────────────────────────────
-- Joins the offending objects back to the students whose resume_url points at them,
-- so the blast radius is a number rather than a guess. Identity stays out of the
-- result: a count and a cohort, nothing else.
SELECT s.cohort_id,
       COUNT(*) AS students_with_unrenderable_resume
FROM   public.students s
JOIN   storage.objects o
  ON   o.bucket_id = 'student-files'
 AND   s.resume_url LIKE '%' || o.name
WHERE  o.name LIKE '%/resume/%'
  AND  lower(right(o.name, 4)) = '.pdf'
  AND  COALESCE(o.metadata ->> 'mimetype', '') <> 'application/pdf'
GROUP  BY s.cohort_id
ORDER  BY s.cohort_id;

-- ── Section 4 (OWNER GATE, WRITES). Repair the stored type for PDFs only ────
-- DO NOT RUN until Sections 1 to 3 are read and the count in Section 3 is what you
-- expect. This corrects metadata only: no file is re-uploaded, moved or deleted, and
-- nothing outside .pdf objects in the resume folder is touched. Storage serves
-- Content-Type from this field, so the same object then renders in the tab.
--
-- BEGIN;
-- UPDATE storage.objects
--    SET metadata = jsonb_set(metadata, '{mimetype}', '"application/pdf"'::jsonb)
--  WHERE bucket_id = 'student-files'
--    AND name LIKE '%/resume/%'
--    AND lower(right(name, 4)) = '.pdf'
--    AND COALESCE(metadata ->> 'mimetype', '') <> 'application/pdf';
-- -- Postcondition: this must return ZERO rows before COMMIT.
-- SELECT COUNT(*) AS still_wrong
--   FROM storage.objects
--  WHERE bucket_id = 'student-files'
--    AND name LIKE '%/resume/%'
--    AND lower(right(name, 4)) = '.pdf'
--    AND COALESCE(metadata ->> 'mimetype', '') <> 'application/pdf';
-- COMMIT;
--
-- ROLLBACK PLAN: the previous value was application/octet-stream (or absent). If the
-- repair has to be undone, set it back the same way for the same object names, which
-- Section 2's result lists. No data is lost either way: only the served type changes.
