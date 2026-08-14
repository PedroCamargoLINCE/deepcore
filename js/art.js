/* DEEPCORE — art.js
   ASCII art assets. Pure data + DC.Art.center helper. DOM-free.
   All assets are arrays of strings; widths <= 76 (help <= 74). */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const A = DC.Art = {};
  const D = DC.DATA;   // data.js loads first; the field manual is composed from it

  const sp = function (n) { return ' '.repeat(n); };
  const rep = function (c, n) { return c.repeat(n); };
  // deterministic texture sampler: slice n chars from a repeating pattern
  function seg(src, off, n) {
    off = off % src.length;
    const s = src.repeat(Math.ceil((off + n) / src.length) + 1);
    return s.slice(off, off + n);
  }
  function lay(s, at, ins) { return s.slice(0, at) + ins + s.slice(at + ins.length); }

  // ================= M-HIRES Phase 2: the sub-cell rasterizer =================
  // Block elements are already in the font — verified per codepoint with
  // fc-match against DejaVu Sans Mono, all 15 quadrants (including the
  // three-quarter ▛▜▙▟ the brief's table omitted), all 8 eighths in both
  // axes, and the shades. No vendoring is needed for any of this.
  //
  // Pure and DOM-free like the rest of art.js: bitmap in, rows of glyphs out.
  // No canvas, no measurement, unit-testable in bare node.
  //
  // THE CELL IS NOT SQUARE and that is the whole difficulty. A cell is
  // 10 x 19 px, so a quadrant sub-pixel is 5 x 9.5 — very nearly TWICE as
  // tall as it is wide. A circle plotted naively on that grid comes out an
  // egg. Every shape helper here therefore works in sub-pixel columns and
  // multiplies the y term by `aspect`, so what is round in the bitmap is
  // round in PIXELS. Never eyeball this; the tests pin it.
  //
  // Where this may be used is a hard design constraint, not a preference
  // (SPEC3 M-HIRES, and §0's chunky-beats-smooth law): NOT on the map. Every
  // map tile is a semantic, clickable, one-glyph object and pxToCell resolves
  // a click to exactly one cell — doubling map resolution would decouple what
  // the player sees from what they can click. Sub-cell detail belongs on the
  // non-interactive surfaces: gauges, the victory core, portrait, title art.
  const CELL_W = 10, CELL_H = 19;

  // Quadrant glyphs indexed by a 4-bit coverage mask: TL=1, TR=2, BL=4, BR=8.
  const QUAD = [
    ' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛',
    '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█',
  ];
  // Partial-cell fills, index = eighths covered. Horizontal grows from the
  // left edge, vertical from the bottom — the two directions a gauge fills.
  const EIGHTH_H = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  const EIGHTH_V = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const SHADES = [' ', '░', '▒', '▓', '█'];

  const R = A.raster = {
    CELL_W: CELL_W, CELL_H: CELL_H,
    QUAD: QUAD, EIGHTH_H: EIGHTH_H, EIGHTH_V: EIGHTH_V, SHADES: SHADES,

    // A sub-cell bitmap covering `cols` x `rows` CELLS, subdivided sx by sy.
    // `aspect` is the sub-pixel's height/width ratio: 1.9 for quadrants,
    // 0.95 for a 2x4 braille cell (very nearly square — that is braille's
    // whole appeal, and why Phase 3 wanted it).
    bitmap: function (cols, rows, sx, sy) {
      sx = sx || 2; sy = sy || 2;
      const w = cols * sx, h = rows * sy;
      return {
        cols: cols, rows: rows, sx: sx, sy: sy, w: w, h: h,
        aspect: (CELL_H / sy) / (CELL_W / sx),
        data: new Uint8Array(w * h),
      };
    },
    get: function (bm, x, y) {
      if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return 0;
      return bm.data[y * bm.w + x];
    },
    set: function (bm, x, y, v) {
      if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return;
      bm.data[y * bm.w + x] = v === undefined ? 1 : v;
    },

    // A disc that is round ON SCREEN. cx/cy/r are in sub-pixel COLUMNS; the
    // y term is scaled by the sub-pixel aspect, so the shape ends up
    // r * (CELL_W / sx) pixels in radius along BOTH axes.
    disc: function (bm, cx, cy, r, v) {
      const a = bm.aspect;
      for (let y = 0; y < bm.h; y++) {
        const dy = (y + 0.5 - cy) * a;
        for (let x = 0; x < bm.w; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy <= r * r) R.set(bm, x, y, v === undefined ? 1 : v);
        }
      }
      return bm;
    },
    // Normalised distance from a disc's centre, 0 at the core and 1 at the
    // rim, in the same aspect-corrected space. Shading ramps read this.
    radial: function (bm, x, y, cx, cy, r) {
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * bm.aspect;
      return Math.sqrt(dx * dx + dy * dy) / r;
    },
    // How many of a cell's sub-pixels are set (0..sx*sy), and their mask.
    cellMask: function (bm, col, row) {
      let mask = 0, n = 0, bit = 0;
      for (let j = 0; j < bm.sy; j++) {
        for (let i = 0; i < bm.sx; i++) {
          if (R.get(bm, col * bm.sx + i, row * bm.sy + j)) { mask |= (1 << bit); n++; }
          bit++;
        }
      }
      return { mask: mask, n: n };
    },
    // The bitmap as rows of quadrant glyphs. 2x2 only — that is what the
    // glyph repertoire can express.
    quadrants: function (bm) {
      const out = [];
      for (let row = 0; row < bm.rows; row++) {
        let s = '';
        for (let col = 0; col < bm.cols; col++) s += QUAD[R.cellMask(bm, col, row).mask];
        out.push(s);
      }
      return out;
    },
    // The bitmap as rows of BRAILLE glyphs (M-HIRES Phase 3). 2 x 4 only.
    // Dot numbering is Unicode's, which is not raster order: the left column
    // is dots 1,2,3,7 and the right is 4,5,6,8, so the last row is the two
    // high bits. Getting this wrong transposes the bottom of every shape.
    braille: function (bm) {
      const BIT = [
        [0x01, 0x08],    // row 0: dots 1, 4
        [0x02, 0x10],    // row 1: dots 2, 5
        [0x04, 0x20],    // row 2: dots 3, 6
        [0x40, 0x80],    // row 3: dots 7, 8
      ];
      const out = [];
      for (let row = 0; row < bm.rows; row++) {
        let s = '';
        for (let col = 0; col < bm.cols; col++) {
          let bits = 0;
          for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 2; i++) {
              if (R.get(bm, col * 2 + i, row * 4 + j)) bits |= BIT[j][i];
            }
          }
          s += String.fromCharCode(0x2800 + bits);
        }
        out.push(s);
      }
      return out;
    },
    // Level 0..4 as a shade glyph. Shades are for SOFT EDGES and gradients,
    // never for structure: at 10x19 a ▒ next to a ▓ is a texture, not a line.
    shade: function (level) {
      return SHADES[Math.max(0, Math.min(SHADES.length - 1, Math.round(level)))];
    },

    // ---- gauges: eighths instead of whole cells ----------------------
    // A bar `width` cells wide filled to `frac`, in 1/8-cell steps. Returns
    // {full, part, rest}: the solid run, the partial glyph at its head, and
    // how many cells are left empty — the caller paints the three pieces in
    // its own colours, which is what keeps the fill and the track distinct.
    // Eighths covered by `frac` of `cells`, with the two readings that
    // actually matter at a glance protected (§0 law 6): a bar that has
    // STARTED never renders as empty, and a bar that is not DONE never
    // renders as full. Those are the two states a player reads without
    // looking — a hull gauge that shows solid must mean undamaged.
    eighths: function (frac, cells) {
      const max = cells * 8;
      frac = frac < 0 ? 0 : (frac > 1 ? 1 : frac);
      let n = Math.round(frac * max);
      if (frac > 0 && n <= 0) n = 1;
      if (frac < 1 && n >= max) n = max - 1;
      return n;
    },
    // A bar `width` cells wide. Returns {full, part, rest}: the solid run,
    // the partial glyph at its head, and how many cells are left empty — the
    // caller paints the three pieces in its own colours, which is what keeps
    // the fill and the track distinct.
    bar: function (frac, width) {
      const n = R.eighths(frac, width);
      const full = Math.floor(n / 8), part = n - full * 8;
      return {
        full: full,
        part: part ? EIGHTH_H[part] : '',
        rest: width - full - (part ? 1 : 0),
        eighths: n,
      };
    },
    // The same in the vertical: a column `height` cells tall filling upward.
    gauge: function (frac, height) {
      const n = R.eighths(frac, height);
      const full = Math.floor(n / 8), part = n - full * 8;
      const out = new Array(height).fill(' ');
      for (let i = 0; i < full; i++) out[height - 1 - i] = '█';
      if (part && full < height) out[height - 1 - full] = EIGHTH_V[part];
      return out;
    },
  };

  const TEX  = '▓▓▒▓▓▓▓▒▒▓▓▒▓▓▓▓▓▒▓▓▓▒▓▓▒▒▓▓▓▒▓▓▓▓▒▓▓▓';   // shallow rock
  const DTEX = '▓▓█▓▓▒▓▓▓▓█▓▒▓▓▓▓▓█▓▓▒▓▓▓▓▓█▒▓▓▓▓▒▓▓█▓▓';   // deep rock
  const GLOW = '░▒░░▒▒░▒▒░░▒░░▒░▒▒░░▒░▒░░▒▒░';               // breach light

  // ---------------- title ----------------
  // 8 block letters, 7 wide x 5 tall, joined by single spaces (63 wide)
  const FONT = {
    D: ['██████▄', '██   ██', '██   ██', '██   ██', '██████▀'],
    E: ['███████', '██     ', '██████ ', '██     ', '███████'],
    P: ['██████▄', '██   ██', '██████▀', '██     ', '██     '],
    C: ['▄██████', '██     ', '██     ', '██     ', '▀██████'],
    O: ['▄█████▄', '██   ██', '██   ██', '██   ██', '▀█████▀'],
    R: ['██████▄', '██   ██', '██████▀', '██  ▀█▄', '██   ██'],
  };
  const word = ['D', 'E', 'E', 'P', 'C', 'O', 'R', 'E'];
  A.title = [0, 1, 2, 3, 4].map(function (i) {
    return word.map(function (ch) { return FONT[ch][i]; }).join(' ');
  });
  A.title.push('');
  // rig-over-strata vignette, drill string centered at col 31 of 63
  A.title.push(sp(30) + '╔═╗');
  A.title.push(sp(29) + '╔╝ ╚╗');
  A.title.push(sp(25) + '────╢▪▪▪╟────');
  A.title.push(sp(22) + '════════╩╦╩════════');
  A.title.push(rep('▀', 30) + '▌║▐' + rep('▀', 30));
  A.title.push(seg(TEX, 3, 30) + ' ║ ' + seg(TEX, 17, 30));
  A.title.push(seg(TEX, 11, 30) + ' ▼ ' + seg(TEX, 29, 30));
  A.title.push(seg(DTEX, 5, 63));

  // ---------------- strata banner (generic 3-line flash frame) ----------------
  // RESERVED for M-ANIM-2 (SPEC3 §A2): the descend interstitial frame that the
  // stratum name typewriters into. Unreferenced today — do not garbage-collect.
  A.strataBanner = [
    '╔' + rep('═', 10) + '▓▒░' + rep('═', 18) + '░▒▓' + rep('═', 10) + '╗',
    '║' + sp(44) + '║',
    '╚' + rep('═', 10) + '▓▒░' + rep('═', 18) + '░▒▓' + rep('═', 10) + '╝',
  ];

  // ---------------- descent animation (8 frames, 30x12) ----------------
  // Rock is sampled per-row so the strata stay put while the bit descends:
  // banks 13|mid 3|banks 14. Head '▐█▌', tip '▼', debris flickers by parity.
  function descentFrame(f) {
    const rows = [
      '           ╔══╦══╗            ',
      '     ══════╝  ║  ╚══════      ',
      rep('▀', 13) + '▌║▐' + rep('▀', 14),
    ];
    const head = 3 + f;
    const tip = head + 1;
    for (let r = 3; r <= 11; r++) {
      const L = r * 3, R = r * 5 + 7, M = r * 11 + 5;
      let row;
      if (r < head) {
        row = seg(TEX, L, 13) + ' ║ ' + seg(TEX, R, 14);
      } else if (r === head) {
        if (f === 7) {
          row = seg(TEX, L, 10) + '▒░▄' + '▐█▌' + '▄░▒' + seg(TEX, R + 3, 11);
        } else {
          row = seg(TEX, L, 10) + (f % 2 ? '▪ ▄' : ' ·▄') + '▐█▌' +
                (f % 2 ? '▄ ·' : '▄▪ ') + seg(TEX, R + 3, 11);
        }
      } else if (r === tip) {
        if (f === 7) {  // breach: light floods the cut
          row = seg(GLOW, 2, 12) + '☼' + ' ▼ ' + '☼' + seg(GLOW, 9, 13);
        } else {
          row = seg(TEX, L, 11) + '░░' + ' ▼ ' + '░░' + seg(TEX, R + 2, 12);
        }
      } else if (f === 6 && r === 11) {  // glow bleeding through the last seam
        row = seg(TEX, L, 12) + '░' + '░▒░' + '░' + seg(TEX, R + 1, 13);
      } else {
        row = seg(TEX, L, 13) + seg(TEX, M, 3) + seg(TEX, R, 14);
      }
      rows.push(row);
    }
    return rows;
  }
  A.descent = [0, 1, 2, 3, 4, 5, 6, 7].map(descentFrame);

  // ---------------- schematic header ----------------
  (function () {
    const mid = '│ ≡≡  R E C O V E R E D   S C H E M A T I C S  ≡≡ │';
    const half = rep('═', (mid.length - 3) >> 1);
    A.schematicHeader = ['╒' + half + '◆' + half + '╕', mid, '╘' + half + '◆' + half + '╛'];
  })();

  // ---------------- foundry header ----------------
  A.foundry = [
    '          ░ ▒ ░',
    '      ▄▄█████████▄▄',
    '        ▀▀█████▀▀        ▄▄▄  T H E   F O U N D R Y  ▄▄▄',
    '          █████          ══════════════◆══════════════',
    '       ▄▄█████████▄▄        cores ◈ hammered into steel',
    '      ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
  ];

  // ---------------- game over: the collapsed rig ----------------
  A.gameover = [
    '                        ·      ·',
    '                     ·     ▄▄     ·',
    '         ╔═╗        ▄▓▓▓▄▄▓▓▄',
    '         ║ ╚═╗     ▄▓▓▓▓▓▓▓▓▓▓▄',
    '         ╚╗  ╚═╦══▄▓▓▓▓▀▀▓▓▓▓▓▓▓▄',
    '    ▄     ╚═══╗║ ▓▓▓▀   ☼  ▀▓▓▓▓▓▄',
    '   ▓█▄  ☼     ║╚▄▓▓▀  ▄▄▄   ▀▓▓▓▓▓▄',
    '  ▄▓▓▓▄▄▄▄▄▄▄▄▓▓▓▄▄▄▓▓▓▓▓▄▄▄▓▓▓▓▓▓▄▄',
    ' ' + seg(TEX, 7, 16) + '░░' + seg(TEX, 30, 10) + '░' + seg(TEX, 50, 10),
    ' ' + seg(DTEX, 3, 39),
    '',
    '     ─══════  R I G   L O S T  ══════─',
  ];

  // ---------------- victory: THE CORE ----------------
  // M-HIRES Phase 2. This was 55 x 13 cells — 550 x 247 px, an ellipse more
  // than twice as wide as it was tall. It was drawn with x/rx and y/ry
  // normalised independently, which makes a shape that is circular in CELLS
  // and therefore flat on screen: the exact egg the brief warns about, only
  // squashed the other way. The core is the payoff image of the whole game
  // and it was not a sphere.
  //
  // Now it is rasterised through A.raster, which does the aspect arithmetic
  // in pixels: 33 x 17 cells is 330 x 323 px, round to within 2%. The silhouette
  // is sampled at 2 x 2 sub-cells so the rim steps in half-cells rather than
  // whole ones, and the radial shading ramp is kept exactly as it was — it is
  // what makes the thing read as a lit sphere instead of a disc, and §0 law 6
  // says legibility outranks any cleverness I could put in its place.
  // M-HIRES Phase 3 adds a `mode`. The INTERIOR is the shading ramp in both
  // modes — that ramp is what makes the thing read as a lit sphere rather
  // than a flat disc, and a uniform braille fill (⣿ is eight dots with gaps,
  // a halftone screen) throws that depth cue away. What braille genuinely
  // buys is the RIM: its sub-pixel is 5 x 4.75, near enough square, where a
  // quadrant's is 5 x 9.5, so the silhouette steps in quarter-cells instead
  // of half-cells. Shades inside, sub-cell at the edge — exactly the split
  // the brief describes, and it is the reading that wins under §0 law 6.
  // Merge seam (M-HIRES × M-CORELORE, resolved by the orchestrator): 13, not
  // 17. Composed height is VICTORY_H + 2 (the caption and the base rule), so
  // 13 gives the 15 rows the victory screen has always been laid out around.
  // At 17 the sphere stood 19 rows tall and pushed M-CORELORE's reveal to row
  // 30, where drawReveal's own guard suppressed it — the Core's answer to
  // GRIT, the payoff of the whole brief, silently never drawn. That screen has
  // to hold the sphere AND the stats AND two lines of dialogue AND two prompt
  // rows; under §0 law 6 the fix is to give the art less room, not to squeeze
  // the whitespace out of everything else. The disc is still built by the
  // Phase 2 rasterizer and shaded per sub-cell, so this is smaller than 17,
  // not coarser — and still far finer than the hand-drawn sphere it replaced.
  // 25 x 13, not 33 x 17. BOTH dimensions shrink together: a cell is 10x19 px,
  // so the block stays round on screen only while W/H stays near 1.9
  // (25*10 = 250 px across, 13*19 = 247 px down — rig_test pins this, and
  // shrinking the height alone turned the core into an ellipse).
  const VICTORY_W = 25, VICTORY_H = 13;
  A.coreSphere = function (mode) {
    const braille = mode === 'braille';
    const sy = braille ? 4 : 2;
    const bm = R.bitmap(VICTORY_W, VICTORY_H, 2, sy);
    const cx = bm.w / 2, cy = bm.h / 2;
    // Radius in sub-columns: the largest disc that fits BOTH axes once the
    // sub-pixel's aspect is accounted for, less half a cell of margin.
    const rad = Math.min(bm.w / 2, (bm.h / 2) * bm.aspect) - 0.6;
    R.disc(bm, cx, cy, rad, 1);
    const rim = braille ? R.braille(bm) : R.quadrants(bm);
    const full = 2 * sy;                                 // a fully covered cell

    const lines = [];
    for (let row = 0; row < VICTORY_H; row++) {
      let s = '';
      for (let col = 0; col < VICTORY_W; col++) {
        const cover = R.cellMask(bm, col, row).n;        // sub-pixels lit
        // distance from the core, 0 at the centre and 1 at the rim, measured
        // in the same aspect-corrected space the disc was drawn in
        const d = R.radial(bm, col * 2 + 1, row * sy + sy / 2, cx, cy, rad);
        let ch = ' ';
        if (cover === 0) {
          if (d <= 1.3 && (col * 7 + row * 13) % 9 === 0) ch = '·';   // sparks
        } else if (cover < full) {
          ch = rim[row][col];                            // sub-cell silhouette
        } else if (d <= 0.10) ch = '☼';
        else if (d <= 0.38) ch = '█';
        else if (d <= 0.62) ch = '▓';
        else if (d <= 0.82) ch = '▒';
        else ch = '░';
        s += ch;
      }
      lines.push(s);
    }
    // the tiny rig, silhouetted against the lower limb of the core
    const c = (VICTORY_W >> 1) - 1;
    lines[VICTORY_H - 5] = lay(lines[VICTORY_H - 5], c, ' ╥ ');
    lines[VICTORY_H - 4] = lay(lines[VICTORY_H - 4], c, '╔╩╗');
    lines[VICTORY_H - 3] = lay(lines[VICTORY_H - 3], c, '║·║');
    // padded to the full width so drawArt, which centres each line by its own
    // length, puts the caption over the sphere rather than 3 columns right of it
    const cap = '≡≡  T H E   C O R E  ≡≡';
    const lead = Math.max(0, (VICTORY_W - cap.length) >> 1);
    lines.unshift((sp(lead) + cap + sp(VICTORY_W)).slice(0, VICTORY_W));
    lines.push(rep('▀', VICTORY_W));
    return lines;
  };
  // The default is the BLOCK build: it needs nothing but the system font.
  // render.js swaps in the braille one only after probing that braille is
  // really there — see DC.Render.subcellMode().
  A.victory = A.coreSphere('blocks');
  // Published so fx.js's core pulse can band the shading against the real
  // geometry instead of a hardcoded half-width (it had rx = 28, which was
  // the OLD sphere).
  A.victoryGeom = { w: VICTORY_W, h: VICTORY_H, top: 1 };

  // ---------------- help: THE FIELD MANUAL (two pages) ----------------
  // M-MANUAL (SPEC3 §B). Two laws govern this block.
  //
  // 1. NOTHING IS TYPED. Every number, cost, duration, item name and glyph on
  //    these pages is read out of DC.DATA at composition time; the key labels
  //    are cross-checked against engine.js's real handlers by
  //    test/barks_test.js, which also retunes data.js underneath the composer
  //    and watches the page follow. CX-02/CX-03 were this manual claiming a
  //    40-point descent vent while the sim vented 45, and quakes past 22 when
  //    they start at 25. Copying a figure out of SPEC.md or out of the old
  //    page reopens exactly that bug — read it from D.
  //
  // 2. STRUCTURE IS COLOUR, NOT BOXES. Each page is composed on a small
  //    styled character grid. A cell carries either a TIER name — 'head',
  //    'body', 'bright', 'key', 'rule', 'grit' — or a TRUE game colour taken
  //    straight from data.js (items, ores, terrain, buildings), so the manual
  //    is a living legend instead of a description of one. render.js resolves
  //    the tiers, lifts any true colour too dark to read as text, and paints
  //    'key' cells inverse — those are the keycaps. art.js stays DOM-free and
  //    knows nothing about a canvas.
  (function () {
    // ---- page geometry (SPEC3 M-MANUAL: gutters >= 3 columns of air) ----
    const W = 72;                    // page width   (the screen allows 74)
    const H = 31;                    // page height  (the screen's whole budget)
    const CA = 1, CAW = 32;          // left column   x 1..32
    const GUT = 4;                   // gutter        x 33..36
    const CB = CA + CAW + GUT;       // right column  x 37..70
    const CBW = W - CB - 1;
    const CAPF = 7;                  // keycaps right-align into this field
    const NAMES = ['OPERATE', 'SURVIVE'];

    // A page is a character grid with a colour tier (or a true game colour)
    // and an inverse flag per cell. Plain text and coloured spans are then two
    // projections of the SAME grid, so the string the tests lint and the
    // pixels the player reads can never disagree.
    function Page(id, w, h) {
      this.id = id; this.w = w; this.h = h;
      this.ch = []; this.co = []; this.iv = [];
      for (let y = 0; y < h; y++) {
        this.ch.push(new Array(w).fill(' '));
        this.co.push(new Array(w).fill(null));
        this.iv.push(new Array(w).fill(false));
      }
    }
    Page.prototype.put = function (x, y, s, c, inv) {
      s = String(s);
      for (let i = 0; i < s.length; i++) {
        const X = x + i;
        if (X < 0 || X >= this.w || y < 0 || y >= this.h) continue;
        this.ch[y][X] = s[i];
        this.co[y][X] = c || 'body';
        this.iv[y][X] = !!inv;
      }
      return x + s.length;                       // next free column
    };
    // right-aligned: the string ENDS at rx-1. Returns its start column, so
    // callers can keep walking leftwards.
    Page.prototype.putR = function (rx, y, s, c, inv) {
      const x = rx - String(s).length;
      this.put(x, y, s, c, inv);
      return x;
    };
    Page.prototype.rule = function (x, y, w) { return this.put(x, y, rep('─', w), 'rule'); };
    // 'SECTION ─────────': the header word, then a hairline out to the column
    // edge. Structure without a single decorative box.
    Page.prototype.head = function (x, y, w, label) {
      const e = this.put(x, y, label, 'head');
      if (e + 2 <= x + w) this.rule(e + 1, y, x + w - e - 1);
      return e;
    };
    Page.prototype.cap = function (x, y, label) {      // an inverse keycap
      return this.put(x, y, ' ' + label + ' ', 'key', true);
    };
    Page.prototype.capR = function (rx, y, label) {
      return this.putR(rx, y, ' ' + label + ' ', 'key', true);
    };
    Page.prototype.text = function () {
      return this.ch.map(function (r) { return r.join(''); });
    };
    // runs of identical (colour, inverse) — what render paints, and the reason
    // a redesign costs no per-cell draw calls.
    Page.prototype.spans = function () {
      const out = [];
      for (let y = 0; y < this.h; y++) {
        const row = [];
        let x = 0;
        while (x < this.w) {
          const c = this.co[y][x], iv = this.iv[y][x];
          if (c === null && !iv) { x++; continue; }
          let e = x, t = '';
          while (e < this.w && this.co[y][e] === c && this.iv[y][e] === iv) { t += this.ch[y][e]; e++; }
          row.push({ x: x, t: t, c: c, inv: iv });
          x = e;
        }
        out.push(row);
      }
      return out;
    };
    // The rows laid out as two columns. Full-width sections (THE LINE, TIPS)
    // legitimately span the gutter; inside this band nothing may, and
    // test/barks_test.js holds the band to SPEC3's >= 3 columns of air.
    Page.prototype.cols = function (from, to) { this.colRows = [from, to]; };
    // painted cells / total cells — SPEC3's air budget (<= 60% ink per page)
    Page.prototype.ink = function () {
      let k = 0;
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++)
          if (this.iv[y][x] || this.ch[y][x] !== ' ') k++;
      return k / (this.w * this.h);
    };

    // paint a run of differently-coloured fragments left to right:
    // [['2 ', 'body'], ['▬', plate.color], [' → ', 'body'], ...]
    function rich(p, x, y, parts) {
      for (let i = 0; i < parts.length; i++) x = p.put(x, y, parts[i][0], parts[i][1]);
      return x;
    }

    // ---- every figure on both pages, read out of the balance data ----
    const C = D.COLORS;
    const IT = D.ITEMS;
    const num  = function (v) { return String(Math.round(v * 10) / 10); };
    const secs = function (ticks) { return num(ticks / D.TICK_HZ) + 's'; };

    const digRock    = secs(D.DIG_ROCK);
    const digRubble  = secs(D.DIG_RUBBLE);
    const orePeriod  = secs(D.BUILDINGS.extractor.period);
    const damperCoal = secs(D.BUILDINGS.damper.coalTicks);
    const odMult     = num(D.OVERDRIVE.drillMult);
    const quakeInst  = num(D.QUAKE.startInst);
    const calmPct    = num(D.BUILDINGS.damper.calm * 100);
    const damperMax  = num(D.DAMPER_MAX);
    const repairPl   = num(D.REPAIR_COST);
    const fuelPer    = num(D.FUEL_PER);
    const jump       = num(D.CURSOR_JUMP);
    const gearIn     = num(D.RECIPES.gear.in.ironPlate);
    const chgIn      = D.RECIPES.charge.in;
    // instability vented on descent — the same DATA key sim.js startStratum
    // subtracts, so retuning it retunes the manual and the sim together.
    const vent       = num(D.DESCEND_VENT);
    // The upgrade that makes repairs cheaper is NAMED, not quoted: the number
    // it swaps in lives in meta.js, which the manual cannot compose from, and
    // a figure this page cannot compose is a figure this page will not print.
    let fixName = '';
    for (let i = 0; i < D.META_UPGRADES.length; i++) {
      if (D.META_UPGRADES[i].id === 'm_fix') fixName = D.META_UPGRADES[i].name;
    }

    // ---- furniture shared by both pages ----
    function header(p, idx) {
      p.put(CA, 0, '▌', 'head');
      p.put(CA + 2, 0, 'DEEPCORE FIELD MANUAL', 'head');
      let x = W - 1;                       // tab strip, right-aligned
      for (let i = NAMES.length - 1; i >= 0; i--) {
        x = (i === idx) ? p.capR(x, 0, NAMES[i]) : p.putR(x - 1, 0, NAMES[i], 'body') - 1;
        x -= 1;
      }
      p.rule(CA, 1, W - CA - 1);
    }
    function footer(p, y) {
      let x = p.cap(CA, y, '←');
      x = p.cap(x + 1, y, '→');
      x = p.put(x + 2, y, 'or', 'body');
      for (let i = 0; i < NAMES.length; i++) x = p.cap(x + 1, y, String(i + 1));
      p.put(x + 2, y, 'turn the page', 'body');
      p.capR(p.putR(W - 1, y, 'leave the manual', 'body') - 1, y, 'ESC');
    }

    // ================= page 1 — OPERATE =================
    function buildOperate() {
      const p = new Page(NAMES[0], W, H);
      header(p, 0);
      p.cols(3, 17);                            // BUILD/CARGO | CURSOR

      // --- BUILD: hotkey, the machine's own letter in its own colour, cost
      p.head(CA, 3, CAW, 'BUILD');
      for (let i = 0; i < D.BUILD_ORDER.length; i++) {
        const b = D.BUILDINGS[D.BUILD_ORDER[i]];
        const y = 5 + i;
        p.cap(CA, y, String(i + 1));            // engine maps '1'..'n' by index
        p.put(CA + 5, y, b.letter, b.color);
        p.put(CA + 7, y, b.name, 'body');
        let x = CA + CAW;                       // costs right-align to the edge
        const keys = Object.keys(b.cost);
        for (let j = keys.length - 1; j >= 0; j--) {
          const it = IT[keys[j]];
          x = p.putR(x, y, it.glyph, it.color);
          x = p.putR(x - 1, y, String(b.cost[keys[j]]), 'bright') - 1;
        }
      }

      // --- CARGO: the legend is the goods themselves, in their true colours
      p.head(CA, 11, CAW, 'CARGO');
      const half = Math.ceil(D.ITEM_ORDER.length / 2);
      for (let i = 0; i < D.ITEM_ORDER.length; i++) {
        const it = IT[D.ITEM_ORDER[i]];
        const x = i < half ? CA : CA + 16;      // raws left, made goods right
        const y = 13 + (i % half);
        p.put(x, y, it.glyph, it.color);
        p.put(x + 2, y, it.name, 'body');
      }

      // --- CURSOR: a real two-column key table, keycaps right-aligned so the
      // descriptions share one left edge. Labels are cross-checked against
      // engine.js's handlers by test/barks_test.js.
      p.head(CB, 3, CBW, 'CURSOR · MOUSE OPTIONAL');
      const keys = [
        ['↑↓←→',  'move the cursor'],
        ['SHIFT', 'hold: jump ' + jump + ' tiles'],
        ['ENTER', 'place · use · repair'],
        ['X',     'demolish · dig rock ' + digRock],
        ['R',     'rotate the output side'],
        ['C',     'overdrive: ' + odMult + '× drill'],
        ['D',     'descend when BREACH READY'],
        ['SPACE', 'pause the run'],
        ['H',     'this manual'],
        ['ESC',   'drop tool · then pause'],
      ];
      for (let i = 0; i < keys.length; i++) {
        p.capR(CB + CAPF, 5 + i, keys[i][0]);
        p.put(CB + CAPF + 2, 5 + i, keys[i][1], 'body');
      }
      p.put(CB, 15, 'ENTER on the rig: overdrive', 'body');
      p.put(CB, 16, 'ENTER on an assembler: recipe', 'body');
      p.put(CB, 17, 'mouse: hover moves · drag lays', 'body');

      // --- THE LINE: the centrepiece. Ore falls down the page into the rig.
      p.head(CA, 19, W - CA - 1, 'THE LINE');
      let vx = CA + 2;
      for (const k in D.ORE_GLYPHS) {
        vx = p.put(vx, 21, D.ORE_GLYPHS[k].glyph, D.ORE_GLYPHS[k].color) + 1;
      }
      p.put(vx + 1, 21, 'ore veins in the rock', 'body');
      rich(p, CB, 21, [[String(D.STRATA_COUNT), 'bright'],
                       [' strata down to the Core', 'body']]);

      const belt = D.BUILDINGS.belt;
      const link = function (y, last, note) {
        p.put(CA + 3, y, last ? '▼' : '│', 'rule');
        p.put(CA + 6, y, rep(belt.letter, 3), belt.color);
        if (note) p.put(CA + 10, y, note, 'body');
      };
      const stage = function (y, b, parts) {
        p.put(CA + 3, y, b.letter, b.color);
        p.put(CA + 5, y, b.name, 'bright');
        rich(p, CA + 19, y, parts);
      };
      p.put(CA + 3, 22, '│', 'rule');
      stage(23, D.BUILDINGS.extractor, [
        ['on a vein · one ore every ' + orePeriod + ' out its marked side', 'body'],
      ]);
      link(24, false, 'belts carry it · corners turn themselves');
      stage(25, D.BUILDINGS.smelter, [
        [IT.ironOre.glyph, IT.ironOre.color], [' ore → ', 'body'],
        [IT.ironPlate.glyph, IT.ironPlate.color], [' plate · one ', 'body'],
        [IT.coal.glyph, IT.coal.color], [' coal per ' + fuelPer + ' smelts', 'body'],
      ]);
      link(26, false, 'ENTER arms lay-mode: move to lay a run');
      stage(27, D.BUILDINGS.assembler, [
        [gearIn + ' ', 'bright'], [IT.ironPlate.glyph, IT.ironPlate.color],
        [' → ', 'body'], [IT.gear.glyph, IT.gear.color], [' gear    ', 'body'],
        [rep(IT.crystal.glyph, chgIn.crystal), IT.crystal.color], [' + ', 'body'],
        [rep(IT.copperPlate.glyph, chgIn.copperPlate), IT.copperPlate.color], [' + ', 'body'],
        [rep(IT.coal.glyph, chgIn.coal), IT.coal.color], [' → ', 'body'],
        [IT.charge.glyph, IT.charge.color], [' charge', 'body'],
      ]);
      link(28, true, 'any tile of the rig takes a delivery');
      stage(29, D.BUILDINGS.hub, [
        ['feed it ', 'body'], [IT.gear.glyph, IT.gear.color], [' and ', 'body'],
        [IT.charge.glyph, IT.charge.color],
        [' · D descends, venting −' + vent, 'body'],
      ]);

      footer(p, H - 1);
      return p;
    }

    // ================= page 2 — SURVIVE =================
    function buildSurvive() {
      const p = new Page(NAMES[1], W, H);
      header(p, 1);
      p.cols(3, 21);                            // THE ROCK/DAMAGE | PRESSURE/DAMPER

      // --- THE ROCK: the hazard glossary, every glyph its true map colour
      p.head(CA, 3, CAW, 'THE ROCK');
      const T = D.TERRAIN;
      const rocks = [
        [T.rock.glyph, T.rock.color, 'rock', 'dig it out', 'X', digRock],
        [D.RUBBLE_GLYPH, C.gray, 'rubble', 'clear it', 'X', digRubble],
        [T.obsidian.glyph, T.obsidian.color, 'obsidian', 'never yields'],
        [T.chasm.glyph, T.chasm.color, 'chasm', 'no way across'],
        [T.magma.glyph, T.magma.color, 'magma', 'spreads · melts all'],
      ];
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i], y = 5 + i;
        p.put(CA, y, r[0], r[1]);
        p.put(CA + 2, y, r[2], 'body');
        const x = p.put(CA + 12, y, r[3], 'body');
        if (r[4]) p.put(p.cap(x + 1, y, r[4]) + 1, y, r[5], 'bright');
      }

      // --- PRESSURE: the one number that ends every run
      p.head(CB, 3, CBW, 'PRESSURE');
      p.put(CB, 5, 'instability starts climbing the', 'body');
      p.put(CB, 6, 'moment you land, and never stops.', 'body');
      rich(p, CB, 8, [['past ', 'body'], [quakeInst, 'bright'],
                      [' the quakes come — they', 'body']]);
      p.put(CB, 9, 'crack machines and bleed the hull.', 'body');
      // the gauge: the ░/▓ seam sits exactly where quakes begin, so the shape
      // of the bar IS the number beside it (scale from D.INSTAB_MAX).
      const GW = 18;
      const seam = Math.round(D.QUAKE.startInst / D.INSTAB_MAX * GW);
      const gx = p.put(CB, 11, 'calm ', 'body');
      p.put(gx, 11, rep('░', seam), C.green);
      p.put(gx + seam, 11, rep('▓', GW - seam), C.red);
      p.put(gx + GW + 1, 11, 'collapse', 'body');
      p.put(gx + seam, 12, '▲', 'bright');
      // the caption follows the marker, but a retune that pushes the seam right
      // must not shove it off the page — clamp it to the column instead
      const cap = 'quakes start at ';
      const capX = Math.min(gx + seam + 2, W - 1 - cap.length - quakeInst.length);
      rich(p, capX, 12, [[cap, 'body'], [quakeInst, 'bright']]);

      // --- DAMAGE & REPAIR
      p.head(CA, 14, CAW, 'DAMAGE');
      p.put(CA, 16, 'a cracked machine runs at half', 'body');
      rich(p, CA, 17, [['speed · at ', 'body'], ['0', 'bright'], [' it is scrap.', 'body']]);
      rich(p, p.cap(CA, 18, 'ENTER') + 1, 18, [
        ['repairs it · ', 'body'], [repairPl, 'bright'], [' ', 'body'],
        [IT.ironPlate.glyph, IT.ironPlate.color],
      ]);
      p.put(CA, 19, 'cheaper with ' + fixName + '.', 'body');
      rich(p, CA, 20, [['hull ', 'body'], ['0', 'bright'], [' and the rig is lost.', 'body']]);

      // --- THE DAMPER: the only lever on the pressure that is not the drill
      p.head(CB, 14, CBW, 'THE DAMPER');
      const dmp = D.BUILDINGS.damper;
      p.put(CB, 16, dmp.letter, dmp.color);        // the machine, not a keycap
      rich(p, CB + 2, 16, [
        ['burns one ', 'body'], [IT.coal.glyph, IT.coal.color],
        [' coal every ' + damperCoal, 'body'],
      ]);
      p.put(CB + 2, 17, 'and slows the climb −' + calmPct + '%', 'body');
      p.put(CB + 2, 18, 'each · up to ' + damperMax + ' of them.', 'body');
      p.put(CB, 20, 'descending vents −' + vent + ' pressure —', 'body');
      p.put(CB, 21, 'the rest only slows the climb.', 'body');

      // --- TIPS + the one line GRIT contributes to the documentation
      p.head(CA, 23, W - CA - 1, 'TIPS');
      const tips = [
        'run two smelters — one alone starves the assembler and the line dies',
        'do not camp: the pressure always wins. breach and move on',
        'bank ▬ iron plates for repairs — the quakes never stop coming',
      ];
      for (let i = 0; i < tips.length; i++) {
        p.put(CA, 25 + i, '▪', 'head');
        p.put(CA + 2, 25 + i, tips[i], 'body');
      }
      p.put(CA, 29, 'GRIT ▸ "Page 3 fell in a chasm. You\'re welcome."', 'grit');

      footer(p, H - 1);
      return p;
    }

    const pages = [buildOperate(), buildSurvive()];
    // The pager's asset: id, plain text (what the tests lint) and the coloured
    // spans (what render paints) — two projections of one grid.
    A.helpPages = pages.map(function (p) {
      return { id: p.id, w: p.w, h: p.h, colRows: p.colRows,
               text: p.text(), rows: p.spans(), ink: p.ink() };
    });
    A.HELP_LAYOUT = { W: W, H: H, CA: CA, CAW: CAW, GUT: GUT, CB: CB, CBW: CBW };
    // A.help stays the plain-text page 1 — the asset render falls back to and
    // the one the older suites already lint.
    A.help = A.helpPages[0].text;
  })();

  // ---------------- mantle banner ----------------
  (function () {
    const bar = '†' + rep('═', 16) + '  ‡  ' + rep('═', 16) + '†';
    const mid = '† †   T H E   M A N T L E   † †';
    A.mantle = [bar, sp((bar.length - mid.length) >> 1) + mid, bar];
  })();

  // ---------------- v1.1: layered rig portrait (SPEC2 §C.1) ----------------
  // The naked rig, exactly 24 x 12: derrick tower between the cab (left,
  // porthole windows) and the power shed (right, vents), drill string driven
  // through the wellhead into cracked strata.
  (function () {
    const rows = [];
    rows.push(sp(10) + '╔═╗' + sp(11));              // crown block
    rows.push(sp(10) + '╠▪╣' + sp(11));              // sheave
    rows.push(sp(9) + '╔╝│╚╗' + sp(10));             // upper legs, hoist cable
    rows.push(sp(9) + '║ │ ║' + sp(10));
    rows.push(sp(3) + '┌───┐╔╝ │ ╚╗┌───┐' + sp(4));  // cab roof · legs · shed roof
    rows.push(sp(3) + '│▪▪▪│║ ▄█▄ ║│≡≡≡│' + sp(4));  // windows · block · vents
    rows.push(sp(3) + '└───┘╢  ║  ╟└───┘' + sp(4));  // drill pipe
    rows.push(rep('▀', 10) + '▌║▐' + rep('▀', 11));  // surface + wellhead
    let r8  = seg(TEX, 3, 10)   + ' ║ ' + seg(TEX, 17, 11);
    let r9  = seg(TEX, 12, 10)  + ' ║ ' + seg(TEX, 27, 11);
    let r10 = seg(DTEX, 5, 10)  + ' ║ ' + seg(DTEX, 19, 11);
    let r11 = seg(DTEX, 14, 10) + ' ▼ ' + seg(DTEX, 33, 11);
    r8  = lay(r8, 13, '░');                          // cracks widening downward
    r9  = lay(r9, 8, '░');
    r10 = lay(lay(r10, 9, '░'), 13, '░');
    r11 = lay(lay(r11, 8, '░'), 14, '░');
    rows.push(r8, r9, r10, r11);
    A.rigBase = rows;
  })();

  // One overlay per meta upgrade id (data.js META_UPGRADES). Spaces are
  // transparent; every non-space cell region is disjoint from every other
  // part's, so composition order never matters.
  A.rigParts = {
    // riveted armor slabs down both flanks (cab + shed outer walls),
    // rising one row above the roofline
    m_hull:   { row: 3, col: 3, lines: [
      '▐               ▌',
      '▐               ▌',
      '▐               ▌',
      '▐               ▌',
    ] },
    m_damp:   { row: 3,  col: 10, lines: ['(◎)'] },                    // gyro ring mid-tower
    m_torque: { row: 11, col: 10, lines: ['█▼█'] },                    // fattened bit
    m_scan:   { row: 1,  col: 3,  lines: ['·˙·˙·',
                                          '  ╦  ',
                                          '  ║  '] },                  // antenna mast, cab roof
    m_salv:   { row: 4,  col: 20, lines: ['══╗ ',
                                          '  ║ ',
                                          ' ╘╨╛'] },                   // claw arm, right side
    m_stock:  { row: 4,  col: 0,  lines: ['╔═╗',
                                          '║▣║',
                                          '╚═╝'] },                    // cargo pod bolted left
    m_deep:   { row: 5,  col: 4,  lines: ['[♦]'] },                    // crystal vault in cab
    m_fix:    { row: 4,  col: 16, lines: ['┬┬┬',
                                          '×⌐×'] },                    // tool rack on the shed
    m_schem:  { row: 3,  col: 15, lines: ['╞≡≡╡'] },                   // blueprint tube, roof edge
  };

  // upgrades: {id: level} — any level >= 1 bolts the part on. Returns a fresh
  // 24 x 12 lines array; never mutates rigBase.
  A.composeRig = function (upgrades) {
    const out = A.rigBase.slice();
    if (upgrades) {
      for (const id in A.rigParts) {
        if (!(upgrades[id] >= 1)) continue;
        const p = A.rigParts[id];
        for (let i = 0; i < p.lines.length; i++) {
          const r = p.row + i;
          if (r < 0 || r >= out.length) continue;
          const src = p.lines[i];
          let row = out[r];
          for (let j = 0; j < src.length; j++) {
            if (src[j] !== ' ') row = lay(row, p.col + j, src[j]);
          }
          out[r] = row;
        }
      }
    }
    return out;
  };

  // ---------------- v1.1: schematic icons (SPEC2 §C.3, 10 x 5 each) ----------------
  A.schemIcons = {
    s_beltfree: [            // rollers under a humming belt
      '          ',
      '▶▶▶▶▶▶▶▶▶▶',
      '══════════',
      '○  ○  ○  ○',
      '          ',
    ],
    s_extract: [             // twin drill-heads chewing rock
      ' ▐█▌  ▐█▌ ',
      ' ▐█▌  ▐█▌ ',
      '  ▼    ▼  ',
      '▓▓░▓▓▓▓░▓▓',
      '▓▒▓▓░▓▓▓▒▓',
    ],
    s_smelt: [               // blast furnace mouth, fire inside
      '  ▄▄▄▄▄▄  ',
      ' ██▀▀▀▀██ ',
      ' ██☼☼☼☼██ ',
      ' ██▄▄▄▄██ ',
      ' ▀▀▀▀▀▀▀▀ ',
    ],
    s_coal: [                // scrubber stack venting clean, coal below
      '  ≡ ≡≡ ≡  ',
      ' ╔══════╗ ',
      ' ║░▒░▒░▒║ ',
      ' ╚══════╝ ',
      ' ♠♠ ♠♠ ♠♠ ',
    ],
    s_plate: [               // riveted hull plates
      '╔═══╦═══╗ ',
      '║▪▪▪║▪▪▪║ ',
      '╠═══╬═══╣ ',
      '║▪▪▪║▪▪▪║ ',
      '╚═══╩═══╝ ',
    ],
    s_damp: [                // seismograph trace going flat
      '┌────────┐',
      '│ ≈~──── │',
      '│   *    │',
      '└─┬────┬─┘',
      '  ▀    ▀  ',
    ],
    s_repair: [              // bot swarm around a machine
      ' ·×    ·  ',
      '×  ┌──┐ × ',
      '   │▓▓│·  ',
      ' · └──┘ × ',
      '  ×    ·  ',
    ],
    s_drill: [               // diamond-crowned bit
      '   ▐██▌   ',
      '   ▐██▌   ',
      '   ♦██♦   ',
      '    ♦♦    ',
      '  ░░░░░░  ',
    ],
    s_salvage: [             // claw over reclaimed scrap
      ' ═══╦═══  ',
      '    ║     ',
      '  ┌─╨─┐   ',
      '  ╘╗ ╔╛   ',
      ' ▬  ¤  ▬  ',
    ],
    s_survey: [              // sonar pinging downward
      '   ▄██▄   ',
      '  ( ▼▼ )  ',
      ' (( ·· )) ',
      '((  ··  ))',
      '(   ··   )',
    ],
    s_charge: [              // crystal ringing with resonance
      '   · ‡ ·  ',
      '  ) ♦♦ (  ',
      ' )) ♦♦ (( ',
      '  ) ♦♦ (  ',
      '   · ˙ ·  ',
    ],
    s_over: [                // throttle gauge buried in the red
      ' ┌──────┐ ',
      ' │▒▓█»»»│ ',
      ' └──┬───┘ ',
      ' ═══╧═══  ',
      '  »»»»»»  ',
    ],
    s_veins: [               // rock fat with ore
      '▓▓≡≡▓▓♦▓▓▓',
      '▓≡≡▓▓♦♦▓¢▓',
      '▓▓▓♠▓▓♦▓¢▓',
      '▓♠♠▓▓▓▓¢▓▓',
      '▓▓▓▓≡≡▓▓▓▓',
    ],
    s_gear: [                // meshed gears + the bronze recipe
      '  ▄█▄     ',
      '  █¤█▄█▄  ',
      '  ▀█▀█¤█  ',
      '     ▀█▀  ',
      ' ▬▬ ▶ ¤¤  ',
    ],
  };

  // ---------------- M-WIDE: 3-cell item & building icons ----------------
  // The sidebar used to say what you were holding with one character: '•' for
  // iron ore, '•' for copper ore, '•' for coal. Three items, three identical
  // dots, told apart by colour alone — which is the one channel a glyph grid
  // should never be asked to carry by itself (§0 law 6).
  //
  // These are pictograms rasterised through R.quadrants from a 6 x 2 sub-pixel
  // bitmap: three cells wide, two sub-rows tall, so an ore heap, a flat ingot
  // and a cut gem have genuinely different SHAPES at one row per item. The
  // bitmaps are the readable source — you can see the picture in the dots —
  // and the glyphs fall out of the same rasterizer the gauges use.
  A.ICON_W = 3;
  function icon3(top, bot) {
    const bm = R.bitmap(3, 1, 2, 2);
    const rows = [top, bot];
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 6; x++) if (rows[y][x] === '#') R.set(bm, x, y, 1);
    }
    return R.quadrants(bm)[0];
  }
  A.itemIcons = {
    ironOre:     icon3('.####.', '######'),   // a heap of broken rock
    copperOre:   icon3('.####.', '######'),
    coal:        icon3('.###..', '######'),   // a heap with one shoulder knocked off
    crystal:     icon3('..##..', '.####.'),   // a cut gem, tapering up
    ironPlate:   icon3('.####.', '.####.'),   // a flat bar
    copperPlate: icon3('.####.', '.####.'),
    gear:        icon3('#.##.#', '.####.'),   // a toothed wheel
    charge:      icon3('#.##.#', '..##..'),   // a core, throwing sparks off both sides
  };
  A.buildIcons = {
    belt:      icon3('.#.#.#', '#.#.#.'),     // a running diagonal: it moves
    extractor: icon3('.####.', '..##..'),     // a bit, biting down
    smelter:   icon3('######', '##..##'),     // a furnace with its mouth open
    assembler: icon3('######', '#.##.#'),     // a press on two legs
    damper:    icon3('#.#.#.', '.#.#.#'),     // a coil, absorbing
  };

  // 2-char sidebar badges + thematic card colors (keys into DC.DATA.COLORS)
  A.schemBadges = {
    s_beltfree: '▶▶', s_extract: '▼▼', s_smelt: '▬▬', s_coal: '♠♠',
    s_plate: '▐▌', s_damp: '∩∩', s_repair: '+×', s_drill: '♦▼',
    s_salvage: '╘╛', s_survey: '()', s_charge: '‡‡', s_over: '»»',
    s_veins: '≡≡', s_gear: '¤¤',
  };
  // ---------------- M-WIDE: the LOADOUT panel's two short strings ----------
  // run.schematics is tracked all run and shown for four seconds on the pick
  // screen, after which the player has twenty minutes to forget they took
  // Salvage Claws. The sidebar lists them permanently — which needs a name
  // that fits a 13-column field and an effect that fits an 11-column one.
  // The full name and the full sentence still exist on the card you choose
  // from; these are the reminder, not the pitch.
  A.SCHEM_SHORT_W = 13;
  A.SCHEM_EFFECT_W = 11;
  A.schemShort = {
    s_beltfree: 'Frictionless', s_extract: 'Twin Drills',  s_smelt: 'Blast Furnace',
    s_coal: 'Coal Scrubber',    s_plate: 'Hull Plating',   s_damp: 'Seismic Damp',
    s_repair: 'Repair Swarm',   s_drill: 'Diamond Bit',    s_salvage: 'Salvage Claws',
    s_survey: 'Deep Sonar',     s_charge: 'Resonance',     s_over: 'OD Coupling',
    s_veins: 'Rich Veins',      s_gear: 'Bronze Gears',
  };
  A.schemEffect = {
    s_beltfree: 'belts free',   s_extract: 'mine +35%',    s_smelt: 'smelt +30%',
    s_coal: 'coal x2',          s_plate: '+20 hull',       s_damp: 'press -25%',
    s_repair: 'self-repair',    s_drill: 'breach -15%',    s_salvage: 'salvage 60%',
    s_survey: 'full reveal',    s_charge: 'charges x2',    s_over: 'OD cost 1/2',
    s_veins: 'veins +50%',      s_gear: 'bronze gear',
  };
  A.schemColors = {
    s_beltfree: 'cyan', s_extract: 'amber', s_smelt: 'magma', s_coal: 'gray',
    s_plate: 'steel', s_damp: 'green', s_repair: 'green', s_drill: 'white',
    s_salvage: 'orange', s_survey: 'blue', s_charge: 'magenta', s_over: 'red',
    s_veins: 'magmaHot', s_gear: 'orange',
  };

  // ---------------- helpers & color suggestions ----------------
  // ---------------- M-GRITPLUS: elevator graffiti ----------------
  // One line of shaft wall scrolls past the cage on every descent. Twenty
  // years of miners with a paint stick and a grudge: the Company, the depth,
  // each other, and a couple of names that turn up again in the logbook if
  // M-EVENTS ever lands. Kept to 40 columns so the line clears the descent
  // frames on both sides at any screen the game draws on.
  A.GRAFFITI_W = 40;
  A.graffiti = [
    'DAY 400: STILL NO PONY  -MGMT',
    'TURN BACK  (crossed out, twice)',
    'GRIT WAS HERE - 20 YEARS. TWENTY.',
    'IF FOUND, I WAS RIGHT  -FMN. OKAFOR',
    'THE COMPANY OWES ME FOURTEEN SHIFTS',
    'DO NOT FEED THE DRILL AFTER MIDNIGHT',
    'MY OTHER RIG IS ALSO BROKEN',
    'STRATUM 6 SMELLS WRONG. TRUST ME.',
    'PENSION = MYTH  (SIGNED, EVERYONE)',
    'HI MOM. SORRY ABOUT THE HOLE.',
    'DID WE DIG TOO GREEDILY? NO. CORRECTLY.',
    'SAFETY MEETING CANCELLED - CAVE-IN',
    'FMN. VOSS OWES ME A BEER AND A LUNG',
    'THE ROCK LISTENS. BE POLITE.',
    'DAYS SINCE LAST INCIDENT: 0  (WAS 0)',
    'ELEVATOR INSPECTED BY: NOBODY, 1994',
    "IF YOU CAN READ THIS YOU'RE FALLING",
    'COMPANY PROPERTY. INCLUDING YOU.',
    'SEND SANDWICHES DOWN SHAFT FOUR',
    'THE HUM IS NOT THE MACHINERY',
    'I NAMED THE QUAKES. THEY ANSWER NOW.',
    'SHIFT 9: THE COAL WAS SINGING AGAIN',
    "DO NOT DIG WEST ON SEVEN. JUST DON'T.",
    'MGMT SAYS MORALE IS UP  (HA)',
    'REST IN PIECES, RIG TWELVE',
    'SOMEBODY FIX THE LIGHTS -EVERY YEAR',
    'THIS SHAFT IS PURE BAD DECISIONS',
    'CLOCK IN. CLOCK OUT. CLOCK IN. HELP.',
    'THE DEEP PAYS BETTER. ASK THE DEEP.',
    'MY WIFE THINKS I SELL INSURANCE',
    'WHOEVER TOOK MY THERMOS: I KNOW.',
    'FOREMEN ARE JUST LOUDER MINERS',
    'INSPECTORS WOULD LOVE IT DOWN HERE',
    "IT'S WARM. IT SHOULD NOT BE WARM.",
    'PRAY TO GRAVITY. SHE ALWAYS ANSWERS.',
    'SIXTY FLOORS OF NOPE  -FMN. ABARA',
    'TELL MY DRILL I LOVED HER',
    'NEW GUY: MIND THE THIRD RUNG',
    'WE ARE THE DEEPEST THING ALIVE',
    'LAST ONE OUT, TURN OFF THE PLANET',
  ];

  // ---------------- M-CORELORE: the egg cracks ----------------
  // The victory sphere is not redrawn here. This is an OVERLAY: give it the
  // sphere's rows and it hands back rows of the same shape with one hairline
  // fissure opened through the shell — so it composes with whatever the core
  // art is at the time, at whatever resolution, without either side knowing
  // about the other. The crack is drawn as VOID (spaces): the shell glows and
  // the fissure does not, which reads at a glance and needs no colour
  // agreement with render or fx (fx skips blank cells).
  //
  // Only shading ink is ever replaced, so lettering and the little rig
  // silhouetted against the lower limb survive untouched. Pure, deterministic,
  // no rng: same rows in, same rows out, every time.
  A.CRACK_INK = '█▓▒░☼';
  // Merge seam (M-HIRES × M-CORELORE, resolved by the orchestrator): M-HIRES
  // Phase 3 can build this sphere out of BRAILLE on a machine whose font
  // supplies it at the cell advance, and braille patterns are not in the block
  // list above. Left as a plain string test, `crackSphere` recognised 5 of the
  // braille sphere's 47 glyphs — so the egg would have barely opened on
  // exactly the machines that rendered it best. Ink is therefore a predicate:
  // the block shades, or any braille pattern (U+2800-28FF).
  // Lettering still survives untouched — no letter falls in that range.
  A.isCrackInk = function (ch) {
    if (!ch) return false;
    if (A.CRACK_INK.indexOf(ch) >= 0) return true;
    const c = ch.charCodeAt(0);
    return c >= 0x2800 && c <= 0x28FF;
  };
  // A fixed walk: one column of drift per row at most, so the seam is always
  // exactly one cell wide however tall the art gets. Hairline, not gash.
  const CRACK_STEP = [0, 1, 0, 0, -1, 0, 1, 1, 0, -1, 0, 0, 1, -1, 0, 1];
  A.crackSphere = function (lines) {
    if (!Array.isArray(lines) || !lines.length) return lines;
    const rows = lines.map(function (l) { return String(l == null ? '' : l); });
    const ink = A.isCrackInk;
    let top = -1, bot = -1, minC = 1e9, maxC = -1;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        if (!ink(rows[y][x])) continue;
        if (top < 0) top = y;
        bot = y;
        if (x < minC) minC = x;
        if (x > maxC) maxC = x;
      }
    }
    if (top < 0 || maxC < minC) return rows;              // nothing to crack
    const cells = rows.map(function (r) { return r.split(''); });
    const cx = (minC + maxC) >> 1;
    const half = Math.max(1, (maxC - minC) >> 1);
    const h = Math.max(1, bot - top);
    // Cells this crack has opened, so the seam can measure its own width.
    const cut = [];
    function isCut(y, x) { return !!(cut[y] && cut[y][x]); }
    function open(y, x) {
      if (y < 0 || y >= cells.length) return 0;
      const row = cells[y];
      if (x < 0 || x >= row.length) return 0;
      if (!ink(row[x])) return 0;                        // never touch lettering
      // A hairline, structurally: never open a cell that would leave three in
      // a row on the same line. The seam-join and a hair-branch can otherwise
      // land beside each other and tear a 3-wide gash — which reads as damage
      // to the art rather than as a crack, and which only shows up at some
      // sphere geometries. Guaranteeing it here means the crack stays a
      // hairline at ANY size, instead of being tuned to one.
      let run = 1;
      for (let i = x - 1; i >= 0 && isCut(y, i); i--) run++;
      for (let i = x + 1; i < row.length && isCut(y, i); i++) run++;
      if (run > 2) return 0;
      row[x] = ' ';
      (cut[y] || (cut[y] = []))[x] = 1;
      return 1;
    }
    // The seam climbs from the sphere's underside to its crown, drifting at
    // most one column per row and never wandering further from centre than a
    // twelfth of the half-width — so it scales with the art instead of being
    // tuned to one resolution.
    const wander = Math.max(1, Math.round(half / 12));
    const b1 = bot - Math.round(h * 0.35), b2 = bot - Math.round(h * 0.7);
    let opened = 0, x = cx;
    for (let y = bot, i = 0; y >= top; y--, i++) {
      const s = CRACK_STEP[i % CRACK_STEP.length];
      const nx = Math.max(cx - wander, Math.min(cx + wander, x + s));
      opened += open(y, nx);
      if (nx !== x) opened += open(y, x);                 // keep the seam joined
      x = nx;
      // two short hair-branches off the seam, deterministic in place and size
      if (y === b1 || y === b2) {
        const dir = (y & 1) ? 1 : -1;
        const len = Math.max(1, Math.round(half / 8));
        for (let k = 1; k <= len; k++) opened += open(y - k, x + dir * k);
      }
    }
    return opened ? cells.map(function (r) { return r.join(''); }) : rows;
  };

  // Pads every line with a uniform left margin so the block (as a whole)
  // is centered in `width` without breaking internal alignment.
  // ---------------- M-EVENTS: the expedition vignettes ----------------
  // One panel per authored event. The brief's ceiling is 40 x 14 for the
  // framed panel; the FRAME is drawn by render (a box with the event's title
  // in it), so the drawing itself gets the interior: 38 columns by 10 rows.
  // Every glyph here is already in the vendored subset — test/headless.js
  // pins that inventory, because a panel that tofus on somebody else's
  // machine is worse than no panel at all (SPEC3 §0 law 6).
  //
  // These are ICONS, not illustrations. At 10x19 pixels a cell there is no
  // rendering detail worth having: what a player needs from the picture is
  // to know in one glance which event this is, and to remember it afterward.
  A.EVENT_W = 38;
  A.EVENT_H = 10;
  A.eventFrames = {
    vault: [
      '     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '     ▓▓╔══════════════════╗▓▓',
      '     ▓▓║ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ ║▓▓',
      '     ▓▓║ ▒▒  ╔══════╗  ▒▒ ║▓▓',
      '  ▓▓▓▓▓╢ ▒▒  ║ ◎  ◎ ║  ▒▒ ╟▓▓',
      '  ▓▓▓▓▓╢ ▒▒  ╚══════╝  ▒▒ ╟▓▓',
      '     ▓▓║ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ ║▓▓',
      '     ▓▓╚══════════════════╝▓▓',
      '     ▓▓▓▓▓ COMPANY  BONDED ▓▓',
    ],
    crack: [
      '   ▓▓▓▓▓▓▓▓▓▓▓ ░ ▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓  ░  ▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓  ░░░  ▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓  ░ ▒ ░  ▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓  ░  ▒  ░  ▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓  ░   ▒   ░  ▓▓▓▓▓▓',
      '   ▓▓▓▓▓  ░    ▒    ░  ▓▓▓▓▓',
      '   ▓▓▓▓  ░     ░     ░  ▓▓▓▓',
      '           it is not wind',
    ],
    drone: [
      '        ▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
      '     ══╡  ▒▒▒▒▒▒▒▒▒▒  ╞══',
      '        ║  ◎      ◎  ║',
      '        ║   ▬▬▬▬▬▬   ║',
      '        ╚════╦═╦═════╝',
      '             ║ ║',
      '             ▼ ▼',
      '      COMPANY COMPLIANCE UNIT',
      '        "STAND BY FOR AUDIT"',
    ],
    pool: [
      '   ▓▓▓▓▓            ░  ▓▓▓▓▓',
      '   ▓▓▓▓   ░     ░      ▓▓▓▓▓',
      '   ▓▓▓        ░         ▓▓▓▓',
      '   ▓▓▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▓▓',
      '   ▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓',
      '   ▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓',
      '   ▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '        blood heat, exactly',
    ],
    ghost: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓      ░░      ▓▓▓▓▓',
      '   ▓▓▓▓▓      ░  ░      ▓▓▓▓',
      '   ▓▓▓▓       ░░░░       ▓▓▓',
      '   ▓▓▓         ░░         ▓▓',
      '   ▓▓         ░░░░         ▓',
      '   ▓         ░░  ░░         ',
      '            ◎ a lamp, lit',
      '        and nobody holding it',
    ],
    crate: [
      '     ┌──────────────────┐',
      '     │ ╔══════════════╗ │',
      '     │ ║ ▓▓▓▓▓▓▓▓▓▓▓▓ ║ │',
      '     │ ║ ▓▓  ·    ·▓▓ ║ │',
      '     │ ║ ▓▓▓▓▓▓▓▓▓▓▓▓ ║ │',
      '     │ ╚══════════════╝ │',
      '     └──────────────────┘',
      '       PERISHABLE — LIVE',
      '     something moved in there',
    ],
    rations: [
      '   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄',
      '   █ ▬▬ █ ▬▬ █ ▬▬ █ ▬▬ █ ▬▬█',
      '   █ ▬▬ █ ▬▬ █ ▬▬ █ ▬▬ █ ▬▬█',
      '   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
      '   ▓▓▓▓▓▓ ══════════ ▓▓▓▓▓▓▓',
      '   ▓▓▓▓ PROPERTY OF THE ▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓ COMPANY ▓▓▓▓▓▓▓▓',
      '',
      '      half-buried. still sealed.',
    ],
    ladder: [
      '   ▓▓▓▓▓▓▓║  ║▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓╠══╣▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓║  ║▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓╠══╣▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓║  ║▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓╠══╣▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓║  ║▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '      it goes UP. nothing is up.',
    ],
    door: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓┌────────┐▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓│ ▪ VOSS │▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓├────────┤▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓│░░░░░░░░│▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓│░░░░  ○ │▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓│░░░░░░░░│▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓└────────┘▓▓▓▓▓▓▓▓▓',
      '     a door. in solid rock.',
    ],
    tally: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓ ││││ ││││ ││││ ││││ ▓▓▓',
      '   ▓ ││││ ││││ ││││ ││││ ▓▓▓',
      '   ▓ ││││ ││││ ││││ ││││ ▓▓▓',
      '   ▓ ││││ ││││ ││││ ││││ ▓▓▓',
      '   ▓ ││││ ││││ ││││ │      ▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '     ninety-seven of something',
    ],
    seam: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓≡≡≡▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓≡≡≡≡≡▓▓▓▓▓▓♦♦▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓≡≡≡≡≡≡♦♦♦♦♦▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓≡≡≡♦♦♦♦▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓♦♦▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '     it hums. at your pitch.',
    ],
    terminal: [
      '        ┌──────────────┐',
      '        │ ░░░░░░░░░░░░ │',
      '        │ ░ SALVAGE  ░ │',
      '        │ ░ TERMINAL ░ │',
      '        │ ░  ONLINE  ░ │',
      '        │ ░░░░░░░░░░░░ │',
      '        ├──────────────┤',
      '        │ ▪▪▪▪▪▪▪▪▪▪▪▪ │',
      '        └──────────────┘',
    ],
    sump: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒',
      '   ░░░░░░░░ ▬▬ ░░░░░░░░░░░░░',
      '   ░░░░░░░░░░░░░ ¤ ░░░░░░░░░',
      '   ░░░ ▬ ░░░░░░░░░░░░░░░░░░░',
      '   ░░░░░░░░░░░░░░░░░░░░░░░░░',
      '',
      '    a whole shift is down there',
    ],
    watchman: [
      '   ▓▓▓▓▓▓▓▓ ╔═╗ ▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓ ║◎║ ▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▄▄▄╚═╝▄▄▄▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▄▓▓▓▓▓▓▓▓▓▓▓▄▓▓▓▓▓▓▓▓',
      '   ▓▓▓▄▓▓▓ RIG  IX ▓▓▓▄▓▓▓▓▓',
      '   ▓▓▄▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▄▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '    her lamp is still burning',
    ],
    coin: [
      '           ▄▄▄▄▄▄▄▄▄',
      '        ▄███████████████▄',
      '       ████ ░░░░░░░░░ ████',
      '      ████ ░  ◈   ◈  ░ ████',
      '      ████ ░   ▬▬▬   ░ ████',
      '       ████ ░░░░░░░░░ ████',
      '        ▀███████████████▀',
      '           ▀▀▀▀▀▀▀▀▀',
      '     minted before the collapse',
    ],
    crossing: [
      '   ▓▓▓▓▓▓▓▓▓║▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓║▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ══════════╬══════════════',
      '   ▓▓▓▓▓▓▓▓▓║▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓║▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '     somebody else is drilling',
      '        and it is not us',
    ],
    suit: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓ ○ ▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓ ▄███▄ ▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▄▄█████████▄▄▓▓▓▓▓▓',
      '   ▓▓▓▓▓ ███ ▪▪▪▪▪ ███ ▓▓▓▓▓',
      '   ▓▓▓▓▓▓ ▀▀▀▀▀▀▀▀▀▀▀ ▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '   a good suit. a very good suit.',
    ],
    shrine: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓ † ▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓ ┌───┐ ▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓ │ ¤ │ ▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓ └───┘ ▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓ ° ▒▒▒▒▒ ° ▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '     a gear, on a little altar',
    ],
    wind: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓  ·  ·   ·    ·  ·  ▓▓',
      '   ▓▓ ────────────────────▸▓',
      '   ▓▓   ·   ·  ·    ·   · ▓▓',
      '   ▓▓ ──────────────────▸ ▓▓',
      '   ▓▓▓  ·    ·   ·  ·   · ▓▓',
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '',
      '    air. moving. from below.',
    ],
    offer: [
      '   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓ ░░░░░░░░░ ▓▓▓▓▓▓▓',
      '   ▓▓▓▓▓ ░░         ░░ ▓▓▓▓▓',
      '   ▓▓▓▓ ░   ◈     ◈   ░ ▓▓▓▓',
      '   ▓▓▓▓ ░             ░ ▓▓▓▓',
      '   ▓▓▓▓▓ ░░  ═════  ░░ ▓▓▓▓▓',
      '   ▓▓▓▓▓▓▓ ░░░░░░░░░ ▓▓▓▓▓▓▓',
      '',
      '      it would like to trade',
    ],
  };
  // A panel that has not been drawn yet still frames correctly.
  A.eventFrame = function (id) {
    const f = A.eventFrames[id];
    return (Array.isArray(f) && f.length) ? f
      : ['', '', '        ┌──────────────┐',
         '        │  ?           ?  │', '        └──────────────┘'];
  };

  A.center = function (lines, width) {
    let w = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].length > w) w = lines[i].length;
    const m = sp(Math.max(0, (width - w) >> 1));
    return lines.map(function (l) { return m + l; });
  };

  A.color = {
    title: 'amber',
    strataBanner: 'amber',
    descent: 'amber',
    schematicHeader: 'cyan',
    foundry: 'orange',
    gameover: 'red',
    victory: 'magmaHot',
    help: 'amber',
    mantle: 'red',
  };
})();
