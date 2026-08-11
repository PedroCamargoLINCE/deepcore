/* DEEPCORE — fx.js
   DC.FX: the render-side animation layer (SPEC3 §A — M-ANIM-1 / M-ANIM-2).
   Owns a frame clock, a small particle list, the per-tile choreography of
   table A1 and the last-pass screen overlay of table A2.

   Contracts (SPEC3 §A, closing paragraph):
   - ZERO sim edits. Every effect derives from state that already exists:
     run.t / run.quakeAt / run.instability, machine.job/status/out/fuel/hp,
     tile fields, ui flags. FX never writes to `run` or `ui`; it never calls
     run.rng (it owns a private PRNG); it never consumes run.events — the
     engine still drains that queue, FX only ever peeks at it.
   - The frame clock is throwaway render state (SPEC3 rule 4). Nothing here
     feeds back into the sim, so a dropped or doubled frame can never change
     a run's outcome.
   - DOM-free like every other module: FX draws through the small `surface`
     object render.js hands it (put/text/ch/fg/...), never through a canvas
     context of its own.

   Wiring (render.js): `DC.FX.begin(state, surface)` at the top of a frame
   (clock + grid scan + triggers), `DC.FX.tile(...)` per map cell inside
   drawMap, `DC.FX.frame(state, surface)` LAST, after every screen has drawn.

   Frame budget: the clock counts render frames and assumes ~60 fps, which is
   the same assumption render.js's flashPart blink already makes. Anything
   whose duration is specced in sim TICKS is measured against run.t instead,
   so it stays honest when the tab throttles. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;
  const C = D.COLORS;
  const U = DC.util;

  const FPS = 60;                        // render.js's assumed frame rate
  const HZ = D.TICK_HZ;
  const W = D.MAP_W, H = D.MAP_H;
  const N = W * H;

  // The frame clock. Starts at 1 so a zero stamp always means "never".
  let F = 0;
  // Private PRNG. run.rng belongs to the sim and is never touched from here.
  const rand = U.mulberry32(0x0DEEC02E);

  // ---------------------------------------------------------------- memory
  // Per-stratum scratch, rebuilt whenever run.grid changes identity (a new
  // run or a new stratum — startStratum always installs a fresh grid).
  let mem = null;

  function freshMem(run) {
    return {
      grid: run.grid,
      rev: new Int32Array(N),            // frame a tile became revealed
      rub: new Int32Array(N),            // frame a tile gained rubble
      belt: new Uint8Array(N),           // belt present last scan
      item: new Array(N).fill(null),     // belt item last scan
      itemT: new Int32Array(N),          // run.t the current item arrived
      first: true,                       // this is the stratum's first scan
      revStep: 0,                        // frame of the newest reveal ring
      smears: [],                        // {x, y, item} departed this frame
      tail: [],                          // {x, y, f} belts laid in a gesture
      crystals: [],                      // revealed crystal tile indices
      glint: null,                       // {i, until}
      lastQuakeEv: -1,                   // newest peeked quake event's totalT
      lastShake: 0,                      // newest ui.shakeUntil seen
      debrisT: -1,                       // totalT of the last debris burst
      sparks: [],                        // {x, y, t} magma contact flashes
      spit: Object.create(null),         // machine id -> {x, y, t}
      prog: Object.create(null),         // machine id -> last seen progress
      recipe: Object.create(null),       // machine id -> last seen recipe
      spin: Object.create(null),         // machine id -> frame of a switch
      drillActive: false,
      feeding: false,
      accent: C.amber,
      ui: null,
      xo: 0,
    };
  }

  function tileAt(run, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return run.grid[y][x];
  }
  function stratumOf(depth) {
    return depth <= D.STRATA_COUNT ? D.STRATA[depth - 1] : D.mantleStratum(depth);
  }
  // Deterministic irregularity: a hash, not a PRNG draw, so the same frame
  // always flickers the same way (repeatable under test, erratic on screen).
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = (n + (n << 3)) | 0;
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    n = n ^ (n >>> 15);
    return (n >>> 0) / 4294967296;
  }
  function breathe(period, off) {        // 0..1 sine, `period` frames
    return 0.5 + 0.5 * Math.sin(((F + (off || 0)) / period) * Math.PI * 2);
  }

  // ------------------------------------------------------------- the scan
  // One pass over the grid per frame. Everything that needs an edge (a tile
  // became revealed, rubble landed, a belt item departed) is detected here by
  // comparing against the previous frame's snapshot — never by asking the sim
  // to remember anything for us.
  function scan(run, ui) {
    const g = run.grid;
    const smears = mem.smears;
    smears.length = 0;
    const crystals = mem.crystals;
    crystals.length = 0;
    const laying = !!(ui && (ui.laying || ui.dragging));
    for (let y = 0; y < H; y++) {
      const row = g[y];
      if (!row) continue;
      for (let x = 0; x < W; x++) {
        const t = row[x];
        if (!t) continue;
        const i = y * W + x;

        // reveal front (A1): stamp the frame a tile first came into scan
        if (t.revealed) { if (mem.rev[i] === 0) { mem.rev[i] = F; mem.revStep = F; } }

        // rubble (A1): stamp the frame debris landed, clear when it is dug out
        if (t.rubble) { if (mem.rub[i] === 0) mem.rub[i] = F; }
        else if (mem.rub[i] !== 0) mem.rub[i] = 0;

        // belts (A1): item arrival stamps for the jam tell, departures for
        // the one-frame motion smear
        const b = t.belt;
        if (b) {
          const item = b.item || null;
          const prev = mem.item[i];
          if (item !== prev) {
            if (prev && !item) {
              const d = D.DIRS[b.dir] || D.DIRS[0];
              const nt = tileAt(run, x + d.dx, y + d.dy);
              // it left forward (onto a belt, into a machine or the hub) —
              // not destroyed under a quake
              if (nt && ((nt.belt && nt.belt.item === prev) || nt.machine !== null)) {
                smears.push({ x: x, y: y, item: prev });
              }
            }
            mem.item[i] = item;
            mem.itemT[i] = run.t;
          }
          if (!mem.belt[i]) {
            mem.belt[i] = 1;
            // comet tail (A1): belts laid during a drag / lay-mode gesture
            if (laying && !mem.first) {
              mem.tail.push({ x: x, y: y, f: F });
              if (mem.tail.length > 3) mem.tail.shift();
            }
          }
        } else if (mem.belt[i]) {
          mem.belt[i] = 0; mem.item[i] = null;
        }

        if (t.ore === 'crystal' && t.revealed) crystals.push(i);
      }
    }
    if (!laying && mem.tail.length) mem.tail.length = 0;
    mem.first = false;
  }

  // ------------------------------------------------------------- particles
  // Screen-space, cell-quantized, capped. Every particle carries the screen
  // it belongs to, so a moment left running when the screen changes simply
  // stops drawing and ages out.
  const parts = [];
  const PART_CAP = 96;

  function spawn(p) { if (parts.length < PART_CAP) parts.push(p); }
  function stepParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      if (--p.life <= 0) parts.splice(i, 1);
    }
  }
  function drawParts(surf, screen) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.screen !== screen) continue;
      const c = Math.round(p.x), r = Math.round(p.y);
      const k = p.clip;
      if (k && (c < k.x || c >= k.x + k.w || r < k.y || r >= k.y + k.h)) continue;
      if (p.behind && surf.ch(c, r) !== ' ') continue;   // drift behind the art
      surf.put(c, r, p.ch, p.col);
    }
  }
  // The map box: layout.map is its interior, the frame sits one cell around it.
  function mapBox(surf) {
    const L = surf && surf.layout && surf.layout.map;
    if (!L) return null;
    return { x: L.x, y: L.y, w: L.w, h: L.h, xo: L.xo || 0 };
  }

  // --------------------------------------------------------------- begin()
  // Called by render.js at the top of every frame, on every screen.
  let lastScreen = null;
  let crack = null;                      // {x, y, f} the breach crack pattern

  function begin(state, surf) {
    F++;
    stepParts();
    const run = state && state.run;
    const ui = (state && state.ui) || null;
    const screen = (state && state.screen) || '';
    screenEdge(screen, run, surf);
    if (!run || !run.grid) { mem = null; return; }
    if (!mem || mem.grid !== run.grid) mem = freshMem(run);
    mem.ui = ui;
    mem.accent = stratumOf(run.depth).accent || C.amber;
    const L = surf && surf.layout && surf.layout.map;
    mem.xo = L ? (L.xo || 0) : 0;
    if (screen !== 'run') return;        // the map rows only animate in-run

    scan(run, ui);
    quakeEdge(run, ui, surf);

    // drill state (A1 hub rows), computed once per frame the same way the
    // sidebar's feed readout does: gears first, then charges.
    const req = run.breachReq || { gear: 0, charge: 0 };
    const inv = run.inv || {};
    const running = run.status === 'active' || run.status === 'breachReady';
    mem.drillActive = !!(running &&
      (((run.gearsFed || 0) < req.gear && (inv.gear || 0) > 0) ||
       ((run.gearsFed || 0) >= req.gear && (run.chargesFed || 0) < req.charge &&
        (inv.charge || 0) > 0)));
    // the drill's own feed log (sim keeps a 10s window for the FEED readout):
    // its newest entry stamped this tick IS the feed tick.
    const feed = run._feed;
    mem.feeding = !!(feed && feed.length && feed[feed.length - 1].t === run.t);

    machineEdges(run);
    worldEdges(run);
  }

  // --- A2: the quake ------------------------------------------------------
  // Detecting a quake render-side, without consuming anything: the engine
  // drains run.events every tick, so the durable signal is ui.shakeUntil
  // rising. run.events is ALSO peeked (never spliced) so a constructed state
  // that still holds its queue fires too. Both paths dedupe on run.totalT, so
  // one quake is one burst of debris however it was seen.
  function quakeEdge(run, ui, surf) {
    let hit = false;
    const evs = run.events;
    if (evs) {
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i];
        if (e && e.type === 'quake' && e.t > mem.lastQuakeEv) { mem.lastQuakeEv = e.t; hit = true; }
      }
    }
    const su = (ui && ui.shakeUntil) || 0;
    if (su > mem.lastShake) { mem.lastShake = su; hit = true; }
    if (!hit || run.totalT === mem.debrisT) return;
    mem.debrisT = run.totalT;
    debrisRain(run, surf);
  }

  // ~12 grains of ceiling fall through the map box over 3 ticks
  const DEBRIS_CH = ['.', "'"];
  function debrisRain(run, surf) {
    const B = mapBox(surf);
    if (!B) return;
    const fall = 3 * (FPS / HZ);               // 3 ticks of falling
    for (let i = 0; i < 12; i++) {
      spawn({
        screen: 'run',
        x: B.x + B.xo + ((rand() * B.w) | 0),
        y: B.y - 1 + (rand() * 2),
        vx: 0, vy: B.h / fall,
        ch: DEBRIS_CH[(rand() * 2) | 0],
        col: rand() < 0.5 ? C.gray : C.darkgray,
        life: Math.round(fall),
        clip: { x: B.x, y: B.y, w: B.w, h: B.h },
      });
    }
  }

  // --- A2: the breach crack -----------------------------------------------
  // 'D' pressed hands the run straight to the descend screen, so the crack
  // is drawn on that screen's first 6 ticks, radiating from where the hub
  // was standing — then the descent animation takes over.
  const RAYS = [
    { dx: 0, dy: -1, ch: '│' }, { dx: 1, dy: -1, ch: '/' },
    { dx: 1, dy: 0, ch: '─' }, { dx: 1, dy: 1, ch: '\\' },
    { dx: 0, dy: 1, ch: '│' }, { dx: -1, dy: 1, ch: '/' },
    { dx: -1, dy: 0, ch: '─' }, { dx: -1, dy: -1, ch: '\\' },
  ];
  function screenEdge(screen, run, surf) {
    if (screen === lastScreen) return;
    const prev = lastScreen;
    lastScreen = screen;
    // Entering a screen restarts its typewriters: arriving at victory with
    // the toast GRIT happened to use last time must still type it out.
    for (const k in typers) delete typers[k];
    if (screen === 'descend' && prev === 'run' && run && run.hub) {
      const B = mapBox(surf);
      const x = B ? B.x + run.hub.x + 1 : (D.COLS / 2) | 0;
      const y = B ? B.y + run.hub.y + 1 : (D.ROWS / 2) | 0;
      // Kept inside the field the descent art occupies: the glass breaks
      // under the interstitial's header, never through it.
      crack = { x: U.clamp(x, 4, D.COLS - 5), y: U.clamp(y, CRACK_TOP + 2, D.ROWS - 4), f: F };
    }
  }
  const CRACK_TOP = 6;                         // first row the crack may touch
  function drawCrack(surf) {
    if (!crack) return;
    const age = F - crack.f;
    const span = 6 * (FPS / HZ);               // 6 ticks of white glass
    if (age > span) { crack = null; return; }
    const reach = 1 + Math.floor((age / span) * 9);
    for (let i = 0; i < RAYS.length; i++) {
      const R = RAYS[i];
      for (let d = 1; d <= reach; d++) {
        const c = crack.x + R.dx * d, r = crack.y + R.dy * d;
        if (c < 0 || c >= D.COLS || r < CRACK_TOP || r >= D.ROWS) break;
        surf.put(c, r, R.ch, d === reach ? C.white : mixOf(C.white, C.amber, 0.5));
      }
    }
  }

  // Machine-level edges: the extractor "spit", assembler recipe switches.
  function machineEdges(run) {
    for (const id in mem.spit) if (run.t - mem.spit[id].t >= 2) delete mem.spit[id];
    const ms = run.machines;
    for (const id in ms) {
      const m = ms[id];
      if (!m || m.id === 0) continue;
      if (m.type === 'extractor') {
        const p = mem.prog[id] || 0;
        // progress resets to 0 on the tick an ore is produced
        if (m.progress < p && p > 0) {
          const o = outputTile(m);
          mem.spit[id] = { x: o.x, y: o.y, t: run.t };
        }
        mem.prog[id] = m.progress;
      } else if (m.type === 'assembler') {
        const r = m.recipe || null;
        if (mem.recipe[id] !== undefined && mem.recipe[id] !== r) mem.spin[id] = F;
        mem.recipe[id] = r;
      }
    }
  }

  // World-level edges driven off the sim's own cadences (no sim edits): the
  // magma burn tick, and the crystal glint timer.
  function worldEdges(run) {
    const sparks = mem.sparks;
    if (sparks.length && run.t !== sparks[0].t) sparks.length = 0;
    if (run.magmaCap > 0 && run.t > 0 && run.t % D.MAGMA.burnPeriod === 0 &&
        !sparks.length) {
      const ms = run.machines;
      for (const id in ms) {
        const m = ms[id];
        if (!m) continue;
        for (let y = m.y; y < m.y + m.h; y++) {
          for (let x = m.x; x < m.x + m.w; x++) {
            for (let k = 0; k < 4; k++) {
              const d = D.DIRS[k];
              const nt = tileAt(run, x + d.dx, y + d.dy);
              if (nt && nt.t === 'magma') sparks.push({ x: x, y: y, t: run.t });
            }
          }
        }
      }
    }
    // one visible crystal glints white for ~1 tick every ~4s
    if (F % (4 * FPS) === 0 && mem.crystals.length) {
      const i = mem.crystals[(rand() * mem.crystals.length) | 0];
      mem.glint = { i: i, until: F + Math.round(FPS / HZ) };
    }
  }

  function outputTile(m) {
    if (m.facing === 0) return { x: m.x + ((m.w - 1) >> 1), y: m.y - 1 };
    if (m.facing === 1) return { x: m.x + m.w, y: m.y + ((m.h - 1) >> 1) };
    if (m.facing === 2) return { x: m.x + ((m.w - 1) >> 1), y: m.y + m.h };
    return { x: m.x - 1, y: m.y + ((m.h - 1) >> 1) };
  }

  // ---------------------------------------------------------------- tile()
  // Per-map-cell choreography (table A1). render.js calls this with the glyph
  // and color it was about to draw; returning [ch, fg] overrides them.
  // The array is reused — render reads it immediately, and never keeps it.
  const OUT = ['', ''];
  function out(ch, fg) { OUT[0] = ch; OUT[1] = fg; return OUT; }

  function tile(run, t, x, y, ch, fg) {
    if (!mem || mem.grid !== run.grid) return null;
    // the status '!' marker (nofuel/blocked/depleted) always stays on top
    if (ch === '!') return null;

    // magma eating a machine: a one-tick spark at the contact edge, over
    // whatever that cell was drawing
    const sparks = mem.sparks;
    for (let k = 0; k < sparks.length; k++) {
      if (sparks[k].x === x && sparks[k].y === y && sparks[k].t === run.t) {
        return out('*', C.magmaHot);
      }
    }

    let r = null;
    if (t.machine === 0) {
      r = hubCell(run, x, y, ch, fg);
    } else if (t.machine !== null && t.machine !== undefined) {
      r = machineCell(run, t, x, y, ch, fg);
    } else if (t.belt) {
      r = beltCell(run, t, x, y, ch, fg);
    } else {
      r = worldCell(run, t, x, y, ch, fg);
    }
    return revealFront(x, y, r, ch, fg);
  }

  // --- A1: the reveal front ------------------------------------------------
  // The sonar made visible, on top of whatever the tile is: the instant a
  // tile enters scan it pulses as a faint '·' ring, then holds one shade
  // brighter for 2s while the front moves on.
  const RING_FRAMES = 8;
  function revealFront(x, y, r, ch, fg) {
    const st = mem.rev[y * W + x];
    if (!st) return r;
    const age = F - st;
    if (age > 2 * FPS) return r;
    if (age < RING_FRAMES) return out('·', shadeOf(C.cyan, 0.55));
    const cch = r ? r[0] : ch, cfg = r ? r[1] : fg;
    return out(cch, mixOf(cfg, C.white, 0.3));
  }

  // --- A1: the world -------------------------------------------------------
  const DIG_CH = ['▓', '▒', '░', '·'];        // the excavation wipe
  const MAGMA_CH = ['≈', '~'];
  const MAGMA_COL = [C.magma, C.magmaHot, '#d8451f'];   // 3-color ember cycle

  function worldCell(run, t, x, y, ch, fg) {
    const i = y * W + x;
    // an excavation in progress wipes ▓▒░· down to bare floor
    if (t.digT > 0) {
      const total = t.t === 'rock' ? D.DIG_ROCK : D.DIG_RUBBLE;
      const done = 1 - U.clamp(t.digT / total, 0, 1);
      return out(DIG_CH[U.clamp(Math.floor(done * 4), 0, 3)], C.gray);
    }
    // debris that lands: rubble jitters for 2s, then settles still
    if (t.rubble) {
      const st = mem.rub[i];
      if (st && F - st < 2 * FPS) {
        return out((((F / 6) | 0) & 1) ? '%' : D.RUBBLE_GLYPH, C.gray);
      }
      return null;
    }
    if (t.t === 'magma') {
      const off = (x * 7 + y * 13) % 3;       // per-tile phase: it breathes
      const p4 = (F / (FPS / 4)) | 0;
      return out(MAGMA_CH[(p4 + off) & 1], MAGMA_COL[(p4 + off) % 3]);
    }
    if (t.t === 'chasm') {
      // depth shimmer: dim/dimmer, offset down the column
      const p = ((((F / 30) | 0) + y) & 1);
      const base = D.TERRAIN.chasm.color;
      return out(ch, p ? shadeOf(base, 0.6) : base);
    }
    if (t.ore === 'crystal' && mem.glint && mem.glint.i === i && F < mem.glint.until) {
      return out(ch, C.white);                // one crystal catches the light
    }
    return null;
  }

  // --- A1: machines --------------------------------------------------------
  // The incoming fg already carries render's own tells (the chromed schematic
  // letter, the damaged-machine red blink), so a row that only changes the
  // GLYPH passes fg straight back through and both tells survive.
  const FIRE_CH = ['▓', '▒', '░'];
  const FIRE_COL = [C.magma, C.orange, C.amber];   // magma -> orange -> amber
  const GEAR_CH = ['¤', '☼', '¤', '☼'];
  const PUMP_CH = ['E', '╪', 'E', '╫'];            // piston stroke, 4 fps

  function machineCell(run, t, x, y, ch, fg) {
    const m = run.machines[t.machine];
    if (!m) return null;
    const anchor = x === m.x && y === m.y;
    const k = (x - m.x) + (y - m.y) * m.w;         // index within the footprint
    const p4 = (F / (FPS / 4)) | 0;                // 4 fps phase
    const p8 = (F / (FPS / 8)) | 0;                // 8 fps phase
    if (m.type === 'extractor') {
      if (m.status === 'depleted') {
        // a dead pump: dim gray, and every other phase shows the cross
        return out((p4 & 1) ? '×' : ch, shadeOf(C.gray, 0.8));
      }
      if (m.status === 'ok') return out(PUMP_CH[p4 & 3], fg);
      return null;
    }
    if (m.type === 'smelter') {
      if (anchor) return null;                     // the S anchor stays steady
      if (m.job) {
        const i = (p8 + k) % 3;                    // phase-offset: the furnace rolls
        return out(FIRE_CH[i], FIRE_COL[i]);
      }
      if (m.status === 'nofuel') return out('░', C.darkgray);   // gone cold
      return null;
    }
    if (m.type === 'assembler') {
      if (anchor) return null;
      const sw = mem.spin[m.id];
      if (sw && F - sw < FPS / 2) {                // recipe switch acknowledgment
        return out(GEAR_CH[((F >> 1) + k) & 3], C.white);
      }
      if (m.job) return out(GEAR_CH[(p8 + k) & 3], fg);
      return null;
    }
    if (m.type === 'damper') {
      // fueled: a calm ~2s heartbeat. unfueled: flat dim (render's '!' blink
      // is left alone by the guard at the top of tile()).
      const g = D.BUILDINGS.damper.color;
      if (m.fuel > 0) return out(ch, mixOf(shadeOf(g, 0.35), g, breathe(2 * FPS)));
      return out(ch, shadeOf(g, 0.4));
    }
    return null;
  }

  // --- A1: the hub ---------------------------------------------------------
  // Ring index of each 3x3 cell, clockwise from the top-left, by dy*3+dx.
  // The center (the 'D') is -1: it answers to the drill, not to the ring.
  const RING_IDX = [0, 1, 2, 7, -1, 3, 6, 5, 4];

  function hubCell(run, x, y, ch, fg) {
    const dx = x - run.hub.x, dy = y - run.hub.y;
    if (dx < 0 || dx > 2 || dy < 0 || dy > 2) return null;
    const ready = run.status === 'breachReady';
    // breachReady: the bottom edge turns into an invitation to press D
    const och = (ready && dy === 2) ? '▼' : ch;

    if (dx === 1 && dy === 1) {
      if (mem.feeding) return out(och, C.white);      // pulse on the feed tick
      if (ready) return out(och, mixOf(mem.accent, C.white, breathe(90)));
      return null;                                     // render's own D handling
    }
    const idx = RING_IDX[dy * 3 + dx];
    // distress beats everything: erratic, not rhythmic — a hash of the frame,
    // so it is repeatable under test and reads as panic on screen
    if (run.integrity < 25) {
      const h = hash(F * 8 + idx);
      return out(och, h < 0.3 ? C.red : shadeOf(C.red, 0.4 + 0.35 * h));
    }
    if (ready) {
      // the whole 3x3 pulses in the stratum accent; the bottom row sweeps
      const k = dy === 2 ? breathe(45, dx * 15) : breathe(90, idx * 6);
      return out(och, mixOf(mem.accent, C.white, k * 0.8));
    }
    if (mem.drillActive) {
      // marching ants, clockwise, twice as fast on overdrive
      const step = (F / (run.overdrive ? 3 : 6)) | 0;
      const d = ((step - idx) % 8 + 8) % 8;
      if (d === 0) return out(och, C.white);
      if (d === 1) return out(och, mixOf(C.amber, C.white, 0.45));
      return out(och, shadeOf(C.amber, 0.7));
    }
    return null;
  }

  // --- A1: belts -----------------------------------------------------------
  // Empty belt: the arrow dim-pulses on a 3-step brightness ramp so the whole
  // network visibly flows even with nothing on it. The phase is SPEC's
  // (x + y + tick>>1) % 3; the tick term's SIGN is chosen per direction so the
  // wave marches DOWNSTREAM (the other half of the same acceptance row) —
  // with a fixed sign an eastbound belt would visibly flow backwards.
  const BELT_RAMP = [0.42, 0.62, 0.95];

  function beltCell(run, t, x, y, ch, fg) {
    const b = t.belt;
    const i = y * W + x;
    // the comet tail on a lay gesture: the last 3 belts you put down stay
    // bright, newest brightest, so the line you are drawing reads as a stroke
    const tail = mem.tail;
    for (let k = 0; k < tail.length; k++) {
      if (tail[k].x === x && tail[k].y === y) {
        const age = tail.length - 1 - k;      // 0 = the one just laid
        return out(ch, mixOf(C.cyan, C.white, 0.8 - age * 0.25));
      }
    }
    if (b.item) {
      // "the spit": for 2 ticks after an extractor produces, the ore sitting
      // on its output tile renders bright white — you see the machine WORK.
      const sp = mem.spit;
      for (const id in sp) {
        const s = sp[id];
        if (s.x === x && s.y === y && run.t - s.t < 2) return out(ch, C.white);
      }
      // jam tell: an item that has not moved in 2s shivers between its color
      // and dim — pressure you can see before the machine reports 'blocked'.
      const held = run.t - mem.itemT[i];
      if (held >= 2 * HZ && (((F / 8) | 0) & 1)) return out(ch, shadeOf(fg, 0.45));
      return null;
    }
    const d = D.DIRS[b.dir] || D.DIRS[1];
    const sgn = (d.dx + d.dy) > 0 ? -1 : 1;
    let p = (x + y + sgn * (run.t >> 1)) % 3;
    if (p < 0) p += 3;
    return out(ch, shadeOf(C.cyan, BELT_RAMP[p]));
  }

  // --------------------------------------------------------------- overlay
  // Screen-space moments and particles (table A2). Drawn LAST, after every
  // screen has finished — nothing else paints over it.
  function frame(state, surf) {
    if (!surf) return;
    const screen = (state && state.screen) || '';
    const run = state && state.run;
    if (run && mem && mem.grid === run.grid && screen === 'run') {
      drawSmears(run, surf);
      drawDread(run, surf);
      drawBorder(run, surf);
      drawEmber(run, surf);
    }
    if (screen === 'title') drawTitle(state, surf);
    if (screen === 'descend') drawCrack(surf);
    if (screen === 'foundry') foundrySparks(state, surf);
    if (screen === 'victory') drawCore(surf);
    if (screen === 'gameover') drawMotes(surf);
    if (screen === 'run') drawSmoke(state, surf);
    drawParts(surf, screen);
  }

  // --- A2: the foundry spark burst -----------------------------------------
  // The part is already blinking white (render, v1.1 §C.2); this is the
  // wrench landing on it. Keyed on ui.flashPart identity, exactly as render
  // keys its blink, so one purchase is one burst.
  let flashRef = null;
  function foundrySparks(state, surf) {
    const fp = state.ui && state.ui.flashPart;
    if (!fp || !fp.id) { flashRef = null; return; }
    if (flashRef === fp) return;
    flashRef = fp;
    const L = surf.layout && surf.layout.foundryRig;
    const p = DC.Art && DC.Art.rigParts && DC.Art.rigParts[fp.id];
    if (!L) return;
    const px = L.x + (p ? (p.col || 0) : (L.w >> 1));
    const py = L.y + (p ? (p.row || 0) : (L.h >> 1));
    const pw = p && p.lines ? p.lines[0].length : 3;
    const ph = p && p.lines ? p.lines.length : 1;
    const n = 5 + ((rand() * 3) | 0);              // 5-7 sparks
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      spawn({
        screen: 'foundry',
        x: px + rand() * pw, y: py + rand() * ph,
        vx: Math.cos(a) * 0.06, vy: Math.sin(a) * 0.04,
        ch: rand() < 0.5 ? '*' : "'",
        col: rand() < 0.5 ? C.white : C.amber,
        life: Math.round(1.2 * FPS),
      });
    }
  }

  // --- A2: the core pulses, then rings on GRIT's last character ------------
  // The victory art is a shading function of distance from the sphere center;
  // this gives that function a phase, and the toast's final character sends
  // one bright ring out through it.
  const CORE_RAMP = [C.magmaHot, C.magma, C.orange, C.amber];
  function drawCore(surf) {
    const A = surf.layout && surf.layout.artBlock;
    if (!A) return;
    const cy = A.row + (A.h >> 1), cx = (D.COLS / 2) | 0;
    const rx = 28, ry = A.h / 2;
    const ph = (F / 24) | 0;
    const done = typedDone('toast');
    const ring = done ? (F - done) / 40 : -1;      // expands over ~0.7s
    for (let r = A.row; r < A.row + A.h && r < D.ROWS; r++) {
      for (let c = 0; c < D.COLS; c++) {
        if (surf.ch(c, r) === ' ') continue;
        const dx = (c - cx) / rx, dy = (r - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (ring >= 0 && ring <= 1.4 && Math.abs(d - ring) < 0.09) {
          surf.put(c, r, surf.ch(c, r), C.white);
          continue;
        }
        surf.put(c, r, surf.ch(c, r), CORE_RAMP[(Math.floor(d * 4) + ph) & 3]);
      }
    }
  }

  // --- A2: dust settling over the collapsed rig ----------------------------
  function drawMotes(surf) {
    const A = surf.layout && surf.layout.artBlock;
    if (F % 12) return;
    const top = A ? A.row : 1, h = A ? A.h : 14;
    spawn({
      screen: 'gameover',
      x: 6 + rand() * (D.COLS - 12), y: top,
      vx: 0, vy: 0.06 + rand() * 0.05,
      ch: '·', col: C.darkgray,
      life: Math.round((h + 4) / 0.08),
      clip: { x: 0, y: top, w: D.COLS, h: h + 4 },
    });
  }

  // --- A2: GRIT's smoke break ----------------------------------------------
  // Pause for more than 30s and smoke curls in from the bottom-left corner,
  // one cell per 5s, capped at 30 — right where his tag sits.
  let pauseF0 = 0;
  function drawSmoke(state, surf) {
    const paused = !!(state.ui && state.ui.paused);
    if (!paused) { pauseF0 = 0; return; }
    if (!pauseF0) { pauseF0 = F; return; }
    const held = F - pauseF0;
    if (held < 30 * FPS) return;
    const n = Math.min(30, 1 + Math.floor((held - 30 * FPS) / (5 * FPS)));
    for (let k = 0; k < n; k++) {
      const c = Math.round(k * 0.7 + hash(k * 13) * 2);
      const r = D.ROWS - 1 - Math.round(k * 0.55 + hash(k * 29) * 2);
      if (c < 0 || c >= D.COLS || r < 0 || r >= D.ROWS) continue;
      surf.put(c, r, '░', k > n - 4 ? C.gray : shadeOf(C.gray, 0.55));
    }
  }

  // --- A2: typewriters and the depth odometer ------------------------------
  // Keyed by call site. A changed string restarts the reveal, so a screen can
  // ask for the same key every frame without owning any state itself.
  const typers = Object.create(null);
  function typed(key, str, cps) {
    let e = typers[key];
    if (!e || e.str !== str) { e = typers[key] = { str: str, f0: F, done: 0 }; }
    const n = Math.floor(((F - e.f0) * (cps || 20)) / FPS);
    if (n >= str.length && !e.done) e.done = F;
    return n >= str.length ? str : str.slice(0, Math.max(0, n));
  }
  // The frame a `typed` key finished, or 0 while it is still running.
  function typedDone(key) {
    const e = typers[key];
    return e ? e.done : 0;
  }
  // Digits settle left to right; the rest roll through randoms at ~10 fps.
  function odometer(key, value, prog) {
    const s = String(Math.round(value));
    const settled = Math.floor(U.clamp(prog, 0, 1) * (s.length + 0.5));
    let o = '';
    for (let i = 0; i < s.length; i++) {
      o += i < settled ? s[i]
        : String(Math.floor(hash(((F / 6) | 0) * 131 + i * 17 + s.length) * 10) % 10);
    }
    return o;
  }

  // --- A2: the title screen ------------------------------------------------
  // Slow embers rise behind the rig, the drill string idles, PRESS ENTER
  // breathes. The logo's 3-tone sweep is render's and is left alone.
  const EMBER_COL = [C.amber, C.orange, '#ff7a45'];
  function drawTitle(state, surf) {
    if (F % 18 === 0) {
      spawn({
        screen: 'title',
        x: 8 + rand() * (D.COLS - 16), y: D.ROWS - 3,
        vx: (rand() - 0.5) * 0.05, vy: -0.11,
        ch: rand() < 0.5 ? '.' : '·',
        col: EMBER_COL[(rand() * 3) | 0],
        life: 170, behind: true,                 // they rise BEHIND the rig
      });
    }
    const T = surf.layout && surf.layout.title;
    if (!T) return;
    if (T.rig) {
      // the drill string below the wellhead churns on a 2-frame swap, offset
      // per row so the pipe reads as turning rather than blinking
      for (let r = 8; r < T.rig.h; r++) {
        for (let c = 0; c < T.rig.w; c++) {
          const gc = T.rig.x + c, gr = T.rig.y + r;
          if (surf.ch(gc, gr) !== '║') continue;
          if (((((F / 8) | 0) + r) & 1)) surf.put(gc, gr, '╫', surf.fg(gc, gr));
        }
      }
    }
    if (T.enter) {
      const k = 0.45 + 0.55 * breathe(1.6 * FPS);
      for (let i = 0; i < T.enter.len; i++) {
        const gc = T.enter.col + i;
        surf.put(gc, T.enter.row, surf.ch(gc, T.enter.row), mixOf(C.green, C.white, k));
      }
    }
  }

  // --- A2: the lights flicker before the hit -------------------------------
  // At terminal instability the map dims one step for the 2 ticks before each
  // scheduled collapse quake. Read straight off run.quakeAt — the sim already
  // knows when the next one lands, so dread costs nothing but a shade.
  function drawDread(run, surf) {
    if ((run.instability || 0) < 99) return;
    const dt = (run.quakeAt || 0) - run.t;
    if (!run.quakeAt || dt < 0 || dt > 2) return;
    const B = mapBox(surf);
    if (!B) return;
    for (let r = B.y; r < B.y + B.h; r++) {
      for (let c = B.x; c < B.x + B.w; c++) {
        const f = surf.fg(c, r);
        if (f) surf.put(c, r, surf.ch(c, r), shadeOf(f, 0.55));
      }
    }
  }

  // --- A2: the map border breathes red at high instability -----------------
  function drawBorder(run, surf) {
    const inst = run.instability || 0;
    if (inst < 80) return;
    const B = mapBox(surf);
    if (!B) return;
    const x0 = B.x - 1, y0 = B.y - 1, w = B.w + 2, h = B.h + 2;
    const k = 0.35 + 0.5 * breathe(2 * FPS);           // ~2s period
    for (let c = x0; c < x0 + w; c++) {
      tintCell(surf, c, y0, k); tintCell(surf, c, y0 + h - 1, k);
    }
    for (let r = y0 + 1; r < y0 + h - 1; r++) {
      tintCell(surf, x0, r, k); tintCell(surf, x0 + w - 1, r, k);
    }
  }
  function tintCell(surf, c, r, k) {
    const f = surf.fg(c, r);
    if (f) surf.put(c, r, surf.ch(c, r), mixOf(f, C.red, k));
  }

  // --- A1: GRIT's cigarette ------------------------------------------------
  // An ember after the 'GRIT ▸' tag, glowing while he talks. render draws the
  // tag in cols 0..5 and the line from col 7, so col 6 is his cigarette.
  // "Priority bark" is read off the run, not off the bark: GRIT flickers fast
  // exactly when the situation is one of Barks' priority triggers.
  function drawEmber(run, surf) {
    const f = run.foreman;
    if (!f || !f.text) return;
    if (run.totalT > (f.until || 0) + 2 * HZ) return;   // the bar has faded out
    const agitated = run.status === 'breachReady' || run.status === 'dead' ||
      run.status === 'won' || (run.instability || 0) >= 99;
    const on = agitated ? ((((F / 4) | 0) & 1) === 0) : breathe(90) > 0.45;
    surf.put(6, 31, '°', on ? C.orange : shadeOf(C.orange, 0.4));
  }

  // --- A1: the one-frame motion smear (drawn as an overlay so it survives
  // the belt/terrain glyph that has already been painted at the departed
  // cell) — a departing item leaves a bright ghost for exactly one frame.
  function drawSmears(run, surf) {
    const L = surf.layout && surf.layout.map;
    if (!L) return;
    for (let k = 0; k < mem.smears.length; k++) {
      const s = mem.smears[k];
      const it = D.ITEMS[s.item];
      if (!it) continue;
      const gc = L.x + s.x + mem.xo, gr = L.y + s.y;
      if (gc < L.x || gc >= L.x + L.w) continue;
      surf.put(gc, gr, it.glyph, surf.mix(it.color, C.white, 0.65));
    }
  }

  // ---------------------------------------------------------------- shared
  let SURF = null;                        // set by render on first begin()
  function shadeOf(hex, f) { return SURF ? SURF.shade(hex, f) : hex; }
  function mixOf(a, b, t) { return SURF ? SURF.mix(a, b, t) : a; }

  DC.FX = {
    FPS: FPS,
    // render.js hooks
    begin: function (state, surf) { SURF = surf || SURF; begin(state, surf); },
    tile: tile,
    frame: frame,
    typed: typed,
    odometer: odometer,
    // test surface: the clock and the per-stratum scratch are inspectable so
    // a stub-canvas frame-advance test can prove each A1/A2 row fires.
    clock: function () { return F; },
    mem: function () { return mem; },
  };
})();
