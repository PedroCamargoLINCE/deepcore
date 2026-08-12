/* DEEPCORE — test/rig_test.js
   Permanent checks for the v1.1 rig portrait + schematic art (SPEC2 §C, §G):
   rigBase geometry, rigParts coverage/disjointness, composeRig identity and
   bounds, schematic icon/badge/color coverage, and no backslash/backtick in
   any art line. Node-only, DOM-free. */
'use strict';

require('../js/data.js');
require('../js/art.js');
const DC = globalThis.DC;
const D = DC.DATA;
const A = DC.Art;

let checks = 0;
function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}
function assert(cond, msg) { checks++; if (!cond) fail(msg); }

const RW = 24, RH = 12;
const IW = 10, IH = 5;

// ------------------------------------------------------------ rigBase 24x12
assert(Array.isArray(A.rigBase), 'rigBase must be an array');
assert(A.rigBase.length === RH, 'rigBase must be ' + RH + ' tall (got ' + A.rigBase.length + ')');
for (let i = 0; i < A.rigBase.length; i++) {
  assert(typeof A.rigBase[i] === 'string' && A.rigBase[i].length === RW,
    'rigBase row ' + i + ' must be ' + RW + ' wide (got ' + A.rigBase[i].length + ')');
}

// ------------------------------------------- rigParts: one per meta upgrade
assert(A.rigParts && typeof A.rigParts === 'object', 'rigParts must exist');
const metaIds = D.META_UPGRADES.map(function (u) { return u.id; });
assert(metaIds.length === 9, 'expected 9 meta upgrade ids in data.js');
for (const id of metaIds) {
  const p = A.rigParts[id];
  assert(p, 'rigParts missing overlay for ' + id);
  assert(Number.isInteger(p.row) && Number.isInteger(p.col) && Array.isArray(p.lines),
    id + ' overlay must be {row, col, lines}');
  assert(p.row >= 0 && p.row + p.lines.length <= RH, id + ' overlay overflows vertically');
  for (const ln of p.lines) {
    assert(typeof ln === 'string', id + ' overlay lines must be strings');
    assert(p.col >= 0 && p.col + ln.length <= RW, id + ' overlay overflows horizontally');
  }
}
for (const id in A.rigParts) {
  assert(metaIds.indexOf(id) !== -1, 'rigParts has unknown upgrade id ' + id);
}

// absolute non-space cells of one part
function cellsOf(id) {
  const p = A.rigParts[id];
  const cells = [];
  for (let i = 0; i < p.lines.length; i++) {
    for (let j = 0; j < p.lines[i].length; j++) {
      if (p.lines[i][j] !== ' ') cells.push([p.row + i, p.col + j]);
    }
  }
  return cells;
}

// no two parts overwrite each other's cells (composition is order-free)
const owner = {};
for (const id of metaIds) {
  for (const c of cellsOf(id)) {
    const k = c[0] + ',' + c[1];
    assert(!owner[k], 'parts ' + owner[k] + ' and ' + id + ' both write cell (' + k + ')');
    owner[k] = id;
  }
}

// ------------------------------------------------------------- composeRig
function diffCells(a, b) {
  let n = 0;
  for (let r = 0; r < RH; r++) {
    for (let c = 0; c < RW; c++) if (a[r][c] !== b[r][c]) n++;
  }
  return n;
}

// no upgrades -> exactly the base
for (const bare of [undefined, {}, { m_hull: 0 }]) {
  const out = A.composeRig(bare);
  assert(Array.isArray(out) && out.length === RH, 'composeRig(no upgrades) must be ' + RH + ' lines');
  assert(out.join('\n') === A.rigBase.join('\n'),
    'composeRig(' + JSON.stringify(bare) + ') must equal rigBase');
}

// all 9 at max level -> still exactly 24x12, and rigBase untouched
const allMax = {};
for (const u of D.META_UPGRADES) allMax[u.id] = u.max;
const full = A.composeRig(allMax);
assert(full.length === RH, 'composeRig(all max) must stay ' + RH + ' tall');
for (let i = 0; i < full.length; i++) {
  assert(typeof full[i] === 'string' && full[i].length === RW,
    'composeRig(all max) row ' + i + ' must stay ' + RW + ' wide');
}
assert(diffCells(full, A.rigBase) > 0, 'composeRig(all max) must differ from rigBase');
assert(A.rigBase.length === RH && A.rigBase.every(function (l) { return l.length === RW; }),
  'composeRig must not mutate rigBase');

// every part alone alters >= 2 cells vs base — buying it changes the picture
for (const id of metaIds) {
  const one = {}; one[id] = 1;
  const n = diffCells(A.composeRig(one), A.rigBase);
  assert(n >= 2, 'part ' + id + ' alters only ' + n + ' cell(s) vs base (need >= 2)');
}

// -------------------------------- schematic icons / badges / colors (all 14)
const schemIds = D.SCHEMATICS.map(function (s) { return s.id; });
assert(schemIds.length === 14, 'expected 14 schematic ids in data.js');
for (const id of schemIds) {
  const ic = A.schemIcons && A.schemIcons[id];
  assert(Array.isArray(ic), 'schemIcons missing ' + id);
  assert(ic.length === IH, id + ' icon must be ' + IH + ' tall (got ' + ic.length + ')');
  for (let i = 0; i < ic.length; i++) {
    assert(typeof ic[i] === 'string' && ic[i].length === IW,
      id + ' icon row ' + i + ' must be ' + IW + ' wide (got ' + ic[i].length + ')');
  }
  const b = A.schemBadges && A.schemBadges[id];
  assert(typeof b === 'string' && b.length === 2,
    id + ' badge must be exactly 2 chars (got ' + JSON.stringify(b) + ')');
  const col = A.schemColors && A.schemColors[id];
  assert(typeof col === 'string' && Object.prototype.hasOwnProperty.call(D.COLORS, col),
    id + ' color ' + JSON.stringify(col) + ' is not a DC.DATA.COLORS key');
}

// --------------------------- no backslash / backtick in any art line at all
(function () {
  const seen = new Set();
  function walk(name, v) {
    if (v == null || seen.has(v)) return;
    if (typeof v === 'string') {
      checks++;
      if (v.indexOf('\\') !== -1 || v.indexOf('`') !== -1) {
        fail('art line in "' + name + '" contains backslash or backtick: ' + v);
      }
      return;
    }
    if (typeof v !== 'object') return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const el of v) walk(name, el);
    } else {
      for (const k in v) walk(name + '.' + k, v[k]);
    }
  }
  for (const k in A) if (typeof A[k] !== 'function') walk(k, A[k]);
})();

// ===========================================================================
// M-HIRES Phase 2 — the sub-cell rasterizer (DC.Art.raster)
// It lives in art.js precisely so it can be proved here: bare node, no
// canvas, no DOM. Three things are pinned — the quadrant mapping against
// known bitmaps, the cell-aspect correction (the brief's "circles come out as
// eggs" trap), and the eighths gauges.
// ===========================================================================
(function rasterSection() {
  const R = A.raster;
  assert(R && typeof R.bitmap === 'function', 'DC.Art.raster exists');
  assert(typeof globalThis.document === 'undefined' &&
         typeof globalThis.HTMLCanvasElement === 'undefined',
    'the rasterizer is proved with no DOM and no canvas in the process');

  // ---- every one of the 16 quadrant patterns, by construction ----------
  // bit order is TL=1, TR=2, BL=4, BR=8; the expected glyph for each mask is
  // written out longhand so a transposed bit cannot pass.
  const EXPECT = [
    ' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛',
    '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█',
  ];
  for (let mask = 0; mask < 16; mask++) {
    const bm = R.bitmap(1, 1, 2, 2);
    if (mask & 1) R.set(bm, 0, 0, 1);      // TL
    if (mask & 2) R.set(bm, 1, 0, 1);      // TR
    if (mask & 4) R.set(bm, 0, 1, 1);      // BL
    if (mask & 8) R.set(bm, 1, 1, 1);      // BR
    const got = R.quadrants(bm);
    assert(got.length === 1 && got[0] === EXPECT[mask],
      'quadrant mask ' + mask + ' renders ' + EXPECT[mask] + ' (got "' + got[0] + '")');
    assert(R.cellMask(bm, 0, 0).mask === mask, 'cellMask round-trips mask ' + mask);
  }

  // ---- a known 4x4 bitmap, written as a picture -------------------------
  // rows 0-1 make the top cell row, rows 2-3 the bottom: the last picture row
  // is empty, so both bottom cells are upper-half blocks.
  const PIC = [
    '#..#',
    '.##.',
    '####',
    '....',
  ];
  const pic = R.bitmap(2, 2, 2, 2);
  for (let y = 0; y < PIC.length; y++) {
    for (let x = 0; x < PIC[y].length; x++) if (PIC[y][x] === '#') R.set(pic, x, y, 1);
  }
  const picRows = R.quadrants(pic);
  assert(picRows[0] === '▚▞' && picRows[1] === '▀▀',
    'a known 4x4 bitmap rasterises to ▚▞/▀▀ (got ' + picRows.join('/') + ')');

  // ---- the cell-aspect correction: a disc is round in PIXELS ------------
  // This is the trap the brief calls out by name. Cells are 10x19, so a
  // quadrant sub-pixel is 5 x 9.5 and a disc plotted without correction is
  // ~1.9x too tall. Measure the drawn extent on both axes IN PIXELS.
  assert(R.CELL_W === 10 && R.CELL_H === 19, 'the cell is 10 x 19');
  const quadAspect = R.bitmap(1, 1, 2, 2).aspect;
  assert(Math.abs(quadAspect - 1.9) < 1e-12,
    'a quadrant sub-pixel is 1.9x taller than it is wide (got ' + quadAspect + ')');
  assert(Math.abs(R.bitmap(1, 1, 2, 4).aspect - 0.95) < 1e-12,
    'a 2x4 braille sub-pixel is 0.95 — very nearly square, which is its whole appeal');

  const d = R.bitmap(41, 21, 2, 2);
  const dcx = d.w / 2, dcy = d.h / 2;
  const drad = Math.min(d.w / 2, (d.h / 2) * d.aspect) - 0.6;
  R.disc(d, dcx, dcy, drad, 1);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      if (!R.get(d, x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const subW = R.CELL_W / d.sx, subH = R.CELL_H / d.sy;   // 5 x 9.5 px
  const pxW = (maxX - minX + 1) * subW;
  const pxH = (maxY - minY + 1) * subH;
  assert(Math.abs(pxW / pxH - 1) < 0.04,
    'the disc is round in PIXELS, not in cells: ' + pxW.toFixed(1) + ' x ' +
    pxH.toFixed(1) + ' px (ratio ' + (pxW / pxH).toFixed(3) + ')');
  // ...and it is emphatically NOT round in cells — if it were, it would be an
  // egg on screen. This is the assertion that fails if someone "simplifies"
  // the aspect term away.
  const cellRatio = ((maxX - minX + 1) / d.sx) / ((maxY - minY + 1) / d.sy);
  assert(cellRatio > 1.7,
    'and it spans ~1.9x more cells across than down, as a round thing must ' +
    'on a 10x19 grid (got ' + cellRatio.toFixed(2) + ')');

  // ---- the victory core actually became a sphere ------------------------
  assert(A.victoryGeom && A.victoryGeom.w && A.victoryGeom.h,
    'art publishes the victory sphere geometry for fx');
  const gw = A.victoryGeom.w * R.CELL_W, gh = A.victoryGeom.h * R.CELL_H;
  assert(Math.abs(gw / gh - 1) < 0.05,
    'the victory core is a sphere: ' + gw + ' x ' + gh + ' px (ratio ' +
    (gw / gh).toFixed(3) + ') — it used to be 550 x 247');
  const vlines = A.victory;
  assert(vlines.length === A.victoryGeom.h + 2, 'victory art is the sphere plus cap and rule');
  assert(vlines.every((l) => l.length === A.victoryGeom.w),
    'every victory row is exactly the published width');

  // ---- eighths: gauges resolve to 1/8 of a cell -------------------------
  // Whole-cell rounding on a 13-wide bar quantises to 7.7% of the value; the
  // eighths path must resolve better than 1%.
  const W = 13;
  const seen = new Set();
  for (let i = 0; i <= 100; i++) {
    const b = R.bar(i / 100, W);
    seen.add(b.full + ':' + b.part);
    assert(b.full + (b.part ? 1 : 0) + b.rest === W,
      'a bar always occupies exactly ' + W + ' cells (frac ' + i + '%)');
    assert(b.full <= W && b.rest >= 0, 'bar pieces stay in bounds at ' + i + '%');
  }
  assert(seen.size > 60,
    'a 13-cell bar shows more than 60 distinct fills across 0-100% (got ' +
    seen.size + '; whole cells gave 14)');
  const zero = R.bar(0, W), one = R.bar(1, W);
  assert(zero.full === 0 && zero.part === '' && zero.rest === W, 'empty reads as empty');
  assert(one.full === W && one.part === '' && one.rest === 0, 'full reads as full');
  // the two readings that matter at a glance must never lie
  const tiny = R.bar(0.001, W);
  assert(tiny.full === 0 && tiny.part === '▏',
    'a barely-started bar shows the thinnest sliver, never nothing');
  const nearly = R.bar(0.999, W);
  assert(nearly.full + (nearly.part ? 1 : 0) === W && nearly.part !== '',
    'a nearly-full bar never rounds up to full');

  const g = R.gauge(0.5, 8);
  assert(g.length === 8, 'a vertical gauge is as tall as asked');
  assert(g.slice(0, 4).every((c) => c === ' ') && g.slice(4).every((c) => c === '█'),
    'a half gauge fills the bottom four cells (got ' + g.join('') + ')');
  const gq = R.gauge(0.25 + 1 / 64, 8);   // 2.125 cells
  assert(gq[8 - 3] === '▁', 'a vertical gauge resolves the leftover eighth (got ' + gq[5] + ')');

  assert(R.shade(0) === ' ' && R.shade(4) === '█' && R.shade(2) === '▒',
    'the shade ramp maps 0..4 to " ░▒▓█"');

  // ---- braille (Phase 3): the dot numbering is not raster order ---------
  // Unicode numbers the dots 1,2,3,7 down the left and 4,5,6,8 down the
  // right, so the BOTTOM row is the two high bits. Walk all eight positions
  // one at a time: a transposed row or column cannot survive this.
  const DOT = [
    [0x01, 0x08],   // row 0 -> dots 1, 4
    [0x02, 0x10],   // row 1 -> dots 2, 5
    [0x04, 0x20],   // row 2 -> dots 3, 6
    [0x40, 0x80],   // row 3 -> dots 7, 8
  ];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 2; i++) {
      const b = R.bitmap(1, 1, 2, 4);
      R.set(b, i, j, 1);
      const got = R.braille(b)[0];
      const want = String.fromCharCode(0x2800 + DOT[j][i]);
      assert(got === want,
        'braille dot at sub-pixel ' + i + ',' + j + ' is U+' +
        (0x2800 + DOT[j][i]).toString(16).toUpperCase() +
        ' (got U+' + got.charCodeAt(0).toString(16).toUpperCase() + ')');
    }
  }
  const empty = R.bitmap(1, 1, 2, 4);
  assert(R.braille(empty)[0] === '⠀', 'an empty braille cell is U+2800, not a space');
  const solid = R.bitmap(1, 1, 2, 4);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) R.set(solid, i, j, 1);
  assert(R.braille(solid)[0] === '⣿', 'a full braille cell is U+28FF');
  // every glyph it can emit is inside the braille block
  const bigger = R.bitmap(6, 3, 2, 4);
  R.disc(bigger, bigger.w / 2, bigger.h / 2, 4, 1);
  for (const line of R.braille(bigger)) {
    for (const chr of line) {
      const cp = chr.codePointAt(0);
      assert(cp >= 0x2800 && cp <= 0x28FF, 'braille output stays in U+2800-28FF');
    }
  }

  // ---- both core builds occupy the same cells ---------------------------
  // The braille build is swapped in at RUNTIME behind a probe, so it must not
  // move the layout by a single cell or the stats block below it shifts.
  const blockCore = A.coreSphere('blocks');
  const brailleCore = A.coreSphere('braille');
  assert(blockCore.length === brailleCore.length,
    'the braille and block core builds are the same height');
  for (let i = 0; i < blockCore.length; i++) {
    assert(blockCore[i].length === brailleCore[i].length,
      'core row ' + i + ' is the same width in both builds');
  }
  assert(blockCore.join('\n') !== brailleCore.join('\n'),
    'scaffold: the two builds really do differ, so the probe decides something');
  // the interior shading ramp survives in BOTH: it is what makes the core
  // read as a lit sphere, and a uniform braille fill would throw it away
  for (const build of [blockCore, brailleCore]) {
    const mid = build[Math.floor(build.length / 2)];
    for (const g of ['█', '▓', '▒', '░']) {
      assert(mid.indexOf(g) >= 0,
        'the core keeps its ' + g + ' shading band in both builds');
    }
  }
  const brailleRow = brailleCore[2];
  assert(Array.from(brailleRow).some((c) => {
    const cp = c.codePointAt(0);
    return cp >= 0x2800 && cp <= 0x28FF;
  }), 'the braille build really does put braille on the rim');
  assert(!Array.from(blockCore.join('')).some((c) => {
    const cp = c.codePointAt(0);
    return cp >= 0x2800 && cp <= 0x28FF;
  }), 'and the block build contains no braille at all — it is the safe default');
})();

console.log('rig_test OK — ' + checks + ' checks passed');
