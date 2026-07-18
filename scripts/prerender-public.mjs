// scripts/prerender-public.mjs
//
// ASPIRE-PUBLIC-SEO: post-build prerendering of the eight public routes.
// Runs as part of `npm run build` (after the client build and the SSR entry
// build). For each public route it writes a static HTML file into dist/ with:
//   - the fully rendered public page markup inside #root
//   - a route-specific title, meta description, canonical, OG/Twitter tags
//   - robots index,follow (replacing the shell's noindex)
//   - accurate JSON-LD structured data
//
// dist/index.html itself becomes the prerendered homepage. The UNMODIFIED
// shell is preserved first as dist/app.html: vercel.json rewrites every
// non-file route (login, portal, staff, auth) to /app.html, which keeps the
// generic title and the noindex meta, so private routes stay excluded from
// search in their initial response.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const ssrDir = resolve(root, '.prerender-ssr')

const { render } = await import(pathToFileURL(resolve(ssrDir, 'prerender-entry.js')).href)
const { META } = await import(pathToFileURL(resolve(ssrDir, 'publicContent.js')).href)
  .catch(() => import(pathToFileURL(resolve(root, 'src/public-site/publicContent.js')).href))

const BASE = 'https://aspireintelligence.app'

const ROUTES = [
  { page: 'home',        path: '/' },
  { page: 'about',       path: '/about' },
  { page: 'eligibility', path: '/eligibility' },
  { page: 'apply',       path: '/apply' },
  { page: 'experience',  path: '/experience' },
  { page: 'preceptors',  path: '/preceptors' },
  { page: 'faq',         path: '/faq' },
  { page: 'contact',     path: '/contact' },
]

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function jsonLd(page, path, meta) {
  const url = BASE + path
  const graph = []
  if (page === 'home') {
    graph.push({
      '@type': 'WebSite',
      '@id': `${BASE}/#website`,
      url: `${BASE}/`,
      name: 'Cedars-Sinai ASPIRE Program',
      alternateName: ['ASPIRE at Cedars-Sinai', 'ASPIRE Intelligence'],
      description: meta.description,
      publisher: { '@id': `${BASE}/#organization` },
    })
    graph.push({
      '@type': 'Organization',
      '@id': `${BASE}/#organization`,
      name: 'Cedars-Sinai',
      url: 'https://www.cedars-sinai.org',
    })
  } else {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Cedars-Sinai ASPIRE Program', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: meta.title, item: url },
      ],
    })
    graph.push({
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: meta.title,
      description: meta.description,
      isPartOf: { '@id': `${BASE}/#website` },
    })
  }
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`
}

const template = readFileSync(resolve(dist, 'index.html'), 'utf8')

// 1. Preserve the shell (generic title + noindex) for every non-prerendered
//    route via the vercel.json rewrite target. The homepage canonical is
//    stripped: a noindex shell serving /login must not claim the homepage as
//    its canonical URL.
writeFileSync(
  resolve(dist, 'app.html'),
  template.replace(/\s*<link rel="canonical" href="[^"]*" \/>/, ''),
)

// 2. Write each prerendered public page.
for (const { page, path } of ROUTES) {
  const meta = META[page]
  if (!meta) throw new Error(`No META entry for page "${page}"`)
  const url = BASE + path
  const body = render(page, path)

  let html = template
  const swaps = [
    [/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`],
    [/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="index,follow" />'],
    [/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(meta.description)}" />`],
    [/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`],
    [/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(meta.title)}" />`],
    [/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(meta.description)}" />`],
    [/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`],
    [/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(meta.title)}" />`],
    [/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(meta.description)}" />`],
  ]
  for (const [re, replacement] of swaps) {
    if (!re.test(html)) throw new Error(`Template marker not found for ${String(re)} (page ${page})`)
    html = html.replace(re, replacement)
  }
  html = html.replace('</head>', `${jsonLd(page, path, meta)}\n  </head>`)

  const rootRe = /<div id="root"><\/div>/
  if (!rootRe.test(html)) throw new Error('Could not find empty #root in template')
  html = html.replace(rootRe, `<div id="root">${body}</div>`)

  const outFile = path === '/'
    ? resolve(dist, 'index.html')
    : resolve(dist, path.slice(1), 'index.html')
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, html)
  console.log(`prerendered ${path} -> ${outFile.replace(root + '/', '')} (${(body.length / 1024).toFixed(1)}kB body)`)
}

// 3. Clean the temporary SSR build output.
rmSync(ssrDir, { recursive: true, force: true })
console.log('prerender complete: 8 public routes + app.html shell')
