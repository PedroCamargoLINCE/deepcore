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
build, no dependencies). Or the single-file build: `dist/deepcore.html`.

- A run to the Core takes roughly 15–25 minutes. Death is permanent; progress
  isn't — cores banked from every run buy permanent Foundry upgrades.
- After victory, the Mantle continues downward forever, for longer runs.
- Press `H` in game for the full manual.

## Controls

| Key | |
|---|---|
| `1–5` | select building (belt, extractor, smelter, assembler, damper) |
| click / drag | place — drag belts to lay runs, corners turn automatically |
| `R` | rotate facing |
| `X` | demolish / excavate rock |
| `C` | overdrive the drill (faster breach, faster instability) |
| `D` | descend when the breach is ready |
| `Esc` | cancel tool / pause menu |
| `H` | manual |

Click a damaged machine to repair it, an assembler to switch recipe, the rig to
toggle overdrive.

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

- `SPEC.md` — full design & module contracts (`SPEC2.md` juice layer,
  `SPEC3.md` creative addendum + dispatch briefs)
- `node test/headless.js` — headless sim test (no browser)
- `node tools/build.js` — bundle into `dist/deepcore.html`
- `docs/ROADMAP.md` — dispatchable follow-up modules (sound, tier-2 logistics,
  events, daily seed)

No dependencies. Plain JS, one canvas, characters only.
