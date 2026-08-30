// MASTHEAD-SCENE-2: prepare dropped masthead city-scene artwork for the app.
//
// Workflow: drop raw generated images (1536x1024, the standard ChatGPT/DALL-E
// landscape frame with the composition rules from docs - quiet left, skyline
// center-right, horizon ~60-75% down) into public/masthead/ named
//   <City>_<Scene>.png      e.g. LA_Day.png, Chicago_Night.png
// Scene words (case-insensitive): Day, Sunset, Night, and Morning/Dawn/
// EarlyMorning for the pre-sunrise state. Then run:
//   npm run masthead:prepare
//
// For each raw PNG this script:
//   1. crops the useful horizon band (y 287..847 of a 1024-tall frame,
//      proportionally for other heights) - drops the empty upper sky and the
//      grey artifact band these generations carry along the bottom edge,
//   2. converts the band to WebP (quality 82) next to it in public/masthead/,
//   3. moves the raw PNG to reference/masthead-scenes-source/ so the deploy
//      payload only carries the ~100KB WebPs, never the ~1.5MB sources.
//
// Already-prepared .webp files are left alone. Requires macOS `sips` and
// Homebrew `cwebp` (this runs on the maintainer's machine, never in CI/Vercel;
// the derived WebPs are committed). Vite discovers the files at dev/build
// start (see vite.config.js), so restart `npm run dev` after preparing.

import { readdirSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, parse } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCENES_DIR = join(root, 'public', 'masthead')
const SOURCE_DIR = join(root, 'reference', 'masthead-scenes-source')

// Crop band as fractions of source height, tuned on the LA set: keeps ridge
// peaks, clouds, skyline, and palms; drops dead sky and the bottom artifact.
const BAND_TOP = 287 / 1024
const BAND_BOTTOM = 847 / 1024

const raws = readdirSync(SCENES_DIR).filter(f => /\.png$/i.test(f))
if (raws.length === 0) {
  console.log('No raw .png files in public/masthead/ - nothing to prepare.')
  process.exit(0)
}
mkdirSync(SOURCE_DIR, { recursive: true })

for (const name of raws) {
  const src = join(SCENES_DIR, name)
  const probe = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' })
  const width = Number(/pixelWidth: (\d+)/.exec(probe)?.[1])
  const height = Number(/pixelHeight: (\d+)/.exec(probe)?.[1])
  if (!width || !height) { console.error(`skip ${name}: could not read dimensions`); continue }

  const top = Math.round(height * BAND_TOP)
  const bandH = Math.round(height * (BAND_BOTTOM - BAND_TOP))
  const cropped = join(SCENES_DIR, `.${name}.crop.png`)
  const webp = join(SCENES_DIR, `${parse(name).name}.webp`)

  execFileSync('sips', ['--cropOffset', String(top), '0', '--cropToHeightWidth', String(bandH), String(width), src, '--out', cropped], { stdio: 'pipe' })
  execFileSync('cwebp', ['-q', '82', cropped, '-o', webp], { stdio: 'pipe' })
  execFileSync('rm', [cropped])

  let dest = join(SOURCE_DIR, name)
  if (existsSync(dest)) dest = join(SOURCE_DIR, `${parse(name).name}.${Date.now()}.png`)
  renameSync(src, dest)
  console.log(`${name} -> ${parse(name).name}.webp (${width}x${bandH}), source moved to reference/masthead-scenes-source/`)
}
console.log('Done. Restart the dev server so Vite re-scans the scene files.')
