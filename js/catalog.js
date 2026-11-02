/* Room Designer: the things you can put in a room. Each builder draws the item in centimetres with
 * its footprint centred on the origin, standing on y = 0 and facing +z (towards the room). */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util;
  const T = RD.tex;
  const C = (RD.catalog = {});

  C.CATEGORIES = [
    { id: 'furniture', name: 'Furniture' },
    { id: 'storage', name: 'Closets & storage' },
    { id: 'lights', name: 'LEDs & lights' },
    { id: 'decor', name: 'Decor' },
    { id: 'tech', name: 'Tech' },
    { id: 'shapes', name: 'Basic shapes' },
    { id: 'mine', name: 'My stuff' },
  ];

  // ------------------------------------------------------------------ geometry helpers
  const geoCache = new Map();
  function boxGeo(w, h, d, r) {
    const key = `b${w.toFixed(1)}|${h.toFixed(1)}|${d.toFixed(1)}|${r || 0}`;
    if (!geoCache.has(key)) {
      const rr = Math.min(r || 0, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
      geoCache.set(key, rr > 0.2 ? new THREE.RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d));
    }
    return geoCache.get(key);
  }
  function cylGeo(rt, rb, h, seg) {
    const key = `c${rt.toFixed(1)}|${rb.toFixed(1)}|${h.toFixed(1)}|${seg || 24}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg || 24));
    return geoCache.get(key);
  }
  function sphereGeo(r, seg) {
    const key = `s${r.toFixed(1)}|${seg || 16}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(r, seg || 16, Math.max(8, (seg || 16) * 0.75)));
    return geoCache.get(key);
  }

  /** Adds a box whose bottom-centre is at (x, y, z). */
  function box(g, mat, w, h, d, x, y, z, r) {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const m = new THREE.Mesh(boxGeo(w, h, d, r), mat);
    m.position.set(x || 0, (y || 0) + h / 2, z || 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function cyl(g, mat, rt, rb, h, x, y, z, seg) {
    const m = new THREE.Mesh(cylGeo(rt, rb, h, seg), mat);
    m.position.set(x || 0, (y || 0) + h / 2, z || 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function ball(g, mat, r, x, y, z, seg) {
    const m = new THREE.Mesh(sphereGeo(r, seg), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }

  const mat = (c, o) => T.mat(c, o);
  const metal = (c) => T.mat(c || '#2a2a2c', { rough: 0.35, metal: 0.8 });
  const fabric = (c) => T.mat(c, { rough: 0.95 });
  const glossy = (c) => T.mat(c, { rough: 0.3 });

  /** Light source helper: the viewer turns these into real lights (limited number) at build time. */
  function light(g, color, intensity, distance, x, y, z, kind) {
    g.userData.lights = g.userData.lights || [];
    g.userData.lights.push({ color, intensity, distance, pos: [x, y, z], kind: kind || 'point' });
  }

  /** Wall glow behind an LED strip: a soft additive patch on the wall. */
  function glowPatch(g, color, w, h, x, y, z, strength) {
    const m = new THREE.MeshBasicMaterial({
      map: T.glow(), color: new THREE.Color(color), transparent: true, opacity: strength == null ? 0.9 : strength,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z);
    p.userData.glow = true;
    p.userData.glowBase = strength == null ? 0.9 : strength;
    p.renderOrder = 2;
    g.add(p);
    return p;
  }

  function ledMat(item) {
    const o = item.opts || {};
    const bright = o.brightness == null ? 1 : o.brightness;
    const color = o.mode === 'rainbow' ? '#ffffff' : item.color;
    const m = new THREE.MeshStandardMaterial({ color: '#111111', emissive: new THREE.Color(color), emissiveIntensity: 2.5 * bright, roughness: 0.4 });
    m.toneMapped = true;
    if (o.mode === 'rainbow') {
      const t = T.rainbow().clone();
      t.needsUpdate = true;
      t.repeat.set(Math.max(1, item.w / 120), 1);
      m.emissiveMap = t;
    }
    m.userData.led = { mode: o.mode || 'solid', color: item.color, base: 2.5 * bright };
    return m;
  }

  function drawerFronts(g, item, x0, y0, w, h, rows, cols, front, color, knob) {
    const gap = 0.6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dw = w / cols, dh = h / rows;
        const cx = x0 + dw * c + dw / 2;
        const cy = y0 + dh * r;
        box(g, mat(color, { rough: 0.6 }), dw - gap, dh - gap, 1.6, cx, cy + gap / 2, front + 0.8, 0.4);
        if (knob === 'bar') box(g, metal('#8a8a8a'), Math.min(dw * 0.4, 16), 1.2, 1.6, cx, cy + dh * 0.62, front + 2.2, 0.5);
        else ball(g, metal('#9a8f80'), 1.3, cx, cy + dh * 0.6, front + 2.2, 10);
      }
    }
  }

  // ------------------------------------------------------------------ the catalogue
  const ITEMS = {
    bed: {
      name: 'Bed', cat: 'furniture', w: 140, d: 200, h: 100, color: '#8b6b4e', color2: '#e8e4dc',
      labels: ['Frame', 'Bedding'],
      opts: { pillows: 2 },
      build(g, it) {
        const { w, d, h } = it;
        const frame = mat(it.color, { rough: 0.7 });
        const legH = 12, baseH = 22, matH = 22;
        box(g, frame, w, baseH, d - 6, 0, legH, 3, 1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, frame, 6, legH, 6, sx * (w / 2 - 5), 0, sz * (d / 2 - 6) + 3);
        box(g, frame, w, Math.max(h, legH + baseH + matH + 10), 7, 0, 0, -d / 2 + 3.5, 1.5);
        box(g, fabric(U.shade(it.color2, 0.25)), w - 4, matH, d - 12, 0, legH + baseH, 4, 5);
        // blanket over the bottom 2/3
        box(g, fabric(it.color2), w + 1, 4, (d - 10) * 0.66, 0, legH + baseH + matH - 2, d / 2 - (d - 10) * 0.33 - 4, 2);
        const n = Math.max(1, Math.min(4, (it.opts && it.opts.pillows) || (w >= 120 ? 2 : 1)));
        const pw = (w - 16) / n;
        for (let i = 0; i < n; i++) box(g, fabric('#f7f5f0'), pw - 4, 12, 36, -w / 2 + 8 + pw * i + pw / 2, legH + baseH + matH - 2, -d / 2 + 30, 5);
      },
    },
    bunkBed: {
      name: 'Loft bed', cat: 'furniture', w: 100, d: 200, h: 180, color: '#e9e9e9', color2: '#4f6d8f',
      labels: ['Frame', 'Bedding'],
      build(g, it) {
        const { w, d, h } = it;
        const fm = metal(it.color);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, fm, 5, h, 5, sx * (w / 2 - 2.5), 0, sz * (d / 2 - 2.5));
        const top = h - 45;
        box(g, fm, w, 4, d, 0, top, 0);
        box(g, fabric(U.shade(it.color2, 0.6)), w - 8, 16, d - 8, 0, top + 4, 0, 4);
        box(g, fabric(it.color2), w - 6, 4, d * 0.6, 0, top + 18, d * 0.2, 2);
        box(g, fm, w, 3, 3, 0, h - 3, d / 2 - 2.5); box(g, fm, w, 3, 3, 0, h - 3, -d / 2 + 2.5);
        box(g, fm, 3, 3, d, -w / 2 + 2.5, h - 3, 0);
        for (let y = 30; y < top; y += 30) box(g, fm, 3, 3, 40, w / 2 - 2, y, d / 2 - 25);
        box(g, fm, 3, top, 3, w / 2 - 2, 0, d / 2 - 45); box(g, fm, 3, top, 3, w / 2 - 2, 0, d / 2 - 5);
      },
    },
    desk: {
      name: 'Desk', cat: 'furniture', w: 120, d: 60, h: 75, color: '#e8e2d6', color2: '#2a2a2c',
      labels: ['Top', 'Legs'], opts: { drawers: 0 },
      build(g, it) {
        const { w, d, h } = it;
        box(g, mat(it.color, { rough: 0.55 }), w, 3, d, 0, h - 3, 0, 0.6);
        const leg = metal(it.color2);
        const drawers = (it.opts && it.opts.drawers) || 0;
        if (drawers) {
          const dw = 40;
          box(g, mat(it.color), dw, h - 3, d - 4, w / 2 - dw / 2 - 1, 0, 0);
          drawerFronts(g, it, w / 2 - dw - 1, 2, dw, h - 7, drawers, 1, d / 2 - 2, U.shade(it.color, -0.05), 'bar');
          box(g, leg, 4, h - 3, 4, -w / 2 + 4, 0, -d / 2 + 4); box(g, leg, 4, h - 3, 4, -w / 2 + 4, 0, d / 2 - 4);
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, leg, 4, h - 3, 4, sx * (w / 2 - 4), 0, sz * (d / 2 - 4));
        }
        box(g, leg, w - 10, 6, 2, 0, h - 9, -d / 2 + 4);
      },
    },
    officeChair: {
      name: 'Office chair', cat: 'furniture', w: 60, d: 60, h: 110, color: '#2b2b2e', color2: '#1a1a1a',
      labels: ['Seat', 'Base'],
      build(g, it) {
        const { w, d, h } = it;
        const base = metal(it.color2);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const leg = box(g, base, 3, 3, w / 2 - 4, Math.sin(a) * (w / 4 - 2), 6, Math.cos(a) * (d / 4 - 2));
          leg.rotation.y = a;
          ball(g, base, 3, Math.sin(a) * (w / 2 - 5), 3, Math.cos(a) * (d / 2 - 5), 10);
        }
        cyl(g, metal('#777'), 2.5, 2.5, h * 0.36, 0, 8, 0, 12);
        const seatY = h * 0.42;
        box(g, fabric(it.color), w * 0.85, 9, d * 0.8, 0, seatY, 2, 4);
        const back = box(g, fabric(it.color), w * 0.8, h - seatY - 8, 8, 0, seatY + 8, -d * 0.36, 4);
        back.rotation.x = -0.1;
        for (const sx of [-1, 1]) box(g, base, 4, 3, d * 0.45, sx * w * 0.42, seatY + 22, 0, 1);
      },
    },
    gamingChair: {
      name: 'Gaming chair', cat: 'furniture', w: 68, d: 68, h: 130, color: '#1e1e22', color2: '#d72638',
      labels: ['Main', 'Accent'],
      build(g, it) {
        ITEMS.officeChair.build(g, Object.assign({}, it, { color2: '#1a1a1a' }));
        const { w, d, h } = it;
        const seatY = h * 0.42;
        for (const sx of [-1, 1]) box(g, fabric(it.color2), 6, h - seatY - 10, 9, sx * w * 0.36, seatY + 9, -d * 0.36, 3);
        box(g, fabric(it.color2), w * 0.4, 10, 9, 0, h - 22, -d * 0.33, 4);
      },
    },
    chair: {
      name: 'Chair', cat: 'furniture', w: 45, d: 50, h: 85, color: '#c49a6c', color2: '#c49a6c',
      labels: ['Seat', 'Legs'],
      build(g, it) {
        const { w, d, h } = it;
        const legs = mat(it.color2, { rough: 0.6 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, legs, 3.5, 45, 3.5, sx * (w / 2 - 3), 0, sz * (d / 2 - 3));
        box(g, mat(it.color, { rough: 0.6 }), w, 4, d, 0, 45, 0, 1);
        box(g, legs, 3.5, h - 45, 3.5, -w / 2 + 3, 45, -d / 2 + 3); box(g, legs, 3.5, h - 45, 3.5, w / 2 - 3, 45, -d / 2 + 3);
        box(g, mat(it.color, { rough: 0.6 }), w - 4, 14, 2.5, 0, h - 18, -d / 2 + 3, 1);
      },
    },
    sofa: {
      name: 'Sofa', cat: 'furniture', w: 200, d: 90, h: 85, color: '#7d8a99', color2: '#3a2e25',
      labels: ['Fabric', 'Legs'],
      build(g, it) {
        const { w, d, h } = it;
        const f = fabric(it.color);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, mat(it.color2), 5, 10, 5, sx * (w / 2 - 8), 0, sz * (d / 2 - 8));
        box(g, f, w, 22, d, 0, 10, 0, 4);
        box(g, f, w, h - 10, 20, 0, 10, -d / 2 + 10, 6);
        for (const sx of [-1, 1]) box(g, f, 18, 30, d, sx * (w / 2 - 9), 10 + 12, 0, 6);
        const n = w > 170 ? 3 : 2;
        const cw = (w - 36) / n;
        for (let i = 0; i < n; i++) box(g, fabric(U.shade(it.color, 0.05)), cw - 2, 14, d - 26, -w / 2 + 18 + cw * i + cw / 2, 30, 6, 5);
      },
    },
    armchair: {
      name: 'Armchair', cat: 'furniture', w: 85, d: 85, h: 90, color: '#c27c4e', color2: '#3a2e25',
      labels: ['Fabric', 'Legs'],
      build(g, it) { ITEMS.sofa.build(g, it); },
    },
    beanbag: {
      name: 'Beanbag', cat: 'furniture', w: 80, d: 80, h: 70, color: '#3f6fb5',
      build(g, it) {
        const m = new THREE.Mesh(sphereGeo(50, 24), fabric(it.color));
        m.scale.set(it.w / 100, it.h / 100, it.d / 100);
        m.position.y = it.h / 2;
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        const dent = new THREE.Mesh(sphereGeo(50, 20), fabric(U.shade(it.color, -0.08)));
        dent.scale.set(it.w / 160, it.h / 200, it.d / 170);
        dent.position.set(0, it.h * 0.78, it.d * 0.08);
        g.add(dent);
      },
    },
    coffeeTable: {
      name: 'Coffee table', cat: 'furniture', w: 100, d: 55, h: 45, color: '#a47551', color2: '#a47551',
      labels: ['Top', 'Legs'],
      build(g, it) {
        const { w, d, h } = it;
        box(g, mat(it.color, { rough: 0.5 }), w, 4, d, 0, h - 4, 0, 1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, mat(it.color2), 4, h - 4, 4, sx * (w / 2 - 5), 0, sz * (d / 2 - 5));
        box(g, mat(it.color), w - 10, 2, d - 10, 0, 12, 0);
      },
    },
    table: {
      name: 'Table', cat: 'furniture', w: 140, d: 80, h: 75, color: '#c9a77c', color2: '#c9a77c',
      labels: ['Top', 'Legs'],
      build(g, it) {
        const { w, d, h } = it;
        box(g, mat(it.color, { rough: 0.5 }), w, 4, d, 0, h - 4, 0, 1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, mat(it.color2), 5, h - 4, 5, sx * (w / 2 - 6), 0, sz * (d / 2 - 6));
      },
    },

    // ---------------------------------------------------------------- storage
    dresser: {
      name: 'Chest of drawers', cat: 'storage', w: 80, d: 45, h: 100, color: '#ffffff', color2: '#f2f2f2',
      labels: ['Body', 'Drawers'], opts: { drawers: 4, columns: 1 },
      build(g, it) {
        const { w, d, h } = it;
        const o = it.opts || {};
        box(g, mat(it.color, { rough: 0.6 }), w, h - 8, d - 2, 0, 8, -1, 0.5);
        box(g, mat(U.shade(it.color, -0.1)), w - 4, 8, d - 6, 0, 0, -1);
        drawerFronts(g, it, -w / 2 + 1.5, 9.5, w - 3, h - 11, o.drawers || 4, o.columns || (w >= 110 ? 2 : 1), d / 2 - 2, it.color2, 'knob');
      },
    },
    nightstand: {
      name: 'Nightstand', cat: 'storage', w: 45, d: 40, h: 55, color: '#d9c3a5', color2: '#d9c3a5',
      labels: ['Body', 'Drawers'], opts: { drawers: 2 },
      build(g, it) { ITEMS.dresser.build(g, it); },
    },
    wardrobe: {
      name: 'Closet / wardrobe', cat: 'storage', w: 100, d: 60, h: 200, color: '#f4f1ea', color2: '#f4f1ea',
      labels: ['Body', 'Doors'], opts: { doors: 2, style: 'doors' },
      build(g, it) {
        const { w, d, h } = it;
        const o = it.opts || {};
        const body = mat(it.color, { rough: 0.6 });
        box(g, body, w, h, d - 2, 0, 0, -1, 0.5);
        if (o.style === 'open') {
          box(g, mat('#2a2826'), w - 4, h - 8, 1, 0, 4, d / 2 - 3);
          ITEMS.clothesRack.hang(g, w - 8, h - 30, d / 2 - 22);
          return;
        }
        const n = Math.max(1, Math.min(4, o.doors || (w > 70 ? 2 : 1)));
        const dw = (w - 2) / n;
        const doorM = o.style === 'mirror' ? T.mat('#cfd8dc', { rough: 0.05, metal: 0.9 }) : mat(it.color2, { rough: 0.55 });
        for (let i = 0; i < n; i++) {
          const x = -w / 2 + 1 + dw * i + dw / 2;
          box(g, doorM, dw - 0.8, h - 4, 2, x, 2, d / 2 - 1, 0.4);
          const side = n === 1 ? 1 : i % 2 === 0 ? 1 : -1;
          if (o.style !== 'sliding') box(g, metal('#8a8a8a'), 1.4, 22, 2, x + side * (dw / 2 - 5), h * 0.45, d / 2 + 1.5, 0.6);
          else box(g, metal('#8a8a8a'), 2, 30, 0.8, x + (i % 2 ? -1 : 1) * (dw / 2 - 4), h * 0.4, d / 2 + 0.6);
        }
      },
    },
    clothesRack: {
      name: 'Clothes rail', cat: 'storage', w: 120, d: 50, h: 170, color: '#2a2a2c',
      hang(g, w, y, z) {
        const r = (s) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
        const cols = ['#2d3a4f', '#e8e1d3', '#8c2f39', '#1f1f22', '#6b8f71', '#d9a441', '#9db4c0', '#c8577a'];
        let x = -w / 2 + 6;
        let i = 0;
        while (x < w / 2 - 6) {
          const len = 55 + r(i) * 50;
          const cm = fabric(cols[Math.floor(r(i + 7) * cols.length)]);
          const m = box(g, cm, 3.5, len, 40, x, y - len, z, 1);
          m.rotation.y = (r(i + 3) - 0.5) * 0.25;
          x += 4 + r(i + 11) * 2.5;
          i++;
        }
        box(g, metal('#8a8a8a'), w, 2, 2, 0, y, z);
      },
      build(g, it) {
        const { w, d, h } = it;
        const m = metal(it.color);
        for (const sx of [-1, 1]) {
          box(g, m, 3, h, 3, sx * (w / 2 - 2), 0, 0);
          box(g, m, 4, 2, d, sx * (w / 2 - 2), 0, 0);
        }
        box(g, m, w, 3, 3, 0, h - 3, 0);
        ITEMS.clothesRack.hang(g, w - 8, h - 5, 0);
      },
    },
    bookshelf: {
      name: 'Bookshelf', cat: 'storage', w: 80, d: 30, h: 180, color: '#ffffff', opts: { shelves: 5, books: true },
      build(g, it) {
        const { w, d, h } = it;
        const o = it.opts || {};
        const m = mat(it.color, { rough: 0.6 });
        box(g, m, 2, h, d, -w / 2 + 1, 0, 0); box(g, m, 2, h, d, w / 2 - 1, 0, 0);
        box(g, mat(U.shade(it.color, -0.06)), w - 4, h, 1, 0, 0, -d / 2 + 0.5);
        const n = Math.max(1, Math.min(10, o.shelves || 5));
        const step = (h - 2) / n;
        for (let i = 0; i <= n; i++) box(g, m, w - 4, 2, d - 1, 0, Math.min(i * step, h - 2), 0.5);
        if (o.books !== false) {
          const bm = new THREE.MeshStandardMaterial({ map: T.books(), transparent: true, alphaTest: 0.5, roughness: 0.8 });
          for (let i = 0; i < n; i++) {
            const bh = Math.min(step - 4, 28);
            const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 6, bh), bm);
            p.position.set(0, i * step + 2 + bh / 2, d / 2 - 4);
            g.add(p);
            box(g, T.mat('#7a6a5a', { rough: 0.9 }), w - 8, bh * 0.7, d - 10, 0, i * step + 2, -1);
          }
        }
      },
    },
    cubeShelf: {
      name: 'Cube shelf', cat: 'storage', w: 77, d: 39, h: 77, color: '#ffffff', opts: { rows: 2, cols: 2 },
      build(g, it) {
        const { w, d, h } = it;
        const o = it.opts || {};
        const m = mat(it.color, { rough: 0.6 });
        const rows = o.rows || Math.max(1, Math.round(h / 38)), cols = o.cols || Math.max(1, Math.round(w / 38));
        for (let r = 0; r <= rows; r++) box(g, m, w, 2, d, 0, Math.min(r * ((h - 2) / rows), h - 2), 0);
        for (let c = 0; c <= cols; c++) box(g, m, 2, h, d, -w / 2 + 1 + c * ((w - 2) / cols), 0, 0);
        box(g, mat(U.shade(it.color, -0.05)), w, h, 0.5, 0, 0, -d / 2);
      },
    },
    floatingShelf: {
      name: 'Wall shelf', cat: 'storage', w: 80, d: 20, h: 4, color: '#c49a6c', mount: 'wall', y: 140,
      build(g, it) { box(g, mat(it.color, { rough: 0.55 }), it.w, it.h, it.d, 0, 0, 0, 0.5); },
    },
    wallCabinet: {
      name: 'Wall cabinet', cat: 'storage', w: 80, d: 35, h: 60, color: '#f4f1ea', color2: '#f4f1ea', mount: 'wall', y: 150,
      labels: ['Body', 'Doors'],
      build(g, it) { ITEMS.wardrobe.build(g, Object.assign({}, it, { opts: { doors: it.w > 60 ? 2 : 1 } })); },
    },
    tvStand: {
      name: 'TV stand', cat: 'storage', w: 160, d: 40, h: 50, color: '#2f2f33', color2: '#c49a6c',
      labels: ['Body', 'Fronts'],
      build(g, it) {
        const { w, d, h } = it;
        box(g, mat(it.color, { rough: 0.5 }), w, h - 8, d - 2, 0, 8, -1, 0.5);
        for (const sx of [-1, 1]) box(g, metal(), 3, 8, 3, sx * (w / 2 - 6), 0, 0);
        drawerFronts(g, it, -w / 2 + 2, 10, w - 4, h - 12, 1, Math.max(2, Math.round(w / 50)), d / 2 - 2, it.color2, 'bar');
      },
    },
    shoeRack: {
      name: 'Shoe rack', cat: 'storage', w: 80, d: 30, h: 50, color: '#2a2a2c',
      build(g, it) {
        const { w, d, h } = it;
        const m = metal(it.color);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, m, 2, h, 2, sx * (w / 2 - 1), 0, sz * (d / 2 - 1));
        const cols = ['#f2f2f2', '#1f1f22', '#b85c38', '#2d3a4f'];
        for (let i = 0; i < 3; i++) {
          const y = 4 + i * ((h - 6) / 2.2);
          box(g, m, w, 1.5, d, 0, y, 0);
          for (let k = 0; k < Math.floor(w / 28); k++) box(g, mat(cols[(i + k) % 4]), 10, 9, d - 6, -w / 2 + 14 + k * 28, y + 1.5, 0, 3);
        }
      },
    },

    // ---------------------------------------------------------------- LEDs & lights
    ledStrip: {
      name: 'LED strip', cat: 'lights', w: 200, d: 2, h: 1.5, color: '#9b5cff', mount: 'wall', y: 235,
      opts: { mode: 'solid', brightness: 1 },
      build(g, it) {
        const m = ledMat(it);
        const strip = box(g, m, it.w, it.h, it.d, 0, 0, 0);
        strip.castShadow = false;
        glowPatch(g, it.opts && it.opts.mode === 'rainbow' ? '#ffffff' : it.color, it.w * 1.25, 90, 0, 0, -it.d / 2 + 0.2, 0.75 * ((it.opts && it.opts.brightness) || 1)).userData.ledGlow = true;
        light(g, it.color, 1.6 * ((it.opts && it.opts.brightness) || 1), Math.max(2.5, it.w / 70), 0, 0, 12, 'led');
      },
    },
    ledBar: {
      name: 'LED light bars', cat: 'lights', w: 8, d: 8, h: 45, color: '#ff3d7f', opts: { mode: 'solid', brightness: 1 },
      build(g, it) {
        const m = ledMat(it);
        cyl(g, metal('#1a1a1a'), it.w / 2, it.w / 2, 3, 0, 0, 0, 16);
        const tube = cyl(g, m, it.w * 0.32, it.w * 0.32, it.h - 3, 0, 3, 0, 16);
        tube.castShadow = false;
        light(g, it.color, 2, 3, 0, it.h * 0.6, 10, 'led');
      },
    },
    neon: {
      name: 'Neon sign', cat: 'lights', w: 80, d: 2, h: 30, color: '#ff4fd8', mount: 'wall', y: 150,
      opts: { text: 'Good vibes', font: 'script', brightness: 1 },
      build(g, it) {
        const o = it.opts || {};
        const t = T.neon(o.text || 'Hello', it.color, o.font);
        const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(1, 1, 1).multiplyScalar(1.15 * (o.brightness || 1)), toneMapped: false, depthWrite: false });
        const p = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.h), m);
        p.position.set(0, it.h / 2, it.d / 2 + 0.3);
        g.add(p);
        box(g, T.mat('#ffffff', { opacity: 0.15, rough: 0.1 }), it.w, it.h, 0.6, 0, 0, 0);
        glowPatch(g, it.color, it.w * 1.6, it.h * 2.2, 0, it.h / 2, -it.d / 2 + 0.2, 0.55);
        light(g, it.color, 1.2, 2.5, 0, it.h / 2, 15, 'led');
      },
    },
    hexLights: {
      name: 'Hexagon lights', cat: 'lights', w: 90, d: 3, h: 60, color: '#00e5ff', color2: '#ff3df2', mount: 'wall', y: 140,
      labels: ['Colour 1', 'Colour 2'], opts: { brightness: 1 },
      build(g, it) {
        const r = Math.min(it.w / 4.6, it.h / 3.4);
        const hex = new THREE.CylinderGeometry(r * 0.92, r * 0.92, it.d, 6);
        hex.rotateX(Math.PI / 2);
        hex.rotateZ(Math.PI / 6);
        const cells = [[0, 0], [1.73, 0], [0.865, 1.5], [-0.865, 1.5], [2.6, 1.5], [0.865, -1.5]];
        cells.forEach(([cx, cy], i) => {
          const col = U.mix(it.color, it.color2 || it.color, i / (cells.length - 1));
          const m = new THREE.MeshStandardMaterial({ color: '#111', emissive: new THREE.Color(col), emissiveIntensity: 2.2 * ((it.opts && it.opts.brightness) || 1) });
          const mesh = new THREE.Mesh(hex, m);
          mesh.position.set(cx * r - r * 0.85, it.h / 2 + cy * r * 0.6, 0);
          g.add(mesh);
        });
        glowPatch(g, it.color, it.w * 1.8, it.h * 2.2, 0, it.h / 2, -it.d / 2 + 0.2, 0.6);
        light(g, it.color, 1.4, 3, 0, it.h / 2, 15, 'led');
      },
    },
    floorLamp: {
      name: 'Floor lamp', cat: 'lights', w: 35, d: 35, h: 160, color: '#f3e6cf', color2: '#2a2a2c',
      labels: ['Shade', 'Stand'], opts: { on: true },
      build(g, it) {
        const { w, h } = it;
        cyl(g, metal(it.color2), w * 0.4, w * 0.45, 3, 0, 0, 0, 24);
        cyl(g, metal(it.color2), 1.2, 1.2, h - 30, 0, 3, 0, 8);
        const on = !it.opts || it.opts.on !== false;
        const shade = cyl(g, T.mat(it.color, { rough: 0.9, emissive: on ? '#ffd9a0' : null, ei: 0.8, side: THREE.DoubleSide }), w * 0.32, w / 2, 30, 0, h - 30, 0, 24);
        shade.castShadow = false;
        if (on) light(g, '#ffd9a0', 3, 5, 0, h - 20, 0, 'lamp');
      },
    },
    deskLamp: {
      name: 'Desk lamp', cat: 'lights', w: 16, d: 25, h: 45, color: '#2a2a2c', opts: { on: true },
      build(g, it) {
        const m = metal(it.color);
        cyl(g, m, 7, 8, 2, 0, 0, -it.d / 2 + 8, 20);
        const arm = box(g, m, 1.5, it.h * 0.75, 1.5, 0, 1, -it.d / 2 + 8);
        arm.rotation.x = 0.25;
        const on = !it.opts || it.opts.on !== false;
        const head = cyl(g, T.mat(it.color, { rough: 0.4, metal: 0.6 }), 3, 7, 10, 0, it.h - 12, it.d / 2 - 8, 18);
        head.rotation.x = 0.6;
        if (on) {
          ball(g, T.mat('#fff', { emissive: '#fff1d6', ei: 3 }), 2.5, 0, it.h - 12, it.d / 2 - 6, 10);
          light(g, '#fff1d6', 1.2, 2, 0, it.h - 14, it.d / 2 - 4, 'lamp');
        }
      },
    },
    ceilingLight: {
      name: 'Ceiling light', cat: 'lights', w: 40, d: 40, h: 10, color: '#ffffff', mount: 'ceiling', opts: { on: true },
      build(g, it) {
        const on = !it.opts || it.opts.on !== false;
        cyl(g, T.mat(it.color, { rough: 0.4, emissive: on ? '#fff3dd' : null, ei: 0.9 }), it.w / 2, it.w / 2.2, it.h, 0, 0, 0, 32).castShadow = false;
        if (on) light(g, '#fff3dd', 9, 0, 0, -5, 0, 'main');
      },
    },
    pendant: {
      name: 'Pendant lamp', cat: 'lights', w: 35, d: 35, h: 80, color: '#1f1f22', mount: 'ceiling', opts: { on: true },
      build(g, it) {
        const on = !it.opts || it.opts.on !== false;
        cyl(g, metal('#222'), 0.4, 0.4, it.h - 20, 0, 20, 0, 6).castShadow = false;
        cyl(g, T.mat(it.color, { rough: 0.5, metal: 0.4, side: THREE.DoubleSide }), 4, it.w / 2, 20, 0, 0, 0, 28).castShadow = false;
        if (on) {
          ball(g, T.mat('#fff', { emissive: '#ffe2b8', ei: 3 }), 5, 0, 2, 0, 12).castShadow = false;
          light(g, '#ffe2b8', 6, 0, 0, -4, 0, 'main');
        }
      },
    },
    fairyLights: {
      name: 'Fairy lights', cat: 'lights', w: 200, d: 2, h: 30, color: '#ffcf7a', mount: 'wall', y: 200, opts: { brightness: 1 },
      build(g, it) {
        const n = Math.max(6, Math.round(it.w / 12));
        const bulb = T.mat('#fff', { emissive: it.color, ei: 3 * ((it.opts && it.opts.brightness) || 1) });
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = -it.w / 2 + t * it.w;
          const sag = (it.h - 4) * 4 * t * (1 - t);
          const y = it.h - 2 - sag;
          pts.push(new THREE.Vector3(x, y, 1.5));
          ball(g, bulb, 1.2, x, y - 1.5, 1.5, 8).castShadow = false;
        }
        const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 3, 0.25, 4), T.mat('#333'));
        g.add(wire);
        glowPatch(g, it.color, it.w * 1.1, it.h * 2.5, 0, it.h / 2, -0.5, 0.45);
        light(g, it.color, 1, 2.5, 0, it.h / 2, 15, 'led');
      },
    },

    // ---------------------------------------------------------------- decor
    rug: {
      name: 'Rug', cat: 'decor', w: 200, d: 140, h: 1, color: '#c9b79c', color2: '#8c5a3c',
      labels: ['Main', 'Border'], opts: { round: false },
      build(g, it) {
        const o = it.opts || {};
        if (o.round) {
          const m = new THREE.Mesh(cylGeo(50, 50, 1, 48), fabric(it.color2));
          m.scale.set(it.w / 100, it.h, it.d / 100); m.position.y = it.h / 2; m.receiveShadow = true; g.add(m);
          const m2 = new THREE.Mesh(cylGeo(50, 50, 1, 48), fabric(it.color));
          m2.scale.set((it.w - 16) / 100, it.h + 0.05, (it.d - 16) / 100); m2.position.y = it.h / 2 + 0.03; m2.receiveShadow = true; g.add(m2);
        } else {
          box(g, fabric(it.color2), it.w, it.h, it.d, 0, 0, 0).castShadow = false;
          box(g, fabric(it.color), it.w - 16, it.h + 0.1, it.d - 16, 0, 0.02, 0).castShadow = false;
        }
      },
    },
    plant: {
      name: 'Plant', cat: 'decor', w: 45, d: 45, h: 120, color: '#4c7a3d', color2: '#d8d2c4',
      labels: ['Leaves', 'Pot'],
      build(g, it) {
        const { w, h } = it;
        const potH = Math.min(35, h * 0.3);
        cyl(g, mat(it.color2, { rough: 0.8 }), w * 0.32, w * 0.25, potH, 0, 0, 0, 20);
        const leaf = T.mat(it.color, { rough: 0.7 });
        const r = (s) => { const x = Math.sin(s * 91.7) * 1000; return x - Math.floor(x); };
        cyl(g, mat('#5a4632'), 1.2, 1.5, h * 0.45, 0, potH, 0, 6);
        for (let i = 0; i < 14; i++) {
          const a = r(i) * Math.PI * 2, rad = w * 0.12 + r(i + 5) * w * 0.25;
          const y = potH + (h - potH) * (0.35 + r(i + 9) * 0.5);
          const b = ball(g, T.mat(U.shade(it.color, (r(i + 2) - 0.5) * 0.25), { rough: 0.7 }), w * (0.13 + r(i + 1) * 0.1), Math.cos(a) * rad, y, Math.sin(a) * rad, 10);
          b.scale.y = 0.7;
        }
        ball(g, leaf, w * 0.2, 0, h - w * 0.18, 0, 12);
      },
    },
    poster: {
      name: 'Poster / picture', cat: 'decor', w: 50, d: 2, h: 70, color: '#1f1f22', mount: 'wall', y: 120,
      opts: { image: null, frame: true }, labels: ['Frame'],
      build(g, it, ctx) {
        const o = it.opts || {};
        if (o.frame !== false) box(g, mat(it.color, { rough: 0.5 }), it.w, it.h, it.d, 0, 0, 0, 0.3);
        const inset = o.frame !== false ? 3 : 0;
        const tex = o.image && ctx && ctx.texture(o.image);
        const pm = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }) : T.mat('#e8e1d3', { rough: 0.8 });
        const p = new THREE.Mesh(new THREE.PlaneGeometry(it.w - inset * 2, it.h - inset * 2), pm);
        p.position.set(0, it.h / 2, it.d / 2 + 0.05);
        p.receiveShadow = true;
        g.add(p);
        if (!tex) {
          // a simple abstract print as a placeholder
          const c1 = new THREE.Mesh(new THREE.CircleGeometry(Math.min(it.w, it.h) * 0.22, 32), T.mat('#e07a5f'));
          c1.position.set(-it.w * 0.08, it.h * 0.58, it.d / 2 + 0.1); g.add(c1);
          const c2 = new THREE.Mesh(new THREE.PlaneGeometry(it.w * 0.5, it.h * 0.18), T.mat('#3d405b'));
          c2.position.set(it.w * 0.08, it.h * 0.3, it.d / 2 + 0.12); g.add(c2);
        }
      },
    },
    mirror: {
      name: 'Mirror', cat: 'decor', w: 60, d: 3, h: 150, color: '#c9a15b', mount: 'wall', y: 40,
      labels: ['Frame'],
      build(g, it) {
        box(g, metal(it.color), it.w, it.h, it.d, 0, 0, 0, 0.8);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(it.w - 5, it.h - 5), T.mat('#dfe8ec', { rough: 0.02, metal: 1 }));
        glass.position.set(0, it.h / 2, it.d / 2 + 0.1);
        g.add(glass);
      },
    },
    curtains: {
      name: 'Curtains', cat: 'decor', w: 180, d: 12, h: 240, color: '#d8cbb8', mount: 'wall', y: 5,
      opts: { open: true },
      build(g, it) {
        const o = it.opts || {};
        const f = T.mat(it.color, { rough: 0.95, side: THREE.DoubleSide });
        cyl(g, metal('#444'), 1, 1, it.w + 10, 0, it.h - 3, 0, 8).rotation.z = Math.PI / 2;
        const panels = o.open === false ? [[-it.w / 4, it.w / 2], [it.w / 4, it.w / 2]] : [[-it.w / 2 + it.w * 0.12, it.w * 0.24], [it.w / 2 - it.w * 0.12, it.w * 0.24]];
        for (const [cx, pw] of panels) {
          const folds = Math.max(3, Math.round(pw / 9));
          for (let i = 0; i < folds; i++) {
            const m = cyl(g, f, pw / folds / 1.6, pw / folds / 1.6, it.h - 4, cx - pw / 2 + (i + 0.5) * (pw / folds), 0, 0, 10);
            m.scale.z = 0.6;
          }
        }
      },
    },
    blinds: {
      name: 'Blinds', cat: 'decor', w: 120, d: 4, h: 130, color: '#f2efe8', mount: 'wall', y: 90,
      build(g, it) {
        const m = T.mat(it.color, { rough: 0.6 });
        for (let y = 0; y < it.h - 6; y += 4) box(g, m, it.w, 0.6, it.d, 0, y, 0);
        box(g, m, it.w + 2, 5, it.d + 1, 0, it.h - 5, 0);
      },
    },
    clock: {
      name: 'Wall clock', cat: 'decor', w: 30, d: 4, h: 30, color: '#ffffff', mount: 'wall', y: 190,
      build(g, it) {
        const c = cyl(g, T.mat('#222'), it.w / 2, it.w / 2, it.d, 0, 0, 0, 40);
        c.rotation.x = Math.PI / 2; c.position.set(0, it.h / 2, 0);
        const f = new THREE.Mesh(new THREE.CircleGeometry(it.w / 2 - 1.5, 40), T.mat(it.color));
        f.position.set(0, it.h / 2, it.d / 2 + 0.1); g.add(f);
        const hand1 = new THREE.Mesh(new THREE.PlaneGeometry(1, it.w * 0.32), T.mat('#111')); hand1.position.set(0, it.h / 2 + it.w * 0.14, it.d / 2 + 0.2); g.add(hand1);
        const hand2 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, it.w * 0.22), T.mat('#111')); hand2.rotation.z = -1.2; hand2.position.set(it.w * 0.09, it.h / 2 + it.w * 0.04, it.d / 2 + 0.25); g.add(hand2);
      },
    },
    laundryBasket: {
      name: 'Laundry basket', cat: 'decor', w: 40, d: 40, h: 55, color: '#d9c7a7',
      build(g, it) { cyl(g, fabric(it.color), it.w / 2, it.w / 2.3, it.h, 0, 0, 0, 20); },
    },
    trashCan: {
      name: 'Bin', cat: 'decor', w: 28, d: 28, h: 40, color: '#2a2a2c',
      build(g, it) { cyl(g, metal(it.color), it.w / 2, it.w / 2.2, it.h, 0, 0, 0, 20); },
    },

    // ---------------------------------------------------------------- tech
    tv: {
      name: 'TV', cat: 'tech', w: 123, d: 6, h: 71, color: '#111111', opts: { on: false },
      build(g, it) {
        const o = it.opts || {};
        const wall = it.mount === 'wall';
        const legH = wall ? 0 : 7;
        if (!wall) {
          box(g, metal('#222'), it.w * 0.3, 1.5, 22, 0, 0, 0);
          box(g, metal('#222'), 6, legH, 3, 0, 0, -1);
        }
        box(g, glossy(it.color), it.w, it.h - legH, it.d, 0, legH, 0, 0.6);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(it.w - 2, it.h - legH - 2),
          o.on ? T.mat('#0b1020', { emissive: '#4a6fbf', ei: 0.9, rough: 0.2 }) : T.mat('#050505', { rough: 0.15, metal: 0.2 }));
        scr.position.set(0, legH + (it.h - legH) / 2, it.d / 2 + 0.05);
        g.add(scr);
      },
    },
    monitor: {
      name: 'Monitor', cat: 'tech', w: 62, d: 20, h: 48, color: '#18181a', opts: { on: true },
      build(g, it) {
        const o = it.opts || {};
        box(g, metal(it.color), 22, 1.5, 18, 0, 0, 0);
        box(g, metal(it.color), 4, 14, 2, 0, 1.5, -4);
        const sh = it.h - 12;
        box(g, glossy(it.color), it.w, sh, 2.5, 0, 12, -1, 0.4);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(it.w - 1.5, sh - 1.5),
          o.on === false ? T.mat('#050505', { rough: 0.2 }) : T.mat('#0b1020', { emissive: '#5f8fe8', ei: 0.7, rough: 0.2 }));
        scr.position.set(0, 12 + sh / 2, 0.3);
        g.add(scr);
      },
    },
    pc: {
      name: 'Gaming PC', cat: 'tech', w: 21, d: 45, h: 46, color: '#121214', color2: '#7a3cff',
      labels: ['Case', 'RGB'],
      build(g, it) {
        box(g, glossy(it.color), it.w, it.h, it.d, 0, 0, 0, 0.6);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(it.d - 4, it.h - 4), T.mat('#111', { emissive: it.color2, ei: 1.2 }));
        glass.rotation.y = -Math.PI / 2;
        glass.position.set(-it.w / 2 - 0.05, it.h / 2, 0);
        g.add(glass);
        for (let i = 0; i < 3; i++) {
          const fan = new THREE.Mesh(new THREE.RingGeometry(3.5, 5, 24), T.mat('#111', { emissive: it.color2, ei: 2.5, side: THREE.DoubleSide }));
          fan.position.set(0, it.h - 9 - i * 12.5, it.d / 2 + 0.1);
          g.add(fan);
        }
      },
    },
    keyboard: {
      name: 'Keyboard & mouse', cat: 'tech', w: 60, d: 18, h: 3, color: '#1c1c1e',
      build(g, it) {
        box(g, mat(it.color, { rough: 0.5 }), 44, 2.5, 14, -8, 0, 0, 0.5);
        box(g, mat(it.color, { rough: 0.4 }), 6, 3, 10, it.w / 2 - 5, 0, 0, 2.5);
        box(g, mat('#2b2b2f', { rough: 1 }), it.w, 0.3, it.d, 0, 0, 0);
      },
    },
    speaker: {
      name: 'Speaker', cat: 'tech', w: 18, d: 22, h: 30, color: '#1f1f22',
      build(g, it) {
        box(g, mat(it.color, { rough: 0.6 }), it.w, it.h, it.d, 0, 0, 0, 1);
        const cone = cyl(g, T.mat('#333', { rough: 0.4 }), it.w * 0.3, it.w * 0.3, 1, 0, 0, 0, 24);
        cone.rotation.x = Math.PI / 2; cone.position.set(0, it.h * 0.4, it.d / 2);
      },
    },
    console: {
      name: 'Game console', cat: 'tech', w: 30, d: 26, h: 8, color: '#f2f2f2',
      build(g, it) { box(g, glossy(it.color), it.w, it.h, it.d, 0, 0, 0, 1.5); box(g, T.mat('#111', { emissive: '#2f7dff', ei: 2 }), it.w * 0.6, 0.5, 0.5, 0, it.h * 0.5, it.d / 2); },
    },
    fan: {
      name: 'Fan', cat: 'tech', w: 40, d: 30, h: 110, color: '#f2f2f2',
      build(g, it) {
        cyl(g, mat(it.color), it.w * 0.4, it.w * 0.45, 3, 0, 0, 0, 24);
        cyl(g, mat(it.color), 1.5, 1.5, it.h - 22, 0, 3, 0, 8);
        const head = cyl(g, T.mat(it.color, { opacity: 0.35 }), it.w / 2, it.w / 2, 8, 0, it.h - 22, 0, 32);
        head.rotation.x = Math.PI / 2; head.position.y = it.h - 20;
      },
    },

    // ---------------------------------------------------------------- basic shapes
    box: {
      name: 'Box', cat: 'shapes', w: 50, d: 50, h: 50, color: '#cfc6b8',
      build(g, it) { box(g, mat(it.color, { rough: 0.7 }), it.w, it.h, it.d, 0, 0, 0, 0.5); },
    },
    cylinder: {
      name: 'Cylinder', cat: 'shapes', w: 50, d: 50, h: 50, color: '#cfc6b8',
      build(g, it) { const m = cyl(g, mat(it.color, { rough: 0.7 }), 50, 50, 1, 0, 0, 0, 32); m.scale.set(it.w / 100, it.h, it.d / 100); m.position.y = it.h / 2; },
    },
    wallPanel: {
      name: 'Wall panel', cat: 'shapes', w: 100, d: 2, h: 100, color: '#56704f', mount: 'wall', y: 0,
      build(g, it) { box(g, mat(it.color, { rough: 0.8 }), it.w, it.h, it.d, 0, 0, 0); },
    },
    radiator: {
      name: 'Radiator', cat: 'shapes', w: 80, d: 10, h: 60, color: '#f4f4f4', mount: 'wall', y: 15,
      build(g, it) {
        const m = mat(it.color, { rough: 0.4 });
        const n = Math.max(3, Math.round(it.w / 6));
        for (let i = 0; i < n; i++) box(g, m, it.w / n - 1, it.h, it.d, -it.w / 2 + (i + 0.5) * (it.w / n), 0, 0, 1);
      },
    },
  };

  C.ITEMS = ITEMS;
  C.def = (type) => ITEMS[type] || null;

  /** Size and colour options for a new item of this type. */
  C.newItem = function (type, extra) {
    const d = ITEMS[type];
    const it = {
      id: U.uid('i'), type, name: d.name,
      w: d.w, d: d.d, h: d.h, color: d.color, color2: d.color2 || d.color,
      mount: d.mount || 'floor', x: 0, z: 0, rot: 0, y: d.mount === 'wall' ? d.y || 100 : 0,
      opts: U.clone(d.opts || {}),
    };
    return Object.assign(it, extra || {});
  };

  /** Custom item from the user's photos ("my stuff"). */
  function buildCustom(g, it, ctx) {
    const def = ctx && ctx.custom(it.customId);
    const front = def && def.front && ctx.texture(def.front.texId);
    const side = def && def.side && ctx.texture(def.side.texId);
    const sideColor = it.color || (def && def.sideColor) || '#bbbbbb';
    const shape = (def && def.shape) || 'box';
    const { w, d, h } = it;
    if (shape === 'model') {
      const tpl = def.model && ctx.model(def.model.blobId, def.model.name);
      if (tpl) { g.add(RD.models.fit(tpl, def.model.rot, w, d, h)); return; }
      // still loading: a light outline of the size
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), T.mat('#9aa3ad', { opacity: 0.35 }));
      m.position.y = h / 2;
      g.add(m);
      return;
    }
    if (shape === 'cutout') {
      const m = new THREE.MeshStandardMaterial({ map: front, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      p.position.y = h / 2;
      p.castShadow = true;
      g.add(p);
      // footprint so the item can be grabbed and casts a believable contact shadow
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, Math.max(d, 10) * 0.9), new THREE.MeshBasicMaterial({ map: T.spot(), color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.3;
      g.add(shadow);
      return;
    }
    if (shape === 'round') {
      const mats = [new THREE.MeshStandardMaterial({ map: front, color: front ? 0xffffff : sideColor, roughness: 0.7 }), T.mat(sideColor), T.mat(sideColor)];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 40, 1), mats);
      m.scale.z = d / w;
      m.position.y = h / 2;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return;
    }
    const sm = side ? new THREE.MeshStandardMaterial({ map: side, roughness: 0.7 }) : T.mat(sideColor, { rough: 0.7 });
    const topTex = def && def.top && ctx.texture(def.top.texId);
    const top = topTex ? new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.7 }) : T.mat(U.shade(sideColor, 0.06), { rough: 0.7 });
    const fm = front ? new THREE.MeshStandardMaterial({ map: front, roughness: 0.65 }) : T.mat(sideColor);
    // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z
    const bottom = T.mat(U.shade(sideColor, -0.2), { rough: 0.8 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sm, sm, top, bottom, fm, T.mat(sideColor)]);
    m.position.y = h / 2;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  /** Builds the 3D model of an item (in centimetres). ctx gives access to pictures and custom items. */
  C.build = function (it, ctx) {
    const g = new THREE.Group();
    if (it.type === 'custom') buildCustom(g, it, ctx);
    else {
      const d = ITEMS[it.type];
      if (d) d.build(g, Object.assign({}, it, { w: Math.max(1, it.w), d: Math.max(0.5, it.d), h: Math.max(0.5, it.h) }), ctx);
      else box(g, mat('#ff00ff'), it.w, it.h, it.d, 0, 0, 0);
    }
    return g;
  };

  /** Which extra settings the item panel shows for each type. */
  C.OPTIONS = {
    bed: [{ key: 'pillows', label: 'Pillows', type: 'number', min: 1, max: 4 }],
    desk: [{ key: 'drawers', label: 'Drawers', type: 'number', min: 0, max: 5 }],
    dresser: [{ key: 'drawers', label: 'Drawers (rows)', type: 'number', min: 1, max: 8 }, { key: 'columns', label: 'Columns', type: 'number', min: 1, max: 3 }],
    nightstand: [{ key: 'drawers', label: 'Drawers', type: 'number', min: 1, max: 4 }],
    wardrobe: [{ key: 'style', label: 'Doors', type: 'select', options: [['doors', 'Hinged doors'], ['sliding', 'Sliding doors'], ['mirror', 'Mirror doors'], ['open', 'Open (walk-in)']] }, { key: 'doors', label: 'Number of doors', type: 'number', min: 1, max: 4 }],
    bookshelf: [{ key: 'shelves', label: 'Shelves', type: 'number', min: 1, max: 10 }, { key: 'books', label: 'Books', type: 'toggle' }],
    cubeShelf: [{ key: 'rows', label: 'Rows', type: 'number', min: 1, max: 6 }, { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 6 }],
    ledStrip: [{ key: 'mode', label: 'Effect', type: 'select', options: [['solid', 'Solid colour'], ['breathe', 'Breathing'], ['rainbow', 'Rainbow flow'], ['cycle', 'Colour cycle']] }, { key: 'brightness', label: 'Brightness', type: 'range', min: 0.2, max: 2, step: 0.1 }],
    ledBar: [{ key: 'mode', label: 'Effect', type: 'select', options: [['solid', 'Solid colour'], ['breathe', 'Breathing'], ['cycle', 'Colour cycle']] }, { key: 'brightness', label: 'Brightness', type: 'range', min: 0.2, max: 2, step: 0.1 }],
    neon: [{ key: 'text', label: 'Text', type: 'text' }, { key: 'font', label: 'Font', type: 'select', options: [['script', 'Handwriting'], ['block', 'Block letters']] }, { key: 'brightness', label: 'Brightness', type: 'range', min: 0.3, max: 2, step: 0.1 }],
    hexLights: [{ key: 'brightness', label: 'Brightness', type: 'range', min: 0.2, max: 2, step: 0.1 }],
    fairyLights: [{ key: 'brightness', label: 'Brightness', type: 'range', min: 0.2, max: 2, step: 0.1 }],
    floorLamp: [{ key: 'on', label: 'Light on', type: 'toggle' }],
    deskLamp: [{ key: 'on', label: 'Light on', type: 'toggle' }],
    ceilingLight: [{ key: 'on', label: 'Light on', type: 'toggle' }],
    pendant: [{ key: 'on', label: 'Light on', type: 'toggle' }],
    rug: [{ key: 'round', label: 'Round', type: 'toggle' }],
    poster: [{ key: 'image', label: 'Picture', type: 'image' }, { key: 'frame', label: 'Frame', type: 'toggle' }],
    curtains: [{ key: 'open', label: 'Open', type: 'toggle' }],
    tv: [{ key: 'on', label: 'Screen on', type: 'toggle' }],
    monitor: [{ key: 'on', label: 'Screen on', type: 'toggle' }],
  };

  /** Doors and windows (holes in walls). */
  C.OPENINGS = {
    door: { name: 'Door', width: 82, height: 205, sill: 0, color: '#f4f1ea' },
    window: { name: 'Window', width: 120, height: 130, sill: 90, color: '#ffffff' },
    glassDoor: { name: 'Balcony door', width: 90, height: 215, sill: 0, color: '#ffffff' },
    opening: { name: 'Open doorway', width: 90, height: 210, sill: 0, color: '#ffffff' },
  };

  /** Doors and windows: frame, glass and door leaf, built in wall coordinates (x along, y up, z into room). */
  C.buildOpening = function (op, wallT) {
    const g = new THREE.Group();
    const frameM = T.mat(op.color || '#ffffff', { rough: 0.5 });
    const fw = 5, depth = wallT + 2;
    const { width: w, height: h } = op;
    const zc = -wallT / 2;
    const add = (bw, bh, bd, x, y, z, m) => box(g, m, bw, bh, bd, x, y, z);
    if (op.type !== 'opening') {
      add(fw, h, depth, -w / 2 + fw / 2, 0, zc, frameM);
      add(fw, h, depth, w / 2 - fw / 2, 0, zc, frameM);
      add(w, fw, depth, 0, h - fw, zc, frameM);
      if (op.sill > 0) add(w + 8, 3, depth + 6, 0, -3, zc + 3, frameM);
    }
    if (op.type === 'door') {
      const leaf = add(w - fw * 2 - 0.6, h - fw - 0.6, 4, 0, 0, -4, T.mat(op.color || '#f4f1ea', { rough: 0.55 }));
      leaf.userData.doorLeaf = true;
      ball(g, metal('#9a9a9a'), 2.2, w / 2 - fw - 8, 100, -1.2, 10);
    } else if (op.type === 'window' || op.type === 'glassDoor') {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - fw * 2, h - fw * 2), T.mat('#cfe6f5', { opacity: 0.25, rough: 0.05, metal: 0.1, side: THREE.DoubleSide }));
      glass.position.set(0, h / 2, zc);
      glass.userData.glass = true;
      g.add(glass);
      const bars = op.type === 'glassDoor' ? 1 : w > 100 ? 1 : 0;
      for (let i = 1; i <= bars; i++) add(3, h - fw * 2, 4, -w / 2 + (w * i) / (bars + 1), fw, zc, frameM);
      if (op.type === 'window' && h > 100) add(w - fw * 2, 3, 4, 0, h * 0.62, zc, frameM);
    }
    return g;
  };
})();
