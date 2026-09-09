#!/usr/bin/env python3
"""DEEPCORE font subsetter (M-HIRES Phase 2.5).

Subsets a full-Unicode monospace face down to exactly the glyph inventory
`tools/glyphs.js` reports, renames the family (the Bitstream Vera license
permits modification only under a name containing neither "Bitstream" nor
"Vera"), and writes WOFF2.

Driven by tools/font.js -- run that, not this. Requires fontTools and brotli,
which are BUILD-time only: the generated .woff2 and its stylesheet are
vendored into the repo, so nothing in the game, the tests or tools/build.js
depends on Python.

    python3 tools/subset_font.py <src.ttf> <codepoints.txt> <out.woff2> <family>
"""
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen


def main(src, cps_path, out, family):
    with open(cps_path, encoding='utf-8') as fh:
        cps = [int(line, 16) for line in fh if line.strip()]

    options = subset.Options()
    options.flavor = 'woff2'
    # A character grid needs outlines and metrics, nothing else: no shaping,
    # no kerning (it is monospace), no hinting tables we would never consult.
    options.layout_features = []
    options.hinting = False
    options.desubroutinize = False
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'kern']
    options.name_IDs = [0, 1, 2, 3, 4, 6, 7, 13, 14]
    options.name_legacy = True

    font = TTFont(src)
    # Original grid-aligned braille outlines. No proportional fallback font
    # is transplanted: the eight dots are constructed in this face's em and
    # carry precisely the same advance as its full block. These are display
    # pixels, so all 256 masks (including the empty cell) must be present.
    cmap = font.getBestCmap()
    advance = font['hmtx'].metrics[cmap[0x2588]][0]
    em = font['head'].unitsPerEm
    order = list(font.getGlyphOrder())
    bit_positions = [(0,0),(0,1),(0,2),(1,0),(1,1),(1,2),(0,3),(1,3)]
    for mask in range(256):
        cp = 0x2800 + mask
        name = 'deepcoreBraille%02X' % mask
        pen = TTGlyphPen(None)
        radius = round(advance * .145)
        for bit, (col, row) in enumerate(bit_positions):
            if not mask & (1 << bit):
                continue
            cx = round(advance * (.25 + col * .5))
            cy = round(em * (.78 - row * .28))
            pen.moveTo((cx + radius, cy))
            pen.qCurveTo((cx + radius, cy + radius), (cx, cy + radius))
            pen.qCurveTo((cx - radius, cy + radius), (cx - radius, cy))
            pen.qCurveTo((cx - radius, cy - radius), (cx, cy - radius))
            pen.qCurveTo((cx + radius, cy - radius), (cx + radius, cy))
            pen.closePath()
        font['glyf'][name] = pen.glyph()
        font['hmtx'].metrics[name] = (advance, 0)
        order.append(name)
        for table in font['cmap'].tables:
            if table.isUnicode():
                table.cmap[cp] = name
    font.setGlyphOrder(order)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=cps)
    subsetter.subset(font)

    # Rename. nameID 1 family, 2 subfamily, 3 unique id, 4 full name,
    # 6 postscript name, plus the typographic pair 16/17 when present.
    ps = family.replace(' ', '')
    names = {1: family, 2: 'Regular', 3: family + ' Subset',
             4: family, 6: ps, 16: family, 17: 'Regular'}
    for rec in font['name'].names:
        if rec.nameID in names:
            rec.string = names[rec.nameID]

    font.flavor = 'woff2'
    font.save(out)

    have = set()
    for table in font['cmap'].tables:
        have.update(table.cmap.keys())
    # The inventory is deliberately over-inclusive: tools/glyphs.js scans raw
    # source text, so a glyph named only in a COMMENT is requested too. That
    # is the safe direction to err in -- an extra glyph costs bytes, a missing
    # one is a tofu box on screen -- but it means the source face may not have
    # everything asked for, which is a warning and not a failure. Check the
    # list by hand when it changes: anything the game actually DRAWS must be
    # in it. (U+226B is the known one; sim.js mentions it in a comment
    # explaining why the code draws U+00BB instead.)
    missing = [c for c in cps if c not in have]
    if missing:
        print('subset_font: NOTE — %d requested codepoints are not in the '
              'source face and were skipped: %s'
              % (len(missing), ' '.join('U+%04X' % c for c in missing)))
    print('subset_font: %d glyphs kept' % len(have))
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 5:
        sys.stderr.write(__doc__)
        sys.exit(1)
    sys.exit(main(*sys.argv[1:]))
