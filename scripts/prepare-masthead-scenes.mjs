// MASTHEAD-SCENE-2/3: prepare dropped masthead city-scene artwork for the app.
//
// SCENE-3 workflow: one FOLDER per city. Drop generated images into
// public/masthead/<City>/ named <City>_<Scene>.png - the seven scenes are
// Dawn, Morning, Day, Golden Hour, Sunset, Night, Rain (Rain shows in
// rainy/overcast/foggy weather). Then run:
//   npm run masthead:prepare
//
// For each raw PNG this script:
//   1. If the frame is already banner-shaped (aspect >= 3:1, e.g. the
//      2000x400 panoramas), converts it to WebP (quality 82) in place.
//      Otherwise it first crops the standard horizon band (y 287..847 of a
//      1024-tall frame, proportionally) - the legacy 3:2 generation shape.
//   2. Moves the raw PNG to reference/masthead-scenes-source/<same subpath>
//      so the deploy payload only carries the small WebPs.
//
// Already-prepared .webp files are left alone. Requires macOS `sips` and
// Homebrew `cwebp` (runs on the maintainer's machine, never in CI/Vercel;
// the derived WebPs are committed). Vite discovers the files at dev/build
// start (see vite.config.js), so restart `npm run dev` after preparing.

import { readdirSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, parse } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCENES_DIR = join(root, 'public', 'masthead')
const SOURCE_DIR = join(root, 'reference', 'masthead-scenes-source')

// Legacy 3:2 crop band as fractions of source height (kept for old-shape
// drops): ridge peaks, clouds, skyline, palms; no dead sky, no bottom artifact.
const BAND_TOP = 287 / 1024
const BAND_BOTTOM = 847 / 1024
const BANNER_ASPECT = 3 // >= this, the frame ships uncropped

const raws = readdirSync(SCENES_DIR, { recursive: true })
  .map(f => String(f).replace(/\\/g, '/'))
  .filter(f => /\.png$/i.test(f))
if (raws.length === 0) {
  console.log('No raw .png files under public/masthead/ - nothing to prepare.')
  process.exit(0)
}

for (const rel of raws) {
  const src = join(SCENES_DIR, rel)
  const probe = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' })
  const width = Number(/pixelWidth: (\d+)/.exec(probe)?.[1])
  const height = Number(/pixelHeight: (\d+)/.exec(probe)?.[1])
  if (!width || !height) { console.error(`skip ${rel}: could not read dimensions`); continue }

  const { dir, name } = parse(rel)
  const webp = join(SCENES_DIR, dir, `${name}.webp`)
  let note
  if (width / height >= BANNER_ASPECT) {
    execFileSync('cwebp', ['-q', '82', src, '-o', webp], { stdio: 'pipe' })
    note = `${width}x${height} banner, uncropped`
  } else {
    const top = Math.round(height * BAND_TOP)
    const bandH = Math.round(height * (BAND_BOTTOM - BAND_TOP))
    const cropped = join(SCENES_DIR, dir, `.${name}.crop.png`)
    execFileSync('sips', ['--cropOffset', String(top), '0', '--cropToHeightWidth', String(bandH), String(width), src, '--out', cropped], { stdio: 'pipe' })
    execFileSync('cwebp', ['-q', '82', cropped, '-o', webp], { stdio: 'pipe' })
    execFileSync('rm', [cropped])
    note = `cropped to ${width}x${bandH}`
  }

  mkdirSync(join(SOURCE_DIR, dir), { recursive: true })
  let dest = join(SOURCE_DIR, rel)
  if (existsSync(dest)) dest = join(SOURCE_DIR, dir, `${name}.${Date.now()}.png`)
  renameSync(src, dest)
  console.log(`${rel} -> ${join(dir, `${name}.webp`)} (${note}), source moved to reference/masthead-scenes-source/`)
}
console.log('Done. Restart the dev server so Vite re-scans the scene files.')
