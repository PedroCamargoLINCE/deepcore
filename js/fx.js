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

  // --------------------------------------------------------------- begin()
  // Called by render.js at the top of every frame, on every screen.
  function begin(state, surf) {
    F++;
    const run = state && state.run;
    const ui = (state && state.ui) || null;
    if (!run || !run.grid) { mem = null; return; }
    if (!mem || mem.grid !== run.grid) mem = freshMem(run);
    mem.ui = ui;
    mem.accent = stratumOf(run.depth).accent || C.amber;
    const L = surf && surf.layout && surf.layout.map;
    mem.xo = L ? (L.xo || 0) : 0;

    scan(run, ui);

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

    let r = null;
    if (t.machine === 0) {
      r = hubCell(run, x, y, ch, fg);
    } else if (t.machine !== null && t.machine !== undefined) {
      r = machineCell(run, t, x, y, ch, fg);
    } else if (t.belt && t.machine === null) {
      r = beltCell(run, t, x, y, ch, fg);
    }
    return r;
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
    const run = state && state.run;
    if (run && mem && mem.grid === run.grid && state.screen === 'run') {
      drawSmears(run, surf);
    }
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
    // test surface: the clock and the per-stratum scratch are inspectable so
    // a stub-canvas frame-advance test can prove each A1/A2 row fires.
    clock: function () { return F; },
    mem: function () { return mem; },
  };
})();
