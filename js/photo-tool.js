/* Room Designer: marking corners on photos (with a magnifier for fingers) and turning the marked
 * area into a straight, front-on picture. */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util, HM = RD.homo;
  const h = U.h;

  const NAMES = ['Bottom left', 'Bottom right', 'Top right', 'Top left'];

  /**
   * Photo with four draggable corners. corners are in image pixels: [BL, BR, TR, TL].
   * opts: { onChange(corners), hint }
   */
  class CornerEditor {
    constructor(host, img, corners, opts) {
      this.img = img;
      this.opts = opts || {};
      this.W = img.naturalWidth; this.H = img.naturalHeight;
      this.corners = corners ? corners.map((c) => c.slice()) : CornerEditor.defaultCorners(this.W, this.H);
      this.el = h('div.corner-editor');
      this.stage = h('div.ce-stage');
      this.imgEl = h('img', { src: img.src, alt: 'Your photo', draggable: false });
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.classList.add('ce-svg');
      this.poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      this.svg.append(this.poly);
      this.handles = this.corners.map((_, i) => {
        const d = h('div.ce-handle', { 'aria-label': NAMES[i], title: NAMES[i] + ' corner', dataset: { n: i + 1 } }, h('span', null, String(i + 1)));
        d.addEventListener('pointerdown', (e) => this.drag(e, i));
        return d;
      });
      this.loupe = h('canvas.ce-loupe', { width: 150, height: 150 });
      this.loupe.hidden = true;
      this.stage.append(this.imgEl, this.svg, ...this.handles, this.loupe);
      this.el.append(this.stage);
      host.append(this.el);
      RD.photoTool.active = this; // used by the automated tests
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.el);
      this.layout();
    }

    static defaultCorners(W, H) {
      const mx = W * 0.15, my = H * 0.15;
      return [[mx, H - my], [W - mx, H - my], [W - mx, my], [mx, my]];
    }

    layout() {
      const bw = this.el.clientWidth, bh = this.el.clientHeight;
      if (!bw || !bh) return;
      // leave a margin round the photo so corners that are out of the picture can still be placed
      const s = Math.min(bw / this.W, bh / this.H) * 0.84;
      this.scale = s;
      this.padX = (bw / s - this.W) / 2;
      this.padY = (bh / s - this.H) / 2;
      const w = this.W * s, hh = this.H * s;
      Object.assign(this.stage.style, { width: w + 'px', height: hh + 'px' });
      this.svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
      this.svg.setAttribute('width', w); this.svg.setAttribute('height', hh);
      this.draw();
    }

    draw() {
      const s = this.scale || 1;
      this.poly.setAttribute('points', this.corners.map(([x, y]) => `${x * s},${y * s}`).join(' '));
      this.handles.forEach((d, i) => { d.style.transform = `translate(${this.corners[i][0] * s}px, ${this.corners[i][1] * s}px)`; });
    }

    set(corners) { this.corners = corners.map((c) => c.slice()); this.draw(); this.changed(); }
    get() { return this.corners.map((c) => c.slice()); }
    changed() { if (this.opts.onChange) this.opts.onChange(this.get()); }

    drag(e, i) {
      e.preventDefault();
      const handle = this.handles[i];
      handle.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, c: this.corners[i].slice() };
      const touch = e.pointerType !== 'mouse';
      this.loupe.hidden = false;
      handle.classList.add('active');
      // keep the magnifier away from the finger
      const placeLoupe = () => {
        const left = this.corners[i][0] * this.scale < this.stage.clientWidth / 2;
        this.loupe.style.left = left ? 'auto' : '8px';
        this.loupe.style.right = left ? '8px' : 'auto';
      };
      placeLoupe();
      this.drawLoupe(i);
      const move = (ev) => {
        // on touch, the corner moves half as fast as the finger for precision
        const k = (touch ? 0.5 : 1) / this.scale;
        const px = this.padX || 0, py = this.padY || 0;
        this.corners[i] = [
          U.clamp(start.c[0] + (ev.clientX - start.x) * k, -px, this.W + px),
          U.clamp(start.c[1] + (ev.clientY - start.y) * k, -py, this.H + py),
        ];
        this.draw();
        placeLoupe();
        this.drawLoupe(i);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.loupe.hidden = true;
        handle.classList.remove('active');
        this.changed();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    }

    drawLoupe(i) {
      const ctx = this.loupe.getContext('2d');
      const [cx, cy] = this.corners[i];
      const zoom = Math.max(2.5, 4 * (this.scale || 1));
      const span = 150 / zoom;
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, 150, 150);
      ctx.drawImage(this.img, cx - span / 2, cy - span / 2, span, span, 0, 0, 150, 150);
      // the marked outline around this corner
      ctx.strokeStyle = 'rgba(255,90,54,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const toL = ([x, y]) => [(x - cx) * zoom + 75, (y - cy) * zoom + 75];
      const prev = toL(this.corners[(i + 3) % 4]), next = toL(this.corners[(i + 1) % 4]);
      ctx.moveTo(prev[0], prev[1]); ctx.lineTo(75, 75); ctx.lineTo(next[0], next[1]);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(75, 60); ctx.lineTo(75, 90); ctx.moveTo(60, 75); ctx.lineTo(90, 75);
      ctx.stroke();
    }

    destroy() { this.ro.disconnect(); this.el.remove(); }
  }

  /** Image pixels (downscaled for speed) plus the scale used. */
  const pixelsCache = new WeakMap();
  function pixels(img, max) {
    const key = img;
    const c = pixelsCache.get(key);
    if (c && c.max === max) return c;
    const data = U.imageData(img, max);
    const res = { data, scale: data.width / img.naturalWidth, max };
    pixelsCache.set(key, res);
    return res;
  }

  /**
   * Straightens the marked area. Returns { canvas, aspect, info } where aspect is the estimated real
   * width/height (from perspective) and the canvas is outW wide.
   */
  function rectify(img, corners, opts) {
    opts = opts || {};
    const focal = opts.focal35 ? HM.focalFrom35mm(opts.focal35, img.naturalWidth, img.naturalHeight) : null;
    const est = HM.estimateAspect(corners, img.naturalWidth, img.naturalHeight, focal);
    const aspect = opts.aspect || (est ? est.aspect : 1);
    const px = pixels(img, opts.maxSource || 1600);
    const sc = corners.map(([x, y]) => [x * px.scale, y * px.scale]);
    // output about as detailed as the source area, at most maxOut on the longest side
    const srcW = Math.max(Math.hypot(sc[1][0] - sc[0][0], sc[1][1] - sc[0][1]), Math.hypot(sc[2][0] - sc[3][0], sc[2][1] - sc[3][1]));
    const maxOut = opts.maxOut || 1024;
    let ow = Math.max(16, Math.min(maxOut, Math.round(srcW * 1.2)));
    let oh = Math.round(ow / aspect);
    if (oh > maxOut) { oh = maxOut; ow = Math.round(oh * aspect); }
    oh = Math.max(16, oh);
    let out = HM.rectify(px.data, sc, ow, oh);
    if (opts.cutout) out = HM.removeBackground(out, opts.tolerance);
    return { canvas: U.imageDataToCanvas(out), aspect, info: est, imageData: out };
  }

  /** Lets the user mark four corners in a modal; resolves with the corners or null. */
  function markCorners(img, title, corners, hint) {
    const host = h('div.ce-host');
    let ed;
    return U.modal(title, h('div.mark-wrap', null, hint ? h('p.hint', null, hint) : null, host), [
      { label: 'Whole photo', value: 'whole' },
      { label: 'Cancel', value: null },
      { label: 'Done', value: 'ok', primary: true },
    ], {
      wide: true,
      onOpen: () => { ed = new CornerEditor(host, img, corners); },
    }).then((v) => {
      if (v === 'whole') return [[0, img.naturalHeight], [img.naturalWidth, img.naturalHeight], [img.naturalWidth, 0], [0, 0]];
      return v === 'ok' ? ed.get() : null;
    });
  }

  RD.photoTool = { CornerEditor, rectify, markCorners, NAMES };
})();
