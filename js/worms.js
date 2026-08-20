/* DEEPCORE — worms.js (SPEC3 M-WORMS)
   DC.Worms: the things down here that are alive and are not the cat.

     vein worms    '~~o', s3+, tunnelling through rock and eating veins
     the lure      two coal on the floor, and a living tunnel-borer you aim
     the Undertoad 'Ω', asleep, and the best mining site in the game

   DOM-free and deterministic. The living-world layer js/events.js opened for
   the cat, extended — with one deliberate difference from it, explained next.

   ── on randomness (§0 law 7) ─────────────────────────────────────────────
   The cat draws from a stream DERIVED from the seed because she is scenery:
   she writes nothing into the sim, so the sim's stream must not know she
   exists. A worm is the opposite. It opens rock, eats ore and changes what an
   extractor is standing on, so it is a CITIZEN of the sim and draws from
   `run.rng` like the quake schedule and the magma it shares a world with.
   That is the brief's decision and this module keeps it.

   Law 7's real demand is subtler than "one stream", though, and this module
   meets it exactly: WHAT THE PLAYER DOES MUST NOT MOVE THE STREAM. So every
   worm draws EXACTLY ONE number on EXACTLY the ticks `stepT` names, whatever
   it decides and whether or not it decides anything at all. Dropping a lure
   re-aims a worm; it does not add, remove or reorder a single draw. The
   number of draws this module spends in a stratum is a pure function of
   (tick count, worm count) — both of which the player cannot touch — so a
   quake still lands on the tiles it was always going to land on, however the
   player played the floor. The suites pin this: see 'a lure never moves the
   stream' in test/headless.js.

   The Undertoad spends nothing at all after placement. Everything it will do
   — where it burrows, how far, what it leaves — is decided when the map is
   made and stored; waking it executes a script and rolls no dice, so the one
   thing in this game a player can DETONATE on purpose cannot shift the
   schedule of the one thing they cannot (law 8's quake).

   Nothing in here reads a clock, a DOM, or Math.random. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  const D = DC.DATA, U = DC.util;
  const HZ = D.TICK_HZ;
  const C = D.COLORS;

  // ---------------- shared plumbing ----------------
  // Mirrors sim.js's private pushEvent, exactly as js/events.js does, and for
  // the same reason: the queue is a data contract ({type, t, data}), not a
  // function one, and engine.js drains it into GRIT.
  function pushEvent(run, type, data) {
    if (!Array.isArray(run.events)) return;
    run.events.push({ type: type, t: run.totalT, data: data || null });
    if (run.events.length > 200) run.events.shift();
  }
  function msg(run, text, color) {
    if (DC.Sim && DC.Sim.msg) DC.Sim.msg(run, text, color);
  }
  function tileAt(run, x, y) {
    if (!run.grid || x < 0 || y < 0 || x >= D.MAP_W || y >= D.MAP_H) return null;
    return run.grid[y][x];
  }
  function stratumOf(run) {
    return run.depth <= D.STRATA_COUNT ? D.STRATA[run.depth - 1]
                                       : D.mantleStratum(run.depth);
  }
  function hubCentre(run) {
    return run.hub ? { x: run.hub.x + 1, y: run.hub.y + 1 } : { x: 0, y: 0 };
  }
  function W() { return D.WORMS || {}; }
  function TOAD() { return D.UNDERTOAD || {}; }

  // ---------------- per-run state ----------------
  // `run.critters` is the entity list the brief names. Lazily attached, like
  // js/events.js's `run.ev`, so a run object built by a test scaffold needs no
  // new fields to be legal and a tree without this module never grows one.
  //
  // `toadSpent` lives on the RUN and not on the stratum: at most one Undertoad
  // per run means the roll stops once it has been dealt, win or lose.
  function state(run) {
    if (!run.critters) {
      run.critters = {
        worms: [], lures: [], toad: null,
        beacon: null,      // M-SCHEMS2/Worm Whisperer: the cursor, published
        toadSpent: false,  // one per run, whether or not it was ever woken
        depth: 0, ate: 0, dug: 0, nextId: 1,
      };
    }
    return run.critters;
  }

  // =========================================================================
  // VEIN WORMS
  // Three cells of animal: '~~o', head last-drawn and brightest, dragging two
  // tail segments through the tiles it has already opened. It swims through
  // rock at one tile per `stepT` and leaves floor behind it — free excavation,
  // if you can persuade it to swim where you want.
  //
  // WHAT A WORM WILL NOT ENTER, and why the list is short: a machine, a belt,
  // a landmark, lava, glass, a chasm, the rig. Everything else is soup. It
  // will not eat the Company's hardware (that is the fiction and it is also
  // the thing that makes a worm safe to have around: a creature that could
  // destroy a base would be a combat system, and this brief has none), and it
  // will not swim through the three terrains nothing swims through.
  //
  // THE UNDERGROUND BELT PAIR. A worm's tunnel may cross the gap between a
  // paired tunnel entrance and its exit, and NOTHING HAPPENS — deliberately.
  // The pair is bound machine-to-machine at placement (sim.js pairTunnel
  // stores the two ids); the tiles between them are not consulted again by
  // anything, ever, so cargo keeps crossing whether that ground is rock,
  // floor or a hole a worm made. In the fiction the pair is buried deeper
  // than the worm swims. test/headless.js drives exactly this case.
  // =========================================================================
  const BLOCKED_T = { magma: true, obsidian: true, chasm: true };

  function passable(run, x, y) {
    if (x < 1 || y < 1 || x >= D.MAP_W - 1 || y >= D.MAP_H - 1) return false;
    const t = tileAt(run, x, y);
    if (!t) return false;
    if (t.machine !== null) return false;   // machines and the rig, untouched
    if (t.belt) return false;               // ...and the belts on top of them
    if (t.lm) return false;                 // ...and anything older than us
    if (t.toad) return false;               // ...and whatever that is
    return !BLOCKED_T[t.t];
  }

  // The tile a worm's head has just entered: it opens, and it pays out.
  function chew(run, S, w, t) {
    if (t.t === 'rock') {
      t.t = 'floor';
      t.digT = 0;                // a half-dug hole finished for you, for free
      S.dug++;
      w.dug++;
    }
    if (t.rubble) { t.rubble = false; t.digT = 0; }
    if (t.ore && t.oreAmt > 0) {
      const bite = Math.min(t.oreAmt, W().eat || 5);
      t.oreAmt -= bite;
      S.ate += bite;
      w.ate += bite;
      if (t.oreAmt <= 0) { t.ore = null; t.oreAmt = 0; }
      // Said once per worm per floor. A creature eating your seam is news;
      // a creature eating your seam eleven times is a log you stop reading.
      if (!w.said) {
        w.said = true;
        msg(run, 'Something is eating the vein from the inside.', C.worm);
        pushEvent(run, 'worm', { act: 'eat' });
      }
    }
  }

  // What a worm is swimming toward, or null. The lure outranks the beacon:
  // two coal on the floor is a commitment, and a cursor is where you happen
  // to be looking (M-SCHEMS2/Worm Whisperer publishes the cursor into
  // `S.beacon` from engine.js — sim never reads the UI).
  function targetFor(run, S, w) {
    let best = null, bestD = 1e9;
    for (const L of S.lures) {
      const d = Math.abs(L.x - w.x) + Math.abs(L.y - w.y);
      if (d < bestD) { bestD = d; best = L; }
    }
    if (best) return { x: best.x, y: best.y, lure: best };
    const b = S.beacon;
    if (b && run.mods && run.mods.wormBeacon) return { x: b.x, y: b.y, lure: null };
    return null;
  }

  // ONE DRAW, EVERY STEP, WHATEVER IT DECIDES (see the header). `r` is that
  // draw, and it is spent before anything is read — so a worm with a lure in
  // front of it and a worm with nothing to do cost the stream the same.
  function stepWorm(run, S, w) {
    const r = run.rng();
    const tgt = targetFor(run, S, w);
    let dirs;
    if (tgt) {
      // Steer: the two axis moves that close the gap, longer axis first, and
      // the draw decides how straight the line is. A worm that pathed like a
      // cursor would read as a machine (§0 law 6 — it must look ALIVE).
      const dx = tgt.x - w.x, dy = tgt.y - w.y;
      const hx = dx > 0 ? 1 : dx < 0 ? 3 : -1;
      const vy = dy > 0 ? 2 : dy < 0 ? 0 : -1;
      const primary = Math.abs(dx) >= Math.abs(dy) ? hx : vy;
      const other = primary === hx ? vy : hx;
      dirs = (r < 0.75 ? [primary, other] : [other, primary]).filter(k => k >= 0);
      // ...and if it is boxed in on both, it will take anything rather than
      // stop: a worm that stalls against a belt run is a worm the player
      // stops believing in.
      for (let k = 0; k < 4; k++) if (dirs.indexOf(k) < 0) dirs.push(k);
    } else {
      // Wander: hold the line, turn on the same draw, and keep the reverse of
      // its heading last so it does not spend the floor swimming back and
      // forth through one hole.
      const f = w.dir;
      dirs = r < (W().turn || 0.28)
        ? [(f + (r < (W().turn || 0.28) / 2 ? 1 : 3)) % 4, f, (f + 2) % 4]
        : [f, (f + 1) % 4, (f + 3) % 4, (f + 2) % 4];
      for (let k = 0; k < 4; k++) if (dirs.indexOf(k) < 0) dirs.push(k);
    }
    for (const k of dirs) {
      const d = D.DIRS[k];
      const nx = w.x + d.dx, ny = w.y + d.dy;
      if (!passable(run, nx, ny)) continue;
      w.body.unshift({ x: w.x, y: w.y });
      while (w.body.length > (W().segs || 3) - 1) w.body.pop();
      w.x = nx; w.y = ny; w.dir = k;
      chew(run, S, w, tileAt(run, nx, ny));
      if (tgt && tgt.lure && nx === tgt.lure.x && ny === tgt.lure.y) eatLure(run, S, tgt.lure);
      return;
    }
    // Sealed in on all four sides (obsidian pocket, a base built around it).
    // It waits. It has spent its draw either way.
  }

  function eatLure(run, S, L) {
    const i = S.lures.indexOf(L);
    if (i >= 0) S.lures.splice(i, 1);
    msg(run, 'The lure is gone. Something took it whole.', C.worm);
    pushEvent(run, 'worm', { act: 'lure' });
  }

  // ---------------- spawning ----------------
  // Candidate sites are read off the finished map (no draws), then ONE draw
  // picks among them and ONE more sets the heading — so a floor's spawn cost
  // is a fixed function of how many worms it is getting, never of the map.
  function spawnWorms(run, S, n) {
    const c = hubCentre(run);
    const minD = W().spawnMinD || 11;
    const cand = [];
    for (let y = 2; y < D.MAP_H - 2; y++)
      for (let x = 2; x < D.MAP_W - 2; x++) {
        const t = run.grid[y][x];
        if (t.t !== 'rock' || t.ore || t.lm || t.machine !== null) continue;
        if (Math.hypot(x - c.x, y - c.y) < minD) continue;
        cand.push({ x: x, y: y });
      }
    for (let i = 0; i < n; i++) {
      if (!cand.length) {
        // A floor with no unowned rock that far out is possible and is not an
        // error: it simply has fewer worms in it. Both draws are still spent,
        // so the stream does not care what the map looked like.
        run.rng(); run.rng();
        continue;
      }
      const site = cand[Math.floor(run.rng() * cand.length)];
      const dir = Math.floor(run.rng() * 4);
      S.worms.push({
        id: S.nextId++, x: site.x, y: site.y, dir: dir,
        body: [], ate: 0, dug: 0, said: false,
      });
    }
  }

  // =========================================================================
  // THE UNDERTOAD
  // A 2x2 'Ω' asleep in a chamber of its own, walled in rock, seen through it
  // on the sweep long before it can be reached. Build or dig within `wakeR`
  // and it wakes: one massive announced quake, then it burrows away and
  // leaves a crystal-lined tunnel behind it.
  //
  // Everything it will do is decided HERE, at placement, and stored on the
  // run. Waking rolls nothing (see the header), and it is placed by CARVING
  // ROCK ONLY — it opens a 2x2 pocket inside a solid 4x4 block of nobody's
  // rock and closes nothing, so no tile the rig could reach before can be
  // walled off by it and mapgen's invariants survive untouched.
  // =========================================================================
  // THE SEARCH IS TIERED, and the tiers are the point. A cave map made of
  // cellular rock has thin, wispy walls: a 2x2 pocket with a fully solid ring
  // around it exists on about one map in eight, and refusing anything less
  // would make the Undertoad a creature nobody meets. So three passes, best
  // first — a true sealed chamber, then any 2x2 of honest rock, then ground
  // that merely is not somebody's vein — and the first tier that has a
  // candidate is the one that gets picked from. Every tier is built by
  // READING the map and costs no draws, so which tier a map lands in can
  // never change how much stream the placement spends (§0 law 7).
  function toadSites(run) {
    const c = hubCentre(run);
    const minD = TOAD().minD || 10;
    const sealed = [], inRock = [], anywhere = [];
    for (let y = 3; y < D.MAP_H - 4; y++)
      for (let x = 3; x < D.MAP_W - 4; x++) {
        if (Math.hypot(x - c.x, y - c.y) < minD) continue;
        let rockAll = true, floors = 0, bad = false;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const t = run.grid[y + dy][x + dx];
            // never a vein, never a wonder, never the rig, never the lava
            if (t.ore || t.lm || t.machine !== null || t.t === 'magma') bad = true;
            if (t.t !== 'rock') rockAll = false;
            if (t.t === 'floor') floors++;
          }
        if (bad) continue;
        if (floors <= 2) anywhere.push({ x: x, y: y });
        if (!rockAll) continue;
        inRock.push({ x: x, y: y });
        let ring = true;
        for (let dy = -1; dy < 3 && ring; dy++)
          for (let dx = -1; dx < 3 && ring; dx++) {
            if (dx >= 0 && dx < 2 && dy >= 0 && dy < 2) continue;
            if (run.grid[y + dy][x + dx].t === 'floor') ring = false;
          }
        if (ring) sealed.push({ x: x, y: y });
      }
    return sealed.length ? sealed : inRock.length ? inRock : anywhere;
  }

  function placeToad(run, S) {
    const T = TOAD();
    if (S.toadSpent || run.depth < (T.minDepth || 6)) return;
    if (run.rng() >= (T.chance || 0.15)) return;      // ONE draw, always here
    const cand = toadSites(run);
    // Three more draws, spent whether or not a site was found, for the same
    // reason the spawn loop spends its two: the MAP must not decide the
    // stream, only the seed and the floor may.
    const tun = T.tunnel || [6, 10];
    const pick = Math.floor(run.rng() * Math.max(1, cand.length));
    const dir = Math.floor(run.rng() * 4);
    const len = tun[0] + Math.floor(run.rng() * (tun[1] - tun[0] + 1));
    if (!cand.length) return;
    S.toadSpent = true;                               // one to a run, and this is it
    const s = cand[pick];
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const t = run.grid[s.y + dy][s.x + dx];
        t.t = 'floor';        // the chamber: opened, never closed (no tile is
        t.rubble = false;     // walled off by this, so mapgen's invariant 3
        t.digT = 0;           // survives untouched)
        t.toad = true;        // read by render (the glyph) and by sim (no build)
      }
    S.toad = { x: s.x, y: s.y, dir: dir, len: len, awake: false, gone: false };
  }

  // The one quake nobody scheduled. No draws: the tiles are the ring around
  // the chamber, which is exactly the ground the player just chose to stand
  // near, and the hull takes the rest. Machines in the ring are damaged, not
  // deleted — the toad is a price, not an execution.
  function toadQuake(run, S) {
    const T = TOAD(), t0 = S.toad;
    const cx = t0.x + 0.5, cy = t0.y + 0.5, R = T.quakeR || 5;
    let rubbled = 0;
    const hit = {};
    for (let y = 0; y < D.MAP_H; y++)
      for (let x = 0; x < D.MAP_W; x++) {
        if (Math.hypot(x - cx, y - cy) > R) continue;
        const t = run.grid[y][x];
        if (t.toad || t.lm || t.machine === 0) continue;
        if (t.machine !== null) { hit[t.machine] = 1; continue; }
        if (t.t === 'floor' && !t.rubble) { t.rubble = true; t.belt = null; rubbled++; }
        else if (t.belt) t.belt = null;
      }
    for (const id in hit) {
      const m = run.machines[id];
      if (m && DC.Sim && DC.Sim.damage) DC.Sim.damage(run, m);
    }
    run.integrity -= T.dmg || 22;
    run.instability = U.clamp((run.instability || 0) + (T.inst || 12), 0, D.INSTAB_MAX);
    run.shake = true;
    return rubbled;
  }

  // ...and then it leaves, and what it leaves is the point. The tunnel runs
  // from the chamber in the heading rolled at placement, opening rock and
  // laying crystal in the floor of it. It stops at anything it cannot open —
  // a short tunnel is a worse prize, never a broken map.
  function toadBurrow(run, S) {
    const T = TOAD(), t0 = S.toad, S0 = stratumOf(run);
    const amt = Math.max(1, Math.round((S0.rich[0] + S0.rich[1]) / 2 * (T.richMult || 1)));
    // The heading was rolled at placement and it is a PREFERENCE, not a
    // promise: the four directions are measured (no draws — this only reads
    // the map) and the longest run wins, ties going to the roll. A creature
    // that burrowed straight into the obsidian it had been sleeping against
    // would hand the player the terror and none of the prize, and the prize
    // is the entire transaction.
    let best = t0.dir, bestN = probeBurrow(run, t0, t0.dir);
    for (let k = 1; k < 4; k++) {
      const dir = (t0.dir + k) % 4;
      const n = probeBurrow(run, t0, dir);
      if (n > bestN) { bestN = n; best = dir; }
    }
    t0.dir = best;
    const laid = carveBurrow(run, t0, best, amt);
    clearChamber(run, t0);
    return laid;
  }
  // One walk down a heading from the chamber's edge, stopping at the first
  // thing the creature cannot swim through. `amt` null measures, a number
  // carves — one route, so the tunnel it digs is always the one it measured.
  function burrowWalk(run, t0, dir, amt) {
    const d = D.DIRS[dir];
    let x = t0.x + (d.dx > 0 ? 1 : 0), y = t0.y + (d.dy > 0 ? 1 : 0);
    let laid = 0;
    for (let i = 0; i < t0.len; i++) {
      x += d.dx; y += d.dy;
      if (x < 1 || y < 1 || x >= D.MAP_W - 1 || y >= D.MAP_H - 1) break;
      const t = run.grid[y][x];
      if (t.lm || t.toad || t.machine !== null || t.belt || BLOCKED_T[t.t]) break;
      if (amt !== null) {
        t.t = 'floor';
        t.rubble = false; t.digT = 0;
        if (!t.ore) { t.ore = 'crystal'; t.oreAmt = amt; }
      }
      laid++;
    }
    return laid;
  }
  function probeBurrow(run, t0, dir) { return burrowWalk(run, t0, dir, null); }
  function carveBurrow(run, t0, dir, amt) { return burrowWalk(run, t0, dir, amt); }
  // The chamber floor is ordinary ground again: the tenant has moved out.
  function clearChamber(run, t0) {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const t = tileAt(run, t0.x + dx, t0.y + dy);
        if (t) t.toad = false;
      }
  }

  // Something was built or dug at (x, y). If the toad is within `wakeR` of it,
  // this is the moment. Called from sim.js's place() and demolishAt().
  function disturb(run, x, y) {
    const S = run && run.critters;
    if (!S || !S.toad || S.toad.awake) return false;
    const T = TOAD(), t0 = S.toad;
    const dx = Math.max(t0.x - x, 0, x - (t0.x + 1));
    const dy = Math.max(t0.y - y, 0, y - (t0.y + 1));
    if (Math.max(dx, dy) > (T.wakeR || 3)) return false;
    t0.awake = true;
    msg(run, '»» YOU WOKE IT. HARD HATS. ««', C.toad);
    const rubbled = toadQuake(run, S);
    const laid = toadBurrow(run, S);
    t0.gone = true;
    msg(run, 'It goes down and away. The wall it left is full of crystal.',
        C.magenta);
    pushEvent(run, 'toad', { act: 'wake', tiles: laid, rubble: rubbled });
    return true;
  }

  // =========================================================================
  // THE LURE
  // Two coal on a floor tile, and every worm on the stratum turns toward it.
  // This is the whole of the "secretly, tools" half of the brief: the cost is
  // fuel you would otherwise have burned, and what you buy is a tunnel dug
  // through the rock wall between you and that far crystal seam, by a
  // creature, for free. Emergent: nothing here scripts a route.
  // =========================================================================
  function lure(run, x, y) {
    const S = state(run);
    const cost = W().lureCost || 2;
    if (!S.worms.length)
      return { ok: false, reason: 'nothing down here to call' };
    const t = tileAt(run, x, y);
    if (!t) return { ok: false, reason: 'out of bounds' };
    if (!t.revealed) return { ok: false, reason: 'unscanned ground' };
    if (t.t !== 'floor' || t.toad) return { ok: false, reason: 'needs open floor' };
    if (t.machine !== null) return { ok: false, reason: 'blocked by structure' };
    if (t.belt) return { ok: false, reason: 'blocked by belt' };
    if (t.rubble) return { ok: false, reason: 'blocked by rubble' };
    if (t.lm) return { ok: false, reason: 'older than the Company' };
    for (const L of S.lures)
      if (L.x === x && L.y === y) return { ok: false, reason: 'already baited' };
    if ((run.inv.coal || 0) < cost)
      return { ok: false, reason: 'need ' + cost + ' ' + D.ITEMS.coal.name };
    run.inv.coal -= cost;
    S.lures.push({ x: x, y: y });
    msg(run, 'Coal on the floor. Now we wait.', C.coal);
    pushEvent(run, 'worm', { act: 'bait' });
    return { ok: true };
  }

  // ---------------- lifecycle ----------------
  // Called from sim.js startStratum, on a finished map, AFTER the mutator has
  // been rolled — 'worm season' is a count, and it has to already be known.
  function start(run) {
    const S = state(run);
    S.worms = [];
    S.lures = [];
    S.toad = null;
    S.beacon = null;
    S.depth = run.depth;
    if (run.depth < (W().minDepth || 3)) return;
    // M-MANTLE/'worm season', wired. The mutator table already gates itself on
    // this module being loaded (sim.js mutatorTable), so the day this file
    // shipped the floor rule started dealing itself; all it needed was the
    // count, read from its own data.js entry rather than typed here.
    const mut = (DC.Sim && DC.Sim.mutatorOf) ? DC.Sim.mutatorOf(run) : null;
    const seasonN = (mut && mut.id === 'worms' && mut.count) ? mut.count : 0;
    // ONE draw for the count, spent whether or not the season overrules it —
    // the mutator decides how many worms, never how much stream they cost.
    const cnt = W().count || [1, 2];
    const rolled = U.ri(run.rng, cnt[0], cnt[1]);
    spawnWorms(run, S, seasonN || rolled);
    placeToad(run, S);
  }

  // Ticked from sim.js AFTER the machines, so a worm never opens ground a
  // machine has already read this tick, and BEFORE the hazards, so a quake
  // lands on the map the worms just left.
  function tick(run) {
    const S = run && run.critters;
    if (!S || !S.worms.length) return;
    if (run.t % (W().stepT || 16) !== 0) return;
    for (const w of S.worms) stepWorm(run, S, w);
  }

  // ---------------- read-only surface ----------------
  // Everything render.js and the suites need, and nothing that mutates.
  function cells(run) {
    // Head first, then the tail from newest to oldest — render walks this in
    // reverse so the head is drawn last and always wins its cell.
    const S = run && run.critters;
    const out = [];
    if (!S) return out;
    for (const w of S.worms) {
      out.push({ x: w.x, y: w.y, head: true, id: w.id });
      for (let i = 0; i < w.body.length; i++)
        out.push({ x: w.body[i].x, y: w.body[i].y, head: false, id: w.id, seg: i });
    }
    return out;
  }

  // The SCAN panel's contribution for a tile, or null. sim.js's describeTile
  // asks this FIRST for a worm or the toad — a creature standing on a tile
  // outranks the dirt it is standing on.
  function describe(run, x, y) {
    const S = run && run.critters;
    if (!S) return null;
    const t = tileAt(run, x, y);
    if (t && t.toad && S.toad && !S.toad.gone) {
      return [
        { text: 'THE UNDERTOAD', color: C.toad },
        { text: 'asleep, and bigger than the chamber', color: C.gray },
        { text: 'build or dig within ' + (TOAD().wakeR || 3) + ' and it wakes',
          color: C.red },
      ];
    }
    for (const L of S.lures)
      if (L.x === x && L.y === y)
        return [
          { text: 'coal lure', color: C.amber },
          { text: 'the worms are coming for it', color: C.gray },
        ];
    for (const w of S.worms) {
      const head = w.x === x && w.y === y;
      const seg = head || w.body.some(b => b.x === x && b.y === y);
      if (!seg) continue;
      return [
        { text: head ? 'VEIN WORM — head' : 'vein worm', color: C.worm },
        { text: 'it eats ore and leaves tunnel', color: C.gray },
        { text: '(L) baits it with ' + (W().lureCost || 2) + ' coal', color: C.amberDim },
      ];
    }
    return null;
  }

  DC.Worms = {
    start: start, tick: tick, lure: lure, disturb: disturb,
    // M-SCHEMS2/Worm Whisperer: engine.js publishes the cursor here every
    // frame the card is installed, so the sim reads run state and never the
    // UI. A null beacon is the ordinary case and costs nothing.
    beacon: function (run, x, y) {
      if (!run) return;
      const S = state(run);
      S.beacon = (x === null || x === undefined) ? null : { x: x, y: y };
    },
    // read-only
    list: function (run) { return (run && run.critters && run.critters.worms) || []; },
    lures: function (run) { return (run && run.critters && run.critters.lures) || []; },
    toad: function (run) { return (run && run.critters && run.critters.toad) || null; },
    cells: cells, describe: describe,
    peek: function (run) { return (run && run.critters) || null; },
    state: state,
  };
})();
