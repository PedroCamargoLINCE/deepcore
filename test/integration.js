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
     - engine + barks end-to-end (SPEC2 §A/§D/§G): the real engine booted on
       stub DOM/rAF, driven through its keydown/mouse handlers — keyboard
       cursor play, lay-mode, bark wiring, foreman lifecycle, arrival flash,
       foundry flashPart — with render.js live on a recording context stub
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
  // (A default-meta bot stalls re-basing stratum 2 at ~30 plates vs ~34 cost.)
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
  // Tuning notes (empirical): asmGate 26 on s1 banks a plate cushion BEFORE
  // the assembler converts the flow to gears — a stratum-2 rebase costs
  // ~28-36 plates and a fresh stratum has no income until a chain is up.
  // (Stale note removed: seeds 2/42 used to lose the s2 line to inst-75+
  // quakes. The M-POLISH balance pass cut instabRate ~35% and made a chain pay
  // for itself inside a stratum; test/balance.js now measures 13/14 seeds
  // surviving stratum 2 on a naked rig. DC_TRACE=1 prints 30s snapshots.)
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
    assertEq(run.instability, Math.max(0, preInstab - 45), 'instability -45 carryover (min 0)');
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

  // Natural quakes must fire once instability builds. (Balance pass, M-POLISH:
  // instabRate dropped ~35% across the strata table, so a brisk strata-1/2
  // push can now legitimately outrun the first quake — that IS the reward for
  // pace. Hold position at stratum 3 instead and let the pressure build; this
  // is the camper's death in miniature, and it still covers the natural-quake
  // path end to end.)
  for (let i = 0; i < 200 && !drainer.seen.quake && run.status !== 'dead'; i++) {
    bot.tickN(4 * HZ, false);
  }
  assert(drainer.seen.quake >= 1,
    'natural quake fires while holding at stratum 3 (inst ' +
    Math.round(run.instability) + ')');
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
  assertEq(run.instability, Math.max(0, preInstab - 45), 'instability vented into the Mantle');
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

// =========================================================================
// SECTION 8 — engine + barks end-to-end (SPEC2 §A/§D/§G)
// Boots the REAL engine against stub DOM/rAF and drives it through its
// actual keydown/mouse handlers and loop: keyboard-first play (cursor walk,
// Enter placement, belt lay-mode with auto-corner, Shift jump, tool keys,
// pause/help), bark wiring (runStart/first*/quake/bigQuake/breachReady/
// descend/schematicPick-bespoke/stratumArrive-bespoke), foreman set+expiry,
// the §E arrival flash, and the §C.2 foundry flashPart. render.js runs for
// real on a recording 2d-context stub; a 'RENDER ERROR' cell fails the
// section. Zero natural quakes fire in the driven window (instability stays
// < QUAKE.startInst), so the script is deterministic for any seed.
// =========================================================================
function engineBarksSection(seed) {
  SECTION = 'engine+barks seed=' + seed;
  require('../js/barks.js');
  require('../js/render.js');
  require('../js/engine.js');
  const B = DC.Barks;
  assert(B && DC.Render && DC.Engine, 'barks/render/engine loaded');

  // --- DOM / rAF stubs (modules captured root=globalThis at load) ---
  const handlers = {};          // window keydown + canvas mouse handlers
  const drawn = [];             // every fillText span, for smoke assertions
  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function (s) { drawn.push(String(s)); },
    measureText: function () { return { width: 10 }; },
  };
  const canvasStub = {
    style: {},
    getContext: function () { return ctxStub; },
    addEventListener: function (t, fn) { handlers[t] = fn; },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: D.COLS * 10, height: D.ROWS * 19 };
    },
  };
  global.window = { addEventListener: function (t, fn) { handlers[t] = fn; } };
  global.document = { getElementById: function () { return canvasStub; } };
  global.location = { search: '?seed=' + seed };
  let rafCb = null;
  global.requestAnimationFrame = function (fn) { rafCb = fn; };

  DC.Engine.start();
  const st = DC.state;
  assert(st && st.screen === 'title', 'engine boots to the title screen');
  // M-HIRES Phase 1: there was no resize handler anywhere in the codebase,
  // which is exactly why the canvas was a fixed island. Wiring it is the
  // engine's only job in that brief, so assert the wire exists and that
  // firing it is harmless (it debounces before it touches the renderer).
  assert(typeof handlers.resize === 'function', 'engine wires a window resize listener');
  handlers.resize();
  handlers.resize();

  let now = 0;
  function frames(n) {          // drive the real rAF loop, 1 tick per frame
    for (let i = 0; i < n; i++) {
      now += 1000 / HZ;
      const cb = rafCb;
      assert(cb, 'rAF loop stays scheduled');
      rafCb = null;
      cb(now);
    }
  }
  function key(k, shift) {
    handlers.keydown({ key: k, shiftKey: !!shift, preventDefault: function () {} });
  }
  function mouseAt(tx, ty, type) {   // map-tile coords -> pixel event
    const ev = { clientX: (D.MAP_X + tx) * 10 + 5, clientY: (D.MAP_Y + ty) * 19 + 9 };
    handlers.mousemove(ev);
    if (type) handlers[type](ev);
  }

  frames(2);
  assert(drawn.some(s => s.indexOf('BEGIN DESCENT') >= 0), 'title menu rendered');

  // --- Enter starts the run; runStart bark + §E arrival flash ---
  key('Enter');
  assert(st.screen === 'run' && st.run, 'Enter starts a run');
  const run = st.run;
  assertEq(run.seed, seed, 'engine honored the ?seed= param');
  assert(run.foreman && B.POOLS.runStart.indexOf(run.foreman.text) >= 0,
    'runStart bark set run.foreman');
  assertEq(run.foreman.t0, run.totalT, 'foreman.t0 anchored at run.totalT');
  assert(st.ui.flash && /STRATUM 1/.test(st.ui.flash.text), 'stratum-1 arrival flash set');
  assertEq(st.ui.flash.color, D.STRATA[0].accent, 'arrival flash uses the stratum accent');
  const hx = run.hub.x, hy = run.hub.y;
  assertEq(st.ui.cursor.x, hx + 1, 'cursor starts at hub center (x)');
  assertEq(st.ui.cursor.y, hy + 1, 'cursor starts at hub center (y)');

  // --- loop ticks the sim; foreman expires right after until + 2s fade ---
  const u0 = run.foreman.until;
  frames(2);
  assert(run.t >= 1, 'engine loop ticks the sim');
  while (run.totalT <= u0 + 2 * HZ) frames(1);
  frames(1);
  assertEq(run.foreman, null, 'foreman cleared after until + 2s fade');

  // --- keyboard-first play (§D): tool key, cursor walk, Enter placement ---
  key('3');
  assertEq(st.ui.tool, 'smelter', "'3' selects the smelter tool");
  for (let i = 0; i < 3; i++) key('ArrowLeft');
  for (let i = 0; i < 3; i++) key('ArrowUp');
  assertEq(st.ui.cursor.x, hx - 2, 'cursor walked to the hub-ring corner (x)');
  assertEq(st.ui.cursor.y, hy - 2, 'cursor walked to the hub-ring corner (y)');
  const plates0 = run.inv.ironPlate;
  key('Enter');
  const smT = run.grid[hy - 2][hx - 2];
  assert(smT.machine !== null && run.machines[smT.machine].type === 'smelter',
    'Enter placed the smelter at the cursor');
  assertEq(run.inv.ironPlate, plates0 - D.BUILDINGS.smelter.cost.ironPlate, 'cost paid');
  assertEq(run.stats.placed.smelter, 1, 'stats.placed.smelter incremented');
  frames(2);
  assert(run.foreman && B.POOLS.firstSmelter.indexOf(run.foreman.text) >= 0,
    'firstSmelter bark fired via run.stats detection');

  // --- belt lay-mode: Enter arms, moves lay, corners auto-turn, Esc disarms ---
  key('1');
  assertEq(st.ui.tool, 'belt', "'1' selects the belt tool");
  for (let i = 0; i < 6; i++) key('ArrowDown');       // to (hx-2, hy+4), clear ring
  assertEq(st.ui.cursor.y, hy + 4, 'cursor on the bottom clear row');
  key('Enter');
  assert(st.ui.laying, 'Enter arms lay-mode');
  assert(run.grid[hy + 4][hx - 2].belt, 'arming placed the first belt');
  for (let i = 0; i < 3; i++) key('ArrowRight');      // lay 3 east
  key('ArrowUp');                                     // corner turn + lay north
  const cornerB = run.grid[hy + 4][hx + 1].belt;
  assert(cornerB && cornerB.dir === 0, 'corner belt auto-turned north');
  const northB = run.grid[hy + 3][hx + 1].belt;
  assert(northB && northB.dir === 0, 'lay-mode laid the northbound belt');
  assertEq(run.stats.placed.belt, 5, 'five belts laid through the key handlers');
  key('Escape');
  assert(!st.ui.laying, 'Escape disarms lay-mode');
  assertEq(st.ui.tool, 'belt', 'Escape while laying keeps the tool');
  let guard = 0;
  while (!(run.foreman && B.POOLS.firstBelt.indexOf(run.foreman.text) >= 0) &&
         guard++ < 20 * HZ) frames(1);
  assert(guard < 20 * HZ, 'queued firstBelt bark landed after the cooldown');

  // --- Shift jump, rotate, mouse=cursor, keyboard demolish, overdrive ---
  const cx0 = st.ui.cursor.x;
  key('ArrowRight', true);
  assertEq(st.ui.cursor.x, Math.min(cx0 + 5, D.MAP_W - 1), 'Shift+arrow jumps 5');
  const f0 = st.ui.facing;
  key('r');
  assertEq(st.ui.facing, (f0 + 1) % 4, 'R rotates the facing');
  key('x');
  assertEq(st.ui.tool, 'demolish', "'x' selects demolish");
  mouseAt(hx + 1, hy + 3);
  assertEq(st.ui.cursor.x, hx + 1, 'mouse-move drives the cursor (x)');
  assertEq(st.ui.cursor.y, hy + 3, 'mouse-move drives the cursor (y)');
  key('Enter');
  assert(!run.grid[hy + 3][hx + 1].belt, 'Enter with demolish removed the belt');
  key('c');
  assertEq(run.overdrive, true, "'c' engages overdrive");
  key('c');
  assertEq(run.overdrive, false, "'c' disengages overdrive");

  // --- Escape tool-clear -> pause -> help (manual documents cursor play) ---
  key('Escape');
  assertEq(st.ui.tool, null, 'Escape clears the tool');
  key('Escape');
  assert(st.ui.paused, 'Escape with no tool pauses');
  key('h');
  assertEq(st.screen, 'help', "pause-menu 'h' opens the manual");
  assertEq(st.ui.helpPage, 0, 'the manual always opens on page 1');
  frames(1);
  assert(drawn.some(s => s.indexOf('MOUSE OPTIONAL') >= 0),
    'manual documents keyboard-cursor play');

  // --- M-MANUAL: both pages really reach the cell buffer, and the keycaps
  // are inverse cells (the letter takes the page background, the cap the tier
  // colour) rather than bracketed text pretending to be keys.
  {
    const A = DC.Art, R = DC.Render;
    const pages = A.helpPages;
    assertEq(pages.length, 2, 'the manual ships two pages');
    const x0 = (D.COLS - pages[0].w) >> 1, y0 = (D.ROWS - pages[0].h) >> 1;
    for (let i = 0; i < pages.length; i++) {
      st.ui.helpPage = i;
      drawn.length = 0;
      frames(1);
      const page = pages[i];
      // the page's longest single-colour run landed on the canvas
      let probe = '';
      for (const row of page.rows)
        for (const s of row) if (!s.inv && s.t.trim().length > probe.length) probe = s.t.trim();
      assert(drawn.some(s => s.indexOf(probe) >= 0),
        'page ' + page.id + ' rendered ("' + probe + '")');
      // the grid the composer built is the grid the buffer holds
      for (let r = 0; r < page.h; r++) {
        for (const span of page.rows[r]) {
          const cell = R.cellAt(x0 + span.x, y0 + r);
          assertEq(cell.ch, span.t[0], page.id + ' row ' + r + ' col ' + span.x + ' drew its glyph');
          if (span.inv) {
            assertEq(cell.fg, D.COLORS.bg, page.id + ': a keycap letter is the page background');
            assertEq(cell.bg, R.helpColor(span.c), page.id + ': a keycap face is the tier colour');
          } else {
            assertEq(cell.fg, R.helpColor(span.c), page.id + ' row ' + r + ': span colour');
          }
        }
      }
    }
    // the pager itself: arrows wrap, page numbers jump, ESC leaves
    st.ui.helpPage = 0;
    key('ArrowRight'); assertEq(st.ui.helpPage, 1, '→ turns to page 2');
    key('ArrowRight'); assertEq(st.ui.helpPage, 0, '→ wraps back to page 1');
    key('ArrowLeft');  assertEq(st.ui.helpPage, 1, '← wraps to the last page');
    key('1');          assertEq(st.ui.helpPage, 0, "'1' jumps to page 1");
    key('2');          assertEq(st.ui.helpPage, 1, "'2' jumps to page 2");
    key('9');          assertEq(st.ui.helpPage, 1, 'a page that does not exist is ignored');
    frames(1);
  }

  key('Escape');
  assertEq(st.screen, 'run', 'Escape returns from the manual to the run');
  assert(st.ui.paused, 'still paused after the manual');
  key('h'); assertEq(st.ui.helpPage, 0, 'reopening the manual returns to page 1');
  key('Escape');
  key(' ');
  assert(!st.ui.paused, 'space unpauses');

  // --- engine wiring: run.shake -> quake bark; event drain -> bigQuake ---
  guard = 0;
  while (run.totalT - run._barks.lastAt < B.COOLDOWN + 8 && guard++ < 30 * HZ) frames(1);
  run.shake = true;                                    // scaffold: force the path
  run.events.push({ type: 'quake', t: run.totalT, data: { dmg: 9 } });
  frames(1);
  assert(run.foreman && B.POOLS.bigQuake.indexOf(run.foreman.text) >= 0,
    'shake + event drain produced the same-tick bigQuake supersede');
  assert(st.ui.shakeUntil > run.t, 'engine mirrored run.shake into ui.shakeUntil');
  assert(st.ui.flash && /QUAKE/.test(st.ui.flash.text), 'quake flash banner set');

  // --- breach -> D descend -> animation gate -> bespoke schematic bark ---
  run.gearsFed = run.breachReq.gear;                   // scaffold: satisfy quota
  frames(1);
  assertEq(run.status, 'breachReady', 'breach ready');
  assert(run.foreman && B.POOLS.breachReady.indexOf(run.foreman.text) >= 0,
    'breachReady bark (priority) cut in');
  assert(st.ui.flash && /BREACH READY/.test(st.ui.flash.text), 'breach flash set');
  frames(7 * HZ);                                      // clear the bark cooldown
  key('d');
  assertEq(st.screen, 'descend', "'d' begins the descent");
  assert(Array.isArray(run.pendingOffers) && run.pendingOffers.length >= 3,
    'schematic offers pending');
  assert(run.foreman && B.POOLS.descend.indexOf(run.foreman.text) >= 0,
    'descend bark fired');
  const preDepth = run.depth;
  key('1');
  assertEq(run.depth, preDepth, 'pick ignored while the descent animation plays');
  frames(140);                                         // real render advances the anim
  assert(st.ui.descendAnim >= DC.Art.descent.length * 10 + 45, 'descent animation done');
  const pickId = run.pendingOffers[1];
  key('2');
  assertEq(run.depth, preDepth + 1, "'2' picked the second schematic");
  assertEq(st.screen, 'run', 'back on the run screen');
  assert(run.schematics.indexOf(pickId) >= 0, 'schematic applied');
  assertEq(run.foreman && run.foreman.text, B.SCHEM_LINES[pickId],
    'bespoke schematic bark fired on applySchematic');
  assert(st.ui.flash && st.ui.flash.text.indexOf('STRATUM ' + run.depth) >= 0,
    'stratum-2 arrival flash set');
  assertEq(st.ui.flash.color, D.STRATA[1].accent, 'arrival flash uses stratum-2 accent');
  assertEq(st.ui.cursor.x, run.hub.x + 1, 'cursor recentered on the new hub');

  // --- bespoke stratumArrive queues behind the cooldown, then lands ---
  guard = 0;
  while (!(run.foreman && run.foreman.text === B.STRATUM_LINES[2]) &&
         guard++ < 20 * HZ) frames(1);
  assertEq(run.foreman && run.foreman.text, B.STRATUM_LINES[2],
    'bespoke stratum-2 arrival bark landed');

  // --- mouse: sidebar build-row click, hub click = overdrive ---
  frames(1);                                           // publish layout.buildRows
  const rows = DC.Render.layout.buildRows;
  assert(Array.isArray(rows) && rows.length === D.BUILD_ORDER.length + 1,
    'render published the sidebar build rows');
  const beltRow = rows.filter(r => r.tool === 'belt')[0];
  assert(beltRow, 'belt row published');
  const sbEv = { clientX: 52 * 10 + 5, clientY: beltRow.row * 19 + 9 };
  handlers.mousedown(sbEv);
  assertEq(st.ui.tool, 'belt', 'sidebar click selects the belt tool');
  handlers.mousedown(sbEv);
  assertEq(st.ui.tool, null, 'clicking the selected row toggles it off');
  mouseAt(run.hub.x + 1, run.hub.y + 1, 'mousedown');
  assertEq(run.overdrive, true, 'clicking the hub toggles overdrive');
  key('c');
  assertEq(run.overdrive, false, 'C toggles it back off');

  // --- abandon -> gameover (cause-aware epitaph) -> title ---
  key('Escape');
  key('a');
  assertEq(st.screen, 'gameover', 'pause-menu A abandons the run');
  assertEq(run.status, 'dead', 'abandoned run is dead');
  // M-POLISH backlog: walking away used to skip the death bark entirely, so
  // GRIT had nothing to say about the one exit the player chooses. The engine
  // now fires it before the screen flips; 'death' is a PRIORITY trigger, so
  // the 6s global cooldown can never swallow it.
  assert(run.foreman && B.POOLS.death.indexOf(run.foreman.text) >= 0,
    'abandoning fires a death bark (got ' +
    JSON.stringify(run.foreman && run.foreman.text) + ')');
  frames(2);
  const epiPool = [];
  for (const pair of B.EPITAPHS.abandon) for (const l of pair) epiPool.push(l);
  assert(drawn.some(s => epiPool.some(l => s.indexOf(l.slice(0, 30)) >= 0)),
    'gameover renders an abandon-cause epitaph');
  key('Enter');
  assertEq(st.screen, 'title', 'Enter returns to the title');
  assertEq(st.run, null, 'run cleared');

  // --- foundry: letter buy sets ui.flashPart (§C.2) and the part renders ---
  st.meta.cores = 10;                                  // scaffold: afford m_stock
  key('f');
  assertEq(st.screen, 'foundry', "'f' opens the Foundry");
  key('a');
  assertEq(st.meta.upgrades.m_stock, 1, 'foundry buy applied');
  assertEq(st.meta.cores, 8, 'cores paid');
  assert(st.ui.flashPart && st.ui.flashPart.id === 'm_stock',
    'engine set ui.flashPart on purchase');
  frames(3);
  assert(drawn.some(s => s.indexOf('▣') >= 0),
    'purchased part appears in the rig portrait');
  // M-POLISH backlog: GRIT's 9 bespoke foundryBuy lines were unreachable —
  // bark() needs a live run and the Foundry has none. The engine now keeps a
  // run-shaped bark context for this screen and parks the line in
  // st.foundryBark; render draws it under the portrait.
  assertEq(st.foundryBark && st.foundryBark.line, B.META_LINES.m_stock,
    'foundry purchase produces its bespoke foreman line with no live run');
  assert(drawn.some(s => s.indexOf(B.META_LINES.m_stock.slice(0, 30)) >= 0),
    'the Foundry renders GRIT under the rig portrait');
  // a second purchase talks too — the runless context must not stall on the
  // global bark cooldown (its clock does not advance on its own)
  key('b');
  assertEq(st.meta.upgrades.m_hull, 1, 'second foundry buy applied');
  assertEq(st.foundryBark.line, B.META_LINES.m_hull,
    'consecutive purchases each get their own line (cooldown does not stall)');
  key('Escape');
  assertEq(st.screen, 'title', 'Escape returns to the surface');
  key('f');
  assertEq(st.foundryBark.line, null, 're-entering the Foundry clears the stale line');
  key('Escape');

  // --- render smoke over the whole drive ---
  assert(!drawn.some(s => s.indexOf('RENDER ERROR') >= 0),
    'no render faults during the drive');
  assert(drawn.some(s => s.indexOf('DEEPCORE') >= 0), 'run header rendered');
  assert(drawn.some(s => s.indexOf('GRIT') >= 0), 'foreman bar rendered');

  delete global.window;
  delete global.document;
  delete global.location;
  delete global.requestAnimationFrame;
}

// =========================================================================
// SECTION 10 — M-RECAP: recap card, Daily Shaft, ghost splits
// The whole brief driven through the REAL engine on stub DOM/rAF/storage:
// the Daily's seed and naked loadout, splits stamped at descend, the save
// migration surfacing as ghost rows in the sidebar, the TAB card view, and
// the clipboard's three outcomes (copied / refused / no clipboard at all).
// The card is asserted as text AND as cells, because the promise of the
// feature is that what you see is exactly what you paste.
// =========================================================================
function recapSection(seed) {
  SECTION = 'recap seed=' + seed;
  require('../js/barks.js');
  require('../js/fx.js');          // loaded on purpose: the card must survive it
  require('../js/render.js');
  require('../js/engine.js');
  const B = DC.Barks, R = DC.Render, M = DC.Meta;
  assert(typeof R.recapText === 'function' && typeof R.recapCard === 'function',
    'render exports the recap card as text and as rows');

  const handlers = {};
  const drawn = [];
  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function (s) { drawn.push(String(s)); },
    measureText: function () { return { width: 10 }; },
  };
  const canvasStub = {
    style: {},
    getContext: function () { return ctxStub; },
    addEventListener: function (t, fn) { handlers[t] = fn; },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: D.COLS * 10, height: D.ROWS * 19 };
    },
  };
  global.window = { addEventListener: function (t, fn) { handlers[t] = fn; } };
  global.document = { getElementById: function () { return canvasStub; } };
  global.location = { search: '' };            // no ?seed=: normal runs roll one
  let rafCb = null;
  global.requestAnimationFrame = function (fn) { rafCb = fn; };
  const cell = {};                             // the "disk"
  global.localStorage = {
    getItem: (k) => (k in cell ? cell[k] : null),
    setItem: (k, v) => { cell[k] = String(v); },
  };
  let captured = null;                         // last clipboard payload

  // the rAF clock must stay monotonic across the whole section (the engine
  // keeps `lastTime` between frames; a rewound clock yields a negative dt and
  // the sim silently stops ticking)
  let now = 1e7;
  function frames(n) {
    for (let i = 0; i < n; i++) {
      now += 1000 / HZ;
      const cb = rafCb;
      assert(cb, 'rAF loop stays scheduled');
      rafCb = null;
      cb(now);
    }
  }
  function key(k) {
    handlers.keydown({ key: k, shiftKey: false, preventDefault: function () {} });
  }
  function paint() { drawn.length = 0; frames(1); return drawn; }
  function shown(s) { return drawn.some((x) => x.indexOf(s) >= 0); }

  try {
    // --- a v1 save on disk: the migration has to survive a real boot -------
    cell[D.SAVE_KEY] = JSON.stringify({
      cores: 9, upgrades: { m_stock: 2 }, bestDepth: 3, wins: 0, runs: 4, totalCores: 12,
    });
    DC.Engine.start();
    const st = DC.state;
    assertEq(st.screen, 'title', 'engine boots to the title with a v1 save');
    assertEq(st.meta.cores, 9, 'the v1 save loaded');
    assertEq(st.meta.upgrades.m_stock, 2, 'the v1 loadout loaded');
    assert(st.meta.bestSplits && st.meta.dailyHistory.length === 0,
      'the v1 save migrated to the M-RECAP shape');
    paint();
    assert(shown('DAILY SHAFT'), 'the title offers the Daily Shaft');

    // --- [T]: today's seed, naked rig, ranked ------------------------------
    const today = M.dailyKey(Date.now());
    assertEq(st.today, today, 'the engine stamped the date for render');
    key('t');
    const run = st.run;
    assertEq(st.screen, 'run', 'T starts the Daily Shaft');
    assertEq(run.seed, M.dailySeed(today), "the Daily's seed is the date hash");
    assertEq(run.daily.date, today, 'the run is tagged with the date it belongs to');
    assertEq(run.daily.practice, false, 'the first attempt of a date is ranked');
    // the Foundry is DISABLED: m_stock 2 would add 40 plates and 8 gears
    assertEq(run.inv.ironPlate, D.START_STOCK.ironPlate,
      'the Daily runs a naked rig (m_stock ignored)');
    assertEq(run.inv.gear, D.START_STOCK.gear, 'no meta gears in the Daily either');
    assertEq(run.maxIntegrity, D.START_INTEGRITY, 'no meta hull in the Daily either');
    assert(run.foreman && B.POOLS.dailyStart.indexOf(run.foreman.text) >= 0,
      'GRIT announces the ranked Daily');
    assert(Array.isArray(run.splits) && run.splits.length === 0, 'splits start empty');
    assert(typeof run.startedAt === 'number', 'the run is stamped with a wall clock');

    // --- a cleared stratum stamps one split --------------------------------
    frames(3);
    run.gearsFed = run.breachReq.gear;          // scaffold: satisfy the quota
    frames(1);
    assertEq(run.status, 'breachReady', 'breach ready');
    const t1 = run.t;
    key('d');
    assertEq(st.screen, 'descend', 'D begins the descent');
    assertEq(run.splits.length, 1, 'descending stamped one split');
    assertEq(run.splits[0].depth, 1, 'the split is for the stratum just cleared');
    assertEq(run.splits[0].sec, t1 / HZ,
      'the split is the STRATUM clock (run.t), not the run clock');
    assertEq(run.splits[0].gears, run.breachReq.gear, 'the split carries its feed totals');
    frames(140);
    key('1');
    assertEq(run.depth, 2, 'into stratum 2');
    assert(run.t < t1, 'the stratum clock reset behind the split');

    // --- abandon: splits and the ranked Daily land in the save -------------
    key('Escape');
    key('a');
    assertEq(st.screen, 'gameover', 'abandoning ends the run');
    assertEq(M.bestSplit(st.meta, 1), Math.round((t1 / HZ) * 10) / 10,
      'clearing stratum 1 banked a ghost split');
    const entry = M.dailyEntry(st.meta, today);
    assert(entry && entry.depth === 2 && entry.timeSec === run.result.timeSec,
      'the ranked Daily result was recorded');
    assert(JSON.parse(cell[D.SAVE_KEY]).dailyHistory.length === 1,
      'the Daily result was persisted, not just held in memory');

    // --- TAB: the recap card ----------------------------------------------
    paint();
    assert(shown('STRATUM REACHED'), 'gameover opens on the stats view');
    assert(shown('[TAB]'), 'the stats view advertises the card');
    key('Tab');
    assertEq(st.screen, 'recap', 'TAB opens the recap card as its own screen');
    const card = R.recapCard(st);
    const txt = R.recapText(st);
    for (let i = 0; i < card.plain.length; i++) {
      assertEq(card.plain[i].length, R.CARD_W,
        'card row ' + i + ' is exactly ' + R.CARD_W + ' columns');
    }
    assert(card.rows.length <= D.ROWS - 2, 'the card fits the screen with its footer');
    assert(txt.indexOf('RUN RECAP') >= 0, 'the card names itself');
    assert(txt.indexOf('SEED ' + run.seed) >= 0, 'the card carries the seed');
    assert(txt.indexOf('DAILY SHAFT') >= 0 && txt.indexOf('RANKED') >= 0,
      'the card marks a ranked Daily');
    assert(/S1\s+TOPSOIL RIDGE\s+█+/.test(txt), 'the depth chart has a bar per stratum');
    assert(txt.indexOf('S2 ') >= 0 && txt.indexOf('†') >= 0,
      'the stratum the run ended in is charted and flagged');
    assert(txt.indexOf('ABANDONED') >= 0, 'the card states how the run ended');
    assert(txt.indexOf('PERFORMANCE REVIEW') >= 0, "GRIT's review is on the card");
    assertEq(R.recapText(st), txt, 'the card is stable across reads (no re-rolled roast)');
    const review = B.REVIEWS[B.reviewTier(run, run.result)]
      .map((l) => B.fillReview(l, B.reviewCtx(run, run.result)))
      .filter((l) => txt.indexOf(l.slice(0, 24)) >= 0);
    assertEq(review.length, 1, 'the review line on the card comes from the earned tier');
    paint();
    assert(shown('RUN RECAP'), 'the card actually landed on the screen');
    assert(!shown('STRATUM REACHED'), 'the card replaces the stats view');
    assert(shown('[C] COPY CARD'), 'the card advertises the copy key');

    // The card is its own screen id precisely so the FX layer leaves it
    // alone: gameover dust motes and the victory core-pulse are scoped by
    // screen, and a card with a '·' punched through its border is a card you
    // would not paste. Read the cells back after a run of frames and require
    // the drawn card to still be the built card, glyph for glyph.
    frames(40);
    assert(DC.FX && DC.FX.clock && DC.FX.clock() > 0,
      'the FX layer really was live for those frames (the check is not vacuous)');
    const grid = [];
    for (let r = 0; r < D.ROWS; r++) {
      let line = '';
      for (let c = 0; c < D.COLS; c++) line += (R.cellAt(c, r) || { ch: ' ' }).ch;
      grid.push(line);
    }
    let top = -1;
    for (let r = 0; r < grid.length; r++) if (grid[r].indexOf('┌─ DEEPCORE') >= 0) { top = r; break; }
    assert(top >= 0, 'the card box is on the cell grid');
    const cx = grid[top].indexOf('┌─ DEEPCORE');
    for (let i = 0; i < card.plain.length; i++) {
      assertEq(grid[top + i].slice(cx, cx + R.CARD_W), card.plain[i],
        'card row ' + i + ' survives 40 frames of the FX overlay intact');
    }

    // --- C: clipboard, and both ways it can fail --------------------------
    global.navigator = {
      clipboard: { writeText: function (t) { captured = t; return { catch: function () {} }; } },
    };
    key('c');
    assertEq(captured, txt, 'C copied exactly the card that is on screen');
    assert(/COPIED/.test(st.ui.copied), 'the copy is confirmed on the card');
    assertEq(st.screen, 'recap', 'copying does not leave the card');
    global.navigator = {                                   // permission denied
      clipboard: { writeText: function () { return { catch: function (fn) { fn(new Error('no')); } }; } },
    };
    key('c');
    assert(/REFUSED/.test(st.ui.copied), 'a rejected write leaves a readable notice');
    global.navigator = {};                                 // file:// has none
    key('c');
    assert(/CLIPBOARD/.test(st.ui.copied), 'no clipboard is a notice, not a crash');
    delete global.navigator;
    key('c');
    assert(st.ui.copied && st.ui.copied.length > 0, 'no navigator at all is survivable');

    // --- TAB back, ENTER out ----------------------------------------------
    key('Tab');
    assertEq(st.screen, 'gameover', 'TAB returns to the stats view it came from');
    assertEq(st.ui.copied, null, 'the copy notice does not follow you off the card');
    paint();
    assert(shown('STRATUM REACHED'), 'the stats view came back');
    key('Enter');
    assertEq(st.screen, 'title', 'ENTER returns to the surface');

    // --- second attempt today = practice, and it never ranks --------------
    key('t');
    const prac = st.run;
    assertEq(prac.daily.practice, true, 'the day is already ranked: this one is practice');
    assertEq(prac.seed, M.dailySeed(today), 'practice digs the same shaft');
    assert(prac.foreman && B.POOLS.dailyPractice.indexOf(prac.foreman.text) >= 0,
      'GRIT calls it practice');

    // --- ghost splits in the DRILL box ------------------------------------
    frames(2);
    const g0 = R.ghostSplit(prac, st.meta);
    assert(g0 && g0.best === M.bestSplit(st.meta, 1), 'the ghost is your stratum-1 record');
    assert(g0.delta > 0 && g0.mark === '▲', 'early in the stratum you are ahead of it');
    assert(shown('BEST '), 'the DRILL box draws the ghost split');
    prac.t = Math.round((g0.best + 30) * HZ);        // scaffold: fall behind
    const g1 = R.ghostSplit(prac, st.meta);
    assertEq(g1.mark, '▼', 'past the record the marker flips');
    assert(g1.delta < 0, 'and the delta goes negative');
    assertEq(R.ghostSplit(prac, { bestSplits: {} }), null, 'no record, no ghost row');
    assertEq(R.ghostSplit(prac, {}), null, 'a v1 profile shows no ghost row');

    // a run with nothing cleared still cards: one partial row, no chart lies
    const bare = R.recapCard(st).plain.join('\n');
    assert(/S1\s+TOPSOIL RIDGE[^\n]*†/.test(bare),
      'a run that cleared nothing charts its one unfinished stratum');
    key('Escape');
    key('a');
    assertEq(M.dailyEntry(st.meta, today).depth, 2,
      'a practice run never overwrites the ranked result');
    assertEq(st.meta.dailyHistory.length, 1, 'practice adds no history row');
    key('Enter');

    // --- victory: C means copy on the card, Mantle on the stats view ------
    key('Enter');
    const vr = st.run;
    assert(vr && vr !== prac, 'a fresh normal run started');
    assert(vr.inv.ironPlate > D.START_STOCK.ironPlate,
      'a normal run DOES get the Foundry loadout (the Daily is the exception)');
    // scaffold: stand the engine on the victory screen with a finished run
    vr.depth = D.STRATA_COUNT;
    vr.status = 'won';
    vr.breaches = D.STRATA_COUNT;
    vr.splits = [];
    for (let d = 1; d <= D.STRATA_COUNT; d++) {
      vr.splits.push({ depth: d, sec: 60 + d * 20, gears: 10 * d, charges: d > 4 ? d : 0 });
    }
    vr.result = { depth: D.STRATA_COUNT, breaches: D.STRATA_COUNT, timeSec: 1200,
                  cores: D.STRATA_COUNT + D.WIN_CORES, won: true };
    st.screen = 'victory';
    st.ui.copied = null;
    paint();
    assert(shown('CONTINUE INTO THE MANTLE'), 'the victory stats view offers the Mantle');
    key('Tab');
    global.navigator = {
      clipboard: { writeText: function (t) { captured = t; return { catch: function () {} }; } },
    };
    captured = null;
    key('c');
    assert(captured && captured.indexOf('CORE BREACHED') >= 0,
      'C on the victory card copies the win');
    assertEq(st.screen, 'recap', 'copying did not descend into the Mantle');
    const wonCard = R.recapCard(st).plain.join('\n');
    assert(/S8\s+THE CORE GATE/.test(wonCard), 'the winning card charts all eight strata');
    assert(wonCard.indexOf('†') < 0, 'a completed run has no unfinished stratum');
    // Every stratum name in FULL. The card is meant to be pasted somewhere
    // public, and a name cut mid-word ('GLOWDEEP GALLER') is the exact defect
    // M-POLISH/CX-04 called out in the SCAN panel. The name column is budgeted
    // for the longest of the eight, so this is a width regression alarm.
    for (let d = 1; d <= D.STRATA_COUNT; d++) {
      const nm = D.STRATA[d - 1].name;
      assert(wonCard.indexOf(nm) >= 0,
        'the card prints stratum ' + d + ' name whole: ' + JSON.stringify(nm));
    }
    for (const ln of wonCard.split('\n')) {
      assertEq(ln.length, R.CARD_W, 'every card row is exactly ' + R.CARD_W + ' columns');
    }
    key('Tab');
    assertEq(st.screen, 'victory', 'TAB goes back to the victory stats view');
    key('c');
    assertEq(st.screen, 'descend', 'C on the stats view still continues into the Mantle');

    // --- the card is a spectator: reading it must not change the run --------
    // On victory the run is STILL LIVE — C continues it into the Mantle. So if
    // building the card drew from run.rng (the roast used to), the Mantle you
    // got would depend on whether you pressed TAB on the way there. Two
    // identical wins, one of which opens the card, must descend into the same
    // schematic offers and the same map. (SPEC3 rule 4.)
    {
      const mkWon = (seed) => {
        const r = S.newRun(defEffects(), seed);
        r.splits = []; r.startedAt = 0; r.depth = D.STRATA_COUNT;
        r.status = 'won'; r.breaches = D.STRATA_COUNT;
        r.result = { depth: D.STRATA_COUNT, breaches: D.STRATA_COUNT,
                     timeSec: 1200, cores: D.WIN_CORES, won: true };
        return r;
      };
      const sig = (r) => {
        let h = 0;
        for (let y = 0; y < D.MAP_H; y++) for (let x = 0; x < D.MAP_W; x++) {
          const t = r.grid[y][x];
          h = (Math.imul(h, 31) + (String(t.t || '').charCodeAt(0) || 0) +
               (t.ore ? String(t.ore).charCodeAt(0) : 0) + (t.oreAmt || 0)) | 0;
        }
        return h;
      };
      const descend = (r) => {
        S.continueIntoMantle(r);
        const offers = (r.pendingOffers || []).slice();
        S.applySchematic(r, offers[0]);
        return offers.join(',') + '#' + sig(r);
      };
      const plain = mkWon(90210);
      const read = mkWon(90210);
      const cardTxt = R.recapText({ run: read, ui: {}, meta: st.meta });
      assert(cardTxt.length > 0, 'the spectator run built a card');
      R.recapText({ run: read, ui: {}, meta: st.meta });   // and read it twice
      assertEq(descend(read), descend(plain),
        'opening the recap card does not change the Mantle (no rng feedback)');
    }

    assert(!drawn.some((s) => s.indexOf('RENDER ERROR') >= 0),
      'no render faults across the recap drive');
    return card.rows.length;
  } finally {
    delete global.window;
    delete global.document;
    delete global.location;
    delete global.requestAnimationFrame;
    delete global.localStorage;
    delete global.navigator;
  }
}

// =========================================================================
// SECTION 9 — js/fx.js frame advance (SPEC3 §A, tables A1 + A2)
// Every row of both tables is an acceptance criterion, so every row gets an
// assertion here: a state is CONSTRUCTED to make the row's "when" true, the
// renderer is advanced frame by frame on a stub canvas, and the cell buffer
// is read back through DC.Render.cellAt to prove the choreography landed on
// the right cell. The sim is only ever driven through its public API — FX
// itself must never write to run/ui, which the guards below also check.
// =========================================================================
// The SPEC3 §A rows that have landed, in table order. Every row named here
// must still fire under a constructed state or the section fails with its
// name — this is the regression net for the whole animation layer.
const FX_ROWS_A1 = [
  'extractor.mining', 'extractor.depleted', 'smelter.fire', 'smelter.cold',
  'assembler.spin', 'damper.breathe', 'hub.drill', 'hub.breachReady',
  'hub.distress', 'belt.march', 'belt.jam', 'belt.smear', 'magma.breathe',
  'magma.spark', 'crystal.glint', 'chasm.shimmer', 'rubble.jitter', 'dig.wipe',
  'reveal.front', 'cursor.laytail', 'grit.ember',
];
const FX_ROWS_A2 = [
  'quake.debris', 'collapse.dread', 'instability.border', 'breach.crack',
  'descent.interstitial', 'title.embers', 'foundry.sparks', 'victory.pulse',
  'gameover.motes', 'pause.smoke',
];

function fxSection(seed) {
  SECTION = 'fx seed=' + seed;
  require('../js/fx.js');
  require('../js/render.js');
  const FX = DC.FX, R = DC.Render;
  const covered = {};
  function row(id) { covered[id] = 1; }
  assert(FX && FX.begin && FX.tile && FX.frame, 'DC.FX exposes begin/tile/frame');
  assert(typeof R.cellAt === 'function', 'render exports the cellAt test surface');

  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function () {}, measureText: function () { return { width: 10 }; },
  };
  R.init({ style: {}, getContext: function () { return ctxStub; } });

  const run = S.newRun(defEffects(), seed);
  const st = {
    screen: 'run', meta: DC.Meta.newProfile(), run: run,
    ui: { tool: null, facing: 1, hover: null, cursor: { x: 0, y: 0 },
          dragging: false, dragLast: null, laying: false, paused: false,
          descendAnim: 0, shakeUntil: 0, flash: null },
  };
  const hx = run.hub.x, hy = run.hub.y;
  st.ui.cursor = { x: hx + 1, y: hy + 1 };

  function frames(n) { for (let i = 0; i < n; i++) R.frame(st); }
  // first placeable footprint near the hub — the 7x7 clearing is guaranteed
  // floor but procgen decides what else is free, so nothing is hardcoded
  function spot(type) {
    for (let y = hy - 5; y <= hy + 6; y++) {
      for (let x = hx - 5; x <= hx + 6; x++) {
        if (S.canPlace(run, type, x, y, 1).ok) return { x: x, y: y };
      }
    }
    return null;
  }
  function cell(x, y) { return R.cellAt(D.MAP_X + x, D.MAP_Y + y); }
  // distinct fg colors a cell takes across n frames (no sim ticks)
  function palette(x, y, n) {
    const seen = {};
    for (let i = 0; i < n; i++) { frames(1); seen[cell(x, y).fg] = 1; }
    return Object.keys(seen);
  }
  function glyphs(x, y, n) {
    const seen = {};
    for (let i = 0; i < n; i++) { frames(1); seen[cell(x, y).ch] = 1; }
    return Object.keys(seen);
  }
  // Same, but ticking the sim once per frame the way the engine loop does.
  // render's own '!' status blink is phased on run.t (not on the frame
  // clock), so a frames-only sample can sit inside one blink half forever.
  function glyphsLive(x, y, n) {
    const seen = {};
    for (let i = 0; i < n; i++) { S.tick(run); frames(1); seen[cell(x, y).ch] = 1; }
    return Object.keys(seen);
  }

  // Arriving in a stratum reveals a whole disc at once, so the reveal-front
  // row (below) sweeps the entire opening view. Let that settle before
  // measuring anything else.
  frames(2 * FX.FPS + 4);

  // ---- A1: belts (empty) — the arrow dim-pulse marches downstream --------
  const bx = hx - 2, by = hy + 2;            // inside the 7x7 hub clearing
  assert(S.place(run, 'belt', bx, by, 1), 'scaffold: belt placed east of the hub');
  frames(1);
  const beltCell = cell(bx, by);
  assertEq(beltCell.ch, D.ARROWS[1], 'empty belt still draws its travel arrow');
  // the ramp has 3 steps and the phase advances every 2 ticks: over 6 ticks a
  // fixed cell must show more than one brightness, or nothing is flowing
  const beltShades = {};
  for (let i = 0; i < 8; i++) { S.tick(run); S.tick(run); frames(1); beltShades[cell(bx, by).fg] = 1; }
  assert(Object.keys(beltShades).length >= 3,
    'empty belt arrow pulses through its 3-step brightness ramp (got ' +
    Object.keys(beltShades).length + ')');
  row('belt.march');

  // ---- A1: belt item jammed > 2s shivers ---------------------------------
  // a belt aimed into the hub's own wall of rock: nothing can accept the item
  const jx = hx - 3, jy = hy + 3;
  assert(S.place(run, 'belt', jx, jy, 3), 'scaffold: dead-end belt placed');
  run.grid[jy][jx].belt.item = 'ironPlate';   // scaffold: hand an item to the belt
  frames(1);
  const held0 = Object.keys(palette(jx, jy, 20));
  assertEq(held0.length, 1, 'a fresh item on a belt does not shiver yet');
  for (let i = 0; i < 2 * HZ + 2; i++) S.tick(run);
  assert(run.grid[jy][jx].belt.item === 'ironPlate', 'the jammed item really is stuck');
  const held1 = Object.keys(palette(jx, jy, 20));
  assertEq(held1.length, 2, 'a jam over 2s shivers between its color and dim');
  row('belt.jam');

  // ---- A1: belt item on move tick leaves a one-frame bright smear --------
  const sx = hx - 2, sy = hy - 2;
  assert(S.place(run, 'belt', sx, sy, 1), 'scaffold: smear belt A');
  assert(S.place(run, 'belt', sx + 1, sy, 1), 'scaffold: smear belt B');
  run.grid[sy][sx].belt.item = 'gear';
  frames(1);                                  // FX snapshots the item at A
  while (run.grid[sy][sx].belt.item) S.tick(run);
  assertEq(run.grid[sy][sx + 1].belt.item, 'gear', 'the item advanced one belt');
  frames(1);
  const smear = cell(sx, sy);
  assertEq(smear.ch, D.ITEMS.gear.glyph, 'the departed cell draws the item glyph');
  assert(smear.fg !== D.ITEMS.gear.color, 'the smear is brighter than the item');
  frames(1);
  assertEq(cell(sx, sy).ch, D.ARROWS[1], 'the smear lasts exactly one frame');
  row('belt.smear');

  // ---- A1: extractor — the piston stroke, the spit, the dead pump --------
  // any revealed vein on the map — how far the procgen put it from the hub is
  // not this test's business
  let ore = null;
  for (let y = 1; y < D.MAP_H - 1 && !ore; y++) {
    for (let x = 1; x < D.MAP_W - 1 && !ore; x++) {
      const t = run.grid[y][x];
      if (t.revealed && t.ore && t.oreAmt > 0 && t.machine === null && !t.belt &&
          t.t === 'floor') ore = { x: x, y: y };
    }
  }
  assert(ore, 'scaffold: a revealed ore tile to mine');
  run.inv.ironPlate += 40;                    // scaffold: pay for the test rig
  assert(S.place(run, 'extractor', ore.x, ore.y, 1), 'scaffold: extractor on the vein');
  S.tick(run);
  const exM = run.machines[run.grid[ore.y][ore.x].machine];
  assertEq(exM.status, 'ok', 'the extractor is actively mining');
  const pump = glyphs(ore.x, ore.y, 40);
  assert(pump.indexOf('E') >= 0 && pump.indexOf('╪') >= 0 && pump.indexOf('╫') >= 0,
    'a mining extractor cycles E ╪ E ╫ (got ' + pump.join('') + ')');
  row('extractor.mining');

  // the spit: a belt on the output tile shows the fresh ore bright-white
  const ot = { x: ore.x + 1, y: ore.y };
  if (run.grid[ot.y][ot.x].t === 'floor' && run.grid[ot.y][ot.x].machine === null) {
    assert(S.place(run, 'belt', ot.x, ot.y, 1), 'scaffold: belt on the output tile');
    let spat = false;
    for (let i = 0; i < 6 * HZ && !spat; i++) {
      S.tick(run); frames(1);
      const c = cell(ot.x, ot.y);
      if (c.ch === D.ORE_GLYPHS[run.grid[ore.y][ore.x].ore].glyph || c.ch === '•') {
        if (c.fg === D.COLORS.white) spat = true;
      }
    }
    assert(spat, 'each ore produced renders bright-white on the output tile');
  }

  run.grid[ore.y][ore.x].oreAmt = 0;          // scaffold: work the vein out
  S.tick(run);
  assertEq(exM.status, 'depleted', 'the vein is depleted');
  // a 1x1's status '!' lands on the anchor itself, so this cell alternates
  // between render's marker and the decaying pump — both must be present
  const dead = glyphsLive(ore.x, ore.y, 40);
  assert(dead.indexOf('×') >= 0, 'a depleted extractor shows × on alternate phases (got ' +
    dead.join('') + ')');
  assert(dead.indexOf('!') >= 0, "the depleted '!' marker still gets its half of the blink");
  frames(1);
  assert(cell(ore.x, ore.y).fg !== D.COLORS.amber, 'the dead pump decays out of amber');
  row('extractor.depleted');

  // ---- A1: smelter — the furnace breathes fire, goes cold without coal ----
  const smSpot = spot('smelter');
  assert(smSpot, 'scaffold: a free 2x2 for the smelter');
  const smx = smSpot.x, smy = smSpot.y;
  assert(S.place(run, 'smelter', smx, smy, 1), 'scaffold: smelter placed');
  const sm = run.machines[run.grid[smy][smx].machine];
  sm.input.ironOre = 4; sm.input.coal = 2;    // scaffold: feed it by hand
  S.tick(run);
  assert(sm.job, 'the smelter is crafting');
  const fire = glyphs(smx, smy + 1, 30);
  assert(fire.indexOf('▓') >= 0 && fire.indexOf('▒') >= 0 && fire.indexOf('░') >= 0,
    'a fueled smelter breathes ▓▒░ (got ' + fire.join('') + ')');
  const emberCols = palette(smx, smy + 1, 30);
  assert(emberCols.indexOf(D.COLORS.magma) >= 0 && emberCols.indexOf(D.COLORS.orange) >= 0 &&
    emberCols.indexOf(D.COLORS.amber) >= 0, 'the fire rolls magma -> orange -> amber');
  frames(1);
  assert(cell(smx, smy).ch === D.BUILDINGS.smelter.letter, 'the S anchor stays steady');
  assert(cell(smx + 1, smy).ch !== cell(smx, smy + 1).ch ||
    cell(smx + 1, smy).fg !== cell(smx, smy + 1).fg,
    'fire cells are phase-offset from each other');
  row('smelter.fire');

  sm.job = null; sm.progress = 0;             // scaffold: starve it of coal
  sm.input.coal = 0; sm.fuel = 0; sm.input.ironOre = 2;
  S.tick(run);
  assertEq(sm.status, 'nofuel', 'the smelter is out of coal');
  frames(1);
  assertEq(cell(smx, smy + 1).ch, '░', 'a cold smelter shows ░');
  assertEq(cell(smx, smy + 1).fg, D.COLORS.darkgray, 'a cold smelter is darkgray');
  const bang = glyphsLive(smx + 1, smy, 20);
  assert(bang.indexOf('!') >= 0, "the existing '!' blink stays on top of the cold fire");
  row('smelter.cold');

  // ---- A1: assembler — meshed gears, and a spin on the recipe switch ------
  const asSpot = spot('assembler');
  assert(asSpot, 'scaffold: a free 2x2 for the assembler');
  const ax = asSpot.x, ay = asSpot.y;
  assert(S.place(run, 'assembler', ax, ay, 1), 'scaffold: assembler placed');
  const asm = run.machines[run.grid[ay][ax].machine];
  asm.input.ironPlate = 4;                    // scaffold: feed it by hand
  S.tick(run);
  assert(asm.job, 'the assembler is crafting');
  const gears = glyphs(ax + 1, ay, 30);
  assert(gears.indexOf('¤') >= 0 && gears.indexOf('☼') >= 0,
    'a crafting assembler spins ¤ ☼ (got ' + gears.join('') + ')');
  const r0 = asm.recipe;
  S.clickTile(run, ax, ay);
  assert(asm.recipe !== r0, 'scaffold: the recipe switched');
  frames(1);
  assertEq(cell(ax + 1, ay).fg, D.COLORS.white,
    'a recipe switch acknowledges with one bright full-speed spin');
  frames(FX.FPS);
  assert(cell(ax + 1, ay).fg !== D.COLORS.white, 'the acknowledgment spin ends');
  row('assembler.spin');

  // ---- A1: damper — a calm green heartbeat, flat when unfueled ------------
  run.inv.copperPlate = (run.inv.copperPlate || 0) + 4;   // scaffold: afford it
  const dSpot = spot('damper');
  assert(dSpot, 'scaffold: a free tile for the damper');
  const dx2 = dSpot.x, dy2 = dSpot.y;
  assert(S.place(run, 'damper', dx2, dy2, 1), 'scaffold: damper placed');
  const dmp = run.machines[run.grid[dy2][dx2].machine];
  S.tick(run);
  assertEq(dmp.status, 'nofuel', 'an unfed damper reads nofuel');
  const flat = {};
  for (let i = 0; i < 40; i++) {
    S.tick(run); frames(1);                   // tick: render's '!' is run.t-phased
    const c = cell(dx2, dy2);
    if (c.ch !== '!') flat[c.fg] = 1;
  }
  assertEq(Object.keys(flat).length, 1, 'an unfueled damper sits at one flat dim color');
  dmp.input.coal = 2;                         // scaffold: hand it a lump of coal
  S.tick(run);
  assert(dmp.fuel > 0, 'the damper is burning');
  assert(palette(dx2, dy2, 90).length >= 5,
    'a fueled damper breathes green on a slow sine');
  row('damper.breathe');

  // ---- A1: the hub — marching ants, the breach invite, distress ----------
  run.inv.gear = (run.inv.gear || 0) + 12;    // scaffold: keep the drill fed
  frames(1);
  assert(FX.mem().drillActive, 'the drill is consuming');
  function edgeChanges(n) {                   // color changes on one border cell
    let last = null, changes = 0;
    for (let i = 0; i < n; i++) {
      frames(1);
      const c = cell(hx, hy).fg;
      if (last !== null && c !== last) changes++;
      last = c;
    }
    return changes;
  }
  const slow = edgeChanges(96);               // 96 frames = 2 full ant laps
  assert(slow >= 5, 'the hub border runs a marching-ants wave while feeding (' +
    slow + ' changes)');
  S.toggleOverdrive(run);
  assert(run.overdrive, 'scaffold: overdrive engaged');
  const fast = edgeChanges(96);
  assert(fast >= slow * 2 - 1, 'the wave runs twice as fast on overdrive (' + slow +
    ' -> ' + fast + ')');
  S.toggleOverdrive(run);
  row('hub.drill');

  // The D pulses white on the tick the drill actually feeds. Sampled only on
  // feed ticks whose run.t phase is 0 — that is a frame where render's own
  // drill-active blink draws amber, so a white D can only be the FX pulse.
  let pulsed = false, sampled = false;
  for (let i = 0; i < 4 * D.DRILL_PERIOD && !pulsed; i++) {
    S.tick(run);
    const fd = run._feed;
    const fed = fd.length && fd[fd.length - 1].t === run.t;
    frames(1);
    if (fed && Math.floor(run.t / 4) % 2 === 0) {
      sampled = true;
      if (cell(hx + 1, hy + 1).fg === D.COLORS.white) pulsed = true;
    }
  }
  assert(sampled, 'scaffold: the drill fed at least once off render\'s blink phase');
  assert(pulsed, 'the D pulses white on a feed tick');

  const st0 = run.status;
  run.status = 'breachReady';                 // scaffold: skip the whole economy
  frames(1);
  assertEq(cell(hx, hy + 2).ch, '▼', 'breachReady sweeps ▼ along the hub bottom row');
  assertEq(cell(hx + 2, hy + 2).ch, '▼', 'all three bottom cells invite the D key');
  assert(palette(hx, hy, 60).length >= 4, 'the whole 3x3 pulses in the stratum accent');
  run.status = st0;
  row('hub.breachReady');

  const integ0 = run.integrity;
  run.integrity = 12;                         // scaffold: a rig about to fail
  const panic = palette(hx + 1, hy, 40);
  assert(panic.length >= 4, 'the border flickers erratically under 25 integrity');
  assert(panic.every(function (c) { return c !== D.COLORS.amber; }),
    'a distressed border is red, never the amber wave');
  run.integrity = integ0;
  row('hub.distress');

  // ---- A1: the world — magma, crystal, chasm, rubble, digs, the front ----
  // a bare revealed floor tile, well clear of everything built so far
  function bareFloor(n) {
    const found = [];
    for (let y = 1; y < D.MAP_H - 1 && found.length < n; y++) {
      for (let x = 1; x < D.MAP_W - 1 && found.length < n; x++) {
        const t = run.grid[y][x];
        if (t.revealed && t.t === 'floor' && !t.ore && !t.rubble && !t.belt &&
            t.machine === null && t.digT === 0) found.push({ x: x, y: y });
      }
    }
    return found;
  }
  const bare = bareFloor(8);
  assert(bare.length >= 6, 'scaffold: bare floor tiles to dress');

  const mg = bare[0], mg2 = bare[1];
  run.grid[mg.y][mg.x].t = 'magma';            // scaffold: pour magma
  run.grid[mg2.y][mg2.x].t = 'magma';
  const mgch = glyphs(mg.x, mg.y, 40);
  assert(mgch.indexOf('≈') >= 0 && mgch.indexOf('~') >= 0,
    'magma swaps ≈ / ~ (got ' + mgch.join('') + ')');
  assert(palette(mg.x, mg.y, 40).length >= 3, 'magma cycles 3 ember colors');
  let offset = false;
  for (let i = 0; i < 20 && !offset; i++) {
    frames(1);
    if (cell(mg.x, mg.y).ch !== cell(mg2.x, mg2.y).ch ||
        cell(mg.x, mg.y).fg !== cell(mg2.x, mg2.y).fg) offset = true;
  }
  assert(offset, 'each magma tile carries its own (x*7+y*13)%3 phase');
  row('magma.breathe');

  // magma burning a machine: a one-tick spark on the contact edge
  run.magmaCap = 40;                           // scaffold: enable the burn pass
  const burn = { x: smx, y: smy + 2 };         // directly under the smelter
  if (run.grid[burn.y] && run.grid[burn.y][burn.x] &&
      run.grid[burn.y][burn.x].machine === null) {
    run.grid[burn.y][burn.x].t = 'magma';      // scaffold: magma at the wall
    let sparked = false;
    for (let i = 0; i < D.MAGMA.burnPeriod * 2 && !sparked; i++) {
      S.tick(run); frames(1);
      if (cell(smx, smy + 1).ch === '*' || cell(smx + 1, smy + 1).ch === '*') sparked = true;
    }
    assert(sparked, 'magma damaging a machine flashes * at the contact edge');
    row('magma.spark');
    run.grid[burn.y][burn.x].t = 'floor';      // scaffold: put the fire out
  }

  const cr = bare[2];
  run.grid[cr.y][cr.x].ore = 'crystal';        // scaffold: seed a crystal vein
  run.grid[cr.y][cr.x].oreAmt = 60;
  let glinted = false;
  for (let i = 0; i < 5 * FX.FPS && !glinted; i++) {
    frames(1);
    if (cell(cr.x, cr.y).fg === D.COLORS.white) glinted = true;
  }
  assert(glinted, 'a visible crystal glints white about every 4s');
  row('crystal.glint');

  const chm = bare[3];
  run.grid[chm.y][chm.x].t = 'chasm';           // scaffold: open a chasm
  assertEq(palette(chm.x, chm.y, 90).length, 2, 'a chasm shimmers dim/dimmer');
  row('chasm.shimmer');

  const rb = bare[4];
  run.grid[rb.y][rb.x].rubble = true;           // scaffold: drop debris
  const jit = glyphs(rb.x, rb.y, 60);
  assert(jit.indexOf('%') >= 0 && jit.indexOf(D.RUBBLE_GLYPH) >= 0,
    'fresh rubble jitters ☼ / % (got ' + jit.join('') + ')');
  frames(2 * FX.FPS);
  assertEq(glyphs(rb.x, rb.y, 20).join(''), D.RUBBLE_GLYPH, 'then it settles still');
  row('rubble.jitter');

  // a dig wipes ▓▒░· as digT runs down
  let rock = null;
  for (let y = 1; y < D.MAP_H - 1 && !rock; y++) {
    for (let x = 1; x < D.MAP_W - 1 && !rock; x++) {
      const t = run.grid[y][x];
      if (t.revealed && t.t === 'rock' && t.digT === 0) rock = { x: x, y: y };
    }
  }
  assert(rock, 'scaffold: a revealed rock tile to excavate');
  assert(S.demolishAt(run, rock.x, rock.y).ok, 'scaffold: excavation started');
  const wipe = {};
  while (run.grid[rock.y][rock.x].digT > 0) { S.tick(run); frames(1); wipe[cell(rock.x, rock.y).ch] = 1; }
  const wipeSeen = Object.keys(wipe);
  assert(wipeSeen.length >= 3 && wipeSeen.every(function (c) { return '▓▒░·'.indexOf(c) >= 0; }),
    'the dig wipes ▓▒░· in proportion to digT (got ' + wipeSeen.join('') + ')');
  row('dig.wipe');

  // the reveal front: a tile entering scan pulses '·', then holds brighter
  let dark = null;
  for (let y = 1; y < D.MAP_H - 1 && !dark; y++) {
    for (let x = 1; x < D.MAP_W - 1 && !dark; x++) if (!run.grid[y][x].revealed) dark = { x: x, y: y };
  }
  assert(dark, 'scaffold: an unrevealed tile');
  run.grid[dark.y][dark.x].revealed = true;     // scaffold: the scan reaches it
  frames(1);
  assertEq(cell(dark.x, dark.y).ch, '·', 'the newest reveal ring pulses ·');
  frames(12);
  const lit = cell(dark.x, dark.y);
  frames(2 * FX.FPS);
  const settled = cell(dark.x, dark.y);
  assert(lit.fg !== settled.fg, 'the newest ring holds one shade brighter for 2s');
  row('reveal.front');

  // ---- A1: the lay-mode comet tail ---------------------------------------
  const lay = bareFloor(30).filter(function (p) { return p.y === bare[5].y; }).slice(0, 4);
  if (lay.length >= 3) {
    st.ui.laying = true;
    st.ui.tool = 'belt';
    frames(1);                                  // FX snapshots the belt layer
    for (let i = 0; i < 3; i++) assert(S.place(run, 'belt', lay[i].x, lay[i].y, 1),
      'scaffold: gesture belt ' + i);
    frames(1);
    const t0c = cell(lay[2].x, lay[2].y).fg, t2c = cell(lay[0].x, lay[0].y).fg;
    assert(t0c !== t2c, 'the comet tail fades from the newest belt back');
    st.ui.laying = false;
    st.ui.tool = null;
    frames(1);
    assert(cell(lay[2].x, lay[2].y).fg !== t0c, 'the tail clears when the gesture ends');
    row('cursor.laytail');
  }

  // ---- A1: GRIT's cigarette ember ----------------------------------------
  run.foreman = { text: 'Line looks like my ex: backed up and expensive.',
                  t0: run.totalT, until: run.totalT + 7 * HZ };   // scaffold
  frames(1);
  assertEq(R.cellAt(6, 31).ch, '°', "an ember burns after GRIT's tag while he talks");
  function emberChanges(n) {
    let last = null, ch = 0;
    for (let i = 0; i < n; i++) {
      frames(1);
      const c = R.cellAt(6, 31).fg;
      if (last !== null && c !== last) ch++;
      last = c;
    }
    return ch;
  }
  const calm = emberChanges(60);
  const st1 = run.status;
  run.status = 'breachReady';                   // scaffold: a priority moment
  const agitated = emberChanges(60);
  assert(agitated > calm, 'the ember flickers faster on priority barks (' + calm +
    ' -> ' + agitated + ')');
  run.status = st1;
  run.foreman = null;
  frames(1);
  assert(R.cellAt(6, 31).ch !== '°', 'the ember goes out when the bar clears');
  row('grit.ember');

  // ---- A2: the quake — debris rains through the map box ------------------
  function countCh(chars, x0, y0, w, h) {
    let n = 0;
    for (let r = y0; r < y0 + h; r++) {
      for (let c = x0; c < x0 + w; c++) {
        const cc = R.cellAt(c, r);
        if (cc && chars.indexOf(cc.ch) >= 0) n++;
      }
    }
    return n;
  }
  // the engine drains run.events before render ever sees them, so the signal
  // that survives is ui.shakeUntil rising — drive it exactly as afterTick does
  st.ui.shakeUntil = run.t + 4;
  frames(1);
  let debris = 0;
  for (let i = 0; i < 3 * (FX.FPS / HZ); i++) {
    frames(1);
    debris = Math.max(debris, countCh(".'", D.MAP_X, D.MAP_Y, D.MAP_W, D.MAP_H) );
  }
  assert(debris >= 6, 'a quake rains debris through the map box (peak ' + debris + ')');
  frames(3 * (FX.FPS / HZ) + 4);
  st.ui.shakeUntil = 0;
  row('quake.debris');

  // the same moment seen only through a peeked (never drained) event queue
  S.tick(run);                                // a fresh tick to dedupe against
  const evLen = run.events.length;
  run.events.push({ type: 'quake', t: run.totalT, data: { dmg: 5 } });
  frames(2);
  assert(countCh(".'", D.MAP_X, D.MAP_Y, D.MAP_W, D.MAP_H) >= 6,
    'a quake event in the queue rains debris too');
  assertEq(run.events.length, evLen + 1,
    'FX peeked run.events and left every entry for the engine to drain');
  frames(3 * (FX.FPS / HZ) + 4);

  // ---- A2: pre-collapse dread — the lights flicker before the hit --------
  const inst0 = run.instability, qa0 = run.quakeAt;
  run.instability = 99.5;                     // scaffold: terminal instability
  run.quakeAt = run.t + 6;                    // scaffold: a scheduled collapse
  frames(1);
  const bright = cell(hx, hy + 4).fg;
  run.quakeAt = run.t + 1;                    // scaffold: 1 tick out
  frames(1);
  const dimmed = cell(hx, hy + 4).fg;
  assert(bright !== dimmed, 'the map dims one step in the 2 ticks before a collapse');
  row('collapse.dread');

  // ---- A2: the map border breathes red over 80 instability ---------------
  run.quakeAt = qa0;
  run.instability = 85;                       // scaffold
  const borderCols = {};
  for (let i = 0; i < 90; i++) { frames(1); borderCols[R.cellAt(24, 2).fg] = 1; }
  assert(Object.keys(borderCols).length >= 4,
    'the map border breathes red at high instability');
  run.instability = inst0;
  frames(1);
  row('instability.border');

  // ---- A2: the breach crack radiates from the hub ------------------------
  st.screen = 'descend';
  st.ui.descendAnim = 0;
  frames(2);
  const cracked = countCh('/\\─│', hx - 6 + D.MAP_X, hy - 6 + D.MAP_Y, 13, 13);
  assert(cracked >= 8, 'pressing D cracks white glass out from the hub (' + cracked + ')');
  frames(6 * (FX.FPS / HZ) + 2);
  assert(countCh('/\\', 0, 0, D.COLS, D.ROWS) === 0, 'the crack clears into the descent');
  st.screen = 'run';
  frames(1);
  row('breach.crack');

  // ---- A2: the descent interstitial — name types, odometer rolls ---------
  st.screen = 'descend';
  st.ui.descendAnim = 0;
  run.pendingOffers = null;                   // scaffold: hold on the animation
  frames(2);
  const nameRow = function () {
    let s = '';
    for (let c = 0; c < D.COLS; c++) s += R.cellAt(c, 4).ch;
    return s.replace(/\s+$/, '').replace(/^\s+/, '');
  };
  const early = nameRow();
  frames(40);
  const later = nameRow();
  assert(later.length > early.length, 'the stratum name typewriters in (' +
    early.length + ' -> ' + later.length + ' chars)');
  assert(later.indexOf('STRATUM ' + (run.depth + 1)) >= 0,
    'and it names the stratum it is taking you to (' + later + ')');
  // the odometer: digits roll before they settle
  const depthRow = function () {
    for (let r = 0; r < D.ROWS; r++) {
      let s = '';
      for (let c = 0; c < D.COLS; c++) s += R.cellAt(c, r).ch;
      if (s.indexOf('DEPTH -') >= 0) return s.trim();
    }
    return '';
  };
  const spun = {};
  for (let i = 0; i < 40; i++) { frames(1); spun[depthRow()] = 1; }
  assert(Object.keys(spun).length >= 3, 'the depth odometer spins its digits');
  st.ui.descendAnim = 10000;                  // scaffold: run the animation out
  frames(2);
  const settledRow = depthRow();
  assert(settledRow.indexOf('-' + (run.depth + 1) * D.DEPTH_M + 'm') >= 0,
    'the odometer settles on the depth you are arriving at (' + settledRow + ')');
  row('descent.interstitial');
  st.screen = 'run';
  st.ui.descendAnim = 0;
  frames(1);

  // ---- A2: the title screen — embers, drill churn, breathing ENTER -------
  st.screen = 'title';
  frames(1);
  const T = R.layout.title;
  assert(T && T.enter, 'render publishes the title layout for fx');
  const logo = {};
  for (let r = 1; r <= 5; r++) for (let c = 0; c < D.COLS; c++) {
    const cc = R.cellAt(c, r);
    if (cc.ch !== ' ') logo[cc.fg] = 1;
  }
  assert(Object.keys(logo).length >= 3, 'the logo keeps its 3-tone sweep');
  const motes0 = countCh(".·", 0, 20, D.COLS, 12);
  frames(240);
  let motesPeak = 0;
  for (let i = 0; i < 60; i++) { frames(1); motesPeak = Math.max(motesPeak, countCh(".·", 0, 12, D.COLS, 18)); }
  assert(motesPeak > motes0, 'embers rise behind the rig (' + motes0 + ' -> ' + motesPeak + ')');
  if (T.rig) {
    let churn = null;
    for (let r = 8; r < T.rig.h && !churn; r++) {
      for (let c = 0; c < T.rig.w && !churn; c++) {
        if (R.cellAt(T.rig.x + c, T.rig.y + r).ch === '║' ||
            R.cellAt(T.rig.x + c, T.rig.y + r).ch === '╫') churn = { c: T.rig.x + c, r: T.rig.y + r };
      }
    }
    assert(churn, 'scaffold: the drill string is on screen');
    const churned = {};
    for (let i = 0; i < 40; i++) { frames(1); churned[R.cellAt(churn.c, churn.r).ch] = 1; }
    assert(churned['║'] && churned['╫'], 'the drill string idles on a 2-frame churn');
  }
  const enterCols = {};
  for (let i = 0; i < 120; i++) { frames(1); enterCols[R.cellAt(T.enter.col, T.enter.row).fg] = 1; }
  assert(Object.keys(enterCols).length >= 4, 'PRESS ENTER breathes');
  row('title.embers');
  st.screen = 'run';
  frames(1);

  // ---- A2: the foundry spark burst ---------------------------------------
  st.screen = 'foundry';
  st.meta.cores = 20;
  frames(2);
  const sparks0 = countCh("*'", 0, 8, 32, 18);
  st.ui.flashPart = { id: 'm_hull', until: 0 };   // exactly what the engine sets
  let sparks1 = 0;
  for (let i = 0; i < 40; i++) { frames(1); sparks1 = Math.max(sparks1, countCh("*'", 0, 8, 32, 18)); }
  assert(sparks1 > sparks0, 'a purchase throws sparks around the bolted part (' +
    sparks0 + ' -> ' + sparks1 + ')');
  frames(2 * FX.FPS);
  assertEq(countCh("*'", 0, 8, 32, 18), sparks0, 'the sparks burn out');
  st.ui.flashPart = null;
  row('foundry.sparks');

  // ---- A2: victory — the core pulses, the toast rings --------------------
  run.result = { depth: 8, breaches: 8, timeSec: 900, cores: 18, won: true };
  st.screen = 'victory';
  frames(1);
  const A = R.layout.artBlock;
  assert(A && A.h > 6, 'render publishes the victory art block for fx');
  function coreRow() {
    const seen = {};
    for (let c = 0; c < D.COLS; c++) {
      const cc = R.cellAt(c, A.row + (A.h >> 1));
      if (cc.ch !== ' ') seen[cc.fg] = 1;
    }
    return Object.keys(seen);
  }
  assert(coreRow().length >= 2, 'the core sphere shades by distance');
  // one cell of the sphere must travel the shading ramp: the shading function
  // now takes a phase, so a fixed cell changes color over time
  const midRow = A.row + (A.h >> 1);
  let probe = -1;
  for (let c = 20; c < 60 && probe < 0; c++) if (R.cellAt(c, midRow).ch !== ' ') probe = c;
  assert(probe >= 0, 'scaffold: a sphere cell to watch');
  const corePhases = {};
  for (let i = 0; i < 120; i++) { frames(1); corePhases[R.cellAt(probe, midRow).fg] = 1; }
  assert(Object.keys(corePhases).length >= 2, 'and the shading pulses on a phase');
  // GRIT's toast types at 14 chars/s, so the ring is a few hundred frames out
  let ringed = false;
  for (let i = 0; i < 600 && !ringed; i++) {
    frames(1);
    let whites = 0;
    for (let r = A.row; r < A.row + A.h; r++) {
      for (let c = 0; c < D.COLS; c++) if (R.cellAt(c, r).fg === D.COLORS.white) whites++;
    }
    if (whites >= 6) ringed = true;
  }
  assert(ringed, 'the finished toast sends one bright ring through the sphere');
  row('victory.pulse');

  // ---- A2: gameover — dust motes and a slow epitaph ----------------------
  run.result = { depth: 4, breaches: 3, timeSec: 400, cores: 3, won: false };
  st.screen = 'gameover';
  frames(2);
  const dust0 = countCh('·', 0, 1, D.COLS, 20);
  let dust1 = 0;
  for (let i = 0; i < 300; i++) { frames(1); dust1 = Math.max(dust1, countCh('·', 0, 1, D.COLS, 20)); }
  assert(dust1 > dust0, 'dust motes drift down over the collapsed rig (' +
    dust0 + ' -> ' + dust1 + ')');
  row('gameover.motes');

  // ---- A2: GRIT's smoke break --------------------------------------------
  st.screen = 'run';
  st.ui.paused = true;
  frames(2);
  assertEq(countCh('░', 0, 24, 24, 9), 0, 'no smoke in the first seconds of a pause');
  frames(31 * FX.FPS);
  const smoke1 = countCh('░', 0, 20, 26, 13);
  assert(smoke1 >= 1, 'after 30s paused, smoke curls in from the corner');
  frames(20 * FX.FPS);
  const smoke2 = countCh('░', 0, 20, 26, 13);
  assert(smoke2 > smoke1, 'and it keeps curling, a cell at a time (' + smoke1 +
    ' -> ' + smoke2 + ')');
  st.ui.paused = false;
  frames(2);
  assertEq(countCh('░', 0, 20, 26, 13), 0, 'un-pausing clears the smoke');
  row('pause.smoke');

  // ---- the hard constraint: FX never writes back into the sim ------------
  st.screen = 'run';
  st.ui.paused = false;
  frames(1);
  // determinism: the animation layer owns a private PRNG, so a frame must
  // never draw a number out of run.rng (that would make what the player sees
  // change what the run does)
  const realRng = run.rng;
  let rngCalls = 0;
  run.rng = function () { rngCalls++; return realRng(); };
  frames(90);
  run.rng = realRng;
  assertEq(rngCalls, 0, 'FX drew ' + rngCalls + ' numbers from run.rng (must be 0)');

  const before = JSON.stringify({
    t: run.t, totalT: run.totalT, inst: run.instability, integ: run.integrity,
    quakeAt: run.quakeAt, status: run.status, ev: run.events.length,
  });
  frames(120);
  assertEq(JSON.stringify({
    t: run.t, totalT: run.totalT, inst: run.instability, integ: run.integrity,
    quakeAt: run.quakeAt, status: run.status, ev: run.events.length,
  }), before, 'advancing 120 FX frames changed nothing in the run');
  assert(FX.clock() > 0, 'the FX frame clock advanced');

  // SPEC3 §A has 21 rows in table A1 and 10 in table A2, and every one of
  // them is an acceptance criterion — pin the counts so a row cannot quietly
  // drop out of the list instead of being fixed.
  assertEq(FX_ROWS_A1.length, 21, 'table A1 has 21 rows');
  assertEq(FX_ROWS_A2.length, 10, 'table A2 has 10 rows');
  const all = FX_ROWS_A1.concat(FX_ROWS_A2);
  const missing = all.filter(function (id) { return !covered[id]; });
  assert(missing.length === 0, 'SPEC3 §A rows with no frame-advance proof: ' +
    missing.join(', '));
  return all.length;
}

// =========================================================================
// SECTION 10 — the animation clock is wall time, not a callback count
// (M-HIRES Phase 0). engine.js's loop is not throttled, so a 144 Hz monitor
// hands the renderer 2.4x the callbacks a 60 Hz one does; a clock that
// counted callbacks ran every frame-measured animation 2.4x too fast there.
// Drive the SAME four wall seconds at both rates and require the same number
// of animation cycles out the other end. The probe is the gameover prompt's
// 1 Hz blink — render's own clock — and fx.js's clock is read alongside it,
// since every §A phase is a pure function of that clock.
// =========================================================================
function clockSection(seed) {
  SECTION = 'clock';
  const FX = DC.FX, R = DC.Render;
  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function () {}, measureText: function () { return { width: 10 }; },
  };
  R.init({ style: {}, getContext: function () { return ctxStub; } });

  const run = S.newRun(defEffects(), seed);
  run.result = { depth: 3, breaches: 2, timeSec: 300, cores: 4, won: false };
  const st = {
    screen: 'gameover', meta: DC.Meta.newProfile(), run: run,
    ui: { tool: null, facing: 1, hover: null, cursor: { x: 0, y: 0 },
          dragging: false, dragLast: null, laying: false, paused: false,
          descendAnim: 0, shakeUntil: 0, flash: null },
  };

  // A cell of the blinking prompt on the bottom row, found rather than
  // hardcoded so a copy edit cannot silently make this test vacuous.
  R.frame(st);
  let probe = -1;
  for (let c = 0; c < D.COLS && probe < 0; c++) if (R.cellAt(c, 31).ch !== ' ') probe = c;
  assert(probe >= 0, 'scaffold: the gameover prompt is on the bottom row');

  let now = 5e6;                     // monotonic across both runs: the clocks
  function drive(spanMs, fps) {      // keep their `lastNow` between calls
    const step = 1000 / fps;
    const n = Math.round(spanMs / step);
    const f0 = FX.clock(), m0 = FX.ms();
    let flips = 0, prev = R.cellAt(probe, 31).fg;
    for (let i = 0; i < n; i++) {
      now += step;
      R.frame(st, now);
      const col = R.cellAt(probe, 31).fg;
      if (col !== prev) flips++;
      prev = col;
    }
    return { calls: n, frames: FX.clock() - f0, ms: FX.ms() - m0, flips: flips };
  }

  const at60 = drive(4000, 60);
  const at144 = drive(4000, 144);

  // The check is not vacuous: the high-refresh run really did deliver 2.4x
  // the callbacks for the same four seconds.
  assertEq(at60.calls, 240, '4 s at 60 fps is 240 callbacks');
  assertEq(at144.calls, 576, '4 s at 144 fps is 576 callbacks');
  assert(Math.abs(at60.ms - 4000) < 20 && Math.abs(at144.ms - 4000) < 20,
    'the fx clock tracks wall time at both rates (' +
    Math.round(at60.ms) + ' / ' + Math.round(at144.ms) + ' ms)');
  assert(Math.abs(at60.frames - 240) <= 2 && Math.abs(at144.frames - 240) <= 2,
    'four wall seconds is 240 virtual frames at both rates (' +
    at60.frames + ' / ' + at144.frames + ')');
  assert(at60.flips >= 6, 'scaffold: the prompt really blinks (' + at60.flips + ' flips)');
  assert(Math.abs(at60.flips - at144.flips) <= 1,
    'the blink completes the same cycles per wall second at 60 and 144 fps (' +
    at60.flips + ' vs ' + at144.flips + ')');
  // and the bug this replaces would have failed it: counting callbacks would
  // have run the 144 fps pass 2.4x through the same wall time.
  assert(at144.flips * 2 < at144.calls / 30,
    'scaffold: a callback-counting clock would have blinked far more often');
  return at60.flips;
}

// =========================================================================
// SECTION 11 — the grid fills the viewport and clicks still land
// (M-HIRES Phase 1). render.js used to set a CSS pixel size once on load, so
// the game was a fixed 800x627 island on any real monitor. Now one scalar
// scales both axes. The three things that can break are all asserted here at
// every viewport size:
//   1. pxToCell round-trips — EVERY cell, not a spot check. The map is
//      clickable and a half-cell error is a mis-placed belt.
//   2. `adv` is re-measured. It is cached from measureText at the old font
//      size; flush() divides a whole batched run by it, so a stale value
//      slides every character in the run out of its cell.
//   3. The aspect never distorts.
// The stub below is deliberately harsher than a browser: measureText returns
// a width proportional to the font size (DejaVu Sans Mono's real 0.602 em
// advance), so a stale `adv` is arithmetically visible rather than a matter
// of taste, and getBoundingClientRect reports what resize() actually wrote to
// the style — the same coupling the real page has.
// =========================================================================
const ADV_EM = 0.602;                      // DejaVu Sans Mono advance / em

function scalingSection() {
  SECTION = 'scaling';
  const R = DC.Render;
  const BASE_W = R.CW * D.COLS, BASE_H = R.CH * D.ROWS;

  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function () {},
    measureText: function () { return { width: parseFloat(this.font) * ADV_EM }; },
  };
  let origin = { left: 0, top: 0 };
  const canvasStub = {
    width: 0, height: 0, style: {},
    getContext: function () { return ctxStub; },
    addEventListener: function () {},
    getBoundingClientRect: function () {
      return {
        left: origin.left, top: origin.top,
        width: parseFloat(this.style.width) || 0,
        height: parseFloat(this.style.height) || 0,
      };
    },
  };
  global.devicePixelRatio = 1;
  R.init(canvasStub);

  const VIEWPORTS = [
    { w: 1280, h: 720,  name: 'laptop 1280x720' },
    { w: 1920, h: 1080, name: 'desktop 1920x1080' },
    { w: 3840, h: 2160, name: '4K 3840x2160' },
    { w: 600,  h: 800,  name: 'phone 600x800' },
  ];
  const scales = {};
  for (const v of VIEWPORTS) {
    const s = R.resize(v.w, v.h);
    const m = R.metrics();
    scales[v.name] = s;

    // --- aspect and fit -------------------------------------------------
    assert(Math.abs(m.width / m.height - BASE_W / BASE_H) < 1e-9,
      v.name + ': the 80x33 aspect survives scaling (' + m.width + 'x' + m.height + ')');
    assertEq(m.cw / m.ch, R.CW / R.CH, v.name + ': the cell keeps its shape');
    assert(s >= R.MIN_SCALE - 1e-9 && s <= R.MAX_SCALE + 1e-9,
      v.name + ': scale ' + s + ' is inside [' + R.MIN_SCALE + ', ' + R.MAX_SCALE + ']');
    if (s > R.MIN_SCALE && s < R.MAX_SCALE) {
      assert(m.width <= v.w + 1e-9 && m.height <= v.h + 1e-9,
        v.name + ': an unclamped fit never overflows the viewport');
      assert(m.width > v.w - m.cw || m.height > v.h - m.ch,
        v.name + ': ...and it is actually a FIT, not a token enlargement');
    }

    // --- `adv` was re-measured at THIS font size ------------------------
    assert(Math.abs(m.adv - m.fontPx * ADV_EM) < 1e-9,
      v.name + ': the glyph advance was re-measured after the resize (adv ' +
      m.adv.toFixed(3) + ' vs ' + (m.fontPx * ADV_EM).toFixed(3) + ' expected at ' +
      m.fontPx.toFixed(2) + 'px)');
    assert(Math.abs(m.adv - m.cw) > 1e-9,
      v.name + ': scaffold — adv differs from the cell pitch, so flush() really ' +
      'does depend on the measurement');

    // --- the backing store follows the CSS size and the dpr -------------
    assertEq(canvasStub.width, Math.round(m.width * m.dpr), v.name + ': backing store width');
    assertEq(canvasStub.height, Math.round(m.height * m.dpr), v.name + ': backing store height');

    // --- pxToCell round-trip, every cell, centred in the viewport -------
    origin = { left: (v.w - m.width) / 2, top: (v.h - m.height) / 2 };
    let bad = null;
    for (let r = 0; r < D.ROWS && !bad; r++) {
      for (let c = 0; c < D.COLS; c++) {
        const px = origin.left + (c + 0.5) * m.cw;
        const py = origin.top + (r + 0.5) * m.ch;
        const hit = R.pxToCell(px, py);
        if (hit.col !== c || hit.row !== r) {
          bad = 'cell ' + c + ',' + r + ' -> ' + hit.col + ',' + hit.row;
          break;
        }
      }
    }
    assert(!bad, v.name + ': every cell centre round-trips through pxToCell (' + bad + ')');

    // top-left and bottom-right pixel of the grid, and the cell boundary a
    // one-pixel error would land on the wrong side of
    assertEq(R.pxToCell(origin.left, origin.top).col, 0, v.name + ': first pixel is col 0');
    assertEq(R.pxToCell(origin.left, origin.top).row, 0, v.name + ': first pixel is row 0');
    const last = R.pxToCell(origin.left + m.width - 0.001, origin.top + m.height - 0.001);
    assertEq(last.col, D.COLS - 1, v.name + ': last pixel is the last column');
    assertEq(last.row, D.ROWS - 1, v.name + ': last pixel is the last row');
    // the cell boundary, from both sides — a half-cell offset error shows up
    // here even though every cell CENTRE would still round-trip
    const inside = R.pxToCell(origin.left + m.cw - 0.01, origin.top + m.ch - 0.01);
    const past = R.pxToCell(origin.left + m.cw + 0.01, origin.top + m.ch + 0.01);
    assert(inside.col === 0 && inside.row === 0,
      v.name + ': the pixel before the first cell boundary is still cell 0,0');
    assert(past.col === 1 && past.row === 1,
      v.name + ': the pixel after it is cell 1,1');
    origin = { left: 0, top: 0 };
  }

  // The whole point of the brief: a 1080p monitor is no longer an 800px
  // island, and a 4K one is not 55px text either.
  assert(scales['desktop 1920x1080'] > 1.5,
    'a 1080p viewport genuinely fills out (scale ' + scales['desktop 1920x1080'] + ')');
  assertEq(scales['4K 3840x2160'], R.MAX_SCALE, '4K clamps to the maximum scale');
  assertEq(scales['phone 600x800'], R.MIN_SCALE,
    'a phone-width viewport letterboxes at the minimum instead of shrinking text');

  // --- called with no arguments it reads the window itself (this is the
  // --- path engine.js's resize listener actually uses)
  global.innerWidth = 1920;
  global.innerHeight = 1080;
  assertEq(R.resize(), scales['desktop 1920x1080'],
    'resize() with no arguments reads the window and lands on the same scale');

  // --- devicePixelRatio changes mid-session (window dragged to another
  // --- display): no resize event fires, so frame() has to notice.
  const before = R.metrics();
  global.devicePixelRatio = 2;
  R.frame({ screen: 'title', meta: DC.Meta.newProfile(), run: null,
            ui: { cursor: { x: 0, y: 0 } } });
  const after = R.metrics();
  assertEq(after.dpr, 2, 'a devicePixelRatio change is picked up without a resize event');
  assertEq(after.deviceWidth, before.deviceWidth * 2, 'and the backing store doubles');
  assertEq(after.width, before.width, 'while the CSS size is unchanged');
  assert(Math.abs(after.adv - after.fontPx * ADV_EM) < 1e-9,
    'the advance is still valid after a dpr-driven re-measure');
  global.devicePixelRatio = 1;
  delete global.innerWidth;
  delete global.innerHeight;
  return Object.keys(scales).map((k) => scales[k].toFixed(2)).join('/');
}

// =========================================================================
// SECTION 12 — the vendored face loads asynchronously (M-HIRES Phase 2.5)
// Render.init() measures the glyph advance ONCE, but a webfont arrives later.
// Until it does, `adv` describes the FALLBACK face; the instant the vendored
// one swaps in, flush() is still dividing whole batched runs by the old
// number and every row shears. The fix is to re-measure on
// document.fonts.ready — the same re-measure resize() owes Phase 1.
// The stub gives the two faces DIFFERENT advances, which is the entire point:
// if the re-measure is dropped, the numbers below stop matching.
// =========================================================================
function fontSection() {
  SECTION = 'font';
  const R = DC.Render;
  const FALLBACK_EM = 0.55, VENDORED_EM = ADV_EM;   // 0.602, DejaVu's real advance
  let faceLoaded = false;
  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function () {},
    measureText: function () {
      return { width: parseFloat(this.font) * (faceLoaded ? VENDORED_EM : FALLBACK_EM) };
    },
  };
  const canvasStub = {
    width: 0, height: 0, style: {},
    getContext: function () { return ctxStub; },
    addEventListener: function () {},
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: parseFloat(this.style.width) || 0,
               height: parseFloat(this.style.height) || 0 };
    },
  };

  let resolveReady = null;
  const ready = new Promise(function (res) { resolveReady = res; });
  let askedFor = null;
  const cssVars = {};
  global.document = {
    documentElement: {
      style: { setProperty: function (k, v) { cssVars[k] = v; } },
    },
    fonts: {
      ready: ready,
      load: function (f) { askedFor = f; return ready; },
    },
  };

  R.init(canvasStub);
  const before = R.metrics();
  assert(Math.abs(before.adv - before.fontPx * FALLBACK_EM) < 1e-9,
    'at init the advance is measured from whatever face is loaded NOW');
  assert(R.fontReady() === false, 'and the vendored face is not claimed to be ready yet');
  assert(askedFor && askedFor.indexOf(R.FONT_FAMILY) >= 0,
    'render asks document.fonts to load the vendored family by name (got ' + askedFor + ')');
  assert(/Deepcore Mono/.test(askedFor), 'which is "Deepcore Mono"');

  // style.css's scanline period is a custom property render sets from the
  // cell size — a fixed 3px pattern reads twice as dense at 2x scale.
  assertEq(cssVars['--scanline'], '3px', 'the scanline period is 3px at scale 1');
  R.resize(1920, 1080);
  assertEq(cssVars['--scanline'], '5px',
    'and it scales with the cell (1.72x -> 5px), so the CRT overlay does not ' +
    'double in density and muddy the art');
  R.resize(800, 627);

  faceLoaded = true;                       // the webfont lands
  resolveReady();
  // let render's two .then handlers run before looking
  return ready.then(function () {})
    .then(function () {})
    .then(function () {
      const after = R.metrics();
      assert(Math.abs(after.adv - after.fontPx * VENDORED_EM) < 1e-9,
        're-measured on document.fonts.ready (adv ' + after.adv.toFixed(3) + ', wanted ' +
        (after.fontPx * VENDORED_EM).toFixed(3) + '; the stale fallback value was ' +
        (after.fontPx * FALLBACK_EM).toFixed(3) + ')');
      assert(R.fontReady(), 'and the renderer knows the vendored face is in use');

      // It must degrade rather than throw: a browser that blocks webfonts, or
      // any host with no font API at all, still has to run the game on the
      // system stack behind it.
      delete global.document;
      assertEq(R.watchFont(), false,
        'with no document.fonts the watch reports absent instead of throwing');
      const still = R.metrics();
      assert(still.adv > 0, 'and the grid still has a usable advance');
      return (after.adv / after.fontPx).toFixed(3);
    });
}

// =========================================================================
// SECTION 13 — the braille coverage probe and its block fallback
// (M-HIRES Phase 3). Braille is NOT in DejaVu Sans Mono; the fallback face is
// the PROPORTIONAL DejaVu Sans, whose braille advances 1500/2048 em against
// the grid's 1233/2048 — 21.7% wide. flush() batches a run of cells into one
// fillText scaled by cw/adv where adv came from '█', so five braille glyphs
// drift a full cell: the failure mode is a CORRUPTED ROW, not a missing dot.
// The probe therefore has to measure before anything emits braille, and the
// block build has to be what renders when it cannot.
// =========================================================================
function brailleSection() {
  SECTION = 'braille';
  const R = DC.Render;
  // Real numbers, from the actual font files: the grid advances 0.602 em and
  // DejaVu Sans's braille advances 0.7324 em.
  const CELL_EM = ADV_EM, PROPORTIONAL_EM = 1500 / 2048;
  let brailleEm = PROPORTIONAL_EM;
  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function () {},
    measureText: function (s) {
      const cp = String(s).codePointAt(0);
      const em = (cp >= 0x2800 && cp <= 0x28FF) ? brailleEm : CELL_EM;
      return { width: parseFloat(this.font) * em };
    },
  };
  const canvasStub = {
    width: 0, height: 0, style: {},
    getContext: function () { return ctxStub; },
    addEventListener: function () {},
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: parseFloat(this.style.width) || 0,
               height: parseFloat(this.style.height) || 0 };
    },
  };
  R.init(canvasStub);

  const run = S.newRun(defEffects(), 4242);
  run.result = { depth: 8, breaches: 8, timeSec: 900, cores: 18, won: true };
  const st = {
    screen: 'victory', meta: DC.Meta.newProfile(), run: run,
    ui: { tool: null, facing: 1, hover: null, cursor: { x: 0, y: 0 },
          dragging: false, dragLast: null, laying: false, paused: false,
          descendAnim: 0, shakeUntil: 0, flash: null },
  };
  function drawnCore() {
    R.frame(st);
    const rows = [];
    for (let r = 0; r < D.ROWS; r++) {
      let line = '';
      for (let c = 0; c < D.COLS; c++) line += (R.cellAt(c, r) || { ch: ' ' }).ch;
      rows.push(line);
    }
    return rows;
  }
  function hasBraille(rows) {
    return rows.some((line) => Array.from(line).some((c) => {
      const cp = c.codePointAt(0);
      return cp >= 0x2800 && cp <= 0x28FF;
    }));
  }

  // ---- braille absent (this is the shipped Linux/DejaVu situation) ------
  assertEq(R.probeBraille(), false,
    'a braille glyph 21.7% wider than the cell is correctly read as ABSENT');
  assertEq(R.subcellMode(), 'blocks', 'so the renderer reports the block mode');
  const fallbackRows = drawnCore();
  assert(!hasBraille(fallbackRows),
    'and NOT ONE braille glyph reaches the cell buffer — this is the assertion ' +
    'that stands between a player and a corrupted row');
  assert(fallbackRows.some((l) => l.indexOf('THE CORE') >= 0 || l.indexOf('C O R E') >= 0),
    'scaffold: the victory screen really was drawn');
  const blockGlyphs = fallbackRows.join('').match(/[▀-▟]/g) || [];
  assert(blockGlyphs.length > 20,
    'the sphere still has its block-element rim (' + blockGlyphs.length + ' glyphs)');

  // ---- braille present and cell-width (a Windows Cascadia-style stack) --
  brailleEm = CELL_EM;
  assertEq(R.probeBraille(), true,
    'a braille glyph that measures exactly one cell is read as present');
  assertEq(R.subcellMode(), 'braille', 'and the renderer offers the braille mode');
  const hiRows = drawnCore();
  assert(hasBraille(hiRows), 'the sphere rim upgrades to braille when it is safe');

  // ---- the layout must not move between the two -------------------------
  let moved = null;
  for (let r = 0; r < D.ROWS && !moved; r++) {
    const a = fallbackRows[r].replace(/\S/g, '#');
    const b = hiRows[r].replace(/\S/g, '#');
    if (a.length !== b.length) moved = 'row ' + r;
  }
  assert(!moved, 'swapping modes never moves the layout (' + moved + ')');
  for (const key of ['STRATA BREACHED', 'CORES EARNED', 'RUN RECAP CARD', 'ASCEND']) {
    assert(fallbackRows.some((l) => l.indexOf(key) >= 0) &&
           hiRows.some((l) => l.indexOf(key) >= 0),
      '"' + key + '" is on the screen in both modes');
  }

  // ---- and the probe re-runs whenever the font changes ------------------
  // A resize re-measures, and so does the webfont landing; a probe that ran
  // once at boot would be stale the moment either happened.
  brailleEm = PROPORTIONAL_EM;
  R.resize(1920, 1080);
  assertEq(R.subcellMode(), 'blocks',
    'the probe re-runs on resize, so a font swap cannot leave it stale');
  assert(!hasBraille(drawnCore()), 'and the sphere drops back to blocks immediately');
  return blockGlyphs.length;
}

// =========================================================================
// SECTION 12 — M-CORELORE + M-GRITPLUS
// The two writing briefs where they touch machinery: the Core Gate's beats
// coming out of the sim at s8, the second voice taking the foreman bar in
// gold, the prompt that lies, the named collapses, the 42-second botanical
// window (and the promise that it costs the RNG stream nothing), the wall
// that slides past on a descent, and the egg cracking on GRIT's last word.
// Render is driven on the recording surface, so every claim is checked as
// cells on the grid rather than as intent.
// =========================================================================
function coreLoreSection(seed) {
  SECTION = 'corelore+gritplus seed=' + seed;
  require('../js/barks.js');
  require('../js/fx.js');
  require('../js/render.js');
  const B = DC.Barks, R = DC.Render, FX = DC.FX, A = DC.Art;
  // Merge seam (M-HIRES × M-CORELORE, resolved by the orchestrator): this
  // section's assertions read the victory sphere cell by cell and were
  // authored against the BLOCK build — which is correct, because blocks are
  // the default on every machine whose mono face lacks braille, i.e. nearly
  // all of them. But M-HIRES added a runtime probe that compares the advance
  // of '█' against '⣿', and a stub returning one width for every glyph makes
  // braille look cell-width and silently switches the sphere to it.
  // So the stub measures like a real machine instead: braille is absent from
  // the mono face and falls through to a proportional one about 21.7% wider,
  // which is the gap probeBraille() exists to detect.
  const ctxStub = {
    fillStyle: '', font: '', textBaseline: '', textAlign: '',
    setTransform: function () {}, fillRect: function () {},
    save: function () {}, restore: function () {}, scale: function () {},
    fillText: function () {},
    measureText: function (s) {
      const braille = typeof s === 'string' && s.length &&
                      s.charCodeAt(0) >= 0x2800 && s.charCodeAt(0) <= 0x28FF;
      return { width: braille ? 12.17 : 10 };
    },
  };
  R.init({ style: {}, getContext: function () { return ctxStub; } });

  // ---- sim: the Core Gate beats, at s8 and nowhere else -------------------
  {
    const run = S.newRun(defEffects(), seed);
    run.depth = D.STRATA_COUNT;
    S.startStratum(run);
    run.breachReq = { gear: 20, charge: 20 };          // scaffold: a round 40
    assertEq(S.breachFrac(run), 0, 'a fresh floor is 0% fed');
    const beats = [];
    function feed(g, c) {
      run.gearsFed = g; run.chargesFed = c;
      S.tick(run);
      for (const ev of run.events.splice(0, run.events.length))
        if (ev.type === 'core') beats.push([ev.data.beat, S.breachFrac(run)]);
    }
    feed(4, 0);                                        // 10%
    assertEq(beats.length, 0, 'the Core says nothing at a tenth of the feed');
    feed(10, 0);                                       // 25%
    assertEq(beats.length, 1, 'beat 0 fires at 25% of the breach feed');
    assertEq(beats[0][0], 0, 'and it is announced as beat 0');
    feed(20, 4);                                       // 60%
    feed(20, 18);                                      // 95%
    assertEq(beats.map(b => b[0]).join(','), '0,1,2', 'three beats, in order');
    for (let i = 0; i < 3; i++)
      assert(beats[i][1] >= D.CORE.beat[i],
        'beat ' + i + ' waited for ' + D.CORE.beat[i] + ' (fired at ' +
        beats[i][1].toFixed(2) + ')');
    feed(20, 20);                                      // 100% — nothing left
    assertEq(beats.length, 3, 'the gate is a 3-beat sequence, once per run');

    // ...and it is stratum 8's alone
    const shallow = S.newRun(defEffects(), seed + 1);
    shallow.depth = 4; S.startStratum(shallow);
    shallow.breachReq = { gear: 4, charge: 0 };
    shallow.gearsFed = 4;
    S.tick(shallow);
    assert(!shallow.events.some(e => e.type === 'core'),
      'no Core Gate above stratum ' + D.STRATA_COUNT);
    const mantle = S.newRun(defEffects(), seed + 2);
    mantle.depth = D.STRATA_COUNT; mantle.mantle = true;
    S.startStratum(mantle);
    mantle.breachReq = { gear: 4, charge: 0 };
    mantle.gearsFed = 4;
    S.tick(mantle);
    assert(!mantle.events.some(e => e.type === 'core'),
      'the gate does not re-open for a Mantle run passing back through');
  }

  // ---- sim: named collapses (M-GRITPLUS) ----------------------------------
  {
    const run = S.newRun(defEffects(), seed + 3);
    run.instability = 100;
    const names = [];
    for (let i = 0; i < 400 * HZ && names.length < 4; i++) {
      run.instability = 100;
      const n0 = run.messages.length;
      S.tick(run);
      for (let m = n0; m < run.messages.length; m++) {
        const hit = /TREMOR ([IVXLC]+)$/.exec(run.messages[m].text);
        if (hit) names.push(hit[1]);
      }
    }
    assertEq(names.slice(0, 4).join(','), 'I,II,III,IV',
      'collapse quakes are numbered as they come (got ' + names.join(',') + ')');
    assertEq(S.roman(9), 'IX', 'the numeral is ASCII roman, not the Unicode block');
    // and the count is per stratum: a new floor starts the list again
    run.depth = 2;
    S.startStratum(run);
    assertEq(run.tremor, 0, 'the tremor list resets on a new stratum');
  }

  // ---- sim: EGG-420 costs the RNG stream nothing --------------------------
  {
    function rngCalls(useEgg) {
      const run = S.newRun(defEffects(), seed + 5);
      let n = 0;
      const real = run.rng;
      run.rng = function () { n++; return real(); };
      if (useEgg) S.startEgg(run, 'code');
      for (let i = 0; i < (D.EGG420.sec - 2) * HZ; i++) S.tick(run);
      return { n: n, inst: run.instability };
    }
    const off = rngCalls(false), on = rngCalls(true);
    assertEq(on.n, off.n, 'opening the window draws no extra numbers from run.rng');
    assert(on.inst < off.inst,
      'the stratum relaxes too: instability ' + on.inst.toFixed(2) + ' < ' +
      off.inst.toFixed(2));
    const ratio = on.inst / off.inst;
    assert(Math.abs(ratio - D.EGG420.instMult) < 0.02,
      'instability rises at x' + D.EGG420.instMult + ' during the window (got x' +
      ratio.toFixed(3) + ')');
  }

  // ---- sim: the damper is a chill unit, and the panel still fits ----------
  {
    const run = S.newRun(defEffects(), seed + 7);
    run.inv.copperPlate = 10;                          // scaffold: afford a damper
    let spot = null;
    for (let y = 1; y < D.MAP_H - 1 && !spot; y++)
      for (let x = 1; x < D.MAP_W - 1 && !spot; x++)
        if (S.canPlace(run, 'damper', x, y, 1).ok) spot = { x: x, y: y };
    assert(spot && S.place(run, 'damper', spot.x, spot.y, 1), 'scaffold: damper placed');
    const plain = S.describeTile(run, spot.x, spot.y).map(l => l.text);
    assert(plain.some(t => /^DAMPER/.test(t)), 'a damper is a DAMPER');
    S.startEgg(run, 'code');
    const chill = S.describeTile(run, spot.x, spot.y);
    assert(chill.some(l => /^CHILL UNIT/.test(l.text)),
      'during the window the tooltip reads chill unit');
    for (const l of chill)
      assert(l.text.length <= S.SCAN_W,
        'the relabelled tooltip still fits the SCAN panel: ' + JSON.stringify(l.text));
  }

  // ---- render: the second voice takes the bar -----------------------------
  const run = S.newRun(defEffects(), seed + 11);
  const st = {
    screen: 'run', meta: DC.Meta.newProfile(), run: run,
    ui: { tool: null, facing: 1, hover: null, cursor: { x: run.hub.x + 1, y: run.hub.y + 1 },
          dragging: false, dragLast: null, laying: false, paused: false,
          descendAnim: 0, shakeUntil: 0, flash: null },
  };
  function frames(n) { for (let i = 0; i < n; i++) R.frame(st); }
  function rowText(r, x0, w) {
    let s = '';
    for (let c = x0; c < x0 + w; c++) s += R.cellAt(c, r).ch;
    return s;
  }
  {
    run.depth = D.STRATA_COUNT;
    B.fire(run, 'runStart');
    run.totalT += 20;                                   // let the typewriter run
    frames(1);
    assert(rowText(31, 0, 6).indexOf('GRIT') >= 0, 'GRIT is tagged on the bar');
    assertEq(R.cellAt(7, 31).fg, D.COLORS.cyan, 'and GRIT speaks in cyan');

    run.totalT += 200;
    const line = B.core(run, 'gate', 0);
    frames(1);
    assertEq(rowText(31, 0, 6).indexOf('GRIT'), -1,
      'the Core is not tagged — it has no name to give');
    assertEq(R.cellAt(5, 31).ch, '▸', 'a bare gold caret marks the second voice');
    // half speed: after 6 ticks GRIT would have shown 12 characters
    run.totalT += 6;
    frames(1);
    const shown = rowText(31, 7, R.FOREMAN_ROW_W).replace(/ +$/, '');
    assertEq(shown, line.slice(0, shown.length), 'the Core types its own line');
    assert(shown.length <= 8, 'the Core types at half GRIT\'s speed (' +
      shown.length + ' chars in 6 ticks)');
    assertEq(R.cellAt(7, 31).fg, D.COLORS.gold, 'and it is gold, not cyan');
    assert(R.contrast(D.COLORS.gold, D.COLORS.bg) >= R.MIN_CONTRAST,
      'the Core clears the contrast floor on the bar background');
    run.totalT += 400;                                  // let it fade out
  }

  // ---- render: the prompt that lies ---------------------------------------
  {
    assertEq(run.coreOffer, null, 'no prompt without the beat that raises it');
    frames(1);
    let found = -1;
    for (let r = D.MAP_Y; r < D.MAP_Y + D.MAP_H; r++)
      if (rowText(r, D.MAP_X, D.MAP_W).indexOf('ASCEND') >= 0) found = r;
    assertEq(found, -1, 'the map shows no ascend prompt of its own');
    run.coreOffer = { t0: run.totalT, until: run.totalT + 9 * HZ };
    frames(1);
    for (let r = D.MAP_Y; r < D.MAP_Y + D.MAP_H; r++)
      if (rowText(r, D.MAP_X, D.MAP_W).indexOf('[ENTER] ASCEND') >= 0) found = r;
    assert(found > 0, 'the Core Gate raises a prompt that looks exactly real');
    // it breathes like the game's real prompts do; both halves are the Core's
    // gold, and both halves clear the text floor
    const px = D.MAP_X + rowText(found, D.MAP_X, D.MAP_W).indexOf('[');
    const tones = {};
    for (let i = 0; i < 8; i++) { run.t++; frames(1); tones[R.cellAt(px, found).fg] = 1; }
    const tk = Object.keys(tones);
    assertEq(tk.length, 2, 'the prompt breathes (got tones ' + tk.join(',') + ')');
    assert(tk.indexOf(D.COLORS.gold) >= 0, 'drawn in the liar\'s own gold');
    for (const t of tk)
      assert(R.contrast(t, D.COLORS.bg) >= R.MIN_CONTRAST,
        'the prompt reads at ' + R.contrast(t, D.COLORS.bg).toFixed(2) + ':1 in tone ' + t);
    run.totalT = run.coreOffer.until + 1;
    frames(1);
    let still = false;
    for (let r = D.MAP_Y; r < D.MAP_Y + D.MAP_H; r++)
      if (rowText(r, D.MAP_X, D.MAP_W).indexOf('ASCEND') >= 0) still = true;
    assertEq(still, false, 'and it takes the offer away again');
  }

  // ---- render: the EGG-420 wash tints, and never paints --------------------
  {
    // the promise in one assertion: no colour the game draws comes out of the
    // wash reading worse than it went in
    for (const k in D.COLORS) {
      const c = D.COLORS[k];
      if (typeof c !== 'string' || c[0] !== '#') continue;
      const t = R.eggTint(c);
      const c0 = R.contrast(c, D.COLORS.bg), c1 = R.contrast(t, D.COLORS.bg);
      if (c0 >= R.MIN_CONTRAST)
        assert(c1 >= R.MIN_CONTRAST, 'the wash demoted ' + k + ' (' + c + ' -> ' + t +
          ', ' + c0.toFixed(2) + ':1 -> ' + c1.toFixed(2) + ':1)');
      assert(c1 >= c0 * 0.8, 'the wash dulls ' + k + ' too far (' +
        c0.toFixed(2) + ':1 -> ' + c1.toFixed(2) + ':1)');
      assert(t !== c || c === D.COLORS.leaf, 'the wash actually reaches ' + k);
    }
    for (const k in D.TERRAIN) {
      const c = D.TERRAIN[k].color;
      assert(R.contrast(R.eggTint(c), D.COLORS.bg) >= R.contrast(c, D.COLORS.bg) * 0.8,
        'terrain ' + k + ' survives the wash');
    }
    // and on the live map: same glyphs in the same places, different colours
    run.coreOffer = null;
    frames(1);
    const before = [];
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) before.push(R.cellAt(D.MAP_X + x, D.MAP_Y + y));
    S.startEgg(run, 'code');
    frames(1);
    let moved = 0, glyphChanged = 0;
    for (let y = 0, i = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++, i++) {
        const now = R.cellAt(D.MAP_X + x, D.MAP_Y + y);
        if (now.ch !== before[i].ch) glyphChanged++;
        if (now.fg !== before[i].fg) moved++;
      }
    assertEq(glyphChanged, 0, 'the wash changes no glyph — tint, do not paint');
    assert(moved > 100, 'but the map really is washed (' + moved + ' cells re-tinted)');
    run.egg = null;
  }

  // ---- render: the wall slides past on a descent --------------------------
  {
    assertEq(typeof R.graffitiFor, 'function', 'render exports the graffiti pick');
    run.depth = 3;                                      // dropping to stratum 4
    const pick = R.graffitiFor(run, run.depth + 1);
    assert(A.graffiti.indexOf(pick) >= 0, 'the pick comes from the pool');
    assertEq(R.graffitiFor(run, 4), pick, 'the same descent shows the same wall');
    assert(R.graffitiFor(run, 5) !== pick || A.graffiti.length < 2,
      'a different floor shows a different wall');
    const spread = {};
    for (let s = 1; s <= 60; s++) spread[R.graffitiFor({ seed: s * 7919 }, 3)] = 1;
    assert(Object.keys(spread).length >= 8,
      'the pick spreads across the pool (' + Object.keys(spread).length + ' in 60 seeds)');
    // render must not steal a number from the run to choose it
    const real = run.rng;
    let drew = 0;
    run.rng = function () { drew++; return real(); };
    st.screen = 'descend';
    run.status = 'breachReady';
    st.ui.descendAnim = 0;
    let seenRow = -1, seenText = '';
    for (let i = 0; i < 120; i++) {
      frames(1);
      for (let r = 20; r < D.ROWS; r++) {
        const t = rowText(r, 0, D.COLS);
        if (t.indexOf(pick) >= 0) { seenRow = r; seenText = pick; }
      }
    }
    run.rng = real;
    assertEq(drew, 0, 'the descent screen drew ' + drew + ' numbers from run.rng (must be 0)');
    assertEq(seenText, pick, 'the graffiti is drawn during the descent');
    assert(seenRow >= 20, 'and it rides the band under the frames (row ' + seenRow + ')');
  }

  // ---- render: the egg cracks on GRIT's last character --------------------
  {
    const art = A.victory;
    const cracked = A.crackSphere(art);
    let cx = -1, cy = -1;
    for (let y = 0; y < art.length && cy < 0; y++)
      for (let x = 0; x < art[y].length; x++)
        if (art[y][x] !== cracked[y][x]) { cx = x; cy = y; break; }
    assert(cy >= 0, 'the shipped sphere has a crack cell to look for');
    const col = cx + Math.max(0, (D.COLS - art[cy].length) >> 1);
    const row = 1 + cy;                                  // drawVictory draws at row 1

    // The toast line a run will get is a pure function of its seed, so it can
    // be read off a probe run without disturbing the one being rendered. The
    // screen is primed with a DIFFERENT toast first: fx keys its typewriter on
    // the string, and priming guarantees the reveal restarts here rather than
    // inheriting a finished one from an earlier section.
    function toastOf(s) { return B.toast(S.newRun(defEffects(), s)); }
    const res = { depth: 8, breaches: 8, timeSec: 700, cores: 18, won: true };
    const sV = seed + 51;
    const want = toastOf(sV).slice(0, 70);
    let sOther = seed + 52;
    while (toastOf(sOther).slice(0, 70) === want) sOther++;
    st.screen = 'victory';
    st.run = S.newRun(defEffects(), sOther);
    st.run.status = 'won'; st.run.result = res;
    frames(2);
    const vic = S.newRun(defEffects(), sV);
    vic.status = 'won'; vic.result = res;
    st.run = vic;
    frames(1);
    assertEq(R.cellAt(col, row).ch, art[cy][cx],
      'while GRIT is still talking the shell is whole');
    function toastRow() {
      for (let r = 20; r < D.ROWS; r++)
        if (rowText(r, 0, D.COLS).indexOf(want) >= 0) return r;
      return -1;
    }
    let guard = 0;
    while (toastRow() < 0 && guard++ < 60 * FX.FPS) frames(1);
    assert(toastRow() > 0, 'the victory toast finished typing');
    frames(1);
    assertEq(R.cellAt(col, row).ch, ' ',
      'on the toast\'s last character the sphere opens a hairline');
    // the reveal is an overlay, not an edit: the asset is untouched
    assertEq(A.victory[cy][cx], art[cy][cx],
      'the crack never writes back into DC.Art.victory');

    // ...and then the shell says something, and GRIT answers it. Render must
    // pick that pair without drawing a number out of the still-live run.
    const realV = vic.rng;
    let drewV = 0;
    vic.rng = function () { drewV++; return realV(); };
    let core = null, reply = null;
    for (let i = 0; i < 40 * FX.FPS && !reply; i++) {
      frames(1);
      for (let r = 20; r < D.ROWS; r++) {
        const t = rowText(r, 0, D.COLS);
        for (const p of B.CORE.reveal) {
          if (t.indexOf(p.core) >= 0) core = p.core;
          if (core === p.core && t.indexOf(p.grit) >= 0) reply = p.grit;
        }
      }
    }
    vic.rng = realV;
    assert(core, 'the opened shell speaks');
    assert(reply, 'and GRIT answers the thing he just drilled into');
    assertEq(drewV, 0, 'the victory screen drew ' + drewV +
      ' numbers from run.rng (the Mantle is one keypress away)');
    // the pair is stable — a redraw is not a re-roll
    let goldRow = -1;
    for (let r = 20; r < D.ROWS; r++)
      if (rowText(r, 0, D.COLS).indexOf(core) >= 0) goldRow = r;
    assert(goldRow > 0, 'the Core line holds its row');
    const gx = rowText(goldRow, 0, D.COLS).indexOf(core[0]);
    assertEq(R.cellAt(gx, goldRow).fg, D.COLORS.gold, 'and it is the Core, in gold');
    frames(30);
    assert(rowText(goldRow, 0, D.COLS).indexOf(core) >= 0,
      'the reveal does not re-roll on redraw');
  }
  return A.graffiti.length;
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
  engineBarksSection(SEED + 29);
  const cardRows = recapSection(SEED + 37);
  const fxRows = fxSection(SEED + 31);
  const blinks = clockSection(SEED + 41);
  const scaleSummary = scalingSection();
  const rimGlyphs = brailleSection();
  // M-CORELORE + M-GRITPLUS. Runs AFTER brailleSection because that one leaves
  // the sub-cell probe pointed at a chosen mode; the Core Gate section draws
  // the victory sphere and would otherwise inherit whichever mode ran last.
  const walls = coreLoreSection(SEED + 43);
  // The webfont section is the one asynchronous check in the suite — a
  // document.fonts.ready handler cannot be driven synchronously — so the
  // PASS line waits on it rather than racing it.
  fontSection().then(function (advEm) {
    console.log('PASS integration seed=' + SEED + ' | ' + drivenSummary +
      ' | fx rows ' + fxRows + ' | recap card ' + cardRows + ' rows' +
      ' | clock 60=144Hz (' + blinks + ' blinks/4s)' +
      ' | scale ' + scaleSummary + ' | webfont re-measured ' + advEm + 'em' +
      ' | braille probe->blocks (' + rimGlyphs + ' rim glyphs)' +
      ' | core gate 3 beats | ' + walls + ' walls' +
      ' | cadence 16/12/10 | overdrive x2 | damper ok | charge+bronze ok | mantle ok' +
      ' | engine+barks ok | ' + (Date.now() - t0) + 'ms');
    process.exit(0);
  }, function (e) {
    fail('exception: ' + (e && e.stack || e));
  });
} catch (e) {
  fail('exception: ' + (e && e.stack || e));
}
