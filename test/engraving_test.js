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
    addEventListener(){},getBoundingClientRect(){return {left:0,top:0,width:1600,height:1600*627/1120};}};
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
  ...D.SCHEMATICS.map(s=>['schematic',{id:s.id}])];
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
const cell=DC.Render.pxToCell(500,300);
DC.Render.setArtMode('classic');DC.Render.frame(DC.state,500);
assert.deepStrictEqual(DC.Render.pxToCell(500,300),cell,'mode switch leaves hit testing unchanged');
const classicGrid=[];
for(let y=0;y<D.ROWS;y++)for(let x=0;x<D.COLS;x++)classicGrid.push(DC.Render.cellAt(x,y).ch);
delete DC.Engraving;DC.Render.frame(DC.state,500);
const fallbackGrid=[];
for(let y=0;y<D.ROWS;y++)for(let x=0;x<D.COLS;x++)fallbackGrid.push(DC.Render.cellAt(x,y).ch);
assert.deepStrictEqual(fallbackGrid,classicGrid,'missing art module falls back to the classic game');
DC.Engraving=E;run.rng=rng;DC.Render.setArtMode('engraved');
for(const viewport of [[800,600],[1600,1000],[2560,1440],[8000,4500]]) {
  for(const ratio of [1,2]) {
    env.devicePixelRatio=ratio;DC.Render.resize(...viewport);DC.Render.frame(DC.state,550);
    assert(DC.Render.illustrationStats().cached<=28,'bounded illustration cache across resizes');
    assert(DC.Render.illustrationStats().pixels<=12000000,'pixel budget holds even when one plate is enormous');
  }
}
assert.deepStrictEqual(errors,[],'new rendering path has no hidden errors');
assert(!storage.has(D.SAVE_KEY),'visual mode never overwrites the player save');
env.localStorage.getItem=()=>{throw Error('storage denied');};
env.location.search='?art=classic';
DC.Render.init(screen);
assert.strictEqual(DC.Render.artMode(),'classic','URL override works even when storage is denied');
console.log('PASS engraving | '+scenes.length+' illustrations | all 9 upgrades | 20 unique encounters | ASCII only | real renderer + V key | cached canvases | classic fallback | unchanged RNG/state/hit testing | '+textCalls+' recorded text draws');
