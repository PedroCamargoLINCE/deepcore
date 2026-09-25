#!/usr/bin/env node
/* DEEPCORE bundler: inlines style.css and all js/ scripts into dist/deepcore.html
   so the game ships as a single self-contained file. Usage: node tools/build.js */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const graphical = process.argv.includes('--graphical');
const classic = process.argv.includes('--classic');
if (graphical && classic) throw new Error('Choose --graphical or --classic, not both.');
const entry = graphical ? 'graphical.html' : 'index.html';
let html = read(entry);

// Inline every stylesheet the page links, in order — style.css and the
// vendored @font-face (M-HIRES Phase 2.5), whose WOFF2 is already a data URI.
// No CDN links: the artifact CSP blocks external hosts and file:// must keep
// working, so a font that is not inlined is a font that is not there.
const linkTag = /[ \t]*<link rel="stylesheet" href="([^"]+)">\n?/g;
const sheets = [];
let sm;
while ((sm = linkTag.exec(html)) !== null) sheets.push(sm[1]);
if (sheets.length === 0) {
  console.error('build: no stylesheet links found in index.html');
  process.exit(1);
}
const css = sheets.map((f) => '/* ==== ' + f + ' ==== */\n' + read(f)).join('\n')
  .replace(/url\(["']?(vendor\/pixelify-sans\.ttf)["']?\)/g, (_,f) =>
    'url(data:font/ttf;base64,' + fs.readFileSync(path.join(root,f)).toString('base64') + ')');
let firstSheet = true;
html = html.replace(linkTag, () => {
  if (!firstSheet) return '';
  firstSheet = false;
  return '<style>\n' + css + '\n</style>\n';
});

// Replace all script tags with one inline bundle, preserving load order.
const scriptTag = /<script src="(js\/[a-z]+\.js)"><\/script>\s*/g;
const files = [];
let m;
while ((m = scriptTag.exec(html)) !== null) files.push(m[1]);
if (files.length === 0) {
  console.error('build: no script tags found in index.html');
  process.exit(1);
}
// The bundle's script list is index.html's, in its load order. A module that
// exists on disk but was never wired into the page would silently vanish from
// dist/ (and only from dist/), so fail loudly instead — this is how js/fx.js
// and anything after it stays in the single-file build.
const onDisk = fs.readdirSync(path.join(root, 'js'))
  .filter((f) => f.endsWith('.js')).map((f) => 'js/' + f).sort();
const registered = new Set(Array.from((read('index.html') + read('graphical.html'))
  .matchAll(/<script src="(js\/[a-z]+\.js)"><\/script>/g), m => m[1]));
const missing = onDisk.filter((f) => !registered.has(f));
if (missing.length) {
  console.error('build: ' + missing.join(', ') + ' not referenced by either edition entry');
  process.exit(1);
}
// The frozen ascii-native branch is the historical port. This second artifact
// also lets a player use current game fixes without loading the fine-art layer.
const activeFiles = classic ? files.filter(f => !['js/engraving.js','js/strata.js'].includes(f)) : files;
let bundle = activeFiles
  .map((f) => '/* ==== ' + f + ' ==== */\n' + read(f))
  .join('\n');
if (graphical) {
  bundle = bundle.replace(/'assets\/bedrock\/(rig|grit)-pixel\.png'/g, (_,id) =>
    "'data:image/png;base64," + fs.readFileSync(path.join(root,'assets/bedrock/'+id+'-pixel.png')).toString('base64') + "'");
  html = html.replace('</head>', '<!-- Pixelify Sans, Copyright 2021 The Pixelify Sans Project Authors.\n' +
    read('vendor/LICENSE-pixelify.txt').replace(/--/g,'—') + '\n-->\n</head>');
}
html = html.replace(scriptTag, '');
html = html.replace('</body>', '<script>\n' + bundle + '\n</script>\n</body>');
// Edition navigation stays local in the standalone artifacts too.
html = html.replace(/href="index.html"/g, 'href="deepcore.html"')
  .replace(/href="graphical.html"/g, 'href="deepcore-graphical.html"')
  .replace(/link\.href\s*=\s*'graphical.html'/g, "link.href='deepcore-graphical.html'");

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', graphical ? 'deepcore-graphical.html' : classic ? 'deepcore-classic.html' : 'deepcore.html');
fs.writeFileSync(out, html);
console.log('build: wrote ' + out + ' (' + (html.length / 1024).toFixed(0) + ' KiB, ' +
  activeFiles.length + ' scripts inlined)');
