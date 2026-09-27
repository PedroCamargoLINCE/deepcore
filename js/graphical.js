/* DEEPCORE / Bedrock — independent graphical renderer and arcade HUD.
   Only ui.descendAnim is advanced here, matching the engine's existing view
   contract. Actions go through Engine.command; map hits return logical cells.
   No simulation value, profile, RNG, or gameplay rule is owned by this file. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {}, D = DC.DATA, A = DC.Atelier;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }[c]));
  const title = s => String(s || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const time = s => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const number = n => Math.floor(n || 0).toLocaleString('en-US');
  const stockNumber = n => {
    for(const [scale,suffix] of [[1e12,'t'],[1e9,'b'],[1e6,'m'],[1e3,'k']])
      if(n>=scale)return (n<scale*10?Math.floor(n/scale*10)/10:Math.floor(n/scale))+suffix;
    return number(n);
  };
  const strata = d => d <= D.STRATA_COUNT ? D.STRATA[d - 1] : D.mantleStratum(d);
  const directions = [
    'North',
    'East',
    'South',
    'West'
  ];
  const iconCache = new Map();
  const gritPortrait='assets/bedrock/grit-pixel.png';
  function icon(id, options) {
    // Keep the embedded PNG out of per-frame HTML comparisons. put() binds
    // the image only when this part of the interface actually changes.
    if(id==='grit')return '<span class="icon grit-portrait'+(options&&options.talking?' talking':'')+'"><img data-grit alt="" width="64" height="64"></span>';
    const key = JSON.stringify([
      id,
      options || {}
    ]);
    let svg = iconCache.get(key);
    if (!svg) {
      svg = A.icon(id, options);
      if (iconCache.size >= 160)
        iconCache.delete(iconCache.keys().next().value);
      iconCache.set(key, svg);
    }
    return '<span class="icon">' + svg + '</span>';
  }
  function button(label, key, cls, disabled) {
    return '<button type="button" data-key="' + esc(key) + '" class="' + (cls || '') + '"' + (disabled ? ' disabled' : '') + '>' + esc(label) + ' <kbd>' + esc(key === ' ' ? 'Space' : key === 'Escape' ? 'Esc' : key) + '</kbd></button>';
  }
  function action(label, id, cls) {
    return '<button type="button" data-action="' + esc(id) + '" class="' + (cls || '') + '">' + label + '</button>';
  }
  function bar(value, max, cls) {
    return '<div class="progress ' + (cls || '') + '" role="meter" aria-valuemin="0" aria-valuemax="' + Math.max(1, max) + '" aria-valuenow="' + clamp(value, 0, Math.max(1, max)) + '"><i style="width:' + clamp(max ? value / max * 100 : 100, 0, 100) + '%"></i></div>';
  }
  function costText(cost) {
    return Object.keys(cost || {}).map(k => cost[k] + ' ' + D.ITEMS[k].name + (cost[k] !== 1 && /plate$/.test(D.ITEMS[k].name) ? 's' : '')).join(', ');
  }
  function costIcons(cost) {
    return Object.keys(cost || {}).map(k => '<span class="price-item">'+cost[k]+icon(k)+'</span>').join('');
  }
  function clean(s) {
    return String(s || '').replace(/[╔╗╚╝═║┌┐└┘─│▓▒░█▌▐▣▪▸»«]/g, '').replace(/◈/g, ' cores ').replace(/¤/g, ' gears ').replace(/‡/g, ' charges ').replace(/≡/g, 'iron').replace(/♠/g, 'coal').replace(/¢/g, 'copper').replace(/♦/g, 'crystal').replace(/\s+/g, ' ').trim();
  }
  function header(kicker, heading, desc, actions) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(kicker) + '</div><h1>' + esc(heading) + '</h1><p>' + esc(desc || '') + '</p></div><div class="actions">' + (actions || '') + '</div></div>';
  }
  function foot(text, buttons) {
    return '<div class="page-foot"><span>' + esc(text) + '</span><div class="actions">' + (buttons || '') + '</div></div>';
  }
  function scene(id, options, cls) {
    return '<div class="' + (cls || 'scene') + '"><canvas data-scene="' + esc(id) + '" data-options="' + esc(JSON.stringify(options || {})) + '" aria-label="' + esc(id === 'landscape' ? 'Your drilling rig in the geological cross-section' : title(id)) + '" role="img"></canvas></div>';
  }
  function livery(meta) {
    const id = DC.Meta.livery(meta), def = D.LIVERY_BY_ID[id];
    if (id === D.LIVERIES[0].id) return A.P.gold;
    return def && def.chrome ? def.chrome.amber : A.P.gold;
  }
  const itemColors = {
    ironOre:'#8edbff', copperOre:'#ffac76', coal:'#bdc9e3', crystal:'#d4a2ff',
    ironPlate:'#9ae8e7', copperPlate:'#ffc298', gear:'#ffda70', charge:'#e1aaff'
  };
  let canvas, ctx, nodes = {}, lastState = null, screen = '', panelTab = 'chain', lastNow = null;
  let viewport = {
      w: 0,
      h: 0,
      dpr: 1
    }, camera = {
      zoom: 1,
      x: D.MAP_W / 2,
      y: D.MAP_H / 2
    };
  let transform = {
      x: 0,
      y: 0,
      tile: 1
    }, lastMapKey = '', surface = null, surfaceKey = '', spriteCache = new Map();
  let htmlCache = {}, pointerBusy = false, pan = null, modelCache = {}, pauseOpen = false, pauseFocus = null;
  let reduced = false, frameCalls = 0, terrainBuilds = 0, mapBuilds = 0, lastRun = null, lastDepth = 0, lastCursor = '';
  let portraitImage=null,portraitReady=false,lastTool=null;
  let titleBackdrop=null,titleBackdropReady=false,titleChoice='Enter';
  let detailOpen=false, cameraMode='work', fieldWidth=0, hudTop=76, lastLesson='';
  let observed = null, sparks = [], gains = {};
  // View-local event snapshots. Never inspect unrevealed terrain, spend RNG,
  // or invent activity for an idle machine. Tick ages freeze with the sim.
  function feedbackSnapshot(run) {
    return {
      run, depth:run.depth, tick:run.t, fed:run.gearsFed + run.chargesFed,
      inv:Object.assign({},run.inv),
      cells:run.grid.map(row => row.map(t => !t.revealed ? null :
        {kind:t.t,rubble:!!t.rubble,belt:!!t.belt})),
      machines:Object.values(run.machines).filter(m => visible(run,m.x,m.y))
        .map(m => ({id:m.id,x:m.x+m.w/2,y:m.y+m.h/2}))
    };
  }
  function feedbackEvents(prev, next) {
    if (!prev || prev.run !== next.run || prev.depth !== next.depth || next.tick < prev.tick) return [];
    const out = [], ids = new Set(prev.machines.map(m => m.id));
    for (const m of next.machines)
      if (!ids.has(m.id)) out.push({kind:'build',x:m.x,y:m.y});
    for (let y=0;y<next.cells.length;y++) for (let x=0;x<next.cells[y].length;x++) {
      const a=prev.cells[y][x], b=next.cells[y][x];
      if (!a || !b) continue;
      if ((a.kind==='rock' && b.kind==='floor') || (a.rubble && !b.rubble)) out.push({kind:'dig',x:x+.5,y:y+.5});
      if (!a.belt && b.belt) out.push({kind:'belt',x:x+.5,y:y+.5});
    }
    if (next.fed>prev.fed) out.push({kind:'feed',x:next.run.hub.x+1.5,y:next.run.hub.y+1.5});
    return out.slice(-48);
  }
  function observeFeedback(run) {
    const next=feedbackSnapshot(run), fresh=!observed || observed.run!==run || observed.depth!==run.depth || next.tick<observed.tick;
    if (fresh) { sparks=[]; gains={}; }
    else {
      if (!reduced) for (const e of feedbackEvents(observed,next)) sparks.push(Object.assign({born:run.t},e));
      for (const id of D.ITEM_ORDER)
        if (next.inv[id]>observed.inv[id]) gains[id]={born:run.t,amount:next.inv[id]-observed.inv[id]};
    }
    sparks=reduced?[]:sparks.filter(e=>run.t-e.born<6).slice(-48);
    for (const id of Object.keys(gains)) if (run.t-gains[id].born>=6) delete gains[id];
    observed=next;
  }
  function drawFeedback(run,s) {
    if (reduced) return;
    for (const e of sparks) {
      if (!visible(run,Math.floor(e.x),Math.floor(e.y))) continue;
      const age=clamp((run.t-e.born)/6,0,1), x=e.x*s,y=e.y*s;
      ctx.globalAlpha=1-age;
      ctx.strokeStyle=e.kind==='dig' ? '#ffc778' : e.kind==='feed' ? '#ffdf7c' : '#77ffdf';
      ctx.lineWidth=Math.max(1.5,s*.065);
      if (e.kind!=='dig') {
        const radius=(e.kind==='feed'?1.6:.45)+age*.65;
        ctx.beginPath();ctx.ellipse(x,y,radius*s,radius*s*.6,0,0,Math.PI*2);ctx.stroke();
      }
      if (e.kind!=='belt') for(let i=0;i<6;i++) {
        const a=i*Math.PI/3, distance=s*(.25+age*1.15);
        ctx.fillStyle=i%2?'#ffce71':'#efffff';
        ctx.fillRect(x+Math.cos(a)*distance,y+Math.sin(a)*distance+age*age*s*.7,s*.1,s*.1);
      }
    }
    ctx.globalAlpha=1;
  }
  const layout = {
    buildRows: [],
    cards: [],
    contracts: [],
    choices: []
  };
  function put(id, html) {
    if (!nodes[id] || htmlCache[id] === html)
      return false;
    const focused = root.document.activeElement, inside = focused && nodes[id].contains(focused);
    const focus = inside ? {
      key: focused.getAttribute('data-key'),
      action: focused.getAttribute('data-action'),
      trophy: focused.getAttribute('data-trophy')
    } : null;
    const scroll = nodes[id].scrollTop;
    const belt = id === 'toolbelt' && nodes[id].querySelector('.build-tools');
    const beltScroll = belt ? belt.scrollLeft : 0;
    nodes[id].innerHTML = html;
    for(const img of nodes[id].querySelectorAll('img[data-grit]'))img.src=gritPortrait;
    nodes[id].scrollTop = scroll;
    if (belt) nodes[id].querySelector('.build-tools').scrollLeft = beltScroll;
    htmlCache[id] = html;
    if (focus)
      for (const [k, v] of Object.entries(focus))
        if (v != null) {
          const el = Array.from(nodes[id].querySelectorAll('[data-' + k + ']')).find(n => n.getAttribute('data-' + k) === v);
          if (el) {
            el.focus({ preventScroll: true });
            break;
          }
        }
    return true;
  }
  function command(key) {
    if (DC.Engine)
      DC.Engine.command(key);
  }
  function selectTitle(key) {
    const items=Array.from(nodes.pages.querySelectorAll('#title-menu button'));
    const selected=items.find(b=>b.dataset.key===key)||items[0];
    if(!selected)return;
    titleChoice=selected.dataset.key;
    for(const b of items){
      b.classList.toggle('current',b===selected);
      if(b===selected)b.setAttribute('aria-describedby','menu-brief');
      else b.removeAttribute('aria-describedby');
    }
    nodes.pages.querySelector('#menu-brief').textContent=selected.dataset.brief;
  }
  function click(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled)
      return;
    if (b.dataset.key != null) {
      command(b.dataset.key);
      // Returning focus to the map makes mouse tool selection followed by
      // arrows / Enter behave exactly like choosing the tool by hotkey.
      if (lastState && lastState.screen === 'run' && !lastState.ui.paused)
        canvas.focus({ preventScroll: true });
      return;
    }
    if (b.dataset.trophy != null) {
      if (lastState)
        lastState.ui.trophyCursor = Number(b.dataset.trophy);
      return;
    }
    const a = b.dataset.action;
    if (a === 'details' || a === 'close-details') {
      detailOpen = a === 'details' && !detailOpen;
      if (!detailOpen) nodes['map-controls'].querySelector('[data-action="details"]').focus({preventScroll:true});
      return;
    }
    if (a === 'fullscreen') {
      const doc=root.document;
      const task=doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
      if (task && task.catch) task.catch(() => {
        b.title='Full screen is unavailable here. You can use your browser\'s full-screen command.';
      });
      return;
    }
    if (a && a.startsWith('tab:')) {
      panelTab = a.slice(4);
      return;
    }
    if (a === 'inspect') {
      if (lastState && lastState.ui.tool)
        command('Escape');
      canvas.focus({ preventScroll: true });
      return;
    }
    if (a === 'zoom-in')
      zoom(1.3);
    if (a === 'zoom-out')
      zoom(1 / 1.3);
    if (a === 'fit') {
      cameraMode = 'overview';
      camera.zoom = 1;
      camera.x = D.MAP_W / 2;
      camera.y = D.MAP_H / 2;
      lastMapKey = '';
    }
    if (a === 'rig-camera' && lastState && lastState.run) {
      cameraMode = 'work';
      workCamera(lastState.run);
    }
    if (a === 'context') {
      command('Enter');
      canvas.focus({ preventScroll: true });
    }
  }
  function zoom(mult) {
    cameraMode = 'manual';
    camera.zoom = clamp(camera.zoom * mult, 1, 4);
    lastMapKey = '';
  }
  function init(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    portraitImage=new root.Image();
    portraitImage.onload=()=>{portraitReady=true;drawScenes();};
    portraitImage.src='assets/bedrock/rig-pixel.png';
    titleBackdrop=new root.Image();
    titleBackdrop.onload=()=>{titleBackdropReady=true;drawScenes();};
    titleBackdrop.src='assets/bedrock/shaft-house.png';
    for (const id of [
        'game',
        'topbar',
        'resources',
        'workspace',
        'world',
        'operations',
        'field-notes',
        'toolbelt',
        'statusbar',
        'pages',
        'modal',
        'map-caption',
        'map-controls'
      ])
      nodes[id] = root.document.getElementById(id);
    nodes.game.addEventListener('click', click);
    // Menu selection belongs to the view, not the save or simulation. Native
    // buttons still own activation; arrows only move keyboard focus.
    const chooseTitle=e=>{
      const b=e.target.closest('#title-menu button');
      if(b)selectTitle(b.dataset.key);
    };
    // Replacing profile-driven markup can generate pointerover under a parked
    // mouse. Only real movement should override the keyboard's selection.
    nodes.game.addEventListener('pointermove',chooseTitle);
    nodes.game.addEventListener('focusin',chooseTitle);
    root.document.addEventListener('pointerdown', () => {
      pointerBusy = true;
    });
    root.document.addEventListener('pointerup', () => {
      pointerBusy = false;
      pan = null;
    });
    root.document.addEventListener('pointercancel', () => {
      pointerBusy = false;
      pan = null;
    });
    root.addEventListener('blur', () => {
      pointerBusy = false;
      pan = null;
    });
    // Document scope includes the initially unfocused title. Never take arrows
    // from a profile dialog or editable control. Selection updates in place so
    // pointer movement cannot rebuild the scene or fight native keyboard focus.
    root.document.addEventListener('keydown', e => {
      if(lastState && lastState.screen==='title' && !e.ctrlKey && !e.metaKey && !e.altKey && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)
        && !root.document.querySelector('dialog[open]') && !e.target.closest('input,textarea,select,[contenteditable]')){
        const items=Array.from(nodes.pages.querySelectorAll('#title-menu button'));
        if(items.length){
          let i=items.findIndex(b=>b.dataset.key===titleChoice);
          if(e.key==='Home')i=0;
          else if(e.key==='End')i=items.length-1;
          else i=(Math.max(0,i)+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
          selectTitle(items[i].dataset.key);
          items[i].focus({preventScroll:true});
          e.preventDefault();e.stopPropagation();return;
        }
      }
    });
    // Real buttons must keep native Tab/Space/Enter accessibility, without the
    // same key also activating a game-screen shortcut on the window handler.
    nodes.game.addEventListener('keydown', e => {
      if (e.key === 'Escape' && detailOpen && lastState && lastState.screen === 'run' && !lastState.ui.paused) {
        detailOpen=false;
        nodes['map-controls'].querySelector('[data-action="details"]').focus({preventScroll:true});
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.target.closest('button,a') && [
          'Tab',
          'Enter',
          ' '
        ].includes(e.key))
        e.stopPropagation();
    });
    nodes.modal.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || !pauseOpen)
        return;
      const buttons = Array.from(nodes.modal.querySelectorAll('button:not(:disabled)')), first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && root.document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && root.document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cameraMode = 'manual';
        pan = {
          x: e.clientX,
          y: e.clientY,
          cx: camera.x,
          cy: camera.y
        };
      }
    }, true);
    canvas.addEventListener('mousemove', e => {
      if (pan) {
        camera.x = pan.cx - (e.clientX - pan.x) / transform.tile;
        camera.y = pan.cy - (e.clientY - pan.y) / transform.tile;
        lastMapKey = '';
        e.stopImmediatePropagation();
      }
    }, true);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!lastState || lastState.screen !== 'run')
        return;
      const before = mapPoint(e.clientX, e.clientY);
      zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18);
      computeTransform();
      const after = mapPoint(e.clientX, e.clientY);
      camera.x += before.x - after.x;
      camera.y += before.y - after.y;
      lastMapKey = '';
    }, { passive: false });
    if (root.matchMedia) {
      const mq = root.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = mq.matches;
      if (mq.addEventListener)
        mq.addEventListener('change', e => {
          reduced = e.matches;
          if(reduced)sparks=[];
          lastMapKey = '';
        });
    }
    put('map-controls', action('Rig', 'rig-camera') + action('\u2212', 'zoom-out') + action('Overview', 'fit') + action('+', 'zoom-in') + action('Production', 'details'));
    resize();
  }
  function resize() {
    if (!canvas)
      return;
    const r = canvas.getBoundingClientRect();
    hudTop=parseFloat(root.getComputedStyle(nodes.game).getPropertyValue('--hud-top'))||76;
    const w = Math.max(1, r.width), h = Math.max(1, r.height), dpr = Math.min(root.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (w * h)));
    if (w !== viewport.w || h !== viewport.h || dpr !== viewport.dpr) {
      viewport = {
        w,
        h,
        dpr
      };
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      lastMapKey = '';
      surfaceKey = '';
      spriteCache.clear();
    }
    computeTransform();
    if (cameraMode === 'work' && lastState && lastState.screen === 'run')
      workCamera(lastState.run);
    drawScenes();
  }
  function cameraArea() {
    // The guide has its own lane: neither it nor the map controls may hide
    // the machinery or induction targets. Overview uses this same safe area.
    return { w: Math.max(160, viewport.w - fieldWidth), h: Math.max(100, viewport.h - hudTop - 44), top:hudTop };
  }
  function basePitch() {
    const a = cameraArea();
    return Math.max(1, Math.min((a.w - 24) / D.MAP_W, (a.h - 24) / D.MAP_H));
  }
  function workCamera(run) {
    if (!run) return;
    const a = cameraArea(), lesson = DC.Tutorial.layout(run);
    const points = [{x:run.hub.x,y:run.hub.y},{x:run.hub.x+3,y:run.hub.y+3}];
    if (lesson) for (const q of [lesson.target,lesson.from])
      if (q && visible(run,q.x,q.y)) points.push(q);
    const xs=points.map(q=>q.x),ys=points.map(q=>q.y);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    // Large working tiles, with enough room around the current lesson.
    // This is a camera choice, never a change to map dimensions or scanning.
    const pitch=Math.min(48,Math.max(32,a.h/14),a.w/(right-left+7),a.h/(bottom-top+6));
    camera.zoom=clamp(pitch/basePitch(),1,4);
    camera.x=(left+right)/2;
    camera.y=(top+bottom)/2;
    lastMapKey='';
    computeTransform();
  }
  function computeTransform() {
    const area = cameraArea(), base = basePitch();
    const tile = base * camera.zoom, w = D.MAP_W * tile, h = D.MAP_H * tile;
    camera.x = clamp(camera.x, 0, D.MAP_W);
    camera.y = clamp(camera.y, 0, D.MAP_H);
    let x = area.w / 2 - camera.x * tile, y = area.h / 2 - camera.y * tile + area.top;
    x = w < area.w ? (area.w - w) / 2 : clamp(x, area.w - w - 10, 10);
    y = h < area.h ? (area.h - h) / 2 + area.top : clamp(y, area.h - h + area.top - 10, area.top);
    transform = {
      x,
      y,
      tile
    };
  }
  function mapPoint(px, py) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (px - r.left - transform.x) / transform.tile,
      y: (py - r.top - transform.y) / transform.tile
    };
  }
  function pxToCell(px, py) {
    if (!canvas || !lastState || lastState.screen !== 'run')
      return null;
    const r = canvas.getBoundingClientRect();
    if (px < r.left || py < r.top || px >= r.left + r.width || py >= r.top + r.height)
      return null;
    const p = mapPoint(px, py), x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H)
      return null;
    return {
      col: D.MAP_X + x,
      row: D.MAP_Y + y
    };
  }
  // Redacted scene model: hidden terrain and ore never reach the art engine.
  function mapModel(run) {
    const tiles = [], biome = Math.min(7, Math.max(0, run.depth - 1));
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (!t.revealed) {
          tiles.push(null);
          continue;
        }
        let edges = 0;
        [
          0,
          3,
          2,
          1
        ].forEach((dir, i) => {
          const d = D.DIRS[dir], n = run.grid[y + d.dy] && run.grid[y + d.dy][x + d.dx];
          if (n && n.revealed && n.t !== t.t)
            edges |= 1 << i;
        });
        tiles.push({
          x,
          y,
          kind: t.t,
          ore: t.ore || null,
          rubble: !!t.rubble,
          biome,
          edges,
          variant: (Math.imul(x + 1, 31) ^ Math.imul(y + 1, 17) ^ run.seed) >>> 0 & 7,
          lm: t.lm ? { id: t.lm.id } : null
        });
      }
    return tiles;
  }
  function cachedSprite(id, w, h, o) {
    const key=JSON.stringify([id,o]);
    let cv = spriteCache.get(key);
    if (!cv) {
      cv = root.document.createElement('canvas');
      const name=A.SUBJECTS[id] || (id==='hub'?'rig':id),rows=DC.Pixels.ART[name];
      const pitch=rows?Math.max(rows.length,...rows.map(row=>row.length)):24;
      cv.width=pitch;
      cv.height=pitch;
      const c = cv.getContext('2d');
      A.sprite(c, id, 0, 0, cv.width, cv.height, o);
      const pixels = () => Array.from(spriteCache.values()).reduce((n, v) => n + v.width * v.height, 0);
      while (spriteCache.size && (spriteCache.size >= 180 || pixels() + cv.width * cv.height > 12000000))
        spriteCache.delete(spriteCache.keys().next().value);
      spriteCache.set(key, cv);
    }
    return cv;
  }
  function drawSprite(id, x, y, w, h, o) {
    ctx.drawImage(cachedSprite(id, w, h, o || {}), x, y, w, h);
  }
  function terrain(run, s) {
    const tiles = mapModel(run), key = JSON.stringify([
        Math.round(s * viewport.dpr * 100),
        tiles
      ]);
    if (key === surfaceKey && surface)
      return surface;
    // Integer source tiles prevent hairline seams between adjacent rock/floor
    // faces at fractional zoom. The composed texture still scales as a whole.
    const pitch=Math.max(1,Math.min(Math.round(s*viewport.dpr),Math.floor(Math.sqrt(12000000/(D.MAP_W*D.MAP_H)))));
    surface = root.document.createElement('canvas');
    surface.width = D.MAP_W * pitch;
    surface.height = D.MAP_H * pitch;
    const c = surface.getContext('2d');
    c.fillStyle = '#090f24';
    c.fillRect(0, 0, surface.width, surface.height);
    for (const t of tiles)
      if (t)
        A.tile(c, t, t.x * pitch, t.y * pitch, pitch);
    surfaceKey = key;
    terrainBuilds++;
    return surface;
  }
  function visible(run, x, y) {
    return !!(run.grid[y] && run.grid[y][x] && run.grid[y][x].revealed);
  }
  function drawWorld(st) {
    const run = st.run, ui = st.ui;
    if (!run)
      return;
    if (lastRun !== run || lastDepth !== run.depth) {
      lastRun = run;
      lastDepth = run.depth;
      camera.x = run.hub.x + 1.5;
      camera.y = run.hub.y + 1.5;
      cameraMode = 'work';
      lastCursor = '';
      workCamera(run);
      surfaceKey = '';
      lastMapKey = '';
    }
    const cp = ui.hover || ui.cursor, cpKey = ui.cursor ? ui.cursor.x + ',' + ui.cursor.y : '';
    // A dead zone keeps ordinary keyboard movement steady. Pan only as the
    // cursor approaches an edge; never recenter because the mouse left a UI.
    if (camera.zoom > 1 && cp && cpKey !== lastCursor && lastCursor && !ui.hover && !pan) {
      const a=cameraArea(), px=transform.x+(cp.x+.5)*transform.tile, py=transform.y+(cp.y+.5)*transform.tile;
      if(px<48)camera.x-=(48-px)/transform.tile;
      if(px>a.w-48)camera.x+=(px-a.w+48)/transform.tile;
      if(py<a.top+24)camera.y-=(a.top+24-py)/transform.tile;
      if(py>a.top+a.h-24)camera.y+=(py-a.top-a.h+24)/transform.tile;
    }
    lastCursor = cpKey;
    computeTransform();
    const s = transform.tile, x0 = transform.x, y0 = transform.y;
    const key = JSON.stringify([
      run.t,
      run.totalT,
      run.status,
      run.depth,
      ui.tool,
      ui.facing,
      ui.hover,
      ui.cursor,
      ui.paused,
      ui.shakeUntil,
      camera,
      viewport,
      fieldWidth,
      hudTop,
      run.nextId,
      run.gearsFed,
      run.inv.ironPlate
    ]);
    if (key === lastMapKey)
      return;
    lastMapKey = key;
    mapBuilds++;
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle = '#0b152b';
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, D.MAP_W * s, D.MAP_H * s);
    ctx.clip();
    const shaking = !reduced && ui.shakeUntil && run.t < ui.shakeUntil;
    ctx.translate(x0 + (shaking ? run.t % 2 ? 2 : -2 : 0), y0);
    ctx.drawImage(terrain(run, s), 0, 0, D.MAP_W * s, D.MAP_H * s);
    // Clip all objects to revealed tiles, including partially seen landmarks.
    ctx.save();
    ctx.beginPath();
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++)
        if (visible(run, x, y))
          ctx.rect(x * s, y * s, s + 0.1, s + 0.1);
    ctx.clip();
    const lm = run.landmark, ld = lm && D.LANDMARK_BY_ID[lm.id];
    if (ld && ld.quakeSafe) {
      ctx.fillStyle = '#e9c67516';
      ctx.beginPath();
      ctx.ellipse((lm.cx + 0.5) * s, (lm.cy + 0.5) * s, ld.aura.r * s, ld.aura.r * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Belts have a clear physical lane and travel arrow; cargo is a sprite.
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        const t = run.grid[y][x];
        if (!t.revealed)
          continue;
        if (t.belt) {
          const b = t.belt;
          ctx.save();
          ctx.translate((x + 0.5) * s, (y + 0.5) * s);
          ctx.rotate((b.dir - 1) * Math.PI / 2);
          const p = A.canvasPen(ctx, -s / 2, -s / 2, s, s);
          p.rect(0, 15, 100, 70, '#0e1d34');
          p.rect(0, 24, 100, 52, '#396282');
          p.rect(0, 19, 100, 5, '#8ec7de');
          p.rect(0, 76, 100, 5, '#65a4c1');
          for (let i = 0; i < 4; i++)
            p.line([
              [
                i * 29 - 12,
                29
              ],
              [
                i * 29,
                50
              ],
              [
                i * 29 - 12,
                71
              ]
            ], '#233d5c', 4);
          A.arrow(p, 1, '#aedbef', 57, 50, 19);
          ctx.restore();
          if (b.item)
            drawSprite(b.item, (x + 0.19) * s, (y + 0.16) * s, s * 0.64, s * 0.64, {});
        }
        if (t.lm && (!ld || !ld.art))
          drawSprite(t.lm.id, x * s, y * s, s, s, { active: !!(lm && lm.on) });
        if (t.digT > 0) {
          ctx.strokeStyle = '#edce81';
          ctx.lineWidth = 2;
          ctx.strokeRect(x * s + 2, y * s + 2, s - 4, s - 4);
          const total = t.rubble ? D.DIG_RUBBLE : D.DIG_ROCK;
          ctx.fillStyle = '#edce81';
          ctx.fillRect(x * s + 2, (y + 1) * s - 4, (s - 4) * clamp(1 - t.digT / total, 0, 1), 2);
        }
      }
    if (lm && ld && ld.art) {
      const w = ld.art[0].length, h = ld.art.length;
      drawSprite(lm.id, lm.x * s, lm.y * s, w * s, h * s, { active: !!lm.on });
    }
    const req = run.breachReq, feeding = run.status !== 'dead' && (run.gearsFed < req.gear && run.inv.gear > 0 || run.gearsFed >= req.gear && run.chargesFed < req.charge && run.inv.charge > 0);
    for (const m of Object.values(run.machines)) {
      if (m.type === 'hub' || !visible(run, m.x, m.y))
        continue;
      const active = m.status === 'ok', phase = active && !reduced ? Math.floor((m.progress || run.t) / 2) % 3 : 0;
      if (active && ['smelter','assembler','damper'].includes(m.type)) {
        ctx.fillStyle=m.type==='smelter'?'#ffac431a':m.type==='damper'?'#60ffd01a':'#70daff15';
        ctx.beginPath();
        ctx.ellipse((m.x+m.w/2)*s,(m.y+m.h*.75)*s,m.w*s*.7,m.h*s*.5,0,0,Math.PI*2);
        ctx.fill();
      }
      drawSprite(m.type, m.x * s, m.y * s, m.w * s, m.h * s, {
        active,
        phase,
        mode: m.mode,
        filterColor: D.ITEMS[m.filter] ? D.ITEMS[m.filter].color : null
      });
      const outs = DC.Sim.outputTiles(run, m) || [];
      for (const out of outs) {
        if (!visible(run, out.x, out.y))
          continue;
        let dir = m.facing;
        for (let i = 0; i < 4; i++) {
          const d = D.DIRS[i];
          if (d.dx < 0 && out.x < m.x || d.dx > 0 && out.x >= m.x + m.w || d.dy < 0 && out.y < m.y || d.dy > 0 && out.y >= m.y + m.h)
            dir = i;
        }
        // Mark the output port on the machine itself. Never paint over the
        // item already travelling on its receiving belt.
        const px = dir === 1 ? m.x + m.w - 0.14 : dir === 3 ? m.x + 0.14 : clamp(out.x + 0.5, m.x + 0.5, m.x + m.w - 0.5);
        const py = dir === 2 ? m.y + m.h - 0.14 : dir === 0 ? m.y + 0.14 : clamp(out.y + 0.5, m.y + 0.5, m.y + m.h - 0.5);
        const p = A.canvasPen(ctx, (px - 0.5) * s, (py - 0.5) * s, s, s);
        A.arrow(p, dir, '#ffe17e', 50, 50, 23);
      }
      const bad = [
        'nofuel',
        'blocked',
        'depleted',
        'unpaired',
        'cold'
      ].includes(m.status);
      if (bad || m.hp === 1) {
        const p = A.canvasPen(ctx, (m.x + m.w - 0.35) * s, (m.y - 0.12) * s, s * 0.48, s * 0.48);
        p.poly([
          [
            50,
            4
          ],
          [
            98,
            89
          ],
          [
            2,
            89
          ]
        ], '#e5af62', A.P.ink, 5);
        p.rect(44, 29, 12, 30, A.P.ink);
        p.rect(44, 68, 12, 10, A.P.ink);
      }
    }
    drawSprite('hub', run.hub.x * s, run.hub.y * s, 3 * s, 3 * s, {
      active: feeding,
      phase: feeding && !reduced ? Math.floor(run.t / (run.overdrive ? 1 : 2)) % 3 : 0,
      upgrades: st.meta.upgrades,
      accent: livery(st.meta)
    });
    if (run.status === 'breachReady') {
      ctx.strokeStyle = '#7dffe0';
      ctx.lineWidth = 3;
      ctx.strokeRect(run.hub.x * s - 2, run.hub.y * s - 2, 3 * s + 4, 3 * s + 4);
    }
    const critters = run.critters;
    if (critters) {
      if (critters.toad && !critters.toad.gone)
        drawSprite('toad', critters.toad.x * s, critters.toad.y * s, 2 * s, 2 * s, {});
      for (const l of critters.lures || []) {
        drawSprite('coal', l.x * s, l.y * s, s, s);
        ctx.strokeStyle = '#e8c87f';
        ctx.lineWidth = 1;
        ctx.strokeRect(l.x * s + 2, l.y * s + 2, s - 4, s - 4);
      }
      const cells = DC.Worms.cells(run);
      for (let i = cells.length - 1; i >= 0; i--) {
        const q = cells[i];
        if (!visible(run, q.x, q.y))
          continue;
        const p = A.canvasPen(ctx, q.x * s, q.y * s, s, s);
        p.oval(50, 50, q.head ? 40 : 30, q.head ? 38 : 25, q.head ? '#edb7a2' : '#b37b7b', A.P.ink, 3);
        if (q.head) {
          p.oval(37, 35, 4, 5, A.P.ink);
          p.oval(60, 35, 4, 5, A.P.ink);
        }
      }
    }
    const cat = DC.Events.cat(run);
    if (cat && visible(run, cat.x, cat.y))
      drawSprite('cat', cat.x * s, cat.y * s, s, s, {});
    drawFeedback(run,s);
    ctx.restore();
    // Tutorial target is always on the map; the lesson is on the desk, never
    // an opaque speech balloon over the tile the player needs to click.
    const tutorial = DC.Tutorial.layout(run);
    if (tutorial) {
      for (const q of [
          tutorial.target,
          tutorial.from
        ])
        if (q && visible(run, q.x, q.y)) {
          ctx.strokeStyle = '#ffe290';
          ctx.lineWidth = 3;
          ctx.strokeRect(q.x * s + 1, q.y * s + 1, s - 2, s - 2);
        }
    }
    if (cp && visible(run, cp.x, cp.y)) {
      const b = D.BUILDINGS[ui.tool], valid = b && DC.Sim.canPlace(run, ui.tool, cp.x, cp.y, ui.facing).ok;
      const color = ui.tool === 'demolish' ? '#f0a18b' : b ? valid ? '#c0df9c' : '#eda18b' : '#e9dfb2', w = b ? b.w : 1, h = b ? b.h : 1;
      ctx.fillStyle = ui.tool ? color + '28' : '#e9dfb217';
      ctx.fillRect(cp.x * s, cp.y * s, w * s, h * s);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(cp.x * s + 0.5, cp.y * s + 0.5, w * s - 1, h * s - 1);
      if (b) {
        ctx.globalAlpha = 0.7;
        drawSprite(ui.tool, cp.x * s, cp.y * s, b.w * s, b.h * s, { facing: ui.facing });
        ctx.globalAlpha = 1;
        const probe = {
          type: ui.tool,
          x: cp.x,
          y: cp.y,
          w: b.w,
          h: b.h,
          facing: ui.facing,
          mode: 'out',
          pair: 0,
          out: []
        };
        for (const q of DC.Sim.outputTiles(run, probe) || []) {
          if (!visible(run, q.x, q.y))
            continue;
          const p = A.canvasPen(ctx, q.x * s, q.y * s, s, s);
          let dir = ui.facing;
          if (ui.tool === 'splitter')
            for (let d = 0; d < 4; d++)
              if (cp.x + D.DIRS[d].dx === q.x && cp.y + D.DIRS[d].dy === q.y)
                dir = d;
          A.arrow(p, dir, color, 50, 50, 40);
        }
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#6ca4bc66';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, D.MAP_W * s + 1, D.MAP_H * s + 1);
  }
  function drawScenes() {
    if (!nodes.pages)
      return;
    for (const cv of nodes.pages.querySelectorAll('canvas[data-scene]')) {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height)
        continue;
      // Fixed low-resolution art surfaces, nearest-neighbour scaled by CSS.
      // The document text remains native and sharp at every zoom level.
      const w=Math.max(96,Math.min(480,Math.round(r.width/3))),h=Math.max(1,Math.round(w*r.height/r.width));
      const key = [
        w,
        h,
        cv.dataset.scene,
        cv.dataset.options,
        portraitReady,
        titleBackdropReady
      ].join('|');
      if (cv._sceneKey === key)
        continue;
      cv.width = w;
      cv.height = h;
      const context=cv.getContext('2d');context.imageSmoothingEnabled=false;
      A.scene(context, cv.dataset.scene, w, h, Object.assign(JSON.parse(cv.dataset.options || '{}'),{portrait:portraitReady?portraitImage:null,backdrop:titleBackdropReady?titleBackdrop:null}));
      cv._sceneKey = key;
    }
  }
  function topbar(st) {
    const run = st.screen === 'run' && st.run, s = run && strata(run.depth);
    const fullscreen=root.document.fullscreenEnabled ? '<button type="button" data-action="fullscreen" aria-label="'+(root.document.fullscreenElement?'Exit full screen':'Full screen')+'" title="'+(root.document.fullscreenElement?'Exit full screen':'Full screen')+'">'+icon('fullscreen')+'</button>' : '';
    if(st.screen==='title')return '<div class="title-utilities"><button type="button" data-key="m" aria-label="'+(st.meta.muted?'Unmute':'Mute')+' audio" title="Sound / M">'+icon(st.meta.muted?'muted':'sound')+'</button><button type="button" data-progress aria-label="Progress / backup" title="Progress / backup">'+icon('book')+'</button>'+fullscreen+'</div>';
    if(run){
      const control=(key,subject,label)=>'<button type="button" data-key="'+key+'" aria-label="'+label+'" title="'+label+'">'+icon(subject)+'</button>';
      return '<div class="shaft-marker"><b class="depth-badge"><small>STRATUM</small>'+String(run.depth).padStart(2,'0')+'</b><div><h3>'+esc(title(s.name).replace(/†/g,''))+'</h3><span>\u2212'+number(run.depth*D.DEPTH_M)+' m <i> / </i> '+time(run.totalT/D.TICK_HZ)+'</span></div></div>'+
        '<div class="top-actions">'+control('m',st.meta.muted?'muted':'sound',st.meta.muted?'Unmute audio (M)':'Mute audio (M)')+control('h','book','Manual (H)')+control(' ','pause','Pause (Space)')+fullscreen+'</div>';
    }
    return '<div class="wordmark">' + icon('bit') + '<div>DEEPCORE<small>MINING CONCERN</small></div></div><span class="eyebrow">Bedrock / Graphical edition</span><div class="top-actions"><button data-key="m" aria-label="' + (st.meta.muted ? 'Unmute' : 'Mute') + ' audio">' + icon(st.meta.muted ? 'muted' : 'sound') + '<span class="mute-label">' + (st.meta.muted ? 'Sound off' : 'Sound on') + '</span></button>' + (st.screen === 'title' ? '<button type="button" data-progress>Progress</button>' + button('Manual', 'h', 'quiet') : button('Back', 'Escape', 'quiet', [
      'descend',
      'vignette'
    ].includes(st.screen))) + fullscreen + '</div>';
  }
  function resources(st) {
    const run = st.run, tut = DC.Tutorial.layout(run), focus = tut && tut.panels ? tut.beat === 'feed' ? 'gear' : 'ironOre' : null;
    return D.ITEM_ORDER.map(id => {
      const label=esc(D.ITEMS[id].name+': '+number(run.inv[id]));
      return '<div class="resource ' + (run.inv[id] || 0 ? '' : 'empty') + (focus === id ? ' tutor-focus' : '') + (gains[id] ? ' gained' : '') + '" style="--resource:'+itemColors[id]+'" role="group" aria-label="'+label+'" title="'+label+'">' + icon(id) + '<div><b>' + stockNumber(run.inv[id]) + '</b><span class="label">' + esc(title(D.ITEMS[id].name)) + '</span></div></div>';
    }).join('');
  }
  function chain(run) {
    if (modelCache.run !== run || modelCache.t !== run.t) {
      modelCache = {
        run,
        t: run.t,
        chain: DC.Sim.chain(run),
        rate: DC.Sim.feedRate(run)
      };
    }
    return modelCache.chain;
  }
  function rigPanel(st) {
    const r = st.run, req = r.breachReq, ch = chain(r), fr = modelCache.rate || {};
    const active = r.stats && r.stats.lastFeedT > 0 && r.totalT - r.stats.lastFeedT < 2 * D.TICK_HZ;
    const ready = r.status === 'breachReady', reserve = DC.Sim.departureReserve();
    const warning = ready ? 'Machines stay here. Pack ' + reserve + ' iron plates for the next floor.' : DC.Sim.supplyWarning(r) ? 'No plates? Reclaim a misplaced machine with X.' : r.overdrive ? D.OVERDRIVE.drillMult + '\u00d7 feed. Pressure rises faster. Keep an eye on the hull.' : 'Gears auto-feed from stock. Deliver production to the rig by belt.';
    const meter = (label,value,max,cls) => '<div class="cockpit-meter"><div class="meter-label"><span>'+label+'</span><strong>'+value+'<small> / '+max+'</small></strong></div>'+segmentedMeter(label,value,max,cls)+'</div>';
    return '<section class="rig-panel '+(ready?'ready':r.overdrive?'overdriving':'')+'"><div class="rig-head">' + icon('rig', {
      active: !!active,
      upgrades: st.meta.upgrades,
      accent: livery(st.meta)
    }) + '<div><div class="eyebrow">Drill control</div><h3>' + (ready ? 'BREACH READY!' : r.overdrive ? 'OVERDRIVE!' : 'FEED THE DRILL') + '</h3></div></div>' +
      '<div class="rig-health">'+meter('Hull',Math.max(0,Math.ceil(r.integrity)),r.maxIntegrity,r.integrity<30?'warn':'')+pressureDial(r.instability)+'</div>'+
      '<div class="rig-feed">'+meter('Drill gears',r.gearsFed,req.gear,'gold')+(req.charge?meter('Core charges',r.chargesFed,req.charge,'charge'):'')+'</div>'+
      '<div class="drill-actions"><button type="button" data-key="c" class="drive-switch" aria-pressed="'+!!r.overdrive+'" title="'+D.OVERDRIVE.drillMult+'x gear/charge feed; higher pressure. No stock, no speed gain."><i class="switch-track" aria-hidden="true"><i></i></i><span>Overdrive<small>'+ (r.overdrive?'ENGAGED':'OFF')+' <kbd>C</kbd></small></span></button>'+
      '<button type="button" data-key="d" class="breach-trigger'+(ready?' armed':'')+'" title="'+(ready?'Breach the floor. Machines stay behind.':'Feed the required gears and charges to unlock descent.')+'"'+(ready?'':' disabled')+'>'+icon('down')+'<span>'+(ready?'BREACH!':'Descend')+'<small>'+(ready?'READY':'LOCKED')+'</small></span><kbd>D</kbd></button></div>'+
      '<div class="rig-readout"><span class="feed-rate">'+(ready?'READY TO BREACH':(fr.gearPerSec||0).toFixed(1)+' gears/s'+(req.charge?' · '+(fr.chargePerSec||0).toFixed(1)+' charges/s':'')+(ch.breachSec!=null&&isFinite(ch.breachSec)?' · ~'+time(ch.breachSec):''))+'</span><span>'+esc(warning)+'</span></div></section>';
  }
  function segmentedMeter(label,value,max,cls) {
    const fraction=clamp(max?value/max:1,0,1);
    return '<div class="instrument-segments '+(cls||'')+'" role="meter" aria-label="'+label+'" aria-valuemin="0" aria-valuemax="'+Math.max(1,max)+'" aria-valuenow="'+clamp(value,0,Math.max(1,max))+'">'+
      Array.from({length:20},(_,i)=>'<i aria-hidden="true" style="--fill:'+clamp((fraction*20-i)*100,0,100)+'%"></i>').join('')+'</div>';
  }
  function pressureDial(value) {
    const v=clamp(value,0,100), point=(fraction,radius)=>{
      const angle=Math.PI*(1-fraction);
      return (48+Math.cos(angle)*radius).toFixed(2)+','+(48-Math.sin(angle)*radius).toFixed(2);
    };
    const ticks=Array.from({length:11},(_,i)=>'<path d="M'+point(i/10,34)+' L'+point(i/10,40)+'" stroke="'+(i*10>=D.QUAKE.startInst?'#e99678':'#718789')+'"/>').join('');
    return '<div class="pressure-dial'+(v>=D.QUAKE.startInst?' danger':'')+'" role="meter" aria-label="Pressure" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+v+'">'+
      '<span>Pressure</span><svg viewBox="0 0 96 58" aria-hidden="true"><g fill="none" stroke-width="3">'+ticks+'<path d="M48,48 L'+point(v/100,30)+'" stroke="'+(v>=D.QUAKE.startInst?'#e99678':'#f4c96b')+'"/></g><path d="M44 44h8v8h-8z" fill="#f4c96b"/></svg><strong>'+Math.floor(v)+'%</strong></div>';
  }
  function tutorial(st) {
    const T = DC.Tutorial, r = st.run;
    if (!T.active(r) || !T.layout(r))
      return '';
    const spans = list => (list || []).map(s => s[0] === 'cap' ? '<kbd>' + esc(clean(s[1])) + '</kbd>' : esc(clean(s[1])) + ' ').join('');
    return '<section class="panel tutor"><div class="row">' + icon('grit', { talking: true }) + '<div><div class="eyebrow">Grit / field radio</div><h3>' + esc(clean(T.title(r))) + '</h3></div></div><p>' + esc(T.line(r)) + '</p><div class="tutor-action">' + spans(T.action(r)) + '</div><div class="tutor-warning">' + spans(T.warn(r)) + '</div><div class="small muted">' + spans(T.foot(r)) + '</div>' + '<div class="lesson">' + T.stamps(r).map(s => '<i class="' + (s.done ? 'done' : s.cur ? 'current' : '') + '"></i>').join('') + '</div><div class="lesson-footer">' + button('Skip induction', D.TUTORIAL.skipKey, 'quiet') + '</div></section>';
  }
  function chainPanel(st) {
    const r = st.run, c = chain(r), tabs = [
        'chain',
        'loadout',
        'journal'
      ];
    let content = '';
    if (panelTab === 'chain')
      content = c.stages.map(s => '<div class="chain-stage">' + icon(s.item) + '<div><strong class="small">' + esc(title(s.name)) + '</strong><small>' + s.n + ' ' + (s.n === 1 ? 'machine' : 'machines') + '</small></div><div class="amount small">' + s.rate.toFixed(2) + '/s' + (s.flag ? '<small><em>' + esc(s.flag === 'NONE' ? 'NOT BUILT' : s.flag) + '</em></small>' : '') + '</div></div>').join('') + '<p class="supply-note">Ore into plates. Plates into gears. Gears into depth.</p>';
    if (panelTab === 'journal')
      content = '<div class="journal">' + r.messages.slice(-15).reverse().map(m => '<p>' + esc(clean(m.text)) + '</p>').join('') + '</div>';
    if (panelTab === 'loadout')
      content = '<div class="loadout">' + (r.schematics.length ? r.schematics.map(id => {
        const d = D.SCHEMATICS.find(s => s.id === id);
        return d ? '<div class="row">' + icon(id) + '<div><strong class="small">' + esc(d.name) + '</strong><p>' + esc(d.desc) + '</p></div></div>' : '';
      }).join('') : '<p>New schematics arrive with each breach. Choose one for the rest of this run.</p>') + '</div>';
    return '<section class="panel"><div class="tabs" role="group" aria-label="Operations detail">' + tabs.map(t => action(title(t), 'tab:' + t, t === panelTab ? 'active' : '')).join('') + '</div>' + content + '</section>';
  }
  function inspector(st) {
    const r = st.run, u = st.ui, q = u.hover || u.cursor, b = D.BUILDINGS[u.tool];
    let subject = 'inspect', name = 'Stratum survey', lines = [];
    if (b) {
      subject = u.tool;
      name = b.name;
      lines = [
        b.desc,
        'Cost: ' + (u.tool === 'belt' && r.mods.beltFree ? 'free' : costText(b.cost)),
        directions[u.facing] + ' output. Rotate with R.'
      ];
      if (q) {
        const c = DC.Sim.canPlace(r, u.tool, q.x, q.y, u.facing);
        if (!c.ok && c.reason)
          lines.push(c.reason);
      }
    } else if (u.tool === 'demolish') {
      subject = 'demolish';
      name = 'Dig / reclaim';
      lines = [
        'Click rock to dig, rubble to clear, or a machine to reclaim it.',
        'Intact new machines refund in full for ' + D.UNDO_TICKS / D.TICK_HZ + ' seconds.'
      ];
    } else if (q) {
      const t = r.grid[q.y] && r.grid[q.y][q.x];
      if (t && t.revealed) {
        const m = t.machine && r.machines[t.machine];
        subject = t.machine === 0 ? 'hub' : m ? m.type : t.lm ? t.lm.id : t.ore || t.t;
        name = m ? D.BUILDINGS[m.type].name : t.machine === 0 ? 'Drill rig' : t.lm ? (D.LANDMARK_BY_ID[t.lm.id] || {}).name : t.ore ? D.ITEMS[t.ore].name : title(t.t);
        lines = DC.Sim.describeTile(r, q.x, q.y).map(v => clean(v.text));
      } else
        lines = ['Unsurveyed ground. The rig\u2019s scan reveals the surrounding stratum.'];
    }
    return '<section class="panel inspection"><div class="row">' + icon(subject) + '<div><div class="eyebrow">' + (q ? 'Survey ' + q.x + ' / ' + q.y : 'Survey') + '</div><h3>' + esc(title(name)) + '</h3></div></div>' + lines.map(l => '<p>' + esc(l) + '</p>').join('') + (!u.tool && q && visible(r, q.x, q.y) ? '<div style="margin-top:10px">' + action('Interact <kbd>Enter</kbd>', 'context', 'quiet') + '</div>' : '') + '</section>';
  }
  function foreman(st) {
    const f = st.run.foreman;
    if (!f || !f.text || st.run.totalT > (f.until || 0) + 2 * D.TICK_HZ)
      return '';
    const core = f.voice === 'core', count = Math.floor((st.run.totalT - (f.t0 || 0)) * (core ? 1 : 2));
    return '<div class="foreman ' + (core ? 'core' : '') + '">' + icon(core ? 'crystal' : 'grit', { talking: count < f.text.length }) + '<div><div class="eyebrow">' + (core ? 'Unidentified transmission' : 'Foreman Grit') + '</div><p>' + esc(f.text.slice(0, Math.max(0, count))) + '</p></div></div>';
  }
  function toolbelt(st) {
    const r = st.run, u = st.ui;
    return '<div class="build-tools">'+D.BUILD_ORDER.filter(id => DC.Sim.unlocked(r, id)).map(id => {
      const b = D.BUILDINGS[id], free = id === 'belt' && r.mods.beltFree, afford = free || Object.keys(b.cost).every(k => (r.inv[k] || 0) >= b.cost[k]);
      return '<button class="tool ' + (u.tool === id ? 'selected ' : '') + (!afford ? 'unaffordable' : '') + '" data-key="' + b.key + '" aria-pressed="' + (u.tool === id) + '" title="' + esc(b.desc + ' Cost: ' + (free ? 'free' : costText(b.cost))) + '">' + icon(id) + '<span class="tool-name">' + esc(b.name) + '</span><span class="cost" aria-label="Cost: '+esc(free?'free':costText(b.cost))+'">' + (free ? 'Free' : costIcons(b.cost)) + '</span><kbd>' + b.key + '</kbd></button>';
    }).join('') + '</div><div class="tool-group">' + action(icon('inspect') + 'Inspect', 'inspect', u.tool ? '' : 'selected') + '<button data-key="x" class="' + (u.tool === 'demolish' ? 'selected' : '') + '">' + icon('demolish') + 'Dig / reclaim <kbd>X</kbd></button><button data-key="r" title="Rotate output direction">' + icon('rotate') + directions[u.facing] + ' <kbd>R</kbd></button></div>';
  }
  function runUI(st) {
    const r = st.run, s = strata(r.depth), mut = DC.Sim.mutatorOf(r);
    if (lastRun!==r || lastDepth!==r.depth) { detailOpen=false; lastLesson=''; }
    const lesson=tutorial(st);
    put('resources', resources(st));
    put('operations', rigPanel(st));
    const detail=detailOpen?'<div class="detail-heading"><span class="eyebrow">Shift information</span>'+action('Close','close-details')+'</div>'+chainPanel(st):'';
    put('field-notes', detail || lesson || inspector(st) + foreman(st));
    const field=nodes['field-notes'];
    field.classList.toggle('show-detail',detailOpen);
    field.classList.toggle('teaching',!!lesson&&!detailOpen);
    const priorWidth=fieldWidth;
    const fieldRect=field.getBoundingClientRect();
    fieldWidth=fieldRect.width?fieldRect.width+24:0;
    const lessonKey=lesson?DC.Tutorial.title(r):'';
    if(cameraMode==='work'&&(priorWidth!==fieldWidth||lessonKey!==lastLesson))workCamera(r);
    lastLesson=lessonKey;
    const detailsButton=nodes['map-controls'].querySelector('[data-action="details"]');
    detailsButton.setAttribute('aria-expanded',String(detailOpen));
    detailsButton.setAttribute('aria-controls','field-notes');
    put('toolbelt', toolbelt(st));
    // A scrollable belt keeps names and prices readable on a small display.
    // Reveal a keyboard-selected tool once; do not fight manual scrolling.
    if(lastTool!==st.ui.tool){
      lastTool=st.ui.tool;
      const selected=nodes.toolbelt.querySelector('.tool.selected');
      if(selected)selected.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    put('map-caption', esc(mut ? mut.name + ' / ' + mut.tag : s.tag));
    const flash = st.ui.flash && st.ui.flash.until > r.t ? clean(st.ui.flash.text) : '';
    const offer = r.coreOffer && r.totalT < r.coreOffer.until;
    put('statusbar', '<span>' + esc(offer ? 'ENTER \xB7 ASCEND' : flash || 'Click to interact \xB7 drag to lay belts \xB7 arrows move cursor \xB7 Enter acts') + '</span><span>Scroll to zoom \xB7 right-drag to pan \xB7 ' + Math.round(camera.zoom * 100) + '%</span>');
  }
  function titlePage(st) {
    const m = st.meta, eligible = DC.Tutorial.eligible(m), hist = (m.dailyHistory || []).find(h => h.date === st.today);
    const entries=[
      {key:'Enter',name:'DIG IN',sub:'Begin a new shift',info:eligible?'Your first shift. GRIT will show you the ropes.':'A fresh shaft. Build the line. Feed the drill. Reach the Core.'},
      {key:'t',name:'DAILY SHAFT',sub:hist?'Practice today\u2019s shaft':'One ranked shot',info:'Daily '+st.today+' · '+(hist?'Ranked: stratum '+hist.depth+' in '+time(hist.timeSec)+'. Replay is practice.':'Same seed for everyone. One ranked attempt today.')},
      {key:'f',name:'THE FOUNDRY',sub:'Permanent rig upgrades',info:number(m.cores)+' cores banked. Improvements travel with you into every shaft.'},
      {key:'h',name:'FIELD MANUAL',sub:'Machines, recipes & survival',info:'Ore into plates. Plates into gears. Gears into depth.'}
    ];
    if(!eligible)entries.push({key:'i',name:'REPLAY INDUCTION',sub:'A refresher with GRIT',info:'Eight practical lessons, on a real shaft. Skip whenever you like.'});
    const installed=D.META_UPGRADES.filter(u=>m.upgrades[u.id]>0).length,lv=DC.Meta.liveries(m).find(v=>v.id===DC.Meta.livery(m));
    return '<div class="title-screen">'+scene('shaft-house',{
      upgrades: m.upgrades,
      accent: livery(m),
      cat: !!m.catFound
    },'title-scene')+'<div class="title-content"><div class="title-kicker">A VERY LONG WAY DOWN</div><h1 class="title-mark" aria-label="Deepcore">DEEP<span>CORE</span></h1><p class="title-tagline">Eight strata. One very hungry drill.</p><nav id="title-menu" aria-label="Main menu">'+entries.map(e=>'<button type="button" data-key="'+e.key+'" data-brief="'+esc(e.info)+'" class="menu-choice"><i class="menu-cursor" aria-hidden="true"></i><span><strong>'+e.name+'</strong><small>'+e.sub+'</small></span><kbd>'+ (e.key==='Enter'?'Enter':e.key.toUpperCase())+'</kbd></button>').join('')+'</nav><p id="menu-brief" class="menu-brief"></p></div>'+
      '<div class="rig-manifest"><span class="eyebrow">DC / RIG DIVISION</span><strong>'+esc(installed?installed+' modifications fitted':'STOCK RIG · READY')+'</strong><span>'+esc(lv?title(lv.name):'Company amber')+'</span></div>'+
      '<footer class="title-footer"><div class="career-strip" aria-label="Permanent progress"><span>'+icon('crystal')+'<b>'+number(m.cores)+'</b> cores</span><span>'+icon('down')+'<b>'+number(m.bestDepth)+'</b> deepest</span><span>'+icon('trophy')+'<b>'+number(m.wins)+'</b> breaches</span></div><div class="title-edition"><span>BEDROCK EDITION</span><a href="index.html">Engraved / Classic</a></div></footer></div>';
  }
  function contracts(st) {
    return '<div class="page paperwork">' + header('Personnel division / terms of engagement', 'Sign before you descend.', 'Choose your contract. The Company will retain the original.') + '<div class="permit-desk">' + D.CONTRACTS.map((c, i) => {
      const open = DC.Meta.contractUnlocked(st.meta, c.id), won = DC.Meta.contractWon(st.meta, c.id);
      return '<article class="permit permit-'+i+' '+(open?'':'locked ')+(i===(st.ui.contractCursor||0)?'chosen':'')+'">'+
        '<div class="permit-tab">DC / 0'+(i+1)+' <span>OPERATOR COPY</span></div><div class="permit-body">'+
        '<div class="permit-heading"><div><div class="eyebrow">'+esc(c.sub)+'</div><h2>'+esc(title(c.name))+'</h2></div>'+icon(c.id)+'</div>'+
        '<div class="permit-stamp">'+(won?'CONCLUDED':open?'CLEARED':'RESTRICTED')+'</div>'+
        '<div class="permit-terms"><div class="eyebrow">Terms of descent</div><ol>'+c.terms.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ol></div>'+
        '<div class="permit-wage"><span>CORE WAGE<br><small>Payable on return</small></span><strong>\xD7'+Number(c.wage).toFixed(1)+'</strong></div>'+
        '<div class="signature">'+(open?button('Sign & descend',String(i+1),'primary'):'<p>'+esc(c.lockText.replace(/^LOCKED: /,''))+'</p>')+'</div>'+
        '<div class="permit-serial" aria-hidden="true">DC · PERSONNEL · 0'+(i+1)+' / RETAIN FOR YOUR RECORDS</div></div></article>';
    }).join('') + '</div>' + foot('The Company accepts no liability. The Company accepts everything else.', button('Return', 'Escape', 'quiet')) + '</div>';
  }
  function foundry(st) {
    const m = st.meta, liveries = DC.Meta.liveries(m), lv = liveries.find(l => l.id === DC.Meta.livery(m)), next = liveries.find(l => !l.unlocked), fb = st.foundryBark;
    return '<div class="page">' + header('Engineering division / permanent improvements', 'The Foundry', 'Cores hammered into steel. Every purchase travels with you.', '<span class="pill">' + icon('crystal') + number(m.cores) + ' cores</span>') + '<div class="two-col"><div>' + scene('landscape', {
      upgrades: m.upgrades,
      accent: livery(m),
      cat: !!m.catFound
    }, 'showcase') + '<div class="row between" style="margin-top:16px"><div><div class="eyebrow">Rig livery</div><h3>' + esc(lv ? title(lv.name) : 'Company amber') + '</h3></div>' + button('Change', 's', 'quiet') + '</div>' + (next ? '<p class="small muted" style="margin-top:10px">Next: ' + esc(next.unlock) + '</p>' : '') + ((typeof fb === 'string' ? fb : fb && fb.line) ? '<blockquote>' + esc(typeof fb === 'string' ? fb : fb.line) + '</blockquote>' : '') + '</div><div class="upgrades">' + D.META_UPGRADES.map((u, i) => {
      const lvl = m.upgrades[u.id] || 0, max = lvl >= u.max, cost = u.costs[lvl];
      return '<button class="upgrade" data-key="' + 'abcdefghi'[i] + '"' + (max || (m.cores || 0) < cost ? ' disabled' : '') + '>' + icon(u.id) + '<div class="description"><h3>' + esc(u.name) + '</h3><p>' + esc(u.desc) + '</p></div><div class="price">' + (max ? 'Complete' : cost + ' cores') + '<small>' + lvl + ' / ' + u.max + ' &nbsp; <kbd>' + 'ABCDEFGHI'[i] + '</kbd></small></div></button>';
    }).join('') + '</div></div>' + foot('Lifetime cores ' + number(m.totalCores) + ' \xB7 ' + number(m.runs) + ' shifts', button('Trophies', 't', 'quiet') + button('Ledger', 'k', 'quiet') + button('Logbook', 'l', 'quiet') + button('Surface', 'Escape', 'quiet')) + '</div>';
  }
  const trophySubjects = [
    'crystal',
    'clock',
    'shield',
    'radar',
    'bit',
    'cat',
    'book',
    'worm',
    'helmet',
    'leaf',
    'seal',
    'trophy',
    'book',
    'crate',
    'shield',
    'skull'
  ];
  function trophies(st) {
    const have = DC.Meta.trophies(st.meta), list = D.TROPHIES, cur = clamp(st.ui.trophyCursor || 0, 0, list.length - 1), sel = list[cur], earned = have.includes(sel.id);
    return '<div class="page">' + header('Personnel division / commendations on file', 'The trophy shelf', have.length + ' of ' + list.length + ' objects accounted for.') + '<div class="trophy-grid">' + list.map((t, i) => '<button data-trophy="' + i + '" class="trophy ' + (have.includes(t.id) ? '' : 'locked ') + (i === cur ? 'selected' : '') + '" aria-label="Inspect ' + esc(t.name) + '">' + icon(trophySubjects[i] || 'trophy') + '<strong>' + esc(have.includes(t.id) ? t.name : 'Not on file') + '</strong></button>').join('') + '</div><div class="inspection-card"><div class="eyebrow">' + (earned ? 'Commendation awarded' : 'Company requirement') + '</div><h2>' + esc(title(sel.name)) + '</h2><p>' + esc(sel.how) + '</p><blockquote>' + esc(earned ? sel.grit : 'Nothing there. Don\'t touch the dust.') + '</blockquote></div>' + foot('Arrow keys inspect the shelf.', button('Foundry', 'Escape', 'quiet')) + '</div>';
  }
  function ledger(st) {
    return '<div class="page">' + header('Accounts division / form 7-B', 'Lifetime account', 'Retain until death, whichever is sooner.', '<span class="pill accent">Audited</span>') + '<table class="ledger"><thead><tr><th scope="col">Account</th><th scope="col">Recorded</th><th scope="col">Notes</th></tr></thead><tbody>' + DC.Meta.ledger(st.meta).map(r => '<tr><td>' + esc(title(r.label)) + '</td><td class="value">' + esc(clean(r.value)) + '</td><td class="small muted">' + esc(r.note || '') + '</td></tr>').join('') + '</tbody></table>' + foot('Discrepancies are the operator\u2019s. Figures are the Company\u2019s.', button('Foundry', 'Escape', 'quiet')) + '</div>';
  }
  function logbook(st) {
    const found = DC.Meta.logbook(st.meta);
    return '<div class="page">' + header('Recovered documents / archive', 'Dead foremen of the deep', 'What they wrote down before the rock had them. ' + found.length + ' / ' + DC.Events.LOGS.length + ' recovered.') + '<ol class="logs">' + DC.Events.LOGS.map((l, i) => '<li class="' + (found.includes(i) ? '' : 'missing') + '">' + esc(found.includes(i) ? l : 'Record not recovered.') + '</li>').join('') + '</ol>' + foot('Filed by the Company. Remembered by you.', button('Foundry', 'Escape', 'quiet')) + '</div>';
  }
  function vignette(st) {
    const e = DC.Events.pending(st.run);
    if (!e)
      return '<div class="page">' + header('Expedition report', 'The dark has nothing to say.', '') + button('Carry on', 'Enter', 'primary') + '</div>';
    return '<div class="page encounter">' + header('Expedition report / stratum ' + (st.run.depth + 1), title(e.title), '') + '<div class="two-col">' + scene(e.id, {}) + '<div><div class="narrative">' + e.text.map(p => '<p>' + esc(p) + '</p>').join('') + '</div>' + e.choices.map((c, i) => '<button class="choice" data-key="' + (i + 1) + '"><kbd>' + (i + 1) + '</kbd><span><strong>' + esc(c.label) + '</strong><small>' + esc(c.hint || '') + '</small></span></button>').join('') + '</div></div>' + foot('A decision must be recorded before the expedition continues.', '') + '</div>';
  }
  function descent(st) {
    const r = st.run, target = r.depth + 1, len = animLength(), anim = st.ui.descendAnim || 0;
    if (anim < len || !r.pendingOffers)
      return '<div class="page descent-page"><div class="eyebrow">Shaft transit / \u2212' + Math.floor((r.depth + clamp(anim / len, 0, 1)) * D.DEPTH_M) + ' m</div><h1>Descending.</h1><p class="muted">' + esc(title(strata(target).name).replace(/†/g, '')) + '</p>' + scene('descent') + bar(anim, len, 'gold') + '<p class="small muted">' + esc(DC.Art.graffiti[(r.seed + target >>> 0) % DC.Art.graffiti.length] || 'Keep your hands inside the cage.') + '</p></div>';
    return '<div class="page">' + header('Engineering division / recovered schematics', 'Make the next floor yours.', 'Choose one improvement. It stays with your rig for this run.') + '<div class="cards ' + (r.pendingOffers.length === 4 ? 'four' : '') + '">' + r.pendingOffers.map((id, i) => {
      const d = D.SCHEMATICS.find(s => s.id === id);
      return '<article class="card schematic"><div class="card-illustration">' + icon(id) + '</div><div class="card-body"><div class="eyebrow">Drawing ' + String(i + 1).padStart(2, '0') + ' / approved modification</div><h2>' + esc(d.name) + '</h2><p>' + esc(d.desc) + '</p><div class="signature">' + button('Install schematic', String(i + 1), 'primary') + '</div></div></article>';
    }).join('') + '</div>' + foot('Next: ' + title(strata(target).name).replace(/†/g, ''), '') + '</div>';
  }
  function manual(st) {
    const page = clamp(st.ui.helpPage || 0, 0, 2), tabs = [
        'Operate',
        'Survive',
        'Logistics'
      ];
    const article = (heading, content) => '<article><h2>' + heading + '</h2>' + content + '</article>';
    const machine = id => '<div class="manual-machine">' + icon(id) + '<div><h3>' + esc(title(D.BUILDINGS[id].name)) + ' <kbd>' + D.BUILDINGS[id].key + '</kbd></h3><p>' + esc(D.BUILDINGS[id].desc) + '</p><p class="muted">' + esc(costText(D.BUILDINGS[id].cost)) + '</p></div></div>';
    const keys = [
      [
        '1\u20130',
        'Choose a construction tool'
      ],
      [
        'R',
        'Rotate its output before placing'
      ],
      [
        'X',
        'Dig rock, clear rubble, reclaim machines'
      ],
      [
        'Arrows',
        'Move the cursor; Shift moves ' + D.CURSOR_JUMP + ' tiles'
      ],
      [
        'Enter',
        'Build or interact at the cursor; belts enter lay mode'
      ],
      [
        'Escape',
        'Stop laying, clear tool, then pause'
      ],
      [
        'Space',
        'Pause or resume'
      ],
      [
        'C',
        'Toggle overdrive'
      ],
      [
        'D',
        'Descend when breach is ready'
      ],
      [
        'L',
        'Drop a coal lure for vein worms'
      ],
      [
        'H / M',
        'Field manual / mute audio'
      ]
    ];
    const recipe = id => {
      const r = D.RECIPES[id];
      return '<div class="recipe">' + Object.keys(r.in).map(k => '<span>' + r.in[k] + ' ' + icon(k) + '</span>').join('<span>+</span>') + icon('down') + Object.keys(r.out).map(k => '<span>' + r.out[k] + ' ' + icon(k) + '</span>').join('') + '<span class="small">' + r.ticks / D.TICK_HZ + 's' + (r.fuel ? ' \xB7 coal fuel' : '') + '</span></div>';
    };
    let body = '';
    if (page === 0)
      body = article('Build the production line', D.BUILD_ORDER.slice(0, 4).map(machine).join('')) + article('The controls', keys.map(k => '<div class="key-row"><kbd>' + esc(k[0]) + '</kbd><span>' + esc(k[1]) + '</span></div>').join('')) + article('What the drill consumes', '<p>The drill consumes gears from stock automatically; it also needs core charges from stratum 5. Connect belt output to any tile of the rig to deliver materials to stock.</p>' + recipe('gear') + recipe('charge') + '<p>Overdrive feeds the drill \xD7' + D.OVERDRIVE.drillMult + ' faster, but pressure rises \xD7' + D.OVERDRIVE.instMult + ' faster. It does not create fuel or speed up your factory.</p>') + article('The smelter makes your building material', recipe('smeltIron') + recipe('smeltCopper') + '<p>Route ore and coal into the smelter. One coal fuels ' + D.FUEL_PER + ' smelts. Plates delivered to the rig pay for more machines. Plates delivered to an assembler become gears.</p><p>One smelter works; two feed gears faster. PACE means a bottleneck, not starvation. STARVED means zero production.</p>');
    if (page === 1)
      body = article('The ground beneath you', [
        'rock',
        'rubble',
        'obsidian',
        'chasm',
        'magma',
        'worm',
        'toad'
      ].map(id => '<div class="manual-machine">' + icon(id) + '<div><h3>' + title(id === 'toad' ? 'undertoad' : id) + '</h3><p>' + {
        rock: 'Dig with X: ' + D.DIG_ROCK / D.TICK_HZ + ' seconds.',
        rubble: 'Clear with X: ' + D.DIG_RUBBLE / D.TICK_HZ + ' seconds.',
        obsidian: 'Cannot be excavated.',
        chasm: 'Cannot build across it. Tunnels can cross underneath.',
        magma: 'Spreads and damages nearby machines.',
        worm: 'Eats ore and leaves a tunnel. L drops ' + D.WORMS.lureCost + ' coal as bait.',
        toad: 'Sleeping under the rock. Disturb it at your peril.'
      }[id] + '</p></div></div>').join('')) + article('Pressure, damage, and the way down', '<p>Pressure rises from the moment you arrive. Quakes begin above ' + D.QUAKE.startInst + ' instability, damaging the rig and machines. At ' + D.INSTAB_MAX + ' the floor collapses repeatedly.</p><p>A cracked machine runs at half speed. Interact to repair it for ' + D.REPAIR_COST + ' iron plates; the Field Kits upgrade reduces that to one. At zero hull, the run ends.</p>' + machine('damper') + '<p>Descent vents ' + D.DESCEND_VENT + ' pressure. Machines stay on the old floor. Keep at least ' + DC.Sim.departureReserve() + ' iron plates for a new base.</p><p>New intact machines refund in full for ' + D.UNDO_TICKS / D.TICK_HZ + ' seconds. Later salvage is ' + D.DEMOLISH_REFUND * 100 + '% before schematics. The Foundry makes your next rig stronger.</p>');
    if (page === 2)
      body = article('Logistics II \u2014 available from stratum ' + D.BUILDINGS.tunnel.unlockDepth, D.BUILD_ORDER.slice(5).map(machine).join('')) + article('One rule, everywhere', '<p>A belt hands its cargo to the one tile its arrow points at. So does a machine. A splitter simply has more than one output, and a tunnel throws its output underground.</p><p>Nothing collects from a neighbour just because it is a neighbour. Rotate with R before you place; the preview shows output arrows.</p><div class="recipe">' + icon('extractor') + icon('belt') + icon('splitter') + icon('smelter') + '</div><p>One vein, two furnaces: the splitter alternates between its sides.</p><div class="recipe">' + icon('belt') + icon('tunnel') + icon('chasm') + icon('tunnel') + icon('hub') + '</div><p>Two tunnels with matching directions connect across up to ' + D.BUILDINGS.tunnel.gap + ' tiles. An unpaired tunnel signals a fault.</p><p>Click or Enter on a filter to cycle the cargo it accepts. Everything else waits. An assembler uses the same interaction to cycle available recipes.</p>');
    return '<div class="page">' + header('Company issue / field manual', 'Read this before you touch the drill.', 'All costs and operating figures come from the same data as the simulation.') + '<div class="actions" style="margin-bottom:24px">' + tabs.map((t, i) => button(t, String(i + 1), i === page ? 'selected' : 'quiet')).join('') + '</div><div class="manual-grid">' + body + '</div>' + foot('The Company recommends remaining alive for the duration of your shift.', button('Back', 'Escape', 'quiet')) + '</div>';
  }
  function result(st) {
    return st.run.result || {
      depth: st.run.depth,
      breaches: st.run.breaches,
      timeSec: st.run.totalT / D.TICK_HZ,
      cores: 0,
      won: st.screen === 'victory'
    };
  }
  function stableLine(run, fn) {
    const proxy = Object.assign({}, run, { rng: DC.util.mulberry32((run.seed ^ 4477004) >>> 0) });
    return DC.Barks[fn](proxy);
  }
  function results(st) {
    const r = st.run, res = result(st), won = st.screen === 'victory', epi = stableLine(r, won ? 'toast' : 'epitaph'), lines = Array.isArray(epi) ? epi : [epi];
    const reveal = DC.Barks.CORE.reveal[(r.seed >>> 0) % DC.Barks.CORE.reveal.length];
    return '<div class="page result">' + header('Expedition report / ' + (won ? 'core breach confirmed' : 'asset written off'), won ? 'You reached the heart.' : 'The rig is lost.', won ? 'The Company records a successful extraction.' : 'The Company regrets the loss of its equipment.') + '<div class="two-col">' + scene(won ? 'core' : 'wreck', {
      upgrades: st.meta.upgrades,
      accent: livery(st.meta),
      cat: !!st.meta.catFound
    }) + '<div><div class="result-stats"><div><b>' + res.depth + '</b><span>STRATUM REACHED</span></div><div><b>' + time(res.timeSec) + '</b><span>SHIFT DURATION</span></div><div><b>' + res.breaches + '</b><span>STRATA BREACHED</span></div><div><b>+' + number(res.paid == null ? res.cores : res.paid) + '</b><span>CORES BANKED</span></div></div><blockquote>' + lines.map(esc).join('<br>') + '</blockquote>' + (won && reveal ? '<p class="core-voice">' + esc(reveal.core) + '</p><p class="small muted">GRIT: ' + esc(reveal.grit) + '</p>' : '') + (st.meta.catFound && !won ? '<p class="small muted">' + esc(DC.Barks.CAT_EPITAPH || 'The cat made it.') + '</p>' : '') + '<div class="actions" style="margin-top:24px">' + button('Return to the surface', 'Enter', 'primary') + (won ? button('Into the Mantle', 'c', 'quiet') : '') + '</div></div></div>' + ((st.newTrophies || []).length ? '<div class="toast-note">New on the shelf: ' + st.newTrophies.map(id => esc(D.TROPHY_BY_ID[id].name)).join(', ') + '</div>' : '') + foot('Seed ' + (r.seed >>> 0) + ' / ' + title((D.CONTRACT_BY_ID[r.contract] || D.CONTRACTS[0]).name), button('Run recap', 'Tab', 'quiet')) + '</div>';
  }
  function splits(r) {
    const all = (r.splits || []).map(s => ({
      depth: s.depth,
      sec: s.sec,
      partial: false
    }));
    if (!all.some(s => s.depth === r.depth))
      all.push({
        depth: r.depth,
        sec: r.t / D.TICK_HZ,
        partial: true
      });
    return all;
  }
  function recapText(st) {
    if (!st.run)
      return 'DEEPCORE \u2014 No run to recap.';
    const r = st.run, res = result(st), review = DC.Barks.review(r, res), fed = DC.Barks.reviewCtx(r, res);
    return [
      'DEEPCORE \u2014 EXPEDITION REPORT',
      'Seed ' + (r.seed >>> 0) + (r.daily ? ' / Daily ' + r.daily.date + (r.daily.practice ? ' (practice)' : ' (ranked)') : ''),
      ...splits(r).map(s => 'S' + s.depth + ' ' + strata(s.depth).name.replace(/†/g, '') + ' \u2014 ' + time(s.sec) + (s.partial ? ' (partial)' : '')),
      'Stratum ' + res.depth + ' / ' + time(res.timeSec) + ' / ' + (res.won ? 'Core breached' : r.integrity > 0 ? 'Abandoned' : 'Rig lost'),
      'Gears fed ' + fed.gears + ' / charges fed ' + fed.charges,
      'Cores +' + res.cores + ' / paid +' + (res.paid == null ? res.cores : res.paid),
      'Schematics: ' + r.schematics.map(id => D.SCHEMATICS.find(s => s.id === id).name).join(', '),
      'GRIT\u2019S PERFORMANCE REVIEW: ' + review
    ].join('\n');
  }
  function recap(st) {
    const r = st.run, res = result(st), all = splits(r), max = Math.max(1, ...all.map(s => s.sec)), fed = DC.Barks.reviewCtx(r, res);
    return '<div class="page">' + header('Personnel division / performance review', 'Your shift, on the record.', 'Seed ' + (r.seed >>> 0) + ' \xB7 ' + (r.daily ? 'Daily ' + r.daily.date + (r.daily.practice ? ' / practice' : ' / ranked') : title((D.CONTRACT_BY_ID[r.contract] || D.CONTRACTS[0]).name))) + '<div class="panel">' + all.map(s => '<div class="split-row"><span>S' + s.depth + '</span><strong>' + esc(title(strata(s.depth).name).replace(/†/g, '')) + '</strong><div class="split-bar"><i style="width:' + s.sec / max * 100 + '%"></i></div><span class="amount">' + time(s.sec) + (s.partial ? ' *' : '') + '</span></div>').join('') + '</div><p class="small muted" style="margin-top:10px">* The final, unfinished stratum.</p><div class="result-stats"><div><b>' + time(res.timeSec) + '</b><span>SHIFT DURATION</span></div><div><b>+' + number(res.paid == null ? res.cores : res.paid) + '</b><span>CORES BANKED</span></div><div><b>' + fed.gears + '</b><span>GEARS FED</span></div><div><b>' + fed.charges + '</b><span>CHARGES FED</span></div></div><blockquote>' + esc(DC.Barks.review(r, res)) + '</blockquote><p class="small muted">Schematics: ' + esc(r.schematics.map(id => D.SCHEMATICS.find(s => s.id === id).name).join(', ') || 'None taken') + '</p>' + (st.ui.copied ? '<p class="toast-note">' + esc(st.ui.copied) + '</p>' : '') + foot('The Company thanks you for your measurable contribution.', button('Copy report', 'c', 'quiet') + button('Stats', 'Tab', 'quiet') + button('Surface', 'Enter', 'primary')) + '</div>';
  }
  function pause(st) {
    if (st.screen !== 'run' || !st.ui.paused) {
      nodes.modal.classList.remove('open');
      if (pauseOpen) {
        pauseOpen = false;
        if (pauseFocus && pauseFocus.isConnected)
          pauseFocus.focus({ preventScroll: true });
        else
          canvas.focus({ preventScroll: true });
      }
      return;
    }
    nodes.modal.classList.add('open');
    put('modal', '<div class="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="pause-portrait">' + icon('grit') + '<small>DC / CREW COMMS</small></div><div class="pause-content"><div class="eyebrow">Shift on hold</div><h1 id="pause-title">TOOLS<br>DOWN.</h1><p>The drill is quiet. Take a breath.<br>Your active shift stays here while this window remains open.</p><div class="stack">' + button('Return to the shaft', ' ', 'primary') + button('Field manual', 'h', 'quiet') + button('Abandon this shift', 'a', 'danger') + '</div></div></div>');
    if (!pauseOpen) {
      pauseOpen = true;
      pauseFocus = root.document.activeElement;
      nodes.modal.querySelector('button').focus({ preventScroll: true });
    }
  }
  function animLength() {
    return ((DC.Art.descent || []).length || 1) * 10 + 45;
  }
  function frame(st, now) {
    lastState = st;
    frameCalls++;
    const dt = lastNow == null ? 1000 / 60 : clamp((Number(now) || 0) - lastNow, 0, 250);
    lastNow = Number(now) || 0;
    if (st.screen === 'run' && st.run) observeFeedback(st.run);
    if (st.screen === 'descend' && st.ui.descendAnim < animLength())
      st.ui.descendAnim += dt * 60 / 1000;
    const changed = screen !== st.screen;
    if (changed) {
      screen = st.screen;
      nodes.game.dataset.screen = screen;
      nodes.pages.scrollTop = 0;
      pan = null;
      pointerBusy = false;
      lastMapKey = '';
      modelCache = {};
    }
    nodes.game.dataset.paused = st.ui.paused ? 'true' : 'false';
    if (!pointerBusy || changed) {
      put('topbar', topbar(st));
      if (st.screen === 'run' && st.run)
        runUI(st);
      else {
        const pages = {
          title: titlePage,
          contract: contracts,
          foundry,
          trophies,
          ledger,
          logbook,
          vignette,
          descend: descent,
          help: manual,
          gameover: results,
          victory: results,
          recap
        };
        if (pages[st.screen]) {
          const replaced=put('pages', pages[st.screen](st));
          if(replaced && st.screen==='title')selectTitle(titleChoice);
        }
      }
      pause(st);
    }
    if (changed)
      resize();
    if (st.screen === 'run' && st.run)
      drawWorld(st);
    else
      drawScenes();
  }
  DC.Render = {
    init,
    resize,
    frame,
    pxToCell,
    layout,
    recapText,
    artMode: () => 'bedrock',
    mapModel,
    feedbackSnapshot,
    feedbackEvents,
    clean,
    icon,
    animLength,
    debug: () => ({
      frameCalls,
      terrainBuilds,
      mapBuilds,
      feedback: sparks.map(e => Object.assign({},e)),
      viewport,
      camera: Object.assign({}, camera),
      transform: Object.assign({}, transform),
      spriteCount: spriteCache.size,
      spritePixels: Array.from(spriteCache.values()).reduce((n, v) => n + v.width * v.height, 0),
      terrainPixels: surface ? surface.width * surface.height : 0,
      portraitReady,
      titleBackdropReady,
      reduced
    })
  };
}());
