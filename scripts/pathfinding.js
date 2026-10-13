/*
 * Wegfindung für NSCs
 *
 * - A* über die Rasterfelder der Szene (quadratisch, hex oder rasterlos)
 * - Wände werden über Foundrys eigenen Kollisionstest geprüft
 * - Geschlossene (nicht verschlossene) Türen gelten als passierbar: der Weg merkt sich,
 *   welche Tür unterwegs geöffnet werden muss
 * - Danach wird der Zickzack-Weg zu wenigen geraden Strecken geglättet
 *
 * Die reinen Rechenfunktionen (MinHeap, aStar, smoothPath, segmentsCross) kommen ohne
 * Foundry aus, damit man sie auch außerhalb testen kann.
 */

/* ------------------------------------------------------------------ */
/*  Reine Rechenfunktionen                                             */
/* ------------------------------------------------------------------ */

export class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item, priority) {
    const a = this.items;
    a.push({ item, priority });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.item;
  }
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Schneiden sich die Strecken a-b und c-d (echte Kreuzung, Berühren zählt mit)? */
export function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p, q, r) => Math.min(p.x, q.x) - 1e-6 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-6
    && Math.min(p.y, q.y) - 1e-6 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-6;
  if (Math.abs(d1) < 1e-6 && on(c, d, a)) return true;
  if (Math.abs(d2) < 1e-6 && on(c, d, b)) return true;
  if (Math.abs(d3) < 1e-6 && on(a, b, c)) return true;
  if (Math.abs(d4) < 1e-6 && on(a, b, d)) return true;
  return false;
}

/**
 * A*-Suche.
 * @param {object} p
 * @param {object} p.start / p.goal   Rasterfeld {i, j}
 * @param {Function} p.key            Feld → eindeutiger Schlüssel
 * @param {Function} p.neighbors      Feld → Nachbarfelder
 * @param {Function} p.center         Feld → Mittelpunkt {x, y}
 * @param {Function} p.edge           (feldA, feldB) → null (blockiert) oder {doors: []}
 * @param {Function} [p.inBounds]     Feld → liegt in der Szene?
 * @param {boolean}  [p.square]       Quadratisches Raster: Diagonalen nicht über Ecken schneiden
 * @param {number}   [p.doorPenalty]  Zusatzkosten für Türen (Pixel)
 * @param {number}   [p.maxNodes]
 * @param {Function} [p.shouldAbort]
 * @returns {Promise<Array<{o, c, doors}>|null>}
 */
export async function aStar(p) {
  const { start, goal, key, neighbors, center, edge } = p;
  const inBounds = p.inBounds ?? (() => true);
  const maxNodes = p.maxNodes ?? 20000;
  const doorPenalty = p.doorPenalty ?? 0;
  const goalKey = key(goal);
  const goalC = center(goal);
  const startKey = key(start);

  const g = new Map([[startKey, 0]]);
  const came = new Map();
  const nodes = new Map([[startKey, start]]);
  const closed = new Set();
  const heap = new MinHeap();
  heap.push(startKey, dist(center(start), goalC));

  let expanded = 0;
  let found = startKey === goalKey;
  while (!found && heap.size) {
    const k = heap.pop();
    if (closed.has(k)) continue;
    if (k === goalKey) { found = true; break; }
    closed.add(k);
    if (++expanded > maxNodes) return null;
    if (expanded % 300 === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (p.shouldAbort?.()) return null;
    }
    const cur = nodes.get(k);
    const curC = center(cur);
    for (const nb of neighbors(cur)) {
      const nk = key(nb);
      if (closed.has(nk) || !inBounds(nb)) continue;
      const e = edge(cur, nb);
      if (!e) continue;
      // Auf quadratischem Raster nicht diagonal an einer Wandecke vorbei "schneiden"
      if (p.square && nb.i !== cur.i && nb.j !== cur.j) {
        const a = edge(cur, { i: cur.i, j: nb.j });
        const b = edge(cur, { i: nb.i, j: cur.j });
        if (!a || !b || a.doors.length || b.doors.length || e.doors.length) continue;
      }
      const cost = dist(curC, center(nb)) + (e.doors.length ? doorPenalty : 0);
      const ng = g.get(k) + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, { from: k, doors: e.doors });
        nodes.set(nk, nb);
        heap.push(nk, ng + dist(center(nb), goalC));
      }
    }
  }
  if (!found) return null;

  const path = [];
  let k = goalKey;
  while (k !== undefined) {
    const step = came.get(k);
    path.push({ o: nodes.get(k), c: center(nodes.get(k)), doors: step?.doors ?? [] });
    k = step?.from;
  }
  return path.reverse();
}

/**
 * Glättet einen Feld-Weg zu geraden Strecken.
 * Türdurchgänge bleiben eigene, kurze Abschnitte, damit davor die Tür geöffnet werden kann.
 * @param {Array<{c, doors}>} nodes
 * @param {Function} clear (punktA, punktB) → true, wenn die gerade Strecke frei ist (ohne Tür)
 * @param {number} [maxLook]
 * @returns {Array<{points: Array<{x,y}>, doors: Array}>}
 */
export function smoothPath(nodes, clear, maxLook = 12) {
  const legs = [];
  if (!nodes || nodes.length < 2) return legs;
  let cur = [nodes[0].c];
  const flush = () => { if (cur.length > 1) legs.push({ points: cur, doors: [] }); };
  let i = 0;
  while (i < nodes.length - 1) {
    if (nodes[i + 1].doors.length) {
      flush();
      legs.push({ points: [nodes[i].c, nodes[i + 1].c], doors: nodes[i + 1].doors });
      cur = [nodes[i + 1].c];
      i += 1;
      continue;
    }
    let j = i + 1;
    const limit = Math.min(nodes.length - 1, i + maxLook);
    for (let k = limit; k >= i + 2; k--) {
      let doorFree = true;
      for (let m = i + 1; m <= k; m++) if (nodes[m].doors.length) { doorFree = false; break; }
      if (doorFree && clear(nodes[i].c, nodes[k].c)) { j = k; break; }
    }
    cur.push(nodes[j].c);
    i = j;
  }
  flush();
  return legs;
}

/** Kürzester Weg in einem kleinen Graphen (Dijkstra). edges: Map<id, Array<{to, cost}>> */
export function dijkstra(edges, from, to) {
  const d = new Map([[from, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(from, 0);
  const done = new Set();
  while (heap.size) {
    const u = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const { to: v, cost } of edges.get(u) ?? []) {
      const nd = d.get(u) + cost;
      if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); heap.push(v, nd); }
    }
  }
  if (!d.has(to)) return null;
  const out = [to];
  while (out[0] !== from) out.unshift(prev.get(out[0]));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Foundry-Anbindung                                                   */
/* ------------------------------------------------------------------ */

const C = () => ({
  MOVE_NONE: CONST.WALL_MOVEMENT_TYPES?.NONE ?? 0,
  DOOR_NONE: CONST.WALL_DOOR_TYPES?.NONE ?? 0,
  DOOR_SECRET: CONST.WALL_DOOR_TYPES?.SECRET ?? 2,
  DS_OPEN: CONST.WALL_DOOR_STATES?.OPEN ?? 1,
  DS_LOCKED: CONST.WALL_DOOR_STATES?.LOCKED ?? 2,
  DIR_BOTH: CONST.WALL_DIRECTIONS?.BOTH ?? 0
});

/** Rasterfelder der aktuellen Szene */
export function makeLattice() {
  const grid = canvas.grid;
  const size = grid.size;
  const rect = canvas.dimensions.sceneRect;
  const inScene = (c) => c.x >= rect.x && c.x <= rect.x + rect.width && c.y >= rect.y && c.y <= rect.y + rect.height;
  const key = (o) => `${o.i},${o.j}`;

  if (grid.isGridless) {
    const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const center = (o) => ({ x: (o.j + 0.5) * size, y: (o.i + 0.5) * size });
    return {
      size, key, center, square: true,
      offsetOf: (p) => ({ i: Math.floor(p.y / size), j: Math.floor(p.x / size) }),
      neighbors: (o) => DIRS.map(([di, dj]) => ({ i: o.i + di, j: o.j + dj })),
      inBounds: (o) => inScene(center(o))
    };
  }
  const center = (o) => grid.getCenterPoint(o);
  return {
    size, key, center,
    square: !!grid.isSquare,
    offsetOf: (p) => grid.getOffset(p),
    neighbors: (o) => grid.getAdjacentOffsets(o),
    inBounds: (o) => inScene(center(o))
  };
}

/** Alle Felder, deren Mittelpunkt in einem Rechteck liegt */
export function offsetsInRect(L, rect) {
  const out = [];
  const a = L.offsetOf({ x: rect.x, y: rect.y });
  const b = L.offsetOf({ x: rect.x + rect.width, y: rect.y + rect.height });
  for (let i = Math.min(a.i, b.i) - 1; i <= Math.max(a.i, b.i) + 1; i++) {
    for (let j = Math.min(a.j, b.j) - 1; j <= Math.max(a.j, b.j) + 1; j++) {
      const o = { i, j };
      const c = L.center(o);
      if (c.x >= rect.x && c.x <= rect.x + rect.width && c.y >= rect.y && c.y <= rect.y + rect.height) out.push(o);
    }
  }
  return out;
}

/**
 * Plant Wege für genau einen Token. Hält einen Zwischenspeicher für Wandprüfungen,
 * der verworfen wird, sobald sich an den Wänden etwas ändert.
 */
export class TokenPathfinder {
  static wallVersion = 0;

  constructor(tokenDoc, { secretDoors = false } = {}) {
    this.doc = tokenDoc;
    this.secretDoors = secretDoors;
    this.cache = new Map();
    this.version = -1;
  }

  get token() { return this.doc.object; }

  lattice() {
    if (!this._lattice || this._latticeScene !== canvas.scene?.id) {
      this._lattice = makeLattice();
      this._latticeScene = canvas.scene?.id;
    }
    return this._lattice;
  }

  /** Blockiert die gerade Strecke? Liefert null (blockiert) oder {doors: [WallDocument]} */
  testSegment(a, b) {
    if (this.version !== TokenPathfinder.wallVersion) {
      this.cache.clear();
      this.version = TokenPathfinder.wallVersion;
    }
    const k = `${Math.round(a.x)},${Math.round(a.y)}>${Math.round(b.x)},${Math.round(b.y)}`;
    if (this.cache.has(k)) return this.cache.get(k);
    const r = this._testSegment(a, b);
    if (this.cache.size > 60000) this.cache.clear();
    this.cache.set(k, r);
    return r;
  }

  _coreCollides(a, b) {
    const t = this.token;
    try {
      if (t?.checkCollision) return !!t.checkCollision(b, { origin: a, type: "move", mode: "any" });
    } catch (err) { /* fällt auf den Polygon-Test zurück */ }
    try {
      const backend = CONFIG.Canvas.polygonBackends?.move;
      return !!backend?.testCollision(a, b, { type: "move", mode: "any" });
    } catch (err) {
      return false;
    }
  }

  _testSegment(a, b) {
    if (!this._coreCollides(a, b)) return { doors: [] };
    // Foundry sagt "blockiert". Prüfen, ob es nur an geschlossenen Türen liegt.
    const K = C();
    const level = this.doc.level ?? this.doc._source?.level ?? null;
    const doors = [];
    let crossed = 0;
    for (const wall of canvas.walls?.placeables ?? []) {
      const w = wall.document;
      if (w.move === K.MOVE_NONE) continue;
      if (w.door !== K.DOOR_NONE && w.ds === K.DS_OPEN) continue;
      if (level && w.levels?.size && !w.levels.has(level)) continue;
      const [x0, y0, x1, y1] = w.c;
      if (!segmentsCross(a, b, { x: x0, y: y0 }, { x: x1, y: y1 })) continue;
      crossed++;
      const usableDoor = w.door !== K.DOOR_NONE && w.ds !== K.DS_LOCKED
        && (w.door !== K.DOOR_SECRET || this.secretDoors);
      if (!usableDoor) return null;
      doors.push(w);
    }
    if (!crossed) return null; // blockiert durch etwas, das wir nicht kennen → lieber nicht
    return { doors };
  }

  /** Strecke frei für einen Token, inkl. etwas Seitenabstand (gegen Kratzen an Wandecken) */
  clearForToken(a, b) {
    const main = this.testSegment(a, b);
    if (!main || main.doors.length) return false;
    const len = dist(a, b);
    if (len < 1) return true;
    const r = this.lattice().size * 0.3;
    const nx = -(b.y - a.y) / len * r, ny = (b.x - a.x) / len * r;
    for (const s of [1, -1]) {
      const t = this.testSegment({ x: a.x + nx * s, y: a.y + ny * s }, { x: b.x + nx * s, y: b.y + ny * s });
      if (!t || t.doors.length) return false;
    }
    return true;
  }

  /**
   * Weg von Punkt zu Punkt planen.
   * @returns {Promise<Array<{points, doors}>|null>} Abschnitte oder null, wenn kein Weg gefunden wurde
   */
  async plan(fromPoint, toPoint, { shouldAbort, maxNodes } = {}) {
    const L = this.lattice();
    const start = L.offsetOf(fromPoint);
    const goal = L.offsetOf(toPoint);
    const nodes = await aStar({
      start, goal,
      key: L.key,
      neighbors: L.neighbors,
      center: L.center,
      inBounds: L.inBounds,
      square: L.square,
      doorPenalty: L.size * 2,
      maxNodes: maxNodes ?? 25000,
      shouldAbort,
      edge: (o1, o2) => this.testSegment(L.center(o1), L.center(o2))
    });
    if (!nodes) return null;
    // Echte Startposition statt Feldmitte verwenden
    nodes[0] = { ...nodes[0], c: { x: fromPoint.x, y: fromPoint.y } };
    if (nodes.length === 1) return [];
    return smoothPath(nodes, (p, q) => this.clearForToken(p, q));
  }
}

/* ------------------------------------------------------------------ */
/*  Gezeichnete Wege (Zeichnungen vom Typ Polygon / Freihand)           */
/* ------------------------------------------------------------------ */

/** Ist die Zeichnung als Weg brauchbar? */
export function isRouteDrawing(d) {
  const s = d?.shape;
  return s?.type === "p" && Array.isArray(s.points) && s.points.length >= 4;
}

export function routeLabel(d) {
  const text = (d.text ?? "").trim();
  const n = Math.floor((d.shape?.points?.length ?? 0) / 2);
  return text ? `${text} (${n} Punkte)` : `Linie …${d.id.slice(-4)} (${n} Punkte)`;
}

/** Punkte einer Zeichnung in Szenen-Koordinaten (inkl. Drehung) */
export function routePoints(d) {
  if (!isRouteDrawing(d)) return [];
  const s = d.shape;
  const pts = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) pts.push({ x: s.points[i], y: s.points[i + 1] });
  const rot = Math.toRadians ? Math.toRadians(d.rotation ?? 0) : (d.rotation ?? 0) * Math.PI / 180;
  const cx = (s.width ?? 0) / 2, cy = (s.height ?? 0) / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let out = pts.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    return { x: d.x + cx + dx * cos - dy * sin, y: d.y + cy + dx * sin + dy * cos };
  });
  // Freihand-Linien haben sehr viele Punkte → ausdünnen
  const minGap = (canvas.grid?.size ?? 100) * 0.75;
  const thin = [out[0]];
  for (let i = 1; i < out.length; i++) {
    if (dist(out[i], thin[thin.length - 1]) >= minGap || i === out.length - 1) thin.push(out[i]);
  }
  out = thin;
  // Geschlossene Form: doppelten Endpunkt weglassen
  if (out.length > 2 && dist(out[0], out[out.length - 1]) < minGap * 0.5) out.pop();
  return out;
}

/** Wegnetz aus mehreren Zeichnungen: Punkte = Knoten, Linien = Kanten, nahe Punkte werden verbunden */
export function buildRouteGraph(drawings) {
  const verts = [];
  const edges = new Map();
  const link = (a, b) => {
    const cost = dist(verts[a], verts[b]);
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a).push({ to: b, cost });
    edges.get(b).push({ to: a, cost });
  };
  for (const d of drawings) {
    const pts = routePoints(d);
    const base = verts.length;
    pts.forEach((p) => verts.push(p));
    for (let i = 0; i + 1 < pts.length; i++) link(base + i, base + i + 1);
  }
  const near = (canvas.grid?.size ?? 100) * 1.5;
  for (let a = 0; a < verts.length; a++) {
    for (let b = a + 1; b < verts.length; b++) {
      if (dist(verts[a], verts[b]) <= near && !edges.get(a)?.some((e) => e.to === b)) link(a, b);
    }
  }
  return { verts, edges };
}
