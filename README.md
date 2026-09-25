# DEEPCORE

```
    ▄▄▄  ▄▄▄ ▄▄▄ ▄▄▄  ▄▄▄ ▄▄▄  ▄▄▄  ▄▄▄
    █  █ █   █   █  █ █   █  █ █  █ █
    █  █ █▄▄ █▄▄ █▄▄▀ █   █  █ █▄▄▀ █▄▄
    █▄▄▀ █▄▄ █▄▄ █    █▄▄ █▄▄█ █  █ █▄▄
          a  t e r m i n a l  d e s c e n t
```

An incremental automation roguelike. You command a drilling rig burrowing toward
the planet's core. In each stratum, build a small automated factory — extractors
on ore veins, belts, smelters, assemblers — and feed the drill the gears and
charges it needs to breach the floor. The stratum grows unstable the longer you
stay: quakes, rubble, magma. This is not a game about surviving. Get through.

## Play

**New: Bedrock, the fully graphical edition.** Open [graphical.html](graphical.html)
for a pixel-art mining world: an illustrated drill and GRIT, distinct material
and machine sprites, a playful pixel font, flat controls and action-driven
impact effects. A close working camera makes the stratum readable; a fixed
cockpit keeps drill meters and actions visible without scrolling. Production
details open on demand. Stamped work permits retain their Papers, Please flavor.
No ASCII art or terminal
renderer. Same gameplay, lore and progression. Mouse wheel zooms; right-drag
pans; **Rig** restores working scale, **Overview** fits the floor, and the corner
control toggles fullscreen. Build with `node tools/build.js --graphical`
to create `dist/deepcore-graphical.html`. See [the edition notes](docs/BEDROCK.md).

Open `index.html` in any modern browser (double-click works — no server, no
build step). Or the single-file build: `dist/deepcore.html`.

The default is **Engraved**, a hybrid illustrated edition: high-definition ASCII
portraits and encounters, graphical strata, and distinct vector resource/machine
icons. The inspector shows the machine you're hovering over or about to build;
its working parts follow actual production, not an idle timer. Press `V` at any time
to switch between Engraved and Classic; gameplay and your save are unchanged.
`?art=classic` opens the classic view directly. Build a standalone classic port
with `node tools/build.js --classic` (`dist/deepcore-classic.html`). The original
1.2 presentation is also preserved on the `ascii-native` branch.

Use **Progress / backup** on the title screen to export/import permanent
progress between offline files. Web-hosted editions on the same origin share
their save; browsers may keep separately opened local HTML files isolated.
Imports require confirmation and retain a recoverable copy of the old profile.
Active runs are not saved in the profile file.

- A run to the Core takes roughly 15–25 minutes. Death is permanent; progress
  isn't — cores banked from every run buy permanent Foundry upgrades.
- After victory, the Mantle continues downward forever, for longer runs.
  Cold Seam has no coal veins: smelt beside magma and craft coal-free charges
  from crystal and copper plates. Normal floors still require coal for charges.
- Press `H` in game for the full manual.

## Controls

The mouse is optional: every action has a keyboard route through the map cursor.

**In a run**

| Key | |
|---|---|
| `1`–`5` | select building (belt, extractor, smelter, assembler, damper) |
| click / drag | place — drag belts to lay runs, corners turn automatically |
| `↑` `↓` `←` `→` | move the map cursor (hold `Shift` to jump 5 tiles) |
| `Enter` | at the cursor: place / interact / repair — with no tool selected, it's a click |
| `Enter` (belt tool) | arm lay-mode: moving the cursor lays belts and turns corners; `Enter`, `Esc` or switching tools disarms |
| `R` | rotate facing (output side of the next machine) |
| `X` | demolish / excavate rock |
| `C` | overdrive the drill (faster breach, faster instability) |
| `V` | switch Engraved / Classic visuals, without restarting |
| `D` | descend when the breach is ready |
| `Space` | pause |
| `Esc` | disarm lay-mode → cancel tool → pause menu |
| `H` | manual |
| `M` | mute / unmute the rig (any screen; remembered) |

Clicking (or `Enter` with no tool) a damaged machine repairs it, an assembler
switches recipe, the rig toggles overdrive.

**Everywhere else**

| Key | |
|---|---|
| `Enter` | title: start a run · schematic/foundry/help/end screens: continue or back |
| `F` | title: the Foundry |
| `H` | title or pause menu: manual |
| `1`–`4` | descent screen: take that schematic |
| `A`–`I` | Foundry: forge that upgrade |
| `L` | Foundry: the logbook — what the dead foremen wrote down |
| `T` | Foundry: the trophy shelf — ←/→ to let GRIT inspect one |
| `K` | Foundry: the Company Ledger — your lifetime, as the form they file it on |
| `S` | Foundry: cycle the rig's livery (chrome only; the map never recolours) |
| `A` | pause menu: abandon the run (banks your cores) |
| `C` | victory screen: continue into the Mantle |
| `Esc` | back / resume |

## The chain

```
≡ ore ──▶ [E]xtractor ──▶ ▶▶▶ belts ──▶ [S]melter ──▶ ▬ plates
plates ──▶ [A]ssembler ──▶ ¤ gears / ‡ charges ──▶ ╔═╗ the drill
                                                   ║D║  breach %  ──▶ DOWN
                                                   ╚═╝
```

Plates are also your build currency — everything your belts deliver to the rig
can be spent or drilled. The factory *is* the timer.

The first-run induction now teaches the whole chain, including coal, smelting,
gears and delivery. GRIT notices steps you already completed; `Tab` skips the
induction, and `I` on the title replays it.

Experiment: extractors cost 4 plates, smelters 5, assemblers 6, and dampers
6 iron + 2 copper plates. `X` refunds a fresh, undamaged machine in full for
10 seconds; afterwards the usual salvage rules apply. Belts refund in full.
Before descending, bank about **25 iron plates** for the next factory:
machines stay on the floor you leave, while your stock travels with you.

The drill consumes **gears, then core charges** when available. `C` overdrive
doubles its feeding rate and raises instability faster; it does not create
fuel or speed up your factory. With no drill stock, overdrive buys no progress.

Eight biome palettes, state-driven rig animation and multi-cell, two-tone
icons keep the terminal look. The embedded font includes cell-aligned Braille
dots for finer art, with a block fallback. No browser dependency download is
needed, including in the single-file build.

## Development

Specs, in reading order:

- `SPEC.md` — full design & module contracts (the source of truth for systems)
- `SPEC2.md` — the juice layer (GRIT, rig portrait, schematic cards, events)
- `SPEC3.md` — creative addendum + the dispatch briefs still on the board
- `docs/DISPATCH.md` — how briefs are handed out (file ownership per worker)
- `docs/ROADMAP.md` — superseded by SPEC3; kept as a map of the old module ids

Everything runs on plain `node` — no test runner, no install:

- `node test/headless.js` — headless sim: mapgen, machines, belts, hazards
- `node test/integration.js` — engine + sim end-to-end, bot policies, screens,
  and a stub-canvas frame advance proving every SPEC3 §A animation row fires
- `node test/barks_test.js` — GRIT's line corpus, voice lint, field-manual
  consistency against `data.js`
- `node test/rig_test.js` — rig portrait composition (art.js overlays)
- `node test/balance.js` — multi-seed balance sweep against the SPEC §12 targets
  (read its footer: it measures a scripted bot on a naked rig by default, and
  says which target is checked under which Foundry loadout)
- `node tools/ab.js '<js mutating D>'` — run that sweep against a tuning without
  editing `data.js`, e.g. `node tools/ab.js 'D.RECIPES.gear.ticks = 18'`
- `node tools/build.js` — bundle into `dist/deepcore.html`

Current implementation decisions, measured balance and test coverage:
[`docs/RELEASE.md`](docs/RELEASE.md). The sweep's card picker now evaluates all
25 schematics against the run; `DC_BAL_PICK=legacy DC_BAL_PACE=legacy` restores
the old policy for controlled comparisons. Automated runs cannot certify fun.

Commits must not contain AI attribution trailers. After cloning, enable the
guard with `git config core.hooksPath .githooks`; human coauthor credits remain
welcome. Test it with `node test/attribution_test.js`.

`js/data.js` is the balance source of truth; the in-game field manual composes
its numbers from it at load, so tuning a constant retunes the manual too.

`js/events.js` (`DC.Events`) is the roguelike texture layer: what the rock has
in it (8% of excavations pay out), the twenty Dead Foremen whose logs you
collect across runs into the Foundry's `[L]ogbook`, the twenty two-choice
expedition vignettes that open a quarter of descents, and the cave-cat. It
rolls on a stream derived from `run.seed` rather than on `run.rng`, so a find
can never move the quake schedule — same seed and same play, same finds.

`js/fx.js` (`DC.FX`) is the animation layer: a render-side frame clock, a small
particle list, and the per-tile choreography of SPEC3 §A. It makes no sim edits
and reads no randomness from `run.rng` — everything it shows is derived from
state the sim already keeps, so what you see can never change what happens.

Plain JS on one canvas, characters only — the ASCII is the identity and it
stays. Dependencies are welcome when they genuinely sharpen the experience
(vendored into the repo and inlined by the bundler, so the single file keeps
working offline) — see SPEC3, rules of engagement #7.
