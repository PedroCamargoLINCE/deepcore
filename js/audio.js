/* DEEPCORE — audio.js (M-SOUND: the rig sings)

   Procedural audio, zero files. Every sound is synthesized on the spot from
   WebAudio oscillators and noise buffers in one muffled industrial register:
   low sine thuds, filtered brown noise, metallic FM pings. Nothing is loaded.

   Contract:
     DC.Audio.init()          create/resume the AudioContext. Browsers refuse
                              to start audio without a user gesture, so the
                              engine calls this from its key and mouse
                              handlers; before the first one, every play() is
                              silent (but still logged — see below).
     DC.Audio.play(name, o)   fire a one-shot. Unknown names are ignored.
     DC.Audio.tick(run)       once per sim tick, AFTER the tick: derives the
                              event sounds that the sim does not announce
                              (a press finishing, a worm moving, the Core
                              speaking) by diffing run state against the
                              previous tick. READ ONLY.
     DC.Audio.frame(st)       once per rendered frame: drives the continuous
                              voices (drill churn, klaxon, title drone, purr)
                              from live state. READ ONLY.
     DC.Audio.setMuted(b) / muted() / toggle()
                              the M key. Persisted by the engine in the meta
                              save (meta.muted); this module keeps no storage.

   Laws honoured:
     - OUTPUT ONLY. This file reads the run and never writes it, never calls
       run.rng (§0 law 7), never gates a sim decision. test/balance.js is
       byte-identical with and without it, which is the proof.
     - Law 1 (animation is honest) extends to sound: drillLoop's volume IS
       Sim.feedRate; a rumble means a worm actually moved; the klaxon sounds
       because instability is actually >= 99.
     - Fully optional. engine.js guards every call (`DC.Audio && ...`); the
       game runs identically with this file absent. The bundle carries it
       because index.html and tools/build.js both list it.
     - Headless-safe. The ONLY file allowed to touch window.AudioContext, and
       it no-ops cleanly in bare node: without a context, play() records the
       call in a small history ring (what the suites assert on) and makes no
       sound. tick()/frame() run their detection either way.

   Register: master gain -12 dB, everything through a single compressor.
   Off by default until the first user gesture.
*/
(function () {
  const root = typeof globalThis !== 'undefined' ? globalThis : this;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA || {};
  const SND = D.SOUND || {};
  const HZ = D.TICK_HZ || 8;

  // ---------------- constants (data.js may override via D.SOUND) ----------------
  const MASTER_DB = SND.masterDb !== undefined ? SND.masterDb : -12;
  const THROTTLE = SND.throttle || { craftDone: 4, place: 8, wormMove: 6, squelch: 6 };
  const HISTORY_MAX = 64;

  // ---------------- state ----------------
  let ctx = null, master = null, comp = null, noiseBuf = null;
  let mutedFlag = false;
  let initFailed = false;
  const history = [];          // [{name, at}] — newest last; headless tests read it
  const counts = {};           // name -> times play() accepted it
  const lastTimes = {};        // name -> [ms] within the last second (throttle)
  const loops = {};            // continuous voices: name -> { nodes, gain, ... }
  const seen = {               // per-run diff memory for tick()
    run: null, jobs: {}, worms: {}, coreT0: -1,
  };

  function clock() {
    if (DC.Audio && typeof DC.Audio.clock === 'function') return DC.Audio.clock();
    if (typeof performance !== 'undefined' && performance && performance.now) return performance.now();
    return Date.now();
  }
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------------- context ----------------
  function ctor() {
    if (typeof window === 'undefined' || !window) return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }
  function init() {
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      return true;
    }
    if (initFailed) return false;
    const AC = ctor();
    if (!AC) { initFailed = true; return false; }
    try {
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6;
      comp.attack.value = 0.005; comp.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = mutedFlag ? 0 : dbToGain(MASTER_DB);
      comp.connect(master);
      master.connect(ctx.destination);
      noiseBuf = makeNoise(ctx, 2);
      buildLoops();
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    } catch (e) {
      ctx = null; master = null; comp = null; initFailed = true;
      return false;
    }
    return true;
  }
  function ready() { return !!(ctx && ctx.state !== 'closed'); }

  // Brown noise: white noise integrated with a leak — the sound of rock.
  function makeNoise(c, seconds) {
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    // A fixed LCG, not Math.random — the noise buffer is the same every
    // load, which keeps "what did that sound like" reproducible. It is not
    // run.rng and could never be: this file has no run in scope here.
    let s = 0x9E3779B1 >>> 0;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const w = (s / 4294967296) * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  // ---------------- node helpers ----------------
  function osc(type, freq, t0) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    return o;
  }
  function gain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function filt(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; if (q !== undefined) f.Q.value = q;
    return f;
  }
  function noise(loop) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = !!loop;
    return s;
  }
  // gain envelope: attack to peak, exponential-ish decay to ~0 by t0+len
  function env(g, t0, peak, atk, len) {
    const p = g.gain;
    p.cancelScheduledValues(t0);
    p.setValueAtTime(0.0001, t0);
    p.linearRampToValueAtTime(peak, t0 + atk);
    p.exponentialRampToValueAtTime(0.0001, t0 + len);
  }
  function stopAt(node, t) { try { node.stop(t); } catch (e) {} }

  // ---------------- one-shots ----------------
  const VOICES = {
    // soft clunk: a low sine drop with a dry noise tick on top
    place: function (t0) {
      const o = osc('sine', 110, t0);
      o.frequency.exponentialRampToValueAtTime(48, t0 + 0.12);
      const g = gain(0); env(g, t0, 0.5, 0.005, 0.16);
      o.connect(g); g.connect(comp); o.start(t0); stopAt(o, t0 + 0.2);
      const n = noise(false), nf = filt('bandpass', 900, 1.5), ng = gain(0);
      env(ng, t0, 0.18, 0.002, 0.05);
      n.connect(nf); nf.connect(ng); ng.connect(comp); n.start(t0); stopAt(n, t0 + 0.08);
    },
    // crumble: brown noise through a falling lowpass, plus a dull thud
    demolish: function (t0) {
      const n = noise(false), f = filt('lowpass', 700, 0.7), g = gain(0);
      f.frequency.exponentialRampToValueAtTime(90, t0 + 0.35);
      env(g, t0, 0.6, 0.01, 0.4);
      n.connect(f); f.connect(g); g.connect(comp); n.start(t0); stopAt(n, t0 + 0.45);
      const o = osc('sine', 70, t0);
      o.frequency.exponentialRampToValueAtTime(38, t0 + 0.2);
      const og = gain(0); env(og, t0 + 0.02, 0.35, 0.01, 0.25);
      o.connect(og); og.connect(comp); o.start(t0); stopAt(o, t0 + 0.3);
    },
    // faint press ping: metallic FM, over in a tenth of a second
    craftDone: function (t0) {
      const c = osc('sine', 1180, t0), m = osc('sine', 1180 * 1.73, t0);
      const mg = gain(600); m.connect(mg); mg.connect(c.frequency);
      const g = gain(0); env(g, t0, 0.09, 0.002, 0.13);
      c.connect(g); g.connect(comp); c.start(t0); m.start(t0);
      stopAt(c, t0 + 0.15); stopAt(m, t0 + 0.15);
    },
    // rumble swell 1.5s, with the integrity-hit thump a third of the way in
    quake: function (t0, o) {
      const big = !!(o && o.big);
      const n = noise(false), f = filt('lowpass', 140, 0.5), g = gain(0);
      const p = g.gain;
      p.setValueAtTime(0.0001, t0);
      p.linearRampToValueAtTime(big ? 1.0 : 0.8, t0 + 0.5);
      p.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      n.connect(f); f.connect(g); g.connect(comp); n.start(t0); stopAt(n, t0 + 1.6);
      const th = osc('sine', 52, t0 + 0.3);
      th.frequency.exponentialRampToValueAtTime(30, t0 + 0.7);
      const tg = gain(0); env(tg, t0 + 0.3, big ? 0.9 : 0.7, 0.01, 0.5);
      th.connect(tg); tg.connect(comp); th.start(t0 + 0.3); stopAt(th, t0 + 0.9);
    },
    // rising drone -> punch-through boom, timed to the descent animation
    breach: function (t0, o) {
      const dur = clamp((o && o.dur) || 2.5, 0.5, 8);
      const a = osc('sawtooth', 48, t0), b = osc('sawtooth', 48.7, t0);
      a.frequency.exponentialRampToValueAtTime(150, t0 + dur);
      b.frequency.exponentialRampToValueAtTime(152, t0 + dur);
      const f = filt('lowpass', 160, 2);
      f.frequency.exponentialRampToValueAtTime(900, t0 + dur);
      const g = gain(0), p = g.gain;
      p.setValueAtTime(0.0001, t0);
      p.linearRampToValueAtTime(0.35, t0 + dur * 0.9);
      p.setValueAtTime(0.35, t0 + dur);
      p.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.15);
      a.connect(f); b.connect(f); f.connect(g); g.connect(comp);
      a.start(t0); b.start(t0); stopAt(a, t0 + dur + 0.2); stopAt(b, t0 + dur + 0.2);
      // the boom: noise + sub, right where the rig breaks the floor
      const tb = t0 + dur;
      const n = noise(false), nf = filt('lowpass', 220, 0.6), ng = gain(0);
      env(ng, tb, 1.0, 0.01, 1.2);
      n.connect(nf); nf.connect(ng); ng.connect(comp); n.start(tb); stopAt(n, tb + 1.3);
      const s = osc('sine', 60, tb); s.frequency.exponentialRampToValueAtTime(28, tb + 0.8);
      const sg = gain(0); env(sg, tb, 0.9, 0.01, 1.0);
      s.connect(sg); sg.connect(comp); s.start(tb); stopAt(s, tb + 1.1);
    },
    // a worm moved: low brown-noise slide, the bandpass sweeping down
    wormMove: function (t0) {
      const n = noise(false), f = filt('bandpass', 95, 2.5), g = gain(0);
      f.frequency.exponentialRampToValueAtTime(42, t0 + 0.4);
      env(g, t0, 0.22, 0.05, 0.45);
      n.connect(f); f.connect(g); g.connect(comp); n.start(t0); stopAt(n, t0 + 0.5);
    },
    // the Core's voice: a sub-bass swell under the gold text — felt, not heard
    coreVoice: function (t0) {
      const o = osc('sine', 31, t0);
      const g = gain(0), p = g.gain;
      p.setValueAtTime(0.0001, t0);
      p.linearRampToValueAtTime(0.7, t0 + 0.9);
      p.setValueAtTime(0.7, t0 + 2.2);
      p.exponentialRampToValueAtTime(0.0001, t0 + 3.4);
      o.connect(g); g.connect(comp); o.start(t0); stopAt(o, t0 + 3.5);
    },
    // GRIT's radio squelch: a two-frame click before he opens his mouth
    squelch: function (t0) {
      const n = noise(false), f = filt('highpass', 2400, 1), g = gain(0);
      env(g, t0, 0.12, 0.002, 0.034);
      n.connect(f); f.connect(g); g.connect(comp); n.start(t0); stopAt(n, t0 + 0.04);
    },
    // the Bell: one clean struck note, long decay. The ONLY pure tone in the
    // game — no filter, no noise, no detune — which is exactly why it is scary.
    bell: function (t0) {
      const o = osc('sine', 659.25, t0);   // E5
      const g = gain(0), p = g.gain;
      p.setValueAtTime(0.0001, t0);
      p.linearRampToValueAtTime(0.55, t0 + 0.004);
      p.exponentialRampToValueAtTime(0.0001, t0 + 7.0);
      o.connect(g); g.connect(comp); o.start(t0); stopAt(o, t0 + 7.1);
    },
  };

  // The seven M1 names plus SPEC3's five hooks. `collapse` is a continuous
  // voice (the klaxon) driven from frame(); it is listed so play('collapse')
  // is a valid, logged event the engine fires on the collapse quake.
  const NAMES = ['place', 'demolish', 'craftDone', 'quake', 'breach', 'drillLoop',
    'collapse', 'title', 'wormMove', 'coreVoice', 'squelch', 'purr', 'bell'];

  function throttled(name, now) {
    const lim = THROTTLE[name];
    if (!lim) return false;
    const arr = lastTimes[name] || (lastTimes[name] = []);
    while (arr.length && arr[0] <= now - 1000) arr.shift();
    if (arr.length >= lim) return true;
    arr.push(now);
    return false;
  }

  function play(name, opts) {
    if (!name || NAMES.indexOf(name) < 0) return false;
    const now = clock();
    if (throttled(name, now)) return false;
    counts[name] = (counts[name] || 0) + 1;
    history.push({ name: name, at: now });
    if (history.length > HISTORY_MAX) history.shift();
    if (name === 'collapse') return true;              // sounded by the klaxon loop
    if (!ready() || mutedFlag) return true;
    const v = VOICES[name];
    if (!v) return true;
    try { v(ctx.currentTime + 0.001, opts || {}); } catch (e) { /* never throw into the loop */ }
    return true;
  }

  // ---------------- continuous voices ----------------
  // Built once at init with gain 0; frame() steers their gains (and the
  // drill's pitch) with short time constants so they never click.
  function buildLoops() {
    // drillLoop: brown churn + a 55 Hz sine with slow AM
    {
      const n = noise(true), f = filt('lowpass', 190, 0.8);
      const s = osc('sine', 55, 0);
      const lfo = osc('sine', 3.2, 0), lg = gain(0.5), sg = gain(0.5);
      lfo.connect(lg); lg.connect(sg.gain);
      const g = gain(0);
      n.connect(f); f.connect(g); s.connect(sg); sg.connect(g); g.connect(comp);
      n.start(); s.start(); lfo.start();
      loops.drillLoop = { gain: g, sine: s, filter: f, base: 55, level: 0 };
    }
    // collapse klaxon: a low saw, pulsed at 3 Hz, through a lowpass
    {
      const a = osc('sawtooth', 165, 0), b = osc('sawtooth', 220, 0);
      const f = filt('lowpass', 1200, 1);
      const lfo = osc('square', 3, 0), lg = gain(0.5), pg = gain(0.5);
      lfo.connect(lg); lg.connect(pg.gain);
      const g = gain(0);
      a.connect(f); b.connect(f); f.connect(pg); pg.connect(g); g.connect(comp);
      a.start(); b.start(); lfo.start();
      loops.collapse = { gain: g, level: 0 };
    }
    // title drone: two detuned saws through a lowpass, barely audible
    {
      const a = osc('sawtooth', 55, 0), b = osc('sawtooth', 55.45, 0);
      const f = filt('lowpass', 130, 1.5), g = gain(0);
      a.connect(f); b.connect(f); f.connect(g); g.connect(comp);
      a.start(); b.start();
      loops.title = { gain: g, level: 0 };
    }
    // cat purr: a 26 Hz rumble amplitude-modulated at 24 Hz, very quiet
    {
      const s = osc('sine', 26, 0), lfo = osc('sine', 24, 0), lg = gain(0.5), mg = gain(0.5);
      lfo.connect(lg); lg.connect(mg.gain);
      const f = filt('lowpass', 120, 0.7), g = gain(0);
      s.connect(mg); mg.connect(f); f.connect(g); g.connect(comp);
      s.start(); lfo.start();
      loops.purr = { gain: g, level: 0 };
    }
  }
  function setLoop(name, level, tc) {
    const L = loops[name];
    if (!L) return;
    L.level = level;
    if (!ready()) return;
    try { L.gain.gain.setTargetAtTime(mutedFlag ? 0 : level, ctx.currentTime, tc || 0.08); } catch (e) {}
  }

  // ---------------- state readers (all read-only) ----------------
  const LEVELS = SND.levels || { drill: 0.55, klaxon: 0.45, title: 0.06, purr: 0.05 };

  // The drill's feed rate as a 0..1 fraction of the fastest it could possibly
  // chew: Sim.feedRate is the truth; the ceiling is one bite per drill period.
  function drillLevel(run) {
    const Sim = DC.Sim;
    if (!Sim || typeof Sim.feedRate !== 'function' || !run || !run._feed) return 0;
    let r;
    try { r = Sim.feedRate(run); } catch (e) { return 0; }
    const rate = (r.gearPerSec || 0) + (r.chargePerSec || 0);
    const mult = (run.mods && run.mods.drillMult) || 1;
    const max = HZ / Math.max(1, (D.DRILL_PERIOD || 8)) * mult *
      (run.overdrive && D.OVERDRIVE ? D.OVERDRIVE.drillMult : 1);
    return clamp(rate / Math.max(0.01, max), 0, 1);
  }
  function catPerched(run) {
    const c = run && run.ev && run.ev.cat;
    return !!(c && c.mode === 'perch');
  }

  // Once per rendered frame. Continuous voices only.
  const levels = { drillLoop: 0, collapse: 0, title: 0, purr: 0 };
  function frame(st) {
    if (!st) return levels;
    const run = st.run;
    const live = st.screen === 'run' && run && !st.ui.paused &&
      (run.status === 'active' || run.status === 'breachReady');
    levels.title = st.screen === 'title' ? LEVELS.title : 0;
    levels.drillLoop = live ? drillLevel(run) * LEVELS.drill : 0;
    levels.collapse = live && run.instability >= 99 ? LEVELS.klaxon : 0;
    levels.purr = live && catPerched(run) ? LEVELS.purr : 0;
    setLoop('title', levels.title, 0.4);
    setLoop('drillLoop', levels.drillLoop, 0.15);
    setLoop('collapse', levels.collapse, 0.05);
    setLoop('purr', levels.purr, 0.3);
    // overdrive raises the churn a major third
    const dl = loops.drillLoop;
    if (dl && ready()) {
      const f = dl.base * (live && run.overdrive ? 1.26 : 1);
      try { dl.sine.frequency.setTargetAtTime(f, ctx.currentTime, 0.1); } catch (e) {}
    }
    return levels;
  }

  // Once per sim tick, after the tick. Event sounds derived by diffing.
  function tick(run) {
    if (!run) return;
    if (seen.run !== run) {                    // a new run: forget the old one
      seen.run = run; seen.jobs = {}; seen.worms = {}; seen.coreT0 = -1;
    }
    // craftDone: a machine whose job finished this tick. A finished job leaves
    // its product in m.out and clears m.job, so "had a job, now has none, has
    // output" is the press landing.
    const ms = run.machines;
    if (ms) {
      for (const id in ms) {
        const m = ms[id];
        if (!m) continue;
        const had = !!seen.jobs[id];
        const has = !!m.job;
        if (had && !has && m.out && m.out.length) play('craftDone');
        seen.jobs[id] = has;
      }
    }
    // wormMove: a worm whose head is not where it was, on a revealed tile.
    const W = DC.Worms;
    const worms = W && W.list ? W.list(run) : null;
    if (worms && worms.length) {
      const now = {};
      for (let i = 0; i < worms.length; i++) {
        const w = worms[i];
        if (!w) continue;
        const key = w.x + ',' + w.y;
        now[w.id] = key;
        const prev = seen.worms[w.id];
        if (prev !== undefined && prev !== key) {
          const row = run.grid && run.grid[w.y];
          const t = row && row[w.x];
          if (!t || t.revealed) play('wormMove');
        }
      }
      seen.worms = now;
    }
    // coreVoice: the bar changed character. barks.js stamps the line with
    // voice:'core' and a fresh t0; a new t0 is a new intrusion.
    const fm = run.foreman;
    if (fm && fm.voice === 'core' && fm.t0 !== seen.coreT0) {
      seen.coreT0 = fm.t0;
      play('coreVoice');
    }
  }

  // ---------------- mute ----------------
  function setMuted(b) {
    mutedFlag = !!b;
    if (ready() && master) {
      try { master.gain.setTargetAtTime(mutedFlag ? 0 : dbToGain(MASTER_DB), ctx.currentTime, 0.02); } catch (e) {}
    }
    return mutedFlag;
  }
  function muted() { return mutedFlag; }
  function toggle() { return setMuted(!mutedFlag); }

  // Test/reset hook: forget everything (history, throttles, diff memory).
  function reset() {
    history.length = 0;
    for (const k in counts) delete counts[k];
    for (const k in lastTimes) delete lastTimes[k];
    seen.run = null; seen.jobs = {}; seen.worms = {}; seen.coreT0 = -1;
  }

  DC.Audio = {
    init: init, play: play, tick: tick, frame: frame,
    setMuted: setMuted, muted: muted, toggle: toggle,
    ready: ready, reset: reset,
    NAMES: NAMES, THROTTLE: THROTTLE, MASTER_DB: MASTER_DB,
    history: history, counts: counts, levels: levels,
    clock: null,          // tests may install a fake clock here
  };
})();
