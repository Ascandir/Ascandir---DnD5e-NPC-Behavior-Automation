/*
 * Ascandir - DnD5e NPC Behavior Automation
 *
 * NSC-Token bekommen ein Verhalten (Bedienung, Patrouille, Umherschlendern, Stehen & Reden),
 * finden selbst ihren Weg (inkl. Türen) oder nutzen vom SL gezeichnete Wege
 * und sagen dabei abwechslungsreiche Sätze in Sprechblasen.
 *
 * Gesteuert wird ausschließlich vom aktiven SL-Client. Spieler sehen nur das Ergebnis.
 */

import {
  TokenPathfinder, offsetsInRect, dist, segmentsCross, isRouteDrawing, routeLabel, routePoints, buildRouteGraph, dijkstra
} from "./pathfinding.js";
import { POOLS, DEFAULT_PHRASES, parseLines, PhraseBag } from "./phrases.js";

const MID = "ascandir-npc-behavior";
const SOCKET = `module.${MID}`;
const { ApplicationV2 } = foundry.applications.api;

/* ------------------------------------------------------------------ */
/*  Kleinkram                                                          */
/* ------------------------------------------------------------------ */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const setting = (key) => game.settings.get(MID, key);
const esc = (s) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const randRange = ([a, b]) => {
  const lo = Math.min(num(a), num(b)), hi = Math.max(num(a), num(b));
  return lo + Math.random() * (hi - lo);
};
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const isLeader = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

const ROLES = {
  server: "Bedienung (geht zu besetzten Tischen)",
  patrol: "Patrouille (läuft einen gezeichneten Weg ab)",
  wander: "Umherschlendern (in einem Bereich)",
  idle: "Stehen & Reden (bleibt stehen)"
};

const DEFAULT_CONFIG = {
  enabled: false,
  role: "server",
  speed: 3,
  autoRotate: false,
  pathing: "auto",
  routes: [],
  server: { tables: [], bar: "", tableWait: [6, 15], barWait: [4, 10], whenEmpty: "bar" },
  patrol: { route: "", mode: "loop", wait: [0, 2], longPauseChance: 15, longPause: [8, 20] },
  wander: { region: "", wait: [4, 12] },
  idle: { wait: [10, 25] },
  bubbles: {
    enabled: true,
    chance: 60,
    useDefaults: true,
    lines: { table: "", bar: "", walk: "", idle: "", patrol: "" },
    important: "",
    importantChance: 35
  }
};

function getConfig(doc) {
  const stored = doc?.getFlag?.(MID, "config") ?? {};
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_CONFIG), stored, { inplace: false, insertKeys: true });
}

async function saveConfig(doc, cfg) {
  await doc.update({ [`flags.${MID}.config`]: cfg });
}

/** Ein NSC, der gerade "beschäftigt" ist und deshalb nicht als Gast zählt */
function isBusyNpc(doc) {
  const cfg = doc?.getFlag?.(MID, "config");
  return !!cfg?.enabled && ["server", "patrol", "wander"].includes(cfg.role ?? "server");
}

function combatRunning() {
  return game.combats?.some((c) => c.started && (!c.scene || c.scene.id === canvas.scene?.id)) ?? false;
}

/** Läuft gerade gar nichts? (aus, Pause, Kampf) */
function blocked() {
  if (!setting("active")) return true;
  if (setting("pauseWithGame") && game.paused) return true;
  if (setting("stopInCombat") && combatRunning()) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Sprechblasen                                                        */
/* ------------------------------------------------------------------ */

const phraseBag = new PhraseBag();

function showBubble(tokenId, text) {
  const token = canvas.tokens?.get(tokenId);
  if (!token || !text) return;
  try {
    canvas.hud.bubbles.say(token, text, { pan: false, requireVisible: true });
  } catch (err) {
    console.warn(`${MID} | Sprechblase fehlgeschlagen`, err);
  }
}

/** Sprechblase bei allen anzeigen */
function broadcastBubble(doc, text) {
  if (!text) return;
  game.socket.emit(SOCKET, { action: "bubble", sceneId: doc.parent?.id, tokenId: doc.id, text });
  showBubble(doc.id, text);
}

/** Sätze für eine Gruppe (eigene + ggf. Standard) */
function linesFor(cfg, pool) {
  const own = parseLines(cfg.bubbles.lines?.[pool]);
  const defaults = cfg.bubbles.useDefaults || !own.length ? DEFAULT_PHRASES[pool] ?? [] : [];
  return [...own, ...defaults];
}

/** Zieht einen Satz (wichtige Sätze werden bevorzugt eingestreut) */
function drawLine(doc, cfg, pool) {
  const important = parseLines(cfg.bubbles.important);
  if (important.length && Math.random() * 100 < num(cfg.bubbles.importantChance, 35)) {
    return phraseBag.draw(`${doc.id}:important`, important);
  }
  return phraseBag.draw(`${doc.id}:${pool}`, linesFor(cfg, pool));
}

/* ------------------------------------------------------------------ */
/*  Gehirn eines NSC                                                     */
/* ------------------------------------------------------------------ */

const brains = new Map();
let routeVersion = 0;

class Brain {
  constructor(doc) {
    this.doc = doc;
    this.id = doc.id;
    this.alive = true;
    this.gen = 0;
    this.holdUntil = 0;
    this.status = "startet …";
    this.lastVisit = new Map();
    this.lastTable = null;
    this.patrolIdx = null;
    this.patrolDir = 1;
    this.target = null;
    this.cfg = getConfig(doc);
    this.pf = new TokenPathfinder(doc, { secretDoors: setting("secretDoors") });
  }

  /* --- Steuerung --- */

  stop() {
    this.alive = false;
    this.gen++;
    this._stopMovement();
    clearDebug(this.id);
  }

  interrupt(holdMs = 0) {
    this.gen++;
    this.holdUntil = Math.max(this.holdUntil, Date.now() + holdMs);
    this._stopMovement();
    clearDebug(this.id);
  }

  _stopMovement() {
    try { this.doc.stopMovement?.(); } catch (err) { /* egal */ }
  }

  ok(gen) {
    return this.alive && gen === this.gen && canvas.scene?.tokens.get(this.id) === this.doc;
  }

  async run() {
    while (this.alive) {
      if (blocked() || Date.now() < this.holdUntil || !this.doc.object) {
        if (blocked()) this.status = game.paused ? "pausiert (Spielpause)" : combatRunning() ? "pausiert (Kampf)" : "ausgeschaltet";
        await delay(500);
        continue;
      }
      const gen = this.gen;
      try {
        await this.step(gen);
      } catch (err) {
        console.error(`${MID} | Fehler bei ${this.doc.name}`, err);
        this.status = `Fehler: ${err?.message ?? err}`;
        await delay(3000);
      }
      await delay(100);
    }
  }

  /** Warten; während Spielpause/Kampf läuft die Zeit nicht weiter */
  async sleep(ms, gen) {
    let left = ms;
    while (left > 0) {
      if (!this.ok(gen)) return false;
      await delay(Math.min(250, left));
      if (!blocked()) left -= 250;
    }
    return this.ok(gen);
  }

  wait(range, gen) {
    return this.sleep(randRange(range) * 1000, gen);
  }

  say(pool, { chanceFactor = 1 } = {}) {
    const b = this.cfg.bubbles;
    if (!b.enabled) return;
    if (Math.random() * 100 >= num(b.chance, 60) * chanceFactor) return;
    broadcastBubble(this.doc, drawLine(this.doc, this.cfg, pool));
  }

  /* --- Position & Felder --- */

  center() {
    const t = this.doc.object;
    if (t?.center) return { x: t.center.x, y: t.center.y };
    const s = canvas.grid.size;
    return { x: this.doc.x + (this.doc.width * s) / 2, y: this.doc.y + (this.doc.height * s) / 2 };
  }

  elevation() { return this.doc.elevation ?? 0; }

  inRegion(region) {
    try { return region.testPoint({ ...this.center(), elevation: this.elevation() }); } catch (err) { return false; }
  }

  /** Felder, auf denen schon jemand steht (oder die ein anderer NSC gerade ansteuert) */
  occupiedKeys() {
    const L = this.pf.lattice();
    const keys = new Set();
    for (const t of canvas.tokens.placeables) {
      if (t.document === this.doc) continue;
      const r = { x: t.x + 2, y: t.y + 2, width: Math.max(1, t.w - 4), height: Math.max(1, t.h - 4) };
      for (const o of offsetsInRect(L, r)) keys.add(L.key(o));
    }
    for (const b of brains.values()) if (b !== this && b.target) keys.add(L.key(L.offsetOf(b.target)));
    return keys;
  }

  regionCells(region, { ring = false } = {}) {
    const L = this.pf.lattice();
    const s = L.size;
    const b = region.bounds;
    const rect = ring ? { x: b.x - s, y: b.y - s, width: b.width + 2 * s, height: b.height + 2 * s } : b;
    const elevation = this.elevation();
    return offsetsInRect(L, rect).filter((o) => {
      if (!L.inBounds(o)) return false;
      let inside = false;
      try { inside = region.testPoint({ ...L.center(o), elevation }); } catch (err) { inside = false; }
      return ring ? !inside : inside;
    });
  }

  guestsIn(region) {
    let docs = [];
    try { docs = [...(region.tokens ?? [])]; } catch (err) { docs = []; }
    if (!docs.length && !region.tokens) {
      docs = canvas.scene.tokens.filter((d) => {
        const t = d.object;
        return t && region.testPoint({ ...t.center, elevation: d.elevation ?? 0 });
      });
    }
    return docs.filter((d) => d !== this.doc && !d.hidden && !isBusyNpc(d));
  }

  /* --- Wege --- */

  routeGraph() {
    if (this._graph && this._graphVersion === routeVersion) return this._graph;
    const drawings = (this.cfg.routes ?? []).map((id) => canvas.scene.drawings.get(id)).filter(isRouteDrawing);
    this._graph = drawings.length ? buildRouteGraph(drawings) : null;
    this._graphVersion = routeVersion;
    return this._graph;
  }

  /** Über gezeichnete Wege: Liste von Zwischenpunkten (oder null = direkt gehen) */
  viaRoutes(from, to) {
    const g = this.routeGraph();
    if (!g || g.verts.length < 2) return null;
    let entry = 0, exit = 0;
    g.verts.forEach((v, i) => {
      if (dist(v, from) < dist(g.verts[entry], from)) entry = i;
      if (dist(v, to) < dist(g.verts[exit], to)) exit = i;
    });
    if (entry === exit) return null;
    const direct = dist(from, to);
    if (direct <= dist(from, g.verts[entry]) + dist(g.verts[exit], to)) return null;
    const ids = dijkstra(g.edges, entry, exit);
    return ids ? ids.map((i) => g.verts[i]) : null;
  }

  async planTo(target, gen) {
    const from = this.center();
    const shouldAbort = () => !this.ok(gen);
    if (this.cfg.pathing === "routes") {
      const via = this.viaRoutes(from, target);
      if (via) {
        const anchors = [from, ...via, target];
        const legs = [];
        let failed = false;
        for (let i = 0; i + 1 < anchors.length; i++) {
          const part = await this.pf.plan(anchors[i], anchors[i + 1], { shouldAbort });
          if (!part) { failed = true; break; }
          legs.push(...part);
        }
        if (!failed) return legs;
      }
    }
    return this.pf.plan(from, target, { shouldAbort });
  }

  /** Geht zu einem Punkt. Gibt true zurück, wenn er angekommen ist. */
  async goTo(target, gen) {
    this.target = target;
    try {
      const legs = await this.planTo(target, gen);
      if (!legs || !this.ok(gen)) return false;
      if (!legs.length) return true;
      drawDebug(this.id, legs);
      if (this.cfg.role === "server" && Math.random() < 0.25) this.say("walk", { chanceFactor: 0.6 });
      return await this.walk(legs, gen);
    } finally {
      this.target = null;
      clearDebug(this.id);
    }
  }

  async walk(legs, gen) {
    let pts = [];
    const flush = async () => {
      if (!pts.length) return true;
      const p = pts;
      pts = [];
      return this.moveAlong(p, gen);
    };
    for (const leg of legs) {
      if (!this.ok(gen)) return false;
      if (leg.doors.length) {
        if (!(await flush())) return false;
        const opened = await openDoors(leg.doors);
        if (!this.ok(gen)) return false;
        const ok = await this.moveAlong(leg.points.slice(1), gen);
        opened.forEach((w) => closeDoorLater(w));
        if (!ok) return false;
      } else {
        pts.push(...leg.points.slice(1));
      }
    }
    return flush();
  }

  async moveAlong(points, gen) {
    const t = this.doc.object;
    if (!t || !points.length || !this.ok(gen)) return false;
    // Falls inzwischen jemand eine Tür auf dem Weg geschlossen hat: wieder öffnen
    const closedOnWay = closedDoorsAlong([this.center(), ...points]);
    if (closedOnWay.length) {
      const opened = await openDoors(closedOnWay);
      opened.forEach((w) => closeDoorLater(w));
      if (!this.ok(gen)) return false;
    }
    const waypoints = points.map((p) => ({ x: Math.round(p.x - t.w / 2), y: Math.round(p.y - t.h / 2) }));
    let result = false;
    try {
      result = await this.doc.move(waypoints, {
        autoRotate: !!this.cfg.autoRotate,
        showRuler: false,
        pan: false,
        animation: { movementSpeed: Math.max(0.5, num(this.cfg.speed, 3)) },
        constrainOptions: { ignoreWalls: true, ignoreCost: true }
      });
    } catch (err) {
      console.warn(`${MID} | Bewegung von ${this.doc.name} fehlgeschlagen`, err);
      return false;
    }
    try { await (this.doc.object?.movementAnimationPromise ?? null); } catch (err) { /* abgebrochen */ }
    return result !== false && this.ok(gen);
  }

  /** Freies Feld in (oder direkt an) einer Region suchen und hingehen */
  async goToRegion(region, gen, { nearGuests = false } = {}) {
    const L = this.pf.lattice();
    const occupied = this.occupiedKeys();
    let cells = this.regionCells(region).filter((o) => !occupied.has(L.key(o)));
    if (nearGuests) cells.push(...this.regionCells(region, { ring: true }).filter((o) => !occupied.has(L.key(o))));
    if (!cells.length) cells = this.regionCells(region, { ring: true }).filter((o) => !occupied.has(L.key(o)));
    if (!cells.length) return false;

    let scored;
    if (nearGuests) {
      const guests = this.guestsIn(region).map((d) => d.object?.center).filter(Boolean);
      scored = cells.map((o) => {
        const c = L.center(o);
        const near = guests.length ? Math.min(...guests.map((g) => dist(g, c))) : 0;
        return { o, score: near + Math.random() * L.size * 0.6 };
      });
    } else {
      scored = cells.map((o) => ({ o, score: Math.random() }));
    }
    scored.sort((a, b) => a.score - b.score);
    for (const { o } of scored.slice(0, 3)) {
      if (!this.ok(gen)) return false;
      if (await this.goTo(L.center(o), gen)) return true;
    }
    return false;
  }

  /** Zu einem Punkt gehen; ist das Feld besetzt, ein freies Nachbarfeld nehmen */
  async goToPoint(point, gen) {
    const L = this.pf.lattice();
    const occupied = this.occupiedKeys();
    let o = L.offsetOf(point);
    if (occupied.has(L.key(o))) {
      const free = L.neighbors(o).filter((n) => L.inBounds(n) && !occupied.has(L.key(n)));
      if (!free.length) return false;
      o = pickRandom(free);
    }
    return this.goTo(L.center(o), gen);
  }

  /* --- Verhalten --- */

  async step(gen) {
    switch (this.cfg.role) {
      case "patrol": return this.stepPatrol(gen);
      case "wander": return this.stepWander(gen);
      case "idle": return this.stepIdle(gen);
      default: return this.stepServer(gen);
    }
  }

  async stepServer(gen) {
    const s = this.cfg.server;
    const regions = canvas.scene.regions;
    const tables = (s.tables ?? []).map((id) => regions.get(id)).filter(Boolean);
    const bar = regions.get(s.bar) ?? null;
    if (!tables.length && !bar) {
      this.status = "keine Tische/Theke eingestellt";
      return this.sleep(5000, gen);
    }

    const occupied = tables.filter((r) => this.guestsIn(r).length);
    if (!occupied.length) {
      if (bar && s.whenEmpty !== "stay") {
        if (s.whenEmpty === "wander" || !this.inRegion(bar)) {
          this.status = "geht zur Theke";
          await this.goToRegion(bar, gen);
        }
      }
      this.status = "wartet (alle Tische leer)";
      this.say("idle", { chanceFactor: 0.5 });
      return this.wait(s.barWait, gen);
    }

    // Tisch wählen: am längsten nicht besucht, möglichst nicht derselbe wie eben
    const now = Date.now();
    let choices = occupied;
    if (choices.length > 1) choices = choices.filter((r) => r.id !== this.lastTable);
    const table = choices
      .map((r) => ({ r, score: (now - (this.lastVisit.get(r.id) ?? 0)) * (0.7 + Math.random() * 0.6) }))
      .sort((a, b) => b.score - a.score)[0].r;

    this.status = `geht zu ${table.name}`;
    const arrived = await this.goToRegion(table, gen, { nearGuests: true });
    this.lastVisit.set(table.id, Date.now());
    this.lastTable = table.id;
    if (!arrived) {
      this.status = `kommt nicht zu ${table.name}`;
      return this.sleep(2000, gen);
    }
    this.status = `bedient ${table.name}`;
    this.say("table");
    if (!(await this.wait(s.tableWait, gen))) return;

    // Danach meistens zur Theke, manchmal direkt zum nächsten Tisch
    if (bar && (occupied.length < 2 || Math.random() < 0.7)) {
      this.status = "geht zur Theke";
      if (await this.goToRegion(bar, gen)) {
        this.status = "an der Theke";
        this.say("bar");
        await this.wait(s.barWait, gen);
      }
    }
  }

  async stepPatrol(gen) {
    const p = this.cfg.patrol;
    const drawing = canvas.scene.drawings.get(p.route);
    const pts = drawing ? routePoints(drawing) : [];
    if (pts.length < 2) {
      this.status = "kein Weg eingestellt";
      return this.sleep(5000, gen);
    }
    if (this.patrolIdx == null || this.patrolIdx >= pts.length) {
      const here = this.center();
      this.patrolIdx = pts.reduce((best, pt, i) => (dist(pt, here) < dist(pts[best], here) ? i : best), 0);
      this.patrolDir = 1;
    }
    this.status = `Patrouille: Punkt ${this.patrolIdx + 1} von ${pts.length}`;
    const arrived = await this.goToPoint(pts[this.patrolIdx], gen);
    if (!this.ok(gen)) return;
    if (!arrived) await this.sleep(1500, gen);

    if (Math.random() * 100 < num(p.longPauseChance, 15)) {
      this.status = "Patrouille: hält inne";
      this.say("patrol");
      if (!(await this.wait(p.longPause, gen))) return;
    } else if (!(await this.wait(p.wait, gen))) return;

    // Nächster Punkt
    const n = pts.length;
    if (p.mode === "pingpong") {
      if (this.patrolIdx + this.patrolDir >= n || this.patrolIdx + this.patrolDir < 0) this.patrolDir *= -1;
      this.patrolIdx += this.patrolDir;
    } else {
      this.patrolIdx = (this.patrolIdx + 1) % n;
    }
  }

  async stepWander(gen) {
    const region = canvas.scene.regions.get(this.cfg.wander.region);
    if (!region) {
      this.status = "kein Bereich eingestellt";
      return this.sleep(5000, gen);
    }
    this.status = `schlendert durch ${region.name}`;
    await this.goToRegion(region, gen);
    if (!this.ok(gen)) return;
    this.status = `steht in ${region.name}`;
    this.say("idle", { chanceFactor: 0.7 });
    await this.wait(this.cfg.wander.wait, gen);
  }

  async stepIdle(gen) {
    this.status = "steht & redet";
    if (!(await this.wait(this.cfg.idle.wait, gen))) return;
    this.say("idle");
  }
}

/* ------------------------------------------------------------------ */
/*  Türen                                                               */
/* ------------------------------------------------------------------ */

/** Geschlossene, benutzbare Türen, die eine Punktfolge kreuzt */
function closedDoorsAlong(points) {
  const K = CONST;
  const OPEN = K.WALL_DOOR_STATES?.OPEN ?? 1, LOCKED = K.WALL_DOOR_STATES?.LOCKED ?? 2;
  const NONE = K.WALL_DOOR_TYPES?.NONE ?? 0, SECRET = K.WALL_DOOR_TYPES?.SECRET ?? 2;
  const out = [];
  for (const wall of canvas.walls?.placeables ?? []) {
    const w = wall.document;
    if (w.door === NONE || w.ds === OPEN || w.ds === LOCKED) continue;
    if (w.door === SECRET && !setting("secretDoors")) continue;
    const a = { x: w.c[0], y: w.c[1] }, b = { x: w.c[2], y: w.c[3] };
    for (let i = 0; i + 1 < points.length; i++) {
      if (segmentsCross(points[i], points[i + 1], a, b)) { out.push(w); break; }
    }
  }
  return out;
}

async function openDoors(walls) {
  const OPEN = CONST.WALL_DOOR_STATES?.OPEN ?? 1;
  const opened = [];
  for (const w of walls) {
    if (!w || w.ds === OPEN) continue;
    try {
      await w.update({ ds: OPEN });
      opened.push(w);
    } catch (err) {
      console.warn(`${MID} | Tür konnte nicht geöffnet werden`, err);
    }
  }
  if (opened.length) await delay(350);
  return opened;
}

function closeDoorLater(wall) {
  if (!setting("closeDoors")) return;
  const OPEN = CONST.WALL_DOOR_STATES?.OPEN ?? 1;
  const CLOSED = CONST.WALL_DOOR_STATES?.CLOSED ?? 0;
  const [x0, y0, x1, y1] = wall.c;
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  (async () => {
    await delay(800);
    for (let i = 0; i < 40; i++) {
      if (!wall.parent?.walls?.get(wall.id) || wall.ds !== OPEN) return;
      const range = (canvas.grid?.size ?? 100) * 0.9;
      const someoneThere = canvas.tokens?.placeables.some((t) => dist(t.center, mid) < range);
      if (!someoneThere) {
        try { await wall.update({ ds: CLOSED }); } catch (err) { /* egal */ }
        return;
      }
      await delay(500);
    }
  })();
}

/* ------------------------------------------------------------------ */
/*  Pfad-Anzeige für den SL (zur Fehlersuche)                           */
/* ------------------------------------------------------------------ */

const debugGraphics = new Map();

function drawDebug(id, legs) {
  clearDebug(id);
  if (!setting("debugPaths") || !legs?.length) return;
  const layer = canvas.controls ?? canvas.interface;
  if (!layer || typeof PIXI === "undefined") return;
  const g = new PIXI.Graphics();
  g.lineStyle(4, 0xffaa00, 0.8);
  for (const leg of legs) {
    g.lineStyle(4, leg.doors.length ? 0x33ccff : 0xffaa00, 0.85);
    g.moveTo(leg.points[0].x, leg.points[0].y);
    for (const p of leg.points.slice(1)) g.lineTo(p.x, p.y);
  }
  layer.addChild(g);
  debugGraphics.set(id, g);
}

function clearDebug(id) {
  const g = debugGraphics.get(id);
  if (!g) return;
  debugGraphics.delete(id);
  try { g.destroy(); } catch (err) { /* egal */ }
}

/* ------------------------------------------------------------------ */
/*  Verwaltung der Gehirne                                               */
/* ------------------------------------------------------------------ */

function stopAll() {
  for (const b of brains.values()) b.stop();
  brains.clear();
}

function syncBrains() {
  if (!isLeader() || !canvas?.ready || !canvas.scene) return stopAll();
  const scene = canvas.scene;
  const wanted = new Set(scene.tokens.filter((d) => getConfig(d).enabled).map((d) => d.id));
  for (const [id, b] of brains) {
    if (!wanted.has(id) || scene.tokens.get(id) !== b.doc) {
      b.stop();
      brains.delete(id);
    }
  }
  for (const id of wanted) {
    if (brains.has(id)) continue;
    const b = new Brain(scene.tokens.get(id));
    brains.set(id, b);
    b.run();
  }
}

function restartBrain(id) {
  const b = brains.get(id);
  if (b) { b.stop(); brains.delete(id); }
  syncBrains();
}

/* ------------------------------------------------------------------ */
/*  Einstellungsfenster pro NSC                                          */
/* ------------------------------------------------------------------ */

function regionOptions(selected) {
  const list = canvas.scene?.regions?.contents ?? [];
  return `<option value="">– keine –</option>` + list
    .map((r) => `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${esc(r.name)}</option>`).join("");
}

function routeDrawings() {
  return (canvas.scene?.drawings?.contents ?? []).filter(isRouteDrawing);
}

class BehaviorConfig extends ApplicationV2 {
  constructor(tokenDoc, options = {}) {
    super({ id: `${MID}-config-${tokenDoc.id}`, ...options });
    this.doc = tokenDoc;
    this.cfg = getConfig(tokenDoc);
  }

  static DEFAULT_OPTIONS = {
    classes: ["ascandir-npcb", "ascandir-npcb-config"],
    window: { title: "NSC-Verhalten", icon: "fa-solid fa-person-walking", resizable: true },
    position: { width: 560, height: 720 },
    actions: {
      save: BehaviorConfig._onSave,
      testBubble: BehaviorConfig._onTest,
      sayNow: BehaviorConfig._onSayNow
    }
  };

  get title() { return `NSC-Verhalten: ${this.doc.name}`; }

  async _renderHTML() {
    const c = this.cfg;
    const regions = canvas.scene?.regions?.contents ?? [];
    const routes = routeDrawings();
    const range = (name, val, step = 1) => `
      <span class="npcb-range">
        <input type="number" name="${name}-0" value="${num(val?.[0])}" min="0" step="${step}"> bis
        <input type="number" name="${name}-1" value="${num(val?.[1])}" min="0" step="${step}"> Sek.
      </span>`;
    const tableChecks = regions.length
      ? regions.map((r) => `<label class="npcb-check"><input type="checkbox" name="table" value="${r.id}" ${c.server.tables.includes(r.id) ? "checked" : ""}> ${esc(r.name)}</label>`).join("")
      : `<p class="npcb-hint warn">Diese Szene hat noch keine Regionen. Zeichne mit dem Regionen-Werkzeug (links) einen Bereich um jeden Tisch und einen um die Theke und gib ihnen Namen wie „Tisch 1“ oder „Theke“.</p>`;
    const routeChecks = routes.length
      ? routes.map((d) => `<label class="npcb-check"><input type="checkbox" name="route" value="${d.id}" ${c.routes.includes(d.id) ? "checked" : ""}> ${esc(routeLabel(d))}</label>`).join("")
      : `<p class="npcb-hint">Noch keine Wege gezeichnet (Zeichnen-Werkzeug → Polygon oder Freihand).</p>`;
    const routeSelect = `<option value="">– kein Weg –</option>` + routes
      .map((d) => `<option value="${d.id}" ${d.id === c.patrol.route ? "selected" : ""}>${esc(routeLabel(d))}</option>`).join("");
    const lineFields = Object.entries(POOLS).map(([k, label]) => `
      <div class="form-group stacked">
        <label>${label}</label>
        <textarea name="lines-${k}" rows="3" placeholder="${esc((DEFAULT_PHRASES[k] ?? []).slice(0, 3).join("\n"))}\n…">${esc(c.bubbles.lines?.[k] ?? "")}</textarea>
      </div>`).join("");

    return `
      <form class="npcb-form" autocomplete="off">
        <fieldset>
          <legend>Allgemein</legend>
          <div class="form-group"><label>Verhalten aktiv</label><input type="checkbox" name="enabled" ${c.enabled ? "checked" : ""}></div>
          <div class="form-group"><label>Verhalten</label>
            <select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === c.role ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="form-group"><label>Tempo (Felder pro Sekunde)</label><input type="number" name="speed" value="${num(c.speed, 3)}" min="0.5" max="20" step="0.5"></div>
          <div class="form-group"><label>In Laufrichtung drehen</label><input type="checkbox" name="autoRotate" ${c.autoRotate ? "checked" : ""}></div>
          <div class="form-group"><label>Wegfindung</label>
            <select name="pathing">
              <option value="auto" ${c.pathing === "auto" ? "selected" : ""}>Automatisch (sucht Türen & Durchgänge selbst)</option>
              <option value="routes" ${c.pathing === "routes" ? "selected" : ""}>Bevorzugt über gezeichnete Wege</option>
            </select></div>
          <div class="npcb-sub" data-show-pathing="routes">
            <p class="npcb-hint">Diese Wege nutzt der NSC wie Gänge. Den Rest findet er automatisch.</p>
            ${routeChecks}
          </div>
        </fieldset>

        <fieldset data-role="server">
          <legend>Bedienung</legend>
          <div class="form-group stacked"><label>Tische (Regionen)</label><div class="npcb-checklist">${tableChecks}</div></div>
          <div class="form-group"><label>Theke (Region)</label><select name="bar">${regionOptions(c.server.bar)}</select></div>
          <div class="form-group"><label>Wartezeit am Tisch</label>${range("tableWait", c.server.tableWait)}</div>
          <div class="form-group"><label>Wartezeit an der Theke</label>${range("barWait", c.server.barWait)}</div>
          <div class="form-group"><label>Wenn alle Tische leer sind</label>
            <select name="whenEmpty">
              <option value="bar" ${c.server.whenEmpty === "bar" ? "selected" : ""}>an der Theke warten</option>
              <option value="wander" ${c.server.whenEmpty === "wander" ? "selected" : ""}>an der Theke hin und her gehen</option>
              <option value="stay" ${c.server.whenEmpty === "stay" ? "selected" : ""}>stehen bleiben</option>
            </select></div>
          <p class="npcb-hint">Ein Tisch gilt als besetzt, sobald ein sichtbarer Token in seiner Region steht (Spieler oder Gäste-NSCs). Andere laufende NSCs zählen nicht als Gäste.</p>
        </fieldset>

        <fieldset data-role="patrol">
          <legend>Patrouille</legend>
          <div class="form-group"><label>Weg</label><select name="patrolRoute">${routeSelect}</select></div>
          <div class="form-group"><label>Ablauf</label>
            <select name="patrolMode">
              <option value="loop" ${c.patrol.mode === "loop" ? "selected" : ""}>Rundgang (am Ende wieder zum Anfang)</option>
              <option value="pingpong" ${c.patrol.mode === "pingpong" ? "selected" : ""}>Hin und zurück</option>
            </select></div>
          <div class="form-group"><label>Wartezeit an jedem Punkt</label>${range("patrolWait", c.patrol.wait)}</div>
          <div class="form-group"><label>Chance auf längere Pause (%)</label><input type="number" name="longPauseChance" value="${num(c.patrol.longPauseChance, 15)}" min="0" max="100"></div>
          <div class="form-group"><label>Längere Pause</label>${range("longPause", c.patrol.longPause)}</div>
        </fieldset>

        <fieldset data-role="wander">
          <legend>Umherschlendern</legend>
          <div class="form-group"><label>Bereich (Region)</label><select name="wanderRegion">${regionOptions(c.wander.region)}</select></div>
          <div class="form-group"><label>Wartezeit zwischen den Wegen</label>${range("wanderWait", c.wander.wait)}</div>
        </fieldset>

        <fieldset data-role="idle">
          <legend>Stehen & Reden</legend>
          <div class="form-group"><label>Abstand zwischen den Sätzen</label>${range("idleWait", c.idle.wait)}</div>
        </fieldset>

        <fieldset>
          <legend>Sprechblasen</legend>
          <div class="form-group"><label>Sprechblasen aktiv</label><input type="checkbox" name="bubblesEnabled" ${c.bubbles.enabled ? "checked" : ""}></div>
          <div class="form-group"><label>Chance pro Gelegenheit (%)</label><input type="number" name="bubbleChance" value="${num(c.bubbles.chance, 60)}" min="0" max="100"></div>
          <div class="form-group"><label>Standardsätze mitverwenden</label><input type="checkbox" name="useDefaults" ${c.bubbles.useDefaults ? "checked" : ""}></div>
          <p class="npcb-hint">Eigene Sätze: einer pro Zeile. Sätze wiederholen sich erst, wenn alle einmal dran waren.</p>
          ${lineFields}
          <div class="form-group stacked">
            <label>Wichtige Sätze <small>(Gerüchte, Hinweise – werden bevorzugt eingestreut, egal wo der NSC gerade ist)</small></label>
            <textarea name="important" rows="3" placeholder="Habt ihr von den Lichtern im alten Turm gehört?">${esc(c.bubbles.important)}</textarea>
          </div>
          <div class="form-group"><label>Anteil wichtiger Sätze (%)</label><input type="number" name="importantChance" value="${num(c.bubbles.importantChance, 35)}" min="0" max="100"></div>
          <div class="form-group npcb-saynow">
            <input type="text" name="sayNowText" placeholder="Satz sofort sagen lassen …">
            <button type="button" data-action="sayNow"><i class="fa-solid fa-comment"></i> Sagen</button>
          </div>
        </fieldset>

        <footer class="npcb-footer">
          <button type="button" data-action="testBubble"><i class="fa-solid fa-comment-dots"></i> Test-Sprechblase</button>
          <button type="button" data-action="save" class="npcb-primary"><i class="fa-solid fa-floppy-disk"></i> Speichern</button>
        </footer>
      </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    const update = () => {
      const role = root.querySelector("[name=role]")?.value;
      root.querySelectorAll("fieldset[data-role]").forEach((f) => { f.hidden = f.dataset.role !== role; });
      const pathing = root.querySelector("[name=pathing]")?.value;
      root.querySelectorAll("[data-show-pathing]").forEach((el) => { el.hidden = el.dataset.showPathing !== pathing; });
    };
    root.querySelector("[name=role]")?.addEventListener("change", update);
    root.querySelector("[name=pathing]")?.addEventListener("change", update);
    root.querySelector("form")?.addEventListener("submit", (e) => e.preventDefault());
    root.querySelector("[name=sayNowText]")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); BehaviorConfig._onSayNow.call(this); }
    });
    update();
  }

  _readForm() {
    const f = this.element;
    const val = (n) => f.querySelector(`[name="${n}"]`)?.value ?? "";
    const chk = (n) => !!f.querySelector(`[name="${n}"]`)?.checked;
    const rng = (n) => [num(val(`${n}-0`)), num(val(`${n}-1`))];
    const all = (n) => [...f.querySelectorAll(`[name="${n}"]:checked`)].map((el) => el.value);
    const c = this.cfg;
    c.enabled = chk("enabled");
    c.role = val("role") || "server";
    c.speed = Math.max(0.5, num(val("speed"), 3));
    c.autoRotate = chk("autoRotate");
    c.pathing = val("pathing") || "auto";
    c.routes = all("route");
    c.server.tables = all("table");
    c.server.bar = val("bar");
    c.server.tableWait = rng("tableWait");
    c.server.barWait = rng("barWait");
    c.server.whenEmpty = val("whenEmpty") || "bar";
    c.patrol.route = val("patrolRoute");
    c.patrol.mode = val("patrolMode") || "loop";
    c.patrol.wait = rng("patrolWait");
    c.patrol.longPauseChance = num(val("longPauseChance"), 15);
    c.patrol.longPause = rng("longPause");
    c.wander.region = val("wanderRegion");
    c.wander.wait = rng("wanderWait");
    c.idle.wait = rng("idleWait");
    c.bubbles.enabled = chk("bubblesEnabled");
    c.bubbles.chance = num(val("bubbleChance"), 60);
    c.bubbles.useDefaults = chk("useDefaults");
    for (const k of Object.keys(POOLS)) c.bubbles.lines[k] = val(`lines-${k}`);
    c.bubbles.important = val("important");
    c.bubbles.importantChance = num(val("importantChance"), 35);
    return c;
  }

  static async _onSave() {
    const cfg = this._readForm();
    await saveConfig(this.doc, cfg);
    phraseBag.clear(`${this.doc.id}:`);
    ui.notifications.info(`NSC-Verhalten für ${this.doc.name} gespeichert.`);
    this.close();
  }

  static _onTest() {
    const cfg = this._readForm();
    const pool = { server: "table", patrol: "patrol" }[cfg.role] ?? "idle";
    broadcastBubble(this.doc, drawLine(this.doc, cfg, pool));
  }

  static _onSayNow() {
    const input = this.element.querySelector("[name=sayNowText]");
    const text = input?.value?.trim();
    if (!text) return;
    broadcastBubble(this.doc, text);
    input.value = "";
  }
}

/* ------------------------------------------------------------------ */
/*  Übersicht aller NSCs der Szene                                       */
/* ------------------------------------------------------------------ */

class BehaviorOverview extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MID}-overview`,
    classes: ["ascandir-npcb", "ascandir-npcb-overview"],
    window: { title: "NSC-Verhalten: Übersicht", icon: "fa-solid fa-people-arrows", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      edit: BehaviorOverview._onEdit,
      toggle: BehaviorOverview._onToggle,
      pan: BehaviorOverview._onPan,
      master: BehaviorOverview._onMaster
    }
  };

  async _renderHTML() {
    const docs = (canvas.scene?.tokens?.contents ?? []).filter((d) => d.getFlag(MID, "config"));
    const active = setting("active");
    const rows = docs.map((d) => {
      const c = getConfig(d);
      const b = brains.get(d.id);
      const status = !c.enabled ? "aus" : !isLeader() ? "läuft beim aktiven SL" : b?.status ?? "startet …";
      return `
        <tr>
          <td><img src="${esc(d.texture?.src)}" alt=""></td>
          <td><a data-action="pan" data-id="${d.id}">${esc(d.name)}</a><br><small>${esc(ROLES[c.role]?.split(" (")[0] ?? c.role)}</small></td>
          <td class="npcb-status">${esc(status)}</td>
          <td class="npcb-buttons">
            <button type="button" data-action="toggle" data-id="${d.id}" title="${c.enabled ? "Anhalten" : "Starten"}"><i class="fa-solid ${c.enabled ? "fa-pause" : "fa-play"}"></i></button>
            <button type="button" data-action="edit" data-id="${d.id}" title="Einstellen"><i class="fa-solid fa-gear"></i></button>
          </td>
        </tr>`;
    }).join("");
    return `
      <div class="npcb-overview">
        <div class="npcb-master">
          <span>Belebung in dieser Welt: <strong>${active ? "an" : "aus"}</strong></span>
          <button type="button" data-action="master"><i class="fa-solid ${active ? "fa-stop" : "fa-play"}"></i> ${active ? "Alles anhalten" : "Alles starten"}</button>
        </div>
        ${rows ? `<table><tbody>${rows}</tbody></table>` : `<p class="npcb-hint">In dieser Szene hat noch kein NSC ein Verhalten. Rechtsklick auf einen Token → Knopf <i class="fa-solid fa-person-walking"></i>.</p>`}
      </div>`;
  }

  _replaceHTML(result, content) { content.innerHTML = result; }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this._timer) this._timer = setInterval(() => { if (this.rendered) this.render(); }, 2000);
  }

  async close(options) {
    clearInterval(this._timer);
    this._timer = null;
    return super.close(options);
  }

  static _onEdit(event, target) {
    const doc = canvas.scene?.tokens.get(target.dataset.id);
    if (doc) new BehaviorConfig(doc).render(true);
  }

  static async _onToggle(event, target) {
    const doc = canvas.scene?.tokens.get(target.dataset.id);
    if (!doc) return;
    const cfg = getConfig(doc);
    cfg.enabled = !cfg.enabled;
    await saveConfig(doc, cfg);
    this.render();
  }

  static _onPan(event, target) {
    const t = canvas.tokens.get(target.dataset.id);
    if (t) { canvas.animatePan({ x: t.center.x, y: t.center.y }); t.control({ releaseOthers: true }); }
  }

  static async _onMaster() {
    await game.settings.set(MID, "active", !setting("active"));
    this.render();
  }
}

function openConfig(doc) {
  new BehaviorConfig(doc).render(true);
}

function openOverview() {
  const existing = foundry.applications.instances?.get(`${MID}-overview`);
  if (existing) return existing.render(true);
  new BehaviorOverview().render(true);
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                               */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MID, key, { scope: "world", config: true, ...data });
  reg("active", {
    name: "Belebung aktiv",
    hint: "Hauptschalter für alle NSC-Verhalten. Auch über den Knopf in der Token-Leiste umschaltbar.",
    type: Boolean, default: true,
    onChange: (v) => { if (!v) for (const b of brains.values()) b.interrupt(); }
  });
  reg("pauseWithGame", {
    name: "Bei Spielpause anhalten",
    hint: "NSCs bleiben stehen, solange das Spiel pausiert ist.",
    type: Boolean, default: true
  });
  reg("stopInCombat", {
    name: "Im Kampf anhalten",
    hint: "Sobald in der Szene ein Kampf läuft, bleiben alle NSCs stehen.",
    type: Boolean, default: true
  });
  reg("closeDoors", {
    name: "Türen hinter sich schließen",
    hint: "Türen, die ein NSC geöffnet hat, schließt er wieder, sobald niemand mehr im Durchgang steht.",
    type: Boolean, default: true
  });
  reg("secretDoors", {
    name: "NSCs benutzen Geheimtüren",
    hint: "Verschlossene Türen benutzen NSCs nie.",
    type: Boolean, default: false,
    onChange: () => { for (const id of [...brains.keys()]) restartBrain(id); }
  });
  reg("debugPaths", {
    name: "Geplante Wege anzeigen (nur SL)",
    hint: "Zeichnet den geplanten Weg jedes NSC als orange Linie (Türdurchgänge blau). Hilfreich beim Einrichten.",
    type: Boolean, default: false
  });
  game.settings.registerMenu(MID, "overview", {
    name: "Übersicht",
    label: "NSC-Übersicht öffnen",
    hint: "Alle NSCs mit Verhalten in der aktuellen Szene.",
    icon: "fa-solid fa-people-arrows",
    type: class extends ApplicationV2 {
      render() { openOverview(); return this; }
    },
    restricted: true
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, (data) => {
    if (data?.action === "bubble" && data.sceneId === canvas.scene?.id) showBubble(data.tokenId, data.text);
  });
  game.modules.get(MID).api = {
    openConfig, openOverview,
    say: (tokenId, text) => {
      const doc = canvas.scene?.tokens.get(tokenId);
      if (doc) broadcastBubble(doc, text);
    },
    brains
  };
  console.log(`${MID} | v${game.modules.get(MID)?.version} geladen`);
  syncBrains();
});

Hooks.on("canvasReady", () => {
  stopAll();
  routeVersion++;
  TokenPathfinder.wallVersion++;
  syncBrains();
});

Hooks.on("createToken", () => syncBrains());
Hooks.on("deleteToken", () => syncBrains());
Hooks.on("userConnected", () => setTimeout(syncBrains, 500));

Hooks.on("updateToken", (doc, changes, options) => {
  if (doc.parent !== canvas.scene) return;
  if (foundry.utils.hasProperty(changes, `flags.${MID}`) || changes.flags?.[`-=${MID}`] !== undefined) {
    restartBrain(doc.id);
    return;
  }
  // Der SL schiebt den NSC selbst: kurz Pause, danach geht es von dort weiter
  const method = options?.movement?.[doc.id]?.method;
  if (method && method !== "api" && brains.has(doc.id)) brains.get(doc.id).interrupt(15000);
});

for (const hook of ["createWall", "updateWall", "deleteWall"]) {
  Hooks.on(hook, () => { TokenPathfinder.wallVersion++; });
}
for (const hook of ["createDrawing", "updateDrawing", "deleteDrawing"]) {
  Hooks.on(hook, () => { routeVersion++; });
}

Hooks.on("combatStart", () => {
  if (setting("stopInCombat")) for (const b of brains.values()) b.interrupt();
});

/* Knopf im Token-HUD (Rechtsklick auf einen Token) */
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = hud.document ?? hud.object?.document;
  const col = root?.querySelector(".col.right") ?? root?.querySelector(".right");
  if (!col || !doc || col.querySelector(".npcb-hud")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon npcb-hud";
  if (getConfig(doc).enabled) btn.classList.add("active");
  btn.title = "NSC-Verhalten";
  btn.innerHTML = `<i class="fa-solid fa-person-walking"></i>`;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openConfig(doc);
  });
  col.append(btn);
});

/* Knöpfe in der Token-Werkzeugleiste links */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tokens = controls.tokens ?? controls.token;
  if (!tokens?.tools || Array.isArray(tokens.tools)) return;
  tokens.tools[`${MID}-toggle`] = {
    name: `${MID}-toggle`,
    title: "NSC-Belebung an/aus",
    icon: "fa-solid fa-people-arrows",
    toggle: true,
    active: game.settings.get(MID, "active"),
    order: 90,
    onChange: (event, active) => game.settings.set(MID, "active", !!active)
  };
  tokens.tools[`${MID}-overview`] = {
    name: `${MID}-overview`,
    title: "NSC-Verhalten: Übersicht",
    icon: "fa-solid fa-person-walking",
    button: true,
    order: 91,
    onChange: () => openOverview()
  };
});
