/* New visual edition: actual browser module order, a recording canvas, and
   pure illustration checks. Run with node test/engraving_test.js. */
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const listeners={},storage=new Map();
let blits=0,canvases=0,textCalls=0;
const errors=[];
function context() {
  return {
    font:'16px monospace',fillStyle:'#ffffff',
    setTransform(){},fillRect(){},clearRect(){},save(){},restore(){},scale(){},
    translate(){},beginPath(){},rect(){},clip(){},strokeRect(){},
    moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},ellipse(){},
    fillText(s){textCalls++;if(String(s).includes('RENDER ERROR'))errors.push(s);},
    measureText(s){return {width:String(s).length*(parseFloat(this.font)||16)*.602};},
    drawImage(){blits++;},
    getImageData(){return {data:new Uint8ClampedArray(4096)};},
  };
}
function canvas() {
  canvases++;
  const ctx=context();
  return {width:1120,height:627,style:{},dataset:{},getContext(){return ctx;},
    addEventListener(k,fn){listeners[k]=fn;},getBoundingClientRect(){return {left:0,top:0,width:1600,height:1600*627/1120};}};
}
const screen=canvas(),frame={dataset:{}};
const env={console,URLSearchParams,Uint8ClampedArray,
  innerWidth:1600,innerHeight:1000,devicePixelRatio:1,location:{search:''},
  localStorage:{getItem(k){return storage.get(k)||null;},setItem(k,v){storage.set(k,String(v));},removeItem(k){storage.delete(k);}},
  addEventListener(k,fn){listeners[k]=fn;},requestAnimationFrame(){return 1;},
  setTimeout(){return 1;},clearTimeout(){},performance:{now(){return 0;}},
  document:{getElementById(id){return id==='screen'?screen:frame;},createElement(){return canvas();},
    documentElement:{style:{setProperty(){}}}},
};
env.window=env;
vm.createContext(env);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const files=Array.from(html.matchAll(/<script src="(js\/[a-z]+\.js)"><\/script>/g),m=>m[1]);
assert(files.includes('js/engraving.js'),'browser includes the new art module');
for(const file of files)if(file!=='js/main.js')vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),env,{filename:file});
const DC=env.DC,D=DC.DATA,E=DC.Engraving;
const serial=p=>p.rows.join('\n')+'|'+Array.from(p.tones).join(',');
const base=E.create('rig',96,48,{});
assert.strictEqual(serial(base),serial(E.create('rig',96,48,{})),'pure deterministic rig');
for(const [w,h] of [[52,24],[58,24],[78,36],[87,36],[96,48],[189,51]]) {
  const plain=E.create('rig',w,h,{});
  for(const up of D.META_UPGRADES) {
    const changed=E.create('rig',w,h,{upgrades:{[up.id]:1}});
    let cells=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      if(plain.rows[y][x]!==changed.rows[y][x] || plain.tones[y*w+x]!==changed.tones[y*w+x])cells++;
    }
    assert(cells>=2,up.id+' visibly changes at least two cells at '+w+'x'+h+' (got '+cells+')');
  }
}
assert.notStrictEqual(serial(E.create('rig',96,48,{active:true,phase:0})),
  serial(E.create('rig',96,48,{active:true,phase:1})),'actual drill feed changes the bit and exhaust');
assert.notStrictEqual(serial(E.create('grit',90,60,{})),
  serial(E.create('grit',90,60,{talking:true})),'GRIT has an actual speech pose');
const scenes=[['grit',{}],['rig',{}],['core',{}],['core',{cracked:true}],['descent',{phase:1}],
  ...E.ENCOUNTERS.map(id=>['encounter',{id}]),
  ...D.SCHEMATICS.map(s=>['schematic',{id:s.id}]),
  ...D.TROPHIES.map(s=>['trophy',{id:s.id}]),
  ...D.CONTRACTS.map(s=>['seal',{id:s.id}]),
  ...D.BUILD_ORDER.map(id=>['machine',{id}]),
  ...['forge','pause','accounts','archive','bore','manual1','manual2','manual3'].map(id=>['station',{id}])];
const encounterHashes=new Set();
for(const [kind,options] of scenes) {
  const art=E.create(kind,96,48,options);
  assert.strictEqual(art.rows.length,48);
  assert(art.rows.every(s=>s.length===96 && /^[\x20-\x7e]*$/.test(s)),kind+' uses printable ASCII only');
  assert(art.tones.every(t=>t>=0 && t<48),'bounded palette');
  assert(art.rows.join('').replace(/ /g,'').length>80,'nonempty illustration');
  if(kind==='encounter')encounterHashes.add(serial(art));
}
assert.strictEqual(encounterHashes.size,20,'all twenty encounters have distinct authored scenes');
assert.strictEqual(E.palette('#abcdef').length,48);
assert.notDeepStrictEqual(E.tile('rock',0,0),E.tile('obsidian',0,0),'glass is distinct from rock');
assert.notStrictEqual(serial(E.create('trophy',42,12,{id:'cat'})),serial(E.create('trophy',42,12,{id:'cat',locked:true})),'unearned trophies stay under dust');
assert.notStrictEqual(serial(E.create('station',33,66,{id:'archive'})),serial(E.create('station',33,66,{id:'archive',found:[0,3,19]})),'archive tabs reflect actual discoveries');
assert.notStrictEqual(serial(E.create('machine',87,33,{id:'assembler',active:true,phase:0})),serial(E.create('machine',87,33,{id:'assembler',active:true,phase:1})),'machine works only from production state');
assert.strictEqual(serial(E.create('machine',87,33,{id:'assembler',phase:0})),serial(E.create('machine',87,33,{id:'assembler',phase:1})),'idle machine has no fake work animation');
assert.strictEqual(new Set(D.BUILD_ORDER.map(id=>serial(E.create('machine',87,33,{id})))).size,D.BUILD_ORDER.length,'all ten machine cutaways have distinct silhouettes');
assert.notStrictEqual(serial(base),serial(E.create('rig',96,48,{quake:true})),'current quake sparks change the rig');
const iconShapes=[];
for(const id of [...D.ITEM_ORDER,...D.BUILD_ORDER,...D.META_UPGRADES.map(u=>u.id)]) {
  assert(DC.Strata.ICONS.includes(id),'authored vector icon exists: '+id);
  const ops=[],ctx=context();
  for(const name of ['fillRect','moveTo','lineTo','ellipse'])ctx[name]=(...args)=>{
    assert(args.every(n=>typeof n==='number'&&Number.isFinite(n)),'finite icon geometry');ops.push([name,...args]);
  };
  DC.Strata.icon(ctx,id,0,0,42,24,'#abcdef');
  assert(ops.length>=4,'real geometry, not a missing-icon fallback: '+id);
  iconShapes.push(JSON.stringify(ops));
}
assert(new Set(iconShapes).size>=22,'icon family has distinct silhouettes even before colour');

DC.Engine.start();
assert.strictEqual(DC.Render.artMode(),'engraved','new edition is the default');
DC.Render.frame(DC.state,0);
assert.strictEqual(DC.Render.illustrationStats().regions,2,'title shows GRIT and the rig');
assert(blits>=2,'fine ASCII actually reaches the display canvas');
const firstCanvases=canvases;
for(let i=1;i<20;i++)DC.Render.frame(DC.state,i*17);
assert.strictEqual(canvases,firstCanvases,'steady art reuses cached surfaces');
const press=key=>listeners.keydown({key,repeat:false,ctrlKey:false,altKey:false,metaKey:false,preventDefault(){}});
press('v');assert.strictEqual(DC.Render.artMode(),'classic');
listeners.keydown({key:'v',repeat:true,preventDefault(){}});
assert.strictEqual(DC.Render.artMode(),'classic','held V does not flash the edition');
listeners.keydown({key:'v',ctrlKey:true,preventDefault(){}});
assert.strictEqual(DC.Render.artMode(),'classic','paste shortcut does not toggle visuals');
assert.strictEqual(storage.get('deepcore_visual_v1'),'classic');
DC.Render.frame(DC.state,400);
assert.strictEqual(DC.Render.illustrationStats().regions,0,'classic has no fine-art overlays');
press('v');assert.strictEqual(DC.Render.artMode(),'engraved');
const profile=DC.Meta.newProfile(),run=DC.Sim.newRun(DC.Meta.effects(profile),1337);
run.grid.flat().forEach(t=>{t.revealed=true;});
DC.state.meta=profile;DC.state.run=run;DC.state.screen='run';
const before=JSON.stringify(run),metaBefore=JSON.stringify(profile);
const rng=run.rng;run.rng=()=>{throw Error('renderer spent simulation RNG');};
DC.Render.frame(DC.state,450);
assert.strictEqual(DC.Render.illustrationStats().regions,1,'in-run rig is engraved');
assert.strictEqual(JSON.stringify(run),before,'render never changes gameplay state');
assert.strictEqual(JSON.stringify(profile),metaBefore,'art preference is not a meta/save migration');
// Hybrid geometry only receives revealed cells; it never sees hidden ore.
const paint=DC.Strata.paint;let visibleTiles=null;
DC.Strata.paint=(ctx,tiles,w,h)=>{visibleTiles=JSON.parse(JSON.stringify(tiles));paint(ctx,tiles,w,h);};
run.grid[0][0].revealed=false;DC.Render.frame(DC.state,451);
assert(visibleTiles && visibleTiles.length===D.MAP_W*D.MAP_H-1);
assert(!visibleTiles.some(t=>t.x===0&&t.y===0),'hidden cell withheld from hybrid layer');
DC.Strata.paint=paint;run.grid[0][0].revealed=true;
const afterFog=JSON.stringify(run);
for(const screenName of ['contract','foundry','trophies','ledger','logbook','help','recap']) {
  DC.state.screen=screenName;DC.Render.frame(DC.state,452);
  assert(DC.Render.illustrationStats().regions>0,screenName+' has an Engraved treatment');
  assert.strictEqual(JSON.stringify(run),afterFog,screenName+' cannot mutate the run');
  assert.strictEqual(JSON.stringify(profile),metaBefore,screenName+' cannot mutate the profile');
}
for(let page=0;page<3;page++){DC.state.screen='help';DC.state.ui.helpPage=page;DC.Render.frame(DC.state,453);}
DC.state.screen='run';DC.state.ui.paused=true;DC.Render.frame(DC.state,454);
assert.strictEqual(DC.Render.illustrationStats().regions,2,'pause badge composited above its opaque panel');
DC.state.ui.paused=false;
DC.state.ui.tool='crusher';DC.Render.frame(DC.state,454);
assert(DC.Render.illustrationStats().subjects.includes('machine:crusher'),'build selection opens its cutaway');
DC.state.ui.tool=null;
const cell=DC.Render.pxToCell(500,300);
DC.Render.setArtMode('classic');DC.Render.frame(DC.state,500);
assert.deepStrictEqual(DC.Render.pxToCell(500,300),cell,'mode switch leaves hit testing unchanged');
const classicGrid=[];
for(let y=0;y<D.ROWS;y++)for(let x=0;x<D.COLS;x++)classicGrid.push(DC.Render.cellAt(x,y).ch);
delete DC.Engraving;DC.Render.frame(DC.state,500);
const fallbackGrid=[];
for(let y=0;y<D.ROWS;y++)for(let x=0;x<D.COLS;x++)fallbackGrid.push(DC.Render.cellAt(x,y).ch);
assert.deepStrictEqual(fallbackGrid,classicGrid,'missing art module falls back to the classic game');
for(const screenName of ['contract','foundry','trophies','ledger','logbook','help','recap']) {
  DC.Engraving=E;DC.state.screen=screenName;DC.Render.frame(DC.state,500);
  // The module-enabled manual intentionally advertises V in its blank row;
  // the standalone port cannot switch, so it omits only that capability hint.
  const snap=()=>Array.from({length:D.ROWS},(_,y)=>Array.from({length:D.COLS},(_,x)=>screenName==='help'&&y===3?null:DC.Render.cellAt(x,y)));
  const classic=snap();delete DC.Engraving;DC.Render.frame(DC.state,500);
  assert(JSON.stringify(snap())===JSON.stringify(classic),screenName+' Classic equals the module-free renderer');
}
DC.state.screen='run';
DC.Engraving=E;run.rng=rng;DC.Render.setArtMode('engraved');
for(const viewport of [[800,600],[1600,1000],[2560,1440],[8000,4500]]) {
  for(const ratio of [1,2]) {
    env.devicePixelRatio=ratio;DC.Render.resize(...viewport);DC.Render.frame(DC.state,550);
    assert(DC.Render.illustrationStats().cached<=28,'bounded illustration cache across resizes');
    assert(DC.Render.illustrationStats().pixels<=12000000,'pixel budget holds even when one plate is enormous');
    assert(DC.Render.illustrationStats().terrainPixels<=12000000,'terrain surface has its own pixel budget');
  }
}
assert.deepStrictEqual(errors,[],'new rendering path has no hidden errors');
assert(!storage.has(D.SAVE_KEY),'visual mode never overwrites the player save');
// Real input uses the Engraved contract's new published geometry.
DC.state.screen='contract';DC.state.ui.contractCursor=0;DC.Render.frame(DC.state,600);
const contract=DC.Render.layout.contracts[0];
assert.strictEqual(contract.h,20,'Engraved contract includes its illustrated seal');
listeners.mousedown({clientX:(contract.col+3)*1600/D.COLS,clientY:(contract.row+3)*(1600*627/1120)/D.ROWS,button:0,preventDefault(){}});
assert.strictEqual(DC.state.screen,'run','click on the illustrated paper signs the contract');
env.localStorage.getItem=()=>{throw Error('storage denied');};
env.location.search='?art=classic';
DC.Render.init(screen);
assert.strictEqual(DC.Render.artMode(),'classic','URL override works even when storage is denied');
console.log('PASS engraving | '+scenes.length+' ASCII illustrations | all 9 upgrades | 20 unique encounters | hybrid terrain + vector icons | real V key + contract click | cached canvases | Classic fallback | unchanged RNG/state/hit testing | '+textCalls+' recorded text draws');
