import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const commit = (sql) => sql.replace(/\nROLLBACK;\s*$/, '\nCOMMIT;\n')

async function world() {
  const db = new PGlite()
  await db.exec(`
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (bucket_id text, name text);
    CREATE TABLE catalog_resources (
      id uuid PRIMARY KEY, title text, category text, resource_type text, storage_path text,
      moved_to_record_document_id uuid, is_active boolean, created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE catalog_forms (id uuid PRIMARY KEY, catalog_resource_id uuid);
    CREATE TABLE form_assignments (
      id uuid PRIMARY KEY, form_id uuid, form_version integer, catalog_resource_id uuid,
      name text, email text, status text, sent_at timestamptz, submitted_at timestamptz, created_at timestamptz
    );
    CREATE TABLE form_submissions (
      id uuid PRIMARY KEY, assignment_id uuid, pdf_bucket text, pdf_path text, record_document_id uuid
    );
    CREATE TABLE sig_templates (id uuid PRIMARY KEY, catalog_resource_id uuid, source_path text);
    CREATE TABLE sig_bulk_sends (id uuid PRIMARY KEY);
    CREATE TABLE sig_requests (
      id uuid PRIMARY KEY, title text, status text, sender_email text, sent_at timestamptz,
      completed_at timestamptz, document_path text, sealed_path text, parent_bulk_id uuid,
      catalog_resource_id uuid, created_at timestamptz
    );
    CREATE TABLE sig_request_signers (
      id uuid PRIMARY KEY, request_id uuid, name text, email text, order_index integer
    );
    CREATE TABLE sig_events (id bigint, request_id uuid);
    CREATE TABLE record_documents (id uuid PRIMARY KEY, source text, source_ref uuid, storage_path text);
  `)
  return db
}

test('Catalog cleanup SQL runs without session-scoped temporary relations', async () => {
  const db = await world()
  const resource = '10000000-0000-4000-8000-000000000001'
  const assignment = '20000000-0000-4000-8000-000000000001'
  await db.exec(`
    INSERT INTO catalog_resources VALUES
      ('${resource}', 'Removed link', 'orientation', 'external_link', null, null, false, now(), now());
    INSERT INTO form_assignments VALUES
      ('${assignment}', '30000000-0000-4000-8000-000000000001', 1, null,
       'Jester', 'JesterLloyd.Bautista@cshs.org', 'submitted', now(), now(), now());
  `)

  const catalogSql = read('db/audit/catalog_removed_items_cleanup.sql')
  const activitySql = read('db/audit/catalog_jester_test_activity_cleanup.sql')
  await db.exec(catalogSql)
  await db.exec(activitySql)
  assert.equal((await db.query('SELECT id FROM catalog_resources')).rows.length, 1, 'review run rolls back')
  assert.equal((await db.query('SELECT id FROM form_assignments')).rows.length, 1, 'review run rolls back')

  await db.exec(commit(catalogSql))
  await db.exec(commit(activitySql))
  assert.equal((await db.query('SELECT id FROM catalog_resources')).rows.length, 0)
  assert.equal((await db.query('SELECT id FROM form_assignments')).rows.length, 0)
  await db.close()
})
