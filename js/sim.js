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
      // M-TIER2: a tunnel with one end. It is the only tier-II structure that
      // can be built WRONG rather than merely built badly, so it says so.
      case 'tunnel':
        return 'That tunnel has no far end. Place its pair up to ' + c.gap +
               ' tiles ahead, same way.';
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
    out.push(diagLine('tunnel', { gap: (D.BUILDINGS.tunnel.gap || 4) * 2 }));
    for (const name of names) {
      out.push(diagLine('blocked', { name: name }));
      out.push(diagLine('nofuel', { name: name }));
      for (const item of items) out.push(diagLine('beltJam', { name: name, item: item }));
    }
    for (const id of D.ITEM_ORDER)
      out.push(diagLine('starved', { id: id, item: D.ITEMS[id].name }));
    return out;
  }

  // ---------------- M-MANTLE: the deep's one rule per floor ----------------
  // ONE ROLL, AT ONE SITE, STORED ON THE RUN (§0 law 7). `rollMutator` is
  // called from startStratum and from nowhere else; every consumer below reads
  // `run.mutator` and never draws. A re-render cannot re-roll it, a tooltip
  // cannot re-roll it, and the balance sweep's numbers move only when the
  // tuning moves — which is the whole point of the law.
  //
  // The table is filtered by what is LOADED, not by what is written. A mutator
  // whose `needs` module is absent is not in the deck at all: it is not dealt,
  // it is not a silent no-op floor, and the roll picks among the rest. That is
  // 'worm season' today (M-WORMS has not landed), and it is how any future
  // module-gated floor rule should arrive.
  function mutatorTable() {
    return (D.MUTATORS || []).filter(function (m) {
      return !m.needs || !!DC[m.needs];
    });
  }
  function rollMutator(run) {
    run.mutator = null;
    run.dark = 0;
    const first = D.MUTATOR_DEPTH || (D.STRATA_COUNT + 1);
    if (run.depth < first) return;
    const table = mutatorTable();
    if (!table.length) return;
    run.mutator = table[Math.floor(run.rng() * table.length)].id;
  }
  function mutDef(run) {
    const id = run && run.mutator;
    return id ? (D.MUTATOR_BY_ID || {})[id] || null : null;
  }
  function isMut(run, id) { return !!run && run.mutator === id; }
  // The tuning field of the ACTIVE mutator, or the neutral value. Every site
  // below reads its number through this rather than typing it, so a mutator's
  // strength lives in data.js beside its name and its one-line consequence.
  function mutVal(run, id, key, dflt) {
    const def = isMut(run, id) ? mutDef(run) : null;
    const v = def ? def[key] : undefined;
    return v === undefined ? dflt : v;
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
      // M-TIER2: the tier-II picks. Multipliers on the structures' own data
      // fields rather than new mechanics, so a tier-II schematic can never
      // teach a rule the plain structure does not already teach.
      tunnelMult: 1, split3: false, smartGate: false, crushRock: false,
      // M-SCHEMS2: the second batch. Flags read by machinery that already
      // exists — the forge check above all (M-MANTLE built it, this switches
      // it on as a reward instead of a rule).
      magmaBoiler: false, echoCharge: false, juryRig: false,
      // Gravity Chute raises this; everything demolished reads it.
      refund: D.DEMOLISH_REFUND,
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
      // M-TIER2
      case 's_conduit': m.tunnelMult *= 2; break;
      case 's_yoke': m.split3 = true; break;
      case 's_gate': m.smartGate = true; break;
      case 's_grind': m.crushRock = true; break;
      // M-SCHEMS2
      case 's_boiler': m.magmaBoiler = true; break;
      case 's_echo': m.echoCharge = true; break;
      case 's_chute': m.refund = D.CHUTE_REFUND; break;
      case 's_jury': m.juryRig = true; break;
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
      // M-SCHEMS2/Echo Charges: charges assembled this run. A counter and not
      // a roll (law 7): the fifth is free because it is the fifth, every time.
      echoN: 0,
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
      // M-MANTLE: this floor's rule (null on strata 1-8) and, for 'the dark
      // rises', how many rings of the edge it has already taken back.
      mutator: null, dark: 0,
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
    // M-MANTLE: the floor's rule is decided BEFORE its ground is, because one
    // of them ('cold seam') is a mapgen instruction — no coal in the rock and
    // a guaranteed pair of magma pools to smelt at. Rolling after the map
    // would mean either a second map or a mutator that lies.
    rollMutator(run);
    const gen = DC.MapGen.generate(run.depth, run.rng, run.mods, run.mutator);
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
    // M-MANTLE/'the seal': the floor is thinner and the planet minds more.
    const seal = mutVal(run, 'seal', 'breachMult', 1);
    run.breachReq = {
      gear: Math.ceil(S.breach.gear * run.mods.breachMult * seal),
      charge: Math.ceil(S.breach.charge * run.mods.breachMult * seal),
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
    // M-MANTLE/'the dark rises' hands you the whole floor exactly once, the
    // way Deep Sonar does — and then spends the stratum taking it back.
    if (run.mods.fullReveal || isMut(run, 'dark')) {
      for (let y = 0; y < D.MAP_H; y++)
        for (let x = 0; x < D.MAP_W; x++) run.grid[y][x].revealed = true;
      run._lastRevealR = 9999;
    }
    updateReveal(run);
    // ...and the floor announces its rule. Only when it HAS one: strata 1-8
    // push nothing, so no consumer has to learn to ignore an empty event.
    if (run.mutator) pushEvent(run, 'mutator', { id: run.mutator, depth: run.depth });
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
    const pool = schematicPool(run, run.depth);
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
  // The sweep's radius. Ordinarily it grows a ring every REVEAL_TICKS and
  // never stops, which is why a stratum is fully drawn about a minute in.
  //
  // M-MANTLE/'the dark rises' FREEZES it at the starting disc, and that is the
  // whole mutator: the brief calls the scan radius "your only lantern", and a
  // lantern that grows to 33 tiles inside a minute is a floodlight. What the
  // rig can see is what it could see when it landed (plus m_scan's eight
  // tiles, which is exactly the upgrade you want on this floor).
  function revealRadius(run) {
    const base = D.REVEAL_R0 + run.mods.scanBonus;
    if (isMut(run, 'dark')) return base;
    return base + Math.floor(run.t / D.REVEAL_TICKS);
  }
  function updateReveal(run) {
    const r = revealRadius(run);
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

  // M-MANTLE/'the dark rises': one ring of the map's edge is un-drawn every
  // `ringT` seconds, and the lantern is relit inside the same step — so the
  // disc around the rig stays lit and everything past it goes back to being
  // rumour. It costs no roll (a tick count decides it) and it walks inward
  // until the whole board is dark but the lamp, which takes about four
  // minutes: longer than a Mantle floor should take, shorter than one you are
  // losing. Un-revealed ground is un-BUILDABLE ground (canPlace), so this is
  // pressure on where the base can grow and not merely on what you can see.
  function stepDark(run) {
    if (!isMut(run, 'dark')) return;
    const per = Math.max(1, Math.round(mutVal(run, 'dark', 'ringT', 20) * HZ));
    if (run.t <= 0 || run.t % per !== 0) return;
    const maxRing = Math.ceil(Math.min(D.MAP_W, D.MAP_H) / 2);
    if ((run.dark || 0) >= maxRing) return;
    const r = run.dark = (run.dark || 0) + 1;
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++)
        if (Math.min(x, y, D.MAP_W - 1 - x, D.MAP_H - 1 - y) < r)
          run.grid[y][x].revealed = false;
    run._lastRevealR = -1;
    updateReveal(run);
    // Said once, on the first ring. After that the map is saying it, every
    // second, in the only language this game has (§0 law 6 beats a reminder).
    if (r === 1)
      msg(run, 'The dark comes in from the walls. The lamp is all you have.',
          D.COLORS.gray);
  }

  // ---------------- tick (§5.1) ----------------
  function tick(run) {
    if (run.status !== 'active' && run.status !== 'breachReady') return;
    run.t++;
    run.totalT++;
    updateReveal(run);
    stepDark(run);        // M-MANTLE: ...and then takes a ring of it back
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
    // M-SCHEMS2/Jury Rig: every damaged machine runs whole and bills the hull
    // for the privilege — working or idle, because it is the patch cable that
    // costs, not the work. Repair it and the bleeding stops.
    if (run.mods.juryRig) {
      let patched = 0;
      for (const id in run.machines) {
        const m = run.machines[id];
        if (m && m.id !== 0 && m.hp === 1) patched++;
      }
      if (patched > 0) run.integrity -= patched * D.JURY_DRAIN / (60 * HZ);
    }
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
  // M-SCHEMS2/Jury Rig: a damaged machine ordinarily works every other tick.
  // With the card it works every tick and the drain in tick() bills the hull
  // instead — speed bought with the one resource the planet is already taking.
  function halfSkip(run, m) {
    return m.hp === 1 && !run.mods.juryRig && run.t % 2 === 1;
  }

  function outputTile(m) {
    if (m.facing === 0) return { x: m.x + ((m.w - 1) >> 1), y: m.y - 1 };
    if (m.facing === 1) return { x: m.x + m.w, y: m.y + ((m.h - 1) >> 1) };
    if (m.facing === 2) return { x: m.x + ((m.w - 1) >> 1), y: m.y + m.h };
    return { x: m.x - 1, y: m.y + ((m.h - 1) >> 1) };
  }

  // ---------------- M-TIER2: the tier-II logistics layer ----------------
  // FOUR STRUCTURES THAT CARRY CARGO WITHOUT MAKING ANY, and one that makes
  // ore out of the wreckage. They are collectively "belt-like": each holds at
  // most ONE item, exactly as a belt tile does, and each hands that item on
  // during the belt step rather than the machine step — so a line of belts,
  // splitters, filters and tunnels compresses in a single pass the way a pure
  // belt line always has, and the network's throughput stays the belt's
  // (D.BELT_PERIOD => 4 tiles/s), comfortably clear of any machine's rate
  // (SPEC §12). A line still only jams when the player under-builds.
  //
  // THE RULE THEY ALL OBEY IS FACING, NOT ADJACENCY (test/headless.js
  // checkRigOutput; director, 2026-08-14). A splitter has two arrows and the
  // schematic gives it three, a tunnel's far arrow is up to four tiles away,
  // and the loader's is the only one that points at what it TAKES from — but
  // every one of those tiles is chosen by the structure's facing, and nothing
  // here ever collects from a neighbour for being a neighbour.
  const BELTLIKE = { splitter: 1, tunnel: 1, loader: 1, filter: 1 };
  function isBeltLike(m) { return !!(m && BELTLIKE[m.type]); }
  // Sealed until its stratum (data.js `unlockDepth`), so the opening floors
  // stay the four-machine lesson they were built as.
  function unlocked(run, type) {
    const B = D.BUILDINGS[type];
    return !!B && (!B.unlockDepth || (run.depth || 1) >= B.unlockDepth);
  }
  function dirOf(k) { return D.DIRS[((k % 4) + 4) % 4]; }
  // How far a tunnel throws, in tiles between its two ends (s_conduit doubles).
  function tunnelGap(run) {
    return Math.max(1, Math.round((D.BUILDINGS.tunnel.gap || 4) *
      ((run.mods && run.mods.tunnelMult) || 1)));
  }
  // Where a splitter's cargo can go, in preference order from `m.side`. Left
  // and right of the arrow; s_yoke adds straight ahead.
  function splitDirs(run, m) {
    const out = [(m.facing + 3) % 4, (m.facing + 1) % 4];
    if (run.mods && run.mods.split3) out.push(m.facing);
    return out;
  }
  function filterItem(m) { return m.filter || D.ITEM_ORDER[0]; }
  // The machine a loader empties: the ONE tile behind it, never a neighbour.
  // Belt-like machines are excluded — they push on their own, and a loader
  // pulling one would be a belt that costs five plates.
  function loaderSource(run, m) {
    const d = dirOf(m.facing);
    const t = tileAt(run, m.x - d.dx, m.y - d.dy);
    if (!t || t.machine === null || t.machine === 0) return null;
    const s = run.machines[t.machine];
    return (!s || isBeltLike(s)) ? null : s;
  }
  // Every tile a machine can put cargo on, for the placement ghost and the
  // tooltip. `outputTile` (SPEC §5.3) stays the single-tile contract every
  // other caller reads; this is the plural of it.
  function outputTiles(run, m) {
    if (m.type === 'splitter') {
      return splitDirs(run, m).map(function (k) {
        const d = dirOf(k);
        return { x: m.x + d.dx, y: m.y + d.dy };
      });
    }
    if (m.type === 'tunnel' && m.mode === 'in') {
      const o = m.pair && run.machines[m.pair];
      return o ? [{ x: o.x, y: o.y }] : [];
    }
    if (m.type === 'filter' && run.mods && run.mods.smartGate) {
      const a = dirOf(m.facing), b = dirOf(m.facing + 1);
      return [{ x: m.x + a.dx, y: m.y + a.dy }, { x: m.x + b.dx, y: m.y + b.dy }];
    }
    return [outputTile(m)];
  }

  // Two tunnels of the same facing, 2..gap+1 tiles apart, are one tunnel. The
  // pairing is decided ONCE, at placement, and stored — so the map never has
  // to be re-read to know which end is which, and three in a row cannot mean
  // two different things on two different ticks. Placing them in either order
  // works: a new end looks BACKWARD for a lonely entrance to be the exit of,
  // then FORWARD for one to become the entrance of.
  function pairTunnel(run, m) {
    const d = dirOf(m.facing), gap = tunnelGap(run);
    function lookup(sx, sy) {
      const t = tileAt(run, sx, sy);
      if (!t || t.machine === null || t.machine === 0) return null;
      const o = run.machines[t.machine];
      return (o && o.type === 'tunnel' && o.facing === m.facing &&
              !o.pair && o.id !== m.id) ? o : null;
    }
    for (let k = 2; k <= gap + 1; k++) {
      const o = lookup(m.x - d.dx * k, m.y - d.dy * k);
      if (o) { o.mode = 'in'; o.pair = m.id; m.mode = 'out'; m.pair = o.id; return; }
    }
    for (let k = 2; k <= gap + 1; k++) {
      const o = lookup(m.x + d.dx * k, m.y + d.dy * k);
      if (o) { o.mode = 'out'; o.pair = m.id; m.mode = 'in'; m.pair = o.id; return; }
    }
    m.mode = 'in';
    m.pair = 0;
  }
  // A tunnel with one end is not a tunnel. Whichever end survives goes back to
  // being a lonely entrance — inert, marked, and named in the SCAN panel —
  // rather than quietly eating cargo into a hole with no far side.
  function unpairTunnel(run, m) {
    if (!m || m.type !== 'tunnel' || !m.pair) return;
    const o = run.machines[m.pair];
    if (o) { o.pair = 0; o.mode = 'in'; o.out.length = 0; }
    m.pair = 0;
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
    if (m.type === 'splitter' || m.type === 'loader') return true;
    // A gate takes what it passes. With Sorting Gates it takes everything and
    // shunts the rest right, which is the difference between a stopper and a
    // sorter — and the reason that pick exists.
    if (m.type === 'filter')
      return item === filterItem(m) || !!(run.mods && run.mods.smartGate);
    // An entrance takes cargo; an exit is an exit. A tunnel with no far end
    // takes nothing at all, so a half-built one backs the line up in front of
    // the player instead of swallowing it.
    if (m.type === 'tunnel') return m.mode === 'in' && !!m.pair;
    return false;
  }

  function machineAccepts(run, m, item) {
    if (m.type === 'hub') return true;
    if (!machineWants(run, m, item)) return false;
    if (isBeltLike(m)) return m.out.length === 0;   // one item, exactly like a belt
    return (m.input[item] || 0) < D.INPUT_CAP;
  }

  // Hand ONE item to the tile (tx, ty): the rig swallows it, a machine buffers
  // it, a belt-like structure holds it, an empty belt carries it. Every push
  // in the game goes through here — machine ejection, belt handoff and the
  // tier-II structures alike — so "what can receive cargo" is one answer.
  function giveTo(run, item, tx, ty) {
    const t = tileAt(run, tx, ty);
    if (!t) return false;
    if (t.machine !== null) {
      const m = run.machines[t.machine];
      if (!m) return false;
      if (m.id === 0) { deliver(run, item); return true; }
      if (!machineAccepts(run, m, item)) return false;
      if (isBeltLike(m)) {
        m.out.push(item);
        m.moved = true;                 // arrived this step; it travels the next
        m.moveT = run.t;
        return true;
      }
      add(m.input, item, 1);
      return true;
    }
    if (t.belt && t.belt.item === null) {
      t.belt.item = item;
      t.belt.moved = true;
      return true;
    }
    return false;
  }

  function tryEject(run, m) {
    if (!m.out.length) return;
    const o = outputTile(m);
    while (m.out.length) {
      if (!giveTo(run, m.out[0], o.x, o.y)) return;
      m.out.shift();                    // a belt refuses the second one itself
    }
  }

  // ---------------- M-TIER2: the crusher ----------------
  // Chebyshev distance from the footprint box, so "within 6" is a square the
  // player can count on the map rather than a circle they have to trust.
  function boxDist(m, x, y) {
    const dx = Math.max(m.x - x, 0, x - (m.x + m.w - 1));
    const dy = Math.max(m.y - y, 0, y - (m.y + m.h - 1));
    return { c: Math.max(dx, dy), d2: dx * dx + dy * dy };
  }
  function crushable(run, t) {
    if (!t || t.lm || t.machine !== null) return false;
    if (t.rubble) return true;
    return !!(run.mods && run.mods.crushRock) && t.t === 'rock';   // s_grind
  }
  // The tile it is chewing. Cached on the machine and revalidated, because the
  // honest search is a 13x13 sweep and this runs every tick of every crusher
  // in every run of the balance sweep. The cache is also what Sim.chain reads,
  // so that model stays a pure read of state the tick already computed.
  function crushTarget(run, m) {
    const c = m.cell;
    if (c && crushable(run, tileAt(run, c.x, c.y))) return c;
    const B = D.BUILDINGS[m.type], R = B.reach;
    let best = null, bd = Infinity;
    for (let y = m.y - R; y < m.y + m.h + R; y++)
      for (let x = m.x - R; x < m.x + m.w + R; x++) {
        const t = tileAt(run, x, y);
        if (!crushable(run, t) || t.machine !== null) continue;
        const b = boxDist(m, x, y);
        if (b.c > R || b.d2 >= bd) continue;
        bd = b.d2; best = { x: x, y: y };
      }
    m.cell = best;
    return best;
  }
  function crush(run, m, cell) {
    const B = D.BUILDINGS[m.type], t = tileAt(run, cell.x, cell.y);
    if (!t) { m.cell = null; return; }
    let n = B.yield;
    if (t.rubble) { t.rubble = false; }
    else { t.t = 'floor'; n = B.rockYield || 1; }
    t.digT = 0;
    for (let i = 0; i < n; i++) m.out.push('ironOre');
  }

  // ---------------- the planet's forge (M-MANTLE + M-SCHEMS2) ----------------
  // ONE ADJACENCY CHECK, TWO CONSUMERS, ON PURPOSE. 'cold seam' (no coal in
  // the rock; a smelter only works beside magma) and the Magma Boiler
  // schematic (a smelter beside magma needs no coal) are the same idea read
  // from opposite ends — the mutator makes it compulsory, the card makes it a
  // reward — so they are the same code. Two separate implementations of "is
  // this smelter touching lava" is exactly how a rule ends up meaning two
  // different things on two different tiles.
  //
  // BURN IMMUNITY IS PART OF THE ENGINE, not a courtesy. D.MAGMA.burnPeriod
  // damages every machine adjacent to magma every 5 seconds, and a smelter has
  // 2 hp: without this, "put your smelter next to the lava" would be an
  // instruction to destroy it inside ten seconds, and the card would be a trap
  // rather than a pick. A smelter working the forge is not standing too close
  // to the fire; it IS the fire's chimney.
  function adjMagma(run, x, y) {
    for (const d of D.DIRS) {
      const t = tileAt(run, x + d.dx, y + d.dy);
      if (t && t.t === 'magma') return true;
    }
    return false;
  }
  function touchesMagma(run, m) {
    for (let y = m.y; y < m.y + m.h; y++)
      for (let x = m.x; x < m.x + m.w; x++)
        if (adjMagma(run, x, y)) return true;
    return false;
  }
  // The forge is live for this smelter: free heat, and the lava leaves it be.
  function forgeSmelter(run, m) {
    if (!m || m.type !== 'smelter') return false;
    if (!isMut(run, 'coldseam') && !(run.mods && run.mods.magmaBoiler)) return false;
    return touchesMagma(run, m);
  }
  // Cold seam ONLY: away from the magma there is nothing to burn and nothing
  // to burn it with, so the smelter is a cold box. The Magma Boiler never does
  // this — a card that switched off the smelters you already had would be a
  // punishment dealt as a reward.
  function coldSmelter(run, m) {
    return !!m && m.type === 'smelter' && isMut(run, 'coldseam') &&
           !touchesMagma(run, m);
  }

  function stepMachine(run, m) {
    const B = D.BUILDINGS[m.type];
    const wasDepleted = m.status === 'depleted';
    if (m.repairAt > 0 && run.t >= m.repairAt) {
      if (m.hp === 1) { m.hp = B.hp; msg(run, B.name + ' self-repaired.', D.COLORS.green); }
      m.repairAt = 0;
    }
    // Belt-like structures move their cargo on the belt clock, in stepBelts —
    // ejecting here as well would make them faster than the belts they sit in.
    if (!isBeltLike(m)) tryEject(run, m);
    // `missing` (M-ONBOARD) is the input an assembler is short of, or null —
    // the one fault the status word cannot express, because a starving
    // assembler and a brand new one both read 'idle'.
    // `cold` (M-MANTLE) is the fifth fault: a smelter on a cold seam floor,
    // standing nowhere near the only heat the floor has.
    let working = false, nofuel = false, depleted = false, missing = null;
    let cold = false;
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
      // M-MANTLE/'cold seam' + M-SCHEMS2/Magma Boiler: at the forge the heat
      // is the planet's, so no fuel is drawn and none is missed. Under cold
      // seam a smelter anywhere else does not start a job at all.
      const forge = forgeSmelter(run, m);
      cold = coldSmelter(run, m);
      if (!cold && !m.job && m.out.length === 0) {
        let r = null;
        if ((m.input.ironOre || 0) >= 1) r = 'smeltIron';
        else if ((m.input.copperOre || 0) >= 1) r = 'smeltCopper';
        if (r) {
          if (!forge && m.fuel <= 0 && (m.input.coal || 0) > 0) {
            m.input.coal--;
            m.fuel = D.FUEL_PER * (run.mods.coalX2 ? 2 : 1);
          }
          if (forge || m.fuel > 0) {
            if (!forge) m.fuel--; // one smelt per fuel unit
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
        // M-SCHEMS2/Echo Charges: the fifth charge needs nothing at all — not
        // a discount on the recipe but a job that starts with the buffer as it
        // is, so a line four charges deep gets its fifth even while the
        // crystal run is still arriving.
        const free = m.recipe === 'charge' && run.mods.echoCharge &&
                     ((run.echoN || 0) + 1) % D.ECHO_EVERY === 0;
        let can = true;
        if (!free)
          for (const k in rec.in)
            if ((m.input[k] || 0) < rec.in[k]) { can = false; missing = k; break; }
        if (can) {
          if (!free) for (const k in rec.in) m.input[k] -= rec.in[k];
          if (m.recipe === 'charge' && run.mods.echoCharge)
            run.echoN = (run.echoN || 0) + 1;
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
    } else if (m.type === 'crusher') {
      // M-TIER2: the hazard, banked. Nearest rubble first (pure arithmetic on
      // the grid — no roll, law 7), one grind per period, ore out the arrow.
      if (m.out.length === 0 && !halfSkip(run, m)) {
        const cell = crushTarget(run, m);
        if (!cell) m.progress = 0;
        else {
          m.progress++;
          working = true;
          if (m.progress >= B.period) {
            m.progress = 0;
            crush(run, m, cell);
            tryEject(run, m);
          }
        }
      }
    }
    // A belt-like structure holding cargo is not "blocked" — that is what a
    // working one looks like on most ticks. It is blocked when the cargo has
    // been sitting there longer than a belt step could explain.
    const stuck = isBeltLike(m)
      ? (m.out.length > 0 && run.t - (m.moveT || 0) > HZ)
      : m.out.length > 0;
    const lonely = m.type === 'tunnel' && !m.pair;
    m.status = lonely ? 'unpaired'
      : depleted ? 'depleted'
      : m.hp === 1 ? 'damaged'
      : cold ? 'cold'
      : nofuel ? 'nofuel'
      : stuck ? 'blocked'
      : isBeltLike(m) ? (m.out.length ? 'ok' : 'idle')
      : (working || m.job) ? 'ok' : 'idle';
    // v1.1 (SPEC2 §B) debounce stamps: run.t of when the underlying condition
    // began, 0 while clear. Based on the raw condition (not display precedence)
    // so a damaged-but-jammed machine still reads as jammed.
    if (stuck) { if (!m.blockedSince) m.blockedSince = run.t; }
    else m.blockedSince = 0;
    if (lonely) { if (!m.lonelySince) m.lonelySince = run.t; }
    else m.lonelySince = 0;
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
    if (m.lonelySince && run.t - m.lonelySince >= G.blockedT * HZ)
      diag(run, 'tunnel', { gap: tunnelGap(run) });
  }

  // ---------------- belts (§5.2) ----------------
  // M-TIER2 widened this from "belt tiles" to "the logistics network": belt
  // tiles AND the belt-like structures, moving on the same clock, compressed
  // by the same multi-pass loop. The pass order is belts row-major first and
  // then structures by ascending id, so a network with no tier-II structure in
  // it steps exactly as it always did.
  function pushDevice(run, m) {
    const item = m.out[0];
    if (m.type === 'splitter') {
      const dirs = splitDirs(run, m);
      for (let i = 0; i < dirs.length; i++) {
        const k = (((m.side | 0) + i) % dirs.length);
        const d = dirOf(dirs[k]);
        if (giveTo(run, item, m.x + d.dx, m.y + d.dy)) {
          m.out.shift();
          // Alternation is state on the machine, never a roll (law 7). A
          // blocked side is skipped rather than stalled on, so a splitter
          // feeding one live line and one dead one is a line, not a jam.
          m.side = (k + 1) % dirs.length;
          return true;
        }
      }
      return false;
    }
    if (m.type === 'tunnel') {
      if (m.mode === 'in') {
        const o = m.pair && run.machines[m.pair];
        if (!o || o.out.length) return false;
        o.out.push(item);
        o.moved = true; o.moveT = run.t;
        m.out.shift();
        return true;
      }
    } else if (m.type === 'filter' && item !== filterItem(m)) {
      // Only Sorting Gates ever hold cargo they do not pass; it goes right.
      const d = dirOf(m.facing + 1);
      if (!giveTo(run, item, m.x + d.dx, m.y + d.dy)) return false;
      m.out.shift();
      return true;
    }
    const d = dirOf(m.facing);
    if (!giveTo(run, item, m.x + d.dx, m.y + d.dy)) return false;
    m.out.shift();
    return true;
  }

  function stepBelts(run) {
    const W = D.MAP_W, H = D.MAP_H, g = run.grid;
    const belts = []; // row-major, loaded belts only
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const b = g[y][x].belt;
        if (b) { b.moved = false; if (b.item) belts.push({ x: x, y: y, b: b }); }
      }
    const devs = [];
    const dids = Object.keys(run.machines).map(Number).sort(function (a, b) { return a - b; });
    for (const id of dids) {
      const m = run.machines[id];
      if (!isBeltLike(m)) continue;
      m.moved = false;
      // The loader's pull, once per belt step and from ONE tile: the machine
      // its arrow points out of. Its cargo can then travel in this same step,
      // so a loader is a belt's worth of throughput and not half of one.
      if (m.type === 'loader' && !m.out.length) {
        const src = loaderSource(run, m);
        if (src && src.out.length) { m.out.push(src.out.shift()); m.moveT = run.t; }
      }
      devs.push(m);
    }
    for (let pass = 0; pass < 60; pass++) {
      let moved = false;
      for (const e of belts) {
        const b = e.b;
        if (!b.item || b.moved) continue;
        const d = D.DIRS[b.dir];
        if (!giveTo(run, b.item, e.x + d.dx, e.y + d.dy)) continue;
        b.item = null; b.moved = true; moved = true;
      }
      for (const m of devs) {
        if (!m.out.length || m.moved) continue;
        if (!pushDevice(run, m)) continue;
        m.moved = true; m.moveT = run.t; moved = true;
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
  // M-MANTLE/'hungry drill': she bites 1.7x as often and takes two gears a
  // bite. That is a THROUGHPUT question and not a nerf — the same base makes
  // the same gears per second, and whether the floor is faster or slower than
  // it was depends entirely on whether that number was above 2x the feed rate
  // or below it. A base with slack gets a floor 70% quicker; a base that was
  // exactly keeping up starves. Charges are untouched: the drill is hungry for
  // gears, and two hungers would be two mutators.
  function drillCost(run) { return mutVal(run, 'hungry', 'gearCost', 1); }
  function drillPeriod(run) {
    return Math.max(1, Math.round(D.DRILL_PERIOD / run.mods.drillMult /
      mutVal(run, 'hungry', 'drillMult', 1) /
      (run.overdrive ? D.OVERDRIVE.drillMult : 1)));
  }
  function stepDrill(run) {
    const cost = drillCost(run);
    if (run.gearsFed < run.breachReq.gear && (run.inv.gear || 0) >= cost) {
      run.inv.gear -= cost;
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
      // ...and 'a gear' means a bite's worth: a hungry drill with one gear in
      // the crate is as stalled as one with none (M-MANTLE).
      if (!((run.inv.gear || 0) >= drillCost(run))) diag(run, 'stallGear', {});
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
    // halfSkip: every other tick — unless Jury Rig is paying the hull for it.
    const dmg = m.hp === 1 && !(run.mods && run.mods.juryRig) ? 0.5 : 1;
    if (m.type === 'extractor') {
      if (m.status === 'depleted') return 0;
      return HZ * run.mods.extractMult * auraMult(run, 'extract', m.x, m.y) / B.period * dmg;
    }
    if (m.type === 'smelter') {
      // M-MANTLE/'cold seam': a smelter off the magma makes nothing, and the
      // panel says nothing rather than a rate it will never reach — the same
      // honesty a mined-out extractor and an unfed crusher already get.
      if (coldSmelter(run, m)) return 0;
      return HZ * run.mods.smeltMult * auraMult(run, 'smelt', m.x, m.y) /
             D.RECIPES.smeltIron.ticks * dmg;
    }
    if (m.type === 'assembler') {
      const rec = D.RECIPES[m.recipe || 'gear'];
      return HZ / rec.ticks * dmg;
    }
    // M-TIER2. A crusher with nothing to chew makes nothing, and says so —
    // the same honesty a mined-out extractor gets. Rubble arrives in quakes,
    // which is minutes apart, so this is a state and not a flicker.
    if (m.type === 'crusher') {
      if (!m.cell) return 0;             // the tick's own survey, read not redone
      return HZ / B.period * B.yield * dmg;
    }
    // The routing layer carries; it does not make. Its rate is the belt's,
    // which is what the CHAIN header prints beside the count — the number
    // that says out loud why a line only ever jams when the player
    // under-builds a MACHINE (SPEC §12).
    if (isBeltLike(m)) return HZ / D.BELT_PERIOD;
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
    let crushN = 0;                                    // ...of which crushers
    let plateRate = 0, plateN = 0;
    let gearRate = 0, gearN = 0, gearIn = 0, gearOut = 0;
    let chargeRate = 0, chargeN = 0;
    let routeN = 0, routeRate = 0, lonely = 0;
    let coldN = 0;                                     // M-MANTLE/'cold seam'
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
      } else if (m.type === 'crusher') {
        // M-TIER2: a crusher is an ore machine, so it stands in the ore stage
        // beside the extractors rather than in a row of its own — the panel
        // teaches SUPPLY, and where the supply comes from is the tooltip's job.
        add2('ironOre', r);
        oreRate += r; oreN++; crushN++;
      } else if (isBeltLike(m)) {
        routeN++;
        routeRate = Math.max(routeRate, r);
        if (m.status === 'unpaired') lonely++;
      } else if (m.type === 'smelter') {
        const rec = D.RECIPES[smelterRecipe(m)];
        for (const k in rec.in) add2(k, -r * rec.in[k]);
        for (const k in rec.out) add2(k, r * rec.out[k]);
        // The forge burns the planet's coal, not yours. A CHAIN panel still
        // drawing a coal drain for a Magma Boiler smelter would send the
        // player mining a vein they do not need (M-MANTLE / M-SCHEMS2).
        if (!forgeSmelter(run, m))
          add2('coal', -r / (D.FUEL_PER * (run.mods.coalX2 ? 2 : 1)));
        plateRate += r; plateN++;
        if (m.status === 'nofuel') noCoal = true;
        if (m.status === 'cold') coldN++;
      } else if (m.type === 'assembler') {
        const rec = D.RECIPES[m.recipe || 'gear'];
        // M-SCHEMS2/Echo Charges: one charge in five costs nothing, so the
        // whole recipe draws four fifths of what it reads on the card.
        const inMult = (m.recipe === 'charge' && run.mods && run.mods.echoCharge)
          ? 1 - 1 / D.ECHO_EVERY : 1;
        for (const k in rec.in) add2(k, -r * rec.in[k] * inMult);
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
    // The ore stage can be manned by two different machines. `parts` is what
    // the panel prints when it is ('2E1C'); `n` stays the total, because every
    // other reader of this model asks how many machines are on the stage.
    stages[0].parts = crushN
      ? [{ n: oreN - crushN, letter: 'E' }, { n: crushN, letter: 'C' }]
        .filter(p => p.n > 0)
      : [{ n: oreN, letter: 'E' }];
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
      } else if (s.id === 'plate' && coldN) {
        // A cold smelter is not starved and it is not out of coal — it is in
        // the wrong place, and that is the only sentence that helps.
        s.flag = 'COLD';
      } else {
        s.flag = (s.id === 'plate' && noCoal) ? 'NO COAL' : s.limiting ? 'STARVED' : '';
      }
    }
    // A charge stage that cannot keep up is its own lesson, and charges gate
    // the breach from stratum 5 down, so it is flagged on its own terms.
    const cs = stages.filter(s => s.id === 'charge')[0];
    if (cs) cs.flag = cs.n === 0 ? 'NONE' : (cs.rate <= 0 ? 'STALLED' : '');
    const gears = lim ? Math.max(0, lim.gears) : 0;
    return {
      stages: stages, flow: flow,
      gearRate: gears, chargeRate: chargeRate, drillRate: drillRate,
      perGear: perGear, noCoal: noCoal, blocked: blocked,
      starved: starved, damaged: damaged,
      // M-TIER2: the routing layer, counted and rated. It is never a stage —
      // it makes nothing, and a row for it would push the LOG off the panel —
      // so it rides the CHAIN header, where the count says what you built and
      // the rate says why it is not your bottleneck (SPEC §12).
      route: { n: routeN, rate: routeRate, lonely: lonely },
      // M-MANTLE: gears per bite (1, or 2 under 'hungry drill') and how many
      // smelters this floor has frozen out. Both are read by the panel and
      // both are what makes the projection below true rather than optimistic.
      drillCost: drillCost(run), cold: coldN,
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
    // M-MANTLE/'hungry drill': the leg is measured in BITES, not gears, so a
    // crate of 40 with a two-gear bite is twenty bites and a line making 1
    // gear/s feeds half a bite a second. Divide both by the cost and the rest
    // of the arithmetic is unchanged — which is the whole reason the mutator
    // is expressed as a cost rather than as a second kind of feed.
    const gc = drillCost(run);
    const g = leg(req.gear - run.gearsFed, (run.inv.gear || 0) / gc, gearsPerSec / gc);
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
    // M-MANTLE/'the seal': the other half of the sprint. The floor is 30%
    // cheaper to leave and half again as expensive to stand on.
    rate *= mutVal(run, 'seal', 'instMult', 1);
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
    unpairTunnel(run, m);        // M-TIER2: the far end goes back to lonely
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
    let glassOpened = 0;                        // M-MANTLE/'glass floors'
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
        // M-MANTLE/'glass floors': ground the planet has already buried once
        // does not survive being hit twice — it opens. A rubble field used to
        // be a nuisance you dug through at leisure (and, since M-TIER2, a
        // supply line you parked a crusher in); here it is the map wearing
        // through, and the hole it leaves is permanent. Chasm is not
        // diggable, not buildable and not bridgeable except by a tunnel, so
        // an eroding floor is a base that has to keep moving.
        else if (t.rubble && isMut(run, 'glass')) {
          t.rubble = false; t.belt = null; t.digT = 0;
          t.ore = null; t.oreAmt = 0;
          t.t = 'chasm';
          glassOpened++;
        } else { t.rubble = true; t.belt = null; }
      }
    }
    if (glassOpened > 0) {
      msg(run, 'The glass floor gives — ' + glassOpened +
          (glassOpened === 1 ? ' tile' : ' tiles') + ' opened onto nothing.',
          D.COLORS.blue);
      pushEvent(run, 'glass', { tiles: glassOpened });
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
    // The adjacency test used to be a closure here. It is `adjMagma(run,x,y)`
    // up by the forge helpers now, because M-MANTLE's cold seam asks the same
    // question of the same tiles and two answers to "is this touching lava"
    // is precisely the divergence this file keeps warning about.
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
          // ...and neither is the smith. A smelter working the forge is the
          // one machine the lava does not take — otherwise 'build beside the
          // magma' would be an instruction that destroys what it built, and
          // both the mutator and the card would read as bugs.
          if (t.t === 'floor' && t.machine !== 0 && !t.lm && adjMagma(run, x, y) &&
              !(t.machine !== null && forgeSmelter(run, run.machines[t.machine])))
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
          if (t.belt && adjMagma(run, x, y)) t.belt = null;
        }
      const ids = Object.keys(run.machines).map(Number).sort((a, b) => a - b);
      for (const id of ids) {
        const m = run.machines[id];
        if (!m) continue;
        if (forgeSmelter(run, m)) continue;      // the chimney does not burn
        let adj = false;
        for (let y = m.y; y < m.y + m.h && !adj; y++)
          for (let x = m.x; x < m.x + m.w && !adj; x++)
            if (adjMagma(run, x, y)) adj = true;
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
    // M-TIER2: sealed until its stratum. The BUILD panel does not list a
    // locked structure either, so this is the belt-and-braces half.
    if (!unlocked(run, type))
      return { ok: false, reason: 'no schematics until stratum ' + B.unlockDepth };
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
    const m = {
      id: id, type: type, x: x, y: y, w: B.w, h: B.h, facing: facing, hp: B.hp,
      progress: 0, recipe: type === 'assembler' ? 'gear' : null,
      input: {}, fuel: 0, status: 'idle', repairAt: 0,
      blockedSince: 0, nofuelSince: 0, starveSince: 0, out: [], job: null,
      // M-TIER2: the tier-II state. `side` is the splitter's next preferred
      // arrow, `filter` the gate's cargo, `mode`/`pair` the tunnel's two ends,
      // `cell` the tile a crusher is chewing, `moveT` the last handoff.
      side: 0, filter: type === 'filter' ? D.ITEM_ORDER[0] : null,
      mode: null, pair: 0, cell: null, moved: false, moveT: 0, lonelySince: 0,
    };
    run.machines[id] = m;
    for (let ty = y; ty < y + B.h; ty++)
      for (let tx = x; tx < x + B.w; tx++) run.grid[ty][tx].machine = id;
    if (type === 'tunnel') pairTunnel(run, m);
    return true;
  }

  function demolishAt(run, x, y) {
    const t = tileAt(run, x, y);
    if (!t) return { ok: false, reason: 'out of bounds' };
    if (t.machine !== null) {
      if (t.machine === 0) return { ok: false, reason: 'the rig is not yours to scrap' };
      const m = run.machines[t.machine];
      const B = D.BUILDINGS[m.type];
      // M-SCHEMS2/Gravity Chute: the refund fraction lives on the mods now.
      const refund = (run.mods && run.mods.refund) || D.DEMOLISH_REFUND;
      for (const k in B.cost) add(run.inv, k, Math.floor(B.cost[k] * refund));
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
    // M-TIER2: the gate's whole interface. Cycling through ITEM_ORDER means
    // the cargo you want is always the same number of clicks from the cargo
    // beside it in the STOCK panel — one order, everywhere.
    if (m.type === 'filter') {
      const list = D.ITEM_ORDER;
      m.filter = list[(list.indexOf(filterItem(m)) + 1) % list.length];
      return { handled: true, kind: 'filter',
               msg: 'filter → ' + D.ITEMS[m.filter].name };
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
  // M-TIER2: a schematic may be gated — to the floor its structures unlock on
  // (`minDepth`, measured against the stratum the card will be USED on, which
  // on a descent is the one below the one being left) and to having built one
  // (`needs`). An ungated card is dealt exactly as it always was, and a deck
  // with no gated card in it is byte-identical to the old deck: same members,
  // same order, same number of draws out of run.rng. That is deliberate — a
  // player who never touches tier II must get the run they would have got.
  function schematicPool(run, depth) {
    const built = (run.stats && run.stats.placed) || {};
    return D.SCHEMATICS
      .filter(s => (!s.minDepth || depth >= s.minDepth) &&
                   (!s.needs || (built[s.needs] || 0) > 0))
      .map(s => s.id)
      .filter(id => run.schematics.indexOf(id) < 0);
  }

  function offerSchematics(run) {
    let pool = schematicPool(run, run.depth + 1);
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
    // M-TIER2: the fourth thing the red '!' can mean.
    unpaired: 'no far end — place its pair',
    // M-MANTLE/'cold seam': the fifth. There is no coal on this floor to be
    // out of, so the fix is a place and not a delivery.
    cold: 'cold — build it beside magma',
  };

  // M-TIER2: what a tier-II structure is doing, in the 29 columns the panel
  // clips at. Each one names the tiles its arrow chose, because "facing, not
  // adjacency" is the rule these exist to conjugate and a tooltip that does
  // not say which way a thing points teaches the wrong half of it.
  function tier2Lines(run, m) {
    const L = [];
    if (m.type === 'splitter') {
      L.push({ text: 'fans ' + splitDirs(run, m).map(k => D.ARROWS[k]).join(' '),
               color: D.COLORS.cyan });
    } else if (m.type === 'tunnel') {
      const o = m.pair && run.machines[m.pair];
      if (o) {
        const d = Math.abs(o.x - m.x) + Math.abs(o.y - m.y);
        L.push({ text: m.mode === 'in' ? 'entrance — far end ' + d + ' on'
                                       : 'exit — cargo surfaces here',
                 color: D.COLORS.cyan });
      }
    } else if (m.type === 'loader') {
      const s = loaderSource(run, m);
      L.push({ text: s ? 'empties the ' + D.BUILDINGS[s.type].name + ' behind'
                       : 'no machine behind it',
               color: s ? D.COLORS.cyan : D.COLORS.red });
    } else if (m.type === 'filter') {
      const it = D.ITEMS[filterItem(m)];
      L.push({ text: 'passes ' + it.name + ' ' + it.glyph, color: it.color });
      if (run.mods && run.mods.smartGate)
        L.push({ text: 'the rest shunts ' + D.ARROWS[(m.facing + 1) % 4],
                 color: D.COLORS.cyan });
      L.push({ text: 'click: cycle the cargo', color: D.COLORS.amberDim });
    } else if (m.type === 'crusher') {
      const B = D.BUILDINGS.crusher;
      L.push({ text: m.cell ? 'grinding — ' + B.yield + ' ore a go'
                            : 'nothing to grind in ' + B.reach,
               color: m.cell ? D.COLORS.steel : D.COLORS.gray });
      if (run.mods && run.mods.crushRock)
        L.push({ text: 'it eats the rock too', color: D.COLORS.steel });
    }
    if (isBeltLike(m) && m.out.length)
      L.push({ text: 'holds ' + itemShort(m.out[0]), color: D.COLORS.gray });
    return L;
  }

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
      // M-MANTLE / M-SCHEMS2: a smelter at the forge has no fuel line, because
      // it has no fuel — the sentence that replaces it is the reason why.
      if (forgeSmelter(run, m))
        L.push({ text: 'the forge feeds it — no coal', color: D.COLORS.magma });
      else if (m.type === 'smelter' || m.type === 'damper')
        L.push({ text: fuelLine(m), color: D.COLORS.orange });
      if (m.type === 'extractor') {
        const ot = tileAt(run, m.x, m.y);
        if (ot && ot.ore)
          L.push({ text: D.ITEMS[ot.ore].name + ' — ' + ot.oreAmt + ' left', color: D.ORE_GLYPHS[ot.ore].color });
      }
      for (const l of tier2Lines(run, m)) L.push(l);   // M-TIER2
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
    // M-TIER2: the plural of it (a splitter has two arrows, three with
    // s_yoke; a tunnel entrance's is its far end), whether a structure is
    // sealed on this floor, and whether it moves cargo rather than making it.
    outputTiles: outputTiles, unlocked: unlocked, beltLike: isBeltLike,
    tunnelGap: tunnelGap, filterItem: filterItem, loaderSource: loaderSource,
    // M-ONBOARD: the diagnostics. diagLines() is every sentence they can emit
    // (worst case filled in) so the suites can hold the lot to the LOG panel;
    // STATUS_HINT is the '!' legend the SCAN panel draws.
    diagLine: diagLine, diagLines: diagLines, STATUS_HINT: STATUS_HINT,
    // M-MANTLE: this floor's rule, as its data.js entry (null on strata 1-8),
    // and the table it was rolled from — which is filtered by what is loaded,
    // so a suite can assert that an absent module is absent from the deck.
    // Nothing here rolls: `mutatorOf` is a lookup, and the ONE draw lives in
    // startStratum (§0 law 7).
    mutatorOf: mutDef, mutatorTable: mutatorTable,
    // The two questions the forge answers, exported because the tooltip, the
    // CHAIN panel and the suites all have to ask them and must not each grow
    // their own idea of "beside the magma" (M-MANTLE / M-SCHEMS2).
    forgeSmelter: forgeSmelter, coldSmelter: coldSmelter,
    // Gears per bite ('hungry drill' makes it 2) and the sweep's radius
    // ('the dark rises' freezes it), both read by render and by the suites.
    drillCost: drillCost, revealRadius: revealRadius,
  };
})();
