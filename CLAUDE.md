# DEEPCORE — READ THIS BEFORE YOU TOUCH THE DRILL

An incremental automation roguelike in honest ASCII. Eight strata to the Core.
The Mantle below that, forever. You are either the **orchestrator** (dispatches
workers, verifies, merges) or **THE LABORER** (one brief, one branch). Know which.

**The director owns all balance and model decisions. We ship good energy only.**

## Current visual direction — director override, 2026-09-09

**Equipment HUD, 2026-09-26:** keep pushing Bedrock away from a website.
The mine now runs behind overlaid stock counters, a stratum badge and compact
icon controls, not a branded header. Tools are an unboxed sprite rack. The
console uses actual-value segmented lamps, a pressure needle, an Overdrive
lever and a dedicated breach trigger; Pause is a full-screen game menu.
Keep every primary readout visible, native keyboard controls accessible and
induction targets below the HUD. No fake instrument activity or glossy UI.

**Cockpit correction, 2026-09-25:** the director approved the pixel art but
rejected the tiny stratum and scrolling drill sidebar. Bedrock now has a
close working camera, a fixed bottom cockpit with every drill meter/action,
and on-demand production details. `bedrock-hud.css` owns this run-only layout.
Do not put Hull, Pressure, feed progress, Overdrive or Descend behind scrolling.
Keep tutorial targets visible and Dig/Rotate reachable on narrow tool strips.
Read `docs/BEDROCK.md`; map dimensions, simulation, saves and other editions
remain unchanged. Browser checks cover notebook HUD bounds and all lessons.

**Pixel-art correction, 2026-09-25:** the director rejected shaded/bevelled
buttons, generic fonts and primitive vector illustrations. Bedrock now uses
generated pixel-style drill/GRIT bitmaps, authored palette-grid sprites,
Pixelify Sans, flat square controls and stamped contract permits. Read
`docs/BEDROCK.md` and `assets/bedrock/README.md` (asset provenance/prompts).
`js/pixels.js` owns the small sprites; `js/atelier.js` composes them and accepts
decoded portrait images. Do not bring back glossy gradients or rounded app
cards. Engraved, Classic, gameplay, lore and saves are unaffected.

**Arcade correction, 2026-09-25:** the director rejected Bedrock's institutional
website appearance. Think of a game executable hosted by a browser: full-screen
cavern title, chunky colorful HUD, bright minerals, tactile controls and honest
action feedback. Papers, Please informs the contract props and Company voice,
not every screen's layout or palette. No marketing-page design. The revised
direction and visual/feedback invariants are in `docs/BEDROCK.md`.

**New edition, 2026-09-25:** the director requested a completely non-ASCII
graphical version, specifically naming Papers, Please aesthetically. Read
`docs/BEDROCK.md`. `graphical.html` uses `js/atelier.js` (pure art composition) and
`js/graphical.js` (independent world renderer and document UI). This is a third
edition, not a replacement for Engraved or Classic. Add
`node test/graphical_test.js` and the isolated Chromium browser acceptance test
to verification. Never change simulation values to accommodate graphics.

The director requested a COMPLETE aesthetic overhaul, inspired by dense ASCII
portraiture and phosphor-terminal illustrations, not large Dwarf Fortress-like
symbols alone. Gameplay and lore are preserved; the old visual layout is not
sacred. Read `docs/AESTHETICS.md`. `js/engraving.js` is the fine-character art
layer; `V` switches back to Classic. `ascii-native` preserves the pre-overhaul
release and `node tools/build.js --classic` emits a separate classic artifact.
This supersedes old rules requiring every visible detail to occupy one logical
cell. Readability, offline operation, save safety and simulation RNG isolation
remain requirements. Add `node test/engraving_test.js` to the gauntlet.

**Extension, 2026-09-25:** the director explicitly permits non-ASCII rendering
for readability, especially the stratum and icons. `js/strata.js` is the hybrid
map/vector icon layer; it receives revealed visual descriptors, never the run
or its RNG. Classic omits both new visual modules. Keep small gameplay labels
and fault/cargo markers legible over the geometry.

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

## Commit attribution (director's instruction, 2026-09-09)

Do not add AI `Co-Authored-By` trailers or AI session-attribution footers to
commits. Preserve actual human authorship and human coauthor credits. This
overrides historical prompts. Enable the repo guard with
`git config core.hooksPath .githooks`; it rejects AI trailers before commit.
History rewrites require the user's explicit request and a verified backup.

## The vibe

Papers Please, Dwarf Fortress, Factorio, Candy Box, Balatro, Cookie Clicker —
steal the shape, never the content. GRIT complains but signs. The Company
accepts no liability. The Company accepts everything else.
