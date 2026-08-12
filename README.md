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

Open `index.html` in any modern browser (double-click works — no server, no
build step). Or the single-file build: `dist/deepcore.html`.

- A run to the Core takes roughly 15–25 minutes. Death is permanent; progress
  isn't — cores banked from every run buy permanent Foundry upgrades.
- After victory, the Mantle continues downward forever, for longer runs.
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
| `D` | descend when the breach is ready |
| `Space` | pause |
| `Esc` | disarm lay-mode → cancel tool → pause menu |
| `H` | manual |

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

`js/data.js` is the balance source of truth; the in-game field manual composes
its numbers from it at load, so tuning a constant retunes the manual too.

`js/fx.js` (`DC.FX`) is the animation layer: a render-side frame clock, a small
particle list, and the per-tile choreography of SPEC3 §A. It makes no sim edits
and reads no randomness from `run.rng` — everything it shows is derived from
state the sim already keeps, so what you see can never change what happens.

Plain JS on one canvas, characters only — the ASCII is the identity and it
stays. Dependencies are welcome when they genuinely sharpen the experience
(vendored into the repo and inlined by the bundler, so the single file keeps
working offline) — see SPEC3, rules of engagement #7.
