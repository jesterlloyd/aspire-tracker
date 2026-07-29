# Unit Specialty Classification: 6NE and 6NW

Source of truth for the organizational division of clinical units 6NE and 6NW in ASPIRE
Intelligence. Recorded to resolve a defect in which both units displayed under `Medical` instead of
`Critical Care`.

## Authoritative source

- Document: `Unit Specialty Resource Chart.pdf`, page 3, "Directory of Critical Care Division 2022"
- Source date: December 1, 2022

## Canonical classification

| Unit  | Canonical name | Primary division | Prior displayed division |
| ----- | -------------- | ---------------- | ------------------------ |
| 6NE   | `6 NE`         | Critical Care    | Medical (incorrect)      |
| 6NW   | `6 NW`         | Critical Care    | Medical (incorrect)      |

Both units belong to the **Critical Care Division**. 6NW has a mixed PCU / Medical-Surgical patient
population, but its organizational division is Critical Care; the mixed characteristics are population
and capability metadata, not the primary division.

## Patient population and capabilities (preserved as descriptors)

### 6 NE

- Population: PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support
- Skills: LVAD, TAH, RVAD, BiVAD, CardioMEMS, transplant, ACLS

### 6 NW

- Population: PCU, Medical-Surgical, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary,
  Trauma, Thoracic
- Skills: transplant, thoracic, trauma, continuous BiPAP, TEVAR management, arrhythmia interpretation,
  ACLS

These descriptors are retained in `src/lib/constants.js` (`PATIENT_POPULATION_MAP`) and, for 6NW, the
Medical-Surgical characteristic is also retained in `UNIT_AREAS` (a same-area compatibility grouping
used only for preference-match coloring, not the primary division).

## Data model (taxonomy) and its limitation

The `units` table and the code catalogs currently model a **single organizational field, `division`**.
There is no separate `specialty`, `acuity`, `service_line`, or `placement_category` column; patient
population is carried separately in `units.patient_population` and `PATIENT_POPULATION_MAP`. Per the
correction scope, the single primary field (`division`) is set to `Critical Care` for both units, and
the richer acuity / population / capability descriptors are preserved in the population maps. A broader
multi-field taxonomy redesign is intentionally out of scope for this correction.

## Root cause (why they displayed as Medical)

Two code-level sources disagreed, and one was wrong:

- `src/lib/constants.js` correctly mapped `6 NE` / `6 NW` (and legacy compact `6NE` / `6NW`) to
  `Critical Care` in both `UNITS_BY_DIVISION` and `UNIT_DIVISION_MAP`.
- `src/lib/unitCatalog.js` (the declared "code-level source of truth for unit dropdowns and labeling")
  hardcoded both units as `division: 'Medical'`. This drove `Medical` on every catalog-derived surface
  (`getUnit(name).division`), including the Overview capacity panel and the student and unit preference
  dropdowns.

Surfaces that read the stored DB column first (`u.division || UNIT_DIVISION_MAP[unit_name] || 'Medical'`
in MatchingTab, OverviewTab capacity rollup, EmbedUnitCard, universal search, and Keith) display
whatever `units.division` holds. No committed code path ever writes `Medical` to `units.division` for
these units (the only writer resolves through `UNIT_DIVISION_MAP`, which yields `Critical Care`), so a
stored `Medical` value, if present, is out-of-band data and cannot be confirmed from the repository
without a read-only query. The Owner-gated migration accompanying this correction verifies and, if
needed, corrects that stored value.

## Authorization note

Division is purely descriptive. It is never part of any authorization, RLS, or portal-scope decision:
Unit Leader and Academic Partner scope key on `unit_key` / `units.unit_name` and cohort, never on
division. Correcting the division does not change who can access or see either unit.

## Correction summary

- `src/lib/unitCatalog.js`: 6 NE and 6 NW moved to the Critical Care division (aligned with
  `constants.js`); descriptions enriched to retain PCU and, for 6NW, Medical-Surgical.
- `supabase/migrations/20260731020000_correct_6ne_6nw_critical_care_division.sql`: Owner-gated,
  idempotent, preflighted correction of the stored `units.division` for these units (division field
  only; no row creation; stable IDs; no scope change). Not applied by this branch.
- `test/unitSpecialtyClassification.test.mjs`: regression guard.
