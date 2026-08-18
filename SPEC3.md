# DEEPCORE — SPEC3: The Final Brainstorm (v1.2 Creative Addendum)

This is a **design-only** document: no code was changed in this pass. It is the
creative inflation layer for a game that is already feature-complete and green
(4 test suites at HEAD, single-file bundle builds). Every section is written as
a **dispatch brief** — a self-contained assignment for one implementation
session (Opus), ranked by feel-per-line-of-code.

**Rules of engagement for every implementing session** (repeat these in every
dispatch prompt):

1. Read `SPEC.md`, `SPEC2.md`, and your SPEC3 section fully before coding.
   `js/data.js` is the balance source of truth — additive keys are fine, value
   changes only if your brief says so.
2. All four suites must stay green: `node test/headless.js`, `test/integration.js`,
   `test/barks_test.js`, `test/rig_test.js`. Extend them for your feature.
   Rebuild `node tools/build.js` and confirm it still parses.
3. Checkpoint commits after every green milestone
   (`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer; never push,
   never rewrite history).
4. Sim/map/meta/art/barks stay DOM-free and deterministic (`run.rng` only —
   render-side animation may use its own frame clock freely; it is throwaway
   state and MUST NOT feed back into sim).
5. GRIT's voice guardrails are law: profanity and innuendo yes; slurs, hate,
   explicit anatomy, or non-consent framing NEVER (see M-POLISH/CX-10 for the
   one existing line to fix and the standard to hold).
6. The aesthetic is the material: every new feature is characters and colors on
   the grid. If a feature needs a sprite sheet, it's wrong.
7. **Dependencies are now permitted** (director's policy change, 2026-08-11): a
   library or vendored asset is welcome when it *demonstrably improves the
   player's experience* — never for dev convenience alone. Conditions: the
   character-grid identity is untouchable (no images, no sprites — rule 6
   stands); everything is vendored into the repo and inlined by
   `tools/build.js` (no CDN links — the artifact CSP blocks them and `file://`
   must keep working); prefer the zero-dep solution when it is equally good.
   First sanctioned candidate: an embedded CP437/VGA-style monospace font as a
   data-URI `@font-face` — game-wide glyph coverage plus real terminal
   texture (see M-MANUAL).

---

## §0 The Eight Laws (design compass — read before inventing anything)

**The lineage** (director, 2026-08-18: *"we have strong inspirations in these
games, please note that"*). When a design question has no obvious answer, ask
which of these six already solved it — and steal the SHAPE of the solution,
never the content:

- **Papers, Please** — bureaucracy as drama: documents, stamps, terms you sign
  and regret. The Company's voice, the contracts (M-HUMANBAL F12), GRIT's
  induction script. Dread delivered on a form.
- **Dwarf Fortress** — the world simulates and does not care; losing is fun;
  glyphs are honest (law 1 is named for it). The quake that owes you nothing.
- **Factorio** — the chain is the game: ratios, bottlenecks, belts, the itch
  to rebuild it better. CHAIN-panel arithmetic, tier-II logistics.
- **Candy Box** — ASCII that keeps escalating past what it has any right to
  do; the interface itself is the unfolding surprise. The rasterizer, the
  wonders, EGG-420.
- **Balatro** — picks, not sliders: difficulty and build variety chosen as
  concrete cards with names, synergies you discover, one more run. Schematics,
  contracts, mutators.
- **Cookie Clicker** — numbers that feel good ticking up, meta that compounds,
  the long tail that stays generous. The Foundry, cores, the Mantle.

1. **Animation is honest.** Every animated glyph communicates true sim state
   (a fire flickers because the smelter is actually smelting). Decoration that
   lies about state is banned. Dwarf Fortress rule.
2. **Chunky beats smooth.** No sub-cell tweening. Motion = glyph swaps and
   color phases at 4–8 fps. The jank IS the charm.
3. **GRIT never explains, he editorializes.** Mechanics live in the manual and
   tooltips; GRIT reacts like a guy who's seen it. The Core (M-CORELORE) is the
   only other voice and breaks every rule GRIT follows.
4. **Pressure forward, never grind.** New content must push the player DOWN
   (risk, tempo, opportunity-cost choices) — never add idle waiting or
   mandatory farming. Runs stay 10–25 min; the Mantle owns 30–40.
5. **Reward = picture changes.** Progress must be visible as a changed image
   (rig parts, trophies, liveries, landmarks) before it is a number.
6. **Readability is the objective, not a constraint** (director's law,
   2026-08-12). ASCII games usually fail here, and it is the hardest thing
   about the form: everything is the same 10×19 box, so meaning has to come
   from contrast, hierarchy, spacing and colour rather than from shape. When a
   decision trades legibility for anything else — density, cleverness,
   authenticity, fidelity to a reference — legibility wins. Ask of every new
   element: *can a player find this in one glance, on a machine that is not
   ours?* That last clause is not rhetorical; see the font stack in
   `render.js`, where a missing platform font silently degraded the whole grid.
   "Cool" and "clean" are the same axis here, not competing ones — the game
   looks best exactly when it reads best.
7. **`run.rng` is the sim's stream, and nothing else may spend from it.**
   Determinism is not just "same seed, same map" — it is that *what the player
   does must not move the stream*. `run.rng` schedules quakes and picks the
   tiles they land on, so any other consumer makes gameplay depend on player
   behaviour and makes every number in `test/balance.js` drift with the shape
   of a base rather than with the tuning.

   Two ways this gets violated, both non-obvious:

   - **Render draws.** `js/render.js` must never call anything that rolls from
     `run.rng`. Barks are the trap: a line rolled on a frame that only happens
     if the player pressed a key (TAB for the recap card) shifts the stream, and
     the victory screen's run is still LIVE — `C` continues it into the Mantle,
     so a different draw means different schematics and a different map. Found
     and fixed in M-RECAP: `Barks.review` now picks by a pure FNV-1a hash of
     (seed, tier, depth). `epitaph`/`toast` get away with it only because their
     screens draw unconditionally — that is luck, not design. Caching per run
     stops a per-frame re-roll but does NOT stop the first draw from moving the
     stream.
   - **New subsystems rolling their own events.** Derive a stream from the seed
     instead of sharing `run.rng`. `js/events.js` does exactly this and
     documents why; `js/data.js`'s EGG-420 note states the same contract.

   **How to comply:** pick by seed hash, roll once inside the game loop and
   store the result on the run, or own a derived stream. **Lock it with a
   test** — snapshot `run.rng()` across the call (see `review never advances
   run.rng` in `test/barks_test.js`, the Mantle-invariance case in
   `test/integration.js`, and the events-on/off quake-schedule comparison).
8. **Dread is not data. The quake is a surprise, permanently** (director's law,
   2026-08-14: *"i like the quake to be a surprise. no timer for it never."*).
   `run.quakeAt` holds the next quake's tick and is trivially displayable —
   displaying it, in any panel, tooltip, gauge or debug overlay that ships, is
   forbidden. The quake is the game's best moment because it is not scheduled
   from the player's side; a countdown converts dread into a spreadsheet and
   camping into arithmetic.

   **Tells yes, timers never.** §A2's pre-collapse dread — the map dimming two
   ticks before a collapse quake at instability ≥ 99 — is shipped and stays. A
   flinch you feel in your gut is the opposite of a number you plan around.

   Generalise it: this game is played *forward under pressure*. Any readout that
   lets a player optimise instead of decide costs the game something, and must
   earn its place against that. Vein-depletion counters were rejected on the
   same grounds — the extractor announces a dead vein when it dies, which is
   when it matters.

---

## §A The Animation Choreography (what "sprites" animate, exactly)

All render-side. Recommended new module `js/fx.js` (`DC.FX`) owning a frame
clock + a small particle list; render calls `DC.FX.frame(state)` overlays last.
Two dispatches: **M-ANIM-1** (machines & world, table A1) and **M-ANIM-2**
(screen moments & particles, table A2).

> **Dispatch note — this section IS the M-ANIM brief.** There is deliberately
> no `### M-ANIM` heading down in §B: the tables below, plus the contracts
> paragraph that closes this section, are the whole specification. A worker
> assigned M-ANIM-1 or M-ANIM-2 should read **§A end to end** and treat each
> table row as an acceptance criterion. Rows are independent — ship them one
> at a time, committing as each lands, rather than building all of `fx.js`
> before the first thing moves on screen.

### A1 — Machines & world (element / when (true state) / choreography)

| Element | When | Choreography |
|---|---|---|
| Extractor `E` | actively mining | letter cycles `E ╪ E ╫` at 4fps (piston stroke); on each ore produced, output tile's item glyph renders bright-white for 2 ticks (the "spit") |
| Extractor | vein depleted | letter decays: dim gray, and every other phase shows `×` — a dead pump |
| Smelter 2×2 | fueled + crafting | the 3 non-anchor cells breathe fire: `▓▒░` rotating through ember colors (magma→orange→amber), phase-offset per cell so the furnace rolls; `S` anchor steady |
| Smelter | out of coal | fire cells go cold `░` darkgray; existing `!` blink stays on top |
| Assembler 2×2 | crafting | non-anchor cells spin `¤ ☼ ¤ ☼` quarter-phase offset (meshed gears); on recipe switch (click), one full-speed bright spin (~0.5s) as acknowledgment |
| Damper `V` | fueled | color breathes green↔dim on a ~2s sine — a calm heartbeat; unfueled: flat dim + `!` |
| Hub 3×3 | drill consuming | border cells `╔═╗║╚╝` run a marching-ants brightness wave clockwise; wave speed ×2 on overdrive; `D` pulses white on each feed tick (already partially specced) |
| Hub | breachReady | whole 3×3 pulses in stratum accent; bottom row cells sweep `▼ ▼ ▼` downward, inviting the D key |
| Hub | integrity < 25 | border flickers red erratically (not rhythmic — distress, not disco) |
| Belts (empty) | always | arrow dim-pulse marching in travel direction: brightness phase = `(x+y+tick»1) % 3` — the whole network visibly flows even when empty |
| Belt item | jammed > 2s | item glyph shivers between its color and dim (pressure tell) |
| Belt item | on move tick | draw at the departed cell 1 extra frame in bright color — a motion smear with zero sub-cell math |
| Magma `≈` | always | 2-frame `≈`/`~` swap + 3-color ember cycle, per-tile phase offset `(x*7+y*13)%3` — it breathes |
| Magma | damaging a machine | 1-tick `*` spark flash at the contact edge |
| Crystal veins `♦` | always | every ~4s one random visible crystal tile glints white for 1 tick |
| Chasm `░` | always | slow alternation dim/dimmer with vertical phase offset — depth shimmer |
| Rubble `☼` | first 2s after spawn | jitters (alternates with `%`), then settles still — debris that lands |
| Dig in progress | digging | progress wipe `▓▒░·` proportional to digT remaining (replaces plain blink) |
| Reveal front | scan expanding | newest-revealed ring renders one shade brighter for 2s; faint `·` pulse ring on each radius step — the sonar sweep made visible |
| Cursor | lay-mode | the last 3 laid belts render bright (a comet tail on the gesture) |
| GRIT's tag | while a bark is typing | a cigarette ember `°` after `GRIT ▸` glows bright↔dim; flickers fast on priority barks (he's agitated) |

### A2 — Screen moments & particles

| Moment | Choreography |
|---|---|
| Quake | existing shake + **debris rain**: ~12 particles (`.` and `'`) fall through the map box over 3 ticks, spawned from the top of random columns (FX list, render-only) |
| Pre-collapse dread | at instability ≥ 99, 2 ticks BEFORE each scheduled collapse quake the whole map dims one step — the lights flicker before the hit (read `run.quakeAt`; render-only) |
| Instability ≥ 80 | map border color breathes red slowly (period ~2s) |
| Breach (D pressed) | 6-tick white crack pattern radiating from the hub (`/ \ ─ │` cells along 6–8 rays), then descent animation |
| Descent interstitial | between descent frames and the schematic cards: stratum name typewriters in accent color while a depth odometer spins `-240m → -360m` (digits roll through randoms before settling) |
| Title screen | slow ember particles (`.` `·` in amber/orange) rising behind the rig; the rig's drill string idles (2-frame churn); `PRESS ENTER` breathes; logo keeps its 3-tone sweep |
| Foundry purchase | existing part white-blink + **spark burst**: 5–7 `*`/`'` particles around the bolted part for ~1.2s (sells the wrench) |
| Victory | the core sphere's shading function gets a phase input — it slowly pulses; GRIT's toast types out; on the final toast character, one bright ring expands through the sphere (see M-CORELORE for what it now means) |
| Gameover | dust motes (`·` darkgray) drift down over the collapsed rig art; the epitaph types out at half GRIT speed (funerals are slower) |
| Pause > 30s | smoke `░` curls in from the screen corner, 1 cell per 5s, capped at ~30 cells (GRIT's smoke break — see M-GRITPLUS for the bark) |

**Contracts (both dispatches):** new `js/fx.js` + render hooks; zero sim edits
(everything derives from existing state: `run.quakeAt`, `machine.job/status`,
`tile` fields, `run.events` may be *peeked* by render but never consumed —
engine still drains them). Acceptance: a stub-canvas frame-advance test proving
each row of the table fires under a constructed state, plus all suites green.
Size: ~250 lines (A1), ~220 lines (A2).

---

## §B Module briefs (the inflation)

### M-POLISH — the last engineering round (P0 — dispatch FIRST)

**Pitch:** ship-quality pass. The adversarial review fleet died to session
limits; its sole survivor (content/UX lens) returned 11 findings, never
refuted. Apply them plus the accumulated leftover concerns.

**The 11 findings (verbatim essence, all verified-by-probe by their finder):**

- **CX-01 [high]** `data.js` — coal is nearly invisible: `COLORS.coal #565650`
  is 2.68:1 against the background (floor for glyphs ~4.5:1). Affects coal
  veins `♠`, coal items on belts, STOCK rows. Fix: brighten to ~`#8a8a80`
  (keep it the dullest material color — coal should look like coal, but exist).
- **CX-02 [med]** `art.js` help says "descending vents 40 instability" twice;
  sim vents 45. Sync the manual.
- **CX-03 [med]** `art.js` help says quakes start "past 22"; actual
  `QUAKE.startInst` is 25. Sync.
- **CX-04 [med]** `sim.js` describeTile lines overflow the 29-col SCAN panel
  and truncate mid-word ("click: repair (2 pl"). Shorten the strings to fit
  (all tooltip lines ≤ 29 chars) rather than clipping.
- **CX-05 [med]** `README.md` controls table omits the entire keyboard-cursor
  scheme (arrows, Enter, Shift×5, Space, F). Document it.
- **CX-06 [low]** `README.md` Development section: list all 4 suites + SPEC2/3.
- **CX-07 [low]** `barks.js` duplicate joke ("the deep keeps the/her deposit")
  in death pool AND abandon epitaph — rewrite one.
- **CX-08 [low]** `sim.js` overdrive message uses `≫` (U+226B) — the one glyph
  in the whole game missing from DejaVu Sans Mono. Replace with `»`.
- **CX-09 [low]** `sim.js` damper tooltip shows `fuel 40` (raw ticks) while
  smelter shows smelts — same label, different units. Show damper fuel in
  seconds ("vent 5s").
- **CX-10 [low]** `barks.js` firstExtractor line "The vein didn't consent, but
  here we are." — within the letter of the guardrails, against their spirit
  (non-consent framing). Replace with rig-directed innuendo, e.g.
  `"First extractor down. She bites, the rock gives. Match made in hell."`
  Hold this standard everywhere: the joke is the rig and the job, never an
  unwilling party.
- **CX-11 [low]** `render.js` STOCK truncates 6 of 8 item names with a spare
  column available ("copper o" vs "copper p"). Widen by 1 and use per-item
  short names from data (add `short:` to ITEMS, e.g. `cu plate`, `crystal`,
  `charge`) so no two rows are ambiguous; counts cap at 999 → show `1k+`.

**Plus the leftover concerns backlog:** foundryBuy barks only fire with a live
run (engine's bark guard) — allow a runless foreman line on the foundry screen
via a 1-line render surface under the portrait; abandon path skips the death
bark (cosmetic — fire it before gameover); orphaned `Art.strataBanner` (use it
as the descend-interstitial frame, or delete it); the browser-eyeball list
(canvas metrics, blink/typewriter feel at 60fps, `dist/deepcore.html` from
`file://`, localStorage persistence, scanline pointer-events) — do a real
browser pass and fix what's off; seeds 2/42 stratum-2 bot deaths — run the
balance sweep below and tune.

**Balance sweep (absorbs old ROADMAP M5):** build `test/balance.js`: ≥12 seeds
× standard/camper policies (lift the integration bot), collect per-stratum
breach times, death depth/cause, cores; tune `data.js` toward SPEC §12 targets
(s1 breach 90–150s; win 15–25 min; campers die s6–7; standard policy survives
s2 on ≥80% of seeds); update test constants that assert tuned values.

**Files:** data.js (values), art.js (manual), barks.js (2 lines), sim.js
(strings), render.js (STOCK), README.md, engine.js (2 small wirings),
test/balance.js. **Size:** ~300 lines touched. **This brief is the only one
allowed to change existing balance values.**

---

### M-RECAP — Run Recap Card, Daily Shaft & Ghost Splits (P0)

**Pitch:** every run ends in a shareable ASCII artifact; every day has one
seed; you race your own ghost. Retention features with zero new sim.

**Design:**
- **Recap card** on gameover/victory (toggle from stats view with `TAB`):
  a boxed 46-wide card — run date, seed, depth bar chart (one row per stratum:
  `S3 KARST ██████▌ 2:41` in stratum accents), cause of death / victory mark,
  schematics taken (badge strip), gears+charges fed totals, cores earned, and
  **GRIT's Performance Review**: a new bark pool (~10 lines/outcome tier) —
  the roast is the reward. `C` copies the card as plain text
  (`navigator.clipboard`, engine-side, graceful failure offline).
- **Daily Shaft**: title menu `[T]` — seed = UTC date hash, Foundry upgrades
  DISABLED (naked rig, pure skill), one attempt per day recorded (attempts
  after the first are unranked "practice", GRIT calls them that). Local
  daily-history table in the meta save (date, depth, time). No network.
- **Ghost splits**: during any run, the sidebar DRILL box gains a thin
  `best 2:10 ▲12s` line comparing current stratum time vs your best-ever run's
  split at that depth (meta save gains `bestSplits[depth]`). Green when ahead,
  red when behind. The race is against yourself.

**GRIT material (performance review — tone lock):**
`"Depth 3. My nephew got to 4 his first week. He's an idiot, kid."` ·
`"You died with 212 plates banked. Saving for retirement? Down HERE?"` ·
`"A win's a win. Don't let it get around that it took you 24 minutes."`

**Contracts:** meta.js (dailyHistory, bestSplits — versioned save migration),
engine.js (T key, TAB toggle, clipboard), render.js (card screen), barks.js
(review pool), data.js additive (nothing). Suites: extend integration with a
recap-state assertion + save-migration test. **Size:** ~350 lines.

---

### M-EVENTS — Dig Finds, Expedition Vignettes & the Cave-Cat (P1)

**Pitch:** roguelike texture. The rock has things in it; between strata the
dark asks questions; one of the answers purrs. (Absorbs old ROADMAP M3.)

**Design:**
1. **Dig finds** — 8% of completed rock excavations yield one of (weighted):
   ore pocket (+6–10 of a stratum ore straight to hub), pre-collapse cache
   (+8–15 plates), a sealed lunchbox (nothing — GRIT story bark, 6-line pool),
   bones (nothing — mood line), gas pocket (+8 instability, warning hiss
   message 1s before it pops), the Old Shaft (reveals a 6-radius map chunk),
   a dead rig (one-time 12-plate salvage + a **foreman's last log entry** —
   see collection below).
2. **Dead Foremen of the Deep** — 20 authored one-liner log entries from rigs
   that didn't make it (`"Log 44: The coal is singing again. Ignoring it. -Fmn. Okafor"`).
   Found entries persist in the meta save; the Foundry gains a `[L]ogbook`
   page listing them — a free-standing lore jigsaw of what's actually down
   there (it should quietly corroborate M-CORELORE: several logs mention the
   singing, the warmth, the heartbeat).
3. **Expedition vignettes** — after each schematic pick, 25% chance of a
   2-choice event screen (framed art panel ~40×14, ~20 events authored).
   Effects limited to: inv deltas, integrity/instability deltas, one-stratum
   modifiers, or gaining the cat. Examples to author in this register:
   *The Vault* (breach: +30 plates +15 instability / leave it: GRIT approves),
   *The Singing Crack* (listen: full reveal, GRIT unsettled / seal: +10 integrity),
   *Company Inspector Drone* (bribe 10 plates: 4 schematic offers next descent /
   scrap it: +8 plates, GRIT delighted, Company "notes your file"),
   *The Warm Pool* (bathe: +15 integrity, +5 instability, GRIT: no comment),
   *Miner's Ghost* (trade 5 integrity for a random schematic).
4. **The Cave-Cat** — from one vignette (*Something in the Crate*): a `c` glyph
   companion that wanders your base, sits on working smelters (warms itself —
   1-cell perch, purely cosmetic), and **flees toward the hub 2 seconds before
   every quake** — a living seismograph, charm wrapping a real mechanical
   tell. Quakes never hit the cat. If the run ends, the cat is fine
   (gameover art gains a small `c` watching from the rubble edge; GRIT:
   `"The cat made it out. Cats always do. Take notes, kid."`). Cat persists
   across runs once found (meta flag) — it's on the title rig ever after.

**Contracts:** new `js/events.js` (`DC.Events.rollDig(run)`, `rollVignette(run)`,
`apply(run, ev, choice)`), sim hook in the dig-complete path + descend path
(2 lines each), render event screen + cat glyph layer, engine choice keys
(1/2), meta (logbook, catFound), barks (cat pool, find pool), art (event
frames, ~20 panels at 40×14 max). All rng from `run.rng`. **Size:** ~500 lines
+ art/writing. Biggest single brief — it's the roguelike soul; art and event
text are 60% of the work.

---

### M-WONDERS — Stratum Landmarks (P1)

**Pitch:** every stratum rolls one landmark — maps stop being interchangeable
caves and start being *places* you tell stories about.

**Design:** one per stratum from a pool of ~10 (depth-gated), placed by mapgen
away from the hub clearing, each = terrain feature + tooltip lore + GRIT
arrival line + a real mechanical identity:

- **The Anvil** (s1+): a 3×3 granite monolith `▓█▓/███/▓█▓`; smelters within
  radius 5 work +15% faster (the old heat never left it).
- **Glass Forest** (s3+): a field of obsidian spires; crystal glint FX ×3;
  demolishing a spire (slow dig, 8s) yields 1 crystal — pre-crystal-era
  players meet the material early.
- **The Drowned Machine** (s2+): a dead pre-collapse mega-extractor (2×2 `M`);
  restart for 10 plates: mines at double rate but jams for 10s every ~45s
  (GRIT: `"She's old. She naps. Respect it."`).
- **The Company Seal** (s4+): a locked 2×2 hatch; open for 20 plates → a free
  schematic offer + a Dead Foreman log + the Company "notes your file" again.
- **The Warm Spot** (s2+): radius-6 zone where quakes never target — visible
  as faintly amber floor. Build sanctuary… that fits half a base. Choices.
- **The Bell** (s5+): a bronze dome; ring it (click): all veins this stratum
  +25% richer, +12 instability, and *somewhere far below, something answers*
  (one Core line fires early — M-CORELORE hook).
- **The Root** (s6+): a magma-fed obsidian column; dampers within radius 6
  are twice as effective (the planet's own shock absorber).
- **The Mirror Pool** (s5+): still chasm-water 1×3; the reveal sweep bounces
  off it — instantly reveals the mirrored half of the map. One-shot.

**Contracts:** map.js (placement + tile flags), sim.js (aura checks — keep to
one `landmarkAt`/`auraMult` helper consulted by existing speed/quake/damper
paths), render (glyphs + tooltip), barks (arrival pool per landmark), data.js
additive (LANDMARKS table). **Size:** ~350 lines.

---

### M-CORELORE — The Core Talks Back (P1)

**Pitch:** the game's second voice. GRIT has a foil, the descent has a
listener, and the ending recontextualizes the whole run. Nothing mechanical
changes — this is pure dread and payoff.

**Design:**
- From stratum 6 down, rare (≤1 per stratum) **intrusions** in the foreman
  bar: gold text, lowercase, no tag, vast and amused —
  `"warmer."` · `"you knock so politely."` · `"the last one stopped at seven.
  you won't."` GRIT immediately follows with a rattled deflection (paired
  lines authored together; his profanity spikes when he's scared).
- **The Core Gate 3-beat**: at s8, the breach sequence gains three beats at
  25% / 60% / 95% breach — the Core asks you to stop; offers you the surface
  back (a fake `[ENTER] ASCEND` prompt that GRIT talks over: `"Don't you
  touch that. It's lying. Probably. Drill."`); then laughs.
- **The reveal**: the victory art's core sphere is an **egg** — the final
  frame adds a hairline crack in sync with the last toast character, and the
  Mantle door reframes: you didn't beat the planet, you *hatched* something's
  front door. Mantle strata (already `†`-marked) get 3 authored Core lines
  that are no longer amused. The endless mode is now *inside*. Nothing else
  about the Mantle changes — the meaning does.
- Dead Foremen logs (M-EVENTS) and The Bell (M-WONDERS) foreshadow this; if
  those modules land, their hooks light up automatically (shared trigger ids).

**Contracts:** barks.js (CORE pools + paired GRIT reactions, ~40 lines of
dialogue), sim events (3 breach-fraction events at s8 — 5 lines), render
(gold intrusion style, fake-prompt beat, victory crack frame), art (crack
overlay). **Size:** ~200 lines, mostly writing. Highest wow-per-line in this
document.

---

### M-GRITPLUS — The Charm Pack (P1, cheap)

**Pitch:** small mechanisms that make GRIT feel alive between his lines.

- **Smoke break**: pause > 30s → the A2 smoke effect + one bark
  (`"Break's over when you say, kid. Rock's not going anywhere. Mostly."`);
  resuming → `"Right. Where were we. Ah — the hole."`
- **Elevator graffiti**: during each descent animation, one line of shaft
  graffiti scrolls past (pool of 40): `"DAY 400: STILL NO PONY —MGMT"` ·
  `"TURN BACK"` (crossed out) · `"GRIT WAS HERE — 20 YEARS. TWENTY."` ·
  `"IF FOUND, I WAS RIGHT —FMN. OKAFOR"` (logbook crossover).
- **Named collapses**: at instability 100, collapse quakes get numbered names
  in the log — `"The stratum groans: TREMOR Ⅶ"` — a rising roman-numeral
  dread counter (reset per stratum).
- **Idle escalation**: the existing idle bark gets a 3-stage ladder (45s
  gentle rib → 90s sarcasm → 150s GRIT starts narrating a nature documentary
  about the player).

- **EGG-420 — The Botanical Incident** (easter egg): two discovery routes —
  typing `4 2 0` during a run, or a 0.42%-weight dig find (*a perfectly
  preserved pre-collapse tin*; GRIT: `"That's botanical. I'm confiscating it.
  For evidence."`). Effect, exactly 42 seconds: a subtle green wash over the
  map (readability is sacred — tint, don't paint), the foreman bar switches to
  a mellow pool (~10 lines: `"...you ever really LOOK at a belt, kid? It
  just... goes."` · `"The quakes are just the planet's heartbeat, man."`),
  damper tooltips read `chill unit`, dampers puff leaf-green `~` smoke (FX
  hook), instability rate ×0.9 (the stratum relaxes too), and on expiry GRIT
  exits with the munchies (`"Break's over. Why does the copper smell like
  breakfast? Does anyone have breakfast?"`). Trophy hook (M-ACHIEVE): **High
  Score** — win a run that included the window (trophy: a tiny potted plant).
  Guardrails: it's GRIT being gloriously unprofessional on Company time — a
  wink, not a PSA in either direction.

**Contracts:** barks.js pools + tiny engine/render hooks; graffiti = art.js
pool + descent interstitial slot (M-ANIM-2 provides the slot; without it,
render above the frames); EGG-420 adds a 3-key input buffer in engine, a
render tint overlay, and the dig-find weight (M-EVENTS hook — without
M-EVENTS, the keys are the only route). **Size:** ~220 lines, mostly writing.

---

### M-MANTLE — Mutators for the Deep (P1 for advanced players)

**Pitch:** the 30–40 minute crowd deserves variety, not just bigger numbers.
Every Mantle stratum (9+) rolls **one mutator**, announced on the banner:

- **the dark rises** — map starts fully revealed, then UN-reveals from the
  edges at 1 ring/20s; your scan radius is the only lantern. (Inverts reveal;
  spooky, trivial to implement on the existing radius math.)
- **hungry drill** — drill consumes 2 gears per feed but breaches ×1.7 speed:
  throughput check.
- **cold seam** — no coal veins; smelters must border magma to work (free
  smelting at the planet's forge — placement puzzle; guarantee ≥2 pools).
- **worm season** — (needs M-WORMS) 3 vein worms active.
- **glass floors** — a chasm network under everything: quakes convert hit
  rubble tiles to chasm. The map erodes under you.
- **echo chamber** — every GRIT bark echoes one Core line back, corrupted.
  (Pure barks; unsettling as hell, costs nothing.)
- **the seal** — breach requirement −30% but instability rate +50%: sprint.

**Contracts:** data.js additive MUTATORS table, sim `run.mutator` rolled in
`startStratum` (depth>8), checks at the 5 named sites, render banner line,
barks announcements. **Size:** ~200 lines + per-mutator touch points.

---

### M-WORMS — Something Lives Down Here (P2)

**Pitch:** Dwarf Fortress wildlife energy with zero combat: hazards you
*manage*, and secretly, tools.

- **Vein Worms** (s3+, 1–2 per stratum, `~~o` 3-segment glyph chain): tunnel
  through rock at ~1 tile/2s leaving floor (free excavation!), eat 5 ore from
  any vein they cross. They follow coal scent: the demolish tool on your own
  hub stock… no — new interaction: cursor + `L` drops a 2-coal **lure** on a
  floor tile; worms path to the nearest lure, eat it, continue. Emergent play:
  spend coal to steer a living tunnel-borer through the rock wall between you
  and that far crystal vein. They never touch machines/belts (they dislike the
  taste of the Company). GRIT has a 6-line pool of opinions, all disgusted.
- **The Undertoad** (≤1 per run, s6+, 15% of maps): a sleeping `Ω` (2×2) in a
  sealed chamber, faintly visible through rock (dim glyph). Building or
  digging within 3 tiles wakes it: one massive scripted quake (guaranteed,
  announced — `"YOU WOKE IT. HARD HATS."`), then it burrows away leaving a
  6–10 tile tunnel lined with crystal ore. The best mining site in the game,
  priced in integrity and terror.

**Contracts:** sim entity list (`run.critters`, ticked after machines;
deterministic pathing via run.rng), map placement, render glyph layer +
tooltips, barks pools, data constants. Mutator hook (M-MANTLE worm season).
**Size:** ~300 lines. Ship after M-EVENTS (shares the "living world" render
layer with the cat).

---

### M-TIER2 — Logistics II (P2; absorbs old ROADMAP M2)

Splitter (1×1, alternates left/right), underground belt pair (≤4 gap, crosses
chasms — partially obsoletes Ghost Belts, pick ONE: keep underground belts,
cut Ghost Belts from M-SCHEMS2), loader (pulls a blocked machine's output
sideways), crusher (2×2: converts adjacent rubble → 2 iron ore each — quakes
become a resource, beautiful judo on the hazard system), **filter gate** (1×1
belt that only passes a clicked-to-cycle item — the charge-era routing tool).
Unlock at stratum 3+ via `unlockDepth` on BUILDINGS + build-list gating.
4 new schematics keyed to these. **Size:** ~400 lines (belt-logic heavy —
dispatch to your strongest session).

---

### M-SCHEMS2 — Second Schematic Batch (P2, +7)

Worm Whisperer (worms also path to your cursor beacon — needs M-WORMS),
Magma Boiler (smelters adjacent to magma need no coal — also M-MANTLE cold
seam's engine), Echo Charges (every 5th charge free), Gravity Chute (demolish
refunds 75%), Jury Rig (damaged machines run full speed but −1 integrity/min
each), Deep Insurance (first lethal hit per run leaves you at 1 integrity;
GRIT has a heart attack), Closed Loop (dampers need no coal, −half effect).
Each with icon/badge/color/bespoke GRIT line (the SPEC2 §C pipeline makes
this mostly content work). **Size:** ~150 lines + art.

---

### M-ACHIEVE — Trophy Shelf & the Company Ledger (P2)

**Trophy shelf**: a Foundry page — an ASCII shelf where each earned milestone
physically appears as an object (Law 5): first win (a tiny golden core),
sub-15:00 win (a stopwatch), no-repair win (pristine wrench), never-overdrive
win ("Scenic Route" — a postcard), depth 12 (a `†`), cat found (a tiny `c`),
all schematics seen (blueprint roll), worm ride… every trophy has a GRIT
inspection line. ~12 trophies, earned-state in meta save.
**The Company Ledger**: a second page — lifetime stats formatted as a
sarcastic corporate report (`TOTAL VALUE EXTRACTED: 48,210 units` /
`EMPLOYEE COMPENSATION DISBURSED: 0.00` / `CONDOLENCE LETTERS SENT: 7 (bulk
rate)`). Numbers from real tracked stats (meta gains lifetime counters).
**Size:** ~250 lines.

---

### M-RIGSKINS — Liveries (P2, cheap)

Unlockable palettes applied to the rig portrait + UI chrome (not the world —
readability is sacred): Company Amber (default), **Safety Orange** (win the
daily), **Gunmetal** (10 runs), **Void** (Mantle depth 12 — UI goes
white-on-black inverse, gorgeous), **Solid Gold** (all trophies; GRIT:
`"Tacky. I love her."`). Foundry `[S]kins` row; meta save field; COLORS
remapping layer in render (chrome colors only). **Size:** ~120 lines.

---

### M-SOUND — The Rig Sings (P2; absorbs old ROADMAP M1 unchanged, plus:)

New hooks discovered since M1 was written: worm rumble (low brown-noise slide
when a worm moves onscreen), the Core's voice (a sub-bass swell under gold
text — felt, not heard), GRIT radio squelch (2-frame click before each bark),
cat purr (near a warm smelter, barely audible), the Bell (one clean struck
note, long decay — the only pure tone in the game; that's why it's scary).
All still WebAudio-synthesized, zero files, `M` mutes, off by default until
first user gesture. **Size:** ~400 lines.

---

### M-MANUAL — The Field Manual, Redesigned (P0-adjacent — dispatch anytime)

**Pitch:** the current help page works but reads as a 74×30 monolith — blocky,
one color, no visual hierarchy (director's note: user-flagged). Rebuild it as
the most *readable* screen in the game: scannable in 5 seconds, worth 30.

**Design directives:**
- **Color hierarchy**: section headers in amber caps over thin rules; keycaps
  rendered as inverse cells (`[R]` bright-on-amber blocks); body text in warm
  dim gray; every item/machine glyph shown inline in its TRUE game color —
  the manual becomes a living legend, not a description of one.
- **Two pages**, `←`/`→` (and `1`/`2`): page 1 **OPERATE** — controls as a
  real two-column key table + the production chain as the centerpiece,
  drawn big with live-colored glyphs; page 2 **SURVIVE** — hazard glossary
  with the actual status glyphs (blinking, via the A1 layer if present),
  damage/repair math, three tips, and GRIT's one contribution
  (`"Page 3 fell in a chasm. You're welcome."`).
- **Air**: ≤60% ink density per page; gutters ≥3 cols; boxes only where they
  mean something (structure is information — no decorative frames).
- **Contrast**: every text tier ≥4.5:1 against the background (pairs with
  M-POLISH/CX-01's coal fix).
- **Optional, sanctioned (rule 7)**: embed a CP437/VGA-style monospace font as
  a data-URI and apply it game-wide — authentic terminal texture, guaranteed
  glyph coverage (kills the CX-08 class of bug forever). If adopted: verify
  every glyph used in data/art/barks renders, re-measure cell metrics (CW/CH),
  and confirm `tools/build.js` inlines the vendored font into the single file.

**Contracts:** art.js (manual rebuilt as two page assets + shared legend
builders), render.js (pager + inverse keycaps), engine.js (page keys),
optional `vendor/` font + build.js inlining. The manual must match ACTUAL
bindings (cross-check engine key handlers — arrows-only cursor, no WASD).
**Acceptance:** stub-canvas render test for both pages; width/height limits;
binding cross-check vs engine; contrast assertions on every palette pair used.
**Size:** ~200 lines + real design care.

---

### M-ONBOARD — Teach the First Five Minutes (P0 — the director could not play his own game)

> Director, 2026-08-12, after playing a build: *"i could not play the game! my
> belts didnt corner correctly and i could not make a extractor work."*

**This brief exists because of a measured failure, and the measurement matters
more than the anecdote.** Both reported problems were investigated at HEAD:

- **Belt cornering is not broken.** Laying an L through `Sim.place` turns the
  corner correctly, and `engine.js`'s keyboard lay-mode and mouse drag go
  through the SAME `enterCell` → `stepGesture` path, which re-aims the previous
  belt toward each new cell. Verified on a real generated map.
- **The extractor was not broken either — it was working perfectly and
  invisibly.** Placed on a revealed vein it mines an ore on the first cycle,
  puts it in `machine.out`, finds no belt on its output side, and sets
  `status: 'blocked'`. It then sits forever. Over 600 ticks it emitted
  **zero log messages.** `render.js` draws a red `!` over it — and nothing,
  anywhere, ever says what that `!` means.

So the mechanics are sound and the *teaching* is absent. A player places a
machine, sees nothing happen, gets one unexplained punctuation mark, and
concludes the game is broken. That is a §0 law 6 failure of the first order:
the state is legible to the simulation and illegible to the human.

**The lesson for the whole project:** the bot in `test/balance.js` has never
once failed to connect an extractor, because it knows the rules by
construction. A green sweep says the game is *winnable*, never that it is
*playable*. Those are different properties and only one of them is tested.

#### Part 1 — Diagnostics (do this first; it is small and it is most of the win)

Make every failure state say its own cause, once, in the LOG. Not a tutorial —
a game that explains itself.

- **Blocked output** — the case that beat the director. First time any machine
  sets `status: 'blocked'`, log it in the machine's own voice: *"The extractor
  is full. Nothing is carrying it away — lay a belt on its output side (R
  rotates before you place)."* Once per run per cause, never nagging.
- **`!` needs a legend.** It currently means blocked, nofuel or depleted with
  no way to tell which. Either differentiate the glyph or make hovering/
  cursoring the machine state the reason in the SCAN panel — that panel already
  exists and already has room.
- **No fuel, depleted vein, jammed belt, unpowered assembler**: same treatment.
- The rig itself should say what it is waiting for when the breach stalls.

#### Part 2 — The first-run tutorial

Only after Part 1, because a game that explains itself needs less tutorial.

- Trigger on a profile with zero completed runs; skippable from the first
  keypress and never shown again once skipped or finished (persist in meta).
- **Teach by doing, on the real map, not a scripted sandbox.** Four beats, each
  gated on the player actually doing it: place an extractor on a vein · rotate
  its output · lay a belt to the rig · watch the first ore arrive. Stratum 1
  already opens with a guaranteed iron vein near the rig.
- **GRIT TEACHES, LOUDLY, AND HE IS FUNNY** (director's call, 2026-08-12,
  verbatim: *"I WANT MY MAN FOREMAN TEACHING AND MAKING JOKES! ... AND CHILD
  JOKES! AND DAD JOKES! I DONT GIVE A FUCK IF PLAYERS NEED TO PARSE A JOKE!"*).
  This overrides the usual restraint. The tutorial is the one place GRIT is
  *contractually obliged* to explain things, and he hates it — the bit is that
  he has been handed the Company induction script and cannot get through a line
  without riffing on it. Law 3 (GRIT never explains) is suspended here BY the
  fiction: he is not choosing to explain, he is being made to.

  **Register: the whole range, deliberately mixed.** Dad jokes and groaners.
  Jokes a nine-year-old would make about a drill going into a hole. Filthy
  adult ones. Puns he is visibly proud of. He should be funny *and* a bit
  embarrassing, the way a man twenty years down a hole with nobody to talk to
  gets. Aim for **~60 authored lines** so a second playthrough is not the same
  script — the tutorial is many players' first impression, and it should be the
  reason they tell someone about this game.

  Same guardrails as everywhere: profanity, innuendo, gallows humour and
  Company-hating are the point; slurs, hate, explicit anatomy and non-consent
  framing are still out. That line has held for the whole project and it is
  where the humour is *better*, not weaker.

- **Presentation: centre stage, not the foreman bar** (director's call). The
  two-row bar at the bottom is for ambient barks; a tutorial delivered there is
  easy to miss and impossible to make feel dynamic. Give these lines a
  **centred panel or a popup near what he is talking about** — a speech box
  that can point at the vein, the machine, the key. It should move, land, and
  get out of the way. Sub-cell block art (M-HIRES's rasterizer) can give the
  box a real tail/pointer without leaving the character grid.

- **The one thing that must survive the comedy.** However dumb the joke, the
  ACTION must be unmissable on screen at the same time: the key drawn as an
  inverse keycap, and the target tile highlighted. That is not a limit on the
  humour — it is what *lets* the humour be as stupid as it likes, because the
  player is never relying on the joke to know what to press. A beat where the
  gag is the only instruction is a beat that gets rewritten.

- Pressure pauses during the tutorial: instability does not climb until the
  first ore reaches the rig. Nobody should lose their first run to a quake
  while reading — least of all to a punchline.

#### Part 3 — Make the manual's first page findable

`H` opens a good two-page manual now (M-MANUAL). A first-time player does not
know it exists. Say so on the title screen and once in the first run.

**Contracts:** `js/sim.js` (cause messages on state transitions — these are sim
events, so they must be deterministic and DOM-free), `js/art.js` (the speech
box and its pointer; sub-cell block art from M-HIRES's rasterizer is available), `js/engine.js` (tutorial
step machine, skip handling), `js/meta.js` (tutorial-seen flag, save-compatible
default), `js/barks.js` (the induction-video pool), `js/render.js` (SCAN panel
reason line, title-screen hint). `js/data.js` additive only.

**Acceptance:** a headless test that places an extractor with no output belt
and asserts the LOG names the cause within N ticks — the exact scenario that
defeated the director. Tutorial steps each assert-driven in
`test/integration.js`. Save written before this brief still loads.
**Size:** ~150 lines for Part 1; ~250 for Part 2's machinery plus ~60 authored
GRIT lines, which is the half that decides whether the tutorial is a chore or
the thing players quote.

**Dispatch note:** the director asked for this "after everything else". Part 1
should not wait — he intends to playtest every major change from here, and a
game that cannot explain its own failure states makes every one of those
sessions cost more than it should. Part 2 can follow whenever.
---

### M-WIDE — Fill the Sides: your Rig, always on screen (P1)

> Director, 2026-08-14, looking at a running game: *"i feel like if we used more
> of the screen available, it would be more clear. what are our actual plans to
> use these black bars at the sides? do we have any plans?"*

There was no plan. This is it.

#### Why the bars are there (it is not a bug, and M-HIRES cannot fix it)

The grid is **80 × 33 cells at 10 × 19 px = 800 × 627, aspect 1.276**. A 16:9
monitor is 1.778. M-HIRES Phase 1 works — the game scales up instead of sitting
as an 800px island — but scaling *preserves aspect*, so on any wider screen it
must letterbox. There is no scaling fix. The only way to fill the sides is
**more columns**:

| Target | Columns needed | Gain |
|---|---|---|
| 16:10 | 100 | +20 |
| 16:9 | 111 | +31 |
| the director's window (1.845) | 116 | +36 |

**Ship 112 columns** (16:9, the common case) and letterbox the remainder rather
than chasing every aspect. `ROWS` stays 33.

#### THE HARD CONSTRAINT: the map does not grow

`MAP_W = 46, MAP_H = 26` stay **exactly as they are**. Widening the playfield
would change vein density, walk distances, quake coverage and every number in
`test/balance.js` — it would be a balance rewrite wearing a layout brief's
clothes. **Every new column is UI.** Run `test/balance.js` before and after and
require the numbers to be unchanged; if they moved, the map grew and the work
is wrong.

#### What the space is for — FOUR panels that breathe

Directed 2026-08-14, after a round of options. **Exactly four**, chosen so the
set answers four different questions, and deliberately not the nine that would
fit: *"id rather have four that breathe than nine that cram."* Three of the four
are pictures, which is the point — the governing principle the director gave is
that **the side space belongs to whatever benefits most from resolution.**

| Panel | Answers |
|---|---|
| **RIG** | what you are |
| **STOCK** | what you have |
| **CHAIN** | what it is doing |
| **LOADOUT** | what you picked |

**1. RIG — your machine, on screen, always. The headline of this brief.**
`js/art.js` already composes it: `composeRig` layers `rigParts[upgradeId]` so
every Foundry upgrade is visibly bolted on. But it is currently only drawn on
the **title screen and in the Foundry** — between runs, when it means nothing.
Law 5 says *reward = picture changes*, and the picture currently changes
somewhere the player is not looking. Put it in the sidebar and every run is
played beside the machine built out of all the previous ones. It is the single
biggest beneficiary of M-HIRES's sub-cell rasterizer in the game: draw it at
block resolution and give it room.

**2. STOCK — all eight items, with icons and a trend.** Today three items are
crammed into two rows. Give each of the eight its own row, and draw each item
as a **3×2 block-art icon** (M-HIRES's rasterizer) rather than a single glyph —
a real gear, a real ingot, a real crystal. The feature is not the space, it is
the **trend arrow**: `• iron ore 68 ↑` says the extractors are outrunning the
smelters, which tells the player what to build next without doing arithmetic.
Same icon treatment is worth giving the BUILD list.

**3. CHAIN — the teacher.** The director could not work out what a smelter was
for, and had to ask. The manual explains the chain on page 1 and he still had to
ask, because the manual is behind `H` and the chain is a *live* thing you need
to see while it is failing.

```
  CHAIN
  •  ore      2 E    1.0/s
  ▬  plate    1 S    0.5/s   ← STARVED
  ¤  gear     1 A    0.36/s
  ─────────────────────────
  breach in ~2:14 at this rate
```

Three things it must do, in priority order:

1. **Name the bottleneck.** Mark the stage that is limiting, in the warning
   colour. This one line would have taught the director more than the manual
   did.
2. **Show the ratio problem.** One smelter is 0.5 plate/s; one assembler wants
   2 plates per 2.75s = 0.73/s. **One smelter cannot feed one assembler** — the
   single most common reason a first run dies. The panel should make that
   visible as a number, not a tip you read once.
3. **Project the breach.** "breach in ~2:14 at this rate" turns the whole base
   into a clock, which is the game's actual subject.

**4. LOADOUT — what you are actually running.** `run.schematics` and `run.mods`
are tracked and then vanish the moment the pick screen closes; twenty minutes
later the player has forgotten they took Salvage Claws. List them with their
icons and a one-line effect each.

#### Two things that were considered and REJECTED — do not add them

Both were proposed and the director turned them down. They are recorded because
the data for both is sitting in plain sight and the next person will have the
same idea I did.

- **NO QUAKE TIMER. NOT EVER.** `run.quakeAt` holds the next quake's tick and is
  trivially displayable. Displaying it is forbidden: *"i like the quake to be a
  surprise. no timer for it never."* The quake is the game's best moment
  precisely because it is not scheduled from the player's side, and a countdown
  converts dread into a spreadsheet. **This is not the same as atmosphere** —
  §A2's pre-collapse dread (the map dimming two ticks before a collapse quake at
  instability ≥ 99) is already shipped and stays: a two-tick flinch you feel is
  the opposite of a number you plan around. Tells yes, timers never.
- **No vein-depletion readout.** Every tile carries `oreAmt`; showing it was
  rejected as too much information. The extractor already announces a dead vein
  through M-ONBOARD's diagnostics, which is the right amount: you learn it when
  it matters, not as a gauge you monitor.

The through-line for both: this game is played *forward under pressure*, and
every readout that lets a player optimise instead of decide costs it something.
Four panels that breathe, and no telemetry.

Secondary uses if room remains: give the LOG more rows (it is the game's
narrator and currently shows ~5); widen the SCAN panel past its 29-column clip;
give the recap card and the manual room to breathe.

#### A duplication worth fixing while you are in here

The newest GRIT line is currently on screen **twice at once** — mirrored into
the LOG *and* typing in the foreman bar. Two or three rows of a small screen
spent saying the same sentence. Either drop the mirror for the line currently
in the bar and let it fall into the LOG once it is superseded, or drop the bar
and let a wider LOG carry him. The first keeps the typewriter, which is worth
keeping.

#### Implementation notes

- `COLS` lives in `js/data.js`. The sidebar is `SB = 49, SBW = 31, SBC = 50,
  SCW = 29` in `render.js` — **derive these from `COLS`** rather than moving the
  numbers, so the next widening is free.
- Most layout already adapts: centring is `(COLS - len) >> 1`, right-aligned
  text uses `COLS - n`. There are roughly a dozen literal column numbers in
  draw calls — audit each.
- **Every screen must be checked at the new width**, not just the run screen:
  title, descend/schematic cards, foundry, help (two pages), victory, gameover,
  recap card, vignette panels. Several centre themselves and will simply work;
  the boxed ones need their widths re-derived.
- §0 law 6 governs: more columns is only better if it reads better. Do not
  spread the sidebar thin to fill space — a wider gutter and a shorter line
  length often read *better* than more content.
- §0 law 7: a rate readout must not consume `run.rng`, and must derive from
  state the sim already keeps.

**Contracts:** `js/data.js` (COLS), `js/render.js` (layout constants, the four
new panels, every screen's width), `js/art.js` (the run-screen rig portrait,
3x2 item/building icons via the M-HIRES rasterizer, any boxed asset with a
baked width), `test/*` (width assertions).
**Acceptance:** balance numbers identical before/after (proves the map did not
grow); every screen rendered at 112 columns in a stub-canvas test with no row
exceeding the grid; the CHAIN panel's bottleneck marker asserted against a
constructed starved base; `tools/build.js` parses.
**Size:** ~250 lines for the widening and the audit, ~350 for the four panels.
Ship them in this order, committing each: RIG (it is already drawn — mostly
placement), STOCK, LOADOUT, CHAIN (most logic). A session that runs short
should leave the rig on screen, which is the change the director most wants.
---

### M-HIRES — Fill the Screen, Then Sharpen It (P0-adjacent — dispatch anytime)

> Director's note (2026-08-11): *"make the definition of ascii better: Canvas
> renderer + Braille/block-character support. also make it full res. it is a
> square to this moment."*

That note names **two different problems**, and they have very different risk
profiles. Do them in the order below; each ships independently.

#### The verified starting state

Measured in the repo at `bf875e6`, not assumed — re-verify before you build:

- `render.js` draws an **80 × 33** grid of **10 × 19 px** cells → a **800 × 627**
  logical canvas.
- `init()` sets `canvas.style.width/height` to those pixel values **once, on
  load**. `style.css` then caps it with `max-width:100vw; max-height:100vh`,
  which can only ever *shrink* it. **There is no resize handler anywhere in the
  codebase** — `init()` is called once from `Engine.start()` on `load`.
- Result on any monitor wider than 800px: a fixed island of terminal in a field
  of black. That is the "it is a square" complaint, exactly.
- The renderer *already* handles devicePixelRatio for crispness (backing store
  at `COLS*CW*dpr`), and `pxToCell()` already maps clicks through
  `getBoundingClientRect()` — so it is **resolution-independent already**.
  Scaling will not break input. This is a much smaller job than it looks.
- `flush()` batches same-color spans into one `fillText` under
  `ctx.scale(CW / adv, 1)`, where `adv` is the measured advance of `█`.

#### ⚠ The finding that reshapes this brief: the font has no braille

`fc-match` against the shipped font stack, per codepoint:

| Codepoint | Resolves to |
|---|---|
| U+2580 `▀`, U+2588 `█`, U+2591 `░` | **DejaVu Sans Mono** ✅ |
| U+2596 `▖`, U+259A `▚` (quadrants) | **DejaVu Sans Mono** ✅ |
| U+2581 `▁`, U+258F `▏` (eighth blocks) | **DejaVu Sans Mono** ✅ |
| U+2800 `⠀` … U+28FF `⣿` (**braille**) | **DejaVu Sans** — the *proportional* face ❌ |

**Braille is not in DejaVu Sans Mono.** A naive braille implementation does not
merely look wrong, it corrupts the grid: `flush()` batches a whole run of cells
into one `fillText` scaled by `CW / adv`, where `adv` was measured from `█`. A
proportional fallback glyph has a different advance, so **every character after
it in that run slides out of its cell** — one braille dot smears an entire row.
Assume nothing here; probe at runtime (below).

#### Phase 0 — The frame clock is wrong on high-refresh monitors (small, do it first)

Found while reviewing M-ANIM, and it belongs here because this brief already
owns render's timing and metrics.

`engine.js`'s `loop()` runs at raw `requestAnimationFrame` rate with no render
throttle, and `fx.js` increments its frame counter `F` once per callback while
assuming `FPS = 60`. The sim is unaffected — it runs on a fixed-timestep
accumulator, correctly decoupled — and anything `fx.js` measures in sim ticks
against `run.t` is also correct. But every animation measured in *frames* runs
**2–2.4× too fast on a 120/144 Hz display**: the damper heartbeat, the smelter
breath, the breach-ready invitation pulse, GRIT's cigarette ember.

`fx.js` documents the assumption in its header rather than hiding it, so this
is a known trade, not a defect. Fix it by driving the clock from **elapsed
milliseconds** instead of a frame count — `F` becomes a time base, and
`breathe(period)` takes a duration rather than a frame span. Cosmetic-only, and
determinism is unaffected (FX already owns a private PRNG and its own test
proves it never touches `run.rng`).

**Acceptance:** advance the stub clock at 60 and at 144 fps and assert an
animation completes the same number of cycles per second of wall time.

#### Phase 1 — Make it fill the screen (do this first; it is the whole complaint)

Biggest visible payoff, zero dependencies, near-zero risk.

Canvas text is **re-rendered, not upscaled** — so drawing the same grid at a
larger cell size produces genuinely more pixels of glyph, not a blurry stretch.
That is the entire trick.

- Compute a scale from the viewport preserving the 80 × 33 aspect, then set
  cell metrics to `CW*s`, `CH*s`, font size to `16*s`, backing store to
  `COLS*CW*s*dpr`. Re-measure `adv` on every resize — it is cached from a
  `measureText` and *will* be stale otherwise.
- Add the missing `resize` listener (debounced ~100ms), and re-run it on
  `devicePixelRatio` change (monitor drag between displays).
- Prefer **fractional** scale filling the viewport over integer-only steps;
  glyphs are vector, so there is no nearest-neighbour argument for integers
  here. Do clamp to a sane maximum so a 4K display does not render 40px text.
- `pxToCell()` needs no change if it keeps using `getBoundingClientRect()`.
  **Verify this with a test rather than by reading it.**
- `#scanlines` in `style.css` is a fixed 3px repeating gradient. At 2× scale it
  reads twice as dense and muddies the art — scale its period with the cell
  size (a CSS custom property set from JS is fine).
- Keep a minimum: below ~800px wide (phones), letterbox rather than shrink text
  into illegibility.

**Acceptance:** a stub-canvas test asserting that at three viewport sizes the
grid still maps clicks to the right cells (round-trip `pxToCell` against known
cell centres), the aspect never distorts, and `adv` is re-measured after resize.

#### Phase 2 — Sub-cell resolution with block elements (no dependency)

Block elements are **already in the font**, today, with no vendoring:

| Family | Glyphs | Sub-cell grid | Effective resolution |
|---|---|---|---|
| Quadrants | `▘▝▖▗▚▞▀▄▌▐█` | 2 × 2 | 160 × 66 |
| Eighth blocks (vert) | `▁▂▃▄▅▆▇█` | 1 × 8 | 80 × 264 |
| Eighth blocks (horiz) | `▏▎▍▌▋▊▉█` | 8 × 1 | 640 × 33 |
| Shades | `░▒▓` | anti-aliasing | — |

Build `DC.Art.raster` — a **pure, DOM-free** helper that takes a boolean/level
bitmap and returns grid rows of block glyphs. Quadrants for 2D shapes, eighth
blocks for bars and gauges (a smelter fuel bar in 1/8ths instead of whole cells
is an instant readability win), shades for soft edges.

Cell aspect matters and is worth stating: cells are 10 × 19, so a **quadrant
sub-pixel is 5 × 9.5 — very tall**. Circles drawn naively on a quadrant grid
come out as eggs. Correct for it in the rasterizer, do not eyeball it.

#### Phase 2.5 — The font subset (the readability half of the dependency question)

M-MANUAL declined the CP437 font for a correctness reason and was right: `node
tools/glyphs.js` shows the game draws 93 non-ASCII glyphs, 27 outside CP437,
including the drill gear `¤`, the core charge `‡`, the belt `▶` and the cores
currency `◈`. A code-page font would tofu the item legend. Read
`vendor/README.md` before reopening that question.

But it left the *readability* half open, and under §0 law 6 that half is worth
doing. The problem is not texture, it is that **we cannot see what other
machines render.** The font stack originally listed no macOS face at all, so a
Mac fell through to Courier New and the box-drawing and block glyphs degraded —
invisible from a Linux box. That specific hole is now patched with Menlo and
Monaco (Menlo shares DejaVu's Bitstream Vera ancestry, so coverage and
proportions nearly match), but patching a stack is guesswork about other
people's systems; **vendoring ends the guessing.**

Do it as M-MANUAL specified: subset a full-Unicode monospace — not a code page
— to exactly the inventory `tools/glyphs.js` prints, rename the family per its
license (DejaVu's permits renamed derivatives), emit WOFF2 as a data-URI, and
teach `tools/build.js` to inline the stylesheet. No CDN links.

**The trap, and why this phase lives in M-HIRES:** `Render.init()` measures the
glyph advance ONCE at startup, but a webfont loads asynchronously — so the
grid would measure against the fallback face and every row would shear. It
needs a re-measure on `document.fonts.ready`. That is the same `adv`
re-measurement this brief already has to solve for resize in Phase 1. One fix,
two callers. Keep the system stack as the fallback chain — if the webfont
fails, the game must still be playable.

#### Phase 3 — Braille, only if it earns its dependency (2 × 4 = 160 × 132)

Braille's appeal is real: a 2 × 4 dot grid makes a sub-pixel **5 × 4.75 — very
nearly square**, which is exactly what quadrants fail at. But it costs a font.

Under rule 7 a dependency is permitted when it demonstrably improves play, so
this is allowed — but it must be done properly:

1. **Vendor a monospace face with verified U+2800–28FF coverage** (candidates:
   GNU Unifont — full BMP and a bitmap look that suits the game; Iosevka;
   Cascadia Code). Subset it to only the codepoints the game actually uses and
   embed as base64 woff2. `tools/build.js` must inline it — **no CDN links,
   `file://` must keep working.**
2. **Probe coverage at runtime before using it.** Measure a braille glyph's
   advance against `█`'s; if they differ beyond a small epsilon, the font did
   not load and braille must **fall back to the Phase 2 block path**. Ship the
   probe even with the vendored font — users' browsers block webfonts, and the
   failure mode is a corrupted row, not a missing dot.
3. Report the bundle size delta. `dist/deepcore.html` is 167 KiB today; a
   subset braille face should cost single-digit KiB, and if it costs 300 KiB
   the subsetting is wrong.

#### Where sub-cell resolution belongs — and where it must never go

**Do not sub-cell the map tiles.** The map is *interactive*: `pxToCell()` maps a
click to a cell, and every tile is a semantic, clickable, one-glyph object —
that legibility is the game. Doubling map resolution would decouple what the
player sees from what they can click, and would flatly contradict SPEC3 §0's
law that chunky beats smooth.

Sub-cell resolution belongs on the **non-interactive display surfaces**, where
it is pure gain:

- the **rig portrait** (title + Foundry) — the single biggest beneficiary; the
  bolt-on upgrade parts get real shape instead of suggestion
- the **victory core sphere** — near-square braille pixels make it a *sphere*
- **gauges and bars** — integrity, breach %, instability, smelter fuel, in
  eighths instead of whole cells
- **M-RECAP's charts**, if that brief has landed (guard it: absent = no-op)
- title-screen ember particles and the `DEEPCORE` logo

#### Contracts

`render.js` (scaling, metrics, resize), `style.css` (scanline period),
`art.js` (`DC.Art.raster`, portrait/sphere at higher fidelity), `engine.js`
(resize wiring only), optionally `vendor/` + `tools/build.js` for Phase 3.
`art.js` stays **DOM-free and pure** — the rasterizer must be testable in bare
node with no canvas. `js/data.js` **additive only**. No sim changes whatsoever.

**Acceptance:** click round-trip correct at three viewport sizes; `adv`
re-measured on resize; rasterizer unit-tested against known bitmaps (including
the aspect correction); a font-coverage probe test proving the block fallback
engages when braille is unavailable; all five suites green; `tools/build.js`
parses and reports its size delta.

**Size:** ~150 lines Phase 1, ~200 Phase 2, ~150 + a vendored font Phase 3.
**Ship Phase 1 alone if the session runs short — it is most of the value.**

---

### M-HUMANBAL — Final Balance: the pass a bot cannot do (P0 — dispatch LAST)

> Director, 2026-08-17, after playing: *"everything i tell you we will add to a
> final balance updates wave, where we solve issues of balancing with human
> gameplay."*

**Why this wave exists.** `test/balance.js` runs a scripted bot that knows the
rules by construction. It has never mis-aimed an extractor, never built in the
wrong order, never spent its last plates on the wrong thing, and never had to
guess what a panel meant. So a green sweep proves the game **winnable** and can
never prove it **playable** — that gap is exactly how the director ended up
unable to play his own game while all five suites passed (see M-ONBOARD). This
brief is the counterweight: the findings that only appear when a human plays.

**Dispatch LAST**, after every systems brief has landed. Balance tuned against a
moving system is balance tuned twice, and these fixes want tuning *as a set* —
several of them push the same numbers in the same direction and applying them
one at a time will overshoot.

**This section is a LEDGER. Append findings as they are found; do not fix them
one at a time.** Each entry records the symptom in the director's words, the
arithmetic underneath it, and candidate fixes — the *decision* is made when the
wave is dispatched, with all findings on the table at once.

Entries come in two kinds, and they do **not** ship together:

- **TUNING** findings (1, 2, 5, 6, 7) are numbers. They are the reason this
  wave is one wave: several of them push the same values the same way, so they
  are decided as a set, last, against systems that have stopped moving.
- **CRAFT** findings (3, 4, 8, 9, 10, 11, 12) are features the director asked
  for while playing. They are recorded here because this is where playtest
  findings go, but they are *built*, not tuned — dispatch each as its own brief
  whenever the board allows, and do not hold them behind the tuning pass.

#### Finding 1 — the plate death spiral: stratum 1 can soft-lock, silently

> *"if i mistakenly use an extractor and dont make it to a smelter, and the ores
> are not close to the rig, i may hit an unescapable ceiling where i dont have
> plates to create a smelter, and thus i cant create belts nor extractors nor
> nothing."*

Real, and reachable by ordinary trial and error. The arithmetic:

| | |
|---|---|
| start stock (naked) | **40 iron plate**, 8 gears, **no coal** |
| costs | belt 1 · extractor 8 · smelter 10 · assembler 12 |
| demolish refund | `Math.floor(cost × 0.5)` — extractor 8→**4**, smelter 10→**5** |
| belts | refund **in full** (so belts are not the trap) |
| bootstrap cost of the first plate | iron extractor 8 + **coal** extractor 8 + smelter 10 = **26** |

Coal is not in start stock and a smelter burns one per three smelts, so the
cheapest configuration that produces a single plate costs **26 of your 40**.
Every build-and-undo cycle then burns half the capital you moved: **40 → 20 →
10 → 5**. At 5 plates a smelter is out of reach permanently, nothing in the
world makes plates, and *the run is over while the player keeps playing it*.
Three rounds of honest experimentation is all it takes, and a first-timer's
first three decisions are all experiments.

The nastiest part is not the lock, it is the silence: M-ONBOARD Part 1 made
every failure state name its own cause, and this state — the only genuinely
unrecoverable one in the game — names nothing.

Candidate fixes, cheapest first:

1. **Name the state, whatever else is decided.** A dead run must say it is dead.
   This is the one item that should ship even if every other candidate is
   rejected, because an unrecoverable state the player cannot detect is worse
   than an unrecoverable state.
2. **A free-undo window.** Full refund on a machine demolished within ~10s of
   placing it. This is the surgical option: it forgives *mistakes* while leaving
   strategic rebuilds priced. Recommended.
3. **Raise `D.DEMOLISH_REFUND`** (0.5 → 0.75). Simple, but it also cheapens
   real mid-run restructuring, which is a decision the game currently charges
   for on purpose.
4. **A floor under the rig**: if plates < smelter cost, no smelter stands, and
   nothing is producing, the Company issues an emergency requisition — in
   fiction, with a GRIT line, so it reads as the world and not as a bailout.
5. **Raise stratum 1's `START_STOCK`.** Bluntest, and it inflates every later
   floor's opening too. Least favoured.

Whatever is picked, the acceptance test is a constructed dead-end state, not a
sweep: build a run down to the locked position and assert the player can still
act. `test/balance.js`'s bot will never find this, by construction.

#### Finding 2 — `←STARVED` is honest arithmetic and the wrong lesson on floor 1

> *"it should not be necessary to have 2 smelters like what is proposed at the
> moment. floor 1 should have a bit of wiggle room for errors."*

The director is right, and the good news is that the game already agrees — it is
the *panel* that is misleading him. Stratum 1 asks for **20 gears and hands you
8**, so the real job is 12 gears:

| chain | plate/s | gear/s | 12 gears in |
|---|---|---|---|
| 1 smelter → 1 assembler | 0.50 | 0.25 | **48s** |
| 2 smelters → 1 assembler | 0.73 (assembler-capped) | 0.36 | 33s |

Against SPEC §12's stratum-1 target (breach 90–150s plus ~40s of building),
**one smelter clears it with room to spare.** But CHAIN marks the plate stage
`←STARVED` in the warning colour the instant that base exists, because it
faithfully reports that the assembler is not saturated. Technically correct;
pedagogically backwards. It reads as *you have a problem* when the truth is
*you are on pace*, and it pushes a new player into spending 10 more plates they
may need for Finding 1's recovery.

This is a §0 law 6 defect, not an arithmetic one: the number is right and the
reader is misled. Directions worth considering:

- Mark the limiting stage in a **neutral** colour and reserve the warning
  colour for a stage that is limiting *and* off the pace the current floor
  actually demands (the panel already projects the breach — compare against it).
- Say what it costs, not just that it exists: `1S 0.50/s — breach 0:48` beside
  `2S — 0:33` makes it a **choice** rather than an accusation.
- Keep `STARVED` for a genuinely stalled stage (rate 0), which is the word's
  plain meaning anyway; "not saturated" is a different condition and deserves a
  different word.

#### Finding 3 (CRAFT) — the induction stops one third of the way through the loop

> Director, 2026-08-17: *"an expansion of the tutorial."*

`BEATS = ['place', 'rotate', 'belt', 'ore']`. The induction teaches the player
to deliver **ore** to the rig — and **the rig does not run on ore.** It runs on
gears, 20 of them on stratum 1. A player who completes every beat of the
tutorial still does not know what a smelter is for, which is *verbatim the
question the director had to ask* ("whats the smelter for? should i get the ore
to the drill or to the smelter?"). The tutorial ends exactly one beat before the
lesson he actually needed.

Worse, it ends before **coal**, which is Finding 1's murder weapon: coal is not
in start stock, a smelter is dead without it, and nothing in the game currently
tells a new player that a second extractor on a second resource is mandatory
before a single plate exists.

Proposed second act — four more beats, same machinery, same gating on the player
actually doing it:

| beat | teaches | why it must exist |
|---|---|---|
| 5 · smelt | place a smelter, belt ore into it | the question he asked out loud |
| 6 · coal | a *second* extractor, on coal, belted to the same smelter | the soft-lock's root cause, taught before it can bite |
| 7 · craft | assembler, plates → gears | the rig's actual fuel |
| 8 · feed | gears to the rig, watch GEAR fill, then `D` | closes the loop and hands over the run |

Notes for whoever builds it:

- **The pressure pause must not cover all eight beats.** `run.instHold` freezing
  instability through a full chain build is most of a stratum with no clock,
  which trains a habit stratum 2 then punishes. Release it at the end of beat 4
  as it does today, and let acts two run under real pressure — GRIT can say so,
  which is more dramatic than silence.
- Beat 6 is the one that may need a map guarantee: stratum 1 must have a coal
  vein reachable, or the beat must detect that it does not and skip gracefully.
  `pickVein` already does the lazy-wait dance for iron; reuse the pattern.
- Eight gated beats is a long induction for a returning player — **`TAB` must
  keep skipping the whole thing from any beat**, and the act break after beat 4
  is a natural second offer to bow out.
- The manual (page 1) and CHAIN already explain this chain. Point at them rather
  than restating them, exactly as beat 4 now points at STOCK.

#### Finding 4 (CRAFT) — GRIT has no face

> Director, 2026-08-17: *"alongside a face/icon for grit."*

He has 422 lines, a typewriter, a bar of his own, and now an induction he
narrates — and he has never been *seen*. `js/art.js` has a layered rig portrait
and nothing else; there is no GRIT anywhere in the art.

A small ASCII portrait, built the way the STOCK icons and the rig are built
(sub-cell bitmaps through `DC.Art.raster`, so the source is a readable picture
and the glyphs fall out of the rasterizer). Where it goes:

- **the induction box** first — he is the teacher there, it is his scene, and a
  face makes the corporate-script bit land as performance rather than text;
- the foreman bar, if it can be afforded (2 × 41 is tight);
- the Foundry and/or the recap card, where there is room to breathe.

The real cost to state up front: **the speech box is 40 wide with three prose
rows of 36.** A face in a left-hand column takes ~6 of those columns and drops
the prose to ~30, which reflows every one of the 67 authored induction lines and
tightens the ceiling for the ~60 more that Finding 3 needs. That is a writing
cost, not just a drawing one, and it is the thing to decide *before* act two is
written rather than after.

- **Expressions, keyed to state the game already has** — no new tracking:
  deadpan (default), pleased (a beat completed, a breach ready), alarmed
  (quake, low integrity), and one for the dad jokes he is proudest of. Three
  rows is eyes and a mouth; that is enough for all four if the eyes carry it.
- Law 6 governs: it must read at one cell = 10 × 19 px, and it must never cost
  a row of GRIT's actual words. If the face and the line compete, the line wins.
- Law 7: expression follows state, never `run.rng`.


#### Finding 5 (TUNING) — building costs, the director's numbers

> Director, 2026-08-18: *"game is too hard: extractor at 4, smelter at 5,
> assembler at 6, damper at 6 / 2"*

Current -> asked: extractor **8 -> 4**, smelter **10 -> 5**, assembler
**12 -> 6**, damper **8+2cu -> 6+2cu** (belt stays 1). Roughly a halving of
the buy-in for the whole tier-1 chain: the classic first base (2 extractors +
smelter + assembler) goes from 38 of your 40 starting plates to **19**.

These are the director's explicit numbers, so the tuning pass starts FROM
them rather than debating them — but apply them aware of the couplings:

- They soften Finding 1's death spiral enormously (a full rebuild after a
  mistake costs half as much), possibly enough that Finding 1 needs only its
  "name the state" fix and no refund mechanics at all. Decide together.
- `test/balance.js` re-baselines: s1 breach med will drop well below 137s and
  cores/run will rise. SPEC §12's bands themselves may need re-stating — that
  is allowed here and nowhere else, with the director in the loop.
- Demolish refunds `floor(cost * 0.5)` — at the new costs, extractor refunds 2,
  smelter 2, assembler 3. The absolute loss per mistake shrinks with the cost,
  which is the point.

#### Finding 6 (TUNING) — the stratum-2 cliff: descending broke

> Director, 2026-08-18: *"constantly gets to stratum 2, but without resources.
> unable to advance at all"*

Verified — this is the run-killer for a human and it is STRUCTURAL, not a map
roll. What descend actually carries (sim `startStratum` + SPEC §5.9): your
**inventory** rides down, your **machines do not** — every building stays on
the floor above, unrefunded unless the Foundry's Salvage Rig (1 level, 40%) is
bought. `START_STOCK` (40 plates, 8 gears) is granted ONCE per run, not per
stratum. So the natural first-run shape is: spend ~38 of 40 plates on the s1
base, feed the drill, descend — and arrive at s2 with pocket change, no
machines, and a fresh 28-gear bill. The bot survives s2 93% of the time
because it BANKS plates before descending, which no first-time human knows to
do; the game never says the machines stay behind. Candidate directions:

1. Finding 5's cost cuts alone close most of it (a fresh s2 base costs ~19).
2. Teach it: the tutorial's proposed beat 8 / a GRIT line on first breach-ready
   ("pack a crate before you drop, kid") — cheap and honest.
3. A small per-stratum arrival stipend, in fiction a Company resupply drop.
4. Make base salvage a default at some %, with the Foundry upgrade raising it.

#### Finding 7 (TUNING) — instability a touch slower

> Director, 2026-08-18: *"instability needs to tick a bit slower"*

Current `instabRate` runs 0.29/s (s1) to 0.52/s (s8), already -35% from the
original values per data.js's own comment. "A bit" is the instruction —
something like a further 10-15%, decided WITH Findings 5/6 (cheaper buildings
mean faster recovery, which already relieves pressure) and re-checked against
the DRIFTED camper note in test/balance.js's footer: the camper currently dies
at s8 rather than the target s6-s7, and slowing instability pushes that number
the WRONG way. This is the clearest example of why the ledger ships as a set.

#### Finding 8 (CRAFT) — rock and rubble as an emergency ore source

> Director, 2026-08-18: *"what rewards can come from rubble or rocks? that may
> be a good place to farm some ores when in need, but with low chances of
> finding them (30ish %)"*

What exists today: digging ROCK rolls M-EVENTS' find table at **8%** per
completed excavation (`D.EVENTS.findRate`) — flavour finds, occasionally
useful; and from s3 the crusher already eats RUBBLE into iron ore (M-TIER2),
but that is a machine, not a shovel. The ask: digging as a hands-on fallback
when the veins are far and the crate is empty — i.e. exactly the situation of
Findings 1 and 6. Direction: a ~30% chance of a small ore payout (1-2 ore,
stratum-appropriate) on completed ROCK digs, SEPARATE from the 8% find table
so the vignettes stay special; X-dig already costs 4s of standing still, which
is the built-in price. Law 7: the roll pattern must match rollDig's (the
events stream, not run.rng). Balance note: it is a floor under bad luck, not
an economy — the numbers land in the tuning set with Findings 5/6.

#### Finding 9 (CRAFT) — strata as biomes: thematic colour per floor

> Director, 2026-08-18: *"thematic per stratum colors and biome."*

Today each stratum has a name, a one-line tag, an `accent` colour and terrain
features (chasms, magma, obsidian) — the accent tints a few UI touches, but
floor rock is the same grey everywhere and s2 reads like s6. The ask is that
each floor LOOK like a place: palette (rock/floor/vein tints from the
stratum's accent family), flora/detail glyphs per biome (the ♠ moss of the
topsoil giving way to crystal growths, bone beds, obsidian sheen), and the FX
layer's ambient dust/embers following suit. Law 6 rules it: machines, veins,
belts and hazards must stay MORE readable than the scenery, on every palette —
a biome that costs one glance of machine-finding is a failed biome.

#### Finding 10 (CRAFT) — the icon overhaul, on the rasterizer we already have

> Director, 2026-08-18: *"cosmetic overhaul: do new beautifull icons: for this
> we will try any engine capable of upresolution ascii"*

The engine exists in-repo: `DC.Art.raster` (M-HIRES) draws sub-cell bitmaps
through quadrants, eighth-blocks and braille — it is what the STOCK icons, the
gauges and the victory sphere already use. The overhaul is to use it HARDER:
richer multi-cell icons (2 rows where 1 is cramped), per-icon colour pairs
instead of single-colour glyphs, the BUILD/SCHEMATIC/FOUNDRY lists brought up
to the same standard, and the braille tier used where the probe says the font
can carry it. No CDN, no image assets, no new dependency — file:// stays law.
If a genuinely better third-party approach is found it must vendor in under
the same rules M-HIRES vendored its font subset.

#### Finding 11 (CRAFT) — the rig portrait breathes

> Director, 2026-08-18: *"animated background for the rig art while in game"*

The YOUR RIG panel (M-WIDE) is a still. Give it life through js/fx.js, which
already owns exactly this kind of motion and its own PRNG (law 7 is why that
matters — the panel must not touch run.rng): smoke curling from the stack,
the ▼ drill-bit column ticking when the drill actually feeds, rock rows
shimmering with the stratum accent (Finding 9's palette reaching the portrait),
sparks on quake frames, the whole panel dimming with §A2 when collapse nears.
State-driven, never random-scheduled: the portrait animating what the sim is
DOING makes it an instrument; ambient wiggle makes it a screensaver.

#### Finding 12 (CRAFT, big — likely its own brief) — difficulty as CONTRACTS

> Director, 2026-08-18: *"3 levels of difficulty with different rewards (meta
> progression wise, harder difficulties are more rewarding) but i dont want
> the classic easy normal hard selector, think of another cool way to select
> difficulties, like the chips options in balatro."*

The fiction already owns the answer: you work for the Company, so difficulty
is the CONTRACT you sign before descending. Three contracts on the descent
screen, presented as cards (the schematic-pick screen already renders exactly
this shape), each a document with terms, a wage multiplier and a Company-form
name — picked, not configured:

  STANDARD TERMS      wage x1.0   the game as shipped
  HAZARD CLAUSE       wage x1.5   harsher terms, e.g. +instability, -stock
  DEATH WARRANT       wage x2.0   the planet reads your paperwork and objects

Principles for whoever builds it (numbers are illustrative, not decided):
- Reward is META-side, as asked: the wage multiplies CORES banked, so harder
  contracts are the fast lane through the Foundry.
- Terms are named, concrete and few — two or three lines a player can hold in
  their head ("quakes hit 25% harder; start with 20 plates"), not a stat sheet.
  GRIT gets a line about each; legal-document humour writes itself.
- Sim-side it is a `run.mods` bundle, the mechanism M-MANTLE's mutators
  already use — same machinery, so build it WITH or AFTER M-MANTLE, not
  against it. The Daily signs STANDARD TERMS always (ranked runs stay equal).
- Locked contracts unlock by deeds (first win unlocks HAZARD, a HAZARD win
  unlocks WARRANT), which is itself meta-progression.
- test/balance.js grows a per-contract loadout row; SPEC §12's bands apply to
  STANDARD TERMS only, with the harder contracts checked for "winnable at
  all" rather than banded.

**Contracts:** `js/data.js` (values — this brief and M-POLISH are the only two
that may change them), `js/sim.js` (refund/undo window), `js/render.js` (CHAIN's
colour rule), `test/balance.js`, `test/headless.js` (constructed dead-end).
Findings 3 and 4 are separate dispatches: `js/tutorial.js` + `js/barks.js` for
the second act, `js/art.js` + `js/render.js` for the face.
**Acceptance:** the dead-end state is provably escapable or provably announced;
SPEC §12's targets still hold after the tuning is applied *as a set*; no finding
is fixed in a way that re-breaks an earlier one.
**Size:** unknown until the ledger closes — it grows with every playtest.

---

## §Z Dispatch plan

**Order** (respects dependencies, front-loads feel):

| Wave | Modules | Why first |
|---|---|---|
| 1 | M-POLISH | everything else builds on a shipped-quality base; owns balance |
| 2 | M-ANIM-1 + M-ANIM-2 (one session), M-RECAP + M-MANUAL (parallel sessions) | biggest feel jump per line; recap locks the payoff; the manual is the front door |
| 2.5 | M-HIRES (alone — it rewrites render's coordinate basis) | the game stops being an 800px island on the monitor; on a clean board this would be first |
| 3 | M-CORELORE + M-GRITPLUS (one session — both are writing), M-WONDERS (parallel) | identity deepeners, no cross-deps |
| 4 | M-EVENTS (big; includes the cat) | the roguelike soul; benefits from anim layer existing |
| 5 | M-MANTLE + M-SCHEMS2 (one session), M-TIER2 (parallel, strong session) | systems expansion |
| 6 | M-WORMS, then M-ACHIEVE + M-RIGSKINS (one session), M-SOUND last | dessert |
| 7 | **M-HUMANBAL, alone and last** | the only pass a bot cannot do; tuned as a SET, against systems that have stopped moving |

**Session prompt template** (paste per dispatch, fill the blanks):

> Read `/home/pedro/Documents/games/deepcore/SPEC.md`, `SPEC2.md`, and
> `SPEC3.md` section **[M-XXX]** in full, plus `js/data.js`. Implement exactly
> that brief. Honor SPEC3's rules of engagement (top of file): all four test
> suites green + extended for your feature, `tools/build.js` parses,
> checkpoint commit after every green milestone with the Co-Authored-By
> trailer, DOM-free determinism in sim/map/meta/art/barks, GRIT voice
> guardrails. data.js: additive only [unless M-POLISH]. When the brief names
> another module as a dependency hook, guard it (feature absent = no-op).
> Return: what you built, what you deviated on and why, test output.

**Scope guard:** waves 1–3 alone make this a game people tell friends about
(shipped polish, living glyphs, a run-recap to paste, two voices, landmark
maps). Waves 4–6 make it deep. If you dispatch only three sessions ever, make
them Waves 1, 2, 3.
