# vendor/ — the font subset

## Current: grid-aligned Braille shipped (2026-09-09)

Deepcore Mono now contains all 256 Braille masks. `tools/subset_font.py`
constructs original eight-dot outlines at the full-block glyph's exact
1233/2048 advance; no proportional font is transplanted. `tools/glyphs.js`
explicitly inventories this dynamically generated range. The subset is
9.8 KiB WOFF2 (about 1.2 KiB more than the previous checked-in face), embedded
in the existing stylesheet and offline bundle. Font licensing is unchanged;
the new dot outlines are part of DEEPCORE's code-generated artwork.

Build-time requirements remain fontTools and brotli; there is no new browser
or test dependency. The runtime metric probe and block fallback remain
mandatory. Browser review verified aligned Braille icons in schematic cards.
Regenerate with `node tools/font.js`.

Everything below records earlier decisions, superseded where noted above.

## Historical: M-HIRES Phase 2.5 (2026-08-12)

**Status: §3 below has now been done.** `deepcore-mono.woff2` is a subset of
DejaVu Sans Mono renamed "Deepcore Mono", carrying exactly the inventory
`node tools/glyphs.js` reports (204 codepoints — printable ASCII plus the 109
non-ASCII glyphs the game can draw). 8.3 KiB as WOFF2, 11.9 KiB once base64'd
into `deepcore-mono.css` as a data URI. Regenerate with `node tools/font.js`
after adding any glyph; that script subsets against the audit, so the two
cannot drift. It needs Python with fontTools + brotli, which are **build-time
only** — the generated files are committed, so the game, the five suites and
`tools/build.js` need none of it.

Three things worth knowing:

- **The advances are identical to the source face** (1233/2048 = 0.602 em for
  every glyph, verified after subsetting). That matters more than it sounds:
  `flush()` batches a whole run of cells into one `fillText` scaled by
  `cw / adv`, so a face whose advance differs from the fallback's shears the
  row on swap.
- **It loads asynchronously and `Render.init()` measures once.** `render.js`
  re-measures on `document.fonts.ready` *and* explicitly calls
  `document.fonts.load()`, because nothing in the DOM uses the face — the page
  paints through a canvas — so it might otherwise never become pending.
  `font-display: block`, because `swap` would paint a frame in the fallback
  and then reflow, which on a character grid is a visible shear of every row.
- **The system stack is still behind it.** If the webfont is blocked, the game
  runs on DejaVu Sans Mono / Menlo / Consolas exactly as before; the advance is
  measured from whatever is actually in use, so nothing shears either way.

`tools/glyphs.js` scans raw source text, so it also reports glyphs that appear
only in *comments* — `≫` (U+226B) is one, and it is genuinely absent from
DejaVu Sans Mono, which is why `sim.js` draws `»` instead and says so. Being
over-inclusive is the safe direction: a spare glyph costs bytes, a missing one
is a tofu box on screen. `tools/subset_font.py` prints anything it had to skip.

## Historical: Braille was NOT vendored (M-HIRES Phase 3, 2026-08-12)

The mechanism ships and works — `DC.Art.raster.braille()`, the runtime probe
in `render.js`, the block fallback, and `A.coreSphere(mode)` which builds the
victory sphere either way. A **second** vendored face for braille was
declined, on measurements:

| Face | braille glyphs | advance |
|---|---|---|
| DejaVu Sans Mono (the grid's face) | **0** | `█` is 1233/2048 = 0.602 em |
| DejaVu Sans (what braille falls through to) | 256 | 1500/2048 = **0.7324 em** |
| Noto Sans Symbols2 | 256 | 700/1000 = **0.70 em** |

No monospace face on hand has braille at all. Every available source is
proportional and ~21% too wide, so vendoring braille means taking glyphs from
a proportional font, scaling the outlines ~82%, forcing a mono advance, and
merging tables — surgery on a binary we cannot visually verify from here. The
return is a rim that steps in quarter-cells instead of half-cells, on one
screen, at the end of a winning run. Under §0 law 6 (readability is the
objective) and law 2 (chunky beats smooth), that does not earn a second font.

It is not dead code. The probe measures the *actual* stack, so on a machine
whose fallback supplies cell-width braille — Windows with Cascadia Mono, which
has the block and is monospaced — the sphere upgrades itself with no code
change. Everywhere else it draws blocks, which is the default, not a degraded
mode.

**Do not skip the probe if someone does vendor braille later.** Browsers block
webfonts and users override fonts; `flush()` batches a run of cells into one
`fillText` scaled by `cw / adv`, so one proportional braille glyph slides every
character after it out of its cell. The failure mode is a corrupted row, not a
missing dot. `test/integration.js` SECTION 13 holds that line.

---

# vendor/ — deliberately empty (M-MANUAL, 2026-08-11)

SPEC3 rule 7 permits vendored dependencies "when they demonstrably improve the
player's experience", and names one sanctioned candidate: an embedded
CP437/VGA monospace font as a data-URI `@font-face`, applied game-wide, on the
theory that it buys authentic terminal texture *and* guaranteed glyph coverage
(killing the CX-08 class of bug — `≫` missing from DejaVu Sans Mono).

M-MANUAL evaluated it and **declined**. The reasoning, so nobody has to redo
it:

## 1. A CP437 font would REMOVE coverage, not guarantee it

`node tools/glyphs.js` audits every non-ASCII character the game can draw
against the real CP437 repertoire (including the graphical `0x00-0x1F` range —
`♦ ☼ ► ▬ ↑ ▲` — which a naive codec check misses). At the time of writing:

    87 non-ASCII glyphs used · 21 outside CP437

and the 21 are not decoration:

    ¤ ‡ ▶ ◈ ▪ ◆ ◇ ◎ ▣ ▸ ◀ † × − — ’ … ˙ ↵ ≋ ≫

`¤` is the drill gear, `‡` the core charge, `▶` the belt (U+25B6 — CP437 has
`►` U+25BA, a different codepoint), `◈` the cores currency, `▪` the rig's
portholes. Adopting the sanctioned font would tofu the game's own item legend
— the exact opposite of the bug it was meant to close. Re-run
`node tools/glyphs.js` after adding any glyph; the number only grows.

## 2. The manual's problem was never the typeface

The brief was contrast and legibility. That was won with hierarchy — colour
tiers, inverse keycaps, hairline rules, a two-column band with real gutters,
true item colours inline — all of which are characters on the existing grid.
Rule 7 also says *prefer the zero-dep solution when it is equally good*; here
it was better, not merely equal.

## 3. What WOULD be worth vendoring, if someone wants this later

Not a code-page font: a **subset of a full-Unicode monospace** (DejaVu Sans
Mono is already first in the render font stack, and its license permits
redistribution of renamed derivatives). Subset to the inventory
`tools/glyphs.js` prints, rename the family, emit WOFF2 as a data-URI, and
teach `tools/build.js` to inline the stylesheet. The win is cross-machine
consistency — a player whose browser falls back to Courier New today gets a
broken-looking grid. The costs to plan for: the webfont loads asynchronously
while `Render.init()` measures the glyph advance once at startup (it would
need a re-measure on `document.fonts.ready`), and it is a game-wide visual
change, so it wants its own dispatch rather than a rider on a UI brief.
