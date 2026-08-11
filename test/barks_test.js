/* DEEPCORE — test/barks_test.js
   Node acceptance test for js/barks.js (SPEC2 §A + §G). Permanent.
   Asserts: DOM-free load; every catalog trigger id has a pool (4-8 lines);
   bespoke lines for every schematic id, meta upgrade id, and stratum 1-8 +
   mantle; ≥120 lines total, all ≤70 chars; determinism (same seed = same
   lines); a scripted drive fires ≥6 distinct triggers with no line reuse;
   foreman set/expiry; priority cut-in + cooldown; pool-exhaust reuse;
   cause-aware epitaphs; victory toast; log mirroring.
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

console.log('PASS barks | categories ' + CATALOG.length +
  ' | lines ' + allLines.length +
  ' | drive triggers ' + trigs.size + ' (' + Array.from(trigs).sort().join(',') + ')' +
  ' | barks in drive ' + d1.lines.length);
