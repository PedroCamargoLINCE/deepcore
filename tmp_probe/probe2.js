// Probe 2: ghost-drag after focus loss, on guaranteed-floor cells.
'use strict';
const path = require('path');
const R = (f) => require(path.join('/home/pedro/Documents/games/deepcore/js', f));
const handlers = {};
const ctxStub = {
  fillStyle: '', font: '', textBaseline: '', textAlign: '',
  setTransform() {}, fillRect() {}, save() {}, restore() {}, scale() {},
  fillText() {}, measureText() { return { width: 10 }; },
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
handlers.keydown({ key: 'Enter', preventDefault() {} });
const run = st.run, hub = run.hub;
// force a guaranteed lane of floor below the hub
for (let y = hub.y + 3; y <= hub.y + 6; y++) {
  const t = run.grid[y][hub.x];
  t.t = 'floor'; t.ore = null; t.rubble = false; t.digT = 0; t.revealed = true;
}
run.inv.ironPlate = 50;
st.ui.tool = 'belt';
function pxOf(x, y) { return { clientX: (D.MAP_X + x) * 10 + 5, clientY: (D.MAP_Y + y) * 19 + 9 }; }
const x = hub.x, y0 = hub.y + 3;
handlers.mousemove(pxOf(x, y0));
handlers.mousedown(pxOf(x, y0));
const count0 = Object.keys(run.machines).length;
console.log('belt placed on mousedown:', !!run.grid[y0][x].belt, 'dragging:', st.ui.dragging);
// Alt-tab: button released in another window; pointer returns over canvas, buttons=0
handlers.mousemove(Object.assign(pxOf(x, y0 + 1), { buttons: 0 }));
handlers.mousemove(Object.assign(pxOf(x, y0 + 2), { buttons: 0 }));
const placedGhost = Object.keys(run.machines).length - count0;
console.log('belts laid by button-less mousemove after focus loss:', placedGhost,
  '| dragging still:', st.ui.dragging);
