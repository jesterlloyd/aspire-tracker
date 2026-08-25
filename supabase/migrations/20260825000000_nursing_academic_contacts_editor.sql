-- Nursing Education & Leadership: narrowly scoped Contacts Editor permission.
--
-- Existing grants remain view-only. A nursing_academic grant may be elevated
-- to manage Contacts, which means create, update, deactivate, and reactivate.
-- No database delete privilege or broader portal permission is introduced.

ALTER TABLE public.user_role_grants
  ADD COLUMN IF NOT EXISTS contacts_access text NOT NULL DEFAULT 'view';

ALTER TABLE public.user_role_grants
  DROP CONSTRAINT IF EXISTS user_role_grants_contacts_access_check;

ALTER TABLE public.user_role_grants
  ADD CONSTRAINT user_role_grants_contacts_access_check
  CHECK (
    contacts_access IN ('view', 'manage')
    AND (role = 'nursing_academic' OR contacts_access = 'view')
  );

COMMENT ON COLUMN public.user_role_grants.contacts_access IS
  'Nursing Education & Leadership Contacts permission: view or manage. Manage allows create/update/deactivate/reactivate only; it does not allow delete or other portal writes.';

-- Least privilege is preserved. Portal users never write authorization rows.
REVOKE INSERT, UPDATE, DELETE ON public.user_role_grants FROM anon, authenticated;
