# DEEPCORE — v1.1 "JUICE" Addendum

Extends `SPEC.md` (which stays authoritative for everything not amended here).
Four features: **the Foreman** (humor), **graphical rig & upgrades**, **keyboard-first
play**, **color pass**. All changes are additive; no v1.0 contract is broken.

New file: `js/barks.js` (loads between `art.js` and `map.js` — index.html updated).
Amended files: `data.js` (accents — done by the director), `sim.js` (events queue +
stats), `engine.js` (cursor, lay-mode, events drain, barks wiring), `render.js`
(cursor, foreman bar, accents, rig portrait, icons, badges), `art.js` (rig layers,
schematic icons).

---

## A. The Foreman — `js/barks.js`

**Character**: FOREMAN GRIT — a gravel-voiced, chain-smoking, Company-hating deep-
mining lifer on the rig intercom. Seen everything, buried half of it. Tone: gallows
humor, mild profanity (hell/damn/shit/ass/bastard — freely), drilling innuendo,
Company-pension jokes, deadpan safety-violation energy. **Never**: slurs, hate,
explicit sex (innuendo yes, anatomy no), jokes at the player's identity — GRIT
mocks the *situation* and the *Company*, and ribs "kid" (the player) with affection.

Tone-lock examples (match this voice exactly):
- runStart: `"Another rig, another hole. Try not to marry this one, kid."`
- noCoal: `"Smelter's out of coal. It runs on coal, genius. COAL."`
- jam: `"Line's backed up worse than the site latrine on chili night."`
- quake: `"That was the planet clearing its throat. Keep working."`
- lowIntegrity: `"Hull's holding on like my second marriage. Which is to say: it ain't."`
- overdriveOn: `"REDLINE, BABY! If she blows, I was never here."`
- breachReady: `"Floor's soft as a Company promise. PUNCH IT."`
- descend: `"Going down. Don't think about what's holding the walls up. (Nothing. It's nothing.)"`
- schematic s_extract: `"Twin Drill-Heads, eh? One for work, one for the weekend."`
- death: `"Good news, kid: you're a permanent part of the geology now."`
- victory: `"You beautiful bastard. You actually drilled it."`

### A.1 API

```js
DC.Barks.tick(run)          // called by engine after every Sim.tick; watches run
                            // state for ambient triggers (jam, idle, lowIntegrity,
                            // noCoal) with internal debouncing; may set run.foreman
DC.Barks.fire(run, trigger, ctx) // discrete trigger; picks an unused-this-run line
                            // via run.rng, sets run.foreman
DC.Barks.epitaph(run)       // -> 1-2 lines for the gameover screen (cause-aware:
                            // died in magma stratum vs quake-tanking vs abandoned)
DC.Barks.toast(run)         // -> victory screen line
```

`run.foreman = { text, t0, until }` — `t0` = run.totalT when set (typewriter
anchor), `until` = t0 + ~7s·TICK_HZ (long lines longer). New bark replaces old.
Global cooldown ~6s except priority triggers (death, victory, breachReady,
collapse) which always cut in. Each line used at most once per run (per-trigger
pools of 4–8 lines; pool exhausted → allow reuse).

### A.2 Trigger catalog (≥ 26 categories, ≥ 120 lines total)

Discrete (fired by engine or drained from `run.events` §B): `runStart`,
`stratumArrive` (generic pool + one bespoke line per stratum 1–8 + mantle),
`firstBelt`, `firstExtractor`, `firstSmelter`, `firstAssembler`, `firstGear`,
`quake`, `bigQuake` (integrity dmg ≥ 8), `collapse` (instability ≥ 99),
`magmaSpread`, `veinDepleted`, `breachReady`, `descend`, `overdriveOn`,
`overdriveOff`, `repair`, `demolish`, `brokeAttempt` (can't afford),
`schematicPick` (generic pool + one bespoke line per schematic id — 14),
`foundryBuy` (one bespoke line per meta upgrade id — 9), `death`, `victory`,
`mantleArrive`.

Ambient (detected in `Barks.tick`): `jam` (any machine `blocked` > 10 s),
`noCoal` (any smelter `nofuel` > 8 s), `lowIntegrity` (< 30, once per stratum),
`idle` (45 s with no placement and no drill feed — GRIT gets sarcastic).

## B. Sim amendments (small, additive)

- `run.events = []` — sim pushes `{type, t, data}` for: `quake` (data: dmg),
  `magma`, `depleted`, `breachReady`, `death`, `won`, `descend`. Engine drains
  (splice all) every tick → drives Barks + existing shake/flash.
- `run.stats = { placed: {beltN, extractorN, ...}, lastPlaceT, lastFeedT }` —
  place() increments; drill feed updates lastFeedT (for `idle`/`first*` triggers).
- `run.foreman = null` initial.
- Machines get `blockedSince` / `nofuelSince` tick stamps (0 when clear) so
  Barks.tick can debounce without scanning history.

## C. Graphical rig & upgrades

### C.1 Layered rig portrait — `art.js`

`DC.Art.rigBase` — the naked rig, exactly **24 wide × 12 tall** (derrick tower,
cab, drill string going down into cracked strata). `DC.Art.rigParts[upgradeId]`
— one overlay per meta upgrade: `{ row, col, lines: [...] }` composited over the
base (spaces in overlay lines are transparent). Visual vocabulary:

- `m_hull` → riveted armor slabs `▐▓▌` down both flanks
- `m_damp` → gyro ring `(◎)` mid-tower
- `m_torque` → the drill bit fattens `▼` → `█▼█`
- `m_scan` → antenna mast `╦` with radiating `·˙·` on the roof
- `m_salv` → a claw arm hanging off the right side
- `m_stock` → cargo pods bolted left
- `m_deep` → small crystal vault `[♦]` in the cab
- `m_fix` → toolkit rack + wrench glyphs
- `m_schem` → blueprint tube on the roof edge

`DC.Art.composeRig(upgrades)` → lines (base + overlay per owned upgrade level ≥1).
Every part must be visually distinct at a glance — buying an upgrade must
*change the picture*.

### C.2 Where it shows

- **Foundry**: portrait left column, upgrade list right. On purchase, engine sets
  `ui.flashPart = {id, until}`; render blinks that overlay white for ~1.2 s —
  the part visibly bolts on. THE payoff moment; make it land.
- **Title**: composed rig (with owned parts) replaces the generic vignette under
  the logo — your rig on the surface, upgrades visible before every run.
- **Run sidebar RIG box**: one glyph per owned upgrade in a compact strip
  (`▐◎▼╦…` colored), so the loadout is visible in-run.

### C.3 Schematic visuals

- `DC.Art.schemIcons[id]` — one icon per schematic, **10 wide × 5 tall**, drawn
  inside the pick-cards above the name (belt rollers, twin bits, furnace mouth,
  a snowflake-damped seismograph, diamond bit, claw, sonar rings, etc.).
- Picked schematics: badge strip in sidebar DRILL box — each schematic = one
  2-char badge (defined in `DC.Art.schemBadges[id]`, e.g. `s_over` → `»»`),
  colored; hover/cursor over strip is not needed (log already announced them).
- Boosted machines change on the map: with `s_extract` extractors' letter
  renders white-bright instead of amber; `s_smelt` same for smelters; `s_coal`
  smelter fuel-pips double; belt with `s_beltfree` unchanged (they're free, not
  faster). Rule: any machine whose type is buffed by an active schematic renders
  its anchor letter in `COLORS.white` — a subtle "chromed" tell.

## D. Keyboard-first play

The game must be 100% playable with no mouse (mouse stays as an equal citizen).

- `ui.cursor = {x, y}` — always valid, starts at hub center each stratum. It IS
  the hover: mouse-move sets it to the hovered tile; arrows/`WASD` move it
  (clamped to map; **Shift+move jumps 5**). Ghost previews, tooltips, and
  interactions all key off `ui.cursor` (rename of v1.0 `ui.hover`; render/sim
  contracts unchanged otherwise — `describeTile` gets cursor coords).
- **Enter** = context action at cursor: build tool → place (facing = `ui.facing`);
  demolish tool → demolishAt; no tool → clickTile (repair / recipe / overdrive).
- **Belt lay-mode**: with belt tool selected, Enter places a belt AND arms
  lay-mode (sidebar shows `LAYING ▸▸▸`); while armed, each cursor *move* places a
  belt in the movement direction and auto-turns the previous gesture belt
  (exactly the mouse-drag corner rule, §6). Enter again or Esc disarms. Tool
  switch disarms.
- Cursor render: the cursor tile draws **inverse video** (fg/bg swapped),
  blinking at half phase; in lay-mode the cursor shows the would-be arrow.
- Every remaining interaction already has a key; add to the hints line. Help
  (`art.js` manual) gains a "MOUSE OPTIONAL" section documenting cursor keys.

## E. Color pass

- `data.js` (done): each stratum + mantle gains `accent` (hex). Depths:
  1 tan `#c9a86a` · 2 sand `#d98e4a` · 3 teal `#5fb8a5` · 4 slate `#8a9bb5` ·
  5 magenta `#c77dff` · 6 ember `#ff7a45` · 7 violet `#9a6ae0` · 8 gold `#ffd23d`
  · mantle crimson `#e04555`.
- Map box border, header stratum name, stratum flash banner, and descend banner
  render in the accent. Floor dots tint toward the accent (mix ~25% into
  `TERRAIN.floor.color` — precompute per stratum in render).
- Title logo: rows sweep amber→orange→ember (3-tone). `DEEPCORE` never mono-color.
- Foreman bar text: `COLORS.cyan`, name tag `GRIT ▸` in amber.
- Foundry: cores count in magenta `◈`, affordable rows amber, owned pips green.
- Schematic cards: icon in the schematic's thematic color (art suggests via
  `DC.Art.schemColors[id]`), frame accent of the *next* stratum (you're choosing
  what to bring down there).

## F. Screen-space changes (render)

Bottom rows rework (run screen): row 30 = condensed key hints (one line, includes
cursor keys); **rows 31–32 = the Foreman bar**: `GRIT ▸ "…"` — text reveals
typewriter-style at ~2 chars/tick from `run.foreman.t0`, holds until `until`,
then fades to dim for 2 s, then clears. Bark also mirrors into the LOG (dim, so
history survives). Gameover screen adds `Barks.epitaph` lines under the stats;
victory adds `Barks.toast`.

## G. Acceptance (added to headless + review)

- `barks.js` DOM-free, deterministic via `run.rng`; headless test drives 3
  strata and asserts: ≥ 6 distinct triggers fired, no line reused, foreman
  field set/expired correctly; every trigger id in the catalog has a pool;
  every schematic id and meta upgrade id has its bespoke line; line width ≤ 70.
- `composeRig` with all 9 upgrades stays within 24×12 and every part alters
  at least 2 cells vs base (assert in test).
- Full keyboard playthrough must be possible: integration test scripts the
  cursor path for a starter base **through the engine's key handlers if
  feasible**, else through Sim API with a manual audit of the key map.
- Nothing in v1.0's headless suite regresses.
