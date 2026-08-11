/* DEEPCORE — test/balance.js
   Balance sweep harness (permanent, node). Measures SPEC.md §12 targets.

   Not a pass/fail suite: it prints numbers you tune `js/data.js` against.
   Exit code is 0 unless the harness itself breaks.

   The bot machinery is lifted from test/integration.js `mkBot` (same shape:
   floor/rock Dijkstra belt routing, smelter chain builder, assembler
   installer) with three changes:
     1. PATHFINDING IS A FIELD, NOT A QUERY. integration.js runs one Dijkstra
        per (candidate, facing) pair — planChain did up to ~18k of them per
        call, which is why the first cut of this file appeared to hang. Here a
        single multi-source Dijkstra is run *outward from the sink* and every
        candidate is an O(1) lookup + prev-walk. Same paths, ~50x cheaper.
     2. A BANKING CHAIN. A competent player keeps one smelter belted into the
        hub so plates accumulate for the NEXT stratum's base; only the surplus
        chains feed the assembler. Without it every plate becomes a gear and
        the rig arrives at stratum 2 unable to afford a smelter — which is a
        bot defect, not a balance signal.
     3. Depth play it needs to reach stratum 8 at all: a second gear assembler
        (one caps at 1 gear / 2.75s), dampers from stratum 2, a charge factory
        placed so a crystal extractor feeds it directly, schematic priority,
        overdrive, and scrapping the base before descending.

   What it reports per run: per-stratum breach and leave times, integrity and
   instability at each descent, plate reserve, live dampers, death depth and
   cause, quake/magma damage split, cores. Stalled strata print the build
   stages they reached ([c1+b2+asm+a2...]) so a bad row can be read as "the bot
   could not plan X" rather than "the balance is wrong".

   KNOWN BOT CEILING: the stratum-5 charge factory (crystal + coal + a copper
   smelter, all belted into one assembler) fails to plan on roughly a third of
   maps and shows up as `no-breach` with a `cu2X`/`cryX` stage count. Those
   rows are a planner limit, not a balance signal — treat win rates as a LOWER
   bound on competent human play.

   Two pacing policies:
     standard — descends as soon as the next base is affordable
     camper   — deliberately overstays to ~1.5x its own breach-ready time
   A stratum that never breaches rides out under rising instability to its
   natural death, so death depth reflects real punishment rather than a cap.

   Budgets (never silent-hang): every run has a sim-tick cap AND the sweep has
   a wall-clock budget; rows print as they finish.

   Usage: node test/balance.js [seed seed ...]
   Env:   DC_BAL_POLICIES=standard,camper   DC_BAL_CAPMIN=30
          DC_BAL_BUDGET=200 (wall seconds)  DC_BAL_META=m_stock:2,m_hull:1
          DC_TRACE=1 (30s progress snapshots to stderr) */
'use strict';

require('../js/data.js');
require('../js/art.js');
require('../js/map.js');
require('../js/sim.js');
require('../js/meta.js');
const DC = globalThis.DC;
const D = DC.DATA;
const S = DC.Sim;
const HZ = D.TICK_HZ;

const TRACE = !!process.env.DC_TRACE;
function key(x, y) { return x + ',' + y; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ------------------------------------------------------------ wall budget
const T0 = Date.now();
const BUDGET_MS = parseInt(process.env.DC_BAL_BUDGET || '200', 10) * 1000;
function elapsed() { return (Date.now() - T0) / 1000; }
function outOfTime() { return Date.now() - T0 > BUDGET_MS; }

// ---------------------------------------------------------------- geometry
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

// ------------------------------------------------------------------ the bot
function mkBot(run) {
  const bot = {};
  const builtBelts = [];
  const builtMachines = [];
  // Assembler pads held clear next to the rig. Mapgen guarantees a floor 7x7
  // around the hub, so claiming pads at stratum start (and routing belts
  // around them) is what keeps the "install the assembler" step from failing
  // on cramped maps — the same thing a player does by eye.
  let reserved = new Set();

  function T(x, y) {
    return (x >= 0 && y >= 0 && x < D.MAP_W && y < D.MAP_H) ? run.grid[y][x] : null;
  }
  function inv(item) { return run.inv[item] || 0; }
  bot.inv = inv;

  function stepTick() {
    S.tick(run);
    if (run.shake) run.shake = false;           // engine's job in the browser
    if (run.events.length > 64) run.events.splice(0, run.events.length - 8);
  }
  function tickN(n, withMaintain) {
    for (let i = 0; i < n && run.status !== 'dead'; i++) {
      stepTick();
      if (withMaintain && run.t % 16 === 0) maintain();
    }
  }
  bot.tickN = tickN;

  function passable(t, k, blocked) {
    if (!t || !t.revealed) return false;
    if (blocked && blocked.has(k)) return false;
    if (reserved.has(k)) return false;
    if (t.machine !== null && t.machine !== undefined) return false;
    if (t.belt) return false;
    return t.t === 'floor' || t.t === 'rock';
  }
  function cellCost(t) {
    if (t.t === 'rock') return 8;
    if (t.rubble) return 4;
    return t.ore ? 2 : 1;
  }

  // -- distance field: one Dijkstra outward from the SINK. Path cost is the
  // sum of cellCost over every tile the belt occupies (start and goal
  // included), which is symmetric, so a field built from the goals answers
  // "cheapest belt run from <any tile> into this machine" by lookup.
  function buildField(goalMap, blocked) {
    const dm = new Map(), prev = new Map(), heap = [];
    function hpush(n) {
      heap.push(n);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].d <= heap[i].d) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    }
    function hpop() {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let s = i;
          if (l < heap.length && heap[l].d < heap[s].d) s = l;
          if (r < heap.length && heap[r].d < heap[s].d) s = r;
          if (s === i) break;
          const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s;
        }
      }
      return top;
    }
    for (const k of goalMap.keys()) {
      const p = k.split(',');
      const x = +p[0], y = +p[1], t = T(x, y);
      if (!passable(t, k, blocked)) continue;
      const c = cellCost(t);
      if (dm.has(k) && dm.get(k) <= c) continue;
      dm.set(k, c);
      hpush({ k, x, y, d: c });
    }
    while (heap.length) {
      const cur = hpop();
      if (cur.d !== dm.get(cur.k)) continue;
      for (const dd of D.DIRS) {
        const nx = cur.x + dd.dx, ny = cur.y + dd.dy, nk = key(nx, ny);
        const t = T(nx, ny);
        if (!passable(t, nk, blocked)) continue;
        const nd = cur.d + cellCost(t);
        if (dm.has(nk) && dm.get(nk) <= nd) continue;
        dm.set(nk, nd);
        prev.set(nk, cur.k);
        hpush({ k: nk, x: nx, y: ny, d: nd });
      }
    }
    return { d: dm, prev, goalMap };
  }
  // Walk a field back to its sink. Returns { path (start..goal), into } | null.
  function fieldPath(fld, sx, sy) {
    let k = key(sx, sy);
    if (!fld.d.has(k)) return null;
    const path = [];
    for (let guard = 0; guard < 4096; guard++) {
      const p = k.split(',');
      path.push({ x: +p[0], y: +p[1] });
      if (fld.goalMap.has(k)) return { path, into: fld.goalMap.get(k) };
      const nk = fld.prev.get(k);
      if (nk === undefined) return null;
      k = nk;
    }
    return null;
  }
  function crosses(path, set) {
    for (const c of path) if (set.has(key(c.x, c.y))) return true;
    return false;
  }

  function hubCenter() { return { x: run.hub.x + 1, y: run.hub.y + 1 }; }
  function hubGoals() { return perimMap(rect(run.hub.x, run.hub.y, 3, 3)); }

  function oreTilesSorted(oreId, ref) {
    const out = [];
    for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
      const t = T(x, y);
      if (t && t.revealed && t.ore === oreId && t.oreAmt > 0 &&
          t.machine === null && !t.belt && t.t === 'floor') out.push({ x, y });
    }
    out.sort((a, b) => dist(a, ref) - dist(b, ref));
    return out;
  }

  function canAfford(type) {
    const cost = D.BUILDINGS[type].cost;
    for (const it in cost) if (inv(it) < cost[it]) return false;
    return true;
  }

  function placeMachine(type, x, y, facing) {
    if (!S.place(run, type, x, y, facing)) return false;
    builtMachines.push({ type, x, y, facing, retired: false });
    return true;
  }

  // A footprint a player would accept: clear floor, or rock/rubble they can
  // excavate first. Cramped maps (chasms from stratum 3 down) make the
  // dig-first case the difference between a base and a stalled rig.
  function siteFree(x, y, w, h, allowDig) {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const t = T(tx, ty);
      if (!t || !t.revealed || t.machine !== null || t.belt) return false;
      if (reserved.has(key(tx, ty))) return false;
      if (t.ore && t.oreAmt > 0) return false;   // never pave a live vein
      if (t.t === 'floor' && !t.rubble) continue;
      if (!allowDig) return false;
      if (t.t !== 'floor' && t.t !== 'rock') return false;   // chasm/magma/obsidian
    }
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
      for (let i = 0; i < D.DIG_ROCK + 8 && run.status !== 'dead'; i++) {
        stepTick();
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

  function retireBelts(list) {
    for (const b of list) {
      b.retired = true;
      const t = T(b.x, b.y);
      if (t && t.belt) S.demolishAt(run, b.x, b.y);
    }
  }

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
    upkeepFeeders();
  }

  // Cheapest extractor tile + belt run into `fp`, evaluated off one field.
  function planExtractor(tiles, fp, blocked) {
    if (!tiles.length) return null;
    const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
    const goals = perimMap(fp);
    for (const [k] of goals) if (blocked.has(k)) goals.delete(k);
    if (!goals.size) return null;
    const fld = buildField(goals, blocked);
    let best = null;
    for (const ot of tiles.slice(0, 16)) {
      const okey = key(ot.x, ot.y);
      if (blocked.has(okey)) continue;
      for (let f = 0; f < 4; f++) {
        const o = outputTile(ot.x, ot.y, 1, 1, f);
        const ok = key(o.x, o.y);
        if (fpSet.has(ok)) return { tile: ot, facing: f, path: [], into: null };
        if (blocked.has(ok)) continue;
        const r = fieldPath(fld, o.x, o.y);
        if (!r) continue;
        if (crosses(r.path, new Set([okey]))) continue;   // never belt over the vein tile
        if (!best || r.path.length < best.path.length) {
          best = { tile: ot, facing: f, path: r.path, into: r.into };
        }
      }
      if (best && best.path.length <= 2) break;
    }
    return best;
  }

  // A "chain" = smelter + ore extractor (+ coal extractor) + belts, output
  // belted into `sinkGoals` (the hub for a banking chain, an assembler
  // perimeter for a feeding chain).
  const SITE_LIMIT = 12, FACING_LIMIT = 2;
  // `anchor` is where the chain wants to live — the rig for a banking chain,
  // the machine it feeds for a remote one. Anchoring on the hub for a charge
  // factory out on the crystals plans 20-belt runs nobody can pay for.
  function planChain(oreId, sinkGoals, noCoal, sinkTag, anchor) {
    const hubC = anchor || hubCenter();
    const oreAll = oreTilesSorted(oreId, hubC);
    const coalAll = noCoal ? [] : oreTilesSorted('coal', hubC);
    if (!oreAll.length || (!noCoal && !coalAll.length)) return null;
    const sinkFld = buildField(sinkGoals, new Set());
    const sites = [];
    for (let y = 1; y < D.MAP_H - 2; y++) {
      for (let x = 1; x < D.MAP_W - 2; x++) {
        if (!siteFree(x, y, 2, 2, true)) continue;
        const ctr = { x: x + 0.5, y: y + 0.5 };
        if (dist(ctr, hubC) > 20) continue;
        sites.push({ x, y, ctr, dig: !siteFree(x, y, 2, 2, false) });
      }
    }
    if (!sites.length) return null;
    const near = (tiles, ctr) => tiles.reduce((m, t) => Math.min(m, dist(t, ctr)), 1e9);
    const siteScore = (v) => dist(v.ctr, hubC) * 1.2 + near(oreAll, v.ctr) +
      (noCoal ? 0 : near(coalAll, v.ctr)) + (v.dig ? 6 : 0);
    sites.sort((a, b) => siteScore(a) - siteScore(b));
    let fallback = null;
    for (const site of sites.slice(0, SITE_LIMIT)) {
      const fp = rect(site.x, site.y, 2, 2);
      const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
      const facings = [0, 1, 2, 3]
        .map((f) => ({ f, o: outputTile(site.x, site.y, 2, 2, f) }))
        .filter((v) => passable(T(v.o.x, v.o.y), key(v.o.x, v.o.y), fpSet))
        .sort((a, b) => (sinkFld.d.get(key(a.o.x, a.o.y)) || 1e9) -
                        (sinkFld.d.get(key(b.o.x, b.o.y)) || 1e9))
        .slice(0, FACING_LIMIT);
      for (const fc of facings) {
        const outLine = fieldPath(sinkFld, fc.o.x, fc.o.y);
        if (!outLine || crosses(outLine.path, fpSet)) continue;
        const blocked = new Set(fpSet);
        for (const c of outLine.path) blocked.add(key(c.x, c.y));
        const oreTiles = oreAll.slice().sort((a, b) => dist(a, site.ctr) - dist(b, site.ctr));
        const oreP = planExtractor(oreTiles, fp, blocked);
        if (!oreP) continue;
        blocked.add(key(oreP.tile.x, oreP.tile.y));
        for (const c of oreP.path) blocked.add(key(c.x, c.y));
        let coalP = null;
        if (!noCoal) {
          const coalTiles = coalAll.slice().sort((a, b) => dist(a, site.ctr) - dist(b, site.ctr));
          coalP = planExtractor(coalTiles, fp, blocked);
          if (!coalP) continue;
        }
        const belts = outLine.path.length + oreP.path.length + (coalP ? coalP.path.length : 0);
        const plan = { site, facing: fc.f, fp, outLine, oreP, coalP, belts, sink: sinkTag };
        if (belts <= 10) return plan;
        if (!fallback || belts < fallback.belts) fallback = plan;
      }
    }
    return fallback;
  }
  bot.planChain = planChain;

  const chains = [];
  function buildChain(plan, oreId) {
    if (!plan) return null;
    if (plan.site.dig && !digIfNeeded(plan.fp)) return null;
    if (!placeMachine('smelter', plan.site.x, plan.site.y, plan.facing)) return null;
    if (!placeMachine('extractor', plan.oreP.tile.x, plan.oreP.tile.y, plan.oreP.facing)) return null;
    if (plan.coalP && !placeMachine('extractor', plan.coalP.tile.x, plan.coalP.tile.y, plan.coalP.facing)) return null;
    if (plan.oreP.path.length && !buildBeltLine(plan.oreP.path, plan.oreP.into, null)) return null;
    if (plan.coalP && plan.coalP.path.length && !buildBeltLine(plan.coalP.path, plan.coalP.into, null)) return null;
    const outBelts = [];
    if (!buildBeltLine(plan.outLine.path, plan.outLine.into, outBelts)) return null;
    const ch = {
      fp: plan.fp, sink: plan.sink || 'hub',
      out: outputTile(plan.site.x, plan.site.y, 2, 2, plan.facing),
      outBelts,
      feeders: [{ oreId: oreId || 'ironOre', x: plan.oreP.tile.x, y: plan.oreP.tile.y }],
    };
    if (plan.coalP) ch.feeders.push({ oreId: 'coal', x: plan.coalP.tile.x, y: plan.coalP.tile.y });
    chains.push(ch);
    return ch;
  }
  bot.buildChain = buildChain;
  bot.chainCost = (p) =>
    D.BUILDINGS.smelter.cost.ironPlate +
    D.BUILDINGS.extractor.cost.ironPlate * (p.coalP ? 2 : 1) +
    (run.mods.beltFree ? 0 : p.belts);

  // Replant a chain's extractor when its vein tile runs dry.
  function upkeepFeeders() {
    for (const ch of chains) {
      const st = T(ch.fp[0].x, ch.fp[0].y);
      if (!st || st.machine === null) continue;
      for (const fd of ch.feeders) {
        const t = T(fd.x, fd.y);
        if (!t) continue;
        const m = t.machine !== null ? run.machines[t.machine] : null;
        if (m && m.type === 'extractor' && t.oreAmt > 0) continue;
        if (m && m.type === 'extractor' && t.oreAmt <= 0) {
          S.demolishAt(run, fd.x, fd.y);
          for (const bm of builtMachines) {
            if (bm.type === 'extractor' && bm.x === fd.x && bm.y === fd.y) bm.retired = true;
          }
        }
        if (t.machine !== null) continue;
        if (inv('ironPlate') < D.BUILDINGS.extractor.cost.ironPlate + 2) continue;
        const tiles = oreTilesSorted(fd.oreId, { x: ch.fp[0].x, y: ch.fp[0].y });
        if (!tiles.length) continue;
        const plan = planExtractor(tiles, ch.fp, new Set());
        if (!plan) continue;
        const cost = D.BUILDINGS.extractor.cost.ironPlate +
          (run.mods.beltFree ? 0 : plan.path.length);
        if (cost + 2 > inv('ironPlate')) continue;
        if (!placeMachine('extractor', plan.tile.x, plan.tile.y, plan.facing)) continue;
        if (plan.path.length) buildBeltLine(plan.path, plan.into, null);
        fd.x = plan.tile.x; fd.y = plan.tile.y;
      }
    }
  }

  // Install an assembler near the hub fed by `feedChains`; output belted (or
  // direct) into the hub. Returns { x, y, facing, fp } or null.
  const asmFail = { site: 0, route: 0, cost: 0 };
  bot.asmFail = asmFail;
  // The 8 spots whose 2x2 output tile lands straight on the rig (no belt run
  // at all). Reserved at stratum start, released as they are claimed.
  function padCands() {
    const hx = run.hub.x, hy = run.hub.y;
    return [
      { x: hx - 2, y: hy, f: 1 }, { x: hx + 3, y: hy, f: 3 },
      { x: hx, y: hy - 2, f: 2 }, { x: hx, y: hy + 3, f: 0 },
      { x: hx - 2, y: hy + 1, f: 1 }, { x: hx + 3, y: hy + 1, f: 3 },
      { x: hx + 1, y: hy - 2, f: 2 }, { x: hx + 1, y: hy + 3, f: 0 },
    ];
  }
  const pads = [];
  function reservePads(n) {
    reserved = new Set();
    pads.length = 0;
    for (const c of padCands()) {
      if (pads.length >= n) break;
      const fp = rect(c.x, c.y, 2, 2);
      if (fp.some((p) => reserved.has(key(p.x, p.y)))) continue;
      if (!siteFree(c.x, c.y, 2, 2, false)) continue;
      const o = outputTile(c.x, c.y, 2, 2, c.f);
      const t = T(o.x, o.y);
      if (!(t && t.machine === 0)) continue;
      for (const p of fp) reserved.add(key(p.x, p.y));
      pads.push({ x: c.x, y: c.y, f: c.f, fp });
    }
  }
  bot.reservePads = reservePads;
  // Held pads block belt routing right where the base is densest; let them go
  // the moment the last assembler that wanted one is up.
  function releasePads() { reserved = new Set(); pads.length = 0; }

  // Claim a reserved pad: place the assembler, belt the feed chains in.
  function installOnPad(feedChains) {
    while (pads.length) {
      const pad = pads.shift();
      for (const p of pad.fp) reserved.delete(key(p.x, p.y));
      if (!siteFree(pad.x, pad.y, 2, 2, false)) continue;
      if (D.BUILDINGS.assembler.cost.ironPlate > inv('ironPlate')) { pads.unshift(pad); return null; }
      for (const c of feedChains) retireBelts(c.outBelts);
      if (!placeMachine('assembler', pad.x, pad.y, pad.f)) continue;
      const fpSet = new Set(pad.fp.map((p) => key(p.x, p.y)));
      const goals = perimMap(pad.fp);
      const blocked = new Set(fpSet);
      let fld = buildField(goals, blocked);
      let fed = false;
      for (const ch of feedChains) {
        if (fpSet.has(key(ch.out.x, ch.out.y))) { ch.sink = 'asm'; fed = true; continue; }
        let r = fieldPath(fld, ch.out.x, ch.out.y);
        if (!r && reserved.size) {          // a spare pad is not worth a dead line
          reserved = new Set();
          pads.length = 0;
          fld = buildField(goals, blocked);
          r = fieldPath(fld, ch.out.x, ch.out.y);
        }
        ch.outBelts.length = 0;
        // a half-built belt run (dig failed / out of plates) is NOT a feed:
        // claiming it starves the assembler with no watchdog
        if (r && buildBeltLine(r.path, r.into, ch.outBelts)) { ch.sink = 'asm'; fed = true; }
        else {                                                  // fall back: bank
          ch.outBelts.length = 0;
          const rh = fieldPath(buildField(hubGoals(), new Set()), ch.out.x, ch.out.y);
          if (rh) buildBeltLine(rh.path, rh.into, ch.outBelts);
          ch.sink = 'hub';
        }
        for (const b of ch.outBelts) b.retired = false;
      }
      return { x: pad.x, y: pad.y, facing: pad.f, fp: pad.fp, fed: fed };
    }
    return null;
  }

  // opts: { pad:false } to skip the rig-side pads, { near:{x,y}, radius:n } to
  // anchor the search somewhere else (the charge assembler wants to sit on the
  // crystals, not in the belt jam around the rig).
  function installAssembler(feedChains, opts) {
    opts = opts || {};
    if (opts.pad !== false) {
      const onPad = installOnPad(feedChains);
      if (onPad) return onPad;
    }
    const anchor = opts.near || hubCenter();
    const radius = opts.radius || 12;
    asmFail.site = asmFail.route = asmFail.cost = 0;
    for (const c of feedChains) retireBelts(c.outBelts);
    const hx = run.hub.x, hy = run.hub.y;
    const cands = [
      { x: hx - 2, y: hy, f: 1 }, { x: hx + 3, y: hy, f: 3 },
      { x: hx, y: hy - 2, f: 2 }, { x: hx, y: hy + 3, f: 0 },
      { x: hx - 2, y: hy + 1, f: 1 }, { x: hx + 3, y: hy + 1, f: 3 },
      { x: hx + 1, y: hy - 2, f: 2 }, { x: hx + 1, y: hy + 3, f: 0 },
    ];
    const hubC = hubCenter();
    const generic = [];
    for (let y = 1; y < D.MAP_H - 2; y++) {
      for (let x = 1; x < D.MAP_W - 2; x++) {
        if (dist({ x: x + 0.5, y: y + 0.5 }, anchor) > radius) continue;
        if (!siteFree(x, y, 2, 2, true)) continue;   // filter BEFORE slicing:
        generic.push({ x, y, f: -1 });               // the nearest tiles are
      }                                              // the hub and its base
    }
    generic.sort((a, b) => dist(a, anchor) - dist(b, anchor));
    const hubFld = buildField(hubGoals(), new Set());
    const list = (opts.pad === false ? [] : cands).concat(generic.slice(0, 80));
    for (let phase = 0; phase < 2; phase++)
    for (const c of list) {
      const facings = c.f >= 0 ? [c.f] : [0, 1, 2, 3];
      for (const f of facings) {
        if (!siteFree(c.x, c.y, 2, 2, phase === 1)) { asmFail.site++; continue; }
        if (phase === 0 && !S.canPlace(run, 'assembler', c.x, c.y, f).ok) { asmFail.site++; continue; }
        const fp = rect(c.x, c.y, 2, 2);
        const fpSet = new Set(fp.map((p) => key(p.x, p.y)));
        const blocked = new Set(fpSet);
        const routes = [];
        let ok = true;
        const o = outputTile(c.x, c.y, 2, 2, f);
        const oT = T(o.x, o.y);
        if (!(oT && oT.machine === 0)) {
          const r = fieldPath(hubFld, o.x, o.y);
          if (!r || crosses(r.path, fpSet)) { ok = false; } else {
            routes.push({ r, ch: null });
            for (const p of r.path) blocked.add(key(p.x, p.y));
          }
        }
        if (ok && feedChains.length) {
          const goals = perimMap(fp);
          for (const [k] of goals) if (blocked.has(k)) goals.delete(k);
          const fld = goals.size ? buildField(goals, blocked) : null;
          for (const ch of feedChains) {
            if (fpSet.has(key(ch.out.x, ch.out.y))) continue;   // direct feed
            const r = fld && fieldPath(fld, ch.out.x, ch.out.y);
            if (!r) { ok = false; break; }
            routes.push({ r, ch });
            for (const p of r.path) blocked.add(key(p.x, p.y));
          }
        }
        if (!ok) { asmFail.route++; continue; }
        const beltCost = run.mods.beltFree ? 0 : routes.reduce((n, r) => n + r.r.path.length, 0);
        if (D.BUILDINGS.assembler.cost.ironPlate + beltCost + 2 > inv('ironPlate')) { asmFail.cost++; continue; }
        if (phase === 1 && !digIfNeeded(rect(c.x, c.y, 2, 2))) continue;
        if (!placeMachine('assembler', c.x, c.y, f)) continue;
        for (const r of routes) {
          if (r.ch) r.ch.outBelts.length = 0;
          digIfNeeded(r.r.path);
          for (let i = 0; i < r.r.path.length; i++) {
            const next = (i + 1 < r.r.path.length) ? r.r.path[i + 1] : r.r.into;
            const dir = dirBetween(r.r.path[i], next);
            if (dir < 0) continue;
            const rec = { x: r.r.path[i].x, y: r.r.path[i].y, dir, retired: false };
            builtBelts.push(rec);
            if (r.ch) r.ch.outBelts.push(rec);
            S.place(run, 'belt', r.r.path[i].x, r.r.path[i].y, dir);
          }
        }
        return { x: c.x, y: c.y, facing: f, fp };
      }
    }
    // couldn't place: put the feed chains back on the hub so plates keep flowing
    for (const ch of feedChains) {
      ch.outBelts.length = 0;
      const r = fieldPath(hubFld, ch.out.x, ch.out.y);
      if (r) buildBeltLine(r.path, r.into, ch.outBelts);
      for (const b of ch.outBelts) b.retired = false;
    }
    return null;
  }

  // Set an assembler's recipe by cycling clickTile (max 4 clicks).
  function setRecipe(asm, want) {
    for (let i = 0; i < 4; i++) {
      const t = T(asm.x, asm.y);
      const m = t && t.machine !== null ? run.machines[t.machine] : null;
      if (!m || m.type !== 'assembler') return false;
      if (m.recipe === want) return true;
      S.clickTile(run, asm.x, asm.y);
    }
    return false;
  }

  // Route a raw-ore extractor line into an existing footprint.
  const feedFail = {};
  bot.feedFail = feedFail;
  function addOreFeed(oreId, fp) {
    const bump = (k) => { feedFail[oreId + k] = (feedFail[oreId + k] || 0) + 1; };
    const tiles = oreTilesSorted(oreId, { x: fp[0].x, y: fp[0].y });
    if (!tiles.length) { bump('-none'); return false; }
    const plan = planExtractor(tiles, fp, new Set());
    if (!plan) { bump('-noroute'); return false; }
    const cost = D.BUILDINGS.extractor.cost.ironPlate +
      (run.mods.beltFree ? 0 : plan.path.length);
    if (cost + 2 > inv('ironPlate')) { bump('-poor'); return false; }
    if (!placeMachine('extractor', plan.tile.x, plan.tile.y, plan.facing)) { bump('-place'); return false; }
    if (plan.path.length && !buildBeltLine(plan.path, plan.into, null)) { bump('-belt'); return false; }
    chains.push({ fp, out: null, outBelts: [],
      feeders: [{ oreId, x: plan.tile.x, y: plan.tile.y }] });
    return true;
  }

  // Dampers: the only real answer to the instability ratchet (each one cuts
  // the rate 25%, max 3). Fed directly off an extractor sitting on a coal
  // vein — a belt run would stall, since one damper buffers to INPUT_CAP and
  // backpressures everything behind it.
  function damperCount() {
    let n = 0;
    for (const id in run.machines) if (run.machines[id] && run.machines[id].type === 'damper') n++;
    return n;
  }
  bot.damperCount = damperCount;
  function buildDamper() {
    if (damperCount() >= D.DAMPER_MAX) return false;
    const cost = D.BUILDINGS.damper.cost;
    for (const k in cost) if (inv(k) < cost[k]) return false;
    if (inv('ironPlate') < (cost.ironPlate || 0) + D.BUILDINGS.extractor.cost.ironPlate + 4) return false;
    const coal = oreTilesSorted('coal', hubCenter());
    for (const ct of coal.slice(0, 12)) {
      for (let f = 0; f < 4; f++) {
        const o = outputTile(ct.x, ct.y, 1, 1, f);
        if (!S.canPlace(run, 'damper', o.x, o.y, 0).ok) continue;
        if (!S.canPlace(run, 'extractor', ct.x, ct.y, f).ok) continue;
        if (!placeMachine('damper', o.x, o.y, 0)) continue;
        if (!placeMachine('extractor', ct.x, ct.y, f)) { S.demolishAt(run, o.x, o.y); continue; }
        return true;
      }
    }
    return false;
  }

  // Re-point a live chain's output at `fp`. Retiring its belts first frees the
  // very tiles that were fencing the target in, which is why this succeeds
  // where planning a whole new chain does not.
  function rerouteChain(ch, fp) {
    if (!ch.out) return false;
    const smelt = T(ch.fp[0].x, ch.fp[0].y);
    if (!smelt || smelt.machine === null) return false;
    retireBelts(ch.outBelts);
    ch.outBelts.length = 0;
    const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
    const goals = perimMap(fp);
    const r = fieldPath(buildField(goals, fpSet), ch.out.x, ch.out.y);
    if (r && !crosses(r.path, fpSet) && buildBeltLine(r.path, r.into, ch.outBelts)) {
      ch.sink = 'asm';
      for (const b of ch.outBelts) b.retired = false;
      return true;
    }
    ch.outBelts.length = 0;                        // put it back on the rig
    const rh = fieldPath(buildField(hubGoals(), new Set()), ch.out.x, ch.out.y);
    if (rh) buildBeltLine(rh.path, rh.into, ch.outBelts);
    for (const b of ch.outBelts) b.retired = false;
    ch.sink = 'hub';
    return false;
  }

  // The charge factory, built the only way that reliably works: pick the pad
  // so a crystal extractor's OUTPUT TILE lands inside the assembler footprint
  // (direct feed, zero belts), then belt the output to the rig. Routing a
  // crystal line to an assembler chosen first fails on ~1 map in 3.
  function installChargeFactory() {
    const hubFld = buildField(hubGoals(), new Set());
    const crystals = oreTilesSorted('crystal', hubCenter());
    const offs = [{ dx: 0, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 }];
    for (const ct of crystals.slice(0, 10)) {
      for (let ef = 0; ef < 4; ef++) {
        const o = outputTile(ct.x, ct.y, 1, 1, ef);
        for (const off of offs) {
          const x = o.x + off.dx, y = o.y + off.dy;
          if (!siteFree(x, y, 2, 2, true)) continue;
          const fp = rect(x, y, 2, 2);
          const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
          for (let f = 0; f < 4; f++) {
            const out = outputTile(x, y, 2, 2, f);
            const oT = T(out.x, out.y);
            let route = null;
            if (oT && oT.machine === 0) route = { path: [], into: null };
            else {
              const r = fieldPath(hubFld, out.x, out.y);
              if (!r || crosses(r.path, fpSet) || r.path.some((c) => c.x === ct.x && c.y === ct.y)) continue;
              route = r;
            }
            const belts = run.mods.beltFree ? 0 : route.path.length;
            if (D.BUILDINGS.assembler.cost.ironPlate + belts +
                D.BUILDINGS.extractor.cost.ironPlate + 2 > inv('ironPlate')) continue;
            if (!digIfNeeded(fp)) continue;
            if (!placeMachine('assembler', x, y, f)) continue;
            if (route.path.length) buildBeltLine(route.path, route.into, null);
            if (!placeMachine('extractor', ct.x, ct.y, ef)) {
              S.demolishAt(run, x, y);
              continue;
            }
            return { x, y, facing: f, fp };
          }
        }
      }
    }
    return null;
  }

  function scrapAll() {
    const ids = Object.keys(run.machines).map(Number).filter((i) => i !== 0);
    for (const id of ids) {
      const m = run.machines[id];
      if (!m) continue;
      S.demolishAt(run, m.x, m.y);
    }
    for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
      const t = T(x, y);
      if (t && t.belt) S.demolishAt(run, x, y);
    }
    for (const b of builtBelts) b.retired = true;
    for (const m of builtMachines) m.retired = true;
    builtBelts.length = 0;
    builtMachines.length = 0;
    chains.length = 0;
  }
  bot.scrapAll = scrapAll;

  // Overdrive: on while feeding a banked stock at low risk.
  function driveOverdrive() {
    let want = false;
    if (run.status === 'active' && run.instability < 45 && run.integrity > 50) {
      const gearsLeft = run.breachReq.gear - run.gearsFed;
      want = gearsLeft > 0 ? inv('gear') >= 8 : inv('charge') >= 4;
    }
    if (want !== run.overdrive) S.toggleOverdrive(run);
  }

  const lineAlive = () => {
    let a = false, s = false;
    for (const id in run.machines) {
      const m = run.machines[id];
      if (m && m.type === 'assembler') a = true;
      if (m && m.type === 'smelter') s = true;
    }
    return s && a;
  };

  // Play the current stratum toward breachReady, then bank/linger per policy.
  bot.playStratum = function (policy, capTotalT) {
    const depth = run.depth;
    const st = { depth, req: run.breachReq.gear + '+' + run.breachReq.charge,
                 tBreach: null, tLeave: null, integEnd: null, instEnd: null,
                 platesEnd: null, gearsEnd: null, damp: 0, stall: false,
                 st: {} };   // build stages reached, for diagnosing stalls
    const capT = BOT.stratCapSec * HZ;
    const trace = () => {
      if (TRACE && run.t % (30 * HZ) < 16) {
        console.error('  [' + policy + '] d' + depth + ' t=' + Math.round(run.t / HZ) +
          's integ=' + Math.ceil(run.integrity) + ' inst=' + Math.round(run.instability) +
          ' fed=' + run.gearsFed + '/' + run.breachReq.gear +
          '+' + run.chargesFed + '/' + run.breachReq.charge +
          ' plates=' + inv('ironPlate') + ' gears=' + inv('gear') +
          ' machines=' + (Object.keys(run.machines).length - 1));
      }
    };
    const finish = () => {
      for (const k in feedFail) if (feedFail[k]) st.st[k] = feedFail[k];
      st.tLeave = Math.round(run.t / HZ);
      st.integEnd = Math.max(0, Math.ceil(run.integrity));
      st.instEnd = Math.round(run.instability);
      st.platesEnd = inv('ironPlate');
      st.gearsEnd = inv('gear');
      st.damp = damperCount();
      return st;
    };
    const alive = () => run.status !== 'dead' && run.totalT < capTotalT && !outOfTime();

    // charge assemblers build out on the crystals, so pads are gear-only
    const wantPads = 1 + (run.breachReq.gear >= BOT.asm2GearReq ? 1 : 0);
    reservePads(wantPads);
    tickN(48, false);                        // scan opens past guaranteed veins

    // phase 1: the banking chain (smelter -> hub: plates for the next base)
    let c1 = null;
    const minChain = D.BUILDINGS.smelter.cost.ironPlate +
                     D.BUILDINGS.extractor.cost.ironPlate * 2;
    while (!c1 && run.status === 'active' && run.t < capT / 2 && alive()) {
      if (inv('ironPlate') >= minChain) {
        const p1 = planChain('ironOre', hubGoals(), false);
        if (p1 && bot.chainCost(p1) <= inv('ironPlate')) c1 = buildChain(p1, 'ironOre');
      }
      if (!c1) tickN(48, true);
      trace();
    }
    if (run.status === 'dead' || !alive()) return finish();
    if (!c1) { st.stall = 'no-iron-chain'; return finish(); }
    st.st.c1 = 1;

    // Main loop. Build order matters more than anything else the bot does:
    // the SECOND chain goes up BEFORE the assembler, because installing the
    // assembler converts chain 1's plate stream into gears and plate income
    // would otherwise be zero forever — no rebuilds, no next base.
    let asm = null, asmTries = 0, asm2g = null, asm2gFeed = null;
    let bank2 = null, bank2Tries = 0, feedChain = null;
    let cuChain = null, cuTries = 0;
    let asm2 = null;
    const asm2Feeds = { crystal: false, coal: false, copper: false };
    let iter = 0, lastGearProg = -1, lastGearT = 0;
    while (run.status === 'active' && run.t < capT && alive()) {
      tickN(16, true);
      iter++;
      driveOverdrive();
      trace();
      const gearProg = run.gearsFed + inv('gear');
      if (gearProg > lastGearProg) { lastGearProg = gearProg; lastGearT = run.t; }
      if (iter % 2 !== 0) continue;          // planning is heavy; throttle it
      if (!asm && !bank2 && bank2Tries < 6 && inv('ironPlate') >= BOT.bank2Gate) {
        const p = planChain('ironOre', hubGoals(), false);
        if (p && bot.chainCost(p) + 4 <= inv('ironPlate')) bank2 = buildChain(p, 'ironOre');
        if (!bank2) bank2Tries++; else st.st.b2 = 1;
        continue;
      }
      if (!asm && (bank2 || bank2Tries >= 6) && inv('ironPlate') >= BOT.asmGate(depth)) {
        asm = installAssembler([c1]);        // c1 switches from banking to feeding
        if (asm) { st.st.asm = 1; if (wantPads < 2) releasePads(); }
        if (!asm && ++asmTries >= 8) {
          st.stall = 'no-asm(site' + asmFail.site + '/route' + asmFail.route +
                     '/cost' + asmFail.cost + ')';
          break;
        }
        continue;
      }
      if (!asm) continue;
      // The charge tier gates the breach outright from stratum 5 down, so it
      // outranks everything except being alive.
      if (run.breachReq.charge > 0) {
        if (!asm2 && inv('ironPlate') >= BOT.chargeAsmGate) {
          releasePads();                       // charges outrank a spare pad
          asm2 = installChargeFactory();
          if (asm2) {
            setRecipe(asm2, 'charge');
            asm2Feeds.crystal = true;          // the extractor feeds it directly
            st.st.a2 = 1;
          } else {
            asm2 = installAssembler([], { pad: false, radius: 16 });
            if (asm2) { setRecipe(asm2, 'charge'); st.st.a2b = 1; }
            else st.st.a2X = (st.st.a2X || 0) + 1;
          }
          continue;
        }
        if (asm2 && !asm2Feeds.crystal) {
          asm2Feeds.crystal = addOreFeed('crystal', asm2.fp);
          if (asm2Feeds.crystal) st.st.cry = 1; else st.st.cryX = (st.st.cryX || 0) + 1;
          continue;
        }
        if (asm2 && !asm2Feeds.coal) {
          asm2Feeds.coal = addOreFeed('coal', asm2.fp);
          if (asm2Feeds.coal) st.st.cl = 1; else st.st.clX = (st.st.clX || 0) + 1;
          continue;
        }
        if (asm2 && !asm2Feeds.copper) {
          if (inv('ironPlate') >= BOT.copperGate) {
            const p = planChain('copperOre', perimMap(asm2.fp), false, 'asm',
                                { x: asm2.x + 0.5, y: asm2.y + 0.5 });
            if (p && bot.chainCost(p) <= inv('ironPlate')) {
              asm2Feeds.copper = !!buildChain(p, 'copperOre');
            }
            if (asm2Feeds.copper) st.st.cu2 = 1;
            else st.st.cu2X = (st.st.cu2X || 0) + 1;
          }
          if (!asm2Feeds.copper && (st.st.cu2X || 0) < BOT.chargeTries) continue;
        }
      }
      // copper stock, then dampers: instability control pays for the whole
      // rest of the run, so it outranks raw gear throughput
      if (!cuChain && depth >= 2 && cuTries < 6 &&
          inv('copperPlate') < BOT.copperStock && inv('ironPlate') >= BOT.copperGate) {
        const p = planChain('copperOre', hubGoals(), false);
        if (p && bot.chainCost(p) + 4 <= inv('ironPlate')) cuChain = buildChain(p, 'copperOre');
        if (!cuChain) cuTries++; else st.st.cu = 1;
        continue;
      }
      if (depth >= 2 && damperCount() < D.DAMPER_MAX &&
          inv('ironPlate') >= BOT.damperGate && buildDamper()) continue;
      // a SECOND gear assembler: one caps out at 1 gear / 3.5s, which cannot
      // pay a 60+ gear breach bill inside a stratum's instability budget
      if (!asm2g && run.breachReq.gear >= BOT.asm2GearReq &&
          inv('ironPlate') >= BOT.asm2Gate) {
        asm2g = installAssembler([]);
        if (asm2g) { setRecipe(asm2g, 'gear'); st.st.a2g = 1; releasePads(); }
        else st.st.a2gX = (st.st.a2gX || 0) + 1;
        continue;
      }
      if (asm2g && !asm2gFeed && inv('ironPlate') >= BOT.feedGate) {
        const p = planChain('ironOre', perimMap(asm2g.fp), false, 'asm',
                            { x: asm2g.x + 0.5, y: asm2g.y + 0.5 });
        if (p && bot.chainCost(p) + 6 <= inv('ironPlate')) {
          asm2gFeed = buildChain(p, 'ironOre');
          if (asm2gFeed) st.st.f2 = 1;
        }
        continue;
      }
      // a third chain into the assembler when the gear bill is big — or a
      // first one, if the install could not route the original chain in
      // Trust nothing: if fed gears + banked gears have not moved in a while
      // and the breach still wants gears, the line is broken however it looks.
      const starving = !chains.some((ch) => ch.sink === 'asm') ||
        (run.gearsFed < run.breachReq.gear && run.t - lastGearT > BOT.starveSec * HZ);
      if (starving) {
        // cheapest fix first: re-point a banking chain at the assembler
        let fixed = false;
        for (const ch of chains) {
          if (ch.sink === 'asm' || !ch.out) continue;
          if (rerouteChain(ch, asm.fp)) { fixed = true; st.st.rr = (st.st.rr || 0) + 1; break; }
        }
        if (fixed) { lastGearT = run.t; continue; }
      }
      if (!feedChain && (starving ||
          (run.breachReq.gear >= BOT.feedGearReq && inv('ironPlate') >= BOT.feedGate))) {
        const p = planChain('ironOre', perimMap(asm.fp), false, 'asm',
                            { x: asm.x + 0.5, y: asm.y + 0.5 });
        if (p && bot.chainCost(p) + 8 <= inv('ironPlate')) feedChain = buildChain(p, 'ironOre');
        if (feedChain) { st.st.f = 1; lastGearT = run.t; }
        else st.st.fX = (st.st.fX || 0) + 1;
        continue;
      }
    }
    if (run.overdrive) S.toggleOverdrive(run);
    if (run.status === 'dead') return finish();
    if (run.status !== 'breachReady') { if (!st.stall) st.stall = 'no-breach'; return finish(); }
    st.tBreach = Math.round(run.t / HZ);

    // post-breach: camper overstays; standard leaves as soon as the next base
    // is affordable (and never rides instability past the panic line)
    if (policy === 'camper') {
      const until = Math.round(st.tBreach * BOT.camperLinger) * HZ;
      while (run.status === 'breachReady' && run.t < until && alive()) {
        tickN(16, true);
        trace();
      }
    } else if (depth < D.STRATA_COUNT) {
      const until = run.t + BOT.descendWaitSec * HZ;
      while (run.status === 'breachReady' && run.t < until && alive() &&
             inv('ironPlate') < BOT.descendReserve &&
             run.instability < BOT.panicInst && lineAlive()) {
        tickN(16, true);
        trace();
      }
    }
    return finish();
  };

  return bot;
}

// -------------------------------------------------------- policy constants
// Fixed across tuning passes so before/after sweeps are apples-to-apples.
const BOT = {
  stratCapSec: 420,               // per-stratum no-breach cap -> stall
  asmGate: (depth) => (depth === 1 ? 20 : 20),
  bank2Gate: 38,                  // plates before the second banking chain
  feedGearReq: 40, feedGate: 46,  // third chain, straight into the assembler
  descendReserve: 65,             // standard leaves once the next base is paid for
  descendWaitSec: 90, panicInst: 78,
  camperLinger: 1.5,              // camper leaves at 1.5x its breach-ready time
  copperStock: 8, damperGate: 30, // copper bank + plate floor for a damper pair
  asm2GearReq: 40, asm2Gate: 40,  // second gear assembler once the bill is big
  chargeTries: 10,                // give up re-planning a charge feed after this
  starveSec: 50,                  // no gear progress this long => the line is dead
  chargeAsmGate: 26, copperGate: 40,
  pickOrder: ['s_plate', 's_damp', 's_drill', 's_charge', 's_extract', 's_smelt',
              's_veins', 's_salvage', 's_coal', 's_survey', 's_over',
              's_beltfree', 's_repair', 's_gear'],
};
function pickSchematic(run) {
  for (const id of BOT.pickOrder) if (run.pendingOffers.indexOf(id) >= 0) return id;
  return run.pendingOffers[0];
}

// ------------------------------------------------------------------ one run
function playRun(seed, policy, capMin, effects) {
  const run = S.newRun(effects, seed);
  const bot = mkBot(run);
  const capTotalT = capMin * 60 * HZ;
  const rec = { policy, seed, strata: [], outcome: '?', deathDepth: null,
                totalSec: 0, cores: 0, minInteg: run.integrity, maxInst: 0,
                quakes: 0, quakeDmg: 0, magmaDmg: 0, cause: '-', schematics: '' };
  const harvest = () => {
    for (const e of run.events) {
      if (e.type === 'quake') { rec.quakes++; rec.quakeDmg += (e.data && e.data.dmg) || 0; }
    }
    run.events.length = 0;
    rec.minInteg = Math.min(rec.minInteg, run.integrity);
    rec.maxInst = Math.max(rec.maxInst, run.instability);
  };
  while (run.status !== 'dead' && run.status !== 'won' &&
         run.totalT < capTotalT && !outOfTime()) {
    const sRec = bot.playStratum(policy, capTotalT);
    harvest();
    rec.strata.push(sRec);
    if (run.status === 'dead' || run.status === 'won') break;
    if (sRec.stall) {
      // ride the stall out under rising instability: the honest death depth
      while (run.status !== 'dead' && run.totalT < capTotalT && !outOfTime()) {
        bot.tickN(128, true);
        harvest();
      }
      break;
    }
    if (run.totalT >= capTotalT || outOfTime()) break;
    bot.scrapAll();
    if (!S.beginDescent(run)) break;
    if (run.status === 'won') break;
    S.applySchematic(run, pickSchematic(run));
  }
  harvest();
  rec.minInteg = Math.max(0, Math.round(Math.min(rec.minInteg, run.integrity)));
  rec.maxInst = Math.round(rec.maxInst);
  rec.totalSec = Math.round(run.totalT / HZ);
  rec.deathDepth = run.depth;
  rec.cores = run.result ? run.result.cores : run.breaches;
  rec.schematics = run.schematics.map((s) => s.replace(/^s_/, '')).join(',');
  const lost = (run.maxIntegrity || D.START_INTEGRITY) - run.integrity;
  rec.magmaDmg = Math.max(0, Math.round(lost - rec.quakeDmg));
  const lastStall = rec.strata.length ? rec.strata[rec.strata.length - 1].stall : false;
  rec.outcome = run.status === 'won' ? 'WON'
    : run.status === 'dead' ? 'dead@' + run.depth
    : outOfTime() ? 'BUDGET' : 'cap@' + run.depth;
  rec.cause = run.status === 'won' ? '-'
    : lastStall ? String(lastStall)
    : rec.magmaDmg > rec.quakeDmg ? 'magma' : 'quakes';
  return rec;
}

// ------------------------------------------------------------------- sweep
const DEFAULT_SEEDS = [1337, 777, 42, 2, 1, 7, 99, 123, 2024, 31337, 555, 90210,
                       424242, 1010];
const seeds = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => parseInt(s, 10) | 0)
  : (process.env.DC_BAL_SEEDS ? process.env.DC_BAL_SEEDS.split(',').map(Number)
                              : DEFAULT_SEEDS);
const policies = (process.env.DC_BAL_POLICIES || 'standard,camper').split(',');
const capMin = parseInt(process.env.DC_BAL_CAPMIN || '30', 10);

// Foundry loadout: default is a naked first run (SPEC §12's baseline).
// NAKED gates the annotations that only describe that baseline — a run with
// upgrades beats the naked s1-breach and cores bands by design, and printing
// "[target ...]" next to a number the target was never about reads as a
// failure. See the FOOTER at the bottom for which target is checked where.
const NAKED = !process.env.DC_BAL_META;
const profile = DC.Meta.newProfile();
if (process.env.DC_BAL_META) {
  for (const part of process.env.DC_BAL_META.split(',')) {
    const kv = part.split(':');
    if (kv[0]) profile.upgrades[kv[0].trim()] = parseInt(kv[1] || '1', 10);
  }
}
const effects = DC.Meta.effects(profile);

function pad(s, n) { return (String(s) + ' '.repeat(n)).slice(0, n); }
function padL(s, n) { return (' '.repeat(n) + String(s)).slice(-n); }
function mmss(sec) { return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }

console.log('DEEPCORE balance sweep — ' + seeds.length + ' seeds x ' +
  policies.length + ' policies, cap ' + capMin + ' sim-min, budget ' +
  Math.round(BUDGET_MS / 1000) + 's wall' +
  (process.env.DC_BAL_META ? ', meta ' + process.env.DC_BAL_META : ', naked rig'));
console.log(pad('policy', 9) + padL('seed', 7) + '  ' + pad('outcome', 8) +
  padL('time', 6) + padL('cores', 6) + padL('mInt', 5) + '  ' + pad('cause', 22) +
  'per-stratum  breach>leave (integ,inst,plates)');

const rows = [];
let aborted = false;
outer:
for (const policy of policies) {
  for (const seed of seeds) {
    if (outOfTime()) { aborted = true; break outer; }
    process.stdout.write(pad(policy, 9) + padL(seed, 7) + '  ');
    const r = playRun(seed, policy, capMin, effects);
    rows.push(r);
    const per = r.strata.map((s) =>
      's' + s.depth + ':' + (s.tBreach == null ? (s.stall ? 'X' : '--') : s.tBreach) +
      '>' + s.tLeave + '(' + s.integEnd + ',' + s.instEnd + ',' + s.platesEnd +
      (s.damp ? ',v' + s.damp : '') + ')' +
      (s.tBreach == null ? '[' + (Object.keys(s.st).map((k) =>
        s.st[k] > 1 ? k + '*' + s.st[k] : k).join('+') || 'nothing') + ']' : '')).join(' ');
    console.log(pad(r.outcome, 8) + padL(mmss(r.totalSec), 6) + padL(r.cores, 6) +
      padL(r.minInteg, 5) + '  ' + pad(r.cause, 22) + per);
  }
}
if (aborted) console.log('!! wall budget exhausted after ' + Math.round(elapsed()) +
  's — partial results (raise DC_BAL_BUDGET or cut seeds)');

// -------------------------------------------------------------- aggregates
function med(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2]
                      : Math.round((a[a.length / 2 - 1] + a[a.length / 2]) / 2);
}
function agg(policy) {
  const rs = rows.filter((r) => r.policy === policy);
  if (!rs.length) return;
  const n = rs.length;
  const wins = rs.filter((r) => r.outcome === 'WON');
  const deaths = rs.filter((r) => /^dead@/.test(r.outcome));
  const caps = rs.filter((r) => /^cap@/.test(r.outcome));
  const s1 = rs.map((r) => r.strata[0]).filter((s) => s && s.tBreach != null);
  // "survived stratum 2" = reached stratum 3 or better (breached s2 alive)
  const surviveS2 = rs.filter((r) => r.deathDepth > 2 ||
    (r.outcome === 'WON') ||
    (r.strata.length > 2));
  const stalls = [];
  for (const r of rs) for (const s of r.strata) if (s.stall) stalls.push('s' + s.depth + ':' + s.stall);
  const deathDepths = deaths.map((r) => r.deathDepth).sort((a, b) => a - b);
  console.log('\n== ' + policy + ' ==  n=' + n);
  if (s1.length) {
    console.log('  s1 breach-ready: med ' + med(s1.map((s) => s.tBreach)) + 's  range ' +
      Math.min.apply(null, s1.map((s) => s.tBreach)) + '-' +
      Math.max.apply(null, s1.map((s) => s.tBreach)) + 's' +
      (NAKED ? '   [SPEC 90-150s + ~40s build => 130-190s here]' : ''));
  }
  console.log('  survive stratum 2: ' + surviveS2.length + '/' + n + ' (' +
    Math.round(100 * surviveS2.length / n) + '%)   [target >=80%]');
  console.log('  wins: ' + wins.length + '/' + n +
    (wins.length ? '  med ' + (med(wins.map((r) => r.totalSec)) / 60).toFixed(1) +
      'min  range ' + wins.map((r) => (r.totalSec / 60).toFixed(1)).sort().join('/') : '') +
    '   [target 15-25min' + (NAKED ? ' — not checked on a naked rig, see footer' : '') + ']');
  console.log('  deaths: ' + deaths.length + (deathDepths.length
    ? ' at depths [' + deathDepths.join(',') + '] med ' + med(deathDepths) : '') +
    (policy === 'camper' ? '   [target ~6-7 with a full Foundry]' : ''));
  const causes = {};
  for (const r of rs) if (r.outcome !== 'WON') causes[r.cause] = (causes[r.cause] || 0) + 1;
  console.log('  causes: ' + (Object.keys(causes).map((k) => k + ' x' + causes[k]).join(', ') || 'none'));
  console.log('  integrity: min med ' + med(rs.map((r) => r.minInteg)) +
    '  quake dmg med ' + med(rs.map((r) => r.quakeDmg)) +
    '  magma dmg med ' + med(rs.map((r) => r.magmaDmg)) +
    '  quakes med ' + med(rs.map((r) => r.quakes)));
  console.log('  cores/run: med ' + med(rs.map((r) => r.cores)) +
    '  [' + rs.map((r) => r.cores).join(',') + ']' +
    (NAKED ? '   [target 2-5 early]' : ''));
  if (caps.length) console.log('  hit ' + capMin + '-min cap: ' +
    caps.map((r) => r.outcome + '/' + r.seed).join(' '));
  if (stalls.length) console.log('  stalls: ' + stalls.join(' '));
}
for (const p of policies) agg(p);

// ---------------------------------------------------------------- FOOTER
// What the numbers above are worth. Written because the bare table invites
// exactly one wrong conclusion — "the naked rig never wins, so the game is
// unwinnable" — and someone acting on it would flatten the difficulty curve
// the Foundry exists to create.
const FULL_LOADOUT =
  'm_stock:2,m_hull:2,m_damp:2,m_torque:2,m_fix:1,m_scan:1,m_deep:1,m_schem:1';
console.log('\n' + '─'.repeat(78));
console.log('WHAT THIS HARNESS MEASURES');
console.log(`
  The runner is a SCRIPTED BOT, not a player. It lays a fixed opening (coal →
  belts → assembler) and extends it down a static priority list. It does not
  read the map, re-route around a poor vein roll, or improvise a tier-2 chain.
  Treat its results as a FLOOR on difficulty — the game is at least this
  survivable — never as the player experience.

  Default loadout is a NAKED rig: run one, no Foundry. Give it upgrades with
    DC_BAL_META=${FULL_LOADOUT}

  SPEC §12 target                  checked on            last known good
  ---------------------------------------------------------------------------
  s1 breach 90-150s +~40s build    naked, standard       med 137s      OK
  first runs bank 2-5 cores        naked                 med 3         OK
  survive stratum 2 >= 80%         naked                 93% / 86%     OK
  full win in 15-25 min            full Foundry, std     4/14 @ 21.7m  OK
  camping ~1.5x pace dies s6-s7    full Foundry, camper  med 7         OK

  The win target is deliberately NOT checked on a naked rig. SPEC §12 scopes it
  to "competent play", and the Foundry is the game's answer to a first run that
  ends at stratum 4. A naked bot going 0/14 is the intended shape of run one.

  KNOWN CEILING: at high loadout most remaining deaths are 'no-breach' stalls at
  s5+ — look for cu2X / crystal-noroute in the per-stratum tags. That is the bot
  failing to build the tier-2 chain, not the stratum being unbeatable. Do NOT
  tune data.js against those stalls; fix the bot's build policy first.`);
console.log('─'.repeat(78));
console.log('\ndone in ' + Math.round(elapsed()) + 's wall');
