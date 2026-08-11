# DEEPCORE — Roadmap / dispatchable modules

v1.0 ships complete: full run loop, 8 strata + endless Mantle, 5 buildings,
14 schematics, 9 Foundry upgrades, quake/magma/instability pressure, ASCII art
set, meta save. The modules below are **out of scope for v1** — each section is a
self-contained brief that a dedicated session can implement against `SPEC.md`
without touching the core sim contracts.

---

## M1 — Sound engine (WebAudio, no assets)

**Goal:** procedural audio, zero files. A `js/audio.js` module registering
`DC.Audio` with `init()` (on first user gesture), `play(name)`, `setMuted(bool)`,
and an `M` key binding in engine.js.

All sounds synthesized with WebAudio oscillators/noise buffers, in a muffled
industrial register (low sine thuds, filtered brown noise, metallic FM pings):

- `place` / `demolish` — soft clunk / crumble
- `craftDone` — faint press ping (throttle: max 4/s globally)
- `quake` — low rumble swell 1.5 s + integrity hit thump
- `breach` — rising drone → punch-through boom (descent animation sync)
- `drillLoop` — continuous low churn whose volume tracks feed rate; overdrive
  raises pitch a third
- `collapse` — alarm klaxon while instability ≥ 99
- title drone — two detuned saws through a lowpass, barely audible

Constraints: master gain −12 dB default, everything through one compressor,
`DC.Audio` fully optional (game must run identically with the file absent —
engine guards every call). Persist mute in the meta save.

## M2 — Content pack: logistics tier 2

**Goal:** widen the mid-game build space without new core mechanics.

- **Splitter** (1×1, cost 4 iP): input from behind, alternates output left/right.
- **Underground belt** (pair, cost 3 iP each): enters ground, exits at matching
  tile ≤ 4 away in facing dir; items skip the gap (lets lines cross chasms).
- **Loader** (1×1, cost 6 iP + 2 cP): pulls from an adjacent machine's output
  even when its front is blocked — unjams tricky layouts.
- **Crusher** (2×2, cost 10 iP): 1 rubble-adjacent placement gimmick — converts
  rubble tiles in a 1-tile radius into 2 ironOre each (quakes become a resource).
- 4 new schematics keyed to these buildings.

Sim changes are additive (new building types + belt-move cases). Render: new
glyphs. Balance: these unlock from stratum 3 (add an `unlockDepth` field to
BUILDINGS and a check in canPlace + build list rendering).

## M3 — Expedition events

**Goal:** roguelike texture between strata. After each schematic pick, 25%
chance of a one-screen ASCII vignette event (`DC.Art.events[...]`, ~20 of them)
with a 2-choice decision (e.g. *"A sealed pre-collapse vault. [1] Breach it
(+30 plates, +15 instability) [2] Leave it"*). Effects limited to: inv deltas,
integrity/instability deltas, one-off mods (next stratum only). New module
`js/events.js` (`DC.Events.roll(run) -> event|null`, `apply(run, event, choice)`),
a `descend-event` screen in render/engine.

## M4 — Daily seed & run recap

**Goal:** replay hooks. Title menu gains `[T] TODAY'S SHAFT` — seed derived from
the UTC date, banked cores disabled (pure run), end screen shows a shareable
ASCII recap card (depth, time, breach graph per stratum as a bar chart, schematic
list) that `navigator.clipboard`-copies as text. Local best-per-day table in the
meta save.

## M5 — Balance instrumentation

**Goal:** tuning without guesswork. Extend `test/balance.js` into a Monte-Carlo
harness: N seeded bot runs across policy variants (greedy expander / minimal
rusher / damper turtle), CSV output of per-stratum breach times, death causes,
integrity curves; a small report generator. Use it to retune `data.js` toward
the §12 targets after any content change.
