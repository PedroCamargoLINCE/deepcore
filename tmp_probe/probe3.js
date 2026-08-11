// Probe 3: victory -> continue -> death -> title -> foundry path, real handlers,
// render running every frame; fail if any frame paints 'RENDER ERROR'.
'use strict';
const path = require('path');
const R = (f) => require(path.join('/home/pedro/Documents/games/deepcore/js', f));
const handlers = {};
let drawn = [];
const ctxStub = {
  fillStyle: '', font: '', textBaseline: '', textAlign: '',
  setTransform() {}, fillRect() {}, save() {}, restore() {}, scale() {},
  fillText(s) { drawn.push(String(s)); }, measureText() { return { width: 10 }; },
};
const canvasStub = {
  style: {}, getContext: () => ctxStub,
  addEventListener: (t, fn) => { handlers[t] = fn; },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 627 }),
};
global.window = { addEventListener: (t, fn) => { handlers[t] = fn; } };
global.document = { getElementById: () => canvasStub };
global.location = { search: '?seed=1337' };
let rafCb = null;
global.requestAnimationFrame = (fn) => { rafCb = fn; };
R('data.js'); R('art.js'); R('barks.js'); R('map.js'); R('sim.js');
R('meta.js'); R('render.js'); R('engine.js');
const DC = global.window.DC, D = DC.DATA;
DC.Engine.start();
const st = DC.state;
let now = 0, errAt = null;
function frames(n, label) {
  for (let i = 0; i < n; i++) {
    now += 1000 / 60;
    drawn = [];
    const cb = rafCb; rafCb = null; cb(now);
    if (!errAt && drawn.some(s => s.indexOf('RENDER ERROR') >= 0)) {
      errAt = label + ' frame ' + i + ': ' + drawn.find(s => s.indexOf('RENDER ERROR') >= 0);
    }
  }
}
function key(k) { handlers.keydown({ key: k, preventDefault() {} }); }

key('Enter'); frames(3, 'run');
// force the win condition: stratum 8, breach ready
const run = st.run;
run.depth = 8; run.breaches = 7;
run.status = 'breachReady';
key('d');
console.log('screen after D at stratum 8:', st.screen, 'result:', JSON.stringify(run.result));
frames(5, 'victory');
key('c');
console.log('screen after C:', st.screen, 'pendingOffers:', run.pendingOffers && run.pendingOffers.length,
  'status:', run.status, 'mantle:', run.mantle);
frames(200, 'descend-anim');           // play out the whole descent animation
console.log('descendAnim:', st.ui.descendAnim, 'cards published:', DC.Render.layout.cards.length);
key('1');
console.log('screen after pick:', st.screen, 'depth:', run.depth, 'status:', run.status);
frames(5, 'mantle-run');
// die in the mantle via abandon (pause -> A)
key('Escape'); key('a');
console.log('screen after abandon:', st.screen, 'result.cores:', run.result && run.result.cores,
  'meta cores:', st.meta.cores, 'wins:', st.meta.wins, 'runs:', st.meta.runs);
frames(5, 'gameover');
key('Enter');
console.log('screen:', st.screen, 'run:', st.run);
frames(3, 'title');
key('f');
frames(3, 'foundry');
console.log('screen:', st.screen);
// buy an upgrade to exercise flashPart render path
st.meta.cores = 50;
key('a');
console.log('flashPart:', JSON.stringify(st.ui.flashPart));
frames(80, 'foundry-flash');
console.log('RENDER ERROR seen:', errAt || 'none');
