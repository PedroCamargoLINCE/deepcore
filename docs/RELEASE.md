# DEEPCORE 1.2 — completed board, 2026-09-09

The director asked to finish the outstanding board, including presentation,
then delegated the remaining pacing choice: immediate fun AND meta-fun.
The choice is a forgiving STANDARD with real factory decisions, useful early
Foundry purchases, and harder contracts for extra risk and extra wages. No
post-breach pressure surcharge, automatic salvage, or arrival stipend was
added. Upgrades should feel effective, not be cancelled by hidden punishment.

## What shipped

| Finding / brief | Resolution |
|---|---|
| M-TUTORIAL2 / F3–4 | Recovered the prior branch's face and unfinished act two; completed all eight lessons through a real gear delivery. Four facial moods, reactive pre-completed steps, stamps and signature, TAB skip, and an honest suspended induction if no coal is reachable. Pressure protection ends after the first ore, not after the whole factory. The six face columns are accepted; prose was reflowed to 3×30 and validated. |
| F9 — biomes | Eight terrain palettes, sparse flora/crystal/floor marks and drilling-driven dust/embers. Machines, resources and hazards retain their semantic colours. No map RNG change. |
| F10 — icons / upresolution | Rasterized 10×5 schematic icons, two-tone colour, hand-hinted compact build/Foundry icons. All 256 cell-aligned Braille glyphs are now embedded in Deepcore Mono, so the existing high-resolution tier works offline; blocks remain a tested fallback. No new runtime dependency. |
| F11 — breathing rig | Actual drill feeds drive shaft/bit motion and smoke, actual quake debris drives sparks, and collapse state drives dimming. Idle is idle; animation never rolls simulation RNG. |
| F14 — overdrive explanation | Recorded and implemented: rig inspection and toggle feedback explain gear/charge consumption, twice the feed rate, increased instability, and no progress without stock. The manual and README explain the same mechanic. |
| F1 — plate trap | Intact machines have a full-refund 10-second undo window; damaged/old machines keep normal salvage rules. A missing plate-production path gets a visible CHAIN warning and a recovery LOG message. Four successive wrong extractor experiments lose no capital inside the window. |
| F2 — false starvation | A positive limiting rate says PACE in cyan. STARVED means zero rate; NO COAL remains a genuine fault. |
| F5 — requested costs | Extractor 8→4, smelter 10→5, assembler 12→6, damper (8 iron + 2 copper)→(6 + 2). Starting stock remains 40 plates. |
| F6 — floor-two cliff | Breach feedback, CHAIN and the tutorial explain that machines stay behind. Pack 25 plates: the new 19-plate basic factory plus six belts. Costs + teaching chosen; no default salvage or free arrival stock. |
| F7 + F13 — pressure / worms | Instability grows 10% slower across strata and Mantle. Worms still begin on floor 3 and eat 5 ore; the cheaper factory restores margin without removing their threat or free-tunnel benefit. |
| DILUTED / harness decision | Replaced the fixed card list with an explicit, state-aware score for all 25 schematics. Corrected the camper's timing comparison. Both old behaviours remain selectable for A/B checks. Stale footer claims were removed; known planner limits remain visible. |
| F15 — missing charge ingredients | Post-release audit found genuine zero-copper floors. Missing reachable copper/crystal now gets four normal-richness deposits, with no extra RNG draw or changes to resource-complete maps. |
| F16 — Cold Seam charge dead end | Coal-free charge crafting on Cold Seam, consistently taught and reflected in cargo acceptance, consumption and CHAIN. Normal recipes and the lava-smelting challenge remain intact. |

F8 (dig spoil) and F12 (contracts) were already implemented and are retained.
The save key and schema remain unchanged: new timing/tutorial counters belong
to an active run, not persisted meta. Existing saves continue to load.

## Balance evidence — not a substitute for player feedback

Canonical 14 seeds, two policies, naked and the historical upgraded loadout:

```
m_stock:2,m_hull:2,m_damp:2,m_torque:2,m_fix:1,m_scan:1,m_deep:1,m_schem:1
```

This excludes the salvage upgrade deliberately. Do not use `DC_BAL_META=full`:
the harness expects explicit upgrade levels, not that alias.

Same legacy picker/pace before and after the tuning isolates the game change:

| STANDARD policy | Before | After tuning, same legacy bot |
|---|---:|---:|
| Naked first breach, median (includes construction) | 137 s | 100 s |
| Naked survive floor 2 | 12/14 | 14/14 |
| Naked wins | 0/14 | 2/14 |
| Naked cores, median | 2 | 6 |
| Upgraded wins | 2/14 | 11/14 |
| Upgraded winning time, median | 21.9 min | 17.8 min |

Initial 1.2 policy results, before F15–16 (adaptive picker + corrected camper timing):

| Rig / contract | Standard-policy wins | Median winning time | Camper wins |
|---|---:|---:|---:|
| Naked / STANDARD | 2/14 | 21.7 min | 4/14 |
| Upgraded / STANDARD | 9/14 | 17.5 min | 11/14 |
| Upgraded / HAZARD | 9/14 | 17.5 min | 11/14 |
| Upgraded / WARRANT | 5/14 | 16.8 min | 11/14 |

Naked first-breach range is 96–122 seconds; all 14 standard-policy runs clear
floor 2, and median cores are 6. Upgraded STANDARD wins span 16.0–20.5 minutes.
Upgraded minimum hull medians are 65 / 17 / 0 across the three contracts.
HAZARD's equal win count therefore does not mean its damage rider is inert.

The original 130–190-second opening and 2–5-core bands no longer hold. That
is a declared design change: less bootstrap waiting and a useful first-loss
purchase are preferable to starving the player to recover an old number.
The 15–25-minute full-win target and >=80% floor-two survival remain satisfied.

The camper now waits 1.5× the STANDARD departure decision, including its
stock-banking phase; previously it sometimes left *earlier* than STANDARD.
Extra stock changes later factories, timings and schematic trajectories. Its
higher win rate is an economic benefit, not a controlled pressure experiment.
We do not tune forced deaths at floors 6–7 to hide it. An upgraded rig being
able to exploit a good factory is allowed; endlessly idling still accumulates
instability, and the contracts increase the bill. The challenge can be chosen
without making early experimentation expensive.

Correction from the post-release audit: floor-5 stalls in upgraded
STANDARD included **missing copper**, not only planner failures. Expanding
the copper-chain search did not help; inspecting the actual grids found zero
copper ore. F15 repairs generation rather than changing the bot's routing.
The historical 9/14 above is retained as the before measurement. The harness
still cannot improvise every layout or measure comprehension and enjoyment,
but that does not justify dismissing unexplained stalls as bot limitations.

After the F15–16 repair, with the SAME adaptive picker and routing:

| Rig / contract | Standard-policy wins | Median winning time | Camper wins |
|---|---:|---:|---:|
| Naked / STANDARD | 2/14 | 21.7 min | 5/14 |
| Upgraded / STANDARD | 11/14 | 17.1 min | 10/14 |
| Upgraded / HAZARD | 11/14 | 17.1 min | 10/14 |
| Upgraded / WARRANT | 7/14 | 16.8 min | 10/14 |

Opening timings and STANDARD floor-two survival are unchanged; naked median
cores rise to 7. Upgraded minimum hull medians are now 81 / 41 / 23 across the
three contracts. STANDARD seeds 42 and 555 now win. Seed 90210 still stalls:
its diagnostic snapshot has 12 live copper tiles but no free routing-field
entry around its charge assembler. That is a different failure from missing
ore; a wider 96-site/four-facing search did not recover the boxed-in layout.
No bot-routing expansion or pressure/cost retuning was shipped for it.

## Verification and reproduction

All five gauntlet suites pass, including deterministic map/sim checks, legacy
save migrations, keyboard-only tutorial completion, pre-completed tutorial
steps, no-coal suspension, real TAB skip, all faces and biome palettes, both
icon encodings, truthful chain states, refund deadlines/damage, and rig state
animation. Attribution tests separately preserve human coauthors.
Charge regressions cover 800 generated maps, unchanged-map/RNG fixtures,
real Cold Seam and normal assembler jobs, Echo composition, belt acceptance,
and honest CHAIN/SCAN output. A separate 4,000-map audit found no missing
charge ingredient or inaccessible Cold Seam smelter site.

```
node test/headless.js
node test/integration.js
node test/barks_test.js
node test/rig_test.js
node test/balance.js
node test/attribution_test.js
node tools/build.js
```

Use `DC_BAL_META` with the exact loadout above and repeat with
`DC_BAL_CONTRACT=hazard` and `warrant`. For a controlled old-policy comparison,
set `DC_BAL_PICK=legacy DC_BAL_PACE=legacy`. Do not mix policy changes into a
claim of simulation-only A/B identity.

Real Chromium `file://` review covers the induction, schematic offers, Foundry
and distinct strata. The runtime selects Braille with the bundled font; the
metric/fallback tests remain in place. The generated single-file game is
`dist/deepcore.html` (ignored build output; rebuild from the checked-in source).

## Repository policy

AI commit-attribution instructions have been removed from the specs and all
dispatch prompts. `CLAUDE.md` records the director's override; enable the
commit-message guard with `git config core.hooksPath .githooks`. Human credits
are preserved. Historical message cleanup must keep trees, author identities,
dates and merge topology intact and be backed up before publishing rewritten
refs. Original personal artifacts and the unfinished tutorial source worktree
are not disposable litter.
