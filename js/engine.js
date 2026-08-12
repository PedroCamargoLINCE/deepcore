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
  let helpFrom = 'title';    // screen to return to from help
  let recapFrom = 'gameover';// screen to return to from the recap card
  let gesture = {};          // "x,y" -> true: belts placed in the current drag/lay gesture
  let pauseAt = 0;           // rAF timestamp the current pause began (0 = running)
  let smoked = false;        // GRIT already took his smoke break on this pause
  let eggBuf = '';           // EGG-420: the last few digits typed, in order
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
    }
    drainEvents(run);
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
      if (ev.type === 'quake' && ev.data && ev.data.dmg >= 8) bark('bigQuake', ev.data);
      else if (ev.type === 'magma') bark('magmaSpread');
      else if (ev.type === 'depleted') bark('veinDepleted');
      // M-CORELORE: the Core Gate. sim.js says WHEN (breach fractions at s8);
      // barks.js says what, and answers itself in GRIT's voice a beat later.
      else if (ev.type === 'core') coreBeat(run, ev.data);
      // M-WONDERS: the stratum's landmark, found by the sweep or used by the
      // player. The Bell is the one that reaches past GRIT: ringing it is
      // heard, and something far below answers early (SPEC3 M-CORELORE hook).
      else if (ev.type === 'landmark' && ev.data) {
        if (ev.data.act === 'find') bark('landmarkFound', ev.data.id);
        else {
          bark('landmarkUse', ev.data.id);
          if (ev.data.id === 'bell') coreBeat(run, { kind: 'intrusion' });
        }
      }
    }
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
    if (!trigger || !B || !B.fire || !st || !st.run) return;
    try { B.fire(st.run, trigger, ctx); } catch (e) {}
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
    st.run = DC.Sim.newRun(effects, seed);
    // Engine-owned recap bookkeeping. The sim knows nothing about any of it:
    // splits are stamped at descend time, startedAt is wall-clock (engine may
    // read a clock; sim may not).
    st.run.daily = daily;
    st.run.splits = [];
    st.run.startedAt = Date.now();
    awarded = false; awardedCores = 0; breachFlashed = false;
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
    bark(daily ? (daily.practice ? 'dailyPractice' : 'dailyStart') : 'runStart');
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
    } else {
      // Already banked at victory; a Mantle death only credits the new breaches.
      const delta = (res.cores || 0) - awardedCores;
      if (delta > 0) {
        st.meta.cores += delta;
        st.meta.totalCores += delta;
        awardedCores = res.cores;
      }
      if (res.depth > st.meta.bestDepth) st.meta.bestDepth = res.depth;
      DC.Meta.save(st.meta);
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

  // EGG-420's trophy (SPEC3 M-ACHIEVE: "High Score" — win a run that included
  // the window). M-ACHIEVE may not exist in this tree, so the hook is a hard
  // no-op unless meta.js grew an award function; the run still records
  // run.eggSeen either way, which is all a later dispatch needs.
  function eggTrophy(st) {
    const M = DC.Meta;
    if (!st.run || !st.run.eggSeen || !M || typeof M.awardTrophy !== 'function') return;
    try { M.awardTrophy(st.meta, 'high_score'); } catch (e) {}
  }

  function handleWon(st) {
    awardRun(st);
    eggTrophy(st);
    bark('victory');
    st.screen = 'victory';
  }

  function tryDescend(st) {
    const run = st.run;
    if (!run || run.status !== 'breachReady') return;
    if (!DC.Sim.beginDescent(run)) return;
    recordSplit(run);
    bark('descend');
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
    DC.Sim.applySchematic(run, id);
    bark('schematicPick', id);
    breachFlashed = false;
    arriveFlash(st);
    st.ui.shakeUntil = 0;
    st.ui.hover = null;
    centerCursor(st);
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
    switch (st.screen) {
      case 'title':
        if (k === 'Enter') newRun(st);
        else if (lk === 't') newRun(st, { daily: true });
        else if (lk === 'f') {
          st.screen = 'foundry';
          if (st.foundryBark) st.foundryBark.line = null;   // fresh floor, no stale line
        }
        else if (lk === 'h') openHelp(st, 'title');
        else handled = false;
        break;
      case 'run':
        handled = runKey(st, e, k, lk);
        break;
      case 'descend': {
        const offers = st.run && st.run.pendingOffers;
        const n = (k >= '1' && k <= '9') ? k.charCodeAt(0) - 49 : -1;
        if (offers && n >= 0 && n < offers.length) applyChoice(st, n);
        else handled = false;
        break;
      }
      case 'foundry':
        if (k === 'Escape' || k === 'Enter') st.screen = 'title';
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
    const bi = (k >= '1' && k <= '9') ? k.charCodeAt(0) - 49 : -1;
    if (bi >= 0 && bi < D.BUILD_ORDER.length) { setTool(st, D.BUILD_ORDER[bi]); return true; }
    switch (lk) {
      case 'x': setTool(st, 'demolish'); return true;
      case 'r': ui.facing = (ui.facing + 1) % 4; return true;
      case 'c':
        DC.Sim.toggleOverdrive(run);
        bark(run.overdrive ? 'overdriveOn' : 'overdriveOff');
        return true;
      case 'd': tryDescend(st); return true;
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
    return DC.Sim.place(run, type, x, y, st.ui.facing);
  }

  function doDemolish(st, x, y) {
    const r = DC.Sim.demolishAt(st.run, x, y);
    if (r && r.ok) bark('demolish');
    else if (r && r.reason) DC.Sim.msg(st.run, r.reason, D.COLORS.red);
  }

  function doClickTile(st, x, y) {
    const r = DC.Sim.clickTile(st.run, x, y);
    if (r && r.handled && r.msg) DC.Sim.msg(st.run, r.msg, D.COLORS.amber);
    if (r && r.handled && r.kind === 'repair') bark('repair');
  }

  // ---------------- belt gesture (mouse drag & keyboard lay-mode) ----------------

  function tileAt(run, x, y) {
    if (x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H) return null;
    return run.grid[y][x];
  }

  function beginGesture(st, x, y) {
    gesture = {};
    st.ui.dragLast = { x, y };
    if (DC.Sim.place(st.run, 'belt', x, y, st.ui.facing)) gesture[x + ',' + y] = true;
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
    }
  }

  function onMouseDown(e) {
    const st = DC.state;
    if (!st) return;
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
        if (rows[i] && rows[i].row === c.row) { t = rows[i].tool; break; }
      }
    } else {
      t = rows[c.row];
    }
    if (!t || typeof t !== 'string') return;
    setTool(st, t === st.ui.tool ? null : t);
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
