/* DEEPCORE — events.js (SPEC3 M-EVENTS)
   DC.Events: the roguelike texture layer. Three things live here —

     dig finds     what the rock had in it (8% of completed excavations)
     the logbook   twenty foremen who did not come back up
     vignettes     the two-choice question the dark asks between strata
     the cat       and the one answer that purrs

   DOM-free, and deterministic. GRIT's answer to all of it is in barks.js;
   the numbers are in data.js; the panels are in art.js. This module owns the
   rolls, the effects, and the authored event text.

   ── on randomness ────────────────────────────────────────────────────────
   The brief says "all rng from run.rng". Every roll here is deterministic
   from the run's seed, but it is drawn from a stream DERIVED from that seed
   rather than from run.rng itself, for one reason: run.rng also schedules
   quakes and picks the tiles they land on. Drawing from it here would mean
   the number of holes a player dug decided which tiles the next quake ate,
   and every balance number in test/balance.js would move with the shape of
   the base rather than with the tuning. data.js's EGG420 note already
   promised this ("that module owns the roll; sim.js never draws for it"), so
   the derived stream is the contract the rest of the tree was written to.
   Same seed and same play still produce the same finds, in the same order,
   forever — which is what determinism is for.

   Nothing in here reads a clock, a DOM, or Math.random. The cat writes
   nothing back into the sim: it is a render-side creature that happens to
   live in run state so it stays deterministic and survives a pause. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA, U = DC.util;
  const HZ = D.TICK_HZ;
  const C = D.COLORS;

  // ---------------- shared plumbing ----------------
  // Mirrors sim.js's private pushEvent: engine.js splice-drains run.events
  // every tick and turns these into GRIT lines and meta writes. Kept local
  // rather than exported from sim because the queue is a data contract (a
  // {type, t, data} record), not a function one.
  function pushEvent(run, type, data) {
    if (!Array.isArray(run.events)) return;
    run.events.push({ type: type, t: run.totalT, data: data || null });
    if (run.events.length > 200) run.events.shift();
  }
  function msg(run, text, color) {
    if (DC.Sim && DC.Sim.msg) DC.Sim.msg(run, text, color);
  }
  function add(inv, item, n) { if (inv) inv[item] = (inv[item] || 0) + n; }
  function stratumOf(run) {
    return run.depth <= D.STRATA_COUNT ? D.STRATA[run.depth - 1]
                                       : D.mantleStratum(run.depth);
  }
  function tileAt(run, x, y) {
    if (!run.grid || x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H) return null;
    return run.grid[y][x];
  }
  function weighted(rng, list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i].w || 0;
    if (total <= 0) return null;
    let r = rng() * total;
    for (let i = 0; i < list.length; i++) {
      r -= list[i].w || 0;
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  // ---------------- per-run state ----------------
  // Lazily attached, exactly like barks.js's run._barks: a run that never digs
  // and never sees a vignette never grows one, and a run object built by a
  // test scaffold needs no new fields to be legal.
  function state(run) {
    if (!run.ev) {
      run.ev = {
        rng: U.mulberry32(((run.seed >>> 0) ^ 0x0EBE5747) >>> 0),
        depth: 0,          // last stratum seen (per-floor reset detection)
        digs: 0, finds: 0, // counters, for the suites and the recap
        rigTaken: false,   // a dead rig is salvaged once per floor
        gas: null,         // { at, x, y } — the pocket, hissing, about to pop
        logs: [],          // indices into LOGS found this run
        vignette: null,    // the rolled vignette awaiting a choice
        seen: {},          // vignette id -> true (never offered twice a run)
        temp: null,        // { depth, undo: [[key, prev]] } one-stratum mods
        cat: null,         // { x, y, mode, hold } — see the cat section
      };
    }
    const S = run.ev;
    if (S.depth !== run.depth) {
      S.depth = run.depth;
      S.rigTaken = false;
      S.gas = null;            // a fuse never survives a descent
      if (S.cat) homeCat(run, S);
    }
    return S;
  }

  // =========================================================================
  // DEAD FOREMEN OF THE DEEP
  // Twenty rigs that didn't make it, one line each. Found entries persist in
  // the meta save and stack up in the Foundry's logbook — a lore jigsaw you
  // assemble across runs. Several of them are the Core's foreshadowing seen
  // from the other side (the singing, the warmth, the thing keeping time):
  // M-CORELORE wrote those beats, these are the men who heard them first and
  // filed a report about it, because that is what foremen do.
  // =========================================================================
  const LOGS = [
    'Log 3: New seam. Company wants it by Friday. Which Friday? -Fmn. Dunne',
    'Log 44: The coal is singing again. Ignoring it. -Fmn. Okafor',
    "Log 9: Floor's warm on eleven. Warmer than the smelters. -Fmn. Voss",
    'Log 14: Told the crew it was the pumps. We have no pumps. -Fmn. Voss',
    'Log 18: Something under the bit keeps time. Four beats. -Fmn. Abara',
    'Log 21: Requisition denied. Dampers denied. Morale denied. -Fmn. Pike',
    'Log 26: Rig Twelve stopped answering. We kept drilling. -Fmn. Reyes',
    'Log 30: Counted the gears twice. Something counted along. -Fmn. Okafor',
    'Log 33: A cat came down with the coal. She stays. -Fmn. Halloran',
    'Log 35: The cat quits the smelter before every quake. -Fmn. Halloran',
    'Log 38: Below seven the echo comes back early. -Fmn. Idris',
    'Log 41: The Company calls it settling. I call it breathing. -Fmn. Pike',
    'Log 47: Lost Marchetti to the glass. Bill management. -Fmn. Reyes',
    "Log 52: It is not hot down here. It is warm. That's worse. -Fmn. Voss",
    'Log 55: Drill hit something that did not want to be rock. -Fmn. Kovac',
    'Log 58: My name is on this shaft. Nobody asked me first. -Fmn. Dunne',
    'Log 60: It knows the shift whistle. It waits for it. -Fmn. Idris',
    'Log 63: Sealed the west gallery. Do not open it. -Fmn. Kovac',
    'Log 70: We are the deepest crew alive. Correction: awake. -Fmn. Abara',
    'Log 77: If you are reading this, you got further than us. -Fmn. Okafor',
  ];

  // One log the player has not seen this run, preferred; failing that, any.
  // The meta save decides what the Foundry lists — this only decides what the
  // rock hands over next, and repeating yourself inside one run is the one
  // way a twenty-line corpus can feel like four.
  function takeLog(run, S) {
    const fresh = [];
    for (let i = 0; i < LOGS.length; i++)
      if (S.logs.indexOf(i) < 0) fresh.push(i);
    const pool = fresh.length ? fresh : LOGS.map(function (l, i) { return i; });
    const i = pool[Math.floor(S.rng() * pool.length)];
    S.logs.push(i);
    msg(run, LOGS[i], C.gold);
    // engine.js persists it into the profile; a missing meta hook just means
    // the line was read once and not filed, which is still a line read.
    pushEvent(run, 'foremanLog', { index: i, text: LOGS[i] });
    return i;
  }

  // =========================================================================
  // DIG FINDS
  // 8% of completed rock excavations yield something. Digging is already a
  // real cost in plates-of-time, so this is the rock paying a little of it
  // back — and occasionally charging interest (SPEC3 §0 law 4: the finds push
  // you forward, none of them ask you to stand still and farm).
  // =========================================================================
  function findTable(S) {
    const all = D.FINDS || [];
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const f = all[i];
      if (f.id === 'rig' && S.rigTaken && D.EVENTS.rigOncePerStratum) continue;
      out.push(f);
    }
    return out;
  }

  function rollDig(run, x, y) {
    if (!run || !run.grid) return null;
    if (run.status !== 'active' && run.status !== 'breachReady') return null;
    const S = state(run);
    const EV = D.EVENTS || {};
    S.digs++;

    // EGG-420's dig route (M-GRITPLUS built the window and left this roll to
    // us). It is rolled against every excavation rather than against the 8%
    // find table on purpose: at 0.42% OF FINDS the tin surfaces about once in
    // eight hundred runs, which is not an easter egg, it is a rumour. Once a
    // run — the window is a joke, and a joke does not get told twice.
    const EG = D.EGG420;
    if (EG && EG.digWeight > 0 && !run.eggSeen && S.rng() < EG.digWeight) {
      S.finds++;
      msg(run, 'A tin, pre-collapse, perfectly preserved. Still sealed.', C.leaf);
      if (DC.Sim && DC.Sim.startEgg) DC.Sim.startEgg(run, 'dig');
      pushEvent(run, 'find', { id: 'tin', bark: 'egg420' });
      return 'tin';
    }

    if (S.rng() >= (EV.findRate || 0)) return null;
    const f = weighted(S.rng, findTable(S));
    if (!f) return null;
    S.finds++;
    applyFind(run, S, f, x, y);
    pushEvent(run, 'find', { id: f.id, bark: f.bark });
    return f.id;
  }

  function pickOre(run, S) {
    const ores = stratumOf(run).ores || { ironOre: 1 };
    const list = [];
    for (const k in ores) list.push({ id: k, w: ores[k] });
    const e = weighted(S.rng, list);
    return e ? e.id : 'ironOre';
  }

  function applyFind(run, S, f, x, y) {
    const EV = D.EVENTS || {};
    switch (f.id) {
      case 'ore': {
        const id = pickOre(run, S);
        const n = U.ri(S.rng, f.amt[0], f.amt[1]);
        add(run.inv, id, n);
        const it = D.ITEMS[id];
        msg(run, 'An ore pocket spills open — ' + n + ' ' + it.name + '.', it.color);
        break;
      }
      case 'cache': {
        const n = U.ri(S.rng, f.amt[0], f.amt[1]);
        add(run.inv, 'ironPlate', n);
        msg(run, 'A pre-collapse cache — ' + n + ' plates, still greased.', C.white);
        break;
      }
      case 'lunchbox':
        msg(run, 'A lunchbox, sealed. Packed for a shift that ended.', C.gray);
        break;
      case 'bones':
        msg(run, 'Bones in the seam, folded neat. Boots set beside them.', C.gray);
        break;
      case 'gas':
        // The hiss first, the pocket a second later: a whole second of "oh no"
        // is worth more than the eight points of pressure it costs.
        S.gas = { at: run.t + (EV.gasFuse || HZ), inst: f.inst || 8 };
        msg(run, 'A thin hiss out of the fresh face. Then nothing.', C.orange);
        break;
      case 'shaft': {
        const r = EV.shaftR || 6, r2 = r * r;
        let n = 0;
        for (let ty = 0; ty < D.MAP_H; ty++)
          for (let tx = 0; tx < D.MAP_W; tx++) {
            const t = run.grid[ty][tx];
            if (t.revealed) continue;
            if ((tx - x) * (tx - x) + (ty - y) * (ty - y) <= r2) { t.revealed = true; n++; }
          }
        msg(run, 'An old shaft yawns open — the scan runs down it.', C.cyan);
        break;
      }
      case 'rig':
        S.rigTaken = true;
        add(run.inv, 'ironPlate', f.plates || 12);
        msg(run, 'A dead rig, gutted. Salvage: +' + (f.plates || 12) + ' plates.',
            C.steel);
        takeLog(run, S);
        break;
    }
  }

  // The gas pocket's fuse, and (later) the cat. One tick hook, called from
  // sim.js after the hazards have run so the cat can read a quake that was
  // scheduled this very tick.
  function tick(run) {
    if (!run || !run.ev) return;          // nothing has happened yet: no work
    const S = state(run);
    if (S.gas && run.t >= S.gas.at) {
      const inst = S.gas.inst;
      S.gas = null;
      run.instability = U.clamp(run.instability + inst, 0, D.INSTAB_MAX);
      msg(run, 'Gas pocket — the air goes sour (+' + inst + ' pressure).', C.red);
    }
    stepCat(run, S);
  }

  // =========================================================================
  // THE CAVE-CAT (wired in a later section of this brief)
  // =========================================================================
  function homeCat() { /* the cat lands in the next milestone */ }
  function stepCat() { /* ditto */ }

  // ---------------- public API ----------------
  DC.Events = {
    rollDig: rollDig,
    tick: tick,
    // M-WONDERS' Company Seal asks for one of these when it is opened. Any
    // caller that has a reason to hand the player a piece of the jigsaw uses
    // this; the roll, the LOG line and the meta write are all on this side.
    grantLog: function (run) { return run ? takeLog(run, state(run)) : null; },
    LOGS: LOGS,
    logCount: LOGS.length,
    logText: function (i) { return LOGS[i] || null; },
    // Test/inspection surface: the per-run record, without forcing it to exist.
    peek: function (run) { return (run && run.ev) || null; },
    state: state,
  };
})();
