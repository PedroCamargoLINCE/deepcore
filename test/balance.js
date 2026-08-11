/* DEEPCORE — test/balance.js
   Balance sweep harness (permanent, node). SPEC.md §12 targets, measured.

   Bot machinery lifted from test/integration.js mkBot (same planner:
   Dijkstra belt routing over floor/rock, chain builder, assembler
   installer), extended to drive as deep as it can:
     - charge tier at depth >= 5: charge assembler near the hub fed by a
       copper chain + crystal + coal extractor lines
     - second iron chain into the gear assembler when the gear req is high
     - schematic pick priority list, overdrive heuristic, scrap-then-descend
   Two pacing policies:
     standard — descend once breach + a short gear-bank window allows
     camper   — lingers to ~1.5x the breach-ready time before descending
   A stalled stratum (no breach by the cap / planner defeat) rides out under
   quakes to its natural death, so death depth reflects real punishment.

   Usage: node test/balance.js [seed seed ...]
   Env:   DC_BAL_POLICIES=standard,camper  DC_BAL_CAPMIN=30  DC_TRACE=1 */
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
// (lifted from test/integration.js mkBot; extended for depth 5+ play)
function mkBot(run) {
  const bot = {};
  const builtBelts = [];
  const builtMachines = [];

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
    const heap = [];
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
  bot.chainCost = (p) =>
    D.BUILDINGS.smelter.cost.ironPlate +
    D.BUILDINGS.extractor.cost.ironPlate * (p.coalP ? 2 : 1) +
    (run.mods.beltFree ? 0 : p.belts);

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
  function installAssembler(feedChains) {
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
        for (const ch of feedChains) {
          if (!ok) break;
          if (fpSet.has(key(ch.out.x, ch.out.y))) continue;
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
    for (const ch of feedChains) {
      ch.outBelts.length = 0;
      const r = findPath([ch.out], hubGoals(), new Set());
      if (r) buildBeltLine(r.path, r.into, ch.outBelts);
      for (const b of ch.outBelts) b.retired = false;
    }
    return null;
  }

  // Set an assembler's recipe by cycling clickTile (max 4 clicks).
  function setRecipe(asm, want) {
    for (let i = 0; i < 4; i++) {
      const m = run.machines[T(asm.x, asm.y).machine];
      if (!m || m.type !== 'assembler') return false;
      if (m.recipe === want) return true;
      S.clickTile(run, asm.x, asm.y);
    }
    return false;
  }

  // Route a raw-ore extractor line into an existing footprint. Returns bool.
  function addOreFeed(oreId, fp) {
    const tiles = oreTilesSorted(oreId, { x: fp[0].x, y: fp[0].y });
    if (!tiles.length) return false;
    const plan = planExtractor(tiles, fp, new Set());
    if (!plan) return false;
    const cost = D.BUILDINGS.extractor.cost.ironPlate +
      (run.mods.beltFree ? 0 : plan.path.length);
    if (cost + 2 > inv('ironPlate')) return false;
    if (!placeMachine('extractor', plan.tile.x, plan.tile.y, plan.facing)) return false;
    if (plan.path.length && !buildBeltLine(plan.path, plan.into, null)) return false;
    // register as a chain-like feeder so depletion replants it
    chains.push({ fp, out: null, outBelts: [],
      feeders: [{ oreId, x: plan.tile.x, y: plan.tile.y }] });
    return true;
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

  // Overdrive heuristic: on while feeding a banked stock at low risk.
  function overdriveWant() {
    if (run.status !== 'active') return false;
    if (run.instability >= 45 || run.integrity <= 50) return false;
    const gearsLeft = run.breachReq.gear - run.gearsFed;
    return gearsLeft > 0 ? inv('gear') >= 8 : inv('charge') >= 4;
  }
  function driveOverdrive() {
    const want = overdriveWant();
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
  // Returns a per-stratum record; caller handles the descend.
  bot.playStratum = function (policy, capTotalT) {
    const depth = run.depth;
    const st = { depth, req: run.breachReq.gear + '+' + run.breachReq.charge,
                 tBreach: null, tLeave: null, integEnd: null, instEnd: null, stall: false };
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
    tickN(48, false);                        // scan opens past guaranteed veins

    // phase 1: iron chain
    let c1 = null;
    while (!c1 && run.status === 'active' && run.t < capT / 2 && run.totalT < capTotalT) {
      const p1 = planChain('ironOre', hubGoals(), false);
      if (p1 && bot.chainCost(p1) <= inv('ironPlate')) c1 = buildChain(p1, 'ironOre');
      if (!c1) tickN(48, true);
      trace();
    }
    const finish = () => {
      st.tLeave = Math.round(run.t / HZ);
      st.integEnd = Math.max(0, Math.ceil(run.integrity));
      st.instEnd = Math.round(run.instability);
      return st;
    };
    if (run.status === 'dead') return finish();
    if (!c1) { st.stall = 'no-iron-chain'; return finish(); }

    // main loop: gear assembler, optional 2nd iron chain, charge tier at 5+
    let asm = null, asmTries = 0;
    let chain2 = null, asm2 = null, asm2Feeds = { crystal: false, coal: false, copper: false };
    let iter = 0;
    const needCharges = () => run.breachReq.charge > 0;
    while (run.status === 'active' && run.t < capT && run.totalT < capTotalT) {
      tickN(16, true);
      iter++;
      driveOverdrive();
      trace();
      const planNow = iter % 4 === 0;        // planning is heavy; throttle it
      if (!planNow) continue;
      if (!asm && inv('ironPlate') >= BOT.asmGate(depth)) {
        asm = installAssembler([c1]);
        if (!asm && ++asmTries >= 8) { st.stall = 'no-assembler'; break; }
      }
      if (asm && !chain2 && run.breachReq.gear >= BOT.chain2GearReq &&
          inv('ironPlate') >= BOT.chain2Gate) {
        const goals = perimMap(asm.fp);
        const p = planChain('ironOre', goals, false);
        if (p && bot.chainCost(p) + 8 <= inv('ironPlate')) chain2 = buildChain(p, 'ironOre');
      }
      if (asm && needCharges()) {
        if (!asm2 && inv('ironPlate') >= BOT.chargeAsmGate) {
          asm2 = installAssembler([]);
          if (asm2) setRecipe(asm2, 'charge');
        }
        if (asm2 && !asm2Feeds.crystal) asm2Feeds.crystal = addOreFeed('crystal', asm2.fp);
        if (asm2 && !asm2Feeds.coal) asm2Feeds.coal = addOreFeed('coal', asm2.fp);
        if (asm2 && asm2Feeds.crystal && !asm2Feeds.copper &&
            inv('ironPlate') >= BOT.copperGate) {
          const goals = perimMap(asm2.fp);
          const p = planChain('copperOre', goals, false);
          if (p && bot.chainCost(p) + 6 <= inv('ironPlate')) {
            asm2Feeds.copper = !!buildChain(p, 'copperOre');
          }
        }
      }
    }
    if (run.overdrive) S.toggleOverdrive(run);
    if (run.status === 'dead') return finish();
    if (run.status !== 'breachReady') { if (!st.stall) st.stall = 'no-breach'; return finish(); }
    st.tBreach = Math.round(run.t / HZ);

    // post-breach: bank (standard) or linger (camper), then hand back
    if (policy === 'camper') {
      const until = Math.round(st.tBreach * BOT.camperLinger) * HZ;
      while (run.status === 'breachReady' && run.t < until && run.totalT < capTotalT) {
        tickN(16, true);
        trace();
      }
    } else if (depth < D.STRATA_COUNT) {
      const until = run.t + BOT.bankSec * HZ;
      while (run.status === 'breachReady' && run.t < until &&
             inv('gear') < BOT.bankGears && lineAlive() && run.totalT < capTotalT) {
        tickN(16, true);
        trace();
      }
    }
    return finish();
  };

  return bot;
}

// -------------------------------------------------------- policy constants
// Fixed across tuning so before/after sweeps are apples-to-apples.
const BOT = {
  stratCapSec: 480,          // per-stratum no-breach cap -> stall
  asmGate: (depth) => (depth === 1 ? 26 : 16),
  bankSec: 45, bankGears: 14,     // standard post-breach banking window
  camperLinger: 1.5,              // camper leaves at 1.5x breach-ready time
  chain2GearReq: 45, chain2Gate: 46,   // second iron chain threshold
  chargeAsmGate: 24, copperGate: 40,   // charge tier build gates
  pickOrder: ['s_plate', 's_damp', 's_drill', 's_charge', 's_extract', 's_smelt',
              's_veins', 's_salvage', 's_coal', 's_survey', 's_over',
              's_beltfree', 's_repair', 's_gear'],
};
function pickSchematic(run) {
  for (const id of BOT.pickOrder) if (run.pendingOffers.indexOf(id) >= 0) return id;
  return run.pendingOffers[0];
}

// ------------------------------------------------------------------ one run
function playRun(seed, policy, capMin) {
  const run = S.newRun(DC.Meta.effects(DC.Meta.newProfile()), seed);
  const bot = mkBot(run);
  const capTotalT = capMin * 60 * HZ;
  const rec = { policy, seed, strata: [], outcome: '?', deathDepth: null,
                totalSec: 0, cores: 0, minInteg: run.integrity, schematics: null };
  while (run.status !== 'dead' && run.status !== 'won' && run.totalT < capTotalT) {
    const sRec = bot.playStratum(policy, capTotalT);
    rec.strata.push(sRec);
    rec.minInteg = Math.min(rec.minInteg, run.integrity);
    if (run.status === 'dead' || run.status === 'won') break;
    if (sRec.stall) {
      // ride the stall out under rising instability: the honest death depth
      while (run.status !== 'dead' && run.totalT < capTotalT) bot.tickN(64, true);
      break;
    }
    if (run.totalT >= capTotalT) break;
    bot.scrapAll();
    if (!S.beginDescent(run)) break;
    if (run.status === 'won') break;
    S.applySchematic(run, pickSchematic(run));
  }
  rec.minInteg = Math.max(0, Math.min(rec.minInteg, run.integrity));
  rec.totalSec = Math.round(run.totalT / HZ);
  rec.deathDepth = run.depth;
  rec.cores = run.result ? run.result.cores : run.breaches;
  rec.schematics = run.schematics.map((s) => s.replace(/^s_/, '')).join(',');
  rec.outcome = run.status === 'won' ? 'WON'
    : run.status === 'dead' ? 'dead@' + run.depth
    : 'cap@' + run.depth;
  return rec;
}

// ------------------------------------------------------------------- sweep
const DEFAULT_SEEDS = [1337, 777, 42, 2, 1, 7, 99, 123, 2024, 31337, 555, 90210, 424242, 1010];
const seeds = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => parseInt(s, 10) | 0)
  : DEFAULT_SEEDS;
const policies = (process.env.DC_BAL_POLICIES || 'standard,camper').split(',');
const capMin = parseInt(process.env.DC_BAL_CAPMIN || '30', 10);

function pad(s, n) { return (String(s) + ' '.repeat(n)).slice(0, n); }
function padL(s, n) { return (' '.repeat(n) + String(s)).slice(-n); }

const t0 = Date.now();
const rows = [];
for (const policy of policies) {
  for (const seed of seeds) {
    rows.push(playRun(seed, policy, capMin));
  }
}

console.log('DEEPCORE balance sweep — ' + seeds.length + ' seeds x ' +
  policies.length + ' policies, cap ' + capMin + ' sim-min  (' +
  Math.round((Date.now() - t0) / 1000) + 's wall)');
console.log(pad('policy', 9) + padL('seed', 7) + '  ' + pad('outcome', 9) +
  padL('time', 6) + padL('cores', 6) + padL('mInteg', 7) +
  '  per-stratum breach@s (leave@s, integ, inst)');
for (const r of rows) {
  const per = r.strata.map((s) =>
    's' + s.depth + ':' + (s.tBreach == null ? (s.stall ? 'STALL' : '--') : s.tBreach) +
    '(' + s.tLeave + ',' + s.integEnd + ',' + s.instEnd + ')').join(' ');
  console.log(pad(r.policy, 9) + padL(r.seed, 7) + '  ' + pad(r.outcome, 9) +
    padL(Math.round(r.totalSec / 60) + ':' + pad(('0' + r.totalSec % 60).slice(-2), 2), 6) +
    padL(r.cores, 6) + padL(r.minInteg, 7) + '  ' + per);
}

// -------------------------------------------------------------- aggregates
function agg(policy) {
  const rs = rows.filter((r) => r.policy === policy);
  const n = rs.length;
  const wins = rs.filter((r) => r.outcome === 'WON');
  const deaths = rs.filter((r) => /^dead@/.test(r.outcome));
  const caps = rs.filter((r) => /^cap@/.test(r.outcome));
  const s1 = rs.map((r) => r.strata[0]).filter((s) => s && s.tBreach != null);
  const surviveS2 = rs.filter((r) => {
    const d = r.strata.find((s) => s.depth === 2);
    // survived stratum 2 = breached it (or never died there)
    return d ? (d.tBreach != null && !(r.deathDepth === 2 && /^dead@/.test(r.outcome)))
             : r.deathDepth > 2;
  });
  const stalls = [];
  for (const r of rs) for (const s of r.strata) if (s.stall) stalls.push('s' + s.depth + ':' + s.stall);
  const med = (arr) => {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    return a.length % 2 ? a[(a.length - 1) / 2] : Math.round((a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  };
  const deathDepths = deaths.map((r) => r.deathDepth);
  const coresEarly = rs.map((r) => r.cores);
  console.log('\n== ' + policy + ' ==  n=' + n);
  console.log('  s1 breach-ready: med ' + med(s1.map((s) => s.tBreach)) + 's  range ' +
    Math.min.apply(null, s1.map((s) => s.tBreach)) + '-' +
    Math.max.apply(null, s1.map((s) => s.tBreach)) + 's   [target ~130-190s incl build]');
  console.log('  survive stratum 2: ' + surviveS2.length + '/' + n + ' (' +
    Math.round(100 * surviveS2.length / n) + '%)   [target >=80%]');
  console.log('  wins: ' + wins.length + '/' + n +
    (wins.length ? '  time med ' + Math.round(med(wins.map((r) => r.totalSec)) / 60) +
      'min range ' + wins.map((r) => Math.round(r.totalSec / 60)).sort((a, b) => a - b).join('-') + 'min' : '') +
    '   [target 15-25min]');
  console.log('  deaths: ' + deaths.length + ' at depths [' + deathDepths.sort((a, b) => a - b).join(',') + ']' +
    (deathDepths.length ? ' med ' + med(deathDepths) : '') +
    (policy === 'camper' ? '   [target ~6-7]' : ''));
  if (caps.length) console.log('  30min-cap: ' + caps.map((r) => r.outcome + '/' + r.seed).join(' '));
  console.log('  cores/run: [' + coresEarly.join(',') + '] med ' + med(coresEarly) +
    '   [target 2-5 for first runs]');
  if (stalls.length) console.log('  stalls: ' + stalls.join(' '));
}
for (const p of policies) agg(p);
