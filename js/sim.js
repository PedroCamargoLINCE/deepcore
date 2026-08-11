/* DEEPCORE — sim.js
   DC.Sim: tick-based factory/hazard simulation. DOM-free.
   Never reads DC.state; everything lives in the run object. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA, U = DC.util;
  const HZ = D.TICK_HZ;

  // ---------------- helpers ----------------
  function tileAt(run, x, y) {
    if (x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H) return null;
    return run.grid[y][x];
  }
  function add(inv, item, n) { inv[item] = (inv[item] || 0) + n; }
  function stratumOf(run) {
    return run.depth <= D.STRATA_COUNT ? D.STRATA[run.depth - 1] : D.mantleStratum(run.depth);
  }
  function msg(run, text, color) {
    run.messages.push({ text: text, color: color || D.COLORS.gray, t: run.t });
    if (run.messages.length > 40) run.messages.shift();
  }
  // v1.1 (SPEC2 §B) event queue: engine splice-drains every tick.
  // Entries are { type, t, data } with t = run.totalT (monotonic across strata).
  function pushEvent(run, type, data) {
    if (!run.events) run.events = [];
    run.events.push({ type: type, t: run.totalT, data: data || null });
    if (run.events.length > 200) run.events.shift(); // never grow unbounded headless
  }
  function setResult(run, won) {
    run.result = {
      depth: run.depth, breaches: run.breaches,
      timeSec: Math.round(run.totalT / HZ),
      cores: run.breaches + (won ? D.WIN_CORES : 0), won: won,
    };
  }

  // ---------------- modifiers (§5.8) ----------------
  function baseMods() {
    return {
      beltFree: false, extractMult: 1, smeltMult: 1, coalX2: false, instMult: 1,
      autoRepair: false, breachMult: 1, salvage: 0, fullReveal: false,
      chargeX2: false, overCheap: false, richVeins: false, bronzeGear: false,
      drillMult: 1, startBonus: {}, scanBonus: 0, repairCost: D.REPAIR_COST,
      integrityBonus: 0, offerCount: 3,
    };
  }
  function applyMeta(mods, fx) {
    fx = fx || {};
    if (fx.startBonus) mods.startBonus = fx.startBonus;
    mods.integrityBonus += fx.integrityBonus || 0;
    if (fx.instMult != null) mods.instMult *= fx.instMult;
    if (fx.drillMult != null) mods.drillMult *= fx.drillMult;
    if (fx.repairCost != null) mods.repairCost = fx.repairCost;
    mods.scanBonus += fx.scanBonus || 0;
    mods.salvage = Math.max(mods.salvage, fx.salvage || 0);
    if (fx.offerCount) mods.offerCount = fx.offerCount;
  }
  function applySchematicMod(run, id) {
    const m = run.mods;
    switch (id) {
      case 's_beltfree': m.beltFree = true; break;
      case 's_extract': m.extractMult += 0.35; break;
      case 's_smelt': m.smeltMult += 0.30; break;
      case 's_coal': m.coalX2 = true; break;
      case 's_plate':
        m.integrityBonus += 20;
        run.maxIntegrity += 20;
        run.integrity = Math.min(run.maxIntegrity, run.integrity + 20);
        break;
      case 's_damp': m.instMult *= 0.75; break;
      case 's_repair': m.autoRepair = true; break;
      case 's_drill': m.breachMult = Math.max(0.1, m.breachMult - 0.15); break;
      case 's_salvage': m.salvage = Math.max(m.salvage, 0.6); break;
      case 's_survey': m.fullReveal = true; break;
      case 's_charge': m.chargeX2 = true; break;
      case 's_over': m.overCheap = true; break;
      case 's_veins': m.richVeins = true; break;
      case 's_gear': m.bronzeGear = true; break;
    }
  }

  // ---------------- run lifecycle ----------------
  function newRun(metaEffects, seed) {
    const mods = baseMods();
    applyMeta(mods, metaEffects);
    const run = {
      seed: seed, rng: U.mulberry32(seed >>> 0),
      depth: 1, status: 'active', t: 0, totalT: 0,
      grid: null, hub: null, machines: {}, nextId: 1,
      inv: {}, gearsFed: 0, chargesFed: 0,
      breachReq: { gear: 0, charge: 0 },
      integrity: 0, maxIntegrity: 0,
      instability: 0, quakeAt: 0, overdrive: false,
      schematics: [], mods: mods, pendingOffers: null,
      breaches: 0, mantle: false, messages: [], result: null,
      magmaCap: 0,
      // v1.1 (SPEC2 §B): additive event/stat/foreman surface
      events: [],
      stats: { placed: {}, lastPlaceT: 0, lastFeedT: 0 },
      foreman: null,
      _feed: [], _lastRevealR: -1,
    };
    for (const k in D.START_STOCK) add(run.inv, k, D.START_STOCK[k]);
    for (const k in mods.startBonus) if (mods.startBonus[k]) add(run.inv, k, mods.startBonus[k]);
    run.maxIntegrity = D.START_INTEGRITY + mods.integrityBonus;
    run.integrity = run.maxIntegrity;
    startStratum(run);
    msg(run, 'The rig bites into the topsoil. Feed it gears.', D.COLORS.amber);
    return run;
  }

  function startStratum(run) {
    const S = stratumOf(run);
    const gen = DC.MapGen.generate(run.depth, run.rng, run.mods);
    run.grid = gen.grid;
    run.hub = gen.hub;
    run.t = 0;
    run.instability = Math.max(0, run.instability - 40);
    run.gearsFed = 0;
    run.chargesFed = 0;
    run.breachReq = {
      gear: Math.ceil(S.breach.gear * run.mods.breachMult),
      charge: Math.ceil(S.breach.charge * run.mods.breachMult),
    };
    run.machines = {
      0: { id: 0, type: 'hub', x: run.hub.x, y: run.hub.y, w: 3, h: 3, facing: 0,
           hp: Infinity, progress: 0, recipe: null, input: {}, fuel: 0,
           status: 'ok', repairAt: 0, blockedSince: 0, nofuelSince: 0,
           out: [], job: null },
    };
    run.nextId = 1;
    run.quakeAt = 0;
    run.overdrive = false;
    run.status = 'active';
    let magma = 0;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++)
        if (run.grid[y][x].t === 'magma') magma++;
    run.magmaCap = Math.floor(magma * D.MAGMA.growthCap);
    run._feed = [];
    run._lastRevealR = -1;
    if (run.mods.fullReveal) {
      for (let y = 0; y < D.MAP_H; y++)
        for (let x = 0; x < D.MAP_W; x++) run.grid[y][x].revealed = true;
      run._lastRevealR = 9999;
    }
    updateReveal(run);
  }

  // ---------------- reveal (§5.6) ----------------
  function updateReveal(run) {
    const r = D.REVEAL_R0 + run.mods.scanBonus + Math.floor(run.t / D.REVEAL_TICKS);
    if (r <= run._lastRevealR) return;
    run._lastRevealR = r;
    const cx = run.hub.x + 1, cy = run.hub.y + 1, r2 = r * r;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (!t.revealed && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2)
          t.revealed = true;
      }
  }

  // ---------------- tick (§5.1) ----------------
  function tick(run) {
    if (run.status !== 'active' && run.status !== 'breachReady') return;
    run.t++;
    run.totalT++;
    updateReveal(run);
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (t.digT > 0 && --t.digT === 0) {
          if (t.t === 'rock') t.t = 'floor';
          t.rubble = false;
        }
      }
    const ids = Object.keys(run.machines).map(Number).sort((a, b) => a - b);
    for (const id of ids) {
      if (id === 0) continue;
      const m = run.machines[id];
      if (m) stepMachine(run, m);
    }
    if (run.t % D.BELT_PERIOD === 0) stepBelts(run);
    if (run.t % drillPeriod(run) === 0) stepDrill(run);
    run.instability = U.clamp(run.instability + instRate(run) / HZ, 0, 100);
    stepQuake(run);
    stepMagma(run);
    if (run.status === 'active' &&
        run.gearsFed >= run.breachReq.gear && run.chargesFed >= run.breachReq.charge) {
      run.status = 'breachReady';
      msg(run, '»» BREACH READY — press D to descend ««', D.COLORS.amber);
      pushEvent(run, 'breachReady', { depth: run.depth });
    }
    if (run.integrity <= 0) {
      run.integrity = 0;
      run.status = 'dead';
      setResult(run, false);
      msg(run, 'The rig gives way. The depth keeps it.', D.COLORS.red);
      pushEvent(run, 'death', { depth: run.depth, cause: 'integrity' });
    }
  }

  // ---------------- machines (§5.3) ----------------
  function halfSkip(run, m) { return m.hp === 1 && run.t % 2 === 1; }

  function outputTile(m) {
    if (m.facing === 0) return { x: m.x + ((m.w - 1) >> 1), y: m.y - 1 };
    if (m.facing === 1) return { x: m.x + m.w, y: m.y + ((m.h - 1) >> 1) };
    if (m.facing === 2) return { x: m.x + ((m.w - 1) >> 1), y: m.y + m.h };
    return { x: m.x - 1, y: m.y + ((m.h - 1) >> 1) };
  }

  function machineAccepts(run, m, item) {
    if (m.type === 'hub') return true;
    if (m.type === 'smelter')
      return (item === 'ironOre' || item === 'copperOre' || item === 'coal') &&
             (m.input[item] || 0) < D.INPUT_CAP;
    if (m.type === 'assembler') {
      const r = D.RECIPES[m.recipe || 'gear'];
      return !!r.in[item] && (m.input[item] || 0) < D.INPUT_CAP;
    }
    if (m.type === 'damper')
      return item === 'coal' && (m.input.coal || 0) < D.INPUT_CAP;
    return false;
  }

  function tryEject(run, m) {
    if (!m.out.length) return;
    const o = outputTile(m);
    const t = tileAt(run, o.x, o.y);
    if (!t) return;
    while (m.out.length) {
      const item = m.out[0];
      if (t.machine !== null) {
        const tm = run.machines[t.machine];
        if (!tm) return;
        if (tm.id === 0) { add(run.inv, item, 1); m.out.shift(); continue; }
        if (machineAccepts(run, tm, item)) { add(tm.input, item, 1); m.out.shift(); continue; }
        return;
      }
      if (t.belt && t.belt.item === null) { t.belt.item = item; m.out.shift(); }
      return; // belt holds one item; anything else blocks
    }
  }

  function stepMachine(run, m) {
    const B = D.BUILDINGS[m.type];
    const wasDepleted = m.status === 'depleted';
    if (m.repairAt > 0 && run.t >= m.repairAt) {
      if (m.hp === 1) { m.hp = B.hp; msg(run, B.name + ' self-repaired.', D.COLORS.green); }
      m.repairAt = 0;
    }
    tryEject(run, m);
    let working = false, nofuel = false, depleted = false;
    if (m.type === 'extractor') {
      const t = tileAt(run, m.x, m.y);
      if (!t || !t.ore || t.oreAmt <= 0) depleted = true;
      else if (m.out.length === 0 && !halfSkip(run, m)) {
        m.progress++;
        working = true;
        if (m.progress >= B.period / run.mods.extractMult) {
          m.progress = 0;
          t.oreAmt--;
          m.out.push(t.ore);
          tryEject(run, m);
        }
      }
    } else if (m.type === 'smelter') {
      if (!m.job && m.out.length === 0) {
        let r = null;
        if ((m.input.ironOre || 0) >= 1) r = 'smeltIron';
        else if ((m.input.copperOre || 0) >= 1) r = 'smeltCopper';
        if (r) {
          if (m.fuel <= 0 && (m.input.coal || 0) > 0) {
            m.input.coal--;
            m.fuel = D.FUEL_PER * (run.mods.coalX2 ? 2 : 1);
          }
          if (m.fuel > 0) {
            m.fuel--; // one smelt per fuel unit
            const rec = D.RECIPES[r];
            for (const k in rec.in) m.input[k] -= rec.in[k];
            m.job = r;
            m.progress = 0;
          } else nofuel = true;
        }
      }
      if (m.job && !halfSkip(run, m)) {
        m.progress++;
        working = true;
        const rec = D.RECIPES[m.job];
        if (m.progress >= rec.ticks / run.mods.smeltMult) {
          for (const k in rec.out) for (let i = 0; i < rec.out[k]; i++) m.out.push(k);
          m.job = null;
          m.progress = 0;
          tryEject(run, m);
        }
      }
    } else if (m.type === 'assembler') {
      if (!m.recipe) m.recipe = 'gear';
      if (!m.job && m.out.length === 0) {
        const rec = D.RECIPES[m.recipe];
        let can = true;
        for (const k in rec.in) if ((m.input[k] || 0) < rec.in[k]) { can = false; break; }
        if (can) {
          for (const k in rec.in) m.input[k] -= rec.in[k];
          m.job = m.recipe;
          m.progress = 0;
        }
      }
      if (m.job && !halfSkip(run, m)) {
        m.progress++;
        working = true;
        const rec = D.RECIPES[m.job];
        if (m.progress >= rec.ticks) {
          for (const k in rec.out) for (let i = 0; i < rec.out[k]; i++) m.out.push(k);
          m.job = null;
          m.progress = 0;
          tryEject(run, m);
        }
      }
    } else if (m.type === 'damper') {
      if (m.fuel <= 0 && (m.input.coal || 0) > 0) { m.input.coal--; m.fuel = B.coalTicks; }
      if (m.fuel > 0) { m.fuel--; working = true; }
      else nofuel = true;
    }
    m.status = depleted ? 'depleted'
      : m.hp === 1 ? 'damaged'
      : nofuel ? 'nofuel'
      : m.out.length ? 'blocked'
      : (working || m.job) ? 'ok' : 'idle';
    // v1.1 (SPEC2 §B) debounce stamps: run.t of when the underlying condition
    // began, 0 while clear. Based on the raw condition (not display precedence)
    // so a damaged-but-jammed machine still reads as jammed.
    if (m.out.length) { if (!m.blockedSince) m.blockedSince = run.t; }
    else m.blockedSince = 0;
    if (nofuel) { if (!m.nofuelSince) m.nofuelSince = run.t; }
    else m.nofuelSince = 0;
    if (depleted && !wasDepleted) {
      pushEvent(run, 'depleted', { id: m.id, x: m.x, y: m.y,
        ore: (tileAt(run, m.x, m.y) || {}).ore || null });
    }
  }

  // ---------------- belts (§5.2) ----------------
  function stepBelts(run) {
    const W = D.MAP_W, H = D.MAP_H, g = run.grid;
    const belts = []; // row-major, loaded belts only
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const b = g[y][x].belt;
        if (b) { b.moved = false; if (b.item) belts.push({ x: x, y: y, b: b }); }
      }
    for (let pass = 0; pass < 60; pass++) {
      let moved = false;
      for (const e of belts) {
        const b = e.b;
        if (!b.item || b.moved) continue;
        const d = D.DIRS[b.dir];
        const tx = e.x + d.dx, ty = e.y + d.dy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const t = g[ty][tx];
        if (t.machine !== null) {
          const m = run.machines[t.machine];
          if (!m) continue;
          if (m.id === 0) {
            add(run.inv, b.item, 1);
            b.item = null; b.moved = true; moved = true;
          } else if (machineAccepts(run, m, b.item)) {
            add(m.input, b.item, 1);
            b.item = null; b.moved = true; moved = true;
          }
        } else if (t.belt && t.belt.item === null) {
          t.belt.item = b.item;
          t.belt.moved = true;
          b.item = null; b.moved = true; moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // ---------------- drill (§5.7) ----------------
  function drillPeriod(run) {
    return Math.max(1, Math.round(D.DRILL_PERIOD / run.mods.drillMult /
      (run.overdrive ? D.OVERDRIVE.drillMult : 1)));
  }
  function stepDrill(run) {
    if (run.gearsFed < run.breachReq.gear && (run.inv.gear || 0) > 0) {
      run.inv.gear--;
      run.gearsFed++;
      run._feed.push({ t: run.t, item: 'gear' });
      if (run.stats) run.stats.lastFeedT = run.totalT;
    } else if (run.chargesFed < run.breachReq.charge && (run.inv.charge || 0) > 0) {
      run.inv.charge--;
      run.chargesFed += run.mods.chargeX2 ? 2 : 1;
      run._feed.push({ t: run.t, item: 'charge' });
      if (run.stats) run.stats.lastFeedT = run.totalT;
    }
    while (run._feed.length && run._feed[0].t < run.t - 10 * HZ) run._feed.shift();
  }
  function feedRate(run) {
    const win = Math.min(10, Math.max(1, run.t / HZ));
    let g = 0, c = 0;
    for (const f of run._feed)
      if (f.t >= run.t - 10 * HZ) { if (f.item === 'gear') g++; else c++; }
    return { gearPerSec: g / win, chargePerSec: c / win };
  }

  // ---------------- instability & quakes (§5.5) ----------------
  function instRate(run) {
    let rate = stratumOf(run).instabRate * run.mods.instMult;
    if (run.overdrive)
      rate *= run.mods.overCheap ? 1 + (D.OVERDRIVE.instMult - 1) / 2 : D.OVERDRIVE.instMult;
    let dampers = 0;
    for (const id in run.machines) {
      const m = run.machines[id];
      if (m.type === 'damper' && m.fuel > 0 && dampers < D.DAMPER_MAX) dampers++;
    }
    for (let i = 0; i < dampers; i++) rate *= 1 - D.BUILDINGS.damper.calm;
    return rate;
  }

  function damageMachine(run, m) {
    if (!m || m.id === 0) return;
    m.hp--;
    if (m.hp <= 0) {
      destroyMachine(run, m);
      msg(run, D.BUILDINGS[m.type].name + ' destroyed!', D.COLORS.red);
    } else if (m.hp === 1 && run.mods.autoRepair) {
      m.repairAt = run.t + 15 * HZ;
    }
  }
  function destroyMachine(run, m) {
    for (let y = m.y; y < m.y + m.h; y++)
      for (let x = m.x; x < m.x + m.w; x++) {
        const t = tileAt(run, x, y);
        if (t && t.machine === m.id) t.machine = null;
      }
    delete run.machines[m.id];
  }

  function stepQuake(run) {
    const Q = D.QUAKE;
    if (run.quakeAt > 0 && run.t >= run.quakeAt) {
      run.quakeAt = 0;
      fireQuake(run);
    } else if (run.quakeAt === 0 && run.instability >= Q.startInst) {
      const f = (run.instability - Q.startInst) / (100 - Q.startInst);
      let secs = stratumOf(run).quakeBase + (Q.collapseIvl - stratumOf(run).quakeBase) * f;
      secs *= 1 + (run.rng() * 2 - 1) * Q.jitter;
      run.quakeAt = run.t + Math.max(1, Math.round(secs * HZ));
    }
  }

  function fireQuake(run) {
    const Q = D.QUAKE;
    const n = Q.tiles(run.instability, run.depth);
    const built = [], floors = [];
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (t.belt || (t.machine !== null && t.machine !== 0)) built.push({ x: x, y: y });
        if (t.t === 'floor' && t.revealed && t.machine !== 0) floors.push({ x: x, y: y });
      }
    for (let i = 0; i < n; i++) {
      const useBuilt = built.length && (run.rng() < 0.55 || !floors.length);
      if (useBuilt) {
        const c = U.pick(run.rng, built);
        const t = run.grid[c.y][c.x];
        if (t.belt) t.belt = null; // item lost
        else if (t.machine !== null && t.machine !== 0) damageMachine(run, run.machines[t.machine]);
      } else if (floors.length) {
        const c = U.pick(run.rng, floors);
        const t = run.grid[c.y][c.x];
        if (t.machine !== null) damageMachine(run, run.machines[t.machine]);
        else { t.rubble = true; t.belt = null; }
      }
    }
    const dmg = Q.integrityDmg(run.instability, run.depth);
    run.integrity -= dmg;
    run.shake = true;
    if (run.instability >= 99) msg(run, '!! COLLAPSE — the stratum is failing !!', D.COLORS.red);
    else msg(run, '≋ QUAKE — the stratum shudders (−' + dmg + ' integrity)', D.COLORS.orange);
    pushEvent(run, 'quake', { dmg: dmg });
  }

  // ---------------- magma (§5.5) ----------------
  function stepMagma(run) {
    if (run.magmaCap <= 0) return;
    const M = D.MAGMA, W = D.MAP_W, H = D.MAP_H, g = run.grid;
    function adjMagma(x, y) {
      for (const d of D.DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && g[ny][nx].t === 'magma') return true;
      }
      return false;
    }
    if (run.t % M.period === 0) {
      let count = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (g[y][x].t === 'magma') count++;
      const cand = [];
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const t = g[y][x];
          if (t.t === 'floor' && t.machine !== 0 && adjMagma(x, y)) cand.push({ x: x, y: y });
        }
      let spread = 0;
      for (const c of cand) {
        if (count >= run.magmaCap) break;
        if (run.rng() < M.spreadChance) {
          const t = g[c.y][c.x];
          if (t.machine !== null) {
            const m = run.machines[t.machine];
            if (m) { destroyMachine(run, m); msg(run, D.BUILDINGS[m.type].name + ' swallowed by magma!', D.COLORS.magma); }
          }
          t.belt = null; t.ore = null; t.oreAmt = 0; t.rubble = false; t.digT = 0;
          t.t = 'magma';
          count++; spread++;
        }
      }
      if (spread > 0) {
        msg(run, '≈ magma claims new ground ≈', D.COLORS.magma);
        pushEvent(run, 'magma', { tiles: spread });
      }
    }
    if (run.t % M.burnPeriod === 0) {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const t = g[y][x];
          if (t.belt && adjMagma(x, y)) t.belt = null;
        }
      const ids = Object.keys(run.machines).map(Number).sort((a, b) => a - b);
      for (const id of ids) {
        const m = run.machines[id];
        if (!m) continue;
        let adj = false;
        for (let y = m.y; y < m.y + m.h && !adj; y++)
          for (let x = m.x; x < m.x + m.w && !adj; x++)
            if (adjMagma(x, y)) adj = true;
        if (!adj) continue;
        if (id === 0) {
          run.integrity -= M.hubBurn;
          msg(run, 'Magma sears the rig hull!', D.COLORS.magma);
        } else damageMachine(run, m);
      }
    }
  }

  // ---------------- building (§5.9) ----------------
  function canPlace(run, type, x, y, facing) {
    const B = D.BUILDINGS[type];
    if (!B || type === 'hub') return { ok: false, reason: 'unknown structure' };
    for (let ty = y; ty < y + B.h; ty++)
      for (let tx = x; tx < x + B.w; tx++) {
        const t = tileAt(run, tx, ty);
        if (!t) return { ok: false, reason: 'out of bounds' };
        if (!t.revealed) return { ok: false, reason: 'unscanned ground' };
        if (t.t !== 'floor') return { ok: false, reason: 'needs open floor' };
        if (t.rubble) return { ok: false, reason: 'blocked by rubble' };
        if (t.machine !== null) return { ok: false, reason: 'blocked by structure' };
        if (t.belt) return { ok: false, reason: 'blocked by belt' };
      }
    if (type === 'extractor' && !tileAt(run, x, y).ore)
      return { ok: false, reason: 'needs an ore vein' };
    if (!(type === 'belt' && run.mods.beltFree))
      for (const k in B.cost)
        if ((run.inv[k] || 0) < B.cost[k])
          return { ok: false, reason: 'need ' + B.cost[k] + ' ' + D.ITEMS[k].name };
    return { ok: true };
  }

  function place(run, type, x, y, facing) {
    if (!canPlace(run, type, x, y, facing).ok) return false;
    const B = D.BUILDINGS[type];
    if (!(type === 'belt' && run.mods.beltFree))
      for (const k in B.cost) run.inv[k] = (run.inv[k] || 0) - B.cost[k];
    if (run.stats) { // v1.1 (SPEC2 §B)
      run.stats.placed[type] = (run.stats.placed[type] || 0) + 1;
      run.stats.lastPlaceT = run.totalT;
    }
    if (type === 'belt') {
      run.grid[y][x].belt = { dir: facing, item: null, moved: false };
      return true;
    }
    const id = run.nextId++;
    run.machines[id] = {
      id: id, type: type, x: x, y: y, w: B.w, h: B.h, facing: facing, hp: B.hp,
      progress: 0, recipe: type === 'assembler' ? 'gear' : null,
      input: {}, fuel: 0, status: 'idle', repairAt: 0,
      blockedSince: 0, nofuelSince: 0, out: [], job: null,
    };
    for (let ty = y; ty < y + B.h; ty++)
      for (let tx = x; tx < x + B.w; tx++) run.grid[ty][tx].machine = id;
    return true;
  }

  function demolishAt(run, x, y) {
    const t = tileAt(run, x, y);
    if (!t) return { ok: false, reason: 'out of bounds' };
    if (t.machine !== null) {
      if (t.machine === 0) return { ok: false, reason: 'the rig is not yours to scrap' };
      const m = run.machines[t.machine];
      const B = D.BUILDINGS[m.type];
      for (const k in B.cost) add(run.inv, k, Math.floor(B.cost[k] * D.DEMOLISH_REFUND));
      for (const k in m.input) if (m.input[k] > 0) add(run.inv, k, m.input[k]);
      destroyMachine(run, m);
      return { ok: true };
    }
    if (t.belt) {
      if (!run.mods.beltFree)
        for (const k in D.BUILDINGS.belt.cost) add(run.inv, k, D.BUILDINGS.belt.cost[k]);
      t.belt = null; // any item is lost
      return { ok: true };
    }
    if (t.rubble) {
      if (t.digT > 0) return { ok: false, reason: 'already clearing' };
      t.digT = D.DIG_RUBBLE;
      return { ok: true };
    }
    if (t.t === 'rock') {
      if (!t.revealed) return { ok: false, reason: 'unscanned ground' };
      if (t.digT > 0) return { ok: false, reason: 'already excavating' };
      t.digT = D.DIG_ROCK;
      return { ok: true };
    }
    if (t.t === 'obsidian' || t.t === 'chasm' || t.t === 'magma')
      return { ok: false, reason: 'cannot excavate ' + t.t };
    return { ok: false, reason: 'nothing to demolish' };
  }

  function clickTile(run, x, y) {
    const t = tileAt(run, x, y);
    if (!t || t.machine === null) return { handled: false };
    const m = run.machines[t.machine];
    if (!m) return { handled: false };
    if (m.id !== 0 && m.hp === 1) {
      const cost = run.mods.repairCost;
      if ((run.inv.ironPlate || 0) >= cost) {
        run.inv.ironPlate -= cost;
        m.hp = D.BUILDINGS[m.type].hp;
        m.repairAt = 0;
        // kind lets the engine distinguish repairs (v1.1 barks) without msg-sniffing
        return { handled: true, kind: 'repair',
                 msg: D.BUILDINGS[m.type].name + ' repaired (−' + cost + ' plate)' };
      }
      return { handled: true, msg: 'repair needs ' + cost + ' iron plate' };
    }
    if (m.id === 0) {
      toggleOverdrive(run); // logs its own message; no msg here (engine echoes msg)
      return { handled: true };
    }
    if (m.type === 'assembler') {
      const list = D.ASSEMBLER_RECIPES.filter(r => r !== 'bronzeGear' || run.mods.bronzeGear);
      m.recipe = list[(list.indexOf(m.recipe) + 1) % list.length];
      const out = Object.keys(D.RECIPES[m.recipe].out)[0];
      return { handled: true, msg: 'assembler → ' + D.ITEMS[out].name };
    }
    return { handled: false };
  }

  function toggleOverdrive(run) {
    run.overdrive = !run.overdrive;
    msg(run, run.overdrive ? '≫ OVERDRIVE engaged — the rig howls.' : 'Overdrive disengaged.',
        run.overdrive ? D.COLORS.red : D.COLORS.gray);
  }

  // ---------------- descent (§5.9) ----------------
  function offerSchematics(run) {
    let pool = D.SCHEMATICS.map(s => s.id).filter(id => run.schematics.indexOf(id) < 0);
    pool = U.shuffle(run.rng, pool);
    const offers = pool.slice(0, run.mods.offerCount);
    if (offers.length < run.mods.offerCount) {
      const rep = U.shuffle(run.rng, ['s_extract', 's_smelt', 's_plate', 's_veins']);
      for (const id of rep) {
        if (offers.length >= run.mods.offerCount) break;
        if (offers.indexOf(id) < 0) offers.push(id);
      }
    }
    return offers;
  }

  function beginDescent(run) {
    if (run.status !== 'breachReady') return false;
    if (run.mods.salvage > 0) {
      let back = 0;
      for (const id in run.machines) {
        const m = run.machines[id];
        if (m.id === 0) continue;
        const B = D.BUILDINGS[m.type];
        for (const k in B.cost) {
          const n = Math.floor(B.cost[k] * run.mods.salvage);
          if (n > 0) { add(run.inv, k, n); back += n; }
        }
      }
      if (back > 0) msg(run, 'Salvage claws recover ' + back + ' parts.', D.COLORS.green);
    }
    run.breaches++;
    if (run.depth === D.STRATA_COUNT && !run.mantle) {
      run.status = 'won';
      setResult(run, true);
      pushEvent(run, 'won', { depth: run.depth });
      return true;
    }
    run.pendingOffers = offerSchematics(run);
    pushEvent(run, 'descend', { from: run.depth, to: run.depth + 1 });
    return true;
  }

  function continueIntoMantle(run) {
    run.mantle = true;
    run.pendingOffers = offerSchematics(run);
  }

  function applySchematic(run, id) {
    run.schematics.push(id);
    applySchematicMod(run, id);
    run.depth++;
    startStratum(run);
    run.pendingOffers = null;
    const s = D.SCHEMATICS.filter(x => x.id === id)[0];
    msg(run, 'Schematic installed: ' + (s ? s.name : id), D.COLORS.cyan);
    msg(run, '▼ Descending — stratum ' + run.depth + '.', D.COLORS.amber);
  }

  function abandon(run) {
    run.status = 'dead';
    setResult(run, false);
    pushEvent(run, 'death', { depth: run.depth, cause: 'abandon' });
  }

  // ---------------- tooltip (§5.9) ----------------
  function describeTile(run, x, y) {
    const t = tileAt(run, x, y);
    if (!t) return [];
    if (!t.revealed) return [{ text: 'unscanned depths', color: D.COLORS.darkgray }];
    const L = [];
    if (t.machine !== null && run.machines[t.machine]) {
      const m = run.machines[t.machine];
      if (m.id === 0) {
        L.push({ text: 'DRILL RIG', color: D.COLORS.amber });
        L.push({ text: 'integrity ' + Math.max(0, Math.ceil(run.integrity)) + '/' + run.maxIntegrity,
                 color: D.COLORS.gray });
        L.push({ text: 'click: toggle overdrive', color: D.COLORS.amberDim });
        return L;
      }
      const B = D.BUILDINGS[m.type];
      L.push({ text: B.name.toUpperCase() + ' [' + m.status + ']',
               color: m.status === 'ok' ? D.COLORS.green
                    : m.status === 'idle' ? D.COLORS.gray : D.COLORS.red });
      if (m.hp === 1)
        L.push({ text: 'damaged — click: repair (' + run.mods.repairCost + ' plate)', color: D.COLORS.red });
      if (m.type === 'assembler') {
        const out = Object.keys(D.RECIPES[m.recipe || 'gear'].out)[0];
        L.push({ text: 'recipe: ' + D.ITEMS[out].name + ' (click cycles)', color: D.COLORS.blue });
      }
      if (m.type === 'smelter' || m.type === 'damper')
        L.push({ text: 'fuel ' + m.fuel + ((m.input.coal || 0) > 0 ? ' (+' + m.input.coal + ' coal)' : ''),
                 color: D.COLORS.orange });
      if (m.type === 'extractor') {
        const ot = tileAt(run, m.x, m.y);
        if (ot && ot.ore)
          L.push({ text: D.ITEMS[ot.ore].name + ' — ' + ot.oreAmt + ' left', color: D.ORE_GLYPHS[ot.ore].color });
      }
      const buf = Object.keys(m.input).filter(k => m.input[k] > 0)
        .map(k => m.input[k] + ' ' + D.ITEMS[k].name).join(', ');
      if (buf) L.push({ text: 'buffer: ' + buf, color: D.COLORS.gray });
      return L.slice(0, 5);
    }
    if (t.belt) {
      L.push({ text: 'belt ' + D.ARROWS[t.belt.dir] +
               (t.belt.item ? ' — carrying ' + D.ITEMS[t.belt.item].name : ''), color: D.COLORS.cyan });
      return L;
    }
    if (t.digT > 0) return [{ text: 'excavating — ' + Math.ceil(t.digT / HZ) + 's', color: D.COLORS.amber }];
    if (t.rubble) return [{ text: 'rubble — demolish (X) to clear', color: D.COLORS.gray }];
    if (t.ore) {
      L.push({ text: D.ITEMS[t.ore].name + ' vein — ' + t.oreAmt, color: D.ORE_GLYPHS[t.ore].color });
      L.push({ text: 'place an extractor here', color: D.COLORS.amberDim });
      return L;
    }
    if (t.t === 'rock') return [{ text: 'rock — demolish (X) to excavate', color: D.COLORS.rock }];
    if (t.t === 'obsidian') return [{ text: 'obsidian — impassable glass', color: D.COLORS.magenta }];
    if (t.t === 'chasm') return [{ text: 'chasm — a long way down', color: D.COLORS.blue }];
    if (t.t === 'magma') return [{ text: 'magma — it spreads', color: D.COLORS.magma }];
    return [{ text: 'bare floor', color: D.COLORS.darkgray }];
  }

  DC.Sim = {
    newRun: newRun, startStratum: startStratum, tick: tick,
    canPlace: canPlace, place: place, demolishAt: demolishAt,
    clickTile: clickTile, toggleOverdrive: toggleOverdrive,
    beginDescent: beginDescent, continueIntoMantle: continueIntoMantle,
    applySchematic: applySchematic, abandon: abandon,
    describeTile: describeTile, feedRate: feedRate, msg: msg,
  };
})();
