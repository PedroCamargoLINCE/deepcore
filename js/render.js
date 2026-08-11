/* DEEPCORE — render.js
   Canvas character-grid renderer. Pure view of DC.state: no game logic, no
   input handling. Tooltip/scan text comes from DC.Sim.describeTile.
   Defensive about DC.Art (written in parallel): any missing asset renders a
   placeholder frame instead of crashing. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA;
  const C = D.COLORS;
  const U = DC.util;

  const COLS = D.COLS, ROWS = D.ROWS;
  const CW = 10, CH = 19;
  const FONT = '16px "DejaVu Sans Mono", "Cascadia Mono", Consolas, "Courier New", monospace';
  const UNREV_BG = '#050504';        // near-black for unrevealed tiles (SPEC §7)
  const SB = 49, SBW = 31;           // sidebar box: cols 49..79
  const SBC = 50, SCW = 29;          // sidebar content col + width
  // Tallest one LOG message may grow to once word-wrapped into SCW columns.
  // 3 rows holds the longest mirrored GRIT bark (75 chars with its tag) whole;
  // anything longer ends in '…' on a word boundary. The panel has 9 rows.
  const LOG_MSG_ROWS = 3;
  const LETTERS = 'abcdefghi';
  const HUB_ART = ['╔═╗', '║D║', '╚═╝'];
  const EMBER = '#ff7a45';           // v1.1 §E title sweep endpoint (stratum-6 ember)

  // v1.1 §C.2 — compact sidebar glyph per owned meta upgrade: [glyph, color key]
  const UP_GLYPHS = {
    m_hull:   ['▐', 'steel'],
    m_damp:   ['◎', 'green'],
    m_torque: ['▼', 'amber'],
    m_scan:   ['╦', 'cyan'],
    m_salv:   ['⌐', 'orange'],
    m_stock:  ['▣', 'gray'],
    m_deep:   ['♦', 'magenta'],
    m_fix:    ['┼', 'white'],
    m_schem:  ['≡', 'blue'],
  };

  let canvas = null, ctx = null, dpr = 1, adv = CW; // adv = measured glyph advance
  let frameN = 0;

  // ---------------- cell buffer ----------------
  const chB = [], fgB = [], bgB = [];
  for (let r = 0; r < ROWS; r++) {
    chB.push(new Array(COLS).fill(' '));
    fgB.push(new Array(COLS).fill(null));
    bgB.push(new Array(COLS).fill(null));
  }
  function clearBuf() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) { chB[r][c] = ' '; fgB[r][c] = null; bgB[r][c] = null; }
    }
  }
  function put(col, row, ch, fg, bg) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    chB[row][col] = ch;
    fgB[row][col] = fg || C.gray;
    if (bg !== undefined) bgB[row][col] = bg;
  }
  function text(col, row, str, fg, bg) {
    str = String(str);
    for (let i = 0; i < str.length; i++) put(col + i, row, str[i], fg, bg);
  }
  function textR(rightCol, row, str, fg, bg) {  // right-aligned, last char at rightCol
    str = String(str);
    text(rightCol - str.length + 1, row, str, fg, bg);
  }
  function ctext(row, str, fg, bg) {
    str = String(str);
    text(Math.max(0, (COLS - str.length) >> 1), row, str, fg, bg);
  }
  function invertCell(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    const f = fgB[row][col];
    if (chB[row][col] === ' ' || !f) { bgB[row][col] = C.amberDim; fgB[row][col] = C.bg; }
    else { bgB[row][col] = f; fgB[row][col] = C.bg; }
  }

  // ---------------- color helpers ----------------
  const colCache = Object.create(null);
  function hx(n) { n = U.clamp(Math.round(n), 0, 255); return (n < 16 ? '0' : '') + n.toString(16); }
  function shade(hex, f) {  // darken/lighten a #rrggbb by factor f
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const k = hex + '*' + f;
    if (colCache[k]) return colCache[k];
    const v = '#' + hx(parseInt(hex.slice(1, 3), 16) * f)
                  + hx(parseInt(hex.slice(3, 5), 16) * f)
                  + hx(parseInt(hex.slice(5, 7), 16) * f);
    colCache[k] = v;
    return v;
  }
  function mix(a, b, t) {  // a→b linear mix, t in 0..1
    if (!a || a[0] !== '#' || a.length !== 7 || !b || b[0] !== '#' || b.length !== 7) return a;
    const k = a + '~' + b + '~' + t;
    if (colCache[k]) return colCache[k];
    let v = '#';
    for (let i = 1; i < 7; i += 2) {
      v += hx(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t);
    }
    colCache[k] = v;
    return v;
  }
  function resolveColor(c) { return c ? (C[c] || c) : null; }

  // ---------------- drawing primitives ----------------
  function box(col, row, w, h, color, title, titleColor) {
    const horiz = '─'.repeat(Math.max(0, w - 2));
    text(col, row, '┌' + horiz + '┐', color);
    for (let r = row + 1; r < row + h - 1; r++) { put(col, r, '│', color); put(col + w - 1, r, '│', color); }
    text(col, row + h - 1, '└' + horiz + '┘', color);
    if (title) text(col + 2, row, (' ' + title + ' ').slice(0, Math.max(0, w - 4)), titleColor || color);
  }
  function bar(col, row, width, frac, color) {
    frac = U.clamp(frac || 0, 0, 1);
    const n = Math.round(frac * width);
    if (n > 0) text(col, row, '█'.repeat(n), color);
    if (n < width) text(col + n, row, '░'.repeat(width - n), C.darkgray);
  }
  function wrap(str, w) {
    const out = [];
    const words = String(str || '').split(/\s+/).filter(Boolean);
    let line = '';
    for (const wd of words) {
      if (!line.length) line = wd;
      else if (line.length + 1 + wd.length <= w) line += ' ' + wd;
      else { out.push(line); line = wd; }
    }
    if (line) out.push(line);
    return out;
  }
  // wrap(), but never taller than `rows`. What does not fit ends in '…' placed
  // on a WORD boundary — CX-04's rule ("shorten to fit rather than clip") for
  // the two panels that carry authored prose: the LOG and the Foreman bar.
  function wrapClamp(str, w, rows) {
    const out = wrap(str, w);
    if (out.length <= rows) return out;
    const keep = out.slice(0, rows);
    let last = keep[rows - 1];
    if (last.length >= w) {                    // make room for the ellipsis
      const cut = last.lastIndexOf(' ');
      last = cut > 0 ? last.slice(0, cut) : last.slice(0, w - 1);
    }
    keep[rows - 1] = last + '…';
    return keep;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  // Split delta, compact: seconds under a minute, m:ss past it.
  function fmtDelta(sec) {
    const a = Math.abs(Math.round(sec || 0));
    return a < 60 ? a + 's' : fmtTime(a);
  }
  // The ghost you are racing (M-RECAP): your best time in THIS stratum, from
  // the meta save. 0 / missing = no record yet, and the row is not drawn.
  function ghostSplit(run, meta) {
    const splits = meta && meta.bestSplits;
    const best = splits && splits[String(run.depth)];
    if (!(typeof best === 'number' && isFinite(best) && best > 0)) return null;
    const delta = best - (run.t || 0) / D.TICK_HZ;
    return { best: best, delta: delta, mark: delta >= 0 ? '▲' : '▼' };
  }

  // ---------------- art access (defensive) ----------------
  function placeholder(name) {
    const inner = ' ' + name + ' ';
    const h = '─'.repeat(inner.length);
    return ['┌' + h + '┐', '│' + inner + '│', '└' + h + '┘'];
  }
  function art(name) {
    const A = DC.Art;
    if (A && Array.isArray(A[name]) && A[name].length && typeof A[name][0] === 'string') return A[name];
    return placeholder(name);
  }
  function artFrames() {
    const A = DC.Art;
    if (A && Array.isArray(A.descent) && A.descent.length && Array.isArray(A.descent[0])) return A.descent;
    return [placeholder('descent')];
  }
  function artColor(name, fb) {
    const A = DC.Art;
    const k = A && A.color && A.color[name];
    return resolveColor(k) || fb || C.amber;
  }
  function drawArt(lines, row, color) {
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      text(Math.max(0, (COLS - ln.length) >> 1), row + i, ln, color);
    }
  }
  // Uniform left margin for the whole block (keeps internal alignment intact).
  function blockWidth(lines) {
    let w = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].length > w) w = lines[i].length;
    return w;
  }
  function blockX(lines, width) { return Math.max(0, (width - blockWidth(lines)) >> 1); }

  // ---------------- v1.1 rig portrait / schematic art (defensive) ----------------
  function composeRigSafe(upgrades) {
    const A = DC.Art;
    try {
      if (A && typeof A.composeRig === 'function') {
        const l = A.composeRig(upgrades || {});
        if (Array.isArray(l) && l.length && typeof l[0] === 'string') return l;
      }
    } catch (e) { /* art in flux */ }
    return null;
  }
  function schemBadge(id) {
    const A = DC.Art;
    const b = A && A.schemBadges && A.schemBadges[id];
    if (typeof b === 'string' && b.length) return (b + ' ').slice(0, 2);
    return String(id || '??').slice(2, 4).toUpperCase() || '??';
  }
  function schemColor(id, fb) {
    const A = DC.Art;
    return resolveColor(A && A.schemColors && A.schemColors[id]) || fb || C.cyan;
  }

  // ui.flashPart = {id, until} (engine sets on Foundry purchase). Expiry is
  // tracked locally by object identity so the clock unit `until` uses doesn't
  // matter: a fresh flashPart blinks its overlay white for ~1.2 s of frames.
  let flashRef = null, flashF0 = 0;
  function activeFlash(ui) {
    const fp = ui && ui.flashPart;
    if (!fp || !fp.id) { flashRef = null; return null; }
    if (flashRef !== fp) { flashRef = fp; flashF0 = frameN; }
    if (frameN - flashF0 > 72) return null;              // ~1.2 s at 60 fps
    return { id: fp.id, on: ((frameN >> 2) & 1) === 0 }; // ~7.5 Hz blink
  }

  // Barks epitaph/toast may consume run.rng — cache per run object so a
  // per-frame redraw never re-rolls (and stays a no-op without js/barks.js).
  let epiRun = null, epiLines = [], toastRun = null, toastLine = '';
  function epitaphSafe(run) {
    if (!run || !DC.Barks || typeof DC.Barks.epitaph !== 'function') return [];
    if (epiRun === run) return epiLines;
    let l = [];
    try { l = DC.Barks.epitaph(run) || []; } catch (e) {}
    if (typeof l === 'string') l = [l];
    epiRun = run;
    epiLines = Array.isArray(l) ? l.slice(0, 2).map(String) : [];
    return epiLines;
  }
  function toastSafe(run) {
    if (!run || !DC.Barks || typeof DC.Barks.toast !== 'function') return '';
    if (toastRun === run) return toastLine;
    let l = '';
    try { l = DC.Barks.toast(run) || ''; } catch (e) {}
    toastRun = run;
    toastLine = typeof l === 'string' ? l : '';
    return toastLine;
  }

  // ---------------- safe Sim queries (parallel-dev guards) ----------------
  function canPlaceSafe(run, type, x, y, facing) {
    try {
      if (DC.Sim && DC.Sim.canPlace) return !!DC.Sim.canPlace(run, type, x, y, facing).ok;
    } catch (e) { /* sim in flux */ }
    return false;
  }
  function describeSafe(run, x, y) {
    try {
      if (DC.Sim && DC.Sim.describeTile) return DC.Sim.describeTile(run, x, y) || [];
    } catch (e) { /* ignore */ }
    return [];
  }
  function feedRateSafe(run) {
    try {
      if (DC.Sim && DC.Sim.feedRate) return DC.Sim.feedRate(run) || { gearPerSec: 0, chargePerSec: 0 };
    } catch (e) { /* ignore */ }
    return { gearPerSec: 0, chargePerSec: 0 };
  }

  // M-POLISH/CX-11 — STOCK row labels. Prefers data.js's per-item `short:`,
  // then Sim.itemShort's fallback table, then the plain name.
  // STOCK_NAME_W is the name field in characters: the accept test in
  // itemLabel and the slice at the draw site MUST be the same number, so it
  // is named once here and exported for the suite to audit against D.ITEMS.
  const STOCK_NAME_W = 9;
  const STOCK_COUNT_W = 3;
  function itemLabel(id) {
    const it = D.ITEMS[id] || {};
    // a `short` wider than the field would be cut mid-word — that is the bug
    // being fixed, so fall through to the table instead of trusting it
    if (typeof it.short === 'string' && it.short.length &&
        it.short.length <= STOCK_NAME_W) return it.short;
    try {
      if (DC.Sim && typeof DC.Sim.itemShort === 'function') return String(DC.Sim.itemShort(id));
    } catch (e) { /* sim in flux */ }
    return String(it.name || id);
  }
  // Counts live in STOCK_COUNT_W columns: 999 is the widest number that fits,
  // past that read '1k+' (also STOCK_COUNT_W wide) rather than overrun.
  function stockCount(n) {
    n = Math.max(0, Math.floor(n || 0));
    return n > 999 ? '1k+' : String(n);
  }

  function stratumOf(depth) {
    return depth <= D.STRATA_COUNT ? D.STRATA[depth - 1] : D.mantleStratum(depth);
  }
  // Output tile per SPEC §5.3
  function outputTile(x, y, w, h, f) {
    if (f === 0) return { x: x + ((w - 1) >> 1), y: y - 1 };
    if (f === 1) return { x: x + w, y: y + ((h - 1) >> 1) };
    if (f === 2) return { x: x + ((w - 1) >> 1), y: y + h };
    return { x: x - 1, y: y + ((h - 1) >> 1) };
  }
  function fallbackResult(run, won) {
    if (run && run.result) return run.result;
    return {
      depth: run ? run.depth : 1,
      breaches: run ? run.breaches : 0,
      timeSec: run ? run.totalT / D.TICK_HZ : 0,
      cores: (run ? run.breaches : 0) + (won ? D.WIN_CORES : 0),
      won: !!won,
    };
  }

  // ================= RUN SCREEN =================
  let floorTintDepth = -1, floorTint = D.TERRAIN.floor.color;

  function drawRun(state) {
    const run = state.run, ui = state.ui || {};
    if (!run || !run.grid) { ctext(15, 'NO ACTIVE RUN', C.red); return; }
    const st = stratumOf(run.depth);
    const accent = st.accent || C.amber;
    const phase = Math.floor(run.t / 4) % 2;

    // header (row 0)
    put(0, 0, '▌', C.amber);
    text(1, 0, 'DEEPCORE', C.bg, C.amber);
    put(9, 0, '▐', C.amber);
    const sl = 'STRATUM ' + run.depth;
    text(12, 0, sl, C.amber);
    text(12 + sl.length + 1, 0, '— ' + st.name, accent);
    text(46, 0, 'DEPTH -' + (run.depth * D.DEPTH_M) + 'm', C.gray);
    textR(COLS - 1, 0, 'ELAPSED ' + fmtTime(run.totalT / D.TICK_HZ), C.gray);

    // thin rule (row 1, under the map column only — sidebar starts here)
    text(0, 1, '─'.repeat(SB), C.amberDim);

    // map box rows 2..29, cols 0..47; interior = 46x26 at (MAP_X, MAP_Y)
    box(0, 2, 48, 28, accent, 'STRATUM ' + run.depth + ' ─ ' + st.name, C.white);

    if (floorTintDepth !== run.depth) {
      floorTintDepth = run.depth;
      floorTint = mix(D.TERRAIN.floor.color, accent, 0.25);
    }
    drawMap(run, ui, phase);
    drawSidebar(run, ui, phase, st, state.meta);
    drawHints(run, ui, phase);
    drawForeman(run);

    // flash banner: centered inverse block over the map
    const fl = ui.flash;
    if (fl && fl.text && (!fl.until || run.t < fl.until)) {
      const s = (' ' + fl.text + ' ').slice(0, D.MAP_W);
      const fc = resolveColor(fl.color) || C.amber;
      text(D.MAP_X + Math.max(0, (D.MAP_W - s.length) >> 1), D.MAP_Y + 11, s, C.bg, fc);
    }

    // pause menu overlay
    if (ui.paused) {
      const bw = 26, bh = 8, bx = (48 - bw) >> 1, by = 12;
      for (let r = by; r < by + bh; r++) text(bx, r, ' '.repeat(bw), C.gray, C.bg);
      box(bx, by, bw, bh, C.amber, 'PAUSED', C.white);
      text(bx + 3, by + 2, '[ESC] RESUME', C.amber);
      text(bx + 3, by + 4, '[A]   ABANDON RUN', C.red);
      text(bx + 3, by + 5, '[H]   MANUAL', C.gray);
    }
  }

  function mapPut(tx, ty, ch, fg, xo) {
    if (tx < 0 || tx >= D.MAP_W || ty < 0 || ty >= D.MAP_H) return;
    const gc = D.MAP_X + tx + (xo || 0);
    if (gc < D.MAP_X || gc >= D.MAP_X + D.MAP_W) return;
    put(gc, D.MAP_Y + ty, ch, fg);
  }

  function drawMap(run, ui, phase) {
    const shaking = ui.shakeUntil && run.t < ui.shakeUntil;
    const xo = shaking ? ((run.t & 1) ? 1 : -1) : 0;
    // Published for js/fx.js (SPEC3 §A): the map viewport plus the shake
    // offset, so the overlay lands on the same cells the tiles just did.
    layout.map = { x: D.MAP_X, y: D.MAP_Y, w: D.MAP_W, h: D.MAP_H, xo: xo };
    const FX = DC.FX && DC.FX.tile ? DC.FX : null;
    const req = run.breachReq || { gear: 0, charge: 0 };
    const inv = run.inv || {};
    const running = run.status === 'active' || run.status === 'breachReady';
    const drillActive = running &&
      (((run.gearsFed || 0) < req.gear && (inv.gear || 0) > 0) ||
       ((run.gearsFed || 0) >= req.gear && (run.chargesFed || 0) < req.charge && (inv.charge || 0) > 0));
    const hubRed = run.integrity < 25;

    // v1.1 §C.3 "chromed" tell: machine types buffed by an active schematic
    // render their anchor letter in COLORS.white.
    const scs = run.schematics || [];
    const chromed = {
      extractor: scs.indexOf('s_extract') >= 0,
      smelter: scs.indexOf('s_smelt') >= 0 || scs.indexOf('s_coal') >= 0,
      assembler: scs.indexOf('s_gear') >= 0,
    };

    for (let y = 0; y < D.MAP_H; y++) {
      const row = run.grid[y];
      if (!row) continue;
      for (let x = 0; x < D.MAP_W; x++) {
        const tile = row[x];
        if (!tile) continue;
        const gc = D.MAP_X + x + xo;
        if (gc < D.MAP_X || gc >= D.MAP_X + D.MAP_W) continue;
        const gr = D.MAP_Y + y;
        if (!tile.revealed) { put(gc, gr, ' ', null, UNREV_BG); continue; }

        const ter = D.TERRAIN[tile.t] || D.TERRAIN.floor;
        let ch = ter.glyph;
        let fg = tile.t === 'floor' ? floorTint : ter.color;
        if (tile.t === 'magma' && phase) fg = C.magmaHot;
        if (tile.ore && D.ORE_GLYPHS[tile.ore]) {
          const og = D.ORE_GLYPHS[tile.ore];
          ch = og.glyph;
          fg = tile.oreAmt < 25 ? shade(og.color, 0.55) : og.color;
        }
        if (tile.rubble) { ch = D.RUBBLE_GLYPH; fg = C.gray; }
        if (tile.digT > 0 && phase) { ch = '▒'; fg = C.gray; }
        if (tile.belt) {
          const it = tile.belt.item && D.ITEMS[tile.belt.item];
          if (it) { ch = it.glyph; fg = it.color; }
          else { ch = D.ARROWS[tile.belt.dir] || '·'; fg = shade(C.cyan, 0.6); }
        }
        if (tile.machine !== null && tile.machine !== undefined) {
          if (tile.machine === 0) {
            // the hub, 3x3 rig art
            const hx2 = x - run.hub.x, hy2 = y - run.hub.y;
            ch = (HUB_ART[hy2] && HUB_ART[hy2][hx2]) || '═';
            if (ch === 'D') fg = drillActive && phase ? C.white : C.amber;
            else fg = hubRed ? C.red : C.amber;
          } else {
            const m = run.machines[tile.machine];
            if (!m) { ch = '?'; fg = C.gray; }
            else {
              const b = D.BUILDINGS[m.type] || D.BUILDINGS.belt;
              if (x === m.x && y === m.y) {
                ch = b.letter;
                const base = chromed[m.type] ? C.white : b.color;
                fg = m.hp === 1 ? (phase ? C.red : base) : base;
              } else { ch = '▓'; fg = shade(b.color, 0.55); }
              const bad = m.status === 'nofuel' || m.status === 'blocked' || m.status === 'depleted';
              if (bad && phase) {
                // '!' over first non-anchor tile (the anchor itself for 1x1s)
                const mkx = (b.w > 1 || b.h > 1) ? m.x + 1 : m.x;
                if (x === mkx && y === m.y) { ch = '!'; fg = C.red; }
              }
            }
          }
        }
        // SPEC3 §A1: fx.js animates the tile it was about to draw. It reads
        // only true sim state and returns [ch, fg] (a reused array) or null.
        if (FX) {
          const o = FX.tile(run, tile, x, y, ch, fg);
          if (o) { ch = o[0]; fg = o[1]; }
        }
        put(gc, gr, ch, fg);
      }
    }

    // ghost preview / demolish marker / cursor
    const hov = ui.hover || ui.cursor;
    if (hov && hov.x >= 0 && hov.x < D.MAP_W && hov.y >= 0 && hov.y < D.MAP_H) {
      if (ui.tool && ui.tool !== 'demolish' && D.BUILDINGS[ui.tool]) {
        const b = D.BUILDINGS[ui.tool];
        const ok = canPlaceSafe(run, ui.tool, hov.x, hov.y, ui.facing || 0);
        const gcol = ok ? C.green : C.red;
        for (let dy = 0; dy < b.h; dy++) {
          for (let dx = 0; dx < b.w; dx++) {
            const anchor = dx === 0 && dy === 0;
            const g = anchor ? (ui.tool === 'belt' ? D.ARROWS[ui.facing || 0] : b.letter) : '░';
            mapPut(hov.x + dx, hov.y + dy, g, gcol, xo);
          }
        }
        if (ui.tool !== 'belt') {
          const o = outputTile(hov.x, hov.y, b.w, b.h, ui.facing || 0);
          mapPut(o.x, o.y, D.ARROWS[ui.facing || 0], gcol, xo);
        }
      } else if (ui.tool === 'demolish') {
        mapPut(hov.x, hov.y, '×', C.red, xo);
      } else if (Math.floor(run.t / 2) % 2) {
        // bare cursor: inverse video at half phase
        const gc = D.MAP_X + hov.x + xo;
        if (gc >= D.MAP_X && gc < D.MAP_X + D.MAP_W) invertCell(gc, D.MAP_Y + hov.y);
      }
    }
  }

  // ---------------- sidebar ----------------
  function sideEdge(row, kind, title, titleColor) {
    const l = kind === 'top' ? '┌' : kind === 'bot' ? '└' : '├';
    const r = kind === 'top' ? '┐' : kind === 'bot' ? '┘' : '┤';
    text(SB, row, l + '─'.repeat(SBW - 2) + r, C.amberDim);
    if (title) text(SB + 2, row, (' ' + title + ' ').slice(0, SBW - 4), titleColor || C.amber);
    return row + 1;
  }
  function sideWalls(row) { put(SB, row, '│', C.amberDim); put(SB + SBW - 1, row, '│', C.amberDim); }

  function drawSidebar(run, ui, phase, st, meta) {
    const req = run.breachReq || { gear: 0, charge: 0 };
    const gGlyph = D.ITEMS.gear.glyph, cGlyph = D.ITEMS.charge.glyph;
    let y = 1;

    // RIG — owned meta-upgrade glyph strip on the header row (v1.1 §C.2)
    let edge = y;
    y = sideEdge(y, 'top', 'RIG');
    const ups = (meta && meta.upgrades) || {};
    let gx = SB + SBW - 3;
    for (let i = D.META_UPGRADES.length - 1; i >= 0 && gx > SB + 7; i--) {
      const id = D.META_UPGRADES[i].id;
      if (!(ups[id] > 0)) continue;
      const g = UP_GLYPHS[id] || ['·', 'gray'];
      put(gx--, edge, g[0], resolveColor(g[1]) || C.amber);
    }
    sideWalls(y);
    text(SBC, y, 'INTEG', C.gray);
    const ifrac = run.maxIntegrity ? run.integrity / run.maxIntegrity : 0;
    const icol = ifrac > 0.6 ? C.green : ifrac > 0.3 ? C.amber : C.red;
    bar(SBC + 6, y, 13, ifrac, icol);
    textR(SB + SBW - 2, y, Math.max(0, Math.ceil(run.integrity)) + '/' + run.maxIntegrity, icol);
    y++;
    sideWalls(y);
    text(SBC, y, 'INSTB', C.gray);
    const inst = run.instability || 0;
    let ncol = inst < 40 ? C.green : inst < 70 ? C.amber : C.red;
    if (inst >= 80) ncol = phase ? C.red : shade(C.red, 0.45);  // blink red
    bar(SBC + 6, y, 13, inst / 100, ncol);
    textR(SB + SBW - 2, y, Math.floor(inst) + '%', ncol);
    y++;

    // DRILL — picked-schematic badge strip on the header row (v1.1 §C.3)
    edge = y;
    y = sideEdge(y, 'sep', 'DRILL');
    const scs = run.schematics || [];
    const maxB = 10;                                   // 2 chars each, 20 cols free
    const first = Math.max(0, scs.length - maxB);      // deep runs: newest badges win
    let bx = SB + SBW - 2 - Math.min(maxB, scs.length) * 2;
    for (let i = first; i < scs.length; i++) {
      text(bx, edge, schemBadge(scs[i]), schemColor(scs[i]));
      bx += 2;
    }
    sideWalls(y);
    text(SBC, y, 'GEAR', C.gray);
    bar(SBC + 5, y, 12, req.gear ? run.gearsFed / req.gear : 1, C.amber);
    textR(SB + SBW - 2, y, run.gearsFed + '/' + req.gear + gGlyph, C.amber);
    y++;
    if (req.charge > 0) {
      sideWalls(y);
      text(SBC, y, 'CHRG', C.gray);
      bar(SBC + 5, y, 12, run.chargesFed / req.charge, C.magenta);
      textR(SB + SBW - 2, y, run.chargesFed + '/' + req.charge + cGlyph, C.magenta);
      y++;
    }
    sideWalls(y);
    const fr = feedRateSafe(run);
    let feed = 'FEED ' + (fr.gearPerSec || 0).toFixed(1) + gGlyph;
    if (req.charge > 0) feed += ' ' + (fr.chargePerSec || 0).toFixed(1) + cGlyph;
    feed += '/s';
    text(SBC, y, feed, C.gray);
    textR(SB + SBW - 2, y, run.overdrive ? 'OD ON' : 'OD off',
      run.overdrive ? (phase ? C.red : C.orange) : C.darkgray);
    y++;

    // M-RECAP ghost split: this stratum's clock against your best-ever run at
    // this depth. The delta is time IN HAND — it counts down as you dig, green
    // while you are still under the record, red the moment you are not. Only
    // drawn once a record exists, so a first run costs no sidebar rows.
    const gs = ghostSplit(run, meta);
    if (gs) {
      sideWalls(y);
      text(SBC, y, 'BEST ' + fmtTime(gs.best), C.darkgray);
      textR(SB + SBW - 2, y, gs.mark + fmtDelta(gs.delta), gs.delta >= 0 ? C.green : C.red);
      y++;
    }

    // STOCK — 2 columns, always show ironPlate & gear
    y = sideEdge(y, 'sep', 'STOCK');
    const inv = run.inv || {};
    const shown = D.ITEM_ORDER.filter(id => (inv[id] || 0) > 0 || id === 'ironPlate' || id === 'gear');
    const srows = Math.max(1, Math.ceil(shown.length / 2));
    for (let i = 0; i < srows; i++) {
      sideWalls(y + i);
      for (let k = 0; k < 2; k++) {
        const id = shown[i * 2 + k];
        if (!id) continue;
        const it = D.ITEMS[id], cx = SBC + k * 15;
        put(cx, y + i, it.glyph, it.color);
        // CX-11: STOCK_NAME_W columns (the old blank gutter) + a per-item
        // short name, so 'copper ore' and 'copper plate' stop rendering as
        // 'copper o/p'.
        text(cx + 2, y + i, itemLabel(id).slice(0, STOCK_NAME_W), C.gray);
        text(cx + 2 + STOCK_NAME_W, y + i,
             U.padL(stockCount(inv[id] || 0), STOCK_COUNT_W), C.white);
      }
    }
    y += srows;

    // BUILD — one row per tool + demolish; facing arrow in the title
    edge = y;
    y = sideEdge(y, 'sep', 'BUILD ' + (D.ARROWS[ui.facing || 0] || D.ARROWS[1]));
    if (ui.laying) {                                   // v1.1 §D belt lay-mode armed
      const ar = D.ARROWS[ui.facing || 0] || '▸';
      textR(SB + SBW - 3, edge, 'LAYING ' + ar + ar + ar, phase ? C.white : C.cyan);
    }
    layout.buildRows = [];
    for (const t of D.BUILD_ORDER) {
      const b = D.BUILDINGS[t];
      sideWalls(y);
      const free = t === 'belt' && run.mods && run.mods.beltFree;
      const afford = free || Object.keys(b.cost).every(k => (inv[k] || 0) >= b.cost[k]);
      const costS = free ? 'free'
        : Object.keys(b.cost).map(k => b.cost[k] + (D.ITEMS[k] ? D.ITEMS[k].glyph : '?')).join(' ');
      if (ui.tool === t) {
        text(SBC, y, U.pad(b.key + ' ' + b.letter + ' ' + U.pad(b.name, 10), SCW - costS.length) + costS,
          C.bg, C.amber);
      } else {
        const bad = shade(C.red, 0.8);
        put(SBC, y, b.key, C.amber);
        put(SBC + 2, y, b.letter, b.color);
        text(SBC + 4, y, U.pad(b.name, 10), afford ? C.gray : bad);
        textR(SB + SBW - 2, y, costS, afford ? (free ? C.green : C.amberDim) : bad);
      }
      layout.buildRows.push({ row: y, tool: t });
      y++;
    }
    sideWalls(y);
    if (ui.tool === 'demolish') text(SBC, y, U.pad('X × demolish', SCW), C.bg, C.amber);
    else {
      put(SBC, y, 'X', C.amber);
      put(SBC + 2, y, '×', C.red);
      text(SBC + 4, y, 'demolish', C.gray);
    }
    layout.buildRows.push({ row: y, tool: 'demolish' });
    y++;

    // SCAN — tile tooltip / tool description / stratum flavor
    y = sideEdge(y, 'sep', 'SCAN');
    const lines = scanLines(run, ui, st).slice(0, 5);
    for (let i = 0; i < 5; i++) {
      sideWalls(y + i);
      const L = lines[i];
      if (L) text(SBC, y + i, String(L.text).slice(0, SCW), resolveColor(L.color) || C.gray);
    }
    y += 5;

    // LOG — fills the rest; newest at bottom, brightest. Messages WORD-WRAP
    // into the panel: it used to slice every line at SCW, which cut the first
    // message of every run mid-word ('The rig bites into the topsoi') and
    // every mirrored GRIT bark at 29 of its ~70 characters. The newest message
    // is always drawn whole; older ones drop off the top instead of appearing
    // headless (a message is either fully on the panel or not on it at all).
    y = sideEdge(y, 'sep', 'LOG');
    const bottom = ROWS - 1;                       // bottom border row (32)
    for (let r = y; r < bottom; r++) sideWalls(r);
    const logRows = bottom - y;                    // drawable rows (9 today)
    const all = run.messages || [];
    const painted = [];                            // bottom-up: newest first
    for (let j = all.length - 1; j >= 0 && painted.length < logRows; j--) {
      const m = all[j];
      const age = all.length - 1 - j;
      let mc = resolveColor(m.color) || C.gray;
      if (age > 3) mc = C.amberDim;
      else if (age > 0) mc = shade(mc, 1 - age * 0.18);
      const rows = wrapClamp(String(m.text), SCW, LOG_MSG_ROWS);
      if (painted.length && painted.length + rows.length > logRows) break;
      for (let k = rows.length - 1; k >= 0 && painted.length < logRows; k--) {
        painted.push({ text: rows[k], color: mc });
      }
    }
    for (let i = 0; i < painted.length; i++) {
      text(SBC, bottom - 1 - i, painted[i].text.slice(0, SCW), painted[i].color);
    }
    sideEdge(bottom, 'bot');
  }

  function scanLines(run, ui, st) {
    const hov = ui.hover || ui.cursor;
    if (hov && hov.x >= 0 && hov.x < D.MAP_W && hov.y >= 0 && hov.y < D.MAP_H) {
      const l = describeSafe(run, hov.x, hov.y);
      if (l.length) return l;
    }
    if (ui.tool === 'demolish') {
      return [{ text: 'DEMOLISH', color: C.red }]
        .concat(wrap('Remove machines and belts. Excavate rock and rubble.', SCW)
          .map(t => ({ text: t, color: C.gray })));
    }
    if (ui.tool && D.BUILDINGS[ui.tool]) {
      const b = D.BUILDINGS[ui.tool];
      return [{ text: b.name.toUpperCase(), color: b.color }]
        .concat(wrap(b.desc, SCW).map(t => ({ text: t, color: C.gray })));
    }
    return [{ text: st.tag, color: C.amberDim }];
  }

  // v1.1 §F: row 30 = one condensed hints line (cursor keys included);
  // rows 31-32 = the Foreman bar. Everything stays left of the sidebar (col 48).
  function drawHints(run, ui, phase) {
    const ready = run.status === 'breachReady';
    const segs = [
      ['1-5 BLD ', C.amberDim],
      ['X DEM ', C.amberDim],
      ['R ROT ', C.amberDim],
      ['C OD ', C.amberDim],
      ['↑↓←→ ↵ ', C.amberDim],
      ['D DESC ', ready ? (phase ? C.green : C.white) : C.amberDim],
      ['ESC H', C.amberDim],
    ];
    let x = 0;
    for (const s of segs) {
      if (x + s[0].length > SB - 1) break;
      text(x, 30, s[0], s[1]);
      x += s[0].length;
    }
  }

  // Foreman bar (v1.1 §F) — GRIT-tag amber, text cyan, typewriter ~2 chars/tick
  // from t0, hold to `until`, then 2 s dim fade. Only barks.js populates it.
  function drawForeman(run) {
    const f = run.foreman;
    if (!f || !f.text) return;
    const until = f.until || 0;
    if (run.totalT > until + 2 * D.TICK_HZ) return;          // faded out
    const fading = run.totalT > until;
    const full = String(f.text);
    const shown = U.clamp(Math.floor((run.totalT - (f.t0 || 0)) * 2), 0, full.length);
    const w = SB - 1 - 7;                                    // 41 cols per row
    // Two rows, split on a WORD boundary. The old split was a raw column cut,
    // so GRIT's longer lines broke as 'Gravi / ty agrees' on the most-read
    // line in the game. The typewriter is unchanged: `shown` characters of the
    // whole line are revealed, each row taking its share as the reveal reaches
    // it (+1 per row for the space the wrap consumed).
    const rows = wrapClamp(full, w, 2);
    text(0, 31, 'GRIT ▸', fading ? C.amberDim : C.amber);
    let left = shown;
    for (let i = 0; i < rows.length && left > 0; i++) {
      text(7, 31 + i, rows[i].slice(0, left), fading ? C.amberDim : C.cyan);
      left -= rows[i].length + 1;
    }
  }

  // ================= TITLE =================
  function drawTitle(state) {
    const meta = state.meta || {};
    const lines = art('title');
    // Logo rows sweep amber → orange → ember, 3-tone (v1.1 §E): never mono-color.
    const logoRows = Math.min(5, lines.length);
    const sweep = [C.amber, C.amber, C.orange, C.orange, EMBER];
    for (let i = 0; i < logoRows; i++) {
      const ln = lines[i];
      text(Math.max(0, (COLS - ln.length) >> 1), 1 + i, ln, sweep[i] || EMBER);
    }
    // Under the logo: YOUR rig, owned upgrades visible (v1.1 §C.2). Falls back
    // to the generic vignette rows of the title art if composeRig is absent.
    const rig = composeRigSafe(meta.upgrades);
    let below;
    layout.title = { rig: null, enter: null };
    if (rig) {
      const rx = blockX(rig, COLS), ry = 7;
      for (let i = 0; i < rig.length && ry + i < 24; i++) text(rx, ry + i, rig[i], C.amber);
      below = Math.min(ry + Math.min(rig.length, 24 - ry) + 1, 24);
      // published for fx.js: the drill string idles inside this block
      layout.title.rig = { x: rx, y: ry, w: blockWidth(rig), h: Math.min(rig.length, 24 - ry) };
    } else {
      for (let i = logoRows; i < lines.length; i++) {
        const ln = lines[i];
        text(Math.max(0, (COLS - ln.length) >> 1), 1 + i, ln, artColor('title', C.amber));
      }
      below = Math.min(1 + lines.length + 1, 24);
    }
    ctext(below, 'an automated descent toward the core', C.gray);
    ctext(below + 1, 'build the line · feed the drill · keep moving', C.amberDim);
    // menu
    const segs = [
      ['[ENTER]', C.green], [' BEGIN DESCENT   ', C.amber],
      ['[T]', C.green], [' DAILY SHAFT   ', C.amber],      // M-RECAP
      ['[F]', C.green], [' THE FOUNDRY   ', C.amber],
      ['[H]', C.green], [' MANUAL', C.amber],
    ];
    let tot = 0;
    for (const s of segs) tot += s[0].length;
    let x = (COLS - tot) >> 1;
    layout.title.enter = { col: x, row: 28, len: segs[0][0].length };  // it breathes
    for (const s of segs) { text(x, 28, s[0], s[1]); x += s[0].length; }
    // M-RECAP: today's shaft at a glance — the local daily table, made visible
    // on the front door. state.today is stamped by the engine (render keeps no
    // clock of its own); absent, the line simply does not appear.
    const today = state.today;
    if (today) {
      // read the history directly rather than through Meta.dailyEntry: that
      // helper normalises the profile as a side effect, and render writes to
      // nothing.
      const hist = (meta && Array.isArray(meta.dailyHistory)) ? meta.dailyHistory : [];
      let de = null;
      for (let i = 0; i < hist.length; i++) {
        if (hist[i] && hist[i].date === today) { de = hist[i]; break; }
      }
      ctext(29, de
        ? 'DAILY ' + today + ' — RUN: STRATUM ' + de.depth + ' in ' + fmtTime(de.timeSec)
        : 'DAILY ' + today + ' — OPEN, ONE RANKED ATTEMPT', C.darkgray);
    }
    // meta stats footer
    put(2, 31, '◈', C.magenta);
    text(4, 31, (meta.cores || 0) + ' CORES BANKED   BEST STRATUM ' + (meta.bestDepth || 0) +
      '   WINS ' + (meta.wins || 0) + '/' + (meta.runs || 0), C.amberDim);
    textR(COLS - 3, 31, 'v' + D.VERSION, C.darkgray);
  }

  // ================= DESCEND =================
  function drawDescend(state) {
    const run = state.run, ui = state.ui || {};
    const frames = artFrames();
    const animLen = frames.length * 10 + 45;      // ~2.5 s at 60 fps incl. hold
    const anim = ui.descendAnim || 0;
    const target = run ? run.depth + 1 : 1;
    const nst = stratumOf(target);
    const accent = nst.accent || C.amber;

    if (anim < animLen || !run || !run.pendingOffers) {
      ui.descendAnim = anim + 1;                  // render advances the anim counter (SPEC §7)
      ctext(2, '»» DESCENDING ««', C.amber);
      // SPEC3 §A2 interstitial: the name types itself in the accent while the
      // odometer rolls its digits down to the depth you are arriving at.
      ctext(4, fxTyped('descend', 'STRATUM ' + target + ' — ' + nst.name, 24), accent);
      const fi = Math.min(Math.floor(anim / 10), frames.length - 1);
      const fh = frames[fi].length;
      drawArt(frames[fi], 7, artColor('descent', C.orange));
      const d0 = (target - 1) * D.DEPTH_M;
      const prog = animLen ? anim / animLen : 1;
      const dm = Math.min(target * D.DEPTH_M, d0 + Math.floor(prog * D.DEPTH_M));
      ctext(Math.min(ROWS - 2, 8 + fh + 1),
        'DEPTH -' + fxOdometer('descend', target * D.DEPTH_M, prog, String(dm)) + 'm', C.gray);
      return;
    }

    // schematic pick
    const offers = run.pendingOffers;
    const hdr = art('schematicHeader');
    drawArt(hdr, 2, artColor('schematicHeader', C.amber));
    const n = Math.max(1, offers.length);
    const gap = 2;
    const w = Math.min(24, Math.floor((COLS - 2 - (n - 1) * gap) / n));
    const x0 = (COLS - (n * w + (n - 1) * gap)) >> 1;
    const rowc = Math.min(hdr.length + 3, 8), h = 15;
    layout.cards = [];
    for (let i = 0; i < offers.length; i++) {
      const id = offers[i];
      const sc = D.SCHEMATICS.find(s => s.id === id) || { id: id, name: id, desc: '' };
      const cx = x0 + i * (w + gap);
      box(cx, rowc, w, h, ui.hoverCard === i ? C.white : accent);
      // Icon slot: 10x5 schematic icon (v1.1 §C.3) in its thematic color, or a
      // dim placeholder — the name always lands on the same row either way.
      const ic = DC.Art && DC.Art.schemIcons && DC.Art.schemIcons[id];
      if (Array.isArray(ic) && ic.length && typeof ic[0] === 'string') {
        const icc = schemColor(id);
        const ir = ic.slice(0, 5);
        let iy = rowc + 1 + ((5 - ir.length) >> 1);
        for (const ln of ir) {
          text(cx + Math.max(1, (w - ln.length) >> 1), iy++, ln.slice(0, w - 2), icc);
        }
      } else {
        const ph = ['┌─┐', '│◇│', '└─┘'];
        for (let p = 0; p < ph.length; p++) {
          text(cx + Math.max(1, (w - ph[p].length) >> 1), rowc + 2 + p, ph[p], C.darkgray);
        }
      }
      let yy = rowc + 7;
      for (const ln of wrap(sc.name, w - 4).slice(0, 2)) {
        text(cx + Math.max(1, (w - ln.length) >> 1), yy++, ln, C.white);
      }
      yy++;
      for (const ln of wrap(sc.desc, w - 4).slice(0, rowc + 13 - yy)) {
        text(cx + Math.max(1, (w - ln.length) >> 1), yy++, ln, C.gray);
      }
      const key = '[ ' + (i + 1) + ' ]';
      text(cx + ((w - key.length) >> 1), rowc + h - 2, key, C.green);
      layout.cards.push({ col: cx, row: rowc, w: w, h: h, id: id, index: i });
    }
    ctext(rowc + h + 2, 'CHOOSE ONE — [1-' + n + '] OR CLICK', C.amberDim);
  }

  // ================= FOUNDRY =================
  // v1.1 §C.2: rig portrait left, upgrade list right. On purchase the engine
  // sets ui.flashPart = {id, until}; that part's overlay cells blink white.
  function drawRigPortrait(x0, y0, w, upgrades, flash) {
    const rig = composeRigSafe(upgrades);
    if (!rig) {
      const ph = placeholder('rig');
      for (let i = 0; i < ph.length; i++) {
        text(x0 + Math.max(0, (w - ph[i].length) >> 1), y0 + 4 + i, ph[i], C.darkgray);
      }
      return;
    }
    const ox = x0 + Math.max(0, (w - blockWidth(rig)) >> 1);
    const rows = Math.min(rig.length, 12);
    // published for fx.js: the spark burst goes off around the bolted part
    layout.foundryRig = { x: ox, y: y0, w: blockWidth(rig), h: rows };
    for (let i = 0; i < rows; i++) text(ox, y0 + i, rig[i].slice(0, w), C.amber);
    if (!flash) return;
    const p = DC.Art && DC.Art.rigParts && DC.Art.rigParts[flash.id];
    if (p && Array.isArray(p.lines)) {
      const fc = flash.on ? C.white : C.amberDim;   // hard blink: the part bolts on
      for (let i = 0; i < p.lines.length; i++) {
        const ln = p.lines[i];
        for (let j = 0; j < ln.length; j++) {
          if (ln[j] !== ' ') put(ox + (p.col || 0) + j, y0 + (p.row || 0) + i, ln[j], fc);
        }
      }
    } else if (flash.on) {
      // part overlay unknown (art in flux): flash the whole rig instead
      for (let i = 0; i < rows; i++) text(ox, y0 + i, rig[i].slice(0, w), C.white);
    }
  }

  function drawFoundry(state) {
    const meta = state.meta || { cores: 0, upgrades: {} };
    const ui = state.ui || {};
    const lines = art('foundry');
    drawArt(lines, 1, artColor('foundry', C.orange));
    ctext(Math.min(1 + lines.length + 1, 8), '◈ ' + (meta.cores || 0) + ' CORES', C.magenta);

    // left column: the rig, upgrades bolted on
    const py = 10;
    box(1, py, 28, 14, C.amberDim, 'YOUR RIG', C.amber);
    drawRigPortrait(2, py + 1, 26, meta.upgrades, activeFlash(ui));

    // right column: upgrade list (2 rows each: stat line + dim desc)
    const lx = 31;
    for (let i = 0; i < D.META_UPGRADES.length; i++) {
      const up = D.META_UPGRADES[i];
      const lvl = (meta.upgrades && meta.upgrades[up.id]) || 0;
      const maxed = lvl >= up.max;
      const cost = maxed ? 0 : up.costs[lvl];
      const afford = !maxed && (meta.cores || 0) >= cost;
      const row = py + i * 2;
      put(lx, row, LETTERS[i], afford ? C.amber : C.darkgray);
      put(lx + 1, row, ')', C.darkgray);
      text(lx + 3, row, U.pad(up.name, 17), maxed ? C.amberDim : afford ? C.amber : C.darkgray);
      if (lvl > 0) text(lx + 21, row, '█'.repeat(lvl), C.green);
      if (lvl < up.max) text(lx + 21 + lvl, row, '░'.repeat(up.max - lvl), C.darkgray);
      text(lx + 24, row, lvl + '/' + up.max, C.gray);
      text(lx + 28, row, maxed ? ' MAX' : U.padL(cost + '◈', 4),
        maxed ? C.amberDim : afford ? C.magenta : shade(C.red, 0.8));
      text(lx + 3, row + 1, up.desc.slice(0, COLS - lx - 4), C.darkgray);
    }

    // Foreman surface (M-POLISH backlog): GRIT talks on the Foundry floor even
    // with no live run — the engine parks the last foundryBuy line here.
    // Accepts a bare string or {line}, so the engine side can grow.
    const fbRaw = state.foundryBark;
    const fb = typeof fbRaw === 'string' ? fbRaw : (fbRaw && fbRaw.line);
    if (fb) ctext(28, 'GRIT ▸ ' + String(fb).slice(0, 70), C.cyan);

    ctext(29, 'lifetime cores ' + (meta.totalCores || 0) + '   runs ' + (meta.runs || 0), C.darkgray);
    ctext(31, '[A-I] FORGE UPGRADE      [ESC] RETURN TO SURFACE', C.amber);
  }

  // ================= HELP / GAMEOVER / VICTORY =================
  function drawHelp() {
    const lines = art('help');
    const start = Math.max(1, (ROWS - lines.length) >> 1);
    drawArt(lines, start, artColor('help', C.amber));
    if (start + lines.length < ROWS - 1) ctext(ROWS - 1, '[ESC] BACK', C.amberDim);
  }

  function statsBlock(row, res) {
    const L = 26, V = 46;
    text(L, row, 'STRATUM REACHED', C.gray);
    text(V, row, res.depth + '  (-' + (res.depth * D.DEPTH_M) + 'm)', C.white);
    text(L, row + 1, 'STRATA BREACHED', C.gray);
    text(V, row + 1, String(res.breaches), C.white);
    text(L, row + 2, 'TIME', C.gray);
    text(V, row + 2, fmtTime(res.timeSec), C.white);
    text(L, row + 3, 'CORES EARNED', C.gray);
    text(V, row + 3, '+' + res.cores + ' ◈', C.magenta);
  }

  function drawGameover(state, phase) {
    const lines = art('gameover');
    drawArt(lines, 1, artColor('gameover', C.red));
    layout.artBlock = { row: 1, h: lines.length };   // fx: dust motes drift here
    const y = Math.min(1 + lines.length + 1, 26);
    statsBlock(y, fallbackResult(state.run, false));
    // Foreman's last word (v1.1 §F) — only when js/barks.js is loaded.
    // SPEC3 §A2: it types out at half GRIT speed. Funerals are slower.
    const epi = epitaphSafe(state.run);
    for (let i = 0; i < epi.length && y + 5 + i < 30; i++) {
      ctext(y + 5 + i, (i === 0 ? 'GRIT ▸ ' : '') +
        fxTyped('epitaph' + i, String(epi[i]).slice(0, 70), 8), C.cyan);
    }
    ctext(30, '[TAB] RUN RECAP CARD', C.amberDim);
    ctext(31, '[ENTER] RETURN TO THE SURFACE', phase ? C.white : C.amber);
  }

  function drawVictory(state, phase) {
    const lines = art('victory');
    drawArt(lines, 1, artColor('victory', C.magmaHot));
    layout.artBlock = { row: 1, h: lines.length };   // fx: the core sphere pulses
    const y = Math.min(1 + lines.length + 1, 24);
    statsBlock(y, fallbackResult(state.run, true));
    ctext(y + 5, '+' + D.WIN_CORES + ' ◈ CORE BONUS', phase ? C.magenta : shade(C.magenta, 0.6));
    const tl = toastSafe(state.run);
    if (tl && y + 7 < 31) ctext(y + 7, 'GRIT ▸ ' + fxTyped('toast', tl.slice(0, 70), 14), C.cyan);
    ctext(30, '[TAB] RUN RECAP CARD', C.amberDim);
    ctext(31, '[ENTER] ASCEND      [C] CONTINUE INTO THE MANTLE', C.amber);
  }

  // ================= RECAP CARD (SPEC3 M-RECAP) =================
  // A 46-wide boxed ASCII artifact: the whole run as one picture you can paste
  // into a chat window. Built once as text rows plus colour spans, so what the
  // screen shows and what `C` copies are the same card by construction —
  // recapText() is literally these rows' text.
  // Everything here reads state; nothing writes it, and no sim value is
  // recomputed — splits come from the engine, the roast from barks.js.
  const CARD_W = 46;
  const CARD_IN = CARD_W - 2;             // interior columns (44)
  const CARD_STRATA_MAX = 12;             // Mantle runs elide the earliest rows
  const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];

  // Horizontal bar in eighth-blocks: a 2:41 stratum next to a 2:44 one has to
  // look different, and whole cells cannot show that at 13 columns.
  function cardBar(frac, width) {
    const units = Math.round(U.clamp(frac || 0, 0, 1) * width * 8);
    const full = Math.min(width, Math.floor(units / 8));
    const rem = units % 8;
    let s = '█'.repeat(full);
    if (rem > 0 && full < width) s += EIGHTHS[rem - 1];
    return U.pad(s, width);
  }
  function cardRow(inner, color, spans) {
    return { text: '│' + U.pad(inner, CARD_IN) + '│', color: color || C.gray, spans: spans || null };
  }
  function cardEdge(kind, title, color) {
    const bar = '─'.repeat(CARD_IN);
    const l = kind === 'top' ? '┌' : kind === 'bot' ? '└' : '├';
    const r = kind === 'top' ? '┐' : kind === 'bot' ? '┘' : '┤';
    let s = l + bar + r;
    if (title) {
      const t = ' ' + title + ' ';
      s = s.slice(0, 2) + t + s.slice(2 + t.length);
    }
    return { text: s, color: color || C.amberDim, spans: null };
  }

  // GRIT's Performance Review consumes run.rng, so it is cached per run and
  // outcome — a per-frame redraw must never re-roll the roast.
  let revRun = null, revKey = '', revLine = '';
  function reviewSafe(run, res) {
    if (!run || !DC.Barks || typeof DC.Barks.review !== 'function') return '';
    const key = (res.won ? 'w' : 'l') + '|' + res.depth + '|' + (run.mantle ? 'm' : '');
    if (revRun === run && revKey === key) return revLine;
    let l = '';
    try { l = DC.Barks.review(run, res) || ''; } catch (e) { /* barks in flux */ }
    revRun = run; revKey = key;
    revLine = typeof l === 'string' ? l : '';
    return revLine;
  }

  // Cause of death, in the same three buckets Barks.epitaph reasons about.
  function recapOutcome(run, res) {
    if (res.won && !run.mantle) return 'CORE BREACHED';
    if (run.status !== 'dead' && run.status !== 'won') return 'RUN IN PROGRESS';
    if (run.integrity > 0) return 'ABANDONED THE DIG';
    const st = stratumOf(res.depth);
    if (st.features && st.features.magma) return 'LOST TO THE MELT';
    return 'RIG DESTROYED';
  }

  // The rows the bar chart draws: one per stratum entered. Cleared strata come
  // from the engine's splits; the stratum the run ended in has no split, so it
  // is added here from run.t and flagged.
  function recapStrata(run) {
    const out = [];
    const splits = Array.isArray(run.splits) ? run.splits : [];
    let cleared = false;
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i];
      if (!s || typeof s.depth !== 'number') continue;
      if (s.depth === run.depth) cleared = true;
      out.push({ depth: s.depth, sec: s.sec || 0, partial: false });
    }
    if (!cleared) out.push({ depth: run.depth, sec: (run.t || 0) / D.TICK_HZ, partial: true });
    return out;
  }

  function buildRecap(state) {
    const run = state && state.run;
    if (!run) {
      const rows = [cardEdge('top', 'RUN RECAP'), cardRow(' no run to recap', C.red), cardEdge('bot')];
      return { rows: rows, plain: rows.map(r => r.text) };
    }
    const res = fallbackResult(run, !!(run.result && run.result.won));
    const rows = [];
    rows.push(cardEdge('top', 'DEEPCORE ─ RUN RECAP', C.amber));

    // identity line: when it was dug, and which hole
    const date = (DC.Meta && DC.Meta.dailyKey && run.startedAt)
      ? DC.Meta.dailyKey(run.startedAt) : '';
    rows.push(cardRow(' ' + U.pad(date, 12) +
      U.padL('SEED ' + (run.seed >>> 0), CARD_IN - 14) + ' ', C.gray));
    if (run.daily) {
      rows.push(cardRow(' DAILY SHAFT  ·  ' +
        (run.daily.practice ? 'PRACTICE (UNRANKED)' : 'RANKED ATTEMPT'),
        run.daily.practice ? C.amberDim : C.magenta));
    }

    // depth bar chart, one row per stratum, in the stratum accents
    rows.push(cardEdge('sep', 'DESCENT', C.amberDim));
    let strata = recapStrata(run);
    let elided = 0;
    if (strata.length > CARD_STRATA_MAX) {
      elided = strata.length - CARD_STRATA_MAX;
      strata = strata.slice(elided);
    }
    let maxSec = 1;
    for (let i = 0; i < strata.length; i++) if (strata[i].sec > maxSec) maxSec = strata[i].sec;
    if (elided) rows.push(cardRow(' ... ' + elided + ' earlier strata', C.darkgray));
    for (let i = 0; i < strata.length; i++) {
      const s = strata[i];
      const st = stratumOf(s.depth);
      const inner = ' ' + U.pad('S' + s.depth, 3) + ' ' + U.pad(st.name, 15) + ' ' +
        cardBar(s.sec / maxSec, 13) + ' ' + U.padL(fmtTime(s.sec), 6) + ' ' +
        (s.partial ? '†' : ' ');
      rows.push(cardRow(inner, C.gray, [
        { from: 5, len: 15, color: st.accent || C.amber },
        { from: 21, len: 13, color: st.accent || C.amber },
        { from: 35, len: 7, color: s.partial ? C.red : C.white },
      ]));
    }

    // the numbers: how it ended, what was taken, what was fed, what was banked
    rows.push(cardEdge('sep', 'LEDGER', C.amberDim));
    const outcome = recapOutcome(run, res);
    rows.push(cardRow(' ' + U.pad(outcome, 27) + U.padL('TIME ' + fmtTime(res.timeSec), 15) + ' ',
      res.won ? C.green : C.red));
    const scs = run.schematics || [];
    const spans = [];
    let badges = '';
    for (let i = 0; i < scs.length && badges.length < 26; i++) {
      spans.push({ from: 13 + badges.length, len: 2, color: schemColor(scs[i]) });
      badges += schemBadge(scs[i]) + ' ';
    }
    rows.push(cardRow(' SCHEMATICS  ' + (badges || '(none taken)'), C.gray, spans));
    const ctx = (DC.Barks && DC.Barks.reviewCtx) ? DC.Barks.reviewCtx(run, res) : null;
    const gears = ctx ? ctx.gears : (run.gearsFed || 0);
    const charges = ctx ? ctx.charges : (run.chargesFed || 0);
    const fedL = ' FED  ' + gears + D.ITEMS.gear.glyph + '  ' + charges + D.ITEMS.charge.glyph;
    const fedR = 'CORES +' + (res.cores || 0) + ' ◈ ';
    rows.push(cardRow(U.pad(fedL, Math.max(0, CARD_IN - fedR.length)) + fedR, C.gray));

    // and the reason to read the thing
    const line = reviewSafe(run, res);
    if (line) {
      rows.push(cardEdge('sep', "GRIT'S PERFORMANCE REVIEW", C.amberDim));
      const wrapped = wrapClamp(line, CARD_IN - 2, 3);
      for (let i = 0; i < wrapped.length; i++) rows.push(cardRow(' ' + wrapped[i], C.cyan));
    }
    rows.push(cardEdge('bot', null, C.amber));
    return { rows: rows, plain: rows.map(r => r.text) };
  }

  // The end-screen card view (TAB from the stats view on gameover/victory).
  function drawRecap(state) {
    const card = buildRecap(state);
    const rows = card.rows;
    const x = Math.max(0, (COLS - CARD_W) >> 1);
    const y0 = Math.max(1, (ROWS - 2 - rows.length) >> 1);
    for (let i = 0; i < rows.length && y0 + i < ROWS - 2; i++) {
      const r = rows[i];
      text(x, y0 + i, r.text, r.color);
      if (!r.spans) continue;
      for (let s = 0; s < r.spans.length; s++) {
        const sp = r.spans[s];
        text(x + 1 + sp.from, y0 + i, r.text.slice(1 + sp.from, 1 + sp.from + sp.len), sp.color);
      }
    }
    const note = state.ui && state.ui.copied;
    if (note) ctext(ROWS - 2, String(note), C.green);
    ctext(ROWS - 1, '[TAB] STATS   [C] COPY CARD   [ENTER] RETURN TO THE SURFACE', C.amber);
  }

  // ================= flush (batched fillText) =================
  function flush() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, COLS * CW, ROWS * CH);
    // background runs
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const b = bgB[r][c];
        if (!b) { c++; continue; }
        let e = c + 1;
        while (e < COLS && bgB[r][e] === b) e++;
        ctx.fillStyle = b;
        ctx.fillRect(c * CW, r * CH, (e - c) * CW, CH);
        c = e;
      }
    }
    // text runs: same-color spans in one fillText; x-scale maps the measured
    // glyph advance onto the CW cell pitch so long runs stay grid-aligned
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.save();
    ctx.scale(CW / adv, 1);
    for (let r = 0; r < ROWS; r++) {
      const yy = r * CH + CH * 0.55;
      let c = 0;
      while (c < COLS) {
        if (chB[r][c] === ' ') { c++; continue; }
        const col = fgB[r][c];
        let e = c, s = '';
        while (e < COLS && (chB[r][e] === ' ' || fgB[r][e] === col)) { s += chB[r][e]; e++; }
        ctx.fillStyle = col || C.gray;
        ctx.fillText(s, c * adv, yy);
        c = e;
      }
    }
    ctx.restore();
  }

  // ================= fx surface (SPEC3 §A) =================
  // js/fx.js draws through this, never through a canvas context: it is the
  // same cell buffer every screen writes into, so the FX pass is simply the
  // last thing to touch a cell. Read accessors let the overlay recolor what
  // has already been drawn (the instability border breathe, the pre-collapse
  // dim, the victory sphere pulse) without knowing how it got there.
  const surface = {
    COLS: COLS, ROWS: ROWS,
    put: put, text: text, ctext: ctext, invertCell: invertCell,
    ch: function (c, r) {
      return (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? chB[r][c] : ' ';
    },
    fg: function (c, r) {
      return (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? fgB[r][c] : null;
    },
    bg: function (c, r) {
      return (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? bgB[r][c] : null;
    },
    shade: shade, mix: mix, resolve: resolveColor, C: C,
    layout: null,                        // wired to `layout` below
  };
  // Strings fx.js animates in place (SPEC3 §A2 typewriters and the descent
  // odometer). Without js/fx.js loaded these are the plain values, so every
  // screen still reads correctly on its own.
  function fxTyped(key, str, cps) {
    str = String(str);
    if (!DC.FX || !DC.FX.typed) return str;
    try { return DC.FX.typed(key, str, cps); } catch (e) { return str; }
  }
  function fxOdometer(key, value, prog, plain) {
    if (!DC.FX || !DC.FX.odometer) return plain;
    try { return DC.FX.odometer(key, value, prog); } catch (e) { return plain; }
  }
  // ================= public API =================
  const layout = { cards: [], buildRows: [], map: null };
  surface.layout = layout;

  DC.Render = {
    CW: CW, CH: CH,
    layout: layout,
    // M-POLISH/CX-11: the STOCK row contract, exported so test/barks_test.js
    // can prove every D.ITEMS.short survives the name field unclipped and
    // stays unambiguous — mirrors Sim.SCAN_W for the tooltip panel (CX-04).
    STOCK_NAME_W: STOCK_NAME_W,
    STOCK_COUNT_W: STOCK_COUNT_W,
    itemLabel: itemLabel,
    stockCount: stockCount,
    // The prose panels' text contract (LOG at SCW columns, Foreman bar at 41),
    // exported so test/barks_test.js can prove no authored line — sim message
    // or GRIT bark — is ever cut mid-word by either one.
    SCAN_COL_W: SCW,
    LOG_MSG_ROWS: LOG_MSG_ROWS,
    FOREMAN_ROW_W: SB - 1 - 7,
    wrapClamp: wrapClamp,

    // M-RECAP: the card as data and as plain text. engine.js copies
    // recapText() to the clipboard, so the shared artifact and the drawn
    // screen can never drift apart.
    CARD_W: CARD_W,
    recapCard: buildRecap,
    recapText: function (state) {
      try { return buildRecap(state).plain.join('\n'); } catch (e) { return ''; }
    },
    ghostSplit: ghostSplit,

    init: function (cv) {
      canvas = cv;
      ctx = cv.getContext('2d');
      dpr = (root.devicePixelRatio || 1);
      cv.width = COLS * CW * dpr;
      cv.height = ROWS * CH * dpr;
      cv.style.width = (COLS * CW) + 'px';
      cv.style.height = (ROWS * CH) + 'px';
      ctx.font = FONT;
      const m = ctx.measureText('█');
      adv = (m && m.width) ? m.width : CW;
    },

    // SPEC3 §A test surface: the cell buffer after a frame, so a stub-canvas
    // frame-advance test can prove an FX row actually landed on a cell.
    cellAt: function (col, row) {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
      return { ch: chB[row][col], fg: fgB[row][col], bg: bgB[row][col] };
    },

    frame: function (state) {
      if (!ctx || !state) return;
      frameN++;
      const phase = Math.floor(frameN / 30) % 2;   // blink phase off the run clock
      clearBuf();
      // SPEC3 §A: fx.js advances its frame clock and takes its per-frame read
      // of the world BEFORE anything draws; its overlay lands after everything.
      if (DC.FX && DC.FX.begin) {
        try { DC.FX.begin(state, surface); } catch (e) { /* fx never kills a frame */ }
      }
      try {
        switch (state.screen) {
          case 'run':      drawRun(state); break;
          case 'descend':  drawDescend(state); break;
          case 'foundry':  drawFoundry(state); break;
          case 'help':     drawHelp(); break;
          case 'gameover': drawGameover(state, phase); break;
          case 'recap':    drawRecap(state); break;      // M-RECAP
          case 'victory':  drawVictory(state, phase); break;
          case 'title':
          default:         drawTitle(state); break;
        }
      } catch (e) {
        // never let a render fault kill the loop during parallel development
        text(1, 1, 'RENDER ERROR: ' + (e && e.message ? e.message : e), C.red);
      }
      if (DC.FX && DC.FX.frame) {
        try { DC.FX.frame(state, surface); } catch (e) { /* overlay is optional */ }
      }
      flush();
    },

    pxToCell: function (px, py) {
      if (!canvas) return { col: -1, row: -1 };
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return { col: -1, row: -1 };
      return {
        col: Math.floor((px - r.left) * COLS / r.width),
        row: Math.floor((py - r.top) * ROWS / r.height),
      };
    },
  };
})();
