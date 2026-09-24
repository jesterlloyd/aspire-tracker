// test/helpers/pgliteRest.mjs
//
// A small supabase-js look-alike over PGlite, for tests that must run the real engine
// against real Postgres (triggers, constraints, the audit chain) without a network.
// Covers exactly the query builder calls lib/server/signatures uses: select/insert/
// update/upsert/delete with eq, neq, in, is, not(...), order, limit, single, maybeSingle.
// Plus an in-memory storage bucket. Not a general PostgREST.

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`

function normalize(v) {
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]))
  return v
}

function builder(pg, table, arrayCols) {
  const st = { op: 'select', cols: '*', where: [], params: [], order: [], limit: null, rows: null, patch: null, onConflict: null, returning: null, single: null }
  const p = (v) => { st.params.push(v); return `$${st.params.length}` }
  const api = {
    select(cols = '*') { if (st.op === 'select') st.cols = cols; else st.returning = cols; return api },
    insert(rows) { st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return api },
    upsert(rows, { onConflict } = {}) { st.op = 'upsert'; st.rows = Array.isArray(rows) ? rows : [rows]; st.onConflict = onConflict; return api },
    update(patch) { st.op = 'update'; st.patch = patch; return api },
    delete() { st.op = 'delete'; return api },
    eq(c, v) { st.where.push(() => `${ident(c)} = ${p(v)}`); return api },
    neq(c, v) { st.where.push(() => `${ident(c)} IS DISTINCT FROM ${p(v)}`); return api },
    in(c, vs) { st.where.push(() => vs.length ? `${ident(c)} IN (${vs.map(v => p(v)).join(', ')})` : 'false'); return api },
    is(c, v) { st.where.push(() => `${ident(c)} IS ${v === null ? 'NULL' : v ? 'TRUE' : 'FALSE'}`); return api },
    not(c, op, v) {
      if (op === 'is') st.where.push(() => `${ident(c)} IS NOT ${v === null ? 'NULL' : v}`)
      else if (op === 'like') st.where.push(() => `${ident(c)} NOT LIKE ${p(v)}`)
      else throw new Error(`not(${op}) unsupported`)
      return api
    },
    filter() { throw new Error('filter() unsupported in pgliteRest') },
    order(c, { ascending = true } = {}) { st.order.push(`${ident(c)} ${ascending ? 'ASC' : 'DESC'}`); return api },
    limit(n) { st.limit = n; return api },
    single() { st.single = 'one'; return api },
    maybeSingle() { st.single = 'maybe'; return api },
    then(res, rej) { return run().then(res, rej) },
  }
  const cols = (c) => (!c || c === '*') ? '*' : c.split(',').map(s => ident(s.trim())).join(', ')
  // A text[] column takes a Postgres array literal; everything else that is an object is jsonb.
  const pgArray = (xs) => `{${xs.map(x => x == null ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
  const valFor = (k, v) => (Array.isArray(v) && arrayCols.has(k)) ? pgArray(v) : val(v)
  const val = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v
  async function run() {
    try {
      await arrayCols.ready
      const whereSql = st.where.length ? ` WHERE ${st.where.map(f => f()).join(' AND ')}` : ''
      let sql
      if (st.op === 'select') {
        sql = `SELECT ${cols(st.cols)} FROM ${ident(table)}${whereSql}${st.order.length ? ` ORDER BY ${st.order.join(', ')}` : ''}${st.limit ? ` LIMIT ${st.limit}` : ''}`
      } else if (st.op === 'insert' || st.op === 'upsert') {
        const keys = [...new Set(st.rows.flatMap(r => Object.keys(r)))]
        const values = st.rows.map(r => `(${keys.map(k => p(valFor(k, r[k] ?? null))).join(', ')})`).join(', ')
        const conflict = st.op === 'upsert' ? ` ON CONFLICT (${st.onConflict.split(',').map(ident).join(', ')}) DO UPDATE SET ${keys.map(k => `${ident(k)} = EXCLUDED.${ident(k)}`).join(', ')}` : ''
        sql = `INSERT INTO ${ident(table)} (${keys.map(ident).join(', ')}) VALUES ${values}${conflict} RETURNING ${cols(st.returning || '*')}`
      } else if (st.op === 'update') {
        const sets = Object.entries(st.patch).map(([k, v]) => `${ident(k)} = ${p(valFor(k, v))}`).join(', ')
        sql = `UPDATE ${ident(table)} SET ${sets}${whereSql} RETURNING ${cols(st.returning || '*')}`
      } else {
        sql = `DELETE FROM ${ident(table)}${whereSql} RETURNING *`
      }
      const { rows } = await pg.query(sql, st.params)
      const data = rows.map(normalize)
      if (st.single === 'one') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${data.length}` } }
      if (st.single === 'maybe') return { data: data[0] ?? null, error: null }
      return { data, error: null }
    } catch (e) {
      return { data: null, error: { code: e.code || 'XX000', message: e.message } }
    }
  }
  return api
}

// Which columns of a table are Postgres arrays, read once per table.
const arrayCache = new WeakMap()
function arrayColumns(pg, table) {
  if (!arrayCache.has(pg)) arrayCache.set(pg, new Map())
  const perDb = arrayCache.get(pg)
  if (!perDb.has(table)) {
    const set = new Set()
    set.ready = pg.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'ARRAY'`, [table])
      .then(({ rows }) => { for (const r of rows) set.add(r.column_name) })
    perDb.set(table, set)
  }
  return perDb.get(table)
}

export function pgliteRest(pg) {
  const buckets = new Map()
  const bucket = (name) => { if (!buckets.has(name)) buckets.set(name, new Map()); return buckets.get(name) }
  return {
    from: (t) => builder(pg, t, arrayColumns(pg, t)),
    storage: {
      from: (name) => ({
        async upload(path, bytes, { upsert = false } = {}) {
          const b = bucket(name)
          if (b.has(path) && !upsert) return { error: { message: 'The resource already exists' } }
          b.set(path, Buffer.from(bytes)); return { data: { path }, error: null }
        },
        async download(path) {
          const x = bucket(name).get(path)
          return x ? { data: new Blob([x]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
        async createSignedUploadUrl(path) { return { data: { path, token: `upload-${path}` }, error: null } },
        async createSignedUrl(path) { return bucket(name).has(path) ? { data: { signedUrl: `memory://${name}/${path}` }, error: null } : { data: null, error: { message: 'not found' } } },
        async remove(paths) { for (const p of paths) bucket(name).delete(p); return { error: null } },
      }),
      _buckets: buckets,
    },
  }
}

/** A mailer that records instead of sending. */
export function fakeMailer() {
  const sent = []
  return { sent, emails: { send: async (m) => { sent.push(m); return { data: { id: `mail-${sent.length}` }, error: null } } } }
}
