/* Room Designer: the current room (project), undo/redo and saving. */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util, G = RD.geo, C = RD.catalog;

  const listeners = new Set();
  const S = (RD.store = {
    project: null,
    stuff: new Map(), // id -> custom item made from photos
    history: [],
    future: [],
    settings: { units: 'metric', night: false, quality: 'high', cutaway: true, snap: true },
  });

  S.on = (fn) => listeners.add(fn);
  const emit = (why) => listeners.forEach((fn) => fn(why));

  // ------------------------------------------------------------------ new rooms
  S.blankProject = function (name) {
    const pts = G.rect(400, 330);
    const p = {
      id: U.uid('r'), name: name || 'My room', created: Date.now(), updated: Date.now(), version: 1,
      room: {
        points: pts, height: 250, thickness: 12,
        walls: pts.map(() => ({ finish: 'paint', color: '#f4f1ea' })),
        floor: { type: 'wood', color: '#b98a5a' },
        ceiling: { color: '#ffffff' },
        led: { on: false, color: '#9b5cff', mode: 'solid', where: 'ceiling', brightness: 1 },
      },
      openings: [
        { id: U.uid('o'), type: 'door', wall: 3, along: 60, width: 82, height: 205, sill: 0, color: '#f4f1ea' },
        { id: U.uid('o'), type: 'window', wall: 1, along: 165, width: 120, height: 130, sill: 90, color: '#ffffff' },
      ],
      items: [],
      photos: [],
    };
    const light = C.newItem('ceilingLight', { x: 200, z: 165 });
    p.items.push(light);
    return p;
  };

  /** Makes older or imported rooms complete. */
  S.normalize = function (p) {
    p.room = p.room || {};
    const r = p.room;
    r.points = G.normalize(r.points && r.points.length >= 3 ? r.points : G.rect(400, 330));
    r.height = r.height || 250;
    r.thickness = r.thickness || 12;
    r.walls = r.walls || [];
    while (r.walls.length < r.points.length) r.walls.push(Object.assign({}, r.walls[r.walls.length - 1] || { finish: 'paint', color: '#f4f1ea' }, { photo: null }));
    r.walls.length = r.points.length;
    r.floor = r.floor || { type: 'wood', color: '#b98a5a' };
    r.ceiling = r.ceiling || { color: '#ffffff' };
    r.led = r.led || { on: false, color: '#9b5cff', mode: 'solid', where: 'ceiling', brightness: 1 };
    p.openings = p.openings || [];
    p.items = p.items || [];
    p.photos = p.photos || [];
    for (const it of p.items) { it.opts = it.opts || {}; it.mount = it.mount || 'floor'; }
    return p;
  };

  // ------------------------------------------------------------------ changes, undo and redo
  S.set = function (project) {
    S.project = S.normalize(project);
    S.history = [];
    S.future = [];
    emit('load');
  };

  /** Changes the room: fn(project) edits it in place. One undo step per call. */
  S.update = function (fn, label, opts) {
    const before = JSON.stringify(S.project);
    fn(S.project);
    const after = JSON.stringify(S.project);
    if (before === after) return;
    if (!(opts && opts.noHistory)) {
      const last = S.history[S.history.length - 1];
      // typing in a box or dragging a slider: merge into one step
      if (opts && opts.merge && last && last.merge === opts.merge && Date.now() - last.t < 1500) last.t = Date.now();
      else S.history.push({ state: before, label, t: Date.now(), merge: opts && opts.merge });
      if (S.history.length > 150) S.history.shift();
      S.future = [];
    }
    S.project.updated = Date.now();
    emit('change');
    S.save();
  };

  S.undo = function () {
    const h = S.history.pop();
    if (!h) return false;
    S.future.push({ state: JSON.stringify(S.project), label: h.label });
    S.project = JSON.parse(h.state);
    emit('undo');
    S.save();
    return h.label || true;
  };

  S.redo = function () {
    const f = S.future.pop();
    if (!f) return false;
    S.history.push({ state: JSON.stringify(S.project), label: f.label, t: 0 });
    S.project = JSON.parse(f.state);
    emit('redo');
    S.save();
    return f.label || true;
  };

  // ------------------------------------------------------------------ saving
  const saveNow = async () => {
    if (!S.project) return;
    try {
      await RD.db.put('rooms', JSON.parse(JSON.stringify(S.project)));
      await RD.db.setSetting('lastRoom', S.project.id);
    } catch (e) {
      U.toast('Could not save: ' + (e.message || 'storage is full'));
    }
  };
  S.save = U.debounce(saveNow, 400);
  S.saveNow = () => S.save.flush();

  S.listRooms = async () => (await RD.db.all('rooms')).sort((a, b) => (b.updated || 0) - (a.updated || 0));

  S.loadStuff = async function () {
    S.stuff = new Map((await RD.db.all('stuff')).map((d) => [d.id, d]));
  };

  S.saveStuff = async function (def) {
    S.stuff.set(def.id, def);
    await RD.db.put('stuff', def);
    emit('stuff');
  };

  S.deleteStuff = async function (id) {
    const def = S.stuff.get(id);
    S.stuff.delete(id);
    await RD.db.del('stuff', id);
    emit('stuff');
    return def;
  };

  // ------------------------------------------------------------------ room shape changes
  /**
   * Replaces the room outline. Doors, windows and wall items stay where they were in the room
   * (moved to whichever wall is now closest), and walls keep their paint.
   */
  S.setOutline = function (p, newPts) {
    const oldPts = p.room.points;
    const oldWalls = G.walls(oldPts);
    newPts = G.normalize(newPts);
    const sameCount = newPts.length === oldPts.length;
    const remap = (wallIdx, along) => {
      const w = oldWalls[wallIdx] || oldWalls[0];
      const pt = G.pointOnWall(w, U.clamp(along, 0, w.len));
      const nw = G.nearestWall(newPts, pt[0], pt[1]);
      return { wall: nw.i, along: nw.along };
    };
    if (!sameCount) {
      const newWalls = G.walls(newPts);
      // each new wall takes the finish of the old wall closest to its middle
      p.room.walls = newWalls.map((w) => {
        const mid = G.pointOnWall(w, w.len / 2);
        const old = G.nearestWall(oldPts, mid[0], mid[1]);
        return U.clone(p.room.walls[old.i] || { finish: 'paint', color: '#f4f1ea' });
      });
      for (const o of p.openings) Object.assign(o, remap(o.wall, o.along));
      for (const it of p.items) if (it.mount === 'wall') Object.assign(it, remap(it.wall, it.along));
    } else {
      // same walls, new lengths: keep things at the same distance from the start of their wall
      const nws = G.walls(newPts);
      for (const o of p.openings) { const w = nws[o.wall]; if (w) o.along = U.clamp(o.along, o.width / 2, Math.max(o.width / 2, w.len - o.width / 2)); }
      for (const it of p.items) if (it.mount === 'wall') { const w = nws[it.wall]; if (w) it.along = U.clamp(it.along, Math.min(it.w / 2, w.len / 2), Math.max(w.len - it.w / 2, w.len / 2)); }
    }
    p.room.points = newPts;
  };

  /** Puts an item on the floor, a wall or the ceiling, keeping it where it is. */
  S.setMount = function (p, it, mount, viewer) {
    if (it.mount === mount) return;
    const pose = viewer.itemPose(it);
    if (mount === 'wall') {
      const nw = G.nearestWall(p.room.points, pose.x, pose.z);
      it.wall = nw.i; it.along = nw.along; it.y = U.clamp(pose.y || 100, 0, p.room.height - it.h);
      if (!pose.y) it.y = Math.min(120, p.room.height - it.h);
    } else {
      const off = it.mount === 'wall' ? Math.max(it.d / 2 + 2, 10) : 0;
      const nw = it.mount === 'wall' ? G.walls(p.room.points)[pose.wall] : null;
      it.x = pose.x + (nw ? nw.n[0] * (off - it.d / 2) : 0);
      it.z = pose.z + (nw ? nw.n[1] * (off - it.d / 2) : 0);
      it.rot = pose.rot;
      it.y = 0;
    }
    it.mount = mount;
  };
})();
