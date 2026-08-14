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
  // The BASE cell and its font size — the grid as it was authored, 80x33 of
  // 10x19 = 800x627. Everything on screen is this multiplied by `scale`
  // (M-HIRES Phase 1); nothing below ever hardcodes 10 or 19 again.
  const CW = 10, CH = 19, FONT_PX = 16;
  // Readability is a design objective (SPEC3 §0 law 6), and on a character
  // grid it starts with the font: a missing glyph is a tofu box and a
  // wrong-width one shears the whole row, because flush() batches a run of
  // cells into one fillText scaled by cw/adv.
  // The stack is ordered by coverage, one entry per platform:
  //   DejaVu Sans Mono  Linux, and the face every glyph here was chosen against
  //   Menlo             macOS — derived from the same Bitstream Vera ancestor
  //                     as DejaVu, so coverage and proportions nearly match.
  //                     WITHOUT it a Mac fell through to Courier New, whose
  //                     box-drawing and block coverage is poor: the game
  //                     looked broken on a platform we cannot see from here.
  //   Monaco            older macOS, before Menlo shipped
  //   Cascadia Mono / Consolas   Windows
  // `node tools/glyphs.js` prints the inventory any candidate must cover.
  //
  // M-HIRES Phase 2.5 puts a VENDORED face at the head of it: "Deepcore Mono",
  // a subset of DejaVu Sans Mono carrying exactly that inventory, embedded as
  // a data URI by vendor/deepcore-mono.css. The system stack stays behind it
  // as the fallback chain — if the webfont is blocked or fails, the game must
  // still be playable — but when it loads, every machine draws the same grid
  // and we stop guessing about platforms we cannot see.
  const FONT_FAMILY = 'Deepcore Mono';
  const FONT_STACK = '"' + FONT_FAMILY + '", "DejaVu Sans Mono", Menlo, Monaco, ' +
                     '"Cascadia Mono", Consolas, "Courier New", monospace';
  // Scale limits. Below 1 the glyphs stop being legible faster than the extra
  // fit is worth, so a phone-sized viewport keeps the full 800x627 and lets
  // style.css's max-width/max-height letterbox it. Above ~2.25 a 16px font has
  // become 36px and the terminal reads as a toy — a 4K panel gets margins
  // rather than 55px text.
  const MIN_SCALE = 1, MAX_SCALE = 2.25;
  const UNREV_BG = '#050504';        // near-black for unrevealed tiles (SPEC §7)
  // ---- panel geometry, DERIVED (M-WIDE) --------------------------------
  // These were the literals SB=49, SBW=31, SBC=50, SCW=29. They are computed
  // from COLS and MAP_W now, so the next widening is free: put a bigger
  // number in data.js and the columns fall out of it.
  //
  // The map box is MAP_W+2 wide at col 0, then one column of gutter, so the
  // panels start at MAP_W+3. Everything right of that is UI. A panel column
  // is 31 wide because that is what the SCAN panel's 29-column text contract
  // (Sim.SCAN_W) plus its two walls needs — NOT because 31 is half of what is
  // left. Spreading a column to 40 would not make one line of it easier to
  // read (§0 law 6); a second column of panels would.
  const SB = D.MAP_W + 3;            // 49 — first panel column
  const RIGHT_W = COLS - SB;         // 63 at 112 cols, 31 at 80
  const PANEL_W = 31;                // one panel column, walls included
  const TWO_COL = RIGHT_W >= PANEL_W * 2;
  const SBW = PANEL_W;
  const SBC = SB + 1, SCW = SBW - 2;                 // content col + width (29)
  // Second column: right-aligned to the last cell, so any slack between the
  // two columns becomes gutter rather than a ragged right edge.
  const SB2 = TWO_COL ? COLS - PANEL_W : -1;
  const SBW2 = TWO_COL ? PANEL_W : 0;
  const SBC2 = SB2 + 1, SCW2 = Math.max(0, SBW2 - 2);
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
  // Live metrics: the base cell times the current scale. `adv` is measured
  // from the font at `fontPx` and is therefore STALE the instant scale
  // changes — resize() re-measures it, and flush() maps it onto the `cw`
  // pitch, so a whole batched run stays grid-aligned at any size.
  let scale = 1, cw = CW, ch = CH, fontPx = FONT_PX;
  let font = FONT_PX + 'px ' + FONT_STACK;
  let fontReady = false;             // the vendored face has loaded and been measured
  let brailleOK = false;             // braille is present AND cell-width (probed)

  // Render's own animation clock (M-HIRES Phase 0). Same contract as fx.js's:
  // driven by elapsed milliseconds, expressed in virtual 60 fps frames, so the
  // gameover/victory blink, the flashPart pulse and the descent animation run
  // at wall speed on a 144 Hz monitor instead of 2.4x too fast. Throwaway
  // render state — nothing here ever feeds back into the sim.
  const RFPS = 60, RMS_PER_FRAME = 1000 / RFPS, RMAX_DT = 250;
  let clockMs = 0, frameN = 0, dFrames = 1, lastNow = null;
  function advanceClock(nowMs) {
    const prev = frameN;
    if (typeof nowMs !== 'number' || !isFinite(nowMs)) {
      clockMs += RMS_PER_FRAME;              // no host clock (tests): nominal step
    } else if (lastNow === null) {
      lastNow = nowMs;
      clockMs += RMS_PER_FRAME;
    } else {
      const dt = nowMs - lastNow;
      lastNow = nowMs;
      if (dt > 0) clockMs += Math.min(dt, RMAX_DT);
    }
    frameN = Math.round(clockMs * RFPS / 1000);
    dFrames = frameN - prev;
  }

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

  // ---------------- EGG-420 (M-GRITPLUS) ----------------
  // The window is sim state (run.egg, in run.totalT) — render reads it and
  // never writes it. The wash is a MIX toward leaf green, floored back to
  // readable by legible(): the map may look mellow, it may not look worse.
  function eggOn(run) {
    return !!(run && run.egg && D.EGG420 && run.totalT < run.egg.until);
  }
  function eggTint(hex) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const k = 'E' + hex;
    if (colCache[k]) return colCache[k];
    const leaf = C.leaf || C.green;
    let v = mix(hex, leaf, D.EGG420.tint);
    // The wash may not DEMOTE a colour: anything that cleared the text floor
    // before the window still clears it inside the window. (The floor tint and
    // the other deliberately-dim furniture are left dim — lifting those would
    // be painting, and would wreck the map's hierarchy for a joke.)
    if (contrast(hex, C.bg) >= MIN_CR && contrast(v, C.bg) < MIN_CR) v = legible(v, C.bg);
    colCache[k] = v;
    return v;
  }

  // ---------------- drawing primitives ----------------
  function box(col, row, w, h, color, title, titleColor) {
    const horiz = '─'.repeat(Math.max(0, w - 2));
    text(col, row, '┌' + horiz + '┐', color);
    for (let r = row + 1; r < row + h - 1; r++) { put(col, r, '│', color); put(col + w - 1, r, '│', color); }
    text(col, row + h - 1, '└' + horiz + '┘', color);
    if (title) text(col + 2, row, (' ' + title + ' ').slice(0, Math.max(0, w - 4)), titleColor || color);
  }
  // M-HIRES Phase 2: gauges fill in EIGHTHS of a cell, not whole cells.
  // A 13-cell integrity bar used to quantise to 7.7 points of hull; it now
  // resolves to under one, so the bar moves when the rig takes a hit instead
  // of sitting still for six of them and then jumping. That is the single
  // cheapest readability win in the brief (§0 law 6), and it costs one glyph
  // per bar — the partial cell is drawn in the FILL colour so the boundary
  // between "filled" and "track" stays unambiguous at a glance.
  //
  // Falls back to whole cells if art.js is absent (render is defensive about
  // its assets by contract) — the bar is never wrong, only coarser.
  function bar(col, row, width, frac, color) {
    frac = U.clamp(frac || 0, 0, 1);
    const R = DC.Art && DC.Art.raster;
    if (!R || !R.bar) {
      const n = Math.round(frac * width);
      if (n > 0) text(col, row, '█'.repeat(n), color);
      if (n < width) text(col + n, row, '░'.repeat(width - n), C.darkgray);
      return;
    }
    const b = R.bar(frac, width);
    let x = col;
    if (b.full > 0) { text(x, row, '█'.repeat(b.full), color); x += b.full; }
    if (b.part) { put(x, row, b.part, color); x += 1; }
    if (b.rest > 0) text(x, row, '░'.repeat(b.rest), C.darkgray);
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

  // ---------------- contrast (M-MANUAL) ----------------
  // The map's palette is tuned for tiles on black: obsidian sits at 1.34:1 and
  // chasm at 1.22:1, which is right for a wall you are meant to squint past and
  // wrong for a glossary entry you are meant to read. `legible` walks a colour
  // toward white until it clears the 4.5:1 text floor, so the manual can print
  // every glyph in its TRUE game colour and still be readable — same hue, same
  // identity, enough light. Nothing else in the renderer uses it: tiles keep
  // their real colours.
  const MIN_CR = 4.5;
  function relLum(hex) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return 0;
    let v = 0;
    const w = [0.2126, 0.7152, 0.0722];
    for (let i = 0; i < 3; i++) {
      let c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      v += w[i] * c;
    }
    return v;
  }
  function contrast(a, b) {
    const x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function legible(hex, over) {
    const bgc = over || C.bg;
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const k = 'L' + hex + bgc;
    if (colCache[k]) return colCache[k];
    let out = hex;
    for (let t = 0; t <= 20 && contrast(out, bgc) < MIN_CR; t++) out = mix(hex, C.white, t / 20);
    colCache[k] = out;
    return out;
  }

  // ---------------- art access (defensive) ----------------
  function placeholder(name) {
    const inner = ' ' + name + ' ';
    const h = '─'.repeat(inner.length);
    return ['┌' + h + '┐', '│' + inner + '│', '└' + h + '┘'];
  }
  function artWidth(lines) {
    let w = 0;
    for (const ln of lines) if (ln.length > w) w = ln.length;
    return w;
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
  // M-WIDE: the production model behind the STOCK trends and the CHAIN panel.
  // Cached per (run, tick) because three panels ask for it on every frame and
  // it walks every machine; the cache is throwaway render state and can never
  // feed back into the sim (SPEC3 rule 4).
  let chainRun = null, chainT = -1, chainVal = null;
  function chainSafe(run) {
    if (!run) return null;
    if (chainRun === run && chainT === run.t) return chainVal;
    let v = null;
    try {
      if (DC.Sim && DC.Sim.chain) v = DC.Sim.chain(run);
    } catch (e) { /* sim in flux */ }
    chainRun = run; chainT = run.t; chainVal = v;
    return v;
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
    text(0, 1, '─'.repeat(SB - 1), C.amberDim);

    // map box rows 2..29, cols 0..47; interior = 46x26 at (MAP_X, MAP_Y)
    box(0, 2, 48, 28, accent, 'STRATUM ' + run.depth + ' ─ ' + st.name, C.white);

    if (floorTintDepth !== run.depth) {
      floorTintDepth = run.depth;
      floorTint = mix(D.TERRAIN.floor.color, accent, 0.25);
    }
    drawMap(run, ui, phase);
    drawSidebar(run, ui, phase, st, state.meta);
    drawPanels(run, ui, phase, st, state.meta);
    drawHints(run, ui, phase);
    drawForeman(run);

    // flash banner: centered inverse block over the map
    const fl = ui.flash;
    if (fl && fl.text && (!fl.until || run.t < fl.until)) {
      const s = (' ' + fl.text + ' ').slice(0, D.MAP_W);
      const fc = resolveColor(fl.color) || C.amber;
      text(D.MAP_X + Math.max(0, (D.MAP_W - s.length) >> 1), D.MAP_Y + 11, s, C.bg, fc);
    }

    // M-CORELORE: the Core Gate's middle beat offers you the surface back. The
    // prompt is a lie — nothing is bound to it, ENTER still does what ENTER
    // always does, and GRIT talks over it a beat later. It is drawn in the
    // Core's gold rather than the game's green, so the screen is at least
    // honest about WHO is lying to you.
    const off = run.coreOffer;
    if (off && run.totalT < (off.until || 0)) {
      const gold = C.gold || C.amber;
      const s = '[ENTER] ASCEND — THE SURFACE IS STILL THERE';
      text(D.MAP_X + Math.max(0, (D.MAP_W - s.length) >> 1), D.MAP_Y + 14, s,
           phase ? gold : shade(gold, 0.55));
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
    const egg = eggOn(run);

    // M-WONDERS: this stratum's landmark. `warm` is the one aura that is drawn
    // rather than merely felt — the Warm Spot's whole proposition is "build
    // HERE", which is a question about floor, so the floor answers it. The
    // other auras stay invisible on purpose: tinting a radius-5 disc under a
    // working base would cost more legibility than it buys (SPEC3 §0 law 6).
    const lmk = run.landmark;
    const lmDef = lmk && D.LANDMARK_BY_ID ? D.LANDMARK_BY_ID[lmk.id] : null;
    const lmJam = lmDef && lmDef.jam && lmk.on && DC.Sim && DC.Sim.landmarkJammed
      ? DC.Sim.landmarkJammed(run) : false;
    const warm = (lmDef && lmDef.quakeSafe && lmDef.aura)
      ? { cx: lmk.cx, cy: lmk.cy, r2: lmDef.aura.r * lmDef.aura.r } : null;
    const warmFloor = warm ? mix(floorTint, C.amber, 0.45) : floorTint;
    // A landmark's colour is a state readout, not decoration: dormant until
    // it is paid for, and the Drowned Machine visibly dims while she naps.
    const lmColor = !lmDef ? null
      : (C[(lmk.on && lmDef.onColor) || lmDef.color] || C.white);

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
        if (warm && tile.t === 'floor' &&
            (x - warm.cx) * (x - warm.cx) + (y - warm.cy) * (y - warm.cy) <= warm.r2)
          fg = warmFloor;
        if (tile.t === 'magma' && phase) fg = C.magmaHot;
        if (tile.ore && D.ORE_GLYPHS[tile.ore]) {
          const og = D.ORE_GLYPHS[tile.ore];
          ch = og.glyph;
          fg = tile.oreAmt < 25 ? shade(og.color, 0.55) : og.color;
        }
        // M-WONDERS: the wonder outranks the terrain it replaced.
        if (tile.lm) {
          ch = tile.lm.g;
          fg = lmColor || C.white;
          if (lmJam && tile.lm.id === lmk.id && phase) fg = shade(fg, 0.45);
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
        // EGG-420: the botanical wash. TINT, DON'T PAINT — every glyph keeps
        // its own colour and its own identity, nudged a sixth of the way
        // toward leaf green and then held to the 4.5:1 floor. Coal still reads
        // as coal, magma still reads as magma, and the map is never harder to
        // read during the 42 seconds than it was before them (SPEC3 §0 law 6).
        if (egg) fg = eggTint(fg);
        put(gc, gr, ch, fg);
      }
    }

    // M-EVENTS: the cat, drawn over the tiles and under the cursor. Her
    // COLOUR is state, the same way every other glyph on this map is: dim
    // while she is wandering, ember while she is sitting on a lit furnace,
    // and bright white the moment she breaks for the rig — which is the two
    // seconds before a quake, and the only reason a player has to keep half
    // an eye on her (SPEC3 §0 law 1).
    const cat = (DC.Events && DC.Events.cat) ? DC.Events.cat(run) : null;
    if (cat && run.grid[cat.y] && run.grid[cat.y][cat.x] &&
        run.grid[cat.y][cat.x].revealed) {
      const cc = cat.mode === 'flee' ? C.white
        : cat.mode === 'perch' ? C.magmaHot
        : shade(C.white, 0.7);
      mapPut(cat.x, cat.y, 'c', egg ? eggTint(cc) : cc, xo);
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
  // One panel column's furniture. `col`/`w` are passed so the same two
  // primitives draw both columns (M-WIDE); sideEdge/sideWalls stay as the
  // column-A shorthand every existing caller already reads as.
  function panelEdge(col, w, row, kind, title, titleColor) {
    const l = kind === 'top' ? '┌' : kind === 'bot' ? '└' : '├';
    const r = kind === 'top' ? '┐' : kind === 'bot' ? '┘' : '┤';
    text(col, row, l + '─'.repeat(w - 2) + r, C.amberDim);
    if (title) text(col + 2, row, (' ' + title + ' ').slice(0, w - 4), titleColor || C.amber);
    return row + 1;
  }
  function panelWalls(col, w, row) {
    put(col, row, '│', C.amberDim);
    put(col + w - 1, row, '│', C.amberDim);
  }
  function sideEdge(row, kind, title, titleColor) {
    return panelEdge(SB, SBW, row, kind, title, titleColor);
  }
  function sideWalls(row) { panelWalls(SB, SBW, row); }

  function drawSidebar(run, ui, phase, st, meta) {
    const req = run.breachReq || { gear: 0, charge: 0 };
    const gGlyph = D.ITEMS.gear.glyph, cGlyph = D.ITEMS.charge.glyph;
    let y = 1;

    // RIG — the hull's two gauges. The owned-upgrade glyph strip that used to
    // ride this header row (v1.1 §C.2) was a compact stand-in for a picture we
    // could not afford at 80 columns; at 112 the second column draws the rig
    // itself, parts and all, so the strip is only kept where that panel is not
    // (M-WIDE: reward is a picture changing, not a row of runes).
    let edge = y;
    y = sideEdge(y, 'top', 'RIG');
    if (!TWO_COL) {
      const ups = (meta && meta.upgrades) || {};
      let gx = SB + SBW - 3;
      for (let i = D.META_UPGRADES.length - 1; i >= 0 && gx > SB + 7; i--) {
        const id = D.META_UPGRADES[i].id;
        if (!(ups[id] > 0)) continue;
        const g = UP_GLYPHS[id] || ['·', 'gray'];
        put(gx--, edge, g[0], resolveColor(g[1]) || C.amber);
      }
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

    // CHAIN — the teacher (M-WIDE). It sits directly under DRILL because it
    // explains the number DRILL prints: the feed rate is an outcome, and this
    // is where the outcome is decided.
    y = drawChainPanel(y, run, meta, phase);

    const inv = run.inv || {};
    // STOCK lives in the second column when there is one (M-WIDE: eight items,
    // one per row, with icons and a trend). At 80 columns it stays here, two
    // to a row, exactly as it was.
    if (!TWO_COL) {
      y = sideEdge(y, 'sep', 'STOCK');
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
    }

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
      // M-WIDE: the same 3-cell pictogram treatment as STOCK, so the thing you
      // are about to place and the thing it will eat look like each other.
      const bIcon = buildIcon(t);
      if (ui.tool === t) {
        text(SBC, y, U.pad(b.key + ' ' + bIcon + ' ' + U.pad(b.name, 10), SCW - costS.length) + costS,
          C.bg, C.amber);
      } else {
        const bad = shade(C.red, 0.8);
        put(SBC, y, b.key, C.amber);
        text(SBC + 2, y, bIcon, b.color);
        text(SBC + 6, y, U.pad(b.name, 10), afford ? C.gray : bad);
        textR(SB + SBW - 2, y, costS, afford ? (free ? C.green : C.amberDim) : bad);
      }
      layout.buildRows.push({ row: y, col: SB, w: SBW, tool: t });
      y++;
    }
    sideWalls(y);
    if (ui.tool === 'demolish') text(SBC, y, U.pad('X  ×  demolish', SCW), C.bg, C.amber);
    else {
      put(SBC, y, 'X', C.amber);
      put(SBC + 3, y, '×', C.red);
      text(SBC + 6, y, 'demolish', C.gray);
    }
    layout.buildRows.push({ row: y, col: SB, w: SBW, tool: 'demolish' });
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

  // ---- PANEL 4: CHAIN — the teacher --------------------------------------
  // The director could not work out what a smelter was for, and had to ask.
  // Page one of the manual explains the chain and he still had to ask, because
  // the manual is behind H and the chain is a LIVE thing you need to see while
  // it is failing. So: one row per stage, how many machines, the real rate,
  // and the limiting stage named in the warning colour.
  //
  // The number that matters most is the one nobody works out on their own: a
  // smelter makes 0.5 plate/s and a gear assembler eats 0.73, so one smelter
  // cannot feed one assembler. With that base standing, this panel says
  // 'plate 1S 0.50/s ←STARVED' — which is the whole lesson, in a row.
  //
  // And a projection, because a base is a clock: 'BREACH ~2:14'. Never a
  // quake countdown — that one is forbidden (SPEC3 §0 law 8), and the two
  // readouts are opposites: one is the plan, the other is the thing that
  // happens to the plan.
  const CHAIN_NAME_X = 2, CHAIN_N_X = 9, CHAIN_RATE_R = 18, CHAIN_FLAG_X = 20;
  function fmtRate(r) {
    if (!(r > 0)) return '—';
    // two decimals below ten, so the three stages read as one column of
    // numbers you can compare at a glance (0.50 against 0.36, not 1.0)
    return (r >= 10 ? r.toFixed(0) : r.toFixed(2)) + '/s';
  }
  function drawChainPanel(y, run, meta, phase) {
    const ch = chainSafe(run);
    y = sideEdge(y, 'sep', 'CHAIN');
    if (!ch) return y;
    for (const s of ch.stages) {
      sideWalls(y);
      const it = D.ITEMS[s.item] || {};
      const dead = s.n === 0;
      put(SBC, y, it.glyph || '·', dead ? C.darkgray : it.color);
      text(SBC + CHAIN_NAME_X, y, s.name, dead ? C.darkgray : C.gray);
      text(SBC + CHAIN_N_X, y, s.n + s.letter, dead ? C.darkgray : C.white);
      textR(SBC + CHAIN_RATE_R, y, fmtRate(s.rate), dead ? C.darkgray : C.white);
      if (s.flag) {
        // the warning colour, and only on the stage that is actually holding
        // the base back — a panel that shouts at three rows teaches nothing
        // steady, not blinking: a bottleneck is a state that lasts minutes,
        // and the blink is reserved for the things that are about to hurt
        text(SBC + CHAIN_FLAG_X, y, ('←' + s.flag).slice(0, SCW - CHAIN_FLAG_X),
          s.flag === 'NONE' ? C.amberDim : C.red);
      }
      y++;
    }
    // the projection, and the ghost you are racing (M-RECAP's split, which
    // asks the same question this row answers)
    sideWalls(y);
    const ready = run.status === 'breachReady';
    if (ready) {
      text(SBC, y, 'BREACH READY [D]', phase ? C.white : C.green);
    } else if (ch.breachSec === null || !isFinite(ch.breachSec)) {
      // nothing is making what the rig still wants; the stage flags above
      // already say which link is missing, so this row does not repeat it
      text(SBC, y, 'BREACH  —', C.red);
    } else {
      text(SBC, y, 'BREACH ~' + fmtTime(ch.breachSec), C.amber);
    }
    const gs = ghostSplit(run, meta);
    if (gs) {
      textR(SB + SBW - 2, y, 'BEST ' + gs.mark + fmtDelta(gs.delta),
        gs.delta >= 0 ? C.green : C.red);
    }
    return y + 1;
  }

  // ================= THE SECOND PANEL COLUMN (M-WIDE) =================
  // Four panels answering four different questions — what you are (RIG),
  // what you have (STOCK), what you picked (LOADOUT), what it is all doing
  // (CHAIN, which lives in column A next to the drill it explains). Four that
  // breathe rather than nine that cram: every one of them is allowed to leave
  // columns empty, because a short line in a wide gutter reads better than a
  // packed one (§0 law 6).
  //
  // Nothing in here spends from run.rng (§0 law 7) and nothing writes state.
  // And nothing in here — not a countdown, not a gauge, not an estimate —
  // says anything about when the next quake lands (§0 law 8).

  // Ground colours: the rig portrait's bottom rows are rock, and rock takes
  // the stratum's accent so the picture says which floor you are standing on.
  const GROUND_CH = '▓▒░█▀';
  const RIG_GROUND_ROW = 7;              // rigBase row 7 is the surface line

  function drawRigPanel(y, run, meta, accent) {
    y = panelEdge(SB2, SBW2, y, 'top', 'YOUR RIG');
    const rig = composeRigSafe(meta && meta.upgrades) || placeholder('rig');
    const h = Math.min(rig.length, 12);
    const ox = SBC2 + Math.max(0, (SCW2 - blockWidth(rig)) >> 1);
    const ground = mix(C.rock, accent || C.amber, 0.35);
    for (let i = 0; i < h; i++) {
      panelWalls(SB2, SBW2, y + i);
      const ln = rig[i].slice(0, SCW2);
      for (let j = 0; j < ln.length; j++) {
        if (ln[j] === ' ') continue;
        const rock = i >= RIG_GROUND_ROW && GROUND_CH.indexOf(ln[j]) >= 0;
        put(ox + j, y + i, ln[j], rock ? ground : C.amber);
      }
    }
    // published for fx.js and the suites: where the in-run rig actually landed
    layout.runRig = { x: ox, y: y, w: blockWidth(rig), h: h };
    return y + h;
  }

  // ---- PANEL 2: STOCK — all eight items, one per row, with a trend --------
  // The old panel crammed whatever was nonzero into two rows of two, so the
  // list changed SHAPE as the run went on and nothing was ever in the same
  // place twice. Eight fixed rows: an item at zero is information too, and a
  // row you can find without reading is the whole point (§0 law 6).
  //
  // The feature is the arrow. A count is a fact about the past; '68 ↑' is the
  // sentence "your extractors are outrunning your smelters", which is the
  // decision the player is actually facing, without them doing the
  // arithmetic. It reads Sim.chain's net flow — capacity in minus capacity
  // out — so it is a statement about the base, not a sampled derivative that
  // would flicker every time a belt hiccuped.
  const TREND_EPS = 0.02;              // per second: below this it is flat
  const SCHEM_NAME_W = 13;             // LOADOUT name field (art.js authors to it)
  function trendMark(net) {
    if (net > TREND_EPS) return ['↑', C.green];
    if (net < -TREND_EPS) return ['↓', C.red];
    return ['·', C.darkgray];
  }
  function itemIcon(id) {
    const ic = DC.Art && DC.Art.itemIcons && DC.Art.itemIcons[id];
    if (typeof ic === 'string' && ic.length) return ic;
    return ' ' + ((D.ITEMS[id] || {}).glyph || '?') + ' ';
  }
  function buildIcon(t) {
    const ic = DC.Art && DC.Art.buildIcons && DC.Art.buildIcons[t];
    if (typeof ic === 'string' && ic.length) return ic;
    return ' ' + ((D.BUILDINGS[t] || {}).letter || '?') + ' ';
  }
  function drawStockPanel(y, run, ch) {
    y = panelEdge(SB2, SBW2, y, 'sep', 'STOCK');
    const inv = run.inv || {};
    const flow = (ch && ch.flow) || {};
    for (let i = 0; i < D.ITEM_ORDER.length; i++) {
      const id = D.ITEM_ORDER[i];
      const it = D.ITEMS[id];
      const n = inv[id] || 0;
      const idle = n === 0 && !flow[id];
      panelWalls(SB2, SBW2, y);
      const x = SBC2 + 1;
      text(x, y, itemIcon(id), idle ? shade(it.color, 0.45) : it.color);
      text(x + 4, y, itemLabel(id).slice(0, STOCK_NAME_W), idle ? C.darkgray : C.gray);
      // count and arrow ride the right edge: one column of numbers the eye
      // can run down, rather than eight ragged ones
      textR(SB2 + SBW2 - 4, y, stockCount(n), n ? C.white : C.darkgray);
      const tm = trendMark(flow[id] || 0);
      put(SB2 + SBW2 - 2, y, tm[0], tm[1]);
      y++;
    }
    return y;
  }

  // ---- PANEL 3: LOADOUT — what you are actually running ------------------
  // run.schematics is tracked for the whole run and displayed for the four
  // seconds the pick screen is up. Twenty minutes later the player cannot
  // tell you whether the belts are free, and plays as though they are not.
  // One row each, permanently: badge in its own colour, short name, effect.
  function schemShort(id) {
    const A = DC.Art;
    const s = A && A.schemShort && A.schemShort[id];
    if (typeof s === 'string' && s.length) return s;
    const def = D.SCHEMATICS.find(x => x.id === id);
    return def ? def.name : String(id);
  }
  function schemEffect(id) {
    const A = DC.Art;
    const s = A && A.schemEffect && A.schemEffect[id];
    return typeof s === 'string' ? s : '';
  }
  function drawLoadoutPanel(y, run) {
    y = panelEdge(SB2, SBW2, y, 'sep', 'LOADOUT');
    const rowsAvail = (ROWS - 1) - y;              // the bottom edge closes it
    const scs = run.schematics || [];
    const nameX = SBC2 + 4, effX = SBC2 + 4 + SCHEM_NAME_W + 1;
    const effW = SB2 + SBW2 - 1 - effX;
    if (!scs.length) {
      for (let i = 0; i < rowsAvail; i++) panelWalls(SB2, SBW2, y + i);
      if (rowsAvail > 0) text(SBC2 + 1, y, 'nothing picked yet', C.darkgray);
      if (rowsAvail > 1) text(SBC2 + 1, y + 1, 'one per breach', C.darkgray);
      return y + rowsAvail;
    }
    // Deep runs collect more than fit. The OLDEST are the ones that have
    // faded, so they are the ones kept on screen — the newest was announced
    // in the LOG a minute ago and is still in the player's head.
    const drop = Math.max(0, scs.length - rowsAvail);
    for (let i = 0; i < rowsAvail; i++) {
      panelWalls(SB2, SBW2, y + i);
      if (drop && i === rowsAvail - 1) {
        text(SBC2 + 1, y + i, '+' + (drop + 1) + ' more', C.darkgray);
        break;
      }
      const id = scs[i];
      if (id === undefined) continue;
      text(SBC2 + 1, y + i, schemBadge(id), schemColor(id));
      text(nameX, y + i, schemShort(id).slice(0, SCHEM_NAME_W), C.gray);
      text(effX, y + i, schemEffect(id).slice(0, effW), C.amberDim);
    }
    return y + rowsAvail;
  }

  function drawPanels(run, ui, phase, st, meta) {
    if (!TWO_COL) { layout.runRig = null; return; }
    const accent = st.accent || C.amber;
    const ch = chainSafe(run);
    let y = 1;
    y = drawRigPanel(y, run, meta, accent);
    y = drawStockPanel(y, run, ch);
    y = drawLoadoutPanel(y, run);
    panelEdge(SB2, SBW2, Math.min(y, ROWS - 1), 'bot');
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
  //
  // M-CORELORE: the same bar carries the game's second voice. When barks marks
  // the line `voice: 'core'` it is the planet talking, and everything about
  // the draw changes so you know that before you have read a word: no GRIT
  // tag (just a gold ▸ where his name should be), gold instead of cyan, and
  // half the typing speed — it is not in a hurry and never has been. The
  // geometry is untouched, so the 2×41 wrap contract holds for both voices.
  function drawForeman(run) {
    const f = run.foreman;
    if (!f || !f.text) return;
    const until = f.until || 0;
    if (run.totalT > until + 2 * D.TICK_HZ) return;          // faded out
    const fading = run.totalT > until;
    const core = f.voice === 'core';
    const full = String(f.text);
    const shown = U.clamp(Math.floor((run.totalT - (f.t0 || 0)) * (core ? 1 : 2)),
                          0, full.length);
    const w = SB - 1 - 7;                                    // 41 cols per row
    if (core) {
      const gold = C.gold || C.amber;
      const rows = wrapClamp(full, w, 2);
      put(5, 31, '▸', fading ? shade(gold, 0.55) : gold);
      let left = shown;
      for (let i = 0; i < rows.length && left > 0; i++) {
        text(7, 31 + i, rows[i].slice(0, left), fading ? shade(gold, 0.55) : gold);
        left -= rows[i].length + 1;
      }
      return;
    }
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
    // M-EVENTS: once she has been found she is on the title rig ever after —
    // the progression the player will actually mention to somebody. Sat on
    // the rig's shoulder, one cell, no explanation offered.
    if (meta.catFound && layout.title.rig) {
      const rg = layout.title.rig;
      put(rg.x + rg.w + 1, rg.y + Math.min(2, rg.h - 1), 'c', shade(C.white, 0.85));
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
  // M-GRITPLUS: elevator graffiti. One line of shaft wall slides UP the screen
  // while the cage goes down, in the band under the descent frames — the
  // A2 interstitial's slot if that dispatch landed, plain rows below the art
  // if it did not. Which line you get is a pure hash of the run seed and the
  // floor you are leaving: render never touches run.rng (a draw here would
  // change the map the player is dropping into), and the same descent always
  // shows the same wall.
  function graffitiFor(run, target) {
    const pool = DC.Art && DC.Art.graffiti;
    if (!Array.isArray(pool) || !pool.length) return null;
    let h = 0x811c9dc5;
    const s = String(((run && run.seed) >>> 0)) + ':' + target;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return pool[(h >>> 1) % pool.length];
  }
  function drawGraffiti(run, target, prog, band) {
    const line = graffitiFor(run, target);
    if (!line || band >= ROWS - 1) return;
    const rows = Math.max(1, ROWS - 1 - band);            // the band it rides
    const row = band + Math.floor((1 - U.clamp(prog, 0, 1)) * rows);
    if (row < band || row >= ROWS) return;
    const s = String(line).slice(0, D.COLS - 4);
    // it passes the light: bright at eye level, dim as it leaves the frame
    const mid = band + (rows >> 1);
    const near = Math.abs(row - mid) <= 1;
    const lit = legible(C.rock, C.bg);                    // spray paint, but readable
    ctext(row, s, near ? lit : shade(lit, 0.7));
  }

  function drawDescend(state) {
    const run = state.run, ui = state.ui || {};
    const frames = artFrames();
    const animLen = frames.length * 10 + 45;      // ~2.5 s at 60 fps incl. hold
    const anim = ui.descendAnim || 0;
    const target = run ? run.depth + 1 : 1;
    const nst = stratumOf(target);
    const accent = nst.accent || C.amber;

    if (anim < animLen || !run || !run.pendingOffers) {
      ui.descendAnim = anim + dFrames;            // render advances the anim counter (SPEC §7)
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
      const depthRow = Math.min(ROWS - 2, 8 + fh + 1);
      ctext(depthRow,
        'DEPTH -' + fxOdometer('descend', target * D.DEPTH_M, prog, String(dm)) + 'm', C.gray);
      drawGraffiti(run, target, prog, depthRow + 1);
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
  // The Foundry page's two columns, as a block that centres itself: the rig
  // box, a gutter, and the upgrade list (44 columns holds the longest desc,
  // 'Instability rises 12% slower (per level).', with air to spare).
  const FOUNDRY_RIG_W = 28, FOUNDRY_GAP = 3, FOUNDRY_LIST_W = 46;
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

    // Two columns — the rig, and what can be bolted to it — CENTRED as one
    // block (M-WIDE). They used to start at col 1 because col 1 was as far
    // left as 80 columns allowed; at 112 that would leave the forge art
    // centred over a page pinned to the left edge.
    const py = 10;
    const fx0 = Math.max(0, (COLS - (FOUNDRY_RIG_W + FOUNDRY_GAP + FOUNDRY_LIST_W)) >> 1);
    box(fx0, py, FOUNDRY_RIG_W, 14, C.amberDim, 'YOUR RIG', C.amber);
    drawRigPortrait(fx0 + 1, py + 1, FOUNDRY_RIG_W - 2, meta.upgrades, activeFlash(ui));

    // right column: upgrade list (2 rows each: stat line + dim desc)
    const lx = fx0 + FOUNDRY_RIG_W + FOUNDRY_GAP;
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
      text(lx + 3, row + 1, up.desc.slice(0, FOUNDRY_LIST_W - 3), C.darkgray);
    }

    // Foreman surface (M-POLISH backlog): GRIT talks on the Foundry floor even
    // with no live run — the engine parks the last foundryBuy line here.
    // Accepts a bare string or {line}, so the engine side can grow.
    const fbRaw = state.foundryBark;
    const fb = typeof fbRaw === 'string' ? fbRaw : (fbRaw && fbRaw.line);
    if (fb) ctext(28, 'GRIT ▸ ' + String(fb).slice(0, 70), C.cyan);

    ctext(29, 'lifetime cores ' + (meta.totalCores || 0) + '   runs ' + (meta.runs || 0), C.darkgray);
    ctext(31, '[A-I] FORGE UPGRADE   [L] LOGBOOK   [ESC] RETURN TO SURFACE', C.amber);
  }

  // ================= THE VIGNETTE SCREEN (M-EVENTS) =================
  // The dark asks a question between two strata. The layout is built around
  // one demand from SPEC3 §0 law 6: a player who has been staring at a dense
  // factory for four minutes has to take this in at a glance. So it is one
  // picture, two lines of prose in a comfortable measure, and two choices in
  // a column with their consequences under them — the same [1]/[2] idiom the
  // schematic cards already taught, turned on its side because these are
  // sentences rather than cards.
  const VG_X = (COLS - 40) >> 1;      // the 40-wide panel, centred
  const VG_ROW = 3;
  const VG_PROSE_W = 64;
  // The choices hang off the panel's own left edge (M-WIDE): at 80 columns
  // col 12 was that edge; at 112 a fixed 12 would strand them out in the dark.
  const VG_CHOICE_X = VG_X;
  function drawVignette(state) {
    const run = state.run, ui = state.ui || {};
    const ev = (DC.Events && DC.Events.pending) ? DC.Events.pending(run) : null;
    const accent = stratumOf(run ? run.depth : 1).accent || C.amber;
    if (!ev) {                       // never a blank screen, even mid-edit
      ctext(15, 'THE DARK HAS NOTHING TO SAY', C.gray);
      ctext(17, '[ENTER] CARRY ON', C.amber);
      return;
    }

    // The title types itself in the stratum's accent — the same interstitial
    // grammar the descent screen uses, so this reads as part of the descent
    // rather than as a modal that interrupted it.
    ctext(1, fxTyped('vignette:' + ev.id, ev.title, 26), accent);

    const frame = (DC.Art && DC.Art.eventFrame) ? DC.Art.eventFrame(ev.id) : [''];
    box(VG_X, VG_ROW, 40, 14, mix(accent, C.bg, 0.55));
    const inner = frame.slice(0, 12);
    // The BLOCK is centred, never the individual rows: a panel whose rows are
    // different lengths (they all are) would shear into nonsense if each row
    // found its own centre.
    const ax = VG_X + 1 + blockX(inner, 38);
    let ay = VG_ROW + 1 + Math.max(0, (12 - inner.length) >> 1);
    for (const ln of inner) text(ax, ay++, ln.slice(0, 38), C.rock);

    let py = VG_ROW + 15;
    for (const p of (ev.text || []).slice(0, 2)) {
      for (const ln of wrap(p, VG_PROSE_W).slice(0, 1)) ctext(py++, ln, C.gray);
    }

    const rows = [];
    let cy = py + 2;
    for (let i = 0; i < ev.choices.length && i < 2; i++) {
      const c = ev.choices[i];
      const hot = ui.hoverChoice === i;
      const key = '[' + (i + 1) + ']';
      text(VG_CHOICE_X, cy, key, C.green);
      text(VG_CHOICE_X + 4, cy, c.label, hot ? C.white : C.amber);
      if (c.hint) text(VG_CHOICE_X + 4, cy + 1, c.hint, C.darkgray);
      rows.push({ col: VG_CHOICE_X, row: cy, w: Math.max(1, COLS - 2 * VG_CHOICE_X), h: 2, index: i });
      cy += 3;
    }
    layout.choices = rows;
    ctext(ROWS - 2, 'CHOOSE — [1] OR [2]', C.amberDim);
  }

  // ================= THE LOGBOOK (M-EVENTS) =================
  // Twenty rigs that didn't come back up, one line each, collected across
  // runs. The unfound ones are drawn as the SHAPE of a missing line rather
  // than hidden: the page has to read as a jigsaw with holes in it, or
  // filling one in is a number going up instead of a picture changing
  // (SPEC3 §0 law 5). The dots are furniture and answer to the 3:1 floor;
  // the entries themselves are gold, the colour the LOG already gives a
  // found log, so the two readings of the same line agree.
  const LOG_ROW0 = 5;                       // first entry row
  // The page is 78 columns — a 70-column entry (the ceiling every authored
  // line in this game answers to) plus its number column — and it CENTRES
  // itself rather than starting at a fixed left margin, so the entries sit
  // under the masthead at any width. A logbook that clips its own entries
  // mid-word is worse than no logbook: the whole page exists to be read
  // (SPEC3 §0 law 6).
  const LOG_PAGE_W = 78;
  const LOG_COL = Math.max(0, (COLS - LOG_PAGE_W) >> 1);  // number column
  const LOG_TEXT = LOG_COL + 5;             // where the entry itself starts
  const LOG_W = LOG_PAGE_W - 5;
  function drawLogbook(state) {
    const meta = state.meta || {};
    const E = DC.Events;
    const logs = (E && E.LOGS) || [];
    const found = (DC.Meta && DC.Meta.logbook) ? DC.Meta.logbook(meta) : [];
    const dim = mix(C.gray, C.bg, 0.5);

    ctext(1, 'DEAD FOREMEN OF THE DEEP', C.amber);
    ctext(2, 'what they wrote down before the rock had them', C.gray);
    text(LOG_COL, 3, '─'.repeat(LOG_PAGE_W), mix(C.amber, C.bg, 0.42));

    for (let i = 0; i < logs.length && LOG_ROW0 + i < ROWS - 4; i++) {
      const row = LOG_ROW0 + i;
      const has = found.indexOf(i) >= 0;
      text(LOG_COL, row, U.padL(String(i + 1), 2), has ? C.amberDim : C.darkgray);
      put(LOG_COL + 3, row, '▸', has ? C.amber : C.darkgray);
      if (has) {
        text(LOG_TEXT, row, logs[i].slice(0, LOG_W), C.gold);
      } else {
        // the hole, drawn to the true width of the line that belongs in it
        text(LOG_TEXT, row, '·'.repeat(Math.min(LOG_W, logs[i].length)), dim);
      }
    }
    const n = found.length, tot = logs.length;
    ctext(ROWS - 3, 'RECOVERED ' + n + ' / ' + tot +
      (n >= tot && tot > 0 ? '  —  the whole book' : ''),
      n >= tot && tot > 0 ? C.green : C.gray);
    ctext(ROWS - 1, '[ESC] BACK TO THE FOUNDRY', C.amber);
  }

  // ================= HELP: THE FIELD MANUAL (M-MANUAL) =================
  // art.js composes the pages and hands render two projections of one grid:
  // plain text (what the suites lint) and coloured spans (what lands here).
  // Render owns presentation only — resolve the tier names, lift true game
  // colours to a readable level, paint 'key' cells inverse. No text, no
  // number and no key label is authored on this side.
  const HELP_TIER = {
    head:   C.amber,                     // section headers, the masthead
    body:   C.gray,                      // prose (5.5:1 — warm, dim, readable)
    bright: C.white,                     // the figures themselves
    grit:   C.cyan,                      // the foreman's one contribution
    key:    C.amber,                     // keycaps: this is their BACKGROUND
    rule:   mix(C.amber, C.bg, 0.42),    // hairlines under the headers
  };
  function helpColor(c) {
    if (!c) return HELP_TIER.body;
    if (HELP_TIER[c]) return HELP_TIER[c];
    return legible(resolveColor(c) || HELP_TIER.body, C.bg);
  }
  function helpPages() {
    const A = DC.Art;
    return (A && Array.isArray(A.helpPages) && A.helpPages.length &&
            Array.isArray(A.helpPages[0].rows)) ? A.helpPages : null;
  }
  function helpIndex(state, n) {
    const i = (state && state.ui && state.ui.helpPage) | 0;
    return U.clamp(i, 0, n - 1);
  }
  function drawHelp(state) {
    const pages = helpPages();
    if (!pages) {                        // art.js half-loaded: never crash
      const lines = art('help');
      const start = Math.max(1, (ROWS - lines.length) >> 1);
      drawArt(lines, start, artColor('help', C.amber));
      if (start + lines.length < ROWS - 1) ctext(ROWS - 1, '[ESC] BACK', C.amberDim);
      return;
    }
    const page = pages[helpIndex(state, pages.length)];
    const x0 = Math.max(0, (COLS - page.w) >> 1);
    const y0 = Math.max(0, (ROWS - page.h) >> 1);
    for (let r = 0; r < page.rows.length; r++) {
      const row = page.rows[r];
      for (let s = 0; s < row.length; s++) {
        const span = row[s];
        const col = helpColor(span.c);
        // a keycap is the inverse cell: the tier colour becomes the key's
        // face and the page's own background becomes the letter on it
        if (span.inv) text(x0 + span.x, y0 + r, span.t, C.bg, col);
        else text(x0 + span.x, y0 + r, span.t, col);
      }
    }
  }

  // The end-screen stats, as a centred two-column block (M-WIDE: L/V were the
  // literals 26/46, which centred a 34-wide block on an 80-column screen).
  const STATS_W = 34, STATS_VAL = 20;
  function statsBlock(row, res) {
    const L = Math.max(0, (COLS - STATS_W) >> 1), V = L + STATS_VAL;
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
    // M-EVENTS: the rig is gone and the cat is not. She sits on the rubble
    // edge of the wreck watching, and GRIT says the one line he says about
    // it. The run is over, so this is the last thing the screen tells you —
    // which is exactly the right weight for the joke.
    const hadCat = (DC.Events && DC.Events.cat) ? DC.Events.cat(state.run) : null;
    if (hadCat) {
      const rubble = 1 + lines.length - 3;
      // on the wreck's own left edge, wherever the centred art put it
      const cx = Math.max(0, (COLS - artWidth(lines)) >> 1) + 3;
      put(cx, Math.max(1, rubble), 'c', shade(C.white, 0.8));
      const cl = (DC.Barks && DC.Barks.CAT_EPITAPH) || null;
      if (cl && y + 5 + epi.length < 30) ctext(y + 5 + epi.length + 1, cl, C.gray);
    }
    ctext(30, '[TAB] RUN RECAP CARD', C.amberDim);
    ctext(31, '[ENTER] RETURN TO THE SURFACE', phase ? C.white : C.amber);
  }

  // M-CORELORE, the reveal. On the toast's last character the sphere gains a
  // hairline crack — it was an egg, and you did not beat the planet's door,
  // you knocked on something's. The crack is applied as an OVERLAY on whatever
  // rows the victory art hands over (Art.crackSphere is a pure function of
  // those rows), so it composes with any core art at any resolution and needs
  // nothing from this module but the moment. Missing art helper, missing fx,
  // missing toast: the sphere simply draws whole, as it always did.
  function crackedCore(lines, done) {
    const A = DC.Art;
    if (!done || !A || typeof A.crackSphere !== 'function') return lines;
    try { return A.crackSphere(lines) || lines; } catch (e) { return lines; }
  }

  // A stable pick out of an authored pool, keyed on the run and a slot name.
  // FNV-1a over the seed: same run, same line, every frame and every redraw,
  // without ever touching run.rng (SPEC3 rule 4 — render must not feed back
  // into sim, and on the victory screen the Mantle's map is still unrolled).
  function seedPick(run, slot, n) {
    let h = 0x811c9dc5;
    const s = String(((run && run.seed) >>> 0)) + ':' + slot;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return n > 0 ? (h >>> 1) % n : 0;
  }
  // M-CORELORE's payoff. Once the shell is open the Core says one line and
  // GRIT answers it — the same call-and-response as the foreman bar, on the
  // one screen that has no foreman bar. Absent barks.js: nothing is drawn and
  // the victory screen is exactly what it was.
  function drawReveal(run, row) {
    const pool = DC.Barks && DC.Barks.CORE && DC.Barks.CORE.reveal;
    if (!Array.isArray(pool) || !pool.length || row + 1 > ROWS - 3) return;
    const pair = pool[seedPick(run, 'reveal', pool.length)];
    if (!pair) return;
    const gold = C.gold || C.amber;
    const said = fxTyped('reveal', String(pair.core), 8);   // slow: it has time
    ctext(row, said, gold);
    if (said.length >= String(pair.core).length && pair.grit)
      ctext(row + 1, 'GRIT ▸ ' + fxTyped('revealGrit', String(pair.grit), 16), C.cyan);
  }

  function drawVictory(state, phase) {
    // Merge seam (M-HIRES × M-CORELORE): the two briefs both wanted this
    // sphere and neither knew about the other, so they are composed in the
    // only order that works — pick the sphere at the best resolution THIS
    // machine can render, then crack whatever that produced. M-CORELORE was
    // briefed to write the crack as an overlay taking sphere rows precisely
    // so this composition would be possible.
    //
    // M-HIRES Phase 3: `art('victory')` is the block build and is always safe;
    // the braille build is taken ONLY when the probe measured braille at the
    // cell advance. Guarded so an art.js without coreSphere (or a throw
    // inside it) still draws the sphere.
    let sphere = art('victory');
    if (DC.Art && typeof DC.Art.coreSphere === 'function' && brailleOK) {
      try {
        const hi = DC.Art.coreSphere('braille');
        if (Array.isArray(hi) && hi.length) sphere = hi;
      } catch (e) { /* keep the block build */ }
    }
    // The toast is typed FIRST (the call is keyed and idempotent) because the
    // sphere behind it needs to know whether GRIT has finished talking: the
    // crack lands on his last character. With fx.js absent there is no
    // typewriter at all, the line is complete on frame one, and the shell is
    // already open — which is the same statement, told at the speed that build
    // tells everything else.
    const full = toastSafe(state.run).slice(0, 70);
    const typed = full ? fxTyped('toast', full, 14) : '';
    const lines = crackedCore(sphere, full && typed.length >= full.length);
    drawArt(lines, 1, artColor('victory', C.magmaHot));
    // fx: the core sphere pulses. `w` is published so the pulse bands against
    // the sphere's real half-width instead of a hardcoded one (M-HIRES).
    layout.artBlock = { row: 1, h: lines.length, w: artWidth(lines) };
    const y = Math.min(1 + lines.length + 1, 24);
    statsBlock(y, fallbackResult(state.run, true));
    ctext(y + 5, '+' + D.WIN_CORES + ' ◈ CORE BONUS', phase ? C.magenta : shade(C.magenta, 0.6));
    if (full && y + 7 < 31) ctext(y + 7, 'GRIT ▸ ' + typed, C.cyan);
    // ...and then the shell answers him. The pair is chosen by a pure hash of
    // the run's seed — render must never draw from run.rng, and on this screen
    // the run is still live (the Mantle is one keypress away).
    if (full && typed.length >= full.length) drawReveal(state.run, y + 9);
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

  // GRIT's Performance Review is a pure function of the run (Barks picks it by
  // seed hash precisely so that opening this card cannot move run.rng — see the
  // note over Barks.reviewPick). Cached per run and outcome anyway: it builds a
  // string, and this runs every frame the card is up.
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
      // Widths are budgeted so no stratum NAME is ever cut mid-word: the
      // longest of the eight is GLOWDEEP GALLERIES at 18, so the name field is
      // 18 and the bar gives up the two columns to pay for it (11 cells is
      // still 88 eighth-steps — more resolution than the eye reads off a
      // 46-wide card). Deep Mantle names overflow by their trailing daggers,
      // which clip harmlessly. 1+3+1+18+1+11+1+6+1+1 = 44 = CARD_IN exactly.
      const inner = ' ' + U.pad('S' + s.depth, 3) + ' ' + U.pad(st.name, 18) + ' ' +
        cardBar(s.sec / maxSec, 11) + ' ' + U.padL(fmtTime(s.sec), 6) + ' ' +
        (s.partial ? '†' : ' ');
      rows.push(cardRow(inner, C.gray, [
        { from: 5, len: 18, color: st.accent || C.amber },
        { from: 24, len: 11, color: st.accent || C.amber },
        { from: 36, len: 7, color: s.partial ? C.red : C.white },
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

  // ================= viewport scaling (M-HIRES Phase 1) =================
  // The canvas used to be a fixed 800x627 island: init() set a CSS pixel size
  // once on load and nothing ever resized it. Canvas text is RE-RENDERED at
  // the new cell size rather than upscaled, so drawing the same 80x33 grid
  // larger produces genuinely more pixels of glyph — this sharpens, it does
  // not stretch. The aspect is preserved by construction: one scalar `s`
  // multiplies both axes, so the grid can never distort.
  function fitScale(vw, vh) {
    const s = Math.min(vw / (COLS * CW), vh / (ROWS * CH));
    if (!(s > 0) || !isFinite(s)) return 1;
    return U.clamp(s, MIN_SCALE, MAX_SCALE);
  }
  // Re-measure the glyph advance. MUST run after every scale change: `adv`
  // comes from measureText at the old font size and flush() divides by it.
  function measureAdv() {
    ctx.font = font;
    const m = ctx.measureText('█');
    adv = (m && m.width > 0) ? m.width : cw;
    probeBraille();
  }

  // ---- braille coverage probe (M-HIRES Phase 3) -------------------------
  // Braille (U+2800-28FF) is NOT in DejaVu Sans Mono — verified per codepoint
  // with fc-match, not assumed — and the fallback face is the PROPORTIONAL
  // DejaVu Sans, whose braille advances 1500/2048 em against the grid's
  // 1233/2048. That is 21.7% wide, and flush() batches a whole run of cells
  // into one fillText scaled by cw/adv where adv came from '█': five braille
  // glyphs in a row drift a full cell and the row is corrupted. So the
  // failure mode is not a missing dot, it is a wrecked line of text.
  //
  // Hence: never emit braille without measuring first, every time the font
  // changes. A vendored face does not excuse the probe — browsers block
  // webfonts, users override fonts, and the check is two measureText calls.
  const BRAILLE_EPS = 0.02;          // 2% of a cell; the real gap is 21.7%
  function probeBraille() {
    brailleOK = false;
    try {
      ctx.font = font;
      const blk = ctx.measureText('█').width;
      const brl = ctx.measureText('⣿').width;
      if (!(blk > 0) || !(brl > 0)) return false;
      brailleOK = Math.abs(brl - blk) <= blk * BRAILLE_EPS;
    } catch (e) { brailleOK = false; }
    return brailleOK;
  }
  // The CRT scanline period is a fixed 3px in style.css; at 2x scale that
  // reads twice as dense and muddies the art. Hand the sheet the current cell
  // height so the overlay scales with the picture.
  function setScanlinePeriod() {
    try {
      const el = root.document && root.document.documentElement;
      if (el && el.style && el.style.setProperty) {
        el.style.setProperty('--scanline', Math.max(3, Math.round(3 * scale)) + 'px');
      }
    } catch (e) { /* headless, or a canvas with no page around it */ }
  }
  function applyScale(s) {
    scale = s;
    cw = CW * s;
    ch = CH * s;
    // Rounded, and then USED rounded: the font string is what the browser
    // measures, so metrics().fontPx must be the same number or `adv` and the
    // reported size disagree by a hair that compounds across an 80-cell run.
    fontPx = Math.round(FONT_PX * s * 100) / 100;
    font = fontPx + 'px ' + FONT_STACK;
    const pw = COLS * cw, ph = ROWS * ch;
    canvas.width = Math.round(pw * dpr);
    canvas.height = Math.round(ph * dpr);
    if (canvas.style) {
      canvas.style.width = pw + 'px';
      canvas.style.height = ph + 'px';
    }
    measureAdv();
    setScanlinePeriod();
  }

  // ================= flush (batched fillText) =================
  function flush() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, COLS * cw, ROWS * ch);
    // background runs
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const b = bgB[r][c];
        if (!b) { c++; continue; }
        let e = c + 1;
        while (e < COLS && bgB[r][e] === b) e++;
        ctx.fillStyle = b;
        ctx.fillRect(c * cw, r * ch, (e - c) * cw, ch);
        c = e;
      }
    }
    // text runs: same-color spans in one fillText; x-scale maps the measured
    // glyph advance onto the `cw` cell pitch so long runs stay grid-aligned
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.save();
    ctx.scale(cw / adv, 1);
    for (let r = 0; r < ROWS; r++) {
      const yy = r * ch + ch * 0.55;
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
  const layout = { cards: [], buildRows: [], map: null, choices: [], runRig: null };
  surface.layout = layout;

  DC.Render = {
    // The BASE cell. The drawn cell is this times metrics().scale.
    CW: CW, CH: CH, FONT_PX: FONT_PX,
    layout: layout,
    // M-POLISH/CX-11: the STOCK row contract, exported so test/barks_test.js
    // can prove every D.ITEMS.short survives the name field unclipped and
    // stays unambiguous — mirrors Sim.SCAN_W for the tooltip panel (CX-04).
    STOCK_NAME_W: STOCK_NAME_W,
    STOCK_COUNT_W: STOCK_COUNT_W,
    itemLabel: itemLabel,
    stockCount: stockCount,
    // M-WIDE: the panel geometry, derived from COLS rather than typed in.
    // Exported so the suites can hold the columns to the screen's real width
    // instead of re-deriving numbers that would then agree with themselves.
    LAYOUT: {
      cols: COLS, rows: ROWS,
      sb: SB, sbw: SBW, sbc: SBC, scw: SCW,
      sb2: SB2, sbw2: SBW2, sbc2: SBC2, scw2: SCW2,
      twoCol: TWO_COL,
      get runRig() { return layout.runRig; },
    },
    LOGBOOK_W: LOG_W,
    // The prose panels' text contract (LOG at SCW columns, Foreman bar at 41),
    // exported so test/barks_test.js can prove no authored line — sim message
    // or GRIT bark — is ever cut mid-word by either one.
    SCAN_COL_W: SCW,
    LOG_MSG_ROWS: LOG_MSG_ROWS,
    FOREMAN_ROW_W: SB - 1 - 7,
    wrapClamp: wrapClamp,
    // M-MANUAL's contrast contract, exported so test/barks_test.js can assert
    // the floor on every colour the field manual actually paints (tiers and
    // lifted game colours alike) instead of trusting the palette by eye.
    MIN_CONTRAST: MIN_CR,
    contrast: contrast,
    legible: legible,
    // M-GRITPLUS: the EGG-420 wash and the descent's graffiti pick, exported
    // so the suites can prove the tint never demotes a colour and that the
    // wall a given descent shows is a pure function of the run (never rng).
    eggTint: eggTint, graffitiFor: graffitiFor,
    helpColor: helpColor,
    HELP_TIER: HELP_TIER,

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
      DC.Render.resize();
      DC.Render.watchFont();
    },

    // A webfont loads ASYNCHRONOUSLY, while init() measures the glyph advance
    // exactly once. Until the face lands, `adv` describes the fallback; the
    // moment it swaps in, every batched run is scaled by the wrong number and
    // the whole grid shears. So re-measure when the font is really ready —
    // which is the same re-measure resize() already owed Phase 1, reached
    // through the same call. One fix, two callers.
    //
    // Both hooks are used on purpose: fonts.load() forces the face to load
    // even though the page paints only through a canvas (nothing in the DOM
    // uses it, so it might otherwise never become pending), and fonts.ready
    // catches the general case including a font that was already cached.
    watchFont: function () {
      const remeasure = function () {
        if (ctx) { measureAdv(); fontReady = true; }
      };
      try {
        const f = root.document && root.document.fonts;
        if (!f) return false;
        if (typeof f.load === 'function') {
          const p = f.load(font);
          if (p && p.then) p.then(remeasure, function () { /* blocked: fallback */ });
        }
        if (f.ready && typeof f.ready.then === 'function') {
          f.ready.then(remeasure, function () { /* nothing to do */ });
        }
        return true;
      } catch (e) { return false; }   // no document, or a hostile CSP
    },
    fontReady: function () { return fontReady; },
    FONT_FAMILY: FONT_FAMILY,

    // Which sub-cell technique the art may use on THIS machine, right now.
    // 'braille' only when the probe measured braille at exactly the cell
    // advance; otherwise 'blocks', which needs nothing but the system font.
    // Art asks this rather than assuming, so the block path is not a
    // degraded mode — it is the default, and braille is the upgrade.
    subcellMode: function () { return brailleOK ? 'braille' : 'blocks'; },
    probeBraille: function () { return ctx ? probeBraille() : false; },

    // Fit the grid to the viewport, preserving aspect. Called on load, on
    // every (debounced) window resize, and whenever devicePixelRatio changes
    // — dragging the window between a laptop panel and an external monitor
    // changes dpr without changing innerWidth, and the backing store has to
    // follow or the text goes soft. `vw`/`vh` default to the window but are
    // arguments so the scaling can be tested without a DOM.
    resize: function (vw, vh) {
      if (!ctx) return scale;
      vw = (typeof vw === 'number' && vw > 0) ? vw : (root.innerWidth || COLS * CW);
      vh = (typeof vh === 'number' && vh > 0) ? vh : (root.innerHeight || ROWS * CH);
      dpr = (root.devicePixelRatio || 1);
      applyScale(fitScale(vw, vh));
      return scale;
    },

    // Metrics, live. `scale` is fractional by design: glyphs are vector, so
    // there is no nearest-neighbour argument for integer steps here.
    metrics: function () {
      return {
        scale: scale, cw: cw, ch: ch, fontPx: fontPx, adv: adv, dpr: dpr,
        width: COLS * cw, height: ROWS * ch,
        deviceWidth: canvas ? canvas.width : 0,
        deviceHeight: canvas ? canvas.height : 0,
      };
    },
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,

    // SPEC3 §A test surface: the cell buffer after a frame, so a stub-canvas
    // frame-advance test can prove an FX row actually landed on a cell.
    cellAt: function (col, row) {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
      return { ch: chB[row][col], fg: fgB[row][col], bg: bgB[row][col] };
    },

    frame: function (state, nowMs) {
      if (!ctx || !state) return;
      // A window dragged between displays changes devicePixelRatio without
      // firing `resize`. One property read a frame is cheaper than a
      // matchMedia dance and catches every case.
      if ((root.devicePixelRatio || 1) !== dpr) DC.Render.resize();
      advanceClock(nowMs);
      const phase = Math.floor(frameN / 30) % 2;   // 1 Hz blink, wall time
      clearBuf();
      // SPEC3 §A: fx.js advances its frame clock and takes its per-frame read
      // of the world BEFORE anything draws; its overlay lands after everything.
      if (DC.FX && DC.FX.begin) {
        try { DC.FX.begin(state, surface, nowMs); } catch (e) { /* fx never kills a frame */ }
      }
      try {
        switch (state.screen) {
          case 'run':      drawRun(state); break;
          case 'descend':  drawDescend(state); break;
          case 'foundry':  drawFoundry(state); break;
          case 'logbook':  drawLogbook(state); break;   // M-EVENTS
          case 'vignette': drawVignette(state); break;  // M-EVENTS
          case 'help':     drawHelp(state); break;
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
