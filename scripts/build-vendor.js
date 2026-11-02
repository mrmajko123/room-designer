#!/usr/bin/env node
/* Bundles three.js, the add-ons the app uses and the QR code generator into one plain script,
 * js/vendor/three.bundle.js, so the app runs from a file:// page, inside the desktop app and on phones
 * with no build step. Run `npm install` then `npm run vendor` after changing a version. */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const mod = (p) => path.join(root, 'node_modules', p);
const three = JSON.parse(fs.readFileSync(mod('three/package.json'), 'utf8')).version;

// Embed the Draco decoder (wasm + wrapper) as strings.
const draco = mod('three/examples/jsm/libs/draco');
const embed = path.join(__dirname, '.draco-embed.js');
fs.writeFileSync(embed,
  `export const dracoWrapper = ${JSON.stringify(fs.readFileSync(path.join(draco, 'draco_wasm_wrapper.js'), 'utf8'))};\n` +
  `export const dracoWasm = ${JSON.stringify(fs.readFileSync(path.join(draco, 'draco_decoder.wasm')).toString('base64'))};\n`);

esbuild.build({
  entryPoints: [path.join(__dirname, 'three-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome90', 'safari15'],
  outfile: path.join(root, 'js', 'vendor', 'three.bundle.js'),
  banner: { js: `/* three.js ${three} (MIT, https://threejs.org), Draco decoder (Apache-2.0), qrcode-generator (MIT, Kazuhiko Arase); bundled for Room Designer */` },
  alias: { 'three/addons': 'three/examples/jsm' },
  // the Draco decoder is embedded (see three-entry.js), so its default file URLs are never fetched
  define: { 'import.meta.url': '"https://room-designer.invalid/"' },
  logLevel: 'info',
}).then(() => fs.rmSync(embed, { force: true })).catch(() => { fs.rmSync(embed, { force: true }); process.exit(1); });
