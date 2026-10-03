-- db/audit/my_profile_name_conflicts.sql
--
-- TOPBAR-PROFILE-1: staff accounts whose Connect signature signs with a different name from
-- the account's own name. Read-only; runs before or after 20261103000000_my_profile_name.sql.
--
-- Settings > General > Profile now has ONE Display name field. It does not resolve these on
-- its own: the signature keeps its name until that person edits the field and saves, and the
-- page tells them the two differ. Decide each row with the person; nothing here changes data.
--
-- difference: 'case or spacing only' when the two match after lower-casing and squeezing
-- spaces, else 'different name'.

SELECT up.email,
       up.role,
       up.full_name                                    AS account_name,
       btrim(up.connect_signature->>'display_name')    AS signature_name,
       CASE
         WHEN lower(regexp_replace(btrim(up.full_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(up.connect_signature->>'display_name'), '\s+', ' ', 'g'))
         THEN 'case or spacing only'
         ELSE 'different name'
       END                                             AS difference,
       up.connect_signature->>'updated_at'             AS signature_saved_at
  FROM public.user_profiles up
 WHERE up.role IN ('owner', 'admin', 'interviewer', 'viewer')
   AND nullif(btrim(up.connect_signature->>'display_name'), '') IS NOT NULL
   AND btrim(up.connect_signature->>'display_name') IS DISTINCT FROM btrim(up.full_name)
 ORDER BY up.role, up.email;
