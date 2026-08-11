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
  const LETTERS = 'abcdefghi';
  const HUB_ART = ['╔═╗', '║D║', '╚═╝'];

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
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
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
    drawSidebar(run, ui, phase, st);
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
    const req = run.breachReq || { gear: 0, charge: 0 };
    const inv = run.inv || {};
    const running = run.status === 'active' || run.status === 'breachReady';
    const drillActive = running &&
      (((run.gearsFed || 0) < req.gear && (inv.gear || 0) > 0) ||
       ((run.gearsFed || 0) >= req.gear && (run.chargesFed || 0) < req.charge && (inv.charge || 0) > 0));
    const hubRed = run.integrity < 25;

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
                fg = m.hp === 1 ? (phase ? C.red : b.color) : b.color;
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

  function drawSidebar(run, ui, phase, st) {
    const req = run.breachReq || { gear: 0, charge: 0 };
    const gGlyph = D.ITEMS.gear.glyph, cGlyph = D.ITEMS.charge.glyph;
    let y = 1;

    // RIG
    y = sideEdge(y, 'top', 'RIG');
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

    // DRILL
    y = sideEdge(y, 'sep', 'DRILL');
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
        text(cx + 2, y + i, it.name.slice(0, 8), C.gray);
        text(cx + 11, y + i, U.padL(String(Math.min(inv[id] || 0, 999)), 3), C.white);
      }
    }
    y += srows;

    // BUILD — one row per tool + demolish; facing arrow in the title
    y = sideEdge(y, 'sep', 'BUILD ' + (D.ARROWS[ui.facing || 0] || D.ARROWS[1]));
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

    // LOG — fills the rest; newest at bottom, brightest
    y = sideEdge(y, 'sep', 'LOG');
    const bottom = ROWS - 1;                       // bottom border row (32)
    for (let r = y; r < bottom; r++) sideWalls(r);
    const cap = Math.min(6, bottom - y);
    const msgs = (run.messages || []).slice(-cap);
    for (let j = 0; j < msgs.length; j++) {
      const m = msgs[j];
      const age = msgs.length - 1 - j;
      let mc = resolveColor(m.color) || C.gray;
      if (age > 3) mc = C.amberDim;
      else if (age > 0) mc = shade(mc, 1 - age * 0.18);
      text(SBC, bottom - msgs.length + j, String(m.text).slice(0, SCW), mc);
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

  function drawHints(run, ui, phase) {
    text(0, 30, '1-5 BUILD  X DEMOLISH  R ROTATE  C OVERDRIVE', C.amberDim);
    const ready = run.status === 'breachReady';
    text(0, 31, 'D DESCEND', ready ? (phase ? C.green : C.white) : C.amberDim);
    text(11, 31, 'SPC PAUSE  ESC MENU  H HELP', C.amberDim);
  }

  // Foreman bar (v1.1 addendum) — only drawn if sim/barks populate run.foreman
  function drawForeman(run) {
    const f = run.foreman;
    if (!f || !f.text) return;
    const until = f.until || 0;
    if (run.totalT > until + 2 * D.TICK_HZ) return;         // faded out
    const full = String(f.text);
    const shown = U.clamp((run.totalT - (f.t0 || 0)) * 2, 0, full.length);  // typewriter
    text(0, 32, 'GRIT ▸', C.amber);
    text(7, 32, full.slice(0, shown).slice(-41), run.totalT > until ? C.amberDim : C.cyan);
  }

  // ================= TITLE =================
  function drawTitle(state) {
    const meta = state.meta || {};
    const lines = art('title');
    drawArt(lines, 1, artColor('title', C.amber));
    const below = Math.min(1 + lines.length + 1, 24);
    ctext(below, 'an automated descent toward the core', C.gray);
    ctext(below + 1, 'build the line · feed the drill · keep moving', C.amberDim);
    // menu
    const segs = [
      ['[ENTER]', C.green], [' BEGIN DESCENT   ', C.amber],
      ['[F]', C.green], [' THE FOUNDRY   ', C.amber],
      ['[H]', C.green], [' MANUAL', C.amber],
    ];
    let tot = 0;
    for (const s of segs) tot += s[0].length;
    let x = (COLS - tot) >> 1;
    for (const s of segs) { text(x, 28, s[0], s[1]); x += s[0].length; }
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
      ctext(4, 'STRATUM ' + target + ' — ' + nst.name, accent);
      const fi = Math.min(Math.floor(anim / 10), frames.length - 1);
      const fh = frames[fi].length;
      drawArt(frames[fi], 7, artColor('descent', C.orange));
      const d0 = (target - 1) * D.DEPTH_M;
      const dm = Math.min(target * D.DEPTH_M, d0 + Math.floor((anim / animLen) * D.DEPTH_M));
      ctext(Math.min(ROWS - 2, 8 + fh + 1), 'DEPTH -' + dm + 'm', C.gray);
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
      let yy = rowc + 1;
      const ic = DC.Art && DC.Art.schemIcons && DC.Art.schemIcons[id];   // v1.1, optional
      if (Array.isArray(ic)) {
        const icc = resolveColor(DC.Art.schemColors && DC.Art.schemColors[id]) || C.cyan;
        for (const ln of ic.slice(0, 5)) text(cx + Math.max(1, (w - ln.length) >> 1), yy++, ln, icc);
        yy++;
      } else yy++;
      for (const ln of wrap(sc.name, w - 4).slice(0, 2)) {
        text(cx + Math.max(1, (w - ln.length) >> 1), yy++, ln, C.white);
      }
      yy++;
      for (const ln of wrap(sc.desc, w - 4).slice(0, 4)) {
        text(cx + Math.max(1, (w - ln.length) >> 1), yy++, ln, C.gray);
      }
      const key = '[ ' + (i + 1) + ' ]';
      text(cx + ((w - key.length) >> 1), rowc + h - 2, key, C.green);
      layout.cards.push({ col: cx, row: rowc, w: w, h: h, id: id, index: i });
    }
    ctext(rowc + h + 2, 'CHOOSE ONE — [1-' + n + '] OR CLICK', C.amberDim);
  }

  // ================= FOUNDRY =================
  function drawFoundry(state) {
    const meta = state.meta || { cores: 0, upgrades: {} };
    const lines = art('foundry');
    drawArt(lines, 1, artColor('foundry', C.orange));
    let y = 1 + lines.length + 1;
    ctext(y, '◈ ' + (meta.cores || 0) + ' CORES', C.magenta);
    y += 2;
    for (let i = 0; i < D.META_UPGRADES.length; i++) {
      const up = D.META_UPGRADES[i];
      const lvl = (meta.upgrades && meta.upgrades[up.id]) || 0;
      const maxed = lvl >= up.max;
      const cost = maxed ? 0 : up.costs[lvl];
      const afford = !maxed && (meta.cores || 0) >= cost;
      const row = y + i;
      put(2, row, LETTERS[i], afford ? C.amber : C.darkgray);
      put(3, row, ')', C.darkgray);
      text(5, row, U.pad(up.name, 18), maxed ? C.amberDim : afford ? C.white : C.darkgray);
      if (lvl > 0) text(24, row, '█'.repeat(lvl), C.green);
      if (lvl < up.max) text(24 + lvl, row, '░'.repeat(up.max - lvl), C.darkgray);
      text(28, row, lvl + '/' + up.max, C.gray);
      text(33, row, maxed ? 'MAX ' : U.padL(cost + '◈', 4),
        maxed ? C.amberDim : afford ? C.magenta : shade(C.red, 0.8));
      text(39, row, up.desc.slice(0, COLS - 40), C.amberDim);
    }
    y += D.META_UPGRADES.length + 1;
    ctext(y, 'lifetime cores ' + (meta.totalCores || 0) + '   runs ' + (meta.runs || 0), C.darkgray);
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
    statsBlock(Math.min(1 + lines.length + 1, 26), fallbackResult(state.run, false));
    ctext(31, '[ENTER] RETURN TO THE SURFACE', phase ? C.white : C.amber);
  }

  function drawVictory(state, phase) {
    const lines = art('victory');
    drawArt(lines, 1, artColor('victory', C.magmaHot));
    const y = Math.min(1 + lines.length + 1, 24);
    statsBlock(y, fallbackResult(state.run, true));
    ctext(y + 5, '+' + D.WIN_CORES + ' ◈ CORE BONUS', phase ? C.magenta : shade(C.magenta, 0.6));
    ctext(31, '[ENTER] ASCEND      [C] CONTINUE INTO THE MANTLE', C.amber);
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

  // ================= public API =================
  const layout = { cards: [], buildRows: [] };

  DC.Render = {
    CW: CW, CH: CH,
    layout: layout,

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

    frame: function (state) {
      if (!ctx || !state) return;
      frameN++;
      const phase = Math.floor(frameN / 30) % 2;   // blink phase off the run clock
      clearBuf();
      try {
        switch (state.screen) {
          case 'run':      drawRun(state); break;
          case 'descend':  drawDescend(state); break;
          case 'foundry':  drawFoundry(state); break;
          case 'help':     drawHelp(); break;
          case 'gameover': drawGameover(state, phase); break;
          case 'victory':  drawVictory(state, phase); break;
          case 'title':
          default:         drawTitle(state); break;
        }
      } catch (e) {
        // never let a render fault kill the loop during parallel development
        text(1, 1, 'RENDER ERROR: ' + (e && e.message ? e.message : e), C.red);
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
