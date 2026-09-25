# Bedrock pixel-art sources

Created for Deepcore's September 25, 2026 pixel-art revision using the built-in
image-generation tool (not the API/CLI fallback). No reference images were
supplied. Both generated PNGs retain their original RGBA data; the game scales
them using nearest-neighbour sampling. They are generated illustrations, not
claims of manual pixel-by-pixel authorship.

- `rig-pixel.png`: title, Foundry and wreck illustration. Hardware overlays
  communicate the nine real permanent upgrades. Livery colours the trim.
- `grit-pixel.png`: induction, intercom and pause portrait. The radio indicator
  follows speaking state, not an ambient animation timer.
- Small materials, all ten machines, the map rig and selected equipment are
  separately authored palette grids in `js/pixels.js`. Rare objects retain
  their original geometry, sampled into discrete pixels by `rasterPen`.
- Pixelify Sans is vendored under the SIL Open Font License in
  `vendor/LICENSE-pixelify.txt`; source: Google Fonts' `ofl/pixelifysans`.
  The bundler embeds both images, the font and its license. No runtime network
  service or image-generation dependency is required.

## Drill — final generation prompt

Use case: stylized-concept. Asset type: production pixel-art sprite for an indie mining automation game, not a mockup. Primary request: one original, beautifully authored chunky mobile drilling rig, isolated on a genuinely transparent background. A worn compact tracked mining crawler with a powerful vertical spiral drill at its front, a squat teal armored cab with a warm lit window, mustard-yellow lifting tower, chunky black treads, rust-red engine, hanging cables, a tiny work lamp and riveted patched panels. Side-on three-quarter view; whole machine fully visible, centered, clean transparent margin, no floor or backdrop. Deliberate economical pixel clusters, appealing asymmetric silhouette, a few telling wear marks, dark indigo outline, warm ochre/cream highlights, teal and dusty red accents. Minimal 16-bit/8-bit inspired craftsmanship, like the characterful industrial pixel art of a small indie game; target native detail around 128 by 128 pixels enlarged with perfectly crisp square pixels. No smooth vectors, no gradients, no airbrush, no glow, no isometric app icon, no glossy plastic, no bevelled UI, no text, no logos, no watermark. Artwork must read as one integrated hand-drawn machine, not a collection of rectangle icons. Transparent background is mandatory.

## GRIT — final generation prompt

Use case: stylized-concept. Asset type: production portrait sprite for an indie mining game, genuinely transparent background. Primary request: an original grizzled mine foreman named GRIT, head and shoulders fully visible, facing the player, with the personality of an exhausted man who complains but always gets you home. Broad weathered face, enormous dark gray moustache, a small old cheek scar, heavy eyebrows, amber work goggles resting just below the rim of a battered mustard hardhat with a round miner lamp. Patched dark teal work coat, red-brown collar. Wry skeptical expression, not angry or smiling broadly. Economical hand-authored-looking pixel art: clearly square, deliberate pixel clusters, dark indigo outline, chunky 64 by 64 native-resolution character portrait enlarged with nearest-neighbor crisp edges. Expressive low-resolution face, not a realistic painting pixel filter. Limited warm ochre, dusty teal, rust, cream, charcoal palette fitting an industrial game influenced by Papers Please. Isolated centered bust, transparent margin, no frame or background, no props outside clothing, no text, no logos, no watermark, no smooth vector gradients, no glossy UI icon, no airbrushed shading. Genuine transparent background mandatory.
