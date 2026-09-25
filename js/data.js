/* DEEPCORE — data.js
   Single source of truth: constants, items, terrain, buildings, recipes,
   strata, schematics, meta upgrades, colors, shared utilities.
   Loaded first. Must work in browser AND headless node (no DOM access). */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};

  // ---------------- utilities ----------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  DC.util = {
    mulberry32,
    ri: (rng, a, b) => a + Math.floor(rng() * (b - a + 1)),
    pick: (rng, arr) => arr[Math.floor(rng() * arr.length)],
    shuffle(rng, arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    pad: (s, n) => (s + ' '.repeat(n)).slice(0, n),
    padL: (s, n) => (' '.repeat(n) + s).slice(-n),
  };

  const D = DC.DATA = {};

  // ---------------- core dimensions & timing ----------------
  // M-WIDE: 112, not 80. The grid is the game's window, and at 80x33 of 10x19
  // it is aspect 1.276 against a 16:9 monitor's 1.778 — aspect-preserving
  // scaling MUST letterbox that, so the black bars were never a scaling bug
  // and no sharpening pass could close them. 112 columns is 16:9 almost
  // exactly (112*10 / 33*19 = 1.786); wider aspects letterbox the remainder
  // rather than the game chasing every panel on the market.
  // THE MAP DOES NOT GROW WITH IT: MAP_W/MAP_H below are untouched, so vein
  // density, walk distances and quake coverage are the same game they were.
  // Every column this adds is UI (render.js derives its panel columns from it).
  D.COLS = 112;           // total character grid width
  D.ROWS = 33;            // total character grid height
  D.MAP_W = 46;           // stratum map width  (tiles)
  D.MAP_H = 26;           // stratum map height (tiles)
  D.MAP_X = 1;            // map viewport origin (grid col) inside border
  D.MAP_Y = 3;            // map viewport origin (grid row) inside border
  D.TICK_HZ = 8;          // logic ticks per second
  D.BELT_PERIOD = 2;      // belt items advance 1 tile every N ticks (4 tiles/s)
  D.DRILL_PERIOD = 8;     // drill consumes 1 feed item every N ticks (1/s)
  D.REVEAL_R0 = 10;       // starting scan radius around hub
  D.REVEAL_TICKS = 16;    // +1 radius every N ticks (2s)
  D.DIG_ROCK = 32;        // ticks to excavate rock (4s)
  D.DIG_RUBBLE = 16;      // ticks to clear rubble (2s)
  D.INPUT_CAP = 8;        // max per-item machine input buffer
  D.FUEL_PER = 3;         // smelts per 1 coal
  D.STRATA_COUNT = 8;     // breach stratum 8 => victory; 9+ = The Mantle
  D.DEPTH_M = 120;        // meters per stratum (flavor)

  // ---------------- M-ONBOARD: diagnostics (SPEC3 M-ONBOARD Part 1) ----------
  // Seconds a fault must PERSIST before the LOG names its cause. These are
  // debounce windows, not timers: a machine whose output backs up for a moment
  // in a busy base is working correctly, and a line that fires on that teaches
  // nothing. Long enough that ordinary play never trips them, short enough that
  // a player who has genuinely stalled is told while still looking at the thing.
  D.DIAG = {
    blockedT: 8,   // output full and nothing taking it away
    nofuelT: 6,    // a burner gone dry
    starveT: 15,   // an assembler missing an input its recipe needs
    beltJamT: 8,   // an item on a belt that has not advanced
    stallT: 60,    // the rig short of a breach item with none in stock
  };

  // ---------------- M-ONBOARD: the first-run tutorial (Part 2) ---------------
  // Four beats, each gated on the player actually doing the thing. The numbers
  // here are the SHAPE of the induction, not its content: the box's geometry
  // (so the suites can hold every authored line to a box that never truncates
  // it), and how long GRIT waits before he says the same thing differently.
  //
  // `boxW` is 40 against a 46-wide map on purpose — it centres ON THE MAP with
  // three columns of map showing either side, so the box reads as a thing
  // sitting on the floor rather than as a new screen. Everything right of the
  // map is live UI (CHAIN, STOCK) and the tutorial's job is to point AT those,
  // never to sit on them.
  D.TUTORIAL = {
    boxW: 40,        // speech box width in cells, walls included
    proseRows: 3,    // rows of GRIT inside it (the authored line wraps to these)
    // M-TUTORIAL2 (Finding 4): GRIT's face rides the left edge of the prose
    // rows — 5 cells of portrait and 1 of air. The prose ceiling every line is
    // written to DROPS by this much (36 -> 30), which is a writing cost paid
    // once, deliberately, before act two was authored (see SPEC3 Finding 4).
    faceW: 6,
    nudgeT: 22,      // seconds on one beat before he re-riffs the same lesson
    nudgeMax: 3,     // ...and how many times, before he lets the silence work
    holdT: 4,        // seconds the completed beat's box lingers before the next
    armT: 30,        // seconds to wait for the sweep to reveal a vein, then give up
    skipKey: 'Tab',  // skippable from the first keypress, on a key play never uses
    // M-TUTORIAL2 (Finding 3, "better not longer"): the reactive induction's
    // two clocks. noticeT is how long GRIT's "already built one" line lingers
    // on a beat the player had ALREADY satisfied before it stamps and moves on
    // — long enough to read one row, short enough that a speedrunning veteran
    // watches the induction sprint to keep up. breakT is the act break after
    // beat 4: the legal minimum is met, TAB is offered a second time, and
    // staying is a choice — this is how long the choice stays on screen.
    noticeT: 2.5,
    breakT: 7,
  };

  // ---------------- palette (semantic) ----------------
  D.COLORS = {
    bg:       '#0a0a08',
    amber:    '#e8b45a',
    amberDim: '#6b5a36',
    white:    '#e8e6df',
    gray:     '#8a877c',
    darkgray: '#403d33',
    rock:     '#5a5245',
    cyan:     '#6fd1c7',
    green:    '#7fbf6a',
    red:      '#e05545',
    orange:   '#e07a35',
    magenta:  '#c77dff',
    blue:     '#7aa5e0',
    steel:    '#9aa4b0',
    // coal was #565650 = 2.68:1 on bg — a single '•' or '♠' at that contrast
    // is a smudge (CX-01). 5.12:1 clears the 4.5:1 glyph floor with margin and
    // is still the dullest material colour in the palette (steel 7.84, orange
    // 6.61, magenta 7.37) and dimmer than the UI gray 5.51 — coal reads as
    // coal, it just exists now.
    coal:     '#82827a',
    magma:    '#ff6a3d',
    magmaHot: '#ffd23d',
    // M-CORELORE: the Core's voice. Not amber — GRIT owns amber, and the whole
    // point of the second voice is that you know who is talking before you
    // read a word. Pale, cold gold, brighter than amber (13.1:1 on bg against
    // amber's 8.4:1) and never tagged.
    gold:     '#ffe9a8',
    // M-GRITPLUS/EGG-420: the botanical wash. Only ever MIXED into a colour
    // that already reads, never painted over one.
    leaf:     '#8ad36a',
    // M-WORMS: the two things down here that are alive and are not the cat.
    // Rose, because nothing else on this map is: the ores are steel, orange,
    // coal-grey and magenta, the terrain is brown/blue/black, magma is fire
    // and the cat is white. A vein worm can therefore be found in one glance
    // and can never be read as a belt, which is the whole of §0 law 6 for
    // this feature. 9.02:1 on bg; the Undertoad's deeper kin-rose is 5.68:1
    // and is drawn SHADED while it sleeps — a thing seen through rock.
    worm:     '#e89aa0',
    toad:     '#d2687e',
  };

  // ---------------- directions ----------------
  // facing: 0=N 1=E 2=S 3=W
  D.DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  D.ARROWS = ['▲', '▶', '▼', '◀']; // ▲ ▶ ▼ ◀

  // ---------------- items ----------------
  // `short`: STOCK-row label, <= 8 chars. Every pair stays distinguishable
  // down to a 6-char truncation ('iron o' / 'iron p', 'cu ore' / 'cu pla'),
  // so no row is ambiguous at any width the sidebar can offer (CX-11).
  D.ITEMS = {
    ironOre:     { name: 'iron ore',     short: 'iron ore', glyph: '•', color: D.COLORS.steel },   // •
    copperOre:   { name: 'copper ore',   short: 'cu ore',   glyph: '•', color: D.COLORS.orange },
    coal:        { name: 'coal',         short: 'coal',     glyph: '•', color: D.COLORS.coal },
    crystal:     { name: 'core crystal', short: 'crystal',  glyph: '♦', color: D.COLORS.magenta }, // ♦
    ironPlate:   { name: 'iron plate',   short: 'iron plt', glyph: '▬', color: D.COLORS.white },   // ▬
    copperPlate: { name: 'copper plate', short: 'cu plate', glyph: '▬', color: D.COLORS.orange },
    gear:        { name: 'drill gear',   short: 'gear',     glyph: '¤', color: D.COLORS.amber },   // ¤
    charge:      { name: 'core charge',  short: 'charge',   glyph: '‡', color: D.COLORS.magenta }, // ‡
  };
  D.ITEM_ORDER = ['ironOre', 'copperOre', 'coal', 'crystal',
                  'ironPlate', 'copperPlate', 'gear', 'charge'];

  // ---------------- terrain ----------------
  D.TERRAIN = {
    floor:    { glyph: '·', color: '#2e2c24', buildable: true  }, // ·
    rock:     { glyph: '▓', color: D.COLORS.rock, buildable: false, diggable: true },  // ▓
    obsidian: { glyph: '█', color: '#2a2632', buildable: false, diggable: false },     // █
    chasm:    { glyph: '░', color: '#1a2030', buildable: false, diggable: false },     // ░
    magma:    { glyph: '≈', color: D.COLORS.magma, buildable: false, diggable: false },// ≈
  };
  D.RUBBLE_GLYPH = '☼'; // ☼ rubble marker drawn over floor
  // Presentation only. Semantic ore, machine and hazard colours stay fixed.
  // Sparse details grow on bare floor; they never occupy a tile in the sim.
  D.BIOMES = [
    { rock: '#596044', floor: '#303c27', detail: '#536344', marks: ['\'', '`', ','], dust: '#879565' },
    { rock: '#795638', floor: '#443022', detail: '#765638', marks: ['·', ':', '─'], dust: '#c09565' },
    { rock: '#3d6461', floor: '#223b39', detail: '#3f625c', marks: [';', ',', '│'], dust: '#72a99d' },
    { rock: '#515e73', floor: '#2b303d', detail: '#4d5970', marks: ['/', '\\', ':'], dust: '#8f9db9' },
    { rock: '#634575', floor: '#34243f', detail: '#614473', marks: ['`', '\'', ':'], dust: '#b28bca' },
    { rock: '#744736', floor: '#3b2822', detail: '#6f4936', marks: ['.', ':', ','], dust: '#c88860' },
    { rock: '#514860', floor: '#282432', detail: '#51465f', marks: ['/', '─', '\\'], dust: '#9585a8' },
    { rock: '#786846', floor: '#3e3424', detail: '#6d5c3c', marks: [':', '`', '\''], dust: '#c5ad76' },
  ];
  D.ORE_GLYPHS = {
    ironOre:   { glyph: '≡', color: D.COLORS.steel },   // ≡
    copperOre: { glyph: '¢', color: D.COLORS.orange },  // ¢
    coal:      { glyph: '♠', color: D.COLORS.coal },    // ♠
    crystal:   { glyph: '♦', color: D.COLORS.magenta }, // ♦
  };

  // ---------------- buildings ----------------
  // cost paid from hub inventory. hp 2 = damaged at 1 (half speed), dead at 0.
  D.BUILDINGS = {
    belt:      { name: 'belt',      key: '1', letter: '▶', w: 1, h: 1, hp: 1,
                 cost: { ironPlate: 1 },  color: D.COLORS.cyan,
                 desc: 'Moves items. Drag to lay runs; corners auto-turn.' },
    extractor: { name: 'extractor', key: '2', letter: 'E', w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 4 },  color: D.COLORS.amber, period: 16,
                 desc: 'Place on an ore vein. Mines 1 ore / 2s to its output side.' },
    smelter:   { name: 'smelter',   key: '3', letter: 'S', w: 2, h: 2, hp: 2,
                 cost: { ironPlate: 5 }, color: D.COLORS.orange,
                 desc: 'Smelts ore into plates. Burns 1 coal per 3 smelts.' },
    assembler: { name: 'assembler', key: '4', letter: 'A', w: 2, h: 2, hp: 2,
                 cost: { ironPlate: 6 }, color: D.COLORS.blue,
                 desc: 'Crafts drill gears / core charges. Click to switch recipe.' },
    damper:    { name: 'damper',    key: '5', letter: 'V', w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 6, copperPlate: 2 }, color: D.COLORS.green,
                 coalTicks: 40, calm: 0.25,
                 desc: 'Burns 1 coal / 5s to vent pressure: −25% instability rate each (max 3).' },
    // ---------------- M-TIER2: Logistics II (SPEC3) ----------------
    // Five structures that are all the SAME LESSON as the belt: a thing hands
    // its cargo to the tile its arrow points at, and to no other. The splitter
    // has two arrows, the tunnel's second arrow is four tiles away and the
    // loader's points out of a machine instead of into one — but not one of
    // them takes cargo from a neighbour just for standing there. That rule is
    // the game's whole logistics grammar (test/headless.js checkRigOutput), so
    // tier II conjugates it rather than adding exceptions to it.
    //
    // `unlockDepth` seals them until the stratum named: the first two floors
    // are where a player learns extractor → belt → smelter → assembler, and a
    // build list of ten on stratum 1 teaches nothing but hesitation (§0 law 6).
    // canPlace refuses them above it and the BUILD panel does not list them.
    //
    // Letters are ASCII capitals in the belt's cyan — the colour says "cargo
    // moves through this", the letter says which one — except the crusher,
    // which makes a material and wears that material's colour like the
    // smelter does. All six glyphs are checked against the map's existing
    // inventory (▓ ▒ ░ · ≡ ♠ ¢ ♦ ☼ ≈ E S A V D and the belt arrows) and
    // against vendor/deepcore-mono.woff2 by node tools/glyphs.js.
    splitter:  { name: 'splitter',  key: '6', letter: 'Y', w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 4 }, color: D.COLORS.cyan, unlockDepth: 3,
                 desc: 'Fans one line into two: cargo alternates left and right of its arrow.' },
    // 'U' dives, '∩' surfaces — the two glyphs are mirrors of each other, so
    // an end that swallows and an end that spits can never be confused.
    tunnel:    { name: 'tunnel',    key: '7', letter: 'U', letterOut: '∩',
                 w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 3 }, color: D.COLORS.cyan, unlockDepth: 3,
                 gap: 4,
                 desc: 'Two of them, same arrow, up to 4 tiles apart: cargo runs under anything.' },
    loader:    { name: 'loader',    key: '8', letter: 'L', w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 5 }, color: D.COLORS.cyan, unlockDepth: 3,
                 desc: 'Empties the machine behind it out its own arrow — a second output side.' },
    // The hazard, banked. Quakes bury a base in rubble the player then digs by
    // hand; a crusher standing in the mess clears it AND pays for it, so the
    // deep strata's worst habit becomes the deep strata's supply line.
    crusher:   { name: 'crusher',   key: '9', letter: 'C', w: 2, h: 2, hp: 2,
                 cost: { ironPlate: 14 }, color: D.COLORS.steel, unlockDepth: 3,
                 period: 24, reach: 6, yield: 2, rockYield: 1,
                 desc: 'Grinds rubble within 6 tiles into 2 iron ore each. Quakes become supply.' },
    filter:    { name: 'filter',    key: '0', letter: 'F', w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 2, copperPlate: 1 }, color: D.COLORS.cyan,
                 unlockDepth: 3,
                 desc: 'A gate one cargo passes. Click it to choose which. The rest waits.' },
    hub:       { name: 'drill rig', letter: 'D', w: 3, h: 3, hp: Infinity,
                 cost: {}, color: D.COLORS.amber,
                 desc: 'The rig. Feed it drill gears & core charges by belt to breach.' },
  };
  // Order IS the hotkey: engine.js binds '1'..'9' then '0' by index, and the
  // manual and the tutorial both compose their keycaps from this list, so the
  // five tier-I entries stay exactly where they were.
  D.BUILD_ORDER = ['belt', 'extractor', 'smelter', 'assembler', 'damper',
                   'splitter', 'tunnel', 'loader', 'crusher', 'filter'];
  D.DAMPER_MAX = 3;          // max stacking dampers
  D.REPAIR_COST = 2;         // ironPlate per repair (meta m_fix lowers to 1)
  D.DEMOLISH_REFUND = 0.5;   // fraction of cost refunded
  D.UNDO_TICKS = 10 * D.TICK_HZ; // full refund for intact machines placed by mistake
  D.PRESSURE_MULT = 0.90;    // M-HUMANBAL: 'a bit slower', across all floors

  // ---------------- recipes ----------------
  // Tick counts set the whole economy's tempo: one smelter = 0.5 plate/s,
  // one assembler = 1 gear / 2.75s. A chain (smelter + 2 extractors + belts,
  // ~32 plates) now pays for itself in ~64s, so building one INSIDE a stratum
  // is worth doing — at ticks 20/28 it barely broke even before the stratum
  // ended, which is what made stratum 2 a coin flip. (Balance pass, M-POLISH.)
  D.RECIPES = {
    smeltIron:   { in: { ironOre: 1 },   out: { ironPlate: 1 },   ticks: 16, fuel: true },
    smeltCopper: { in: { copperOre: 1 }, out: { copperPlate: 1 }, ticks: 16, fuel: true },
    gear:        { in: { ironPlate: 2 }, out: { gear: 1 },        ticks: 22 },
    bronzeGear:  { in: { ironPlate: 1, copperPlate: 1 }, out: { gear: 2 }, ticks: 22,
                   requires: 's_gear' },  // only with Bronze Gearworks schematic
    charge:      { in: { crystal: 1, copperPlate: 1, coal: 2 }, out: { charge: 1 }, ticks: 32 },
  };
  D.SMELTER_RECIPES = ['smeltIron', 'smeltCopper'];   // auto-picked by available input
  D.ASSEMBLER_RECIPES = ['gear', 'bronzeGear', 'charge']; // click cycles unlocked ones

  // ---------------- strata ----------------
  // instabRate: instability per second. quakeBase: seconds between quakes (jittered).
  // ores: relative weights for vein type rolls. nodes: vein blob count.
  // Balance pass (M-POLISH, measured with test/balance.js — 14 seeds x 2
  // policies). Three families of change, all for the same reason: at the old
  // numbers instability outran the drill. Every stratum starts at
  // (previous - 45), so a stratum that costs more than 45 instability
  // ratchets the run toward permanent collapse; at 0.45-0.90/s it cost 80-180
  // and NO seed survived stratum 2 with a naked rig.
  //   instabRate  -35% across the board  (0.29 .. 0.59)
  //   breach.gear cut where it outran a two-assembler base (deep strata -27%)
  //   crystal weight raised on 5-8: charges gate the breach there and 12% of
  //     stratum-5 maps rolled NO crystal vein at all (see notes: mapgen only
  //     guarantees iron + coal)
  D.STRATA = [
    { name: 'TOPSOIL RIDGE',      tag: 'loose earth, old roots',      accent: '#c9a86a',
      ores: { ironOre: 0.55, coal: 0.45 },                      nodes: 9,
      rich: [60, 100],  breach: { gear: 20, charge: 0 },
      instabRate: 0.29, quakeBase: 34, features: {} },
    { name: 'SANDSTONE DRIFTS',   tag: 'the wind is buried here',     accent: '#d98e4a',
      ores: { ironOre: 0.40, coal: 0.33, copperOre: 0.27 },     nodes: 10,
      rich: [70, 110],  breach: { gear: 28, charge: 0 },
      instabRate: 0.33, quakeBase: 32, features: {} },
    { name: 'KARST HOLLOWS',      tag: 'water carved these graves',   accent: '#5fb8a5',
      ores: { ironOre: 0.34, coal: 0.30, copperOre: 0.36 },     nodes: 10,
      rich: [70, 120],  breach: { gear: 36, charge: 0 },
      instabRate: 0.36, quakeBase: 30, features: { chasms: 3 } },
    { name: 'GRANITE ROOT',       tag: 'the mountain’s spine',        accent: '#8a9bb5',
      ores: { ironOre: 0.46, coal: 0.28, copperOre: 0.26 },     nodes: 11,
      rich: [90, 150],  breach: { gear: 46, charge: 0 },
      instabRate: 0.39, quakeBase: 29, features: { chasms: 2 } },
    { name: 'GLOWDEEP GALLERIES', tag: 'something down here shines',  accent: '#c77dff',
      ores: { ironOre: 0.28, coal: 0.26, copperOre: 0.20, crystal: 0.26 }, nodes: 12,
      rich: [90, 150],  breach: { gear: 46, charge: 6 },
      instabRate: 0.43, quakeBase: 28, features: { chasms: 2 } },
    { name: 'MAGMA FRINGE',       tag: 'the planet’s blood runs close', accent: '#ff7a45',
      ores: { ironOre: 0.27, coal: 0.25, copperOre: 0.20, crystal: 0.28 }, nodes: 12,
      rich: [100, 160], breach: { gear: 54, charge: 10 },
      instabRate: 0.47, quakeBase: 26, features: { chasms: 1, magma: 3 } },
    { name: 'OBSIDIAN WARRENS',   tag: 'glass walls, no echoes',      accent: '#9a6ae0',
      ores: { ironOre: 0.26, coal: 0.24, copperOre: 0.20, crystal: 0.30 }, nodes: 13,
      rich: [100, 170], breach: { gear: 62, charge: 14 },
      instabRate: 0.52, quakeBase: 24, features: { magma: 2, obsidian: true } },
    { name: 'THE CORE GATE',      tag: 'it knows you are coming',     accent: '#ffd23d',
      ores: { ironOre: 0.25, coal: 0.24, copperOre: 0.19, crystal: 0.32 }, nodes: 14,
      rich: [110, 180], breach: { gear: 80, charge: 20 },
      instabRate: 0.59, quakeBase: 22, features: { chasms: 2, magma: 3, obsidian: true } },
  ];
  // The Mantle: endless strata 9+ (k = depth - 8)
  D.mantleStratum = function (depth) {
    const k = depth - D.STRATA_COUNT;
    return {
      name: 'THE MANTLE ' + '†'.repeat(Math.min(k, 6)),  // † marks
      tag: 'there was never a bottom',
      accent: '#e04555',
      ores: { ironOre: 0.25, coal: 0.24, copperOre: 0.19, crystal: 0.32 },
      nodes: 14, rich: [110 + 10 * k, 180 + 15 * k],
      breach: { gear: 80 + 16 * k, charge: 20 + 6 * k },
      instabRate: 0.59 + 0.08 * k, quakeBase: Math.max(13, 22 - k),
      features: { chasms: 2, magma: 3 + Math.min(k, 4), obsidian: true },
    };
  };

  // ---------------- hazard tuning ----------------
  // integrityDmg softened (depth 0.8 -> 0.6, inst /30 -> /35) and quakeBase
  // flattened in the deep strata (see STRATA): a stratum-8 quake used to hit
  // for 11 every 17s, which spent a full 100-integrity rig in ~80s no matter
  // how well the base was played. startInst is deliberately UNCHANGED at 25 —
  // it is the number the manual quotes (CX-03).
  D.QUAKE = {
    startInst: 25,     // no quakes below this instability
    jitter: 0.35,      // ± fraction on interval
    collapseIvl: 9,    // seconds between quakes at instability 100 ("collapse")
    tiles: (inst, depth) => 2 + Math.floor(inst / 30) + Math.floor(depth / 3),
    integrityDmg: (inst, depth) => 2 + Math.floor(depth * 0.6) + Math.floor(inst / 35),
  };
  D.MAGMA = {
    period: 48,        // ticks between spread rolls (6s)
    spreadChance: 0.12,
    growthCap: 2.0,    // max magma tiles = initial * cap
    burnPeriod: 40,    // ticks between adjacency damage rolls (5s)
    hubBurn: 1,        // integrity per burn period if magma touches hub
  };
  D.OVERDRIVE = { drillMult: 2, instMult: 1.6 };
  // Instability refunded on descent. It was a bare literal in sim.js
  // startStratum AND a second bare literal in art.js's manual — the exact
  // shape of CX-02 (manual said 40, sim vented 45). It lives here now and is
  // read by BOTH consumers, so the two can never drift again; test/barks_test
  // asserts sim.js references this key rather than a number.
  D.DESCEND_VENT = 45;
  // The instability scale's ceiling. sim.js clamps instability to 0..100 and
  // ramps the quake timer over the same span; the manual draws its pressure
  // gauge against it (M-MANUAL). Declared here so the gauge is composed rather
  // than eyeballed — test/barks_test.js asserts sim.js's clamp still agrees
  // with this number, which is how the two stay married without touching sim.
  D.INSTAB_MAX = 100;
  // Cursor step while SHIFT is held (engine.js moveCursor). It was a bare
  // literal in engine.js and a typed '5' in the manual — CX-02's exact shape.
  // engine.js reads it and the manual composes from it (M-MANUAL).
  D.CURSOR_JUMP = 5;

  // ---------------- run start ----------------
  D.START_STOCK = { ironPlate: 40, gear: 8 };
  D.START_INTEGRITY = 100;

  // ---------------- schematics (pick 1 of 3 on each breach) ----------------
  D.SCHEMATICS = [
    { id: 's_beltfree', name: 'Frictionless Rollers', desc: 'Belts cost nothing to place.' },
    { id: 's_extract',  name: 'Twin Drill-Heads',     desc: 'Extractors mine 35% faster.' },
    { id: 's_smelt',    name: 'Blast Furnaces',       desc: 'Smelters work 30% faster.' },
    { id: 's_coal',     name: 'Coal Scrubbers',       desc: 'Smelter fuel lasts twice as long.' },
    { id: 's_plate',    name: 'Hull Plating',         desc: '+20 max integrity, restored now.' },
    { id: 's_damp',     name: 'Seismic Dampers',      desc: 'Instability rises 25% slower.' },
    { id: 's_repair',   name: 'Repair Swarm',         desc: 'Damaged machines self-repair in 15s.' },
    { id: 's_drill',    name: 'Diamond Bit',          desc: 'Breach requirements −15%.' },
    { id: 's_salvage',  name: 'Salvage Claws',        desc: 'Descending refunds 60% of built machines.' },
    { id: 's_survey',   name: 'Deep Sonar',           desc: 'New strata start fully revealed.' },
    { id: 's_charge',   name: 'Resonant Charges',     desc: 'Core charges count double at the drill.' },
    { id: 's_over',     name: 'Overdrive Coupling',   desc: 'Overdrive instability penalty halved.' },
    { id: 's_veins',    name: 'Rich Veins',           desc: 'Ore veins in new strata are 50% richer.' },
    { id: 's_gear',     name: 'Bronze Gearworks',     desc: 'Unlock: 1 iron + 1 copper plate → 2 gears.' },
    // M-TIER2: four picks that multiply a structure rather than the rig, so
    // each is dealt only to a player who is RUNNING that structure. Two gates,
    // and the second is the one that matters:
    //
    //   `minDepth` — the floor the card is used on must have unlocked its
    //   structure at all (offerSchematics measures against the floor you are
    //   about to land on, not the one you are leaving).
    //   `needs`    — you have built one this run.
    //
    // A card that multiplies splitters is a dead pick to someone with no
    // splitters, and a breach pays exactly one pick. It also keeps the deck
    // the same 14 cards for a player who never touches tier II, which is why
    // the balance sweep does not drift a single number for the runs that do
    // not use this layer.
    { id: 's_conduit',  name: 'Deep Conduits',        minDepth: 3, needs: 'tunnel',
      desc: 'Underground belts reach twice as far.' },
    { id: 's_yoke',     name: 'Trident Yokes',        minDepth: 3, needs: 'splitter',
      desc: 'Splitters feed a third line straight ahead.' },
    { id: 's_gate',     name: 'Sorting Gates',        minDepth: 3, needs: 'filter',
      desc: 'Filters shunt what they do not pass to their right.' },
    { id: 's_grind',    name: 'Rock Grinders',        minDepth: 3, needs: 'crusher',
      desc: 'Crushers chew rock as well as rubble.' },
    // M-SCHEMS2: the second batch. Same Balatro grammar as the first fourteen
    // — a name and ONE consequence — and the same gating grammar as M-TIER2
    // where an ungated card would be a dead pick: `minDepth` measures the
    // floor the card is USED on, so the Magma Boiler is only dealt going down
    // to ground that has magma at all.
    { id: 's_boiler',   name: 'Magma Boiler',         minDepth: 6,
      desc: 'Smelters beside magma burn no coal.' },
    // Charges gate the breach from stratum 5 down; above that the card would
    // discount a recipe nothing is running.
    { id: 's_echo',     name: 'Echo Charges',         minDepth: 5,
      desc: 'Every fifth core charge assembles free.' },
    { id: 's_chute',    name: 'Gravity Chute',
      desc: 'Demolished machines refund 75% of their cost.' },
    { id: 's_jury',     name: 'Jury Rig',
      desc: 'Damaged machines run full speed. Each costs 1 hull a minute.' },
    { id: 's_insure',   name: 'Deep Insurance',
      desc: 'The first killing blow leaves 1 integrity instead. Once.' },
    { id: 's_loop',     name: 'Closed Loop',
      desc: 'Dampers burn no coal, but calm half as much.' },
    // `needsModule` names a DC module that must be LOADED for the card to be
    // in the deck at all — the schematic deck's copy of the mutator table's
    // `needs` contract. This is 'worm season' again: M-WORMS has not landed,
    // the card is written, and the day `DC.Worms` loads it deals itself.
    { id: 's_whisper',  name: 'Worm Whisperer',       needsModule: 'Worms',
      desc: 'Vein worms also come when the cursor calls.' },
  ];

  // ---------------- meta upgrades (Foundry) ----------------
  D.META_UPGRADES = [
    { id: 'm_stock',  name: 'Deeper Stores',     max: 2, costs: [2, 4],
      desc: '+20 plates & +4 gears at start (per lvl).' },
    { id: 'm_hull',   name: 'Reinforced Hull',   max: 2, costs: [3, 6],
      desc: '+25 max integrity (per level).' },
    { id: 'm_damp',   name: 'Gyro Dampers',      max: 2, costs: [4, 8],
      desc: 'Instability rises 12% slower (per level).' },
    { id: 'm_torque', name: 'Drill Torque',      max: 2, costs: [4, 8],
      desc: 'Drill feeds & breaches 12% faster/lvl.' },
    { id: 'm_fix',    name: 'Field Kits',        max: 1, costs: [3],
      desc: 'Repairs cost 1 plate instead of 2.' },
    { id: 'm_scan',   name: 'Prospector Array',  max: 1, costs: [5],
      desc: 'Rig scan starts 8 tiles wider.' },
    { id: 'm_salv',   name: 'Salvage Rig',       max: 1, costs: [6],
      desc: 'Descending refunds 40% of built machines.' },
    { id: 'm_deep',   name: 'Deep Stock',        max: 1, costs: [6],
      desc: 'Start with +10 copper plates, 2 charges.' },
    { id: 'm_schem',  name: 'Schematic Library', max: 1, costs: [8],
      desc: 'Choose from 4 schematics instead of 3.' },
  ];
  D.WIN_CORES = 10;  // bonus cores for reaching the Core (breaching stratum 8)

  // ---------------- M-CORELORE: the second voice ----------------
  // The Core intrudes on the foreman bar from CORE_DEPTH down, at most once a
  // stratum, and holds the three Core Gate beats at the breach fractions
  // below. Everything here is timing and reach — the writing is in barks.js.
  D.CORE = {
    depth: 6,          // first stratum the Core is awake on
    chance: 0.0018,    // per-tick intrusion roll once armed (~1 in 9 minutes)
    armT: 25,          // seconds into a stratum before it may speak at all
    hold: 9,           // seconds the gold line holds the bar
    beat: [0.25, 0.60, 0.95],  // Core Gate beats, as breach-feed fractions
    offer: 9,          // seconds the fake [ENTER] ASCEND prompt is displayed
  };

  // ---------------- M-GRITPLUS ----------------
  // Idle ladder: seconds of nothing before each rung of GRIT's attention.
  D.IDLE_LADDER = [45, 90, 150];
  // EGG-420 — the Botanical Incident. A 42-second easter egg, never on the
  // critical path: typing the code during a run opens the window, and if
  // js/events.js is present it may also roll a tin at `digWeight` (that module
  // owns the roll; sim.js never draws for it, so the RNG stream is identical
  // whether or not it is loaded).
  D.EGG420 = {
    code: '420',       // typed during a run (engine keeps a 3-key buffer)
    codeGapMs: 1500,   // max gap between keys before the buffer forgets
    sec: 42,           // window length
    instMult: 0.9,     // the stratum relaxes too
    digWeight: 0.0042, // M-EVENTS dig-find weight (unused without that module)
    tint: 0.16,        // map wash strength — tint, don't paint (SPEC3 §0 law 6)
    barkEvery: 14,     // seconds between mellow foreman lines
  };

  // ---------------- M-WONDERS: stratum landmarks ----------------
  // One per stratum, rolled by mapgen from the depth-gated pool below. A
  // landmark is terrain + lore + a real mechanical identity; it is never on the
  // critical path, so a map that cannot fit one is still a legal map.
  //
  // GLYPHS ARE FROM THE VENDORED SUBSET ONLY. `vendor/deepcore-mono.woff2`
  // carries exactly the inventory `node tools/glyphs.js` reports, and
  // regenerating it needs Python + fontTools that the suites deliberately do
  // not require. Every glyph below was already in that inventory before this
  // module existed, so the font is untouched and nothing can tofu. Check with
  // `node tools/glyphs.js` before editing any `art` string here.
  //
  // Fields:
  //   min      first stratum the landmark may roll on (mantle: everything)
  //   art      rows of glyphs, ' ' = not part of the landmark
  //   scatter  { n, r } instead of `art`: n loose cells within radius r
  //   base     terrain the landmark's tiles become — decides buildable/diggable
  //   color    key into D.COLORS
  //   needReach  placement must land on ground already walkable from the rig
  //   aura     { r, smelt|extract|damper } additive fractions: 0.15 = x1.15
  //   quakeSafe  quakes never target inside `aura.r`
  //   cost     click to activate, paid from hub stock
  //   jam      { every, dur } seconds — an activated landmark that naps
  //   dig      { ticks, yield } this landmark's tiles are excavatable
  //   ring     { veinMult, inst } one-shot click: richer veins, more pressure
  //   grant    'schematic' — one-shot click reward
  //   mirror   true — the reveal sweep bounces off it, once
  //   lore     tooltip lines, each <= Sim.SCAN_W (29) columns
  D.LANDMARKS = [
    { id: 'anvil', name: 'THE ANVIL', min: 1,
      art: ['▓█▓', '███', '▓█▓'], base: 'obsidian', color: 'steel',
      aura: { r: 5, smelt: 0.15 },
      lore: ['granite, and still warm', 'smelters within 5: +15%'] },

    { id: 'drowned', name: 'THE DROWNED MACHINE', min: 2,
      art: ['M▓', '▓▓'], base: 'obsidian', color: 'gray', onColor: 'green',
      cost: { ironPlate: 10 }, aura: { r: 4, extract: 1 },
      jam: { every: 45, dur: 10 }, doneMsg: 'she is already turning',
      lore: ['a pre-collapse extractor', 'click: restart (10 plates)'],
      onLore: ['she runs. she also naps.', 'extractors within 4: x2'] },

    { id: 'warmspot', name: 'THE WARM SPOT', min: 2,
      art: ['◎'], base: 'floor', color: 'amber', needReach: true,
      aura: { r: 6 }, quakeSafe: true,
      lore: ['the floor is warm here', 'quakes never land within 6'] },

    { id: 'glassforest', name: 'THE GLASS FOREST', min: 3,
      scatter: { n: 11, r: 4 }, glyph: '▲', base: 'obsidian', color: 'magenta',
      dig: { ticks: 64, yield: 'crystal' },
      lore: ['an obsidian spire', 'dig it out (X): 1 crystal'] },

    { id: 'seal', name: 'THE COMPANY SEAL', min: 4,
      art: ['╒╕', '╘╛'], base: 'obsidian', color: 'white', onColor: 'darkgray',
      cost: { ironPlate: 20 }, grant: 'schematic',
      doneMsg: 'the seal is already open',
      lore: ['a Company hatch, welded', 'click: open (20 plates)'],
      onLore: ['open. the file notes it.'] },

    { id: 'bell', name: 'THE BELL', min: 5,
      art: ['▟▙', '██'], base: 'obsidian', color: 'orange', onColor: 'darkgray',
      ring: { veinMult: 1.25, inst: 12 }, doneMsg: 'the bell is already struck',
      lore: ['bronze, and never struck', 'click: ring (+12 pressure)'],
      onLore: ['struck. something heard.'] },

    { id: 'mirror', name: 'THE MIRROR POOL', min: 5,
      art: ['▂▂▂'], base: 'chasm', color: 'cyan', mirror: true,
      lore: ['still water, still black', 'the scan bounces off it'] },

    { id: 'root', name: 'THE ROOT', min: 6,
      art: ['╥', '║', '║', '╨'], base: 'obsidian', color: 'magenta',
      aura: { r: 6, damper: 1 },
      lore: ['the planet braces here', 'dampers within 6 work double'] },
  ];
  D.LANDMARK_BY_ID = {};
  for (const L of D.LANDMARKS) D.LANDMARK_BY_ID[L.id] = L;
  // Tiles from the hub centre to the landmark anchor. Big enough that no aura
  // reaches the rig clearing for free — an aura is a reason to move the base,
  // never a bonus the opening layout collects by accident.
  D.LANDMARK_MIN_DIST = 12;
  // Seconds into a stratum before the discovery bark may fire. The arrival
  // line holds the foreman bar until ~12s; this waits it out (see sim.js).
  D.LANDMARK_BARK_T = 14;

  // ---------------- M-EVENTS: dig finds, vignettes & the cat ----------------
  // The rock has things in it, the dark between strata asks questions, and one
  // of the answers purrs. Timing and weights live here; every word of it lives
  // in js/events.js (the finds and the vignettes) and js/barks.js (GRIT's
  // answer to both). js/events.js owns all of this content's randomness on a
  // stream DERIVED from run.seed rather than run.rng — see the header of that
  // file for why the roll must not move the sim's stream position.
  D.EVENTS = {
    findRate: 0.08,       // fraction of completed ROCK excavations that yield
    vignetteChance: 0.25, // chance of an expedition vignette after a pick
    gasFuse: 8,           // ticks between the hiss and the pop (1s of warning)
    shaftR: 6,            // Old Shaft: radius of map revealed around the dig
    rigOncePerStratum: true, // a dead rig is salvaged once per floor, not five
    // M-ROCKORE (SPEC3 M-HUMANBAL Finding 8): the spoil. A completed ROCK dig
    // also rolls, SEPARATELY from findRate above, for a small ore payout —
    // the floor under bad luck for the run where the veins are on the far
    // wall and the crate is empty (Findings 1 and 6). Both rolls can land on
    // one dig; neither gates the other, and they do not even share a stream
    // (js/events.js owns a third derived channel for this one, so the finds
    // above sit at exactly the stream position M-EVENTS left them at).
    //
    // It is a FLOOR, never an economy: chance x mean = 0.45 ore per completed
    // dig, and X already charges 4s of standing still per hole, so hand-dug
    // ore costs ~9 seconds a unit against an extractor's 0.5/s. Nobody will
    // ever prefer the shovel; a stranded rig can still crawl out on it.
    //
    // `bias` multiplies the STRATUM's own vein weights (D.STRATA[].ores) to
    // decide which ore the spoil carries, so the answer is always what that
    // floor is made of — tilted toward what a stranded player is actually
    // stuck on. Iron and coal are the two things a dead base needs (plates,
    // then the fuel to make them: Finding 1's murder weapon is an empty coal
    // bin); copper rides at par; core crystal is damped hard because charges
    // are the BREACH GATE from stratum 5 down and a shovel must not be a way
    // around a gate. Deep-floor spoil goes from 32% crystal to 9%.
    rockOre: {
      chance: 0.30,       // of completed ROCK excavations (independent of findRate)
      min: 1, max: 2,     // units per payout, inclusive
      bias: { ironOre: 1.5, coal: 1.5, copperOre: 1.0, crystal: 0.3 },
    },
    // The cave-cat. Everything here is presentation cadence — the cat writes
    // nothing back into the sim, so none of it can move a balance number.
    catStep: 6,           // ticks between cat moves (~0.75s — chunky, law 2)
    catPerch: 40,         // ticks it holds a warm smelter before moving on
    catFlee: 2,           // seconds before a quake it breaks for the rig
    // The vignette panel. 40x14 is the brief's ceiling and the art is built to
    // it exactly, so every event frames identically and the choices land on
    // the same two rows every time (SPEC3 §0 law 6 — find it in one glance).
    panelW: 40, panelH: 14,
  };
  // Dig finds, weighted. `bark` names the js/barks.js pool GRIT answers with;
  // an absent pool is silently no barked line, never an error. Weights are
  // relative and need not sum to anything in particular — they sum to 100 here
  // because that makes the table readable as percentages of a find.
  D.FINDS = [
    { id: 'ore',      w: 24, amt: [6, 10], bark: 'digFind' },
    { id: 'cache',    w: 20, amt: [8, 15], bark: 'digFind' },
    { id: 'lunchbox', w: 14, bark: 'lunchbox' },
    { id: 'bones',    w: 14, bark: 'bones' },
    { id: 'gas',      w: 12, inst: 8, bark: 'gasPocket' },
    { id: 'shaft',    w: 10, bark: 'oldShaft' },
    { id: 'rig',      w: 6,  plates: 12, bark: 'deadRig' },
  ];

  // ---------------- M-MANTLE: mutators for the deep ----------------
  // From stratum 9 down, every floor rolls ONE mutator and wears it on the
  // banner. This is the Balatro half of the lineage note (§0): a pick with a
  // name and a single consequence a player can hold in their head, never a
  // sheet of modifiers. Seven of them, one per floor, rolled from `run.rng` at
  // exactly one site (sim.js startStratum) and stored on the run — law 7 means
  // a re-render must never re-roll, so nothing else in the tree may draw here.
  //
  // WHY 9 AND NOT EARLIER. Strata 1-8 are the game's argument, and it is the
  // same argument every run: the chain, the pressure, the descent. The Mantle
  // is where a player who has already won comes back for variety, and variety
  // that arrives before mastery is just noise (§0 law 4 — pressure forward,
  // never grind).
  //
  // `name` + `tag` are BOTH drawn, together, on the rule under the header —
  // 47 columns for the pair plus its furniture, which is why neither is prose.
  // The tag is the whole rule: if a mutator needs two sentences it is two
  // mutators, or it is the wrong mutator.
  //
  // `needs` names a DC module that must be LOADED for the mutator to be dealt
  // at all. An absent module is not an error and not a half-mutator: the entry
  // simply is not in the roll table, and the floor rolls one of the others.
  // That is how 'worm season' ships today — M-WORMS does not exist yet, the
  // line is written, and the day `DC.Worms` loads it deals itself.
  D.MUTATOR_DEPTH = D.STRATA_COUNT + 1;   // first floor that rolls one (9)
  D.MUTATORS = [
    // Inverts the reveal: the whole floor is handed to you and then taken
    // back, ring by ring from the edges, and the scan disc stops growing.
    // Everything it costs is arithmetic the reveal math already did.
    { id: 'dark', name: 'THE DARK RISES', tag: 'the map forgets',
      ringT: 20 },
    // A throughput question with a knife in it: the drill bites 1.7x as often
    // and swallows two gears a bite, so a base that was exactly keeping up is
    // now 15% short and a base with slack is a floor faster.
    { id: 'hungry', name: 'HUNGRY DRILL', tag: 'two gears a bite',
      gearCost: 2, drillMult: 1.7 },
    // A placement puzzle. No coal in the rock at all, and a smelter only works
    // where it can reach the planet's own furnace — which is out at the map's
    // edge, a long belt from the rig, and does not burn its smith.
    { id: 'coldseam', name: 'COLD SEAM', tag: 'lava smelts; coal-free charges',
      magma: 2 },
    // M-WORMS. Written, gated, and dealt the day that module loads.
    { id: 'worms', name: 'WORM SEASON', tag: 'three of them, hungry',
      needs: 'Worms', count: 3 },
    // The floor erodes under the base: a quake that lands on ground it has
    // already buried opens it instead. Camping a rubble field stops working.
    { id: 'glass', name: 'GLASS FLOORS', tag: 'rubble becomes hole' },
    // Pure barks, and the cheapest dread in the game: the Core repeats the
    // foreman back at him, wrong.
    { id: 'echo', name: 'ECHO CHAMBER', tag: 'something repeats you' },
    // The sprint. Cheaper to leave, far more expensive to stay.
    { id: 'seal', name: 'THE SEAL', tag: 'breach -30%, pressure +50%',
      breachMult: 0.7, instMult: 1.5 },
  ];
  D.MUTATOR_BY_ID = {};
  for (const M of D.MUTATORS) D.MUTATOR_BY_ID[M.id] = M;

  // ---------------- M-SCHEMS2 tuning ----------------
  // Echo Charges: one charge in this many is free. Five is the number the
  // brief names; it lives here because sim.js spends it AND Sim.chain divides
  // by it to keep the CHAIN panel's crystal draw honest, and CX-02 is what
  // happens when one number is typed in two places.
  D.ECHO_EVERY = 5;
  // Gravity Chute's refund, against D.DEMOLISH_REFUND's half.
  D.CHUTE_REFUND = 0.75;
  // Jury Rig: integrity a damaged machine costs per minute while it is being
  // run flat out. Per MACHINE — three broken machines is three a minute.
  D.JURY_DRAIN = 1;
  // Closed Loop: dampers stop burning coal and calm half as much.
  D.CLOSED_LOOP_CALM = 0.5;

  // ---------------- M-WORMS: something lives down here ----------------
  // Dwarf Fortress wildlife energy with zero combat (SPEC3 §0's lineage note):
  // hazards you MANAGE, and — once you work out the lure — tools. Every number
  // here is read by js/worms.js and by nothing else; the module is optional, so
  // a tree without it is a tree where this table is simply never consulted.
  //
  // WHY THE WORM IS A TOOL AND NOT A MONSTER. It cannot touch a machine, a
  // belt or a structure ("they dislike the taste of the Company"), so the only
  // ways it can reach you are the two it is FOR: it opens rock you would have
  // paid four seconds a tile to dig, and it eats five ore out of any vein it
  // swims through. That is a real cost and a real gift out of one creature,
  // and `lureCost` is the price of aiming it.
  D.WORMS = {
    minDepth: 3,        // s3+ — the tutorial owns stratum 1 and never meets one
    count: [1, 2],      // per stratum, inclusive (worm season overrides to 3)
    stepT: 16,          // ticks per tile (2s at 8Hz) — chunky on purpose (law 2)
    segs: 3,            // '~~o': two tail segments behind the head
    eat: 5,             // ore taken out of a vein tile the head passes through
    lureCost: 2,        // coal per lure
    turn: 0.28,         // chance a wandering worm changes its mind at a step
    spawnMinD: 11,      // tiles from the rig centre a worm may first appear
  };
  // The Undertoad. At most ONE per run, from stratum 6, on 15% of the maps
  // that are allowed one — the best mining site in the game, priced in
  // integrity and terror.
  //
  // Law 8 is not violated by its quake. Law 8 forbids SCHEDULED dread being
  // shown as a number; this quake is not scheduled at all — it is caused by
  // the player's own act, on the tick they commit it, and announced to their
  // face. Everything the toad will do (where it burrows, how far) is decided
  // when the map is made and executed with no roll at all, so waking it costs
  // `run.rng` nothing and the quake schedule does not move under it.
  D.UNDERTOAD = {
    minDepth: 6,
    chance: 0.15,
    wakeR: 3,           // build or dig within this many tiles and it wakes
    minD: 10,           // ...and it never sleeps closer than this to the rig
    tunnel: [6, 10],    // tiles of crystal-lined tunnel it leaves behind
    dmg: 22,            // integrity, one blow — this is the price
    inst: 12,           // ...and the planet notices
    quakeR: 5,          // tiles around the chamber that come down as rubble
    richMult: 1,        // crystal per tunnel tile, x the stratum's mid richness
  };

  // ---------------- M-ACHIEVE: the trophy shelf ----------------
  // Every trophy is a REAL event that exists today (see docs/prompts); the
  // engine awards them through DC.Meta.awardTrophy, and the shelf in the
  // Foundry draws each one as an object (§0 law 5: reward = picture changes).
  // `how` is the Company's requirement, `grit` is the foreman's inspection
  // line once it is on the shelf. Order here is shelf order.
  D.TROPHIES = [
    { id: 'first_win',    name: 'FIRST LIGHT',
      how:  'Reach the Core.',
      grit: "You broke through. The Company will bill you for the hole." },
    { id: 'sub15',        name: 'FIFTEEN FLAT',
      how:  'Reach the Core in under 15:00.',
      grit: "Under fifteen. I hadn't finished my smoke." },
    { id: 'no_repair',    name: 'PRISTINE',
      how:  'Reach the Core without repairing a single machine.',
      grit: "Never touched the wrench. Good, or lucky. Same paycheck." },
    { id: 'scenic',       name: 'SCENIC ROUTE',
      how:  'Reach the Core without ever engaging overdrive.',
      grit: "No overdrive, the whole way down. My ears thank you." },
    { id: 'depth12',      name: 'TWELVE DOWN',
      how:  'Reach stratum 12 in the Mantle.',
      grit: "Twelve. There's no map for twelve. There's barely a word." },
    { id: 'cat',          name: 'STOWAWAY',
      how:  'Find the cat.',
      grit: "She outranks you. Don't argue, she's asleep on the manifest." },
    { id: 'schems_all',   name: 'FULL SET',
      how:  'See every schematic in the deck dealt.',
      grit: "Every blueprint in the deck. You could open a shop. Down here." },
    { id: 'wormfood',     name: 'WORMFOOD',
      how:  'Bait a lure that a vein worm actually takes.',
      grit: "Fed the damn worm. Now it knows your name." },
    { id: 'hard_hats',    name: 'HARD HATS',
      how:  'Wake the Undertoad.',
      grit: "I said hard hats. I meant coffins." },
    { id: 'high_score',   name: 'HIGH SCORE',
      how:  'Reach the Core after the Botanical Incident.',
      grit: "High score. Every sense of it. Not writing that on the form." },
    { id: 'company_man',  name: 'COMPANY MAN',
      how:  'Clock ten shifts.',
      grit: "Ten shifts. You get a pin. Nobody's going to hand it to you." },
    { id: 'daily_win',    name: 'RANKED',
      how:  'Reach the Core on a ranked Daily Shaft.',
      grit: "Same hole as everybody else, and you got out of it." },
    { id: 'logbook_full', name: 'THE WHOLE BOOK',
      how:  "Recover every dead foreman's log.",
      grit: "Twenty dead foremen, cover to cover. Learn anything? Me neither." },
    { id: 'shareholder',  name: 'SHAREHOLDER',
      how:  'Bank 100 cores over your career.',
      grit: "A hundred cores. The Company got the cores. You got a shelf." },
    // M-CONTRACTS: the two the paper is worth. Both are "signed it AND came
    // back", which is the only way a contract is ever really tested.
    { id: 'hazard_win',   name: 'HAZARD PAY',
      how:  'Reach the Core under the Hazard Clause.',
      grit: "Signed the rider, took the shaking, got out. That's a career." },
    { id: 'warrant_win',  name: 'DEATH WARRANT',
      how:  'Reach the Core under a Death Warrant.',
      grit: "Death Warrant. Signed it. Read it after." },
  ];
  D.TROPHY_BY_ID = {};
  for (let i = 0; i < D.TROPHIES.length; i++) D.TROPHY_BY_ID[D.TROPHIES[i].id] = D.TROPHIES[i];
  D.SUB15_SEC = 15 * 60;         // FIFTEEN FLAT: strictly under this
  D.TROPHY_DEPTH = 12;           // TWELVE DOWN (and the Void livery)
  D.SHAREHOLDER_CORES = 100;     // lifetime cores for SHAREHOLDER

  // ---------------- M-RIGSKINS: liveries ----------------
  // Chrome colours only: the rig portrait, panel frames, gauges and title
  // art. render.js reads `chrome` for exactly those and NOTHING on the map —
  // machines, veins, belts, worms and hazards keep their colours on every
  // skin (§0 law 6). `dim` is the frame colour; `hi` is the accent the title
  // sweep ends on. `unlock` names the rule; DC.Meta.liveryUnlocked checks it.
  D.LIVERIES = [
    { id: 'amber',    name: 'COMPANY AMBER',  unlock: 'issued',
      chrome: { amber: D.COLORS.amber, dim: D.COLORS.amberDim, hi: D.COLORS.orange, ember: '#ff7a45' } },
    { id: 'orange',   name: 'SAFETY ORANGE',  unlock: 'win a ranked Daily Shaft',
      chrome: { amber: '#ff9a3c', dim: '#7a4a1e', hi: '#ffd23d', ember: '#e05545' } },
    { id: 'gunmetal', name: 'GUNMETAL',       unlock: 'clock ten shifts',
      chrome: { amber: '#b8c0cc', dim: '#525a66', hi: '#e8e6df', ember: '#7aa5e0' } },
    { id: 'void',     name: 'VOID',           unlock: 'reach stratum 12',
      chrome: { amber: '#e8e6df', dim: '#8a877c', hi: '#ffffff', ember: '#c8c6bf' } },
    { id: 'gold',     name: 'SOLID GOLD',     unlock: 'fill the trophy shelf',
      chrome: { amber: '#ffe9a8', dim: '#8a7a3c', hi: '#ffd23d', ember: '#ffb347' },
      grit: 'Tacky. I love her.' },
  ];
  D.LIVERY_BY_ID = {};
  for (let i = 0; i < D.LIVERIES.length; i++) D.LIVERY_BY_ID[D.LIVERIES[i].id] = D.LIVERIES[i];
  D.LIVERY_RUNS = 10;            // GUNMETAL
  // ---------------- M-SOUND ----------------
  // Procedural audio (js/audio.js). Output only: nothing here moves the sim.
  D.SOUND = {
    masterDb: -12,                                  // master gain, everything via one compressor
    throttle: { craftDone: 4, place: 8, wormMove: 6, squelch: 6 },   // max per second
    levels: { drill: 0.55, klaxon: 0.45, title: 0.06, purr: 0.05 },  // continuous voices
  };


  // ---------------- M-CONTRACTS: the paper you sign ----------------
  // Difficulty as a Company document. §0's lineage names both halves of it:
  // Papers Please for the form you sign and regret, Balatro for the pick —
  // three cards with names, not a slider with three notches. Each contract is
  // a NAME, two or three lines of terms you can hold in your head, and a WAGE
  // that multiplies every core banked at DC.Meta.award.
  //
  // `fx` is an EFFECTS LAYER of exactly the shape DC.Meta.effects() returns.
  // sim.js applies it through the same applyMeta() the Foundry goes through,
  // one line below it, so a contract can never teach the sim a rule the
  // Foundry has not already taught it — and every term below names a knob
  // that was already there.
  //
  // NOTHING IN `fx` TOUCHES run.rng (§0 law 7), and that is load-bearing:
  // `quakeDmgMult` scales the INTEGRITY a quake costs and never the tiles it
  // picks, so one seed generates the same map, schedules the same quakes and
  // lands them on the same tiles under all three contracts. That is what makes
  // "the STANDARD sweep is byte-identical" a fact about the code rather than a
  // hope, and test/integration.js pins it by snapshotting run.rng across
  // newRun for each of the three.
  //
  // `mark` is the one glyph the run header carries (§0 law 6: one glyph, the
  // way the Mantle carries its '†'), and both are already in the game's glyph
  // inventory — see tools/glyphs.js. STANDARD is unmarked on purpose: the
  // ordinary shift is the one that needs no annotation.
  //
  // Terms are TUNING and were measured, not typed (tools/ab.js over the
  // full-Foundry sweep; the paragraph in test/balance.js's footer has the
  // numbers). The spec's illustrative cards carried a plate ADVANCE as a
  // sweetener; measured, any advance at all — even ten plates — made the
  // rider an EASIER run than STANDARD for the bot (a faster stratum 1 is
  // worth more than a quake rider costs), which is the one thing a harder
  // paper may not be. So the sweetener is the wage and nothing else, and the
  // second term is a hull rating. Existing data.js values are untouched (the
  // M-HUMANBAL ledger rule); everything here is new data.
  D.CONTRACTS = [
    { id: 'standard', name: 'STANDARD TERMS', mark: '', wage: 1,
      sub: 'form 1-A',
      terms: ['The shift as posted.',
              'No rider. No hazard pay.'],
      fx: {},
      unlock: null, lockText: '' },
    { id: 'hazard', name: 'HAZARD CLAUSE', mark: '‡', wage: 1.5,
      sub: 'form 1-A, rider H',
      terms: ['Quakes hit 25% harder.',
              'Hull rated 20 lower.'],
      fx: { quakeDmgMult: 1.25, integrityBonus: -20 },
      unlock: 'win', lockText: 'LOCKED: reach the Core once' },
    { id: 'warrant', name: 'DEATH WARRANT', mark: '×', wage: 2,
      sub: 'form 9-D',
      terms: ['Quakes hit 50% harder.',
              'No salvage on descent, ever.',
              'Hull rated 30 lower.'],
      fx: { quakeDmgMult: 1.5, salvageCap: 0, integrityBonus: -30 },
      unlock: 'hazardWin', lockText: 'LOCKED: win under HAZARD' },
  ];
  D.CONTRACT_BY_ID = {};
  for (let i = 0; i < D.CONTRACTS.length; i++) D.CONTRACT_BY_ID[D.CONTRACTS[i].id] = D.CONTRACTS[i];
  // The contract every run that never sees the screen signs: the Daily (ranked
  // runs stay equal), the first-run induction, and the [I] replay.
  D.CONTRACT_DEFAULT = 'standard';

  D.SAVE_KEY = 'deepcore_save_v1';
  // Display only (title-screen corner). v1.4 extends Engraved with hybrid strata,
  // with the completed human-balance board unchanged. The save
  // key is deliberately NOT versioned with it: no save format change here.
  D.VERSION = '1.4';
})();
