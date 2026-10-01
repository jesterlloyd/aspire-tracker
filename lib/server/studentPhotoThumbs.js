// lib/server/studentPhotoThumbs.js
//
// PHOTO-THUMBS-1 (Owner, 2026-09-30: "make the app so much faster, especially the loading of
// students' photos"). Measured first: student-files held 81 images averaging 1,074 KB (the largest
// 5,057 KB), and every avatar, 28 to 96 pixels wide, downloaded its original. A roster of forty was
// about 40 MB of photographs.
//
// So each headshot gets a SMALL COPY beside it, in the same private folder:
//
//     <cohort>/<student>/headshot.<ext>        the original, never touched, never recompressed
//     <cohort>/<student>/headshot-thumb.jpg    256 pixels on its shorter side, about 15 to 30 KB
//
// Rules this file keeps:
//   - The original is the record. The ID badge, Download and Open ask for it by name and always
//     get it; a small copy is only ever handed to a caller that asked for one (staff) or to a
//     roster endpoint that never produces a badge (Unit Leader, Academic Partner).
//   - No small copy yet is never a missing photo: the signer falls back to the original, exactly
//     what every screen showed before this existed.
//   - The small copy lives in the student's own folder, so the same path guard
//     (refBelongsToStudent), the same signed-URL lifetime and the same delete-the-folder cleanup
//     cover it. Nothing about who may see a photograph changes.
//   - Photos travel browser -> storage and never pass through the server, so the copies are made
//     by a scheduled sweep (api/cron/photo-thumbs.js), which is also the one-time pass over the
//     photos that already exist. A replaced photo drops its old copy the moment the new original
//     is in place (dropHeadshotThumb), so nobody is shown the previous face; a once-a-day deep
//     check catches a copy older than its original however that came about.
//
// sharp is imported only where a copy is actually made, so the endpoints that merely sign a URL
// never load it.

import { Buffer } from 'node:buffer'
import { STUDENT_FILES_BUCKET, parseStoredFileRef, refBelongsToStudent, signedUrlTtlSeconds } from './studentFiles.js'

export const THUMB_FILE = 'headshot-thumb.jpg'
export const THUMB_PX = 256          // the SHORTER side: a cover-cropped circle is never upscaled
export const THUMB_QUALITY = 82
export const THUMBS_PER_RUN = 20
const SIGN_CHUNK = 100
const PROBE_TTL = 60                 // the sweep only asks whether a copy exists

/** The small copy's path for an original headshot path, or null when the path is not one. */
export function thumbPathFor(originalPath) {
  if (typeof originalPath !== 'string') return null
  const parts = originalPath.split('/')
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null
  if (!/^headshot\.[a-z0-9]+$/i.test(parts[2])) return null
  return `${parts[0]}/${parts[1]}/${THUMB_FILE}`
}

const bucket = (storage) => storage.from(STUDENT_FILES_BUCKET)

/** One headshot: the small copy when there is one, else the original. Returns a URL or null. */
export async function signHeadshotPreferThumb(storage, originalPath) {
  const ttl = signedUrlTtlSeconds('headshot')
  const thumb = thumbPathFor(originalPath)
  if (thumb) {
    const { data, error } = await bucket(storage).createSignedUrl(thumb, ttl)
    if (!error && data?.signedUrl) return data.signedUrl
  }
  const { data, error } = await bucket(storage).createSignedUrl(originalPath, ttl)
  return !error && data?.signedUrl ? data.signedUrl : null
}

/**
 * Many headshots in two storage calls at most: every small copy in one batch, then the originals of
 * the ones that have none. Returns { ok, urls } with urls[i] for paths[i] (null when neither signs).
 */
export async function signHeadshotsPreferThumb(storage, originalPaths) {
  const ttl = signedUrlTtlSeconds('headshot')
  const urls = originalPaths.map(() => null)
  const thumbs = originalPaths.map(thumbPathFor)
  const withThumb = thumbs.map((t, i) => (t ? i : -1)).filter(i => i >= 0)
  if (withThumb.length) {
    const { data } = await bucket(storage).createSignedUrls(withThumb.map(i => thumbs[i]), ttl)
    withThumb.forEach((i, k) => { const s = data?.[k]; if (s && !s.error && s.signedUrl) urls[i] = s.signedUrl })
  }
  const rest = urls.map((u, i) => (u ? -1 : i)).filter(i => i >= 0)
  if (rest.length) {
    const { data, error } = await bucket(storage).createSignedUrls(rest.map(i => originalPaths[i]), ttl)
    if (error) return { ok: false, urls }
    rest.forEach((i, k) => { const s = data?.[k]; if (s && !s.error && s.signedUrl) urls[i] = s.signedUrl })
  }
  return { ok: true, urls }
}

/**
 * A new original is in place: its old small copy must go, so the next reader gets the new photo
 * (the original) until the sweep rebuilds the copy. Best effort; never throws.
 */
export async function dropHeadshotThumb(storage, originalPath) {
  const thumb = thumbPathFor(originalPath)
  if (!thumb) return false
  try { const { error } = await bucket(storage).remove([thumb]); return !error } catch { return false }
}

/** The small copy of an image: upright, 256 on its shorter side, never enlarged, JPEG on white. */
export async function makeThumb(input) {
  const { default: sharp } = await import('sharp')
  return sharp(input, { failOn: 'none' })
    .rotate()                                   // honour a phone's rotation flag, then drop it
    .resize(THUMB_PX, THUMB_PX, { fit: 'outside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })         // a transparent PNG becomes a photo on white
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer()
}

/** Every real student's original headshot path, bound to that student. */
async function headshotPaths(db) {
  const { data, error } = await db.from('students').select('id, headshot_url').not('headshot_url', 'is', null).limit(5000)
  if (error) throw new Error('students_unreadable')
  const out = []
  for (const row of data || []) {
    const ref = parseStoredFileRef(row.headshot_url)
    if (ref.kind === 'empty' || ref.kind === 'unknown') continue
    if (!refBelongsToStudent(ref.path, row.id) || !thumbPathFor(ref.path)) continue
    out.push(ref.path)
  }
  return out
}

/** Which of these originals have no small copy. One storage call per hundred. */
async function missingThumbs(storage, paths) {
  const missing = []
  for (let i = 0; i < paths.length; i += SIGN_CHUNK) {
    const chunk = paths.slice(i, i + SIGN_CHUNK)
    const { data, error } = await bucket(storage).createSignedUrls(chunk.map(thumbPathFor), PROBE_TTL)
    if (error) throw new Error('storage_unavailable')
    chunk.forEach((p, k) => { const s = data?.[k]; if (!s || s.error || !s.signedUrl) missing.push(p) })
  }
  return missing
}

/** The deep check: a small copy older than its original is stale. One listing per student folder. */
async function staleThumbs(storage, paths) {
  const stale = []
  for (const p of paths) {
    const [cohort, student, file] = p.split('/')
    const { data, error } = await bucket(storage).list(`${cohort}/${student}`, { limit: 100 })
    if (error || !Array.isArray(data)) continue
    const at = (name) => { const o = data.find(x => x.name === name); return o ? new Date(o.updated_at || o.created_at || 0).getTime() : null }
    const original = at(file), thumb = at(THUMB_FILE)
    if (original != null && thumb != null && thumb < original) stale.push(p)
  }
  return stale
}

async function buildOne(storage, originalPath) {
  const { data, error } = await bucket(storage).download(originalPath)
  if (error || !data) return 'unreadable'
  let small
  try { small = await makeThumb(Buffer.from(await data.arrayBuffer())) } catch { return 'not_an_image' }
  const { error: upErr } = await bucket(storage).upload(thumbPathFor(originalPath), small, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
  return upErr ? 'upload_failed' : 'built'
}

/**
 * One sweep. Builds up to `limit` missing small copies; with `deep`, first drops any copy older
 * than its original. Returns counts only (no names, no paths): { photos, missing, built, failed, dropped }.
 * `now` rotates where the sweep starts, so a photo that cannot be read never starves the others.
 */
export async function runThumbSweep(db, storage, { limit = THUMBS_PER_RUN, deep = false, now = Date.now() } = {}) {
  const paths = await headshotPaths(db)
  let dropped = 0
  if (deep) {
    for (const p of await staleThumbs(storage, paths)) if (await dropHeadshotThumb(storage, p)) dropped++
  }
  const missing = await missingThumbs(storage, paths)
  const start = missing.length ? Math.floor(now / 600000) % missing.length : 0
  const todo = [...missing.slice(start), ...missing.slice(0, start)].slice(0, limit)
  let built = 0, failed = 0
  for (const p of todo) {
    if ((await buildOne(storage, p)) === 'built') built++
    else failed++
  }
  return { photos: paths.length, missing: missing.length, built, failed, dropped }
}
