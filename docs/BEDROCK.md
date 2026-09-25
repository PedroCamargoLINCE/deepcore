# Bedrock — the fully graphical edition

The director's September 25 brief: build a genuinely different graphical game
presentation, with no ASCII obligation, while keeping the existing game. The
first pass leaned too far into **Papers, Please**'s institutional palette. The
director's correction is authoritative: **a colorful arcade game executed in a
browser, not a website**. The Company is fictional flavor, not the UI template.

## Play

Open `graphical.html`, or build a portable offline copy:

```
node tools/build.js --graphical
# dist/deepcore-graphical.html
```

`index.html` remains Engraved, with its live Classic switch. Its title now links
to the graphical edition. The `ascii-native` branch remains untouched.

## Visual direction

An illustrated pixel-art mining game: charcoal hardware, dusty teal steel,
amber controls, rust-red furnaces and violet crystals. The director's next
correction rejected bevelled buttons, bland fonts and primitive vector icons.
The title now pairs a Pixelify Sans wordmark with a generated drilling crawler;
GRIT has a separate expressive pixel-style portrait. Flat square controls,
high-contrast meters and clear selected states replace gradients and bevels.
All labels stay native text, not words baked into an image.

Thirty original palette-grid sprites cover the eight resources, all ten build
tools, the map rig, GRIT fallback, three permit emblems and seven equipment
objects. These are authored pixel clusters, not ASCII displayed on screen.
Rare icons retain their original geometry, sampled by a discrete pixel pen;
the twenty encounter compositions remain distinct, now on low-resolution
scene surfaces. Not every illustration is a newly generated bitmap.

Papers, Please still informs contract props and the bureaucratic voice;
Factorio informs the readable production line; Balatro informs concrete,
colorful upgrade picks. The graphical Dwarf Fortress release informs the
separation of an illustrated world from its unchanged simulation. Artwork is
original, not copied assets from those games.

Visual hierarchy is deliberate: the stratum is the largest surface; the rig's
condition and breach progress remain primary; a persistent stock strip answers
what you own; the toolbelt answers what you can build. Detail is grouped into
Chain, Loadout and Journal tabs. The tutorial lives on the desk and highlights
its actual map targets without covering them.

Terrain uses square tiles, connected wall edges, distinct materials for eight
biomes, physical ore silhouettes, rail-like belts, and machine sprites with
visible output ports. Coal is a fractured cluster, iron a banded metallic slab,
copper separate angular nuggets, and crystal a tall translucent cluster.
Items on belts use the same visual vocabulary as stock and recipes.

Menus are also graphical: a detailed rig on the title and Foundry screens,
stamped work permits on a green desk, illustrated schematic cards, twenty individual
encounter tableaux, trophy objects, a typeset ledger, recovered documents,
illustrated manuals, and graphical end-of-run reports. No character-grid art,
CRT overlay, or glyph-rendered terrain is used by this edition.

## Architecture and controls

- `js/pixels.js`: pure palette-grid sprite definitions and a discrete pen for
  remaining geometric subjects. Machine poses read production state.
- `js/atelier.js`: pure composition, shared between Canvas and crisp-edge SVG
  pixel icons. The large rig receives a decoded bitmap as an explicit input;
  a separately authored map sprite is also the loading fallback. All nine
  Foundry upgrades alter both rigs; livery changes the large rig's trim.
- `assets/bedrock/`: generated RGBA drill and GRIT illustrations, with final
  prompts and provenance in its README. Generated with the built-in image
  tool, not manually painted pixel-by-pixel. The small sprites are code-authored.
- `js/graphical.js`: independent Canvas world renderer plus semantic HTML UI.
  It never invokes the Classic/Engraved rendering pipeline. No dependency or
  network service is required. The source page loads local PNG/font assets;
  its standalone build embeds them. `art.js` remains loaded for shared tutorial/manual
  metadata and the engine's existing descent-duration contract; its ASCII
  illustrations are never rendered.
- `Engine.command(key)`: graphical buttons enter the same route as keyboard
  commands. The existing simulation, gates, tutorial, awards and input actions
  remain authoritative. Canvas hits map back to the unchanged logical tiles.
- The corner fullscreen control enters/exits browser fullscreen through a real
  user gesture. It is only offered where the host exposes the capability.
- Mouse wheel zooms; right/middle drag pans; Fit restores the full stratum.
  Keyboard movement brings the cursor into view when zoomed. Original gameplay
  keys remain valid. Native buttons retain focus and keyboard activation.
- The interface adapts to narrower windows; the map can be magnified instead of
  shrinking important controls. Short/narrow displays scroll the operations
  desk and toolbelt. Selecting an offscreen tool by keyboard brings it into
  view. Long prices wrap inside their controls. This remains a desktop-first
  factory game.

## Save safety

The save key and schema are unchanged. Pages served from the same web origin
share their profile. Browsers may isolate different `file://` paths, so every
edition offers a title-screen **Progress / backup** panel. Export a JSON file,
then import it in the other edition. Imported progress is reviewed before
replacement, sanitized through the existing save migration, and the previous
profile is retained under `deepcore_profile_backup_v1` for export/recovery.
Malformed and future-version files are rejected. An import is refused if the
backup cannot be stored. This transfers permanent progress, not an active run.

No gameplay values, recipe costs, map dimensions, progression gates or encounter
consequences are changed. Rendering does not advance `run.rng`, including the
ending's GRIT lines (selected through an isolated seed-derived proxy).

## Rendering invariants

- Unknown cells are redacted before terrain reaches the art engine. Multi-tile
  objects and wildlife are clipped to revealed ground.
- Production poses follow machine status/progress and drill feed. Pausing
  freezes these states. Reduced-motion preference disables shake and cycling
  poses. There are no quake countdowns or vein-depletion counters.
- Build/belt placement, cleared rock/rubble and drill-feed changes produce
  short view-local impact rings/debris; inventory increases light their HUD
  counters. No idle frame invents activity. Snapshots never read hidden terrain;
  effects are capped at 48, expire after six simulation ticks, freeze on pause,
  reset on a new run/floor, and particles are suppressed by reduced motion.
- State views do not mutate the simulation or the profile. Only the existing
  view-owned `ui.descendAnim` advances during the descent interstitial.
- Stable frames reuse terrain and sprite surfaces. The terrain and sprite cache
  have independent 12-million-pixel budgets, sprites are capped at 180 entries,
  and DPR is capped at 2 (lowered further for oversized surfaces).
- Terrain is composed at an integer source tile pitch and scaled as one image,
  avoiding the hairline grid seams introduced by fractional tile coordinates.
- Sprites cache at their native pixel pitch, independent of display size.
  Scene surfaces are capped at 480 pixels wide and scale with nearest-neighbour
  sampling. Image decoding and UI markup never spend simulation RNG. GRIT's
  embedded PNG is bound only when the DOM changes, not copied into each
  per-frame HTML comparison.
- Pixelify Sans is a local, OFL-licensed variable font. The bundle includes its
  complete license; no installed system font or CDN is required.
- The three offline bundles do not load one another's renderer. The vendored
  terminal-font audit follows `index.html`; Bedrock's proportional text does not
  accidentally expand Classic's glyph inventory.

## Verification

Run the five original suites, `test/engraving_test.js`, attribution tests, and:

```
node test/graphical_test.js
node test/graphical_browser.js
```

The browser test expects an **isolated** Chromium profile with remote debugging
on port 9344 (`DC_BROWSER_PORT` overrides it). It modifies only that disposable
profile, exercises real inputs, and writes review screenshots to
`/tmp/deepcore-bedrock-*.png`. Never point it at a personal browser session.

Coverage includes original sprite palettes, RGBA portrait sources, embedded
font/image assets, flat button styles, all machine/resource subjects, twenty
distinct encounter scenes, eight biome palettes, all nine rig upgrades, state
and RNG purity, fog redaction, save migration, all game screens, real building
and belt dragging, breach through the Core into the Mantle, camera controls,
native fullscreen, tick-driven effects and reduced motion, profile import/backup, offline bundles,
small screens and oversized-display cache budgets. Compare the canonical
14-seed/two-policy balance outcome rows against the pre-change baseline.

Verified September 25: all original suites, Engraved, attribution, graphical
unit tests and browser acceptance pass. All 28 canonical balance outcome rows
are byte-identical to the pre-change baseline. The three offline editions build
independently; the graphical bundle also passes a real `file://` browser load.
The arcade revision repeats this gate, including fresh-profile induction,
real fullscreen entry/exit, placement feedback, tick-based expiration, pause
freeze and reduced-motion suppression. Screens were visually reviewed at
desktop, smaller-window and phone sizes.

The pixel-art revision repeats this gate, including both bitmap and sprite
upgrade variants, decoded local/embedded portraits, loaded Pixelify Sans,
contract wrapping and keyboard-selected tools on narrow displays. All 28
canonical outcome rows match the pre-pixel baseline. Evidence:
`/tmp/deepcore-pixel-before-balance.txt` and
`/tmp/deepcore-pixel-after-balance.txt`.
