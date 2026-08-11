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

  // ---------------- help: field manual (74 x 30) ----------------
  // CX-02/CX-03: every number and key binding in here is COMPOSED from
  // DC.DATA (and cross-checked against engine.js's handlers) so the manual
  // can never drift from the sim again. If you retune data.js, the manual
  // retunes with it. Don't reintroduce literals.
  (function () {
    // pad-or-clip: a retuned constant can never break the box frame, and
    // test/barks_test.js asserts nothing is actually being clipped.
    const padTo = function (s, n) {
      return s.length >= n ? s.slice(0, n) : s + sp(n - s.length);
    };
    const n = function (v) { return String(Math.round(v * 10) / 10); };
    const secs = function (ticks) { return n(ticks / D.TICK_HZ); };

    // --- values pulled from the balance source of truth ---
    const digRock   = secs(D.DIG_ROCK);
    const digRubble = secs(D.DIG_RUBBLE);
    const odMult    = n(D.OVERDRIVE.drillMult);
    const quakeInst = n(D.QUAKE.startInst);
    const damper    = D.BUILDINGS.damper;
    const calmPct   = n(damper.calm * 100);
    const damperMax = n(D.DAMPER_MAX);
    const repairPl  = n(D.REPAIR_COST);
    const fuelPer   = n(D.FUEL_PER);
    const gearIn    = D.RECIPES.gear.in.ironPlate;
    const chgIn     = D.RECIPES.charge.in;
    // instability vented on descent — the same DATA key sim.js startStratum
    // subtracts, so retuning it retunes the manual and the sim together.
    const vent      = n(D.DESCEND_VENT);
    // first stratum whose breach needs core charges = when charges matter
    let chargeStratum = D.STRATA.length;
    for (let i = 0; i < D.STRATA.length; i++) {
      if (D.STRATA[i].breach.charge > 0) { chargeStratum = i + 1; break; }
    }
    // build hotkeys, straight off BUILD_ORDER (engine maps '1'..'5' by index)
    const tools = D.BUILD_ORDER.map(function (k, i) {
      return (i + 1) + ' ' + D.BUILDINGS[k].name;
    });

    const L = [
      'CONTROLS',
      '1..' + tools.length + '   build tools:',
      '       ' + padTo(tools[0], 12) + tools[1],
      '       ' + padTo(tools[2], 12) + tools[3],
      '       ' + tools[4],
      'X      demolish · dig rock (' + digRock + 's)',
      'R      rotate output side',
      'C      overdrive: ' + odMult + 'x drill, +inst',
      'D      descend when BREACH READY',
      'SPACE  pause   ESC menu   H manual',
      rep('─', 34),
      'MOUSE OPTIONAL — cursor play:',
      '↑↓←→   move cursor (SHIFT: x5)',
      'ENTER  place · interact · repair',
      '  belt tool: ENTER arms lay-mode,',
      '  moving lays belts, corners turn;',
      '  ENTER/ESC or tool swap disarms',
      'mouse: hover=cursor · drag = belts',
    ];
    const R = [
      'TERRAIN & HAZARDS',
      '▓ rock      dig with X, ' + digRock + 's',
      '█ obsidian  never yields',
      '░ chasm     impassable void',
      '≈ magma     spreads · melts all',
      '☼ rubble    clear with X, ' + digRubble + 's',
      rep('─', 29),
      'instability always climbs. past',
      'inst ' + quakeInst + ', quakes break machines',
      'and bleed hull integrity. dampers',
      'V slow it ' + calmPct + '% each (max ' + damperMax + ', coal).',
      'descending vents ' + vent + ' instability.',
      'integrity 0 = the rig is lost.',
      rep('─', 29),
      'ENTER/click on: hub = overdrive,',
      'assembler = recipe, damaged',
      'machine = repair (' + repairPl + '▬ · m_fix 1).',
      'GRIT is on the intercom. ignore.',
    ];
    const chain = [
      'PRODUCTION CHAIN ── belts into any rig tile deliver their cargo',
      '≡ ore ──▶ [E]xtractor ──▶ ▶▶▶ belt ──▶ [S]melter ──▶ ▬ plate  (♠ 1/' +
        fuelPer + ')',
      rep('▬', gearIn) + ' ' + gearIn + ' iron plates ──▶ [A]ssembler ──▶ ¤ gear' +
        ' ──▶ belt into [D]rill rig',
      '♦ crystal + ▬ copper + ' + rep('♠', chgIn.coal) + ' coal ──▶ [A] ──▶ ' +
        '‡ core charge  (stratum ' + chargeStratum + '+)',
      'descend: goods carry on, machines are lost, instability vents −' + vent,
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
