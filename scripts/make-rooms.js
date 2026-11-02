#!/usr/bin/env node
/*
 * Builds the downloadable files for the ready-made rooms in js/templates.js:
 *   rooms/<name>.room  open it in Room Designer (Your rooms → Open room file)
 *   rooms/<name>.glb   the 3D model, for any 3D viewer (Windows 3D Viewer, Blender, online viewers)
 * Run: node scripts/make-rooms.js   (needs `npm install` for Playwright)
 */
const fs = require('fs');
const path = require('path');
const templates = require('../js/templates.js');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'rooms');
fs.mkdirSync(out, { recursive: true });

(async () => {
  for (const [key, t] of Object.entries(templates)) {
    const project = JSON.parse(JSON.stringify(t.project));
    Object.assign(project, { id: 'r-template-' + key, created: Date.parse('2026-11-02T12:00:00Z'), updated: Date.parse('2026-11-02T12:00:00Z') });
    const file = { format: 'room-designer', version: 1, app: version, project, stuff: [], blobs: {} };
    fs.writeFileSync(path.join(out, `${t.title}.room`), JSON.stringify(file, null, 1) + '\n');
    console.log(`rooms/${t.title}.room`);
  }

  // 3D models, exported by the app itself
  const { chromium } = require('playwright');
  const { serve } = require('../tests/serve.js');
  const server = await serve(0);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/?nowelcome`);
  await page.waitForFunction(() => window.RD && RD.store && RD.store.project && !document.querySelector('#app.loading'));
  for (const [key, t] of Object.entries(templates)) {
    const bytes = await page.evaluate(async (k) => {
      RD.store.set(RD.store.fromTemplate(k));
      await new Promise((r) => setTimeout(r, 300));
      const blob = await RD.app.viewer.exportGLB();
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, key);
    fs.writeFileSync(path.join(out, `${t.title}.glb`), Buffer.from(bytes));
    console.log(`rooms/${t.title}.glb (${Math.round(bytes.length / 1024)} KB)`);
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
