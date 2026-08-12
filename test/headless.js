/* DEEPCORE — test/headless.js
   Node integration test (SPEC §11). Loads the real modules, verifies map
   guarantees, scripts a working starter base through the public Sim API
   (2 iron extractors + 1 coal extractor -> smelter -> assembler -> hub),
   ticks 3 sim-minutes, then forces instability 90 and verifies quakes. */
'use strict';

require('../js/data.js');
require('../js/art.js');
require('../js/map.js');
require('../js/sim.js');
require('../js/meta.js');
const DC = globalThis.DC;
const D = DC.DATA;
const S = DC.Sim;

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}
function assert(cond, msg) { if (!cond) fail(msg); }
function key(x, y) { return x + ',' + y; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ---------------------------------------------------------------- art widths
function checkArt() {
  function walk(name, v) {
    if (!Array.isArray(v)) return;
    for (const el of v) {
      if (typeof el === 'string') {
        assert(el.length <= 76, 'art asset "' + name + '" line too wide (' + el.length + ' > 76)');
      } else {
        walk(name, el);
      }
    }
  }
  for (const k of Object.keys(DC.Art)) walk(k, DC.Art[k]);
}

// ------------------------------------------------------------------ the run
let run = null;
let platesGained = 0;   // inv.ironPlate increases observed across ticks (= smelted)
let gearsMade = 0;      // inv.gear increases observed across ticks (= crafted+delivered)
let shakes = 0;
const seenMsgs = new Set();
const allMsgs = [];

function T(x, y) {
  return (x >= 0 && y >= 0 && x < D.MAP_W && y < D.MAP_H) ? run.grid[y][x] : null;
}
function inv(item) { return run.inv[item] || 0; }

function tick1() {
  const p0 = inv('ironPlate'), g0 = inv('gear');
  S.tick(run);
  const pd = inv('ironPlate') - p0;
  if (pd > 0) platesGained += pd;
  const gd = inv('gear') - g0;
  if (gd > 0) gearsMade += gd;
  if (run.shake) { shakes++; run.shake = false; }
  for (const m of run.messages) {
    if (!seenMsgs.has(m)) { seenMsgs.add(m); allMsgs.push(m); }
  }
}
function tickN(n, withMaintain) {
  for (let i = 0; i < n && run.status !== 'dead'; i++) {
    tick1();
    if (withMaintain && run.t % 16 === 0) maintain();
  }
}

// -------------------------------------------------------- map guarantee checks
function hubCenter() { return { x: run.hub.x + 1, y: run.hub.y + 1 }; }

function floodFromHub() {
  const seen = Array.from({ length: D.MAP_H }, () => new Array(D.MAP_W).fill(false));
  const q = [];
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
    q.push({ x: run.hub.x + dx, y: run.hub.y + dy });
    seen[run.hub.y + dy][run.hub.x + dx] = true;
  }
  while (q.length) {
    const c = q.pop();
    for (const dd of D.DIRS) {
      const nx = c.x + dd.dx, ny = c.y + dd.dy;
      const t = T(nx, ny);
      if (t && !seen[ny][nx] && t.t === 'floor') { seen[ny][nx] = true; q.push({ x: nx, y: ny }); }
    }
  }
  return seen;
}

function oreComponents(oreId) {
  const seen = new Set();
  const comps = [];
  for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
    const t = T(x, y);
    if (!t || t.ore !== oreId || seen.has(key(x, y))) continue;
    const comp = [];
    const q = [{ x, y }];
    seen.add(key(x, y));
    while (q.length) {
      const c = q.pop();
      comp.push(c);
      for (const dd of D.DIRS) {
        const nx = c.x + dd.dx, ny = c.y + dd.dy;
        const nt = T(nx, ny);
        if (nt && nt.ore === oreId && !seen.has(key(nx, ny))) {
          seen.add(key(nx, ny));
          q.push({ x: nx, y: ny });
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function checkMapGuarantees() {
  // hub clear: 7x7 around the 3x3 footprint is all floor
  for (let y = run.hub.y - 2; y <= run.hub.y + 4; y++) {
    for (let x = run.hub.x - 2; x <= run.hub.x + 4; x++) {
      const t = T(x, y);
      assert(t && t.t === 'floor', 'hub 7x7 clearing not floor at ' + x + ',' + y);
    }
  }
  const reach = floodFromHub();
  const reachable = (comp) => comp.some((c) => reach[c.y][c.x]);
  const iron = oreComponents('ironOre').filter(reachable);
  const ironTiles = iron.reduce((n, c) => n + c.length, 0);
  // two guaranteed veins may have grown into one blob: accept 1 comp if big
  assert(iron.length >= 2 || (iron.length === 1 && ironTiles >= 12),
    'expected >=2 reachable iron veins (got ' + iron.length + ' comps, ' + ironTiles + ' tiles)');
  const coal = oreComponents('coal').filter(reachable);
  assert(coal.length >= 1, 'expected >=1 reachable coal vein');
  return reach;
}

// ------------------------------------------- M-WONDERS: mapgen invariant sweep
// Landmarks are placed by mapgen, and mapgen is the module where a defect hides
// for seeds before it surfaces: a monolith dropped on a guaranteed vein, or a
// column laid across the one corridor to it, turns a run unwinnable in a way
// that only shows up as a confusing loss much later. So the guarantees are
// re-checked here across many seeds and every stratum, WITH landmarks present,
// and the connectivity invariant is re-derived from scratch rather than taken
// on trust: `landmark.cells[].was` records the terrain each cell replaced, so
// this sweep can rebuild the pre-landmark map and compare the two flood fills
// itself. If map.js's own guard and this one ever disagree, this one wins.
function reachOf(grid, hub) {
  const seen = new Set();
  const q = [];
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
    const x = hub.x + dx, y = hub.y + dy;
    seen.add(y * D.MAP_W + x);
    q.push([x, y]);
  }
  while (q.length) {
    const c = q.pop();
    for (const dd of D.DIRS) {
      const nx = c[0] + dd.dx, ny = c[1] + dd.dy;
      if (nx < 0 || ny < 0 || nx >= D.MAP_W || ny >= D.MAP_H) continue;
      const k = ny * D.MAP_W + nx;
      if (seen.has(k) || grid[ny][nx].t !== 'floor') continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen;
}

function oreCompsOf(grid, oreId) {
  const seen = new Set(), comps = [];
  for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
    if (grid[y][x].ore !== oreId || seen.has(y * D.MAP_W + x)) continue;
    const comp = [], q = [{ x, y }];
    seen.add(y * D.MAP_W + x);
    while (q.length) {
      const c = q.pop();
      comp.push(c);
      for (const dd of D.DIRS) {
        const nx = c.x + dd.dx, ny = c.y + dd.dy;
        if (nx < 0 || ny < 0 || nx >= D.MAP_W || ny >= D.MAP_H) continue;
        const k = ny * D.MAP_W + nx;
        if (grid[ny][nx].ore === oreId && !seen.has(k)) { seen.add(k); q.push({ x: nx, y: ny }); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function checkLandmarkSweep() {
  const SEEDS = 80, DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];
  const seenIds = {};
  let maps = 0, withLm = 0, cells = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const rng = DC.util.mulberry32(s * 7919 + 13);
    for (const depth of DEPTHS) {
      const gen = DC.MapGen.generate(depth, rng, {});
      const grid = gen.grid, hub = gen.hub, lm = gen.landmark;
      const tag = 'seed ' + s + ' depth ' + depth;
      maps++;

      // (1) the guaranteed veins are still there and still reachable
      const reach = reachOf(grid, hub);
      const reachable = (c) => c.some((p) => reach.has(p.y * D.MAP_W + p.x));
      const iron = oreCompsOf(grid, 'ironOre').filter(reachable);
      const ironTiles = iron.reduce((n, c) => n + c.length, 0);
      assert(iron.length >= 2 || (iron.length === 1 && ironTiles >= 12),
        tag + ': lost the guaranteed iron (' + iron.length + ' comps, ' + ironTiles + ' tiles)');
      assert(oreCompsOf(grid, 'coal').filter(reachable).length >= 1,
        tag + ': lost the guaranteed coal vein');

      // (2) the hub clearing is untouched
      for (let y = hub.y - 2; y <= hub.y + 4; y++)
        for (let x = hub.x - 2; x <= hub.x + 4; x++) {
          const t = grid[y][x];
          assert(t && t.t === 'floor' && !t.lm,
            tag + ': landmark or wall inside the hub clearing at ' + x + ',' + y);
        }

      if (!lm) continue;
      withLm++;
      seenIds[lm.id] = (seenIds[lm.id] || 0) + 1;
      const def = D.LANDMARK_BY_ID[lm.id];
      assert(def, tag + ': landmark id ' + lm.id + ' is not in D.LANDMARKS');
      assert(depth >= def.min, tag + ': ' + lm.id + ' rolled above its min depth ' + def.min);
      assert(lm.cells.length > 0, tag + ': landmark placed with no cells');

      // (3) no cell overwrote ore, the rig, or another landmark's ground
      const cellKeys = new Set();
      for (const c of lm.cells) {
        const t = grid[c.y][c.x];
        cells++;
        assert(c.x > 0 && c.y > 0 && c.x < D.MAP_W - 1 && c.y < D.MAP_H - 1,
          tag + ': landmark cell on the border ring');
        assert(!t.ore && t.oreAmt === 0, tag + ': landmark overwrote an ore vein at ' + c.x + ',' + c.y);
        assert(t.machine === null, tag + ': landmark overwrote a machine footprint');
        assert(t.lm && t.lm.id === lm.id, tag + ': landmark cell is not flagged on the grid');
        assert(t.t === def.base, tag + ': landmark cell terrain is not ' + def.base);
        assert(typeof c.was === 'string', tag + ': landmark cell did not record its old terrain');
        assert(c.was !== 'magma', tag + ': landmark ate a magma tile');
        cellKeys.add(c.y * D.MAP_W + c.x);
      }
      assert(cellKeys.size === lm.cells.length, tag + ': landmark cells are not distinct');
      assert(Math.hypot(lm.x - (hub.x + 1), lm.y - (hub.y + 1)) >= D.LANDMARK_MIN_DIST,
        tag + ': landmark anchor is inside the rig\'s reserved distance');

      // (4) the carve still connects every region it connected before. Rebuild
      // the map as it was one step earlier and flood BOTH.
      for (const c of lm.cells) grid[c.y][c.x].t = c.was;
      const before = reachOf(grid, hub);
      for (const c of lm.cells) grid[c.y][c.x].t = def.base;
      for (const k of before) {
        if (cellKeys.has(k)) continue;   // the landmark's own ground, legally consumed
        assert(reach.has(k), tag + ': the landmark walled off tile ' +
          (k % D.MAP_W) + ',' + Math.floor(k / D.MAP_W) + ' from the rig');
      }
    }
  }
  // The feature has to actually happen, on every stratum, for most maps.
  assert(withLm >= maps * 0.9,
    'landmarks should place on the overwhelming majority of maps (' + withLm + '/' + maps + ')');
  assert(Object.keys(seenIds).length === D.LANDMARKS.length,
    'every landmark in the table should be reachable by some seed (saw ' +
    Object.keys(seenIds).join(',') + ')');

  // determinism: the same seed and depth must produce the same wonder, in the
  // same place, forever. Landmarks derive from a hash of the finished grid and
  // draw nothing from run.rng, so this also proves the map itself is unmoved.
  for (const s of [1337, 42, 90210]) {
    const a = DC.MapGen.generate(5, DC.util.mulberry32(s), {});
    const b = DC.MapGen.generate(5, DC.util.mulberry32(s), {});
    assertEqJSON(a.landmark, b.landmark, 'landmark is deterministic for seed ' + s);
  }
  return { maps, withLm, cells, ids: seenIds };
}
function assertEqJSON(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), msg);
}

// --------------------------------------------------------------- path finding
function passable(t, k, blocked) {
  if (!t || !t.revealed) return false;
  if (blocked && blocked.has(k)) return false;
  if (t.machine !== null && t.machine !== undefined) return false;
  if (t.belt) return false;
  return t.t === 'floor' || t.t === 'rock';
}
function cellCost(t) {
  if (t.t === 'rock') return 8;
  if (t.rubble) return 4;
  return t.ore ? 2 : 1;
}

// Dijkstra from start cells to any goal in goalMap (key -> "into" tile).
// Returns { path: [cells...], into } or null. Path cells will hold belts.
function findPath(starts, goalMap, blocked) {
  const distm = new Map(), prev = new Map(), pq = [];
  for (const s of starts) {
    const k = key(s.x, s.y);
    const t = T(s.x, s.y);
    if (!passable(t, k, blocked)) continue;
    distm.set(k, cellCost(t));
    pq.push({ k, x: s.x, y: s.y, d: cellCost(t) });
  }
  while (pq.length) {
    pq.sort((a, b) => b.d - a.d);
    const cur = pq.pop();
    if (cur.d !== distm.get(cur.k)) continue;
    if (goalMap.has(cur.k)) {
      const path = [];
      let k = cur.k;
      while (k !== undefined) {
        const p = k.split(',');
        path.unshift({ x: +p[0], y: +p[1] });
        k = prev.get(k);
      }
      return { path, into: goalMap.get(cur.k) };
    }
    for (const dd of D.DIRS) {
      const nx = cur.x + dd.dx, ny = cur.y + dd.dy;
      const t = T(nx, ny);
      const nk = key(nx, ny);
      if (!passable(t, nk, blocked)) continue;
      const nd = cur.d + cellCost(t);
      if (distm.has(nk) && distm.get(nk) <= nd) continue;
      distm.set(nk, nd);
      prev.set(nk, cur.k);
      pq.push({ k: nk, x: nx, y: ny, d: nd });
    }
  }
  return null;
}

// ------------------------------------------------------------ build utilities
function rect(x, y, w, h) {
  const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}
function outputTile(x, y, w, h, facing) {
  if (facing === 0) return { x: x + ((w - 1) >> 1), y: y - 1 };
  if (facing === 1) return { x: x + w, y: y + ((h - 1) >> 1) };
  if (facing === 2) return { x: x + ((w - 1) >> 1), y: y + h };
  return { x: x - 1, y: y + ((h - 1) >> 1) };
}
// Map of perimeter cell key -> the footprint tile a belt there would push into.
function perimMap(fp) {
  const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
  const m = new Map();
  for (const c of fp) {
    for (const dd of D.DIRS) {
      const nx = c.x + dd.dx, ny = c.y + dd.dy, k = key(nx, ny);
      if (!fpSet.has(k) && !m.has(k)) m.set(k, { x: c.x, y: c.y });
    }
  }
  return m;
}
function dirBetween(a, b) {
  for (let i = 0; i < 4; i++) {
    if (D.DIRS[i].dx === b.x - a.x && D.DIRS[i].dy === b.y - a.y) return i;
  }
  return -1;
}
function canAfford(type) {
  const cost = D.BUILDINGS[type].cost;
  for (const it in cost) if (inv(it) < cost[it]) return false;
  return true;
}

const builtBelts = [];    // {x, y, dir, retired} — for quake-damage maintenance
const builtMachines = []; // {type, x, y, facing, retired}

function placeMachine(type, x, y, facing) {
  if (!S.place(run, type, x, y, facing)) return false;
  builtMachines.push({ type, x, y, facing, retired: false });
  return true;
}

function digIfNeeded(cells) {
  let any = false;
  for (const c of cells) {
    const t = T(c.x, c.y);
    if (t && (t.t === 'rock' || t.rubble)) {
      const r = S.demolishAt(run, c.x, c.y);
      if (!r || !r.ok) return false;
      any = true;
    }
  }
  if (any) {
    for (let i = 0; i < D.DIG_ROCK + 8; i++) {
      tick1();
      if (cells.every((c) => { const t = T(c.x, c.y); return t && t.t === 'floor' && !t.rubble; })) break;
    }
  }
  return cells.every((c) => { const t = T(c.x, c.y); return t && t.t === 'floor' && !t.rubble; });
}

function buildBeltLine(path, into, record) {
  if (!digIfNeeded(path)) return false;
  for (let i = 0; i < path.length; i++) {
    const next = (i + 1 < path.length) ? path[i + 1] : into;
    const dir = dirBetween(path[i], next);
    if (dir < 0) return false;
    if (!S.place(run, 'belt', path[i].x, path[i].y, dir)) return false;
    const b = { x: path[i].x, y: path[i].y, dir, retired: false };
    builtBelts.push(b);
    if (record) record.push(b);
  }
  return true;
}

// Repair damaged machines, rebuild quake-destroyed belts/machines on our plan.
function maintain() {
  for (const id in run.machines) {
    const m = run.machines[id];
    if (m && m.type !== 'hub' && m.hp === 1 && inv('ironPlate') >= 3) S.clickTile(run, m.x, m.y);
  }
  for (const b of builtBelts) {
    if (b.retired) continue;
    const t = T(b.x, b.y);
    if (!t) continue;
    if (t.rubble && !(t.digT > 0)) { S.demolishAt(run, b.x, b.y); continue; }
    if (!t.belt && t.machine === null && t.t === 'floor' && !t.rubble && canAfford('belt')) {
      S.place(run, 'belt', b.x, b.y, b.dir);
    }
  }
  for (const mc of builtMachines) {
    if (mc.retired) continue;
    const t = T(mc.x, mc.y);
    if (!t || t.machine !== null) continue;
    if (mc.type === 'extractor' && !(t.ore && t.oreAmt > 0)) continue;
    if (canAfford(mc.type)) S.place(run, mc.type, mc.x, mc.y, mc.facing);
  }
}

// ---------------------------------------------------------------- planning
function oreTilesSorted(oreId, reach, ref) {
  const out = [];
  for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
    const t = T(x, y);
    if (t && t.ore === oreId && t.oreAmt > 0 && reach[y][x] && t.machine === null && !t.belt) {
      out.push({ x, y });
    }
  }
  out.sort((a, b) => dist(a, ref) - dist(b, ref));
  return out;
}

// Best (tile, facing, path) delivering oreId into the footprint fp.
function planExtractor(tiles, fp, blocked) {
  const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
  const goals = perimMap(fp);
  for (const [k] of goals) if (blocked.has(k)) goals.delete(k);
  let best = null;
  for (const ot of tiles.slice(0, 14)) {
    const okey = key(ot.x, ot.y);
    if (blocked.has(okey)) continue;
    for (let f = 0; f < 4; f++) {
      const o = outputTile(ot.x, ot.y, 1, 1, f);
      const ok = key(o.x, o.y);
      if (fpSet.has(ok)) {                       // ejects straight into the machine
        return { tile: ot, facing: f, path: [], into: null };
      }
      if (blocked.has(ok)) continue;
      const b2 = new Set(blocked); b2.add(okey); // path may not cross the extractor
      const r = findPath([o], goals, b2);
      if (r && (!best || r.path.length < best.path.length)) {
        best = { tile: ot, facing: f, path: r.path, into: r.into };
      }
    }
    if (best && best.path.length <= 2) break;    // good enough, stop searching
  }
  return best;
}

function planStarterBase(reach) {
  const hubC = hubCenter();
  const hubGoals = perimMap(rect(run.hub.x, run.hub.y, 3, 3));
  const sites = [];
  for (let y = 1; y < D.MAP_H - 2; y++) {
    for (let x = 1; x < D.MAP_W - 2; x++) {
      const fp = rect(x, y, 2, 2);
      let ok = true, hasOre = false;
      for (const c of fp) {
        const t = T(c.x, c.y);
        if (!t || t.t !== 'floor' || t.rubble || t.machine !== null || t.belt || !t.revealed) { ok = false; break; }
        if (t.ore) hasOre = true;
      }
      if (!ok) continue;
      const ctr = { x: x + 0.5, y: y + 0.5 };
      if (dist(ctr, hubC) > 14) continue;
      sites.push({ x, y, hasOre, ctr });
    }
  }
  const ironAll = oreTilesSorted('ironOre', reach, hubC);
  const coalAll = oreTilesSorted('coal', reach, hubC);
  assert(ironAll.length > 0, 'no reachable iron ore tiles');
  assert(coalAll.length > 0, 'no reachable coal tiles');
  const near = (tiles, ctr) => tiles.reduce((m, t) => Math.min(m, dist(t, ctr)), 1e9);
  sites.sort((a, b) =>
    (dist(a.ctr, hubC) * 1.2 + near(ironAll, a.ctr) + near(coalAll, a.ctr) + (a.hasOre ? 6 : 0)) -
    (dist(b.ctr, hubC) * 1.2 + near(ironAll, b.ctr) + near(coalAll, b.ctr) + (b.hasOre ? 6 : 0)));

  let fallback = null;
  for (const site of sites.slice(0, 60)) {
    const fp = rect(site.x, site.y, 2, 2);
    const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
    // facing whose output tile is a laneable cell, closest to the hub
    const facings = [0, 1, 2, 3]
      .map((f) => ({ f, o: outputTile(site.x, site.y, 2, 2, f) }))
      .filter((v) => passable(T(v.o.x, v.o.y), key(v.o.x, v.o.y), fpSet))
      .sort((a, b) => dist(a.o, hubC) - dist(b.o, hubC));
    for (const fc of facings) {
      const blocked = new Set(fpSet);
      const hubLine = findPath([fc.o], hubGoals, blocked);
      if (!hubLine) continue;
      for (const c of hubLine.path) blocked.add(key(c.x, c.y));
      const ironTiles = ironAll.slice().sort((a, b) => dist(a, site.ctr) - dist(b, site.ctr));
      const ironPlan = planExtractor(ironTiles, fp, blocked);
      if (!ironPlan) continue;
      blocked.add(key(ironPlan.tile.x, ironPlan.tile.y));
      for (const c of ironPlan.path) blocked.add(key(c.x, c.y));
      const coalTiles = coalAll.slice().sort((a, b) => dist(a, site.ctr) - dist(b, site.ctr));
      const coalPlan = planExtractor(coalTiles, fp, blocked);
      if (!coalPlan) continue;
      const belts = hubLine.path.length + ironPlan.path.length + coalPlan.path.length;
      const plan = { site, facing: fc.f, fp, hubLine, ironPlan, coalPlan, belts };
      if (belts + 28 <= inv('ironPlate')) return plan;      // fits the 40-plate budget
      if (!fallback || belts < fallback.belts) fallback = plan;
    }
  }
  return fallback; // may exceed budget; execution will report if plates run dry
}

function executeStarterBase(plan) {
  assert(plan, 'could not plan a starter base (no smelter site with routable iron+coal)');
  const p = plan;
  assert(placeMachine('smelter', p.site.x, p.site.y, p.facing),
    'failed to place smelter at ' + p.site.x + ',' + p.site.y);
  const smelter = { fp: p.fp };
  assert(placeMachine('extractor', p.ironPlan.tile.x, p.ironPlan.tile.y, p.ironPlan.facing),
    'failed to place iron extractor');
  assert(placeMachine('extractor', p.coalPlan.tile.x, p.coalPlan.tile.y, p.coalPlan.facing),
    'failed to place coal extractor');
  assert(p.ironPlan.path.length === 0 || buildBeltLine(p.ironPlan.path, p.ironPlan.into, null),
    'failed to lay iron belt line');
  assert(p.coalPlan.path.length === 0 || buildBeltLine(p.coalPlan.path, p.coalPlan.into, null),
    'failed to lay coal belt line');
  smelter.hubBelts = [];
  assert(buildBeltLine(p.hubLine.path, p.hubLine.into, smelter.hubBelts),
    'failed to lay smelter->hub belt line');
  smelter.out = outputTile(p.site.x, p.site.y, 2, 2, p.facing);
  return smelter;
}

function upgradeToAssembler(smelter) {
  // Retire the temporary smelter->hub line; plates now flow through the assembler.
  for (const b of smelter.hubBelts) {
    b.retired = true;
    const t = T(b.x, b.y);
    if (t && t.belt) S.demolishAt(run, b.x, b.y);
  }
  const hubC = hubCenter();
  const hubGoals = perimMap(rect(run.hub.x, run.hub.y, 3, 3));
  const sites = [];
  for (let y = 1; y < D.MAP_H - 2; y++) {
    for (let x = 1; x < D.MAP_W - 2; x++) {
      const fp = rect(x, y, 2, 2);
      let ok = true;
      for (const c of fp) {
        const t = T(c.x, c.y);
        if (!t || t.t !== 'floor' || t.rubble || t.machine !== null || t.belt || !t.revealed) { ok = false; break; }
      }
      if (ok) sites.push({ x, y, ctr: { x: x + 0.5, y: y + 0.5 } });
    }
  }
  sites.sort((a, b) =>
    (dist(a.ctr, smelter.out) + dist(a.ctr, hubC)) - (dist(b.ctr, smelter.out) + dist(b.ctr, hubC)));
  for (const site of sites.slice(0, 80)) {
    const fp = rect(site.x, site.y, 2, 2);
    const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
    const facings = [0, 1, 2, 3]
      .map((f) => ({ f, o: outputTile(site.x, site.y, 2, 2, f) }))
      .filter((v) => passable(T(v.o.x, v.o.y), key(v.o.x, v.o.y), fpSet))
      .sort((a, b) => dist(a.o, hubC) - dist(b.o, hubC));
    for (const fc of facings) {
      const blocked = new Set(fpSet);
      const toHub = findPath([fc.o], hubGoals, blocked);
      if (!toHub) continue;
      for (const c of toHub.path) blocked.add(key(c.x, c.y));
      const asmGoals = perimMap(fp);
      for (const [k] of asmGoals) if (blocked.has(k)) asmGoals.delete(k);
      const fromSmelter = findPath([smelter.out], asmGoals, blocked);
      if (!fromSmelter) continue;
      const beltCost = toHub.path.length + fromSmelter.path.length;
      if (14 + beltCost > inv('ironPlate')) continue;
      if (!placeMachine('assembler', site.x, site.y, fc.f)) continue;
      assert(buildBeltLine(fromSmelter.path, fromSmelter.into, null),
        'failed to lay smelter->assembler belt line');
      assert(buildBeltLine(toHub.path, toHub.into, null),
        'failed to lay assembler->hub belt line');
      return true;
    }
  }
  fail('could not place + route an assembler (smelter->assembler->hub)');
}

function addSecondIronExtractor(smelter, reach) {
  const tiles = oreTilesSorted('ironOre', reach, smelter.out);
  const plan = planExtractor(tiles, smelter.fp, new Set());
  if (!plan) return false;
  if (!canAfford('extractor') || inv('ironPlate') < 8 + plan.path.length + 1) return false;
  if (!placeMachine('extractor', plan.tile.x, plan.tile.y, plan.facing)) return false;
  if (plan.path.length) buildBeltLine(plan.path, plan.into, null);
  return true;
}

// -------------------------------------------------------------------- main
// ------------------------------------------- M-RECAP: the save, DOM-free
// meta.js grew two fields (ghost splits, the Daily Shaft history) after v1
// saves had already shipped. This asserts the load path in bare node with no
// storage at all: a v1 profile must come back whole, with the new fields
// defaulted, and the new helpers must be pure functions of their arguments
// (dailyKey takes the timestamp; nothing here reads a clock).
function checkSave() {
  const M = DC.Meta;
  const fresh = M.newProfile();
  assert(fresh.v === M.SAVE_V, 'a fresh profile carries the save version');
  assert(fresh.bestSplits && typeof fresh.bestSplits === 'object',
    'a fresh profile has a bestSplits table');
  assert(Array.isArray(fresh.dailyHistory), 'a fresh profile has a daily history');

  // load() with no localStorage must not throw and must be a fresh profile
  const loaded = M.load();
  assert(loaded && Array.isArray(loaded.dailyHistory) && loaded.v === M.SAVE_V,
    'Meta.load is headless-safe and returns a migrated profile');

  // best splits: lower time wins, junk is refused
  const p = M.newProfile();
  assert(M.bestSplit(p, 3) === 0, 'no record yet reads as 0 (no ghost to race)');
  assert(M.recordSplit(p, 3, 141.24) === true, 'first split for a depth records');
  assert(M.bestSplit(p, 3) === 141.2, 'split stored to a tenth of a second');
  assert(M.recordSplit(p, 3, 150) === false, 'a slower split does not overwrite');
  assert(M.recordSplit(p, 3, 120.5) === true, 'a faster split takes the record');
  assert(M.bestSplit(p, 3) === 120.5, 'best split is the fastest seen');
  assert(M.recordSplit(p, 0, 10) === false, 'depth 0 is not a stratum');
  assert(M.recordSplit(p, 4, -3) === false, 'negative times are refused');
  assert(M.recordSplit(p, 4, NaN) === false, 'NaN times are refused');
  assert(M.recordSplits(p, [{ depth: 5, sec: 90 }, { depth: 6, sec: 80 }, null]) === 2,
    'recordSplits banks a whole run and survives holes in the list');

  // the Daily Shaft: one seed per UTC date, one ranked attempt per date
  assert(M.dailyKey(Date.UTC(2026, 0, 5, 23, 59, 59)) === '2026-01-05', 'dailyKey is UTC');
  assert(M.dailyKey(Date.UTC(2026, 0, 6, 0, 0, 1)) === '2026-01-06', 'dailyKey rolls at UTC midnight');
  const s1 = M.dailySeed('2026-01-05'), s2 = M.dailySeed('2026-01-06');
  assert(s1 === M.dailySeed('2026-01-05'), 'the daily seed is a pure hash of the date');
  assert(s1 !== s2, 'consecutive days are different shafts');
  assert(s1 >= 0 && s1 < 2 ** 31 && (s1 | 0) === s1, 'daily seed is a positive 31-bit int');
  assert(M.recordDaily(p, { date: '2026-01-05', depth: 4, timeSec: 512, cores: 3 }) === true,
    'the first attempt of a date ranks');
  assert(M.recordDaily(p, { date: '2026-01-05', depth: 9, timeSec: 99, cores: 9 }) === false,
    'later attempts that day are practice and are not recorded');
  assert(M.dailyEntry(p, '2026-01-05').depth === 4, 'the ranked attempt is the one kept');
  assert(M.dailyEntry(p, '2026-01-06') === null, 'no entry for a day not played');
  assert(M.recordDaily(p, { date: 'yesterday', depth: 1, timeSec: 1 }) === false,
    'a malformed date is refused rather than repaired');

  // --- the real migration: a v1 save read back through Meta.load ---
  // (a bare-object storage stub, exactly the shape meta.js guards for)
  const cell = {};
  global.localStorage = {
    getItem: (k) => (k in cell ? cell[k] : null),
    setItem: (k, v) => { cell[k] = String(v); },
  };
  try {
    // written by a build that predates M-RECAP: no v, no bestSplits, no history
    cell[D.SAVE_KEY] = JSON.stringify({
      cores: 7, upgrades: { m_stock: 1, m_bogus: 3 }, bestDepth: 5,
      wins: 1, runs: 9, totalCores: 22,
    });
    const old = M.load();
    assert(old.cores === 7 && old.bestDepth === 5 && old.runs === 9,
      'a v1 save still loads its own fields');
    assert(old.upgrades.m_stock === 1 && !('m_bogus' in old.upgrades),
      'v1 upgrades survive; unknown ids are dropped');
    assert(old.v === M.SAVE_V, 'the loaded profile is stamped with the new version');
    assert(Object.keys(old.bestSplits).length === 0,
      'a v1 profile loads with no ghosts rather than undefined');
    assert(old.dailyHistory.length === 0,
      'a v1 profile loads with an empty daily history rather than undefined');
    // it can then take new records and round-trip them
    M.recordSplit(old, 2, 88.5);
    M.recordDaily(old, { date: '2026-02-02', depth: 3, timeSec: 300, cores: 2 });
    M.save(old);
    const back = M.load();
    assert(back.bestSplits['2'] === 88.5, 'a new record round-trips through the save');
    assert(back.dailyHistory.length === 1 && back.dailyHistory[0].date === '2026-02-02',
      'the daily history round-trips through the save');

    // a save corrupted in the NEW fields must degrade, never throw
    cell[D.SAVE_KEY] = JSON.stringify({
      cores: 3, bestSplits: { '0': 5, x: 3, '3': -1, '4': 'nope', '5': 12.34, '6': 9 },
      dailyHistory: [null, 42, { date: 'nope' },
                     { date: '2026-03-03', depth: 4, timeSec: 100 },
                     { date: '2026-03-03', depth: 99, timeSec: 1 }],
    });
    const dirty = M.load();
    assert(Object.keys(dirty.bestSplits).sort().join(',') === '5,6',
      'only sane split records survive (got ' + JSON.stringify(dirty.bestSplits) + ')');
    assert(dirty.bestSplits['5'] === 12.3, 'split times are normalised on load');
    assert(dirty.dailyHistory.length === 1 && dirty.dailyHistory[0].depth === 4,
      'malformed and duplicate-date daily rows are dropped');
    cell[D.SAVE_KEY] = '{not json at all';
    assert(M.load().cores === 0, 'corrupt JSON still yields a fresh profile');
  } finally {
    delete global.localStorage;
  }

  // the new helpers must also tolerate a profile object that predates them
  const legacy = { cores: 1, upgrades: {} };
  assert(M.bestSplit(legacy, 2) === 0, 'bestSplit on a v1 profile reads 0');
  assert(M.dailyEntry(legacy, '2026-01-05') === null, 'dailyEntry on a v1 profile is null');
  assert(M.recordSplit(legacy, 2, 100) === true, 'a v1 profile can still take a record');
}

function main() {
  checkArt();
  checkSave();
  const lmSweep = checkLandmarkSweep();

  const eff = DC.Meta.effects(DC.Meta.newProfile());
  assert(eff && typeof eff.instMult === 'number' && eff.offerCount === 3,
    'Meta.effects default shape is wrong');
  run = S.newRun(eff, 1337);
  assert(run && run.grid && run.hub, 'Sim.newRun returned no run');
  assert(run.depth === 1 && run.status === 'active', 'fresh run should be active at depth 1');

  const reach = checkMapGuarantees();
  const oreStart = sumOre();

  // let the scan radius grow past the guaranteed-vein radius before building
  tickN(128, false);

  const smelter = executeStarterBase(planStarterBase(reach));

  // bank plates through smelter->hub until the assembler stage is affordable
  while (run.status !== 'dead' && run.t < 960 && inv('ironPlate') < 30) tickN(16, true);
  while (run.status !== 'dead' && run.t < 1200 && inv('ironPlate') < 20) tickN(16, true);
  assert(run.status !== 'dead', 'run died during the banking phase');
  upgradeToAssembler(smelter);
  let secondIron = addSecondIronExtractor(smelter, reach);
  while (!secondIron && run.status !== 'dead' && run.t < 1300) {
    tickN(32, true);
    secondIron = addSecondIronExtractor(smelter, reach);
  }

  // run out the 3 sim-minutes
  const mainTicks = 3 * 60 * D.TICK_HZ;
  if (run.t < mainTicks) tickN(mainTicks - run.t, true);

  const oreMined = oreStart - sumOre();
  assert(oreMined > 0, 'no ore was mined in 3 sim-minutes');
  assert(platesGained > 0, 'no plates were smelted & delivered to the hub');
  assert(run.gearsFed > 0, 'drill fed no gears');
  assert(gearsMade > 0, 'assembler chain delivered no crafted gears to the hub');

  // ---- hazard phase: force instability, expect quakes + integrity loss ----
  const integ0 = run.integrity;
  const msg0 = allMsgs.length;
  const shakes0 = shakes;
  run.instability = 90;
  run.quakeAt = 0;
  tickN(60 * D.TICK_HZ, false);
  const quakeMsgs = allMsgs.slice(msg0).filter((m) => /quake|collapse|tremor|shake|shudder/i.test(m.text || ''));
  assert(quakeMsgs.length > 0, 'no quake messages during 60s at instability 90 (shakes=' + (shakes - shakes0) + ')');
  assert(shakes > shakes0, 'no quake shakes during 60s at instability 90');
  assert(run.integrity < integ0, 'integrity did not drop under quakes (' + integ0 + ' -> ' + run.integrity + ')');

  console.log('PASS seed=1337 | ore mined ' + oreMined +
    ' | plates smelted ' + platesGained +
    ' | gears crafted->hub ' + gearsMade +
    ' | gearsFed ' + run.gearsFed + '/' + run.breachReq.gear +
    ' | quakes ' + (shakes - shakes0) + ' (' + quakeMsgs.length + ' msgs)' +
    ' | integrity ' + integ0 + '->' + run.integrity +
    ' | status ' + run.status +
    ' | landmarks ' + lmSweep.withLm + '/' + lmSweep.maps + ' maps, ' +
    lmSweep.cells + ' cells, ' + Object.keys(lmSweep.ids).length + ' kinds, ' +
    'veins+connectivity held');
}

function sumOre() {
  let s = 0;
  for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) s += T(x, y).oreAmt || 0;
  return s;
}

try {
  main();
  process.exit(0);
} catch (e) {
  fail('exception: ' + (e && e.stack || e));
}
