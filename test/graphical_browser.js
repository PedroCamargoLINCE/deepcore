/* Real Chromium acceptance test. Launch a disposable profile with
   --remote-debugging-port=9344, then node test/graphical_browser.js.
   Node 22's WebSocket or the system's ws module. Screenshots go to /tmp. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const WebSocket=globalThis.WebSocket||require('ws');
const base='file://'+path.resolve(__dirname,'..')+'/',port=process.env.DC_BROWSER_PORT||9344;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
  const page=pages.find(p=>p.type==='page');assert(page,'test browser has a page');
  const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map(),errors=[];let serial=0;
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.exception?.description||'browser evaluation failed');return r.result.value;};
  const waitFor=async(expression,message)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50);}assert.fail(message);};
  const key=async k=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:k});await send('Input.dispatchKeyEvent',{type:'keyUp',key:k});await delay(40);};
  const click=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert(p,'click target '+selector);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});await delay(60);};
  const shot=async name=>{await delay(60);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/deepcore-bedrock-'+name+'.png',Buffer.from(r.data,'base64'));};
  const size=async(w,h,dpr=1)=>{await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:dpr,mobile:false});await delay(160);await evaluate('DC.Render.resize()');};
  const cockpit=async label=>{
    const result=await evaluate(`(()=>{
      const op=document.querySelector('#operations'),box=op.getBoundingClientRect();
      const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=box.top&&r.bottom<=box.bottom+1};
      return {scroll:op.scrollHeight>op.clientHeight+1,overflow:document.documentElement.scrollHeight>innerHeight+1,
        meters:[...op.querySelectorAll('[role="meter"]')].every(visible),
        controls:[...op.querySelectorAll('button')].every(visible),
        readout:visible(op.querySelector('.rig-readout')),
        tools:[...document.querySelectorAll('.tool-group button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight}),
        tile:DC.Render.debug().transform.tile};
    })()`);
    assert(!result.scroll&&!result.overflow&&result.meters&&result.controls&&result.readout&&result.tools,label+' cockpit needs no scrolling: '+JSON.stringify(result));
    return result;
  };
  try{
    await send('Runtime.enable');await send('Page.enable');
    await send('Page.navigate',{url:base+'graphical.html'});await delay(650);
    await evaluate('document.fonts.ready.then(()=>true)');
    await waitFor('DC.Render.debug().portraitReady','rig portrait decoded');
    await size(1440,960);
    await evaluate('DC.state.meta=DC.Meta.newProfile();DC.Render.frame(DC.state,performance.now())');
    assert.strictEqual(await evaluate('DC.state.screen'),'title');await shot('title');
    assert(await evaluate('document.fonts.check(\'16px "Pixelify Sans"\')'),'vendored pixel font loaded');
    assert(await evaluate('getComputedStyle(document.querySelector(".hero h1")).fontFamily.includes("Pixelify Sans")'),'title uses the new font');
    assert(await evaluate('[...document.querySelectorAll("button")].filter(b=>b.getClientRects().length).every(b=>{const s=getComputedStyle(b);return s.backgroundImage==="none"&&s.boxShadow==="none"&&s.borderRadius==="0px"})'),'flat buttons: no gradients, bevels or rounded app chrome');
    if(await evaluate('document.fullscreenEnabled')) {
      await click('#topbar [data-action="fullscreen"]');
      assert(await evaluate('!!document.fullscreenElement'),'native fullscreen enters from a real gesture');
      await click('#topbar [data-action="fullscreen"]');
      assert(await evaluate('!document.fullscreenElement'),'native fullscreen exits');
      await size(1440,960);
    }
    // Begin via an actual native button, not a direct sim call.
    await click('#pages button[data-key="Enter"]');
    let screen=await evaluate('DC.state.screen');
    if(screen==='contract')await click('#pages button[data-key="1"]');
    assert.strictEqual(await evaluate('DC.state.screen'),'run');await shot('induction');
    assert(await evaluate('DC.Tutorial.active(DC.state.run)&&!!document.querySelector(".tutor")'),'fresh profile sees the actual induction lesson');
    await waitFor('[...document.querySelectorAll(".grit-portrait img")].every(i=>i.complete&&i.naturalWidth>0)','GRIT bitmap decoded');
    for(const [w,h] of [[1366,768],[1280,720],[960,700]]){
      await size(w,h);const hud=await cockpit(w+'x'+h);
      assert(hud.tile>=23,'default camera shows readable machinery at '+w+'x'+h);
      const failures=await evaluate(`(()=>{
        const s=DC.state,original=s.run.tutorial.i,fail=[];
        for(let i=0;i<9;i++){
          s.run.tutorial.i=i;DC.Render.frame(s,performance.now());
          const p=document.querySelector('#field-notes');
          if(p.scrollHeight>p.clientHeight+1)fail.push('lesson '+i+' scrolls');
          const l=DC.Tutorial.layout(s.run),t=DC.Render.debug().transform,c=document.querySelector('#screen').getBoundingClientRect(),f=p.getBoundingClientRect();
          for(const q of [l&&l.target,l&&l.from])if(q){const x=c.x+t.x+(q.x+.5)*t.tile,y=c.y+t.y+(q.y+.5)*t.tile;
            if(x<c.left||x>f.left-6||y<c.top+30||y>c.bottom-40)fail.push('lesson '+i+' obscures target');}
        }
        s.run.tutorial.i=original;DC.Render.frame(s,performance.now());return fail;
      })()`);
      assert.deepStrictEqual(failures,[],'all induction lessons fit at '+w+'x'+h);
      if(w===1280)await shot('induction-laptop');
    }
    await size(1440,960);
    await key('Tab');
    // Isolated fixture, never the user's profile. Stop simulation for stable
    // screenshots, but keep the real frame/input loop and Engine handlers.
    await evaluate(`(()=>{
      DC.Sim.tick=()=>{};const s=DC.state,D=DC.DATA;
      s.meta=DC.Meta.newProfile();s.meta.cores=30;s.meta.tutorialSeen=true;
      s.meta.trophies=D.TROPHIES.filter((_,i)=>i%3!==1).map(t=>t.id);s.meta.logbook=[0,3,5,6,13,19];
      s.run=DC.Sim.newRun(DC.Meta.effects(s.meta),1337);s.run.depth=5;DC.Sim.startStratum(s.run);
      s.run.grid.flat().forEach(t=>t.revealed=true);D.ITEM_ORDER.forEach(id=>s.run.inv[id]=40);
      // A readable illustrative factory with real machine placement.
      for(let y=5;y<20;y++)for(let x=8;x<37;x++){const t=s.run.grid[y][x];if(t.machine!==0&&!t.lm)Object.assign(t,{t:'floor',ore:null,rubble:false});}
      for(const [x,id] of [[10,'ironOre'],[14,'coal'],[18,'copperOre']]){s.run.grid[9][x].ore=id;s.run.grid[9][x].oreAmt=90;DC.Sim.place(s.run,'extractor',x,9,2);for(let y=10;y<14;y++)DC.Sim.place(s.run,'belt',x,y,2);}
      DC.Sim.place(s.run,'smelter',10,14,1);DC.Sim.place(s.run,'smelter',14,14,1);DC.Sim.place(s.run,'assembler',18,14,1);
      DC.Sim.place(s.run,'damper',30,14,1);DC.Sim.place(s.run,'splitter',30,10,1);DC.Sim.place(s.run,'crusher',33,13,1);
      for(const m of Object.values(s.run.machines)){m.status='ok';m.progress=3;}
      s.run.grid[11][10].belt.item='ironOre';s.run.grid[11][14].belt.item='coal';s.run.grid[11][18].belt.item='copperOre';
      s.run.gearsFed=19;s.run.instability=38;s.run.integrity=82;s.ui.tool=null;s.ui.hover=null;s.ui.cursor={x:18,y:14};s.screen='run';DC.Render.frame(s,performance.now());
    })()`);
    await shot('factory');
    const clickTile=async(x,y,type='mousePressed',button='left')=>{
      const p=await evaluate(`(()=>{const t=DC.Render.debug().transform,r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+t.x+(${x}+.5)*t.tile,y:r.y+t.y+(${y}+.5)*t.tile}})()`);
      await send('Input.dispatchMouseEvent',{type,button,clickCount:1,...p});return p;
    };
    // Build through actual toolbar + canvas hit testing at the new square
    // tile pitch, then drag a corner. No test-only input implementation.
    await evaluate('DC.state.run.inv.ironPlate=300;DC.state.run.inv.copperPlate=300;DC.state.run.t++;DC.Render.frame(DC.state,performance.now())');
    await click('#toolbelt button[data-key="3"]');assert.strictEqual(await evaluate('DC.state.ui.tool'),'smelter');
    assert(await evaluate('document.activeElement===document.querySelector("#screen")'),'tool click returns focus for keyboard map play');
    const target=await evaluate(`(()=>{const r=DC.state.run;for(let y=7;y<18;y++)for(let x=21;x<30;x++)if(DC.Sim.canPlace(r,'smelter',x,y,DC.state.ui.facing).ok)return {x,y,n:Object.keys(r.machines).length};return null})()`);
    assert(target,'machine fixture placement exists');
    await clickTile(target.x,target.y);await clickTile(target.x,target.y,'mouseReleased');await delay(80);
    assert.strictEqual(await evaluate('Object.keys(DC.state.run.machines).length'),target.n+1,'map click places the selected machine');
    assert(await evaluate('DC.Render.debug().feedback.some(e=>e.kind==="build")'),'successful placement gets real build feedback');
    const feedbackFrozen=await evaluate('JSON.stringify(DC.Render.debug().feedback)');
    await evaluate('DC.state.ui.paused=true;for(let i=0;i<15;i++)DC.Render.frame(DC.state,performance.now()+i*100)');
    assert.strictEqual(await evaluate('JSON.stringify(DC.Render.debug().feedback)'),feedbackFrozen,'paused effects do not advance with wall clock');
    await evaluate('DC.state.ui.paused=false;DC.Render.frame(DC.state,performance.now())');
    await shot('build-feedback');
    await evaluate('DC.state.run.t+=7;DC.Render.frame(DC.state,performance.now())');
    assert.strictEqual(await evaluate('DC.Render.debug().feedback.length'),0,'impact effects expire on sim ticks');
    await click('#toolbelt button[data-key="r"]');assert.strictEqual(await evaluate('DC.state.ui.facing'),2,'rotate uses real engine command');
    await click('#toolbelt button[data-key="1"]');
    const pathCells=[[26,17],[27,17],[28,17],[28,18]];
    await clickTile(...pathCells[0]);
    for(const q of pathCells.slice(1)){await clickTile(...q,'mouseMoved');await delay(20);}
    await clickTile(...pathCells[3],'mouseReleased');
    const beltDirs=await evaluate('[[26,17],[27,17],[28,17],[28,18]].map(([x,y])=>DC.state.run.grid[y][x].belt?.dir)');
    assert.deepStrictEqual(beltDirs,[1,1,2,2],'dragged corner is continuous and correctly directed');
    assert(await evaluate('DC.Render.debug().feedback.some(e=>e.kind==="belt")'),'real belt drag receives feedback');
    await click('#map-controls button[data-action="zoom-in"]');
    const zoomed=await evaluate('DC.Render.debug().camera.zoom');assert(zoomed>1,'map zoom changes the camera');
    const panStock=await evaluate('DC.state.run.inv.ironPlate');
    await clickTile(28,17,'mousePressed','right');await clickTile(29,17,'mouseMoved','right');await clickTile(29,17,'mouseReleased','right');
    assert.strictEqual(await evaluate('DC.state.run.inv.ironPlate'),panStock,'right-drag pans without placing a belt');
    await click('#map-controls button[data-action="fit"]');
    const fitTile=await evaluate('DC.Render.debug().transform.tile');
    await click('#map-controls button[data-action="rig-camera"]');
    assert(await evaluate('DC.Render.debug().transform.tile')>fitTile*1.3,'Rig restores the close working camera');
    const detailPurity=await evaluate('JSON.stringify([DC.state.run,DC.state.meta])');
    await click('#map-controls button[data-action="details"]');
    assert(await evaluate('document.querySelector("#field-notes .tabs")&&document.querySelector("[data-action=details]").getAttribute("aria-expanded")==="true"'),'production opens on demand');
    for(const tab of ['loadout','journal','chain'])await click('#field-notes [data-action="tab:'+tab+'"]');
    await shot('production');await key('Escape');
    assert.strictEqual(await evaluate('document.querySelector("[data-action=details]").getAttribute("aria-expanded")'),'false','Escape closes details, not the run');
    assert.strictEqual(await evaluate('JSON.stringify([DC.state.run,DC.state.meta])'),detailPurity,'camera/details leave simulation and profile unchanged');
    // Direct frame calls cannot touch a run's RNG, even on victory/recap.
    const purity=await evaluate(`(()=>{const s=DC.state,fn=s.run.rng,original=s.screen;s.run.rng=()=>{throw new Error('render spent sim RNG')};const before=JSON.stringify([s.run,s.meta]);try{for(const name of ['run','foundry','contract','help','trophies','ledger','logbook','victory','gameover','recap']){s.screen=name;DC.Render.frame(s,performance.now())}return before===JSON.stringify([s.run,s.meta])}finally{s.run.rng=fn;s.screen=original;DC.Render.frame(s,performance.now())}})()`);
    assert(purity,'real renderer leaves gameplay and progression byte-identical');
    // Every screen must render with real DOM controls and no terminal layer.
    for(const name of ['contract','foundry','trophies','ledger','logbook','help','vignette','descend','victory','gameover','recap']){
      await evaluate(`(()=>{const s=DC.state;s.screen=${JSON.stringify(name)};s.ui.helpPage=0;s.ui.descendAnim=999;s.run.pendingOffers=DC.DATA.SCHEMATICS.slice(0,3).map(x=>x.id);DC.Events.state(s.run).vignette=DC.Events.VIGNETTES[0];s.run.result={depth:5,breaches:4,timeSec:734,cores:4,won:false,paid:4};DC.Render.frame(s,performance.now())})()`);
      assert(await evaluate('document.querySelector("#pages").innerText.length>30'),name+' content');await shot(name);
      if(name==='foundry'){
        await evaluate('window.upgradeFixture=JSON.stringify(DC.state.meta.upgrades);DC.DATA.META_UPGRADES.forEach(u=>DC.state.meta.upgrades[u.id]=1);DC.Render.frame(DC.state,performance.now())');
        await shot('foundry-upgraded');
        await evaluate('DC.state.meta.upgrades=JSON.parse(window.upgradeFixture);DC.Render.frame(DC.state,performance.now())');
      }
    }
    for(const p of [1,2]){await evaluate('DC.state.screen="help";DC.state.ui.helpPage='+p+';DC.Render.frame(DC.state,performance.now())');await shot('manual-'+p);}
    for(let i=0;i<20;i++){
      await evaluate('DC.state.screen="vignette";DC.Events.state(DC.state.run).vignette=DC.Events.VIGNETTES['+i+'];DC.Render.frame(DC.state,performance.now())');
      assert(await evaluate('document.querySelector("#pages").innerText.includes(DC.Events.VIGNETTES['+i+'].choices[0].label)'), 'encounter choice preserved');
    }
    await evaluate('DC.state.screen="run";DC.state.ui.paused=false;DC.Render.frame(DC.state,performance.now())');
    await click('#topbar button[data-key=" "]');assert(await evaluate('DC.state.ui.paused'));await shot('pause');
    await click('#modal button[data-key=" "]');assert.strictEqual(await evaluate('DC.state.ui.paused'),false);
    // Breach -> timed interstitial -> real schematic choice -> next floor.
    await evaluate(`(()=>{const s=DC.state;s.run=DC.Sim.newRun(DC.Meta.effects(s.meta),2718);s.run.status='breachReady';s.run.gearsFed=s.run.breachReq.gear;s.run.chargesFed=s.run.breachReq.charge;s.ui.tool=null;s.ui.descendAnim=0;DC.Render.frame(s,performance.now())})()`);
    await click('#operations button[data-key="d"]');assert.strictEqual(await evaluate('DC.state.screen'),'descend');
    await key('1');assert.strictEqual(await evaluate('DC.state.run.depth'),1,'schematic cannot skip transit');
    const transit=await evaluate('DC.Render.animLength()/60*1000');await delay(transit+250);
    await click('#pages button[data-key="1"]');
    if(await evaluate('DC.state.screen')==='vignette')await click('#pages button[data-key="1"]');
    assert.strictEqual(await evaluate('DC.state.run.depth'),2);assert.strictEqual(await evaluate('DC.state.screen'),'run');
    // The Core still ends the base game; the same C command enters the Mantle.
    await evaluate(`(()=>{const s=DC.state;s.run.depth=8;DC.Sim.startStratum(s.run);s.run.status='breachReady';s.run.gearsFed=s.run.breachReq.gear;s.run.chargesFed=s.run.breachReq.charge;DC.Render.frame(s,performance.now())})()`);
    await click('#operations button[data-key="d"]');assert.strictEqual(await evaluate('DC.state.screen'),'victory');
    await click('#pages button[data-key="c"]');assert.strictEqual(await evaluate('DC.state.screen'),'descend');await delay(transit+250);
    await click('#pages button[data-key="1"]');if(await evaluate('DC.state.screen')==='vignette')await click('#pages button[data-key="1"]');
    assert(await evaluate('DC.state.run.mantle&&DC.state.run.depth===9&&DC.state.screen==="run"'),'graphical journey continues into the real Mantle');
    for(const [w,h] of [[1920,1080],[1366,768],[1280,720],[800,600]]){
      await size(w,h);await cockpit('late-game '+w+'x'+h);
      assert.strictEqual(await evaluate('document.querySelectorAll("#operations [role=meter]").length'),4,'late-game charges remain on the cockpit');
      if(w===1280)await shot('cockpit-laptop');
    }
    await size(960,700,2);await shot('factory-small');
    assert(await evaluate('[...document.querySelectorAll(".tool .cost")].every(e=>e.getBoundingClientRect().bottom<=e.closest(".tool").getBoundingClientRect().bottom)'),'long tool prices fit inside their controls');
    await key('0');
    assert(await evaluate('(()=>{const t=document.querySelector(".tool.selected").getBoundingClientRect(),b=document.querySelector("#toolbelt").getBoundingClientRect();return t.left>=b.left&&t.right<=b.right})()'),'keyboard selection reveals an offscreen tool');
    const beltScroll=await evaluate('document.querySelector(".build-tools").scrollLeft');
    await evaluate('DC.state.run.inv.ironPlate=0;DC.Render.frame(DC.state,performance.now())');
    assert.strictEqual(await evaluate('document.querySelector(".build-tools").scrollLeft'),beltScroll,'inventory/affordability updates preserve tool strip position');
    await send('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await waitFor('matchMedia("(prefers-reduced-motion: reduce)").matches&&DC.Render.debug().reduced','reduced motion preference applied');
    await evaluate('DC.state.run.t+=7;DC.Render.frame(DC.state,performance.now());DC.state.run.gearsFed++;DC.state.run.t++;DC.Render.frame(DC.state,performance.now())');
    assert.strictEqual(await evaluate('DC.Render.debug().feedback.length'),0,'reduced motion suppresses new particles');
    await send('Emulation.setEmulatedMedia',{features:[]});
    const overflow=await evaluate('({w:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth})');assert(overflow.doc<=overflow.w&&overflow.body<=overflow.w,'no page horizontal overflow');
    await size(390,844,2);await cockpit('narrow 390x844');await shot('factory-mobile');
    await evaluate('DC.state.screen="contract";DC.Render.frame(DC.state,performance.now())');await shot('contract-mobile');
    assert(await evaluate('[...document.querySelectorAll(".permit")].every(e=>e.getBoundingClientRect().right<=innerWidth)'),'all permits fit on mobile');
    await evaluate('DC.state.screen="title";DC.Render.frame(DC.state,performance.now())');await shot('title-mobile');
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'title mobile fits');
    await size(1440,960);await click('#topbar [data-progress]');
    assert(await evaluate('document.querySelector(".profile-dialog").open'),'native profile dialog opens');
    await evaluate(`(()=>{const p=JSON.parse(JSON.stringify(DC.state.meta));p.cores=17;window.profileBeforeImport=JSON.stringify(DC.state.meta);const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(p)],'progress.json',{type:'application/json'}));const input=document.querySelector('[data-import]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(80);
    await click('.profile-dialog [data-confirm]');assert.strictEqual(await evaluate('DC.state.meta.cores'),17,'reviewed profile imported');
    assert(await evaluate('localStorage.getItem("deepcore_profile_backup_v1")===window.profileBeforeImport'),'replaced profile retained as backup');await shot('profile');await click('.profile-dialog [data-close]');
    // Explicit desktop-scale ceiling: backing stores stay bounded on an
    // oversized display, and repeated stable frames reuse the terrain.
    await evaluate('DC.state.screen="run";DC.state.ui.tool=null;DC.Render.frame(DC.state,performance.now())');
    await size(8000,4500,2);
    const caches=await evaluate(`(()=>{const s=DC.state,a=DC.Render.debug();for(let i=0;i<30;i++)DC.Render.frame(s,performance.now());const b=DC.Render.debug();return {same:a.terrainBuilds===b.terrainBuilds,pixels:b.terrainPixels,sprites:b.spritePixels,screen:document.querySelector('#screen').width*document.querySelector('#screen').height}})()`);
    assert(caches.same&&caches.pixels<=12000000&&caches.sprites<=12000000&&caches.screen<=12010000,'stable caches and bounded canvas allocation');
    await size(960,700);
    await send('Page.navigate',{url:base+'dist/deepcore-graphical.html'});await delay(500);assert.strictEqual(await evaluate('DC.Render.artMode()'),'bedrock');await shot('bundle');
    await evaluate('document.fonts.ready.then(()=>true)');
    await waitFor('DC.Render.debug().portraitReady','standalone rig bitmap decoded');
    assert(await evaluate('document.fonts.check(\'16px "Pixelify Sans"\')'),'standalone font decoded');
    await key('i');
    await waitFor('!!document.querySelector("img[data-grit]")&&[...document.querySelectorAll("img[data-grit]")].every(i=>i.complete&&i.naturalWidth>0&&i.src.startsWith("data:image/png;base64,"))','standalone GRIT decoded from embedded source');
    assert.deepStrictEqual(errors,[],'no browser exceptions');
    console.log('PASS graphical browser | all screens + 20 encounters | fresh induction | native fullscreen | real building / belt corners / rotate / pause | tick-driven feedback + reduced motion | breach -> timed pick -> Core -> Mantle | zoom and pan | renderer state/RNG purity | profile import + recoverable backup | responsive 1440 / 960 / 390 | 8K cache bounds | standalone file:// | screenshots /tmp/deepcore-bedrock-*.png');
  }finally{ws.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
