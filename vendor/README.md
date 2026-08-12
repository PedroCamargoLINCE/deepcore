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
