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
require('../js/events.js');    // M-EVENTS: the finds, the logbook, the vignettes
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

// M-EVENTS adds nine pools of its own. They are not in the SPEC2 catalog
// above (that list is the shipped v1.1 surface and its count is quoted in the
// PASS line), so their sizing is pinned here — same 4-8 rule, because a
// three-line pool starts repeating inside one run and a nine-line one has
// lines the player will never see.
const EVENT_POOLS = ['digFind', 'lunchbox', 'bones', 'gasPocket', 'oldShaft',
                     'deadRig', 'cat', 'catFlee', 'vignette'];
for (const t of EVENT_POOLS) {
  const pool = B.POOLS[t];
  assert(Array.isArray(pool), 'M-EVENTS trigger "' + t + '" has a pool');
  assert(pool.length >= 4 && pool.length <= 8,
    'pool "' + t + '" has 4-8 lines (got ' + pool.length + ')');
}
// The one line that is deliberately NOT a pool: the cat's ending is a
// punchline, and a punchline that rotates is one nobody can quote back.
assert(typeof B.CAT_EPITAPH === 'string' && B.CAT_EPITAPH.length <= 70,
  'the cat has exactly one epitaph, and it fits');

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
// M-WONDERS: every landmark gets a discovery line, and every landmark the
// player can actually touch gets a line for having touched it. A wonder with
// no line is scenery, which is the one thing this module exists not to ship.
for (const L of D.LANDMARKS) {
  const lines = B.LANDMARK_LINES[L.id];
  assert(lines && typeof lines.find === 'string',
    'bespoke discovery line for landmark ' + L.id);
  const usable = !!(L.cost || L.ring || L.dig || L.mirror);
  if (usable)
    assertEq(typeof lines.use, 'string', 'bespoke use line for landmark ' + L.id);
}
assertEq(D.LANDMARKS.length, 8, 'all 8 landmarks covered');
// M-EVENTS: GRIT has an opinion about EVERY fork. A vignette choice with no
// bespoke line falls back to a shrug, and a shrug on half the catalog reads
// as the game not having noticed what the player just did.
{
  const V = (DC.Events && DC.Events.VIGNETTES) || [];
  assert(V.length >= 20, 'the vignette catalog is loaded (' + V.length + ')');
  const keys = new Set();
  for (const v of V) {
    for (let i = 0; i < v.choices.length; i++) {
      const k = v.id + ':' + i;
      keys.add(k);
      assertEq(typeof B.VIGNETTE_LINES[k], 'string',
        'GRIT answers ' + v.title + ' / ' + v.choices[i].label);
    }
  }
  for (const k in B.VIGNETTE_LINES)
    assert(keys.has(k), 'vignette line ' + k + ' names a real choice');
}
for (const id in B.LANDMARK_LINES)
  assert(D.LANDMARK_BY_ID[id], 'landmark line ' + id + ' names a real landmark');

// ------------------------------------------------- width + total line count
SECTION = 'width';
const allLines = [];
for (const t in B.POOLS) for (const l of B.POOLS[t]) allLines.push([t, l]);
for (const k in B.STRATUM_LINES) allLines.push(['stratum:' + k, B.STRATUM_LINES[k]]);
for (const k in B.SCHEM_LINES) allLines.push([k, B.SCHEM_LINES[k]]);
for (const k in B.META_LINES) allLines.push([k, B.META_LINES[k]]);
for (const k in B.LANDMARK_LINES)   // M-WONDERS
  for (const w in B.LANDMARK_LINES[k]) allLines.push(['landmark:' + k, B.LANDMARK_LINES[k][w]]);
for (const k in B.VIGNETTE_LINES)   // M-EVENTS
  allLines.push(['vignette:' + k, B.VIGNETTE_LINES[k]]);
for (const c in B.EPITAPHS)
  for (const pair of B.EPITAPHS[c]) for (const l of pair) allLines.push(['epitaph:' + c, l]);
for (const l of B.TOASTS) allLines.push(['toast', l]);
// M-CORELORE: the second voice is authored content like everything above it,
// so both halves of every pair join the corpus the width / duplicate /
// guardrail / wrap lints run over. The Core's line is untagged in the bar and
// in the LOG (4 columns of prefix, not 7), so checking it against GRIT's tag
// below is the conservative measurement.
const CORE_KINDS = ['intrusion', 'gate', 'reveal', 'mantle'];
for (const k of CORE_KINDS) {
  for (const p of (B.CORE[k] || [])) {
    allLines.push(['core:' + k, p.core]);
    allLines.push(['core:' + k + ' reply', p.grit]);
  }
}
// M-RECAP: GRIT's Performance Review is authored content like everything
// above it, so it joins the corpus the width / duplicate / guardrail lints
// run over. Lines carry {tokens}; they are measured filled, worst-case.
const REVIEW_TIERS = ['shallow', 'mid', 'deep', 'win', 'mantle'];
const REVIEW_TOKENS = ['depth', 'time', 'min', 'plates', 'gears', 'charges',
                       'cores', 'breaches', 'schems'];
const REVIEW_WORST = {
  depth: '999', time: '999:59', min: '999', plates: '9999', gears: '9999',
  charges: '9999', cores: '9999', breaches: '999', schems: '99',
};
for (const [tag, l] of allLines) {
  assertEq(typeof l, 'string', 'line in ' + tag + ' is a string');
  assert(l.length > 0 && l.length <= 70,
    'line in ' + tag + ' within 70 chars (' + l.length + '): ' + l);
}
assert(allLines.length >= 120, '>= 120 lines total (got ' + allLines.length + ')');
// Review lines join the corpus AFTER the width loop: they are measured in the
// 'review' section instead, with their {tokens} filled (a raw line carrying
// '{plates}' is 5 columns longer than the '212' the card actually prints).
// They go in RAW — filling them here would make every line sharing a token
// share a fake content word and poison the overlap lint below.
for (const t of REVIEW_TIERS)
  for (const l of B.REVIEWS[t]) allLines.push(['review:' + t, l]);

// M-ONBOARD Part 2: the induction script. It joins the DUPLICATE and GUARDRAIL
// corpora here — a joke told twice is worse whichever panel the second telling
// lands in, and the voice guardrails do not care where a line is drawn. It
// deliberately does NOT join `allLines`: everything in there is measured
// against the 70-column ceiling and the foreman bar's 2 x 41, and the induction
// is never drawn in the bar. Its width and wrap are held to the speech box it
// actually lives in, down in SECTION 'onboard-tutor'.
const tutorLines = [];
for (const k in B.TUTOR) for (const l of B.TUTOR[k]) tutorLines.push(['tutor:' + k, l]);

// M-EVENTS: the Dead Foremen. These are NOT GRIT — they are quotes found in
// the rock, and they join the corpus for the width and guardrail lints (they
// are drawn into the same LOG panel every bark is) but deliberately NOT for
// the near-duplicate lint below. The whole design of the logbook is that the
// entries rhyme with each other and with the elevator graffiti: several are
// meant to say the same thing about the singing and the warmth in different
// men's handwriting, which is the jigsaw. `logLines` is checked for exact
// repeats and for its own house style in the block right after this one.
const logLines = [];
for (const l of (DC.Events && DC.Events.LOGS) || []) logLines.push(['log', l]);
// Every authored string the vignettes carry, flattened. Defined as a function
// because the vignette catalog lands later in this brief than the logbook did
// — an absent DC.Events.VIGNETTES is simply no lines, never a crash.
function eventLines() {
  const out = [];
  for (const v of (DC.Events && DC.Events.VIGNETTES) || []) {
    out.push(['vignette:' + v.id, v.title]);
    for (const p of v.text || []) out.push(['vignette:' + v.id, p]);
    for (const c of v.choices || []) {
      out.push(['vignette:' + v.id + ' choice', c.label]);
      if (c.hint) out.push(['vignette:' + v.id + ' hint', c.hint]);
      if (c.result) out.push(['vignette:' + v.id + ' result', c.result]);
    }
  }
  return out;
}
{
  SECTION = 'logbook';
  const E = DC.Events;
  assert(E && Array.isArray(E.LOGS), 'DC.Events.LOGS is the corpus');
  assertEq(E.LOGS.length, 20, 'twenty foremen did not come back up');
  const seenL = new Set();
  const names = new Set();
  for (const l of E.LOGS) {
    assert(typeof l === 'string' && l.length > 0 && l.length <= 70,
      'log entry within 70 chars (' + l.length + '): ' + l);
    assert(!seenL.has(l), 'the same log is not found twice: ' + l);
    seenL.add(l);
    // House style, because the logbook is read as a PAGE of twenty and any
    // entry that breaks the shape reads as a bug rather than as a voice:
    // "Log <n>: <the thing he wrote> -Fmn. <name>".
    const m = /^Log (\d+): .+ -Fmn\. ([A-Z][a-z]+)$/.exec(l);
    assert(m, 'log entry is "Log N: ... -Fmn. Name": ' + l);
    names.add(m[2]);
  }
  assert(names.size >= 8, 'the book is more than a couple of foremen (' +
    names.size + ' names)');
  // ...and the jigsaw actually corroborates M-CORELORE. These are the three
  // beats the Core is written around; if the logbook stops mentioning them it
  // has become trivia instead of foreshadowing.
  const all = E.LOGS.join(' ').toLowerCase();
  for (const beat of ['singing', 'warm', 'keeps time'])
    assert(all.indexOf(beat) >= 0, 'the logbook still corroborates "' + beat + '"');
  assert(E.logText(0) === E.LOGS[0] && E.logText(999) === null,
    'Events.logText reads the book and refuses what is not in it');
}

// line text -> trigger id (for classifying what the drive fired)
const TRIG_OF = {};
for (const t in B.POOLS) for (const l of B.POOLS[t]) TRIG_OF[l] = t;
for (const k in B.STRATUM_LINES) TRIG_OF[B.STRATUM_LINES[k]] = 'stratumArrive';
for (const k in B.SCHEM_LINES) TRIG_OF[B.SCHEM_LINES[k]] = 'schematicPick';
for (const k in B.META_LINES) TRIG_OF[B.META_LINES[k]] = 'foundryBuy';
for (const k in B.LANDMARK_LINES) {
  const L = B.LANDMARK_LINES[k];
  if (L.find) TRIG_OF[L.find] = 'landmarkFound';
  if (L.use) TRIG_OF[L.use] = 'landmarkUse';
}

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
  // M-WIDE: the line is in the bar and NOWHERE ELSE while it is the current
  // line — it used to be on screen twice at once, typing in the bar and
  // mirrored into the LOG at the same moment.
  const said = run.foreman.text;
  const inLog = function (t) { return run.messages.some(m => m.text === 'GRIT ▸ ' + t); };
  assert(!inLog(said), 'the line being typed in the bar is not also in the LOG');
  step(12 * HZ);
  assert(inLog(said), 'and it falls into the LOG once its hold is over');

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

// ------------------------------- M-RECAP: GRIT's Performance Review pools
// The recap card's payload. Contracts: five outcome tiers, >= 10 lines each,
// every line still <= 70 columns once its {tokens} are filled with the worst
// case the game can produce, no unknown token (a typo'd {plate} would render
// as literal braces on the card), the tier a run earns is the tier the line
// comes from, and the roll is deterministic on run.rng like every other bark.
SECTION = 'review';
let REVIEW_N = 0;
{
  for (const fn of ['review', 'reviewTier', 'reviewCtx', 'fillReview'])
    assertEq(typeof B[fn], 'function', 'DC.Barks.' + fn + ' is a function');
  for (const t of REVIEW_TIERS) {
    const pool = B.REVIEWS[t];
    assert(Array.isArray(pool), 'review tier "' + t + '" has a pool');
    assert(pool.length >= 10, 'review tier "' + t + '" has >= 10 lines (got ' +
      pool.length + ')');
    for (const l of pool) {
      REVIEW_N++;
      const filled = B.fillReview(l, REVIEW_WORST);
      assert(filled.length <= 70, 'review line fits 70 cols filled (' +
        filled.length + '): ' + filled);
      assert(!/[{}]/.test(filled), 'review line uses only known tokens: ' + l);
      const toks = l.match(/\{(\w+)\}/g) || [];
      for (const tk of toks) {
        assert(REVIEW_TOKENS.indexOf(tk.slice(1, -1)) >= 0,
          'review token ' + tk + ' is a real context key: ' + l);
      }
    }
  }
  assertEq(Object.keys(B.REVIEWS).length, REVIEW_TIERS.length,
    'no review tier ships without a test contract');

  // tier selection: shallow / mid / deep / win / mantle
  const cases = [
    [1, false, false, 'shallow'], [2, false, false, 'shallow'],
    [3, false, false, 'mid'], [5, false, false, 'mid'],
    [6, false, false, 'deep'], [8, false, false, 'deep'],
    [8, true, false, 'win'], [11, true, true, 'mantle'], [11, false, true, 'mantle'],
  ];
  for (const [depth, won, mantle, tier] of cases) {
    const run = S.newRun(defEffects(), 100 + depth);
    run.depth = depth; run.mantle = mantle;
    assertEq(B.reviewTier(run, { depth: depth, won: won }), tier,
      'depth ' + depth + ' won=' + won + ' mantle=' + mantle + ' reviews as ' + tier);
    const line = B.review(run, { depth: depth, won: won, timeSec: 600, cores: 4 });
    const pool = B.REVIEWS[tier].map(l => B.fillReview(l, B.reviewCtx(run,
      { depth: depth, won: won, timeSec: 600, cores: 4 })));
    assert(pool.indexOf(line) >= 0, 'review line came from the ' + tier + ' pool');
    assert(!/[{}]/.test(line), 'review line is fully substituted: ' + line);
  }

  // context: run totals span strata (gearsFed resets every stratum, splits do
  // not), and the hoarding joke needs the plates that were still banked
  {
    const run = S.newRun(defEffects(), 777);
    run.splits = [{ depth: 1, sec: 100, gears: 20, charges: 0 },
                  { depth: 2, sec: 130, gears: 28, charges: 3 }];
    run.gearsFed = 7; run.chargesFed = 1; run.inv.ironPlate = 212;
    run.schematics = ['s_extract', 's_damp'];
    const ctx = B.reviewCtx(run, { depth: 3, won: false, timeSec: 245, cores: 2, breaches: 2 });
    assertEq(ctx.gears, 55, 'review gear total sums the splits plus this stratum');
    assertEq(ctx.charges, 4, 'review charge total sums the splits plus this stratum');
    assertEq(ctx.plates, 212, 'review reads the plates still banked');
    assertEq(ctx.time, '4:05', 'review formats the run time');
    assertEq(ctx.min, 4, 'review rounds the run to whole minutes');
    assertEq(ctx.schems, 2, 'review counts the schematics taken');
    // no splits at all (a run that died in stratum 1) still reads clean
    const bare = S.newRun(defEffects(), 778);
    bare.gearsFed = 3;
    assertEq(B.reviewCtx(bare, { depth: 1, won: false, timeSec: 0 }).gears, 3,
      'review context works with no splits recorded');
    assertEq(B.reviewCtx(bare, {}).min, 1, 'a sub-minute run still reads as 1 min');
  }

  // determinism: same seed, same roll — the card must not re-roll per frame
  {
    const a = S.newRun(defEffects(), 4242), b = S.newRun(defEffects(), 4242);
    const res = { depth: 4, won: false, timeSec: 500, cores: 3 };
    assertEq(B.review(a, res), B.review(b, res), 'review is deterministic on the run seed');

    // ...and the review must not TOUCH run.rng. It is the one bark that render
    // asks for on demand — the card is a screen the player may never open, and
    // on victory the run is still live. If picking the roast advanced the
    // stream, the Mantle a player got would depend on whether they pressed TAB.
    const c = S.newRun(defEffects(), 4242);
    for (let i = 0; i < 8; i++) c.rng();                     // control: no card
    const before = [];
    for (let i = 0; i < 8; i++) before.push(c.rng());
    const d = S.newRun(defEffects(), 4242);
    for (let i = 0; i < 8; i++) d.rng();
    for (let k = 0; k < 5; k++) B.review(d, res);            // open the card 5×
    const after = [];
    for (let i = 0; i < 8; i++) after.push(d.rng());
    assertEq(after.join(','), before.join(','),
      'review never advances run.rng (render must not feed back into sim)');

    // and it still varies run to run — a constant would pass every check above
    const seen = {};
    for (let s = 1; s <= 40; s++) seen[B.review(S.newRun(defEffects(), s * 7919), res)] = 1;
    assert(Object.keys(seen).length >= 5,
      'review picks spread across the pool (' + Object.keys(seen).length + ' distinct in 40 seeds)');
  }
}

// ============================== M-CORELORE: the second voice ==============
// The brief's whole promise is that the Core reads as a DIFFERENT character
// from GRIT, so the contrast is asserted mechanically and not left to taste:
// the Core is lowercase throughout (GRIT shouts, the planet never needs to),
// never says "kid" (his word, and the relationship it implies is his), and
// every line ships with the deflection GRIT throws over the top of it. The
// register lives in one structure so a later dispatch cannot add an unpaired
// Core line without failing here.
SECTION = 'corelore';
let CORE_N = 0;
{
  assertEq(typeof B.core, 'function', 'DC.Barks.core is a function');
  assert(B.CORE && typeof B.CORE === 'object', 'DC.Barks.CORE is exposed');
  assertEq(Object.keys(B.CORE).length, CORE_KINDS.length,
    'no Core register ships without a test contract');
  assert(B.CORE.intrusion.length >= 8,
    'the stratum-6+ intrusion pool is deep enough not to repeat (got ' +
    B.CORE.intrusion.length + ')');
  assertEq(B.CORE.gate.length, 3, 'the Core Gate is a 3-beat sequence');
  assert(B.CORE.mantle.length >= 3, 'the Mantle gets >= 3 authored Core lines');
  assert(B.CORE.reveal.length >= 3,
    'the reveal has >= 3 authored lines — the crack is a picture, this is\n'
    + '    the picture landing');
  for (const k of CORE_KINDS) {
    for (const p of B.CORE[k]) {
      CORE_N += 2;
      assert(typeof p.core === 'string' && p.core.length, k + ': every beat has a Core line');
      assert(typeof p.grit === 'string' && p.grit.length,
        k + ': every Core line is authored with GRIT\'s reply: ' + p.core);
      assert(!/[A-Z]/.test(p.core),
        k + ': the Core is lowercase — it is not shouting: ' + p.core);
      assert(!/\bkid\b/i.test(p.core),
        k + ': "kid" is GRIT\'s word, not the planet\'s: ' + p.core);
      assert(/[A-Z]/.test(p.grit), k + ': GRIT still talks like GRIT: ' + p.grit);
    }
  }
  // exactly one beat carries the fake ascend prompt, and it is the middle one
  const offers = B.CORE.gate.map(p => !!p.offer);
  assertEq(offers.join(','), 'false,true,false',
    'only the Core Gate\'s second beat offers the surface back');

  // --- the beat, end to end: gold voice, untagged LOG mirror, GRIT's answer
  {
    const run = S.newRun(defEffects(), 616);
    run.depth = D.STRATA_COUNT;
    const line = B.core(run, 'gate', 0);
    assertEq(line, B.CORE.gate[0].core, 'gate beat 0 speaks its authored line');
    assert(run.foreman && run.foreman.text === line, 'the Core takes the foreman bar');
    assertEq(run.foreman.voice, 'core', 'the bar is marked as the Core speaking');
    // the mirror is deferred (M-WIDE): the gold line reaches the LOG when it
    // stops being the line in the bar, not while it is still typing there
    assert(!run.messages.some(m => m.text.indexOf(line) >= 0),
      'the Core is not in the LOG while it is still speaking');
    assertEq(B.core(run, 'gate', 0), null, 'a gate beat fires at most once per run');
    assertEq(run.coreOffer, null, 'beat 0 puts no prompt on the screen');

    // GRIT's deflection is scheduled, not immediate: it lands as the gold line
    // finishes typing, which is the beat the joke needs.
    let guard = 0;
    while (run.foreman.voice === 'core' && guard++ < 40 * HZ) { S.tick(run); B.tick(run); }
    assertEq(run.foreman.voice, 'grit', 'GRIT answers the Core');
    assertEq(run.foreman.text, B.CORE.gate[0].grit, 'and he answers with HIS paired line');
    assert(guard > 2, 'the deflection waits for the Core to finish (' + guard + ' ticks)');
    // ...and GRIT taking the bar is exactly what hands the gold line to the
    // LOG: superseded, therefore history (M-WIDE's deferred mirror).
    const tail = run.messages.filter(m => m.text.indexOf(line) >= 0).pop();
    assert(tail, 'the Core line reaches the LOG once it is superseded');
    assertEq(tail.text.indexOf('GRIT'), -1, 'the Core is never tagged as GRIT in the LOG');
    assertEq(tail.color, D.COLORS.gold, 'the Core mirrors into the LOG in gold');

    // beat 2 is the lie: it puts a prompt on the screen with a real expiry
    run.totalT += 100;
    B.core(run, 'gate', 1);
    assert(run.coreOffer && run.coreOffer.until > run.totalT,
      'the Core Gate\'s middle beat raises the fake ASCEND prompt');
    assertEq(run.coreOffer.until - run.totalT, D.CORE.offer * HZ,
      'the prompt is displayed for D.CORE.offer seconds');
  }

  // --- the ambient intrusion: never above D.CORE.depth, once per stratum
  {
    const shallow = S.newRun(defEffects(), 617);
    shallow.depth = D.CORE.depth - 1;
    shallow.t = 60 * HZ;
    for (let i = 0; i < 40 * HZ; i++) { shallow.totalT++; B.tick(shallow); }
    const heard = (shallow.messages || []).some(m => m.color === D.COLORS.gold);
    assertEq(heard, false, 'the Core is silent above stratum ' + D.CORE.depth);

    const deep = S.newRun(defEffects(), 618);
    deep.depth = D.CORE.depth;
    deep.t = D.CORE.armT * HZ + 1;
    let golds = 0, seenVoice = null;
    for (let i = 0; i < 3000; i++) {
      deep.totalT++; deep.t++;
      const before = (deep.foreman && deep.foreman.text) || null;
      B.tick(deep);
      if (deep.foreman && deep.foreman.voice === 'core' && deep.foreman.text !== before) {
        golds++;
        seenVoice = deep.foreman.text;
      }
    }
    assertEq(golds, 1, 'the Core intrudes exactly once on a stratum (got ' + golds + ')');
    assert(B.CORE.intrusion.some(p => p.core === seenVoice),
      'the intrusion came from the stratum-6+ pool: ' + JSON.stringify(seenVoice));
  }

  // --- the Mantle register: past the shell it stops being amused
  {
    const run = S.newRun(defEffects(), 619);
    run.depth = D.STRATA_COUNT + 1;
    run.mantle = true;
    run.t = D.CORE.armT * HZ + 1;
    let said = null;
    for (let i = 0; i < 4000 && !said; i++) {
      run.totalT++; run.t++;
      B.tick(run);
      if (run.foreman && run.foreman.voice === 'core') said = run.foreman.text;
    }
    assert(said && B.CORE.mantle.some(p => p.core === said),
      'in the Mantle the Core draws from the Mantle pool (got ' + JSON.stringify(said) + ')');
  }
}

// ============================== M-GRITPLUS ================================
SECTION = 'gritplus';
let GRAFFITI_N = 0;
{
  // --- the idle ladder: three rungs, at the thresholds data.js declares
  assert(Array.isArray(D.IDLE_LADDER) && D.IDLE_LADDER.length === 3,
    'D.IDLE_LADDER declares three rungs');
  for (const p of ['idle', 'idle2', 'idle3'])
    assert(Array.isArray(B.POOLS[p]) && B.POOLS[p].length >= 4,
      'idle rung "' + p + '" has a pool of >= 4 lines');
  {
    const run = S.newRun(defEffects(), 620);
    const rungs = [];
    let last = null;
    for (let i = 0; i < 200 * HZ; i++) {
      S.tick(run); B.tick(run);
      const f = run.foreman;
      if (f && f.text !== last) {
        last = f.text;
        for (const p of ['idle', 'idle2', 'idle3'])
          if (B.POOLS[p].indexOf(f.text) >= 0) rungs.push([p, Math.round(run.totalT / HZ)]);
      }
    }
    assertEq(rungs.map(r => r[0]).join(','), 'idle,idle2,idle3',
      'the idle ladder climbs gentle -> sarcasm -> documentary (got ' +
      JSON.stringify(rungs) + ')');
    for (let i = 0; i < 3; i++)
      assert(rungs[i][1] >= D.IDLE_LADDER[i],
        'rung ' + (i + 1) + ' waits its ' + D.IDLE_LADDER[i] + 's (fired at ' + rungs[i][1] + 's)');
    // and any real work resets the whole ladder
    run.stats.lastPlaceT = run.totalT;
    let more = 0;
    for (let i = 0; i < 40 * HZ; i++) {
      S.tick(run); B.tick(run);
      const f = run.foreman;
      if (f && f.text !== last) { last = f.text; more++; }
    }
    assertEq(more, 0, 'placing something resets the ladder — GRIT stops needling');
  }

  // --- the smoke break: fired while the sim is FROZEN, so the line must
  // already be typed out (run.totalT does not advance during a pause)
  {
    const run = S.newRun(defEffects(), 621);
    assertEq(typeof B.pause, 'function', 'DC.Barks.pause is a function');
    const line = B.pause(run, 'smokeBreak');
    assert(B.POOLS.smokeBreak.indexOf(line) >= 0, 'the smoke-break line comes from its pool');
    const shown = Math.floor((run.totalT - run.foreman.t0) * 2);
    assert(shown >= line.length,
      'a bark fired mid-pause is already fully typed (' + shown + '/' + line.length + ')');
    assert(run.foreman.until > run.totalT, 'and it still expires once the sim resumes');
    const back = B.pause(run, 'breakOver');
    assert(B.POOLS.breakOver.indexOf(back) >= 0, 'resuming gets him back on shift');
  }

  // --- EGG-420: the bar goes mellow, priority lines still land, the window
  // closes with the munchies, and none of it touches progression
  {
    const run = S.newRun(defEffects(), 622);
    assertEq(typeof S.startEgg, 'function', 'Sim.startEgg opens the window');
    assertEq(B.eggOpen(run), false, 'no window on a fresh run');
    S.startEgg(run, 'code');
    assertEq(B.eggOpen(run), true, 'the code opens the window');
    assertEq(run.egg.until - run.totalT, D.EGG420.sec * HZ, 'the window is 42 seconds');
    run.totalT += 100;
    const mellow = B.fire(run, 'quake');
    assert(B.POOLS.egg420.indexOf(mellow) >= 0,
      'while the window is open the bar draws mellow: ' + JSON.stringify(mellow));
    run.totalT += 100;
    const dead = B.fire(run, 'death');
    assert(B.POOLS.death.indexOf(dead) >= 0,
      'priority lines still say what they came to say: ' + JSON.stringify(dead));
    // expiry: the exit line fires once, and only once
    run.totalT = run.egg.until + 1;
    let ends = 0;
    for (let i = 0; i < 30 * HZ; i++) {
      run.totalT++;
      const before = run.foreman && run.foreman.text;
      B.tick(run);
      if (run.foreman && run.foreman.text !== before &&
          B.POOLS.egg420End.indexOf(run.foreman.text) >= 0) ends++;
    }
    assertEq(ends, 1, 'the window closes with exactly one munchies line');
    assertEq(B.eggOpen(run), false, 'and the window is shut');
  }

  // --- elevator graffiti: 40 walls, none of them too wide to read, none of
  // them repeated, all of them under the same guardrails as the barks
  {
    const A = DC.Art;
    assert(Array.isArray(A.graffiti) && A.graffiti.length >= 40,
      'the shaft carries >= 40 lines of graffiti (got ' +
      (A.graffiti && A.graffiti.length) + ')');
    const seenG = new Set();
    for (const g of A.graffiti) {
      GRAFFITI_N++;
      assert(typeof g === 'string' && g.length > 0, 'every graffito is a string');
      assert(g.length <= A.GRAFFITI_W, 'graffito fits ' + A.GRAFFITI_W +
        ' columns (' + g.length + '): ' + g);
      assert(!seenG.has(g), 'the same wall is not painted twice: ' + g);
      seenG.add(g);
    }
  }

  // --- the crack overlay: a PURE function of whatever sphere it is handed.
  // M-HIRES is redrawing the victory sphere at higher fidelity in parallel, so
  // this must never assume the shipped art: it is checked against the shipped
  // rows AND against a synthetic sphere at a different resolution.
  {
    const A = DC.Art;
    assertEq(typeof A.crackSphere, 'function', 'Art.crackSphere is a function');
    function cracks(rows, label) {
      const before = rows.slice();
      const out = A.crackSphere(rows);
      assertEq(rows.join('\n'), before.join('\n'),
        label + ': crackSphere does not mutate the rows it is given');
      assertEq(out.length, rows.length, label + ': the block keeps its height');
      let opened = 0, widest = 0;
      for (let y = 0; y < rows.length; y++) {
        assertEq(out[y].length, rows[y].length, label + ': row ' + y + ' keeps its width');
        let run0 = 0;
        for (let x = 0; x < rows[y].length; x++) {
          if (out[y][x] === rows[y][x]) { run0 = 0; continue; }
          assertEq(out[y][x], ' ', label + ': the crack is void, not a new glyph');
          assert(A.CRACK_INK.indexOf(rows[y][x]) >= 0,
            label + ': the crack only opens shading ink, never lettering (' +
            JSON.stringify(rows[y][x]) + ' at ' + x + ',' + y + ')');
          opened++;
          if (++run0 > widest) widest = run0;
        }
      }
      assert(opened >= rows.length / 2, label + ': the crack reaches through the shell (' +
        opened + ' cells)');
      assert(widest <= 2, label + ': it stays a hairline — widest run ' + widest);
      // deterministic: no rng, no frame clock, no hidden state — the same
      // sphere cracks the same way every time it is drawn
      assertEq(A.crackSphere(rows).join('\n'), out.join('\n'),
        label + ': crackSphere is deterministic');
      return opened;
    }
    const shipped = cracks(A.victory, 'shipped sphere');
    // a taller, wider sphere in different ink proportions — i.e. whatever
    // M-HIRES hands over at merge time
    const big = [];
    for (let y = -12; y <= 12; y++) {
      let s = '';
      for (let x = -40; x <= 40; x++) {
        const d = (x * x) / 1600 + (y * y) / 144;
        s += d <= 0.1 ? '☼' : d <= 0.4 ? '█' : d <= 0.7 ? '▓' : d <= 1 ? '▒' : ' ';
      }
      big.push(s);
    }
    cracks(big, 'hi-res sphere');
    assert(shipped > 0, 'the shipped sphere really cracks');
    // and it is inert on anything that is not a sphere
    assertEq(A.crackSphere([]).length, 0, 'no rows in, no rows out');
    assertEq(A.crackSphere(['no ink here']).join(''), 'no ink here',
      'art with no shading ink is returned untouched');
  }
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
  // the induction is in here too: sixty new jokes are sixty new chances to have
  // told one of the existing four hundred a second time
  const dupLines = allLines.concat(tutorLines);
  const byText = new Map();
  for (const [tag, l] of dupLines) {
    if (byText.has(l)) fail('exact duplicate line in ' + byText.get(l) +
      ' and ' + tag + ': ' + l);
    byText.set(l, tag);
  }
  const sets = dupLines.map(([, l]) => new Set(contentWords(l)));
  let worst = 0, worstPair = null;
  for (let i = 0; i < dupLines.length; i++) {
    for (let j = i + 1; j < dupLines.length; j++) {
      const a = sets[i], b = sets[j];
      if (!a.size || !b.size) continue;
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      const jac = inter / (a.size + b.size - inter);
      if (jac > worst) { worst = jac; worstPair = [dupLines[i], dupLines[j]]; }
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
  // M-EVENTS' authored text answers to the same guardrails GRIT does — the
  // logbook, and every line of every vignette (which is why they are gathered
  // here rather than trusted for being "lore").
  // M-ONBOARD Part 2: the induction is where the register is widest by design
  // (dad jokes, the joke a nine-year-old makes about a drill and a hole, filthy
  // adult ones) and it answers to exactly the same line the rest of the corpus
  // does. That line is where the humour is BETTER, not weaker.
  for (const [tag, l] of allLines.concat(tutorLines, logLines, eventLines())) {
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
  // 'depleted' joins the sweep with M-ONBOARD: it is one of the three statuses
  // render draws the red '!' for, so it now prints a legend line of its own.
  const statuses = ['ok', 'idle', 'jammed', 'nofuel', 'blocked', 'dead', 'depleted'];
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

// ---------------------------------- M-ONBOARD: the game explains itself
// Part 1's contracts, held here because this suite is where the wording and
// panel-geometry lints live. Three separate things:
//   * every sentence the diagnostics can emit fits the LOG (checked with the
//     prose panels below, which is where wrapClamp is already loaded)
//   * the '!' legend fits the SCAN panel AND covers exactly the statuses
//     render draws that '!' for — a fourth one added later fails here until
//     somebody writes its line
//   * GRIT's editorial never spends run.rng (SPEC3 §0 law 7)
SECTION = 'onboard';
let diagN = 0;
{
  assertEq(typeof S.diagLine, 'function', 'Sim exports diagLine');
  assertEq(typeof S.diagLines, 'function', 'Sim exports diagLines');
  const lines = S.diagLines();
  diagN = lines.length;
  assert(diagN >= 40, 'diagLines enumerates the wording (' + diagN + ')');
  for (const l of lines) {
    assert(typeof l === 'string' && l.length > 0, 'every diagnostic is a string');
    // Reason AND fix, always. A line that only names the fault leaves the
    // player exactly where the director was: told something is wrong, not
    // told what to do. Every one of these ends in an instruction.
    assert(/belt|demolish|mine |assembler|takes/i.test(l),
      'diagnostic names a fault but no fix: ' + JSON.stringify(l));
  }
  assertEq(new Set(lines).size >= 20, true, 'the causes do not all say the same thing');

  // --- the '!' legend ---
  const H = S.STATUS_HINT;
  assert(H && typeof H === 'object', 'Sim exports STATUS_HINT');
  for (const k in H) {
    assert(typeof H[k] === 'string' && H[k].length > 0, 'legend for ' + k + ' is a string');
    assert(H[k].length <= S.SCAN_W, 'the ' + k + ' legend is ' + H[k].length +
      ' cols, panel clips at ' + S.SCAN_W + ': ' + JSON.stringify(H[k]));
  }
  // The legend is a WARNING the player has to find at a glance, so it is held
  // to the same 4.5:1 text floor every other panel is, and deliberately not to
  // the dim tone the passive 'click:' hints use — that one measures 2.96:1 and
  // would have buried the one line this brief exists to surface (law 6).
  {
    require('../js/render.js');
    const R = DC.Render;
    const lit = R.resolveColor ? R.resolveColor(D.COLORS.amber) : D.COLORS.amber;
    assert(R.contrast(lit, D.COLORS.bg) >= R.MIN_CONTRAST,
      "the '!' legend paints at " + R.contrast(lit, D.COLORS.bg).toFixed(2) +
      ':1, under the ' + R.MIN_CONTRAST + ':1 text floor');
  }
  // render.js is the authority on which statuses get the glyph; scrape it so
  // the two can never drift. This is the actual M-ONBOARD requirement: the
  // mark meant blocked OR nofuel OR depleted with no way to tell which.
  {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../js/render.js'), 'utf8');
    const mrk = src.match(/const bad = ([^;]+);/);
    assert(mrk, "found render.js's '!' condition");
    const drawn = (mrk[1].match(/'(\w+)'/g) || []).map(s => s.replace(/'/g, ''));
    assert(drawn.length >= 3, "render's '!' covers several statuses (" + drawn.join(',') + ')');
    for (const st of drawn)
      assert(H[st], "render draws '!' for status '" + st +
        "' and the SCAN panel has no legend line for it");
    for (const st in H)
      assert(drawn.indexOf(st) >= 0, 'STATUS_HINT explains ' + st +
        " but render never draws '!' for it");
  }

  // --- GRIT editorializes, and it costs the stream nothing ---
  assertEq(typeof B.diag, 'function', 'Barks exports diag');
  for (const cause in B.DIAG_POOL) {
    const pool = B.POOLS[B.DIAG_POOL[cause]];
    assert(Array.isArray(pool) && pool.length >= 4 && pool.length <= 8,
      'diag pool for ' + cause + ' has 4-8 lines');
  }
  // The causes GRIT already covers through an ambient must NOT get a second
  // line — two GRIT reactions to one fault is nagging.
  for (const cause of ['blocked', 'nofuel', 'depleted'])
    assert(!B.DIAG_POOL[cause], cause + ' already reaches GRIT through an ambient pool');
  // Stream safety, measured against a twin that never speaks: these lines fire
  // only when the player has built something wrong, so a draw here would make
  // the quake schedule depend on the shape of a base. Same technique as the
  // 'review never advances run.rng' lint above.
  {
    const a = S.newRun(defEffects(), 20260813);
    const b = S.newRun(defEffects(), 20260813);
    for (const cause in B.DIAG_POOL) {
      a.totalT += 60 * HZ; b.totalT += 60 * HZ;
      const line = B.diag(a, cause);
      assert(typeof line === 'string', 'GRIT answers ' + cause);
      assertEq(a.rng(), b.rng(), 'Barks.diag(' + cause + ') advanced run.rng');
    }
    // same seed, same cause, same line — every time
    const c = S.newRun(defEffects(), 20260813);
    const d = S.newRun(defEffects(), 20260813);
    c.totalT += 60 * HZ; d.totalT += 60 * HZ;
    assertEq(B.diag(c, 'beltJam'), B.diag(d, 'beltJam'),
      'one seed and one cause must pick one line');
    assertEq(B.diag(c, 'nope'), null, 'an unknown cause is a silence, not a throw');
  }
}

// ============ M-ONBOARD Part 2: the induction script ======================
// The tutorial pool is authored content and answers to every lint the rest of
// the corpus does — but NOT to the foreman bar's geometry, because it is never
// drawn there. It lives in a 40-cell box on the map, so its wrap contract is
// that box: three rows of DC.Art.SPEECH.TEXT_W, no line truncated, no word
// split. That is the same requirement the bar imposes, measured against the
// panel the writing actually lands in.
SECTION = 'onboard-tutor';
let TUTOR_N = 0, TUTOR_WORST = 0;
{
  require('../js/tutorial.js');
  require('../js/render.js');
  const R = DC.Render, A = DC.Art, T = DC.Tutorial;
  const S2 = A.SPEECH;
  assert(S2 && S2.W > 0 && S2.TEXT_W > 0 && S2.PROSE_ROWS > 0,
    'Art exports the speech-box geometry');
  assert(B.TUTOR && typeof B.tutor === 'function', 'Barks exports the induction pool');

  // Every beat has a pool, and the sign-offs do too. The sizes are the point of
  // the brief: ~60 authored lines so a second playthrough is not the same
  // script, and no beat so thin that one run exhausts it.
  const BEAT_POOLS = ['place', 'rotate', 'belt', 'ore'];
  for (const k of BEAT_POOLS) {
    assert(Array.isArray(B.TUTOR[k]) && B.TUTOR[k].length >= 10,
      'induction beat "' + k + '" has >= 10 lines (got ' +
      ((B.TUTOR[k] || []).length) + ')');
  }
  for (const k of ['nudge', 'outro', 'skip']) {
    assert(Array.isArray(B.TUTOR[k]) && B.TUTOR[k].length >= 4,
      'induction pool "' + k + '" has >= 4 lines');
  }
  for (const k of T.BEATS)
    assert(Array.isArray(B.TUTOR[k]), 'every beat js/tutorial.js runs has a pool: ' + k);
  TUTOR_N = tutorLines.length;
  assert(TUTOR_N >= 55, 'the induction is ~60 authored lines (got ' + TUTOR_N + ')');

  // --- the panel-wrap contract: nothing is ever cut mid-word ---
  for (const [tag, l] of tutorLines) {
    assertEq(typeof l, 'string', tag + ' is a string');
    const rows = R.wrapClamp(l, S2.TEXT_W, S2.PROSE_ROWS);
    assert(rows.length <= S2.PROSE_ROWS, tag + ': "' + l + '" needs ' + rows.length +
      ' rows, the box holds ' + S2.PROSE_ROWS);
    for (const ln of rows) {
      assert([...ln].length <= S2.TEXT_W, tag + ': row "' + ln + '" is ' +
        [...ln].length + ' > ' + S2.TEXT_W + ' columns');
      assert(ln.indexOf('…') < 0, tag + ': "' + l + '" would be truncated to "' + ln + '"');
    }
    const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).join(' ');
    assertEq(words(rows.join(' ')), words(l), tag + ': wrapping changed the words');
    if (l.length > TUTOR_WORST) TUTOR_WORST = l.length;
  }

  // --- THE BIT. He is reading somebody else's paper and cannot leave it alone.
  // Every beat pool has to carry the quoted-script half in a real share of its
  // lines, because that quote is the setup and the riff is the punchline: a
  // pool that stopped quoting would just be GRIT with a new subject.
  for (const k of BEAT_POOLS) {
    // a real script quote: a capitalised sentence in single quotes, not an
    // apostrophe pair that happened to fall the right distance apart
    const quoting = B.TUTOR[k].filter(l => /'[A-Z][^']{8,}[.!?]'/.test(l)).length;
    assert(quoting >= 4, 'induction beat "' + k + '" quotes the Company script in ' +
      quoting + ' lines — the flat line IS the setup');
    // ...and it is not ONLY that shape. A pool of thirteen script-riffs is one
    // joke told thirteen times; the brief asked for the whole range, mixed
    // deliberately, and the range is what makes a second playthrough different.
    assert(B.TUTOR[k].length - quoting >= 4,
      'induction beat "' + k + '" is ' + quoting + '/' + B.TUTOR[k].length +
      ' script-riffs — the register has collapsed to one shape');
  }
  // The dad jokes and the groaners are load-bearing (director, verbatim: "AND
  // CHILD JOKES! AND DAD JOKES!"). A setup-and-punchline joke has a shape a
  // lint can see, so the one thing that can be pinned about the comedy is
  // pinned: it may be rewritten, it may not be quietly sanded off.
  {
    const setups = BEAT_POOLS.reduce(function (n, k) {
      return n + B.TUTOR[k].filter(l => /^(Why|What|How) /.test(l)).length;
    }, 0);
    assert(setups >= 3, 'the induction has ' + setups +
      ' setup-and-punchline jokes in it; the brief asked for dad jokes');
  }

  // --- determinism (§0 law 7). The induction runs on a live run whose map,
  // schematic offers and quake schedule all come off run.rng. A line drawn
  // because the player was SLOW would move all three.
  {
    const a = S.newRun(defEffects(), 20260817);
    const b = S.newRun(defEffects(), 20260817);
    for (const k in B.TUTOR) {
      for (let salt = 0; salt < 5; salt++) {
        const line = B.tutor(a, k, salt);
        assert(typeof line === 'string' && line.length > 0,
          'Barks.tutor(' + k + ', ' + salt + ') returns a line');
        assertEq(B.tutor(b, k, salt), line, 'one seed and one beat pick one line');
      }
    }
    assertEq(a.rng(), b.rng(), 'the induction advanced run.rng');
    assertEq(B.tutor(a, 'nope', 0), null, 'an unknown beat is a silence, not a throw');
    // ...and restating really does move on rather than repeating itself
    const seen = new Set();
    for (let salt = 0; salt < B.TUTOR.place.length; salt++) seen.add(B.tutor(a, 'place', salt));
    assertEq(seen.size, B.TUTOR.place.length, 'restating walks the pool without repeats');
    // different seeds do not all open on the same joke
    const opens = new Set();
    for (let s = 1; s <= 40; s++) opens.add(B.tutor(S.newRun(defEffects(), s * 7717), 'place', 0));
    assert(opens.size >= 6, 'the opening line varies by seed (' + opens.size + ' of ' +
      B.TUTOR.place.length + ')');
  }

  // --- the ACTION rows are never a joke and never empty ---
  {
    const run = S.newRun(defEffects(), 4242);
    const meta = DC.Meta.newProfile();
    assert(T.begin(run, meta), 'the induction arms on a fresh profile');
    const caps = {};
    for (let i = 0; i < T.BEATS.length; i++) {
      run.tutorial.i = i;
      const act = T.action(run);
      assert(Array.isArray(act) && act.length, 'beat ' + T.BEATS[i] + ' has an action row');
      let w = 0, hasCap = false;
      for (const s of act) {
        w += s[0] === 'cap' ? s[1].length + 2 : s[1].length;
        if (s[0] === 'cap') { hasCap = true; caps[s[1]] = true; }
      }
      assert(w <= S2.TEXT_W, 'beat ' + T.BEATS[i] + ' action row is ' + w +
        ' cols, the box holds ' + S2.TEXT_W);
      // the last beat is a WATCH beat and has no key; the three that ask for a
      // keypress must draw that key
      if (T.BEATS[i] !== 'ore')
        assert(hasCap, 'beat ' + T.BEATS[i] + ' draws its key as a keycap');
      // the way out is on screen on every beat that is still asking for one
      const foot = T.foot(run);
      assert(foot.some(s => s[0] === 'cap' && s[1] === D.TUTORIAL.skipKey.toUpperCase()),
        'beat ' + T.BEATS[i] + ' shows the skip key');
    }
    // the keycaps name keys engine.js really binds, not keys the writing wished
    // for: the build digits come off D.BUILD_ORDER, so a reordering moves them
    assert(caps[String(D.BUILD_ORDER.indexOf('extractor') + 1)],
      'the place beat draws the extractor build key from D.BUILD_ORDER');
    assert(caps[String(D.BUILD_ORDER.indexOf('belt') + 1)],
      'the belt beat draws the belt build key from D.BUILD_ORDER');
    assert(caps.R, 'the rotate beat draws R');
  }
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

  // M-ONBOARD: the diagnostics are too long to survive the regex scrape above
  // (they are built from a table, not written inline at the msg() call), and
  // they are the longest prose the LOG ever carries — a cause that names itself
  // in a sentence the panel truncates would have re-created the original bug in
  // a new place. Sim.diagLines() is exactly the enumeration this needs.
  const diagLits = S.diagLines();
  for (const t of diagLits) checkWrap(t, LW, LR, 'LOG diagnostic');

  // M-EVENTS writes into the same LOG panel. The dead foremen are the tight
  // case — 70 columns of somebody else's handwriting has to survive three
  // rows of 29 — and events.js's own messages get the same treatment as
  // sim.js's, worst case filled in.
  for (const [, l] of logLines) checkWrap(l, LW, LR, 'LOG foreman entry');
  const evSrc = fs.readFileSync(path.join(__dirname, '../js/events.js'), 'utf8');
  const evLits = [];
  const evRe = /msg\(\s*run\s*,/g;
  let em;
  while ((em = evRe.exec(evSrc)) !== null) {
    const seg = evSrc.slice(em.index, em.index + 400);
    const cut = seg.indexOf(');');
    const body = cut > 0 ? seg.slice(0, cut) : seg;
    const litRe2 = /'((?:[^'\\]|\\.)*)'/g;
    let x2;
    while ((x2 = litRe2.exec(body)) !== null) {
      const s = x2[1].replace(/\\'/g, "'");
      if (s.length > 3) evLits.push(s);
    }
  }
  assert(evLits.length >= 6, 'found the static events.js log messages (' +
    evLits.length + ')');
  const longestItem = Object.keys(D.ITEMS)
    .map(k => D.ITEMS[k].name).sort((a, b) => b.length - a.length)[0];
  const evDyn = [
    'An ore pocket spills open — 10 ' + longestItem + '.',
    'A pre-collapse cache — 15 plates, still greased.',
    'Gas pocket — the air goes sour (+99 pressure).',
    'A dead rig, gutted. Salvage: +99 plates.',
  ];
  for (const t of evLits.concat(evDyn)) checkWrap(t, LW, LR, 'LOG event message');
  PROSE_N = allLines.length * 2 + lits.length + dyn.length +
            logLines.length + evLits.length + evDyn.length + diagLits.length +
            TUTOR_N;   // wrapped against the induction box, in 'onboard-tutor'
}

console.log('PASS barks | categories ' + CATALOG.length +
  ' | lines ' + allLines.length +
  ' | core ' + CORE_N + ' (' + B.CORE.intrusion.length + ' intrusions, ' +
  B.CORE.gate.length + ' gate beats, ' + B.CORE.reveal.length + ' reveal, ' +
  B.CORE.mantle.length + ' mantle)' +
  ' | graffiti ' + GRAFFITI_N +
  ' | logbook ' + logLines.length +
  ' | vignette lines ' + eventLines().length +
  ' | reviews ' + REVIEW_N + ' in ' + REVIEW_TIERS.length + ' tiers' +
  ' | drive triggers ' + trigs.size + ' (' + Array.from(trigs).sort().join(',') + ')' +
  ' | barks in drive ' + d1.lines.length +
  ' | worst line overlap ' + DUP_WORST.toFixed(2) + '/' + DUP_MAX.toFixed(2) +
  ' | manual ' + DC.Art.helpPages.length + 'pp ' + DC.Art.help[0].length + 'x' +
  DC.Art.help.length + ' data-composed, ' + MANUAL_COLORS + ' colours, ink ' +
  DC.Art.helpPages.map(p => (p.ink * 100).toFixed(0) + '%').join('/') +
  ' | scan lines ' + scanLines + ' <= ' + S.SCAN_W +
  ' | diagnostics ' + diagN + ' lines, ' + Object.keys(S.STATUS_HINT).length +
  " legends for '!', GRIT costs no rng" +
  ' | induction ' + TUTOR_N + ' lines, longest ' + TUTOR_WORST + ', box ' +
  DC.Art.SPEECH.PROSE_ROWS + 'x' + DC.Art.SPEECH.TEXT_W + ', costs no rng' +
  ' | stock labels ' + D.ITEM_ORDER.length + ' unambiguous' +
  ' | prose ' + PROSE_N + ' lines wrap whole (LOG ' + DC.Render.LOG_MSG_ROWS +
  'x' + DC.Render.SCAN_COL_W + ', bar 2x' + DC.Render.FOREMAN_ROW_W + ')');
