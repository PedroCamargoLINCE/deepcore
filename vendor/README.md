# vendor/ — the font subset (M-HIRES Phase 2.5, 2026-08-12)

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
