#!/usr/bin/env node
/* DEEPCORE bundler: inlines style.css and all js/ scripts into dist/deepcore.html
   so the game ships as a single self-contained file. Usage: node tools/build.js */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

const css = read('style.css');
html = html.replace(/<link rel="stylesheet" href="style.css">/,
  '<style>\n' + css + '\n</style>');

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
const bundle = files
  .map((f) => '/* ==== ' + f + ' ==== */\n' + read(f))
  .join('\n');
html = html.replace(scriptTag, '');
html = html.replace('</body>', '<script>\n' + bundle + '\n</script>\n</body>');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'deepcore.html');
fs.writeFileSync(out, html);
console.log('build: wrote ' + out + ' (' + (html.length / 1024).toFixed(0) + ' KiB, ' +
  files.length + ' scripts inlined)');
