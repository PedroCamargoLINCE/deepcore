/* DEEPCORE — engine.js
   Game shell: state construction, rAF loop with fixed-step accumulator,
   keyboard + mouse input (incl. belt-drag with corner turning and the
   keyboard cursor / lay-mode), screen transitions, meta awards, ui.flash
   and shake wiring. Engine may use Math.random (run seed only). */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;
  const U = DC.util;

  let params = { seed: null, fast: false };
  let tickHz = D.TICK_HZ;
  let lastTime = 0;
  let acc = 0;
  let awarded = false;       // meta award done for this run
  let awardedCores = 0;      // cores already banked (mantle-death delta support)
  let breachFlashed = false; // breach-ready banner shown for this stratum
  // M-WONDERS: a landmark trigger waiting for GRIT to have a mouth free.
  // Discovery is a ONE-SHOT sim event, and the global 6s bark cooldown would
  // routinely eat it: the opening build queues firstBelt and firstExtractor
  // straight across the window the sweep finds the wonder in, so a plain fire
  // would be dropped and the line lost for the whole stratum. Held and
  // retried until a line actually lands instead. { trigger, id }
  let lmPending = null;
  // M-MANTLE: the same problem, and the same answer. A mutator is announced on
  // arrival, which is exactly when stratumArrive is holding the bar — so the
  // id is held here and retried until GRIT actually says something about it.
  let mutPending = null;
  let helpFrom = 'title';    // screen to return to from help
  const TROPHY_COLS = 7;     // M-ACHIEVE: objects per shelf (render agrees)
  let recapFrom = 'gameover';// screen to return to from the recap card
  let gesture = {};          // "x,y" -> true: belts placed in the current drag/lay gesture
  let pauseAt = 0;           // rAF timestamp the current pause began (0 = running)
  let smoked = false;        // GRIT already took his smoke break on this pause
  let eggBuf = '';           // EGG-420: the last few digits typed, in order
  // M-ACHIEVE: what of this run has already been added to the lifetime
  // ledger. The Mantle path awards twice (victory, then the Mantle death),
  // so recordRun hands meta the DELTA since this snapshot rather than the run.
  let tallied = null;
  let eggKeyAt = 0;          // rAF-clock stamp of the last digit (buffer decay)

  // ---------------- startup ----------------

  function parseParams() {
    const out = { seed: null, fast: false };
    try {
      const q = (root.location && root.location.search) || '';
      const p = new URLSearchParams(q);
      if (p.has('seed')) {
        const n = parseInt(p.get('seed'), 10);
        if (!isNaN(n)) out.seed = n;
      }
      out.fast = p.get('fast') === '1';
    } catch (e) { /* file:// oddities */ }
    return out;
  }

  function start() {
    const canvas = document.getElementById('screen');
    DC.Render.init(canvas);
    params = parseParams();
    tickHz = params.fast ? D.TICK_HZ * 2 : D.TICK_HZ;
    DC.state = {
      screen: 'title',
      meta: DC.Meta.load(),
      today: DC.Meta.dailyKey(Date.now()),   // M-RECAP: the Daily Shaft's date
      run: null,
      ui: {
        tool: null, facing: 1,
        hover: null,
        cursor: { x: (D.MAP_W / 2) | 0, y: (D.MAP_H / 2) | 0 },
        dragging: false, dragLast: null, laying: false,
        paused: false, descendAnim: 0, shakeUntil: 0, flash: null,
        copied: null,          // M-RECAP: the recap card's clipboard notice
      },
    };
    // M-SOUND: the saved mute lands before the first gesture can start audio.
    if (DC.Audio) DC.Audio.setMuted(!!(DC.state.meta && DC.state.meta.muted));
    window.addEventListener('keydown', onKey);
    // M-HIRES Phase 1: the canvas fits the viewport, so it has to be told when
    // the viewport changes. Debounced — a drag-resize fires this continuously,
    // and each call re-measures the font and reallocates the backing store.
    window.addEventListener('resize', onResize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    requestAnimationFrame(loop);
  }

  // ---------------- resize ----------------

  let resizeTimer = 0;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = 0;
      DC.Render.resize();
    }, 100);
  }

  // ---------------- main loop ----------------

  function loop(now) {
    requestAnimationFrame(loop);
    const st = DC.state;
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.5) : 0;
    lastTime = now;
    if (st.screen === 'run' && !st.ui.paused && st.run &&
        (st.run.status === 'active' || st.run.status === 'breachReady')) {
      // M-SCHEMS2/Worm Whisperer: the cursor, published into run state before
      // the sim reads it. The SIM MUST NOT READ THE UI (it is DOM-free and
      // headless), so the beacon travels the other way — engine writes where
      // the player is pointing, js/worms.js reads a plain {x, y} on the run.
      // Without the card, or without the module, this is a no-op and the
      // worms have never heard of you.
      const bc = (st.run.mods && st.run.mods.wormBeacon) ? st.ui.cursor : null;
      if (DC.Worms && DC.Worms.beacon)
        DC.Worms.beacon(st.run, bc ? bc.x : null, bc ? bc.y : null);
      acc = Math.min(acc + dt, 0.5);
      const step = 1 / tickHz;
      while (acc >= step && st.screen === 'run') {
        acc -= step;
        DC.Sim.tick(st.run);
        afterTick(st);
      }
    } else {
      acc = 0;
    }
    smokeBreak(st, now);
    if (DC.Audio) DC.Audio.frame(st);           // M-SOUND: continuous voices read state
    // NOTE: ui.descendAnim is advanced by Render.frame (SPEC §7), not here —
    // incrementing in both places played the descent animation at double speed.
    // The rAF timestamp drives render's and fx.js's animation clocks: this
    // loop is not throttled, so without it every frame-measured animation
    // would run 2.4x too fast on a 144 Hz display (M-HIRES Phase 0).
    DC.Render.frame(st, now);
  }

  // M-GRITPLUS: the smoke break. The sim is frozen while paused, so this is
  // measured on the rAF wall clock — 30 seconds of pause and GRIT lights one
  // (fx.js is already curling smoke into the corner by then); resuming gets
  // him back on shift. Barks.pause is used rather than bark() because a frozen
  // run.totalT would leave the typewriter stuck at zero characters.
  function smokeBreak(st, now) {
    const paused = st.screen === 'run' && st.ui && st.ui.paused && st.run;
    if (!paused) {
      if (pauseAt && smoked && st.run) pauseSay(st, 'breakOver');
      pauseAt = 0; smoked = false;
      return;
    }
    if (!pauseAt) { pauseAt = now; return; }
    if (!smoked && now - pauseAt > 30000) { smoked = true; pauseSay(st, 'smokeBreak'); }
  }
  function pauseSay(st, kind) {
    const B = DC.Barks;
    if (!B || !B.pause || !st.run) return;
    try { B.pause(st.run, kind); } catch (e) { /* barks stay optional */ }
  }

  function afterTick(st) {
    const run = st.run, ui = st.ui;
    if (run.shake) {
      run.shake = false;
      ui.shakeUntil = run.t + 4;
      const collapse = run.instability >= 99;
      if (!ui.flash || ui.flash.until <= run.t) {
        ui.flash = {
          text: collapse ? '!! COLLAPSE !!' : '!! QUAKE !!',
          color: D.COLORS.red, until: run.t + 2 * D.TICK_HZ,
        };
      }
      bark(collapse ? 'collapse' : 'quake');
      if (DC.Audio) DC.Audio.play(collapse ? 'collapse' : 'quake', { big: collapse });
    }
    drainEvents(run);
    if (DC.Audio) DC.Audio.tick(run);           // M-SOUND: presses, worms, the Core
    // M-ONBOARD Part 2: the induction's step machine. After the sim tick and
    // after the events, so a beat that is gated on something the tick just did
    // (the first ore reaching the rig) passes on the same frame the player sees
    // it land. It is handed the live ui because R aims the NEXT placement —
    // facing is a UI value, and beat two teaches it honestly.
    tutorTick(st, run);
    // The wonder waits its turn, and yields to the one moment that outranks
    // it: once the rig is breach-ready the bar belongs to that: a tourist
    // observation about a rock must not step on "press D".
    // M-MANTLE: the floor's rule gets said before any tourism about a rock —
    // one of these can end the run and the other is scenery.
    if (mutPending && bark('mutator', mutPending)) mutPending = null;
    if (lmPending && run.status !== 'breachReady' &&
        bark(lmPending.trigger, lmPending.id)) lmPending = null;
    const B = DC.Barks;
    if (B && B.tick) { try { B.tick(run); } catch (e) {} }
    if (ui.flash && ui.flash.until <= run.t) ui.flash = null;
    if (run.status === 'breachReady' && !breachFlashed) {
      breachFlashed = true;
      ui.flash = {
        text: '»» BREACH READY — press D to descend ««',
        color: D.COLORS.green, until: run.t + 4 * D.TICK_HZ,
      };
      bark('breachReady');
    }
    if (run.status === 'dead') {
      awardRun(st);
      bark('death');
      st.screen = 'gameover';
    } else if (run.status === 'won') {
      handleWon(st);
    }
  }

  // Optional v1.1 sim event queue — drained if present, ignored otherwise.
  function drainEvents(run) {
    if (!Array.isArray(run.events) || !run.events.length) return;
    const evs = run.events.splice(0, run.events.length);
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (!ev) continue;
      if (ev.type === 'quake') {
        if (run.tally) run.tally.quakes++;
        if (ev.data && ev.data.dmg >= 8) bark('bigQuake', ev.data);
      }
      else if (ev.type === 'magma') bark('magmaSpread');
      else if (ev.type === 'depleted') bark('veinDepleted');
      // M-SCHEMS2/Deep Insurance: the rig just refused to die. GRIT's heart
      // attack is a PRIORITY trigger — nothing on the bar outranks this.
      else if (ev.type === 'insurance') bark('insurance');
      // M-CORELORE: the Core Gate. sim.js says WHEN (breach fractions at s8);
      // barks.js says what, and answers itself in GRIT's voice a beat later.
      else if (ev.type === 'core') coreBeat(run, ev.data);
      // M-WONDERS: the stratum's landmark, found by the sweep or used by the
      // player. The Bell is the one that reaches past GRIT: ringing it is
      // heard, and something far below answers early (SPEC3 M-CORELORE hook).
      // M-EVENTS: the rock handed something over. The find names its own bark
      // pool, so a pool js/barks.js has not grown yet is simply a quiet find.
      else if (ev.type === 'find' && ev.data) bark(ev.data.bark, ev.data.id);
      // ...and a dead foreman's last log goes in the book, for good.
      else if (ev.type === 'foremanLog' && ev.data) recordLog(run, ev.data.index);
      // ...and the cat. 'flee' is the one that matters: it is the seismograph
      // saying out loud what the map is already showing.
      else if (ev.type === 'cat' && ev.data)
        bark(ev.data.act === 'flee' ? 'catFlee' : 'cat');
      // M-WORMS: the wildlife. 'eat' is the one that matters — a vein going
      // down without an extractor on it is news the player cannot see.
      else if (ev.type === 'worm' && ev.data) {
        bark(ev.data.act === 'eat' ? 'worm'
           : ev.data.act === 'lure' ? 'lureTaken' : 'lure');
        // M-ACHIEVE: WORMFOOD is "a lure a worm actually ate" — the 'lure'
        // act is pushed by js/worms.js only when the coal is taken, so this
        // is the one event that names it.
        if (ev.data.act === 'lure') {
          if (run.tally) run.tally.lures++;
          trophy(run, 'wormfood');
        }
      }
      // ...and the Undertoad, which is a PRIORITY line and a flash: the
      // player caused this on the tick they caused it, and nothing on the bar
      // outranks being told so.
      else if (ev.type === 'toad' && ev.data) {
        bark('undertoad');
        trophy(run, 'hard_hats');
        if (DC.state && DC.state.ui) {
          DC.state.ui.flash = {
            text: '!! YOU WOKE IT — HARD HATS !!',
            color: D.COLORS.toad, until: run.t + 4 * D.TICK_HZ,
          };
        }
      }
      // M-ONBOARD: a failure state just named itself in the LOG, in the
      // system's plain voice. GRIT gets the last word and never the useful
      // one. Not routed through bark(): Barks.diag picks by seed hash rather
      // than from run.rng, because these fire only when the player has made a
      // mistake and law 7 forbids that moving the stream.
      else if (ev.type === 'diagnostic' && ev.data) diagBark(run, ev.data.cause);
      // M-MANTLE: the floor arrived with a rule. The banner carries it for the
      // whole stratum; this is the moment it lands — a flash over the map and
      // GRIT's opinion of it, retried on later ticks if the arrival line is
      // still holding the bar (same shape as the landmark's pending bark).
      else if (ev.type === 'mutator' && ev.data && ev.data.id) {
        mutPending = ev.data.id;
        const def = (D.MUTATOR_BY_ID || {})[ev.data.id];
        if (def && DC.state && DC.state.ui) {
          DC.state.ui.flash = {
            text: '† ' + def.name + ' †',
            color: D.COLORS.red, until: run.t + 4 * D.TICK_HZ,
          };
        }
      }
      else if (ev.type === 'landmark' && ev.data) {
        lmPending = { trigger: ev.data.act === 'find' ? 'landmarkFound' : 'landmarkUse',
                      id: ev.data.id };
        if (ev.data.act !== 'find' && ev.data.id === 'bell') {
          coreBeat(run, { kind: 'intrusion' });
          if (DC.Audio) DC.Audio.play('bell');
        }
      }
    }
  }

  // M-EVENTS: a found log entry is filed the instant it is read, not at the
  // end of the run — a rig that dies on the next quake still keeps what its
  // foreman learned, which is the only reason the logbook fills up at all.
  function recordLog(run, index) {
    const st = DC.state, M = DC.Meta;
    if (!st || !M || typeof M.recordLog !== 'function') return;
    try { M.recordLog(st.meta, index); } catch (e) { /* meta stays optional */ }
  }

  // M-ONBOARD Part 2 wiring — a hard no-op unless js/tutorial.js is loaded.
  //
  // The meta write happens the moment the induction ENDS, not at the end of the
  // run: a first rig that dies on stratum 1 must not be taught to place an
  // extractor a second time. `tutorSeen` keeps that write to one call even
  // though this runs eight times a second.
  let tutorSeen = false;
  function tutorTick(st, run) {
    const T = DC.Tutorial;
    if (!T || !run || !run.tutorial) return;
    try { T.tick(run, st.ui); } catch (e) { /* the tutorial never kills a run */ }
    if (!tutorSeen && !T.active(run)) {
      tutorSeen = true;
      try { DC.Meta.seeTutorial(st.meta); } catch (e) { /* meta stays optional */ }
    }
  }

  // The skip key, handled before every other run-screen binding so it works on
  // the very first frame — including before the first sim tick, which is what
  // "skippable from the first keypress" has to mean.
  function tutorSkip(st) {
    const T = DC.Tutorial;
    if (!T || !st.run || !T.active(st.run)) return false;
    let did = false;
    try { did = T.skip(st.run); } catch (e) { return false; }
    return did;
  }

  // M-ONBOARD wiring — no-op unless js/barks.js exposes the editorial pool.
  function diagBark(run, cause) {
    const B = DC.Barks;
    if (!B || !B.diag || !run || !cause) return;
    try { B.diag(run, cause); } catch (e) { /* barks stay optional */ }
  }

  // Optional Core wiring — no-op unless js/barks.js exposes the second voice.
  function coreBeat(run, data) {
    const B = DC.Barks;
    if (!B || !B.core || !run) return;
    const kind = (data && data.kind) || 'gate';
    try { B.core(run, kind, (data && data.beat) | 0); } catch (e) {}
  }

  // Optional Foreman wiring — no-op unless js/barks.js is loaded.
  function bark(trigger, ctx) {
    const B = DC.Barks;
    const st = DC.state;
    if (!trigger || !B || !B.fire || !st || !st.run) return null;
    // Returns the line that landed, or null if the cooldown swallowed it —
    // which is how the M-WONDERS retry above knows to try again.
    let line = null;
    try { line = B.fire(st.run, trigger, ctx); } catch (e) { return null; }
    if (line && DC.Audio) DC.Audio.play('squelch');   // M-SOUND: the radio opens
    return line;
  }

  // M-POLISH backlog: GRIT's 9 bespoke foundryBuy lines were unreachable —
  // bark() needs st.run and there is no run on the Foundry screen. Barks.fire
  // only touches run.rng / run.totalT / run.foreman / run.messages, so a
  // minimal run-shaped context is enough. totalT jumps between purchases so
  // the global bark cooldown never swallows a line; render draws the returned
  // line under the rig portrait (state.foundryBark).
  function foundryCtx() {
    return {
      rng: U.mulberry32(0xC0FFEE), totalT: 0, t: 0, depth: 1,
      status: 'active', messages: null, foreman: null,
      integrity: 1, maxIntegrity: 1, machines: null, stats: null,
      inv: {}, schematics: [],
    };
  }
  function foundryBark(st, id) {
    const B = DC.Barks;
    if (!B || !B.fire) return;
    if (!st.foundryBark) st.foundryBark = { ctx: foundryCtx(), line: null };
    const fx = st.foundryBark.ctx;
    fx.totalT += 60 * D.TICK_HZ;          // always clear of any bark cooldown
    let line = null;
    try { line = B.fire(fx, 'foundryBuy', id); } catch (e) { /* barks in flux */ }
    if (!line && fx.foreman && fx.foreman.text) line = fx.foreman.text;
    if (line) st.foundryBark.line = String(line);
  }

  // ---------------- run lifecycle ----------------

  // opts.daily (M-RECAP): the Daily Shaft — the seed is a hash of today's UTC
  // date, and the rig runs NAKED (Foundry effects deliberately not applied, so
  // the day's ladder measures play and not banked cores). The first attempt of
  // a date is the ranked one; every later attempt that day is practice and is
  // never recorded.
  // opts.contract (M-CONTRACTS): the D.CONTRACTS id signed on the contract
  // screen. The Daily, the induction and the [I] replay never reach that
  // screen and sign STANDARD here, silently.
  function newRun(st, opts) {
    opts = opts || {};
    let seed, effects, daily = null;
    if (opts.daily) {
      const date = DC.Meta.dailyKey(Date.now());
      seed = DC.Meta.dailySeed(date);
      effects = DC.Meta.effects(DC.Meta.newProfile());
      daily = { date: date, practice: !!DC.Meta.dailyEntry(st.meta, date) };
    } else {
      seed = params.seed !== null ? params.seed : (Math.random() * 2 ** 31) | 0;
      effects = DC.Meta.effects(st.meta);
    }
    let contract = D.CONTRACT_DEFAULT || 'standard';
    if (!daily && !opts.tutor && typeof opts.contract === 'string' &&
        DC.Meta.contractUnlocked && DC.Meta.contractUnlocked(st.meta, opts.contract)) {
      contract = opts.contract;
    }
    st.run = DC.Sim.newRun(effects, seed, contract);
    // Engine-owned recap bookkeeping. The sim knows nothing about any of it:
    // splits are stamped at descend time, startedAt is wall-clock (engine may
    // read a clock; sim may not).
    st.run.daily = daily;
    st.run.splits = [];
    st.run.startedAt = Date.now();
    // M-ACHIEVE: engine-owned counters for the shelf and the Ledger. The sim
    // knows nothing about them; they count the PLAYER'S acts (a repair the
    // Repair Swarm does is not a repair invoiced to the operator) plus the
    // quakes drained off run.events. Everything the Ledger prints that is not
    // already on the run comes from here.
    st.run.tally = { repairs: 0, overdrives: 0, quakes: 0, lures: 0 };
    tallied = null;
    st.newTrophies = [];
    // M-EVENTS: once she has been found, the cat comes on every run. Quietly
    // — she is only news the first time — and only ever as decoration plus
    // the quake tell, so a profile with a cat in it is not a profile with an
    // advantage in it.
    if (DC.Events && DC.Events.grantCat && DC.Meta.catFound &&
        DC.Meta.catFound(st.meta)) {
      try { DC.Events.grantCat(st.run, true); } catch (e) { /* optional */ }
    }
    awarded = false; awardedCores = 0; breachFlashed = false; lmPending = null; mutPending = null;
    // M-ONBOARD Part 2: the first-run induction, on the real generated map.
    // Never on the Daily — that run is ranked against everybody else's, and a
    // tutorial that freezes instability while it plays would be a handicap
    // handed to exactly the people who do not need one.
    // opts.tutor is the title screen's [I] REPLAY INDUCTION: it forces the
    // induction on a profile that has already seen it. Still never on the
    // Daily, for the same reason — the pressure pause would be an advantage.
    tutorSeen = false;
    if (DC.Tutorial && !daily) {
      try { DC.Tutorial.begin(st.run, st.meta, !!opts.tutor); } catch (e) { /* optional */ }
    }
    const ui = st.ui;
    ui.tool = null; ui.facing = 1; ui.hover = null;
    ui.dragging = false; ui.dragLast = null; ui.laying = false;
    ui.paused = false; ui.descendAnim = 0; ui.shakeUntil = 0; ui.flash = null;
    ui.copied = null;
    gesture = {};
    centerCursor(st);
    arriveFlash(st);
    acc = 0;
    st.screen = 'run';
    // M-CONTRACTS: GRIT reads a signed rider aloud instead of the shift-start
    // line; STANDARD gets the ordinary greeting, as it always did.
    if (contract !== (D.CONTRACT_DEFAULT || 'standard')) bark('contract', contract);
    else bark(daily ? (daily.practice ? 'dailyPractice' : 'dailyStart') : 'runStart');
  }

  // ---------------- M-CONTRACTS: the paper ----------------
  // [ENTER] on the title opens the desk — unless the induction is about to
  // arm (a profile with zero runs), in which case STANDARD is signed
  // silently and the tutorial begins: nobody is asked to read a rider before
  // they have placed an extractor.
  function openContracts(st) {
    if (DC.Tutorial && DC.Tutorial.eligible(st.meta)) { newRun(st); return; }
    const list = D.CONTRACTS || [];
    if (!list.length || !DC.Meta.contractLast) { newRun(st); return; }
    const last = DC.Meta.contractLast(st.meta);
    let i = 0;
    for (let k = 0; k < list.length; k++) if (list[k].id === last) i = k;
    st.ui.contractCursor = i;
    st.ui.contractDenied = null;
    st.screen = 'contract';
  }
  function signContract(st, i) {
    const def = (D.CONTRACTS || [])[i];
    if (!def) return false;
    if (!DC.Meta.contractUnlocked(st.meta, def.id)) {
      st.ui.contractDenied = { id: def.id, until: Date.now() + 1200 };
      return false;
    }
    try { DC.Meta.setContractLast(st.meta, def.id); } catch (e) { /* optional */ }
    newRun(st, { contract: def.id });
    return true;
  }

  // M-RECAP: one cleared stratum = one split. Stamped the moment the descent
  // is accepted, because startStratum resets run.t on the way into the next
  // floor. gearsFed/chargesFed reset with it, so the totals ride along.
  function recordSplit(run) {
    if (!run) return;
    if (!Array.isArray(run.splits)) run.splits = [];
    run.splits.push({
      depth: run.depth,
      sec: run.t / D.TICK_HZ,
      gears: run.gearsFed || 0,
      charges: run.chargesFed || 0,
    });
  }

  // Everything the finished run leaves behind in the save: ghost splits for
  // every stratum it cleared, and the Daily result when the run was today's
  // ranked attempt. Idempotent — the Mantle path awards twice.
  function recordRunMeta(st) {
    const run = st.run;
    if (!run) return;
    DC.Meta.recordSplits(st.meta, run.splits);
    const d = run.daily;
    if (d && !d.practice && run.result) {
      DC.Meta.recordDaily(st.meta, {
        date: d.date, depth: run.result.depth, timeSec: run.result.timeSec,
        won: !!run.result.won, cores: run.result.cores || 0,
      });
    }
  }

  function awardRun(st) {
    const res = st.run && st.run.result;
    if (!res) return;
    recordRunMeta(st);
    if (!awarded) {
      DC.Meta.award(st.meta, res);
      awarded = true;
      awardedCores = res.cores || 0;
      recordRun(st);
    } else {
      // Already banked at victory; a Mantle death only credits the new breaches
      // — at the same wage (M-CONTRACTS), so the paid delta is the difference
      // of the two PAID figures, never a raw core count.
      const paid = DC.Meta.paidFor ? DC.Meta.paidFor(res.cores || 0, res.contract) : (res.cores || 0);
      const was = DC.Meta.paidFor ? DC.Meta.paidFor(awardedCores, res.contract) : awardedCores;
      const delta = paid - was;
      res.paid = paid;
      if (delta > 0) {
        st.meta.cores += delta;
        st.meta.totalCores += delta;
        awardedCores = res.cores;
      }
      if (res.depth > st.meta.bestDepth) st.meta.bestDepth = res.depth;
      DC.Meta.save(st.meta);
      recordRun(st);
    }
  }

  // ---------------- recap card (M-RECAP) ----------------

  // The card is its own screen rather than a flag on gameover/victory: the FX
  // layer scopes its particles and colour passes by screen id, so a distinct
  // id is what keeps the gameover dust and the victory core-pulse off the
  // card without either module knowing about the other.
  function toggleRecap(st) {
    if (st.screen === 'recap') st.screen = recapFrom || 'gameover';
    else { recapFrom = st.screen; st.screen = 'recap'; }
    st.ui.copied = null;
  }

  function leaveEndScreen(st) {
    st.ui.copied = null;
    st.run = null;
    st.screen = 'title';
  }

  // C on the card: copy the plain-text card. navigator.clipboard is absent on
  // file:// (insecure context) and can reject when the document is not
  // focused, so every failure path lands on a readable on-card notice — the
  // card is legible ASCII on screen either way.
  function copyRecap(st) {
    let txt = '';
    try {
      if (DC.Render && typeof DC.Render.recapText === 'function') txt = DC.Render.recapText(st) || '';
    } catch (e) { /* render in flux */ }
    if (!txt) { st.ui.copied = 'NOTHING TO COPY'; return; }
    const nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        const p = nav.clipboard.writeText(txt);
        st.ui.copied = 'COPIED — PASTE IT SOMEWHERE LOUD';
        if (p && typeof p.catch === 'function') {
          p.catch(function () { st.ui.copied = 'CLIPBOARD REFUSED — SELECT IT BY HAND'; });
        }
        return;
      } catch (e) { /* fall through to the offline notice */ }
    }
    st.ui.copied = 'NO CLIPBOARD HERE — SELECT IT BY HAND';
  }

  // M-ACHIEVE: a trophy earned MID-RUN (the cat, the worm, the toad, twelve
  // down). Filed the instant it happens, like a foreman's log — a rig that
  // dies on the next tick keeps it — and said in the LOG in the Core's gold,
  // because the flash bar is usually busy with the thing that earned it.
  function trophy(run, id) {
    const st = DC.state, M = DC.Meta;
    if (!st || !M || typeof M.awardTrophy !== 'function') return false;
    let fresh = false;
    try { fresh = M.awardTrophy(st.meta, id); } catch (e) { return false; }
    if (!fresh) return false;
    const def = (D.TROPHY_BY_ID || {})[id];
    if (run && def && DC.Sim.msg) {
      DC.Sim.msg(run, '◈ TROPHY — ' + def.name + '. It goes on the shelf.', D.COLORS.gold);
    }
    if (Array.isArray(st.newTrophies)) st.newTrophies.push(id);
    return true;
  }

  // The lifetime ledger and the end-of-run trophies. Idempotent by DELTA:
  // `tallied` remembers what this run has already contributed, so the Mantle
  // path (victory, then death) adds only the strata, time and items that are
  // new. One-shot facts (the shift itself, the letter home) go in once.
  function runFacts(run) {
    const t = run.tally || {};
    const placed = (run.stats && run.stats.placed) || {};
    let built = 0;
    for (const k in placed) built += placed[k] || 0;
    return {
      timeSec: run.result ? run.result.timeSec : Math.round(run.totalT / D.TICK_HZ),
      breaches: run.breaches || 0,
      delivered: (run.stats && run.stats.delivered) || 0,
      placed: built,
      repairs: t.repairs || 0, overdrives: t.overdrives || 0,
      quakes: t.quakes || 0, lures: t.lures || 0,
      // M-CONTRACTS: what the wage added over the run's own count. A fact
      // like the others, so the Mantle path credits only the new part.
      wagePaid: run.result ? Math.max(0, (run.result.paid || 0) - (run.result.cores || 0)) : 0,
    };
  }
  function recordRun(st) {
    const run = st.run, M = DC.Meta;
    if (!run || !run.result || !M || typeof M.recordRun !== 'function') return;
    const now = runFacts(run);
    const was = tallied || {};
    const delta = {};
    for (const k in now) delta[k] = now[k] - (was[k] || 0);
    if (!tallied) {
      const dead = run.status === 'dead';
      const abandoned = dead && run.integrity > 0;
      delta.deaths = dead && !abandoned ? 1 : 0;
      delta.abandons = abandoned ? 1 : 0;
      // M-CONTRACTS: one paper per shift, and what the wage added over the
      // run's own count (Meta.award stamped `paid` a moment ago).
      delta.signed = 1;
    } else if (run.status === 'dead') {
      // a Mantle death after a banked victory is still a letter home
      delta.deaths = run.integrity > 0 ? 0 : 1;
      delta.abandons = run.integrity > 0 ? 1 : 0;
    }
    tallied = now;
    try { M.recordRun(st.meta, delta); } catch (e) { /* meta stays optional */ }
    let fresh = [];
    try {
      fresh = M.checkTrophies(st.meta, {
        won: !!run.result.won, timeSec: run.result.timeSec, depth: run.result.depth,
        repairs: now.repairs, overdrives: now.overdrives,
        daily: !!(run.daily && !run.daily.practice),
        egg: !!run.eggSeen,
        contract: run.contract || 'standard',
      }) || [];
    } catch (e) { fresh = []; }
    if (!Array.isArray(st.newTrophies)) st.newTrophies = [];
    for (let i = 0; i < fresh.length; i++) st.newTrophies.push(fresh[i]);
  }

  function handleWon(st) {
    awardRun(st);
    bark('victory');
    st.screen = 'victory';
  }

  function tryDescend(st) {
    const run = st.run;
    if (!run || run.status !== 'breachReady') return;
    if (!DC.Sim.beginDescent(run)) return;
    recordSplit(run);
    bark('descend');
    if (DC.Audio) DC.Audio.play('breach', { dur: animLen() / 60 });   // synced to the descent
    if (run.status === 'won') { handleWon(st); return; }
    if (run.pendingOffers) {
      st.ui.tool = null;
      st.ui.laying = false;
      endGesture(st);
      st.ui.descendAnim = 0;
      st.screen = 'descend';
    }
  }

  // Must mirror render.js drawDescend: frames.length * 10 + 45 hold, with a
  // 1-frame placeholder when Art.descent is missing/malformed.
  function animLen() {
    const fr = DC.Art && DC.Art.descent;
    const n = (Array.isArray(fr) && fr.length && Array.isArray(fr[0])) ? fr.length : 1;
    return n * 10 + 45;
  }

  function applyChoice(st, i) {
    const run = st.run;
    const offers = run && run.pendingOffers;
    if (!offers || i < 0 || i >= offers.length) return;
    if (st.ui.descendAnim < animLen()) return; // wait out the descent animation
    const id = offers[i];
    // M-ACHIEVE: the hand was SEEN — every card on it, taken or not. FULL SET
    // is "all schematics seen dealt", which is this moment and no other.
    if (DC.Meta.seeSchematics) {
      try {
        DC.Meta.seeSchematics(st.meta, offers);
        if (DC.Meta.allSchemsSeen(st.meta)) trophy(run, 'schems_all');
      } catch (e) { /* meta stays optional */ }
    }
    DC.Sim.applySchematic(run, id);
    bark('schematicPick', id);
    if (run.depth >= D.TROPHY_DEPTH) trophy(run, 'depth12');
    breachFlashed = false;
    lmPending = null;   // the last floor's wonder is behind us (M-WONDERS)
    mutPending = null;  // ...and its rule (M-MANTLE); the new one re-announces
    arriveFlash(st);
    st.ui.shakeUntil = 0;
    st.ui.hover = null;
    centerCursor(st);
    acc = 0;
    // M-EVENTS: sim.js rolled the expedition vignette on the way down. If the
    // dark asked something, it gets the screen before the floor does.
    st.ui.hoverChoice = -1;
    st.screen = vignetteWaiting(st) ? 'vignette' : 'run';
  }

  // M-EVENTS ------------------------------------------------------------
  function vignetteWaiting(st) {
    const E = DC.Events;
    if (!E || typeof E.pending !== 'function' || !st.run) return false;
    try { return !!E.pending(st.run); } catch (e) { return false; }
  }
  // Answering it. Everything mechanical happens inside events.js; the engine
  // owns exactly the two things that module cannot reach — GRIT's editorial,
  // and the meta save (a cat, once found, is yours in every run after this).
  function answerVignette(st, i) {
    const E = DC.Events, run = st.run;
    if (!run) return;
    const ev = vignetteWaiting(st) ? E.pending(run) : null;
    if (!ev || !ev.choices || i < 0 || i >= ev.choices.length) return;
    let chosen = null;
    try { chosen = E.apply(run, ev, i); } catch (e) { /* never trap the player */ }
    if (chosen) {
      bark('vignette', ev.id + ':' + i);
      if (chosen.fx && chosen.fx.cat && DC.Meta && DC.Meta.findCat) {
        try { DC.Meta.findCat(st.meta); } catch (e) { /* meta stays optional */ }
        trophy(run, 'cat');
      }
    }
    st.ui.hoverChoice = -1;
    acc = 0;
    st.screen = 'run';
  }

  function centerCursor(st) {
    const run = st.run;
    if (run && run.hub) st.ui.cursor = { x: run.hub.x + 1, y: run.hub.y + 1 };
  }

  // v1.1 §E: stratum-arrival banner in the stratum's accent color.
  function arriveFlash(st) {
    const run = st.run;
    if (!run) return;
    const s = run.depth <= D.STRATA_COUNT ? D.STRATA[run.depth - 1]
                                          : D.mantleStratum(run.depth);
    st.ui.flash = {
      text: '»» STRATUM ' + run.depth + ' — ' + s.name + ' ««',
      color: s.accent || D.COLORS.amber,
      until: run.t + 3 * D.TICK_HZ,
    };
  }

  // ---------------- keyboard ----------------

  // The field manual (M-MANUAL). It always opens on page 1: a player hitting H
  // mid-run wants the controls, not wherever they left the pager last time.
  function helpPageCount() {
    const p = DC.Art && DC.Art.helpPages;
    return (p && p.length) || 1;
  }
  function openHelp(st, from) {
    helpFrom = from;
    st.ui.helpPage = 0;
    st.screen = 'help';
  }
  function turnPage(st, d) {
    const n = helpPageCount();
    st.ui.helpPage = (((st.ui.helpPage | 0) + d) % n + n) % n;
  }

  function onKey(e) {
    const st = DC.state;
    if (!st) return;
    // M-RECAP: render draws the Daily line from state.today rather than
    // keeping a clock of its own; refresh it whenever the title is in play so
    // a session left open across UTC midnight still shows the right day.
    if (st.screen === 'title') st.today = DC.Meta.dailyKey(Date.now());
    const k = e.key;
    const lk = k.length === 1 ? k.toLowerCase() : k;
    let handled = true;
    // M-SOUND: any key is the gesture browsers want before audio may start;
    // M itself is the mute, on every screen, and it lives in the meta save.
    if (DC.Audio) DC.Audio.init();
    if (lk === 'm' && DC.Audio) {
      st.meta.muted = DC.Audio.toggle();
      try { DC.Meta.save(st.meta); } catch (err) { /* storage stays optional */ }
      e.preventDefault();
      return;
    }
    switch (st.screen) {
      case 'title':
        if (k === 'Enter') openContracts(st);
        else if (lk === 't') newRun(st, { daily: true });
        else if (lk === 'f') {
          st.screen = 'foundry';
          if (st.foundryBark) st.foundryBark.line = null;   // fresh floor, no stale line
        }
        else if (lk === 'h') openHelp(st, 'title');
        // [I] REPLAY INDUCTION, offered whenever the induction will NOT arrive
        // on its own — the complement of Tutorial.eligible. Not `tutorialSeen`:
        // that leaves every pre-brief save in a locked room (see render.js).
        // A player who IS eligible needs no door; their next run opens it.
        else if (lk === 'i' && DC.Tutorial && !DC.Tutorial.eligible(st.meta)) {
          newRun(st, { tutor: true });
        }
        else handled = false;
        break;
      case 'run':
        handled = runKey(st, e, k, lk);
        break;
      // M-CONTRACTS: the paper. ←/→ or 1-3 to read, ENTER to sign, ESC back.
      case 'contract': {
        const list = D.CONTRACTS || [];
        const n = (k >= '1' && k <= '9') ? k.charCodeAt(0) - 49 : -1;
        if (k === 'Escape') st.screen = 'title';
        else if (k === 'ArrowLeft' || k === 'ArrowUp') st.ui.contractCursor = Math.max(0, (st.ui.contractCursor | 0) - 1);
        else if (k === 'ArrowRight' || k === 'ArrowDown') st.ui.contractCursor = Math.min(list.length - 1, (st.ui.contractCursor | 0) + 1);
        else if (n >= 0 && n < list.length) { st.ui.contractCursor = n; signContract(st, n); }
        else if (k === 'Enter') signContract(st, st.ui.contractCursor | 0);
        else handled = false;
        break;
      }
      case 'descend': {
        const offers = st.run && st.run.pendingOffers;
        const n = (k >= '1' && k <= '9') ? k.charCodeAt(0) - 49 : -1;
        if (offers && n >= 0 && n < offers.length) applyChoice(st, n);
        else handled = false;
        break;
      }
      case 'foundry':
        if (k === 'Escape' || k === 'Enter') st.screen = 'title';
        // M-EVENTS: the logbook. It hangs off the Foundry because that is the
        // one screen between runs where you are already reading your record.
        else if (lk === 'l') st.screen = 'logbook';
        // M-ACHIEVE: the shelf and the Ledger hang off the same floor.
        else if (lk === 't') { st.screen = 'trophies'; st.ui.trophyCursor = 0; }
        else if (lk === 'k') st.screen = 'ledger';
        // M-RIGSKINS: [S] cycles through the liveries this profile has earned.
        else if (lk === 's') {
          if (DC.Meta.cycleLivery) DC.Meta.cycleLivery(st.meta);
          // GRIT has one opinion about liveries, and it is about the gold one.
          const lv = (D.LIVERY_BY_ID || {})[DC.Meta.livery ? DC.Meta.livery(st.meta) : ''];
          if (lv && lv.grit) {
            if (!st.foundryBark) st.foundryBark = { ctx: foundryCtx(), line: null };
            st.foundryBark.line = lv.grit;
          }
        }
        else {
          const i = 'abcdefghi'.indexOf(lk);
          if (i >= 0 && i < D.META_UPGRADES.length) {
            const id = D.META_UPGRADES[i].id;
            if (DC.Meta.buy(st.meta, id)) {
              // v1.1 §C.2: render blinks this part's overlay white ~1.2s.
              // (render keys expiry on object identity; until is advisory,
              // in the rAF-timestamp clock.)
              st.ui.flashPart = { id: id, until: lastTime + 1200 };
              bark('foundryBuy', id);      // live-run path (unused today)
              foundryBark(st, id);         // runless foreman line on this screen
            }
          } else handled = false;
        }
        break;
      // M-EVENTS: the vignette. Two keys, and no way past it that is not an
      // answer — ESC does not dismiss a fork, and the run is not ticking
      // behind it, so there is nothing to be impatient about.
      case 'vignette': {
        const ev = vignetteWaiting(st) ? DC.Events.pending(st.run) : null;
        const n = (k >= '1' && k <= '9') ? k.charCodeAt(0) - 49 : -1;
        if (ev && n >= 0 && n < ev.choices.length) answerVignette(st, n);
        else if (!ev && (k === 'Enter' || k === 'Escape')) st.screen = 'run';
        else handled = false;
        break;
      }
      // M-EVENTS: the logbook is a reading screen and nothing else — every
      // way out of it goes back to the floor you opened it from.
      case 'logbook':
        if (k === 'Escape' || k === 'Enter' || lk === 'l') st.screen = 'foundry';
        else handled = false;
        break;
      // M-ACHIEVE: the shelf is a reading screen with a cursor — ←/→ walk the
      // objects so GRIT can inspect each one; every way out is the Foundry.
      case 'trophies': {
        const n = (D.TROPHIES || []).length;
        const cur = st.ui.trophyCursor | 0;
        if (k === 'Escape' || k === 'Enter' || lk === 't') st.screen = 'foundry';
        else if (k === 'ArrowRight' && n) st.ui.trophyCursor = (cur + 1) % n;
        else if (k === 'ArrowLeft' && n) st.ui.trophyCursor = (cur + n - 1) % n;
        else if (k === 'ArrowDown' && n) st.ui.trophyCursor = Math.min(n - 1, cur + TROPHY_COLS);
        else if (k === 'ArrowUp' && n) st.ui.trophyCursor = Math.max(0, cur - TROPHY_COLS);
        else handled = false;
        break;
      }
      case 'ledger':
        if (k === 'Escape' || k === 'Enter' || lk === 'k') st.screen = 'foundry';
        else handled = false;
        break;
      case 'help':
        // M-MANUAL: the manual is a two-page pager. ←/→ (and the page numbers)
        // turn it, wrapping; ESC/ENTER put it down. The footer on every page
        // states exactly these keys, composed from the page list itself.
        if (k === 'Escape' || k === 'Enter') st.screen = helpFrom || 'title';
        else if (k === 'ArrowRight' || k === 'ArrowDown') turnPage(st, 1);
        else if (k === 'ArrowLeft' || k === 'ArrowUp') turnPage(st, -1);
        else if (k >= '1' && k <= '9') {
          const n = k.charCodeAt(0) - 49;
          if (n < helpPageCount()) st.ui.helpPage = n; else handled = false;
        } else handled = false;
        break;
      case 'gameover':
        if (k === 'Tab') toggleRecap(st);
        else if (k === 'Escape' || k === 'Enter') leaveEndScreen(st);
        else handled = false;
        break;
      case 'victory':
        if (k === 'Tab') toggleRecap(st);
        else if (k === 'Escape' || k === 'Enter') leaveEndScreen(st);
        else if (lk === 'c' && st.run) {
          DC.Sim.continueIntoMantle(st.run);
          st.ui.copied = null;
          st.ui.descendAnim = 0;
          st.screen = 'descend';
        } else handled = false;
        break;
      // M-RECAP: the card. C copies it here; on the victory stats view C still
      // means the Mantle, and both footers say which one they mean.
      case 'recap':
        if (k === 'Tab') toggleRecap(st);
        else if (lk === 'c') copyRecap(st);
        else if (k === 'Escape' || k === 'Enter') leaveEndScreen(st);
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  // EGG-420 (M-GRITPLUS): a 3-key buffer, live during a run. The digits are
  // NOT consumed — 4 and 2 still pick their build tools, which is half the
  // joke — and nothing about progression depends on any of this. The window
  // itself is sim state, so a pause or a descent carries it correctly.
  function eggKeys(st, k) {
    const EG = D.EGG420;
    if (!EG || !st.run || k.length !== 1 || k < '0' || k > '9') return;
    if (lastTime - eggKeyAt > EG.codeGapMs) eggBuf = '';
    eggKeyAt = lastTime;
    eggBuf = (eggBuf + k).slice(-EG.code.length);
    if (eggBuf !== EG.code) return;
    eggBuf = '';
    if (DC.Sim.eggActive && DC.Sim.eggActive(st.run)) return;   // already lit
    if (DC.Sim.startEgg && DC.Sim.startEgg(st.run, 'code')) bark('egg420');
  }

  function runKey(st, e, k, lk) {
    const ui = st.ui, run = st.run;
    // M-ONBOARD Part 2: the way out, first in the chain and bound to a key
    // nothing else on this screen uses. Every other binding still works while
    // the induction is up — it teaches by DOING, so it must never eat the keys
    // it is asking the player to press.
    if (k === D.TUTORIAL.skipKey && tutorSkip(st)) return true;
    eggKeys(st, k);
    if (ui.paused) {
      if (k === 'Escape' || k === 'Enter' || k === ' ') ui.paused = false;
      else if (lk === 'a') {
        DC.Sim.abandon(run);
        awardRun(st);
        // M-POLISH backlog: a real death barks; walking away used to skip
        // straight to gameover. The epitaph stays cause-aware (integrity is
        // still > 0, so Barks.epitaph picks the abandon pool).
        bark('death');
        ui.paused = false;
        st.screen = 'gameover';
      } else if (lk === 'h') openHelp(st, 'run');
      else return false;
      return true;
    }
    // M-TIER2: ten tools now, so the tenth is on '0' — the digit row read left
    // to right, which is where a hand already is. The index is the ONLY thing
    // that binds a key to a tool (data.js BUILD_ORDER), and the manual and the
    // induction compose their keycaps from the same list.
    const bi = k === '0' ? 9 : (k >= '1' && k <= '9') ? k.charCodeAt(0) - 49 : -1;
    if (bi >= 0 && bi < D.BUILD_ORDER.length) {
      const type = D.BUILD_ORDER[bi];
      // A sealed structure is not a tool yet. Say so once, in the LOG, rather
      // than arming a ghost that can never be placed.
      if (DC.Sim.unlocked && !DC.Sim.unlocked(run, type)) {
        DC.Sim.msg(run, D.BUILDINGS[type].name + ': no schematics until stratum ' +
          D.BUILDINGS[type].unlockDepth, D.COLORS.red);
        return true;
      }
      setTool(st, type);
      return true;
    }
    switch (lk) {
      case 'x': setTool(st, 'demolish'); return true;
      case 'r': ui.facing = (ui.facing + 1) % 4; return true;
      case 'c':
        DC.Sim.toggleOverdrive(run);
        if (run.overdrive && run.tally) run.tally.overdrives++;
        bark(run.overdrive ? 'overdriveOn' : 'overdriveOff');
        return true;
      case 'd': tryDescend(st); return true;
      // M-WORMS: two coal on the floor under the cursor. The only new binding
      // this brief adds, and it sits beside the other one-letter verbs rather
      // than on a modifier, because it is a TOOL and not an option.
      case 'l': doLure(st); return true;
      case 'h': openHelp(st, 'run'); return true;
    }
    if (k === 'Escape') {
      if (ui.laying) { ui.laying = false; endGesture(st); }
      else if (ui.tool) setTool(st, null);
      else ui.paused = true;
      return true;
    }
    if (k === ' ') { ui.paused = true; return true; }
    if (k === 'Enter') { contextAction(st); return true; }
    const mv = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[k];
    if (mv !== undefined) { moveCursor(st, mv, e.shiftKey ? D.CURSOR_JUMP : 1); return true; }
    return false;
  }

  function setTool(st, t) {
    st.ui.tool = t;
    st.ui.laying = false;
    endGesture(st);
  }

  // Enter = context action at the keyboard cursor.
  function contextAction(st) {
    const ui = st.ui, c = ui.cursor;
    if (!c) return;
    if (ui.tool === 'belt') {
      if (ui.laying) { ui.laying = false; endGesture(st); }
      else { beginGesture(st, c.x, c.y); ui.laying = true; }
    } else if (ui.tool === 'demolish') doDemolish(st, c.x, c.y);
    else if (ui.tool) doPlace(st, ui.tool, c.x, c.y);
    else doClickTile(st, c.x, c.y);
  }

  function moveCursor(st, dir, n) {
    const ui = st.ui;
    for (let i = 0; i < n; i++) {
      const nx = U.clamp(ui.cursor.x + D.DIRS[dir].dx, 0, D.MAP_W - 1);
      const ny = U.clamp(ui.cursor.y + D.DIRS[dir].dy, 0, D.MAP_H - 1);
      if (nx === ui.cursor.x && ny === ui.cursor.y) break;
      ui.cursor = { x: nx, y: ny };
      if (ui.laying && ui.tool === 'belt') enterCell(st, nx, ny);
    }
    ui.hover = { x: ui.cursor.x, y: ui.cursor.y };
  }

  // ---------------- build / interact actions ----------------

  function doPlace(st, type, x, y) {
    const run = st.run;
    const chk = DC.Sim.canPlace(run, type, x, y, st.ui.facing);
    if (!chk || !chk.ok) {
      const reason = (chk && chk.reason) || 'cannot build here';
      DC.Sim.msg(run, reason, D.COLORS.red);
      if (/cost|afford|plate|need/i.test(reason)) bark('brokeAttempt', reason);
      return false;
    }
    const ok = DC.Sim.place(run, type, x, y, st.ui.facing);
    if (ok && DC.Audio) DC.Audio.play('place');
    return ok;
  }

  // M-WORMS: the lure. Refusals are said in the LOG in the sim's flat voice,
  // exactly as a refused placement is; GRIT only gets a line when it works,
  // because a foreman editorialising every mistyped key is nagging (§0 law 3).
  function doLure(st) {
    if (!DC.Worms || !DC.Worms.lure) return;
    const c = st.ui.cursor;
    if (!c) return;
    const r = DC.Worms.lure(st.run, c.x, c.y);
    // A successful lure pushes its own event; GRIT answers it on the next
    // tick through drainEvents, like every other thing that happens down here.
    if (r && !r.ok && r.reason) DC.Sim.msg(st.run, r.reason, D.COLORS.red);
  }

  function doDemolish(st, x, y) {
    const r = DC.Sim.demolishAt(st.run, x, y);
    if (r && r.ok) bark('demolish');
    if (r && r.ok && DC.Audio) DC.Audio.play('demolish');
    else if (r && r.reason) DC.Sim.msg(st.run, r.reason, D.COLORS.red);
  }

  function doClickTile(st, x, y) {
    const odWas = !!st.run.overdrive;
    const r = DC.Sim.clickTile(st.run, x, y);
    if (r && r.handled && r.msg) DC.Sim.msg(st.run, r.msg, D.COLORS.amber);
    if (r && r.handled && r.kind === 'repair') {
      if (st.run.tally) st.run.tally.repairs++;
      bark('repair');
    }
    // the hub tile toggles overdrive through the sim; count it the same way
    if (!odWas && st.run.overdrive && st.run.tally) st.run.tally.overdrives++;
  }

  // ---------------- belt gesture (mouse drag & keyboard lay-mode) ----------------

  function tileAt(run, x, y) {
    if (x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H) return null;
    return run.grid[y][x];
  }

  function beginGesture(st, x, y) {
    gesture = {};
    st.ui.dragLast = { x, y };
    if (DC.Sim.place(st.run, 'belt', x, y, st.ui.facing)) {
      gesture[x + ',' + y] = true;
      if (DC.Audio) DC.Audio.play('place');
    }
  }

  // The pointer/cursor entered (x, y) mid-gesture; step through intermediate
  // cells (x-major) so fast mouse moves still lay an unbroken line.
  function enterCell(st, x, y) {
    const last = st.ui.dragLast;
    if (!last) { st.ui.dragLast = { x, y }; return; }
    if (x === last.x && y === last.y) return;
    let cx = last.x, cy = last.y;
    const steps = [];
    while (cx !== x) { cx += (x > cx ? 1 : -1); steps.push({ x: cx, y: cy }); }
    while (cy !== y) { cy += (y > cy ? 1 : -1); steps.push({ x: cx, y: cy }); }
    for (let i = 0; i < steps.length; i++) stepGesture(st, steps[i].x, steps[i].y);
  }

  function stepGesture(st, nx, ny) {
    const ui = st.ui, run = st.run, last = ui.dragLast;
    const dx = nx - last.x, dy = ny - last.y;
    let dir = -1;
    for (let i = 0; i < 4; i++) if (D.DIRS[i].dx === dx && D.DIRS[i].dy === dy) dir = i;
    if (dir < 0) { ui.dragLast = { x: nx, y: ny }; return; }
    // Corner turning: a belt placed earlier in this gesture bends toward the new cell.
    if (gesture[last.x + ',' + last.y]) {
      const lt = tileAt(run, last.x, last.y);
      if (lt && lt.belt) lt.belt.dir = dir;
    }
    ui.facing = dir;
    if (DC.Sim.place(run, 'belt', nx, ny, dir)) {
      gesture[nx + ',' + ny] = true;
      if (DC.Audio) DC.Audio.play('place');
    } else {
      // Retracing our own line: just re-aim the existing gesture belt.
      const t = tileAt(run, nx, ny);
      if (t && t.belt && gesture[nx + ',' + ny]) t.belt.dir = dir;
    }
    ui.dragLast = { x: nx, y: ny };
  }

  function endGesture(st) {
    st.ui.dragging = false;
    st.ui.dragLast = null;
    gesture = {};
  }

  function endDrag(st) {
    if (!st.ui.dragging) return;
    st.ui.dragging = false;
    if (!st.ui.laying) { st.ui.dragLast = null; gesture = {}; }
  }

  // ---------------- mouse ----------------

  function cellFromEvent(e) {
    const pc = DC.Render.pxToCell(e.clientX, e.clientY);
    if (!pc) return null;
    const x = pc.col - D.MAP_X, y = pc.row - D.MAP_Y;
    return {
      col: pc.col, row: pc.row, x, y,
      onMap: x >= 0 && x < D.MAP_W && y >= 0 && y < D.MAP_H,
    };
  }

  function onMouseMove(e) {
    const st = DC.state;
    if (!st) return;
    const c = cellFromEvent(e);
    if (!c) return;
    if (st.screen === 'run') {
      if (c.onMap) {
        st.ui.hover = { x: c.x, y: c.y };
        st.ui.cursor = { x: c.x, y: c.y };
        if (st.ui.dragging && st.ui.tool === 'belt' && !st.ui.paused) enterCell(st, c.x, c.y);
      } else {
        st.ui.hover = null;
      }
    } else if (st.screen === 'descend') {
      st.ui.hoverCard = cardAt(st, c);
    } else if (st.screen === 'vignette') {
      st.ui.hoverChoice = choiceAt(st, c);
    }
  }

  function onMouseDown(e) {
    const st = DC.state;
    if (!st) return;
    if (DC.Audio) DC.Audio.init();              // M-SOUND: a click is a gesture too
    const c = cellFromEvent(e);
    if (!c) return;
    if (st.screen === 'run' && !st.ui.paused) {
      if (c.onMap) {
        const ui = st.ui;
        if (ui.tool === 'belt') { beginGesture(st, c.x, c.y); ui.dragging = true; }
        else if (ui.tool === 'demolish') doDemolish(st, c.x, c.y);
        else if (ui.tool) doPlace(st, ui.tool, c.x, c.y);
        else doClickTile(st, c.x, c.y); // hub tile => overdrive toggle (via Sim)
      } else {
        sidebarClick(st, c);
      }
    } else if (st.screen === 'descend') {
      const i = cardAt(st, c);
      if (i >= 0) applyChoice(st, i);
    } else if (st.screen === 'contract') {
      const L = DC.Render.layout, cds = L && L.contracts;
      if (Array.isArray(cds)) {
        for (let i = 0; i < cds.length; i++) {
          const cd = cds[i];
          if (c.col >= cd.col && c.col < cd.col + cd.w && c.row >= cd.row && c.row < cd.row + cd.h) {
            st.ui.contractCursor = i; signContract(st, i); break;
          }
        }
      }
    } else if (st.screen === 'vignette') {
      const i = choiceAt(st, c);
      if (i >= 0) answerVignette(st, i);
    }
  }

  function onMouseUp() {
    const st = DC.state;
    if (st) endDrag(st);
  }

  function onMouseLeave() {
    const st = DC.state;
    if (!st) return;
    st.ui.hover = null;
    endDrag(st);
  }

  // Sidebar build-list clicks. render.js publishes DC.Render.layout.buildRows
  // as an array of {row, tool} entries (grid row -> tool id); a plain
  // {gridRow: toolId} map is also accepted. Without it, clicks are a no-op
  // (keyboard 1-5 / X always works).
  function sidebarClick(st, c) {
    const L = DC.Render.layout;
    const rows = L && L.buildRows;
    if (!rows) return;
    let t = null;
    if (Array.isArray(rows)) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.row !== c.row) continue;
        // M-WIDE: there is a second panel column now, and a click over there
        // lands on the same ROW as a build entry. Entries carry their column
        // span when render publishes one; older payloads match on row alone.
        if (typeof r.col === 'number' && (c.col < r.col || c.col >= r.col + (r.w || 1))) continue;
        t = r.tool;
        break;
      }
    } else {
      t = rows[c.row];
    }
    if (!t || typeof t !== 'string') return;
    setTool(st, t === st.ui.tool ? null : t);
  }

  // M-EVENTS: vignette choice hit test, over DC.Render.layout.choices
  // ([{col,row,w,h,index}, ...]). Keyboard 1/2 is the real route and always
  // works; this is here because every other screen in the game answers a
  // mouse and a screen that silently does not feels broken.
  function choiceAt(st, c) {
    const L = DC.Render.layout;
    const rows = L && L.choices;
    if (!Array.isArray(rows)) return -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && c.col >= r.col && c.col < r.col + r.w &&
          c.row >= r.row && c.row < r.row + r.h) return r.index;
    }
    return -1;
  }

  // Descend-screen card hit test: DC.Render.layout.cards
  // ([{col,row,w,h}, ...]) when published; else even column split.
  function cardAt(st, c) {
    const offers = st.run && st.run.pendingOffers;
    if (!offers || st.ui.descendAnim < animLen()) return -1;
    const L = DC.Render.layout;
    if (L && Array.isArray(L.cards)) {
      for (let i = 0; i < L.cards.length && i < offers.length; i++) {
        const cd = L.cards[i];
        if (c.col >= cd.col && c.col < cd.col + cd.w &&
            c.row >= cd.row && c.row < cd.row + cd.h) return i;
      }
      return -1;
    }
    const w = D.COLS / offers.length;
    const i = Math.floor(c.col / w);
    return (i >= 0 && i < offers.length) ? i : -1;
  }

  DC.Engine = { start };
})();
