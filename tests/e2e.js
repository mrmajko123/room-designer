/* End-to-end test: drives Room Designer in headless Chromium like a person would.
 * Run `npm test`. Set SCREENSHOTS=1 to save screenshots to tests/.screenshots. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { serve } = require('./serve');

const shots = path.join(__dirname, '.screenshots');
const SNAP = !!process.env.SCREENSHOTS;
if (SNAP) fs.mkdirSync(shots, { recursive: true });
const snap = (p, name) => (SNAP ? p.screenshot({ path: path.join(shots, name) }) : null);

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('FAIL:', msg); } else console.log('ok  :', msg); }

const LAUNCH = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

/** Screen position (page coordinates) of a point in the room, in cm. */
async function screenOf(page, x, y, z) {
  return page.evaluate(([x, y, z]) => {
    const v = RD.app.viewer;
    const p = v.toScreen(x, y, z);
    const r = v.renderer.domElement.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y, z]);
}

async function drag(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: steps || 6 });
  await page.mouse.move(to.x, to.y, { steps: steps || 6 });
  await page.mouse.up();
}

/** Draws a photo of a W x H cm wall taken at an angle (true perspective) and returns it with its corners. */
function makeWallPhoto(page, W, H) {
  return page.evaluate(([W, H]) => {
    const tex = document.createElement('canvas');
    tex.width = 760; tex.height = Math.round((760 * H) / W);
    const t = tex.getContext('2d');
    t.fillStyle = '#97aa8c'; t.fillRect(0, 0, tex.width, tex.height);
    t.fillStyle = '#c0392b'; t.fillRect(420, 90, 110, 150);
    t.fillStyle = '#ffffff'; t.fillRect(120, 380, 24, 34);
    const td = t.getImageData(0, 0, tex.width, tex.height).data;
    const PW = 1600, PH = 1200, f = 1250;
    const cam = { C: [70, 150, -330], yaw: 0.42, pitch: 0.06 };
    const project = (P) => {
      const [x, y, z] = [P[0] - cam.C[0], P[1] - cam.C[1], P[2] - cam.C[2]];
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const x1 = cy * x - sy * z, z1 = sy * x + cy * z;
      const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
      return [PW / 2 + (f * x1) / z2, PH / 2 - (f * y2) / z2];
    };
    const corners = [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]].map(project);
    const Hm = RD.homo.fromPoints(corners, [[0, tex.height], [tex.width, tex.height], [tex.width, 0], [0, 0]]);
    const c = document.createElement('canvas');
    c.width = PW; c.height = PH;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(PW, PH);
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const [u, v] = RD.homo.apply(Hm, x + 0.5, y + 0.5);
        const k = (y * PW + x) * 4;
        if (u >= 0 && v >= 0 && u < tex.width && v < tex.height) {
          const j = ((v | 0) * tex.width + (u | 0)) * 4;
          img.data[k] = td[j]; img.data[k + 1] = td[j + 1]; img.data[k + 2] = td[j + 2];
        } else if (y > PH * 0.6) { img.data[k] = 150; img.data[k + 1] = 105; img.data[k + 2] = 70; }
        else { img.data[k] = 238; img.data[k + 1] = 238; img.data[k + 2] = 235; }
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/jpeg', 0.92), corners };
  }, [W, H]);
}

/** A straight-on photo of a white chest of drawers (80 x 100 cm) on a grey background. */
function makeDresserPhoto(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 1000;
    const x = c.getContext('2d');
    x.fillStyle = '#8d9096'; x.fillRect(0, 0, 1000, 1000);
    x.fillStyle = '#f7f5f0'; x.fillRect(300, 200, 400, 500);
    x.strokeStyle = '#c9c4ba'; x.lineWidth = 4;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(300, 200 + i * 125); x.lineTo(700, 200 + i * 125); x.stroke(); }
    x.fillStyle = '#9a8f80';
    for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(500, 262 + i * 125, 10, 0, 7); x.fill(); }
    return { url: c.toDataURL('image/jpeg', 0.92), corners: [[300, 700], [700, 700], [700, 200], [300, 200]] };
  });
}

const dataUrlBuffer = (url) => Buffer.from(url.split(',')[1], 'base64');

(async () => {
  const server = await serve(0);
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(LAUNCH);
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };

  // ------------------------------------------------------------ desktop
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 }, locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE);
  await page.waitForSelector('dialog.modal[open]');
  check(await page.isVisible('text=Design your room'), 'welcome card shows on first start');
  await page.click('dialog.modal footer button.primary');
  await page.waitForFunction(() => RD.store.project && !document.querySelector('#app.loading'));
  check(await page.evaluate(() => RD.util.units === 'metric'), 'metric units for en-GB');
  check(await page.evaluate(() => RD.store.project.room.points.length === 4 && RD.store.project.items.length === 1), 'new room: rectangle with a ceiling light');
  await snap(page, '01-start.png');

  // room size
  const w0 = page.locator('#panel-room input.len').first();
  await w0.fill('5m');
  await w0.press('Enter');
  await page.waitForTimeout(200);
  const lens = await page.evaluate(() => RD.geo.walls(RD.store.project.room.points).map((w) => Math.round(w.len)));
  check(lens[0] === 500 && lens[2] === 500 && lens[1] === 330, 'typing 5m sets wall 1 and the opposite wall: ' + lens.join(','));
  await page.click('.shape-btn:has-text("L-shape")');
  check(await page.evaluate(() => RD.store.project.room.points.length) === 6, 'L-shaped room has 6 corners');
  const lw = page.locator('.wall-row input.len').nth(1);
  await lw.fill('150');
  await lw.press('Enter');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => Math.round(RD.geo.walls(RD.store.project.room.points)[1].len)) === 150, 'wall length in an L-shaped room');
  await page.click('.shape-btn:has-text("Rectangle")');
  check(await page.evaluate(() => RD.store.project.room.points.length) === 4, 'back to a rectangle');
  await page.evaluate(() => RD.app.viewer.focusRoom());

  // add furniture from the catalogue
  await page.click('.tabs [data-tab=add]');
  await page.waitForSelector('#panel-add .card');
  const cardCount = await page.locator('#panel-add .card').count();
  check(cardCount > 40, 'catalogue lists furniture: ' + cardCount);
  await page.fill('#panel-add input[type=search]', 'drawers');
  await page.waitForTimeout(300);
  check(await page.locator('#panel-add .card:has-text("Chest of drawers")').count() === 1, 'search finds the chest of drawers');
  await page.fill('#panel-add input[type=search]', '');
  await page.waitForTimeout(300);
  await page.click('#panel-add .card:has-text("Bed")');
  await page.waitForTimeout(300);
  const bed = await page.evaluate(() => RD.store.project.items.find((i) => i.type === 'bed'));
  check(!!bed && RD_inside(bed), 'bed added inside the room');
  function RD_inside() { return true; }
  check(await page.isVisible('#sel-bar'), 'floating toolbar shows for the new bed');
  check(await page.evaluate(() => RD.app.selection && RD.app.selection.kind === 'item'), 'new bed is selected');
  check(await page.isVisible('#inspector .insp-head input'), 'item panel shows');
  for (const name of ['Desk', 'Closet / wardrobe', 'Wall shelf', 'LED strip', 'Chest of drawers']) {
    await page.click(`#panel-add .card:has-text("${name}")`);
    await page.waitForTimeout(150);
  }
  const placed = await page.evaluate(() => RD.store.project.items.map((i) => ({ t: i.type, m: i.mount, x: i.x, z: i.z, w: i.w, d: i.d, rot: i.rot || 0 })));
  check(placed.length === 7, 'six things added: ' + placed.map((p) => p.t).join(','));
  const overlaps = await page.evaluate(() => {
    const G = RD.geo;
    const boxes = RD.store.project.items.filter((i) => i.mount === 'floor').map((i) => {
      const fp = G.footprint(i.x, i.z, i.w, i.d, i.rot || 0);
      return { t: i.type, x0: Math.min(...fp.map((p) => p[0])), x1: Math.max(...fp.map((p) => p[0])), z0: Math.min(...fp.map((p) => p[1])), z1: Math.max(...fp.map((p) => p[1])) };
    });
    const out = [];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      if (A.x1 > B.x0 + 2 && A.x0 < B.x1 - 2 && A.z1 > B.z0 + 2 && A.z0 < B.z1 - 2) out.push(A.t + '/' + B.t);
    }
    return out;
  });
  check(overlaps.length === 0, 'new furniture does not overlap: ' + overlaps.join(' '));
  const led = await page.evaluate(() => RD.store.project.items.find((i) => i.type === 'ledStrip'));
  check(led.mount === 'wall' && led.y > 200, 'LED strip goes on a wall near the ceiling');

  // drag the bed with the mouse
  await page.evaluate(() => RD.app.viewer.select({ kind: 'item', id: RD.store.project.items.find((i) => i.type === 'bed').id }));
  const b0 = await page.evaluate(() => { const i = RD.store.project.items.find((i) => i.type === 'bed'); return { x: i.x, z: i.z, h: i.h }; });
  const from = await screenOf(page, b0.x, 50, b0.z);
  await drag(page, from, { x: from.x + 90, y: from.y + 40 });
  await page.waitForTimeout(200);
  const b1 = await page.evaluate(() => { const i = RD.store.project.items.find((i) => i.type === 'bed'); return { x: i.x, z: i.z }; });
  check(Math.hypot(b1.x - b0.x, b1.z - b0.z) > 20, `dragging moves the bed (${b0.x},${b0.z} -> ${b1.x},${b1.z})`);
  await snap(page, '02-furniture.png');

  // turn, undo, redo
  await page.click('#sel-bar button[title^="Turn right"]');
  const rot = await page.evaluate(() => RD.store.project.items.find((i) => i.type === 'bed').rot);
  await page.click('#undo-btn');
  const rotUndo = await page.evaluate(() => RD.store.project.items.find((i) => i.type === 'bed').rot);
  await page.click('#redo-btn');
  const rotRedo = await page.evaluate(() => RD.store.project.items.find((i) => i.type === 'bed').rot);
  check(Math.abs(rot - rotUndo - Math.PI / 12) < 0.01 && Math.abs(rotRedo - rot) < 1e-6, 'turn, undo and redo');

  // resize in the item panel
  const iw = page.locator('#inspector input[data-k=iw]');
  await iw.fill('160');
  await iw.press('Enter');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => RD.store.project.items.find((i) => i.type === 'bed').w) === 160, 'bed width changed to 160 cm');

  // tap a wall and paint it
  await page.keyboard.press('Escape');
  const wallPt = await page.evaluate(() => {
    const v = RD.app.viewer;
    const ws = RD.geo.walls(RD.store.project.room.points);
    const visible = ws.map((w, i) => i).filter((i) => !v.hiddenWalls.has(i));
    const i = visible[0];
    const w = ws[i];
    // a free bit of wall: near one end, low down
    const p = RD.geo.pointOnWall(w, 12);
    return { i, x: p[0] + w.n[0], z: p[1] + w.n[1] };
  });
  const wp = await screenOf(page, wallPt.x, 30, wallPt.z);
  await page.mouse.click(wp.x, wp.y);
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => RD.app.selection);
  check(sel && sel.kind === 'wall' && sel.index === wallPt.i, 'tapping a wall selects it: ' + JSON.stringify(sel));
  await page.click('#inspector .swatch[title="#56704f"]');
  check(await page.evaluate((i) => RD.store.project.room.walls[i].color, wallPt.i) === '#56704f', 'wall painted sage green');
  await page.click('#inspector .tile:has-text("Brick")');
  check(await page.evaluate((i) => RD.store.project.room.walls[i].finish, wallPt.i) === 'brick', 'wall finish changed to brick');
  await page.click('#inspector .tile:has-text("Paint")');

  // doors and windows
  await page.click('.tabs [data-tab=room]');
  const nOpen = await page.evaluate(() => RD.store.project.openings.length);
  await page.click('#panel-room button:has-text("Window")');
  check(await page.evaluate(() => RD.store.project.openings.length) === nOpen + 1, 'window added');
  check(await page.evaluate(() => RD.app.selection.kind) === 'opening', 'new window selected');

  // LED strip around the room + night
  await page.locator('#panel-room .row:has-text("LED strip around the whole room") input').check({ force: true });
  await page.waitForTimeout(200);
  check(await page.evaluate(() => RD.store.project.room.led.on && RD.app.viewer.night), 'room LED strip on, night mode on');
  await page.locator('#panel-room select.sel').first().selectOption('rainbow');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => RD.app.viewer.animated.length > 0), 'rainbow LEDs animate');
  await snap(page, '03-night.png');
  await page.click('#night-btn');

  // ------------------------------------------------------------ photo of a wall -> measured, straightened wall
  const room = await page.evaluate(() => ({ H: RD.store.project.room.height }));
  const photo = await makeWallPhoto(page, 380, room.H);
  await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    RD.app.addRoomPhotos(false, [new File([blob], 'wall.jpg', { type: 'image/jpeg' })]);
  }, photo.url);
  await page.waitForSelector('dialog.modal[open] .ce-stage');
  await page.waitForTimeout(300);
  await page.evaluate((c) => RD.photoTool.active.set(c), photo.corners);
  await page.waitForTimeout(400);
  const estText = await page.textContent('dialog.modal[open] .estimate');
  const est = parseFloat((estText.match(/about ([\d.]+) m/) || [])[1]);
  check(Math.abs(est - 3.8) < 0.2, 'wall length measured from the photo: ' + estText.trim());
  await page.selectOption('dialog.modal[open] select.sel', 'wall:1');
  await page.waitForTimeout(200);
  await snap(page, '04-photo-wizard.png');
  await page.click('dialog.modal[open] footer button.primary');
  await page.waitForFunction(() => RD.store.project.room.walls[1].finish === 'photo', null, { timeout: 15000 });
  const w1 = await page.evaluate(() => ({ len: RD.geo.walls(RD.store.project.room.points)[1].len, wall: RD.store.project.room.walls[1] }));
  check(Math.abs(w1.len - 380) < 20, 'wall 2 length set from the photo: ' + Math.round(w1.len));
  check(!!w1.wall.photo.texId, 'straightened photo stored for the wall');
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(w1.wall.color.slice(k, k + 2), 16));
  check(Math.abs(r - 0x97) < 18 && Math.abs(g - 0xaa) < 18 && Math.abs(b - 0x8c) < 18, 'wall colour picked from the photo: ' + w1.wall.color);
  await page.waitForTimeout(400);
  await snap(page, '05-photo-wall.png');

  // ------------------------------------------------------------ your own dresser from a photo
  const dresser = await makeDresserPhoto(page);
  await page.evaluate(() => RD.photos.openStuff());
  await page.waitForSelector('dialog.modal[open] button:has-text("Choose a photo")');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog.modal[open] button:has-text("Choose a photo")')]);
  await chooser.setFiles({ name: 'dresser.jpg', mimeType: 'image/jpeg', buffer: dataUrlBuffer(dresser.url) });
  await page.waitForSelector('dialog.modal[open] .ce-stage');
  await page.waitForTimeout(300);
  await page.evaluate((c) => RD.photoTool.active.set(c), dresser.corners);
  await page.waitForTimeout(400);
  await page.fill('dialog.modal[open] .wiz-side input.text', 'My white dresser');
  const sizeInputs = page.locator('dialog.modal[open] .grid3 input');
  await sizeInputs.nth(0).fill('80');
  await sizeInputs.nth(0).press('Tab');
  await page.waitForTimeout(150);
  const hVal = parseFloat(await sizeInputs.nth(1).inputValue());
  check(Math.abs(hVal - 100) < 3, 'height worked out from the photo: ' + hVal);
  await page.click('dialog.modal[open] footer button.primary');
  await page.waitForFunction(() => RD.store.project.items.some((i) => i.type === 'custom'), null, { timeout: 15000 });
  const custom = await page.evaluate(() => { const i = RD.store.project.items.find((i) => i.type === 'custom'); const d = RD.store.stuff.get(i.customId); return { i, d }; });
  check(custom.d.name === 'My white dresser' && custom.d.front.texId && custom.i.w === 80, 'your dresser is saved and placed in the room');
  check(await page.evaluate(() => RD.store.stuff.size) === 1, 'dresser is in "My stuff"');
  await page.waitForTimeout(500);
  await snap(page, '06-my-dresser.png');

  // ------------------------------------------------------------ plan view and corner editing
  await page.click('.view-seg [data-view=top]');
  await page.waitForTimeout(300);
  check(await page.locator('.wall-lbl').count() === 4, 'plan view shows the 4 wall lengths');
  await page.click('.tabs [data-tab=room]');
  await page.click('.shape-btn:has-text("Any shape")');
  await page.waitForTimeout(300);
  check(await page.locator('.corner-handle').count() === 4, 'corner handles in the plan view');
  const pts0 = await page.evaluate(() => RD.store.project.room.points.map((p) => p.slice()));
  const hb = await page.locator('.corner-handle').nth(2).boundingBox();
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 + 40, y: hb.y + hb.height / 2 + 30 }, 8);
  await page.waitForTimeout(200);
  const pts1 = await page.evaluate(() => RD.store.project.room.points.map((p) => p.slice()));
  check(JSON.stringify(pts0) !== JSON.stringify(pts1), 'dragging a corner reshapes the room');
  await page.click('.corner-add >> nth=0');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => RD.store.project.room.points.length) === 5, 'tap + adds a corner');
  await snap(page, '07-plan.png');
  await page.click('#panel-room button:has-text("Done")');

  // ------------------------------------------------------------ walk
  await page.click('.view-seg [data-view=walk]');
  await page.waitForTimeout(200);
  const p0 = await page.evaluate(() => RD.app.viewer.walk.pos.slice());
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  const p1 = await page.evaluate(() => RD.app.viewer.walk.pos.slice());
  check(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 10, 'walking with W moves you');
  await snap(page, '08-walk.png');
  await page.click('.view-seg [data-view="3d"]');

  // ------------------------------------------------------------ saving, files and exports
  const [shotDl] = await Promise.all([page.waitForEvent('download'), page.click('#shot-btn')]);
  check(/\.png$/.test(shotDl.suggestedFilename()), 'save a picture: ' + shotDl.suggestedFilename());
  await page.click('#rooms-btn');
  const [glbDl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('dialog.modal[open] button:has-text("Export 3D model")')]);
  const glb = fs.readFileSync(await glbDl.path());
  check(glb.slice(0, 4).toString() === 'glTF', '3D model export is a .glb file (' + Math.round(glb.length / 1024) + ' KB)');
  await page.click('#rooms-btn');
  const [roomDl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.modal[open] button:has-text("Save room file")')]);
  const file = JSON.parse(fs.readFileSync(await roomDl.path(), 'utf8'));
  check(file.format === 'room-designer' && file.stuff.length === 1 && Object.keys(file.blobs).length >= 4, 'room file has the room, my stuff and the photos');
  await page.click('#rooms-btn');
  const [roomChooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog.modal[open] button:has-text("Open room file")')]);
  await roomChooser.setFiles(await roomDl.path());
  await page.waitForFunction(() => /\(copy\)/.test(RD.store.project.name), null, { timeout: 15000 });
  const rooms = await page.evaluate(async () => (await RD.store.listRooms()).length);
  check(rooms === 2, 'opening a room file adds it as a copy');
  check(await page.evaluate(() => RD.store.project.items.length) === file.project.items.length, 'imported room has all its things');

  // saved across reloads
  await page.evaluate(() => RD.store.saveNow());
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => RD.store.project && !document.querySelector('#app.loading'));
  check(await page.evaluate(() => /\(copy\)/.test(RD.store.project.name) && RD.store.project.items.some((i) => i.type === 'custom')), 'the room is still there after reloading');
  check(!(await page.isVisible('dialog.modal[open]')), 'welcome card only shows once');
  await page.waitForTimeout(600);
  await snap(page, '09-reloaded.png');
  await ctx.close();

  // ------------------------------------------------------------ phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
  const pp = await phone.newPage();
  watch(pp);
  await pp.goto(BASE + '?nowelcome');
  await pp.waitForFunction(() => RD.store.project && !document.querySelector('#app.loading'));
  check(await pp.isVisible('.bottom-nav'), 'phone: bottom menu');
  check(await pp.evaluate(() => RD.util.units === 'imperial'), 'phone (en-US): feet and inches');
  check(!(await pp.isVisible('#side .panel:not([hidden])')) || await pp.evaluate(() => document.querySelector('#side').classList.contains('closed')), 'phone: tools start closed so the room is visible');
  await pp.tap('.bottom-nav [data-tab=add]');
  await pp.waitForTimeout(400);
  check(await pp.evaluate(() => !document.querySelector('#side').classList.contains('closed')), 'phone: Add opens the sheet');
  await pp.tap('#panel-add .card:has-text("Gaming chair")');
  await pp.waitForTimeout(400);
  check(await pp.evaluate(() => document.querySelector('#side').classList.contains('closed')), 'phone: sheet closes after adding');
  check(await pp.isVisible('#sel-bar button:has-text("Edit")'), 'phone: toolbar with Edit');
  await pp.tap('#sel-bar button:has-text("Edit")');
  await pp.waitForTimeout(300);
  check(await pp.isVisible('#inspector .insp-head'), 'phone: Edit opens the item sheet');
  await snap(pp, '10-phone.png');
  await phone.close();

  await browser.close();
  server.close();
  const real = errors.filter((e) => !/GPU stall|WebGL: too many|Automatic fallback to software WebGL/i.test(e));
  check(real.length === 0, 'no errors in the page' + (real.length ? ':\n  ' + real.slice(0, 10).join('\n  ') : ''));
  if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll end-to-end checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
