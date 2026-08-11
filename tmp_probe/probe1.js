// Probe: browser-runtime input defects in engine.js/render.js (stub DOM).
'use strict';
const path = require('path');
const R = (f) => require(path.join('/home/pedro/Documents/games/deepcore/js', f));

const handlers = {};
const drawn = [];
const ctxStub = {
  fillStyle: '', font: '', textBaseline: '', textAlign: '',
  setTransform() {}, fillRect() {}, save() {}, restore() {}, scale() {},
  fillText(s) { drawn.push(String(s)); },
  measureText() { return { width: 10 }; },
};
const canvasStub = {
  style: {},
  getContext: () => ctxStub,
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
const DC = global.window.DC || global.DC, D = DC.DATA;

DC.Engine.start();
const st = DC.state;
let now = 0;
function frames(n) {
  for (let i = 0; i < n; i++) {
    now += 1000 / D.TICK_HZ;
    const cb = rafCb; rafCb = null; cb(now);
  }
}
function key(k, opts) {
  opts = opts || {};
  let pd = false;
  handlers.keydown({
    key: k, shiftKey: !!opts.shift, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta,
    altKey: !!opts.alt, repeat: !!opts.repeat, preventDefault() { pd = true; },
  });
  return pd;
}

console.log('--- P1: held Enter across title->run transition (auto-repeat) ---');
key('Enter');                       // starts run, cursor lands on hub center
console.log('screen after Enter #1:', st.screen, 'overdrive:', st.run.overdrive);
const pd1 = key('Enter', { repeat: true }); // browser auto-repeat of the SAME hold
console.log('after repeated Enter: overdrive =', st.run.overdrive, '(preventDefault:', pd1 + ')');

console.log('--- P2: modified keys leak into game actions ---');
const f0 = st.ui.facing;
const pdR = key('r', { ctrl: true });      // Ctrl+R = browser reload
console.log('Ctrl+R: facing', f0, '->', st.ui.facing, 'preventDefault:', pdR);
const od0 = st.run.overdrive;
const pdC = key('c', { ctrl: true });      // Ctrl+C
console.log('Ctrl+C: overdrive', od0, '->', st.run.overdrive, 'preventDefault:', pdC);

console.log('--- P3: Space auto-repeat toggles pause every event ---');
key(' '); const pA = st.ui.paused;
key(' ', { repeat: true }); const pB = st.ui.paused;
key(' ', { repeat: true }); const pC = st.ui.paused;
console.log('pause states across held Space:', pA, pB, pC);
st.ui.paused = false;

console.log('--- P4: sidebarClick has no column guard (map border rows) ---');
frames(3); // let render publish layout.buildRows
const rows = DC.Render.layout.buildRows.map(r => r.row);
console.log('buildRows grid rows:', JSON.stringify(rows));
st.ui.tool = null;
// click on the map box RIGHT BORDER (grid col 47 -> px 475) at a build row height
const rowPx = rows[1] * 19 + 9;
handlers.mousemove({ clientX: 475, clientY: rowPx });
handlers.mousedown({ clientX: 475, clientY: rowPx });
console.log('click on map border col 47 at build-row height selects tool:', st.ui.tool);
st.ui.tool = null;
// click on LEFT border col 0
handlers.mousedown({ clientX: 5, clientY: rows[2] * 19 + 9 });
console.log('click on map border col 0 selects tool:', st.ui.tool);
st.ui.tool = null;

console.log('--- P5: ghost drag after focus loss (no e.buttons check) ---');
st.ui.tool = 'belt';
const hub = st.run.hub;
const tx = hub.x - 3, ty = hub.y;
function pxOf(x, y) { return { clientX: (D.MAP_X + x) * 10 + 5, clientY: (D.MAP_Y + y) * 19 + 9 }; }
handlers.mousemove(pxOf(tx, ty));
handlers.mousedown(pxOf(tx, ty));
console.log('dragging after mousedown:', st.ui.dragging);
// user alt-tabs, releases the button in another window (pointer never left canvas),
// returns, moves mouse: mousemove with buttons=0
const beltsBefore = Object.keys(st.run.machines).length;
handlers.mousemove(Object.assign(pxOf(tx, ty - 1), { buttons: 0 }));
handlers.mousemove(Object.assign(pxOf(tx, ty - 2), { buttons: 0 }));
const beltsAfter = Object.keys(st.run.machines).length;
console.log('machines placed by button-less mousemove:', beltsAfter - beltsBefore,
  '(dragging still:', st.ui.dragging + ')');
handlers.mouseup({});

console.log('--- P6: layout.cards persists across screens (stale hit-test data) ---');
console.log('cards on run screen right now:', DC.Render.layout.cards.length);
console.log('done');
