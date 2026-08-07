// KNOWLEDGE-GRAPH-1: force-directed layout for the Knowledge Center graph.
//
// Hand-rolled on purpose. The corpus is dozens of pages, not thousands, so an
// O(n²) repulsion pass per tick is nothing, and a dependency-free ~150 lines
// beats adding d3-force to the bundle for one Settings surface. If the vault
// ever grows past a few hundred pages this is the module to revisit.
//
// DETERMINISTIC: initial positions derive from a hash of each node's id, never
// from Math.random. The same graph always settles into the same shape, so the
// view doesn't reshuffle on every visit and the math is testable.

/** Adjacency map: id -> Set of neighbor ids (undirected, both edge types). */
export function buildAdjacency(edges) {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const e of edges || []) { add(e.source, e.target); add(e.target, e.source); }
  return adj;
}

/**
 * The n-hop neighborhood of a node (the node itself included). Drives the
 * Local Graph: depth 1 by default, depth 2 as the optional wider view.
 */
export function neighborhood(startId, edges, depth = 1) {
  const adj = buildAdjacency(edges);
  const seen = new Set([startId]);
  let frontier = [startId];
  for (let hop = 0; hop < depth; hop++) {
    const next = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) || []) {
        if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Small stable hash -> [0, 1). Good enough to scatter initial positions. */
export function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Tuning knobs, all in one place. Distances are in world units (≈ CSS px at
// zoom 1); the defaults were eyeballed against a 26-node corpus.
export const LAYOUT = {
  TICKS: 300,           // simulation steps run up-front (small graph: instant)
  REPULSION: 7000,      // inverse-square push between every node pair
  SPRING: 0.035,        // pull along each edge toward SPRING_LENGTH
  SPRING_LENGTH: 110,
  GRAVITY: 0.004,       // gentle pull toward the center keeps islands on screen
  DAMPING: 0.85,
  MAX_STEP: 14,         // per-tick displacement clamp: stability over speed
};

/**
 * Compute settled positions for every node.
 * Returns Map<id, {x, y}> centered on (0, 0).
 *
 * Isolated nodes get the same physics; gravity alone parks them in a loose
 * ring around the connected mass, which reads honestly as "present but
 * unlinked" without a special-case orbit.
 */
export function computeLayout(nodes, edges, opts = {}) {
  const cfg = { ...LAYOUT, ...opts };
  const n = nodes.length;
  const pos = new Map();
  const vel = new Map();
  if (n === 0) return pos;

  // Deterministic scatter, radius scaled to node count so big graphs start
  // spread out instead of exploding from a point.
  const spread = Math.max(160, Math.sqrt(n) * 90);
  for (const node of nodes) {
    const a = hash01(node.id, 1) * Math.PI * 2;
    const r = (0.25 + 0.75 * hash01(node.id, 2)) * spread;
    pos.set(node.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    vel.set(node.id, { x: 0, y: 0 });
  }

  const ids = nodes.map(node => node.id);
  const springs = edges
    .filter(e => pos.has(e.source) && pos.has(e.target) && e.source !== e.target)
    .map(e => [e.source, e.target]);

  for (let tick = 0; tick < cfg.TICKS; tick++) {
    // Repulsion: every pair pushes apart.
    for (let i = 0; i < ids.length; i++) {
      const pi = pos.get(ids[i]);
      const vi = vel.get(ids[i]);
      for (let j = i + 1; j < ids.length; j++) {
        const pj = pos.get(ids[j]);
        const vj = vel.get(ids[j]);
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { // coincident points: nudge apart deterministically
          dx = 0.5 + hash01(ids[i] + ids[j], 3);
          dy = 0.5;
          d2 = dx * dx + dy * dy;
        }
        const f = cfg.REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vi.x += fx; vi.y += fy;
        vj.x -= fx; vj.y -= fy;
      }
    }
    // Springs along edges.
    for (const [a, b] of springs) {
      const pa = pos.get(a); const pb = pos.get(b);
      const va = vel.get(a); const vb = vel.get(b);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - cfg.SPRING_LENGTH) * cfg.SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      va.x += fx; va.y += fy;
      vb.x -= fx; vb.y -= fy;
    }
    // Gravity + integrate.
    for (const id of ids) {
      const p = pos.get(id);
      const v = vel.get(id);
      v.x += -p.x * cfg.GRAVITY;
      v.y += -p.y * cfg.GRAVITY;
      v.x *= cfg.DAMPING;
      v.y *= cfg.DAMPING;
      const step = Math.sqrt(v.x * v.x + v.y * v.y);
      const clamp = step > cfg.MAX_STEP ? cfg.MAX_STEP / step : 1;
      p.x += v.x * clamp;
      p.y += v.y * clamp;
    }
  }
  return pos;
}

/** Bounding box of a set of positions, with padding. */
export function boundsOf(positions, pad = 40) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** The zoom/pan transform that fits a bounding box into a viewport. */
export function fitTransform(bounds, width, height, maxScale = 1.6) {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(maxScale, Math.min(width / bw, height / bh));
  return {
    scale,
    tx: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    ty: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

/** Node radius from degree: perceptible growth, bounded so hubs stay tidy. */
export function nodeRadius(degree) {
  return Math.min(19, 5.5 + Math.sqrt(degree || 0) * 3);
}
