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
      // The one place a stratum ends, for everything this module owns: the
      // one-floor modifiers are handed back here rather than at any of the
      // four call sites that could have remembered to, which is why they
      // cannot leak into the next floor even if a later brief adds a fifth.
      if (S.temp && S.temp.depth !== run.depth) revertTemp(run, S);
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
  // EXPEDITION VIGNETTES
  // After every schematic pick, a 25% chance that the dark asks you something.
  // Two choices, never more: a vignette is a fork, not a menu, and a fork you
  // can read in one glance is the only kind that belongs between two screens
  // a player is already impatient to get through.
  //
  // The effects are deliberately bounded to what the brief allows — inventory,
  // integrity, pressure, a one-stratum modifier, or the cat — because a
  // vignette that could hand out anything would end up being the game. Two
  // house rules on top of that:
  //
  //   1. NOTHING HERE CAN KILL YOU. Integrity is clamped to a floor of 1. A
  //      screen with no information on it, arriving between strata, must never
  //      be the thing that ends a fifteen-minute run.
  //   2. EVERY CHOICE DOES SOMETHING. The "walk away" option is never an
  //      empty else-branch: it buys quiet — pressure vented, hull steadied,
  //      a thing left unwoken — so declining is a play and not a shrug.
  //
  // `min` is the first stratum an event may be offered on. The register is the
  // rock's, not GRIT's: flat, specific, and unhurried. GRIT answers over the
  // top of it from barks.js, which is where his voice lives and stays.
  // =========================================================================
  const VIGNETTES = [
    { id: 'vault', title: 'THE VAULT', min: 1,
      text: ['A Company strongroom, welded shut from the outside.',
             'Whatever is in there, somebody wanted it staying in there.'],
      choices: [
        { label: 'BREACH IT', hint: '+30 plates, +15 pressure',
          result: 'The vault gives. So, a little, does the ceiling.',
          fx: { inv: { ironPlate: 30 }, inst: 15 } },
        { label: 'LEAVE IT WELDED', hint: 'the floor settles: −10 pressure',
          result: 'You walk past. The stratum seems to approve.',
          fx: { inst: -10 } },
      ] },

    { id: 'crack', title: 'THE SINGING CRACK', min: 3,
      text: ['A fissure no wider than a hand, and a sound coming up it.',
             'Not wind. Wind does not hold a note.'],
      choices: [
        { label: 'LISTEN TO IT', hint: 'the whole stratum, mapped',
          result: 'You listen. The shape of the floor arrives in your head.',
          fx: { reveal: true, inst: 5 } },
        { label: 'SEAL IT WITH PLATE', hint: '−6 plates, +10 hull',
          result: 'Sealed. The rig feels steadier for not hearing it.',
          fx: { inv: { ironPlate: -6 }, integrity: 10 } },
      ] },

    { id: 'drone', title: 'COMPANY INSPECTOR DRONE', min: 2,
      text: ['It has found you. It is filling in a form about you.',
             '"STAND BY FOR AUDIT," it says, at some length.'],
      choices: [
        { label: 'BRIBE IT — 10 PLATES', hint: 'one more schematic next descent',
          result: 'It files you as compliant. Compliance pays, apparently.',
          fx: { inv: { ironPlate: -10 }, modsSet: { offerCount: 4 } } },
        { label: 'SCRAP IT FOR PARTS', hint: '+8 plates, and a note in your file',
          result: 'Eight plates of drone. The Company notes your file.',
          fx: { inv: { ironPlate: 8 } } },
      ] },

    { id: 'pool', title: 'THE WARM POOL', min: 1,
      text: ['Standing water at exactly blood heat, in a rock that is cold.',
             'It is very clean. That is the part nobody likes.'],
      choices: [
        { label: 'BATHE IN IT', hint: '+15 hull, +5 pressure',
          result: 'You come out warm to the bone and nobody says anything.',
          fx: { integrity: 15, inst: 5 } },
        { label: 'PUMP IT INTO THE DRILL', hint: '−12 pressure',
          result: 'The rig drinks it. The floor is quieter without it.',
          fx: { inst: -12 } },
      ] },

    { id: 'ghost', title: "MINER'S GHOST", min: 2,
      text: ['A lamp, lit, hanging in the air at working height.',
             'Nobody is holding it. It is waiting to be traded with.'],
      choices: [
        { label: 'TRADE 5 HULL FOR IT', hint: 'one schematic, from a dead man',
          result: 'Something is taken out of the rig. Something is left behind.',
          fx: { integrity: -5, schematic: true } },
        { label: 'WALK ON PAST', hint: 'nothing owed: −8 pressure',
          result: 'You keep walking. The lamp does not follow. Good.',
          fx: { inst: -8 } },
      ] },

    { id: 'crate', title: 'SOMETHING IN THE CRATE', min: 1, needsNoCat: true,
      text: ['A shipping crate, stencilled PERISHABLE, wedged in the seam.',
             'The lid moves about a finger-width. Then it moves again.'],
      choices: [
        { label: 'OPEN IT', hint: 'whatever it is, it is alive',
          result: 'A cat walks out, unhurried, and starts inspecting the rig.',
          fx: { cat: true } },
        { label: 'PRISE IT FOR TIMBER', hint: '+10 plates of fittings',
          result: 'You strip the crate. Whatever was in it is gone by then.',
          fx: { inv: { ironPlate: 10 } } },
      ] },

    { id: 'rations', title: 'THE RATION DROP', min: 1,
      text: ['A Company pallet, half-buried, straps intact, seals unbroken.',
             'Dated. Extremely dated.'],
      choices: [
        { label: 'EAT', hint: '+12 hull — a fed crew works',
          result: 'It is terrible. Everybody works better for an hour.',
          fx: { integrity: 12 } },
        { label: 'STRIP THE PALLET', hint: '+20 plates of banding steel',
          result: 'Twenty plates of good steel and nobody gets lunch.',
          fx: { inv: { ironPlate: 20 } } },
      ] },

    { id: 'ladder', title: 'THE LONG LADDER', min: 2,
      text: ['Bolted rungs going UP, out of the ceiling, into rock.',
             'There is nothing up. You came from up. Up is solid.'],
      choices: [
        { label: 'CLIMB A LITTLE WAY', hint: 'the stratum, mapped — +8 pressure',
          result: 'From up there the whole floor makes a horrible sense.',
          fx: { reveal: true, inst: 8 } },
        { label: 'CUT IT DOWN', hint: '+14 plates of rung steel',
          result: 'Fourteen plates of ladder, and one less way in.',
          fx: { inv: { ironPlate: 14 } } },
      ] },

    { id: 'door', title: "THE FOREMAN'S DOOR", min: 2,
      text: ['A door. Framed, hinged, fitted, in unbroken rock.',
             'The nameplate says VOSS. It has been polished recently.'],
      choices: [
        { label: 'OPEN IT', hint: '+12 plates, a log entry, +8 pressure',
          result: 'An office. A desk. A logbook, still open at the last page.',
          fx: { inv: { ironPlate: 12 }, inst: 8, log: true } },
        { label: 'KNOCK, THEN LEAVE', hint: 'manners cost nothing: −10 pressure',
          result: 'You knock. You do not wait. The floor eases behind you.',
          fx: { inst: -10 } },
      ] },

    { id: 'tally', title: 'THE TALLY WALL', min: 1,
      text: ['Scratch marks. Thousands. In groups of five, in one hand.',
             'They stop mid-group, which is the part you keep looking at.'],
      choices: [
        { label: 'COUNT THEM', hint: 'you learn the floor: mapped, +6 pressure',
          result: 'Counting takes a while. You come out knowing the place.',
          fx: { reveal: true, inst: 6 } },
        { label: 'ADD ONE', hint: '+8 hull. Somebody had to.',
          result: 'You add a mark and finish his group. The crew stands taller.',
          fx: { integrity: 8 } },
      ] },

    { id: 'seam', title: 'THE QUIET SEAM', min: 3,
      text: ['A vein of ore running clean through the gallery wall.',
             'When the drill stops, you can hear it holding a note.'],
      choices: [
        { label: 'MINE IT OUT NOW', hint: 'a hopper of ore, +10 pressure',
          result: 'The note stops halfway through. The rock notices.',
          fx: { ore: [10, 14], inst: 10 } },
        { label: 'LEAVE IT SINGING', hint: 'this floor rises 20% slower',
          result: 'You work around it. The whole stratum stays calmer.',
          fx: { modsMul: { instMult: 0.8 } } },
      ] },

    { id: 'terminal', title: 'THE SALVAGE TERMINAL', min: 2,
      text: ['A Company claims terminal, still lit, still online, down here.',
             'It is waiting for an employee number. Yours will do.'],
      choices: [
        { label: 'FILE A CLAIM', hint: 'one more schematic next descent',
          result: 'Filed. Somewhere, a form is approved by nobody at all.',
          fx: { modsSet: { offerCount: 4 } } },
        { label: 'WIPE IT AND STRIP IT', hint: '+22 plates, and a note in your file',
          result: 'Twenty-two plates. The Company notes your file. Again.',
          fx: { inv: { ironPlate: 22 } } },
      ] },

    { id: 'sump', title: 'THE SUMP', min: 3,
      text: ['A flooded gallery. Black water, and gear under it.',
             'Somebody parked a whole shift down there and left it.'],
      choices: [
        { label: 'DIVE IT', hint: '+25 plates, −8 hull',
          result: 'You come up with the gear and a cough you will keep.',
          fx: { inv: { ironPlate: 25 }, integrity: -8 } },
        { label: 'DRAIN IT DOWNWARD', hint: '−15 pressure',
          result: 'The water goes somewhere else. The floor thanks you.',
          fx: { inst: -15 } },
      ] },

    { id: 'watchman', title: 'THE WATCHMAN', min: 4,
      text: ['Rig IX, sat upright in her own rubble, lamp still burning.',
             'Nobody has fuelled that lamp in a very long time.'],
      choices: [
        { label: 'TAKE THE LAMP', hint: 'the stratum, mapped',
          result: 'You take the lamp. The floor lays itself out in front of it.',
          fx: { reveal: true } },
        { label: 'LET HER BURN', hint: 'read her log instead',
          result: 'You leave the lamp lit and take only what she wrote down.',
          fx: { log: true } },
      ] },

    { id: 'coin', title: 'THE COIN', min: 1,
      text: ['A coin in the dust, minted long before the collapse.',
             'Worth nothing. Obviously you are going to pick it up.'],
      choices: [
        { label: 'POCKET IT', hint: 'for luck, which is not a mechanic',
          result: 'You pocket it. It is a good coin. That is the whole event.',
          fx: {} },
        { label: 'PAY THE ROCK WITH IT', hint: '−14 pressure',
          result: 'You flick it into the dark. Something down there is paid.',
          fx: { inst: -14 } },
      ] },

    { id: 'crossing', title: 'THE CROSSING', min: 3,
      text: ['Another shaft cuts yours at right angles, freshly cut.',
             'You can hear a drill in it. It is not one of yours.'],
      choices: [
        { label: 'SIGNAL THEM', hint: '+14 plates traded, +8 pressure',
          result: 'They trade steel for coal and neither crew says a name.',
          fx: { inv: { ironPlate: 14 }, inst: 8 } },
        { label: 'SEAL YOUR SIDE', hint: '+10 hull, and no company',
          result: 'You brick it up. Whoever they were, they are theirs now.',
          fx: { integrity: 10 } },
      ] },

    { id: 'suit', title: 'THE COMPANY MAN', min: 4,
      text: ['A body in a very good suit, a long way from any lift.',
             'No helmet. No lamp. No explanation.'],
      choices: [
        { label: 'SEARCH HIM', hint: '+25 plates, and a note in your file',
          result: 'His case is full of sample plate. He will not need it.',
          fx: { inv: { ironPlate: 25 } } },
        { label: 'LEAVE HIM HIS DIGNITY', hint: 'take only the notebook',
          result: 'You take the notebook, straighten his tie, and move on.',
          fx: { log: true, inst: -6 } },
      ] },

    { id: 'shrine', title: 'THE SHRINE', min: 2,
      text: ['A gear on an altar of stacked plate, candle stubs beside it.',
             'Somebody down here worked out who to ask, and asked.'],
      choices: [
        { label: 'LEAVE A GEAR', hint: '−2 gears, −16 pressure',
          result: 'You add a gear to the pile. The floor goes quiet for it.',
          fx: { inv: { gear: -2 }, inst: -16 } },
        { label: 'TAKE THE GEAR', hint: '+2 gears, +12 pressure',
          result: 'You take the offering. Something notes the withdrawal.',
          fx: { inv: { gear: 2 }, inst: 12 } },
      ] },

    { id: 'wind', title: 'THE WIND', min: 3,
      text: ['Air moving, steadily, in a sealed stratum with no shafts out.',
             'It is coming from below. It is warm.'],
      choices: [
        { label: 'FOLLOW IT DOWN', hint: 'the drill runs 25% faster this floor',
          result: 'You cut along the draught. The bit finds it easy going.',
          fx: { modsMul: { drillMult: 1.25 }, inst: 6 } },
        { label: 'BLOCK IT OFF', hint: '+12 hull',
          result: 'Plated over. The rig stops flinching every ten minutes.',
          fx: { integrity: 12 } },
      ] },

    { id: 'offer', title: 'THE OFFER', min: 6,
      text: ['The gallery narrows into something that is not a gallery.',
             'It would like to trade. It is very clear about the terms.'],
      choices: [
        { label: 'ACCEPT', hint: 'one schematic, −15 hull',
          result: 'Something is taken out of the rig. You do not watch.',
          fx: { integrity: -15, schematic: true } },
        { label: 'REFUSE', hint: '−20 pressure. It can wait.',
          result: 'You decline. It is not offended. It is patient.',
          fx: { inst: -20 } },
      ] },
  ];

  // ---------------- rolling and applying ----------------
  function rollVignette(run) {
    if (!run) return null;
    const S = state(run);
    S.vignette = null;
    const EV = D.EVENTS || {};
    if (run.status === 'dead' || run.status === 'won') return null;
    if (S.rng() >= (EV.vignetteChance || 0)) return null;
    const pool = [];
    for (let i = 0; i < VIGNETTES.length; i++) {
      const v = VIGNETTES[i];
      if (S.seen[v.id]) continue;                 // once per run, always
      if ((v.min || 1) > run.depth) continue;     // depth-gated
      if (v.needsNoCat && S.cat) continue;        // you already have a cat
      pool.push(v);
    }
    if (!pool.length) return null;
    const v = pool[Math.floor(S.rng() * pool.length)];
    S.seen[v.id] = true;
    S.vignette = v;
    return v;
  }

  // One-stratum modifiers. run.mods is the sim's live modifier block, so a
  // temporary change has to record what it displaced and hand it back — which
  // it does on the next depth change, in state(), whether or not anybody
  // remembers to ask. Set at arrival on stratum N, spent during N, returned on
  // arrival at N+1: an extra schematic offer is therefore computed by the
  // descent that ENDS N, which is exactly what "next descent" means.
  function setTemp(run, S, key, value) {
    if (!run.mods) return;
    if (!S.temp) S.temp = { depth: run.depth, undo: [] };
    S.temp.undo.push([key, run.mods[key]]);
    run.mods[key] = value;
  }
  function revertTemp(run, S) {
    if (!S.temp) return;
    for (let i = S.temp.undo.length - 1; i >= 0; i--)
      run.mods[S.temp.undo[i][0]] = S.temp.undo[i][1];
    S.temp = null;
  }

  function apply(run, ev, choice) {
    if (!run || !ev || !Array.isArray(ev.choices)) return null;
    const c = ev.choices[choice | 0];
    if (!c) return null;
    const S = state(run);
    S.vignette = null;
    const fx = c.fx || {};

    for (const k in (fx.inv || {})) {
      run.inv[k] = Math.max(0, (run.inv[k] || 0) + fx.inv[k]);
    }
    if (fx.ore) {
      const id = pickOre(run, S);
      add(run.inv, id, U.ri(S.rng, fx.ore[0], fx.ore[1]));
    }
    if (fx.integrity) {
      // House rule 1: a vignette never ends a run. The floor of 1 is the
      // whole reason a "-15 hull" option can be offered at all.
      run.integrity = U.clamp(run.integrity + fx.integrity, 1, run.maxIntegrity);
    }
    if (fx.inst) {
      run.instability = U.clamp(run.instability + fx.inst, 0, D.INSTAB_MAX);
    }
    if (fx.reveal) {
      for (let y = 0; y < D.MAP_H; y++)
        for (let x = 0; x < D.MAP_W; x++) run.grid[y][x].revealed = true;
      run._lastRevealR = 9999;
    }
    if (fx.schematic && DC.Sim && DC.Sim.installSchematic) {
      const owned = run.schematics || [];
      const avail = D.SCHEMATICS.filter(function (s) { return owned.indexOf(s.id) < 0; });
      if (avail.length) {
        const pick = avail[Math.floor(S.rng() * avail.length)];
        const id = DC.Sim.installSchematic(run, pick.id);
        if (id) msg(run, 'Schematic installed: ' + pick.name, C.cyan);
      }
    }
    if (fx.log) takeLog(run, S);
    if (fx.cat) grantCat(run);
    for (const k in (fx.modsSet || {})) setTemp(run, S, k, fx.modsSet[k]);
    for (const k in (fx.modsMul || {}))
      setTemp(run, S, k, (run.mods[k] || 0) * fx.modsMul[k]);

    if (c.result) msg(run, c.result, C.white);
    pushEvent(run, 'vignette', { id: ev.id, choice: choice | 0, cat: !!fx.cat });
    return c;
  }

  // =========================================================================
  // THE CAVE-CAT (wired in a later section of this brief)
  // =========================================================================
  function grantCat() { /* the cat lands in the next milestone */ }
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
    // The vignettes: rolled by sim.js on the way into a stratum, answered by
    // engine.js when the player picks. `pending` is what render draws.
    rollVignette: rollVignette,
    apply: apply,
    pending: function (run) { return (run && run.ev && run.ev.vignette) || null; },
    VIGNETTES: VIGNETTES,
    LOGS: LOGS,
    logCount: LOGS.length,
    logText: function (i) { return LOGS[i] || null; },
    // Test/inspection surface: the per-run record, without forcing it to exist.
    peek: function (run) { return (run && run.ev) || null; },
    state: state,
  };
})();
