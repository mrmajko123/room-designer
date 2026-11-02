/* Room Designer: floor-plan maths. Rooms are polygons of [x, z] points in centimetres,
 * wound so that the inside of the room is on the left of every wall (positive area). */
(function (root) {
  const G = {};

  G.area2 = function (pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a;
  };

  /** Returns a copy wound the way the app expects (positive area). */
  G.normalize = function (pts) {
    const out = pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    return G.area2(out) < 0 ? out.reverse() : out;
  };

  /** One entry per wall: start a, end b, length, unit direction and the normal pointing into the room. */
  G.walls = function (pts) {
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1e-6;
      const dir = [dx / len, dz / len];
      out.push({ i, a, b, len, dir, n: [-dir[1], dir[0]], angle: Math.atan2(-dir[1], dir[0]) });
    }
    return out;
  };

  /** Rotation (around the vertical axis) that turns an item's front (+z) to face into the room from wall w. */
  G.facingAngle = (w) => Math.atan2(w.n[0], w.n[1]);

  G.pointOnWall = (w, along) => [w.a[0] + w.dir[0] * along, w.a[1] + w.dir[1] * along];

  /** Outline offset outwards by t (mitred corners), used for wall thickness. */
  G.offsetOutward = function (pts, t) {
    const ws = G.walls(pts);
    const n = pts.length;
    return pts.map((p, i) => {
      const n0 = ws[(i - 1 + n) % n].n, n1 = ws[i].n;
      let k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
      if (k < 0.15) k = 0.15; // very sharp corner: limit the mitre
      return [p[0] - (t * (n0[0] + n1[0])) / k, p[1] - (t * (n0[1] + n1[1])) / k];
    });
  };

  G.pointInPolygon = function (x, z, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  };

  G.bounds = function (pts) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    return { minX, minZ, maxX, maxZ, w: maxX - minX, l: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  };

  G.rect = (w, l) => [[0, 0], [w, 0], [w, l], [0, l]];

  /** L-shaped room: a w x l rectangle with a cw x cl piece missing from the far corner. */
  G.lShape = function (w, l, cw, cl) {
    cw = Math.min(Math.max(cw, 20), w - 20);
    cl = Math.min(Math.max(cl, 20), l - 20);
    return [[0, 0], [w, 0], [w, l - cl], [w - cw, l - cl], [w - cw, l], [0, l]];
  };

  /** Nearest wall to a point: wall index, distance along the wall and distance from it. */
  G.nearestWall = function (pts, x, z) {
    let best = null;
    for (const w of G.walls(pts)) {
      const rx = x - w.a[0], rz = z - w.a[1];
      const along = Math.min(Math.max(rx * w.dir[0] + rz * w.dir[1], 0), w.len);
      const p = G.pointOnWall(w, along);
      const dist = Math.hypot(x - p[0], z - p[1]);
      if (!best || dist < best.dist) best = { i: w.i, along, dist, wall: w };
    }
    return best;
  };

  /**
   * Changes the length of wall i, keeping every other wall straight. In rooms with square corners the
   * opposite wall grows or shrinks with it (like pulling one side of the room); otherwise only the next
   * corner moves. Returns the new points, or null if a wall would get too short.
   */
  G.setWallLength = function (pts, i, newLen) {
    const n = pts.length;
    const ws = G.walls(pts);
    const w = ws[i];
    const d = newLen - w.len;
    if (newLen < 10) return null;
    if (Math.abs(d) < 0.01) return pts.map((p) => p.slice());
    let k = -1;
    for (let s = 1; s < n; s++) {
      const j = (i + s) % n;
      if (ws[j].dir[0] * w.dir[0] + ws[j].dir[1] * w.dir[1] < -0.999) { k = s; break; }
    }
    const out = pts.map((p) => p.slice());
    const moves = k > 0 ? k : 1;
    for (let s = 1; s <= moves; s++) {
      const v = (i + s) % n;
      out[v][0] += w.dir[0] * d;
      out[v][1] += w.dir[1] * d;
    }
    for (const nw of G.walls(out)) if (nw.len < 10) return null;
    if (G.area2(out) <= 0) return null;
    return G.normalize(out);
  };

  /** Inserts a corner in the middle of wall i (to make custom shapes). */
  G.splitWall = function (pts, i, along) {
    const w = G.walls(pts)[i];
    const p = G.pointOnWall(w, along == null ? w.len / 2 : along);
    const out = pts.map((q) => q.slice());
    out.splice(i + 1, 0, [Math.round(p[0]), Math.round(p[1])]);
    return out;
  };

  G.removeCorner = function (pts, i) {
    if (pts.length <= 3) return null;
    const out = pts.map((q) => q.slice());
    out.splice(i, 1);
    return G.area2(out) > 0 ? out : null;
  };

  /** True when no two walls cross each other. */
  G.isSimple = function (pts) {
    const n = pts.length;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const hits = (p1, p2, p3, p4) => {
      const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
        if (hits(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
      }
    }
    return true;
  };

  /** Footprint corners of a box item (centre x,z, size w x d, rotation rot) in plan. */
  G.footprint = function (x, z, w, d, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    // local +x maps to (cos, -sin), local +z maps to (sin, cos) for a rotation around +y.
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => [
      x + lx * c + lz * s,
      z - lx * s + lz * c,
    ]);
  };

  /**
   * Keeps a floor item inside the room and pulls it flush against a wall when it is within `snap` cm.
   * Returns the corrected centre.
   */
  G.keepInside = function (pts, x, z, w, d, rot, snap) {
    const ws = G.walls(pts);
    const c = Math.cos(rot), s = Math.sin(rot);
    const ax = [c, -s], az = [s, c];
    if (!G.pointInPolygon(x, z, pts)) {
      // Dragged outside: bring it back through the nearest wall.
      const nw = G.nearestWall(pts, x, z);
      const p = G.pointOnWall(nw.wall, nw.along);
      x = p[0] + nw.wall.n[0];
      z = p[1] + nw.wall.n[1];
    }
    for (let pass = 0; pass < 3; pass++) {
      for (const wall of ws) {
        const ext = Math.abs((w / 2) * (ax[0] * wall.n[0] + ax[1] * wall.n[1])) + Math.abs((d / 2) * (az[0] * wall.n[0] + az[1] * wall.n[1]));
        const rx = x - wall.a[0], rz = z - wall.a[1];
        const along = rx * wall.dir[0] + rz * wall.dir[1];
        const side = Math.abs((w / 2) * (ax[0] * wall.dir[0] + ax[1] * wall.dir[1])) + Math.abs((d / 2) * (az[0] * wall.dir[0] + az[1] * wall.dir[1]));
        if (along < -side + 1 || along > wall.len + side - 1) continue; // not in front of this wall
        const dist = rx * wall.n[0] + rz * wall.n[1];
        if (dist < -ext - 30) continue; // far behind the wall (other wing of an L-shaped room)
        if (dist < ext || (snap && dist - ext <= snap)) {
          x += (ext - dist) * wall.n[0];
          z += (ext - dist) * wall.n[1];
        }
      }
    }
    return [x, z];
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
  else (root.RD = root.RD || {}).geo = G;
})(typeof window !== 'undefined' ? window : globalThis);
