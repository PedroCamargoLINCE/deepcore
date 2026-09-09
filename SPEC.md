# DEEPCORE — Implementation Specification

An incremental automation roguelike in the terminal aesthetic. The player commands a
drilling rig descending through 8 procedurally generated strata toward the planet's
core. In each stratum they build a small automated factory (extractors → belts →
smelters → assemblers) whose throughput of **drill gears** and **core charges**
directly powers the drill's breach progress. Rising **instability** causes quakes
that punish camping — the game is about *getting through*, not surviving. Meta
progression (the Foundry) is small and secondary.

Pillars: Factorio-lite logistics on a Dwarf-Fortress-style glyph map, runs of
10–25 minutes (win at stratum 8), an endless Mantle for advanced 30–40 min runs,
heavy ASCII art, zero external dependencies, runs from `file://`.

---

## 1. Tech & module contracts

Plain browser JavaScript. **No TypeScript, no ES modules, no external libraries.**
Every file registers into a shared `DC` namespace with this exact pattern so files
work both in the browser and under headless node:

```js
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DC = root.DC = root.DC || {};
  // ... attach DC.Xxx here ...
})();
```

Load order (script tags in `index.html`, already written):
`js/data.js → js/art.js → js/map.js → js/sim.js → js/meta.js → js/render.js → js/engine.js → js/main.js`

DOM-free files (must never touch `window`/`document`/`localStorage` except via the
guarded pattern): **data.js, art.js, map.js, sim.js, meta.js**. `meta.js` guards
`localStorage` behind `typeof localStorage !== 'undefined'`.

`js/data.js` **already exists and is the single source of truth** for all constants,
items, buildings, recipes, strata, schematics, and meta upgrades. Read it in full
before implementing anything. Do not duplicate its values; reference `DC.DATA`.

Module surfaces (exact — other modules call these):

- `DC.MapGen.generate(depth, rng, mods)` → `{ grid, hub: {x, y} }` — §4
- `DC.Sim` — §5 (API list at §5.9)
- `DC.Meta` — §10
- `DC.Render.init(canvas)`, `DC.Render.frame(state)`, `DC.Render.pxToCell(px, py)` → `{col,row}` — §7
- `DC.Art` — §9 (pure data + `DC.Art.center(lines, width)` helper)
- `DC.Engine.start()` — §6
- `main.js`: `window.addEventListener('load', () => DC.Engine.start())`

---

## 2. Global state shape

`DC.state` (created by engine.js):

```js
DC.state = {
  screen: 'title',   // 'title'|'run'|'descend'|'foundry'|'help'|'gameover'|'victory'
  meta: null,        // DC.Meta profile (loaded at start)
  run: null,         // active run (below) or null
  ui: {
    tool: null,          // null | 'belt'|'extractor'|'smelter'|'assembler'|'damper'|'demolish'
    facing: 1,           // 0=N 1=E 2=S 3=W (R rotates)
    hover: null,         // {x, y} map tile under mouse, or null
    dragging: false,     // belt-drag gesture in progress
    dragLast: null,      // {x, y} last cell of drag
    paused: false,
    descendAnim: 0,      // frame counter for descent animation
    shakeUntil: 0,       // run.t until which render shakes the map
    flash: null,         // {text, color, until} big banner over map
  },
}
```

Run state (created by `DC.Sim.newRun`):

```js
run = {
  seed, rng,             // mulberry32; rng used for ALL run randomness
  depth: 1,              // current stratum (1-based)
  status: 'active',      // 'active'|'breachReady'|'dead'|'won'
  t: 0,                  // ticks elapsed in current stratum
  totalT: 0,             // ticks elapsed across the whole run
  grid, hub,             // from MapGen (hub = {x,y} of 3x3 anchor, top-left)
  machines: {},          // id -> machine (below); nextId: 1
  nextId: 1,
  inv: {},               // hub inventory: itemId -> count (this IS the build currency)
  gearsFed: 0, chargesFed: 0,   // drill progress this stratum
  breachReq: { gear, charge },  // after schematic/meta modifiers
  integrity, maxIntegrity,
  instability: 0,        // 0..100
  quakeAt: 0,            // tick of next quake (0 = unscheduled)
  overdrive: false,
  schematics: [],        // chosen schematic ids
  mods: {},              // consolidated modifiers (see §5.8)
  pendingOffers: null,   // schematic ids offered on descend screen
  breaches: 0,           // strata cleared (drives cores earned)
  mantle: false,         // continued past victory
  messages: [],          // [{text, color, t}] newest LAST; cap 40
  result: null,          // set on death/win: {depth, breaches, timeSec, cores, won}
  magmaCap: 0,           // initial magma tiles * DC.DATA.MAGMA.growthCap
}
```

Machine:

```js
machine = {
  id, type,              // type: key into DC.DATA.BUILDINGS
  x, y, w, h,            // anchor top-left + size
  facing,                // 0..3; output side
  hp,                    // from BUILDINGS[type].hp; 1 = damaged (half speed)
  progress: 0,           // craft ticks accumulated
  recipe: null,          // recipe id (assembler: player-cycled; smelter: auto)
  input: {},             // itemId -> count buffered
  fuel: 0,               // smelts remaining from consumed coal (smelter); coal ticks (damper)
  status: 'idle',        // 'ok'|'idle'|'blocked'|'nofuel'|'damaged'|'depleted'
  repairAt: 0,           // if s_repair: tick when self-repair completes (0 = none)
}
```

Tile (grid is `grid[y][x]`, `y` in `0..MAP_H-1`):

```js
tile = {
  t: 'floor'|'rock'|'obsidian'|'chasm'|'magma',
  ore: null | 'ironOre'|'copperOre'|'coal'|'crystal',
  oreAmt: 0,
  machine: null,         // machine id occupying this tile
  belt: null,            // { dir: 0..3, item: null|itemId, moved: false }
  rubble: false,
  digT: 0,               // >0: excavation in progress, ticks remaining
  revealed: false,
}
```

---

## 3. Game flow

```
title ──ENTER──▶ run ──breach & D──▶ descend (anim + schematic pick) ──▶ run (depth+1)
  │  F: foundry   │                                  after depth 8 breach ──▶ victory
  │  H: help      │ integrity ≤ 0 ──▶ gameover              victory: ENTER = end run,
  └──────────────◀┴── Esc pause menu (resume / abandon run / help)   C = continue (Mantle)
```

Cores earned at run end (death, abandon, or ascend after victory):
`run.breaches + (won ? DC.DATA.WIN_CORES : 0)`. Award via `DC.Meta.award(result)`.

---

## 4. Map generation — `js/map.js`

`DC.MapGen.generate(depth, rng, mods)` → `{ grid, hub }`. Deterministic given rng.
Stratum params: `depth <= 8` → `DC.DATA.STRATA[depth-1]`, else `DC.DATA.mantleStratum(depth)`.

1. **Caves**: fill `MAP_W×MAP_H` with rock at ~45%, floor elsewhere; run 4 cellular
   automata smoothing passes (rock if ≥5 rock neighbors of 8). Border ring is rock.
2. **Hub site**: hub anchor near map center (±4 tiles, rng). Clear a 7×7 floor area
   centered on the hub's 3×3 footprint. Mark hub tiles `machine: 0` — machine id 0
   is reserved for the hub (sim creates it).
3. **Ore veins**: `nodes` blobs. For each: roll type by `ores` weights, pick a floor
   tile ≥ 4 tiles from hub footprint, grow a random-walk blob of 4–8 tiles (floor
   tiles only, may convert adjacent rock to floor-with-ore). Each tile gets
   `oreAmt = ri(rich[0], rich[1])` (× `1.5` if `mods.richVeins`).
   **Guarantee**: at least 2 iron veins and 1 coal vein with ≥6 total tiles each
   within radius 12 of hub center; if the roll fails, force-place them.
4. **Chasms** (`features.chasms`): N random-walk cracks of length 8–18, 1–2 wide,
   avoiding the 7×7 hub clearing. Tiles become `chasm`.
5. **Magma** (`features.magma`): N pools (blobs of 3–6) at map edge regions, ≥ 10
   tiles from hub. Tiles become `magma`.
6. **Obsidian** (`features.obsidian`): convert ~35% of remaining rock into `obsidian`
   in vein-like walls (random walks along rock), creating a maze feel. Never inside
   the hub clearing.
7. **Connectivity**: flood-fill floor from hub; any ore vein not reachable gets a
   1-wide floor corridor carved to it (straight L-shape through rock, not through
   obsidian/chasm/magma — if impossible, relocate the vein).
8. All tiles start `revealed: false`; sim reveals by radius (§5.6).

---

## 5. Simulation — `js/sim.js`

All logic is tick-based (`DC.DATA.TICK_HZ` = 8/s). No wall-clock, no `Date.now()`.
`run.rng` is the only randomness source. Sim is DOM-free and must not read `DC.state`
— everything it needs lives in `run` (pass `metaEffects` into `newRun`).

### 5.1 Tick order — `DC.Sim.tick(run)`

Runs only while `status` is `'active'` or `'breachReady'`:

1. `run.t++; run.totalT++`; reveal update (§5.6); dig timers (§5.5).
2. Machines, ascending id: pull nothing (belts push — §5.2); advance crafts (§5.3);
   eject outputs (§5.3); damper burn (§5.4); self-repair checks.
3. Belts advance if `t % BELT_PERIOD === 0` (§5.2).
4. Drill consumes if `t % drillPeriod === 0` (§5.7).
5. Instability += `effRate / TICK_HZ` (§5.8), clamped 0..100.
6. Quake scheduling/firing (§5.5); magma spread & burn (§5.5).
7. Status: if `gearsFed ≥ breachReq.gear && chargesFed ≥ breachReq.charge` and status
   is `'active'` → `'breachReady'`, msg `»» BREACH READY — press D to descend ««`.
   If `integrity ≤ 0` → `'dead'`, set `run.result`.

### 5.2 Belts

A belt tile holds ≤ 1 item. Every `BELT_PERIOD` ticks:

```
for every belt tile: belt.moved = false
repeat (max 60 passes) until a full pass makes no move:
  for each belt tile b at (x,y), row-major, with b.item and !b.moved:
    (tx,ty) = neighbor in b.dir
    target = grid[ty][tx] (skip if out of bounds)
    if target.machine != null:
        m = machine; if m is hub → credit item to run.inv, b.item = null, b.moved = true
        else if machineAccepts(m, b.item) → m.input[item]++, b.item=null, b.moved=true
        (machineAccepts: item is an input of m's current/possible recipes — smelter:
         any ore of its two recipes or coal-as-fuel; assembler: inputs of selected
         recipe; damper: coal — and buffer/fuel below INPUT_CAP)
    else if target.belt and target.belt.item == null:
        target.belt.item = b.item; target.belt.moved = true; b.item = null; b.moved = true
```

Belts **push** into machines/hub; machines never pull. Items on a destroyed belt are
lost. A belt with no valid target simply holds its item (backpressure).

### 5.3 Machines (extractor, smelter, assembler)

Speed: `damaged (hp==1)` → half speed (accumulate progress on even ticks only).
Craft time modifiers: extractor `period / (1 + 0.35·s_extract)`, smelter
`ticks / (1 + 0.30·s_smelt)` — see §5.8 `mods`.

- **Extractor**: sits on an ore tile. Every effective period: if the tile's
  `oreAmt > 0`, decrement it and produce that ore to the **output tile** (below).
  `oreAmt == 0` → status `'depleted'`, never produces again.
- **Smelter**: auto-recipe — if it has ≥1 iron ore buffered pick `smeltIron`, else
  copper ore → `smeltCopper`, else idle. Fuel: crafting requires `fuel > 0`; when
  fuel hits 0, consume 1 buffered coal → `fuel = FUEL_PER` (× 2 with `s_coal`).
  No coal & none buffered → status `'nofuel'`. Consumes recipe inputs when a craft
  *starts*; outputs on completion.
- **Assembler**: `recipe` field, default `'gear'`. `clickTile` cycles through
  `ASSEMBLER_RECIPES` (skipping `bronzeGear` unless `mods.bronzeGear`). Crafts when
  all inputs buffered.

**Output tile** (outside the footprint, centered on the facing side):
- N: `(x + floor((w-1)/2), y-1)` E: `(x+w, y + floor((h-1)/2))`
- S: `(x + floor((w-1)/2), y+h)` W: `(x-1, y + floor((h-1)/2))`

Eject on completion: output tile has empty belt → place item; is hub → credit
`run.inv`; is a machine that accepts it → its buffer; else status `'blocked'` and
the finished item waits (retry every tick).

Status precedence for display: `depleted > damaged > nofuel > blocked > ok/idle`
(`ok` while progressing, else `idle`).

### 5.4 Damper

Consumes buffered coal: while `fuel > 0`, decrement each tick; when 0, consume
1 coal → `fuel = BUILDINGS.damper.coalTicks`. While fueled it is "active".
Active dampers (max `DAMPER_MAX` count) each multiply instability rate by
`(1 - BUILDINGS.damper.calm)` — see §5.8. Unfueled → `'nofuel'`.

### 5.5 Hazards

- **Excavation**: `demolishAt` on rock sets `digT = DIG_ROCK`; on rubble
  `digT = DIG_RUBBLE`. Tick decrements; at 0, rock→floor / rubble cleared.
  Multiple digs may run concurrently (each tile has its own timer). Obsidian and
  chasm are never diggable.
- **Quakes**: when `instability ≥ QUAKE.startInst` and `quakeAt == 0`, schedule
  `quakeAt = t + secs·TICK_HZ` where secs interpolates from `stratum.quakeBase`
  (at startInst) down to `QUAKE.collapseIvl` (at 100), with ±`jitter`. On fire:
  - damage `QUAKE.tiles(inst, depth)` random targets: 55% a random built tile
    (belt → destroyed, item lost; machine → `hp−1`, destroyed at 0 with no refund;
    hub immune), 45% a random revealed floor tile → `rubble = true` (destroys any
    belt there; a machine tile takes `hp−1` instead of rubble).
  - integrity −= `QUAKE.integrityDmg(inst, depth)`.
  - msg + set `run.shake = true` flag consumed by engine (engine sets
    `ui.shakeUntil = run.t + 4`). At `instability ≥ 99` message reads
    `!! COLLAPSE — the stratum is failing !!` (red).
  - reschedule (`quakeAt = 0`).
- **Magma** (strata with magma): every `MAGMA.period` ticks, each floor tile
  orthogonally adjacent to magma has `MAGMA.spreadChance` to become magma (belts
  destroyed, machines destroyed) while total magma < `run.magmaCap`. Every
  `MAGMA.burnPeriod` ticks: machines orthogonally adjacent to magma take 1 hp;
  belts adjacent are destroyed; hub adjacent → integrity −`MAGMA.hubBurn`.
- **Self-repair** (`s_repair`): when a machine drops to `hp 1`, set
  `repairAt = t + 15·TICK_HZ`; at that tick, if still damaged, restore hp.

### 5.6 Reveal

Tiles within `radius(t) = REVEAL_R0 + metaScanBonus + floor(t / REVEAL_TICKS)` of
hub center (Euclidean) become `revealed`. `mods.fullReveal` (s_survey) reveals all
at stratum start. Unrevealed tiles render dark; building on them is not allowed.

### 5.7 The drill (hub)

Machine id 0, indestructible, 3×3 at `hub.x, hub.y`. Belts pointing into any hub
tile deliver items to `run.inv`. Every `drillPeriod = round(DRILL_PERIOD / mods.drillMult
/ (overdrive ? OVERDRIVE.drillMult : 1))` ticks the drill auto-feeds:

- if `gearsFed < breachReq.gear` and `inv.gear > 0`: `inv.gear--; gearsFed++`
- else if `chargesFed < breachReq.charge` and `inv.charge > 0`:
  `inv.charge--; chargesFed += (mods.chargeX2 ? 2 : 1)`

Overdrive (`toggleOverdrive`): while on, instability rate ×`OVERDRIVE.instMult`
(halved penalty with `s_over`: ×`1 + (instMult-1)/2`).

`breachReq` = stratum values × `(1 - 0.15·s_drill)` (ceil). Charges only appear
from stratum 5 — see data.

### 5.8 Modifiers — `run.mods`

Consolidated once at `newRun` (meta) and updated when a schematic is chosen.
Keys sim reads: `beltFree, extractMult, smeltMult, coalX2, instMult, autoRepair,
breachMult, salvage (0|0.4|0.6), fullReveal, chargeX2, overCheap, richVeins,
bronzeGear, drillMult, startBonus{...}, scanBonus, repairCost, integrityBonus,
offerCount (3|4)`. Meta effects come from `metaEffects` param (§10); schematic
effects from `DC.DATA.SCHEMATICS` ids. Stack multiplicatively where both exist
(e.g. m_damp levels × s_damp). Dampers multiply on top (§5.4).

### 5.9 Sim API (exact signatures)

```js
DC.Sim.newRun(metaEffects, seed) -> run     // builds mods, stock, integrity; calls startStratum
DC.Sim.startStratum(run)                    // generates map for run.depth, resets t,
                                            // instability (-45 carryover, min 0), gearsFed/chargesFed,
                                            // breachReq, machines (hub only), reveal
DC.Sim.tick(run)
DC.Sim.canPlace(run, type, x, y, facing) -> { ok, reason }
    // checks: revealed, in bounds, all footprint tiles floor (no rubble/machine/belt),
    // extractor MUST target an ore tile, cost affordable (beltFree), damper count < max is NOT
    // enforced (extras just do nothing)
DC.Sim.place(run, type, x, y, facing) -> bool          // pays cost from inv
DC.Sim.demolishAt(run, x, y) -> { ok, reason }
    // machine → refund 50% cost + credit its input buffer to inv; belt → refund (unless free) ;
    // rubble/rock → start dig; hub → refuse
DC.Sim.clickTile(run, x, y) -> { handled, msg }
    // priority: damaged machine → repair (cost mods.repairCost iron plates);
    // assembler → cycle recipe; hub → toggleOverdrive; else nothing
DC.Sim.toggleOverdrive(run)
DC.Sim.beginDescent(run) -> bool            // only if status==='breachReady'; applies salvage refund;
                                            // run.breaches++; if depth===8 && !mantle → status 'won',
                                            // set result (won:true); else run.pendingOffers = offerSchematics(run)
DC.Sim.continueIntoMantle(run)              // from victory: mantle=true, pendingOffers=offerSchematics(run)
DC.Sim.applySchematic(run, id)              // push id, update mods, depth++, startStratum, pendingOffers=null
DC.Sim.abandon(run)                         // status 'dead' + result (used from pause menu)
DC.Sim.describeTile(run, x, y) -> [ {text, color}, ... ]   // ≤5 tooltip lines for sidebar
DC.Sim.feedRate(run) -> { gearPerSec, chargePerSec }       // rolling estimate for UI (last 10s window)
DC.Sim.msg(run, text, color)                // push to messages, cap 40
```

`offerSchematics(run)`: `mods.offerCount` distinct schematics not yet taken
(rng-shuffled; one-per-run each; if pool exhausted, allow repeats of multiplicative
ones: s_extract, s_smelt, s_plate, s_veins).

Descent carry-over: `inv` carries; machines are lost (salvage refunds a fraction of
their build cost first); instability drops by 45 (min 0); integrity carries.

---

## 6. Engine & input — `js/engine.js`, `js/main.js`

`DC.Engine.start()`: grab `#screen` canvas, `DC.Render.init(canvas)`, load meta
profile, build `DC.state`, install listeners, start loop.

**Loop**: `requestAnimationFrame` render every frame (`DC.Render.frame(DC.state)`);
fixed-step logic accumulator at `TICK_HZ` while `screen === 'run'` and not paused
(clamp accumulated time to 0.5 s to survive tab-switches). Seed: `?seed=N` URL param
if present else `(Math.random()*2**31)|0` computed once at run start (engine may use
Math.random — sim may not). `?fast=1` doubles TICK_HZ (debug).

**Keyboard** (by `screen`):
- title: `Enter` new run → `Sim.newRun(Meta.effects(state.meta), seed)`, screen `run`;
  `f` foundry; `h` help.
- run: `1-5` select build tool (BUILD_ORDER); `x` demolish tool; `r` rotate facing;
  `Escape` → if tool active clear tool, else pause menu overlay (`ui.paused`,
  options Resume `Esc`/`Enter`, Abandon `a`, Help `h`); `c` overdrive; `d` descend
  when `breachReady`; `Space` toggle pause; `h` help.
- descend: schematic pick `1..offerCount` or click card (after animation finishes).
- foundry: letter keys `a..i` per row to buy; `Escape`/`Enter` back to title.
- help / gameover / victory: `Escape`/`Enter` back (victory also `c` = continue).

**Mouse** (canvas `mousemove`, `mousedown`, `mouseup`, `mouseleave`):
`Render.pxToCell` → map tile (subtract MAP_X/MAP_Y, check bounds) → `ui.hover`.
- Click with build tool → `Sim.place` (msg on failure reason).
- Click with demolish tool → `Sim.demolishAt`.
- Click with no tool → `Sim.clickTile`.
- **Belt dragging**: mousedown with belt tool places a belt at cell (facing =
  `ui.facing`) and sets `dragging`. On entering a new cell orthogonally adjacent to
  `dragLast` while dragging: `dir` = delta direction; if `dragLast` belt was placed
  in this gesture, update its `dir` too (corners turn); place new belt with `dir`.
  Mouseup ends the gesture.
- Clicks on the sidebar build list select tools; clicking hub = overdrive.

**Screen transitions**: `Sim.tick` may set `status` — engine watches after each tick:
`dead` → `Meta.award(result)`, save, screen `gameover`. `won` → `Meta.award` once
(guard flag), screen `victory`. `breachReady` → flash banner once. `d` key →
`Sim.beginDescent`; if `pendingOffers` → screen `descend` with `ui.descendAnim = 0`
(render plays `Art.descent` frames, ~2.5 s, then shows cards); victory handled above.
Choice → `Sim.applySchematic`, screen `run`.

Engine also mirrors `run.shake` → `ui.shakeUntil`, and sets `ui.flash` for breach
ready / quake warnings.

`main.js` is 3 lines (load listener → `DC.Engine.start()`).

---

## 7. Renderer — `js/render.js`

Canvas 2D, character-cell grid `COLS×ROWS` (80×33). `init` measures cell size:
`CW = 10, CH = 19`, font `'16px "DejaVu Sans Mono", "Cascadia Mono", Consolas,
"Courier New", monospace'`. Canvas pixel size `COLS*CW × ROWS*CH` × devicePixelRatio
(ctx.scale), CSS size set to logical pixels. `pxToCell` inverts (account for CSS
scaling via `getBoundingClientRect`).

Internal helpers: `put(col, row, ch, color)`, `text(col, row, str, color)`,
`box(col, row, w, h, color, title?)` (single-line box drawing ┌─┐│└┘ with optional
` TITLE ` in the top edge), `bar(col, row, width, frac, color)` (filled `█`/`░`).
Full clear + redraw every frame is fine. Batch same-color runs into single
`fillText` calls for speed. Blink phase = `Math.floor(state.run?.t / 4) % 2` (use a
frame counter on non-run screens).

**Run screen layout** (character grid coords):

```
row 0     ▌DEEPCORE▐  STRATUM 3 — KARST HOLLOWS   DEPTH -360m        ELAPSED 12:41
row 1     (thin rule ─────)
rows 2-29 map box: border box at cols 0..47, map tiles inside at (MAP_X, MAP_Y)
          — tile (x,y) renders at grid (MAP_X + x, MAP_Y + y) with MAP_X=1, MAP_Y=3
rows 30-32  key hints line(s): tool keys, R rotate, X demolish, C overdrive, D descend...
cols 49-79  sidebar (see below)
```

(The map box is 48 wide × 28 tall holding the 46×26 map; title in its top border:
` STRATUM 3 ─ KARST HOLLOWS `. MAP_Y=3 leaves row 2 for the box's top border.)

Sidebar sections (boxed, tight, top to bottom — heights flexible but keep total ≤33):
- `RIG` — INTEGRITY bar (green→amber→red by fraction) `72/100`; INSTABILITY bar
  (color shifts, **blinks red ≥ 80**) with numeric.
- `DRILL` — BREACH bar + `24/58 ¤` (+ second row `3/8 ‡` when charges required);
  feed rate `0.4¤/s`; `OVERDRIVE ON/OFF` (red when on).
- `STOCK` — hub inventory: glyph, name, count for each nonzero item in ITEM_ORDER
  (always show ironPlate & gear even at 0).
- `BUILD` — one row per BUILD_ORDER entry: `key glyph name cost` — selected tool
  highlighted (inverse/amber), unaffordable dim red. Plus `X demolish` row.
- `SCAN` — hover tooltip: `Sim.describeTile` lines; or tool description when a tool
  is selected and no hover; else flavor line.
- `LOG` — last 6 messages, newest at bottom, brightest; older fade to amberDim.

**Map rendering** (per tile, priority order): unrevealed → `' '` on near-black
(#050504); terrain glyph/color from DATA.TERRAIN; ore tile → ORE_GLYPHS (dim the
color if `oreAmt < 25`); rubble → RUBBLE_GLYPH gray; dig in progress → blink `▒`;
belt → arrow ARROWS[dir] in cyan dim; belt item → item glyph in item color
(overrides arrow); machine tiles → building color: anchor tile shows `letter`
bright, other footprint tiles `▓` in the color darkened; damaged machine → letter
blinks red; status marks: `'nofuel'|'blocked'|'depleted'` → blink `!` (red) over the
machine's non-anchor tile once per blink phase. Hub: render its 3×3 as

```
╔═╗
║D║        (amber; 'D' blinks white while drill is actively consuming;
╚═╝         border turns red when integrity < 25)
```

Ghost preview: when a build tool is selected and hover is on-map, draw the footprint
outline in green (`canPlace.ok`) or red, plus a small arrow on the output tile.
Demolish tool hover → red `×` over target. Map shake: while `run.t < ui.shakeUntil`
offset the whole map ±1 cell (alternate by tick parity).

`ui.flash`: centered banner over the map (1 row, inverse color block).

**Other screens** (all pure functions of state, all heavily ASCII-framed):
- **title**: `Art.title` centered high; subtitle + tagline; menu
  `[ENTER] BEGIN DESCENT   [F] THE FOUNDRY   [H] MANUAL`; bottom line: meta stats
  (cores banked, best depth, wins/runs) + version.
- **descend**: first ~2.5 s: `Art.descent` frames centered (advance `ui.descendAnim`
  each render frame; frame = `floor(anim / 10)`, hold last); then `Art.schematicHeader`
  + `offerCount` cards side by side (box, name, wrapped desc, `[1]`.. key), hover/
  selection highlight.
- **foundry**: `Art.foundry` header; cores in big text; one row per META_UPGRADES:
  `a) Deeper Stores      ██░  2/4◈  desc...` (level pips, cost, dim if maxed or
  unaffordable); footer hints.
- **help**: `Art.help` — controls, item chain diagram, hazard glossary (this is an
  art asset, render just centers it).
- **gameover**: `Art.gameover` + stats block (depth reached, strata breached, time,
  cores earned `+N ◈`) + `[ENTER]`.
- **victory**: `Art.victory` + stats + `+10 ◈ CORE BONUS` + `[ENTER] ASCEND   [C]
  CONTINUE INTO THE MANTLE`.

No game logic in render.js — read state, draw. Tooltip text comes from Sim.

---

## 8. Visual identity

CRT-amber terminal on near-black. Amber is the "chrome" color (frames, titles,
bars); world colors per DATA. No gradients, no rounded anything, no HTML UI — every
pixel is a monospace character on the canvas. `index.html` + `style.css` (already
written) add only a subtle scanline overlay. It must read as Dwarf Fortress / a
mining terminal, never as a web game.

---

## 9. Art assets — `js/art.js`

`DC.Art.<name>` = array of strings (one per line). Constraints: **width ≤ 76 chars,
height per asset ≤ 22 lines** (title ≤ 14). Use box-drawing/CP437-flavored chars
(─│┌┐└┘═║╔╗╚╝▓▒░█▄▀■▪◆♦☼†‡≈), escape nothing weird — plain JS string literals,
no backslashes at line ends, no backticks inside. `DC.Art.center(lines, width)`
returns lines padded to center. Also export `DC.Art.color.<name>` = suggested color
key (string from DATA.COLORS) per asset.

Manifest (all required):

- `title` — big DEEPCORE logo (block/figlet style, amber) + a drill-rig vignette
  under it (rig tower over cracked strata layers, ~10 lines).
- `strataBanner` — small 3-line frame used by render for stratum flash (generic).
- `descent` — **6–8 frames** (array of arrays), each ~30×12: the drill bit punching
  down through rock layers, debris flying, progressively deeper. Final frame: breach
  glow. This plays on every descent — make it the showpiece.
- `schematicHeader` — `≡≡ RECOVERED SCHEMATICS ≡≡` banner, ~3 lines ornamented.
- `foundry` — THE FOUNDRY header (~6 lines: forge/anvil motif).
- `gameover` — collapsed rig, cracked and half-buried, ~14 lines, red-leaning.
- `victory` — THE CORE: a vast glowing sphere/eye behind the tiny rig silhouette,
  ~16 lines — the money shot.
- `help` — full manual page ≤ 74×26: controls table, the production chain
  (`≡ ore ─▶ [E] ─▶ ▶▶▶ ─▶ [S] smelter ─▶ ▬ plate ─▶ [A] ─▶ ¤ gear ─▶ [D]rill`),
  hazard glossary, tips. This one may be 26 lines (render scrolls nothing — fit it).
- `mantle` — short banner for Mantle strata (`†` motif).

Craft these with real care — they carry the game's identity. Verify every line's
width with a quick node script (then delete the script). ASCII-safe apostrophes only.

---

## 10. Meta progression — `js/meta.js`

```js
DC.Meta.load() -> profile        // localStorage DATA.SAVE_KEY, JSON; defaults on absence/corruption
DC.Meta.save(profile)
DC.Meta.newProfile() -> { cores: 0, upgrades: {}, bestDepth: 0, wins: 0, runs: 0, totalCores: 0 }
DC.Meta.award(profile, result)   // cores += result.cores; totalCores; runs++; bestDepth; wins; save
DC.Meta.canBuy(profile, id) -> bool
DC.Meta.buy(profile, id) -> bool // pays, increments level, save
DC.Meta.effects(profile) -> metaEffects   // consolidated for Sim.newRun:
   { startBonus: {ironPlate, gear, copperPlate, charge}, integrityBonus, instMult,
     drillMult, repairCost, scanBonus, salvage, offerCount }
```

Headless-safe: no localStorage → in-memory profile. Corrupt JSON → fresh profile
(never throw).

---

## 11. Headless test — `test/headless.js`

Node script, no browser. Loads modules via:

```js
require('../js/data.js'); require('../js/art.js'); require('../js/map.js');
require('../js/sim.js'); require('../js/meta.js');
const DC = globalThis.DC;
```

Then: seed 1337, `newRun` with default meta effects; **assert** map guarantees
(≥2 iron veins reachable, hub clear); script a hand-built base near the hub using
only the public Sim API (`canPlace`/`place`): 2 iron extractors + 1 coal extractor
on real veins found by scanning the grid, belts to a smelter, smelter output belted
to an assembler, assembler output belted into the hub (choose straight L-paths;
excavate rock via `demolishAt` + tick if needed; if a path is blocked, try another
vein). Tick 3 sim-minutes. **Assert**: ore was mined, plates smelted, `gearsFed > 0`,
no exception, art assets all ≤ 76 wide. Then force `instability = 90`, tick 60 s,
assert quakes fired (messages contain quake text) and integrity dropped. Print a
one-line PASS summary with throughput numbers, exit 0 (nonzero + details on failure).

---

## 12. Balance targets (verified by scripted bot, tuned in data.js)

**2026-09-09 decision:** the director delegated the remaining pacing choice
to favour both immediate experimentation and lasting meta progression. Keep
STANDARD generous; do not add a post-breach pressure surcharge that makes
Foundry upgrades feel ineffective. The original bands below are historical
benchmarks, not permission to force a camper's death. Opening mistakes should
be reversible, a first loss should afford a meaningful Foundry choice, s2
survival should remain at least 80%, and competent full runs should fit
15–25 minutes. Read `docs/RELEASE.md` for measured departures from the old
opening/core/camper bands and the bot's limits. Contracts carry extra risk
and pay extra meta currency; their win rates are not STANDARD targets.

- Stratum 1 with the standard starter base: breach ready in **90–150 s** + ~40 s build.
- Full winning run (competent play, salvage-less): **15–25 min**.
- Integrity budget: a run that camps ~1.5× the target pace should die around s6–s7.
- First 2–3 runs should each bank 2–5 cores (first Foundry buy after run 1–2).
- Belt throughput (4/s) must comfortably exceed any single machine's rate — lines
  only jam when the player under-builds smelters, which is the intended lesson.

---

## 13. File assignments

| File | Owner agent | Notes |
|---|---|---|
| `js/data.js` | — (done) | single source of truth |
| `index.html`, `style.css` | — (done) | |
| `js/map.js`, `js/sim.js` | sim agent | DOM-free; plus `test/smoke_sim.js` |
| `js/render.js` | render agent | pure view of DC.state |
| `js/art.js` | art agent | DOM-free data |
| `js/engine.js`, `js/main.js`, `js/meta.js`, `test/headless.js` | engine agent | |
| `tools/build.js` | — (later) | bundles everything into `dist/deepcore.html` |
