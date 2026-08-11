/* DEEPCORE — art.js
   ASCII art assets. Pure data + DC.Art.center helper. DOM-free.
   All assets are arrays of strings; widths <= 76 (help <= 74). */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const A = DC.Art = {};

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

  // ---------------- help: field manual (74 x 25) ----------------
  (function () {
    const padTo = function (s, n) { return s.length >= n ? s : s + sp(n - s.length); };
    const L = [
      'CONTROLS',
      '1..5   build tools:',
      '       1 belt      2 extractor',
      '       3 smelter   4 assembler',
      '       5 damper',
      'X      demolish · dig rock (4s)',
      'R      rotate output side',
      'C      overdrive: 2x drill, +inst',
      'D      descend when BREACH READY',
      'SPACE  pause   ESC menu   H manual',
      'mouse: click places · drag = belts',
      '  click assembler: cycle recipe',
      '  click damaged machine: repair 2▬',
    ];
    const R = [
      'TERRAIN & HAZARDS',
      '▓ rock      dig with X, 4s',
      '█ obsidian  never yields',
      '░ chasm     impassable void',
      '≈ magma     spreads · melts all',
      '☼ rubble    clear with X, 2s',
      rep('─', 29),
      'instability always climbs; past',
      '22, quakes break machines and',
      'bleed hull integrity. V dampers',
      'slow it 25% each (max 3, coal).',
      'descending vents 40 instability.',
      'integrity 0 = the rig is lost.',
    ];
    const chain = [
      'PRODUCTION CHAIN ── belts into any rig tile deliver their cargo',
      '≡ ore ──▶ [E]xtractor ──▶ ▶▶▶ belt ──▶ [S]melter ──▶ ▬ plate  (♠ 1/3)',
      '▬▬ 2 iron plates ──▶ [A]ssembler ──▶ ¤ gear ──▶ belt into [D]rill rig',
      '♦ crystal + ▬ copper + ♠♠ coal ──▶ [A] ──▶ ‡ core charge  (stratum 5+)',
      'descend: goods carry on, machines are lost, instability vents −40',
    ];
    const tips = [
      'TIPS ▪ run two smelters — a lone smelter starves the assembler line',
      '     ▪ do not camp: instability always wins — breach and move on',
      '     ▪ bank iron plates for repairs; quakes never stop coming',
    ];
    const rows = [];
    const title = '╡ DEEPCORE · FIELD MANUAL ╞';
    const fl = (72 - title.length) >> 1;
    rows.push('╔' + rep('═', fl) + title + rep('═', 72 - fl - title.length) + '╗');
    for (let i = 0; i < L.length; i++) {
      rows.push('║ ' + padTo(L[i], 34) + ' │ ' + padTo(R[i], 33) + ' ║');
    }
    rows.push('╟' + rep('─', 36) + '┴' + rep('─', 35) + '╢');
    for (let i = 0; i < chain.length; i++) rows.push('║ ' + padTo(chain[i], 70) + ' ║');
    rows.push('╟' + rep('─', 72) + '╢');
    for (let i = 0; i < tips.length; i++) rows.push('║ ' + padTo(tips[i], 70) + ' ║');
    rows.push('╚' + rep('═', 72) + '╝');
    A.help = rows;
  })();

  // ---------------- mantle banner ----------------
  (function () {
    const bar = '†' + rep('═', 16) + '  ‡  ' + rep('═', 16) + '†';
    const mid = '† †   T H E   M A N T L E   † †';
    A.mantle = [bar, sp((bar.length - mid.length) >> 1) + mid, bar];
  })();

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
