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

## §0 The Six Laws (design compass — read before inventing anything)

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
