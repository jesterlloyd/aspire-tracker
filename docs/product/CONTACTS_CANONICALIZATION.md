# Contacts Canonicalization (CONTACTS-CANON-1)

Date: 2026-08-25
Status: SHIPPED and APPLIED. Pushed as b2dee20 + 84e45c2 (ordering fix);
migration `20260826000000_contacts_canonicalization.sql` applied to
production 2026-08-25 with all verifications green and an EMPTY V4
manual-correction worklist. The presentation pass (addendum below) followed
the same day. Full suite green; `npx vite build` passes.

## The approved canon (locked 2026-08-25)

- Categories (stored values, singular): Academic Partner, Unit Leader,
  Preceptor, BNI Team, Nursing Executive, Other. "All" stays a filter chip,
  never a category.
- Role/Title per category (dropdowns):
  - Academic Partner: Program Coordinator, Assistant Professor, Clinical
    Placement Coordinator, Manager, Clinical Faculty, Other (free text)
  - Unit Leader: Associate Director, Interim Associate Director, Assistant
    Nurse Manager, NPD Practitioner, Clinical Nurse Specialist
  - Preceptor: CN II, CN III
  - BNI Team: Executive Director, NPD Practitioner, Program/Project
    Coordinator, Lead Administrative Assistant
  - Nursing Executive: "SVP, Chief Nursing Executive" (one combined title),
    "VP of Nursing and Therapies", "Executive Director", "Manager"
  - Other: Talent Acquisition, free text
- Affiliation (derived, never free-form except the Other escape):
  Academic Partner selects a school (operative identity, written to BOTH
  school_name and organization so digest matching keeps working); Unit
  Leader, Preceptor, BNI Team, and Nursing Executive are fixed to
  Cedars-Sinai Medical Center; Other chooses school, Cedars-Sinai, or free
  text.
- Unit Affiliation: multi-unit picker (unit catalog), Unit Leader and
  Preceptor ONLY. Stored as unit_name (primary) + related_units (rest); no
  schema change was needed.
- Services: free text, only for a Nursing Executive with the Executive
  Director title (BNI, Surgical Services, Medical Services, OLAR, ...). New
  `contacts.services` column.
- Preferred Contact Method: retired from both editors AND the column dropped
  in the migration (verified empty in preflight P3 before applying).

## Where the canon lives

`src/lib/contactCategories.js` is the ONE vocabulary module: categories,
legacy map, title lists, free-text rules, `isTitleAllowed` (with unchanged-
legacy passthrough), affiliation rules, unit-list helpers, and the single
chip palette (the former copies in RecipientPicker, RecipientProfileCard,
SentHistory, and UniversalSearch were consolidated onto it). Both write
endpoints (`api/contacts-upsert.js`, `api/portal/academics-contacts.js`)
enforce it server-side; both editors (staff ContactsView modal, portal
AcademicsContactsView modal) render from it; `MultiScopePicker` was
extracted to `src/components/shared/` and is shared by Grant Portal Access
and both editors.

## Pre-migration behavior (the app ships first)

- Reads map legacy plural values through `canonicalCategory()` everywhere.
- Writes normalize to singular, so data converges on every save.
- A non-empty Services value fails closed (503 `services_unavailable`);
  clearing services against the old schema is a dropped no-op; the portal
  GET adapts its SELECT list so it never names the missing column.
- `contacts.role` is NOT NULL until the migration relaxes it, so inserts
  coerce a missing title to '' (the preceptor sync no longer invents the
  'Preceptor' title; CN levels are set by hand).

## The migration (Owner gate)

Renames the four legacy category values in place, backfills NULL categories
by the same role inference the 20260604 backfill used (remainder Other),
sets NOT NULL DEFAULT 'Other' + named CHECK `chk_contacts_category`, maps
the CERTAIN legacy titles (Unit NPD-P variants to NPD Practitioner;
Preceptor/Clinical Preceptor to NULL), relaxes role to nullable, adds
services, drops preferred_contact_method. UNCERTAIN title mappings (Chief
Nursing Officer, BNI Administration, School Coordinator) are COMMENTED
candidates for Jester; verification query V4 lists every remaining
non-canonical title as the manual-correction worklist, and those keep
working as "(legacy)" dropdown passthrough options until corrected.

## Known limits

- The preceptor sync writes unit names straight from the preceptors table;
  a stale non-catalog unit name would be refused loudly (400) rather than
  imported silently.
- organization stays NOT NULL; the derivation rules always produce one, and
  the Other category requires an explicit affiliation on create.
- Digest recipient matching still keys on contacts.school_name equality with
  students.school; the Academic Partner school dropdown writes exactly those
  operative identities, which tightens (not changes) that contract.

## Addendum: presentation pass (2026-08-25, approved)

- Display labels for chips/KPI cards are PLURAL in both apps ("All Contacts,
  Academic Partners, Unit Leaders, Preceptors, BNI Team, Nursing Executives,
  Others"); stored values stay the singular canon
  (CONTACT_CATEGORY_PLURAL_LABELS / categoryPluralLabel).
- Row shape in BOTH directories: name, then the Role/Title pill, then a
  per-category subline (contactListSubline): Academic Partner school, Unit
  Leader and Preceptor unit(s), BNI Team Programs, Nursing Executive
  Services (units only as fallback when stored), Other affiliation.
- Per-category sort engine (sortContactsForCategory), applied on category
  filters in both apps and inside the staff grouped All view: Unit Leaders
  by unit then AD/Interim AD > ANM > NPD-P/CNS; BNI by ED > Lead Admin
  Assistant > NPD-P > Program/Project Coordinator; Nursing Executives by
  SVP > VP > EDs > Managers; Academic Partners by school; Preceptors and
  Others by name. Flat All views stay name-sorted.
- BNI Team gained a "Programs" line: the SAME contacts.services column with
  a per-category label (contactServicesMeta: NE+ED "Services", any BNI
  "Programs"); the field appears in both editors for BNI contacts. No new
  SQL.
- Nursing Executive units are data-driven display (shown only when stored)
  plus a one-time cleanup clearing units from every NE contact except
  Charina Emerson (acting Associate Director of Float Pool; title stays
  Executive Director). The editors show the NE unit picker only when units
  were stored at open, so the exception stays editable and clearable but
  units can never be newly added to an executive.
