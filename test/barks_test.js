/* DEEPCORE — test/barks_test.js
   Node acceptance test for js/barks.js (SPEC2 §A + §G). Permanent.
   Asserts: DOM-free load; every catalog trigger id has a pool (4-8 lines);
   bespoke lines for every schematic id, meta upgrade id, and stratum 1-8 +
   mantle; ≥120 lines total, all ≤70 chars; determinism (same seed = same
   lines); a scripted drive fires ≥6 distinct triggers with no line reuse;
   foreman set/expiry; priority cut-in + cooldown; pool-exhaust reuse;
   cause-aware epitaphs; victory toast; log mirroring.
   M-POLISH adds five lints over the shipped content — this suite is where the
   polish contracts live, so a later dispatch cannot quietly undo them:
     CX-07  no duplicate punchlines anywhere in the 168-line corpus
     CX-10  GRIT's voice guardrails as a machine check (non-consent framing,
            explicit anatomy, demographic targeting — all OUT; profanity,
            gallows humor, rig innuendo and Company-hating stay IN)
     CX-02/03  the field manual (art.js) carries no number or key binding that
            contradicts data.js / engine.js — including the descend vent,
            which must reach BOTH sim.js and the manual from D.DESCEND_VENT
     CX-04  every line Sim.describeTile can emit fits Sim.SCAN_W (29 cols),
            so the SCAN panel never truncates mid-word
     CX-11  every D.ITEMS.short survives render's STOCK name field unclipped
            and no two rows draw the same label
   Scaffold mutations (marked "scaffold:") force ambient conditions the
   drive cannot cheaply reach; all bark behavior runs through the API. */
'use strict';

require('../js/data.js');
require('../js/art.js');
require('../js/barks.js');
require('../js/map.js');
require('../js/sim.js');
require('../js/meta.js');
const DC = globalThis.DC;
const D = DC.DATA;
const S = DC.Sim;
const B = DC.Barks;
const HZ = D.TICK_HZ;

let SECTION = 'boot';
let PROSE_N = 0;              // authored lines checked against the prose panels
function fail(msg) {
  console.error('FAIL [' + SECTION + ']: ' + msg);
  process.exit(1);
}
function assert(cond, msg) { if (!cond) fail(msg); }
function assertEq(a, b, msg) {
  if (a !== b) fail(msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')');
}
function defEffects() { return DC.Meta.effects(DC.Meta.newProfile()); }

// ------------------------------------------------------------ DOM-free load
SECTION = 'load';
assert(typeof window === 'undefined', 'test must run without a DOM');
assert(B && typeof B === 'object', 'DC.Barks exists');
for (const fn of ['tick', 'fire', 'epitaph', 'toast'])
  assertEq(typeof B[fn], 'function', 'DC.Barks.' + fn + ' is a function');

// --------------------------------------------------- catalog pool coverage
SECTION = 'catalog';
const CATALOG = [  // SPEC2 §A.2 — 24 discrete + 4 ambient = 28 categories
  'runStart', 'stratumArrive', 'firstBelt', 'firstExtractor', 'firstSmelter',
  'firstAssembler', 'firstGear', 'quake', 'bigQuake', 'collapse',
  'magmaSpread', 'veinDepleted', 'breachReady', 'descend', 'overdriveOn',
  'overdriveOff', 'repair', 'demolish', 'brokeAttempt', 'schematicPick',
  'foundryBuy', 'death', 'victory', 'mantleArrive',
  'jam', 'noCoal', 'lowIntegrity', 'idle',
];
assert(CATALOG.length >= 26, 'catalog has >= 26 categories');
for (const t of CATALOG) {
  const pool = B.POOLS[t];
  assert(Array.isArray(pool), 'trigger "' + t + '" has a pool');
  assert(pool.length >= 4 && pool.length <= 8,
    'pool "' + t + '" has 4-8 lines (got ' + pool.length + ')');
}

// ------------------------------------------------------------ bespoke lines
SECTION = 'bespoke';
for (let d = 1; d <= D.STRATA_COUNT; d++)
  assertEq(typeof B.STRATUM_LINES[d], 'string', 'bespoke line for stratum ' + d);
assertEq(typeof B.STRATUM_LINES.mantle, 'string', 'bespoke line for the mantle');
for (const s of D.SCHEMATICS)
  assertEq(typeof B.SCHEM_LINES[s.id], 'string', 'bespoke line for schematic ' + s.id);
assertEq(D.SCHEMATICS.length, 14, 'all 14 schematics covered');
for (const u of D.META_UPGRADES)
  assertEq(typeof B.META_LINES[u.id], 'string', 'bespoke line for meta upgrade ' + u.id);
assertEq(D.META_UPGRADES.length, 9, 'all 9 meta upgrades covered');

// ------------------------------------------------- width + total line count
SECTION = 'width';
const allLines = [];
for (const t in B.POOLS) for (const l of B.POOLS[t]) allLines.push([t, l]);
for (const k in B.STRATUM_LINES) allLines.push(['stratum:' + k, B.STRATUM_LINES[k]]);
for (const k in B.SCHEM_LINES) allLines.push([k, B.SCHEM_LINES[k]]);
for (const k in B.META_LINES) allLines.push([k, B.META_LINES[k]]);
for (const c in B.EPITAPHS)
  for (const pair of B.EPITAPHS[c]) for (const l of pair) allLines.push(['epitaph:' + c, l]);
for (const l of B.TOASTS) allLines.push(['toast', l]);
for (const [tag, l] of allLines) {
  assertEq(typeof l, 'string', 'line in ' + tag + ' is a string');
  assert(l.length > 0 && l.length <= 70,
    'line in ' + tag + ' within 70 chars (' + l.length + '): ' + l);
}
assert(allLines.length >= 120, '>= 120 lines total (got ' + allLines.length + ')');

// line text -> trigger id (for classifying what the drive fired)
const TRIG_OF = {};
for (const t in B.POOLS) for (const l of B.POOLS[t]) TRIG_OF[l] = t;
for (const k in B.STRATUM_LINES) TRIG_OF[B.STRATUM_LINES[k]] = 'stratumArrive';
for (const k in B.SCHEM_LINES) TRIG_OF[B.SCHEM_LINES[k]] = 'schematicPick';
for (const k in B.META_LINES) TRIG_OF[B.META_LINES[k]] = 'foundryBuy';

// ------------------------------------------------------------ scripted drive
// Drives a real run: engine-style discrete fires + Barks.tick ambient
// detection over Sim.tick, capturing every foreman line as it lands.
SECTION = 'drive';
function mach(id, type, x, y, w, h, extra) {
  const m = {
    id: id, type: type, x: x, y: y, w: w, h: h, facing: 1,
    hp: 2, progress: 0, recipe: type === 'assembler' ? 'gear' : null,
    input: {}, fuel: 0, status: 'idle', repairAt: 0,
    blockedSince: 0, nofuelSince: 0, out: [], job: null,
  };
  for (const k in (extra || {})) m[k] = extra[k];
  return m;
}

function drive(seed) {
  const run = S.newRun(defEffects(), seed);
  const lines = [];
  let lastKey = '';
  function note() {  // record each newly-set bark (t0+text identifies it)
    const f = run.foreman;
    if (!f) return;
    const key = f.t0 + '|' + f.text;
    if (key !== lastKey) { lastKey = key; lines.push(f.text); }
  }
  function step(n) {
    for (let i = 0; i < n; i++) { S.tick(run); B.tick(run); note(); }
  }

  assertEq(B.fire(run, 'runStart') !== null, true, 'runStart fires at t=0');
  note();
  assert(run.foreman && run.foreman.text, 'foreman set by runStart');
  const logTail = run.messages[run.messages.length - 1];
  assert(logTail && logTail.text === 'GRIT ▸ ' + run.foreman.text,
    'bark mirrored into the LOG');
  step(7 * HZ);

  // firstBelt via a real placement (row-major scan for a legal tile)
  let placed = false;
  for (let y = 0; y < D.MAP_H && !placed; y++)
    for (let x = 0; x < D.MAP_W && !placed; x++)
      if (S.canPlace(run, 'belt', x, y, 1).ok) placed = S.place(run, 'belt', x, y, 1);
  assert(placed, 'drive could place a belt');
  step(2 * HZ);

  // scaffold: first* stats + a crafting assembler + jammed/starving machines
  run.stats.placed.extractor = 1;
  run.stats.placed.smelter = 1;
  run.stats.placed.assembler = 1;
  run.machines[90] = mach(90, 'assembler', 30, 2, 2, 2, { job: 'gear' });
  run.machines[91] = mach(91, 'extractor', 1, 1, 1, 1,
    { out: ['ironOre'], blockedSince: Math.max(1, run.t - 11 * HZ) });
  run.machines[92] = mach(92, 'smelter', 40, 20, 2, 2,
    { input: { ironOre: 5 }, nofuelSince: Math.max(1, run.t - 9 * HZ) });
  step(40 * HZ);  // queue flush (first*) + jam + noCoal land, 6s cooldown apart

  // scaffold: lowIntegrity (< 30, once per stratum), then heal to avoid death
  run.integrity = 25;
  step(8 * HZ);
  run.integrity = 95;

  // idle: 45s since lastPlaceT/lastFeedT (start gears ran dry long ago)
  step(50 * HZ);

  // same-tick priority mechanics
  step(7 * HZ);  // clear cooldown
  assert(B.fire(run, 'quake') !== null, 'quake fires after cooldown'); note();
  assert(B.fire(run, 'bigQuake') !== null, 'bigQuake supersedes same-tick quake'); note();
  assertEq(B.fire(run, 'magmaSpread'), null, 'non-priority blocked by cooldown');
  assert(B.fire(run, 'breachReady') !== null, 'breachReady (priority) cuts in'); note();
  assert(B.fire(run, 'death') !== null, 'death (priority) cuts in'); note();

  return { run: run, lines: lines };
}

const d1 = drive(1337);
// no line reused (no pool was exhausted in the drive)
const seen = new Set();
for (const l of d1.lines) {
  assert(!seen.has(l), 'line reused during drive: ' + l);
  seen.add(l);
}
// >= 6 distinct triggers actually produced barks
const trigs = new Set();
for (const l of d1.lines) {
  assert(TRIG_OF[l], 'recorded line belongs to a pool: ' + l);
  trigs.add(TRIG_OF[l]);
}
assert(trigs.size >= 6, '>= 6 distinct triggers fired (got ' + trigs.size +
  ': ' + Array.from(trigs).join(',') + ')');
for (const t of ['runStart', 'firstBelt', 'jam', 'noCoal', 'lowIntegrity', 'idle'])
  assert(trigs.has(t), 'drive fired ' + t);

// ------------------------------------------------------------- determinism
SECTION = 'determinism';
const d2 = drive(1337);
assertEq(JSON.stringify(d2.lines), JSON.stringify(d1.lines),
  'same seed produces the same bark sequence');
assertEq(d1.lines.length >= 10, true, 'drive produced a healthy line count');

// -------------------------------------------------- foreman field + expiry
SECTION = 'foreman';
{
  const run = S.newRun(defEffects(), 42);
  const line = B.fire(run, 'runStart');
  assertEq(typeof line, 'string', 'fire returns the line');
  const f = run.foreman;
  assert(f && f.text === line, 'run.foreman.text set');
  assertEq(f.t0, run.totalT, 'foreman.t0 anchored at run.totalT');
  assert(f.until > f.t0 + 6 * HZ, 'foreman.until holds ~7s');
  const until = f.until;
  let guard = 0;
  while (run.foreman && guard++ < 30 * HZ) { S.tick(run); B.tick(run); }
  assert(run.foreman === null, 'foreman cleared after expiry');
  assertEq(run.totalT, until + 2 * HZ + 1, 'cleared right after until + 2s fade');
  // long lines hold longer
  run.totalT += 100;
  B.fire(run, 'quake');
  const short = { len: run.foreman.text.length, hold: run.foreman.until - run.foreman.t0 };
  assert(short.hold >= 7 * HZ, 'hold is at least 7s');
}

// --------------------------------------------- bespoke-first line selection
SECTION = 'bespoke-pick';
{
  const run = S.newRun(defEffects(), 9);
  assertEq(B.fire(run, 'stratumArrive'), B.STRATUM_LINES[1],
    'stratumArrive prefers the depth-1 bespoke line');
  run.totalT += 100;
  assertEq(B.fire(run, 'schematicPick', 's_extract'), B.SCHEM_LINES.s_extract,
    'schematicPick uses the bespoke line for its id');
  run.totalT += 100;
  const again = B.fire(run, 'schematicPick', 's_extract');
  assert(B.POOLS.schematicPick.indexOf(again) >= 0,
    'used bespoke falls back to the generic pool');
  run.totalT += 100;
  assertEq(B.fire(run, 'foundryBuy', 'm_hull'), B.META_LINES.m_hull,
    'foundryBuy uses the bespoke line for its id');
  run.depth = 9;
  run.totalT += 100;
  assertEq(B.fire(run, 'stratumArrive'), B.STRATUM_LINES.mantle,
    'stratumArrive at depth 9 uses the mantle bespoke line');
  run.totalT += 100;
  const m = B.fire(run, 'mantleArrive');
  assert(B.POOLS.mantleArrive.indexOf(m) >= 0, 'mantleArrive draws from its pool');
}

// ------------------------------------------------- pool exhaustion -> reuse
SECTION = 'exhaust';
{
  const run = S.newRun(defEffects(), 7);
  const n = B.POOLS.victory.length;
  const got = [];
  for (let i = 0; i < n; i++) got.push(B.fire(run, 'victory'));  // priority: no cooldown
  assertEq(new Set(got).size, n, 'pool served every line once before reuse');
  const extra = B.fire(run, 'victory');
  assert(extra !== null && got.indexOf(extra) >= 0,
    'exhausted pool allows reuse instead of going silent');
}

// -------------------------------------------------- epitaphs (cause-aware)
SECTION = 'epitaph';
function flat(pool) {
  const out = [];
  for (const pair of pool) for (const l of pair) out.push(l);
  return out;
}
{
  const run = S.newRun(defEffects(), 11);
  S.abandon(run);  // integrity intact -> abandoned
  const ep = B.epitaph(run);
  assert(Array.isArray(ep) && ep.length >= 1 && ep.length <= 2, 'epitaph is 1-2 lines');
  for (const l of ep)
    assert(flat(B.EPITAPHS.abandon).indexOf(l) >= 0, 'abandon epitaph from abandon pool');
}
{
  const run = S.newRun(defEffects(), 12);
  run.integrity = 0; run.status = 'dead';  // scaffold: quake-tanked at depth 1
  for (const l of B.epitaph(run))
    assert(flat(B.EPITAPHS.quake).indexOf(l) >= 0, 'integrity epitaph from quake pool');
}
{
  const run = S.newRun(defEffects(), 13);
  run.depth = 6;  // scaffold: MAGMA FRINGE (features.magma)
  run.integrity = 0; run.status = 'dead';
  for (const l of B.epitaph(run))
    assert(flat(B.EPITAPHS.magma).indexOf(l) >= 0, 'magma-stratum epitaph from magma pool');
}

// ---------------------------------------------------------------- toast
SECTION = 'toast';
{
  const run = S.newRun(defEffects(), 14);
  const t = B.toast(run);
  assert(B.TOASTS.indexOf(t) >= 0, 'toast comes from the victory toast pool');
}

// ------------------------------------------- CX-07: no duplicate punchlines
// Same joke twice is worse than one fewer joke. Exact repeats are banned
// outright; near-repeats are caught by content-word overlap (Jaccard over
// non-stopword stems), which is what flagged the original
// "the deep keeps her/the deposit" pair across the death pool and the
// abandon epitaph. Current corpus tops out at 0.25 (shared vocabulary,
// genuinely different jokes), so 0.30 is a real ceiling with headroom.
SECTION = 'duplicates';
const DUP_MAX = 0.30;
const STOP = new Set(('a an the and or but so of to in on at it its is was are ' +
  'be been for with that this these those you your youre we us our my me i he ' +
  'she her him they them not no dont doesnt aint just like as if then than too ' +
  'very there here down up out off from about kid one two now got get gets go ' +
  'goes do does did has have had').split(' '));
function contentWords(s) {
  return s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/)
    .map(w => w.replace(/'/g, ''))
    .filter(w => w.length > 2 && !STOP.has(w));
}
{
  const byText = new Map();
  for (const [tag, l] of allLines) {
    if (byText.has(l)) fail('exact duplicate line in ' + byText.get(l) +
      ' and ' + tag + ': ' + l);
    byText.set(l, tag);
  }
  const sets = allLines.map(([, l]) => new Set(contentWords(l)));
  let worst = 0, worstPair = null;
  for (let i = 0; i < allLines.length; i++) {
    for (let j = i + 1; j < allLines.length; j++) {
      const a = sets[i], b = sets[j];
      if (!a.size || !b.size) continue;
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      const jac = inter / (a.size + b.size - inter);
      if (jac > worst) { worst = jac; worstPair = [allLines[i], allLines[j]]; }
    }
  }
  assert(worst < DUP_MAX, 'no near-duplicate punchlines (overlap ' +
    worst.toFixed(2) + ' >= ' + DUP_MAX + '):\n  ' +
    worstPair[0][0] + ': ' + worstPair[0][1] + '\n  ' +
    worstPair[1][0] + ': ' + worstPair[1][1]);
  var DUP_WORST = worst;  // reported in the PASS line
}

// ---------------------------------------------- CX-10: voice guardrail lint
// SPEC3 rule 5: profanity, gallows humor, drilling innuendo and Company-hating
// are IN BOUNDS by design. Slurs, hate, explicit anatomy and non-consent
// framing are OUT — the joke is the rig and the job, never an unwilling party.
// Demographic nouns are the proxy for the slur/hate class: GRIT talks about
// the Company, the planet, the rig and himself, so any protected-group noun
// appearing at all is a signal worth a human look.
SECTION = 'guardrails';
{
  const BANNED = [
    // non-consent framing (the CX-10 class)
    [/\bconsent(s|ed|ing|ual)?\b/i, 'non-consent framing'],
    [/\bunwilling\b/i, 'non-consent framing'],
    [/\bagainst (her|his|its|their) will\b/i, 'non-consent framing'],
    [/\b(didn'?t|does ?n'?t|won'?t) want (it|to|this)\b/i, 'non-consent framing'],
    [/\bforc(e|es|ed|ing) (her|him|them|it) (to|into)\b/i, 'non-consent framing'],
    [/\b(rape|molest\w*|violat(e|ed|ing) her)\b/i, 'non-consent framing'],
    // explicit anatomy
    [/\b(cock|dick|pussy|tits?|nipples?|genitals?|penis|vagina|boobs?)\b/i,
      'explicit anatomy'],
    // demographic targeting (slur/hate proxy)
    // (plural forms only for color words: "the black rocks" is coal, not people)
    [/\b(jews?|muslims?|christians?|blacks|whites|asians?|arabs?|gays?|lesbians?|trannies|immigrants?|foreigners?|retard\w*|cripples?)\b/i,
      'demographic targeting'],
  ];
  for (const [tag, l] of allLines) {
    for (const [re, why] of BANNED) {
      if (re && re.test(l)) fail('guardrail (' + why + ') in ' + tag + ': ' + l);
    }
  }
  // the specific line CX-10 named must be gone, and its replacement present
  const flat1 = allLines.map(x => x[1]);
  assert(flat1.indexOf("First extractor down. The vein didn't consent, but here we are.") < 0,
    'the CX-10 non-consent line is gone');
  assert(B.POOLS.firstExtractor.some(l => /she bites, the rock gives/i.test(l)),
    'the CX-10 replacement line shipped');
  // CX-07: neither half of the duplicated "deposit" gag survives twice
  const deposits = flat1.filter(l => /deep keeps/i.test(l));
  assertEq(deposits.length, 1, 'the "the deep keeps the deposit" gag is told once');
}

// ------------------------ M-MANUAL: the field manual vs data.js & engine.js
// art.js composes BOTH pages of the manual from DC.DATA at load. A manual that
// lies is worse than no manual (CX-02 said the descent vented 40 where the sim
// vented 45; CX-03 said quakes past 22 where they start at 25), so this block
// proves the composition five ways:
//   * every integer printed on either page is authorized by a balance value or
//     an engine binding — the allow-table below IS the audit trail;
//   * the descend vent still reaches sim.js AND the manual from one data key;
//   * retuning data.js underneath the composer really MOVES the printed
//     figures — the one check a coincidentally-correct literal cannot survive;
//   * the key labels are bound in engine.js for real (arrows, never WASD);
//   * the layout holds SPEC3's contrast and air budgets: every colour the
//     pages paint clears 4.5:1, gutters stay >= 3 columns, ink <= 60%.
SECTION = 'manual';
let MANUAL_COLORS = 0;
{
  const fs = require('fs');
  const path = require('path');
  require('../js/render.js');       // where the manual's colours are resolved
  const A = DC.Art;
  const R = DC.Render;
  const pages = A.helpPages;
  const LAY = A.HELP_LAYOUT;

  assert(Array.isArray(pages) && pages.length >= 2,
    'the manual is a pager of >= 2 pages');
  assert(LAY && LAY.GUT >= 3,
    'the two columns are separated by >= 3 columns of air (got ' + (LAY && LAY.GUT) + ')');
  assert(A.help === pages[0].text,
    'A.help stays the plain-text first page (the asset render falls back to)');

  for (const p of pages) {
    assert(typeof p.id === 'string' && p.id.length, 'every page is named');
    const widths = new Set(p.text.map(l => l.length));
    assertEq(widths.size, 1, p.id + ': every row is the same width (the page is a grid)');
    assertEq(p.text[0].length, p.w, p.id + ': rows are the declared page width');
    assertEq(p.text.length, p.h, p.id + ': text and grid agree on height');
    assert(p.w <= 74, p.id + ' is <= 74 columns (got ' + p.w + ')');
    assert(p.h <= D.ROWS - 2, p.id + ' fits the 33-row screen (got ' + p.h + ')');
    assert(p.ink <= 0.60,
      p.id + ' holds the air budget: ink ' + (p.ink * 100).toFixed(1) + '% <= 60%');
    for (let y = 0; y < p.text.length; y++) {
      // inside the two-column band the gutter is pure air; full-width
      // sections (THE LINE, TIPS) are outside it and may span the page
      if (p.colRows && y >= p.colRows[0] && y <= p.colRows[1]) {
        assertEq(p.text[y].slice(LAY.CA + LAY.CAW, LAY.CB), ' '.repeat(LAY.GUT),
          p.id + ' row ' + y + ': the column gutter is ' + LAY.GUT + ' columns of air');
      }
      for (const s of p.rows[y]) {
        assertEq(p.text[y].slice(s.x, s.x + s.t.length), s.t,
          p.id + ' row ' + y + ': the coloured span and the plain text are one grid');
      }
    }
  }

  // --- contrast: SPEC3 M-MANUAL asks for >= 4.5:1 on every text tier. Check
  // the colours the pages ACTUALLY paint — tiers and lifted game colours — not
  // the palette in the abstract. Hairlines are furniture, so they answer to the
  // 3:1 non-text floor instead.
  const painted = new Map();
  for (const p of pages) {
    for (const row of p.rows) {
      for (const s of row) {
        const col = R.helpColor(s.c);
        painted.set(String(s.c) + (s.inv ? '/inv' : ''), col);
        const cr = R.contrast(col, D.COLORS.bg);
        if (s.inv) {
          // a keycap is inverse: the page background becomes the letter
          assert(R.contrast(D.COLORS.bg, col) >= R.MIN_CONTRAST,
            'keycap face ' + col + ' carries its letter at >= ' + R.MIN_CONTRAST + ':1');
        } else if (s.c === 'rule') {
          assert(cr >= 3.0, 'the hairline rule clears the 3:1 non-text floor (got ' +
            cr.toFixed(2) + ')');
        } else {
          assert(cr >= R.MIN_CONTRAST, 'manual colour ' + s.c + ' paints as ' + col +
            ' at ' + cr.toFixed(2) + ':1, under the ' + R.MIN_CONTRAST + ':1 text floor');
        }
      }
    }
  }
  MANUAL_COLORS = painted.size;
  assert(MANUAL_COLORS >= 8,
    'the manual is polychrome — a living legend, not one amber slab (got ' +
    MANUAL_COLORS + ' colours)');
  assertEq(R.legible(D.COLORS.amber, D.COLORS.bg), D.COLORS.amber,
    'a colour that already reads is passed through untouched');
  for (const k in D.TERRAIN) {
    const raw = D.TERRAIN[k].color;
    const lit = R.legible(raw, D.COLORS.bg);
    assert(R.contrast(lit, D.COLORS.bg) >= R.MIN_CONTRAST,
      'terrain colour ' + k + ' is lifted to a readable tone for the glossary');
  }

  // --- the descend vent: one number, two consumers (sim.js startStratum and
  // the manual). It used to be a literal in each, which is how the manual came
  // to claim 40 while the sim vented 45 (CX-02). Assert both sides still read
  // the data key, so the divergence cannot reopen.
  const vent = D.DESCEND_VENT;
  assert(typeof vent === 'number' && isFinite(vent),
    'DESCEND_VENT is exposed in data.js (got ' + vent + ')');
  const simSrc = fs.readFileSync(path.join(__dirname, '../js/sim.js'), 'utf8');
  const ventLine = simSrc.match(/run\.instability\s*=\s*Math\.max\(0,\s*run\.instability\s*-\s*([^)]+)\)/);
  assert(ventLine, 'found the descend vent subtraction in sim.js startStratum');
  assert(/D\.DESCEND_VENT/.test(ventLine[1]),
    'sim.js vents via D.DESCEND_VENT, not a literal (got "' + ventLine[1].trim() + '")');
  const artSrc = fs.readFileSync(path.join(__dirname, '../js/art.js'), 'utf8');
  assert(/const\s+vent\s*=\s*num\(\s*D\.DESCEND_VENT\s*\)/.test(artSrc),
    'the manual composes its vent figure from D.DESCEND_VENT with no fallback literal');
  // Same shape, second key: the SHIFT jump was a bare 5 in engine.js and a
  // typed 5 in the manual until M-MANUAL moved it into data.js.
  const engSrc = fs.readFileSync(path.join(__dirname, '../js/engine.js'), 'utf8');
  assert(/e\.shiftKey \? D\.CURSOR_JUMP : 1/.test(engSrc),
    'engine.js jumps the cursor by D.CURSOR_JUMP, not a literal');
  assert(/const\s+jump\s*=\s*num\(\s*D\.CURSOR_JUMP\s*\)/.test(artSrc),
    'the manual composes the SHIFT jump from D.CURSOR_JUMP');
  // The pressure gauge is drawn against D.INSTAB_MAX; sim.js clamps to the
  // same ceiling. art.js cannot reach into sim, so the test marries them.
  assert(/U\.clamp\(run\.instability \+ instRate\(run\) \/ HZ, 0, 100\)/.test(simSrc),
    'sim.js still clamps instability to 0..100');
  assertEq(D.INSTAB_MAX, 100, 'D.INSTAB_MAX matches the ceiling sim.js clamps to');

  // --- every printed integer is authorized by data (or by an engine binding)
  const allowed = new Map();
  const allow = (v, why) => allowed.set(Number(v), why);
  for (let i = 1; i <= Math.max(D.BUILD_ORDER.length, pages.length); i++)
    allow(i, 'build hotkey / page number');
  allow(D.DIG_ROCK / D.TICK_HZ, 'DIG_ROCK seconds');
  allow(D.DIG_RUBBLE / D.TICK_HZ, 'DIG_RUBBLE seconds');
  allow(D.BUILDINGS.extractor.period / D.TICK_HZ, 'extractor seconds per ore');
  allow(D.BUILDINGS.damper.coalTicks / D.TICK_HZ, 'damper seconds per coal');
  allow(D.OVERDRIVE.drillMult, 'OVERDRIVE.drillMult');
  allow(D.QUAKE.startInst, 'QUAKE.startInst');
  allow(D.BUILDINGS.damper.calm * 100, 'damper.calm %');
  allow(D.DAMPER_MAX, 'DAMPER_MAX');
  allow(D.REPAIR_COST, 'REPAIR_COST');
  allow(D.FUEL_PER, 'FUEL_PER — and GRIT\'s "page 3" joke');
  allow(D.RECIPES.gear.in.ironPlate, 'gear recipe input');
  allow(D.RECIPES.charge.in.coal, 'charge recipe coal');
  allow(D.CURSOR_JUMP, 'CURSOR_JUMP (SHIFT jump)');
  allow(D.STRATA_COUNT, 'strata down to the Core');
  allow(0, 'the death threshold (integrity 0)');
  allow(vent, 'descend instability vent');
  for (const k of D.BUILD_ORDER) {
    const cost = D.BUILDINGS[k].cost;
    for (const it in cost) allow(cost[it], 'build cost: ' + k + ' ' + it);
  }

  const printed = new Set();
  for (const p of pages) {
    for (const row of p.text) {
      const nums = row.match(/\d+(?:\.\d+)?/g) || [];
      for (const t of nums) {
        const v = Number(t);
        printed.add(v);
        assert(allowed.has(v), p.id + ' prints ' + t + ' which no data.js value ' +
          'authorizes — the manual has drifted from the sim: ' + row.trim());
      }
    }
  }
  // the CX-02/CX-03 numbers must actually be on the page
  assert(printed.has(Number(D.QUAKE.startInst)),
    'the manual states the real quake onset (' + D.QUAKE.startInst + ')');
  assert(printed.has(Number(vent)), 'the manual states the real descend vent (' + vent + ')');
  const joined = pages.map(p => p.text.join('\n')).join('\n');
  assertEq((joined.match(new RegExp('\\b' + vent + '\\b', 'g')) || []).length, 2,
    'both vent mentions (THE LINE on page 1, PRESSURE on page 2) agree');

  // --- the drift probe. Everything above passes for a literal that happens to
  // match today's data. Nothing passes this: retune data.js underneath the
  // composer, rebuild art.js, and require the printed figure to have moved.
  {
    const artPath = require.resolve('../js/art.js');
    const rebuild = () => {
      delete require.cache[artPath];
      require('../js/art.js');
      return DC.Art.helpPages.map(p => p.text.join('\n')).join('\n');
    };
    const keep = {
      dig: D.DIG_ROCK, vent: D.DESCEND_VENT, inst: D.QUAKE.startInst,
      jump: D.CURSOR_JUMP, calm: D.BUILDINGS.damper.calm,
      cost: D.BUILDINGS.smelter.cost.ironPlate, fuel: D.FUEL_PER,
      dampers: D.DAMPER_MAX, strata: D.STRATA_COUNT,
    };
    const probes = [
      ['DIG_ROCK',        () => { D.DIG_ROCK = 96; },                       'dig rock 12s'],
      ['DESCEND_VENT',    () => { D.DESCEND_VENT = 37; },                   'venting −37'],
      ['QUAKE.startInst', () => { D.QUAKE.startInst = 61; },                'quakes start at 61'],
      ['CURSOR_JUMP',     () => { D.CURSOR_JUMP = 9; },                     'jump 9 tiles'],
      ['damper.calm',     () => { D.BUILDINGS.damper.calm = 0.4; },         '−40%'],
      ['smelter cost',    () => { D.BUILDINGS.smelter.cost.ironPlate = 77; }, '77'],
      ['FUEL_PER',        () => { D.FUEL_PER = 6; },                        'coal per 6 smelts'],
      ['DAMPER_MAX',      () => { D.DAMPER_MAX = 7; },                      'up to 7'],
      ['STRATA_COUNT',    () => { D.STRATA_COUNT = 12; },                   '12 strata down'],
    ];
    for (const [name, mutate, expect] of probes) {
      mutate();
      const txt = rebuild();
      assert(txt.indexOf(expect) >= 0, 'retuning ' + name + ' moves the manual — ' +
        'expected "' + expect + '" on the rebuilt page (a typed literal fails here)');
    }
    D.DIG_ROCK = keep.dig; D.DESCEND_VENT = keep.vent; D.QUAKE.startInst = keep.inst;
    D.CURSOR_JUMP = keep.jump; D.BUILDINGS.damper.calm = keep.calm;
    D.BUILDINGS.smelter.cost.ironPlate = keep.cost; D.FUEL_PER = keep.fuel;
    D.DAMPER_MAX = keep.dampers; D.STRATA_COUNT = keep.strata;
    rebuild();
    assertEq(DC.Art.helpPages.map(p => p.text.join('\n')).join('\n'), joined,
      'the probe leaves the shipped manual exactly as it found it');
  }

  // --- key bindings: arrows only, WASD deliberately unbound, and every key
  // the manual advertises is really handled in engine.js
  assert(/ArrowUp/.test(engSrc) && /ArrowLeft/.test(engSrc), 'engine binds arrow keys');
  assert(!/\bKeyW\b/.test(engSrc) && !/\bw:\s*0\b/.test(engSrc),
    'engine leaves WASD unbound (SPEC3 M-MANUAL)');
  assert(!/WASD/i.test(joined), 'the manual does not promise WASD');
  assert(/↑↓←→/.test(joined), 'the manual documents the arrow-key cursor');
  for (const k of ['x', 'r', 'c', 'd', 'h']) {
    assert(new RegExp("case '" + k + "':").test(engSrc),
      'manual key ' + k.toUpperCase() + ' is really bound in engine.runKey');
  }
  assert(/if \(k === ' '\) \{ ui\.paused = true/.test(engSrc), 'SPACE pauses');
  assert(/if \(k === 'Enter'\) \{ contextAction/.test(engSrc), 'ENTER is the context action');
  // the pager keys the footer promises
  assert(/case 'help':[\s\S]*ArrowRight[\s\S]*turnPage/.test(engSrc),
    "engine turns the manual's pages on the arrow keys");
  assert(/st\.ui\.helpPage = n/.test(engSrc),
    'engine jumps straight to a page by its number');
  // build tool names/order come straight from data.js
  for (let i = 0; i < D.BUILD_ORDER.length; i++) {
    const nm = D.BUILDINGS[D.BUILD_ORDER[i]].name;
    assert(new RegExp('\\b' + nm + '\\b').test(joined),
      'the manual lists build tool ' + (i + 1) + ' as ' + nm);
    assert(new RegExp(' ' + (i + 1) + ' ').test(pages[0].text[5 + i]),
      'hotkey ' + (i + 1) + ' caps the ' + nm + ' row');
  }
  // and so do the goods in the CARGO legend
  for (const id of D.ITEM_ORDER) {
    assert(joined.indexOf(D.ITEMS[id].name) >= 0,
      'the CARGO legend names ' + D.ITEMS[id].name + ' straight from data.js');
  }
}

// ------------------------------- CX-04: every SCAN tooltip line fits the panel
// sim.js exports SCAN_W precisely so this can be re-audited whenever the
// tooltip strings are edited. The old bug was render clipping mid-word
// ("click: repair (2 pl"); the fix is that no line is ever over-long in the
// first place, so we generate the machine states that produce the longest
// strings and measure every line describeTile can emit.
SECTION = 'scan-panel';
let scanLines = 0;
{
  const W = S.SCAN_W;
  assert(typeof W === 'number' && W > 0, 'Sim.SCAN_W is exported');
  const run = S.newRun(defEffects(), 4242);
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) run.grid[y][x].revealed = true;

  const seen = [];
  function sweep() {
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        for (const l of S.describeTile(run, x, y) || []) {
          scanLines++;
          assert(typeof l.text === 'string', 'tooltip line has text');
          assert(l.text.length <= W, 'SCAN line overflows ' + W + ' cols (' +
            l.text.length + '): ' + JSON.stringify(l.text));
          seen.push(l.text);
        }
      }
  }
  sweep();  // natural map: terrain, ore veins, the hub

  // scaffold: one of every building, in every status, damaged and whole, with
  // every input buffer full — the widest strings the panel can be asked to draw
  const types = ['belt', 'extractor', 'smelter', 'assembler', 'damper'];
  const statuses = ['ok', 'idle', 'jammed', 'nofuel', 'blocked', 'dead'];
  let id = 1000;
  const spots = [];
  for (let y = 1; y < D.MAP_H - 3; y++)
    for (let x = 1; x < D.MAP_W - 3; x++) {
      const t = run.grid[y][x];
      if (t.machine === null && t.t === 'floor' && !t.belt) spots.push([x, y]);
    }
  let si = 0;
  for (const type of types)
    for (const st of statuses)
      for (const hp of [1, 2]) {
        if (si >= spots.length) break;
        const [x, y] = spots[si++];
        const B = D.BUILDINGS[type];
        const m = mach(id++, type, x, y, B.w, B.h,
          { hp: hp, status: st, fuel: 40, recipe: type === 'assembler' ? 'charge' : null });
        for (const k of D.ITEM_ORDER) m.input[k] = D.INPUT_CAP;  // widest buffer line
        run.machines[m.id] = m;
        run.grid[y][x].machine = m.id;
        run.grid[y][x].ore = 'crystal';        // longest ore name under a drill
        run.grid[y][x].oreAmt = 999;
      }
  sweep();
  // every assembler recipe prints its output name on the panel
  for (const r of D.ASSEMBLER_RECIPES) {
    for (const k in run.machines)
      if (run.machines[k].type === 'assembler') run.machines[k].recipe = r;
    sweep();
  }
  // belts carrying the longest-named cargo
  for (let y = 0; y < D.MAP_H; y++)
    for (let x = 0; x < D.MAP_W; x++) {
      const t = run.grid[y][x];
      if (t.t === 'floor' && t.machine === null) t.belt = { dir: 2, item: 'crystal' };
    }
  sweep();
  assert(scanLines > 1000, 'the sweep actually exercised the panel (' + scanLines + ')');
  assert(seen.some(l => /repair/.test(l)), 'the damaged-machine repair line was covered');
}

// ------------------------ CX-11: STOCK rows are unambiguous and never clipped
// render.js exports the row contract (STOCK_NAME_W / itemLabel / stockCount).
// The bug was 'copper ore' and 'copper plate' both drawing as 'copper o/p';
// the fix is per-item `short:` in data.js, so this lint holds data and render
// together — a new item with no short, or a short that clips, fails here.
SECTION = 'stock-rows';
{
  require('../js/render.js');          // DOM-free at load; init() is what needs a canvas
  const R = DC.Render;
  assert(R && typeof R.itemLabel === 'function', 'Render exports itemLabel');
  const W = R.STOCK_NAME_W;
  assert(typeof W === 'number' && W > 0, 'Render exports STOCK_NAME_W');

  const labels = new Map();
  for (const id of D.ITEM_ORDER) {
    const it = D.ITEMS[id];
    assert(it, 'ITEM_ORDER entry ' + id + ' exists in ITEMS');
    assert(typeof it.short === 'string' && it.short.length,
      id + ' needs a `short:` STOCK label in data.js');
    const drawn = R.itemLabel(id).slice(0, W);
    assertEq(drawn, it.short, id + " draws its data.js short verbatim — '" +
      it.short + "' is being clipped to '" + drawn + "'");
    assert(!labels.has(drawn), 'STOCK label ' + JSON.stringify(drawn) +
      ' is ambiguous: both ' + labels.get(drawn) + ' and ' + id + ' draw it');
    labels.set(drawn, id);
  }
  // counts share the row: 3 columns, and nothing may overrun them
  for (const n of [0, 1, 42, 999, 1000, 12345, 1e9]) {
    const s = R.stockCount(n);
    assertEq(s.length <= R.STOCK_COUNT_W, true,
      'stock count ' + n + ' -> ' + JSON.stringify(s) + ' overruns the count field');
  }
  assertEq(R.stockCount(999), '999', '999 still prints exactly');
  assertEq(R.stockCount(1000), '1k+', 'past 999 the count reads 1k+');
  assertEq(R.stockCount(-5), '0', 'negative stock clamps to 0');
}

// ------------------ prose panels: no authored line is ever cut mid-word
// CX-04 fixed the SCAN tooltips by shortening them. The same defect lived on
// in the two panels that carry authored PROSE: the LOG sliced every message at
// 29 columns ('The rig bites into the topsoi', and every mirrored GRIT bark at
// 29 of its ~70 characters) and the Foreman bar split at raw column 41
// ('Gravi / ty agrees'). Both now word-wrap through Render.wrapClamp. This
// lint holds the corpus and the panel geometry together: a new bark too long
// to wrap whole, or a re-inlined slice, fails here.
SECTION = 'prose-panels';
{
  const fs = require('fs');
  const path = require('path');
  const R = DC.Render;
  const LW = R.SCAN_COL_W, LR = R.LOG_MSG_ROWS, FW = R.FOREMAN_ROW_W;
  assert(typeof R.wrapClamp === 'function', 'Render exports wrapClamp');
  assert(LW > 0 && LR > 0 && FW > 0, 'Render exports the LOG/Foreman geometry');

  // rows must fit the panel, and reading them top to bottom must reproduce the
  // line word for word — no split words, nothing dropped, no '…' (a line that
  // needs the ellipsis is one the corpus should not contain).
  function checkWrap(str, w, rows, where) {
    const out = R.wrapClamp(str, w, rows);
    assert(out.length <= rows, where + ': "' + str + '" needs ' + out.length +
      ' rows, panel holds ' + rows);
    for (const ln of out) {
      assert([...ln].length <= w, where + ': row "' + ln + '" is ' +
        [...ln].length + ' > ' + w + ' columns');
      assert(ln.indexOf('…') < 0, where + ': "' + str +
        '" does not fit ' + rows + 'x' + w + ' — it would be truncated to "' + ln + '"');
    }
    const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).join(' ');
    assertEq(words(out.join(' ')), words(str),
      where + ': wrapping "' + str + '" changed the words');
  }

  for (const [tag, line] of allLines) {
    // barks.js mirrors into the LOG behind this tag; the bar draws it untagged
    checkWrap('GRIT ▸ ' + line, LW, LR, 'LOG bark mirror [' + tag + ']');
    checkWrap(line, FW, 2, 'Foreman bar [' + tag + ']');
  }

  // sim.js messages: every static literal handed to msg(), plus the worst case
  // of each message built by concatenation (longest name / widest number).
  const simSrc2 = fs.readFileSync(path.join(__dirname, '../js/sim.js'), 'utf8');
  const lits = [];
  const callRe = /msg\(\s*run\s*,/g;                 // ternaries and concatenations included
  let mm;
  while ((mm = callRe.exec(simSrc2)) !== null) {
    const seg = simSrc2.slice(mm.index, mm.index + 400);
    const cut = seg.indexOf(');');
    const body = cut > 0 ? seg.slice(0, cut) : seg;
    const litRe = /'((?:[^'\\]|\\.)*)'/g;
    let x;
    while ((x = litRe.exec(body)) !== null) {
      const s = x[1].replace(/\\'/g, "'");
      if (s.length > 3) lits.push(s);               // skip glyph/format fragments
    }
  }
  assert(lits.length >= 12, 'found the static sim.js log messages (' + lits.length + ')');
  const bnames = Object.keys(D.BUILDINGS).map(k => D.BUILDINGS[k].name);
  const snames = Object.keys(D.SCHEMATICS || {}).map(k => D.SCHEMATICS[k].name);
  const longestB = bnames.sort((a, b) => b.length - a.length)[0];
  const longestS = (snames.sort((a, b) => b.length - a.length)[0]) || 'x';
  const dyn = [
    longestB + ' self-repaired.',
    longestB + ' destroyed!',
    longestB + ' swallowed by magma!',
    '≋ QUAKE — the stratum shudders (−99 integrity)',
    'Salvage claws recover 999 parts.',
    'Schematic installed: ' + longestS,
    '▼ Descending — stratum 99.',
  ];
  for (const t of lits.concat(dyn)) checkWrap(t, LW, LR, 'LOG sim message');
  PROSE_N = allLines.length * 2 + lits.length + dyn.length;
}

console.log('PASS barks | categories ' + CATALOG.length +
  ' | lines ' + allLines.length +
  ' | drive triggers ' + trigs.size + ' (' + Array.from(trigs).sort().join(',') + ')' +
  ' | barks in drive ' + d1.lines.length +
  ' | worst line overlap ' + DUP_WORST.toFixed(2) + '/' + DUP_MAX.toFixed(2) +
  ' | manual ' + DC.Art.helpPages.length + 'pp ' + DC.Art.help[0].length + 'x' +
  DC.Art.help.length + ' data-composed, ' + MANUAL_COLORS + ' colours, ink ' +
  DC.Art.helpPages.map(p => (p.ink * 100).toFixed(0) + '%').join('/') +
  ' | scan lines ' + scanLines + ' <= ' + S.SCAN_W +
  ' | stock labels ' + D.ITEM_ORDER.length + ' unambiguous' +
  ' | prose ' + PROSE_N + ' lines wrap whole (LOG ' + DC.Render.LOG_MSG_ROWS +
  'x' + DC.Render.SCAN_COL_W + ', bar 2x' + DC.Render.FOREMAN_ROW_W + ')');
