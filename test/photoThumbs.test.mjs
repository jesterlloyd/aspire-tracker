// test/photoThumbs.test.mjs
//
// PHOTO-THUMBS-1 (Owner, 2026-09-30). Student headshots averaged 1,074 KB and every avatar downloaded
// its original. Each now has a small copy beside it. What these tests hold: the copy is small and
// upright; a photo with no copy yet still shows (the original); a replaced photo drops its old copy;
// access is unchanged; and the ID badge, Open and Download ALWAYS get the original.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const T = await import('../lib/server/studentPhotoThumbs.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const COHORT = '11111111-1111-4111-8111-111111111111'
const A = '22222222-2222-4222-8222-222222222222', B = '33333333-3333-4333-8333-333333333333', C = '44444444-4444-4444-8444-444444444444'
const orig = (id, ext = 'jpg') => `${COHORT}/${id}/headshot.${ext}`
const thumb = (id) => `${COHORT}/${id}/headshot-thumb.jpg`

/** An in-memory bucket with the storage calls the module makes. */
function fakeStorage(files = {}) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k, { ...v }]))
  const calls = []
  const api = {
    createSignedUrl: async (path) => { calls.push(['sign', path]); return store.has(path) ? { data: { signedUrl: `signed:${path}` }, error: null } : { data: null, error: { message: 'Object not found' } } },
    createSignedUrls: async (paths) => { calls.push(['signMany', paths.length]); return { data: paths.map(p => (store.has(p) ? { path: p, signedUrl: `signed:${p}`, error: null } : { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' })), error: null } },
    remove: async (paths) => { calls.push(['remove', ...paths]); paths.forEach(p => store.delete(p)); return { error: null } },
    download: async (path) => { calls.push(['download', path]); const f = store.get(path); return f ? { data: new Blob([f.bytes]), error: null } : { data: null, error: { message: 'not found' } } },
    upload: async (path, bytes, opts) => { calls.push(['upload', path, opts?.contentType]); store.set(path, { bytes, updated_at: new Date(api.clock).toISOString() }); return { error: null } },
    list: async (prefix) => { calls.push(['list', prefix]); return { data: [...store.entries()].filter(([k]) => k.startsWith(`${prefix}/`)).map(([k, v]) => ({ name: k.split('/').pop(), updated_at: v.updated_at })), error: null } },
    clock: Date.parse('2026-10-01T09:00:00Z'),
  }
  return { from: (b) => { assert.equal(b, 'student-files'); return api }, store, calls, api }
}
const fakeDb = (rows) => ({ from: (t) => { assert.equal(t, 'students'); return { select: () => ({ not: () => ({ limit: async () => ({ data: rows, error: null }) }) }) } } })
const photo = (w, h, format = 'jpeg') => sharp({ create: { width: w, height: h, channels: format === 'png' ? 4 : 3, background: format === 'png' ? { r: 20, g: 40, b: 200, alpha: 0 } : { r: 180, g: 120, b: 90 } } })[format]().toBuffer()

test('the small copy sits in the student\'s own folder, and only a headshot has one', () => {
  assert.equal(T.thumbPathFor(orig(A)), thumb(A))
  assert.equal(T.thumbPathFor(orig(A, 'png')), thumb(A))
  for (const bad of [`${COHORT}/${A}/resume.pdf`, `${COHORT}/${A}/headshot-thumb.jpg`, `${A}/headshot.jpg`, `${COHORT}/${A}/x/headshot.jpg`, '', null, undefined]) assert.equal(T.thumbPathFor(bad), null, String(bad))
  // The same S-03 guard that binds an original to its student binds the copy.
  const F = read('lib/server/studentFiles.js')
  assert.match(F, /segments\.length !== 3/)
  assert.equal(thumb(A).split('/')[1], A)
})

test('a small copy is small, upright, 256 on its shorter side, and never enlarged', async () => {
  const big = await photo(3000, 4000)
  const out = await T.makeThumb(big)
  const meta = await sharp(out).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 256, 341])
  assert.ok(out.length < 40 * 1024, `${out.length} bytes`)
  // A phone photo stored sideways with a rotation flag comes out upright, with the flag gone.
  const sideways = await sharp(await photo(4000, 3000)).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const up = await sharp(await T.makeThumb(sideways)).metadata()
  assert.deepEqual([up.width, up.height, up.orientation], [256, 341, undefined])
  // A photo already smaller than the copy is not blown up, and a transparent PNG lands on white.
  const tiny = await sharp(await T.makeThumb(await photo(120, 160, 'png'))).raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([tiny.info.width, tiny.info.height, tiny.info.channels], [120, 160, 3])
  assert.ok(tiny.data[0] > 250 && tiny.data[1] > 250 && tiny.data[2] > 250, 'white, not black, behind a transparent photo')
  await assert.rejects(() => T.makeThumb(Buffer.from('not an image')))
})

test('a roster signs the small copy where there is one and the original where there is not', async () => {
  const s = fakeStorage({ [orig(A)]: {}, [thumb(A)]: {}, [orig(B)]: {}, })
  const out = await T.signHeadshotsPreferThumb(s, [orig(A), orig(B), orig(C)])
  assert.deepEqual(out, { ok: true, urls: [`signed:${thumb(A)}`, `signed:${orig(B)}`, null] })
  assert.deepEqual(s.calls, [['signMany', 3], ['signMany', 2]], 'two storage calls for the whole roster')
  assert.equal(await T.signHeadshotPreferThumb(s, orig(A)), `signed:${thumb(A)}`)
  assert.equal(await T.signHeadshotPreferThumb(s, orig(B)), `signed:${orig(B)}`, 'no copy yet is never a missing photo')
  assert.equal(await T.signHeadshotPreferThumb(s, orig(C)), null)
})

test('the sweep builds what is missing, a few at a time, and never writes an original', async () => {
  const bytes = await photo(1200, 1600)
  const s = fakeStorage({ [orig(A)]: { bytes }, [thumb(A)]: { bytes: Buffer.from('x') }, [orig(B)]: { bytes }, [orig(C, 'png')]: { bytes: Buffer.from('corrupt') } })
  const db = fakeDb([
    { id: A, headshot_url: orig(A) }, { id: B, headshot_url: orig(B) }, { id: C, headshot_url: orig(C, 'png') },
    { id: A, headshot_url: orig(B) },                       // names another student: never touched
    { id: B, headshot_url: 'not a reference' }, { id: B, headshot_url: '' },
  ])
  const out = await T.runThumbSweep(db, s, { now: 0 })
  assert.deepEqual(out, { photos: 3, missing: 2, built: 1, failed: 1, dropped: 0 })
  const uploads = s.calls.filter(c => c[0] === 'upload')
  assert.deepEqual(uploads, [['upload', thumb(B), 'image/jpeg']], 'only a small copy is ever uploaded')
  assert.equal((await sharp(s.store.get(thumb(B)).bytes).metadata()).width, 256)
  assert.equal(s.store.get(orig(B)).bytes, bytes, 'the original is the same bytes it was')
  // Nothing left to build that can be built: the next run is one read and one storage call.
  s.calls.length = 0
  const again = await T.runThumbSweep(fakeDb([{ id: A, headshot_url: orig(A) }, { id: B, headshot_url: orig(B) }]), s, { now: 0 })
  assert.deepEqual([again.missing, again.built], [0, 0])
  assert.deepEqual(s.calls, [['signMany', 2]])
  // The limit holds.
  const many = fakeStorage(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${COHORT}/${String(i).padStart(8, '0')}-0000-4000-8000-000000000000/headshot.jpg`, { bytes }])))
  const rows = [...many.store.keys()].map(p => ({ id: p.split('/')[1], headshot_url: p }))
  assert.deepEqual(await T.runThumbSweep(fakeDb(rows), many, { limit: 5, now: 0 }), { photos: 30, missing: 30, built: 5, failed: 0, dropped: 0 })
})

test('a replaced photo drops its old small copy; the daily deep check catches one that slipped through', async () => {
  const bytes = await photo(800, 800)
  const s = fakeStorage({ [orig(A)]: { bytes, updated_at: '2026-10-01T08:00:00Z' }, [thumb(A)]: { bytes: Buffer.from('old'), updated_at: '2026-09-30T08:00:00Z' },
    [orig(B)]: { bytes, updated_at: '2026-09-01T08:00:00Z' }, [thumb(B)]: { bytes: Buffer.from('ok'), updated_at: '2026-09-02T08:00:00Z' } })
  const db = fakeDb([{ id: A, headshot_url: orig(A) }, { id: B, headshot_url: orig(B) }])
  const out = await T.runThumbSweep(db, s, { deep: true, now: 0 })
  assert.deepEqual(out, { photos: 2, missing: 1, built: 1, failed: 0, dropped: 1 })
  assert.notEqual(String(s.store.get(thumb(A)).bytes), 'old', 'rebuilt from the new original')
  assert.equal(String(s.store.get(thumb(B)).bytes), 'ok', 'a copy newer than its original is left alone')
  assert.equal(await T.dropHeadshotThumb(s, orig(B)), true)
  assert.equal(s.store.has(thumb(B)), false)
  assert.equal(s.store.has(orig(B)), true, 'dropping a copy never touches the original')
  assert.equal(await T.dropHeadshotThumb(s, `${COHORT}/${B}/resume.pdf`), false)
  // The four places a new photo lands all drop the old copy.
  assert.match(read('api/student-file-cleanup.js'), /kind === 'headshot' && listed\.names\.includes\(THUMB_FILE\)\) toRemove\.push\(THUMB_FILE\)/)
  assert.match(read('api/portal/my-avatar.js'), /await dropHeadshotThumb\(db\.storage, cp\.path\)/)
  assert.match(read('api/student-intake-submit.js'), /column === 'headshot_url'\) await dropHeadshotThumb\(db\.storage, ref\.path\)/)
  assert.match(read('api/portal/my-profile.js'), /column === 'headshot_url'\) await dropHeadshotThumb\(db\.storage, ref\.path\)/)
  // Deleting a student removes the whole folder, the copy with it.
  assert.match(read('api/student-file-cleanup.js'), /toRemove = listed\.names/)
})

test('THE BADGE GETS THE ORIGINAL: only an explicit request for the small copy is ever answered with one', () => {
  const client = read('src/lib/studentFileClient.js')
  // The single fetch (what the badge, Open and Download use) sends no variant.
  const single = client.slice(client.indexOf('export async function fetchStudentFileUrl('), client.indexOf('// ── Reads (portal own headshot)'))
  assert.match(single, /body: JSON\.stringify\(\{ student_id: studentId, kind \}\)/)
  assert.doesNotMatch(single, /variant|thumb/i)
  // Both badge call sites fetch through the original-only paths, never the avatar hook.
  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /const headshotUrl = await fetchStudentFileUrl\(\{ studentId: student\.id, kind: 'headshot' \}\)\s+const \{ frontBlob, backBlob \} = await generateBadgePNGs\(/)
  const portal = read('src/portal/StudentPortal.jsx')
  assert.match(portal, /const headshotUrl = await fetchPortalHeadshotUrl\(\)/)
  // The student's own portal endpoint (header photo AND their badge) is untouched: originals only.
  assert.doesNotMatch(read('api/portal/student-file-access.js'), /studentPhotoThumbs|thumb/i)
  // Open and Download are original-only too.
  const hook = read('src/lib/useStudentFile.js')
  for (const fn of ['openStudentFile', 'downloadStudentFile']) {
    const body = hook.slice(hook.indexOf(`export async function ${fn}(`)).split('\nexport ')[0]
    assert.match(body, /await fetchStudentFileUrl\(\{ studentId, kind \}\)/)
    assert.doesNotMatch(body, /small|THUMB/)
  }
  // The server: no variant, no small copy.
  const staff = read('api/student-file-access.js')
  assert.match(staff, /const thumb = kind === 'headshot' && it\?\.variant === 'thumb'/)
  assert.match(staff, /const full = toSign\.filter\(\(t\) => !t\.thumb\)/)
  assert.doesNotMatch(read('src/lib/badgeGenerator.js'), /thumb/i)
})

test('avatars ask for the small copy, and the two are never mixed in the cache or a batch', () => {
  const hook = read('src/lib/useStudentFile.js')
  assert.match(hook, /const kind = small && askedKind === 'headshot' \? HEADSHOT_THUMB : askedKind/)
  assert.match(hook, /const key = active \? `\$\{studentId\}:\$\{kind\}:\$\{refreshKey \?\? ''\}` : null/, 'the cache key carries the kind, so a copy and an original never share an entry')
  const client = read('src/lib/studentFileClient.js')
  assert.match(client, /i\.kind === HEADSHOT_THUMB\s+\? \{ student_id: i\.studentId, kind: 'headshot', variant: 'thumb' \}/)
  assert.match(client, /r\.variant === 'thumb' \? HEADSHOT_THUMB : r\.kind/)
  for (const p of ['src/components/StudentAvatar.jsx', 'src/components/connect/RecipientProfileCard.jsx', 'src/portal/PortalApp.jsx', 'src/components/settings/AccountsDirectory.jsx']) assert.match(read(p), /small: true/, p)
  // The largest avatar in the app is well inside the copy at twice the pixel density.
  const sizes = [...read('src/components/StudentSidePanel.jsx').matchAll(/<StudentAvatar[^>]*size=\{(\d+)\}/g)].map(m => +m[1])
  for (const s of sizes) assert.ok(s * 2 <= T.THUMB_PX, `an avatar of ${s}px`)
})

test('the roster endpoints: same access rules, same lifetime, the copy when there is one', () => {
  for (const p of ['api/portal/unit-student-file-access.js', 'api/portal/school-student-file-access.js']) {
    const src = read(p)
    assert.match(src, /if \(kind === 'headshot'\) \{\s+signedUrl = await signHeadshotPreferThumb\(supabaseAdmin\.storage, ref\.path\)/, p)
    // The path guard still runs before anything is signed.
    assert.ok(src.indexOf('refBelongsToStudent(ref.path, studentId)') < src.indexOf('signHeadshotPreferThumb(supabaseAdmin.storage'), p)
  }
  const staff = read('api/student-file-access.js')
  assert.ok(staff.indexOf('refBelongsToStudent(ref.path, row.id)') < staff.indexOf('signHeadshotsPreferThumb(supabaseAdmin.storage'))
  assert.ok(staff.indexOf('if (!roleKinds.has(n.kind)) return nullResult') < staff.indexOf('toSign.push('), 'a role with no headshot access gets no copy either')
  assert.match(read('lib/server/studentPhotoThumbs.js'), /const ttl = signedUrlTtlSeconds\('headshot'\)/)
})

test('the scheduled job: every ten minutes, real students only, a deep check once a day', async () => {
  const v = JSON.parse(read('vercel.json'))
  assert.deepEqual(v.crons.find(c => c.path === '/api/cron/photo-thumbs'), { path: '/api/cron/photo-thumbs', schedule: '*/10 * * * *' })
  assert.equal(v.functions['api/cron/photo-thumbs.js'].maxDuration, 120)
  const { createPhotoThumbsCron, isDeepRun, CRON_NAME } = await import('../api/cron/photo-thumbs.js')
  assert.equal(CRON_NAME, 'photo-thumbs')
  assert.equal(isDeepRun(new Date('2026-10-01T09:00:10Z')), true)
  assert.equal(isDeepRun(new Date('2026-10-01T09:10:10Z')), false)
  assert.equal(isDeepRun(new Date('2026-10-01T15:00:10Z')), false)
  const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }
  const db = { storage: {}, from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'run' }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }) }
  const seen = []
  const sweep = async (d, storage, opts) => { seen.push(opts); return { photos: 81, missing: 81, built: 20, failed: 0, dropped: 0 } }
  const no = res(); await createPhotoThumbsCron({ makeDb: () => db, sweep, authorized: () => false })({}, no)
  assert.equal(no.code, 401)
  const ok = res(); await createPhotoThumbsCron({ makeDb: () => db, sweep, authorized: () => true, clock: () => new Date('2026-10-01T09:00:05Z') })({}, ok)
  assert.deepEqual([ok.code, ok.body.built, seen[0].deep], [200, 20, true])
  assert.ok(!JSON.stringify(ok.body).includes('/'), 'counts only: no names and no paths leave the job')
  assert.match(read('api/cron/photo-thumbs.js'), /populationDb\(createClient\(/)
})

test('PHOTO-THUMBS-LOG-1: a run that did something says so in the server log, in counts only', async () => {
  const src = read('api/cron/photo-thumbs.js')
  // DEMO-THUMBS-1 changed the condition: either sweep having done something, or the demo sweep failing.
  assert.match(src, /if \(did\(real\) \|\| did\(demo\) \|\| demo\?\.error\) console\.log\('\[photo-thumbs\]', JSON\.stringify\(out\)\)/)
  const { createPhotoThumbsCron } = await import('../api/cron/photo-thumbs.js')
  const db = { storage: {}, from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'run' }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }) }
  const res = () => { const r = { status() { return r }, json() { return r } }; return r }
  const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(' '))
  try {
    await createPhotoThumbsCron({ makeDb: () => db, authorized: () => true, sweep: async () => ({ photos: 57, missing: 0, built: 0, failed: 0, dropped: 0 }) })({}, res())
    await createPhotoThumbsCron({ makeDb: () => db, authorized: () => true, sweep: async () => ({ photos: 57, missing: 3, built: 2, failed: 1, dropped: 0 }) })({}, res())
  } finally { console.log = log }
  assert.deepEqual(lines.filter(l => l.startsWith('[photo-thumbs]')), ['[photo-thumbs] {"photos":57,"missing":3,"built":2,"failed":1,"dropped":0}'], 'a quiet run writes nothing')
})

test('DEMO-THUMBS-1: demo students get small copies too, swept apart from real ones', async () => {
  const src = read('api/cron/photo-thumbs.js')
  assert.match(src, /populationDb\(createClient\(/, 'the real sweep still reads real rows only')
  assert.match(src, /scopedServiceDb\(serviceClient\(\), true\)/, 'the demo sweep has its own client, scoped to demo rows')
  const { scopedServiceDb } = await import('../lib/server/demoScope.js')
  // The scope is real: a students read through each client carries its own is_demo filter.
  const seen = []
  const fake = () => ({ storage: {}, from: (t) => ({ select: () => ({ eq: (c, v) => { seen.push([t, c, v]); return { not: () => ({ limit: async () => ({ data: [], error: null }) }) } } }) }) })
  await scopedServiceDb(fake(), true).from('students').select('id, headshot_url').not('headshot_url', 'is', null).limit(1)
  await scopedServiceDb(fake(), false).from('students').select('id, headshot_url').not('headshot_url', 'is', null).limit(1)
  assert.deepEqual(seen, [['students', 'is_demo', true], ['students', 'is_demo', false]])

  const { createPhotoThumbsCron } = await import('../api/cron/photo-thumbs.js')
  const mk = (tag) => ({ tag, storage: { tag }, from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'run' }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }) })
  const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }
  const calls = []
  const sweep = async (db, storage) => { calls.push([db.tag, storage.tag]); return db.tag === 'real' ? { photos: 57, missing: 0, built: 0, failed: 0, dropped: 0 } : { photos: 21, missing: 21, built: 20, failed: 0, dropped: 0 } }
  const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(' '))
  const ok = res()
  try { await createPhotoThumbsCron({ makeDb: () => mk('real'), makeDemoDb: () => mk('demo'), sweep, authorized: () => true })({}, ok) } finally { console.log = log }
  assert.deepEqual(calls, [['real', 'real'], ['demo', 'demo']], 'two sweeps, each with its own client and storage, real first')
  assert.deepEqual(ok.body, { photos: 57, missing: 0, built: 0, failed: 0, dropped: 0, demo: { photos: 21, missing: 21, built: 20, failed: 0, dropped: 0 } })
  assert.equal(lines.filter(l => l.startsWith('[photo-thumbs]')).length, 1, 'a demo build is logged, in counts only')
  // A demo sweep that throws never fails the real run.
  const bad = res()
  const lines2 = []; console.log = (...a) => lines2.push(a.join(' '))
  try { await createPhotoThumbsCron({ makeDb: () => mk('real'), makeDemoDb: () => mk('demo'), authorized: () => true, sweep: async (db) => { if (db.tag === 'demo') throw new Error('storage_unavailable'); return { photos: 57, missing: 0, built: 0, failed: 0, dropped: 0 } } })({}, bad) } finally { console.log = log }
  assert.equal(bad.code, 200)
  assert.deepEqual(bad.body.demo, { error: 'storage_unavailable' })
  // Access is untouched: a demo photo's copy is signed by the same endpoints under the same rules.
  assert.doesNotMatch(read('lib/server/studentPhotoThumbs.js'), /is_demo/)
})
