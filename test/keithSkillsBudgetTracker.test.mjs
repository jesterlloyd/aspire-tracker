// BUDGET-TRACKER-1 follow-up (Owner, 2026-09-30): two active Keith skills still said Program Budget and an
// active skill cannot be edited in the app, so 20261027000000 renames it the way Activate changes a
// skill: a new version, a snapshot with a change note credited to the Owner, and an activity line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const RENAME = runnable(read('supabase/migrations/20261027000000_keith_skills_budget_tracker.sql'))

test('each skill naming Program Budget gets Budget Tracker in a new, recorded version; a re-run changes nothing', async () => {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  // keith_skill_versions and activity_logs as 20260805000001 made them (the columns used here).
  await pg.exec(`
    ALTER TABLE keith_skills ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS updated_by uuid;
    CREATE TABLE keith_skill_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid NOT NULL, version_number integer NOT NULL, display_name text NOT NULL, description text NOT NULL DEFAULT '', allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}', trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL, model_route text NOT NULL, io_contract jsonb NOT NULL DEFAULT '{}', instruction_body text NOT NULL DEFAULT '', change_note text NOT NULL DEFAULT '', editor_id uuid, created_at timestamptz DEFAULT now(), UNIQUE (skill_id, version_number));
    CREATE TABLE activity_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_name text, user_role text, action_type text, entity_type text, entity_id text, description text, metadata jsonb);`)
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING id`)
  const cols = (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'keith_skills'`)).rows.map(r => r.column_name)
  const insert = async (slug, name, desc, body) => {
    const extra = cols.includes('data_classification') ? ', data_classification, model_route' : ''
    const vals = cols.includes('data_classification') ? ", 'confidential', 'default'" : ''
    await pg.query(`INSERT INTO keith_skills (slug, display_name, description, status, enabled, version, instruction_body${extra}) VALUES ($1, $2, $3, 'active', true, 1, $4${vals})`, [slug, name, desc, body])
  }
  await insert('read-receipt', 'Read Receipt', 'Reads an uploaded receipt for Program Budget. Runs only from Program Budget > Receipts.', "You read ONE purchase receipt for ASPIRE's Program Budget.")
  await insert('prepare-concur', 'Prepare for Concur', 'Runs only from Program Budget > Receipts, on request.', 'Prepare ONE Concur entry.')
  await insert('theme-comments', 'Theme Comments', 'Nothing about budgets.', 'Themes.')
  await pg.exec(RENAME)
  const skills = (await pg.query(`SELECT slug, version, status, enabled, description, instruction_body FROM keith_skills ORDER BY slug`)).rows
  const by = Object.fromEntries(skills.map(s => [s.slug, s]))
  assert.equal(by['read-receipt'].version, 2)
  assert.equal(by['read-receipt'].description, 'Reads an uploaded receipt for Budget Tracker. Runs only from Budget Tracker > Receipts.')
  assert.match(by['read-receipt'].instruction_body, /ASPIRE's Budget Tracker/)
  assert.equal(by['prepare-concur'].version, 2)
  assert.deepEqual([by['prepare-concur'].status, by['prepare-concur'].enabled], ['active', true], 'still on')
  assert.equal(by['theme-comments'].version, 1, 'a skill that never named it is left alone')
  const versions = (await pg.query(`SELECT change_note, editor_id FROM keith_skill_versions`)).rows
  assert.equal(versions.length, 2)
  assert.ok(versions.every(v => v.change_note === 'Renamed Program Budget to Budget Tracker (Owner, 2026-09-30).' && v.editor_id === owner.id))
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM activity_logs WHERE action_type = 'keith_skill_update'`)).rows[0].n, 2)
  await pg.exec(RENAME)
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM keith_skill_versions`)).rows[0].n, 2, 'a re-run changes nothing')
})
