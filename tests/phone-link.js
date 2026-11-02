/* Tests the phone link: the desktop app's Wi-Fi server and the scan page a phone opens from the QR code.
 * Run: node tests/phone-link.js */
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const { createPhoneLink, lanAddresses } = require('../desktop/phone-link');

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('FAIL:', msg); } else console.log('ok  :', msg); }
const LAUNCH = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

function request(port, p, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: body === undefined ? 'GET' : 'POST' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

(async () => {
  const events = [];
  const link = createPhoneLink({ root: path.resolve(__dirname, '..'), onEvent: (e) => events.push(e), port: 0 });
  const info = await link.start();
  check(info.port > 0 && /^[0-9a-f]{32}$/.test(info.token), 'server starts with a random key');
  check(Array.isArray(info.urls) && info.urls.every((u) => u.includes('/scan.html#' + info.token)), 'QR address contains the key: ' + (info.urls[0] || '(no network on this machine)'));
  console.log('      network addresses:', lanAddresses().join(', ') || 'none');

  // security: everything except the scan page itself needs the key
  check((await request(info.port, '/scan.html')).status === 200, 'scan page is served');
  check((await request(info.port, '/index.html')).status === 404, 'nothing else from the app is served');
  check((await request(info.port, '/../package.json')).status === 404, 'no files outside the scan page');
  check((await request(info.port, '/api/hello?t=wrong', '')).status === 403, 'wrong key is refused');
  check((await request(info.port, '/api/upload?t=' + info.token, undefined)).status === 405, 'uploads must be POST');

  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${info.port}/scan.html#${info.token}`;
  await page.goto(url);
  await page.waitForSelector('#conn.ok');
  check(events.some((e) => e.type === 'connected'), 'computer hears that the phone connected');

  // 3D scan upload
  await page.tap('[data-go=scan3d]');
  check(await page.isVisible('text=Scaniverse'), 'scan page suggests free scanner apps');
  const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(2 * 1024 * 1024, 7)]);
  await page.setInputFiles('#model-input', { name: 'My dresser.glb', mimeType: 'model/gltf-binary', buffer: glb });
  await page.waitForSelector('#sent:not([hidden])', { timeout: 20000 });
  const file = events.find((e) => e.type === 'file' && e.kind === 'model');
  check(file && file.name === 'My dresser.glb' && file.data.length === glb.length && file.data.slice(0, 4).toString() === 'glTF', '3D scan arrives on the computer intact');
  check(events.some((e) => e.type === 'progress'), 'upload progress is reported');
  check(events.some((e) => e.type === 'done' && e.kind === 'model'), 'phone says the 3D scan is complete');

  // quick photo scan
  events.length = 0;
  await page.tap('#sent [data-go=home]');
  await page.tap('[data-go=photos]');
  check(await page.isDisabled('#send-photos'), 'can\'t send without a front photo');
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  await page.setInputFiles('.slot[data-step=front] input', { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.setInputFiles('.slot[data-step=top] input', { name: 'top.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.tap('#send-photos');
  await page.waitForSelector('#sent:not([hidden])', { timeout: 20000 });
  const steps = events.filter((e) => e.type === 'file').map((e) => e.kind + ':' + e.step);
  check(steps.join(',') === 'photo:front,photo:top', 'front and top photos arrive: ' + steps.join(','));
  check(events.some((e) => e.type === 'done' && e.kind === 'photos'), 'phone says the photos are complete');

  // a new QR code makes the old link expire
  await link.start();
  await page.tap('#sent [data-go=home]');
  await page.reload();
  await page.waitForSelector('#problem:not([hidden])');
  check(/expired/i.test(await page.textContent('#problem-title')), 'old QR codes stop working');

  link.stop();
  check(!link.running, 'server stops when the window closes');
  await browser.close();
  check(errors.length === 0, 'no errors on the scan page ' + errors.join('; '));
  if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll phone link checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
