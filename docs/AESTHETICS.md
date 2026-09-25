# DEEPCORE 1.4 — Engraved

## Separate graphical edition — Bedrock

The director subsequently requested a fully graphical edition with **no ASCII**
commitment, and emphasized Papers, Please as an aesthetic reference. This now
lives in `graphical.html`, independently of the two editions documented below.
Subsequent feedback rejected an institutional/website look: Bedrock now uses
a colorful pixel-art game and full-screen cavern presentation. Bedrock's later
pixel-art correction replaces shaded controls and primitive vector icons with
flat controls, Pixelify Sans, palette-grid sprites and generated drill/GRIT
illustrations. Paper is an
in-world prop, not the overall interface. The browser is the game's host.
Read `docs/BEDROCK.md` for its art direction, architecture, controls, save
transfer and verification. Engraved and Classic remain available and unchanged
as visual editions; the frozen `ascii-native` branch is not rewritten.

## Readability follow-up — coal versus iron

Human feedback caught a real weakness: coal reused the metallic ore silhouette,
with only a tint and highlight separating it from iron. Coal now has three
matte, fractured lumps with readable rims; iron is one broad, silver-banded
slab, and copper is a pair of broken angular nuggets. This shared icon artwork
appears in stock and manual views. Map deposits use ragged carbon seams versus
parallel iron bands, while retaining their established resource glyphs.

Engraved belt cargo now carries the corresponding ore glyph (iron `≡`, coal
`♠`, copper `¢`) instead of collapsing all three to `•`. Existing jam dimming,
production flashes, tooltips and routing remain intact. Classic keeps its
original glyphs and palette. New tests compare colour-free icon silhouettes
at three resolutions and verify actual belt glyphs in both editions.

## Extension — 2026-09-25

The director asked to carry Engraved through every remaining screen, then
explicitly released the ASCII-only restriction for readability, naming the
stratum and icons. The result is a hybrid edition, not a different game.

- `js/strata.js` paints faceted, biome-coloured rock, glass cleavage, magma,
  ore deposits, belt rails and connected machine chassis. Plain floor dots
  give way to quieter ground; sparse biome flora remains. Resource glyphs,
  machine anchor letters, cargo, warnings, cursors, placement ghosts, wildlife
  and landmarks retain their existing meanings and positions.
- A shared vector icon family covers all eight resources, ten build tools,
  nine Foundry upgrades and the demolish symbol. Build/stock/Foundry rows and
  manual illustrations use the same palette and physical silhouettes. Keys,
  names, prices and quantities are never replaced with unexplained pictures.
- The rig panel becomes a detailed machine cutaway on hover or build selection.
  Ten authored machine subjects; working poses read `status` and `progress`.
  A build preview never pretends to be producing. Induction keeps GRIT, and
  the rig shows sparks only during the existing post-quake shake signal.
- Contracts have engraved seals, locked/concluded variants and room for the
  unchanged terms and signature controls. The Foundry has an illustrated anvil
  reacting to purchases. Sixteen trophy objects replace the old miniatures,
  with a larger inspection specimen and unearned objects kept under dust.
- The ledger has an abacus and audit seal; the archive's tabs reflect actual
  recovered logs. All manual pages gain machinery and resource illustrations
  in their margins, outside the unchanged text. The recap gains a bore section
  and GRIT's portrait; the pause panel gains a mechanical pause badge.

The graphic layer receives only revealed tile descriptors, never a run object.
It cannot inspect hidden ore, use RNG, change a map, or predict a quake. The
original grid still owns all hit testing. The expanded contract cards publish
their actual click rectangles; a real mouse-route test signs one of them.
Opaque modal backgrounds cover map art; the pause badge alone is composited
above its own panel. Icons sit in reserved gutters, not on prose.

Both the illustration cache and the single terrain surface are capped at
12 million pixels each; offscreen DPR is capped at 2. Stable frames reuse the
surfaces. `--classic` omits both `engraving.js` and `strata.js`; V switches all
new art and geometry off together. No dependency or save migration was added.

Verification adds 87 illustration configurations, distinct machine subjects,
vector icon coverage and finite geometry, fog-of-war isolation, render-only
state/RNG checks, Classic/module-free equivalence on all newly treated screens
(apart from the manual's existing V capability hint),
actual contract clicks, and cache budgets through 8000x4500 / DPR 2. Real
Chromium review covers the new screens and a populated stratum at 1600x1000
and 960x700 / DPR 2. The canonical balance outcome rows are compared with a
fresh pre-extension sweep; the renderer is not a balance change.

## Original 1.3 direction and implementation

## The director's brief

The 1.2 game is fun and beautiful, but not the envisioned visual style. The
references distinguish illustrated ASCII from a grid of large game symbols:
one is luminous, outlined phosphor-terminal portraiture; the other constructs
a detailed face from dense character shading. The director explicitly permits
a complete aesthetic overhaul, including non-character techniques if useful.
Gameplay, progression, lore and the existing human-balance work must stay.

Chosen direction: an illustrated industrial instrument. Warm engraved metal,
sea-glass intercom ink, dense halftones, physical machinery, geology in section,
and a restrained recessed terminal face. Functional text stays large and sharp.
No full-screen blur, barrel distortion, colour fringing or moving scanlines.

## What is implemented

- An independent fine-character lattice, normally 3 times the UI's linear
  resolution (9 times its character count), with a coarser 2x tier on small
  viewports. It does not enlarge or resample the old 24x12 rig drawing.
- Original shaded GRIT portrait: hard hat, lamp, goggles, scar, moustache,
  work coat. Visible on the title and tutorial intercom. Speech responds to
  the existing bark state; the tutorial's alarm mood changes the expression.
- A newly drawn rig with tapered cross-braced derrick, ladder, sheave, glazed
  cab, ventilated service shed, tracks, rotary table, drill pipe and faceted
  cutting head. Every Foundry upgrade changes the picture; the recovered cat
  appears on the title rig. Feed drives bit/exhaust poses, never an idle timer.
- Sedimentary rock microtextures, different glass-cleavage patterns for
  obsidian, and machinery-body details. Ore, machine anchor letters, faults,
  cargo and directional cues retain their semantic glyphs and colours.
- New high-definition schematic illustrations for all 25 cards, maintaining
  their established subject matter and thematic colours.
- Twenty separately authored encounter illustrations, grounded in their
  existing prose: welded vault, fissure, inspector drone, pool, floating lamp,
  shipping crate, rations, ladder, Voss's door, tally marks, ore seam, claims
  terminal, submerged gear, Rig IX, coin, crossing, suited body, gear shrine,
  warm draught and the offer. Choices, consequences and writing are unchanged.
- Close-up descent cutting head and stratified rock, a shaded Core with an
  opening fracture, and an engraved wreck on the loss screen.
- A new title composition showing both GRIT and the rig, plus restrained
  instrument-bezel styling with lighter scanlines for the finer characters.

This is a presentation overhaul, not a gameplay redesign. The logical map,
keyboard routes, layout of actionable controls, tutorial progression, manuals,
contracts, lore, rewards, saves and balance remain intact. Small symbols stay
small where they serve as controls or identifiers rather than illustrations.

## Two editions

`master` defaults to Engraved. `V` toggles the view immediately, with no restart
or simulation effect. Preference lives separately in `deepcore_visual_v1`,
never inside the progression save. Blocked storage is safe; URL `?art=classic`
overrides the preference. Held V does not repeatedly flash the view, and
Ctrl/Command-V is not captured as a visual switch.

`ascii-native` points to `e30d1a8`, the exact published, playable pre-overhaul
release including the charge-progression fixes. It was pushed before any art
changes. Its existence is not just a claim in a handoff document.

```
node tools/build.js            # dist/deepcore.html — Engraved + live V switch
node tools/build.js --classic  # dist/deepcore-classic.html — no engraving module
```

Both artifacts work offline via `file://`; no new runtime dependency, fetch,
remote asset or image-generation service is needed. The original art is code-
native geometry sampled into printable ASCII and a 48-ink tonal palette.
Intermediate canvases cache those glyphs; they are not downloaded sprite sheets.

## Engineering and verification

`js/engraving.js` is pure and DOM-free. It returns character rows plus ink
indices; the renderer handles browser measurement and compositing. Input uses
the unchanged logical grid. Modal backgrounds and gameplay glyphs are painted
over the illustration layer, so art cannot cover a pause menu or tutorial.
No renderer or illustration call draws from the simulation RNG.

Steady illustrations reuse cached canvases. The cache is bounded by 28 entries
and 12 million pixels, with cached-art DPR capped at 2. Terrain has one cached
surface rather than an accumulating tile history. Mechanical phases are finite
state reads, and resizing / livery changes are included in cache keys.

Run the five original gauntlet suites, attribution tests, and:

```
node test/engraving_test.js
```

The new suite checks 50 illustration configurations, ASCII-only output, all
nine upgrade silhouettes at six art resolutions, twenty unique encounters,
speech/drill poses, actual canvas compositing, stable-frame caching, the real
V handler, Classic fallback,
unchanged simulation/profile state and RNG, hit testing, multiple viewports and
DPRs, including an oversized-display cache-budget check. Browser review also
covers the title, induction, factory view, Foundry, cards, encounter art and
the Core.

Both canonical 14-seed/two-policy sweeps (naked and historical upgraded loadout)
have byte-identical outcome rows to the pre-overhaul `e30d1a8` release. The
visual edition does not retune difficulty or change the known bot-layout limit.

The local Chromium check at 1600x913 averaged 2.66 ms per cached run-screen
render across 200 calls (paused, revealed map). This is a local renderer timing,
not an FPS promise for all devices or a simulation-performance measurement.
