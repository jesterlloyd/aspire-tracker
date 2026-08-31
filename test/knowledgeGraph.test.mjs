// KNOWLEDGE-GRAPH-1: the Knowledge Center Graph View.
//
// Three layers:
//   1. buildKnowledgeGraph - edges from explicit governed relationships ONLY.
//   2. knowledgeGraphLayout - deterministic force layout + traversal.
//   3. Source pins - endpoint posture, List-default UI, drawer reuse, no new
//      dependency, and the no-inferred-edges guarantee.
//
// Run: node --test test/knowledgeGraph.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildKnowledgeGraph } from '../lib/server/keith/knowledgeGraph.js'
import {
  buildAdjacency, neighborhood, computeLayout, boundsOf, fitTransform, nodeRadius, hash01,
} from '../src/lib/knowledgeGraphLayout.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripComments = (s) => s.split('\n').filter(l => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('--')
}).join('\n')

// ── Graph assembly ───────────────────────────────────────────────────────────

const E = (id, over = {}) => ({
  id, slug: `slug-${id}`, title: `Title ${id}`, category: 'faq', state: 'active',
  body_format: 'markdown', superseded_by: null, expires_at: null, review_date: null, tags: [],
  ...over,
})
const L = (source, target, status = 'resolved') => ({
  source_entry_id: source, target_entry_id: status === 'resolved' ? target : null, status,
})

test('edges come ONLY from resolved wikilinks and superseded_by', () => {
  const { nodes, edges } = buildKnowledgeGraph({
    entries: [E('a'), E('b'), E('c', { superseded_by: 'a' })],
    links: [
      L('a', 'b'),
      L('a', null, 'broken'),
      L('b', null, 'ambiguous'),
      { source_entry_id: 'b', target_entry_id: null, status: 'self' },
    ],
    today: '2026-08-07',
  })
  assert.equal(edges.length, 2)
  assert.deepEqual(edges[0], { source: 'a', target: 'b', type: 'wikilink' })
  assert.deepEqual(edges[1], { source: 'c', target: 'a', type: 'supersedes' },
    'supersession points FROM the old page TO its replacement')
  // Broken links became counts, not lines.
  const a = nodes.find(n => n.id === 'a')
  const b = nodes.find(n => n.id === 'b')
  assert.equal(a.broken_count, 1)
  assert.equal(b.broken_count, 1)
})

test('degree, direction and orphan flags are exact', () => {
  const { nodes } = buildKnowledgeGraph({
    entries: [E('hub'), E('x'), E('y'), E('lonely')],
    links: [L('x', 'hub'), L('y', 'hub'), L('hub', 'x')],
    today: '2026-08-07',
  })
  const hub = nodes.find(n => n.id === 'hub')
  assert.equal(hub.degree, 3)
  assert.equal(hub.in_degree, 2)
  assert.equal(hub.out_degree, 1)
  assert.equal(hub.is_orphan, false)
  const lonely = nodes.find(n => n.id === 'lonely')
  assert.equal(lonely.degree, 0)
  assert.equal(lonely.is_orphan, true, 'no relationship in either direction = orphan')
})

test('defensive exclusions: self loops, dangling endpoints, duplicates', () => {
  const { edges } = buildKnowledgeGraph({
    entries: [E('a'), E('b', { superseded_by: 'b' })], // self-supersession ignored
    links: [
      { source_entry_id: 'a', target_entry_id: 'a', status: 'resolved' }, // self loop
      { source_entry_id: 'a', target_entry_id: 'ghost', status: 'resolved' }, // dangling
      L('a', 'b'), L('a', 'b'), // duplicate
    ],
    today: '2026-08-07',
  })
  assert.equal(edges.length, 1)
  assert.deepEqual(edges[0], { source: 'a', target: 'b', type: 'wikilink' })
})

test('review flags are computed from the injected date, and no body ever rides along', () => {
  const { nodes } = buildKnowledgeGraph({
    entries: [
      E('old', { expires_at: '2026-01-01', body: 'SHOULD NEVER APPEAR' }),
      E('due', { review_date: '2026-08-07' }),
      E('fresh', { review_date: '2026-12-01' }),
    ],
    links: [],
    today: '2026-08-07',
  })
  assert.equal(nodes.find(n => n.id === 'old').expired, true)
  assert.equal(nodes.find(n => n.id === 'due').due_for_review, true, 'due today counts as due')
  assert.equal(nodes.find(n => n.id === 'fresh').due_for_review, false)
  // The node shape is a closed metadata set - body can never leak through it.
  for (const n of nodes) assert.ok(!('body' in n), 'graph nodes must never carry content')
})

// ── Traversal + layout ───────────────────────────────────────────────────────

const CHAIN = [
  { source: 'a', target: 'b', type: 'wikilink' },
  { source: 'b', target: 'c', type: 'wikilink' },
  { source: 'c', target: 'd', type: 'wikilink' },
]

test('adjacency is undirected and neighborhood respects depth', () => {
  const adj = buildAdjacency(CHAIN)
  assert.deepEqual([...adj.get('b')].sort(), ['a', 'c'])
  assert.deepEqual([...neighborhood('a', CHAIN, 1)].sort(), ['a', 'b'], '1 hop')
  assert.deepEqual([...neighborhood('a', CHAIN, 2)].sort(), ['a', 'b', 'c'], '2 hops')
  assert.deepEqual([...neighborhood('z', CHAIN, 1)].sort(), ['z'], 'unknown start = itself')
})

test('the layout is deterministic: same graph, same shape, every time', () => {
  const nodes = ['a', 'b', 'c', 'd', 'lonely'].map(id => ({ id, degree: 1 }))
  const p1 = computeLayout(nodes, CHAIN)
  const p2 = computeLayout(nodes, CHAIN)
  for (const id of ['a', 'b', 'c', 'd', 'lonely']) {
    assert.deepEqual(p1.get(id), p2.get(id), `${id} must not reshuffle between visits`)
    assert.ok(Number.isFinite(p1.get(id).x) && Number.isFinite(p1.get(id).y), 'positions stay finite')
  }
  // hash01 is the only randomness source and it is pure.
  assert.equal(hash01('cs-link-access', 1), hash01('cs-link-access', 1))
  assert.notEqual(hash01('cs-link-access', 1), hash01('cs-link-access', 2))
})

test('the physics actually cluster: linked nodes end nearer than strangers', () => {
  const nodes = ['a', 'b', 'far1', 'far2'].map(id => ({ id, degree: 0 }))
  const edges = [{ source: 'a', target: 'b', type: 'wikilink' }]
  const pos = computeLayout(nodes, edges)
  const d = (m, n) => Math.hypot(pos.get(m).x - pos.get(n).x, pos.get(m).y - pos.get(n).y)
  assert.ok(d('a', 'b') < d('a', 'far1'), 'the spring must beat pure repulsion')
  assert.ok(d('a', 'b') < d('far1', 'far2'), 'unlinked pairs drift apart')
})

test('fitTransform frames the bounds inside the viewport', () => {
  const pos = new Map([['a', { x: -100, y: -50 }], ['b', { x: 100, y: 50 }]])
  const b = boundsOf(pos, 10)
  const t = fitTransform(b, 800, 560)
  for (const { x, y } of pos.values()) {
    const sx = x * t.scale + t.tx
    const sy = y * t.scale + t.ty
    assert.ok(sx >= 0 && sx <= 800 && sy >= 0 && sy <= 560, 'every point lands on screen')
  }
  assert.ok(t.scale <= 1.6, 'fit never over-zooms a tiny graph')
})

test('node radius grows with degree but stays bounded', () => {
  assert.ok(nodeRadius(0) < nodeRadius(3))
  assert.ok(nodeRadius(3) < nodeRadius(12))
  assert.ok(nodeRadius(500) <= 19, 'a mega-hub cannot swallow the canvas')
})

// ── Endpoint posture ─────────────────────────────────────────────────────────

const endpoint = read('api/knowledge-admin.js')

test('knowledge_graph is a bare read action with no writable surface', () => {
  assert.match(endpoint, /knowledge_graph:\s*\['action'\]/)
  const block = endpoint.slice(endpoint.indexOf("case 'knowledge_graph'"), endpoint.indexOf("case 'link_report'"))
  // Two SELECTs, zero writes, and the entry select carries NO body column.
  assert.match(block, /from\('knowledge_entries'\)/)
  assert.match(block, /from\('knowledge_links'\)/)
  assert.doesNotMatch(block, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/)
  const select = /select\('([^']+)'\)/.exec(block)[1]
  assert.ok(!select.split(',').map(s => s.trim()).includes('body'), 'the graph payload must never include content')
})

test('the graph required NO new SQL: no migration ships with this feature', () => {
  // knowledge_links and superseded_by came from the already-applied vault
  // migration; the graph is a pure read over them.
  const migrations = readdirSync(join(here, '..', 'supabase', 'migrations'))
  const graphMigrations = migrations.filter(f => /graph/i.test(f))
  assert.equal(graphMigrations.length, 0, 'a graph migration would mean the code-only constraint was broken')
})

test('NO inferred edges: the builder and endpoint never import an inference surface', () => {
  const builder = stripComments(read('lib/server/keith/knowledgeGraph.js'))
  const view = stripComments(read('src/components/settings/KnowledgeGraphView.jsx'))
  for (const [name, src] of [['builder', builder], ['view', view], ['endpoint', stripComments(endpoint)]]) {
    assert.doesNotMatch(src, /embedding|similarity|cosine|semantic|anthropic|\/v1\/messages/i,
      `${name} must not manufacture relationships`)
  }
  // The builder's only edge sources are the two governed ones.
  const edgeTypes = [...builder.matchAll(/type: '([a-z]+)'/g)].map(m => m[1])
  assert.deepEqual([...new Set(edgeTypes)].sort(), ['supersedes', 'wikilink'])
})

// ── UI pins ──────────────────────────────────────────────────────────────────

const panel = read('src/components/settings/KnowledgeCenterPanel.jsx')
const view = read('src/components/settings/KnowledgeGraphView.jsx')

test('List stays the default view, Graph is the second projection', () => {
  assert.match(panel, /useState\('list'\)/)
  assert.match(panel, /\{ key: 'list', label: 'List' \}, \{ key: 'graph', label: 'Graph' \}/)
  assert.match(panel, /label="Knowledge Center view"/)
  // The list branch still renders the same DataTable chain - untouched.
  assert.match(panel, /<DataTable/)
  assert.match(panel, /columns=\{ENTRY_COLUMNS\}/)
})

test('the graph is fetched lazily and marked stale after every list reload', () => {
  assert.match(panel, /if \(view !== 'graph' \|\| !graphStale \|\| !allowed\) return/)
  assert.match(panel, /action: 'knowledge_graph'/)
  assert.match(panel, /setGraphStale\(true\)/)
})

test('clicking a node opens the SAME drawer as the list - one editing paradigm', () => {
  assert.match(panel, /onOpenEntry=\{node => openEntry\(node\.id\)\}/)
  // The graph view itself talks to no endpoint and owns no editor.
  assert.doesNotMatch(view, /fetch\(|supabase|postAdmin|DetailDrawer|KnowledgeEntryDrawer/)
  assert.match(view, /onOpenEntry\?\.\(node\)/)
})

test('rendering is a dependency-free canvas: no graph library joined the bundle', () => {
  assert.match(view, /<canvas/)
  const pkg = read('package.json')
  assert.doesNotMatch(pkg, /d3|cytoscape|vis-network|sigma|react-force-graph|reagraph/)
})

test('the panel filters drive the graph too, as dimming rather than removal', () => {
  for (const prop of ['stateFilter=\\{stateFilter\\}', 'categoryFilter=\\{categoryFilter\\}', 'tagFilter=\\{activeTagFilter\\}', 'search=\\{search\\}']) {
    assert.match(panel, new RegExp(prop))
  }
  assert.match(view, /filteredOut \? 0\.10/, 'filtered-out nodes dim instead of vanishing')
  assert.match(view, /needs a NON-passive listener|passive: false/,
    'wheel zoom must not scroll the page under the graph')
})

test('local graph: selected entry + neighbors, 1 hop default, 2 optional', () => {
  assert.match(view, /useState\('global'\)/)
  assert.match(view, /useState\(1\)/)
  assert.match(view, /neighborhood\(selectedEntryId, edges \|\| \[\], depth\)/)
  assert.match(view, /setDepth\(d => \(d === 1 \? 2 : 1\)\)/)
  // The selection must SURVIVE closing the drawer: while the drawer is open
  // its backdrop blocks the graph controls, so gating on drawerOpen would
  // make Local mode unreachable by mouse (found in visual QC).
  assert.match(panel, /selectedEntryId=\{selectedEntry\?\.id \|\| null\}/)
})

test('honest sparse-state signals: unlinked and unresolved are counted, never faked', () => {
  assert.match(view, /is_orphan/)
  assert.match(view, /unlinked/)
  assert.match(view, /broken_count > 0/)
  assert.match(view, /unresolved/)
  // The accessible summary names the List view as the complete surface.
  assert.match(view, /Use the List view for full keyboard access/)
})

test('state is encoded by shape as well as color', () => {
  const code = stripComments(view)
  assert.match(code, /state === 'draft'/)      // hollow ring
  assert.match(code, /state === 'deprecated'/) // dashed ring + fade
  assert.match(code, /state === 'archived'/)   // gray fill
  assert.match(code, /superseded_by/)          // amber halo
  assert.match(view, /hollow = draft · dashed ring = deprecated · gray = archived/,
    'the legend explains the non-color cues')
})
