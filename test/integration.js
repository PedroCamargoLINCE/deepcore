/* DEEPCORE — test/integration.js
   Node integration test (permanent). Drives a real run through strata 1-2
   with scripted bases via the public Sim API (planner adapted from
   test/headless.js), descends into stratum 3, then runs focused API sections:
     - descent carry-over exactly per SPEC §5.9 (after BOTH driven strata)
     - s_extract measurably speeds extractors (exact cadence)
     - overdrive toggling changes drill cadence + instability rate
     - a fueled damper cuts the instability rate by its calm fraction
     - demolish refunds 50% + credits input buffers (belts refund fully)
     - clickTile repairs a damaged machine at mods.repairCost
     - breachReq scaling with s_drill
     - run.events populated + drained-shape (quake/breachReady/descend)
     - SPEC2 §B surface: run.stats, run.foreman, blockedSince/nofuelSince
     - charge tier at depth 5 (crystal veins, recipe cycling, charge feed,
       s_charge double credit) + bronzeGear unlock via s_gear
     - endgame: depth-8 breach -> won -> continueIntoMantle -> depth 9 via
       mantleStratum
   The driven run stops after breaching stratum 2: a fully autonomous
   3-stratum push fights procgen economics (rebuilding stratum 3 from scrap
   under carried instability) without exercising any sim mechanic the direct
   API sections below don't already cover at depths 5/8/9 — the test verifies
   the SIM, not bot heroics. Test-scaffolding mutations (marked "scaffold:")
   force positions the bot cannot cheaply reach (inventory top-ups, hp
   damage, fed counters); all behavior under test runs through the public
   API. */
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

let SECTION = 'boot';
function fail(msg) {
  console.error('FAIL [' + SECTION + ']: ' + msg);
  process.exit(1);
}
function assert(cond, msg) { if (!cond) fail(msg); }
function assertEq(a, b, msg) {
  if (a !== b) fail(msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')');
}
function key(x, y) { return x + ',' + y; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function defEffects() { return DC.Meta.effects(DC.Meta.newProfile()); }

// Debug aid: DC_DEBUG=1 prints the map on bot failures.
function dumpMap(run, label) {
  if (!process.env.DC_DEBUG) return;
  console.error('--- ' + label + ' (t=' + run.t + ', plates=' + (run.inv.ironPlate || 0) + ') ---');
  for (let y = 0; y < D.MAP_H; y++) {
    let s = '';
    for (let x = 0; x < D.MAP_W; x++) {
      const t = run.grid[y][x];
      if (!t.revealed) { s += ' '; continue; }
      if (t.machine === 0) { s += 'D'; continue; }
      if (t.machine !== null) { s += D.BUILDINGS[run.machines[t.machine].type].letter; continue; }
      if (t.belt) { s += D.ARROWS[t.belt.dir]; continue; }
      if (t.ore) { s += D.ORE_GLYPHS[t.ore].glyph; continue; }
      if (t.rubble) { s += '%'; continue; }
      s += { floor: '.', rock: '#', obsidian: 'O', chasm: 'X', magma: '~' }[t.t] || '?';
    }
    console.error(s);
  }
}

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

// ------------------------------------------------------- event drain harness
const EVENT_TYPES = ['quake', 'magma', 'depleted', 'breachReady', 'death', 'won', 'descend'];
function mkDrainer(run) {
  const seen = {};              // type -> count
  const samples = {};           // type -> first event object
  function drain() {
    assert(Array.isArray(run.events), 'run.events must be an array');
    const evs = run.events.splice(0, run.events.length);
    assertEq(run.events.length, 0, 'events must be empty right after splice-drain');
    for (const ev of evs) {
      assert(ev && typeof ev === 'object', 'event entries must be objects');
      assert(EVENT_TYPES.indexOf(ev.type) >= 0, 'unknown event type ' + ev.type);
      assert(typeof ev.t === 'number' && ev.t >= 0, 'event.t must be a tick number');
      assert(ev.data === null || typeof ev.data === 'object', 'event.data must be null|object');
      seen[ev.type] = (seen[ev.type] || 0) + 1;
      if (!samples[ev.type]) samples[ev.type] = ev;
    }
    return evs;
  }
  return { drain, seen, samples };
}

// ------------------------------------------------------------------ the bot
// Closure over one run: pathing + building helpers (adapted from headless.js).
function mkBot(run, drainer) {
  const bot = {};
  const builtBelts = [];
  const builtMachines = [];
  bot.builtMachines = builtMachines;

  function T(x, y) {
    return (x >= 0 && y >= 0 && x < D.MAP_W && y < D.MAP_H) ? run.grid[y][x] : null;
  }
  function inv(item) { return run.inv[item] || 0; }
  bot.T = T; bot.inv = inv;

  function stepTick() {
    S.tick(run);
    if (run.shake) run.shake = false;   // engine's job; keep parity with headless
    if (drainer) drainer.drain();
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
    if (t.machine !== null && t.machine !== undefined) return false;
    if (t.belt) return false;
    return t.t === 'floor' || t.t === 'rock';
  }
  function cellCost(t) {
    if (t.t === 'rock') return 8;
    if (t.rubble) return 4;
    return t.ore ? 2 : 1;
  }
  function findPath(starts, goalMap, blocked) {
    const distm = new Map(), prev = new Map();
    const heap = [];   // binary min-heap on .d
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
    for (const s of starts) {
      const k = key(s.x, s.y);
      const t = T(s.x, s.y);
      if (!passable(t, k, blocked)) continue;
      distm.set(k, cellCost(t));
      hpush({ k, x: s.x, y: s.y, d: cellCost(t) });
    }
    while (heap.length) {
      const cur = hpop();
      if (cur.d !== distm.get(cur.k)) continue;
      if (goalMap.has(cur.k)) {
        const path = [];
        let k2 = cur.k;
        while (k2 !== undefined) {
          const p = k2.split(',');
          path.unshift({ x: +p[0], y: +p[1] });
          k2 = prev.get(k2);
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
        hpush({ k: nk, x: nx, y: ny, d: nd });
      }
    }
    return null;
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
  bot.oreTilesSorted = oreTilesSorted;

  function canAfford(type) {
    const cost = D.BUILDINGS[type].cost;
    for (const it in cost) if (inv(it) < cost[it]) return false;
    return true;
  }
  bot.canAfford = canAfford;

  function placeMachine(type, x, y, facing) {
    if (!S.place(run, type, x, y, facing)) return false;
    builtMachines.push({ type, x, y, facing, retired: false });
    return true;
  }
  bot.placeMachine = placeMachine;

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
  bot.maintain = maintain;

  // Best (ore tile, facing, path) delivering oreId into footprint fp.
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
        if (fpSet.has(ok)) return { tile: ot, facing: f, path: [], into: null };
        if (blocked.has(ok)) continue;
        const b2 = new Set(blocked); b2.add(okey);
        const r = findPath([o], goals, b2);
        if (r && (!best || r.path.length < best.path.length)) {
          best = { tile: ot, facing: f, path: r.path, into: r.into };
        }
      }
      if (best && best.path.length <= 2) break;
    }
    return best;
  }

  // Plan a 2x2 machine site whose output routes to sinkGoals, fed by oreId
  // (+ coal unless noCoal). Adapted from headless.js planStarterBase.
  function planChain(oreId, sinkGoals, noCoal) {
    const hubC = hubCenter();
    const sites = [];
    for (let y = 1; y < D.MAP_H - 2; y++) {
      for (let x = 1; x < D.MAP_W - 2; x++) {
        const fp = rect(x, y, 2, 2);
        let ok = true;
        for (const c of fp) {
          const t = T(c.x, c.y);
          if (!t || t.t !== 'floor' || t.rubble || t.machine !== null || t.belt || !t.revealed) { ok = false; break; }
        }
        if (!ok) continue;
        const ctr = { x: x + 0.5, y: y + 0.5 };
        if (dist(ctr, hubC) > 20) continue;
        sites.push({ x, y, ctr });
      }
    }
    const oreAll = oreTilesSorted(oreId, hubC);
    const coalAll = noCoal ? [] : oreTilesSorted('coal', hubC);
    if (!oreAll.length || (!noCoal && !coalAll.length)) return null;
    const near = (tiles, ctr) => tiles.reduce((m, t) => Math.min(m, dist(t, ctr)), 1e9);
    sites.sort((a, b) =>
      (dist(a.ctr, hubC) * 1.2 + near(oreAll, a.ctr) + (noCoal ? 0 : near(coalAll, a.ctr))) -
      (dist(b.ctr, hubC) * 1.2 + near(oreAll, b.ctr) + (noCoal ? 0 : near(coalAll, b.ctr))));
    let fallback = null;
    for (const site of sites.slice(0, 40)) {
      const fp = rect(site.x, site.y, 2, 2);
      const fpSet = new Set(fp.map((c) => key(c.x, c.y)));
      const facings = [0, 1, 2, 3]
        .map((f) => ({ f, o: outputTile(site.x, site.y, 2, 2, f) }))
        .filter((v) => passable(T(v.o.x, v.o.y), key(v.o.x, v.o.y), fpSet))
        .sort((a, b) => dist(a.o, hubCenter()) - dist(b.o, hubCenter()));
      for (const fc of facings) {
        const blocked = new Set(fpSet);
        const outLine = findPath([fc.o], sinkGoals, blocked);
        if (!outLine) continue;
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
          blocked.add(key(coalP.tile.x, coalP.tile.y));
          for (const c of coalP.path) blocked.add(key(c.x, c.y));
        }
        const belts = outLine.path.length + oreP.path.length +
          (coalP ? coalP.path.length : 0);
        const plan = { site, facing: fc.f, fp, outLine, oreP, coalP, belts };
        // good-enough early exit keeps planning cheap; caller checks cost
        if (belts <= 10) return plan;
        if (!fallback || belts < fallback.belts) fallback = plan;
      }
    }
    return fallback;
  }
  bot.planChain = planChain;

  // Build a planned smelter chain; returns a handle used by maintain() to
  // keep the feeders alive when their ore tiles deplete.
  const chains = [];
  function buildChain(plan, oreId) {
    if (!plan) return null;
    if (!placeMachine('smelter', plan.site.x, plan.site.y, plan.facing)) return null;
    if (!placeMachine('extractor', plan.oreP.tile.x, plan.oreP.tile.y, plan.oreP.facing)) return null;
    if (plan.coalP && !placeMachine('extractor', plan.coalP.tile.x, plan.coalP.tile.y, plan.coalP.facing)) return null;
    if (plan.oreP.path.length && !buildBeltLine(plan.oreP.path, plan.oreP.into, null)) return null;
    if (plan.coalP && plan.coalP.path.length && !buildBeltLine(plan.coalP.path, plan.coalP.into, null)) return null;
    const outBelts = [];
    if (!buildBeltLine(plan.outLine.path, plan.outLine.into, outBelts)) return null;
    const ch = {
      fp: plan.fp,
      out: outputTile(plan.site.x, plan.site.y, 2, 2, plan.facing),
      outBelts,
      feeders: [
        { oreId: oreId || 'ironOre', x: plan.oreP.tile.x, y: plan.oreP.tile.y },
      ],
    };
    if (plan.coalP) ch.feeders.push({ oreId: 'coal', x: plan.coalP.tile.x, y: plan.coalP.tile.y });
    chains.push(ch);
    return ch;
  }
  bot.buildChain = buildChain;

  // Replant a chain's extractor when its ore tile runs dry.
  function upkeepFeeders() {
    for (const ch of chains) {
      const st = T(ch.fp[0].x, ch.fp[0].y);
      if (!st || st.machine === null) continue;       // smelter gone; machines
      for (const fd of ch.feeders) {                  // handled elsewhere
        const t = T(fd.x, fd.y);
        if (!t) continue;
        const m = t.machine !== null ? run.machines[t.machine] : null;
        if (m && m.type === 'extractor' && t.oreAmt > 0) continue;   // healthy
        if (m && m.type === 'extractor' && t.oreAmt <= 0) {
          S.demolishAt(run, fd.x, fd.y);              // scrap the dry extractor
          // un-register its rebuild entry so maintain stops replacing it
          for (const bm of builtMachines) {
            if (bm.type === 'extractor' && bm.x === fd.x && bm.y === fd.y) bm.retired = true;
          }
        }
        if (t.machine !== null) continue;             // something else there
        // replant on the nearest live tile of the same ore
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

  // Install the assembler fed by the given chains, output belted (or direct)
  // into the hub. Plans every route and checks the full plate budget BEFORE
  // building anything: failed placements are expensive (50% refund).
  // Retires the chains' interim hub lines first so routing has the corridor;
  // re-lays them and returns null if no candidate works.
  function installAssembler(chains) {
    for (const c of chains) retireBelts(c.outBelts);
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
        if (dist({ x: x + 0.5, y: y + 0.5 }, hubC) > 10) continue;
        generic.push({ x, y, f: -1 });
      }
    }
    generic.sort((a, b) => dist(a, hubC) - dist(b, hubC));
    for (const c of cands.concat(generic.slice(0, 60))) {
      const facings = c.f >= 0 ? [c.f] : [0, 1, 2, 3];
      for (const f of facings) {
        if (!S.canPlace(run, 'assembler', c.x, c.y, f).ok) continue;
        const fp = rect(c.x, c.y, 2, 2);
        const fpSet = new Set(fp.map((p) => key(p.x, p.y)));
        // plan all routes against a shared blocked set
        const blocked = new Set(fpSet);
        const routes = [];
        let ok = true;
        const o = outputTile(c.x, c.y, 2, 2, f);
        const oT = T(o.x, o.y);
        if (!(oT && oT.machine === 0)) {
          const r = findPath([o], hubGoals(), blocked);
          if (!r) { ok = false; } else {
            routes.push({ r, ch: null });
            for (const p of r.path) blocked.add(key(p.x, p.y));
          }
        }
        for (const ch of chains) {
          if (!ok) break;
          if (fpSet.has(key(ch.out.x, ch.out.y))) continue;  // direct eject
          const goals = perimMap(fp);
          for (const [k] of goals) if (blocked.has(k)) goals.delete(k);
          const r = findPath([ch.out], goals, blocked);
          if (!r) { ok = false; break; }
          routes.push({ r, ch });
          for (const p of r.path) blocked.add(key(p.x, p.y));
        }
        if (!ok) continue;
        const beltCost = run.mods.beltFree ? 0 : routes.reduce((n, r) => n + r.r.path.length, 0);
        if (D.BUILDINGS.assembler.cost.ironPlate + beltCost + 2 > inv('ironPlate')) continue;
        // execute; every planned belt is registered so maintain() re-lays any
        // cell a mid-build quake disturbs; chain feed lines are recorded on
        // the chain handle so they can be re-routed later (bank phase)
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
    // give the smelters their hub lines back so plates keep banking
    for (const ch of chains) {
      ch.outBelts.length = 0;
      const r = findPath([ch.out], hubGoals(), new Set());
      if (r) buildBeltLine(r.path, r.into, ch.outBelts);
      for (const b of ch.outBelts) b.retired = false;
    }
    return null;
  }
  bot.installAssembler = installAssembler;

  // Demolish everything we built (belts refund fully, machines 50%) — the
  // pre-descent scrap pass. Keeps `keep` (a machine anchor) if given.
  function scrapAll(keep) {
    const ids = Object.keys(run.machines).map(Number).filter((i) => i !== 0);
    for (const id of ids) {
      const m = run.machines[id];
      if (!m) continue;
      if (keep && m.x === keep.x && m.y === keep.y) continue;
      const r = S.demolishAt(run, m.x, m.y);
      assert(r && r.ok, 'scrap: demolish machine failed: ' + (r && r.reason));
    }
    for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
      const t = T(x, y);
      if (t && t.belt) S.demolishAt(run, x, y);
    }
    for (const b of builtBelts) b.retired = true;
    for (const m of builtMachines) m.retired = true;
    chains.length = 0;
  }
  bot.scrapAll = scrapAll;

  // Play the current stratum to breachReady. Two phases: an iron chain
  // banking plates at the hub, then an assembler converting them to gears.
  // opts:
  //   capSec       — hard time cap for the stratum
  //   asmGate      — plates required before the assembler stage
  //   gearBank     — after breach, keep producing until inv.gear >= this
  //   gearBankSec  — cap on that gear-bank window
  function playStratum(opts) {
    opts = opts || {};
    const cap = (opts.capSec || 420) * HZ;
    tickN(48, false);       // let the scan open past the guaranteed-vein radius

    const chainCost = (p) =>
      D.BUILDINGS.smelter.cost.ironPlate +
      D.BUILDINGS.extractor.cost.ironPlate * (p.coalP ? 2 : 1) +
      (run.mods.beltFree ? 0 : p.belts);
    let c1 = null;
    while (!c1 && run.status === 'active' && run.t < cap / 2) {
      const p1 = planChain('ironOre', hubGoals(), false);
      if (p1 && chainCost(p1) <= inv('ironPlate')) c1 = buildChain(p1, 'ironOre');
      if (!c1) tickN(48, true);
    }
    if (!c1) dumpMap(run, 'phase-1 failed at depth ' + run.depth);
    assert(c1, 'stratum ' + run.depth + ': phase-1 iron chain failed (plates ' +
      inv('ironPlate') + ')');
    let asm = null, asmTries = 0, iter = 0;
    while (run.status === 'active' && run.t < cap) {
      tickN(16, true);
      iter++;
      if (process.env.DC_TRACE && run.t % (30 * HZ) < 16) {
        console.error('  d' + run.depth + ' t=' + Math.round(run.t / HZ) +
          's integ=' + Math.ceil(run.integrity) + ' inst=' + Math.round(run.instability) +
          ' fed=' + run.gearsFed + '/' + run.breachReq.gear +
          ' plates=' + inv('ironPlate') + ' gears=' + inv('gear') +
          ' machines=' + (Object.keys(run.machines).length - 1) +
          (asm ? ' asm' : ''));
      }
      const planNow = iter % 4 === 0;      // planning is heavy; throttle it
      if (planNow && !asm && inv('ironPlate') >= (opts.asmGate || 16)) {
        asm = installAssembler([c1]);
        if (!asm) {
          asmTries++;
          if (asmTries >= 8) {
            dumpMap(run, 'assembler install failed at depth ' + run.depth);
            fail('stratum ' + run.depth + ': could not install + route an assembler');
          }
        }
      }
    }
    assert(run.status !== 'dead',
      'stratum ' + run.depth + ': rig died (integrity 0) before breach');
    assert(run.status === 'breachReady',
      'stratum ' + run.depth + ': no breach within ' + (cap / HZ) + 's (gearsFed ' +
      run.gearsFed + '/' + run.breachReq.gear + ', plates ' + inv('ironPlate') + ')');
    // post-breach gear banking: a short window, aborted the moment the
    // production line dies (instability is rising — lingering here is how
    // rigs die; SPEC §12 punishes camping by design)
    const lineAlive = () => {
      let a = false, s = false;
      for (const id in run.machines) {
        const m = run.machines[id];
        if (m && m.type === 'assembler') a = true;
        if (m && m.type === 'smelter') s = true;
      }
      return s && a;
    };
    if (opts.gearBank) {
      const until = run.t + (opts.gearBankSec || 40) * HZ;
      while (run.status === 'breachReady' && run.t < until &&
             inv('gear') < opts.gearBank && lineAlive()) {
        tickN(16, true);
      }
    }
    assert(run.status !== 'dead', 'stratum ' + run.depth + ': died during bank phase');
    return true;
  }
  bot.playStratum = playStratum;

  return bot;
}

// =========================================================================
// SECTION 1 — driven run: strata 1..2 with scripted bases, arrive at 3
// =========================================================================
function drivenRun(seed) {
  SECTION = 'driven-run seed=' + seed;
  // A 2-strata push is early-game territory: drive it with a realistic small
  // Foundry loadout (9 cores ~ 2-4 banked runs). This also exercises the
  // Meta.effects -> Sim.newRun startBonus/integrityBonus contract for real.
  // (A default-meta bot stalls re-basing stratum 2 at ~30 plates vs ~34 cost
  //  -- see the balance notes in the PASS line.)
  const prof = DC.Meta.newProfile();
  prof.upgrades = { m_stock: 2, m_hull: 1 };
  const eff = DC.Meta.effects(prof);
  const run = S.newRun(eff, seed);
  assert(run.depth === 1 && run.status === 'active', 'fresh run active at depth 1');
  assertEq(run.inv.ironPlate, D.START_STOCK.ironPlate + 40, 'm_stock x2 start plates applied');
  assertEq(run.inv.gear, D.START_STOCK.gear + 8, 'm_stock x2 start gears applied');
  assertEq(run.maxIntegrity, D.START_INTEGRITY + 25, 'm_hull integrity bonus applied');

  // SPEC2 §B initial surface
  assert(Array.isArray(run.events), 'run.events initialized');
  assertEq(run.foreman, null, 'run.foreman initialized to null');
  assert(run.stats && typeof run.stats.placed === 'object' &&
         run.stats.lastPlaceT === 0 && run.stats.lastFeedT === 0,
         'run.stats initialized {placed:{}, lastPlaceT:0, lastFeedT:0}');

  const drainer = mkDrainer(run);
  const bot = mkBot(run, drainer);
  // Survival picks (s_extract/s_drill/s_charge are measured in their own
  // sections; bronzeGear crafting in the charge-tier section). s_gear on the
  // first descent leaves integrity untouched (carry-over branch); s_plate on
  // the second exercises the +20-max / +20-restore branch.
  // asmGate 26 on stratum 1 banks a plate cushion BEFORE the assembler
  // converts the flow to gears: arriving on stratum 2 with < ~30 plates and
  // no income means waiting to death under carried instability.
  // Tuning notes (empirical, seeds 1/777/1337/2024/99999 pass, 2/42 die):
  // longer post-breach gear banking or higher s2 asmGate LOWER the pass rate
  // — instability punishes every extra second (by design). Seeds 2/42 lose
  // the s2 line to inst-75+ quakes at ~29/30 gears with no rebuild reserve;
  // that is honest hostile procgen, not a sim defect (verified via DC_TRACE).
  const picks = ['s_gear', 's_plate'];
  const stratOpts = [
    { capSec: 420, asmGate: 26, gearBank: 16, gearBankSec: 90 },
    { capSec: 420, asmGate: 16 },
  ];

  for (let stratum = 1; stratum <= 2; stratum++) {
    bot.playStratum(stratOpts[stratum - 1]);
    if (process.env.DC_DEBUG) {
      console.error('S' + stratum + ': t=' + Math.round(run.t / HZ) + 's integ=' +
        Math.ceil(run.integrity) + '/' + run.maxIntegrity + ' inst=' + Math.round(run.instability) +
        ' plates=' + (run.inv.ironPlate | 0) + ' gears=' + (run.inv.gear | 0) +
        ' copper=' + (run.inv.copperPlate | 0));
    }
    assert(drainer.seen.breachReady >= stratum, 'breachReady event fired for stratum ' + stratum);
    const brEv = drainer.samples.breachReady;
    assert(brEv.data && typeof brEv.data.depth === 'number', 'breachReady event data has depth');

    // ---- descent carry-over (SPEC §5.9) ----
    // scrap pass first: banks 50% machine cost + input buffers + full belt
    // cost (machines-lost-on-descent is proven in the salvage section, where
    // machines are left standing through beginDescent/applySchematic)
    bot.scrapAll(null);
    const preInv = JSON.parse(JSON.stringify(run.inv));
    const preIntegrity = run.integrity;
    const preInstab = run.instability;
    const preDepth = run.depth;
    const preBreaches = run.breaches;

    assert(S.beginDescent(run), 'beginDescent from breachReady');
    // default meta: salvage 0 -> inv must be EXACTLY unchanged by beginDescent
    assertEq(JSON.stringify(run.inv), JSON.stringify(preInv),
      'inv unchanged by beginDescent when salvage=0');
    assertEq(run.breaches, preBreaches + 1, 'breaches incremented');
    assert(Array.isArray(run.pendingOffers), 'pendingOffers set');
    assertEq(run.pendingOffers.length, run.mods.offerCount, 'offerCount offers');
    const offerSet = new Set(run.pendingOffers);
    assertEq(offerSet.size, run.pendingOffers.length, 'offers distinct');
    for (const id of run.pendingOffers) {
      assert(D.SCHEMATICS.some((s) => s.id === id), 'offer is a real schematic: ' + id);
      assert(run.schematics.indexOf(id) < 0, 'offer not already taken: ' + id);
    }
    const evs = drainer.drain();
    const dEv = evs.find((e) => e.type === 'descend');
    assert(dEv, 'descend event pushed by beginDescent');
    assertEq(dEv.data.from, preDepth, 'descend event from-depth');
    assertEq(dEv.data.to, preDepth + 1, 'descend event to-depth');

    const pick = picks[stratum - 1];
    const preMax = run.maxIntegrity;
    S.applySchematic(run, pick);
    assertEq(run.depth, preDepth + 1, 'depth incremented by applySchematic');
    assertEq(run.status, 'active', 'status active on new stratum');
    assertEq(run.t, 0, 'stratum tick counter reset');
    assertEq(run.pendingOffers, null, 'pendingOffers cleared');
    assertEq(run.gearsFed, 0, 'gearsFed reset');
    assertEq(run.chargesFed, 0, 'chargesFed reset');
    assertEq(run.instability, Math.max(0, preInstab - 40), 'instability -40 carryover (min 0)');
    if (pick === 's_plate') {
      assertEq(run.maxIntegrity, preMax + 20, 's_plate adds +20 max integrity');
      assertEq(run.integrity, Math.min(run.maxIntegrity, preIntegrity + 20),
        's_plate restores 20 integrity now');
    } else {
      assertEq(run.integrity, preIntegrity, 'integrity carries over');
    }
    // inv carries exactly through applySchematic too
    assertEq(JSON.stringify(run.inv), JSON.stringify(preInv), 'inv carries across descent');
    // machines are lost — only the hub remains, and the kept machine is gone
    assertEq(Object.keys(run.machines).length, 1, 'machines lost on descent (hub only)');
    assert(run.machines[0] && run.machines[0].type === 'hub', 'hub machine survives as id 0');
    const st = run.depth <= D.STRATA_COUNT ? D.STRATA[run.depth - 1] : D.mantleStratum(run.depth);
    assertEq(run.breachReq.gear, Math.ceil(st.breach.gear * run.mods.breachMult),
      'breachReq recomputed for new stratum');
  }

  // arrived at stratum 3 (breachReq asserts above checked the recompute);
  // let it simulate briefly under the carried instability
  assertEq(run.depth, 3, 'driven run arrived at stratum 3');
  bot.tickN(20 * HZ, false);
  assert(run.status === 'active', 'stratum 3 simulates cleanly on arrival');

  // natural quakes must have fired somewhere in 2+ strata of play
  assert(drainer.seen.quake >= 1, 'at least one natural quake event across strata 1-2');
  const qEv = drainer.samples.quake;
  assert(qEv.data && typeof qEv.data.dmg === 'number' && qEv.data.dmg > 0,
    'quake event data.dmg is a positive number');
  // stats accumulated
  assert(run.stats.placed.belt > 0 && run.stats.placed.extractor > 0 &&
         run.stats.placed.smelter > 0 && run.stats.placed.assembler > 0,
    'run.stats.placed counts belts/extractors/smelters/assemblers');
  assert(run.stats.lastPlaceT > 0 && run.stats.lastFeedT > 0,
    'run.stats lastPlaceT/lastFeedT stamped');
  assert(run.integrity > 0, 'rig alive after arriving at stratum 3');
  return run;
}

// =========================================================================
// SECTION 2 — s_extract measurably speeds extractors (exact cadence)
// =========================================================================
function ticksToFirstOre(run, bot) {
  // find a revealed ore tile we can put an extractor on, output to open floor
  for (const oreId of ['ironOre', 'coal', 'copperOre']) {
    const tiles = bot.oreTilesSorted(oreId, { x: run.hub.x + 1, y: run.hub.y + 1 });
    for (const c of tiles) {
      for (let f = 0; f < 4; f++) {
        if (!S.canPlace(run, 'extractor', c.x, c.y, f).ok) continue;
        const t = run.grid[c.y][c.x];
        const start = t.oreAmt;
        assert(S.place(run, 'extractor', c.x, c.y, f), 'place measuring extractor');
        let n = 0;
        while (t.oreAmt === start && n < 64) { S.tick(run); n++; }
        S.demolishAt(run, c.x, c.y);            // clean up (50% refund)
        run.events.splice(0, run.events.length); // drop events from these ticks
        return n;
      }
    }
  }
  fail('no measurable ore tile found');
}
function extractCadence(seed) {
  SECTION = 's_extract seed=' + seed;
  const run = S.newRun(defEffects(), seed);
  const bot = mkBot(run, null);
  bot.tickN(48, false);   // reveal
  const base = ticksToFirstOre(run, bot);
  assertEq(base, D.BUILDINGS.extractor.period, 'base extractor cadence = period (16 ticks)');

  S.applySchematic(run, 's_extract');   // "picking" the schematic (depth 2 now)
  assertEq(run.mods.extractMult, 1.35, 's_extract sets extractMult 1.35');
  const bot2 = mkBot(run, null);
  bot2.tickN(48, false);
  const fast = ticksToFirstOre(run, bot2);
  assertEq(fast, Math.ceil(D.BUILDINGS.extractor.period / 1.35),
    's_extract cadence = ceil(period/1.35) (12 ticks)');
  assert(fast < base, 's_extract measurably speeds extractors');

  S.applySchematic(run, 's_extract');   // repeatable pick stacks additively
  assertEq(Math.abs(run.mods.extractMult - 1.7) < 1e-9, true, 'second s_extract -> 1.7');
  const bot3 = mkBot(run, null);
  bot3.tickN(48, false);
  const faster = ticksToFirstOre(run, bot3);
  assertEq(faster, Math.ceil(D.BUILDINGS.extractor.period / 1.7),
    'double s_extract cadence = ceil(period/1.7) (10 ticks)');
}

// =========================================================================
// SECTION 3 — overdrive: drill cadence + instability rate
// =========================================================================
function overdriveSection(seed) {
  SECTION = 'overdrive seed=' + seed;
  const run = S.newRun(defEffects(), seed);
  run.inv.gear = 200;                     // scaffold: plenty of feed
  run.breachReq = { gear: 10000, charge: 0 }; // scaffold: never breach during test
  const W = 48;                           // window: 6 s

  const i0 = run.instability, g0 = run.gearsFed;
  for (let i = 0; i < W; i++) S.tick(run);
  const fedBase = run.gearsFed - g0;
  const instBase = run.instability - i0;
  assertEq(fedBase, W / D.DRILL_PERIOD, 'base drill cadence: 1 gear per DRILL_PERIOD ticks');

  S.toggleOverdrive(run);
  assertEq(run.overdrive, true, 'toggleOverdrive turns overdrive on');
  const i1 = run.instability, g1 = run.gearsFed;
  for (let i = 0; i < W; i++) S.tick(run);
  const fedOver = run.gearsFed - g1;
  const instOver = run.instability - i1;
  assertEq(fedOver, W / (D.DRILL_PERIOD / D.OVERDRIVE.drillMult),
    'overdrive drill cadence doubled');
  const ratio = instOver / instBase;
  assert(Math.abs(ratio - D.OVERDRIVE.instMult) < 0.05,
    'overdrive instability rate x' + D.OVERDRIVE.instMult + ' (got x' + ratio.toFixed(3) + ')');

  S.toggleOverdrive(run);
  assertEq(run.overdrive, false, 'toggleOverdrive turns overdrive back off');
  const g2 = run.gearsFed;
  for (let i = 0; i < W; i++) S.tick(run);
  assertEq(run.gearsFed - g2, W / D.DRILL_PERIOD, 'cadence restored after overdrive off');

  // a fueled damper multiplies the instability rate by (1 - calm)
  const dx = run.hub.x - 2, dy = run.hub.y - 2;   // inside the 7x7 hub clearing
  run.inv.copperPlate = (run.inv.copperPlate || 0) + 2;   // scaffold: afford it
  assert(S.place(run, 'damper', dx, dy, 0), 'place damper in hub clearing');
  const dm = run.machines[run.grid[dy][dx].machine];
  dm.input.coal = 4;                      // scaffold: fuel supply
  const i2 = run.instability;
  for (let i = 0; i < W; i++) S.tick(run);
  const dRatio = (run.instability - i2) / instBase;
  assert(Math.abs(dRatio - (1 - D.BUILDINGS.damper.calm)) < 0.02,
    'fueled damper cuts instability rate by calm=' + D.BUILDINGS.damper.calm +
    ' (got x' + dRatio.toFixed(3) + ')');
  assert(dm.fuel > 0 && (dm.input.coal || 0) < 4, 'damper burned buffered coal into fuel');
}

// =========================================================================
// SECTION 4 — demolish refunds; dig; clickTile repair; machine stamps
// =========================================================================
function demolishRepairSection(seed) {
  SECTION = 'demolish+repair seed=' + seed;
  const run = S.newRun(defEffects(), seed);
  const hx = run.hub.x, hy = run.hub.y;

  // smelter in the guaranteed-clear hub ring
  const sx = hx - 2, sy = hy - 2;
  assert(S.canPlace(run, 'smelter', sx, sy, 1).ok, 'hub-ring corner is buildable');
  const p0 = run.inv.ironPlate;
  assert(S.place(run, 'smelter', sx, sy, 1), 'place smelter');
  assertEq(run.inv.ironPlate, p0 - D.BUILDINGS.smelter.cost.ironPlate, 'smelter cost paid');
  const sm = run.machines[run.grid[sy][sx].machine];
  assert(sm && sm.type === 'smelter', 'smelter machine exists');
  assertEq(sm.blockedSince, 0, 'blockedSince starts 0');
  assertEq(sm.nofuelSince, 0, 'nofuelSince starts 0');

  // nofuelSince stamps: ore but no coal
  sm.input.ironOre = 1;                  // scaffold: buffered ore, no coal
  S.tick(run);
  assertEq(sm.status, 'nofuel', 'smelter with ore and no coal -> nofuel');
  assert(sm.nofuelSince > 0, 'nofuelSince stamped');
  sm.input.coal = 1;                     // scaffold: coal arrives
  S.tick(run);
  assertEq(sm.nofuelSince, 0, 'nofuelSince cleared once fueled');
  assertEq(sm.status, 'ok', 'smelter crafting after refuel');

  // repair: damaged machine, priority over recipes, exact cost
  sm.hp = 1;                             // scaffold: quake damage
  const pr = run.inv.ironPlate;
  const r1 = S.clickTile(run, sx, sy);
  assert(r1.handled && /repaired/.test(r1.msg), 'clickTile repairs damaged machine');
  assertEq(sm.hp, D.BUILDINGS.smelter.hp, 'hp restored to full');
  assertEq(run.inv.ironPlate, pr - defEffects().repairCost, 'repair cost = mods.repairCost plates');
  // insufficient plates: handled but not repaired
  sm.hp = 1;                             // scaffold
  const save = run.inv.ironPlate;
  run.inv.ironPlate = 1;                 // scaffold
  const r2 = S.clickTile(run, sx, sy);
  assert(r2.handled && sm.hp === 1, 'repair refused without plates');
  run.inv.ironPlate = save;              // scaffold: restore
  assert(S.clickTile(run, sx, sy).handled, 're-repair');

  // m_fix meta: repair costs 1
  const prof = DC.Meta.newProfile();
  prof.upgrades.m_fix = 1;
  const runFix = S.newRun(DC.Meta.effects(prof), seed);
  assertEq(runFix.mods.repairCost, 1, 'm_fix lowers repairCost to 1');

  // demolish machine: 50% cost refund + input buffer credited
  sm.input.coal = 2;                     // scaffold: buffered inputs
  sm.input.ironOre = 3;                  // scaffold
  const invBefore = { plate: run.inv.ironPlate, coal: run.inv.coal || 0, ore: run.inv.ironOre || 0 };
  const rd = S.demolishAt(run, sx, sy);
  assert(rd.ok, 'demolish machine ok');
  assertEq(run.inv.ironPlate, invBefore.plate + Math.floor(D.BUILDINGS.smelter.cost.ironPlate * D.DEMOLISH_REFUND),
    'machine demolish refunds 50% of cost');
  assertEq(run.inv.coal, invBefore.coal + 2, 'demolish credits buffered coal');
  assertEq(run.inv.ironOre, invBefore.ore + 3, 'demolish credits buffered ore');
  assertEq(run.grid[sy][sx].machine, null, 'footprint cleared');

  // belt demolish refunds fully
  const bp = run.inv.ironPlate;
  assert(S.place(run, 'belt', sx, sy, 1), 'place belt');
  assertEq(run.inv.ironPlate, bp - 1, 'belt cost paid');
  assert(S.demolishAt(run, sx, sy).ok, 'demolish belt');
  assertEq(run.inv.ironPlate, bp, 'belt demolish refunds full cost');

  // hub refuses demolition
  assert(!S.demolishAt(run, hx + 1, hy + 1).ok, 'hub demolition refused');

  // rock dig via demolishAt
  let rock = null;
  outer:
  for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
    const t = run.grid[y][x];
    if (t.revealed && t.t === 'rock') { rock = { x, y }; break outer; }
  }
  assert(rock, 'found revealed rock');
  assert(S.demolishAt(run, rock.x, rock.y).ok, 'start rock dig');
  assertEq(run.grid[rock.y][rock.x].digT, D.DIG_ROCK, 'digT set to DIG_ROCK');
  for (let i = 0; i < D.DIG_ROCK; i++) S.tick(run);
  assertEq(run.grid[rock.y][rock.x].t, 'floor', 'rock excavated to floor');

  // blockedSince: extractor ejecting onto bare floor jams after 1 item
  const bot = mkBot(run, null);
  bot.tickN(32, false);
  let done = false;
  for (const c of bot.oreTilesSorted('ironOre', { x: hx + 1, y: hy + 1 })) {
    for (let f = 0; f < 4 && !done; f++) {
      const o = outputTile(c.x, c.y, 1, 1, f);
      const t = run.grid[o.y] && run.grid[o.y][o.x];
      if (!t || t.t !== 'floor' || t.machine !== null || t.belt || t.ore || !t.revealed) continue;
      if (!S.canPlace(run, 'extractor', c.x, c.y, f).ok) continue;
      assert(S.place(run, 'extractor', c.x, c.y, f), 'place jam extractor');
      const m = run.machines[run.grid[c.y][c.x].machine];
      for (let i = 0; i < D.BUILDINGS.extractor.period + 2; i++) S.tick(run);
      assertEq(m.status, 'blocked', 'extractor with no belt at output -> blocked');
      assert(m.blockedSince > 0, 'blockedSince stamped while jammed');
      assert(S.place(run, 'belt', o.x, o.y, f), 'give it an output belt');
      S.tick(run);
      assertEq(m.blockedSince, 0, 'blockedSince cleared after eject');
      done = true;
    }
    if (done) break;
  }
  assert(done, 'jam/unjam scenario executed');
}

// =========================================================================
// SECTION 5 — breachReq scaling with s_drill; salvage refunds
// =========================================================================
function breachSalvageSection(seed) {
  SECTION = 'breachReq+salvage seed=' + seed;
  const run = S.newRun(defEffects(), seed);
  assertEq(run.breachReq.gear, D.STRATA[0].breach.gear, 'stratum 1 breachReq unmodified');
  S.applySchematic(run, 's_drill');
  assertEq(run.mods.breachMult, 0.85, 's_drill sets breachMult 0.85');
  assertEq(run.depth, 2, 'now depth 2');
  assertEq(run.breachReq.gear, Math.ceil(D.STRATA[1].breach.gear * 0.85),
    's_drill scales stratum 2 gear req (30 -> 26)');
  run.depth = 5;                          // scaffold: jump to the charge tier
  S.startStratum(run);
  assertEq(run.breachReq.gear, Math.ceil(D.STRATA[4].breach.gear * 0.85),
    's_drill scales stratum 5 gear req (55 -> 47)');
  assertEq(run.breachReq.charge, Math.ceil(D.STRATA[4].breach.charge * 0.85),
    's_drill scales stratum 5 charge req (8 -> 7)');

  // salvage via meta m_salv (0.4): refunds fraction of machine costs on descent
  const prof = DC.Meta.newProfile();
  prof.upgrades.m_salv = 1;
  const rs = S.newRun(DC.Meta.effects(prof), seed);
  assertEq(rs.mods.salvage, 0.4, 'm_salv -> salvage 0.4');
  const hx = rs.hub.x, hy = rs.hub.y;
  assert(S.place(rs, 'smelter', hx - 2, hy - 2, 1), 'salvage smelter 1');
  assert(S.place(rs, 'smelter', hx + 3, hy + 2, 3), 'salvage smelter 2');
  rs.gearsFed = rs.breachReq.gear;        // scaffold: force-satisfy breach
  S.tick(rs);
  assertEq(rs.status, 'breachReady', 'forced breach ready');
  const plates0 = rs.inv.ironPlate;
  assert(S.beginDescent(rs), 'beginDescent with salvage');
  assertEq(rs.inv.ironPlate,
    plates0 + 2 * Math.floor(D.BUILDINGS.smelter.cost.ironPlate * 0.4),
    'salvage refunds floor(cost*0.4) per machine');
  // the standing machines are lost when the new stratum begins
  assertEq(Object.keys(rs.machines).length, 3, 'smelters still standing after beginDescent');
  S.applySchematic(rs, rs.pendingOffers[0]);
  assertEq(Object.keys(rs.machines).length, 1, 'machines lost on descent (hub only)');
  assert(rs.machines[0] && rs.machines[0].type === 'hub', 'hub survives as machine id 0');
}

// =========================================================================
// SECTION 6 — charge tier at depth 5
// =========================================================================
function chargeSection(seed) {
  SECTION = 'charge-tier seed=' + seed;
  const run = S.newRun(defEffects(), seed);
  run.depth = 5;                          // scaffold: construct a depth-5 run
  S.startStratum(run);
  assertEq(run.breachReq.charge, D.STRATA[4].breach.charge, 'depth 5 requires charges');

  // crystal veins generate on stratum 5
  let crystals = 0;
  for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
    if (run.grid[y][x].ore === 'crystal') crystals++;
  }
  assert(crystals > 0, 'crystal veins generate at depth 5 (found ' + crystals + ' tiles)');

  // assembler adjacent to hub, ejecting straight into a hub tile
  const ax = run.hub.x - 2, ay = run.hub.y;
  assert(S.place(run, 'assembler', ax, ay, 1), 'place assembler at hub ring');
  const am = run.machines[run.grid[ay][ax].machine];
  assertEq(am.recipe, 'gear', 'assembler default recipe is gear');

  // recipe cycling via clickTile (bronzeGear locked without s_gear)
  const r1 = S.clickTile(run, ax, ay);
  assert(r1.handled, 'clickTile cycles assembler recipe');
  assertEq(am.recipe, 'charge', 'gear -> charge (bronzeGear skipped)');
  const r2 = S.clickTile(run, ax, ay);
  assertEq(am.recipe, 'gear', 'charge -> gear wraps');
  assert(r2.handled, 'cycle handled');
  S.clickTile(run, ax, ay);               // back to charge
  assertEq(am.recipe, 'charge', 'recipe set to charge');

  // craft a charge from buffered inputs
  am.input = { crystal: 1, copperPlate: 1, coal: 2 };  // scaffold: inputs
  const c0 = run.inv.charge || 0;
  for (let i = 0; i < D.RECIPES.charge.ticks + 4; i++) S.tick(run);
  assertEq(run.inv.charge, c0 + 1, 'charge crafted and ejected into the hub');
  assertEq(am.input.crystal, 0, 'charge inputs consumed');

  // drill priority: with gears available and gear quota unmet, charges wait
  run.inv.gear = 10;                      // scaffold
  run.inv.charge = 3;                     // scaffold
  const cf0 = run.chargesFed, gf0 = run.gearsFed;
  for (let i = 0; i < 16; i++) S.tick(run);
  assert(run.gearsFed > gf0, 'gears feed while quota unmet');
  assertEq(run.chargesFed, cf0, 'charges not consumed before gear quota');

  // after the gear quota, charges feed (1 per drill period, +1 fed each)
  run.gearsFed = run.breachReq.gear;      // scaffold: gear quota satisfied
  run.inv.gear = 0;                       // scaffold
  const cInv = run.inv.charge;
  const cFed = run.chargesFed;
  for (let i = 0; i < 8 * cInv + 8; i++) S.tick(run);
  assertEq(run.chargesFed, cFed + cInv, 'each charge credits +1 after gear quota');
  assertEq(run.inv.charge, 0, 'charges consumed from inventory');

  // s_charge doubles the credit
  const run2 = S.newRun(defEffects(), seed + 1);
  S.applySchematic(run2, 's_charge');
  assertEq(run2.mods.chargeX2, true, 's_charge sets chargeX2');
  run2.depth = 5;                         // scaffold
  S.startStratum(run2);
  run2.gearsFed = run2.breachReq.gear;    // scaffold
  run2.inv.charge = 2;                    // scaffold
  const f0 = run2.chargesFed;
  for (let i = 0; i < 24; i++) S.tick(run2);
  assertEq(run2.chargesFed, f0 + 4, 's_charge: each consumed charge credits +2');

  // bronzeGear: locked without s_gear (asserted above); with it, the recipe
  // joins the assembler cycle and crafts 1 iron + 1 copper plate -> 2 gears
  const rb = S.newRun(defEffects(), seed + 2);
  S.applySchematic(rb, 's_gear');         // pick the schematic (depth 2 now)
  assertEq(rb.mods.bronzeGear, true, 's_gear sets mods.bronzeGear');
  const bx = rb.hub.x - 2, by = rb.hub.y;
  assert(S.place(rb, 'assembler', bx, by, 1), 'place bronze assembler at hub ring');
  const bm = rb.machines[rb.grid[by][bx].machine];
  S.clickTile(rb, bx, by);
  assertEq(bm.recipe, 'bronzeGear', 'with s_gear the cycle is gear -> bronzeGear');
  S.clickTile(rb, bx, by);
  assertEq(bm.recipe, 'charge', 'bronzeGear -> charge');
  S.clickTile(rb, bx, by);
  S.clickTile(rb, bx, by);                // wrap around to bronzeGear again
  assertEq(bm.recipe, 'bronzeGear', 'cycle wraps through all three recipes');
  bm.input = { ironPlate: 1, copperPlate: 1 };   // scaffold: buffered inputs
  const bg0 = (rb.inv.gear || 0) + rb.gearsFed;  // drill feeds during the craft
  for (let i = 0; i < D.RECIPES.bronzeGear.ticks + 4; i++) S.tick(rb);
  assertEq((rb.inv.gear || 0) + rb.gearsFed, bg0 + 2,
    'bronzeGear crafts 2 gears into the hub');
  assertEq(bm.input.ironPlate, 0, 'bronze inputs consumed');
}

// =========================================================================
// SECTION 7 — endgame: depth-8 breach -> won -> Mantle depth 9
// =========================================================================
function endgameSection(seed) {
  SECTION = 'endgame seed=' + seed;
  const run = S.newRun(defEffects(), seed);
  run.depth = 8;                          // scaffold: jump to the Core Gate
  S.startStratum(run);
  assertEq(run.breachReq.gear, D.STRATA[7].breach.gear, 'depth 8 gear req');
  assertEq(run.breachReq.charge, D.STRATA[7].breach.charge, 'depth 8 charge req');

  run.gearsFed = run.breachReq.gear;      // scaffold: force-satisfy breach
  run.chargesFed = run.breachReq.charge;  // scaffold
  S.tick(run);
  assertEq(run.status, 'breachReady', 'depth 8 breach ready');
  const evs = run.events.splice(0, run.events.length);
  assert(evs.some((e) => e.type === 'breachReady'), 'breachReady event at depth 8');

  assert(S.beginDescent(run), 'beginDescent at depth 8');
  assertEq(run.status, 'won', 'breaching stratum 8 wins the run');
  assert(run.result && run.result.won === true, 'result.won set');
  assertEq(run.result.cores, run.breaches + D.WIN_CORES, 'cores = breaches + WIN_CORES');
  assertEq(run.pendingOffers, null, 'no offers on the won path');
  assert(run.events.some((e) => e.type === 'won'), 'won event pushed');
  run.events.splice(0, run.events.length);

  S.continueIntoMantle(run);
  assertEq(run.mantle, true, 'mantle flag set');
  assert(Array.isArray(run.pendingOffers) && run.pendingOffers.length === run.mods.offerCount,
    'continueIntoMantle offers schematics');

  // pick an offer that keeps the breach math simple
  const pick = run.pendingOffers.find((id) => id !== 's_drill' && id !== 's_plate') ||
               run.pendingOffers[0];
  const preInstab = run.instability;
  S.applySchematic(run, pick);
  assertEq(run.depth, 9, 'depth 9 after mantle pick');
  assertEq(run.status, 'active', 'active again in the Mantle');
  assert(run.grid && run.hub, 'mantle map generated');
  const ms = D.mantleStratum(9);
  assertEq(run.breachReq.gear, Math.ceil(ms.breach.gear * run.mods.breachMult),
    'depth 9 breachReq.gear from mantleStratum');
  assertEq(run.breachReq.charge, Math.ceil(ms.breach.charge * run.mods.breachMult),
    'depth 9 breachReq.charge from mantleStratum');
  assertEq(run.instability, Math.max(0, preInstab - 40), 'instability vented into the Mantle');
  // the mantle map simulates cleanly
  for (let i = 0; i < 40 * 1; i++) S.tick(run);
  assertEq(run.status, 'active', 'mantle stratum ticks without incident');
  // a second mantle breach loops the flow (no second victory)
  run.gearsFed = run.breachReq.gear;      // scaffold
  run.chargesFed = run.breachReq.charge;  // scaffold
  S.tick(run);
  assertEq(run.status, 'breachReady', 'mantle breach ready');
  assert(S.beginDescent(run), 'mantle beginDescent');
  assert(run.status !== 'won', 'no second victory in the Mantle');
  assert(Array.isArray(run.pendingOffers), 'mantle descent offers schematics');
}

// -------------------------------------------------------------------- main
const SEED = process.env.DC_SEED ? (parseInt(process.env.DC_SEED, 10) | 0) : 1337;
try {
  const t0 = Date.now();
  const run = drivenRun(SEED);
  const drivenSummary = 'driven: depth ' + run.depth + ' breaches ' + run.breaches +
    ' integ ' + Math.ceil(run.integrity) + '/' + run.maxIntegrity +
    ' t ' + Math.round(run.totalT / HZ) + 's';
  extractCadence(SEED + 7);
  overdriveSection(SEED + 11);
  demolishRepairSection(SEED + 13);
  breachSalvageSection(SEED + 17);
  chargeSection(SEED + 19);
  endgameSection(SEED + 23);
  console.log('PASS integration seed=' + SEED + ' | ' + drivenSummary +
    ' | cadence 16/12/10 | overdrive x2 | damper ok | charge+bronze ok | mantle ok | ' +
    (Date.now() - t0) + 'ms');
  process.exit(0);
} catch (e) {
  fail('exception: ' + (e && e.stack || e));
}
