-- =====================================================================
-- GOVERNANCE RPC DIAGNOSTIC
-- =====================================================================
--
-- READ-ONLY. Four SELECT statements. Creates nothing, alters nothing.
--
-- WHY: Q0 checks 5/6/7/8 reported "0 exact matches, 4 overloads". Those two
-- numbers together are self-contradicting as evidence of drift - if the
-- functions were missing, the overload count would be 0, not 4. Four functions
-- with the expected NAMES exist and none matched the expected ARGUMENT STRING,
-- which points at how Q0 compared signatures, not at production.
--
-- This diagnostic captures the real signatures so the comparison can be fixed
-- against evidence rather than assumption. It changes nothing either way.

-- =====================================================================
-- D1. The four functions as production actually has them
-- =====================================================================
-- identity_args  is what Q0 compared against and is the suspected culprit.
-- canonical_types is the same signature reduced to bare input types, which is
--                 what a signature comparison should have used.
-- full_args      shows names and defaults, to confirm the difference.
SELECT p.proname                                   AS function_name,
       p.oid                                       AS oid,
       pg_get_function_identity_arguments(p.oid)   AS identity_args,
       pg_catalog.oidvectortypes(p.proargtypes)    AS canonical_types,
       pg_get_function_arguments(p.oid)            AS full_args,
       p.pronargs                                  AS n_args,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
       array_to_string(p.proconfig, ', ')          AS proconfig,
       pg_get_userbyid(p.proowner)                 AS owner,
       p.provolatile                               AS volatility,
       md5(pg_get_functiondef(p.oid))              AS definition_md5,
       length(pg_get_functiondef(p.oid))           AS definition_bytes
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('governance_activate_knowledge_entry',
                     'governance_apply_knowledge_revision',
                     'governance_restore_knowledge_version',
                     'governance_change_knowledge_state')
 ORDER BY p.proname, p.oid;


-- =====================================================================
-- D2. Does OID resolution find them? (validates the proposed repair)
-- =====================================================================
-- to_regprocedure() parses a signature by TYPE and returns NULL rather than
-- erroring when nothing matches. It ignores parameter names entirely, which is
-- exactly the property Q0's string comparison lacked.
--
-- EXPECTED IF THE DEFECT IS MINE: all four resolve to a non-null OID, and
-- those OIDs match D1 exactly. That would prove the callable signatures are
-- correct and only my comparison was wrong.
--
-- EXPECTED IF PRODUCTION HAS REALLY DRIFTED: one or more rows resolve NULL.
WITH want AS (
  SELECT 'public.governance_activate_knowledge_entry(uuid,uuid,text)'          AS sig
  UNION ALL SELECT 'public.governance_apply_knowledge_revision(uuid,uuid)'
  UNION ALL SELECT 'public.governance_restore_knowledge_version(uuid,integer,uuid,text)'
  UNION ALL SELECT 'public.governance_change_knowledge_state(uuid,text,uuid)'
)
SELECT w.sig                                        AS expected_signature,
       to_regprocedure(w.sig)                       AS resolved_to,
       (to_regprocedure(w.sig))::oid                AS resolved_oid,
       (to_regprocedure(w.sig) IS NOT NULL)         AS resolves
  FROM want w
 ORDER BY w.sig;


-- =====================================================================
-- D3. The mismatch, side by side
-- =====================================================================
-- Shows, per function, the string Q0 expected against the string production
-- returned, and whether the canonical type list DOES match. If matched_on_
-- identity is false while matched_on_canonical is true, the defect is entirely
-- in how Q0 normalized the signature.
WITH want AS (
  SELECT 'governance_activate_knowledge_entry' AS fn_name, 'uuid, uuid, text' AS q0_expected
  UNION ALL SELECT 'governance_apply_knowledge_revision', 'uuid, uuid'
  UNION ALL SELECT 'governance_restore_knowledge_version', 'uuid, integer, uuid, text'
  UNION ALL SELECT 'governance_change_knowledge_state', 'uuid, text, uuid'
)
SELECT w.fn_name,
       w.q0_expected,
       pg_get_function_identity_arguments(p.oid) AS production_identity_args,
       pg_catalog.oidvectortypes(p.proargtypes)  AS production_canonical_types,
       (pg_get_function_identity_arguments(p.oid) = w.q0_expected) AS matched_on_identity,
       (replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '')
          = replace(w.q0_expected, ' ', ''))                        AS matched_on_canonical
  FROM want w
  LEFT JOIN pg_proc p ON p.proname = w.fn_name
  LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 ORDER BY w.fn_name;


-- =====================================================================
-- D4. Full definitions, for comparison against the migration file
-- =====================================================================
-- Long output. Run when you want to eyeball the current bodies before they are
-- replaced, or to keep a pre-change record.
SELECT p.proname AS function_name,
       pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('governance_activate_knowledge_entry',
                     'governance_apply_knowledge_revision',
                     'governance_restore_knowledge_version',
                     'governance_change_knowledge_state')
 ORDER BY p.proname;
