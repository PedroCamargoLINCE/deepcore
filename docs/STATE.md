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
node tools/ab.js '<patch>'  # A/B a data.js tuning through the sweep, no edit
```
Test knobs: `DC_SEED=<n>`, `DC_DEBUG=1`, `DC_TRACE=1`.
Sweep knobs: `DC_BAL_META`, `DC_BAL_SEEDS`, `DC_BAL_POLICIES`, `DC_BAL_BUDGET`,
`DC_BAL_CAPMIN`.

**Read `test/balance.js`'s footer before trusting its table.** It measures a
scripted bot, defaults to a naked (no-Foundry) rig, and maps each SPEC §12
target to the loadout it is actually checked under. The bot losing every naked
run is the intended shape of run one, not a balance bug — and its own ceiling
is the tier-2 chain, so `no-breach` stalls at s5+ mean the bot failed rather
than the stratum being unbeatable. Never tune `data.js` against those.

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
- **The grid is 112 × 33, not 80 × 33** (M-WIDE, wave 4.6). `D.COLS` is the only
  place the number lives; `render.js` derives the map box and BOTH panel
  columns from it (`DC.Render.LAYOUT` reports what it derived), so the next
  widening is a one-line change plus an audit of the centred screens. The MAP
  is untouched at 46 × 26 and must stay that way — every column the widening
  added is UI, and `test/balance.js` printing identical numbers is the proof.
  The second column carries the rig portrait, STOCK and LOADOUT; CHAIN sits
  under DRILL in the first. Anything drawing a new screen should centre itself
  off `COLS` rather than typing a margin.

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

## Running with the laptop closed

`claude --cloud "<brief>"` starts the session on Anthropic's infrastructure
rather than this machine, so the laptop can sleep; reattach by session id or
from claude.ai/code. `--remote-control` is the *other* thing — it drives a
session on this laptop from elsewhere and still needs it awake.

Local sessions die with the machine, and that is fine by design: everything
that matters is committed and pushed, and this file plus the specs reconstitute
the context cold. Workers commit **and push** every green milestone (see
`docs/DISPATCH.md`) so no in-flight brief is ever stranded on one disk.

## Picking this up in a fresh session

Paste this:

> Read `/home/pedro/Documents/games/deepcore/docs/STATE.md`, then `SPEC3.md`
> and `docs/DISPATCH.md`. Check `git log --oneline | head -20` and run the test
> suites to confirm where things stand. Then tell me the current status and
> what the next wave to dispatch is.
