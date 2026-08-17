/* DEEPCORE — tutorial.js (SPEC3 M-ONBOARD Part 2)
   DC.Tutorial: the first-run induction. Four beats, each GATED ON THE PLAYER
   ACTUALLY DOING THE THING, on the real generated map — there is no scripted
   sandbox anywhere in this file, and nothing here places, rotates or belts
   anything on the player's behalf.

     1 place   an extractor on the marked iron vein
     2 rotate  R, and the arrow that says where the ore comes out
     3 belt    a line from that arrow to the rig
     4 ore     the first delivery lands, and the panels take over the teaching

   Part 1 already makes every failure state name its own cause in the LOG, so
   the induction never repeats a diagnostic; and CHAIN and STOCK are the
   player's co-teachers from beat 4 on, which is why that beat ends by POINTING
   at them rather than by restating them.

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

  const BEATS = ['place', 'rotate', 'belt', 'ore'];

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

  // The vein the induction teaches on. Stratum 1 guarantees iron near the rig;
  // this picks the CLOSEST revealed one by squared distance, ties broken by
  // scan order, so the choice is a pure function of the map and every player on
  // a seed is taught on the same tile. A map with no revealed iron at all (the
  // Mantle, a hostile roll, a test fixture) simply yields null and the
  // induction does not arm — it never invents a target.
  function pickVein(run) {
    const h = hubCentre(run);
    let best = null, bestD = Infinity;
    for (let y = 0; y < D.MAP_H; y++) {
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (!t || !t.revealed || t.ore !== 'ironOre' || t.oreAmt <= 0) continue;
        if (t.machine !== null || t.belt || t.lm || t.t !== 'floor') continue;
        const d = (x - h.x) * (x - h.x) + (y - h.y) * (y - h.y);
        if (d < bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  // The extractor the player put down. The FIRST one by machine id, so a player
  // who builds three keeps being taught about the one the box has been pointing
  // at since beat one.
  function firstExtractor(run) {
    if (!run || !run.machines) return null;
    const ids = Object.keys(run.machines).map(Number).sort(function (a, b) { return a - b; });
    for (let i = 0; i < ids.length; i++) {
      const m = run.machines[ids[i]];
      if (m && m.type === 'extractor') return m;
    }
    return null;
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
  function begin(run, meta) {
    if (!run || !eligible(meta)) return false;
    run.tutorial = {
      i: 0, salt: 0, nudges: 0,
      beatT: run.totalT, armT: run.totalT,
      vein: pickVein(run),
      rotated: false, facing0: null,
      hold: 0,          // run.totalT the finished box stops lingering
      over: false,      // the whole induction is behind us
      skipped: false,
      seen: {},         // beat id -> the totalT it was completed on
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
        return T.rotated && !outputFouled(run, m);
      }
      case 'belt': {
        const m = firstExtractor(run);
        if (!m) return false;
        const o = outTile(m);
        return reachesRig(run, o.x, o.y);
      }
      case 'ore':
        return ((run.stats && run.stats.delivered) | 0) > 0;
    }
    return false;
  }

  // ---------------- tick ----------------
  // Called from engine.js after every Sim.tick with the live ui, which is where
  // the R press lives (facing is a UI value, not a sim one — R aims the NEXT
  // placement, and teaching that honestly is the whole of beat two).
  function tick(run, ui) {
    const T = state(run);
    if (!T || T.over) return;

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

    // Beat 2 watches the facing the player is aiming with. `facing0` is armed
    // when the beat starts rather than at newRun, so pressing R twenty times
    // during beat one does not silently pre-pass beat two.
    if (BEATS[T.i] === 'rotate' && ui) {
      if (T.facing0 === null) T.facing0 = ui.facing | 0;
      else if ((ui.facing | 0) !== T.facing0) T.rotated = true;
    }

    if (passed(run, T, BEATS[T.i], ui)) {
      T.seen[BEATS[T.i]] = run.totalT;
      if (BEATS[T.i] === 'ore') release(run);   // the floor may tighten now
      T.i++;
      T.salt = 0; T.nudges = 0;
      T.beatT = run.totalT;
      T.facing0 = null;
      if (T.i >= BEATS.length) {
        T.line = pick(run, 'outro', 0);
        T.hold = run.totalT + CFG.holdT * HZ;
      }
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
      case 'outro':
        return [['t', 'STOCK AND CHAIN, ON YOUR RIGHT ▶']];
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
    if (id !== 'rotate') return null;
    const m = firstExtractor(run);
    if (!m || !outputFouled(run, m)) return null;
    return [['t', 'OUTPUT BURIED:'], ['t', ' '], ['cap', 'X'], ['t', ' SCRAP,'],
            ['t', ' '], ['cap', 'R'], ['t', ' RETRY']];
  }

  // The way out, on screen from the first frame and on every beat. A tutorial
  // whose escape hatch is undocumented is a tutorial that has trapped somebody.
  function foot(run) {
    const id = beatId(run);
    if (!id || id === 'outro' || id === 'skipped') return [];
    return [['cap', 'TAB'], ['t', ' SKIP THE INDUCTION']];
  }

  function title(run) {
    const T = state(run);
    if (!T) return '';
    if (T.skipped) return 'GRIT ▸ INDUCTION — BINNED';
    if (T.i >= BEATS.length) return 'GRIT ▸ INDUCTION — SIGNED OFF';
    return 'GRIT ▸ INDUCTION ' + (T.i + 1) + '/' + BEATS.length;
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
    return hubCentre(run);      // belt, ore and the sign-off all point at her
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
    const ex = beatId(run) === 'belt' ? firstExtractor(run) : null;
    const from = ex ? outTile(ex) : null;
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
      panels: beatId(run) === 'ore' || beatId(run) === 'outro',
      beat: beatId(run),
      // true only when no edge could clear BOTH ends of the belt beat, so the
      // starting arrow is under the box. Reported rather than hidden: the
      // suites assert `from` is visible unless this says it could not be.
      compromise: compromise,
    };
  }

  DC.Tutorial = {
    BEATS: BEATS,
    eligible: eligible, begin: begin, tick: tick, skip: skip,
    active: active, state: state, beat: beatId, release: release,
    line: line, action: action, warn: warn, foot: foot, title: title,
    target: target, layout: layout,
    // exposed for the suites: the gates and the two map reads they run on
    pickVein: pickVein, firstExtractor: firstExtractor,
    outputFouled: outputFouled, reachesRig: reachesRig, outputTile: outTile,
  };
})();
