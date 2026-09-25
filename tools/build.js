#!/usr/bin/env node
/* DEEPCORE bundler: inlines style.css and all js/ scripts into dist/deepcore.html
   so the game ships as a single self-contained file. Usage: node tools/build.js */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

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
const css = sheets.map((f) => '/* ==== ' + f + ' ==== */\n' + read(f)).join('\n');
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
const missing = onDisk.filter((f) => files.indexOf(f) < 0);
if (missing.length) {
  console.error('build: ' + missing.join(', ') + ' not referenced by index.html');
  process.exit(1);
}
// The frozen ascii-native branch is the historical port. This second artifact
// also lets a player use current game fixes without loading the fine-art layer.
const classic = process.argv.includes('--classic');
const activeFiles = classic ? files.filter(f => !['js/engraving.js','js/strata.js'].includes(f)) : files;
const bundle = activeFiles
  .map((f) => '/* ==== ' + f + ' ==== */\n' + read(f))
  .join('\n');
html = html.replace(scriptTag, '');
html = html.replace('</body>', '<script>\n' + bundle + '\n</script>\n</body>');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', classic ? 'deepcore-classic.html' : 'deepcore.html');
fs.writeFileSync(out, html);
console.log('build: wrote ' + out + ' (' + (html.length / 1024).toFixed(0) + ' KiB, ' +
  activeFiles.length + ' scripts inlined)');
