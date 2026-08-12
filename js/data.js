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
  D.COLS = 80;            // total character grid width
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
                 cost: { ironPlate: 8 },  color: D.COLORS.amber, period: 16,
                 desc: 'Place on an ore vein. Mines 1 ore / 2s to its output side.' },
    smelter:   { name: 'smelter',   key: '3', letter: 'S', w: 2, h: 2, hp: 2,
                 cost: { ironPlate: 10 }, color: D.COLORS.orange,
                 desc: 'Smelts ore into plates. Burns 1 coal per 3 smelts.' },
    assembler: { name: 'assembler', key: '4', letter: 'A', w: 2, h: 2, hp: 2,
                 cost: { ironPlate: 12 }, color: D.COLORS.blue,
                 desc: 'Crafts drill gears / core charges. Click to switch recipe.' },
    damper:    { name: 'damper',    key: '5', letter: 'V', w: 1, h: 1, hp: 2,
                 cost: { ironPlate: 8, copperPlate: 2 }, color: D.COLORS.green,
                 coalTicks: 40, calm: 0.25,
                 desc: 'Burns 1 coal / 5s to vent pressure: −25% instability rate each (max 3).' },
    hub:       { name: 'drill rig', letter: 'D', w: 3, h: 3, hp: Infinity,
                 cost: {}, color: D.COLORS.amber,
                 desc: 'The rig. Feed it drill gears & core charges by belt to breach.' },
  };
  D.BUILD_ORDER = ['belt', 'extractor', 'smelter', 'assembler', 'damper'];
  D.DAMPER_MAX = 3;          // max stacking dampers
  D.REPAIR_COST = 2;         // ironPlate per repair (meta m_fix lowers to 1)
  D.DEMOLISH_REFUND = 0.5;   // fraction of cost refunded

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

  D.SAVE_KEY = 'deepcore_save_v1';
  // Display only (title-screen corner). v1.1 is the shipped feature set —
  // GRIT, the rig portrait, keyboard play — plus this polish round. The save
  // key is deliberately NOT versioned with it: no save format change here.
  D.VERSION = '1.1';
})();
