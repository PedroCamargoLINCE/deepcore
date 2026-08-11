# DEEPCORE — Project State & Session Handoff

Living orientation doc. Any new session should be able to read **this file plus
the specs** and pick the work up cold — no prior conversation required.

Last updated: 2026-08-11, during Wave 1 (M-POLISH).

---

## What this is

DEEPCORE: an incremental automation roguelike in a terminal/ASCII register.
You command a drilling rig descending through 8 procedurally generated strata
toward the planet's core. Each stratum, you build a small Factorio-lite factory
(extractors → belts → smelters → assemblers) whose gear/charge throughput *is*
your descent speed. Rising instability and quakes punish camping — the game is
about getting *through*, not surviving. Meta progression (the Foundry) is small
and deliberately secondary. Victory = breach stratum 8 (~15–25 min); an endless
Mantle continues after for 30–40 min runs.

Plain browser JS, one canvas, character-grid rendering, runs from `file://`.
Repo: `github.com/PedroCamargoLINCE/deepcore` (private) ·
working copy: `/home/pedro/Documents/games/deepcore`.

## Read in this order

| File | What it is |
|---|---|
| `README.md` | player-facing: how to run, controls, the production chain |
| `SPEC.md` | v1.0 design + module contracts — the systems source of truth |
| `SPEC2.md` | v1.1 "juice": GRIT the foreman, rig-part art, keyboard-first, color |
| `SPEC3.md` | v1.2 creative addendum: animation choreography + 14 dispatch briefs |
| `docs/DISPATCH.md` | how briefs are handed to worker sessions (file ownership, prompts) |
| `docs/ROADMAP.md` | superseded by SPEC3; maps old module ids |

`js/data.js` is the balance source of truth. The in-game field manual composes
its numbers from it at load, so tuning a constant retunes the manual too.

## Commands

```
node test/headless.js       # sim: mapgen, machines, belts, hazards
node test/integration.js    # engine + sim end-to-end, bot policies, screens
node test/barks_test.js     # GRIT's line corpus + voice lint
node test/rig_test.js       # rig portrait composition
node test/balance.js        # multi-seed balance sweep vs SPEC.md §12 targets
node tools/build.js         # bundle -> dist/deepcore.html
```
Test knobs: `DC_SEED=<n>`, `DC_DEBUG=1`, `DC_TRACE=1`.

## Status

- **v1.1 is feature-complete and green**: full run loop, 8 strata + endless
  Mantle, 5 buildings, 14 schematics, 9 Foundry upgrades, quake/magma/
  instability pressure, GRIT's 168-line bark system, layered rig portrait with
  bolt-on upgrade parts, schematic icons/badges, per-stratum accent colors,
  full keyboard play (arrows + Enter; WASD deliberately unbound — `D` is
  descend), meta save.
- **Wave 1 (M-POLISH) in flight**: 11 CX findings + backlog + balance sweep and
  retune. It is the only brief permitted to change existing `data.js` values.
- **Waves 2–6 not started.** Order and paste-ready prompts: `docs/DISPATCH.md`.

## Conventions (violating these has cost us hours before)

1. **Checkpoint-commit constantly.** Session limits have killed four agent
   fleets mid-task; committed work is the only work that survives.
2. **When parallel sessions/agents share the tree, commit BY PATH only** —
   never `git add -A`. That mistake once swept a dying agent's broken,
   unverified `test/balance.js` into an unrelated commit, where it sat unnoticed.
3. **Worker sessions push a branch and stop.** The orchestrator merges.
4. Sim/map/meta/art/barks stay DOM-free and deterministic (`run.rng` only —
   no `Date.now`, no `Math.random`). Render-side animation may use its own
   frame clock but must never feed back into sim.
5. The character-grid identity is law. Dependencies are allowed when they
   genuinely improve play, vendored and inlined by `tools/build.js`
   (SPEC3 rule 7) — no CDN links; `file://` must keep working.
6. GRIT's voice: profanity, gallows humor, drilling innuendo, and
   Company-hating are in bounds by design. Slurs, hate, explicit anatomy, and
   non-consent framing are not.

## Picking this up in a fresh session

Paste this:

> Read `/home/pedro/Documents/games/deepcore/docs/STATE.md`, then `SPEC3.md`
> and `docs/DISPATCH.md`. Check `git log --oneline | head -20` and run the test
> suites to confirm where things stand. Then tell me the current status and
> what the next wave to dispatch is.
