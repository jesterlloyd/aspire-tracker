-- Checks for supabase/migrations/20260923000000_drop_unit_leaders.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the table is there, and what it holds ─────────────────────────────
-- Expect: present true, plus the row counts (any numbers; the seed had 102 rows).
SELECT to_regclass('public.unit_leaders') IS NOT NULL AS present,
       (SELECT count(*) FROM public.unit_leaders)                        AS rows_total,
       (SELECT count(*) FROM public.unit_leaders WHERE is_active = true) AS rows_active;

-- ── PRE 2: nothing else in the database depends on it ────────────────────────
-- Expect: no rows. A row here names an out-of-band view, rule, trigger or a
-- foreign key from another table; the migration refuses to run while one exists.
SELECT d.classid::regclass AS kind, d.objid, d.deptype,
       coalesce(rw.ev_class::regclass::text, t.tgname::text, r.conname::text) AS name
FROM pg_depend d
LEFT JOIN pg_rewrite    rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
LEFT JOIN pg_trigger    t  ON t.oid  = d.objid AND d.classid = 'pg_trigger'::regclass
LEFT JOIN pg_constraint r  ON r.oid  = d.objid AND d.classid = 'pg_constraint'::regclass
WHERE d.refobjid = 'public.unit_leaders'::regclass
  AND d.deptype IN ('n', 'a')
  AND (
    d.classid = 'pg_rewrite'::regclass
    OR d.classid = 'pg_trigger'::regclass
    OR (d.classid = 'pg_constraint'::regclass AND r.conrelid <> 'public.unit_leaders'::regclass)
  );

-- ── PRE 3: the policies the migration drops by name ──────────────────────────
-- Expect: the policies currently on the table (service_role_all_unit_leaders and
-- staff_read_unit_leaders from the repository; anon_read_unit_leaders if the
-- dashboard-created one from S-18 is still there). Any OTHER name here is also
-- dropped with the table; note it.
SELECT polname, polcmd, polroles::regrole[] AS roles
FROM pg_policy
WHERE polrelid = 'public.unit_leaders'::regclass
ORDER BY polname;

-- ── PRE 4: the app no longer routes through the table (sanity, not a gate) ───
-- Expect: every unit in the old table has at least one active Unit Leader
-- contact in Connect (this is section 2 of unit_leaders_vs_connect_preflight.sql
-- and returned no rows on 2026-09-20).
SELECT DISTINCT ul.unit_name
FROM public.unit_leaders ul
WHERE ul.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.contacts c
    CROSS JOIN LATERAL unnest(array_prepend(c.unit_name, coalesce(c.related_units, '{}'::text[]))) AS u(unit)
    WHERE c.is_active = true
      AND c.category IN ('Unit Leader', 'Unit Leadership')
      AND lower(regexp_replace(u.unit, '\s', '', 'g')) = lower(regexp_replace(ul.unit_name, '\s', '', 'g'))
  )
ORDER BY ul.unit_name;

-- ── POST 1: the table is gone, and so are its policies and indexes ───────────
-- Expect: present false, policies 0, indexes 0
SELECT to_regclass('public.unit_leaders') IS NOT NULL AS present,
       (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass('public.unit_leaders')) AS policies,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'unit_leaders') AS indexes;

-- ── POST 2: Connect still answers for every unit with a lead ─────────────────
-- Expect: one row per unit with a derived lead (28 on 2026-09-20: 27 from the
-- old table's units plus Transfer Center, minus Float Pool until an Associate
-- Director is added there).
SELECT DISTINCT ON (ukey) unit, full_name, role
FROM (
  SELECT lower(regexp_replace(u.unit, '\s', '', 'g')) AS ukey, u.unit, c.full_name, c.role
  FROM public.contacts c
  CROSS JOIN LATERAL unnest(array_prepend(c.unit_name, coalesce(c.related_units, '{}'::text[]))) AS u(unit)
  WHERE c.is_active = true
    AND c.category IN ('Unit Leader', 'Unit Leadership')
    AND c.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND c.role IN ('Associate Director', 'Interim Associate Director', 'Acting Associate Director', 'Director', 'Executive Director')
) x
ORDER BY ukey,
  CASE role WHEN 'Associate Director' THEN 1 WHEN 'Interim Associate Director' THEN 1
            WHEN 'Acting Associate Director' THEN 1 WHEN 'Director' THEN 2 ELSE 3 END,
  full_name;
