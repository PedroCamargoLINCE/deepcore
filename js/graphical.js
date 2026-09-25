/* DEEPCORE / Bedrock — independent graphical renderer and document UI.
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
  const strata = d => d <= D.STRATA_COUNT ? D.STRATA[d - 1] : D.mantleStratum(d);
  const directions = [
    'North',
    'East',
    'South',
    'West'
  ];
  const iconCache = new Map();
  function icon(id, options) {
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
  function costShort(cost) {
    return Object.keys(cost || {}).map(k => cost[k] + ' ' + (k === 'ironPlate' ? 'iron' : k === 'copperPlate' ? 'copper' : D.ITEMS[k].name)).join(' / ');
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
    return def && def.chrome ? def.chrome.amber : A.P.gold;
  }
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
    nodes[id].innerHTML = html;
    nodes[id].scrollTop = scroll;
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
      camera.zoom = 1;
      camera.x = D.MAP_W / 2;
      camera.y = D.MAP_H / 2;
      lastMapKey = '';
    }
    if (a === 'context') {
      command('Enter');
      canvas.focus({ preventScroll: true });
    }
  }
  function zoom(mult) {
    camera.zoom = clamp(camera.zoom * mult, 1, 4);
    lastMapKey = '';
  }
  function init(cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    for (const id of [
        'game',
        'topbar',
        'resources',
        'workspace',
        'world',
        'operations',
        'toolbelt',
        'statusbar',
        'pages',
        'modal',
        'map-caption',
        'map-controls'
      ])
      nodes[id] = root.document.getElementById(id);
    nodes.game.addEventListener('click', click);
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
    // Real buttons must keep native Tab/Space/Enter accessibility, without the
    // same key also activating a game-screen shortcut on the window handler.
    nodes.game.addEventListener('keydown', e => {
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
          lastMapKey = '';
        });
    }
    put('map-controls', action('\u2212', 'zoom-out') + action('Fit', 'fit') + action('+', 'zoom-in'));
    resize();
  }
  function resize() {
    if (!canvas)
      return;
    const r = canvas.getBoundingClientRect();
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
    drawScenes();
  }
  function computeTransform() {
    const base = Math.max(1, Math.min((viewport.w - 32) / D.MAP_W, (viewport.h - 64) / D.MAP_H));
    const tile = base * camera.zoom, w = D.MAP_W * tile, h = D.MAP_H * tile;
    camera.x = clamp(camera.x, 0, D.MAP_W);
    camera.y = clamp(camera.y, 0, D.MAP_H);
    let x = viewport.w / 2 - camera.x * tile, y = viewport.h / 2 - camera.y * tile + 7;
    x = w < viewport.w ? (viewport.w - w) / 2 : clamp(x, viewport.w - w - 10, 10);
    y = h < viewport.h ? (viewport.h - h) / 2 + 7 : clamp(y, viewport.h - h - 10, 10);
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
    const dp = viewport.dpr, key = JSON.stringify([
        id,
        Math.round(w * dp),
        Math.round(h * dp),
        o
      ]);
    let cv = spriteCache.get(key);
    if (!cv) {
      cv = root.document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(w * dp));
      cv.height = Math.max(1, Math.ceil(h * dp));
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
    const dp = Math.min(viewport.dpr, Math.sqrt(11900000 / (D.MAP_W * D.MAP_H * s * s)));
    surface = root.document.createElement('canvas');
    surface.width = Math.ceil(D.MAP_W * s * dp);
    surface.height = Math.ceil(D.MAP_H * s * dp);
    const c = surface.getContext('2d');
    c.setTransform(dp, 0, 0, dp, 0, 0);
    c.fillStyle = '#142925';
    c.fillRect(0, 0, D.MAP_W * s, D.MAP_H * s);
    for (const t of tiles)
      if (t)
        A.tile(c, t, t.x * s, t.y * s, s);
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
      surfaceKey = '';
      lastMapKey = '';
    }
    const cp = ui.hover || ui.cursor, cpKey = cp ? cp.x + ',' + cp.y : '';
    if (camera.zoom > 1 && cp && cpKey !== lastCursor && !ui.hover && !pan) {
      camera.x = cp.x + 0.5;
      camera.y = cp.y + 0.5;
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
      run.nextId,
      run.gearsFed,
      run.inv.ironPlate
    ]);
    if (key === lastMapKey)
      return;
    lastMapKey = key;
    mapBuilds++;
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.fillStyle = '#172d29';
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
          p.rect(0, 15, 100, 70, '#233f3c');
          p.rect(0, 24, 100, 52, '#789385');
          p.rect(0, 19, 100, 5, '#b0bca1');
          p.rect(0, 76, 100, 5, '#455f52');
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
            ], '#425f54', 4);
          A.arrow(p, 1, '#ccd1ab', 57, 50, 19);
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
        A.arrow(p, dir, '#e0c47c', 50, 50, 23);
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
      ctx.strokeStyle = '#ebd18d';
      ctx.lineWidth = 2;
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
    ctx.strokeStyle = '#7b8a674d';
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
      const dp = Math.min(root.devicePixelRatio || 1, 2, Math.sqrt(11900000 / (r.width * r.height))), w = Math.ceil(r.width * dp), h = Math.ceil(r.height * dp);
      const key = [
        w,
        h,
        cv.dataset.scene,
        cv.dataset.options
      ].join('|');
      if (cv._sceneKey === key)
        continue;
      cv.width = w;
      cv.height = h;
      A.scene(cv.getContext('2d'), cv.dataset.scene, w, h, JSON.parse(cv.dataset.options || '{}'));
      cv._sceneKey = key;
    }
  }
  function topbar(st) {
    const run = st.screen === 'run' && st.run, s = run && strata(run.depth);
    return '<div class="wordmark">' + icon('bit') + '<div>DEEPCORE<small>MINING CONCERN</small></div></div>' + (run ? '<div class="location"><div class="eyebrow">Stratum ' + run.depth + ' / \u2212' + run.depth * D.DEPTH_M + ' m</div><h3>' + esc(title(s.name).replace(/†/g, '')) + '</h3></div>' : '<span class="eyebrow">Bedrock / Graphical edition</span>') + '<div class="top-actions">' + (run ? '<span class="time small amount">' + time(run.totalT / D.TICK_HZ) + '</span>' : '') + '<button data-key="m" aria-label="' + (st.meta.muted ? 'Unmute' : 'Mute') + ' audio">' + icon(st.meta.muted ? 'muted' : 'sound') + '<span class="mute-label">' + (st.meta.muted ? 'Sound off' : 'Sound on') + '</span></button>' + (st.screen === 'run' ? button('Manual', 'h', 'quiet') + button('Pause', ' ', 'quiet') : st.screen === 'title' ? '<button type="button" data-progress>Progress</button>' + button('Manual', 'h', 'quiet') : button('Back', 'Escape', 'quiet', [
      'descend',
      'vignette'
    ].includes(st.screen))) + '</div>';
  }
  function resources(st) {
    const run = st.run, tut = DC.Tutorial.layout(run), focus = tut && tut.panels ? tut.beat === 'feed' ? 'gear' : 'ironOre' : null;
    return D.ITEM_ORDER.map(id => '<div class="resource ' + (run.inv[id] || 0 ? '' : 'empty') + (focus === id ? ' tutor-focus' : '') + '" title="' + esc(D.ITEMS[id].name) + '">' + icon(id) + '<div><b>' + number(run.inv[id]) + '</b><span class="label">' + esc(title(D.ITEMS[id].name)) + '</span></div></div>').join('');
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
    const warning = ready ? 'Machines stay on this floor. Take ' + reserve + ' iron plates to build the next base.' : DC.Sim.supplyWarning(r) ? 'No plates. Use Demolish to reclaim a misplaced machine.' : 'Drill gears feed automatically from stock. Belts deliver your production to the rig.';
    return '<section class="panel"><div class="rig-head">' + icon('rig', {
      active: !!active,
      upgrades: st.meta.upgrades,
      accent: livery(st.meta)
    }) + '<div><div class="eyebrow">Mobile extraction unit</div><h3>' + (ready ? 'Breach ready' : r.overdrive ? 'Overdrive engaged' : 'Rig operations') + '</h3></div></div>' + '<div class="meters"><div><div class="meter-label"><span>Hull</span><strong>' + Math.max(0, Math.ceil(r.integrity)) + '<small> / ' + r.maxIntegrity + '</small></strong></div>' + bar(r.integrity, r.maxIntegrity, r.integrity < 30 ? 'warn' : '') + '</div><div><div class="meter-label"><span>Pressure</span><strong>' + Math.floor(r.instability) + '%</strong></div>' + bar(r.instability, 100, r.instability >= D.QUAKE.startInst ? 'warn' : '') + '</div></div>' + '<div class="drill-meter"><div class="meter-label"><span>Drill gears</span><strong>' + r.gearsFed + ' / ' + req.gear + '</strong></div>' + bar(r.gearsFed, req.gear, 'gold') + '</div>' + (req.charge ? '<div class="drill-meter"><div class="meter-label"><span>Core charges</span><strong>' + r.chargesFed + ' / ' + req.charge + '</strong></div>' + bar(r.chargesFed, req.charge, 'gold') + '</div>' : '') + '<div class="row between small muted"><span>Feed ' + (fr.gearPerSec || 0).toFixed(1) + ' gears/s' + (req.charge ? ' \xB7 ' + (fr.chargePerSec || 0).toFixed(1) + ' charges/s' : '') + '</span><span>' + (ready ? 'Ready' : ch.breachSec != null && isFinite(ch.breachSec) ? '~' + time(ch.breachSec) : 'Awaiting feed') + '</span></div>' + '<div class="drill-actions">' + button(r.overdrive ? 'Overdrive on' : 'Overdrive', 'c', r.overdrive ? 'selected' : '') + button('Descend', 'd', 'primary', !ready) + '</div><p class="supply-note">' + esc(warning) + '</p></section>';
  }
  function tutorial(st) {
    const T = DC.Tutorial, r = st.run;
    if (!T.active(r) || !T.layout(r))
      return '';
    const spans = list => (list || []).map(s => s[0] === 'cap' ? '<kbd>' + esc(clean(s[1])) + '</kbd>' : esc(clean(s[1])) + ' ').join('');
    return '<section class="panel tutor"><div class="row">' + icon('grit', { talking: true }) + '<div><div class="eyebrow">Operator induction</div><h3>' + esc(clean(T.title(r))) + '</h3></div></div><p>' + esc(T.line(r)) + '</p><div class="tutor-action">' + spans(T.action(r)) + '</div><div class="tutor-warning">' + spans(T.warn(r)) + '</div><div class="small muted">' + spans(T.foot(r)) + '</div>' + '<div class="lesson">' + T.stamps(r).map(s => '<i class="' + (s.done ? 'done' : s.cur ? 'current' : '') + '"></i>').join('') + '</div><div style="margin-top:10px">' + button('Skip induction', D.TUTORIAL.skipKey, 'quiet') + '</div></section>';
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
    return D.BUILD_ORDER.filter(id => DC.Sim.unlocked(r, id)).map(id => {
      const b = D.BUILDINGS[id], free = id === 'belt' && r.mods.beltFree, afford = free || Object.keys(b.cost).every(k => (r.inv[k] || 0) >= b.cost[k]);
      return '<button class="tool ' + (u.tool === id ? 'selected ' : '') + (!afford ? 'unaffordable' : '') + '" data-key="' + b.key + '" aria-pressed="' + (u.tool === id) + '" title="' + esc(b.desc + ' Cost: ' + (free ? 'free' : costText(b.cost))) + '">' + icon(id) + '<span class="tool-name">' + esc(b.name) + '</span><span class="cost">' + (free ? 'Free' : esc(costShort(b.cost))) + '</span><kbd>' + b.key + '</kbd></button>';
    }).join('') + '<div class="tool-group">' + action(icon('inspect') + 'Inspect', 'inspect', u.tool ? '' : 'selected') + '<button data-key="x" class="' + (u.tool === 'demolish' ? 'selected' : '') + '">' + icon('demolish') + 'Dig / reclaim <kbd>X</kbd></button><button data-key="r" title="Rotate output direction">' + icon('rotate') + directions[u.facing] + ' <kbd>R</kbd></button></div>';
  }
  function runUI(st) {
    const r = st.run, s = strata(r.depth), mut = DC.Sim.mutatorOf(r);
    const inspecting = !!st.ui.tool;
    put('resources', resources(st));
    put('operations', rigPanel(st) + tutorial(st) + (inspecting ? inspector(st) : '') + chainPanel(st) + (!inspecting ? inspector(st) : '') + foreman(st));
    put('toolbelt', toolbelt(st));
    put('map-caption', '<b>' + esc(title(s.name).replace(/†/g, '')) + '</b>' + esc(mut ? mut.name + ' / ' + mut.tag : s.tag));
    const flash = st.ui.flash && st.ui.flash.until > r.t ? clean(st.ui.flash.text) : '';
    const offer = r.coreOffer && r.totalT < r.coreOffer.until;
    put('statusbar', '<span>' + esc(offer ? 'ENTER \xB7 ASCEND' : flash || 'Click to interact \xB7 drag to lay belts \xB7 arrows move cursor \xB7 Enter acts') + '</span><span>Scroll to zoom \xB7 right-drag to pan \xB7 ' + Math.round(camera.zoom * 100) + '%</span>');
  }
  function titlePage(st) {
    const m = st.meta, eligible = DC.Tutorial.eligible(m), hist = (m.dailyHistory || []).find(h => h.date === st.today);
    return '<div class="hero"><div class="hero-copy"><div class="eyebrow">A Deepcore Mining Concern production</div><h1>KEEP<span>DIGGING.</span></h1><p class="intro">Build the line. Feed the drill.<br>There are eight strata between you and the heart of this planet.</p><div class="actions">' + button('Begin descent', 'Enter', 'primary') + button('Daily shaft', 't', 'secondary') + button('The Foundry', 'f', 'secondary') + (!eligible ? button('Replay induction', 'i', 'quiet') : '') + '</div><div class="hero-stats"><div><b>' + number(m.cores) + '</b><span>CORES BANKED</span></div><div><b>' + number(m.bestDepth) + '</b><span>DEEPEST STRATUM</span></div><div><b>' + number(m.wins) + '</b><span>CORE BREACHES</span></div></div><div class="edition-note">' + esc('Daily ' + st.today + ' \xB7 ' + (hist ? 'Stratum ' + hist.depth + ' in ' + time(hist.timeSec) : 'One ranked attempt. Same shaft for everyone.')) + '<br>Bedrock edition \xB7 same game, a different world.<br><a href="index.html">Engraved & Classic editions</a></div></div>' + scene('landscape', {
      upgrades: m.upgrades,
      accent: livery(m),
      cat: !!m.catFound
    }, 'hero-art') + '<div class="title-number">DMC / EXTRACTION SERIES 08</div></div>';
  }
  function contracts(st) {
    return '<div class="page paperwork">' + header('Personnel division / terms of engagement', 'Sign before you descend.', 'Choose your contract. The Company will retain the original.') + '<div class="cards">' + D.CONTRACTS.map((c, i) => {
      const open = DC.Meta.contractUnlocked(st.meta, c.id), won = DC.Meta.contractWon(st.meta, c.id);
      return '<article class="card ' + (open ? '' : 'locked ') + (i === (st.ui.contractCursor || 0) ? 'chosen' : '') + '"><div class="card-illustration">' + icon(c.id) + '</div><div class="card-body"><div class="eyebrow">' + esc(c.sub) + ' / ' + (won ? 'Concluded' : open ? 'Approved for signature' : 'Authorization required') + '</div><h2>' + esc(title(c.name)) + '</h2><ul>' + c.terms.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul><div class="wage">\xD7' + Number(c.wage).toFixed(1) + ' <span class="small muted">core wage</span></div><div class="signature">' + (open ? button('Sign contract', String(i + 1), 'primary') : '<p>' + esc(c.lockText.replace(/^LOCKED: /, '')) + '</p>') + '</div></div></article>';
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
    put('modal', '<div class="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">' + icon('grit') + '<div class="eyebrow">Authorized interruption</div><h1 id="pause-title">Tools down.</h1><p>The drill is quiet. Take a breath.<br>Your active shift stays here while this window remains open.</p><div class="stack">' + button('Return to the shaft', ' ', 'primary') + button('Field manual', 'h', 'quiet') + button('Abandon this shift', 'a', 'danger') + '</div></div>');
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
        if (pages[st.screen])
          put('pages', pages[st.screen](st));
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
    clean,
    icon,
    animLength,
    debug: () => ({
      frameCalls,
      terrainBuilds,
      mapBuilds,
      viewport,
      camera: Object.assign({}, camera),
      transform: Object.assign({}, transform),
      spriteCount: spriteCache.size,
      spritePixels: Array.from(spriteCache.values()).reduce((n, v) => n + v.width * v.height, 0),
      terrainPixels: surface ? surface.width * surface.height : 0
    })
  };
}());
