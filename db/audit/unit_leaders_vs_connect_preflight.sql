-- db/audit/unit_leaders_vs_connect_preflight.sql
--
-- UNIT-LEADERS-RETIRE-1 (2026-09-20). READ-ONLY. Run one section at a time in the Supabase
-- SQL editor. Nothing here writes.
--
-- As of this release the app reads unit leadership from ASPIRE Connect > Contacts (category
-- Unit Leader, active, with an email; a contact's units are unit_name plus related_units).
-- The unit's lead is derived: its Associate Director (interim or acting included), else its
-- Director, else an Executive Director over it. The legacy public.unit_leaders table is not
-- read by anything any more. This query shows, per unit, what routing used to resolve from
-- that table and what it resolves from Connect now, so the Owner can see any unit whose
-- "unit form received" CC list or Overview lead changed, BEFORE the table is dropped in a
-- separate, Owner-gated migration.

-- ── 1. Per unit: the old table's lead vs the Connect-derived lead ───────────────────────────
WITH old_lead AS (
  SELECT lower(regexp_replace(unit_name, '\s', '', 'g')) AS ukey, unit_name, full_name, email, role
  FROM public.unit_leaders
  WHERE is_active = true AND is_primary_lead = true
),
connect_rows AS (
  SELECT c.id, c.full_name, c.email, c.role,
         lower(regexp_replace(u.unit, '\s', '', 'g')) AS ukey, u.unit
  FROM public.contacts c
  CROSS JOIN LATERAL unnest(array_prepend(c.unit_name, coalesce(c.related_units, '{}'::text[]))) AS u(unit)
  WHERE c.is_active = true
    AND c.category IN ('Unit Leader', 'Unit Leadership')
    AND c.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND u.unit IS NOT NULL AND btrim(u.unit) <> ''
),
connect_lead AS (
  SELECT DISTINCT ON (ukey) ukey, unit, full_name, email, role
  FROM connect_rows
  WHERE role IN ('Associate Director', 'Interim Associate Director', 'Acting Associate Director', 'Director', 'Executive Director')
  ORDER BY ukey,
    CASE role WHEN 'Associate Director' THEN 1 WHEN 'Interim Associate Director' THEN 1
              WHEN 'Acting Associate Director' THEN 1 WHEN 'Director' THEN 2 ELSE 3 END,
    full_name
)
SELECT coalesce(o.unit_name, n.unit)            AS unit,
       o.full_name                                AS old_lead,
       o.email                                    AS old_lead_email,
       n.full_name                                AS connect_lead,
       n.email                                    AS connect_lead_email,
       n.role                                     AS connect_lead_title,
       CASE WHEN o.email IS NULL AND n.email IS NULL THEN 'neither'
            WHEN o.email IS NULL THEN 'connect only'
            WHEN n.email IS NULL THEN 'OLD ONLY: unit has no lead in Connect'
            WHEN lower(o.email) = lower(n.email) THEN 'same'
            ELSE 'DIFFERENT' END                  AS verdict
FROM old_lead o
FULL OUTER JOIN connect_lead n ON n.ukey = o.ukey
ORDER BY verdict DESC, unit;

-- ── 2. Units the old table knew that have NO active Unit Leader contact in Connect at all ─────
-- These are the units the Owner said may be lost ("whatever hasn't been updated in a while").
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

-- ── 3. Old rows whose person is not in Connect as a Unit Leader (by email) ───────────────────
SELECT ul.unit_name, ul.full_name, ul.email, ul.role, ul.is_primary_lead
FROM public.unit_leaders ul
WHERE ul.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.is_active = true
      AND c.category IN ('Unit Leader', 'Unit Leadership')
      AND lower(c.email) = lower(ul.email)
  )
ORDER BY ul.unit_name, ul.is_primary_lead DESC, ul.full_name;
