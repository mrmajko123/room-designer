/* Room Designer: materials. Floors and wallpapers are drawn on canvases at real-world scale, so a
 * texture "size" is how many metres one copy of the image covers. */
(function () {
  const RD = (window.RD = window.RD || {});
  const T = (RD.tex = {});
  const U = RD.util;
  const cache = new Map();
  let maxAniso = 4;

  T.setAnisotropy = (n) => { maxAniso = n; };

  // Deterministic noise so textures look the same every time.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toTexture(c, sizeM, srgb) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.userData.sizeM = sizeM;
    return t;
  }

  function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  function speckle(ctx, w, h, n, alpha, rand, light) {
    for (let i = 0; i < n; i++) {
      const v = light ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
    }
  }

  const PAINT = {
    // name -> generator(color, color2) returning a canvas texture
    wood(color) {
      // Floor planks: 4 rows of 20 cm planks in a 0.8 m square, staggered.
      const c = canvas(512, 512), x = c.getContext('2d'), r = rng(7);
      const rows = 4, ph = 512 / rows;
      for (let row = 0; row < rows; row++) {
        let off = -r() * 512;
        while (off < 512) {
          const len = 512 * (0.55 + r() * 0.6);
          const tone = (r() - 0.5) * 0.16;
          x.fillStyle = U.shade(color, tone);
          x.fillRect(off, row * ph, len, ph);
          // grain
          for (let g = 0; g < 26; g++) {
            const y = row * ph + r() * ph;
            x.strokeStyle = `rgba(0,0,0,${0.04 + r() * 0.07})`;
            x.lineWidth = 0.6 + r() * 1.4;
            x.beginPath();
            x.moveTo(off, y);
            x.bezierCurveTo(off + len * 0.3, y + (r() - 0.5) * 6, off + len * 0.7, y + (r() - 0.5) * 6, off + len, y + (r() - 0.5) * 4);
            x.stroke();
          }
          x.fillStyle = 'rgba(0,0,0,0.28)';
          x.fillRect(off, row * ph, 2, ph);
          off += len;
        }
        x.fillStyle = 'rgba(0,0,0,0.3)';
        x.fillRect(0, row * ph, 512, 2);
      }
      return toTexture(c, 0.8);
    },
    laminate(color) { return PAINT.wood(color); },
    herringbone(color) {
      const c = canvas(512, 512), x = c.getContext('2d'), r = rng(11);
      x.fillStyle = U.shade(color, -0.25); x.fillRect(0, 0, 512, 512);
      const L = 128, W = 32;
      for (let i = -8; i < 16; i++) {
        for (let j = -2; j < 12; j++) {
          for (const flip of [0, 1]) {
            x.save();
            x.translate(i * W * 2 + j * W * 2 * 0 + (flip ? W : 0), j * L - i * W * 2 + (flip ? W : 0));
            x.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
            x.fillStyle = U.shade(color, (r() - 0.5) * 0.18);
            x.fillRect(0, 0, L - 2, W - 2);
            x.restore();
          }
        }
      }
      return toTexture(c, 1.0);
    },
    carpet(color) {
      const c = canvas(256, 256), x = c.getContext('2d'), r = rng(3);
      x.fillStyle = color; x.fillRect(0, 0, 256, 256);
      speckle(x, 256, 256, 9000, 0.12, r, false);
      speckle(x, 256, 256, 6000, 0.1, r, true);
      return toTexture(c, 0.4);
    },
    tile(color, color2) {
      const c = canvas(512, 512), x = c.getContext('2d'), r = rng(5);
      x.fillStyle = color2 || U.shade(color, -0.25); x.fillRect(0, 0, 512, 512);
      const n = 4, s = 512 / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          x.fillStyle = U.shade(color, (r() - 0.5) * 0.06);
          x.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
          speckle(x, s, s, 0, 0, r, false);
        }
      }
      return toTexture(c, 1.2);
    },
    checker(color, color2) {
      const c = canvas(256, 256), x = c.getContext('2d');
      x.fillStyle = color; x.fillRect(0, 0, 256, 256);
      x.fillStyle = color2 || U.shade(color, -0.6);
      x.fillRect(0, 0, 128, 128); x.fillRect(128, 128, 128, 128);
      return toTexture(c, 0.6);
    },
    concrete(color) {
      const c = canvas(512, 512), x = c.getContext('2d'), r = rng(9);
      x.fillStyle = color; x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 70; i++) {
        const g = x.createRadialGradient(0, 0, 0, 0, 0, 40 + r() * 90);
        const v = r() > 0.5 ? 255 : 0;
        g.addColorStop(0, `rgba(${v},${v},${v},${0.03 + r() * 0.04})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.save(); x.translate(r() * 512, r() * 512); x.fillStyle = g; x.fillRect(-140, -140, 280, 280); x.restore();
      }
      speckle(x, 512, 512, 5000, 0.08, r, false);
      return toTexture(c, 1.5);
    },
    brick(color) {
      const c = canvas(512, 512), x = c.getContext('2d'), r = rng(13);
      x.fillStyle = '#d8d2c8'; x.fillRect(0, 0, 512, 512);
      const rows = 16, bh = 512 / rows, bw = 512 / 4;
      for (let row = 0; row < rows; row++) {
        const off = row % 2 ? -bw / 2 : 0;
        for (let i = -1; i < 5; i++) {
          x.fillStyle = U.shade(color, (r() - 0.5) * 0.22);
          x.fillRect(off + i * bw + 3, row * bh + 3, bw - 6, bh - 6);
        }
      }
      speckle(x, 512, 512, 4000, 0.12, r, false);
      return toTexture(c, 1.0);
    },
    panel(color) {
      // Vertical wood or MDF panelling, 12.5 cm boards.
      const c = canvas(512, 512), x = c.getContext('2d');
      x.fillStyle = color; x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 8; i++) {
        const g = x.createLinearGradient(i * 64, 0, i * 64 + 64, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.08, 'rgba(255,255,255,0.08)');
        g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.06)');
        x.fillStyle = g; x.fillRect(i * 64, 0, 64, 512);
      }
      return toTexture(c, 1.0);
    },
    slats(color) {
      // Acoustic slat wall: dark gaps between narrow wooden slats.
      const c = canvas(512, 512), x = c.getContext('2d'), r = rng(17);
      x.fillStyle = '#1d1b19'; x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 16; i++) {
        x.fillStyle = U.shade(color, (r() - 0.5) * 0.12);
        x.fillRect(i * 32 + 6, 0, 22, 512);
      }
      return toTexture(c, 0.8);
    },
    stripes(color, color2) {
      const c = canvas(256, 256), x = c.getContext('2d');
      x.fillStyle = color; x.fillRect(0, 0, 256, 256);
      x.fillStyle = color2 || U.shade(color, -0.12);
      for (let i = 0; i < 4; i++) x.fillRect(i * 64, 0, 32, 256);
      return toTexture(c, 0.5);
    },
    paint() { return null; },
  };

  T.FLOORS = [
    { id: 'wood', name: 'Wood planks', color: '#b98a5a' },
    { id: 'laminate', name: 'Light laminate', color: '#d8c3a0' },
    { id: 'herringbone', name: 'Herringbone', color: '#a87645' },
    { id: 'carpet', name: 'Carpet', color: '#9a9a96' },
    { id: 'tile', name: 'Tiles', color: '#e6e3dd' },
    { id: 'checker', name: 'Checkered', color: '#f2f0ea', color2: '#2b2b2b' },
    { id: 'concrete', name: 'Concrete', color: '#a7a6a2' },
    { id: 'paint', name: 'Plain', color: '#cfc8bd' },
  ];

  T.WALLS = [
    { id: 'paint', name: 'Paint' },
    { id: 'photo', name: 'My photo' },
    { id: 'brick', name: 'Brick', color: '#a5583a' },
    { id: 'panel', name: 'Panelling', color: '#e9e4da' },
    { id: 'slats', name: 'Wood slats', color: '#a0703f' },
    { id: 'stripes', name: 'Stripes', color: '#e8e1d3' },
    { id: 'concrete', name: 'Concrete', color: '#b4b2ad' },
  ];

  /** Real paint-like colours to start from. */
  T.SWATCHES = [
    '#ffffff', '#f4f1ea', '#ece4d4', '#d9d4cb', '#b8b6b1', '#7d8085', '#3b3f45', '#1f2124',
    '#e9d8c4', '#d6b89a', '#c98b6b', '#b4553c', '#8c3b2e', '#f2c6c2', '#e79aa8', '#c8577a',
    '#f6e3a1', '#f2c14e', '#e08a2e', '#b9c7a5', '#8fa67e', '#56704f', '#2f4a3a', '#a8d5c8',
    '#5fb3a7', '#2a7f86', '#bcd3ea', '#7ea6d8', '#3b6db3', '#2b3a67', '#c8b6e2', '#7b5ea7',
  ];

  T.pattern = function (kind, color, color2) {
    if (!PAINT[kind] || kind === 'paint') return null;
    return cached(`${kind}|${color}|${color2 || ''}`, () => PAINT[kind](color, color2));
  };

  /** Soft glow used to light up walls behind LED strips (white, tinted by the material colour). */
  T.glow = function () {
    return cached('glow', () => {
      const c = canvas(64, 256), x = c.getContext('2d');
      const gy = x.createLinearGradient(0, 0, 0, 256);
      gy.addColorStop(0, 'rgba(255,255,255,0)');
      gy.addColorStop(0.5, 'rgba(255,255,255,1)');
      gy.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gy; x.fillRect(0, 0, 64, 256);
      // fade the ends
      x.globalCompositeOperation = 'destination-in';
      const gx = x.createLinearGradient(0, 0, 64, 0);
      gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.15, 'rgba(0,0,0,1)');
      gx.addColorStop(0.85, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gx; x.fillRect(0, 0, 64, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  };

  /** Round soft spot (for lamp light pools and soft contact shadows). */
  T.spot = function () {
    return cached('spot', () => {
      const c = canvas(128, 128), x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    });
  };

  /** Rainbow strip for animated LEDs. */
  T.rainbow = function () {
    return cached('rainbow', () => {
      const c = canvas(256, 4), x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 256, 0);
      ['#ff0040', '#ff8a00', '#ffe600', '#29ff4a', '#00e5ff', '#2b5bff', '#c300ff', '#ff0040'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
      x.fillStyle = g; x.fillRect(0, 0, 256, 4);
      const t = toTexture(c, 1);
      t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  };

  /** Rows of book spines for bookshelves. */
  T.books = function () {
    return cached('books', () => {
      const c = canvas(512, 128), x = c.getContext('2d'), r = rng(21);
      x.clearRect(0, 0, 512, 128);
      const cols = ['#8c2f39', '#1f4e79', '#2e6b4f', '#d9a441', '#3d3d3d', '#b85c38', '#6c4f8c', '#e8e1d3', '#244a5c', '#9a3e5e'];
      let px = 0;
      while (px < 512) {
        const w = 10 + r() * 16, h = 70 + r() * 56;
        x.fillStyle = cols[Math.floor(r() * cols.length)];
        x.fillRect(px, 128 - h, w - 1, h);
        x.fillStyle = 'rgba(255,255,255,0.35)';
        x.fillRect(px + 2, 128 - h + 8, w - 5, 2);
        px += w;
        if (r() < 0.08) px += 20 + r() * 40;
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  };

  /** Text drawn for neon signs (bright core, soft glow), returned with its aspect ratio. */
  T.neon = function (text, color, font) {
    return cached(`neon|${text}|${color}|${font || ''}`, () => {
      const lines = String(text || 'Hello').split('\n').slice(0, 3);
      const fam = font === 'block' ? '700 120px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif' : 'italic 600 120px "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive';
      const m = canvas(10, 10).getContext('2d');
      m.font = fam;
      const width = Math.max(...lines.map((l) => m.measureText(l).width), 60) + 80;
      const height = lines.length * 140 + 60;
      const c = canvas(Math.ceil(width), Math.ceil(height)), x = c.getContext('2d');
      x.font = fam;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      lines.forEach((l, i) => {
        const y = 30 + 70 + i * 140;
        x.shadowColor = color; x.shadowBlur = 30;
        x.fillStyle = color;
        x.fillText(l, width / 2, y);
        x.shadowBlur = 0;
        x.fillStyle = U.mix(color, '#ffffff', 0.75);
        x.fillText(l, width / 2, y);
      });
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.userData.aspect = width / height;
      return t;
    });
  };

  /** Material cache: one material per look, shared between objects. */
  const mats = new Map();
  T.mat = function (color, o) {
    o = o || {};
    const key = JSON.stringify([color, o.rough, o.metal, o.emissive, o.ei, o.opacity, o.side, o.map && o.map.uuid]);
    if (mats.has(key)) return mats.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: o.rough == null ? 0.75 : o.rough,
      metalness: o.metal || 0,
      map: o.map || null,
      side: o.side || THREE.FrontSide,
    });
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei == null ? 1 : o.ei; }
    if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
    mats.set(key, m);
    return m;
  };
})();
