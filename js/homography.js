/* Room Designer: photo maths. Straightens ("rectifies") the part of a photo between four marked
 * corners, estimates the real width:height ratio of that rectangle from perspective, samples colours
 * and cuts objects out of their background. Pure functions; no DOM except ImageData-like objects. */
(function (root) {
  const H = {};

  /** Solves A x = b (n x n) with partial pivoting. */
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  /** Homography (row-major 3x3, h33 = 1) mapping the 4 src points onto the 4 dst points. */
  H.fromPoints = function (src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
  };

  H.apply = function (m, x, y) {
    const w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  };

  /** Focal length in pixels from a 35 mm-equivalent focal length (EXIF), using the image diagonal. */
  H.focalFrom35mm = (f35, w, h) => (f35 * Math.hypot(w, h)) / 43.27;

  /**
   * Estimates width / height of the real rectangle whose corners are marked in a photo.
   * corners: [bottomLeft, bottomRight, topRight, topLeft] in image pixels. The camera is assumed to have
   * square pixels and its centre in the middle of the photo. The focal length comes from the photo's EXIF
   * data when known, else from the perspective of the rectangle itself, else a typical phone camera.
   */
  H.estimateAspect = function (corners, imgW, imgH, focalPx) {
    const cx = imgW / 2, cy = imgH / 2;
    const c = corners.map(([x, y]) => [x - cx, y - cy]);
    const m = H.fromPoints([[0, 0], [1, 0], [1, 1], [0, 1]], c);
    if (!m) return null;
    const h1 = [m[0], m[3], m[6]], h2 = [m[1], m[4], m[7]];
    const diag = Math.hypot(imgW, imgH);
    let source = 'photo';
    let f = focalPx;
    if (!(f > 0)) {
      source = 'perspective';
      const f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]);
      f = f2 > 0 ? Math.sqrt(f2) : NaN;
      // Only trust it when the rectangle is clearly seen at an angle and the result is plausible.
      const tilt = Math.min(Math.abs(h1[2]), Math.abs(h2[2])) * diag;
      if (!(f > 0.35 * diag && f < 2.5 * diag) || tilt < 0.02) {
        f = 0.6 * diag; // about a 26 mm lens, the usual main camera of a phone
        source = 'typical';
      }
    }
    const n1 = Math.hypot(h1[0] / f, h1[1] / f, h1[2]);
    const n2 = Math.hypot(h2[0] / f, h2[1] / f, h2[2]);
    return { aspect: n1 / n2, focal: f, source };
  };

  /** Straightens the quad marked by corners (BL, BR, TR, TL) of src into an outW x outH image. */
  H.rectify = function (src, corners, outW, outH, out) {
    const m = H.fromPoints([[0, outH], [outW, outH], [outW, 0], [0, 0]], corners);
    const W = src.width, Hh = src.height, s = src.data;
    const o = out || { width: outW, height: outH, data: new Uint8ClampedArray(outW * outH * 4) };
    const d = o.data;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w = m[6] * px + m[7] * py + m[8];
        let sx = (m[0] * px + m[1] * py + m[2]) / w - 0.5;
        let sy = (m[3] * px + m[4] * py + m[5]) / w - 0.5;
        sx = Math.min(Math.max(sx, 0), W - 1.001);
        sy = Math.min(Math.max(sy, 0), Hh - 1.001);
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
        const k = (y * outW + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const top = s[i00 + ch] + (s[i10 + ch] - s[i00 + ch]) * fx;
          const bot = s[i01 + ch] + (s[i11 + ch] - s[i01 + ch]) * fx;
          d[k + ch] = top + (bot - top) * fy;
        }
      }
    }
    return o;
  };

  const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  /**
   * Typical colour of an image region (e.g. the paint of a wall): ignores the darkest and brightest
   * pixels (shadows, lamps, windows) and the most saturated ones (posters, furniture) where possible.
   * region: {x0, y0, x1, y1} as fractions; defaults to the middle of the image.
   */
  H.typicalColor = function (img, region) {
    const r = region || { x0: 0.08, y0: 0.08, x1: 0.92, y1: 0.92 };
    const W = img.width, Hh = img.height, d = img.data;
    const step = Math.max(1, Math.floor(Math.sqrt((W * Hh) / 40000)));
    const px = [];
    for (let y = Math.floor(r.y0 * Hh); y < r.y1 * Hh; y += step) {
      for (let x = Math.floor(r.x0 * W); x < r.x1 * W; x += step) {
        const k = (y * W + x) * 4;
        if (d[k + 3] < 128) continue;
        const R = d[k], G = d[k + 1], B = d[k + 2];
        const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const sat = Math.max(R, G, B) - Math.min(R, G, B);
        px.push([lum, sat, R, G, B]);
      }
    }
    if (!px.length) return '#cccccc';
    px.sort((a, b) => a[0] - b[0]);
    let keep = px.slice(Math.floor(px.length * 0.15), Math.ceil(px.length * 0.85));
    if (!keep.length) keep = px;
    // Group by coarse colour and take the biggest group: the main colour, not an average of everything.
    const bins = new Map();
    for (const p of keep) {
      const key = ((p[2] >> 5) << 6) | ((p[3] >> 5) << 3) | (p[4] >> 5);
      const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += p[2]; b.g += p[3]; b.b += p[4];
      bins.set(key, b);
    }
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    return hex(best.r / best.n, best.g / best.n, best.b / best.n);
  };

  /**
   * Makes the background of a photo of an object transparent: flood-fills from the edges through
   * pixels close in colour to the edge colour. tolerance 0..100. Returns a new image.
   */
  H.removeBackground = function (img, tolerance) {
    const W = img.width, Hh = img.height, s = img.data;
    const out = { width: W, height: Hh, data: new Uint8ClampedArray(s) };
    const d = out.data;
    const tol = Math.pow((tolerance == null ? 30 : tolerance) * 2.2, 2);
    const seen = new Uint8Array(W * Hh);
    const stack = [];
    const push = (x, y, ref) => {
      const i = y * W + x;
      if (seen[i]) return;
      const k = i * 4;
      const dr = s[k] - ref[0], dg = s[k + 1] - ref[1], db = s[k + 2] - ref[2];
      if (dr * dr + dg * dg + db * db > tol) return;
      seen[i] = 1;
      stack.push(i);
    };
    const seed = (x, y) => {
      const k = (y * W + x) * 4;
      const ref = [s[k], s[k + 1], s[k + 2]];
      push(x, y, ref);
      while (stack.length) {
        const i = stack.pop();
        const x0 = i % W, y0 = (i / W) | 0;
        const kk = i * 4;
        const local = [s[kk], s[kk + 1], s[kk + 2]];
        // Compare neighbours with a blend of the seed and the current pixel so soft gradients are followed.
        const r2 = [(ref[0] + local[0]) / 2, (ref[1] + local[1]) / 2, (ref[2] + local[2]) / 2];
        if (x0 > 0) push(x0 - 1, y0, r2);
        if (x0 < W - 1) push(x0 + 1, y0, r2);
        if (y0 > 0) push(x0, y0 - 1, r2);
        if (y0 < Hh - 1) push(x0, y0 + 1, r2);
      }
    };
    const step = Math.max(1, Math.floor(Math.min(W, Hh) / 40));
    for (let x = 0; x < W; x += step) { seed(x, 0); seed(x, Hh - 1); }
    for (let y = 0; y < Hh; y += step) { seed(0, y); seed(W - 1, y); }
    for (let i = 0; i < W * Hh; i++) if (seen[i]) d[i * 4 + 3] = 0;
    // Soften the cut edge a little.
    for (let y = 1; y < Hh - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (seen[i]) continue;
        const n = seen[i - 1] + seen[i + 1] + seen[i - W] + seen[i + W];
        if (n >= 2) d[i * 4 + 3] = 140;
      }
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
  else (root.RD = root.RD || {}).homo = H;
})(typeof window !== 'undefined' ? window : globalThis);
