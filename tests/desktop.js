/* Desktop app test: launches the real Electron app, starts the phone link, sends a 3D scan the way a phone
 * would, and checks that the size check opens and the item is added. Needs: cd desktop && npm install && npm run prepare-web.
 * Run: xvfb-run -a node tests/desktop.js (Linux without a screen) or node tests/desktop.js */
const { _electron: electron } = require('playwright');
const http = require('http');
const path = require('path');
const DESKTOP = path.resolve(__dirname, '..', 'desktop');
const post = (port, path, body, type) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': type || 'application/octet-stream', 'Content-Length': body ? body.length : 0 } }, (resp) => { let d = ''; resp.on('data', (c) => d += c); resp.on('end', () => res({ status: resp.statusCode, body: d })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('FAIL:', msg); } else console.log('ok  :', msg); }
(async () => {
  const app = await electron.launch({ args: ['--no-sandbox', '.'], cwd: DESKTOP, executablePath: require(path.join(DESKTOP, 'node_modules', 'electron')) });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForFunction(() => window.RD && RD.store && RD.store.project && !document.querySelector('#app.loading'), null, { timeout: 30000 });
  const dlg = await win.$('dialog.modal[open] footer button.primary');
  if (dlg) await dlg.click();
  check(await win.evaluate(() => !!(window.roomDesktop && window.roomDesktop.phoneLink)), 'desktop app has the phone link');
  check(await win.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'), 'the page has no direct access to the computer');
  // make a small GLB in the app
  await win.evaluate(async () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.4), new THREE.MeshStandardMaterial({ color: '#7a5c3e' }));
    const buf = await new Promise((res, rej) => new THREE.GLTFExporter().parse(m, res, rej, { binary: true }));
    window.__glbBytes = Array.from(new Uint8Array(buf));
  });
  const glb = Buffer.from(await win.evaluate(() => window.__glbBytes));
  await win.evaluate(() => { RD.scanning.openAdd(); });
  await win.click('.choice:has-text("Scan with your phone")');
  await win.waitForSelector('dialog.modal[open] .qr svg');
  const url = await win.textContent('.qr-url');
  check(/^http:\/\/[\d.]+:\d+\/scan\.html#[0-9a-f]{32}$/.test(url), 'QR code links to this computer: ' + url);

  const port = Number(url.match(/:(\d+)\//)[1]);
  const token = url.split('#')[1];
  const page = await new Promise((res) => http.get({ host: '127.0.0.1', port, path: '/scan.html' }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, len: d.length })); }));
  check(page.status === 200 && page.len > 1000, 'desktop app serves the phone scan page');
  check((await post(port, '/api/hello?t=' + token)).status === 200, 'phone connects');
  await win.waitForFunction(() => /connected/i.test(document.querySelector('.link-status').textContent));

  check((await post(port, `/api/upload?t=${token}&kind=model&name=${encodeURIComponent('Night stand.glb')}`, glb, 'model/gltf-binary')).status === 200, 'phone uploads a 3D scan');
  check((await post(port, `/api/done?t=${token}&kind=model`)).status === 200, 'phone finishes');
  await win.waitForSelector('dialog.modal[open] .scan-preview canvas', { timeout: 20000 });
  const dims = await win.evaluate(() => ['w', 'd', 'h'].map((k) => document.querySelector(`dialog.modal[open] input[data-k=${k}]`).value));
  check((await win.inputValue('dialog.modal[open] .wiz-side input.text')) === 'Night stand', 'size check opens with the scan: ' + dims.join(' x '));
  await win.waitForTimeout(800);

  await win.click('dialog.modal[open] footer button:has-text("Add to My stuff")');
  await win.waitForFunction(() => RD.store.project.items.some((i) => i.type === 'custom'));
  check((await win.evaluate(() => RD.store.project.items.filter((i) => i.type === 'custom').map((i) => `${i.name} ${i.w}x${i.d}x${i.h}`).join(', '))) === 'Night stand 60x40x75', 'scanned item added with its real size');
  check((await post(port, '/api/hello?t=' + token).catch(() => ({ status: 'closed' }))).status === 'closed', 'phone link stops when the QR window closes');
  check(errors.length === 0, 'no errors ' + errors.join('; '));
  await app.close();
  if (failures) process.exit(1);
  console.log('\nAll desktop checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
