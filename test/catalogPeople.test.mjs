// CATALOG-PEOPLE-1 (Owner, 2026-09-24): the Catalog's detail panel lists everyone a form or a
// signature template went to, with its state and Remind. peopleFor runs here against the real
// forms and signatures migrations (PGlite); the panel's wiring is pinned by source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const E = await import('../lib/server/forms/engine.js')
const M = await import('../src/lib/forms/formModel.js')
const { peopleFor } = await import('../lib/server/forms/people.js')
const { completionStatus } = await import('../src/lib/catalog/catalogModel.js')
const PRELUDE = read('test/formsEngine.test.mjs').match(/const PRELUDE = `([\s\S]*?)`/)[1]

async function world() {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(read('supabase/migrations/20260927000000_signatures_phase2.sql'))
  await pg.exec(read('supabase/migrations/20260928000000_forms_phase3.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (role, is_owner, email, full_name) VALUES ('owner', true, 'o@cshs.org', 'Owner') RETURNING *`)
  return { pg, db: pgliteRest(pg), owner }
}
const DAY = 86400000
const iso = (d) => new Date(Date.now() + d * DAY).toISOString()

test('a form lists one row per link, voided links left out, closed links named', async () => {
  const w = await world()
  const form = await E.createForm(w.db, { title: 'ScrubEx', definition: { title: 'ScrubEx', questions: [M.newQuestion('short', 'a')] } }, w.owner)
  await E.publish(w.db, form.id, w.owner)
  const { rows: [f] } = await w.pg.query(`SELECT catalog_resource_id FROM catalog_forms WHERE id = $1`, [form.id])
  const add = (name, cols) => w.pg.query(
    `INSERT INTO form_assignments (form_id, form_version, catalog_resource_id, batch_id, name, email, school_name, status, due_at, sent_at, opened_at, submitted_at, reminder_count)
     VALUES ($1, 1, $2, gen_random_uuid(), $3, $4, 'UCLA', $5, $6, $7, $8, $9, $10)`,
    [form.id, f.catalog_resource_id, name, `${name.toLowerCase()}@x.edu`, cols.status, cols.due ?? null, iso(-5), cols.opened ?? null, cols.submitted ?? null, cols.reminders ?? 0])
  await add('Ava', { status: 'submitted', submitted: iso(-1) })
  await add('Ben', { status: 'opened', opened: iso(-2), due: iso(-1), reminders: 2 })
  await add('Cy', { status: 'sent', due: iso(3) })
  await add('Dee', { status: 'closed', due: iso(-4) })
  await add('Eli', { status: 'voided' })
  const people = await peopleFor(w.db, f.catalog_resource_id, false)
  assert.deepEqual(people.map(p => p.name).sort(), ['Ava', 'Ben', 'Cy', 'Dee'], 'a voided link is not someone it went to')
  const by = Object.fromEntries(people.map(p => [p.name, p]))
  assert.equal(completionStatus(by.Ava), 'done')
  assert.equal(completionStatus(by.Ben), 'overdue')
  assert.equal(by.Ben.reminders, 2)
  assert.equal(completionStatus(by.Cy), 'not_opened')
  assert.equal(by.Dee.closed, 'Closed')
  assert.equal(by.Ava.closed, '')
  assert.ok(people.every(p => p.kind === 'form' && p.school === 'UCLA'))
  assert.deepEqual(await peopleFor(w.db, f.catalog_resource_id, true), [], 'a demo session sees demo links only')
})

test('a signature template lists one row per request, named by its first signer', async () => {
  const w = await world()
  const { rows: [c] } = await w.pg.query(`INSERT INTO catalog_resources (slug, title, kind, storage_path) VALUES ('agreement', 'Agreement', 'signature', 'sig-template:x') RETURNING id`)
  const req = async (code, status, extra = {}) => (await w.pg.query(
    `INSERT INTO sig_requests (envelope_code, title, document_type, catalog_resource_id, status, sent_at, due_at, completed_at)
     VALUES ($1, 'Agreement', 'agreement', $2, $3, now(), $4, $5) RETURNING id`, [code, c.id, status, extra.due ?? null, extra.completed ?? null])).rows[0].id
  const signer = (rid, i, name, opened = null) => w.pg.query(
    `INSERT INTO sig_request_signers (request_id, role_key, order_index, name, email, opened_at, reminder_count) VALUES ($1, $2, $3, $4, $5, $6, 1)`,
    [rid, `r${i}`, i, name, `${name.toLowerCase()}@x.edu`, opened])
  const a = await req('A1', 'completed', { completed: iso(-1) }); await signer(a, 1, 'Ava'); await signer(a, 2, 'Preceptor')
  const b = await req('B1', 'opened', { due: iso(-1) }); await signer(b, 1, 'Ben', iso(-2))
  const d = await req('D1', 'declined'); await signer(d, 1, 'Dee')
  const x = await req('X1', 'voided'); await signer(x, 1, 'Xan')
  await req('Z1', 'draft')
  const people = await peopleFor(w.db, c.id, false)
  const by = Object.fromEntries(people.map(p => [p.name, p]))
  assert.deepEqual(Object.keys(by).sort(), ['Ava', 'Ben', 'Dee'], 'drafts and voided requests are not listed')
  assert.equal(by.Ava.others, 1)
  assert.equal(by.Ava.reminders, 2)
  assert.equal(completionStatus(by.Ava), 'done')
  assert.equal(completionStatus(by.Ben), 'overdue')
  assert.equal(by.Ben.opened_at != null, true)
  assert.equal(by.Dee.closed, 'Declined')
  assert.ok(people.every(p => p.kind === 'signature'))
})

test('the panel lists people for forms and signatures, reminds through each engine, and never by colour alone', () => {
  const staff = read('api/form-staff.js')
  assert.match(staff, /case 'people': needUuid\(body\.catalog_resource_id/)
  const page = read('src/components/catalog/CatalogPage.jsx')
  assert.match(page, /canManage && virtual && formsAllowed && \(\s*<CatalogPeople key=\{row\.id\}/)
  const panel = read('src/components/catalog/CatalogPeople.jsx')
  assert.match(panel, /formStaff\('people', \{ catalog_resource_id: row\.id \}\)/)
  assert.match(panel, /formStaff\('remind', \{ ids: forms \}\)/)
  assert.match(panel, /sigStaff\('remind', \{ id: p\.id \}\)/)
  assert.match(panel, /p\.kind !== 'signature' \|\| sigAllowed/, 'a signature request is reminded only while the flag admits the caller')
  assert.match(panel, /Remind all not done/)
  assert.match(panel, /className=\{`ctl-pstate ctl-pstate-\$\{p\.state\}`\}>\{/, 'the state is a word in the pill')
  const css = read('src/components/catalog/catalog.css')
  const block = css.slice(css.indexOf('Who it went to (CATALOG-PEOPLE-1)'))
  assert.doesNotMatch(block, /border-radius:\s*\d/, 'no literal radii')
})
