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
  (function () {
    const rx = 27, ry = 6, W = rx * 2 + 1;   // 55 wide, 13 rows
    const lines = [];
    for (let y = -ry; y <= ry; y++) {
      let s = '';
      for (let x = -rx; x <= rx; x++) {
        const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        let ch = ' ';
        if (d <= 0.045) ch = '☼';
        else if (d <= 0.16) ch = '█';
        else if (d <= 0.42) ch = '▓';
        else if (d <= 0.72) ch = '▒';
        else if (d <= 1.0) ch = '░';
        else if (d <= 1.35 && (x * 7 + y * 13) % 9 === 0) ch = '·';
        s += ch;
      }
      lines.push(s);
    }
    // the tiny rig, silhouetted against the lower limb of the core
    const c = rx - 1;
    lines[ry + 4] = lay(lines[ry + 4], c, ' ╥ ');
    lines[ry + 5] = lay(lines[ry + 5], c, '╔╩╗');
    lines[ry + 6] = lay(lines[ry + 6], c, '║·║');
    const cap = '≡≡  T H E   C O R E  ≡≡';
    lines.unshift(sp((W - cap.length) >> 1) + cap);
    lines.push(rep('▀', W));
    A.victory = lines;
  })();

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
      p.put(CB, 20, 'descending vents −' + vent + ' pressure:', 'body');
      p.put(CB, 21, 'the only real relief there is.', 'body');

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

  // 2-char sidebar badges + thematic card colors (keys into DC.DATA.COLORS)
  A.schemBadges = {
    s_beltfree: '▶▶', s_extract: '▼▼', s_smelt: '▬▬', s_coal: '♠♠',
    s_plate: '▐▌', s_damp: '∩∩', s_repair: '+×', s_drill: '♦▼',
    s_salvage: '╘╛', s_survey: '()', s_charge: '‡‡', s_over: '»»',
    s_veins: '≡≡', s_gear: '¤¤',
  };
  A.schemColors = {
    s_beltfree: 'cyan', s_extract: 'amber', s_smelt: 'magma', s_coal: 'gray',
    s_plate: 'steel', s_damp: 'green', s_repair: 'green', s_drill: 'white',
    s_salvage: 'orange', s_survey: 'blue', s_charge: 'magenta', s_over: 'red',
    s_veins: 'magmaHot', s_gear: 'orange',
  };

  // ---------------- helpers & color suggestions ----------------
  // Pads every line with a uniform left margin so the block (as a whole)
  // is centered in `width` without breaking internal alignment.
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
