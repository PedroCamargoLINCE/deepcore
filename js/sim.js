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
  // Something arrived at the RIG — off a belt or straight out of a machine
  // facing her. The two call sites used to be bare `add`s, and nothing anywhere
  // could tell "the base produces" from "the base delivers", which is the exact
  // difference the tutorial's fourth beat is about (M-ONBOARD Part 2). Counting
  // it costs one integer and no roll, so the sim stays byte-identical for every
  // run that never asks.
  function deliver(run, item) {
    add(run.inv, item, 1);
    if (run.stats) run.stats.delivered = (run.stats.delivered || 0) + 1;
  }
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
  // Roman numeral for the named-collapse counter (M-GRITPLUS). ASCII letters
  // only: the Unicode roman-numeral block is a hole in several platform fonts,
  // and a tremor nobody can read is not dread, it's a tofu box.
  const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'],
                 [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'],
                 [5, 'V'], [4, 'IV'], [1, 'I']];
  function roman(n) {
    n = Math.max(1, Math.min(3999, Math.floor(n || 1)));
    let s = '';
    for (const [v, sym] of ROMAN) while (n >= v) { s += sym; n -= v; }
    return s;
  }

  // ---------------- M-ONBOARD: diagnostics (SPEC3 M-ONBOARD Part 1) ---------
  // The director could not play his own game while all five suites were green:
  // an extractor placed on a vein with no belt on its output mines one ore,
  // sets status 'blocked', and sits there forever. Over 600 ticks it emitted
  // ZERO log messages, and the red '!' render draws over it says nothing about
  // which of three faults it means. The mechanics were sound; the teaching was
  // absent — a §0 law 6 failure of the first order.
  //
  // So every failure state names its own cause, ONCE PER RUN PER CAUSE, in the
  // SYSTEM's voice: what is wrong first, then what to do about it, plainly.
  // GRIT may editorialize on top afterwards (engine.js drains the 'diagnostic'
  // event and asks Barks.diag), but he never carries the information — law 3
  // says he does not explain mechanics, and law 6 outranks the joke.
  //
  // Determinism (law 7): nothing here rolls. Thresholds are read off run.t, the
  // wording is a pure function of state, and the only writes are run.messages
  // and the event queue — so a run plays out identically whether or not anyone
  // is reading the log, and the quake schedule never moves because a player
  // left a belt disconnected.
  //
  // Where a missing item comes from, for the fix half of a starvation line.
  const ITEM_SOURCE = {
    ironOre: 'mine it from an iron vein', copperOre: 'mine it from a copper vein',
    coal: 'mine it from a coal vein', crystal: 'mine it from a crystal vein',
    ironPlate: 'a smelter makes it from ore',
    copperPlate: 'a smelter makes it from ore',
  };

  // Every sentence the diagnostics can produce. Kept in one function so the
  // suites can enumerate the lot (Sim.diagLines) and hold every one of them to
  // the LOG panel's 3x29 budget — the strings are too long to survive the
  // regex-scrape that covers the plain msg() literals elsewhere in this file.
  function diagLine(cause, c) {
    c = c || {};
    switch (cause) {
      case 'blocked':
        return 'Output blocked: the ' + c.name +
               ' is full. Lay a belt on its output side (R rotates).';
      case 'nofuel':
        return 'The ' + c.name + ' is out of coal. Mine a coal vein and belt the coal in.';
      case 'depleted':
        return 'That vein is mined out. The extractor on it has stopped for good' +
               ' — X demolishes it.';
      // One cause, two shapes: a line laid into bare rock and a line laid into
      // something that will not take what it is carrying look identical on the
      // map, and want opposite fixes.
      case 'beltJam':
        return c.name
          ? 'Belt jam: the ' + c.name + ' will not take ' + c.item + '. Check what it takes.'
          : 'Belt jam: this line ends on bare ground. A belt must feed a machine or the rig.';
      case 'starved':
        return 'The assembler has no ' + c.item + ' — ' +
               (ITEM_SOURCE[c.id] || 'it has to come from somewhere') + '. Belt it in.';
      // The rig's two wants are separate causes on purpose: they stall a run at
      // different times and the fix is a different recipe, so hearing one must
      // not spend the other's single mention.
      case 'stallGear':
        return 'The rig is waiting for drill gears. An assembler makes them from iron plate.';
      case 'stallCharge':
        return 'The rig is waiting for core charges. An assembler makes them from crystal.';
    }
    return null;
  }

  // Name a cause once per RUN — not per machine, and not per tick. A message
  // that repeats is a message players learn to ignore. Returns true if it spoke.
  function diag(run, cause, ctx) {
    if (!run.diag) run.diag = {};      // runs built before this brief, and tests
    if (run.diag[cause]) return false;
    const text = diagLine(cause, ctx);
    if (!text) return false;
    run.diag[cause] = run.totalT + 1;  // stamp, always truthy (totalT can be 0)
    msg(run, text, D.COLORS.amber);
    pushEvent(run, 'diagnostic', { cause: cause });
    return true;
  }

  // Every line diagLine can emit, with the worst case filled in for each
  // substitution. test/barks_test.js wraps all of them into the LOG panel.
  function diagLines() {
    const names = D.BUILD_ORDER.map(k => D.BUILDINGS[k].name);
    const items = D.ITEM_ORDER.map(k => D.ITEMS[k].name);
    const out = ['depleted', 'stallGear', 'stallCharge'].map(c => diagLine(c, {}));
    out.push(diagLine('beltJam', {}));
    for (const name of names) {
      out.push(diagLine('blocked', { name: name }));
      out.push(diagLine('nofuel', { name: name }));
      for (const item of items) out.push(diagLine('beltJam', { name: name, item: item }));
    }
    for (const id of D.ITEM_ORDER)
      out.push(diagLine('starved', { id: id, item: D.ITEMS[id].name }));
    return out;
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
      // M-ONBOARD: causes already named this run. Per RUN, not per stratum —
      // startStratum deliberately does not clear it, because the lesson does
      // not need re-teaching one floor down.
      diag: {},
      stats: { placed: {}, lastPlaceT: 0, lastFeedT: 0, delivered: 0 },
      foreman: null,
      // M-CORELORE: how many Core Gate beats this run has passed (0..3), and
      // the fake ascend prompt barks.js may put on screen. M-GRITPLUS: the
      // per-stratum tremor counter and the EGG-420 window.
      coreBeat: 0, coreOffer: null, tremor: 0, egg: null, eggSeen: false,
      // M-WONDERS: this stratum's landmark (mapgen decides which and where;
      // everything below `cells` is the state a player's clicks write).
      landmark: null,
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
    // M-WONDERS: mapgen may legally return no landmark (a map that could not
    // fit one without breaking a mapgen invariant ships without a wonder), so
    // every consumer treats `run.landmark === null` as the ordinary case.
    run.landmark = gen.landmark
      ? { id: gen.landmark.id, x: gen.landmark.x, y: gen.landmark.y,
          cx: gen.landmark.cx, cy: gen.landmark.cy, cells: gen.landmark.cells,
          on: false, onAt: 0, jam: false, fired: false, found: false }
      : null;
    run.t = 0;
    run.instability = Math.max(0, run.instability - D.DESCEND_VENT);
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
           starveSince: 0, out: [], job: null },
    };
    run.nextId = 1;
    run.quakeAt = 0;
    run.tremor = 0;          // M-GRITPLUS: named collapses count per stratum
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

  // ---------------- M-WONDERS: stratum landmarks (SPEC3) ----------------
  // One helper pair, as the brief demands: `landmarkAt` answers "what is this
  // tile", `auraMult` answers "does this machine stand in a wonder's light".
  // Everything else in sim consults those two and nothing else, so a landmark
  // can never grow a second, divergent idea of its own radius.
  //
  // Auras are measured from the machine's ANCHOR tile (m.x, m.y), which is the
  // same tile the player pointed at when placing it — a 2x2 smelter is in or
  // out by its top-left corner, and the tooltip radius reads true.
  function lmDef(run) {
    const lm = run && run.landmark;
    return lm ? (D.LANDMARK_BY_ID || {})[lm.id] || null : null;
  }
  function landmarkAt(run, x, y) {
    const t = tileAt(run, x, y);
    return t && t.lm ? (D.LANDMARK_BY_ID || {})[t.lm.id] || null : null;
  }
  // The Drowned Machine's nap, derived from the tick clock rather than rolled:
  // she runs for (every - dur) seconds and sleeps for dur, forever, and two
  // runs on the same seed nap on the same ticks.
  function lmJammed(run) {
    const def = lmDef(run), lm = run.landmark;
    if (!def || !def.jam || !lm || !lm.on) return false;
    const cyc = def.jam.every * HZ, dur = def.jam.dur * HZ;
    return ((run.t - lm.onAt) % cyc) >= cyc - dur;
  }
  // The landmark's effects, or null while it is dormant — unpaid, or napping.
  function lmLive(run) {
    const def = lmDef(run);
    if (!def) return null;
    if (def.cost && !run.landmark.on) return null;
    if (lmJammed(run)) return null;
    return def;
  }
  function inAura(run, r, x, y) {
    const lm = run.landmark;
    const dx = x - lm.cx, dy = y - lm.cy;
    return dx * dx + dy * dy <= r * r;
  }
  // Multiplier for `kind` ('smelt' | 'extract' | 'damper') at (x, y). Aura
  // values in data.js are additive fractions: 0.15 -> x1.15, 1 -> x2.
  function auraMult(run, kind, x, y) {
    const def = lmLive(run);
    if (!def || !def.aura || !def.aura[kind]) return 1;
    return inAura(run, def.aura.r, x, y) ? 1 + def.aura[kind] : 1;
  }
  // The Warm Spot: quakes may not choose a tile inside it.
  function quakeSafe(run, x, y) {
    const def = lmLive(run);
    if (!def || !def.quakeSafe || !def.aura) return false;
    return inAura(run, def.aura.r, x, y);
  }

  // Per-tick landmark upkeep: the Mirror Pool's one-shot bounce and the
  // Drowned Machine's nap edges. Draws nothing from run.rng.
  function stepLandmark(run) {
    const lm = run.landmark, def = lmDef(run);
    if (!lm || !def) return;
    // Discovery, not arrival: GRIT reacts when the scan actually finds the
    // thing. The delay is not flavour — the stratum-arrival bark flushes off
    // the queue around 6s and holds the bar for another 6, so a line fired the
    // moment the sweep touched a landmark would be silently swallowed on most
    // strata. This waits for the far side of that window.
    if (!lm.found && run.t > (D.LANDMARK_BARK_T || 14) * HZ) {
      for (const c of lm.cells) {
        const t = tileAt(run, c.x, c.y);
        if (t && t.revealed) {
          lm.found = true;
          pushEvent(run, 'landmark', { id: def.id, act: 'find' });
          break;
        }
      }
    }
    if (def.mirror && !lm.fired) {
      let seen = true;
      for (const c of lm.cells) {
        const t = tileAt(run, c.x, c.y);
        if (t && !t.revealed) { seen = false; break; }
      }
      if (seen) {
        lm.fired = true;
        const W = D.MAP_W, mirrored = [];
        for (let y = 0; y < D.MAP_H; y++)
          for (let x = 0; x < W; x++)
            if (run.grid[y][x].revealed) mirrored.push([W - 1 - x, y]);
        for (const p of mirrored) run.grid[p[1]][p[0]].revealed = true;
        msg(run, 'The pool throws the scan back. The far side is drawn.', D.COLORS.cyan);
        pushEvent(run, 'landmark', { id: def.id, act: 'use' });
      }
    }
    if (def.jam && lm.on) {
      const j = lmJammed(run);
      if (j !== !!lm.jam) {
        lm.jam = j;
        msg(run, j ? 'The drowned machine slows, and sleeps.'
                   : 'The drowned machine wakes, and bites.',
            j ? D.COLORS.gray : D.COLORS.green);
      }
    }
  }

  // The Company Seal's reward: a schematic, installed rather than offered —
  // there is no descent screen open to choose on. It goes through the same
  // `applySchematicMod` every descent pick does, so a sealed hatch can never
  // grant an effect the schematic screen cannot.
  function grantSchematic(run) {
    const pool = D.SCHEMATICS.map(s => s.id).filter(id => run.schematics.indexOf(id) < 0);
    if (!pool.length) return null;
    const id = pool[Math.floor(run.rng() * pool.length)];
    run.schematics.push(id);
    applySchematicMod(run, id);
    return id;
  }

  // A click on landmark ground. Returns the same shape as clickTile.
  function clickLandmark(run, t) {
    const def = (D.LANDMARK_BY_ID || {})[t.lm.id], lm = run.landmark;
    if (!def || !lm || lm.id !== def.id) return { handled: false };
    if (!def.cost && !def.ring) return { handled: false };
    if (lm.on) return { handled: true, msg: def.doneMsg || 'nothing left to do here' };
    for (const k in (def.cost || {}))
      if ((run.inv[k] || 0) < def.cost[k])
        return { handled: true, msg: 'need ' + def.cost[k] + ' ' + D.ITEMS[k].name };
    for (const k in (def.cost || {})) run.inv[k] -= def.cost[k];
    lm.on = true;
    lm.onAt = run.t;
    let out = def.name.toLowerCase() + ' answers';
    if (def.ring) {
      // The Bell: the whole stratum gets richer and angrier at once.
      for (let y = 0; y < D.MAP_H; y++)
        for (let x = 0; x < D.MAP_W; x++) {
          const tt = run.grid[y][x];
          if (tt.ore && tt.oreAmt > 0) tt.oreAmt = Math.round(tt.oreAmt * def.ring.veinMult);
        }
      run.instability = U.clamp(run.instability + def.ring.inst, 0, D.INSTAB_MAX);
      msg(run, 'The bell rings. Every vein here answers it.', D.COLORS.orange);
      out = 'the stratum is richer, and listening';
    }
    if (def.grant === 'schematic') {
      const id = grantSchematic(run);
      const s = id && D.SCHEMATICS.filter(x => x.id === id)[0];
      msg(run, 'The seal breaks. Company property: ' + (s ? s.name : 'nothing'),
          D.COLORS.cyan);
      out = s ? 'schematic recovered: ' + s.name : 'the vault was already emptied';
      // M-EVENTS: a Company hatch is also a Company FILE. Whoever welded this
      // one shut wrote something down first, and it goes in the logbook.
      if (DC.Events && DC.Events.grantLog) DC.Events.grantLog(run);
    }
    pushEvent(run, 'landmark', { id: def.id, act: 'use' });
    return { handled: true, kind: 'landmark', msg: out };
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
          // M-WONDERS: a Glass Forest spire is the one landmark tile that can
          // be excavated, and it pays out on the way down.
          const ld = t.lm ? (D.LANDMARK_BY_ID || {})[t.lm.id] : null;
          if (ld && ld.dig) {
            t.t = 'floor';
            t.lm = null;
            add(run.inv, ld.dig.yield, 1);
            msg(run, 'A spire comes down — 1 ' + D.ITEMS[ld.dig.yield].name + '.',
                D.ITEMS[ld.dig.yield].color);
            pushEvent(run, 'landmark', { id: ld.id, act: 'use' });
          } else if (t.t === 'rock') {
            t.t = 'floor';
            // M-EVENTS: the rock has things in it. Guarded, so a tree without
            // js/events.js digs exactly as it always did — and that module
            // rolls on its own derived stream, so a find can never move the
            // quake schedule out from under a dig.
            if (DC.Events && DC.Events.rollDig) DC.Events.rollDig(run, x, y);
          }
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
    // M-ONBOARD Part 2: the pressure pause. While `instHold` is set the floor
    // does not tighten at all — instability is what schedules quakes, so a
    // frozen gauge means no quake can be scheduled, and nobody loses their
    // first run to one while reading a punchline. js/tutorial.js sets the flag
    // when the induction arms and clears it the instant the first ore reaches
    // the rig; no other caller sets it, so every run in test/balance.js and
    // every run a returning player starts is arithmetically untouched.
    if (!run.instHold)
      run.instability = U.clamp(run.instability + instRate(run) / HZ, 0, 100);
    stepLandmark(run);
    stepEgg(run);
    stepCoreGate(run);
    stepQuake(run);
    stepMagma(run);
    // M-EVENTS: the gas pocket's one-second fuse and the cat's next step.
    // After the hazards on purpose — the cat bolts for the rig off a quake
    // that was scheduled on this very tick, which is the whole trick.
    if (DC.Events && DC.Events.tick) DC.Events.tick(run);
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

  // Does this machine take this KIND of item at all, buffer capacity aside?
  // M-ONBOARD needs the two questions separated: a belt stopped against a
  // merely-full buffer is back-pressure, which is ordinary, while a belt
  // stopped against a machine that will never want its cargo is a mistake.
  // Teaching the first as if it were the second would be worse than silence.
  function machineWants(run, m, item) {
    if (m.type === 'hub') return true;
    if (m.type === 'smelter')
      return item === 'ironOre' || item === 'copperOre' || item === 'coal';
    if (m.type === 'assembler') return !!D.RECIPES[m.recipe || 'gear'].in[item];
    if (m.type === 'damper') return item === 'coal';
    return false;
  }

  function machineAccepts(run, m, item) {
    if (m.type === 'hub') return true;
    return machineWants(run, m, item) && (m.input[item] || 0) < D.INPUT_CAP;
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
        if (tm.id === 0) { deliver(run, item); m.out.shift(); continue; }
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
    // `missing` (M-ONBOARD) is the input an assembler is short of, or null —
    // the one fault the status word cannot express, because a starving
    // assembler and a brand new one both read 'idle'.
    let working = false, nofuel = false, depleted = false, missing = null;
    if (m.type === 'extractor') {
      const t = tileAt(run, m.x, m.y);
      if (!t || !t.ore || t.oreAmt <= 0) depleted = true;
      else if (m.out.length === 0 && !halfSkip(run, m)) {
        m.progress++;
        working = true;
        if (m.progress >= B.period /
            (run.mods.extractMult * auraMult(run, 'extract', m.x, m.y))) {
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
        if (m.progress >= rec.ticks /
            (run.mods.smeltMult * auraMult(run, 'smelt', m.x, m.y))) {
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
        for (const k in rec.in)
          if ((m.input[k] || 0) < rec.in[k]) { can = false; missing = k; break; }
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
    // M-ONBOARD: the same debounce shape for the starving assembler.
    if (missing) { if (!m.starveSince) m.starveSince = run.t; }
    else m.starveSince = 0;
    if (depleted && !wasDepleted) {
      pushEvent(run, 'depleted', { id: m.id, x: m.x, y: m.y,
        ore: (tileAt(run, m.x, m.y) || {}).ore || null });
      // A mined-out vein is permanent, so it is named the moment it happens —
      // there is no transient version of this fault to debounce against.
      diag(run, 'depleted', {});
    }
    diagnose(run, m, missing);
  }

  // M-ONBOARD: turn the debounce stamps stepMachine just wrote into one plain
  // sentence apiece. Reads only run.t, so it is deterministic and free.
  function diagnose(run, m, missing) {
    const G = D.DIAG, name = D.BUILDINGS[m.type].name;
    if (m.blockedSince && run.t - m.blockedSince >= G.blockedT * HZ)
      diag(run, 'blocked', { name: name });
    if (m.nofuelSince && run.t - m.nofuelSince >= G.nofuelT * HZ)
      diag(run, 'nofuel', { name: name });
    if (missing && m.starveSince && run.t - m.starveSince >= G.starveT * HZ)
      diag(run, 'starved', { id: missing, item: D.ITEMS[missing].name });
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
            deliver(run, b.item);
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
    // M-ONBOARD: an item that never advances is the other silent failure — a
    // line laid into bare rock looks exactly like a line that is merely busy.
    //
    // Nothing below here matters once the lesson has been given, and this is
    // the one diagnostic that is not O(1): a fully backed-up network would
    // re-walk itself from every cell, on every belt step, forever.
    if (run.diag && run.diag.beltJam) return;
    // `jamT` counts BELT STEPS (this function runs every D.BELT_PERIOD ticks),
    // so the threshold converts to steps once, here. `moved` is the honest
    // test: it is set on both ends of a handoff, so any cell where traffic is
    // actually flowing re-arms itself.
    const jamSteps = Math.max(1, Math.round(D.DIAG.beltJamT * HZ / D.BELT_PERIOD));
    for (const e of belts) {
      const b = e.b;
      if (!b.item || b.moved) { b.jamT = 0; continue; }
      if ((b.jamT = (b.jamT || 0) + 1) < jamSteps) continue;
      b.jamT = jamSteps;                 // clamp: it is stuck, not getting stucker
      if (diagBelt(run, e.x, e.y, b)) return;
    }
  }

  // Why this belt's item is not moving. Walks forward to the HEAD of the jam,
  // because a stuck belt queued behind another stuck belt is the symptom and
  // not the fault — the player needs the far end of the line, which is exactly
  // the tile they are not looking at.
  function diagBelt(run, x, y, b) {
    let cx = x, cy = y, cb = b;
    for (let hop = 0; hop < D.MAP_W * D.MAP_H; hop++) {
      const d = D.DIRS[cb.dir];
      const t = tileAt(run, cx + d.dx, cy + d.dy);
      if (!t) break;                                    // the line runs off the map
      if (t.machine !== null) {
        const tm = run.machines[t.machine];
        if (!tm || tm.id === 0) return false;           // the rig swallows anything
        // Wants it but is full: back-pressure, which is a tuning problem and
        // not a mistake. The machine's own 'blocked' line covers that story.
        if (machineWants(run, tm, cb.item)) return false;
        return diag(run, 'beltJam', { name: D.BUILDINGS[tm.type].name,
                                      item: D.ITEMS[cb.item].name });
      }
      if (!t.belt) break;                               // ends on bare ground
      if (!t.belt.item) return false;                   // the line ahead is clear
      cx += d.dx; cy += d.dy; cb = t.belt;
    }
    return diag(run, 'beltJam', {});
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
    diagDrill(run);
  }

  // M-ONBOARD: the rig says what it is waiting for. Only when it still needs
  // the item AND none is in stock — a rig steadily chewing through a crate is
  // not stalled, it is working. The opening minute is exempt: a stratum that
  // has not produced its first gear yet is a base being built, not a base that
  // has failed, and law 6 is about finding real signal, not more of it.
  function diagDrill(run) {
    if (run.t < D.DIAG.stallT * HZ) return;
    if (run.gearsFed < run.breachReq.gear) {
      if (!(run.inv.gear > 0)) diag(run, 'stallGear', {});
      return;                       // gears gate the breach first: one lesson at a time
    }
    if (run.chargesFed < run.breachReq.charge && !(run.inv.charge > 0))
      diag(run, 'stallCharge', {});
  }
  function feedRate(run) {
    const win = Math.min(10, Math.max(1, run.t / HZ));
    let g = 0, c = 0;
    for (const f of run._feed)
      if (f.t >= run.t - 10 * HZ) { if (f.item === 'gear') g++; else c++; }
    return { gearPerSec: g / win, chargePerSec: c / win };
  }

  // ---------------- M-WIDE: the production chain, as numbers --------------
  // What the base COULD do, stage by stage, from the machines that are
  // standing in it — the reading the CHAIN panel teaches with. This is the
  // single most useful thing the game can tell a new player, because the trap
  // is arithmetic they have no reason to have done: one smelter is 0.5
  // plate/s, one assembler wants 2 plates every 2.75s = 0.73 plate/s, so ONE
  // SMELTER CANNOT FEED ONE ASSEMBLER. A panel that prints both numbers makes
  // that visible; a manual page behind H does not.
  //
  // Capacity, not measurement: a machine that is momentarily blocked is still
  // a machine, and a rate that flickered every time a belt backed up would be
  // unreadable. What DOES remove a machine from its stage is permanent (a
  // mined-out vein) or halving (a damaged one) — both true sim state.
  //
  // Pure: reads the run, writes nothing, and draws nothing from run.rng
  // (SPEC3 §0 law 7 — a rate readout that moved the stream would make every
  // number in test/balance.js depend on the shape of the base).
  function machineRate(run, m) {
    const B = D.BUILDINGS[m.type];
    const dmg = m.hp === 1 ? 0.5 : 1;                 // halfSkip: every other tick
    if (m.type === 'extractor') {
      if (m.status === 'depleted') return 0;
      return HZ * run.mods.extractMult * auraMult(run, 'extract', m.x, m.y) / B.period * dmg;
    }
    if (m.type === 'smelter') {
      return HZ * run.mods.smeltMult * auraMult(run, 'smelt', m.x, m.y) /
             D.RECIPES.smeltIron.ticks * dmg;
    }
    if (m.type === 'assembler') {
      const rec = D.RECIPES[m.recipe || 'gear'];
      return HZ / rec.ticks * dmg;
    }
    return 0;
  }
  // Which plate a smelter is making: the job it is running, else the ore it
  // has buffered, else iron (its default the moment ore arrives).
  function smelterRecipe(m) {
    if (m.job) return m.job;
    if ((m.input.ironOre || 0) > 0) return 'smeltIron';
    if ((m.input.copperOre || 0) > 0) return 'smeltCopper';
    return 'smeltIron';
  }
  function chain(run) {
    const flow = {};                                   // itemId -> net per second
    const add2 = function (id, n) { if (id) flow[id] = (flow[id] || 0) + n; };
    let oreRate = 0, oreN = 0;                         // smeltable ore only
    let plateRate = 0, plateN = 0;
    let gearRate = 0, gearN = 0, gearIn = 0, gearOut = 0;
    let chargeRate = 0, chargeN = 0;
    let noCoal = false, blocked = false, starved = false, damaged = false;
    for (const id in run.machines) {
      const m = run.machines[id];
      if (!m || m.id === 0) continue;
      const r = machineRate(run, m);
      if (m.type === 'extractor') {
        const t = tileAt(run, m.x, m.y);
        const ore = t && t.ore;
        add2(ore, r);
        if (ore === 'ironOre' || ore === 'copperOre') { oreRate += r; oreN++; }
      } else if (m.type === 'smelter') {
        const rec = D.RECIPES[smelterRecipe(m)];
        for (const k in rec.in) add2(k, -r * rec.in[k]);
        for (const k in rec.out) add2(k, r * rec.out[k]);
        add2('coal', -r / (D.FUEL_PER * (run.mods.coalX2 ? 2 : 1)));
        plateRate += r; plateN++;
        if (m.status === 'nofuel') noCoal = true;
      } else if (m.type === 'assembler') {
        const rec = D.RECIPES[m.recipe || 'gear'];
        for (const k in rec.in) add2(k, -r * rec.in[k]);
        for (const k in rec.out) add2(k, r * rec.out[k]);
        if (m.recipe === 'charge') { chargeRate += r * (rec.out.charge || 1); chargeN++; }
        else {
          let inN = 0, outN = 0;
          for (const k in rec.in) inN += rec.in[k];
          for (const k in rec.out) outN += rec.out[k];
          gearRate += r * (rec.out.gear || 1);
          gearN++; gearIn += inN * r; gearOut += outN * r;
          if (m.starveSince) starved = true;
        }
      } else if (m.type === 'damper') {
        add2('coal', -HZ / D.BUILDINGS.damper.coalTicks);
      }
      if (m.status === 'blocked') blocked = true;
      if (m.hp === 1) damaged = true;
    }
    // Plates per gear, from the recipes actually installed (2 for the plain
    // gear, 1 for Bronze Gearworks, which is the whole point of that pick).
    const perGear = gearOut > 0 ? gearIn / gearOut : D.RECIPES.gear.in.ironPlate;
    const req = run.breachReq || { gear: 0, charge: 0 };
    const drillRate = HZ / drillPeriod(run);
    // Each stage's throughput expressed in the same unit — gears per second —
    // so they can be compared at all. The smallest is the bottleneck.
    const stages = [
      { id: 'ore',   item: 'ironOre',   name: 'ore',   letter: 'E',
        n: oreN,   rate: oreRate,   gears: oreRate / perGear },
      { id: 'plate', item: 'ironPlate', name: 'plate', letter: 'S',
        n: plateN, rate: plateRate, gears: plateRate / perGear },
      { id: 'gear',  item: 'gear',      name: 'gear',  letter: 'A',
        n: gearN,  rate: gearRate,  gears: gearRate },
    ];
    if (req.charge > 0) {
      stages.push({ id: 'charge', item: 'charge', name: 'charge', letter: 'A',
        n: chargeN, rate: chargeRate, gears: Infinity });
    }
    // The limiting stage: lowest throughput, earliest on a tie (the upstream
    // stage is the real constraint — fixing the one below it changes nothing).
    let lim = null;
    for (const s of stages) {
      if (s.id === 'charge') continue;
      if (!lim || s.gears < lim.gears - 1e-9) lim = s;
    }
    if (lim) lim.limiting = true;
    // Only the FIRST missing stage is called out. A base with nothing built
    // has three empty stages, and three warnings in the same colour name no
    // action at all — the one that matters is the next thing to build.
    let namedNone = false;
    for (const s of stages) {
      if (s.id === 'charge') continue;
      if (s.n === 0) {
        s.flag = namedNone ? '' : 'NONE';
        namedNone = true;
      } else {
        s.flag = (s.id === 'plate' && noCoal) ? 'NO COAL' : s.limiting ? 'STARVED' : '';
      }
    }
    // A charge stage that cannot keep up is its own lesson, and charges gate
    // the breach from stratum 5 down, so it is flagged on its own terms.
    const cs = stages[3];
    if (cs) cs.flag = cs.n === 0 ? 'NONE' : (cs.rate <= 0 ? 'STALLED' : '');
    const gears = lim ? Math.max(0, lim.gears) : 0;
    return {
      stages: stages, flow: flow,
      gearRate: gears, chargeRate: chargeRate, drillRate: drillRate,
      perGear: perGear, noCoal: noCoal, blocked: blocked,
      starved: starved, damaged: damaged,
      breachSec: breachEta(run, gears, chargeRate, drillRate),
    };
  }
  // How long the breach is away AT THIS RATE — the number that turns a base
  // into a clock. Stock is fed first (the drill can only swallow one item per
  // drillPeriod however full the crate is), then production carries the rest.
  // null when the rig is short of something nothing is making: that is not a
  // large number, it is a different sentence, and the panel says so.
  function breachEta(run, gearsPerSec, chargesPerSec, drillRate) {
    const req = run.breachReq || { gear: 0, charge: 0 };
    let t = 0;
    const leg = function (need, stock, prod) {
      if (need <= 0) return 0;
      const fromStock = Math.min(need, stock);
      let s = fromStock / drillRate;
      const rest = need - fromStock;
      if (rest > 0) {
        if (!(prod > 0)) return null;
        s += rest / Math.min(drillRate, prod);
      }
      return s;
    };
    const g = leg(req.gear - run.gearsFed, run.inv.gear || 0, gearsPerSec);
    if (g === null) return null;
    t += g;
    const perCharge = run.mods.chargeX2 ? 2 : 1;
    const c = leg((req.charge - run.chargesFed) / perCharge,
                  run.inv.charge || 0, chargesPerSec);
    if (c === null) return null;
    return t + c;
  }

  // ---------------- M-CORELORE: the Core Gate (§B) ----------------
  // Stratum 8 only, once per run. The breach feed is the drama: at a quarter,
  // three fifths and a hair short of done, the planet says something. The sim
  // does not know what — it emits the beat and barks.js owns the words.
  function breachFrac(run) {
    const req = run.breachReq || { gear: 0, charge: 0 };
    const total = (req.gear || 0) + (req.charge || 0);
    if (total <= 0) return 0;
    return U.clamp(((run.gearsFed || 0) + (run.chargesFed || 0)) / total, 0, 1);
  }
  function stepCoreGate(run) {
    const CFG = D.CORE;
    if (!CFG || !CFG.beat || run.mantle || run.depth !== D.STRATA_COUNT) return;
    if (run.coreBeat >= CFG.beat.length) return;
    if (breachFrac(run) < CFG.beat[run.coreBeat]) return;
    const beat = run.coreBeat++;
    pushEvent(run, 'core', { beat: beat, depth: run.depth });
  }

  // ---------------- M-GRITPLUS: EGG-420 ----------------
  // A 42-second window, opened by the typed code (engine) or — if js/events.js
  // is loaded — by a dig find that module rolls. Nothing here draws from
  // run.rng, so an unopened window costs the RNG stream exactly nothing and a
  // run plays identically whether or not the egg exists.
  function startEgg(run, src) {
    if (!run || !D.EGG420) return false;
    run.egg = { until: run.totalT + D.EGG420.sec * HZ, src: src || 'code' };
    run.eggSeen = true;
    msg(run, '≈ something botanical is smouldering ≈', D.COLORS.leaf);
    return true;
  }
  function eggActive(run) {
    return !!(run && run.egg && run.totalT < run.egg.until);
  }
  function stepEgg(run) {
    if (run.egg && !eggActive(run) && !run.egg.closed) {
      run.egg.closed = true;
      msg(run, 'The air clears. The copper still smells great.', D.COLORS.gray);
    }
  }

  // ---------------- instability & quakes (§5.5) ----------------
  function instRate(run) {
    let rate = stratumOf(run).instabRate * run.mods.instMult;
    if (eggActive(run)) rate *= D.EGG420.instMult;   // the stratum relaxes too
    if (run.overdrive)
      rate *= run.mods.overCheap ? 1 + (D.OVERDRIVE.instMult - 1) / 2 : D.OVERDRIVE.instMult;
    // Dampers are applied one at a time rather than counted then multiplied,
    // because The Root (M-WONDERS) doubles the calm of the dampers standing in
    // its radius and not the others. With no landmark in reach every auraMult
    // is 1 and this is arithmetically identical to the old two-loop form.
    let dampers = 0;
    for (const id in run.machines) {
      const m = run.machines[id];
      if (m.type === 'damper' && m.fuel > 0 && dampers < D.DAMPER_MAX) {
        dampers++;
        const calm = Math.min(0.9,
          D.BUILDINGS.damper.calm * auraMult(run, 'damper', m.x, m.y));
        rate *= 1 - calm;
      }
    }
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
        // M-WONDERS/The Warm Spot: a tile inside the zone is never a candidate,
        // so nothing built there is ever chosen. The integrity hit below still
        // lands in full — the Warm Spot shelters a base, not a rig.
        if (quakeSafe(run, x, y)) continue;
        const t = run.grid[y][x];
        if (t.belt || (t.machine !== null && t.machine !== 0)) built.push({ x: x, y: y });
        // ...and rubble never lands on landmark ground either (same reason).
        if (t.t === 'floor' && t.revealed && t.machine !== 0 && !t.lm)
          floors.push({ x: x, y: y });
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
    if (run.instability >= 99) {
      msg(run, '!! COLLAPSE — the stratum is failing !!', D.COLORS.red);
      // M-GRITPLUS: named collapses. Once the stratum is failing the quakes
      // stop being weather and start being a list, counted per stratum — a
      // dread meter you read in the log instead of on a gauge.
      run.tremor = (run.tremor || 0) + 1;
      msg(run, 'The stratum groans: TREMOR ' + roman(run.tremor), D.COLORS.red);
    } else msg(run, '≋ QUAKE — the stratum shudders (−' + dmg + ' integrity)', D.COLORS.orange);
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
          // M-WONDERS: landmark ground is never eaten. Only the Warm Spot's
          // marker is floor at all, but a tile whose terrain said 'magma'
          // while its flag still said 'landmark' would render as a wonder,
          // describe as a wonder and behave as lava.
          if (t.t === 'floor' && t.machine !== 0 && !t.lm && adjMagma(x, y))
            cand.push({ x: x, y: y });
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
        // M-WONDERS: a wonder answers before the terrain does, so the refusal
        // names what is actually in the way. Only the Warm Spot's marker is
        // standable floor, and paving it would hide the tile that names the
        // zone; the rest are solid anyway and would have said 'needs open
        // floor', which tells the player nothing about what they are looking at.
        if (t.lm) return { ok: false, reason: 'landmark ground' };
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
      blockedSince: 0, nofuelSince: 0, starveSince: 0, out: [], job: null,
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
    // M-WONDERS: landmark ground answers before the terrain does. Only a Glass
    // Forest spire yields to a pick; everything else is older than the drill.
    if (t.lm) {
      const ld = (D.LANDMARK_BY_ID || {})[t.lm.id];
      if (ld && ld.dig) {
        if (!t.revealed) return { ok: false, reason: 'unscanned ground' };
        if (t.digT > 0) return { ok: false, reason: 'already excavating' };
        t.digT = ld.dig.ticks;
        return { ok: true };
      }
      return { ok: false, reason: 'older than the Company' };
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
    if (!t) return { handled: false };
    if (t.lm) return clickLandmark(run, t);   // M-WONDERS
    if (t.machine === null) return { handled: false };
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
    // CX-08: '»' (U+00BB) — '≫' (U+226B) is the one glyph DejaVu Sans Mono lacks.
    msg(run, run.overdrive ? '» OVERDRIVE engaged — the rig howls.' : 'Overdrive disengaged.',
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
    // M-EVENTS: and between the pick and the floor, the dark may ask you
    // something. Guarded; engine.js checks Events.pending to decide whether
    // there is a screen to show, so an absent module descends as it always did.
    if (DC.Events && DC.Events.rollVignette) DC.Events.rollVignette(run);
  }

  // M-EVENTS: install a schematic mid-stratum, without a descent (the Miner's
  // Ghost trades one for hull). The CALLER chooses which — events.js rolls it
  // on its own stream — so this consumes no randomness at all, and a run with
  // a ghost in it schedules exactly the quakes a run without one does.
  function installSchematic(run, id) {
    if (!id || !run || run.schematics.indexOf(id) >= 0) return null;
    run.schematics.push(id);
    applySchematicMod(run, id);
    return id;
  }

  function abandon(run) {
    run.status = 'dead';
    setResult(run, false);
    pushEvent(run, 'death', { depth: run.depth, cause: 'abandon' });
  }

  // ---------------- tooltip (§5.9) ----------------
  // M-POLISH/CX-04: the SCAN panel is 29 columns of content and render clips
  // hard, so EVERY line describeTile can emit must already fit in 29 chars —
  // no mid-word truncation. SCAN_W mirrors render.js SCW; it is exported so a
  // suite can re-audit the combinations if these strings are ever edited.
  const SCAN_W = 29;

  // Short item labels for tight panels. Prefers data.js's `short:` field
  // (M-POLISH/CX-11, landing in parallel) and falls back to this table, so the
  // strings fit whether or not that field exists yet. A `short` longer than 10
  // chars is ignored — it would blow the 29-col budget.
  const ITEM_SHORT = {
    ironOre: 'iron ore', copperOre: 'cu ore', coal: 'coal', crystal: 'crystal',
    ironPlate: 'iron plt', copperPlate: 'cu plate', gear: 'gear', charge: 'charge',
  };
  function itemShort(id) {
    const it = D.ITEMS[id];
    const s = it && it.short;
    if (typeof s === 'string' && s.length > 0 && s.length <= 10) return s;
    return ITEM_SHORT[id] || (it && it.name) || String(id);
  }

  // Input-buffer line, packed to fit SCAN_W: entries are dropped from the end
  // with a "+N" marker rather than cut mid-word. `skip` drops items already
  // reported elsewhere (coal lives on the smelter/damper fuel line).
  function bufferLine(m, skip) {
    const keys = Object.keys(m.input).filter(k => m.input[k] > 0 && k !== skip);
    if (!keys.length) return null;
    const ent = keys.map(k => m.input[k] + ' ' + itemShort(k));
    for (let n = ent.length; n > 0; n--) {
      const more = ent.length - n;
      const s = 'in: ' + ent.slice(0, n).join(', ') + (more ? ' +' + more : '');
      if (s.length <= SCAN_W) return s;
    }
    return 'in: ' + keys.length + ' kinds';   // pathological names: still whole words
  }

  function fuelLine(m) {
    const coal = m.input.coal || 0;
    const tail = coal > 0 ? ' (+' + coal + ' coal)' : '';
    // CX-09: same field, different units — say which. Smelter fuel counts
    // smelts remaining; damper fuel is raw ticks, shown as seconds of venting.
    if (m.type === 'damper')
      return 'fuel: ' + Math.ceil(m.fuel / HZ) + 's venting' + tail;
    return 'fuel: ' + m.fuel + (m.fuel === 1 ? ' smelt' : ' smelts') + tail;
  }

  // M-ONBOARD: what the red '!' means. render.js draws that one glyph over
  // three different faults (see the `bad` branch in drawMap), and the glyph
  // alone cannot say which — so the SCAN panel carries the difference, because
  // it is already where the player is pointing when they ask the question.
  // Reason first, fix second, inside the 29 columns the panel clips at; the
  // scan-panel lint in test/barks_test.js holds these to that budget.
  const STATUS_HINT = {
    blocked:  'full — belt its output side',
    nofuel:   'out of coal — belt coal in',
    depleted: 'vein empty — (X) to clear',
  };

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
      // EGG-420: for 42 seconds a seismic damper is a chill unit. Same panel,
      // same widths, same information — GRIT has simply relabelled the thing.
      const bname = (m.type === 'damper' && eggActive(run)) ? 'CHILL UNIT'
                                                            : B.name.toUpperCase();
      L.push({ text: bname + ' [' + m.status + ']',
               color: m.status === 'ok' ? D.COLORS.green
                    : m.status === 'idle' ? D.COLORS.gray : D.COLORS.red });
      // The legend for the '!', immediately under the status word it explains.
      if (STATUS_HINT[m.status])
        L.push({ text: STATUS_HINT[m.status], color: D.COLORS.amber });
      if (m.hp === 1)
        L.push({ text: 'damaged — click to repair ' + run.mods.repairCost + D.ITEMS.ironPlate.glyph,
                 color: D.COLORS.red });
      if (m.type === 'assembler') {
        const out = Object.keys(D.RECIPES[m.recipe || 'gear'].out)[0];
        L.push({ text: 'recipe: ' + D.ITEMS[out].name, color: D.COLORS.blue });
        L.push({ text: 'click: cycle recipe', color: D.COLORS.amberDim });
      }
      if (m.type === 'smelter' || m.type === 'damper')
        L.push({ text: fuelLine(m), color: D.COLORS.orange });
      if (m.type === 'extractor') {
        const ot = tileAt(run, m.x, m.y);
        if (ot && ot.ore)
          L.push({ text: D.ITEMS[ot.ore].name + ' — ' + ot.oreAmt + ' left', color: D.ORE_GLYPHS[ot.ore].color });
      }
      // coal is already reported by the fuel line on the machines that burn it
      const buf = bufferLine(m, (m.type === 'smelter' || m.type === 'damper') ? 'coal' : null);
      if (buf) L.push({ text: buf, color: D.COLORS.gray });
      return L.slice(0, 5);
    }
    // M-WONDERS: the landmark reads before the terrain under it — the tooltip
    // is where a wonder stops being scenery and states its mechanic.
    if (t.lm) {
      const ld = (D.LANDMARK_BY_ID || {})[t.lm.id];
      if (ld) {
        const on = !!(run.landmark && run.landmark.id === ld.id && run.landmark.on);
        L.push({ text: ld.name, color: D.COLORS[ld.color] || D.COLORS.white });
        for (const s of ((on && ld.onLore) || ld.lore || []))
          L.push({ text: s, color: D.COLORS.gray });
        if (t.digT > 0)
          L.push({ text: 'excavating — ' + Math.ceil(t.digT / HZ) + 's', color: D.COLORS.amber });
        return L.slice(0, 5);
      }
    }
    if (t.belt) {
      L.push({ text: 'belt ' + D.ARROWS[t.belt.dir] +
               (t.belt.item ? ' carries ' + itemShort(t.belt.item) : ''), color: D.COLORS.cyan });
      return L;
    }
    if (t.digT > 0) return [{ text: 'excavating — ' + Math.ceil(t.digT / HZ) + 's', color: D.COLORS.amber }];
    if (t.rubble) return [{ text: 'rubble — (X) to clear', color: D.COLORS.gray }];
    if (t.ore) {
      L.push({ text: D.ITEMS[t.ore].name + ' vein — ' + t.oreAmt, color: D.ORE_GLYPHS[t.ore].color });
      L.push({ text: 'place an extractor here', color: D.COLORS.amberDim });
      return L;
    }
    if (t.t === 'rock') return [{ text: 'rock — (X) to excavate', color: D.COLORS.rock }];
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
    // M-EVENTS: a schematic granted outside a descent (the caller picks it)
    installSchematic: installSchematic,
    describeTile: describeTile, feedRate: feedRate, msg: msg,
    // M-WIDE: the production chain as numbers (stage rates, the bottleneck,
    // net flow per item, and the breach projection). Read-only and rng-free.
    chain: chain,
    // M-CORELORE / M-GRITPLUS: the Core Gate's progress reading, the EGG-420
    // window (engine opens it from the typed code; js/events.js may open it
    // from a dig find), and the collapse counter's numeral.
    breachFrac: breachFrac, startEgg: startEgg, eggActive: eggActive,
    roman: roman,
    // M-WONDERS: the two helpers everything else consults, plus the nap state
    // render draws the Drowned Machine's colour from.
    landmarkAt: landmarkAt, auraMult: auraMult, quakeSafe: quakeSafe,
    landmarkJammed: lmJammed,
    // shared with render.js (STOCK column, CX-11); SCAN_W is the tooltip budget
    itemShort: itemShort, SCAN_W: SCAN_W,
    // Where a machine puts what it made (SPEC §5.3). js/tutorial.js highlights
    // this tile for the beat that teaches R, and render.js draws the same tile
    // under the placement ghost — one formula, not three copies of it.
    outputTile: outputTile,
    // M-ONBOARD: the diagnostics. diagLines() is every sentence they can emit
    // (worst case filled in) so the suites can hold the lot to the LOG panel;
    // STATUS_HINT is the '!' legend the SCAN panel draws.
    diagLine: diagLine, diagLines: diagLines, STATUS_HINT: STATUS_HINT,
  };
})();
