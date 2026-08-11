/* DEEPCORE — test/rig_test.js
   Permanent checks for the v1.1 rig portrait + schematic art (SPEC2 §C, §G):
   rigBase geometry, rigParts coverage/disjointness, composeRig identity and
   bounds, schematic icon/badge/color coverage, and no backslash/backtick in
   any art line. Node-only, DOM-free. */
'use strict';

require('../js/data.js');
require('../js/art.js');
const DC = globalThis.DC;
const D = DC.DATA;
const A = DC.Art;

let checks = 0;
function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}
function assert(cond, msg) { checks++; if (!cond) fail(msg); }

const RW = 24, RH = 12;
const IW = 10, IH = 5;

// ------------------------------------------------------------ rigBase 24x12
assert(Array.isArray(A.rigBase), 'rigBase must be an array');
assert(A.rigBase.length === RH, 'rigBase must be ' + RH + ' tall (got ' + A.rigBase.length + ')');
for (let i = 0; i < A.rigBase.length; i++) {
  assert(typeof A.rigBase[i] === 'string' && A.rigBase[i].length === RW,
    'rigBase row ' + i + ' must be ' + RW + ' wide (got ' + A.rigBase[i].length + ')');
}

// ------------------------------------------- rigParts: one per meta upgrade
assert(A.rigParts && typeof A.rigParts === 'object', 'rigParts must exist');
const metaIds = D.META_UPGRADES.map(function (u) { return u.id; });
assert(metaIds.length === 9, 'expected 9 meta upgrade ids in data.js');
for (const id of metaIds) {
  const p = A.rigParts[id];
  assert(p, 'rigParts missing overlay for ' + id);
  assert(Number.isInteger(p.row) && Number.isInteger(p.col) && Array.isArray(p.lines),
    id + ' overlay must be {row, col, lines}');
  assert(p.row >= 0 && p.row + p.lines.length <= RH, id + ' overlay overflows vertically');
  for (const ln of p.lines) {
    assert(typeof ln === 'string', id + ' overlay lines must be strings');
    assert(p.col >= 0 && p.col + ln.length <= RW, id + ' overlay overflows horizontally');
  }
}
for (const id in A.rigParts) {
  assert(metaIds.indexOf(id) !== -1, 'rigParts has unknown upgrade id ' + id);
}

// absolute non-space cells of one part
function cellsOf(id) {
  const p = A.rigParts[id];
  const cells = [];
  for (let i = 0; i < p.lines.length; i++) {
    for (let j = 0; j < p.lines[i].length; j++) {
      if (p.lines[i][j] !== ' ') cells.push([p.row + i, p.col + j]);
    }
  }
  return cells;
}

// no two parts overwrite each other's cells (composition is order-free)
const owner = {};
for (const id of metaIds) {
  for (const c of cellsOf(id)) {
    const k = c[0] + ',' + c[1];
    assert(!owner[k], 'parts ' + owner[k] + ' and ' + id + ' both write cell (' + k + ')');
    owner[k] = id;
  }
}

// ------------------------------------------------------------- composeRig
function diffCells(a, b) {
  let n = 0;
  for (let r = 0; r < RH; r++) {
    for (let c = 0; c < RW; c++) if (a[r][c] !== b[r][c]) n++;
  }
  return n;
}

// no upgrades -> exactly the base
for (const bare of [undefined, {}, { m_hull: 0 }]) {
  const out = A.composeRig(bare);
  assert(Array.isArray(out) && out.length === RH, 'composeRig(no upgrades) must be ' + RH + ' lines');
  assert(out.join('\n') === A.rigBase.join('\n'),
    'composeRig(' + JSON.stringify(bare) + ') must equal rigBase');
}

// all 9 at max level -> still exactly 24x12, and rigBase untouched
const allMax = {};
for (const u of D.META_UPGRADES) allMax[u.id] = u.max;
const full = A.composeRig(allMax);
assert(full.length === RH, 'composeRig(all max) must stay ' + RH + ' tall');
for (let i = 0; i < full.length; i++) {
  assert(typeof full[i] === 'string' && full[i].length === RW,
    'composeRig(all max) row ' + i + ' must stay ' + RW + ' wide');
}
assert(diffCells(full, A.rigBase) > 0, 'composeRig(all max) must differ from rigBase');
assert(A.rigBase.length === RH && A.rigBase.every(function (l) { return l.length === RW; }),
  'composeRig must not mutate rigBase');

// every part alone alters >= 2 cells vs base — buying it changes the picture
for (const id of metaIds) {
  const one = {}; one[id] = 1;
  const n = diffCells(A.composeRig(one), A.rigBase);
  assert(n >= 2, 'part ' + id + ' alters only ' + n + ' cell(s) vs base (need >= 2)');
}

// -------------------------------- schematic icons / badges / colors (all 14)
const schemIds = D.SCHEMATICS.map(function (s) { return s.id; });
assert(schemIds.length === 14, 'expected 14 schematic ids in data.js');
for (const id of schemIds) {
  const ic = A.schemIcons && A.schemIcons[id];
  assert(Array.isArray(ic), 'schemIcons missing ' + id);
  assert(ic.length === IH, id + ' icon must be ' + IH + ' tall (got ' + ic.length + ')');
  for (let i = 0; i < ic.length; i++) {
    assert(typeof ic[i] === 'string' && ic[i].length === IW,
      id + ' icon row ' + i + ' must be ' + IW + ' wide (got ' + ic[i].length + ')');
  }
  const b = A.schemBadges && A.schemBadges[id];
  assert(typeof b === 'string' && b.length === 2,
    id + ' badge must be exactly 2 chars (got ' + JSON.stringify(b) + ')');
  const col = A.schemColors && A.schemColors[id];
  assert(typeof col === 'string' && Object.prototype.hasOwnProperty.call(D.COLORS, col),
    id + ' color ' + JSON.stringify(col) + ' is not a DC.DATA.COLORS key');
}

// --------------------------- no backslash / backtick in any art line at all
(function () {
  const seen = new Set();
  function walk(name, v) {
    if (v == null || seen.has(v)) return;
    if (typeof v === 'string') {
      checks++;
      if (v.indexOf('\\') !== -1 || v.indexOf('`') !== -1) {
        fail('art line in "' + name + '" contains backslash or backtick: ' + v);
      }
      return;
    }
    if (typeof v !== 'object') return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const el of v) walk(name, el);
    } else {
      for (const k in v) walk(name + '.' + k, v[k]);
    }
  }
  for (const k in A) if (typeof A[k] !== 'function') walk(k, A[k]);
})();

console.log('rig_test OK — ' + checks + ' checks passed');
