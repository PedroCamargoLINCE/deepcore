/* scratch: A/B a data.js tuning without editing the file.
   node tmp_probe/exp.js '<js mutating D>' [seeds...]
   (require cache means balance.js sees the mutated DATA)  */
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
