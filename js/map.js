/* DEEPCORE — map.js
   DC.MapGen.generate(depth, rng, mods) -> { grid, hub }
   Deterministic from rng. DOM-free. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA, U = DC.util;

  function blankTile(t) {
    return { t: t, ore: null, oreAmt: 0, machine: null, belt: null,
             rubble: false, digT: 0, revealed: false,
             // M-WONDERS: { id, g } when this tile belongs to a landmark.
             lm: null };
  }

  function generate(depth, rng, mods) {
    mods = mods || {};
    const W = D.MAP_W, H = D.MAP_H;
    const S = depth <= D.STRATA_COUNT ? D.STRATA[depth - 1] : D.mantleStratum(depth);

    // -- 1. cellular caves --------------------------------------------------
    const grid = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
        row.push(blankTile(border || rng() < 0.45 ? 'rock' : 'floor'));
      }
      grid.push(row);
    }
    for (let p = 0; p < 4; p++) {
      const next = [];
      for (let y = 1; y < H - 1; y++) {
        next[y] = [];
        for (let x = 1; x < W - 1; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if ((dx || dy) && grid[y + dy][x + dx].t === 'rock') n++;
          next[y][x] = n >= 5 ? 'rock' : 'floor';
        }
      }
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) grid[y][x].t = next[y][x];
    }

    // -- 2. hub site --------------------------------------------------------
    const hx = (W >> 1) - 1 + U.ri(rng, -4, 4);
    const hy = (H >> 1) - 1 + U.ri(rng, -4, 4);
    for (let y = hy - 2; y <= hy + 4; y++)
      for (let x = hx - 2; x <= hx + 4; x++) {
        const t = grid[y][x];
        t.t = 'floor'; t.ore = null; t.oreAmt = 0;
      }
    for (let y = hy; y < hy + 3; y++)
      for (let x = hx; x < hx + 3; x++) grid[y][x].machine = 0;
    const hcx = hx + 1, hcy = hy + 1;
    const inClear = (x, y) => x >= hx - 2 && x <= hx + 4 && y >= hy - 2 && y <= hy + 4;
    const inb = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;

    // -- 3. ore veins -------------------------------------------------------
    const veins = [];
    const richMul = mods.richVeins ? 1.5 : 1;

    // forced=true: seed within radius 12 of hub center, may seed on rock.
    function placeVein(type, minSize, forced) {
      const attempts = forced ? 200 : 80;
      for (let att = 0; att < attempts; att++) {
        let x, y;
        if (forced) {
          const a = rng() * Math.PI * 2, r = 5.5 + rng() * 6;
          x = Math.round(hcx + Math.cos(a) * r);
          y = Math.round(hcy + Math.sin(a) * r);
        } else {
          x = U.ri(rng, 1, W - 2); y = U.ri(rng, 1, H - 2);
        }
        if (!inb(x, y)) continue;
        const t = grid[y][x];
        if (t.ore || t.machine !== null || inClear(x, y)) continue;
        if (Math.max(Math.abs(x - hcx), Math.abs(y - hcy)) < 5) continue; // >=4 from footprint
        if (!forced && t.t !== 'floor') continue;
        if (forced && t.t !== 'floor' && t.t !== 'rock') continue;
        const size = Math.max(minSize || 0, U.ri(rng, 4, 8));
        const tiles = [];
        let cx = x, cy = y, guard = 0;
        while (tiles.length < size && guard++ < 60) {
          const tt = grid[cy][cx];
          if ((tt.t === 'floor' || tt.t === 'rock') && !tt.ore &&
              tt.machine === null && !inClear(cx, cy)) {
            tt.t = 'floor'; tt.ore = type;
            tt.oreAmt = Math.round(U.ri(rng, S.rich[0], S.rich[1]) * richMul);
            tiles.push({ x: cx, y: cy });
          }
          const d = D.DIRS[U.ri(rng, 0, 3)];
          if (inb(cx + d.dx, cy + d.dy)) { cx += d.dx; cy += d.dy; }
        }
        if (tiles.length >= (minSize || 4)) {
          const v = { type: type, tiles: tiles };
          veins.push(v);
          return v;
        }
        for (const c of tiles) { const tt = grid[c.y][c.x]; tt.ore = null; tt.oreAmt = 0; }
      }
      return null;
    }

    function rollOre() {
      const r = rng(); let acc = 0;
      const ks = Object.keys(S.ores);
      for (const k of ks) { acc += S.ores[k]; if (r < acc) return k; }
      return ks[ks.length - 1];
    }
    for (let i = 0; i < S.nodes; i++) placeVein(rollOre(), 0, false);

    // guarantee: 2 iron + 1 coal veins, >=6 tiles, within r12 of hub center
    function ensureVeins(type, count) {
      const have = veins.filter(v => v.type === type && v.tiles.length >= 6 &&
        v.tiles.some(c => Math.hypot(c.x - hcx, c.y - hcy) <= 12)).length;
      for (let i = have; i < count; i++) placeVein(type, 6, true);
    }
    ensureVeins('ironOre', 2);
    ensureVeins('coal', 1);

    // -- 4. chasms ----------------------------------------------------------
    function carveChasm(x, y) {
      if (!inb(x, y) || inClear(x, y)) return;
      const t = grid[y][x];
      if (t.ore || t.machine !== null) return;
      t.t = 'chasm';
    }
    const F = S.features || {};
    for (let i = 0; i < (F.chasms || 0); i++) {
      for (let att = 0; att < 40; att++) {
        const x = U.ri(rng, 2, W - 3), y = U.ri(rng, 2, H - 3);
        if (inClear(x, y) || grid[y][x].ore) continue;
        let cx = x, cy = y, dir = U.ri(rng, 0, 3);
        const len = U.ri(rng, 8, 18);
        for (let s = 0; s < len; s++) {
          carveChasm(cx, cy);
          if (rng() < 0.5) { // widen to 2
            const pd = D.DIRS[(dir + (rng() < 0.5 ? 1 : 3)) % 4];
            carveChasm(cx + pd.dx, cy + pd.dy);
          }
          if (rng() < 0.3) dir = (dir + (rng() < 0.5 ? 1 : 3)) % 4;
          const d = D.DIRS[dir];
          cx += d.dx; cy += d.dy;
          if (!inb(cx, cy)) break;
        }
        break;
      }
    }

    // -- 5. magma pools -----------------------------------------------------
    for (let i = 0; i < (F.magma || 0); i++) {
      for (let att = 0; att < 60; att++) {
        const x = U.ri(rng, 1, W - 2), y = U.ri(rng, 1, H - 2);
        if (!(x < 6 || x > W - 7 || y < 5 || y > H - 6)) continue; // edge region
        if (Math.hypot(x - hcx, y - hcy) < 10) continue;
        const t0 = grid[y][x];
        if (t0.ore || t0.machine !== null || inClear(x, y) || t0.t === 'chasm') continue;
        const size = U.ri(rng, 3, 6);
        let placed = 0, cx = x, cy = y, g = 0;
        while (placed < size && g++ < 30) {
          const tt = grid[cy][cx];
          if (!inClear(cx, cy) && !tt.ore && tt.machine === null &&
              tt.t !== 'chasm' && tt.t !== 'magma' &&
              Math.hypot(cx - hcx, cy - hcy) >= 10) {
            tt.t = 'magma'; placed++;
          }
          const d = D.DIRS[U.ri(rng, 0, 3)];
          if (inb(cx + d.dx, cy + d.dy)) { cx += d.dx; cy += d.dy; }
        }
        break;
      }
    }

    // -- 6. obsidian maze walls --------------------------------------------
    if (F.obsidian) {
      const rocks = [];
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++)
          if (grid[y][x].t === 'rock') rocks.push({ x: x, y: y });
      const target = Math.floor(rocks.length * 0.35);
      let done = 0, guard = 0;
      while (done < target && guard++ < 4000 && rocks.length) {
        const s = U.pick(rng, rocks);
        let cx = s.x, cy = s.y;
        const len = U.ri(rng, 4, 10);
        for (let k = 0; k < len; k++) {
          const t = grid[cy][cx];
          if (t.t === 'rock' && !inClear(cx, cy)) { t.t = 'obsidian'; done++; }
          const opts = [];
          for (const d of D.DIRS) {
            const nx = cx + d.dx, ny = cy + d.dy;
            if (inb(nx, ny) && grid[ny][nx].t === 'rock') opts.push({ x: nx, y: ny });
          }
          if (!opts.length) break;
          const o = U.pick(rng, opts);
          cx = o.x; cy = o.y;
        }
      }
    }

    // -- 7. connectivity ----------------------------------------------------
    function reachSet() {
      const seen = new Set([hcy * W + hcx]);
      const q = [[hcx, hcy]];
      while (q.length) {
        const c = q.pop();
        for (const d of D.DIRS) {
          const nx = c[0] + d.dx, ny = c[1] + d.dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (seen.has(k) || grid[ny][nx].t !== 'floor') continue;
          seen.add(k); q.push([nx, ny]);
        }
      }
      return seen;
    }
    // 1-wide L through rock/floor only (never obsidian/chasm/magma)
    function carvePath(x0, y0, x1, y1) {
      for (let order = 0; order < 2; order++) {
        const cells = [];
        if (order === 0) {
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) cells.push({ x: x, y: y0 });
          for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) cells.push({ x: x1, y: y });
        } else {
          for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) cells.push({ x: x0, y: y });
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) cells.push({ x: x, y: y1 });
        }
        let ok = true;
        for (const c of cells) {
          if (!inb(c.x, c.y)) { ok = false; break; }
          const tt = grid[c.y][c.x].t;
          if (tt !== 'floor' && tt !== 'rock') { ok = false; break; }
        }
        if (ok) {
          for (const c of cells) { const t = grid[c.y][c.x]; if (t.t === 'rock') t.t = 'floor'; }
          return true;
        }
      }
      return false;
    }
    let seen = reachSet();
    for (const v of veins) {
      if (!v.tiles.length || v.tiles.some(c => seen.has(c.y * W + c.x))) continue;
      let carved = false;
      for (const c of v.tiles) if (carvePath(hcx, hcy, c.x, c.y)) { carved = true; break; }
      if (!carved) { // relocate the vein
        for (const c of v.tiles) { const t = grid[c.y][c.x]; t.ore = null; t.oreAmt = 0; }
        const nv = placeVein(v.type, Math.max(4, Math.min(6, v.tiles.length)), true);
        v.tiles = nv ? nv.tiles : [];
        if (nv) veins.pop(); // placeVein pushed a duplicate record
        seen = reachSet();
        if (v.tiles.length && !v.tiles.some(c => seen.has(c.y * W + c.x)))
          for (const c of v.tiles) if (carvePath(hcx, hcy, c.x, c.y)) break;
      }
      seen = reachSet();
    }

    // -- 8. landmark (M-WONDERS) -------------------------------------------
    // Runs LAST, on a finished map, and is the only step that can be refused.
    //
    // DETERMINISM WITHOUT STREAM CHURN. This step draws ZERO numbers from
    // `rng`. It seeds a private mulberry32 from a hash of the grid the steps
    // above just produced, so it is still a pure function of the run seed —
    // the same seed always yields the same landmark in the same place — while
    // leaving `run.rng` positioned exactly where it was before landmarks
    // existed. Every vein roll, quake timer and schematic offer downstream is
    // therefore bit-identical to the pre-M-WONDERS build, which is what makes
    // the balance sweep's before/after readable: any movement in it is the
    // landmark's MECHANICS, never a reshuffled map.
    //
    // THE INVARIANTS. Mapgen is the module where a bug hides for seeds before
    // it surfaces, so placement is verify-then-keep rather than
    // reason-then-hope:
    //   1. no landmark cell may carry ore      (a vein is never overwritten)
    //   2. no landmark cell may be hub or clearing
    //   3. every floor tile reachable from the rig BEFORE placement must
    //      still be reachable after it, except the cells the landmark itself
    //      consumed (nothing is ever walled off)
    // Any candidate that fails is reverted tile-by-tile and the next is tried.
    // If every candidate fails, the map ships with no landmark — a stratum
    // without a wonder is a lesser stratum, never a broken one.
    function gridHash() {
      let h = (0x811c9dc5 ^ Math.imul(depth, 0x9e3779b1)) >>> 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const t = grid[y][x];
          h ^= t.t.charCodeAt(0) + (t.ore ? t.ore.charCodeAt(0) * 7 + t.oreAmt : 0);
          h = Math.imul(h, 0x01000193);
        }
      h ^= hx * 31 + hy;
      return Math.imul(h, 0x01000193) >>> 0;
    }

    // Terrain a landmark may consume. Magma is excluded on purpose: sim counts
    // magma tiles at stratum start to size `run.magmaCap`, and quietly eating
    // some would change a hazard budget this module has no business touching.
    const LM_OVER = { floor: true, rock: true, obsidian: true, chasm: true };
    const MIN_D = D.LANDMARK_MIN_DIST || 12;

    function lmCells(def, ax, ay, lrng) {
      const cells = [];
      if (def.art) {
        for (let dy = 0; dy < def.art.length; dy++)
          for (let dx = 0; dx < def.art[dy].length; dx++) {
            const g = def.art[dy][dx];
            if (g === ' ') continue;
            cells.push({ x: ax + dx, y: ay + dy, g: g });
          }
        return cells;
      }
      // scattered: loose cells in a disc, deduped, order-stable
      const r = def.scatter.r, seen = {};
      for (let att = 0; att < def.scatter.n * 8 && cells.length < def.scatter.n; att++) {
        const dx = U.ri(lrng, -r, r), dy = U.ri(lrng, -r, r);
        if (dx * dx + dy * dy > r * r) continue;
        const k = (ay + dy) * W + (ax + dx);
        if (seen[k]) continue;
        seen[k] = 1;
        cells.push({ x: ax + dx, y: ay + dy, g: def.glyph });
      }
      return cells;
    }

    function cellOk(def, c) {
      if (!inb(c.x, c.y)) return false;
      const t = grid[c.y][c.x];
      if (t.ore || t.machine !== null) return false;      // invariant 1 & 2
      if (inClear(c.x, c.y)) return false;                // invariant 2
      if (!LM_OVER[t.t]) return false;
      if (def.needReach && t.t !== 'floor') return false;
      return true;
    }

    let landmark = null;
    const lrng = U.mulberry32(gridHash());
    const pool = (D.LANDMARKS || []).filter(l => depth >= l.min);
    if (pool.length) {
      const order = U.shuffle(lrng, pool);
      // anchors far enough from the rig that no aura is free, shuffled once
      // and shared by every candidate landmark this map tries.
      const anchors = [];
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++)
          if (Math.hypot(x - hcx, y - hcy) >= MIN_D) anchors.push({ x: x, y: y });
      const tries = U.shuffle(lrng, anchors);

      const before = reachSet();
      // Each full verification is two floods of the map, so the search is
      // budgeted: cheap checks may be tried 240 times per landmark, but only
      // 30 candidates ever get flooded. Mapgen runs once per stratum and the
      // balance sweep runs it thousands of times — an unbounded retry loop
      // here is how a "harmless" mapgen tweak becomes a hung harness.
      let verified = 0;
      for (let oi = 0; oi < order.length && !landmark; oi++) {
        const def = order[oi];
        const minCells = def.scatter ? Math.ceil(def.scatter.n * 0.6) : 0;
        for (let ti = 0; ti < tries.length && ti < 240 && verified < 30; ti++) {
          const a = tries[ti];
          let cells = lmCells(def, a.x, a.y, lrng);
          if (def.scatter) cells = cells.filter(c => cellOk(def, c));
          if (!cells.length) continue;
          if (def.scatter ? cells.length < minCells : !cells.every(c => cellOk(def, c))) continue;
          // needReach: the landmark is only worth anything if the player can
          // stand on/next to it, so require the anchor to be live ground.
          if (def.needReach && !cells.some(c => before.has(c.y * W + c.x))) continue;
          // otherwise: reachable OR at least approachable by digging — never
          // sealed inside glass, a chasm or lava with no way in.
          if (!def.needReach) {
            let open = false;
            for (const c of cells) {
              for (const d of D.DIRS) {
                const nx = c.x + d.dx, ny = c.y + d.dy;
                if (!inb(nx, ny)) continue;
                const tt = grid[ny][nx];
                if (tt.t === 'floor' || tt.t === 'rock') { open = true; break; }
              }
              if (open) break;
            }
            if (!open) continue;
          }

          verified++;
          const prev = cells.map(c => grid[c.y][c.x].t);
          for (const c of cells) {
            const t = grid[c.y][c.x];
            t.t = def.base;
            t.lm = { id: def.id, g: c.g };
          }
          // invariant 3: nothing the rig could reach may have been walled off
          const after = reachSet();
          const eaten = new Set(cells.map(c => c.y * W + c.x));
          let ok = true;
          for (const k of before) if (!eaten.has(k) && !after.has(k)) { ok = false; break; }
          if (ok) {
            // `was` is the terrain this cell replaced. It is not decoration:
            // test/headless.js rebuilds the pre-landmark map from it and
            // re-derives invariant 3 from scratch, rather than trusting the
            // check twelve lines above to be the one that is right.
            landmark = { id: def.id, x: a.x, y: a.y,
                         cx: a.x + ((def.art ? def.art[0].length : 1) - 1) / 2,
                         cy: a.y + ((def.art ? def.art.length : 1) - 1) / 2,
                         cells: cells.map((c, i) => ({ x: c.x, y: c.y, was: prev[i] })) };
            break;
          }
          for (let i = 0; i < cells.length; i++) {   // revert, tile by tile
            const t = grid[cells[i].y][cells[i].x];
            t.t = prev[i];
            t.lm = null;
          }
        }
      }
      // a scattered landmark's "centre" is the anchor it grew around
      if (landmark && D.LANDMARK_BY_ID[landmark.id].scatter) {
        landmark.cx = landmark.x; landmark.cy = landmark.y;
      }
    }

    return { grid: grid, hub: { x: hx, y: hy }, landmark: landmark };
  }

  DC.MapGen = { generate: generate };
})();
