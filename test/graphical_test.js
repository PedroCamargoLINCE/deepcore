/* Bedrock contract: pixel art, deterministic views, complete asset
   coverage, redacted fog, safe profiles and independent offline editions. */
'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('graphical.html'),files=Array.from(html.matchAll(/<script src="(js\/[a-z]+\.js)"><\/script>/g),m=>m[1]);
const env={console,URLSearchParams};vm.createContext(env);
for(const f of files)if(f!=='js/main.js')vm.runInContext(read(f),env,{filename:f});
const DC=env.DC,D=DC.DATA,A=DC.Atelier,R=DC.Render;
const PX=DC.Pixels;
assert(PX,'authored pixel module loaded by the real entry');
assert(!/Math\.random|Date\.now|\.rng\(|fillText|strokeText/.test(read('js/pixels.js')),'pixel art is independent of clocks, fonts and RNG');
for(const [id,rows] of Object.entries(PX.ART)){
  assert(rows.length>=16&&rows.length<=32,id+' has an intentional native pitch');
  for(const row of rows)for(const ch of row)assert(ch==='.'||PX.PAL[ch],id+' has a known palette index: '+JSON.stringify(ch));
}
for(const id of [...D.ITEM_ORDER,...D.BUILD_ORDER,'rig','grit','seal','shield','skull'])assert(PX.ART[id],id+' has original authored clusters');
for(const name of ['rig','grit']){
  const png=fs.readFileSync(path.join(root,'assets/bedrock/'+name+'-pixel.png'));
  assert.strictEqual(png.subarray(1,4).toString(),'PNG');
  assert.strictEqual(png[25],6,name+' preserves RGBA transparency');
  assert(png.readUInt32BE(16)>=256&&png.readUInt32BE(20)>=256,name+' source retained at high resolution');
}
assert.strictEqual(R.artMode(),'bedrock');
for(const f of ['js/render.js','js/engraving.js','js/strata.js','js/fx.js'])assert(!files.includes(f),'graphical entry excludes '+f);
assert(!/fillText|strokeText|Math\.random|Date\.now|\.rng\(/.test(read('js/atelier.js')),'art engine cannot draw characters or roll a random stream');
assert(!/fillText|strokeText|Math\.random|Date\.now/.test(read('js/graphical.js')),'graphical renderer has no character-grid path or ambient clock');
function recorder(){
  const calls=[];
  const methods=['fillRect','clearRect','beginPath','moveTo','lineTo','closePath','fill','stroke','ellipse','save','restore','translate','rotate','scale','setTransform','rect','clip','strokeRect','drawImage'];
  const c={calls};for(const method of methods)c[method]=(...args)=>{for(const n of args)if(typeof n==='number')assert(Number.isFinite(n),method+' has finite geometry');calls.push([method,...args]);};
  for(const key of ['fillStyle','strokeStyle','lineWidth','lineCap','lineJoin'])Object.defineProperty(c,key,{set(v){if(key.endsWith('Style'))assert(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v),'valid colour '+v);calls.push([key,v]);}});
  c.fillText=()=>{throw new Error('ASCII fallback forbidden');};return c;
}
const serial=(id,o)=>{const c=recorder();A.sprite(c,id,0,0,80,80,o||{});return JSON.stringify(c.calls);};
const ids=[...D.ITEM_ORDER,...D.BUILD_ORDER,'hub','demolish',...D.META_UPGRADES.map(u=>u.id),...D.SCHEMATICS.map(s=>s.id),...D.LANDMARKS.map(l=>l.id),'grit','cat','worm','toad','sound','muted','pause','rotate','inspect','down','trophy','clock','leaf','helmet','fullscreen'];
for(const id of ids){const c=recorder();A.sprite(c,id,0,0,24,24,{});assert(c.calls.length>=4,id+' has real geometry');const svg=A.icon(id);assert(svg.includes('<svg')&&!svg.includes('<text')&&!svg.includes('<image'),id+' is a native vector');assert.strictEqual(svg,A.icon(id),id+' deterministic');}
assert.strictEqual(new Set(D.BUILD_ORDER.map(id=>serial(id))).size,D.BUILD_ORDER.length,'all ten machine subjects are distinct');
const noColour=s=>s.replace(/#[0-9a-f]{6}/g,'ink');
assert.strictEqual(new Set(['coal','ironOre','copperOre'].map(id=>noColour(serial(id)))).size,3,'ore silhouettes differ without colour');
for(const id of ['extractor','smelter','assembler','damper','hub']){
  assert.strictEqual(serial(id,{active:false,phase:0}),serial(id,{active:false,phase:2}),id+' idle does not fake production');
  assert.notStrictEqual(serial(id,{active:true,phase:1}),serial(id,{active:false,phase:0}),id+' active state visible');
}
for(const u of D.META_UPGRADES){
  assert.notStrictEqual(serial('rig',{}),serial('rig',{upgrades:{[u.id]:1}}),u.id+' changes the map rig');
  const before=recorder(),after=recorder();A.portraitRig(before,0,0,700,700,{});A.portraitRig(after,0,0,700,700,{upgrades:{[u.id]:1}});assert.notDeepStrictEqual(after.calls,before.calls,u.id+' changes the large rig');
  const image={decodedBitmap:true},imageBefore=recorder(),imageAfter=recorder();
  A.portraitRig(imageBefore,0,0,400,400,{portrait:image});
  A.portraitRig(imageAfter,0,0,400,400,{portrait:image,upgrades:{[u.id]:1}});
  assert(imageBefore.calls.some(c=>c[0]==='drawImage'&&c[1]===image),'decoded bitmap is composed');
  assert.notDeepStrictEqual(imageBefore.calls,imageAfter.calls,u.id+' also changes the bitmap rig');
}
const scenes=[];
for(const e of DC.Events.VIGNETTES){const c=recorder();A.scene(c,e.id,500,400,{});scenes.push(JSON.stringify(c.calls));}
assert.strictEqual(new Set(scenes).size,20,'every encounter is separately illustrated');
for(const id of ['landscape','wreck','core','descent']){const c=recorder();A.scene(c,id,500,400,{upgrades:{m_hull:1}});}
const biomes=[];for(let i=0;i<8;i++){const c=recorder();A.tile(c,{kind:'rock',biome:i,edges:15,variant:1},0,0,30);biomes.push(JSON.stringify(c.calls));}
assert.strictEqual(new Set(biomes).size,8,'each stratum has its own material palette');
const meta=DC.Meta.newProfile(),run=DC.Sim.newRun(DC.Meta.effects(meta),1337),twin=DC.Sim.newRun(DC.Meta.effects(meta),1337);
const before=JSON.stringify({run,meta});for(let i=0;i<40;i++)R.mapModel(run);
assert.strictEqual(JSON.stringify({run,meta}),before,'redacted view does not mutate the run or profile');assert.strictEqual(run.rng(),twin.rng(),'view does not consume RNG');
const hidden=run.grid.flat().find(t=>!t.revealed);assert(hidden,'test has fog');
Object.defineProperty(hidden,'ore',{get(){throw new Error('hidden ore was read');}});Object.defineProperty(hidden,'lm',{get(){throw new Error('hidden landmark was read');}});R.mapModel(run);
assert(R.mapModel(run).some(t=>t===null),'unknown terrain is represented only as null');
// Arcade feedback observes real changes, not animation timers or fake output.
const snap=R.feedbackSnapshot(run);
assert.strictEqual(R.feedbackEvents(snap,R.feedbackSnapshot(run)).length,0,'idle frame produces no feedback');
const feedbackBefore=JSON.stringify({run:twin,meta});R.feedbackSnapshot(twin);
assert.strictEqual(JSON.stringify({run:twin,meta}),feedbackBefore,'feedback snapshot leaves gameplay and profile intact');
assert.strictEqual(run.rng(),twin.rng(),'feedback does not consume sim RNG');
const plain={hub:{x:4,y:4}},base={run:plain,depth:1,tick:10,fed:0,inv:{},machines:[],cells:[[{kind:'rock',rubble:false,belt:false},null]]};
const updated={...base,tick:11,fed:1,machines:[{id:3,x:1,y:1}],cells:[[{kind:'floor',rubble:false,belt:true},{kind:'floor',rubble:false,belt:true}]]};
const eventBefore=JSON.stringify([base,updated]),events=R.feedbackEvents(base,updated);
assert.deepStrictEqual(Array.from(events,e=>e.kind),['build','dig','belt','feed'],'real actions produce distinct feedback');
assert.strictEqual(events.filter(e=>e.x===1.5&&e.y===.5).length,0,'revealing a tile does not fake a build');
assert.strictEqual(JSON.stringify([base,updated]),eventBefore,'feedback does not mutate its source');
for(const reset of [{...updated,depth:2},{...updated,run:{}},{...updated,tick:9}])assert.strictEqual(R.feedbackEvents(base,reset).length,0,'new floor/run resets feedback');
const large={...updated,machines:Array.from({length:100},(_,id)=>({id,x:1,y:1}))};assert(R.feedbackEvents(base,large).length<=48,'event burst is bounded');
const old=DC.Meta.parseProfile(JSON.stringify({cores:12,upgrades:{m_hull:1},runs:7}));assert.strictEqual(old.cores,12);assert.strictEqual(old.upgrades.m_hull,1);assert.strictEqual(old.v,DC.Meta.SAVE_V);assert.strictEqual(old.runs,7);
for(const raw of ['{}','[]','null','broken','{"cores":-1,"upgrades":{}}','{"cores":1,"upgrades":{},"v":999}'])assert.throws(()=>DC.Meta.parseProfile(raw),'bad / future import refused');
const original=JSON.stringify(meta),parsed=DC.Meta.parseProfile(original);assert.strictEqual(JSON.stringify(meta),original,'profile migration is pure');assert.strictEqual(JSON.stringify(parsed),original,'current profile roundtrips');
for(const edition of ['deepcore','deepcore-classic','deepcore-graphical']){
  const f='dist/'+edition+'.html';if(!fs.existsSync(path.join(root,f)))continue;
  const built=read(f),scripts=Array.from(built.matchAll(/<script>([\s\S]*?)<\/script>/g));assert(scripts.length,'inline script exists');for(const s of scripts)new vm.Script(s[1]);
  assert(!/<script src=|<link rel="stylesheet"/.test(built),'standalone has no script/style fetches');
  assert(!/link\.href\s*=\s*'graphical.html'/.test(built),'standalone edition link points to the built file');
  if(edition==='deepcore-graphical'){
    assert(!built.includes('/* ==== js/render.js ==== */'));assert(built.includes('/* ==== js/atelier.js ==== */'));
    assert(built.includes('/* ==== js/pixels.js ==== */'),'pixel module bundled');
    assert(!/['"]assets\/bedrock\//.test(built),'no external bitmap paths');
    assert.strictEqual((built.match(/data:image\/png;base64,/g)||[]).length,2,'both illustrations embedded');
    assert(built.includes('data:font/ttf;base64,'),'pixel font embedded');
    assert(built.includes('SIL OPEN FONT LICENSE'),'font license travels with the build');
  }
  else assert(!built.includes('/* ==== js/graphical.js ==== */'),'legacy edition excludes new renderer');
}
console.log('PASS graphical | '+Object.keys(PX.ART).length+' authored pixel subjects | '+ids.length+' total icon subjects | 2 RGBA portraits + pixel font embedded | 20 unique encounters | 8 biomes | all 9 upgrades on sprite AND bitmap rigs | no text-drawing path | no RNG/state mutations | fog redaction | safe profile migration | three offline builds');
