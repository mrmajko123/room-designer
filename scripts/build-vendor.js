#!/usr/bin/env node
/* Bundles three.js and the add-ons the app uses into one plain script, js/vendor/three.bundle.js,
 * so the app runs from a file:// page, inside the desktop app and on phones with no build step.
 * Run `npm install` then `npm run vendor` after changing the three.js version. */
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const three = JSON.parse(require('fs').readFileSync(path.join(root, 'node_modules', 'three', 'package.json'), 'utf8')).version;
esbuild.build({
  entryPoints: [path.join(__dirname, 'three-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome90', 'safari15'],
  outfile: path.join(root, 'js', 'vendor', 'three.bundle.js'),
  banner: { js: `/* three.js ${three} (MIT license, https://threejs.org) bundled for Room Designer */` },
  alias: { 'three/addons': 'three/examples/jsm' },
  logLevel: 'info',
}).catch(() => process.exit(1));
