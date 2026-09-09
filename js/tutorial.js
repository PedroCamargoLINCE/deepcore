/* DEEPCORE — tutorial.js (SPEC3 M-ONBOARD Part 2 + M-TUTORIAL2)
   DC.Tutorial: the first-run induction. Two acts, eight lessons, each GATED ON
   THE PLAYER ACTUALLY DOING THE THING, on the real generated map — there is no
   scripted sandbox anywhere in this file, and nothing here places, rotates or
   belts anything on the player's behalf.

     ACT ONE — the legal minimum (the pressure pause holds)
     1 place   an extractor on the marked iron vein
     2 rotate  R, and the arrow that says where the ore comes out
     3 belt    a line from that arrow to the rig
     4 ore     the first delivery lands, and the panels take over the teaching
     — the act break: the minimum is met, TAB is offered a second time,
       staying is a choice, and the floor is tightening again —
     ACT TWO — closing the loop, on the Company's time
     5 smelt   a smelter, with ore belted into it
     6 coal    the smelter sits DARK with ore queued — the machine visibly not
               working is the lesson (Finding 1's soft-lock, taught before it
               bites): a SECOND extractor, on coal, same smelter
     7 craft   an assembler, plates to gears
     8 feed    a gear the player's own line made reaches the rig; the form is
               signed and the run is handed over

   REACTIVE, NOT SCRIPTED (Finding 3's 2026-08-25 amendment): every gate is a
   pure read of sim state, so a beat the player has ALREADY satisfied passes
   on sight — with a line where GRIT notices, not a lecture — and a returning
   player who speedruns the chain watches the induction sprint to keep up.

   Part 1 already makes every failure state name its own cause in the LOG, so
   the induction never repeats a diagnostic; and CHAIN and STOCK are the
   player's co-teachers from beat 4 on, which is why act one ends by POINTING
   at them — and act two ends by pointing right again, not by restating the
   chain the manual and CHAIN already explain.

   DOM-free and deterministic. Nothing in this module rolls: the line for a beat
   is a pure hash of (seed, beat, restatement) through Barks.tutor, every gate is
   a pure read of sim state, and the geometry is arithmetic on D.MAP_*. Law 7 is
   the reason — the induction runs on a LIVE run whose map, schematic offers and
   quake schedule all come off run.rng, so a single stolen number would make the
   game a player got depend on how long they took to find the R key.

   Pressure pauses while it runs: `run.instHold` freezes instability until the
   first ore reaches the rig (sim.js), so nobody loses their first run to a
   quake while reading — least of all to a punchline. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;
  const HZ = D.TICK_HZ;
  const CFG = D.TUTORIAL;

  // 'break' is the act break — a beat of its own in the FLOW (it owns the
  // screen for a moment, and TAB is a real offer there) but not a LESSON: it
  // gates on nothing, stamps nothing, and the title counts 8, not 9.
  const BEATS = ['place', 'rotate', 'belt', 'ore', 'break',
                 'smelt', 'coal', 'craft', 'feed'];
  const LESSONS = BEATS.filter(function (b) { return b !== 'break'; });

  // Which build key selects a thing, asked of the keymap rather than typed in
  // — engine.js binds D.BUILD_ORDER[n-1] to the digit n, so a reordering of
  // that list moves the keycap in the box with it instead of making the
  // tutorial lie about the controls (which is the one bug a tutorial cannot
  // have).
  function buildKey(type) {
    const i = D.BUILD_ORDER.indexOf(type);
    return i < 0 ? '?' : String(i + 1);
  }
  function oreGlyph(id) {
    const g = D.ORE_GLYPHS && D.ORE_GLYPHS[id];
    return (g && g.glyph) || '*';
  }

  function tileAt(run, x, y) {
    if (!run || !run.grid) return null;
    if (x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H) return null;
    return run.grid[y][x];
  }
  function hubCentre(run) {
    return run.hub ? { x: run.hub.x + 1, y: run.hub.y + 1 } : { x: 0, y: 0 };
  }

  // The vein a beat teaches on. Stratum 1 guarantees iron AND coal near the
  // rig (map.js's ensureVeins); this picks the CLOSEST revealed one by squared
  // distance, ties broken by scan order, so the choice is a pure function of
  // the map and every player on a seed is taught on the same tile. A map with
  // none revealed at all (the Mantle, a cold seam, a test fixture) simply
  // yields null and the beat that wanted it does not arm — it never invents a
  // target. M-TUTORIAL2 generalized this over `ore` so the coal beat runs the
  // same lazy-wait dance the iron vein always has.
  function pickVein(run, ore) {
    ore = ore || 'ironOre';
    const h = hubCentre(run);
    let best = null, bestD = Infinity;
    for (let y = 0; y < D.MAP_H; y++) {
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (!t || !t.revealed || t.ore !== ore || t.oreAmt <= 0) continue;
        if (t.machine !== null || t.belt || t.lm || t.t !== 'floor') continue;
        const d = (x - h.x) * (x - h.x) + (y - h.y) * (y - h.y);
        if (d < bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  // The machine the player put down. The FIRST one by machine id, so a player
  // who builds three keeps being taught about the one the box has been
  // pointing at since the beat began.
  function firstOf(run, type) {
    if (!run || !run.machines) return null;
    const ids = Object.keys(run.machines).map(Number).sort(function (a, b) { return a - b; });
    for (let i = 0; i < ids.length; i++) {
      const m = run.machines[ids[i]];
      if (m && m.type === type && (m.job || m.out.length ||
          (type === 'smelter' && oreQueued(m)))) return m;
    }
    for (const id of ids) if (run.machines[id].type === type) return run.machines[id];
    return null;
  }
  function firstExtractor(run) {
    return Object.values((run && run.machines) || {}).find(m => m.type === 'extractor' &&
      tileAt(run,m.x,m.y).ore === 'ironOre') || null;
  }

  // ---- the act-two reads, all pure (M-TUTORIAL2) ----
  // Ore standing in the smelter's intake. While the smelter is dark this stays
  // visibly queued (stepMachine only consumes input when it can light a job),
  // which is exactly the picture the coal beat teaches from.
  function oreQueued(m) {
    return ((m.input.ironOre || 0) + (m.input.copperOre || 0)) > 0;
  }
  // The smelter has heat: coal in the intake, fuel in the box, or a job lit by
  // the planet itself (a Magma Boiler forge never draws fuel — sim.js). A lit
  // smelter is the coal lesson ACHIEVED, however it was achieved.
  function smelterLit(m) {
    return m.fuel > 0 || (m.input.coal || 0) > 0 || (!!m.job && m.status !== 'nofuel');
  }
  // A gear the player's line made, arriving at the rig. Start stock never
  // passes through Sim's deliver(), so this cannot be satisfied by the eight
  // gears the run begins with — only by a belt or an output facing her.
  function gearDelivered(run) {
    const by = run.stats && run.stats.deliveredBy;
    return ((by && by.gear) | 0) > 0;
  }

  function outTile(m) {
    if (DC.Sim && DC.Sim.outputTile) return DC.Sim.outputTile(m);
    if (m.facing === 0) return { x: m.x + ((m.w - 1) >> 1), y: m.y - 1 };
    if (m.facing === 1) return { x: m.x + m.w, y: m.y + ((m.h - 1) >> 1) };
    if (m.facing === 2) return { x: m.x + ((m.w - 1) >> 1), y: m.y + m.h };
    return { x: m.x - 1, y: m.y + ((m.h - 1) >> 1) };
  }

  // Can anything ever come out of this machine's output side? This is the exact
  // failure that defeated the director: an extractor whose teeth face solid
  // rock mines one ore, blocks, and sits there being silently correct. The
  // rotate beat will not pass while it is true, and the box says so in words
  // that name the fix.
  function outputFouled(run, m) {
    const o = outTile(m);
    const t = tileAt(run, o.x, o.y);
    if (!t) return true;                       // the output points off the map
    if (t.machine !== null || t.belt) return false;   // already feeding something
    return t.t !== 'floor' || !!t.lm || !!t.rubble;
  }

  // Does a line of belts run from (x, y) into the rig? Walks the belts the way
  // an item does — one tile per hop, in the direction each belt is aimed — so a
  // player who laid a beautiful line that turns left one tile early gets told
  // the truth rather than a compliment.
  function reachesRig(run, x, y) {
    let cx = x, cy = y;
    for (let hop = 0; hop < D.MAP_W * D.MAP_H; hop++) {
      const t = tileAt(run, cx, cy);
      if (!t) return false;
      if (t.machine === 0) return true;
      if (!t.belt) return false;
      const d = D.DIRS[t.belt.dir];
      cx += d.dx; cy += d.dy;
    }
    return false;
  }

  // ---------------- eligibility & lifecycle ----------------

  // A profile with zero completed runs that has not already seen this. The
  // `runs` half is what keeps a save written before this brief out of the
  // induction: an old profile has no `tutorialSeen` field at all, so it loads
  // with the false default, and the run count is what says it does not need
  // teaching (M-ONBOARD's "trigger on a profile with zero completed runs").
  function eligible(meta) {
    if (!meta) return false;
    if (meta.tutorialSeen) return false;
    return ((meta.runs | 0) === 0);
  }

  // Arming is LAZY about its vein, and measured rather than assumed: across 200
  // seeds an iron vein is inside the opening scan radius at t=0 on 198 of them
  // and on all 200 within five seconds, because the scan is still growing when
  // the run starts. Refusing to arm on the two would have made the induction
  // silently absent for one player in a hundred — so it arms anyway and picks
  // the tile the moment the sweep hands one over, and gives up (quietly, and
  // releasing the pressure pause) if a map really has none.
  // `force` is the title screen's REPLAY INDUCTION door, and it bypasses
  // eligibility only — everything after arms identically, so a replay is the
  // real thing and not a preview of it. Two players need this and neither is
  // served by the one-way flag on its own: the one who hit TAB in the first ten
  // seconds and regretted it, and the one coming back after a month away. It is
  // also the only way the director can watch his own tutorial, since his
  // profile has runs on it — and a game whose tutorial can only be re-entered
  // through devtools has a tutorial nobody on the team will ever re-read.
  function begin(run, meta, force) {
    if (!run || (!force && !eligible(meta))) return false;
    run.tutorial = {
      i: 0, salt: 0, nudges: 0,
      beatT: run.totalT, armT: run.totalT,
      enterT: run.totalT,
      depth0: run.depth,
      vein: pickVein(run),
      rotated: false, facing0: null,
      hold: 0,          // run.totalT the finished box stops lingering
      over: false,      // the whole induction is behind us
      skipped: false,
      seen: {},         // beat id -> the totalT it was completed on
      // M-TUTORIAL2 (act two + the reactive layer):
      coalVein: null,   // the second vein, found by the same lazy wait as iron
      pre: 0,           // totalT until which a pre-passed beat's notice lingers
      joltT: 0,         // the last quake the face flinched at (mood, law 8-clean)
    };
    // The pressure pause. Instability is what schedules quakes, so this is the
    // whole of "nobody loses their first run to a quake while reading".
    run.instHold = true;
    return true;
  }

  function active(run) {
    return !!(run && run.tutorial && !run.tutorial.over);
  }
  function state(run) { return (run && run.tutorial) || null; }
  function beatId(run) {
    const T = state(run);
    if (!T || T.over) return null;
    if (T.skipped) return 'skipped';
    return T.i < BEATS.length ? BEATS[T.i] : 'outro';
  }

  // The skip key, live from the first frame — including before the first sim
  // tick has run, which is what "skippable from the first keypress" has to
  // mean. The induction is over the instant this lands; the box lingers for
  // one beat only so GRIT can be seen approving of the decision, and the
  // approval is delivered in the SAME box every other line is, on the same
  // width contract, rather than being squeezed into the foreman bar.
  function skip(run) {
    const T = state(run);
    if (!T || T.over || T.skipped) return false;
    T.skipped = true;
    T.i = BEATS.length;
    T.line = pick(run, 'skip', 0);
    T.hold = run.totalT + CFG.holdT * HZ;
    release(run);
    return true;
  }

  // The floor starts breathing again. Called when the ore lands and again on
  // any exit, because an induction that ended early must not leave the game
  // permanently becalmed.
  function release(run) { if (run) run.instHold = false; }

  function pick(run, beat, salt) {
    const B = DC.Barks;
    if (!B || typeof B.tutor !== 'function') return null;
    try { return B.tutor(run, beat, salt); } catch (e) { return null; }
  }

  // ---------------- the gates ----------------
  // Each returns true when the PLAYER has done the thing. Nothing here has a
  // timer in it: a beat cannot pass by waiting, and does not fail by waiting
  // either.
  function passed(run, T, id, ui) {
    switch (id) {
      case 'place':
        return !!firstExtractor(run);
      case 'rotate': {
        const m = firstExtractor(run);
        if (!m) return false;
        return (T.rotated || gearDelivered(run) ||
          Object.values(run.machines).some(s => s.type === 'smelter' && (oreQueued(s) || s.job))) &&
          !outputFouled(run, m);
      }
      case 'belt': {
        const m = firstExtractor(run);
        if (!m) return false;
        const o = outTile(m);
        return reachesRig(run, o.x, o.y) || gearDelivered(run) ||
          Object.values(run.machines).some(s => s.type === 'smelter' && (oreQueued(s) || s.job));
      }
      case 'ore':
        return ((run.stats && run.stats.delivered) | 0) > 0 ||
          Object.values(run.machines).some(s => s.type === 'smelter' && (oreQueued(s) || s.job));
      // ---- act two (M-TUTORIAL2). Outcomes, not ceremonies: each gate reads
      // what the CHAIN now does, so however the player got there counts.
      case 'smelt': {
        // a smelter exists and ore has reached it — queued, mid-job, or
        // already out the far side
        const s = firstOf(run, 'smelter');
        return !!s && (oreQueued(s) || !!s.job || s.out.length > 0);
      }
      case 'coal':
        // the smelter has heat, however it got it (belted coal, or a forge)
        return !!firstOf(run, 'smelter') && smelterLit(firstOf(run, 'smelter'));
      case 'craft': {
        // a gear is being made or has been made — the job, the output buffer,
        // or one already banked at the rig
        if (gearDelivered(run)) return true;
        const a = firstOf(run, 'assembler');
        return !!a && (a.job === 'gear' || a.job === 'bronzeGear' ||
                       a.out.indexOf('gear') >= 0);
      }
      case 'feed':
        return gearDelivered(run);
      // 'break' has no gate: tick() runs it on its own clock, and the player
      // starting act two early ends it early.
    }
    return false;
  }

  // The beat is done: stamp it, step past it, and — the reactive layer — if
  // the NEXT lesson is already satisfied, arm the notice instead of the
  // instruction, so GRIT gets to say "already built one" rather than teach a
  // thing the player has visibly done (Finding 3's amendment, the single
  // cheapest thing that makes the induction feel alive).
  function advance(run, T) {
    T.i++;
    T.salt = 0; T.nudges = 0;
    T.beatT = run.totalT;
    T.enterT = run.totalT;
    T.facing0 = null;
    T.pre = 0;
    if (T.i >= BEATS.length) {
      T.line = pick(run, 'outro', 0);
      T.hold = run.totalT + CFG.holdT * HZ;
      return;
    }
    const id = BEATS[T.i];
    if (id !== 'break' && passed(run, T, id, null)) {
      T.pre = run.totalT + CFG.noticeT * HZ;
    }
  }

  // ---------------- tick ----------------
  // Called from engine.js after every Sim.tick with the live ui, which is where
  // the R press lives (facing is a UI value, not a sim one — R aims the NEXT
  // placement, and teaching that honestly is the whole of beat two).
  function tick(run, ui) {
    const T = state(run);
    if (!T || T.over) return;

    // The face's quake flinch (M-TUTORIAL2). ui.shakeUntil is the engine's
    // 4-tick screen shake — too brief for an expression to be read — so the
    // moment is stamped here and mood() holds the alarm for a beat. Reading
    // the shake that HAPPENED is law-8-clean; run.quakeAt never is.
    if (ui && ui.shakeUntil && run.t < ui.shakeUntil) T.joltT = run.totalT;

    // A player who reaches the next floor with the induction still running has
    // left it behind, and the pressure pause goes with them — a frozen
    // instability gauge carried into stratum 2 would be a whole run played
    // without a quake. Breaching stratum 1 without ever delivering an ore is
    // very nearly impossible; "very nearly" is not a thing to leave load-bearing.
    if (run.depth !== T.depth0) { T.over = true; release(run); return; }

    // The finished box lingers for a beat so the sign-off can be read, then
    // the induction is done and the screen belongs to the game again.
    if (T.i >= BEATS.length) {
      if (T.hold && run.totalT >= T.hold) T.over = true;
      return;
    }

    // Still waiting for the sweep to hand over a vein to teach on.
    if (!T.vein) {
      T.vein = pickVein(run);
      if (!T.vein) {
        if (run.totalT - T.armT > CFG.armT * HZ) { T.over = true; release(run); }
        return;
      }
      T.beatT = run.totalT;      // the beat starts when the player can see it
    }

    const id = BEATS[T.i];

    // The act break (M-TUTORIAL2). No gate and no stamp: the legal minimum is
    // met, the floor is tightening again, TAB is a real offer, and staying is
    // a choice. It ends on its own clock — or the moment the player answers
    // it with a smelter, which is the only "waiting advances a beat" in this
    // file, and it is the point: the break is a pause, not a lesson.
    if (id === 'break') {
      if (firstOf(run, 'smelter') || run.totalT - T.beatT >= CFG.breakT * HZ) {
        advance(run, T);
      }
      return;
    }

    // A pre-passed beat: GRIT's notice is on screen. Let it be read, then
    // stamp and move on — the sprint, one readable step at a time.
    if (T.pre) {
      if (run.totalT >= T.pre) {
        T.seen[id] = run.totalT;
        if (id === 'ore') release(run);   // the floor may tighten now
        advance(run, T);
      }
      return;
    }

    // The coal beat's second vein, by the iron vein's own lazy-wait dance —
    // and the graceful giveup: a map with no coal to point at AND no forge to
    // skip the lesson with is a map where the chain cannot be finished, so
    // after armT the form closes at the legal minimum rather than nudging
    // forever at a wall (the brief's "never invent a target").
    if (id === 'coal' && !T.coalVein) {
      T.coalVein = pickVein(run, 'coal');
      const s = firstOf(run, 'smelter');
      if (!T.coalVein && !(s && smelterLit(s))) {
        if (run.totalT - T.enterT > CFG.armT * HZ) {
          T.i = BEATS.length;
          T.incomplete = true;
          T.line = 'No coal on the scan. Form suspended. Keep looking; H has the manual.';
          T.hold = run.totalT + CFG.holdT * HZ;
        }
        return;
      }
    }

    // Beat 2 watches the facing the player is aiming with. `facing0` is armed
    // when the beat starts rather than at newRun, so pressing R twenty times
    // during beat one does not silently pre-pass beat two.
    if (id === 'rotate' && ui) {
      if (T.facing0 === null) T.facing0 = ui.facing | 0;
      else if ((ui.facing | 0) !== T.facing0) T.rotated = true;
    }

    if (passed(run, T, id, ui)) {
      T.seen[id] = run.totalT;
      if (id === 'ore') release(run);   // the floor may tighten now
      advance(run, T);
      return;
    }

    // He is contractually required to restate. He restates with feeling, a
    // different line each time, and then he lets the silence do the work.
    if (T.nudges < CFG.nudgeMax && run.totalT - T.beatT > CFG.nudgeT * HZ) {
      T.nudges++;
      T.salt++;
      T.beatT = run.totalT;
    }
  }

  // ---------------- what the box says ----------------
  // The authored line, and then the two rows that must land even if the joke
  // did not: the ACTION (keys as inverse caps, drawn by render) and, when the
  // player has got themselves stuck in the one way this beat can stick, the
  // fix. `caps` entries are drawn inverse; `t` entries are plain.
  function line(run) {
    const T = state(run);
    if (!T) return null;
    if (T.skipped || T.i >= BEATS.length) return T.line || null;
    // A pre-passed beat gets the NOTICE pool — GRIT clocking what the player
    // already did — never the instruction for a thing that is visibly done.
    if (T.pre) return pick(run, 'notice_' + BEATS[T.i], 0);
    return pick(run, BEATS[T.i], T.salt);
  }

  function action(run) {
    const id = beatId(run);
    const ex = firstExtractor(run);
    switch (id) {
      case 'place':
        return [['cap', buildKey('extractor')], ['t', ' EXTRACTOR'], ['t', '   '],
                ['cap', '↵'], ['t', ' ON THE ' + oreGlyph('ironOre') + ' VEIN']];
      case 'rotate':
        return [['cap', 'R'], ['t', ' TURN THE OUTPUT ARROW ' + D.ARROWS[ex ? ex.facing : 1]]];
      case 'belt':
        return [['cap', buildKey('belt')], ['t', ' BELT'], ['t', '  '],
                ['cap', '↵'], ['t', ' ARROW ▸ RIG']];
      case 'ore':
        return [['t', 'WATCH THE RIG — AND THE PANELS ▶']];
      // ---- act two (M-TUTORIAL2) ----
      case 'break':
        return [['t', 'LEGAL MINIMUM MET · '], ['cap', buildKey('smelter')],
                ['t', ' FOR ACT TWO']];
      case 'smelt':
        return [['cap', buildKey('smelter')], ['t', ' SMELTER'], ['t', '   '],
                ['cap', '↵'], ['t', ' BELT ORE IN']];
      case 'coal':
        return [['cap', buildKey('extractor')],
                ['t', ' ON THE ' + oreGlyph('coal') + ' COAL ▸ SMELTER']];
      case 'craft':
        return [['cap', buildKey('assembler')],
                ['t', ' ASSEMBLER — PLATES ▸ GEARS']];
      case 'feed':
        return [['cap', buildKey('belt')],
                ['t', ' GEARS ▸ RIG — WATCH GEAR FILL']];
      case 'outro':
        return [['t', 'PACK PLATES; MACHINES STAY HERE ▶']];
      case 'skipped':
        return [['cap', 'H'], ['t', ' THE MANUAL, WHENEVER YOU WANT IT']];
    }
    return [];
  }

  // The one row that is allowed to be a scold. Only ever drawn when the beat
  // has a specific, nameable way of being stuck — otherwise it is blank air,
  // because a permanent warning row is a warning nobody reads.
  function warn(run) {
    const id = beatId(run);
    if (id === 'rotate') {
      const m = firstExtractor(run);
      if (!m || !outputFouled(run, m)) return null;
      return [['t', 'OUTPUT BURIED:'], ['t', ' '], ['cap', 'X'], ['t', ' SCRAP,'],
              ['t', ' '], ['cap', 'R'], ['t', ' RETRY']];
    }
    // The coal beat's whole pedagogy (M-TUTORIAL2): the smelter the player
    // just built, sitting dark with ore queued, and the real cause named — in
    // different words from Part 1's LOG diagnostic, which this must never
    // repeat. Drawn only while the failure is actually on the map.
    if (id === 'coal') {
      const s = firstOf(run, 'smelter');
      if (!s || smelterLit(s) || !oreQueued(s)) return null;
      return [['t', 'SMELTER DARK: COAL IS NOT STOCKED']];
    }
    return null;
  }

  // The way out, on screen from the first frame and on every beat. A tutorial
  // whose escape hatch is undocumented is a tutorial that has trapped somebody.
  function foot(run) {
    const id = beatId(run);
    if (!id || id === 'outro' || id === 'skipped') return [];
    return [['cap', 'TAB'], ['t', ' SKIP THE INDUCTION']];
  }

  // ---------------- the face (M-TUTORIAL2, Finding 4) ----------------
  // Which of GRIT's four expressions the box wears, as a PURE read of state
  // the game already tracks — law 7 twice over: nothing here rolls, and
  // nothing here is new bookkeeping. Precedence is danger first (alarmed),
  // then the joke he cannot keep off his face (proud), then approval
  // (pleased), then the default set of a man twenty years down a hole.
  function isJoke(s) { return /^(Why|What|How) /.test(String(s || '')); }
  function lastSeenT(T) {
    let t = -Infinity;
    for (const k in T.seen) if (T.seen[k] > t) t = T.seen[k];
    return t;
  }
  function mood(run) {
    const T = state(run);
    if (!T) return 'deadpan';
    // alarmed: the floor bit back — a quake just landed (stamped by tick from
    // ui.shakeUntil, never from run.quakeAt: the surprise stays a surprise),
    // the hull is low, or the machine the box points at is visibly failing.
    if (T.joltT && run.totalT - T.joltT < 3 * HZ) return 'alarmed';
    if (run.maxIntegrity > 0 && run.integrity / run.maxIntegrity < 0.4) return 'alarmed';
    if (warn(run)) return 'alarmed';
    if (T.skipped) return 'deadpan';   // he approves, but with a straight face
    // pleased before proud here: the notice IS approval ("look at you"), even
    // when the notice line happens to be joke-shaped.
    if (T.pre) return 'pleased';
    // proud: he is telling one of HIS jokes — the setup-and-punchline shape
    // the corpus lint pins — and he wants you to know he wrote it.
    if (isJoke(line(run))) return 'proud';
    // pleased: a lesson just landed, a beat the player had already done, the
    // breach standing ready, or the finished form.
    if (T.i >= BEATS.length) return 'pleased';
    if (run.status === 'breachReady') return 'pleased';
    if (run.totalT - lastSeenT(T) < CFG.holdT * HZ) return 'pleased';
    return 'deadpan';
  }

  // The Company form's own furniture (M-TUTORIAL2, "paperwork as theater"):
  // the title counts LESSONS (the break is not one), and stamps() is the strip
  // of eight boxes on the box's bottom border, filled as each lesson passes —
  // a stamp per lesson, a signature at the end, in the contracts desk's visual
  // family.
  function lessonNo(T) {
    let n = 0;
    for (let i = 0; i <= T.i && i < BEATS.length; i++) if (BEATS[i] !== 'break') n++;
    return n;
  }
  function title(run) {
    const T = state(run);
    if (!T) return '';
    if (T.skipped) return 'GRIT ▸ INDUCTION — BINNED';
    if (T.incomplete) return 'GRIT ▸ INDUCTION — SUSPENDED';
    if (T.i >= BEATS.length) return 'GRIT ▸ INDUCTION — SIGNED OFF';
    if (BEATS[T.i] === 'break') return 'GRIT ▸ INDUCTION — MINIMUM MET';
    const act = T.i > BEATS.indexOf('break') ? ' — ACT TWO' : '';
    return 'GRIT ▸ INDUCTION ' + lessonNo(T) + '/' + LESSONS.length + act;
  }

  // One entry per lesson, in teaching order: done (stamped), and whether it is
  // the one under GRIT's pen right now. Render lays these into the bottom
  // border; a skipped induction shows the form as it stood.
  function stamps(run) {
    const T = state(run);
    if (!T) return [];
    const cur = T.i < BEATS.length && !T.skipped ? BEATS[T.i] : null;
    return LESSONS.map(function (b) {
      return { id: b, done: T.seen[b] !== undefined, cur: b === cur };
    });
  }

  // The sign-off row (outro only): the same 'x  ' signature furniture the
  // contracts desk uses, with GRIT's name on the line for once.
  function sig(run) {
    const T = state(run);
    if (!T || T.skipped || T.incomplete || T.i < BEATS.length) return null;
    return [['t', 'x  '], ['t', 'Grit'], ['t', ' — FOREMAN · COUNTERSIGNED']];
  }

  // ---------------- geometry ----------------
  // WHERE THE BOX GOES, and the whole of §0 law 6's clause about it: it must
  // never cover the thing it is pointing at.
  //
  // "Centre stage" is CENTRED ON THE MAP, not on COLS. M-WIDE put two columns
  // of live UI right of MAP_W + 3, so a box centred with the usual
  // (COLS - w) >> 1 would land squarely on CHAIN and STOCK — the two panels
  // this brief exists to point AT. Every number below derives from D.MAP_X /
  // D.MAP_W / D.MAP_H; there is not a margin typed anywhere in this file.
  //
  // Vertically it takes a map EDGE — top or bottom — and hangs its tail off the
  // side facing its target, aligned to the target's own column.
  //
  // Sitting it two rows off the target reads better and was tried first; it is
  // wrong, and the belt beat is what says so. The target of beats three and
  // four is the RIG, near the middle of the map, and a 40x8 box two rows from
  // the rig lands squarely on the ground the player is being asked to lay a
  // belt across. A tutorial that covers the work it just set is worse than one
  // that points from further away. On an edge, the whole middle of the map
  // stays clear to build in and the wedge plus the highlighted tile carry the
  // pointing.
  //
  // Which edge is CHOSEN rather than assumed, because the belt beat has two
  // tiles that must stay visible — the arrow the ore leaves by and the rig it
  // has to reach — and taking the edge opposite the rig can bury the arrow.
  // (It did; a seed sweep found it.) So both candidate spans are tested against
  // both tiles and the box takes one that clears them. If a map ever puts them
  // so far apart that neither edge does, the TARGET wins and `compromise` says
  // so out loud — the one rule that never bends is that the box does not cover
  // the thing it is pointing at.
  function target(run) {
    const T = state(run);
    if (!T) return null;
    const id = beatId(run);
    if (id === 'place') return { x: T.vein.x, y: T.vein.y };
    const m = firstExtractor(run);
    if (id === 'rotate' && m) return outTile(m);
    // act two (M-TUTORIAL2): each lesson points at its own machine the moment
    // it exists, and at the sensible precursor until then — never at a tile
    // the player cannot see.
    if (id === 'smelt' || id === 'coal' || id === 'craft') {
      const s = firstOf(run, 'smelter');
      if (id === 'smelt') return s ? { x: s.x, y: s.y } : hubCentre(run);
      if (id === 'coal') {
        // the SECOND vein is the lesson; the smelter is the 'from' end
        if (T.coalVein) return { x: T.coalVein.x, y: T.coalVein.y };
        return s ? { x: s.x, y: s.y } : hubCentre(run);
      }
      const a = firstOf(run, 'assembler');
      if (a) return { x: a.x, y: a.y };
      if (s) return { x: s.x, y: s.y };
    }
    return hubCentre(run);      // belt, feed, the break and the sign-off: her
  }

  function layout(run) {
    if (!active(run)) return null;
    const S = DC.Art && DC.Art.SPEECH;
    if (!S) return null;
    // No vein yet means nothing to teach on and therefore no box — pointing at
    // a tile the player cannot see is worse than silence. Being SKIPPED is the
    // exception: that line is about the decision, not about the map, and it
    // points at the rig, which is always there.
    if (!state(run).vein && beatId(run) !== 'skipped') return null;
    const tgt = target(run);
    if (!tgt) return null;
    // Beats with TWO ends the player needs at once: the belt beat (the arrow
    // the ore leaves by, and the rig) and — same idea, act two — the coal
    // beat (the coal vein, and the smelter it must feed).
    let from = null;
    if (beatId(run) === 'belt') {
      const ex = firstExtractor(run);
      from = ex ? outTile(ex) : null;
    } else if (beatId(run) === 'coal' && state(run).coalVein) {
      const s = firstOf(run, 'smelter');
      from = s ? { x: s.x, y: s.y } : null;
    }
    const w = S.W, h = S.H;
    const col = D.MAP_X + ((D.MAP_W - w) >> 1);
    // The two candidate edges, each measured WITH its tail row, since a wedge
    // sitting on the tile it points at is the same failure as a wall doing it.
    const bot = Math.max(0, D.MAP_H - h);
    const spans = {
      top: [0, Math.min(D.MAP_H - 1, h)],       // box rows 0..h-1, tail at h
      bot: [Math.max(0, bot - 1), D.MAP_H - 1], // tail at bot-1, box below it
    };
    const pts = from ? [tgt, from] : [tgt];
    const clears = function (k) {
      const s = spans[k];
      return !pts.some(function (p) { return p.y >= s[0] && p.y <= s[1]; });
    };
    const wantBot = tgt.y < (D.MAP_H >> 1);   // target up top -> box on the floor
    const first = wantBot ? 'bot' : 'top', second = wantBot ? 'top' : 'bot';
    let pickEdge = first, compromise = false;
    if (!clears(first)) {
      if (clears(second)) pickEdge = second;
      else compromise = true;                 // neither fits both; the target wins
    }
    const below = pickEdge === 'bot';
    const mapRow = below ? bot : 0;
    const row = D.MAP_Y + mapRow;
    const tailRow = below ? row - 1 : row + h;
    const tw = (DC.Art.SPEECH_TAIL_W || 3);
    let tailCol = D.MAP_X + tgt.x - ((tw - 1) >> 1);
    if (tailCol < col + 1) tailCol = col + 1;
    if (tailCol > col + w - 1 - tw) tailCol = col + w - 1 - tw;
    return {
      col: col, row: row, w: w, h: h,
      tailCol: tailCol, tailRow: tailRow, tailW: tw,
      dir: below ? 'up' : 'down',
      target: { col: D.MAP_X + tgt.x, row: D.MAP_Y + tgt.y, x: tgt.x, y: tgt.y },
      // The belt beat has two ends and the player needs both: the arrow the ore
      // leaves by, and the rig it has to arrive at. Highlighting only the
      // destination is how you get a beautiful line that starts nowhere.
      from: from ? { col: D.MAP_X + from.x, row: D.MAP_Y + from.y, x: from.x, y: from.y }
                 : null,
      // From beat 4 on the induction stops talking about the map and starts
      // pointing right: STOCK's iron-ore row is ticking up and CHAIN's limiting
      // stage is lit, two feet away, and teaching the player where to look for
      // the rest of the run is worth more than another sentence from GRIT.
      // The feed beat points right too (M-TUTORIAL2) — at the gear rows, since
      // GEAR filling is what it asks the player to watch.
      panels: beatId(run) === 'ore' || beatId(run) === 'outro' ||
              beatId(run) === 'feed',
      beat: beatId(run),
      // true only when no edge could clear BOTH ends of the belt beat, so the
      // starting arrow is under the box. Reported rather than hidden: the
      // suites assert `from` is visible unless this says it could not be.
      compromise: compromise,
    };
  }

  DC.Tutorial = {
    BEATS: BEATS, LESSONS: LESSONS,
    eligible: eligible, begin: begin, tick: tick, skip: skip,
    active: active, state: state, beat: beatId, release: release,
    line: line, action: action, warn: warn, foot: foot, title: title, mood: mood,
    stamps: stamps, sig: sig,
    target: target, layout: layout,
    // exposed for the suites: the gates and the map reads they run on
    pickVein: pickVein, firstExtractor: firstExtractor, firstOf: firstOf,
    outputFouled: outputFouled, reachesRig: reachesRig, outputTile: outTile,
  };
})();
