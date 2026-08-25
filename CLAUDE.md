# DEEPCORE — READ THIS BEFORE YOU TOUCH THE DRILL

An incremental automation roguelike in honest ASCII. Eight strata to the Core.
The Mantle below that, forever. You are either the **orchestrator** (dispatches
workers, verifies, merges) or **THE LABORER** (one brief, one branch). Know which.

**The director owns all balance and model decisions. We ship good energy only.**

## Where the truth lives

- **`SPEC3.md`** — design canon. The Eight Laws (§0), the lineage, every brief,
  the M-HUMANBAL ledger. If it contradicts your instincts, the spec wins.
- **`docs/DISPATCH.md`** — the orchestration playbook: worker launch incantation,
  THE MODEL RULE, the monitor rule, the Frankenstein hazard, the wave table.
- **`docs/prompts/*.txt`** — aged-forward worker briefs. Never dispatch a stale one.

## Laws you will be tempted to break (don't)

1. **Plain browser JS**, IIFE → `DC` namespace. No build step, no CDN, no
   framework. `file://` must keep working. Runs in browser AND bare node.
2. **`run.rng` belongs to the sim.** Render, panels, barks, audio never touch it.
   A bark that rolls the dice silently changes which Mantle you get.
3. **Readability is the objective.** Legibility outranks density, cleverness,
   and authenticity. If the screen got harder to read, the feature failed.
4. **Saves never break.** `SAVE_KEY='deepcore_save_v1'` never moves; bump
   `SAVE_V`, default new fields in `sanitize()`. Old saves always load.
5. **Never tune `data.js` against the bot.** Balance changes go to the
   M-HUMANBAL ledger in SPEC3 — recorded, verified, shipped as a set, LAST.
6. **No Date.now / Math.random** in sim, map, meta, art, or barks. Deterministic
   or it doesn't merge.

## Before you claim anything works

Run the gauntlet — all five, every time:
`node test/headless.js && node test/integration.js && node test/barks_test.js
&& node test/rig_test.js && node test/balance.js`
Then **read the screen, not just the tests**: render
a frame and look at it. Byte-identical 14-seed sweep is the gate for UI/meta/
audio work; canonical-14 full-Foundry A/B for sim work.

Commit early, push always. Session limits eat unpushed work and nobody mourns it.

## The vibe

Papers Please, Dwarf Fortress, Factorio, Candy Box, Balatro, Cookie Clicker —
steal the shape, never the content. GRIT complains but signs. The Company
accepts no liability. The Company accepts everything else.
