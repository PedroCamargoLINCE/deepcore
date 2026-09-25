# DEEPCORE — Project State & Session Handoff

Living orientation doc. Any new session should be able to read **this file plus
the specs** and pick the work up cold — no prior conversation required.

Last updated: 2026-09-25, 1.4 Engraved extension and hybrid strata.

## Current handoff — read this before the historical notes

Engraved now extends through the contract desk, Foundry tooling, trophy shelf,
ledger, logbook, all three manual pages, recap and pause screen. The director
explicitly allowed non-ASCII graphics for the stratum and asked for better
icons: `js/strata.js` paints faceted geology, ore deposits, machine chassis and
belt rails below the semantic character layer. Its vector icons cover every
resource, build tool and Foundry upgrade. The right-hand rig panel becomes a
state-driven machine cutaway while inspecting or preparing a build; induction
retains GRIT. No gameplay values, lore, save formats or controls were changed.
Both visual layers are omitted from the Classic standalone build. See
`docs/AESTHETICS.md` for the new verification and invariants.

Follow-up human feedback: coal looked too similar to iron. Engraved now uses
fractured coal clusters, banded iron slabs and separate copper nuggets, with
distinct map-deposit textures and ore-specific belt cargo glyphs. Colour-free
silhouette tests guard against returning to the same recoloured rock. Classic
and all gameplay values remain unchanged.

The director subsequently requested a complete aesthetics overhaul, with no
commitment to the old visuals, keeping gameplay and lore. `docs/AESTHETICS.md`
records the implemented Engraved edition: high-definition character portraits,
machinery, encounters and terrain; V switches to Classic. `ascii-native` is a
published branch at `e30d1a8`, preserving the exact pre-overhaul release.
`node tools/build.js --classic` also produces a separate classic artifact.
Include `node test/engraving_test.js` in verification. The naked/upgraded
canonical sweeps remain byte-identical to the pre-overhaul game.

The outstanding tutorial, biome, icon/font, rig-animation, overdrive and
M-HUMANBAL work is implemented and tested. `docs/RELEASE.md` is the current
decision ledger and contains before/after balance evidence, test commands,
and the harness limitations. All original waves are implemented; the older
status bullets below are historical, not a fresh queue to dispatch.

The follow-up audit found and repaired two real progression bugs: charge-gated
maps could contain no copper, and Cold Seam removed coal while still requiring
it for charges. SPEC3 F15–16 and `docs/RELEASE.md` record the correction. Earlier
claims that all three floor-5 stalls were planner failures were wrong: 42 and
555 had no copper, while 90210 had ore but boxed in its assembler.
With the repair and unchanged bot routing, upgraded STANDARD wins 11/14
(previously 9/14); HAZARD 11/14; WARRANT 7/14. Seed 90210 still has a boxed-in
charge assembler despite 12 live copper tiles. No difficulty retuning was
added to hide that layout failure. The offline bundle now builds at 773 KiB.

The director delegated the remaining fun/pacing choice: keep STANDARD
forgiving, allow useful first-run Foundry purchases, and put extra risk/reward
in contracts. No post-breach surcharge or automatic floor salvage was added.
The original opening/core/camper bands have been explicitly superseded in
SPEC §12; the full-run time and floor-two survival targets still hold.

The tutorial source worktree was recovered without deleting or resetting it.
Keep personal untracked artifacts intact. AI commit-attribution trailers are
forbidden by the director; this overrides old agent habits. Use the local
`.githooks/commit-msg` guard. Human credits remain welcome.

### Release / history cleanup — 2026-09-09

Game implementation and attribution guard are in `bfef873` (the rewritten
equivalent of the original `41563c3` checkpoint). All five suites and the
attribution tests pass; the rebuilt offline bundle is 771 KiB. Real Chromium
selects Braille with zero width mismatches across all 256 masks. The local
commit guard uses an absolute path so it also protects the old worktree.

Historical cleanup removed AI credits/session footers from **181 messages**;
**184 commit IDs** changed because parent hashes changed too. Every tree,
author/committer identity and date, and original merge relationship was
verified unchanged. Nine signatures authenticating old commit bytes were
removed from their rewritten equivalents, not falsely carried forward.

The verified original history, original working patches, commit map and
verification report are in the ignored local directory:
`.history-backups/ai-cleanup-2026-09-09-9PPPwV/`.
Six clean merged worktrees were archived there before removal, along with
eleven merged local branch refs. The archive includes their ignored files;
the bundle preserves their original commits. Personal artifacts remain intact.

Preserve `/home/pedro/Documents/games/deepcore-tut2`: its six modified source
files remain byte-identical to the recovery checkpoint. Its committed face
and unfinished act two are fully implemented in master. A recovery merge
records that branch's ancestry without replacing the completed implementation.

Release publication uses an atomic exact-ref force-with-lease push: rewritten
master and the preserved tutorial branch replace their old tips, and fourteen
verified-merged remote branches are removed. The local backup's
`publication.json` records successful remote verification. Other clones must
be resynchronized; merging old history would restore the removed credits.

GitHub retains merged-PR snapshots `refs/pull/1/head` and `refs/pull/2/head`.
Branch-history cleanup does not erase those server-held copies or old-SHA
caches. Do not describe this as erasing every historical copy on GitHub.
GitHub CLI 2.98.0 is installed and authenticated.

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

## Historical status (superseded by the current handoff above)

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

- **M-CONTRACTS (2026-08-24, branch M-CONTRACTS)**: difficulty is the paper
  you sign — three Company forms on a `contract` screen between the title's
  [ENTER] and the run (Papers Please for the paper, Balatro for the pick).
  A contract is an effects layer of `Meta.effects()`'s shape, applied in
  `Sim.newRun(effects, seed, contractId)` after the Foundry; the wage
  multiplies at `Meta.award` and nowhere else (`result.paid`). STANDARD
  applies nothing and `test/balance.js` is byte-identical under it; HAZARD
  (quakes 1.25x, hull -20, wage x1.5) unlocks on the first win, DEATH
  WARRANT (quakes 1.5x, no salvage ever, hull -30, wage x2) on a HAZARD win.
  Terms were measured, not typed — any plate advance made the riders EASIER
  than STANDARD for the bot; see the M-CONTRACTS paragraph in the balance
  footer. The Daily, the induction and [I] always sign STANDARD silently.
  `SAVE_V` 6 (optional fields; v1..v5 load). Two trophies, a CONTRACTS SIGNED
  ledger line, `DC_BAL_CONTRACT=standard|hazard|warrant`.

- **M-ROCKORE (2026-08-25, branch M-ROCKORE)**: the spoil — SPEC3 M-HUMANBAL
  Finding 8. A completed ROCK dig pays 1-2 stratum-appropriate ore ~30% of the
  time, SEPARATE from M-EVENTS' 8% find table (both can land on one hole).
  Rubble is untouched: that stays the crusher's economy (M-TIER2). It is a
  floor under bad luck for the run where the veins are far and the crate is
  empty (Findings 1 and 6), priced by the 4s X already charges — 0.113 ore/s,
  22.5% of one extractor, so it can never be a farm (§0 law 4). Numbers are
  named fields in `D.EVENTS.rockOre` (chance/min/max/bias) for the tuning
  pass; `bias` multiplies the STRATUM's own vein weights (iron/coal x1.5,
  copper at par, core crystal x0.3 because charges gate the breach from s5
  down). Law 7: the roll owns a THIRD derived stream in `js/events.js`, never
  `run.rng` AND never the find table's stream — so the 8% finds sit at exactly
  the position M-EVENTS left them and both balance sweeps are byte-identical
  before and after. No UI, no save fields, no `SAVE_V` bump; the LOG line and
  the STOCK tick are the whole picture change. The sweep cannot measure this
  feature — the bot digs ~2 holes a run — and the balance footer says so.

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
