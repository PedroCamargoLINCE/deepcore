/* A/B a data.js tuning against the balance sweep WITHOUT editing data.js.
   Loads DATA, applies your patch to it in memory, then runs test/balance.js —
   the require cache means the sweep sees the mutated DATA.

     node tools/ab.js '<js mutating D>' [seeds...]

   Examples:
     node tools/ab.js 'D.RECIPES.gear.ticks = 18'
     node tools/ab.js 'D.QUAKE.startInst = 30' 1337 777 42
     DC_BAL_META=m_hull:2 node tools/ab.js 'D.STRATA[2].instRate *= 0.8'

   Every env knob test/balance.js reads still applies (DC_BAL_META,
   DC_BAL_BUDGET, DC_BAL_POLICIES, DC_BAL_CAPMIN). Read that file's footer
   first — it says which SPEC 12 target is checked on which loadout, and
   warns which failures are the bot's ceiling rather than the game's. */
'use strict';
require('../js/data.js');
const D = globalThis.DC.DATA;
const patch = process.argv[2] || '';
process.argv = [process.argv[0], process.argv[1]].concat(process.argv.slice(3));
if (patch) {
  // eslint-disable-next-line no-new-func
  new Function('D', patch)(D);
  console.log('PATCH: ' + patch);
}
require('../test/balance.js');
