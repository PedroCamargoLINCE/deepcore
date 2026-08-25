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
require('../js/events.js');   // M-EVENTS: dig finds, vignettes, the cat
require('../js/worms.js');    // M-WORMS: vein worms, the lure, the Undertoad
const DC = globalThis.DC;
const D = DC.DATA;
const S = DC.Sim;

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}
function assert(cond, msg) { if (!cond) fail(msg); }
function assertEq(a, b, msg) {
  if (a !== b) fail(msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')');
}
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

// -------------------------------------------------- the vendored font subset
// `vendor/deepcore-mono.woff2` carries EXACTLY the inventory tools/glyphs.js
// reports, and regenerating it needs Python + fontTools that these suites
// deliberately do not require. So adding a glyph to a bark, an art asset or a
// data table without regenerating the font puts a tofu box on the screen of
// every player whose system font is missing it — the exact class of bug
// M-HIRES vendored the font to end, and one nothing else in the tree would
// catch. This pins the inventory. If it fails you have added a glyph: either
// use one of the 110 below, or run `node tools/font.js` and update this list
// deliberately, in the same commit.
const FONT_GLYPHS =
  '¢¤§«°±·»×˙Ω—’†‡•…←↑→↓↵−∩≈≋≡≤≫⌐─│┌┐└┘├┤┬┼═║╒╔╕╗╘╚╛╝╞╟╠╡╢╣╥╦╧╨╩╪╫╬' +
  '▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▖▗▘▙▚▛▜▝▞▟▣▪▬▲▶▸▼◀◆◇◈○◎☼♠♣♦⣿';
function checkGlyphInventory() {
  const drawn = require('../tools/glyphs.js').glyphs.join('');
  const have = new Set(FONT_GLYPHS.split(''));
  const added = drawn.split('').filter((c) => !have.has(c));
  assert(added.length === 0,
    'these glyphs are not in vendor/deepcore-mono.woff2 and will tofu: ' +
    added.join(' ') + ' (' + added.map((c) =>
      'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ') +
    ') — see tools/font.js');
  return drawn.length;
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

  // M-EVENTS: the logbook and the cat. Both are optional fields a v1/v2 save
  // has never heard of, so both must default rather than fail (checked in the
  // migration block below), and the book must never hold the same entry twice.
  assert(Array.isArray(fresh.logbook) && fresh.logbook.length === 0,
    'a fresh profile has an empty logbook');
  assert(fresh.catFound === false, 'a fresh profile has no cat yet');
  assert(M.recordLog(p, 4) === true, 'a found log entry is filed');
  assert(M.recordLog(p, 4) === false, 'the same entry is never filed twice');
  assert(M.recordLog(p, 1) === true, 'a second entry is filed');
  assert(M.logbook(p).join(',') === '1,4', 'the book reads in entry order');
  assert(M.hasLog(p, 4) === true && M.hasLog(p, 9) === false,
    'the book knows what it holds');
  assert(M.recordLog(p, -1) === false && M.recordLog(p, M.LOGBOOK_MAX) === false,
    'an out-of-range entry is refused rather than stored');
  assert(M.catFound(p) === false, 'the cat is not found by default');
  assert(M.findCat(p) === true && M.catFound(p) === true, 'the cat is found once');
  assert(M.findCat(p) === false, '...and cannot be found twice');

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
    assert(Array.isArray(old.logbook) && old.logbook.length === 0,
      'a v1 profile loads with an empty logbook rather than undefined');
    assert(old.catFound === false, 'a v1 profile loads without a cat');
    // it can then take new records and round-trip them
    M.recordSplit(old, 2, 88.5);
    M.recordDaily(old, { date: '2026-02-02', depth: 3, timeSec: 300, cores: 2 });
    M.recordLog(old, 11);
    M.findCat(old);
    M.save(old);
    const back = M.load();
    assert(back.bestSplits['2'] === 88.5, 'a new record round-trips through the save');
    assert(back.dailyHistory.length === 1 && back.dailyHistory[0].date === '2026-02-02',
      'the daily history round-trips through the save');
    assert(back.logbook.join(',') === '11', 'the logbook round-trips through the save');
    assert(back.catFound === true, 'the cat round-trips through the save');
    // M-SOUND: the mute flag is a profile field, off by default
    assert(M.newProfile().muted === false, 'a fresh profile is not muted');
    old.muted = true; M.save(old);
    assert(M.load().muted === true, 'the mute round-trips through the save');
    // and a save full of nonsense is sanitized, never trusted
    cell[D.SAVE_KEY] = JSON.stringify({ logbook: [3, 3, -1, 'x', 999, 2], catFound: 'yes' });
    const junk = M.load();
    assert(junk.logbook.join(',') === '2,3',
      'a corrupt logbook is filtered and deduped, not repaired (got ' +
      junk.logbook.join(',') + ')');
    assert(junk.catFound === true, 'a truthy cat flag reads as a cat');
    assert(junk.muted === false, 'a missing mute flag reads as sound on');

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

// ======================================================================
// M-EVENTS — dig finds at the sim layer.
// The find table is exercised directly (a 4000-dig sweep is the only honest
// way to see an 8% roll), and the SIM HOOK is proved separately by digging a
// real hole through the public API and watching the counter move. The two
// halves matter: a perfect find table nobody calls is a perfect no-op.
// ======================================================================
function checkDigFinds() {
  const E = DC.Events;
  assert(E && typeof E.rollDig === 'function', 'DC.Events.rollDig exists');
  assert(typeof E.tick === 'function', 'DC.Events.tick exists');
  const eff = DC.Meta.effects(DC.Meta.newProfile());

  // ---- the table: rate, coverage, and every payload ---------------------
  const r0 = S.newRun(eff, 4242);
  const seen = {};
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const id = E.rollDig(r0, 5, 5);
    if (id) seen[id] = (seen[id] || 0) + 1;
    r0.instability = 0;       // keep the gas pockets from ending the run
    r0.ev.rigTaken = false;   // scaffold: the per-floor lock is checked below
  }
  const st0 = E.peek(r0);
  assert(st0.digs === N, 'every excavation is counted (' + st0.digs + ')');
  const rate = st0.finds / st0.digs;
  assert(rate > 0.05 && rate < 0.11,
    'about 8% of excavations yield (got ' + (rate * 100).toFixed(1) + '%)');
  for (const f of D.FINDS)
    assert(seen[f.id] > 0, 'find "' + f.id + '" turned up in ' + N + ' digs');
  // EGG-420's dig route (M-GRITPLUS asked for it; without this it is the typed
  // code or nothing). Rolled per excavation rather than per find — see the
  // note in events.js — and only ever once in a run.
  assert(seen.tin > 0, 'the pre-collapse tin is findable at all');
  {
    const run = S.newRun(eff, 4242);
    let tins = 0;
    for (let i = 0; i < 20000; i++) {
      if (E.rollDig(run, 5, 5) === 'tin') tins++;
      run.instability = 0;
      run.ev.rigTaken = false;
    }
    assert(tins === 1, 'the tin turns up exactly once in a run (got ' + tins + ')');
    assert(run.eggSeen === true, 'and it really opened the window');
  }

  // ---- the payloads, one at a time, on a clean run ----------------------
  function forced(id, at) {
    // Drive the stream until the wanted find comes up, then report the run it
    // came up on. Cheaper and far clearer than stubbing the rng.
    const run = S.newRun(eff, 99);
    // The dig site matters for exactly one find (the Old Shaft reveals map
    // around it), so callers may say where the hole is; everything else is
    // indifferent to it.
    const p = at || { x: 20, y: 12 };
    for (let i = 0; i < 20000; i++) {
      const before = {
        inv: JSON.parse(JSON.stringify(run.inv)),
        inst: run.instability,
        revealed: countRevealed(run),
        msgs: run.messages.length,
      };
      const spoils0 = (run.ev && run.ev.spoils) || 0;
      const got = E.rollDig(run, p.x, p.y);
      // M-ROCKORE: the spoil rolls on the SAME excavation, independently, and
      // pays into the same crate — that is the design (both can land on one
      // dig). It is not part of the find's payload, so it is folded into the
      // BEFORE snapshot and every case below still measures what the FIND
      // paid, which is the thing under test.
      if (run.ev && run.ev.spoils > spoils0) {
        let sp = null;
        for (let j = run.events.length - 1; j >= 0 && !sp; j--)
          if (run.events[j].type === 'rockOre') sp = run.events[j].data;
        assert(sp && sp.id && sp.n > 0, 'a spoil payout files its own event');
        before.inv[sp.id] = (before.inv[sp.id] || 0) + sp.n;
        before.msgs++;
      }
      if (got === id) return { run: run, before: before };
      run.instability = 0;
      run.ev.rigTaken = false;
    }
    fail('never rolled the "' + id + '" find in 20000 digs');
  }
  function countRevealed(run) {
    let n = 0;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) if (run.grid[y][x].revealed) n++;
    return n;
  }
  function invTotal(inv, keys) {
    let n = 0;
    for (const k of keys) n += inv[k] || 0;
    return n;
  }

  {  // ore pocket: 6-10 of one of THIS stratum's ores, straight to the hub
    const { run, before } = forced('ore');
    const ores = Object.keys(D.STRATA[run.depth - 1].ores);
    const gained = invTotal(run.inv, ores) - invTotal(before.inv, ores);
    assert(gained >= 6 && gained <= 10,
      'an ore pocket pays 6-10 ore (got ' + gained + ')');
  }
  {  // cache: 8-15 plates
    const { run, before } = forced('cache');
    const gained = (run.inv.ironPlate || 0) - (before.inv.ironPlate || 0);
    assert(gained >= 8 && gained <= 15,
      'a cache pays 8-15 plates (got ' + gained + ')');
  }
  for (const quiet of ['lunchbox', 'bones']) {
    const { run, before } = forced(quiet);
    assert(JSON.stringify(run.inv) === JSON.stringify(before.inv),
      'a ' + quiet + ' pays nothing but a story');
    assert(run.messages.length > before.msgs, '...and it does tell the story');
  }
  {  // gas pocket: a second of warning, THEN the pressure
    const { run, before } = forced('gas');
    const S0 = E.peek(run);
    assert(S0.gas && S0.gas.at === run.t + D.EVENTS.gasFuse,
      'the gas pocket arms a one-second fuse');
    assert(run.instability === before.inst, 'the hiss costs nothing by itself');
    const inst0 = run.instability;
    for (let i = 0; i < D.EVENTS.gasFuse; i++) { run.t++; E.tick(run); }
    assert(Math.abs(run.instability - (inst0 + 8)) < 1e-9,
      'the pocket pops for +8 pressure (got +' +
      (run.instability - inst0).toFixed(2) + ')');
    assert(E.peek(run).gas === null, 'and the fuse is spent, not repeating');
  }
  {  // the Old Shaft: a 6-radius chunk of map, revealed
    // dug in the corner furthest from the rig, which is the only place the
    // opening scan has certainly not already lit up
    const probe = S.newRun(eff, 99);
    const far = { x: probe.hub.x < D.MAP_W / 2 ? D.MAP_W - 2 : 1,
                  y: probe.hub.y < D.MAP_H / 2 ? D.MAP_H - 2 : 1 };
    const { run, before } = forced('shaft', far);
    const gained = countRevealed(run) - before.revealed;
    assert(gained > 0,
      'the old shaft reveals map the scan had not reached (got ' + gained + ')');
    assert(gained <= Math.PI * D.EVENTS.shaftR * D.EVENTS.shaftR + 8,
      'and it reveals a 6-radius chunk, not the floor (got ' + gained + ')');
  }
  {  // the dead rig: 12 plates, a log entry, and only once per stratum
    const { run, before } = forced('rig');
    assert((run.inv.ironPlate || 0) - (before.inv.ironPlate || 0) === 12,
      'a dead rig salvages 12 plates');
    const st = E.peek(run);
    assert(st.logs.length === 1, 'a dead rig hands over one foreman log');
    assert(typeof E.logText(st.logs[0]) === 'string', '...and it is a real entry');
    assert(st.rigTaken === true, 'the floor remembers it has been salvaged');
    let more = 0;
    for (let i = 0; i < 5000; i++) if (E.rollDig(run, 5, 5) === 'rig') more++;
    assert(more === 0, 'the same floor never yields a second dead rig');
    run.depth++;                                  // scaffold: descend a floor
    E.tick(run);
    assert(E.peek(run).rigTaken === false, 'the next floor has its own wreck');
  }

  // ---- the contract that protects every balance number ------------------
  // events.js draws from a stream derived from run.seed, never from run.rng.
  // If that ever changes, the number of holes a player dug starts deciding
  // which tiles the next quake eats.
  {
    function stream(withDigs) {
      const run = S.newRun(eff, 8080);
      if (withDigs) for (let i = 0; i < 500; i++) { E.rollDig(run, 5, 5); run.instability = 0; }
      return [run.rng(), run.rng(), run.rng()].join(',');
    }
    assert(stream(true) === stream(false),
      'digging never moves the sim rng stream');
    // ...and it is still deterministic on the seed
    function finds(seed) {
      const run = S.newRun(eff, seed);
      const out = [];
      for (let i = 0; i < 300; i++) { out.push(E.rollDig(run, 5, 5)); run.instability = 0; }
      return out.join(',');
    }
    assert(finds(31337) === finds(31337), 'the same seed digs up the same things');
    assert(finds(31337) !== finds(31338), 'a different seed digs up different things');
  }

  // ---- the sim hook: a real hole in real rock ---------------------------
  {
    const run = S.newRun(eff, 606);
    let dug = 0, rubbles = 0;
    for (let y = 0; y < D.MAP_H && dug < 60; y++)
      for (let x = 0; x < D.MAP_W && dug < 60; x++) {
        const t = run.grid[y][x];
        if (t.t !== 'rock' || t.lm) continue;
        t.revealed = true;
        if (!S.demolishAt(run, x, y).ok) continue;
        dug++;
      }
    assert(dug > 0, 'the scaffold found rock to excavate');
    for (let i = 0; i < D.DIG_ROCK + 2; i++) S.tick(run);
    const st = E.peek(run);
    assert(st && st.digs === dug,
      'sim.js reports every completed excavation to events.js (' +
      (st && st.digs) + ' of ' + dug + ')');
    // rubble is not rock: clearing it is housekeeping, not prospecting
    const before = st.digs;
    for (let y = 0; y < D.MAP_H && rubbles < 5; y++)
      for (let x = 0; x < D.MAP_W && rubbles < 5; x++) {
        const t = run.grid[y][x];
        if (t.t !== 'floor' || t.machine !== null || t.belt || t.lm) continue;
        t.rubble = true; t.revealed = true;
        if (S.demolishAt(run, x, y).ok) rubbles++;
      }
    assert(rubbles > 0, 'the scaffold found rubble to clear');
    for (let i = 0; i < D.DIG_RUBBLE + 2; i++) S.tick(run);
    assert(E.peek(run).digs === before, 'clearing rubble is not an excavation');
  }
  return st0.finds;
}

// ======================================================================
// M-ROCKORE — the spoil, measured  (SPEC3 M-HUMANBAL Finding 8)
// checkDigFinds above proves the 8% table and the sim hook. This one is the
// statistics the 30% roll needs to be believed: the rate, the per-stratum ore
// table it actually pays out, and the two isolations that make it legal —
// never run.rng (law 7), and never the find table's stream either (which is
// what lets test/balance.js name which number this feature moved).
// ======================================================================
function rockOreSection() {
  const E = DC.Events;
  const RO = D.EVENTS.rockOre;
  const eff = DC.Meta.effects(DC.Meta.newProfile());
  const N = 4000;
  assert(RO && RO.chance > 0, 'D.EVENTS.rockOre is a named, tunable field');

  // ---- the rate, and the table, on every floor of the game --------------
  let worstRate = 0, lines = [];
  for (const depth of [1, 2, 4, 5, 8, 9, 14]) {
    const run = S.newRun(eff, 4242 + depth);
    run.depth = depth;
    const got = {};
    let paid = 0, units = 0;
    for (let i = 0; i < N; i++) {
      const before = E.peek(run) ? E.peek(run).spoils : 0;
      E.rollDig(run, 5, 5);
      const st = E.peek(run);
      if (st.spoils > before) {
        paid++;
        // the spoil is filed before the find, so scan back for the newest one
        let sp = null;
        for (let j = run.events.length - 1; j >= 0 && !sp; j--)
          if (run.events[j].type === 'rockOre') sp = run.events[j].data;
        assert(sp, 's' + depth + ': a payout files an event');
        got[sp.id] = (got[sp.id] || 0) + 1;
        units += sp.n;
        assert(sp.n >= RO.min && sp.n <= RO.max,
          's' + depth + ': a payout is ' + RO.min + '-' + RO.max + ' ore (got ' + sp.n + ')');
      }
      run.instability = 0;        // keep the gas pockets from ending the run
      run.ev.rigTaken = false;
      run.events.length = 0;
    }
    const rate = paid / N;
    assert(Math.abs(rate - RO.chance) < 0.03,
      's' + depth + ': about ' + (RO.chance * 100).toFixed(0) + '% of holes pay (got ' +
      (rate * 100).toFixed(1) + '%)');
    const mean = units / paid;
    assert(Math.abs(mean - (RO.min + RO.max) / 2) < 0.12,
      's' + depth + ': a payout averages ' + ((RO.min + RO.max) / 2) + ' ore (got ' +
      mean.toFixed(2) + ')');
    // what came out matches the table events.js says it will pay
    const tbl = E.spoilTable(run);
    let tot = 0;
    for (const e of tbl) tot += e.w;
    for (const e of tbl) {
      const share = (got[e.id] || 0) / paid;
      assert(Math.abs(share - e.w / tot) < 0.05,
        's' + depth + ': "' + e.id + '" pays at its table weight (' +
        (100 * share).toFixed(1) + '% vs ' + (100 * e.w / tot).toFixed(1) + '%)');
    }
    for (const id in got)
      assert(tbl.some(e => e.id === id),
        's' + depth + ': "' + id + '" is not an ore this floor spawns');
    // Iron and coal are what a stranded base is stuck on — plates, and the
    // fuel to make them (Findings 1 and 6). They must carry the spoil.
    const need = ((got.ironOre || 0) + (got.coal || 0)) / paid;
    assert(need > 0.5, 's' + depth + ': iron+coal carry the spoil (' +
      (100 * need).toFixed(0) + '%)');
    worstRate = Math.max(worstRate, Math.abs(rate - RO.chance));
    lines.push('s' + depth + ' ' + tbl.map(e =>
      e.id.replace(/Ore$/, '') + ' ' + (100 * e.w / tot).toFixed(0)).join('/'));
  }

  // ---- the two isolations ----------------------------------------------
  {
    // law 7: the sim's stream never moves, however many holes were dug
    function stream(withDigs) {
      const run = S.newRun(eff, 8080);
      if (withDigs) for (let i = 0; i < 500; i++) { E.rollDig(run, 5, 5); run.instability = 0; }
      return [run.rng(), run.rng(), run.rng()].join(',');
    }
    assert(stream(true) === stream(false), 'the spoil never moves the sim rng stream');

    // ...and the find table's stream does not move either. The spoil owns a
    // THIRD channel off the same seed on purpose: if it spent numbers out of
    // the find stream, every vignette in every run would shift by however
    // many holes the player happened to dig.
    function finds(chance) {
      const was = RO.chance;
      RO.chance = chance;
      try {
        const run = S.newRun(eff, 31337);
        const out = [];
        for (let i = 0; i < 600; i++) {
          out.push(E.rollDig(run, 5, 5));
          run.instability = 0;
          run.ev.rigTaken = false;
        }
        return out.join(',');
      } finally { RO.chance = was; }
    }
    assertEq(finds(RO.chance), finds(0),
      'the 8% find table rolls the same sequence with the spoil on and off');

    // deterministic on the seed, which is what all of that determinism is for
    function spoil(seed) {
      const run = S.newRun(eff, seed);
      const out = [];
      for (let i = 0; i < 400; i++) {
        const b = run.ev ? run.ev.spoils : 0;
        E.rollDig(run, 5, 5);
        out.push(run.ev.spoils > b ? run.ev.spoilOre : '-');
        run.instability = 0;
        run.ev.rigTaken = false;
      }
      return out.join(',');
    }
    assert(spoil(555) === spoil(555), 'the same seed digs up the same spoil');
    assert(spoil(555) !== spoil(556), 'a different seed does not');
  }

  return lines.join(' | ') + ' (rate within ' + (worstRate * 100).toFixed(1) + 'pt)';
}

// ======================================================================
// M-EVENTS — the expedition vignettes, at the sim layer.
// The catalog is audited as DATA first (what an event is allowed to do is
// the whole safety story of the feature), then the roll, then every effect
// kind, then the two house rules the module claims: a vignette can never
// kill you, and a one-stratum modifier is really one stratum.
// ======================================================================
function checkVignettes() {
  const E = DC.Events;
  const A = DC.Art;
  const eff = DC.Meta.effects(DC.Meta.newProfile());
  assert(typeof E.rollVignette === 'function' && typeof E.apply === 'function',
    'DC.Events exposes rollVignette/apply');
  const V = E.VIGNETTES;
  assert(Array.isArray(V) && V.length >= 20,
    'twenty expedition vignettes are authored (got ' + (V && V.length) + ')');

  // ---- the catalog as data ---------------------------------------------
  // FX_KEYS is the contract. SPEC3 limits a vignette to inventory deltas,
  // integrity/pressure, a one-stratum modifier, or the cat; anything else
  // appearing here is a vignette that has quietly become a game mechanic.
  const FX_KEYS = ['inv', 'ore', 'integrity', 'inst', 'reveal', 'schematic',
                   'log', 'cat', 'modsSet', 'modsMul'];
  const ids = new Set();
  let catGivers = 0, choices = 0;
  for (const v of V) {
    assert(typeof v.id === 'string' && !ids.has(v.id), 'unique vignette id: ' + v.id);
    ids.add(v.id);
    assert(typeof v.title === 'string' && v.title.length <= 34,
      v.id + ': the title fits the panel (' + v.title.length + ')');
    assert(Array.isArray(v.text) && v.text.length >= 1 && v.text.length <= 2,
      v.id + ': one or two lines of prose');
    for (const p of v.text)
      assert(p.length <= 64, v.id + ': prose line fits 64 columns (' + p.length + ')');
    assert(v.min >= 1 && v.min <= D.STRATA_COUNT,
      v.id + ': the depth gate names a real stratum');
    assertEqJSON(v.choices.length, 2, v.id + ': a vignette is a fork, not a menu');
    for (const c of v.choices) {
      choices++;
      assert(typeof c.label === 'string' && c.label.length <= 30,
        v.id + ': choice label fits (' + c.label.length + '): ' + c.label);
      assert(typeof c.hint === 'string' && c.hint.length <= 46,
        v.id + ': choice hint fits (' + (c.hint || '').length + ')');
      assert(typeof c.result === 'string' && c.result.length <= 66,
        v.id + ': the result line fits (' + (c.result || '').length + ')');
      for (const k in (c.fx || {}))
        assert(FX_KEYS.indexOf(k) >= 0,
          v.id + ': "' + k + '" is not an effect a vignette may have');
      if (c.fx && c.fx.cat) catGivers++;
    }
    // house rule 2: every choice does something (see events.js). The Coin's
    // keepsake is the single authored exception and is named here so that
    // adding a SECOND do-nothing option has to be a deliberate edit.
    const inert = v.choices.filter(c => !c.fx || Object.keys(c.fx).length === 0);
    assert(inert.length === 0 || v.id === 'coin',
      v.id + ': "walk away" has to buy something');
    // and a panel to look at
    const art = A.eventFrame(v.id);
    assert(Array.isArray(art) && art.length && art.length <= A.EVENT_H,
      v.id + ': has a panel that fits ' + A.EVENT_H + ' rows');
    assert(A.eventFrames[v.id], v.id + ': has its OWN panel, not the placeholder');
    for (const ln of art)
      assert([...ln].length <= A.EVENT_W,
        v.id + ': panel row fits ' + A.EVENT_W + ' columns: ' + ln);
  }
  assert(catGivers === 1, 'exactly one choice in the whole catalog gives the cat');

  // ---- the roll ---------------------------------------------------------
  {
    // Rate, measured on a run parked at the deepest stratum so the whole
    // catalog is eligible; `seen` is cleared each time because the once-per-
    // run rule is what the next block is about.
    const run = S.newRun(eff, 5150);
    run.depth = D.STRATA_COUNT;
    let hits = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      run.ev = null;                       // a fresh run's worth of state
      const S2 = E.state(run);
      S2.rng = DC.util.mulberry32(i + 1);  // scaffold: an independent draw each time
      if (E.rollVignette(run)) hits++;
    }
    const rate = hits / N;
    assert(rate > 0.20 && rate < 0.30,
      'about 25% of descents ask you something (got ' +
      (rate * 100).toFixed(1) + '%)');
  }
  {
    // Never twice in a run, and never above its depth gate.
    const run = S.newRun(eff, 77);
    const got = [];
    for (let d = 1; d <= 40; d++) {
      run.depth = 1 + (d % D.STRATA_COUNT);
      E.state(run);                        // sync the floor
      const v = E.rollVignette(run);
      if (v) {
        assert(got.indexOf(v.id) < 0, 'no vignette is offered twice a run: ' + v.id);
        assert(v.min <= run.depth, v.id + ' respects its depth gate');
        got.push(v.id);
      }
    }
    assert(got.length > 2, 'the drive saw a few vignettes (' + got.length + ')');
  }
  {
    // the cat's vignette is withdrawn once you have a cat
    const run = S.newRun(eff, 4);
    const st = E.state(run);
    st.cat = { x: 1, y: 1 };
    for (let i = 0; i < 400; i++) {
      st.seen = {};
      const v = E.rollVignette(run);
      assert(!v || v.id !== 'crate', 'the crate is not offered to a cat owner');
    }
  }

  // ---- every effect kind, applied ---------------------------------------
  function byId(id) { return V.filter(v => v.id === id)[0]; }
  function fresh(depth) {
    const run = S.newRun(eff, 313);
    run.depth = depth || 1;
    E.state(run);
    return run;
  }
  {  // inventory, both directions
    const run = fresh();
    run.inv.ironPlate = 5;
    E.apply(run, byId('vault'), 0);
    assert(run.inv.ironPlate === 35, 'a vignette adds to the hub (got ' +
      run.inv.ironPlate + ')');
    const run2 = fresh();
    run2.inv.gear = 1;
    E.apply(run2, byId('shrine'), 0);     // costs 2 gears; only 1 in stock
    assert(run2.inv.gear === 0, 'a cost never takes an inventory negative');
  }
  {  // pressure, clamped both ends
    const run = fresh();
    run.instability = 3;
    E.apply(run, byId('vault'), 1);       // -10
    assert(run.instability === 0, 'pressure clamps at 0');
    const run2 = fresh();
    run2.instability = 96;
    E.apply(run2, byId('vault'), 0);      // +15
    assert(run2.instability === D.INSTAB_MAX, 'pressure clamps at the ceiling');
  }
  {  // HOUSE RULE 1: a vignette can never end a run
    const run = fresh(6);
    run.integrity = 3;
    E.apply(run, byId('offer'), 0);       // -15 hull
    assert(run.integrity === 1,
      'a costly vignette leaves you alive at 1 (got ' + run.integrity + ')');
    assert(run.status !== 'dead', 'and the run is still going');
    // ...and it never overheals
    const run2 = fresh();
    run2.integrity = run2.maxIntegrity - 2;
    E.apply(run2, byId('rations'), 0);    // +12 hull
    assert(run2.integrity === run2.maxIntegrity, 'healing stops at max integrity');
  }
  {  // the map
    const run = fresh(3);
    let hidden = 0;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) if (!run.grid[y][x].revealed) hidden++;
    assert(hidden > 0, 'the scaffold has map left to reveal');
    E.apply(run, byId('crack'), 0);
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++)
        assert(run.grid[y][x].revealed, 'listening maps the whole stratum');
  }
  {  // a schematic, installed without a descent
    const run = fresh(2);
    const d0 = run.depth, n0 = run.schematics.length;
    E.apply(run, byId('ghost'), 0);
    assert(run.schematics.length === n0 + 1, 'the ghost trades you a schematic');
    assert(run.depth === d0, '...without descending a floor');
  }
  {  // a foreman log
    const run = fresh(4);
    E.apply(run, byId('watchman'), 1);
    assert(E.peek(run).logs.length === 1, 'the watchman leaves you her log');
  }
  {  // HOUSE RULE: one-stratum modifiers really are one stratum
    const run = fresh(2);
    const base = run.mods.offerCount;
    E.apply(run, byId('drone'), 0);
    assert(run.mods.offerCount === 4, 'the bribe buys a fourth schematic offer');
    // it survives the whole floor...
    for (let i = 0; i < 200; i++) S.tick(run);
    assert(run.mods.offerCount === 4, '...for the whole of that floor');
    // ...and is handed back on arrival at the next one
    run.depth++;
    E.state(run);
    assert(run.mods.offerCount === base,
      'and the next floor gets its own offers back (got ' + run.mods.offerCount + ')');
    // multiplicative modifiers restore exactly, not approximately
    const run2 = fresh(3);
    const inst0 = run2.mods.instMult;
    E.apply(run2, byId('seam'), 1);
    assert(Math.abs(run2.mods.instMult - inst0 * 0.8) < 1e-9,
      'the quiet seam calms the floor by a fifth');
    run2.depth++;
    E.state(run2);
    assert(run2.mods.instMult === inst0, 'and hands the multiplier back exactly');
  }

  // ---- and none of it touches the sim's stream --------------------------
  {
    function stream(withVignettes) {
      const run = S.newRun(eff, 6161);
      run.depth = 5;
      if (withVignettes) {
        for (let i = 0; i < 40; i++) {
          const v = E.rollVignette(run);
          if (v) E.apply(run, v, i % 2);
          run.ev.seen = {};
        }
      }
      return [run.rng(), run.rng(), run.rng()].join(',');
    }
    assert(stream(true) === stream(false),
      'vignettes never move the sim rng stream');
  }
  return V.length + ' vignettes, ' + choices + ' choices';
}

// ======================================================================
// M-EVENTS — the cave-cat.
// Three promises, all of them checkable: she stays somewhere legal, she
// sits on furnaces that are actually lit, and she breaks for the rig
// BEFORE every quake rather than after it. Plus the one that makes her
// safe to ship at all — she never writes into the sim, so a run with a cat
// and a run without one are the same run.
// ======================================================================
function checkCat() {
  const E = DC.Events;
  const eff = DC.Meta.effects(DC.Meta.newProfile());
  assert(typeof E.grantCat === 'function' && typeof E.cat === 'function',
    'DC.Events exposes the cat');

  function withCat(seed) {
    const run = S.newRun(eff, seed || 808);
    assert(E.cat(run) === null, 'a run has no cat until one is found');
    const cat = E.grantCat(run);
    assert(cat && E.cat(run) === cat, 'granting a cat gives the run a cat');
    assert(E.grantCat(run) === cat, 'and she is not granted twice');
    return run;
  }

  {  // she starts somewhere legal, and stays there
    const run = withCat(808);
    const cat = E.cat(run);
    assert(run.grid[cat.y][cat.x].t === 'floor', 'the cat starts on floor');
    let illegal = 0, moved = 0;
    let last = cat.x + ',' + cat.y;
    for (let i = 0; i < 60 * D.TICK_HZ; i++) {
      S.tick(run);
      if (run.status === 'dead') break;
      const t = run.grid[cat.y] && run.grid[cat.y][cat.x];
      if (!t || (t.t !== 'floor' && t.machine !== 0)) illegal++;
      const now = cat.x + ',' + cat.y;
      if (now !== last) { moved++; last = now; }
    }
    assert(illegal === 0, 'the cat never stands in rock, glass or magma');
    assert(moved > 10, 'the cat actually wanders (' + moved + ' moves)');
    // ...and never far enough away to be somebody else's cat
    const c = { x: run.hub.x + 1, y: run.hub.y + 1 };
    assert(Math.abs(cat.x - c.x) <= 20 && Math.abs(cat.y - c.y) <= 20,
      'the cat stays in sight of the rig');
  }

  {  // the perch: a smelter that is genuinely burning
    const run = withCat(909);
    const cat = E.cat(run);
    // scaffold: a smelter next to the rig, mid-smelt
    const sx = run.hub.x + 4, sy = run.hub.y;
    for (let y = sy; y < sy + 2; y++)
      for (let x = sx; x < sx + 2; x++) {
        const t = run.grid[y][x];
        t.t = 'floor'; t.ore = null; t.oreAmt = 0; t.lm = null; t.revealed = true;
      }
    const id = run.nextId++;
    run.machines[id] = {
      id: id, type: 'smelter', x: sx, y: sy, w: 2, h: 2, facing: 1, hp: 2,
      progress: 4, recipe: null, input: { ironOre: 8 }, fuel: 9,
      status: 'ok', repairAt: 0, blockedSince: 0, nofuelSince: 0,
      out: [], job: 'smeltIron',
    };
    for (let y = sy; y < sy + 2; y++)
      for (let x = sx; x < sx + 2; x++) run.grid[y][x].machine = id;
    let perched = false;
    for (let i = 0; i < 90 * D.TICK_HZ && !perched; i++) {
      S.tick(run);
      run.machines[id].job = 'smeltIron';       // scaffold: keep the fire lit
      run.machines[id].input.ironOre = 8;
      run.machines[id].fuel = 9;
      if (cat.mode === 'perch') perched = true;
    }
    assert(perched, 'the cat finds a lit smelter and sits on it');
    assert(cat.x >= sx && cat.x < sx + 2 && cat.y >= sy && cat.y < sy + 2,
      'and the perch is ON the furnace');
    // the smelter is unharmed by being sat on
    assert(run.machines[id].hp === 2 && run.machines[id].job === 'smeltIron',
      'a cat on a smelter costs the smelter nothing');
  }

  {  // THE TELL: she runs before the quake, not after it
    const run = withCat(1111);
    const cat = E.cat(run);
    const c = { x: run.hub.x + 1, y: run.hub.y + 1 };
    const dist = () => Math.max(Math.abs(cat.x - c.x), Math.abs(cat.y - c.y));
    run.instability = 60;                       // scaffold: quakes are scheduled
    let flees = 0, quakes = 0, lateFlees = 0, closedIn = 0;
    let armed = 0, distAtArm = 0;
    for (let i = 0; i < 300 * D.TICK_HZ; i++) {
      const before = run.quakeAt;
      S.tick(run);
      run.instability = 60;                     // hold the pressure steady
      run.integrity = run.maxIntegrity;         // and keep her human alive
      const fleeing = run.quakeAt > 0 &&
        run.quakeAt - run.t <= D.EVENTS.catFlee * D.TICK_HZ;
      if (fleeing) {
        if (!armed) { armed = 1; distAtArm = dist(); flees++; }
        if (cat.mode !== 'flee') lateFlees++;
      } else if (armed) {
        armed = 0;
      }
      // the tick a quake actually lands on: quakeAt was armed and is now spent
      if (before > 0 && run.quakeAt === 0 && run.t >= before) {
        quakes++;
        if (dist() <= distAtArm) closedIn++;
        assert(E.cat(run) === cat, 'the quake did not take the cat');
      }
    }
    assert(quakes >= 5, 'the scaffold produced quakes to flee (' + quakes + ')');
    assert(flees >= 5, 'the cat had a flee window before each of them');
    assert(lateFlees === 0,
      'the cat is already fleeing for the whole window (' + lateFlees + ' late ticks)');
    assert(closedIn === quakes,
      'and she is closer to the rig when it lands, every time (' +
      closedIn + '/' + quakes + ')');
  }

  {  // a descent re-homes her: the rig is rebuilt around her every floor
    const run = withCat(1212);
    const cat = E.cat(run);
    for (let i = 0; i < 40; i++) S.tick(run);
    run.depth = 2;
    S.startStratum(run);
    E.state(run);
    assert(run.grid[cat.y][cat.x].t === 'floor',
      'the cat lands on floor on the new stratum, not in rock');
  }

  {  // and the promise that lets her exist at all
    function stream(withCatToo) {
      const run = S.newRun(eff, 1313);
      if (withCatToo) E.grantCat(run);
      for (let i = 0; i < 200 * D.TICK_HZ; i++) S.tick(run);
      return [run.rng(), run.rng(), run.rng(), run.integrity, run.instability].join(',');
    }
    assertEqJSON(stream(true), stream(false),
      'a run with a cat in it is the same run as one without');
  }
  return 'cat: wanders, perches, flees';
}

// ------------------------------------------------ M-ONBOARD: the diagnostics
// THE reason this brief exists. The director could not play his own game while
// every suite here was green: an extractor placed on a revealed vein with no
// belt on its output mines an ore, sets status 'blocked', and sits there
// forever emitting NOTHING. The bot in test/balance.js has never once failed to
// connect an extractor, because it knows the rules by construction — so a green
// sweep proved the game winnable and said nothing at all about whether it was
// playable. This section tests the second property.
//
// Every scenario below runs on its own fresh run, because the whole contract is
// "once per run per cause" and shared runs would hide a cause that never fired.

// A revealed, buildable ore tile, preferring `ore` when asked for one.
function freeVein(r, ore) {
  let any = null;
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) {
      const t = r.grid[y][x];
      if (!t.revealed || !t.ore || t.oreAmt <= 0) continue;
      if (t.t !== 'floor' || t.rubble || t.machine !== null || t.belt || t.lm) continue;
      if (!ore || t.ore === ore) return { x: x, y: y, t: t };
      if (!any) any = { x: x, y: y, t: t };
    }
  return any;
}
// Somewhere `type` will actually go, asked of the sim rather than guessed —
// a 2x2 smelter needs four clear tiles and the first bare floor on the map is
// usually not one of them. `pad` also demands that many clear tiles to the
// WEST, for the belt-feeds-machine scenarios.
function freeSpot(r, type, pad) {
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) {
      if (!S.canPlace(r, type, x, y, 1).ok) continue;
      let clear = true;
      for (let i = 1; i <= (pad || 0); i++)
        if (!S.canPlace(r, 'belt', x - i, y, 1).ok) { clear = false; break; }
      if (clear) return { x: x, y: y, t: r.grid[y][x] };
    }
  return null;
}
function texts(r) { return r.messages.map((m) => m.text); }
function countMsg(r, needle) {
  return texts(r).filter((t) => t.indexOf(needle) >= 0).length;
}
function tickRun(r, n) { for (let i = 0; i < n; i++) S.tick(r); }

function checkDiagnostics() {
  // ---- THE REPRODUCTION -------------------------------------------------
  // Verbatim from the brief: an extractor on a revealed vein, NO belt on its
  // output side, 600 ticks. Before this brief that produced zero messages.
  {
    const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), 12345);
    const v = freeVein(r);
    assert(v, 'the reproduction needs a revealed vein to build on');
    assert(S.place(r, 'extractor', v.x, v.y, 1), 'could not place the extractor');
    const want = S.diagLine('blocked', { name: D.BUILDINGS.extractor.name });
    let namedAt = -1;
    for (let i = 0; i < 600; i++) {
      S.tick(r);
      if (namedAt < 0 && countMsg(r, want)) namedAt = i + 1;
    }
    const m = Object.keys(r.machines).map((k) => r.machines[k])
      .filter((x) => x.type === 'extractor')[0];
    assertEq(m.status, 'blocked', 'the reproduction must still reproduce the STATE');
    assert(namedAt > 0,
      'THE BUG: 600 ticks with a blocked extractor and the LOG never named the cause');
    // It has to arrive while the player is still looking at the thing they just
    // placed, not five minutes later.
    assert(namedAt <= (D.DIAG.blockedT + 4) * D.TICK_HZ,
      'the blocked cause took ' + namedAt + ' ticks to reach the LOG');
    // ...and the fix must be in the sentence, not just the fault.
    assert(/belt/i.test(want) && /output/i.test(want),
      'the blocked line names the fault but not the fix: ' + want);
  }

  // ---- once per run per CAUSE, not per machine and not per tick ----------
  // A message that repeats is a message players learn to ignore.
  {
    const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), 909);
    const a = freeVein(r);
    assert(S.place(r, 'extractor', a.x, a.y, 1), 'first extractor placed');
    tickRun(r, 400);
    // a SECOND machine hitting the same cause must stay silent
    const b = freeVein(r);
    assert(b && (b.x !== a.x || b.y !== a.y), 'a second free vein for the repeat test');
    assert(S.place(r, 'extractor', b.x, b.y, 1), 'second extractor placed');
    tickRun(r, 600);
    const want = S.diagLine('blocked', { name: D.BUILDINGS.extractor.name });
    assertEq(countMsg(r, want), 1,
      'the blocked cause was named ' + countMsg(r, want) + ' times in one run');
    assertEq(r.diag.blocked > 0, true, 'the cause is stamped on the run');
  }

  // ---- every failure state in the brief names itself ---------------------
  const named = [];
  function scenario(label, seed, build, ticks, cause, ctx) {
    const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), seed);
    build(r);
    tickRun(r, ticks);
    const want = S.diagLine(cause, ctx || {});
    assert(want, 'diagLine has wording for ' + cause);
    assertEq(countMsg(r, want), 1,
      label + ': expected exactly one "' + want + '", got ' + countMsg(r, want) +
      ' — log was:\n    ' + texts(r).join('\n    '));
    named.push(cause);
    return r;
  }

  // out of fuel: a smelter with ore to melt and no coal to melt it with
  scenario('nofuel', 4242, (r) => {
    r.inv.ironPlate = 999;
    const f = freeSpot(r, 'smelter');
    assert(f && S.place(r, 'smelter', f.x, f.y, 1), 'smelter placed');
    const sm = r.machines[r.nextId - 1];
    sm.input.ironOre = 4;                    // scaffold: ore in, nothing to burn
  }, (D.DIAG.nofuelT + 4) * D.TICK_HZ, 'nofuel', { name: D.BUILDINGS.smelter.name });

  // depleted vein: the last ore comes out and the extractor is a dead pump
  scenario('depleted', 77, (r) => {
    const v = freeVein(r);
    v.t.oreAmt = 1;                          // scaffold: one ore left in the rock
    assert(S.place(r, 'extractor', v.x, v.y, 1), 'extractor placed');
  }, 200, 'depleted');

  // jammed belt, shape one: a line laid into bare ground. Facing 3 is west,
  // and freeSpot's padding guarantees the tile west of it is clear floor —
  // which is precisely the mistake: somewhere for the item to go, and nothing
  // there to take it.
  scenario('beltJam/dead end', 31337, (r) => {
    r.inv.ironPlate = 999;
    const f = freeSpot(r, 'belt', 1);
    assert(f && S.place(r, 'belt', f.x, f.y, 3), 'belt placed');
    f.t.belt.item = 'ironOre';               // scaffold: give it something to carry
  }, (D.DIAG.beltJamT + 4) * D.TICK_HZ, 'beltJam');

  // a starving assembler: it has the recipe and nothing to build it from
  scenario('starved', 2024, (r) => {
    r.inv.ironPlate = 999;
    const f = freeSpot(r, 'assembler');
    assert(f && S.place(r, 'assembler', f.x, f.y, 1), 'assembler placed');
  }, (D.DIAG.starveT + 4) * D.TICK_HZ, 'starved',
     { id: 'ironPlate', item: D.ITEMS.ironPlate.name });

  // the rig, stalled for want of a specific item
  scenario('stallGear', 5150, () => {}, (D.DIAG.stallT + 4) * D.TICK_HZ, 'stallGear');
  scenario('stallCharge', 5151, (r) => {
    r.gearsFed = r.breachReq.gear;           // scaffold: gears done, charges are not
    r.breachReq.charge = 4;
  }, (D.DIAG.stallT + 4) * D.TICK_HZ, 'stallCharge');

  // jammed belt, shape two: a line into something that will never want its
  // cargo. This is the branch that must NOT fire on a merely-full buffer.
  {
    const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), 616);
    r.inv.ironPlate = 999; r.inv.copperPlate = 999;
    const f = freeSpot(r, 'damper', 1);
    assert(f && S.place(r, 'damper', f.x, f.y, 1), 'damper placed');
    // a belt one tile west of the damper, pointing east into it, carrying
    // something a damper will never burn
    const bx = f.x - 1, by = f.y;
    assert(S.place(r, 'belt', bx, by, 1), 'belt placed west of the damper');
    r.grid[by][bx].belt.item = 'ironPlate';
    tickRun(r, (D.DIAG.beltJamT + 4) * D.TICK_HZ);
    const want = S.diagLine('beltJam',
      { name: D.BUILDINGS.damper.name, item: D.ITEMS.ironPlate.name });
    assertEq(countMsg(r, want), 1,
      'a belt feeding a machine that refuses its cargo must say so — log was:\n    ' +
      texts(r).join('\n    '));
  }

  // back-pressure is NOT a mistake and must never be taught as one: a belt
  // stopped against a machine that wants its cargo but is full is a tuning
  // question, and the machine's own 'blocked' line already covers that story.
  {
    const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), 8080);
    r.inv.ironPlate = 999; r.inv.copperPlate = 999;
    const f = freeSpot(r, 'damper', 1);
    assert(f && S.place(r, 'damper', f.x, f.y, 1), 'damper placed');
    const dm = r.machines[r.nextId - 1];
    dm.input.coal = D.INPUT_CAP;             // scaffold: buffer full, wants more
    const bx = f.x - 1, by = f.y;
    assert(S.place(r, 'belt', bx, by, 1), 'belt placed west of the damper');
    r.grid[by][bx].belt.item = 'coal';
    tickRun(r, (D.DIAG.beltJamT + 6) * D.TICK_HZ);
    assert(!r.diag.beltJam,
      'back-pressure against a full buffer was taught as a belt mistake');
  }

  // ---- determinism: same seed, same inputs, same messages, same order ----
  function scripted(seed) {
    const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), seed);
    const v = freeVein(r);
    S.place(r, 'extractor', v.x, v.y, 1);
    tickRun(r, 700);
    return texts(r).join('\n');
  }
  assertEq(scripted(1234), scripted(1234),
    'two runs on one seed with one script produced different logs');

  // ---- law 7: a player mistake must not move the sim's stream ------------
  // The whole point of the law. These messages fire exactly when somebody has
  // built something wrong, so if naming one cost a draw, the quake schedule
  // would depend on the shape of a base rather than on the tuning — and every
  // number in test/balance.js would drift with it. 400 ticks keeps both runs
  // under D.QUAKE.startInst, where quake TARGETING (which legitimately reads
  // the built list) cannot confound the comparison.
  {
    const quiet = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), 4711);
    const noisy = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), 4711);
    const v = freeVein(noisy);
    assert(S.place(noisy, 'extractor', v.x, v.y, 1), 'extractor placed');
    tickRun(quiet, 400);
    tickRun(noisy, 400);
    assert(noisy.diag.blocked, 'the noisy run must actually have fired a diagnostic');
    assert(quiet.instability < D.QUAKE.startInst, 'the comparison stays pre-quake');
    assertEq(noisy.rng(), quiet.rng(),
      'naming a fault advanced run.rng — a disconnected belt moved the quake schedule');
  }

  return named.length;
}

// ======================================================================
// A machine whose OUTPUT POINTS AT THE RIG feeds it directly — no belt for
// that last tile. This has always worked; the test exists because nothing
// pinned it, and M-TIER2 is about to rewrite belt handoff underneath it.
//
// The rule is FACING, not adjacency (director, 2026-08-14, explicitly: "i
// want to go to the rig if the output is faced to the rig, not if it only
// is adjacent to it"). A machine parked against the rig pointing the wrong
// way must still fail, because a belt only ever hands its cargo to the tile
// it faces and machines must obey the same rule the player is being taught.
// ======================================================================
function checkRigOutput() {
  const eff = DC.Meta.effects(DC.Meta.newProfile());

  // A smelter at hub-relative (dx, dy) pointed `facing`, fed by hand, with no
  // belt anywhere. Returns plates that reached the rig (START_STOCK seeds 40,
  // so measure the delta, never the total).
  function delivered(dx, dy, facing) {
    const run = S.newRun(eff, 1337);
    const h = run.hub, x = h.x + dx, y = h.y + dy;
    const chk = S.canPlace(run, 'smelter', x, y, facing);
    assert(chk.ok, 'scaffold: smelter placeable at hub' +
      (dx >= 0 ? '+' : '') + dx + ',' + (dy >= 0 ? '+' : '') + dy +
      ' (got: ' + chk.reason + ')');
    S.place(run, 'smelter', x, y, facing);
    const m = run.machines[run.grid[y][x].machine];
    m.input = { ironOre: 12 };
    m.fuel = 99;
    const before = run.inv.ironPlate || 0;
    for (let i = 0; i < 400; i++) S.tick(run);
    return (run.inv.ironPlate || 0) - before;
  }

  assertEq(delivered(0, -2, 2), 12,
    'a smelter above the rig, output pointing DOWN into it, needs no belt');
  assertEq(delivered(-2, 0, 1), 12,
    'a smelter left of the rig, output pointing RIGHT into it, needs no belt');
  assertEq(delivered(0, -2, 0), 0,
    'the same smelter pointing AWAY delivers nothing — facing, not adjacency');
  return 'rig output-facing feed ok';
}

// ======================================================================
// M-TIER2 — Logistics II: the five tier-II structures.
//
// The suite scaffolds a FLAT FLOOR around the rig (every tile revealed
// floor, nothing built) and then places real structures through the public
// API on it. A generated map cannot be relied on to have a straight open
// run of eight tiles beside the rig on every seed, and this section is
// about the structures' rules, not about procgen's generosity.
//
// What it holds them to, in order: they are sealed until their stratum;
// every one of them obeys FACING, NOT ADJACENCY; the network they form
// carries at the belt's rate and no slower; and none of them spends from
// run.rng (SPEC3 §0 law 7).
// ======================================================================
function flatRun(seed, depth) {
  const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), seed || 1337);
  r.depth = depth === undefined ? D.BUILDINGS.splitter.unlockDepth : depth;
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) {
      const t = r.grid[y][x];
      t.revealed = true;
      if (t.machine === 0) continue;                 // the rig stays put
      t.t = 'floor'; t.machine = null; t.belt = null; t.rubble = false;
      t.digT = 0; t.ore = null; t.oreAmt = 0; t.lm = null;
    }
  r.landmark = null;
  r.inv.ironPlate = 9999; r.inv.copperPlate = 999;   // scaffold: not a cost test
  return r;
}
function machAt(r, x, y) {
  const t = r.grid[y] && r.grid[y][x];
  return (t && t.machine !== null) ? r.machines[t.machine] : null;
}
function beltItems(r) {
  const out = [];
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) {
      const b = r.grid[y][x].belt;
      if (b && b.item) out.push({ x: x, y: y, item: b.item });
    }
  return out;
}

function checkTier2() {
  const T2 = D.BUILD_ORDER.filter(t => !!D.BUILDINGS[t].unlockDepth);
  assert(T2.length === 5, 'M-TIER2 ships five sealed structures (' + T2.join(',') + ')');

  // ---- sealed until their stratum --------------------------------------
  {
    const early = flatRun(2001, 1);
    for (const t of T2) {
      const B = D.BUILDINGS[t];
      assert(B.unlockDepth >= 2, t + ' is sealed at all');
      assertEq(S.unlocked(early, t), false, t + ' is locked on stratum 1');
      const chk = S.canPlace(early, t, early.hub.x - 6, early.hub.y, 1);
      assertEq(chk.ok, false, t + ' cannot be placed on stratum 1');
      assert(/stratum/.test(chk.reason), t + "'s refusal names the stratum: " + chk.reason);
      assertEq(S.place(early, t, early.hub.x - 6, early.hub.y, 1), false,
        t + ' cannot be forced past the seal');
    }
    const late = flatRun(2001, D.BUILDINGS.splitter.unlockDepth);
    for (const t of T2)
      assertEq(S.unlocked(late, t), true, t + ' is unlocked on its own stratum');
    // ...and the opening two floors are untouched: the four-machine lesson
    for (const t of D.BUILD_ORDER.filter(k => !D.BUILDINGS[k].unlockDepth))
      assertEq(S.unlocked(early, t), true, t + ' is available from stratum 1');
  }

  // ---- THE RULE: facing, not adjacency ---------------------------------
  // Every structure is asked the same question the rig is asked in
  // checkRigOutput: does it take cargo from a thing that is merely NEXT to
  // it? The answer has to be no, five times, or the game's own lesson about
  // belts is a lie the moment a player unlocks tier II.
  {
    const r = flatRun(2002);
    const hx = r.hub.x, hy = r.hub.y;
    // a smelter with a full ore buffer, and a taker parked beside it
    function feeder(x, y, facing) {
      assert(S.place(r, 'smelter', x, y, facing), 'scaffold smelter at ' + x + ',' + y);
      const m = machAt(r, x, y);
      m.input = { ironOre: 8 }; m.fuel = 99;
      return m;
    }
    // (a) a LOADER only empties the machine its own arrow comes out of. The
    // first one is TOUCHING the smelter and aimed across it; the second is
    // one tile further on and aimed out of it. Same distance, opposite result.
    const sm = feeder(hx - 10, hy + 4, 0);             // faces north, into floor
    assert(S.place(r, 'loader', sm.x + 1, sm.y - 1, 1), 'loader placed beside the smelter');
    const side = machAt(r, sm.x + 1, sm.y - 1);
    tickRun(r, 200);
    assertEq(side.out.length, 0,
      'a loader NEXT TO a machine takes nothing — adjacency is not a connection');
    S.demolishAt(r, side.x, side.y);
    // the same loader, one tile on, with its arrow pointing out of the smelter
    assert(S.place(r, 'loader', sm.x + sm.w, sm.y, 1), 'loader placed on the smelter');
    const puller = machAt(r, sm.x + sm.w, sm.y);
    tickRun(r, 100);
    assertEq(puller.out.length > 0 || (r.grid[puller.y][puller.x + 1].belt || {}).item != null,
      true, 'a loader whose arrow leaves the machine empties it');
  }
  {
    // (b) a belt beside a splitter/filter/tunnel hands it nothing; a belt
    // POINTED at one hands it everything.
    for (const type of ['splitter', 'filter', 'tunnel']) {
      const r = flatRun(2003);
      const x = r.hub.x - 8, y = r.hub.y;
      assert(S.place(r, type, x, y, 1), type + ' placed');
      const m = machAt(r, x, y);
      if (type === 'tunnel') {                        // give it a far end
        assert(S.place(r, 'tunnel', x + 3, y, 1), 'the tunnel gets its pair');
      }
      // a belt ALONGSIDE it, running past into another belt
      assert(S.place(r, 'belt', x, y - 1, 1), 'belt laid alongside');
      assert(S.place(r, 'belt', x + 1, y - 1, 1), '...and one for it to run into');
      r.grid[y - 1][x].belt.item = 'ironOre';
      tickRun(r, 8);
      assertEq(m.out.length, 0, type + ' took cargo off a belt that merely passed it');
      assertEq(r.grid[y - 1][x].belt.item, null, 'that belt moved its cargo on as usual');
      // and now one that points AT it
      assert(S.place(r, 'belt', x - 1, y, 1), 'belt laid into it');
      r.grid[y][x - 1].belt.item = 'ironOre';
      tickRun(r, 4);
      assertEq(r.grid[y][x - 1].belt.item, null, type + ' took the cargo aimed at it');
    }
  }

  // ---- the splitter ----------------------------------------------------
  {
    const r = flatRun(2004);
    const x = r.hub.x - 8, y = r.hub.y;
    assert(S.place(r, 'splitter', x, y, 1), 'splitter placed facing east');
    const m = machAt(r, x, y);
    assert(S.place(r, 'belt', x, y - 1, 0), 'left catcher');
    assert(S.place(r, 'belt', x, y + 1, 2), 'right catcher');
    // 12 items in, and they come out 6 and 6
    const got = { n: 0, s: 0 };
    for (let i = 0; i < 12; i++) {
      m.out.length = 0; m.out.push('ironOre'); m.moveT = r.t;
      tickRun(r, D.BELT_PERIOD);
      if (r.grid[y - 1][x].belt.item) { got.n++; r.grid[y - 1][x].belt.item = null; }
      if (r.grid[y + 1][x].belt.item) { got.s++; r.grid[y + 1][x].belt.item = null; }
    }
    assertEq(got.n, 6, 'the splitter sent half its cargo left');
    assertEq(got.s, 6, 'and half right');
    // one side jammed: everything goes the other way, because a splitter that
    // stalls on a dead branch is a jam the player did not build
    S.demolishAt(r, x, y - 1);
    let right = 0;
    for (let i = 0; i < 6; i++) {
      m.out.length = 0; m.out.push('ironOre'); m.moveT = r.t;
      tickRun(r, D.BELT_PERIOD);
      if (r.grid[y + 1][x].belt.item) { right++; r.grid[y + 1][x].belt.item = null; }
    }
    assertEq(right, 6, 'with one side dead the splitter feeds the live one, every time');
    // ...and with both dead it holds, which IS back-pressure
    S.demolishAt(r, x, y + 1);
    m.out.length = 0; m.out.push('ironOre'); m.moveT = r.t;
    tickRun(r, 4 * D.BELT_PERIOD);
    assertEq(m.out.length, 1, 'a splitter with nowhere to go holds its cargo');
    // Trident Yokes opens the third arrow
    assertEq(S.outputTiles(r, m).length, 2, 'two arrows by default');
    r.mods.split3 = true;
    assertEq(S.outputTiles(r, m).length, 3, 'three with Trident Yokes');
    assert(S.place(r, 'belt', x + 1, y, 1), 'a catcher straight ahead');
    tickRun(r, 2 * D.BELT_PERIOD);
    assertEq(r.grid[y][x + 1].belt.item, 'ironOre', 'and it uses it');
  }

  // ---- the underground pair --------------------------------------------
  {
    const r = flatRun(2005);
    const y = r.hub.y, x = r.hub.x - 12;
    const gap = D.BUILDINGS.tunnel.gap;
    assert(S.place(r, 'tunnel', x, y, 1), 'entrance placed');
    const a = machAt(r, x, y);
    assertEq(a.mode, 'in', 'a lone tunnel is an entrance');
    assertEq(a.pair, 0, '...with no far end');
    assertEq(machineStatusAfter(r, a), 'unpaired', 'and it says so');
    assertEq(S.machineAccepts === undefined, true, 'accepts stays private');
    // a lonely entrance takes nothing: better a line that backs up in front of
    // the player than one that swallows cargo into a hole with no far side
    assert(S.place(r, 'belt', x - 1, y, 1), 'a belt into the lonely entrance');
    r.grid[y][x - 1].belt.item = 'coal';
    tickRun(r, 4);
    assertEq(r.grid[y][x - 1].belt.item, 'coal', 'a half-built tunnel eats nothing');
    // the far end, across a chasm nothing else crosses
    for (let k = 1; k <= gap; k++) r.grid[y][x + k].t = 'chasm';
    assertEq(S.canPlace(r, 'belt', x + 1, y, 1).ok, false, 'a belt cannot cross the chasm');
    assert(S.place(r, 'tunnel', x + gap + 1, y, 1), 'exit placed beyond the chasm');
    const b = machAt(r, x + gap + 1, y);
    assertEq(a.pair, b.id, 'the two ends found each other');
    assertEq(b.mode, 'out', 'the far one is the exit');
    assert(S.place(r, 'belt', x + gap + 2, y, 1), 'a belt off the exit');
    tickRun(r, 6 * D.BELT_PERIOD);
    assertEq(r.grid[y][x + gap + 2].belt.item, 'coal', 'the cargo crossed the chasm');
    // too far is too far
    assertEq(S.place(r, 'tunnel', x + gap + 1 + gap + 2, y + 2, 1), true, 'a far pair placed');
    const c = machAt(r, x + gap + 1 + gap + 2, y + 2);
    assertEq(c.pair, 0, 'a tunnel out of range pairs with nothing');
    // Deep Conduits doubles the span
    const r2 = flatRun(2006);
    r2.mods.tunnelMult = 2;
    assertEq(S.tunnelGap(r2), gap * 2, 'Deep Conduits doubles the reach');
    assert(S.place(r2, 'tunnel', x, y, 1) && S.place(r2, 'tunnel', x + gap * 2 + 1, y, 1),
      'both ends placed at the doubled span');
    assert(machAt(r2, x, y).pair, 'and they pair at a distance the base pair cannot');
    // reverse order works too: the second one placed becomes the entrance
    const r3 = flatRun(2007);
    assert(S.place(r3, 'tunnel', x + 3, y, 1), 'the far end goes down first');
    assert(S.place(r3, 'tunnel', x, y, 1), 'the near end second');
    assertEq(machAt(r3, x, y).mode, 'in', 'the upstream end is the entrance');
    assertEq(machAt(r3, x + 3, y).mode, 'out', 'the downstream end is the exit');
    // and losing one end makes the other lonely again rather than a cargo hole
    S.demolishAt(r3, x + 3, y);
    S.tick(r3);
    assertEq(machAt(r3, x, y).pair, 0, 'the survivor is unpaired');
    assertEq(machAt(r3, x, y).status, 'unpaired', 'and marked');
  }

  // ---- the loader ------------------------------------------------------
  {
    // The exact failure it exists for: an extractor whose output side is
    // buried, which mines one ore and then sits there being correct.
    const r = flatRun(2008);
    const x = r.hub.x - 9, y = r.hub.y;
    r.grid[y][x].ore = 'ironOre'; r.grid[y][x].oreAmt = 99;
    assert(S.place(r, 'extractor', x, y, 1), 'extractor on the vein, facing east');
    r.grid[y][x + 1].t = 'rock';                       // its output is a wall
    tickRun(r, 60);
    const ex = machAt(r, x, y);
    assertEq(ex.status, 'blocked', 'the extractor really is stuck');
    assert(S.place(r, 'loader', x, y - 1, 0), 'loader above it, facing north');
    assert(S.place(r, 'belt', x, y - 2, 0), 'a belt off the loader');
    tickRun(r, 40);
    assertEq(r.grid[y - 2][x].belt.item, 'ironOre', 'the loader gave it a second output');
    // and it keeps the machine running rather than draining it once
    r.grid[y - 2][x].belt.item = null;
    tickRun(r, 40);
    assertEq(r.grid[y - 2][x].belt.item, 'ironOre', 'the extractor is producing again');
    // a loader with nothing behind it is inert, not an error
    const r2 = flatRun(2009);
    assert(S.place(r2, 'loader', x, y, 1), 'a loader on bare floor');
    tickRun(r2, 40);
    assertEq(machAt(r2, x, y).status, 'idle', 'a loader with nothing behind it idles');
  }

  // ---- the filter gate -------------------------------------------------
  {
    const r = flatRun(2010);
    const x = r.hub.x - 8, y = r.hub.y;
    assert(S.place(r, 'filter', x, y, 1), 'gate placed');
    const g = machAt(r, x, y);
    assertEq(g.filter, D.ITEM_ORDER[0], 'a new gate passes the first cargo in the order');
    assert(S.place(r, 'belt', x - 1, y, 1) && S.place(r, 'belt', x + 1, y, 1), 'a line through it');
    r.grid[y][x - 1].belt.item = 'coal';
    tickRun(r, 6 * D.BELT_PERIOD);
    assertEq(r.grid[y][x + 1].belt.item, null, 'the gate held the cargo it does not pass');
    assertEq(r.grid[y][x - 1].belt.item, 'coal', '...and the line backed up behind it');
    // clicking cycles it, through every cargo and back
    const seen = [];
    for (let i = 0; i < D.ITEM_ORDER.length; i++) {
      const res = S.clickTile(r, x, y);
      assert(res.handled, 'clicking a gate is handled');
      seen.push(machAt(r, x, y).filter);
    }
    assertEq(seen.length, new Set(seen).size, 'the cycle visits every cargo exactly once');
    assertEq(seen[seen.length - 1], D.ITEM_ORDER[0], 'and comes back round');
    g.filter = 'coal';
    tickRun(r, 6 * D.BELT_PERIOD);
    assertEq(r.grid[y][x + 1].belt.item, 'coal', 'set to coal, it passes coal');
    // Sorting Gates: what it does not pass goes right instead of nowhere
    const r2 = flatRun(2011);
    r2.mods.smartGate = true;
    assert(S.place(r2, 'filter', x, y, 1), 'gate placed');
    machAt(r2, x, y).filter = 'crystal';
    assert(S.place(r2, 'belt', x - 1, y, 1), 'a feed');
    assert(S.place(r2, 'belt', x + 1, y, 1), 'the pass line');
    assert(S.place(r2, 'belt', x, y + 1, 2), 'the shunt line');
    r2.grid[y][x - 1].belt.item = 'coal';
    tickRun(r2, 4 * D.BELT_PERIOD);
    assertEq(r2.grid[y + 1][x].belt.item, 'coal', 'the rest shunts right');
    assertEq(r2.grid[y][x + 1].belt.item, null, 'and does not come out the front');
    r2.grid[y][x - 1].belt.item = 'crystal';
    tickRun(r2, 4 * D.BELT_PERIOD);
    assertEq(r2.grid[y][x + 1].belt.item, 'crystal', 'while its own cargo goes straight through');
  }

  // ---- the crusher -----------------------------------------------------
  {
    const r = flatRun(2012);
    const x = r.hub.x - 10, y = r.hub.y;
    const B = D.BUILDINGS.crusher;
    assert(S.place(r, 'crusher', x, y, 1), 'crusher placed');
    const c = machAt(r, x, y);
    tickRun(r, 4);
    assertEq(c.status, 'idle', 'a crusher with no rubble is idle, not broken');
    assertEq(S.chain(r).stages[0].rate, 0, 'and CHAIN says it is making nothing');
    // the quake's leavings, in reach and out of it
    r.grid[y + 3][x].rubble = true;
    r.grid[y][x + 2 + B.reach + 2].rubble = true;      // deliberately too far
    assert(S.place(r, 'belt', x + B.w, y, 1), 'a belt off its arrow');
    tickRun(r, B.period + 4);
    assertEq(r.grid[y + 3][x].rubble, false, 'the rubble in reach is gone');
    assertEq(r.grid[y][x + 2 + B.reach + 2].rubble, true, 'the rubble out of reach is not');
    let ore = (r.grid[y][x + B.w].belt.item === 'ironOre' ? 1 : 0) + c.out.length;
    assertEq(ore, B.yield, 'one rubble tile paid ' + B.yield + ' iron ore');
    // Rock Grinders: it eats the wall too, and slower per tile
    const r2 = flatRun(2013);
    r2.mods.crushRock = true;
    assert(S.place(r2, 'crusher', x, y, 1), 'crusher placed');
    r2.grid[y + 3][x].t = 'rock';
    assert(S.place(r2, 'belt', x + B.w, y, 1), 'a belt off its arrow');
    tickRun(r2, B.period + 4);
    assertEq(r2.grid[y + 3][x].t, 'floor', 'the wall came down');
    ore = (r2.grid[y][x + B.w].belt.item === 'ironOre' ? 1 : 0) + machAt(r2, x, y).out.length;
    assertEq(ore, B.rockYield, 'rock pays ' + B.rockYield + ', less than rubble');
    // ...and without the schematic the wall is just a wall
    const r3 = flatRun(2014);
    assert(S.place(r3, 'crusher', x, y, 1), 'crusher placed');
    r3.grid[y + 3][x].t = 'rock';
    tickRun(r3, B.period * 3);
    assertEq(r3.grid[y + 3][x].t, 'rock', 'a plain crusher does not eat rock');
  }

  // ---- SPEC §12: the line carries faster than anything can fill it ------
  // A mixed run — belts, a splitter, a tunnel pair, a gate — measured
  // end to end, against the fastest single machine in the game.
  {
    const r = flatRun(2015);
    const y = r.hub.y, x0 = r.hub.x - 16;
    // belt, belt, splitter, belt(through the live side), tunnel, gap, tunnel,
    // gate, belt into the rig
    assert(S.place(r, 'belt', x0, y, 1), 'b0');
    assert(S.place(r, 'belt', x0 + 1, y, 1), 'b1');
    assert(S.place(r, 'splitter', x0 + 2, y, 1), 'splitter');
    assert(S.place(r, 'belt', x0 + 2, y + 1, 1), 'the live branch');
    assert(S.place(r, 'belt', x0 + 3, y + 1, 1), 'b2');
    assert(S.place(r, 'tunnel', x0 + 4, y + 1, 1), 'tunnel in');
    assert(S.place(r, 'tunnel', x0 + 7, y + 1, 1), 'tunnel out');
    assert(S.place(r, 'filter', x0 + 8, y + 1, 1), 'gate');
    machAt(r, x0 + 8, y + 1).filter = 'ironOre';
    let bx = x0 + 9;
    while (r.grid[y + 1][bx] && r.grid[y + 1][bx].machine !== 0) {
      assert(S.place(r, 'belt', bx, y + 1, 1), 'run to the rig at ' + bx);
      bx++;
    }
    // feed the head of the line every belt step for a sim-minute
    const before = r.inv.ironOre || 0;
    const secs = 60;
    for (let i = 0; i < secs * D.TICK_HZ; i++) {
      if (i % D.BELT_PERIOD === 0 && !r.grid[y][x0].belt.item)
        r.grid[y][x0].belt.item = 'ironOre';
      S.tick(r);
    }
    const moved = (r.inv.ironOre || 0) - before;
    const perSec = moved / secs;
    const beltRate = D.TICK_HZ / D.BELT_PERIOD;
    assert(perSec > beltRate * 0.9,
      'a mixed tier-II line carries ' + perSec.toFixed(2) + '/s, under the belt rate ' +
      beltRate.toFixed(2));
    // and that is comfortably clear of the fastest thing that can fill it
    let fastest = 0;
    for (const t of D.BUILD_ORDER) {
      const B = D.BUILDINGS[t];
      if (B.period) fastest = Math.max(fastest, D.TICK_HZ / B.period * (B.yield || 1));
    }
    for (const k in D.RECIPES) {
      let n = 0;
      for (const o in D.RECIPES[k].out) n += D.RECIPES[k].out[o];
      fastest = Math.max(fastest, D.TICK_HZ / D.RECIPES[k].ticks * n);
    }
    assert(perSec >= fastest * 2,
      'SPEC §12: the line (' + perSec.toFixed(2) + '/s) must comfortably exceed the ' +
      'fastest machine (' + fastest.toFixed(2) + '/s) — lines may only jam when the ' +
      'player under-builds');
  }

  // ---- law 7: none of it spends from the sim's stream -------------------
  {
    const quiet = flatRun(2016);
    const busy = flatRun(2016);
    const y = busy.hub.y, x = busy.hub.x - 10;
    for (const t of T2) {
      assert(S.place(busy, t, x + T2.indexOf(t) * 3, y + 4, 1), t + ' placed');
    }
    busy.grid[y + 6][x].rubble = true;
    assert(S.place(busy, 'belt', x, y, 1), 'and a belt with cargo on it');
    busy.grid[y][x].belt.item = 'ironOre';
    tickRun(quiet, 600);
    tickRun(busy, 600);
    S.chain(busy); S.chain(busy);
    assertEq(busy.rng(), quiet.rng(),
      'a base full of tier-II structures moved the quake schedule (SPEC3 §0 law 7)');
  }

  return T2.length;
}
// A machine's status after one tick of the sim has looked at it.
function machineStatusAfter(r, m) { S.tick(r); return m.status; }

// ======================================================================
// M-WIDE — Sim.chain: the production chain as numbers
// The CHAIN panel's whole job is to teach the ratio trap, so the model
// behind it is pinned here against the data rather than against itself:
// one smelter is 0.5 plate/s, one gear assembler wants 0.73 plate/s, and
// therefore ONE SMELTER CANNOT FEED ONE ASSEMBLER. If that stops being
// true in data.js, this test says so before a player has to find out.
// ======================================================================
// ------------------------------------------- M-MANTLE: mutators for the deep
// Force the NEXT startStratum to deal a named mutator without disturbing
// anything else. rollMutator is the first thing that draws in startStratum, so
// substituting exactly one number picks the entry and every later draw in that
// stratum is the run's own — which is what makes "this floor, but with the
// mutator" a fair comparison against "this floor" rather than two maps.
function forceMutator(run, id) {
  const table = S.mutatorTable();
  const i = table.findIndex((m) => m.id === id);
  assert(i >= 0, 'mutator ' + id + ' is not in the roll table');
  const base = run.rng;
  let first = true;
  run.rng = function () {
    if (first) { first = false; return (i + 0.5) / table.length; }
    return base();
  };
}
function mantleRun(seed, id, eff) {
  const r = S.newRun(eff || DC.Meta.effects(DC.Meta.newProfile()), seed);
  r.depth = D.MUTATOR_DEPTH;
  r.mantle = true;
  if (id) forceMutator(r, id);
  S.startStratum(r);
  if (id) assertEq(r.mutator, id, 'forced mutator ' + id + ' was dealt');
  return r;
}
function revealAll(r) {
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) r.grid[y][x].revealed = true;
}
function countTiles(r, pred) {
  let n = 0;
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) if (pred(r.grid[y][x], x, y)) n++;
  return n;
}

function checkMutators() {
  const eff = DC.Meta.effects(DC.Meta.newProfile());

  // ---- the table -------------------------------------------------------
  // A mutator whose module is absent is NOT DEALT. It is not a floor that
  // silently does nothing — the entry is filtered out and the roll picks
  // among the rest, which is the contract that lets 'worm season' ship
  // written-and-waiting rather than as dead weight or as a lie.
  const table = S.mutatorTable();
  assert(table.length > 0, 'the roll table is not empty');
  for (const m of table)
    assert(!m.needs || !!DC[m.needs],
      'mutator ' + m.id + ' is dealt but its module ' + m.needs + ' is absent');
  const gated = (D.MUTATORS || []).filter((m) => m.needs && !DC[m.needs]);
  for (const m of gated)
    assert(!table.some((t) => t.id === m.id),
      'gated mutator ' + m.id + ' must not be in the roll table');
  // M-WORMS LANDED, and this is the line that used to say it had not. The
  // contract is proved from the other side now: 'worm season' names a module,
  // that module is loaded, and the floor rule therefore deals itself with no
  // change to the table code that was written before it existed.
  const season = (D.MUTATORS || []).find((m) => m.id === 'worms');
  assertEq(season.needs, 'Worms', "'worm season' still names the module it needs");
  assert(!!DC.Worms, 'and M-WORMS has landed, so it is loaded');
  assert(table.some((m) => m.id === 'worms'),
    "'worm season' is dealt now that DC.Worms exists");

  // ---- the banner ------------------------------------------------------
  // render.js inlays '<space>† NAME — tag<space>' into the divider under the
  // header, which is SB-1 = the map column's width. A pair that does not fit
  // is not drawn at all, so a mutator that overflows would ship its rule
  // INVISIBLE. Held here, where it is a data question.
  const RULE_W = 48;
  for (const m of D.MUTATORS || []) {
    assert(typeof m.name === 'string' && m.name.length > 0, m.id + ' has a name');
    assert(typeof m.tag === 'string' && m.tag.length > 0, m.id + ' has a one-line rule');
    assertEq(m.name, m.name.toUpperCase(), m.id + ' name is the banner\'s caps');
    const inset = ' † ' + m.name + ' — ' + m.tag + ' ';
    assert(inset.length <= RULE_W,
      'mutator ' + m.id + ' banner is ' + inset.length + ' > ' + RULE_W + ' columns');
    assert(m.tag.indexOf('.') < 0, m.id + ' tag is a rule, not a sentence');
  }

  // ---- one roll, at one site, stored (§0 law 7) -------------------------
  {
    const a = S.newRun(eff, 5150);
    a.depth = D.MUTATOR_DEPTH; a.mantle = true;
    S.startStratum(a);
    assert(a.mutator && D.MUTATOR_BY_ID[a.mutator],
      'a Mantle floor deals a mutator from the table');
    // reading it, repeatedly, costs nothing
    const r0 = a.rng();
    const again = S.newRun(eff, 5150);
    again.depth = D.MUTATOR_DEPTH; again.mantle = true;
    S.startStratum(again);
    for (let i = 0; i < 50; i++) { S.mutatorOf(again); S.drillCost(again); S.revealRadius(again); }
    assertEq(again.rng(), r0, 'reading the mutator never advances run.rng');
    assertEq(again.mutator, a.mutator, 'and the same seed deals the same floor');
    // ...and strata 1-8 deal none at all
    const shallow = S.newRun(eff, 5150);
    assertEq(shallow.mutator, null, 'no mutator above the Mantle');
    for (let d = 2; d <= D.STRATA_COUNT; d++) {
      shallow.depth = d;
      S.startStratum(shallow);
      assertEq(shallow.mutator, null, 'no mutator on stratum ' + d);
    }
  }

  // ---- the dark rises --------------------------------------------------
  {
    const r = mantleRun(4242, 'dark', eff);
    const all = D.MAP_W * D.MAP_H;
    assertEq(countTiles(r, (t) => t.revealed), all,
      'the dark rises hands you the whole floor first');
    // the lantern does not grow: that is the mutator
    const r0 = S.revealRadius(r);
    for (let i = 0; i < 8 * 60; i++) S.tick(r);
    assertEq(S.revealRadius(r), r0, 'the scan radius is frozen — it is a lantern');
    assert(r.dark > 0, 'rings of the edge have gone dark');
    const lit = countTiles(r, (t) => t.revealed);
    assert(lit < all, 'the map has un-drawn itself (' + lit + '/' + all + ')');
    // ...and what is left lit is the disc around the rig, still lit
    const cx = r.hub.x + 1, cy = r.hub.y + 1;
    assert(r.grid[cy][cx].revealed, 'the rig itself is never dark');
    let inDisc = 0;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const edge = Math.min(x, y, D.MAP_W - 1 - x, D.MAP_H - 1 - y);
        if (edge >= r.dark && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r0 * r0) {
          assert(r.grid[y][x].revealed, 'the lamp relights its own disc at ' + x + ',' + y);
          inDisc++;
        }
      }
    assert(inDisc > 0, 'the lantern disc survived the dark');
    // un-revealed ground is un-buildable ground: the mutator has teeth
    let dark = null;
    for (let y = 0; y < D.MAP_H && !dark; y++)
      for (let x = 0; x < D.MAP_W && !dark; x++)
        if (!r.grid[y][x].revealed && r.grid[y][x].t === 'floor') dark = { x: x, y: y };
    if (dark) {
      r.inv.ironPlate = 999;
      assertEq(S.canPlace(r, 'belt', dark.x, dark.y, 1).reason, 'unscanned ground',
        'the dark takes the ground back, not just the picture of it');
    }
    // and a floor WITHOUT the mutator still sweeps open the way it always did
    const plain = mantleRun(4242, 'seal', eff);
    for (let i = 0; i < 8 * 60; i++) S.tick(plain);
    assert(S.revealRadius(plain) > r0, 'an ordinary floor still grows its sweep');
    assertEq(plain.dark, 0, 'and nothing goes dark on it');
  }

  // ---- hungry drill ----------------------------------------------------
  {
    const r = mantleRun(777, 'hungry', eff);
    const def = D.MUTATOR_BY_ID.hungry;
    assertEq(S.drillCost(r), def.gearCost, 'the drill takes two gears a bite');
    const plain = mantleRun(777, 'seal', eff);
    assertEq(S.drillCost(plain), 1, 'and one on every other floor');
    // she bites faster: the same stock is spent sooner AND further
    r.inv.gear = 40; r.breachReq = { gear: 100, charge: 0 };
    plain.inv.gear = 40; plain.breachReq = { gear: 100, charge: 0 };
    for (let i = 0; i < 8 * 20; i++) { S.tick(r); S.tick(plain); }
    assertEq(r.inv.gear, 0, 'a hungry drill empties a 40-gear crate inside 20s');
    assert(r.gearsFed === 20, 'and banks exactly half of it as progress (' + r.gearsFed + ')');
    assert(plain.inv.gear > 0, 'an ordinary drill is still chewing (' + plain.inv.gear + ')');
    assert(plain.gearsFed < r.gearsFed * 2,
      'the hungry drill is genuinely faster per gear-second, not merely greedier');
    // a crate of one is a stalled rig, not a slow one
    r.inv.gear = 1;
    const fed = r.gearsFed;
    for (let i = 0; i < 8 * 10; i++) S.tick(r);
    assertEq(r.gearsFed, fed, 'one gear does not buy a two-gear bite');
    // ...and the projection is measured in BITES
    const ch = S.chain(r);
    assertEq(ch.drillCost, def.gearCost, 'CHAIN reports the cost of a bite');
  }

  // ---- cold seam -------------------------------------------------------
  {
    // Mapgen is held to the rule over many floors, because this is the one
    // mutator that can generate an UNWINNABLE map: no coal anywhere means no
    // plates unless a smelter can reach the lava.
    let coalTiles = 0, minMagma = Infinity, pads = 0, maps = 0;
    for (let s = 1; s <= 60; s++) {
      const r = mantleRun(s * 7919 + 11, 'coldseam', eff);
      maps++;
      coalTiles += countTiles(r, (t) => t.ore === 'coal');
      minMagma = Math.min(minMagma, countTiles(r, (t) => t.t === 'magma'));
      // walkable-or-diggable set from the rig
      const seen = new Set();
      const q = [[r.hub.x + 1, r.hub.y + 1]];
      seen.add((r.hub.y + 1) * D.MAP_W + (r.hub.x + 1));
      while (q.length) {
        const c = q.pop();
        for (const d of D.DIRS) {
          const nx = c[0] + d.dx, ny = c[1] + d.dy;
          if (nx < 0 || ny < 0 || nx >= D.MAP_W || ny >= D.MAP_H) continue;
          const k = ny * D.MAP_W + nx;
          if (seen.has(k)) continue;
          const t = r.grid[ny][nx];
          if (t.t !== 'floor' && t.t !== 'rock') continue;
          seen.add(k); q.push([nx, ny]);
        }
      }
      const lava = (x, y) => {
        for (const d of D.DIRS) {
          const nx = x + d.dx, ny = y + d.dy;
          if (nx >= 0 && ny >= 0 && nx < D.MAP_W && ny < D.MAP_H &&
              r.grid[ny][nx].t === 'magma') return true;
        }
        return false;
      };
      let ok = false;
      const B = D.BUILDINGS.smelter;
      for (let y = 1; y < D.MAP_H - B.h && !ok; y++)
        for (let x = 1; x < D.MAP_W - B.w && !ok; x++) {
          let stand = true, touch = false;
          for (let dy = 0; dy < B.h; dy++)
            for (let dx = 0; dx < B.w; dx++) {
              const t = r.grid[y + dy][x + dx];
              if (t.ore || t.machine !== null || t.lm ||
                  (t.t !== 'floor' && t.t !== 'rock')) stand = false;
              if (lava(x + dx, y + dy)) touch = true;
            }
          if (stand && touch && seen.has(y * D.MAP_W + x)) ok = true;
        }
      if (ok) pads++;
    }
    assertEq(coalTiles, 0, 'cold seam leaves no coal in the rock at all');
    assert(minMagma >= 3 * (D.MUTATOR_BY_ID.coldseam.magma || 2),
      'every cold seam floor carries its pools (min ' + minMagma + ')');
    assertEq(pads, maps,
      'every cold seam floor has a REACHABLE smelter pad on the lava (' +
      pads + '/' + maps + ')');

    // the two smelters: one at the forge, one anywhere else
    const r = mantleRun(4242, 'coldseam', eff);
    revealAll(r);
    r.inv.ironPlate = 999;
    const lava = (x, y) => {
      for (const d of D.DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx >= 0 && ny >= 0 && nx < D.MAP_W && ny < D.MAP_H &&
            r.grid[ny][nx].t === 'magma') return true;
      }
      return false;
    };
    const free = (x, y) => {
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const t = r.grid[y + dy][x + dx];
          if (t.ore || t.machine !== null || t.lm ||
              (t.t !== 'floor' && t.t !== 'rock')) return false;
        }
      return true;
    };
    const near = (x, y, R) => {
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= D.MAP_W || ny >= D.MAP_H) continue;
          if (r.grid[ny][nx].t === 'magma') return true;
        }
      return false;
    };
    let hot = null, cold = null;
    for (let y = 1; y < D.MAP_H - 2; y++)
      for (let x = 1; x < D.MAP_W - 2; x++) {
        if (!free(x, y)) continue;
        const t = lava(x, y) || lava(x + 1, y) || lava(x, y + 1) || lava(x + 1, y + 1);
        if (t && !hot) hot = { x: x, y: y };
        if (!near(x, y, 3) && !cold) cold = { x: x, y: y };
      }
    assert(hot && cold, 'the test floor offers a forge pad and a cold pad');
    for (const p of [hot, cold])
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const t = r.grid[p.y + dy][p.x + dx];
          if (t.t === 'rock') t.t = 'floor';       // the player would dig it
        }
    assert(S.place(r, 'smelter', hot.x, hot.y, 1), 'a smelter stands at the forge');
    assert(S.place(r, 'smelter', cold.x, cold.y, 1), 'and one stands away from it');
    const ms = Object.keys(r.machines).map((k) => r.machines[k])
      .filter((m) => m.type === 'smelter');
    const H = ms.filter((m) => m.x === hot.x && m.y === hot.y)[0];
    const K = ms.filter((m) => m.x === cold.x && m.y === cold.y)[0];
    assert(H && K, 'both smelters exist');
    assert(S.forgeSmelter(r, H), 'the one on the lava is a forge');
    assert(!S.forgeSmelter(r, K), 'the one away from it is not');
    assert(S.coldSmelter(r, K), 'and cold seam calls it cold');
    assert(!S.coldSmelter(r, H), 'the forge is never cold');
    // ore, and deliberately coal too: the cold one still will not run
    H.input.ironOre = 8; K.input.ironOre = 8; K.input.coal = 8;
    for (let i = 0; i < 8 * 40; i++) S.tick(r);
    assertEq(H.status, 'blocked', 'the forge smelted with no coal and filled up');
    assert(H.out.length > 0 || (r.inv.ironPlate || 0) > 999, 'the forge made plates');
    assertEq(H.fuel, 0, 'and it burned none of its own fuel doing it');
    assertEq(H.hp, D.BUILDINGS.smelter.hp,
      'the lava does not eat the smith it is smelting for');
    const K2 = r.machines[K.id];
    assert(K2, 'the cold smelter still exists');
    assertEq(K2.status, 'cold', 'a smelter off the seam reads cold, not out-of-fuel');
    assertEq(K2.input.ironOre, 8, 'and it has not touched its ore');
    assertEq(K2.input.coal, 8, '...nor its coal, which is not the problem');
    assert(S.STATUS_HINT.cold && S.STATUS_HINT.cold.length <= S.SCAN_W,
      "the '!' legend names the fifth fault, inside the panel");
    // and the CHAIN panel says so rather than promising a rate
    const ch = S.chain(r);
    const plate = ch.stages.filter((s) => s.id === 'plate')[0];
    assertEq(ch.cold, 1, 'CHAIN counts the frozen-out smelter');
    assertEq(plate.flag, 'COLD', 'and flags the stage COLD, not STARVED');
    assert(!(ch.flow.coal < 0), 'a forge draws no coal in the model either');
  }

  // ---- glass floors ----------------------------------------------------
  {
    const r = mantleRun(31337, 'glass', eff);
    revealAll(r);
    // bury a patch, then shake it: rubble that is hit again opens
    const spots = [];
    for (let y = 2; y < D.MAP_H - 2 && spots.length < 40; y++)
      for (let x = 2; x < D.MAP_W - 2 && spots.length < 40; x++) {
        const t = r.grid[y][x];
        if (t.t === 'floor' && t.machine === null && !t.lm && !t.belt) {
          t.rubble = true;
          spots.push({ x: x, y: y });
        }
      }
    assert(spots.length > 10, 'the test floor has ground to bury');
    const chasm0 = countTiles(r, (t) => t.t === 'chasm');
    r.instability = 95;
    for (let k = 0; k < 40; k++) { r.quakeAt = 0; for (let i = 0; i < 8 * 20; i++) S.tick(r); }
    const chasm1 = countTiles(r, (t) => t.t === 'chasm');
    assert(chasm1 > chasm0,
      'quakes opened the buried ground (' + chasm0 + ' -> ' + chasm1 + ')');
    // ...and an ordinary floor only ever buries it
    const plain = mantleRun(31337, 'seal', eff);
    revealAll(plain);
    for (const s of spots) {
      const t = plain.grid[s.y][s.x];
      if (t.t === 'floor' && t.machine === null && !t.lm) t.rubble = true;
    }
    const p0 = countTiles(plain, (t) => t.t === 'chasm');
    plain.instability = 95;
    for (let k = 0; k < 40; k++) {
      plain.quakeAt = 0;
      for (let i = 0; i < 8 * 20; i++) S.tick(plain);
    }
    assertEq(countTiles(plain, (t) => t.t === 'chasm'), p0,
      'without the mutator a quake never opens the floor');
  }

  // ---- the seal --------------------------------------------------------
  {
    const def = D.MUTATOR_BY_ID.seal;
    const sealed = mantleRun(99, 'seal', eff);
    const plain = mantleRun(99, 'echo', eff);
    const M = D.mantleStratum(D.MUTATOR_DEPTH);
    assertEq(sealed.breachReq.gear, Math.ceil(M.breach.gear * def.breachMult),
      'the seal thins the floor by exactly its data.js number');
    assert(sealed.breachReq.gear < plain.breachReq.gear, 'which is less than it was');
    assertEq(plain.breachReq.gear, M.breach.gear, 'and an ordinary floor is untouched');
    // ...and charges the difference back in pressure
    for (let i = 0; i < 8 * 20; i++) { S.tick(sealed); S.tick(plain); }
    const ratio = sealed.instability / plain.instability;
    assert(Math.abs(ratio - def.instMult) < 0.02,
      'and instability rises ' + def.instMult + 'x (measured ' + ratio.toFixed(3) + ')');
  }

  // ---- echo chamber (pure, and it costs no rng) -------------------------
  {
    const B = require('../js/barks.js') && DC.Barks;
    assert(B && typeof B.echoOf === 'function', 'the echo is exported');
    let echoed = 0, longest = 0;
    for (const k in B.POOLS)
      for (const line of B.POOLS[k]) {
        const e = B.echoOf(line);
        assert(typeof e === 'string' && e.length > 0,
          'every line GRIT can say has an echo: ' + JSON.stringify(line));
        assertEq(B.echoOf(line), e, 'and the same line always echoes the same way');
        longest = Math.max(longest, e.length);
        echoed++;
      }
    assert(longest <= 70, 'the longest echo fits the bar (' + longest + ')');
    assert(echoed > 100, 'the whole corpus was echoed (' + echoed + ')');
    // the mutator only speaks on its own floor
    const r = mantleRun(2024, 'echo', eff);
    const before = r.rng();
    let core = 0;
    for (let i = 0; i < 8 * 90; i++) {
      S.tick(r);
      B.fire(r, 'quake');
      B.tick(r);
      if (r.foreman && r.foreman.voice === 'core') core++;
    }
    assert(core > 0, 'the floor answered him');
    // rng invariance: echoing is a pure transform, so a run that is barked at
    // and a run that is not must stand at the same place in the stream
    const quiet = mantleRun(2024, 'echo', eff);
    for (let i = 0; i < 8 * 90; i++) S.tick(quiet);
    const loud = mantleRun(2024, 'echo', eff);
    for (let i = 0; i < 8 * 90; i++) {
      S.tick(loud);
      B.echoOf('Another rig, another hole. Try not to marry this one, kid.');
    }
    assertEq(loud.rng(), quiet.rng(), 'reading an echo never advances run.rng');
    assertEq(before === before, true, 'seed sanity');
  }

  return table.length;
}

// --------------------------------------------- M-SCHEMS2: the second batch
// One block per card, each installing the pick through Sim.installSchematic —
// the same applySchematicMod every descent pick goes through — never by
// poking run.mods directly, so a card that stopped wiring its own flag would
// fail here before a player ever drew it.
function checkSchems2() {
  const eff = DC.Meta.effects(DC.Meta.newProfile());
  let cards = 0;

  // ---- Magma Boiler ----------------------------------------------------
  // The reward half of the cold seam engine: the SAME forge check, read from
  // the other end. With the card, a smelter beside magma burns nothing and
  // the lava spares it; without it, the same smelter in the same spot is an
  // ordinary machine standing too close to the fire.
  {
    const mk = function (boiler) {
      const r = S.newRun(eff, 777);
      revealAll(r);
      r.inv.ironPlate = 999;
      // a clear 2x2 pad with a spare column to its left for the pool
      let pad = null;
      for (let y = 2; y < D.MAP_H - 3 && !pad; y++)
        for (let x = 2; x < D.MAP_W - 3 && !pad; x++) {
          let ok = true;
          for (let dy = 0; dy < 2 && ok; dy++)
            for (let dx = -1; dx < 2 && ok; dx++) {
              const t = r.grid[y + dy][x + dx];
              if (t.ore || t.machine !== null || t.lm || t.belt ||
                  (t.t !== 'floor' && t.t !== 'rock')) ok = false;
            }
          if (ok) pad = { x: x, y: y };
        }
      assert(pad, 'the test floor offers a pad with a spare column');
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) r.grid[pad.y + dy][pad.x + dx].t = 'floor';
        r.grid[pad.y + dy][pad.x - 1].t = 'magma';   // the pool
      }
      r.magmaCap = 4;    // stratum 1 rolls none, so arm the burn loop by hand
      if (boiler)
        assertEq(S.installSchematic(r, 's_boiler'), 's_boiler', 'the card installs');
      assert(S.place(r, 'smelter', pad.x, pad.y, 1), 'the smelter stands');
      const m = Object.keys(r.machines).map((k) => r.machines[k])
        .filter((mm) => mm.type === 'smelter')[0];
      m.input.ironOre = 8;
      return { r: r, m: m };
    };
    const a = mk(true);
    assert(S.forgeSmelter(a.r, a.m), 'with the card, beside magma IS the forge');
    for (let i = 0; i < 8 * 30; i++) S.tick(a.r);
    assert(a.m.out.length > 0 || a.m.status === 'blocked',
      'it smelted with no coal at all');
    assertEq(a.m.fuel, 0, 'and burned none of its own');
    assertEq(a.m.hp, D.BUILDINGS.smelter.hp, 'and the lava lets the chimney be');
    const ch = S.chain(a.r);
    assert(!(ch.flow.coal < 0), 'CHAIN draws no coal for the forge either');
    // ...and the same smelter without the card
    const b = mk(false);
    assert(!S.forgeSmelter(b.r, b.m), 'no card, no forge');
    assert(!S.coldSmelter(b.r, b.m),
      'and no cold box either — the card is a reward, never a rule');
    for (let i = 0; i < 8 * 3; i++) S.tick(b.r);
    assertEq(b.m.status, 'nofuel', 'it wants coal like it always did');
    for (let i = 0; i < 8 * 30; i++) S.tick(b.r);
    assert(!b.r.machines[b.m.id] || b.r.machines[b.m.id].hp < D.BUILDINGS.smelter.hp,
      'and the lava does not spare it');
    cards++;
  }

  // ---- Echo Charges ----------------------------------------------------
  // Eight coal is exactly four charges' worth of fuel. Without the card that
  // is where the assembler stops; with it, the same buffer yields five — the
  // fifth starting on nothing, counted and never rolled (law 7).
  {
    const mk = function (echo) {
      const r = S.newRun(eff, 4242);
      revealAll(r);
      r.inv.ironPlate = 999;
      let pad = null;
      for (let y = 2; y < D.MAP_H - 3 && !pad; y++)
        for (let x = 2; x < D.MAP_W - 3 && !pad; x++) {
          let ok = true;
          for (let dy = 0; dy < 2 && ok; dy++)
            for (let dx = 0; dx < 2 && ok; dx++) {
              const t = r.grid[y + dy][x + dx];
              if (t.ore || t.machine !== null || t.lm || t.belt ||
                  (t.t !== 'floor' && t.t !== 'rock')) ok = false;
            }
          if (ok) pad = { x: x, y: y };
        }
      assert(pad, 'the test floor offers an assembler pad');
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) r.grid[pad.y + dy][pad.x + dx].t = 'floor';
      if (echo)
        assertEq(S.installSchematic(r, 's_echo'), 's_echo', 'the card installs');
      assert(S.place(r, 'assembler', pad.x, pad.y, 1), 'the assembler stands');
      const m = Object.keys(r.machines).map((k) => r.machines[k])
        .filter((mm) => mm.type === 'assembler')[0];
      m.recipe = 'charge';
      m.input = { crystal: 8, copperPlate: 8, coal: 8 };
      return { r: r, m: m };
    };
    const a = mk(true);
    let made = 0;
    for (let i = 0; i < 8 * 60 && made < 5; i++) {
      S.tick(a.r);
      while (a.m.out.length) { made++; a.m.out.shift(); }
    }
    assertEq(made, 5, 'eight coal bought five charges with the card');
    assertEq(a.m.input.crystal, 4, 'four crystal paid for them');
    assertEq(a.m.input.coal, 0, '...and all eight coal');
    assertEq(a.r.echoN, 5, 'the counter counted every one');
    // the sixth is a paid charge again, and there is nothing left to pay with
    for (let i = 0; i < 8 * 10; i++) { S.tick(a.r); a.m.out.length = 0; }
    assertEq(a.r.echoN, 5, 'the free one does not chain into a free two');
    // ...and the projection draws four fifths of the recipe
    const ch = S.chain(a.r);
    const rec = D.RECIPES.charge;
    const rate = 8 / rec.ticks;
    assert(Math.abs(ch.flow.crystal - (-rate * (1 - 1 / D.ECHO_EVERY))) < 1e-9,
      'CHAIN draws crystal at four fifths of the card rate');
    const b = mk(false);
    let plain = 0;
    for (let i = 0; i < 8 * 60 && plain < 5; i++) {
      S.tick(b.r);
      while (b.m.out.length) { plain++; b.m.out.shift(); }
    }
    assertEq(plain, 4, 'without the card the same buffer stops at four');
    cards++;
  }

  // ---- Gravity Chute ---------------------------------------------------
  // A smelter costs 10 plates: half back is 5, the chute's three quarters is
  // 7. Belts are untouched — they already refund whole, card or no card.
  {
    const mk = function (chute) {
      const r = S.newRun(eff, 1337);
      revealAll(r);
      r.inv.ironPlate = 100;
      if (chute)
        assertEq(S.installSchematic(r, 's_chute'), 's_chute', 'the card installs');
      let pad = null;
      for (let y = 2; y < D.MAP_H - 3 && !pad; y++)
        for (let x = 2; x < D.MAP_W - 3 && !pad; x++) {
          let ok = true;
          for (let dy = 0; dy < 2 && ok; dy++)
            for (let dx = 0; dx < 2 && ok; dx++) {
              const t = r.grid[y + dy][x + dx];
              if (t.ore || t.machine !== null || t.lm || t.belt || t.t !== 'floor')
                ok = false;
            }
          if (ok) pad = { x: x, y: y };
        }
      assert(pad, 'the test floor offers a pad');
      assert(S.place(r, 'smelter', pad.x, pad.y, 1), 'the smelter stands');
      const before = r.inv.ironPlate;
      assert(S.demolishAt(r, pad.x, pad.y).ok, 'and comes down');
      return r.inv.ironPlate - before;
    };
    assertEq(mk(false), Math.floor(10 * D.DEMOLISH_REFUND),
      'half back without the card');
    assertEq(mk(true), Math.floor(10 * D.CHUTE_REFUND),
      'three quarters back with it');
    cards++;
  }

  // ---- Jury Rig --------------------------------------------------------
  // A damaged machine ordinarily works every other tick. With the card it
  // works every tick — measurably double the ore — and each patched machine
  // bills the hull D.JURY_DRAIN a minute until it is repaired.
  {
    const mk = function (jury) {
      const r = S.newRun(eff, 90210);
      revealAll(r);
      r.inv.ironPlate = 100;
      r.instHold = true;   // no quakes: the only hull cost here is the card's
      if (jury)
        assertEq(S.installSchematic(r, 's_jury'), 's_jury', 'the card installs');
      let vein = null;
      for (let y = 1; y < D.MAP_H - 1 && !vein; y++)
        for (let x = 1; x < D.MAP_W - 1 && !vein; x++) {
          const t = r.grid[y][x];
          if (t.ore === 'ironOre' && t.machine === null && !t.lm && t.t === 'floor')
            vein = { x: x, y: y };
        }
      assert(vein, 'the test floor has an iron vein on open floor');
      r.grid[vein.y][vein.x].oreAmt = 999;
      assert(S.place(r, 'extractor', vein.x, vein.y, 1), 'the extractor stands');
      const m = Object.keys(r.machines).map((k) => r.machines[k])
        .filter((mm) => mm.type === 'extractor')[0];
      m.hp = 1;
      return { r: r, m: m };
    };
    const a = mk(true), b = mk(false);
    let fast = 0, slow = 0;
    for (let i = 0; i < D.BUILDINGS.extractor.period * 20; i++) {
      S.tick(a.r);
      S.tick(b.r);
      while (a.m.out.length) { fast++; a.m.out.shift(); }
      while (b.m.out.length) { slow++; b.m.out.shift(); }
    }
    assert(fast >= slow * 2 - 1 && fast > 0,
      'the patched extractor mines at full speed (' + fast + ' vs ' + slow + ')');
    // ...and the model agrees with the floor
    assert(Math.abs(S.chain(a.r).flow.ironOre -
                    2 * S.chain(b.r).flow.ironOre) < 1e-9,
      'CHAIN rates the patched machine whole');
    // the bill: one damaged machine, one JURY_DRAIN per minute, until repaired
    const before = a.r.integrity;
    for (let i = 0; i < 60 * 8; i++) { S.tick(a.r); a.m.out.length = 0; }
    assert(Math.abs((before - a.r.integrity) - D.JURY_DRAIN) < 0.01,
      'a minute on the patch costs exactly ' + D.JURY_DRAIN + ' hull');
    a.m.hp = D.BUILDINGS.extractor.hp;         // repaired: the bleeding stops
    const held = a.r.integrity;
    for (let i = 0; i < 60 * 8; i++) { S.tick(a.r); a.m.out.length = 0; }
    assertEq(a.r.integrity, held, 'repair stops the drain');
    // ...and without the card the hull never paid at all
    const b0 = b.r.integrity;
    for (let i = 0; i < 60 * 8; i++) { S.tick(b.r); b.m.out.length = 0; }
    assertEq(b.r.integrity, b0, 'no card, no bill');
    cards++;
  }

  // ---- Deep Insurance --------------------------------------------------
  // However far past zero the blow drove the hull, the policy pays back to
  // exactly 1 — once. The second lethal hit is simply lethal, and a run
  // without the card never sees the payout at all.
  {
    const r = S.newRun(eff, 2024);
    assertEq(S.installSchematic(r, 's_insure'), 's_insure', 'the card installs');
    r.integrity = -7;                          // a quake can overshoot zero
    S.tick(r);
    assertEq(r.integrity, 1, 'the payout leaves exactly 1, not a refund of 7');
    assertEq(r.status, 'active', 'and the run is still a run');
    assertEq(r.insured, true, 'the policy is spent');
    assert(r.events.some((e) => e.type === 'insurance'),
      'the sim announced it (GRIT needs his heart attack)');
    assert(!r.events.some((e) => e.type === 'death'), 'and no death event fired');
    r.integrity = -1;
    S.tick(r);
    assertEq(r.status, 'dead', 'the second killing blow kills');
    const plain = S.newRun(eff, 2024);
    plain.integrity = -1;
    S.tick(plain);
    assertEq(plain.status, 'dead', 'no card, no miracle');
    cards++;
  }

  // ---- Closed Loop -----------------------------------------------------
  // Three otherwise-identical floors, twenty coal-free seconds: no damper,
  // a looped damper, a fuelled damper. The looped one calms — genuinely —
  // and calms exactly half as hard as the coal-burner it replaced.
  {
    const mk = function (damper, loop) {
      const r = S.newRun(eff, 555);
      revealAll(r);
      r.inv.ironPlate = 100; r.inv.copperPlate = 10;
      if (loop)
        assertEq(S.installSchematic(r, 's_loop'), 's_loop', 'the card installs');
      if (!damper) return { r: r, m: null };
      let pad = null;
      for (let y = 2; y < D.MAP_H - 2 && !pad; y++)
        for (let x = 2; x < D.MAP_W - 2 && !pad; x++) {
          const t = r.grid[y][x];
          if (t.t === 'floor' && !t.ore && t.machine === null && !t.lm && !t.belt)
            pad = { x: x, y: y };
        }
      assert(S.place(r, 'damper', pad.x, pad.y, 1), 'the damper stands');
      const m = Object.keys(r.machines).map((k) => r.machines[k])
        .filter((mm) => mm.type === 'damper')[0];
      return { r: r, m: m };
    };
    const none = mk(false, false), loop = mk(true, true), coal = mk(true, false);
    coal.m.input.coal = 8;
    loop.m.input.coal = 8;   // deliberately: the loop must not touch it
    for (let i = 0; i < 8 * 20; i++) { S.tick(none.r); S.tick(loop.r); S.tick(coal.r); }
    assertEq(loop.m.input.coal, 8, 'the looped damper never draws its coal');
    assertEq(loop.m.fuel, 0, '...nor holds any');
    assert(loop.m.status !== 'nofuel', 'and it never reads out-of-fuel');
    assert(loop.r.instability < none.r.instability,
      'it genuinely vents (' + loop.r.instability.toFixed(2) + ' < ' +
      none.r.instability.toFixed(2) + ')');
    assert(coal.r.instability < loop.r.instability,
      'at half the coal-burner\'s strength');
    // the arithmetic, exactly: 25% calm plain, 12.5% looped
    const base = none.r.instability;
    assert(Math.abs(loop.r.instability - base * (1 - D.BUILDINGS.damper.calm *
                                                     D.CLOSED_LOOP_CALM)) < 0.01,
      'the looped calm is the data.js product');
    // ...and the projection stops charging coal for it
    assertEq(S.chain(loop.r).flow.coal || 0, 0, 'CHAIN draws no coal for the loop');
    assert((S.chain(coal.r).flow.coal || 0) < 0, 'and still does for the burner');
    cards++;
  }

  // ---- Worm Whisperer --------------------------------------------------
  // The deck's copy of the mutator table's contract: a card whose module has
  // not landed is NOT DEALT — it is not a dead pick a breach can waste its
  // one choice on. Everything else about the card already exists (line, art,
  // mods flag), so the day DC.Worms loads, nothing here needs touching.
  {
    const r = S.newRun(eff, 31337);
    r.depth = D.MUTATOR_DEPTH;                 // every minDepth gate is open
    r.stats.placed = { splitter: 1, tunnel: 1, filter: 1, crusher: 1 };
    const pool = S.schematicPool(r, r.depth);
    assert(pool.indexOf('s_boiler') >= 0 && pool.indexOf('s_loop') >= 0,
      'the rest of the batch is in the deck down here');
    // M-WORMS LANDED: the card is DEALT now, by the same gate that refused
    // it before, and nothing in the deck code changed to make that happen.
    assert(pool.indexOf('s_whisper') >= 0,
      'the Worm Whisperer is dealt now that DC.Worms exists');
    for (const sc of D.SCHEMATICS)
      if (sc.needsModule)
        assertEq(pool.indexOf(sc.id) >= 0, !!DC[sc.needsModule],
          sc.id + ' is dealt exactly when its module is loaded');
    assertEq(S.installSchematic(r, 's_whisper'), 's_whisper',
      'installed it still wires its flag...');
    assertEq(r.mods.wormBeacon, true, '...for the module that now reads it');
    cards++;
  }

  return cards;
}

// ======================================================================
// ------------------------------------------------- M-WORMS: something lives
// The battery is organised the way the brief is: the animal, the tool, the
// monster, and then the two features that shipped dark waiting for it. The
// long one in the middle — 'a lure never moves the stream' — is the reason
// this module was allowed to draw from run.rng at all, so it is the one to
// read first if any of this ever has to be revisited.
function wormRun(seed, depth) {
  const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), seed);
  r.depth = depth === undefined ? D.WORMS.minDepth : depth;
  S.startStratum(r);
  return r;
}
// flatRun's board, but on a floor that really was started at a worm depth —
// flatRun sets `depth` without regenerating, so its map (and its wildlife) is
// always stratum 1's. This starts the stratum first and then flattens around
// the animals, which is what a "walk a worm at this thing" test needs.
function flatWorm(seed, depth) {
  const r = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), seed);
  r.depth = depth === undefined ? D.WORMS.minDepth : depth;
  S.startStratum(r);
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) {
      const t = r.grid[y][x];
      t.revealed = true;
      if (t.machine === 0) continue;                 // the rig stays put
      t.t = 'floor'; t.machine = null; t.belt = null; t.rubble = false;
      t.digT = 0; t.ore = null; t.oreAmt = 0; t.lm = null; t.toad = false;
    }
  r.landmark = null;
  if (r.critters) r.critters.toad = null;            // the toad is tested elsewhere
  // Scaffold: these cases tick for minutes to walk a worm somewhere, and a
  // quake eating the very belt the case is about would be a false negative
  // about worms. instHold is js/tutorial.js's own pressure pause; magmaCap 0
  // stops the lava spreading over the board mid-experiment. Neither is
  // touched by any case that is ABOUT pressure.
  r.instHold = true;
  r.magmaCap = 0;
  r.inv.ironPlate = 9999; r.inv.copperPlate = 999;
  return r;
}
function checkWorms() {
  const eff = DC.Meta.effects(DC.Meta.newProfile());
  const WD = D.WORMS, TD = D.UNDERTOAD;
  assert(!!DC.Worms, 'DC.Worms is loaded');

  // ---- where they are, and where they are not --------------------------
  // The tutorial owns stratum 1 (js/tutorial.js), so worms starting at 3 is
  // not a taste call — it is the reason the induction can never collide with
  // one. Pinned here rather than trusted.
  {
    assert(WD.minDepth > 1, 'worms never share a floor with the induction');
    for (let d = 1; d < WD.minDepth; d++) {
      const r = wormRun(9001, d);
      assertEq(DC.Worms.list(r).length, 0, 'no worms on stratum ' + d);
      assertEq(DC.Worms.toad(r), null, 'and no Undertoad either');
    }
    let counts = {};
    for (let s = 0; s < 60; s++) {
      const r = wormRun(7001 + s * 131, WD.minDepth + (s % 5));
      const ws = DC.Worms.list(r);
      counts[ws.length] = (counts[ws.length] || 0) + 1;
      assert(ws.length >= WD.count[0] && ws.length <= WD.count[1],
        'a floor gets ' + WD.count[0] + '-' + WD.count[1] + ' worms (got ' + ws.length + ')');
      const c = { x: r.hub.x + 1, y: r.hub.y + 1 };
      for (const w of ws) {
        assert(Math.hypot(w.x - c.x, w.y - c.y) >= WD.spawnMinD,
          'a worm never surfaces on top of the rig');
        assert(w.x > 0 && w.y > 0 && w.x < D.MAP_W - 1 && w.y < D.MAP_H - 1,
          'a worm starts inside the map');
      }
    }
    assert(Object.keys(counts).length > 1, 'the count actually varies across floors');
  }

  // ---- a re-render must never move a worm ------------------------------
  // The render layer asks these three questions every frame. If any of them
  // drew from run.rng, a player who watched the map would get a different
  // quake than a player who looked away (§0 law 7's render trap).
  {
    const a = wormRun(4711, 5), b = wormRun(4711, 5);
    const before = JSON.stringify(DC.Worms.list(a));
    for (let i = 0; i < 200; i++) {
      DC.Worms.cells(a); DC.Worms.list(a); DC.Worms.toad(a);
      DC.Worms.describe(a, i % D.MAP_W, (i * 7) % D.MAP_H);
      S.describeTile(a, i % D.MAP_W, (i * 7) % D.MAP_H);
    }
    assertEq(JSON.stringify(DC.Worms.list(a)), before, 'reading never moves a worm');
    assertEq(a.rng(), b.rng(), 'and never advances run.rng');
    // ...and the glyph chain is the three cells the brief asked for
    const r = wormRun(4711, 5);
    tickRun(r, WD.stepT * 6);
    for (const w of DC.Worms.list(r)) {
      const mine = DC.Worms.cells(r).filter((c) => c.id === w.id);
      assertEq(mine.length, WD.segs, "'~~o' is " + WD.segs + ' cells of animal');
      assertEq(mine.filter((c) => c.head).length, 1, 'exactly one of them is the head');
      assertEq(mine[0].head, true, 'and cells() puts it first, so render draws it last');
    }
  }

  // ---- it opens rock, and it eats the vein ------------------------------
  {
    const r = wormRun(1201, 6);
    r.instHold = true; r.magmaCap = 0;   // scaffold: see flatWorm
    let rock0 = countTiles(r, (t) => t.t === 'rock');
    let ore0 = 0;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) ore0 += r.grid[y][x].oreAmt || 0;
    tickRun(r, WD.stepT * 400);
    const st = DC.Worms.peek(r);
    assert(st.dug > 0, 'a worm opens rock as it swims (' + st.dug + ' tiles)');
    assertEq(countTiles(r, (t) => t.t === 'rock'), rock0 - st.dug,
      'and every tile it opened is floor now, none of them anything else');
    let ore1 = 0;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) ore1 += r.grid[y][x].oreAmt || 0;
    if (st.ate > 0) {
      assertEq(ore0 - ore1, st.ate, 'the ore it ate is the ore that left the map');
      assert(st.ate % WD.eat === 0 || ore1 === 0,
        'it takes ' + WD.eat + ' a mouthful (or the last of a thin tile)');
    }
    // an exhausted tile stops being a vein rather than becoming a 0-ore one
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const t = r.grid[y][x];
        if (t.ore) assert(t.oreAmt > 0, 'no vein tile is left holding zero ore');
      }
  }

  // ---- it does not touch the Company -----------------------------------
  // The one promise that makes a creature safe to have in a game with no
  // combat. Driven against a real base rather than reasoned about: a worm is
  // walked at a machine, a belt and a landmark with a lure behind each.
  {
    const r = flatWorm(1202, 6);
    const hy = r.hub.y, hx = r.hub.x;
    assert(S.place(r, 'smelter', hx - 10, hy, 1), 'a smelter in the worm\'s way');
    assert(S.place(r, 'belt', hx - 12, hy, 1), 'and a belt beside it');
    r.grid[hy][hx - 12].belt.item = 'coal';
    r.grid[hy + 2][hx - 10].lm = { id: 'root', g: '♠' };
    r.inv.coal = 99;
    const w = DC.Worms.list(r)[0] || null;
    assert(w, 'the floor has a worm to walk');
    w.x = hx - 14; w.y = hy; w.body.length = 0;
    assert(DC.Worms.lure(r, hx - 6, hy).ok, 'a lure on the far side of the smelter');
    const mach0 = Object.keys(r.machines).length;
    const hp0 = machAt(r, hx - 10, hy).hp;
    let onMachine = 0, onBelt = 0, onLm = 0, moved = 0;
    let last = w.x + ',' + w.y;
    for (let i = 0; i < WD.stepT * 200; i++) {
      S.tick(r);
      if (w.x + ',' + w.y !== last) { moved++; last = w.x + ',' + w.y; }
      for (const c of DC.Worms.cells(r)) {
        const t = r.grid[c.y][c.x];
        if (t.machine !== null) onMachine++;
        if (t.belt) onBelt++;
        if (t.lm) onLm++;
      }
    }
    // The counters above are only worth anything if the animal actually
    // walked past the things it is not allowed to touch.
    assert(moved > 20, 'the worm really did travel (' + moved + ' steps)');
    assertEq(onMachine, 0, 'a worm never stands on a machine or the rig');
    assertEq(onBelt, 0, 'a worm never stands on a belt');
    assertEq(onLm, 0, 'a worm never stands on a landmark');
    assertEq(r.grid[hy][hx - 12].belt && r.grid[hy][hx - 12].belt.item, 'coal',
      'the cargo on that belt is exactly where it was left');
    assertEq(Object.keys(r.machines).length, mach0, 'and no machine was eaten');
    assertEq(machAt(r, hx - 10, hy).hp, hp0, '...nor even scratched');
    assert(!!r.grid[hy + 2][hx - 10].lm, 'the landmark tile still belongs to the landmark');
    // ...nor does it swim through the three terrains nothing swims through
    for (const kind of ['magma', 'obsidian', 'chasm']) {
      const q = flatWorm(1203, 6);
      const ww = DC.Worms.list(q)[0];
      assert(ww, 'a worm to box in');
      ww.x = 4; ww.y = 4; ww.body.length = 0;
      for (let y = 2; y <= 6; y++)
        for (let x = 2; x <= 6; x++)
          if (x !== 4 || y !== 4) q.grid[y][x].t = kind;
      tickRun(q, WD.stepT * 30);
      assertEq(ww.x + ',' + ww.y, '4,4', 'a worm walled in by ' + kind + ' stays put');
      assertEq(q.grid[3][4].t, kind, '...and the ' + kind + ' is untouched');
    }
  }

  // ---- THE UNDERGROUND BELT PAIR ----------------------------------------
  // The brief asked for a decision and a test. THE DECISION IS: NOTHING
  // HAPPENS. sim.js pairTunnel binds the two ends machine-to-machine at
  // placement and stores the ids; no code path ever re-reads the ground
  // between them, so a worm's tunnel across that gap cannot break, re-route
  // or unpair anything. In the fiction the pair is buried deeper than the
  // worm swims. Here is the case, driven end to end.
  {
    const r = flatWorm(1204, 6);
    const y = r.hub.y, x = r.hub.x - 14;
    const gap = D.BUILDINGS.tunnel.gap;
    assert(S.place(r, 'tunnel', x, y, 1), 'entrance placed');
    assert(S.place(r, 'tunnel', x + gap + 1, y, 1), 'exit placed');
    const a = machAt(r, x, y), b = machAt(r, x + gap + 1, y);
    assertEq(a.pair, b.id, 'the pair found each other');
    for (let k = 1; k <= gap; k++) r.grid[y][x + k].t = 'rock';   // solid ground over it
    assert(S.place(r, 'belt', x - 1, y, 1), 'a belt into the entrance');
    assert(S.place(r, 'belt', x + gap + 2, y, 1), 'a belt off the exit');
    // walk a worm straight across the buried span
    const w = DC.Worms.list(r)[0];
    assert(w, 'a worm to walk over it');
    w.x = x + 2; w.y = y - 3; w.body.length = 0;
    r.inv.coal = 99;
    assert(DC.Worms.lure(r, x + 2, y + 4).ok, 'bait on the far side of the span');
    tickRun(r, WD.stepT * 40);
    let crossed = 0;
    for (let k = 1; k <= gap; k++) if (r.grid[y][x + k].t === 'floor') crossed++;
    assert(crossed > 0, 'the worm really did open the ground over the pair (' + crossed + ')');
    // ...and the pair does not care, at all
    assertEq(a.pair, b.id, 'the pair is still bound');
    assertEq(a.mode, 'in', 'the entrance is still the entrance');
    assertEq(b.mode, 'out', 'the exit is still the exit');
    r.grid[y][x - 1].belt.item = 'coal';
    tickRun(r, 8 * D.BELT_PERIOD);
    assertEq(r.grid[y][x + gap + 2].belt.item, 'coal',
      'and cargo still crosses the span the worm dug through');
  }

  // ---- THE LURE ---------------------------------------------------------
  {
    const r = flatWorm(1205, 6);
    const hy = r.hub.y, hx = r.hub.x;
    r.inv.coal = 0;
    assertEq(DC.Worms.lure(r, hx - 8, hy).ok, false, 'no coal, no lure');
    assert(/coal/.test(DC.Worms.lure(r, hx - 8, hy).reason), '...and it says which');
    r.inv.coal = WD.lureCost;
    r.grid[hy][hx - 8].t = 'rock';
    assertEq(DC.Worms.lure(r, hx - 8, hy).ok, false, 'a lure needs open floor');
    r.grid[hy][hx - 8].t = 'floor';
    assert(S.place(r, 'belt', hx - 7, hy, 1), 'a belt to be in the way');
    assertEq(DC.Worms.lure(r, hx - 7, hy).ok, false, 'a lure does not go on a belt');
    assert(DC.Worms.lure(r, hx - 8, hy).ok, 'and on bare floor it does');
    assertEq(r.inv.coal, 0, 'it cost exactly ' + WD.lureCost + ' coal');
    assertEq(DC.Worms.lures(r).length, 1, 'and it is on the map');
    r.inv.coal = 99;
    assertEq(DC.Worms.lure(r, hx - 8, hy).ok, false, 'one lure to a tile');
    // a floor with nothing to call refuses the spend rather than eating it
    const shallow = flatWorm(1206, 1);
    shallow.inv.coal = 99;
    const no = DC.Worms.lure(shallow, shallow.hub.x - 8, shallow.hub.y);
    assertEq(no.ok, false, 'stratum 1 has nothing to call');
    assertEq(shallow.inv.coal, 99, 'and the coal stays in the crate');
    // ...and a worm walks to it, eats it, and moves on
    const w = DC.Worms.list(r)[0];
    w.x = hx - 16; w.y = hy; w.body.length = 0;
    const d0 = Math.abs(w.x - (hx - 8));
    tickRun(r, WD.stepT * 4);
    assert(Math.abs(w.x - (hx - 8)) < d0, 'the worm turns toward the bait');
    tickRun(r, WD.stepT * 40);
    assertEq(DC.Worms.lures(r).length, 0, 'and eats it when it arrives');
    assert(r.events.some((e) => e.type === 'worm' && e.data.act === 'lure'),
      'which GRIT is told about');
  }

  // ---- A LURE NEVER MOVES THE STREAM (§0 law 7) -------------------------
  // The load-bearing test of this whole module. Two identical runs; one of
  // them is played WITH the tool, hard — six lures, dropped at different
  // moments, dragging its worms right across the map. If aiming a worm cost
  // the stream one draw, the quake schedule would depend on how the player
  // played the floor, every number in test/balance.js would drift with the
  // shape of a base, and the module would have to be rewritten onto a derived
  // stream like js/events.js. It does not, so it does not.
  {
    const a = wormRun(8123, 6), b = wormRun(8123, 6);
    revealAll(b);
    b.inv.coal = 999;
    let dropped = 0;
    for (let i = 0; i < 8 * 240; i++) {
      S.tick(a); S.tick(b);
      if (i % 240 === 0) {
        for (let y = 1; y < D.MAP_H - 1 && dropped <= i / 240; y++)
          for (let x = 1; x < D.MAP_W - 1 && dropped <= i / 240; x++)
            if (DC.Worms.lure(b, (x * 13 + i) % (D.MAP_W - 2) + 1,
                                 (y * 7 + i) % (D.MAP_H - 2) + 1).ok) dropped++;
      }
    }
    assert(dropped >= 4, 'the lured run really did use the tool (' + dropped + ' lures)');
    const wa = DC.Worms.list(a).map((w) => w.x + ',' + w.y).join(' ');
    const wb = DC.Worms.list(b).map((w) => w.x + ',' + w.y).join(' ');
    assert(wa !== wb, 'and it really did move the worms (' + wa + ' vs ' + wb + ')');
    assertEq(b.quakeAt, a.quakeAt, 'the next quake is scheduled for the same tick');
    assertEq(Math.round(b.instability * 1e6), Math.round(a.instability * 1e6),
      'the pressure is identical');
    for (let i = 0; i < 40; i++)
      assertEq(b.rng(), a.rng(), 'and the stream itself is bit-identical at draw ' + i);
  }

  // ---- WORM SEASON, wired (M-MANTLE) ------------------------------------
  // The mutator shipped written and gated on this module. Nothing in the
  // table changed when the module landed; the count comes out of the entry's
  // own data.js field, so retuning the season retunes the floor.
  {
    const def = D.MUTATOR_BY_ID.worms;
    assert(def && def.count >= 3, 'the season names its own count');
    const r = mantleRun(6161, 'worms', eff);
    assertEq(DC.Worms.list(r).length, def.count,
      'worm season puts ' + def.count + ' of them in the walls');
    const plain = mantleRun(6161, 'seal', eff);
    assert(DC.Worms.list(plain).length < def.count,
      'and an ordinary Mantle floor has fewer');
    assert(DC.Barks && DC.Barks.MUTATOR_LINES && DC.Barks.MUTATOR_LINES.worms,
      'GRIT already had a line for it');
  }

  // ---- THE WORM WHISPERER, wired (M-SCHEMS2) ----------------------------
  // The card's contract: worms also come when the cursor calls. The cursor is
  // UI, so ENGINE publishes it into run state and the sim reads a plain
  // {x, y} — which is exactly what this drives, with no engine in the room.
  {
    const off = flatWorm(1207, 6), on = flatWorm(1207, 6);
    assertEq(S.installSchematic(on, 's_whisper'), 's_whisper', 'the card installs');
    assertEq(on.mods.wormBeacon, true, 'and sets its flag');
    const bx = off.hub.x - 15, by = off.hub.y - 8;
    for (const r of [off, on]) {
      const w = DC.Worms.list(r)[0];
      assert(w, 'a worm to call');
      w.x = r.hub.x + 12; w.y = r.hub.y + 8; w.dir = 1; w.body.length = 0;
      DC.Worms.beacon(r, bx, by);
    }
    const d0 = Math.abs(DC.Worms.list(on)[0].x - bx) + Math.abs(DC.Worms.list(on)[0].y - by);
    tickRun(off, WD.stepT * 25); tickRun(on, WD.stepT * 25);
    const wOn = DC.Worms.list(on)[0], wOff = DC.Worms.list(off)[0];
    const dOn = Math.abs(wOn.x - bx) + Math.abs(wOn.y - by);
    const dOff = Math.abs(wOff.x - bx) + Math.abs(wOff.y - by);
    assert(dOn < d0, 'with the card the worm closes on the cursor (' + d0 + ' -> ' + dOn + ')');
    assert(dOn < dOff, 'and without it, it has never heard of you (' + dOff + ')');
    // the beacon costs the stream nothing either — it is a target, not a roll
    const c1 = flatWorm(1208, 6), c2 = flatWorm(1208, 6);
    S.installSchematic(c2, 's_whisper');
    for (let i = 0; i < 400; i++) {
      DC.Worms.beacon(c2, i % D.MAP_W, i % D.MAP_H);
      S.tick(c1); S.tick(c2);
    }
    for (let i = 0; i < 20; i++) assertEq(c2.rng(), c1.rng(), 'the beacon draws nothing');
  }

  // ---- THE UNDERTOAD ----------------------------------------------------
  let toads = 0, maps = 0, tunnels = [];
  {
    const c = {};
    for (let s = 0; s < 200; s++) {
      const r = wormRun(3300 + s * 977, TD.minDepth + (s % 5));
      maps++;
      const t = DC.Worms.toad(r);
      if (!t) continue;
      toads++;
      const hub = { x: r.hub.x + 1, y: r.hub.y + 1 };
      assert(Math.hypot(t.x - hub.x, t.y - hub.y) >= TD.minD,
        'it never sleeps on top of the rig');
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const tt = r.grid[t.y + dy][t.x + dx];
          assertEq(tt.toad, true, 'all four cells are the creature');
          assertEq(tt.t, 'floor', 'and the chamber is open ground');
          assertEq(tt.ore, null, 'it never sleeps on a vein');
          assertEq(tt.lm, null, 'and never on a wonder');
          assertEq(tt.machine, null, 'and never on the rig');
        }
      // nothing may be built on the tenant. Scanned first, or the refusal
      // that comes back is the ordinary one about unscanned ground.
      r.inv.ironPlate = 999;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) r.grid[t.y + dy][t.x + dx].revealed = true;
      const chk = S.canPlace(r, 'belt', t.x, t.y, 1);
      assertEq(chk.ok, false, 'you cannot build on it');
      assert(/asleep/.test(chk.reason), '...and the refusal says why: ' + chk.reason);
      c[r.depth] = 1;
    }
    assert(toads > 0, 'the Undertoad is placed at all (' + toads + '/' + maps + ')');
    const rate = toads / maps;
    assert(rate > 0.03 && rate < 0.35,
      'and roughly at its stated rate (' + (rate * 100).toFixed(0) + '% vs ' +
      (TD.chance * 100) + '%)');
  }

  // one to a run, however deep it goes
  {
    const r = S.newRun(eff, 5511);
    let seen = 0;
    for (let d = TD.minDepth; d <= TD.minDepth + 14; d++) {
      r.depth = d;
      S.startStratum(r);
      if (DC.Worms.toad(r)) seen++;
    }
    assert(seen <= 1, 'at most one Undertoad in a run (saw ' + seen + ')');
  }

  // waking it: the radius, the quake, the prize — and no draw from the stream
  {
    let woke = 0;
    for (let s = 0; s < 400 && woke < 6; s++) {
      const r = wormRun(4400 + s * 613, TD.minDepth + (s % 6));
      const t = DC.Worms.toad(r);
      if (!t) continue;
      revealAll(r);
      r.inv.ironPlate = 999; r.inv.copperPlate = 999;
      // far away, nothing happens
      const far = { x: t.x > D.MAP_W / 2 ? 1 : D.MAP_W - 2, y: t.y };
      r.grid[far.y][far.x].t = 'rock';
      S.demolishAt(r, far.x, far.y);
      assertEq(DC.Worms.toad(r).awake, false, 'a hole across the map does not wake it');
      // within the radius, it does — and the roll does not move. A chamber
      // seated by the loosest placement tier can have no rock left within the
      // radius at all; that map is simply not this case's map.
      let dug = null;
      for (let dy = -TD.wakeR; dy <= TD.wakeR + 1 && !dug; dy++)
        for (let dx = -TD.wakeR; dx <= TD.wakeR + 1 && !dug; dx++) {
          const x = t.x + dx, y = t.y + dy;
          const tt = r.grid[y] && r.grid[y][x];
          if (tt && tt.t === 'rock' && !tt.toad) dug = { x: x, y: y };
        }
      if (!dug) continue;
      const stream = [];
      const base = r.rng;
      r.rng = function () { stream.push(1); return base(); };
      const i0 = r.integrity, p0 = r.instability;
      assert(S.demolishAt(r, dug.x, dug.y).ok, 'the pick goes in');
      assertEq(DC.Worms.toad(r).awake, true, 'and it wakes');
      assertEq(stream.length, 0, 'waking it draws NOTHING from run.rng (law 7/8)');
      r.rng = base;
      assertEq(i0 - r.integrity, TD.dmg, 'the hull pays ' + TD.dmg + ' for it');
      assertEq(Math.round(r.instability - p0), TD.inst, 'and the planet notices');
      assertEq(r.shake, true, 'the screen is told to shake');
      assert(/WOKE IT/.test(r.messages.map((m) => m.text).join(' ')),
        'and the player is told to their face');
      const ev = r.events.filter((e) => e.type === 'toad')[0];
      assert(ev && ev.data.act === 'wake', 'the event carries the wake');
      assert(ev.data.tiles >= TD.tunnel[0] && ev.data.tiles <= TD.tunnel[1],
        'the tunnel is ' + TD.tunnel[0] + '-' + TD.tunnel[1] + ' tiles (' + ev.data.tiles + ')');
      tunnels.push(ev.data.tiles);
      assert(ev.data.rubble > 0, 'and it brought the ceiling down around itself');
      assertEq(DC.Worms.toad(r).gone, true, 'the tenant has moved out');
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++)
          assertEq(r.grid[t.y + dy][t.x + dx].toad, false, 'the chamber is ordinary ground');
      assertEq(S.canPlace(r, 'belt', t.x, t.y, 1).ok, true, 'and buildable now');
      // the prize: crystal, in a line, out of the chamber
      let cry = 0;
      for (let y = 0; y < D.MAP_H; y++)
        for (let x = 0; x < D.MAP_W; x++)
          if (r.grid[y][x].ore === 'crystal' && r.grid[y][x].oreAmt > 0) cry++;
      assert(cry >= ev.data.tiles, 'the tunnel is lined with crystal (' + cry + ')');
      // a second disturbance is not a second quake
      const i1 = r.integrity;
      assertEq(DC.Worms.disturb(r, dug.x, dug.y), false, 'it only wakes once');
      assertEq(r.integrity, i1, 'and only bills once');
      woke++;
    }
    assert(woke >= 3, 'the wake path was driven on several maps (' + woke + ')');
  }

  // building near it wakes it too — the brief says building OR digging
  {
    for (let s = 0; s < 400; s++) {
      const r = wormRun(6600 + s * 421, TD.minDepth + (s % 5));
      const t = DC.Worms.toad(r);
      if (!t) continue;
      revealAll(r);
      r.inv.ironPlate = 999;
      let spot = null;
      for (let dy = -TD.wakeR; dy <= TD.wakeR + 1 && !spot; dy++)
        for (let dx = -TD.wakeR; dx <= TD.wakeR + 1 && !spot; dx++) {
          const x = t.x + dx, y = t.y + dy;
          const tt = r.grid[y] && r.grid[y][x];
          if (tt && tt.t === 'floor' && !tt.toad && !tt.ore && tt.machine === null &&
              !tt.rubble && !tt.lm) spot = { x: x, y: y };
        }
      if (!spot) continue;
      assert(S.place(r, 'belt', spot.x, spot.y, 1), 'a belt goes down beside it');
      assertEq(DC.Worms.toad(r).awake, true, 'and that wakes it as surely as a pick');
      break;
    }
  }

  // ---- Sim.chain is still pure, and still blind to the wildlife ---------
  // chain() reads MACHINE state, so a worm eating a vein out from under an
  // extractor changes what the panel reports through the extractor's own
  // status and not through any new term. Verified rather than assumed: the
  // projection is identical across a worm's whole meal, and rolls nothing.
  {
    const r = wormRun(2211, 6);
    const before = JSON.stringify(S.chain(r));
    const twin = wormRun(2211, 6);
    for (let i = 0; i < 200; i++) { S.chain(r); }
    assertEq(r.rng(), twin.rng(), 'chain() still draws nothing with worms on the map');
    tickRun(r, WD.stepT * 200);
    const ch = S.chain(r);
    assert(ch && typeof ch.drillCost === 'number', 'and still answers after they have eaten');
    assertEq(JSON.stringify(S.chain(r)), JSON.stringify(ch), 'twice, identically');
    assert(before.length > 0, 'the panel had an answer before they started too');
  }

  return { worms: 1, toads: toads, maps: maps,
           tunnel: tunnels.length ? Math.min.apply(null, tunnels) + '-' +
                                    Math.max.apply(null, tunnels) : 'n/a' };
}

function checkChain() {
  const eff = DC.Meta.effects(DC.Meta.newProfile());
  const r = S.newRun(eff, 4242);
  const twin = S.newRun(eff, 4242);          // an untouched stream to compare to
  for (let i = 0; i < 200; i++) { S.tick(r); S.tick(twin); }

  // the arithmetic the panel exists to show, straight out of data.js
  const smeltPerSec = D.TICK_HZ / D.RECIPES.smeltIron.ticks;
  const gearPerSec = D.TICK_HZ / D.RECIPES.gear.ticks;
  const platesWanted = gearPerSec * D.RECIPES.gear.in.ironPlate;
  assert(platesWanted > smeltPerSec,
    'the ratio trap is real: one assembler wants ' + platesWanted.toFixed(2) +
    ' plate/s and one smelter makes ' + smeltPerSec.toFixed(2));

  // build the classic first base: two iron extractors, one smelter, one
  // assembler — placed through the public API, on tiles the map really has
  let ext = 0;
  for (let y = 0; y < D.MAP_H && ext < 2; y++) {
    for (let x = 0; x < D.MAP_W && ext < 2; x++) {
      const t = r.grid[y][x];
      if (!t.revealed || t.ore !== 'ironOre') continue;
      if (S.canPlace(r, 'extractor', x, y, 1).ok && S.place(r, 'extractor', x, y, 1)) ext++;
    }
  }
  assertEq(ext, 2, 'two iron extractors placed for the chain model');
  function place2x2(type) {
    for (let y = 0; y < D.MAP_H; y++) {
      for (let x = 0; x < D.MAP_W; x++) {
        if (S.canPlace(r, type, x, y, 1).ok && S.place(r, type, x, y, 1)) return true;
      }
    }
    return false;
  }
  assert(place2x2('smelter'), 'a smelter site exists');
  assert(place2x2('assembler'), 'an assembler site exists');

  const ch = S.chain(r);
  assert(ch && ch.stages.length >= 3, 'Sim.chain returns the three stages');
  const ore = ch.stages[0], plate = ch.stages[1], gear = ch.stages[2];
  assertEq(ore.n, 2, 'chain counts both ore extractors');
  assertEq(plate.n, 1, 'chain counts the smelter');
  assertEq(gear.n, 1, 'chain counts the assembler');
  assert(Math.abs(ore.rate - 2 * D.TICK_HZ / D.BUILDINGS.extractor.period) < 1e-9,
    'ore rate is the extractors cadence (' + ore.rate + ')');
  assert(Math.abs(plate.rate - smeltPerSec) < 1e-9, 'plate rate is one smelt cycle');
  assert(Math.abs(gear.rate - gearPerSec) < 1e-9, 'gear rate is one craft cycle');

  // the bottleneck: plates, every time, on this base
  assert(plate.limiting === true, 'the smelter is named as the limiting stage');
  assert(!ore.limiting && !gear.limiting, 'and it is named alone');
  assertEq(plate.flag, 'STARVED', 'the limiting stage carries the warning word');
  assert(Math.abs(ch.gearRate - plate.rate / ch.perGear) < 1e-9,
    'effective gear throughput is the bottleneck, not the assembler');

  // net flow: ore piles up, plates are eaten faster than they are made,
  // coal only ever goes down
  assert(ch.flow.ironOre > 0, 'iron ore trends up (extractors outrun the smelter)');
  assert(ch.flow.ironPlate < 0, 'iron plate trends down (the assembler outruns the smelter)');
  assert(ch.flow.coal < 0, 'coal only ever burns');

  // and a projection that is a number of seconds, not a promise
  assert(ch.breachSec > 0 && isFinite(ch.breachSec), 'the breach projects to a real time');
  const noAsm = S.chain(r);
  assertEq(noAsm.breachSec > 0, true, 'projection is stable across calls');

  // ---- M-TIER2: the new machines are IN the model ------------------------
  // A structure the player can see on the map and not in CHAIN is a hole in
  // the game's only live explanation of itself, so every type this brief adds
  // is asked for its number here.
  {
    // the crusher stands in the ore stage beside the extractors, and the row
    // says which is which: '2E1C'
    r.depth = D.BUILDINGS.crusher.unlockDepth;
    r.inv.ironPlate = (r.inv.ironPlate || 0) + 999;    // scaffold: not a cost test
    r.inv.copperPlate = (r.inv.copperPlate || 0) + 99;
    let put = false;
    for (let y = 0; y < D.MAP_H && !put; y++)
      for (let x = 0; x < D.MAP_W && !put; x++)
        if (S.canPlace(r, 'crusher', x, y, 1).ok) put = S.place(r, 'crusher', x, y, 1);
    assert(put, 'a crusher site exists');
    const cm = Object.keys(r.machines).map(k => r.machines[k])
      .filter(m => m.type === 'crusher')[0];
    const dry = S.chain(r);
    assertEq(dry.stages[0].n, 3, 'the crusher joins the ore stage');
    assertEq(dry.stages[0].parts.map(p => p.n + p.letter).join(''), '2E1C',
      'and the row says which machines are on it');
    assert(Math.abs(dry.stages[0].rate - ore.rate) < 1e-9,
      'a crusher with no rubble adds no rate — the same honesty a dead vein gets');
    // give it something to chew and the stage rate moves by exactly its cadence
    r.grid[cm.y + 3][cm.x].rubble = true;
    S.tick(r);
    const wet = S.chain(r);
    const B = D.BUILDINGS.crusher;
    assert(Math.abs(wet.stages[0].rate - (ore.rate + D.TICK_HZ / B.period * B.yield)) < 1e-9,
      'a fed crusher adds ' + B.yield + ' ore every ' + B.period + ' ticks (' +
      wet.stages[0].rate + ')');
    assert(wet.flow.ironOre > dry.flow.ironOre, 'and the ore trend answers');

    // the routing layer is counted and rated, and it is never a stage: it
    // makes nothing, and the number that matters about it is that it is
    // faster than everything that fills it (SPEC §12)
    assertEq(dry.route.n, 0, 'no routing structures, nothing to report');
    const before = dry.stages.length;
    let laid = 0;
    for (const t of ['splitter', 'tunnel', 'loader', 'filter']) {
      let done = false;
      for (let y = 0; y < D.MAP_H && !done; y++)
        for (let x = 0; x < D.MAP_W && !done; x++)
          if (S.canPlace(r, t, x, y, 1).ok) done = S.place(r, t, x, y, 1);
      assert(done, 'a ' + t + ' site exists');
      laid++;
    }
    assertEq(laid, 4, 'one of each routing structure placed');
    S.tick(r);
    const routed = S.chain(r);
    assertEq(routed.route.n, 4, 'CHAIN counts every routing structure');
    assert(Math.abs(routed.route.rate - D.TICK_HZ / D.BELT_PERIOD) < 1e-9,
      'and rates them at the belt (' + routed.route.rate + '/s)');
    assertEq(routed.stages.length, before, 'the routing layer is not a stage');
    for (const s of routed.stages)
      assert(s.gears === undefined || s.n > 0 || s.rate === 0,
        'no stage was invented for a structure that makes nothing');
    // the lonely tunnel is reported, because that IS the fault the panel can
    // see and the player cannot
    assert(routed.route.lonely >= 1, 'a tunnel with one end is reported as lonely');
  }

  // it is a READ: no mutation, and not one draw from the sim's stream
  assertEq(r.rng(), twin.rng(), 'Sim.chain never advances run.rng (SPEC3 law 7)');
  return ch;
}

function main() {
  checkArt();
  const glyphN = checkGlyphInventory();
  checkSave();
  const digFinds = checkDigFinds();
  const spoil = rockOreSection();   // M-ROCKORE: the 30% roll, measured
  const vignettes = checkVignettes();
  const catNote = checkCat();
  const lmSweep = checkLandmarkSweep();
  const diagN = checkDiagnostics();   // M-ONBOARD: the game explains itself
  const rigFeed = checkRigOutput();   // facing, not adjacency, feeds the rig
  const tier2N = checkTier2();        // M-TIER2: the tier-II logistics layer
  const chainCh = checkChain();       // M-WIDE: the CHAIN panel's numbers
  const mutN = checkMutators();       // M-MANTLE: the deep's one rule per floor
  const schemN = checkSchems2();      // M-SCHEMS2: the second card batch
  const wormN = checkWorms();         // M-WORMS: the wildlife, the lure, the toad

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
    ' | glyphs ' + glyphN + ' in the subset' +
    ' | dig finds ' + digFinds + '/4000, all 7 kinds' +
    ' | spoil ' + spoil +
    ' | ' + vignettes + ' | ' + catNote +
    ' | landmarks ' + lmSweep.withLm + '/' + lmSweep.maps + ' maps, ' +
    lmSweep.cells + ' cells, ' + Object.keys(lmSweep.ids).length + ' kinds, ' +
    'veins+connectivity held' +
    ' | diagnostics: ' + diagN + ' causes named, once each, rng untouched' +
    ' | ' + rigFeed +
    ' | tier II: ' + tier2N + ' structures, facing not adjacency, line > machines' +
    ' | mutators ' + mutN + ' dealt of ' + D.MUTATORS.length + ' written, one roll a floor' +
    ' | schems2: ' + schemN + ' cards through the real pick path' +
    ' | worms: ' + wormN.toads + '/' + wormN.maps + ' maps have an Undertoad, ' +
    'tunnels ' + wormN.tunnel + ', a lure never moves the stream' +
    ' | chain: ' + chainCh.stages.map(s => s.n + s.letter + ' ' +
      s.rate.toFixed(2) + '/s').join(' -> ') +
    ' limited by ' + chainCh.stages.filter(s => s.limiting).map(s => s.name).join(','));
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
