// MASTHEAD-PICKER-WEBP-1: prepare dropped city-picker card art.
//
// Drop a 16:9 image named <City>.png (matching a key in PICKER_IMAGE_FILES)
// into public/masthead/picker/ and run:
//   npm run picker:prepare
//
// For each raw PNG this script:
//   1. Resizes to 960px wide, preserving aspect and alpha.
//   2. Encodes WebP at quality 82 alongside it.
//   3. Moves the original to reference/masthead-picker-source/.
//
// WHY 960: the card is drawn at ~232 CSS px in the three-column desktop grid,
// but the ONE-COLUMN PHONE LAYOUT draws it at ~444, and that is the size the
// art has to satisfy. 960 covers it past 2x. The supplied 2000px PNGs were
// 3.3-5.7 MB each, 50 MB for the set, and every byte arrived the first time
// anyone opened the picker.
//
// Requires Homebrew `cwebp` and Python `Pillow` (the maintainer's machine, not
// CI; the derived WebPs are committed).

import { readdirSync, mkdirSync, renameSync, existsSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, parse } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PICKER_DIR = join(root, 'public', 'masthead', 'picker')
const SOURCE_DIR = join(root, 'reference', 'masthead-picker-source')
const WIDTH = 960

const raws = readdirSync(PICKER_DIR).filter(f => /\.png$/i.test(f))
if (raws.length === 0) {
  console.log('No raw .png files in public/masthead/picker/ - nothing to prepare.')
  process.exit(0)
}

mkdirSync(SOURCE_DIR, { recursive: true })
for (const file of raws) {
  const src = join(PICKER_DIR, file)
  const { name } = parse(file)
  const tmp = join(PICKER_DIR, `.${name}.resized.png`)
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(src)})
im.resize((${WIDTH}, round(${WIDTH} * im.height / im.width)), Image.LANCZOS).save(${JSON.stringify(tmp)})
`], { stdio: 'pipe' })
  execFileSync('cwebp', ['-quiet', '-q', '82', '-alpha_q', '100', tmp, '-o', join(PICKER_DIR, `${name}.webp`)], { stdio: 'pipe' })
  unlinkSync(tmp)
  let dest = join(SOURCE_DIR, file)
  if (existsSync(dest)) dest = join(SOURCE_DIR, `${name}.${Date.now()}.png`)
  renameSync(src, dest)
  console.log(`${file} -> ${name}.webp (${WIDTH}px), source moved to reference/masthead-picker-source/`)
}
console.log('Done. Add the city to PICKER_IMAGE_FILES in src/lib/mastheadCityPreference.js if it is new.')
