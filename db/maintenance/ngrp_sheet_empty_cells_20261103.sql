-- db/maintenance/ngrp_sheet_empty_cells_20261103.sql
--
-- SHEET-READ-ALL-1 follow-up (Owner, 2026-11-03: "yeah, you can delete them"). Removes the
-- applicant Sheet's EMPTY cell rows: rows with neither a value nor a format, which clearing a
-- selection's formatting used to leave behind (976 on 2026-11-03). Such a row holds nothing the
-- Sheet shows. Transition Form answers live in the submission revisions and are not in this table.
-- Refuses to run if the count is not the 976 measured, so it never deletes more than was approved.

BEGIN;

DO $empty_cells$
DECLARE
  v_empty int := (SELECT count(*) FROM public.ngrp_sheet_cells WHERE value IS NULL AND format IS NULL);
  v_kept  int := (SELECT count(*) FROM public.ngrp_sheet_cells WHERE value IS NOT NULL OR format IS NOT NULL);
  v_gone  int;
BEGIN
  IF v_empty <> 976 THEN RAISE EXCEPTION 'PRECHECK FAILED: % empty rows, expected 976', v_empty; END IF;
  DELETE FROM public.ngrp_sheet_cells WHERE value IS NULL AND format IS NULL;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone <> 976 OR (SELECT count(*) FROM public.ngrp_sheet_cells) <> v_kept THEN
    RAISE EXCEPTION 'POSTCHECK FAILED: deleted %, kept % of %', v_gone, (SELECT count(*) FROM public.ngrp_sheet_cells), v_kept;
  END IF;
END
$empty_cells$;

COMMIT;
