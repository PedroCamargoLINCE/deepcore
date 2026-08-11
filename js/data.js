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
    coal:     '#565650',
    magma:    '#ff6a3d',
    magmaHot: '#ffd23d',
  };

  // ---------------- directions ----------------
  // facing: 0=N 1=E 2=S 3=W
  D.DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  D.ARROWS = ['▲', '▶', '▼', '◀']; // ▲ ▶ ▼ ◀

  // ---------------- items ----------------
  D.ITEMS = {
    ironOre:     { name: 'iron ore',     glyph: '•', color: D.COLORS.steel },   // •
    copperOre:   { name: 'copper ore',   glyph: '•', color: D.COLORS.orange },
    coal:        { name: 'coal',         glyph: '•', color: D.COLORS.coal },
    crystal:     { name: 'core crystal', glyph: '♦', color: D.COLORS.magenta }, // ♦
    ironPlate:   { name: 'iron plate',   glyph: '▬', color: D.COLORS.white },   // ▬
    copperPlate: { name: 'copper plate', glyph: '▬', color: D.COLORS.orange },
    gear:        { name: 'drill gear',   glyph: '¤', color: D.COLORS.amber },   // ¤
    charge:      { name: 'core charge',  glyph: '‡', color: D.COLORS.magenta }, // ‡
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
                 cost: { ironPlate: 12 }, color: D.COLORS.orange,
                 desc: 'Smelts ore into plates. Burns 1 coal per 3 smelts.' },
    assembler: { name: 'assembler', key: '4', letter: 'A', w: 2, h: 2, hp: 2,
                 cost: { ironPlate: 14 }, color: D.COLORS.blue,
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
  D.RECIPES = {
    smeltIron:   { in: { ironOre: 1 },   out: { ironPlate: 1 },   ticks: 20, fuel: true },
    smeltCopper: { in: { copperOre: 1 }, out: { copperPlate: 1 }, ticks: 20, fuel: true },
    gear:        { in: { ironPlate: 2 }, out: { gear: 1 },        ticks: 28 },
    bronzeGear:  { in: { ironPlate: 1, copperPlate: 1 }, out: { gear: 2 }, ticks: 28,
                   requires: 's_gear' },  // only with Bronze Gearworks schematic
    charge:      { in: { crystal: 1, copperPlate: 1, coal: 2 }, out: { charge: 1 }, ticks: 40 },
  };
  D.SMELTER_RECIPES = ['smeltIron', 'smeltCopper'];   // auto-picked by available input
  D.ASSEMBLER_RECIPES = ['gear', 'bronzeGear', 'charge']; // click cycles unlocked ones

  // ---------------- strata ----------------
  // instabRate: instability per second. quakeBase: seconds between quakes (jittered).
  // ores: relative weights for vein type rolls. nodes: vein blob count.
  D.STRATA = [
    { name: 'TOPSOIL RIDGE',      tag: 'loose earth, old roots',      accent: '#c9a86a',
      ores: { ironOre: 0.55, coal: 0.45 },                      nodes: 9,
      rich: [60, 100],  breach: { gear: 20, charge: 0 },
      instabRate: 0.45, quakeBase: 34, features: {} },
    { name: 'SANDSTONE DRIFTS',   tag: 'the wind is buried here',     accent: '#d98e4a',
      ores: { ironOre: 0.40, coal: 0.33, copperOre: 0.27 },     nodes: 10,
      rich: [70, 110],  breach: { gear: 30, charge: 0 },
      instabRate: 0.50, quakeBase: 32, features: {} },
    { name: 'KARST HOLLOWS',      tag: 'water carved these graves',   accent: '#5fb8a5',
      ores: { ironOre: 0.34, coal: 0.30, copperOre: 0.36 },     nodes: 10,
      rich: [70, 120],  breach: { gear: 42, charge: 0 },
      instabRate: 0.55, quakeBase: 30, features: { chasms: 3 } },
    { name: 'GRANITE ROOT',       tag: 'the mountain’s spine',        accent: '#8a9bb5',
      ores: { ironOre: 0.46, coal: 0.28, copperOre: 0.26 },     nodes: 11,
      rich: [90, 150],  breach: { gear: 58, charge: 0 },
      instabRate: 0.60, quakeBase: 27, features: { chasms: 2 } },
    { name: 'GLOWDEEP GALLERIES', tag: 'something down here shines',  accent: '#c77dff',
      ores: { ironOre: 0.32, coal: 0.26, copperOre: 0.26, crystal: 0.16 }, nodes: 12,
      rich: [90, 150],  breach: { gear: 55, charge: 8 },
      instabRate: 0.66, quakeBase: 25, features: { chasms: 2 } },
    { name: 'MAGMA FRINGE',       tag: 'the planet’s blood runs close', accent: '#ff7a45',
      ores: { ironOre: 0.30, coal: 0.24, copperOre: 0.24, crystal: 0.22 }, nodes: 12,
      rich: [100, 160], breach: { gear: 65, charge: 14 },
      instabRate: 0.72, quakeBase: 22, features: { chasms: 1, magma: 3 } },
    { name: 'OBSIDIAN WARRENS',   tag: 'glass walls, no echoes',      accent: '#9a6ae0',
      ores: { ironOre: 0.30, coal: 0.24, copperOre: 0.22, crystal: 0.24 }, nodes: 13,
      rich: [100, 170], breach: { gear: 78, charge: 20 },
      instabRate: 0.80, quakeBase: 20, features: { magma: 2, obsidian: true } },
    { name: 'THE CORE GATE',      tag: 'it knows you are coming',     accent: '#ffd23d',
      ores: { ironOre: 0.30, coal: 0.24, copperOre: 0.20, crystal: 0.26 }, nodes: 14,
      rich: [110, 180], breach: { gear: 110, charge: 30 },
      instabRate: 0.90, quakeBase: 17, features: { chasms: 2, magma: 3, obsidian: true } },
  ];
  // The Mantle: endless strata 9+ (k = depth - 8)
  D.mantleStratum = function (depth) {
    const k = depth - D.STRATA_COUNT;
    return {
      name: 'THE MANTLE ' + '†'.repeat(Math.min(k, 6)),  // † marks
      tag: 'there was never a bottom',
      accent: '#e04555',
      ores: { ironOre: 0.28, coal: 0.24, copperOre: 0.20, crystal: 0.28 },
      nodes: 14, rich: [110 + 10 * k, 180 + 15 * k],
      breach: { gear: 110 + 22 * k, charge: 30 + 8 * k },
      instabRate: 0.9 + 0.12 * k, quakeBase: Math.max(10, 17 - k),
      features: { chasms: 2, magma: 3 + Math.min(k, 4), obsidian: true },
    };
  };

  // ---------------- hazard tuning ----------------
  D.QUAKE = {
    startInst: 22,     // no quakes below this instability
    jitter: 0.35,      // ± fraction on interval
    collapseIvl: 9,    // seconds between quakes at instability 100 ("collapse")
    tiles: (inst, depth) => 2 + Math.floor(inst / 30) + Math.floor(depth / 3),
    integrityDmg: (inst, depth) => 2 + Math.floor(depth * 0.8) + Math.floor(inst / 30),
  };
  D.MAGMA = {
    period: 48,        // ticks between spread rolls (6s)
    spreadChance: 0.12,
    growthCap: 2.0,    // max magma tiles = initial * cap
    burnPeriod: 40,    // ticks between adjacency damage rolls (5s)
    hubBurn: 1,        // integrity per burn period if magma touches hub
  };
  D.OVERDRIVE = { drillMult: 2, instMult: 1.6 };

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
      desc: '+20 iron plates, +4 gears at run start (per level).' },
    { id: 'm_hull',   name: 'Reinforced Hull',   max: 2, costs: [3, 6],
      desc: '+25 max integrity (per level).' },
    { id: 'm_damp',   name: 'Gyro Dampers',      max: 2, costs: [4, 8],
      desc: 'Instability rises 12% slower (per level).' },
    { id: 'm_torque', name: 'Drill Torque',      max: 2, costs: [4, 8],
      desc: 'Drill consumes & breaches 12% faster (per level).' },
    { id: 'm_fix',    name: 'Field Kits',        max: 1, costs: [3],
      desc: 'Repairs cost 1 plate instead of 2.' },
    { id: 'm_scan',   name: 'Prospector Array',  max: 1, costs: [5],
      desc: 'Rig scan starts 8 tiles wider.' },
    { id: 'm_salv',   name: 'Salvage Rig',       max: 1, costs: [6],
      desc: 'Descending refunds 40% of built machines.' },
    { id: 'm_deep',   name: 'Deep Stock',        max: 1, costs: [6],
      desc: 'Start with +10 copper plates and 2 core charges.' },
    { id: 'm_schem',  name: 'Schematic Library', max: 1, costs: [8],
      desc: 'Choose from 4 schematics instead of 3.' },
  ];
  D.WIN_CORES = 10;  // bonus cores for reaching the Core (breaching stratum 8)

  D.SAVE_KEY = 'deepcore_save_v1';
  D.VERSION = '1.0';
})();
