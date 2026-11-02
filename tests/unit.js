/* Unit tests for the floor-plan and photo maths (no browser needed). Run: node tests/unit.js */
const G = require('../js/geometry.js');
const H = require('../js/homography.js');

let failed = 0;
function check(cond, msg) { if (!cond) { failed++; console.log('FAIL:', msg); } else console.log('ok  :', msg); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- Floor plans
const r = G.rect(400, 300);
check(G.area2(r) > 0, 'rectangle is wound with positive area');
const ws = G.walls(r);
check(ws[0].len === 400 && ws[1].len === 300, 'wall lengths');
check(ws[0].n[0] === 0 && ws[0].n[1] === 1, 'first wall faces into the room');
const r2 = G.setWallLength(r, 0, 450);
check(G.walls(r2)[0].len === 450 && G.walls(r2)[2].len === 450 && G.walls(r2)[1].len === 300, 'resizing a wall moves the opposite wall too');
const L = G.lShape(500, 400, 200, 150);
check(L.length === 6 && G.area2(L) > 0, 'L-shape has 6 walls');
const L2 = G.setWallLength(L, 0, 550);
const lw = G.walls(L2).map((w) => Math.round(w.len));
check(lw[0] === 550 && lw[5] === 400 && G.isSimple(L2), 'L-shape resize keeps it closed: ' + lw.join(','));
check(G.normalize([[0, 0], [0, 300], [400, 300], [400, 0]])[1][0] === 400, 'clockwise outlines are flipped');
check(G.pointInPolygon(100, 100, r) && !G.pointInPolygon(500, 100, r), 'point in polygon');
const [kx, kz] = G.keepInside(r, 10, 150, 100, 50, 0, 0);
check(near(kx, 50, 0.01) && kz === 150, 'items are pushed inside the room: ' + kx);
const [sx] = G.keepInside(r, 360, 150, 60, 40, 0, 10);
check(near(sx, 370, 0.01), 'items snap flush to a nearby wall: ' + sx);
const off = G.offsetOutward(r, 10);
check(near(off[0][0], -10, 1e-9) && near(off[0][1], -10, 1e-9), 'outer wall outline');
check(G.splitWall(r, 0).length === 5 && G.removeCorner(G.splitWall(r, 0), 1).length === 4, 'split and remove corners');

// ---- Photo maths: render a wall of known size with a pinhole camera and measure it back.
function project(P, cam) {
  // cam: position C, yaw, pitch, focal f, image w h. World: x right, y up, z towards the wall.
  const [x, y, z] = [P[0] - cam.C[0], P[1] - cam.C[1], P[2] - cam.C[2]];
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const x1 = cy * x - sy * z, z1 = sy * x + cy * z;
  const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
  return [cam.w / 2 + (cam.f * x1) / z2, cam.h / 2 - (cam.f * y2) / z2];
}
const W = 380, Hh = 250;
const wall = [[0, 0, 0], [W, 0, 0], [W, Hh, 0], [0, Hh, 0]]; // BL, BR, TR, TL on the plane z = 0
const cases = [
  { C: [80, 150, -320], yaw: 0.45, pitch: 0.08, note: 'standing in a corner, looking across' },
  { C: [300, 140, -350], yaw: -0.35, pitch: -0.12, note: 'from the other side, tilted down' },
  { C: [190, 125, -420], yaw: 0, pitch: 0, note: 'straight on' },
  { C: [-50, 170, -260], yaw: 0.7, pitch: 0.15, note: 'steep angle' },
];
for (const c of cases) {
  const cam = { ...c, f: 3000, w: 4032, h: 3024 };
  const pts = wall.map((P) => project(P, cam));
  const known = H.estimateAspect(pts, cam.w, cam.h, cam.f);
  check(near(known.aspect, W / Hh, 0.01), `aspect with known focal (${c.note}): ${known.aspect.toFixed(3)} vs ${(W / Hh).toFixed(3)}`);
  const auto = H.estimateAspect(pts, cam.w, cam.h, null);
  check(near(auto.aspect, W / Hh, 0.12), `aspect with estimated focal (${c.note}, ${auto.source}): ${auto.aspect.toFixed(3)}`);
}
check(near(H.focalFrom35mm(26, 4032, 3024), 3028, 5), 'focal length from 35 mm equivalent');

// Rectify a synthetic checkerboard: corners of the full image -> identity.
const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
for (let i = 0; i < 64; i++) { const v = ((i % 8) + Math.floor(i / 8)) % 2 ? 255 : 0; img.data.set([v, v, v, 255], i * 4); }
const out = H.rectify(img, [[0, 8], [8, 8], [8, 0], [0, 0]], 8, 8);
let same = true;
for (let i = 0; i < img.data.length; i++) if (Math.abs(out.data[i] - img.data[i]) > 1) same = false;
check(same, 'rectifying the whole image returns it unchanged');

// Typical colour ignores a small poster on a sage wall.
const wallImg = { width: 50, height: 50, data: new Uint8ClampedArray(50 * 50 * 4) };
for (let i = 0; i < 2500; i++) {
  const x = i % 50, y = Math.floor(i / 50);
  const poster = x > 30 && x < 40 && y > 10 && y < 25;
  wallImg.data.set(poster ? [220, 20, 40, 255] : [150 + (x % 3), 170, 140, 255], i * 4);
}
const tc = H.typicalColor(wallImg);
check(/^#9[67]aa8c$/.test(tc), 'typical wall colour: ' + tc);

// Background removal keeps an object in the middle.
const obj = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) };
for (let i = 0; i < 1600; i++) {
  const x = i % 40, y = Math.floor(i / 40);
  const inside = x > 10 && x < 30 && y > 8 && y < 36;
  obj.data.set(inside ? [120, 70, 30, 255] : [240, 240, 236, 255], i * 4);
}
const cut = H.removeBackground(obj, 25);
check(cut.data[3] === 0 && cut.data[(20 * 40 + 20) * 4 + 3] === 255, 'background removed, object kept');

if (failed) { console.log(`${failed} unit test(s) failed`); process.exit(1); }
console.log('All unit tests passed');
