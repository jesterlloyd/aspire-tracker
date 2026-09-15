// PORTAL-SPLIT: what a first load actually costs, measured rather than guessed.
//
// Usage:
//   npx vite build --sourcemap --outDir <dir>
//   node scripts/chunkReport.mjs <dir> [--top=20] [--json] [--html=<relative html>]
//
// --html names the entry document when it is not app.html or index.html at the
// top of the build (a multi-entry build puts each one at its own path).
//
// Prints, for one build:
//   1. every JS/CSS chunk with raw and gzipped bytes, largest first;
//   2. the FIRST LOAD of each audience: the entry chunk plus the chunks the
//      browser must have before that route can render (the entry's static
//      imports, read from the HTML's modulepreload links);
//   3. the entry chunk broken down by npm package and by src/ folder, from the
//      sourcemap's sourcesContent (pre-minified bytes, so shares are indicative
//      of who owns the chunk rather than of shipped bytes).
//
// The third section is the one that matters when moving a split boundary: a
// lazy() in the wrong place HOISTS a shared dependency graph into the entry
// (App.jsx records the NGRP case: 585 KB -> 3 MB). Run this before and after.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { gzipSync } from 'node:zlib'

const [, , outDir = 'dist', ...rest] = process.argv
const topN = Number((rest.find(a => a.startsWith('--top='))?.split('=')[1]) || 20)
const asJson = rest.includes('--json')
const assetsDir = join(outDir, 'assets')
if (!existsSync(assetsDir)) {
  console.error(`No assets directory at ${assetsDir}. Build first: npx vite build --sourcemap --outDir ${outDir}`)
  process.exit(1)
}

const kb = n => `${(n / 1024).toFixed(1)} KB`
const files = readdirSync(assetsDir).filter(f => /\.(js|css)$/.test(f))
const sizes = new Map()
for (const f of files) {
  const buf = readFileSync(join(assetsDir, f))
  sizes.set(f, { raw: buf.length, gz: gzipSync(buf).length })
}

// The HTML entry lists the entry chunk and everything preloaded with it: that
// set IS the first load, before any route-level lazy chunk is fetched.
const htmlFlag = rest.find(a => a.startsWith('--html='))?.split('=')[1]
const htmlName = [htmlFlag, 'app.html', 'index.html'].filter(Boolean).find(h => existsSync(join(outDir, h)))
const html = htmlName ? readFileSync(join(outDir, htmlName), 'utf8') : ''
const referenced = [...html.matchAll(/assets\/([A-Za-z0-9_.-]+\.(?:js|css))/g)].map(m => m[1])
const firstLoad = [...new Set(referenced)]
const sum = names => names.reduce((acc, n) => {
  const s = sizes.get(n)
  return s ? { raw: acc.raw + s.raw, gz: acc.gz + s.gz } : acc
}, { raw: 0, gz: 0 })

// Entry chunk composition, from its sourcemap.
const entryJs = firstLoad.find(n => n.endsWith('.js') && n.startsWith('index-')) || firstLoad.find(n => n.endsWith('.js'))
const mapPath = entryJs ? join(assetsDir, `${entryJs}.map`) : null
const byOwner = new Map()
let mappedTotal = 0
if (mapPath && existsSync(mapPath)) {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'))
  const contents = map.sourcesContent || []
  map.sources.forEach((src, i) => {
    const content = contents[i]
    if (!content) return
    let owner = src
    if (src.includes('node_modules/')) {
      const parts = src.split('node_modules/').pop().split('/')
      owner = `npm:${parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]}`
    } else if (src.includes('src/')) {
      const seg = src.split('src/').pop().split('/')
      owner = `src/${seg.length > 1 && ['components', 'portal', 'lib', 'pages', 'public-site', 'styles'].includes(seg[0]) ? `${seg[0]}/${seg[1]}` : seg[0]}`
    }
    byOwner.set(owner, (byOwner.get(owner) || 0) + content.length)
    mappedTotal += content.length
  })
}

const report = {
  outDir,
  firstLoad: { files: firstLoad, ...sum(firstLoad) },
  chunks: [...sizes.entries()].sort((a, b) => b[1].raw - a[1].raw).map(([name, s]) => ({ name, ...s })),
  entryChunk: entryJs || null,
  entryComposition: [...byOwner.entries()].sort((a, b) => b[1] - a[1]).map(([owner, bytes]) => ({
    owner, bytes, share: mappedTotal ? bytes / mappedTotal : 0,
  })),
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`\n=== ${outDir} ===`)
  console.log(`FIRST LOAD (${htmlName || 'no html'}): ${kb(report.firstLoad.raw)} raw, ${kb(report.firstLoad.gz)} gzipped, ${firstLoad.length} files`)
  for (const f of firstLoad) {
    const s = sizes.get(f)
    if (s) console.log(`    ${kb(s.gz).padStart(9)} gz  ${f}`)
  }
  console.log(`\nLARGEST CHUNKS (raw / gzipped)`)
  for (const c of report.chunks.slice(0, topN)) {
    console.log(`    ${kb(c.raw).padStart(10)} / ${kb(c.gz).padStart(9)}  ${c.name}`)
  }
  if (report.entryComposition.length) {
    console.log(`\nENTRY CHUNK ${entryJs} BY OWNER (pre-minified source bytes, ${kb(mappedTotal)} mapped)`)
    for (const row of report.entryComposition.slice(0, topN)) {
      console.log(`    ${kb(row.bytes).padStart(10)}  ${(row.share * 100).toFixed(1).padStart(5)}%  ${row.owner}`)
    }
  } else {
    console.log('\nNo sourcemap for the entry chunk: rebuild with --sourcemap for the composition section.')
  }
  console.log('')
}
void basename
void statSync
