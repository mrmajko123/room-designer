/* Room Designer: starts the app and connects the 3D view, the panels and the saved rooms. */
(function () {
  const RD = window.RD;
  const U = RD.util, G = RD.geo, C = RD.catalog, S = RD.store, P = RD.panels, I = RD.icons;
  const h = U.h;

  const app = (RD.app = { selection: null, viewer: null, tab: 'room', quiet: false, sheet: null });

  function fillIcons(root) {
    U.$$('[data-icon]', root).forEach((el) => { el.innerHTML = I[el.dataset.icon] || ''; });
  }

  // ------------------------------------------------------------------ changes
  /** Edit the room. opts.merge groups quick repeated edits into one undo step; opts.quiet skips redrawing panels. */
  app.change = function (fn, label, opts) {
    app.quiet = !!(opts && opts.quiet);
    try { S.update(fn, label, opts); } finally { app.quiet = false; }
  };

  function refreshPanels() {
    if (app.tab === 'room' || !U.isPhone()) P.renderRoom();
    if (app.tab === 'photos') P.renderPhotos();
    P.renderInspector(app.inspectorOpen() ? app.selection : null);
    P.renderSelBar(app.selection);
  }

  S.on((why) => {
    app.viewer.sync();
    if (why === 'stuff') { if (app.tab === 'add') P.renderAdd(); return; }
    if (!app.quiet) refreshPanels();
    if (why === 'load' || why === 'undo' || why === 'redo') { if (app.tab === 'add') P.renderAdd(); if (app.tab === 'photos') P.renderPhotos(); }
    U.$('#undo-btn').disabled = !S.history.length;
    U.$('#redo-btn').disabled = !S.future.length;
    U.$('#room-name').textContent = S.project.name;
    document.title = `${S.project.name} · Room Designer`;
  });

  // ------------------------------------------------------------------ selection and panels
  app.inspectorOpen = function () {
    if (!app.selection) return false;
    if (!U.isPhone()) return true;
    return app.sheet === 'inspector';
  };

  app.selectThing = function (sel) { app.viewer.select(sel); };

  app.onSelect = function (sel) {
    app.selection = sel;
    if (U.isPhone()) {
      if (sel && (sel.kind === 'wall' || sel.kind === 'floor')) openSheet('inspector');
      else if (!sel && app.sheet === 'inspector') openSheet(null);
      else if (sel && app.sheet === 'side') openSheet(null);
    }
    P.renderSelBar(sel);
    P.renderInspector(app.inspectorOpen() ? sel : null);
    if (app.tab === 'room') P.renderRoom();
  };

  app.openInspector = function () { openSheet('inspector'); P.renderInspector(app.selection); };
  app.closeInspector = function () {
    if (U.isPhone() && app.selection && (app.selection.kind === 'item' || app.selection.kind === 'opening')) { openSheet(null); P.renderInspector(null); return; }
    app.viewer.select(null);
  };

  function openSheet(which) {
    app.sheet = which;
    const side = U.$('#side');
    if (U.isPhone()) side.classList.toggle('closed', which !== 'side');
    else side.classList.remove('closed');
    U.$$('.bottom-nav [data-tab]').forEach((b) => b.classList.toggle('on', which === 'side' && b.dataset.tab === app.tab));
    if (which !== 'inspector' && U.isPhone()) P.renderInspector(null);
  }

  function setTab(tab) {
    app.tab = tab;
    U.$$('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    for (const t of ['room', 'add', 'photos']) U.$('#panel-' + t).hidden = t !== tab;
    if (tab === 'room') P.renderRoom();
    if (tab === 'add') P.renderAdd();
    if (tab === 'photos') P.renderPhotos();
    app.viewer.showWallNumbers = tab === 'room' || tab === 'photos';
    app.viewer.requestRender();
  }

  // ------------------------------------------------------------------ views
  let hintTimer = null;
  function showHint(text, ms) {
    const el = U.$('#view-hint');
    el.textContent = text;
    el.hidden = !text;
    clearTimeout(hintTimer);
    if (text && ms) hintTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  app.setView = function (v) {
    if (app.viewer.editCorners && v !== 'top') app.viewer.setEditCorners(false);
    app.viewer.setView(v);
    U.$$('.view-seg [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    U.$('#walk-pad').hidden = v !== 'walk' || !U.isTouch();
    const touch = U.isTouch();
    if (v === 'walk') showHint(touch ? 'Drag to look around. Use the arrows to walk.' : 'Drag to look around. Walk with W A S D or the arrow keys.', 5000);
    else if (v === 'top') showHint(app.viewer.editCorners ? 'Drag the corners. Tap + to add a corner, tap a corner to remove it.' : (touch ? 'Plan view: drag to move, pinch to zoom.' : 'Plan view: drag to move, scroll to zoom.'), app.viewer.editCorners ? 0 : 3500);
    else showHint('', 0);
    if (app.tab === 'room') P.renderRoom();
  };

  app.setNight = function (on) {
    S.settings.night = on;
    app.viewer.setNight(on);
    const b = U.$('#night-btn');
    b.innerHTML = on ? I.sun : I.moon;
    b.classList.toggle('on', on);
    b.title = on ? 'Switch to day (N)' : 'Switch to night: see your LEDs glow (N)';
    saveSettings();
  };

  // ------------------------------------------------------------------ room shape
  app.setShape = function (id) {
    const b = G.bounds(S.project.room.points);
    if (id === 'custom') {
      app.change((p) => { p.room.shape = 'custom'; }, 'Room shape');
      app.toggleCornerEdit(true);
      return;
    }
    const pts = id === 'L' ? G.lShape(b.w, b.l, Math.round(b.w * 0.4), Math.round(b.l * 0.4)) : G.rect(b.w, b.l);
    app.change((p) => { S.setOutline(p, pts.map((q) => [q[0] + b.minX, q[1] + b.minZ])); p.room.shape = id; }, 'Room shape');
    if (app.viewer.editCorners) app.toggleCornerEdit(false);
  };

  app.setWallLength = function (i, len) {
    const next = G.setWallLength(S.project.room.points, i, len);
    if (!next || !G.isSimple(next)) { U.toast('That length does not fit with the other walls.'); refreshPanels(); return; }
    app.change((p) => S.setOutline(p, next), `Wall ${i + 1} length`);
  };

  app.toggleCornerEdit = function (force) {
    const on = force == null ? !app.viewer.editCorners : force;
    app.viewer.setEditCorners(on);
    app.setView(on ? 'top' : app.viewer.view);
    if (on && U.isPhone()) openSheet(null);
    P.renderRoom();
  };

  const viewerHooks = {
    project: () => S.project,
    stuff: (id) => S.stuff.get(id),
    update: (fn, label) => app.change(fn, label),
    select: (sel) => app.onSelect(sel),
    cornersChanged: (pts) => {
      if (!G.isSimple(pts) || Math.abs(G.area2(pts)) < 2000 || G.walls(pts).some((w) => w.len < 10)) { U.toast('Walls can\'t cross or be that short.'); app.viewer.requestRender(); return; }
      app.change((p) => { S.setOutline(p, pts); p.room.shape = 'custom'; }, 'Move corner');
    },
    cornerTapped: async (i) => {
      if (S.project.room.points.length <= 3) { U.toast('A room needs at least 3 corners.'); return; }
      if (!(await U.confirm('Remove this corner?', 'The two walls next to it become one straight wall.', 'Remove'))) return;
      const next = G.removeCorner(S.project.room.points, i);
      if (!next || !G.isSimple(next)) { U.toast('That corner can\'t be removed.'); return; }
      app.change((p) => { S.setOutline(p, next); p.room.shape = 'custom'; }, 'Remove corner');
    },
    addCorner: (i) => app.change((p) => { S.setOutline(p, G.splitWall(p.room.points, i)); p.room.shape = 'custom'; }, 'Add corner'),
  };

  app.splitWall = function (i) {
    viewerHooks.addCorner(i);
    app.toggleCornerEdit(true);
    U.toast('Drag the new corner to shape your room.');
  };

  // ------------------------------------------------------------------ adding things
  function placeNew(it) {
    const v = app.viewer;
    const room = S.project.room;
    if (it.mount === 'wall') {
      it.wall = v.facingWall();
      const w = G.walls(room.points)[it.wall];
      if (it.type === 'ledStrip' || it.type === 'fairyLights') it.w = Math.min(it.w, Math.round(w.len - 10));
      it.w = Math.min(it.w, w.len - 2);
      if (it.type === 'ledStrip') it.y = room.height - it.h - 2;
      it.y = U.clamp(it.y, 0, Math.max(0, room.height - it.h - 1));
      it.along = v.freeAlong(it.wall, it.w, null, it.y, it.h);
    } else {
      // beds, desks and closets usually stand against a wall
      const wallish = it.mount === 'floor' && (/^(bed|bunkBed|desk|dresser|wardrobe|bookshelf|tvStand|sofa|nightstand|cubeShelf|shoeRack|clothesRack|radiator|armchair)$/.test(it.type) || it.type === 'custom');
      const spot = v.findSpot(it, wallish);
      it.x = Math.round(spot.x * 2) / 2; it.z = Math.round(spot.z * 2) / 2; it.rot = spot.rot || 0;
    }
    app.change((p) => { p.items.push(it); }, 'Add ' + it.name);
    app.viewer.select({ kind: 'item', id: it.id });
    if (U.isPhone()) openSheet(null);
    if (!S.settings.toldDrag) { S.settings.toldDrag = true; saveSettings(); U.toast(it.mount === 'wall' ? 'Drag it along the wall to move it.' : 'Drag it to move it. Use the buttons below to turn it.'); }
  }

  app.addItem = function (type) {
    const it = C.newItem(type);
    if (/ledStrip|ledBar|neon|hexLights|fairyLights/.test(type) && !app.viewer.night) setTimeout(() => U.toast('Tip: switch to night to see it glow.', { action: { label: 'Night', run: () => app.setNight(true) } }), 300);
    placeNew(it);
  };

  app.addCustom = function (def) {
    placeNew({
      id: U.uid('i'), type: 'custom', customId: def.id, name: def.name, w: def.w, d: def.d, h: def.h,
      color: def.sideColor, color2: def.sideColor, mount: def.mount || 'floor', x: 0, z: 0, rot: 0, y: def.mount === 'wall' ? 110 : 0, opts: {},
    });
  };

  app.refreshStuff = function (def) {
    // copies already in the room keep their size unless it was never changed
    app.change((p) => p.items.forEach((it) => { if (it.customId === def.id) { it.name = def.name; } }), 'Update ' + def.name);
    app.viewer.sync();
    if (app.tab === 'add') P.renderAdd();
  };

  app.stuffMenu = async function (def) {
    const v = await U.modal(def.name, h('p', null, 'Change the photo, size or type of this item, or delete it.'), [
      { label: 'Delete', value: 'del', danger: true },
      { label: 'Add to room', value: 'add' },
      { label: 'Edit', value: 'edit', primary: true },
    ]);
    if (v === 'edit') RD.photos.openStuff(def);
    if (v === 'add') app.addCustom(def);
    if (v === 'del') {
      const used = S.project.items.filter((i) => i.customId === def.id).length;
      if (!(await U.confirm('Delete ' + def.name + '?', used ? `It is also removed from this room (${used}×).` : 'It is removed from your stuff.', 'Delete', true))) return;
      await S.deleteStuff(def.id);
      if (used) app.change((p) => { p.items = p.items.filter((i) => i.customId !== def.id); }, 'Delete ' + def.name);
    }
  };

  app.addOpening = function (type, wallIdx) {
    const d = C.OPENINGS[type];
    const wall = wallIdx != null ? wallIdx : app.viewer.facingWall();
    const w = G.walls(S.project.room.points)[wall];
    const width = Math.min(d.width, w.len - 10);
    const op = { id: U.uid('o'), type, wall, along: app.viewer.freeAlong(wall, width), width, height: Math.min(d.height, S.project.room.height - 5), sill: d.sill, color: d.color };
    app.change((p) => { p.openings.push(op); }, 'Add ' + d.name.toLowerCase());
    app.viewer.select({ kind: 'opening', id: op.id });
  };

  // ------------------------------------------------------------------ editing the selection
  const selItem = () => (app.selection && app.selection.kind === 'item' ? S.project.items.find((i) => i.id === app.selection.id) : null);

  app.rotateSelected = function (deg) {
    const it = selItem();
    if (!it || it.mount === 'wall') return;
    app.change((p) => {
      const t = p.items.find((i) => i.id === it.id);
      let r = (t.rot || 0) + (deg * Math.PI) / 180;
      if (Math.abs(deg) === 90) r = Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
      r = Math.atan2(Math.sin(r), Math.cos(r));
      t.rot = Math.round(r * 10000) / 10000;
      if (t.mount !== 'ceiling' && !(t.y > 0)) [t.x, t.z] = G.keepInside(p.room.points, t.x, t.z, t.w, t.d, t.rot, 0);
    }, 'Turn', { merge: 'turn' + it.id });
  };

  app.nudgeSelected = function (dx, dz) {
    const it = selItem();
    if (!it) return;
    app.change((p) => {
      const t = p.items.find((i) => i.id === it.id);
      if (t.mount === 'wall') t.along = Math.max(t.w / 2, (t.along || 0) + dx);
      else { t.x += dx; t.z += dz; }
    }, 'Move', { merge: 'nudge' + it.id });
  };

  app.duplicateSelected = function () {
    const s = app.selection;
    if (!s) return;
    if (s.kind === 'item') {
      const it = selItem();
      if (!it) return;
      const copy = Object.assign(U.clone(it), { id: U.uid('i'), locked: false });
      if (copy.mount === 'wall') {
        const w = G.walls(S.project.room.points)[copy.wall];
        copy.along = U.clamp(copy.along + copy.w + 10, copy.w / 2, w.len - copy.w / 2);
        if (copy.along === it.along) copy.y = Math.max(0, copy.y - copy.h - 10);
      } else {
        const c = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0);
        copy.x += c * (it.w + 10); copy.z -= sn * (it.w + 10);
        [copy.x, copy.z] = G.keepInside(S.project.room.points, copy.x, copy.z, copy.w, copy.d, copy.rot || 0, 0);
      }
      app.change((p) => p.items.push(copy), 'Duplicate');
      app.viewer.select({ kind: 'item', id: copy.id });
    } else if (s.kind === 'opening') {
      const op = S.project.openings.find((o) => o.id === s.id);
      if (!op) return;
      const copy = Object.assign(U.clone(op), { id: U.uid('o') });
      copy.along = app.viewer.freeAlong(op.wall, op.width, null);
      app.change((p) => p.openings.push(copy), 'Duplicate');
      app.viewer.select({ kind: 'opening', id: copy.id });
    }
  };

  app.deleteSelected = function () {
    const s = app.selection;
    if (!s) return;
    let name = '';
    if (s.kind === 'item') {
      const it = selItem();
      if (!it) return;
      name = it.name;
      app.change((p) => { p.items = p.items.filter((i) => i.id !== s.id); }, 'Delete ' + name);
    } else if (s.kind === 'opening') {
      name = (C.OPENINGS[(S.project.openings.find((o) => o.id === s.id) || {}).type] || {}).name || 'Opening';
      app.change((p) => { p.openings = p.openings.filter((o) => o.id !== s.id); }, 'Delete ' + name);
    } else return;
    app.viewer.select(null);
    U.toast(`Deleted ${name}`, { action: { label: 'Undo', run: () => app.undo() } });
  };

  app.undo = function () { const l = S.undo(); if (l) U.toast(typeof l === 'string' ? 'Undid: ' + l : 'Undone', { timeout: 1600 }); };
  app.redo = function () { const l = S.redo(); if (l) U.toast(typeof l === 'string' ? 'Redid: ' + l : 'Redone', { timeout: 1600 }); };

  app.pickPosterImage = async function (it) {
    const files = await U.pickFiles({});
    if (!files.length) return;
    const ph = await U.readPhoto(files[0], 1600);
    const id = await RD.db.putBlob(ph.blob, { kind: 'poster' });
    app.change((p) => {
      const t = p.items.find((i) => i.id === it.id);
      t.opts.image = id;
      const inset = t.opts.frame === false ? 0 : 6;
      t.h = Math.round(((t.w - inset) * ph.height) / ph.width + inset);
    }, 'Poster picture');
  };

  // ------------------------------------------------------------------ room photos
  app.addRoomPhotos = async function (camera, files) {
    files = files || (await U.pickFiles({ camera, multiple: !camera }));
    if (!files.length) return [];
    const added = [];
    for (const f of files) {
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) continue;
      try {
        const ph = await U.readPhoto(f);
        const id = await RD.db.putBlob(ph.blob, { kind: 'room-photo', focal35: ph.focal35 });
        added.push({ id, w: ph.width, h: ph.height, focal35: ph.focal35, added: Date.now() });
      } catch (e) {
        U.toast(`${f.name}: ${e.message}`);
      }
    }
    if (!added.length) return [];
    app.change((p) => p.photos.push(...added), added.length > 1 ? 'Add photos' : 'Add photo');
    setTab('photos');
    if (U.isPhone()) openSheet('side');
    RD.photos.openWall(added[0]);
    return added;
  };

  app.removeRoomPhoto = async function (ph) {
    if (!(await U.confirm('Remove this photo?', 'Walls already made from it keep their picture.', 'Remove', true))) return;
    app.change((p) => { p.photos = p.photos.filter((x) => x.id !== ph.id); }, 'Remove photo');
  };

  app.wallPhotoFor = async function (i) {
    const photos = S.project.photos;
    if (!photos.length) {
      const added = await app.addRoomPhotos(false);
      void added;
      return;
    }
    const grid = h('div.photo-grid');
    let close;
    for (const ph of photos.slice().reverse()) {
      const card = h('button.photo-card', { onclick: () => { close(null); RD.photos.openWall(ph, { wall: i }); } });
      RD.db.blobUrl(ph.id).then((u) => { if (u) card.style.backgroundImage = `url(${u})`; });
      grid.append(card);
    }
    const v = await U.modal(`Photo for wall ${i + 1}`, h('div', null, h('p.hint', null, 'Pick the photo that shows this wall.'), grid), [{ label: 'Add new photo', value: 'new' }], { onOpen: (dlg, c) => { close = c; } });
    if (v === 'new') {
      const files = await U.pickFiles({ multiple: false });
      if (!files.length) return;
      const ph = await U.readPhoto(files[0]);
      const id = await RD.db.putBlob(ph.blob, { kind: 'room-photo', focal35: ph.focal35 });
      const rec = { id, w: ph.width, h: ph.height, focal35: ph.focal35, added: Date.now() };
      app.change((p) => p.photos.push(rec), 'Add photo');
      RD.photos.openWall(rec, { wall: i });
    }
  };

  // ------------------------------------------------------------------ rooms, files and settings
  async function openRoom(id) {
    const p = await RD.db.get('rooms', id);
    if (!p) return;
    app.viewer.select(null, true);
    app.selection = null;
    app.viewer.cameraPlaced = false;
    S.set(p);
    app.viewer.focusRoom();
    await RD.db.setSetting('lastRoom', p.id);
    refreshPanels();
  }

  async function newRoom() {
    const name = await U.prompt('New room', 'My room', 'Create');
    if (name == null) return;
    await S.saveNow();
    const p = S.blankProject(name || 'My room');
    app.viewer.cameraPlaced = false;
    app.viewer.select(null, true);
    app.selection = null;
    S.set(p);
    S.save();
    app.viewer.focusRoom();
    setTab('room');
    refreshPanels();
  }

  /** Every stored picture a room needs. */
  function blobIds(p, stuffDefs) {
    const ids = new Set(p.photos.map((x) => x.id));
    for (const w of p.room.walls) if (w.photo) { ids.add(w.photo.photoId); ids.add(w.photo.texId); }
    if (p.room.floor.texId) ids.add(p.room.floor.texId);
    for (const it of p.items) if (it.opts && it.opts.image) ids.add(it.opts.image);
    for (const d of stuffDefs) for (const part of [d.front, d.side]) if (part) { ids.add(part.photoId); ids.add(part.texId); }
    ids.delete(undefined); ids.delete(null);
    return Array.from(ids);
  }

  async function exportRoom() {
    await S.saveNow();
    const p = S.project;
    const defs = Array.from(new Set(p.items.filter((i) => i.customId).map((i) => i.customId))).map((id) => S.stuff.get(id)).filter(Boolean);
    const blobs = {};
    for (const id of blobIds(p, defs)) {
      const rec = await RD.db.getBlobRecord(id);
      if (rec && rec.blob) blobs[id] = { data: await U.blobToDataURL(rec.blob), focal35: rec.focal35 || null, kind: rec.kind || null };
    }
    const file = { format: 'room-designer', version: 1, app: RD.VERSION, project: p, stuff: defs, blobs };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    await U.saveFile(blob, `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'room'}.room`);
  }

  async function importRoom(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'room-designer' || !data.project) throw new Error('This is not a Room Designer file.');
      for (const [id, b] of Object.entries(data.blobs || {})) {
        const blob = await U.dataURLToBlob(b.data);
        await RD.db.put('blobs', { id, blob, type: blob.type, created: Date.now(), focal35: b.focal35, kind: b.kind });
      }
      for (const d of data.stuff || []) await S.saveStuff(d);
      const p = data.project;
      const existing = await RD.db.get('rooms', p.id);
      if (existing) { p.id = U.uid('r'); p.name += ' (copy)'; }
      await RD.db.put('rooms', S.normalize(p));
      await openRoom(p.id);
      U.toast(`Opened ${p.name}`);
    } catch (e) {
      U.toast('Could not open the file: ' + e.message);
    }
  }

  async function exportModel() {
    U.toast('Making the 3D model…', { timeout: 1500 });
    try {
      const blob = await app.viewer.exportGLB();
      await U.saveFile(blob, `${S.project.name.replace(/[^\w\- ]+/g, '').trim() || 'room'}.glb`);
    } catch (e) { U.toast('Could not export: ' + e.message); }
  }

  app.screenshot = async function () {
    const blob = await app.viewer.screenshot();
    await U.saveFile(blob, `${S.project.name.replace(/[^\w\- ]+/g, '').trim() || 'room'}.png`);
  };

  function saveSettings() {
    const s = S.settings;
    RD.db.setSetting('settings', { units: s.units, night: s.night, quality: s.quality, cutaway: s.cutaway, snap: s.snap, welcomed: s.welcomed, toldDrag: s.toldDrag }).catch(() => {});
  }

  function applySettings() {
    U.setUnits(S.settings.units);
    app.viewer.setQuality(S.settings.quality);
    app.viewer.setCutaway(S.settings.cutaway !== false);
    app.viewer.snapWalls = S.settings.snap !== false;
  }

  async function roomsMenu() {
    await S.saveNow();
    const rooms = await S.listRooms();
    const body = h('div');
    let close;
    const go = (fn) => () => { close(null); fn(); };
    body.append(h('div.room-list', null, rooms.map((r) => h('button.list-item' + (r.id === S.project.id ? '.on' : ''), { onclick: go(() => r.id !== S.project.id && openRoom(r.id)) },
      h('span', { html: I.room }), h('span.grow', null, r.name, h('small', null, `${(r.items || []).length} things · ${new Date(r.updated || r.created).toLocaleDateString()}`)),
      r.id === S.project.id ? h('span', { html: I.check }) : null))));
    const btn = (icon, label, fn) => h('button', { onclick: go(fn) }, h('span', { html: I[icon] }), label);
    const menu = h('div.menu-list', null,
      btn('plus', 'New room', newRoom),
      btn('file', 'Rename this room', async () => { const n = await U.prompt('Rename room', S.project.name); if (n) app.change((p) => { p.name = n; }, 'Rename room'); }),
      btn('copy', 'Duplicate this room', async () => {
        await S.saveNow();
        const copy = Object.assign(U.clone(S.project), { id: U.uid('r'), name: S.project.name + ' (copy)', created: Date.now(), updated: Date.now() });
        await RD.db.put('rooms', copy);
        await openRoom(copy.id);
        U.toast('Duplicated. You are now editing the copy.');
      }),
      btn('trash', 'Delete this room', async () => {
        if (!(await U.confirm('Delete ' + S.project.name + '?', 'This cannot be undone.', 'Delete', true))) return;
        await RD.db.del('rooms', S.project.id);
        const left = await S.listRooms();
        if (left.length) await openRoom(left[0].id);
        else { S.set(S.blankProject()); S.save(); app.viewer.focusRoom(); }
      }),
      h('hr'),
      btn('camera', 'Save a picture (PNG)', app.screenshot),
      btn('box3d', 'Export 3D model (.glb)', exportModel),
      btn('download', 'Save room file (to back up or share)', exportRoom),
      btn('upload', 'Open room file', async () => { const f = await U.pickFiles({ accept: '.room,application/json' }); if (f.length) importRoom(f[0]); }),
      h('hr'),
      btn('gear', 'Settings', settingsDialog));
    body.append(menu, h('p.about', null, `Room Designer ${RD.VERSION}. Your rooms and photos are saved on this device only.`));
    await U.modal('Your rooms', body, [], { onOpen: (dlg, c) => { close = c; } });
  }

  async function settingsDialog() {
    const s = S.settings;
    const body = h('div');
    const row = (label, control, sub) => h('div.row', null, h('span.lab', null, label, sub ? h('small', { style: { display: 'block', color: 'var(--ink-3)' } }, sub) : null), control);
    const seg = (opts, val, set) => {
      const wrap = h('div.seg.small');
      const draw = (v) => { wrap.innerHTML = ''; opts.forEach(([k, l]) => wrap.append(h('button' + (v === k ? '.on' : ''), { onclick: () => { set(k); draw(k); } }, l))); };
      draw(val);
      return wrap;
    };
    const sw = (val, set) => { const i = h('input', { type: 'checkbox', checked: val }); i.addEventListener('change', () => set(i.checked)); return h('span.switch', null, i, h('span')); };
    body.append(
      row('Units', seg([['metric', 'cm / m'], ['imperial', 'ft / in']], s.units, (v) => { s.units = v; applySettings(); saveSettings(); refreshPanels(); if (app.tab === 'add') P.renderAdd(); app.viewer.requestRender(); })),
      row('Graphics', seg([['high', 'Best'], ['low', 'Fast']], s.quality, (v) => { s.quality = v; applySettings(); saveSettings(); }), 'Use Fast on older phones'),
      row('Hide walls in front', sw(s.cutaway !== false, (v) => { s.cutaway = v; applySettings(); saveSettings(); }), 'So you can see into the room'),
      row('Snap to walls', sw(s.snap !== false, (v) => { s.snap = v; applySettings(); saveSettings(); }), 'Furniture slides flat against walls'));
    await U.modal('Settings', body, [{ label: 'Done', value: 'ok', primary: true }]);
  }

  async function welcome() {
    const body = h('div', null,
      h('ol.steps', null,
        h('li', null, h('span', null, h('b', null, 'Set your room size. '), 'Measure your walls and type the lengths in Room, or build it from photos of your walls.')),
        h('li', null, h('span', null, h('b', null, 'Paint and decorate. '), 'Tap a wall to paint it, pick a floor, and add LEDs, shelves, closets and furniture.')),
        h('li', null, h('span', null, h('b', null, 'Add your own stuff. '), 'Take a photo of your dresser or desk, type its size, and it appears in 3D.'))),
      h('p.hint.small', null, 'Everything is saved on this device. Nothing is uploaded.'));
    await U.modal('Design your room', body, [{ label: 'Let\'s go', value: 'ok', primary: true }]);
    S.settings.welcomed = true;
    saveSettings();
  }

  // ------------------------------------------------------------------ input
  function bindUI() {
    fillIcons(document);
    U.$('#rooms-btn').addEventListener('click', roomsMenu);
    U.$('#undo-btn').addEventListener('click', app.undo);
    U.$('#redo-btn').addEventListener('click', app.redo);
    U.$('#night-btn').addEventListener('click', () => app.setNight(!app.viewer.night));
    U.$('#shot-btn').addEventListener('click', app.screenshot);
    U.$('#focus-btn').addEventListener('click', () => { if (app.viewer.view === 'walk') app.setView('3d'); app.viewer.focusRoom(); });
    U.$$('.view-seg [data-view]').forEach((b) => b.addEventListener('click', () => app.setView(b.dataset.view)));
    U.$$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    U.$$('.bottom-nav [data-tab]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.tab;
      if (app.sheet === 'side' && app.tab === t) { openSheet(null); return; }
      setTab(t);
      openSheet('side');
    }));
    U.$('.bottom-nav [data-action=shot]').addEventListener('click', app.screenshot);

    // swipe a sheet down to close it
    U.$$('.sheet').forEach((sheet) => {
      let y0 = null;
      sheet.addEventListener('touchstart', (e) => { y0 = sheet.scrollTop <= 0 && !e.target.closest('input,select,textarea,.panel,.insp-body') ? e.touches[0].clientY : null; }, { passive: true });
      sheet.addEventListener('touchmove', (e) => {
        if (y0 == null) return;
        if (e.touches[0].clientY - y0 > 70) { y0 = null; if (sheet.id === 'inspector') app.closeInspector(); else openSheet(null); }
      }, { passive: true });
    });

    // walking buttons
    const pad = U.$('#walk-pad');
    const held = new Set();
    const applyPad = () => {
      const f = (held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0);
      const t = (held.has('left') ? 1 : 0) - (held.has('right') ? 1 : 0);
      app.viewer.setWalkInput(f, 0, t);
    };
    pad.querySelectorAll('[data-walk]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); held.add(b.dataset.walk); applyPad(); });
      const up = () => { held.delete(b.dataset.walk); applyPad(); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); app.redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); app.duplicateSelected(); return; }
      if (mod) return;
      if (app.viewer.view === 'walk' && /^(w|a|s|d|q|e|arrowup|arrowdown|arrowleft|arrowright)$/.test(k)) {
        app.viewer.walk.keys.add(k); e.preventDefault(); return;
      }
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); app.deleteSelected(); }
      else if (k === 'escape') app.viewer.select(null);
      else if (k === 'r') app.rotateSelected(e.shiftKey ? -15 : 15);
      else if (k === 'n') app.setNight(!app.viewer.night);
      else if (k === '1') app.setView('3d');
      else if (k === '2') app.setView('top');
      else if (k === '3') app.setView('walk');
      else if (k === 'f') app.viewer.focusRoom();
      else if (k.startsWith('arrow') && app.selection) {
        e.preventDefault();
        const st = e.shiftKey ? 10 : 1;
        app.nudgeSelected(k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0);
      }
    });
    window.addEventListener('keyup', (e) => app.viewer.walk.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => app.viewer.walk.keys.clear());

    // drop photos or room files onto the window
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      const roomFile = files.find((f) => /\.room$|json/i.test(f.name + f.type));
      if (roomFile) { importRoom(roomFile); return; }
      const imgs = files.filter((f) => /^image\//.test(f.type));
      if (imgs.length) app.addRoomPhotos(false, imgs);
    });

    window.addEventListener('resize', U.debounce(() => { openSheet(app.sheet); refreshPanels(); }, 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden) S.saveNow(); });
    window.addEventListener('pagehide', () => S.saveNow());

    // Android back button in the phone app
    const AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (AppPlugin && AppPlugin.addListener) {
      AppPlugin.addListener('backButton', () => {
        const dlg = document.querySelector('dialog[open]');
        if (dlg) { if (dlg.closeWith) dlg.closeWith(null); else dlg.close(); return; }
        if (app.sheet) { openSheet(null); return; }
        if (app.selection) { app.viewer.select(null); return; }
        if (app.viewer.view !== '3d') { app.setView('3d'); return; }
        if (AppPlugin.minimizeApp) AppPlugin.minimizeApp();
      });
    }
  }

  // ------------------------------------------------------------------ start
  async function start() {
    try {
      const saved = await RD.db.setting('settings', null);
      const lang = (navigator.language || 'en').toLowerCase();
      Object.assign(S.settings, { units: /^en-(us|lr|mm)$/.test(lang) ? 'imperial' : 'metric' }, saved || {});
      U.setUnits(S.settings.units);
      await S.loadStuff();
      app.viewer = new RD.Viewer(U.$('#stage'), viewerHooks);
      bindUI();
      applySettings();
      const lastId = await RD.db.setting('lastRoom', null);
      let p = lastId ? await RD.db.get('rooms', lastId) : null;
      if (!p) { const all = await S.listRooms(); p = all[0] || null; }
      S.set(p || S.blankProject());
      if (!p) S.save();
      app.setNight(!!S.settings.night);
      openSheet(U.isPhone() ? null : 'side');
      setTab('room');
      refreshPanels();
      U.$('#app').classList.remove('loading');
      if (!S.settings.welcomed && !/[?&]nowelcome/.test(location.search)) welcome();
    } catch (e) {
      console.error(e);
      U.$('#boot').innerHTML = '';
      U.$('#boot').append(h('p', null, 'Room Designer could not start: ' + (e && e.message)), h('p.hint', null, 'Your device or browser may not support 3D graphics (WebGL).'));
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  start();
})();
