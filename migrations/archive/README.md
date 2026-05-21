# Archived Migrations

These files reference tables that were planned but never created in the live Supabase project. They have no runtime impact and are kept here for historical reference only.

| File | Referenced table | Status |
|---|---|---|
| `migration_submissions.sql` | `unit_submissions` | Table does not exist; superseded by `unit_cohort_responses` |
| `migration_accepting.sql` | `student_submissions` | Table does not exist; never deployed |
| `migration_student_intake.sql` | `student_intake_submissions` | Table does not exist; intake goes directly to `students` |
| `migration_intake_role.sql` | `student_intake_submissions` | Table does not exist; companion to migration_student_intake.sql |

**Do not run these files** against the live database. The active migrations are the `migration_*.sql` files in the repo root.
