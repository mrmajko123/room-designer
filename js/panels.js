/* Room Designer: side panels (Room, Add, Photos), the selection panel and the floating toolbar. */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util, G = RD.geo, T = RD.tex, C = RD.catalog, I = RD.icons;
  const h = U.h;
  const P = (RD.panels = {});
  const app = () => RD.app;
  const store = () => RD.store;
  const proj = () => RD.store.project;

  // ------------------------------------------------------------------ small widgets
  const icon = (name) => h('span', { html: I[name] || '' });

  function section(title, ...children) {
    return h('div.sec', null, title ? h('h3', null, title) : null, ...children);
  }

  /** Length box: shows the current unit, accepts "2.5m", "8'2\"" etc. Calls onCommit(cm). */
  function lenInput(cm, onCommit, opts) {
    opts = opts || {};
    const input = h('input.len', { type: 'text', inputmode: 'decimal', value: U.lenInputValue(cm), 'aria-label': opts.label || 'Length', dataset: { k: opts.key || '' } });
    const commit = () => {
      let v = U.parseLen(input.value);
      if (isNaN(v)) { input.value = U.lenInputValue(cm); return; }
      if (opts.min != null) v = Math.max(opts.min, v);
      if (opts.max != null) v = Math.min(opts.max, v);
      v = Math.round(v * 10) / 10;
      if (Math.abs(v - cm) < 0.05) { input.value = U.lenInputValue(cm); return; }
      onCommit(v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * (U.units === 'imperial' ? 2.54 : 1);
        const v = (U.parseLen(input.value) || cm) + (e.key === 'ArrowUp' ? step : -step);
        input.value = U.lenInputValue(v);
        commit();
      }
    });
    input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
    return h('div.len-wrap', null, input, h('i', null, U.unitLabel()));
  }

  function field(label, control) { return h('label.field', null, h('span', null, label), control); }

  function toggle(checked, onChange, key) {
    const input = h('input', { type: 'checkbox', checked: !!checked, dataset: { k: key || '' } });
    input.addEventListener('change', () => onChange(input.checked));
    return h('span.switch', null, input, h('span'));
  }

  function selectBox(options, value, onChange, key) {
    const s = h('select.sel', { dataset: { k: key || '' } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  /** Colour picker: swatches plus a free colour. onChange(hex, done). */
  function colorPicker(value, onChange, opts) {
    opts = opts || {};
    const list = opts.swatches || T.SWATCHES;
    const sw = h('div.swatches', null, list.map((c) => h('button.swatch' + (c.toLowerCase() === String(value).toLowerCase() ? '.on' : ''), {
      style: { background: c }, title: c, 'aria-label': 'Colour ' + c, onclick: () => onChange(c, true),
    })));
    const input = h('input.color-input', { type: 'color', value: value || '#ffffff', 'aria-label': 'Pick any colour', dataset: { k: opts.key || '' } });
    const hex = h('span.hex', null, String(value || '').toUpperCase());
    input.addEventListener('input', () => { hex.textContent = input.value.toUpperCase(); onChange(input.value, false); });
    input.addEventListener('change', () => onChange(input.value, true));
    return h('div.picker', null, opts.noSwatches ? null : sw, h('div.color-row', null, input, h('span.hint', null, opts.label || 'Any colour'), hex));
  }

  function keepFocus(container, render) {
    const a = document.activeElement;
    const key = a && container.contains(a) && a.dataset && a.dataset.k;
    const scroll = container.scrollTop;
    render();
    container.scrollTop = scroll;
    if (key) {
      const el = container.querySelector(`[data-k="${CSS.escape(key)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  const LED_COLORS = ['#ff2d55', '#ff7a00', '#ffd400', '#30ff6a', '#00e5ff', '#2f6bff', '#9b5cff', '#ff4fd8', '#ffffff', '#ffd9a0'];

  const SHAPE_SVG = {
    rect: '<svg viewBox="0 0 44 34"><rect x="5" y="4" width="34" height="26" rx="1" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    L: '<svg viewBox="0 0 44 34"><path d="M5 4h34v14H24v12H5Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>',
    custom: '<svg viewBox="0 0 44 34"><path d="M6 8 22 4l17 7-4 19H9Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="22" cy="4" r="2.6" fill="currentColor"/><circle cx="39" cy="11" r="2.6" fill="currentColor"/></svg>',
  };

  // ------------------------------------------------------------------ Room panel
  P.renderRoom = function () {
    const el = U.$('#panel-room');
    keepFocus(el, () => {
      el.innerHTML = '';
      const p = proj();
      const room = p.room;
      const ws = G.walls(room.points);
      const shape = room.shape || (room.points.length === 4 && isRect(room.points) ? 'rect' : room.points.length === 6 ? 'L' : 'custom');

      // Shape & size
      const shapes = h('div.shapes', null, [['rect', 'Rectangle'], ['L', 'L-shape'], ['custom', 'Any shape']].map(([id, name]) =>
        h('button.shape-btn' + (shape === id ? '.on' : ''), { onclick: () => app().setShape(id) }, h('span', { html: SHAPE_SVG[id] }), name)));
      const size = h('div');
      if (shape === 'rect') {
        size.append(h('div.grid2', null,
          field('Width (wall 1)', lenInput(ws[0].len, (v) => app().setWallLength(0, v), { min: 50, max: 5000, key: 'w0' })),
          field('Length (wall 2)', lenInput(ws[1].len, (v) => app().setWallLength(1, v), { min: 50, max: 5000, key: 'w1' }))));
      } else {
        size.append(h('div.wall-list', null, ws.map((w, i) => {
          const wall = room.walls[i] || {};
          const dot = h('span.wall-num', { style: { background: wall.finish === 'paint' || !wall.finish ? wall.color : '#ddd' } }, String(i + 1));
          return h('div.wall-row' + (isSel('wall', i) ? '.on' : ''), null, dot,
            h('span.lab', { onclick: () => app().selectThing({ kind: 'wall', index: i }) }, 'Wall ' + (i + 1)),
            lenInput(w.len, (v) => app().setWallLength(i, v), { min: 20, max: 5000, key: 'wl' + i, label: 'Length of wall ' + (i + 1) }));
        })));
        if (shape === 'custom') {
          size.append(h('div.row', null, h('span.lab', null, 'Move corners in the plan view'),
            h('button.btn' + (app().viewer.editCorners ? '.primary' : ''), { onclick: () => app().toggleCornerEdit() }, icon('corner'), app().viewer.editCorners ? 'Done' : 'Edit corners')));
        }
      }
      el.append(section('Shape & size', shapes, h('div', { style: { height: '10px' } }), size,
        h('div.grid2', { style: { marginTop: '10px' } },
          field(G.hasSlopes(room) ? 'Highest ceiling' : 'Ceiling height', lenInput(room.height, (v) => app().change((q) => { q.room.height = v; }, 'Ceiling height'), { min: 150, max: 800, key: 'height' })),
          field('Floor area', h('div.hint', { style: { padding: '9px 0' } }, areaText(room.points)))),
        h('p.hint.small', { style: { marginTop: '8px' } }, 'Tip: measure along the floor from corner to corner. Type it in centimetres (350) or metres (3.5m).')));

      // Sloped ceiling (attic rooms)
      el.append(section('Sloped ceiling', slopeEditor(room, ws),
        h('p.hint.small', { style: { marginTop: '8px' } }, 'For attic rooms: pick the low walls the ceiling slopes up from. The ceiling height above is the highest point.')));

      // Compass
      el.append(section('Compass', h('div.row', null,
        h('span.lab', null, 'Looking at wall 1, you face'),
        h('div', { style: { width: '130px' } }, selectBox([['', 'Not set']].concat(COMPASS.map(([deg, name]) => [deg, `${deg}° ${name}`])),
          room.facing == null ? '' : String(room.facing), (v) => app().change((q) => { q.room.facing = v === '' ? null : Number(v); }, 'Compass'), 'facing')))));

      // Paint
      const allSame = room.walls.every((w) => (w.finish || 'paint') === 'paint' && w.color === room.walls[0].color);
      el.append(section('Paint all walls',
        colorPicker(allSame ? room.walls[0].color : '', (c, done) => app().change((q) => q.room.walls.forEach((w) => { w.finish = 'paint'; w.color = c; }), 'Paint walls', { merge: 'paintall', quiet: !done }), { key: 'paintall' }),
        h('p.hint.small', { style: { marginTop: '8px' } }, 'To paint one wall, tap it in the 3D view.')));

      // Floor
      el.append(section('Floor', floorEditor(room.floor)));

      // Ceiling
      el.append(section('Ceiling', colorPicker(room.ceiling.color, (c, done) => app().change((q) => { q.room.ceiling.color = c; }, 'Ceiling colour', { merge: 'ceil', quiet: !done }), { noSwatches: true, label: 'Ceiling colour', key: 'ceil' })));

      // Doors & windows
      const addBtns = h('div.grid2', null, Object.entries(C.OPENINGS).map(([type, d]) =>
        h('button.btn', { onclick: () => app().addOpening(type) }, icon(type === 'window' ? 'window' : 'door'), d.name)));
      const list = h('div.list', { style: { marginTop: '10px' } }, p.openings.map((o) =>
        h('button.list-item' + (isSel('opening', o.id) ? '.on' : ''), { onclick: () => app().selectThing({ kind: 'opening', id: o.id }) },
          icon(o.type === 'window' ? 'window' : 'door'),
          h('span.grow', null, (C.OPENINGS[o.type] || {}).name || 'Opening', h('small', null, `Wall ${o.wall + 1} · ${U.fmtLen(o.width)} × ${U.fmtLen(o.height)}`)))));
      el.append(section('Doors & windows', addBtns, p.openings.length ? list : h('p.hint.small', { style: { marginTop: '8px' } }, 'No doors or windows yet.')));

      // LED strip around the room
      const led = room.led;
      const ledBody = h('div');
      ledBody.append(h('div.row', null, h('span.lab', null, 'LED strip around the whole room'), toggle(led.on, (on) => app().change((q) => { q.room.led.on = on; if (on && !app().viewer.night) app().setNight(true); }, 'LED strip'), 'ledon')));
      if (led.on) {
        ledBody.append(
          colorPicker(led.color, (c, done) => app().change((q) => { q.room.led.color = c; }, 'LED colour', { merge: 'ledc', quiet: !done }), { swatches: LED_COLORS, key: 'ledc' }),
          h('div.grid2', { style: { marginTop: '10px' } },
            field('Effect', selectBox([['solid', 'Solid colour'], ['breathe', 'Breathing'], ['cycle', 'Colour cycle'], ['rainbow', 'Rainbow flow']], led.mode, (v) => app().change((q) => { q.room.led.mode = v; }, 'LED effect'), 'ledm')),
            field('Where', selectBox([['ceiling', 'Along the ceiling'], ['floor', 'Along the floor']], led.where, (v) => app().change((q) => { q.room.led.where = v; }, 'LED position'), 'ledw'))),
          h('div.row', null, h('span.lab', null, 'Brightness'), rangeInput(led.brightness || 1, 0.2, 2, 0.1, (v, done) => app().change((q) => { q.room.led.brightness = v; }, 'LED brightness', { merge: 'ledb', quiet: !done }))));
      }
      ledBody.append(h('p.hint.small', null, 'Switch to night mode (moon button) to see the glow. Add single LED strips behind your bed or desk from Add → LEDs & lights.'));
      el.append(section('LED lights', ledBody));
    });
  };

  const COMPASS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']].concat(
    Array.from({ length: 24 }, (_, k) => [k * 15, '']).filter(([d]) => d % 45 !== 0)).sort((a, b) => a[0] - b[0]);

  /** Low "knee" walls the ceiling slopes up from: on/off, height and how far the slope reaches. */
  function slopeEditor(room, ws, only) {
    const box = h('div.slopes');
    ws.forEach((w, i) => {
      if (only != null && i !== only) return;
      const sl = (room.walls[i] || {}).slope;
      const row = h('div.slope-row');
      row.append(h('div.row', null, h('span.lab', null, only != null ? 'Ceiling slopes up from this wall' : `Wall ${i + 1} (${U.fmtLen(w.len)})`),
        toggle(!!sl, (on) => app().change((q) => {
          q.room.walls[i].slope = on ? { knee: Math.min(110, Math.round(q.room.height * 0.4)), run: Math.round(Math.min(200, (G.bounds(q.room.points).l || 300) / 3)) } : null;
        }, on ? 'Sloped ceiling' : 'Flat ceiling'), 'slope' + i)));
      if (sl) {
        const info = G.slopeInfo(room, sl);
        row.append(h('div.grid2', null,
          field('Low wall height', lenInput(sl.knee, (v) => app().change((q) => { q.room.walls[i].slope.knee = v; }, 'Slope'), { min: 0, max: room.height - 5, key: 'knee' + i })),
          field('Slope reaches the top after', lenInput(sl.run, (v) => app().change((q) => { q.room.walls[i].slope.run = v; }, 'Slope'), { min: 5, max: 2000, key: 'run' + i }))),
        h('p.hint.small', null, `${Math.round(info.angle)}° slope, ${U.fmtLen(info.length)} along the slant. "Reaches the top after" is measured along the floor, from the wall.`));
      }
      box.append(row);
    });
    return box;
  }

  function rangeInput(value, min, max, step, onChange) {
    const r = h('input', { type: 'range', min, max, step, value });
    r.addEventListener('input', () => onChange(parseFloat(r.value), false));
    r.addEventListener('change', () => onChange(parseFloat(r.value), true));
    return r;
  }

  function isRect(pts) {
    const ws = G.walls(pts);
    return ws.every((w, i) => { const n = ws[(i + 1) % 4]; return Math.abs(w.dir[0] * n.dir[0] + w.dir[1] * n.dir[1]) < 0.01; });
  }

  function areaText(pts) {
    const a = Math.abs(G.area2(pts)) / 2 / 10000;
    return U.units === 'imperial' ? `${Math.round(a * 10.7639)} sq ft` : `${a.toFixed(1)} m²`;
  }

  function isSel(kind, id) {
    const s = app().selection;
    return s && s.kind === kind && (s.id === id || s.index === id);
  }

  function texPreview(type, color, color2) {
    const t = T.pattern(type, color, color2);
    if (!t) return null;
    try { return t.image.toDataURL('image/jpeg', 0.7); } catch (e) { return null; }
  }

  function floorEditor(fl) {
    const box = h('div');
    const tiles = h('div.tiles', null, T.FLOORS.map((f) => {
      const on = (fl.type || 'wood') === f.id;
      const col = on && fl.type !== 'photo' ? fl.color : f.color;
      const url = texPreview(f.id, col, f.color2);
      return h('button.tile' + (on ? '.on' : ''), {
        onclick: () => app().change((q) => { q.room.floor = { type: f.id, color: on ? q.room.floor.color : f.color, color2: f.color2 }; }, 'Floor'),
      }, h('span.tex', { style: url ? { backgroundImage: `url(${url})` } : { background: col } }), f.name);
    }));
    box.append(tiles);
    if (fl.type === 'photo') {
      box.append(h('p.hint.small', { style: { marginTop: '8px' } }, 'Using a picture of your floor. Pick another floor above to stop.'));
      box.append(h('div.row', null, h('span.lab', null, 'Size of one copy of the picture'),
        h('div', { style: { width: '120px' } }, lenInput(fl.sizeCm || 100, (v) => app().change((q) => { q.room.floor.sizeCm = v; }, 'Floor picture size'), { min: 10, max: 1000, key: 'fsize' }))));
    } else {
      box.append(h('div', { style: { marginTop: '10px' } }, colorPicker(fl.color, (c, done) => app().change((q) => { q.room.floor.color = c; }, 'Floor colour', { merge: 'floorc', quiet: !done }), { noSwatches: true, label: 'Floor colour', key: 'floorc' })));
    }
    return box;
  }

  // ------------------------------------------------------------------ Add panel (catalogue)
  const thumbs = new Map();
  let addState = { cat: 'all', q: '' };
  let thumbQueue = [];

  function queueThumb(key, make, img) {
    if (thumbs.has(key)) { img.style.backgroundImage = `url(${thumbs.get(key)})`; return; }
    thumbQueue.push({ key, make, img });
    if (thumbQueue.length === 1) setTimeout(drainThumbs, 30);
  }
  function drainThumbs() {
    const start = performance.now();
    while (thumbQueue.length && performance.now() - start < 24) {
      const { key, make, img } = thumbQueue.shift();
      try {
        if (!thumbs.has(key)) thumbs.set(key, make());
        img.style.backgroundImage = `url(${thumbs.get(key)})`;
      } catch (e) { /* preview failed: keep the blank card */ }
    }
    if (thumbQueue.length) setTimeout(drainThumbs, 16);
  }

  P.renderAdd = function () {
    const el = U.$('#panel-add');
    keepFocus(el, () => {
      el.innerHTML = '';
      thumbQueue = [];
      const search = h('input.text', { type: 'search', placeholder: 'Search: bed, LED, shelf…', value: addState.q, dataset: { k: 'search' } });
      search.addEventListener('input', U.debounce(() => { addState.q = search.value.trim().toLowerCase(); P.renderAdd(); }, 150));
      el.append(h('div.search', null, h('span', { html: I.search }), search));
      const cats = [{ id: 'all', name: 'All' }].concat(C.CATEGORIES);
      el.append(h('div.chips', null, cats.map((c) => h('button.chip' + (addState.cat === c.id ? '.on' : ''), { onclick: () => { addState.cat = c.id; P.renderAdd(); } }, c.name))));

      const q = addState.q;
      const match = (name) => !q || name.toLowerCase().includes(q);
      const mine = Array.from(store().stuff.values()).sort((a, b) => (b.created || 0) - (a.created || 0));
      let any = false;
      for (const cat of C.CATEGORIES) {
        if (addState.cat !== 'all' && addState.cat !== cat.id) continue;
        const cards = [];
        if (cat.id === 'mine') {
          if (!q) cards.push(h('button.card.add-own', { onclick: () => RD.scanning.openAdd() }, h('span.pic', { html: I.scanqr }), 'Scan my stuff'));
          for (const def of mine) {
            if (!match(def.name)) continue;
            const pic = h('span.pic');
            const picId = def.thumbId || (def.front && def.front.texId);
            if (picId) RD.db.blobUrl(picId).then((u) => { if (u) pic.style.backgroundImage = `url(${u})`; });
            const more = h('button.card-more', { title: 'Edit or delete', 'aria-label': 'Edit ' + def.name, html: I.more });
            more.addEventListener('click', (e) => { e.stopPropagation(); app().stuffMenu(def); });
            cards.push(h('div.card', { role: 'button', tabindex: 0, onclick: () => app().addCustom(def) }, pic, h('span.nm', null, def.name), more));
          }
          if (!mine.length && q) continue;
        } else {
          for (const [type, d] of Object.entries(C.ITEMS)) {
            if (d.cat !== cat.id || !match(d.name + ' ' + type)) continue;
            const pic = h('span.pic');
            queueThumb(type, () => app().viewer.thumbnail(C.newItem(type)), pic);
            cards.push(h('button.card', { onclick: () => app().addItem(type), title: `${d.name} (${U.fmtLen(d.w)} × ${U.fmtLen(d.d)})` }, pic, h('span.nm', null, d.name)));
          }
        }
        if (!cards.length) continue;
        any = true;
        el.append(h('div.cat-title', null, cat.name), h('div.cards', null, cards));
        if (cat.id === 'mine' && !mine.length) el.append(h('p.hint.small', { style: { marginTop: '8px' } }, 'Scan your own dresser, desk or anything else in 3D with your phone, check its size, and it appears in your room looking like the real thing.'));
      }
      if (!any) el.append(h('p.empty', null, 'Nothing found. Try another word, or add your own item from a photo.'));
    });
  };

  // ------------------------------------------------------------------ Photos panel
  P.renderPhotos = function () {
    const el = U.$('#panel-photos');
    el.innerHTML = '';
    const p = proj();
    el.append(section('Build your room from photos',
      h('ol.steps', null,
        h('li', null, 'Stand back and take a photo of each wall, with the corners where it meets the floor and ceiling in the picture.'),
        h('li', null, 'Tap the photo and drag the 4 dots onto those corners.'),
        h('li', null, 'Room Designer straightens the photo, measures the wall and puts it on your 3D room, or just copies the wall colour.')),
      h('div.btn-row', null,
        h('button.btn.primary', { onclick: () => app().addRoomPhotos(true) }, icon('camera'), 'Take photo'),
        h('button.btn', { onclick: () => app().addRoomPhotos(false) }, icon('photo'), 'Choose photos'))));
    const grid = h('div.photo-grid');
    for (const ph of p.photos.slice().reverse()) {
      const used = [];
      p.room.walls.forEach((w, i) => { if (w.photo && w.photo.photoId === ph.id) used.push('Wall ' + (i + 1)); });
      if (p.room.floor.photo && p.room.floor.photo.photoId === ph.id) used.push('Floor');
      const card = h('button.photo-card', { onclick: () => RD.photos.openWall(ph), title: 'Use this photo' },
        used.length ? h('span.badge', null, used.join(', ')) : h('span.badge', null, 'Tap to use'));
      RD.db.blobUrl(ph.id).then((u) => { if (u) card.style.backgroundImage = `url(${u})`; });
      const x = h('button.x', { 'aria-label': 'Remove photo', title: 'Remove photo', html: I.close });
      x.addEventListener('click', (e) => { e.stopPropagation(); app().removeRoomPhoto(ph); });
      card.append(x);
      grid.append(card);
    }
    el.append(p.photos.length ? grid : h('p.empty', null, 'No photos yet.'));
    el.append(section('Your own furniture',
      h('p.hint', null, 'Scan your dresser, desk, bed or anything else in 3D with your phone, so your room looks like your real room.'),
      h('div', { style: { height: '10px' } }),
      h('button.btn.block.primary', { onclick: () => RD.scanning.openAdd() }, icon('scanqr'), 'Scan my own stuff')));
  };

  // ------------------------------------------------------------------ selection panel
  P.renderInspector = function (sel) {
    const el = U.$('#inspector');
    if (!sel) { el.hidden = true; el.innerHTML = ''; return; }
    const p = proj();
    keepFocus(el, () => {
      el.innerHTML = '';
      if (sel.kind === 'item') {
        const it = p.items.find((i) => i.id === sel.id);
        if (it) itemInspector(el, it);
      } else if (sel.kind === 'opening') {
        const op = p.openings.find((o) => o.id === sel.id);
        if (op) openingInspector(el, op);
      } else if (sel.kind === 'wall') wallInspector(el, sel.index);
      else if (sel.kind === 'floor') {
        el.append(head('Floor', areaText(p.room.points)), h('div.insp-body', null, section('', floorEditor(p.room.floor))));
      }
    });
    el.hidden = !el.childElementCount;
  };

  function head(title, sub, onRename) {
    const close = h('button.icon-btn', { 'aria-label': 'Close', title: 'Close', html: I.close, onclick: () => app().closeInspector() });
    let t;
    if (onRename) {
      const input = h('input', { type: 'text', value: title, 'aria-label': 'Name', dataset: { k: 'name' } });
      input.addEventListener('change', () => onRename(input.value.trim() || title));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      t = h('div.title', null, input, sub ? h('small', null, sub) : null);
    } else t = h('div.title', null, h('h2', { style: { fontSize: '16px' } }, title), sub ? h('small', null, sub) : null);
    return h('div.insp-head', null, h('div.sheet-grip', { style: { position: 'absolute', left: '50%', top: '0', translate: '-50% 0' } }), t, close);
  }

  function itemInspector(el, it) {
    const def = it.type === 'custom' ? store().stuff.get(it.customId) : C.def(it.type);
    const typeName = it.type === 'custom' ? 'My stuff' : (def ? def.name : it.type);
    const upd = (fn, label, opts) => app().change((q) => { const t = q.items.find((i) => i.id === it.id); if (t) fn(t, q); }, label, opts);
    el.append(head(it.name, typeName !== it.name ? typeName : (it.mount === 'wall' ? 'On a wall' : it.mount === 'ceiling' ? 'On the ceiling' : 'On the floor'), (name) => upd((t) => { t.name = name; }, 'Rename')));
    const body = h('div.insp-body');
    el.append(body);

    // size
    const lim = { min: 1, max: 2000 };
    body.append(section('Size', h('div.grid3', null,
      field('Width', lenInput(it.w, (v) => upd((t) => { t.w = v; }, 'Resize'), Object.assign({ key: 'iw' }, lim))),
      field(it.mount === 'wall' ? 'Depth' : 'Depth', lenInput(it.d, (v) => upd((t) => { t.d = v; }, 'Resize'), Object.assign({ key: 'id' }, lim, { min: 0.5 }))),
      field('Height', lenInput(it.h, (v) => upd((t) => { t.h = v; }, 'Resize'), Object.assign({ key: 'ih' }, lim, { min: 0.5 })))),
    it.type === 'custom' && def ? h('button.link', { style: { marginTop: '6px' }, onclick: () => upd((t) => { t.w = def.w; t.d = def.d; t.h = def.h; }, 'Reset size') }, 'Reset to the size you measured') : null));

    // colours
    const labels = (def && def.labels) || [];
    const isLed = /^(ledStrip|ledBar|neon|fairyLights)$/.test(it.type);
    const colours = h('div');
    colours.append(colorPicker(it.color, (c, done) => upd((t) => { t.color = c; }, 'Colour', { merge: 'c1' + it.id, quiet: !done }), { swatches: isLed ? LED_COLORS : T.SWATCHES, label: labels[0] || (it.type === 'custom' ? 'Sides' : 'Colour'), key: 'c1' }));
    if (def && def.color2 && labels[1]) {
      colours.append(h('div', { style: { height: '12px' } }), h('div.hint', null, labels[1]),
        colorPicker(it.color2, (c, done) => upd((t) => { t.color2 = c; }, 'Colour', { merge: 'c2' + it.id, quiet: !done }), { swatches: it.type === 'hexLights' || it.type === 'pc' ? LED_COLORS : T.SWATCHES, label: labels[1], key: 'c2' }));
    }
    body.append(section(isLed ? 'Light colour' : 'Colour', colours));

    // options
    const opts = C.OPTIONS[it.type] || [];
    if (opts.length) {
      const box = h('div');
      for (const o of opts) {
        const val = it.opts[o.key];
        const set = (v, label, mo) => upd((t) => { t.opts[o.key] = v; }, label || o.label, mo);
        if (o.type === 'number') {
          const s = selectBox(Array.from({ length: o.max - o.min + 1 }, (_, k) => [o.min + k, String(o.min + k)]), val == null ? o.min : val, (v) => set(parseInt(v, 10)), 'o' + o.key);
          box.append(h('div.row', null, h('span.lab', null, o.label), h('div', { style: { width: '90px' } }, s)));
        } else if (o.type === 'select') {
          box.append(h('div.row', null, h('span.lab', null, o.label), h('div', { style: { width: '170px' } }, selectBox(o.options, val == null ? o.options[0][0] : val, (v) => set(v), 'o' + o.key))));
        } else if (o.type === 'toggle') {
          box.append(h('div.row', null, h('span.lab', null, o.label), toggle(val !== false, (v) => set(v), 'o' + o.key)));
        } else if (o.type === 'range') {
          box.append(h('div.row', null, h('span.lab', null, o.label), h('div', { style: { width: '150px' } }, rangeInput(val == null ? 1 : val, o.min, o.max, o.step, (v, done) => set(v, o.label, { merge: 'r' + o.key + it.id, quiet: !done })))));
        } else if (o.type === 'text') {
          const t = h('textarea.text', { rows: 2, dataset: { k: 'o' + o.key } }, val || '');
          t.addEventListener('change', () => set(t.value));
          box.append(field(o.label, t));
        } else if (o.type === 'image') {
          box.append(h('div.row', null, h('span.lab', null, val ? 'Your picture' : 'Use your own picture'),
            h('button.btn', { onclick: () => app().pickPosterImage(it) }, icon('photo'), val ? 'Change' : 'Choose'),
            val ? h('button.btn', { onclick: () => set(null, 'Remove picture') }, 'Remove') : null));
        }
      }
      body.append(section('Options', box));
    }

    // position
    const pos = h('div');
    const canWall = true, canCeil = /ceilingLight|pendant|fan|box|cylinder|custom/.test(it.type) || it.mount === 'ceiling';
    const mounts = [['floor', 'Floor'], ['wall', 'Wall']].concat(canCeil ? [['ceiling', 'Ceiling']] : []);
    if (canWall) {
      pos.append(h('div.seg.full.small', null, mounts.map(([m, l]) => h('button' + (it.mount === m ? '.on' : ''), {
        onclick: () => app().change((q) => { const t = q.items.find((i) => i.id === it.id); store().setMount(q, t, m, app().viewer); }, 'Move to ' + l.toLowerCase()),
      }, l))));
    }
    if (it.mount === 'wall') {
      const ws = G.walls(proj().room.points);
      const w = ws[it.wall] || ws[0];
      pos.append(h('div.grid2', { style: { marginTop: '10px' } },
        field('Wall', selectBox(ws.map((_, i) => [i, 'Wall ' + (i + 1)]), it.wall, (v) => upd((t) => { t.wall = parseInt(v, 10); t.along = Math.min(t.along, ws[t.wall].len - t.w / 2); }, 'Move to wall'), 'iwall')),
        field('Height off floor', lenInput(it.y || 0, (v) => upd((t) => { t.y = v; }, 'Move'), { min: 0, max: proj().room.height, key: 'iy' })),
        field('From left corner', lenInput(Math.max(0, (it.along || 0) - it.w / 2), (v) => upd((t) => { t.along = U.clamp(v + t.w / 2, t.w / 2, w.len - t.w / 2); }, 'Move'), { min: 0, max: w.len, key: 'ia' }))));
    } else {
      pos.append(h('div', { style: { height: '10px' } }), h('div.rot-row', null,
        h('button.icon-btn', { title: 'Turn left', 'aria-label': 'Turn left', html: I.rotL, onclick: () => app().rotateSelected(-15) }),
        rangeInput(Math.round(((it.rot || 0) * 180) / Math.PI), -180, 180, 1, (v, done) => upd((t) => { t.rot = (v * Math.PI) / 180; }, 'Rotate', { merge: 'rot' + it.id, quiet: !done })),
        h('button.icon-btn', { title: 'Turn right', 'aria-label': 'Turn right', html: I.rotR, onclick: () => app().rotateSelected(15) }),
        h('output', null, Math.round(((it.rot || 0) * 180) / Math.PI) + '°')));
      if (it.mount !== 'ceiling') {
        pos.append(h('div.grid2', { style: { marginTop: '10px' } },
          field('Height off floor', lenInput(it.y || 0, (v) => upd((t) => { t.y = v; }, 'Move'), { min: 0, max: proj().room.height, key: 'iy' })),
          h('div')));
      }
    }
    body.append(section('Position', pos, it.mount === 'floor' ? h('p.hint.small', { style: { marginTop: '8px' } }, 'Drag it in the 3D view. It snaps flat against walls and can sit on desks and shelves.') : null));

    body.append(section('', h('div.actions', null,
      h('button.btn', { onclick: () => app().duplicateSelected() }, icon('copy'), 'Duplicate'),
      h('button.btn.danger', { onclick: () => app().deleteSelected() }, icon('trash'), 'Delete'),
      h('button.btn', { onclick: () => upd((t) => { t.locked = !t.locked; }, it.locked ? 'Unlock' : 'Lock') }, icon(it.locked ? 'lock' : 'unlock'), it.locked ? 'Locked' : 'Lock in place'),
      it.type === 'custom' && def ? h('button.btn', { onclick: () => (def.shape === 'model' ? RD.scanning.reviewModel(null, { def }) : RD.photos.openStuff(def)) }, icon(def.shape === 'model' ? 'box3d' : 'photo'), def.shape === 'model' ? 'Edit scan' : 'Edit photo') : null)));
  }

  function openingInspector(el, op) {
    const ws = G.walls(proj().room.points);
    const w = ws[op.wall] || ws[0];
    const upd = (fn, label, opts) => app().change((q) => { const t = q.openings.find((o) => o.id === op.id); if (t) fn(t); }, label, opts);
    el.append(head((C.OPENINGS[op.type] || {}).name || 'Opening', 'Wall ' + (op.wall + 1)));
    const body = h('div.insp-body');
    el.append(body);
    body.append(section('Type', h('div.seg.full.small', null, Object.entries(C.OPENINGS).map(([t, d]) => h('button' + (op.type === t ? '.on' : ''), {
      onclick: () => upd((o) => { o.type = t; o.sill = d.sill; o.height = d.height; if (t !== 'window') o.sill = 0; }, 'Change type'),
    }, d.name.replace('Open doorway', 'Opening').replace('Balcony door', 'Glass door'))))));
    body.append(section('Size & position', h('div.grid2', null,
      field('Width', lenInput(op.width, (v) => upd((o) => { o.width = v; }, 'Resize'), { min: 20, max: w.len - 4, key: 'ow' })),
      field('Height', lenInput(op.height, (v) => upd((o) => { o.height = v; }, 'Resize'), { min: 20, max: proj().room.height - 2, key: 'oh' })),
      op.type === 'window' ? field('Height off floor', lenInput(op.sill, (v) => upd((o) => { o.sill = v; }, 'Move'), { min: 1, max: proj().room.height - op.height - 2, key: 'os' })) : null,
      field('From left corner', lenInput(Math.max(0, op.along - op.width / 2), (v) => upd((o) => { o.along = U.clamp(v + o.width / 2, o.width / 2, w.len - o.width / 2); }, 'Move'), { min: 0, max: w.len, key: 'oa' })),
      field('Wall', selectBox(ws.map((_, i) => [i, 'Wall ' + (i + 1)]), op.wall, (v) => upd((o) => { o.wall = parseInt(v, 10); o.along = Math.min(o.along, ws[o.wall].len - o.width / 2); }, 'Move to wall'), 'owall'))),
    h('p.hint.small', { style: { marginTop: '8px' } }, 'Drag it along the wall in the 3D view.')));
    body.append(section('Frame colour', colorPicker(op.color, (c, done) => upd((o) => { o.color = c; }, 'Colour', { merge: 'oc' + op.id, quiet: !done }), { key: 'oc' })));
    body.append(section('', h('div.actions', null,
      h('button.btn', { onclick: () => app().duplicateSelected() }, icon('copy'), 'Duplicate'),
      h('button.btn.danger', { onclick: () => app().deleteSelected() }, icon('trash'), 'Delete'))));
  }

  function wallInspector(el, i) {
    const p = proj();
    const ws = G.walls(p.room.points);
    const w = ws[i];
    if (!w) return;
    const wall = p.room.walls[i];
    const upd = (fn, label, opts) => app().change((q) => fn(q.room.walls[i], q), label, opts);
    el.append(head('Wall ' + (i + 1), U.fmtLen(w.len) + ' long'));
    const body = h('div.insp-body');
    el.append(body);
    body.append(section('Length', h('div.row', null, h('span.lab', null, 'Wall length'),
      h('div', { style: { width: '130px' } }, lenInput(w.len, (v) => app().setWallLength(i, v), { min: 20, max: 5000, key: 'wlen' })))));
    body.append(section('Sloped ceiling', slopeEditor(p.room, ws, i)));

    const finish = wall.finish || 'paint';
    const tiles = h('div.tiles', null, T.WALLS.map((f) => {
      const url = f.id === 'paint' || f.id === 'photo' ? null : texPreview(f.id, f.color);
      const pic = h('span.tex', { style: url ? { backgroundImage: `url(${url})` } : f.id === 'paint' ? { background: wall.color } : {} }, f.id === 'photo' ? h('span', { html: I.photo }) : null);
      if (f.id === 'photo' && wall.photo && wall.photo.texId) RD.db.blobUrl(wall.photo.texId).then((u) => { if (u) pic.style.backgroundImage = `url(${u})`; });
      return h('button.tile' + (finish === f.id ? '.on' : ''), {
        onclick: () => {
          if (f.id === 'photo') {
            if (wall.photo && wall.photo.texId) upd((wl) => { wl.finish = 'photo'; }, 'Wall photo');
            else app().wallPhotoFor(i);
            return;
          }
          upd((wl) => { wl.finish = f.id; if (f.color && finish !== f.id) wl.color = f.id === 'paint' ? wl.color : f.color; }, 'Wall finish');
        },
      }, pic, f.name);
    }));
    body.append(section('Look', tiles));
    if (finish === 'photo') {
      body.append(section('My photo', h('div.btn-row', null,
        h('button.btn', { onclick: () => app().wallPhotoFor(i) }, icon('photo'), 'Change photo'),
        wall.photo && wall.photo.photoId ? h('button.btn', { onclick: () => { const ph = p.photos.find((x) => x.id === wall.photo.photoId); if (ph) RD.photos.openWall(ph, { wall: i }); } }, icon('corner'), 'Fix corners') : null)));
    } else {
      body.append(section(finish === 'paint' ? 'Paint colour' : 'Colour',
        colorPicker(wall.color, (c, done) => upd((wl) => { wl.color = c; }, 'Paint', { merge: 'wc' + i, quiet: !done }), { key: 'wc' }),
        finish === 'stripes' ? h('div', { style: { marginTop: '10px' } }, colorPicker(wall.color2 || U.shade(wall.color, -0.12), (c, done) => upd((wl) => { wl.color2 = c; }, 'Stripe colour', { merge: 'wc2' + i, quiet: !done }), { noSwatches: true, label: 'Stripe colour', key: 'wc2' })) : null));
    }
    body.append(section('', h('div.actions', null,
      h('button.btn', { onclick: () => app().change((q) => { const src = U.clone(q.room.walls[i]); q.room.walls.forEach((x, k) => { if (k !== i) Object.assign(x, U.clone(src)); }); }, 'Same look on all walls') }, icon('brush'), 'Use on all walls'),
      h('button.btn', { onclick: () => app().addOpening('window', i) }, icon('window'), 'Add window'),
      h('button.btn', { onclick: () => app().addOpening('door', i) }, icon('door'), 'Add door'),
      h('button.btn', { onclick: () => app().splitWall(i) }, icon('corner'), 'Add a corner'))));
  }

  // ------------------------------------------------------------------ floating toolbar for the selection
  P.renderSelBar = function (sel) {
    const bar = U.$('#sel-bar');
    bar.innerHTML = '';
    if (!sel || (sel.kind !== 'item' && sel.kind !== 'opening')) { bar.hidden = true; return; }
    const p = proj();
    const thing = sel.kind === 'item' ? p.items.find((i) => i.id === sel.id) : p.openings.find((o) => o.id === sel.id);
    if (!thing) { bar.hidden = true; return; }
    const b = (ic, title, fn, cls) => h('button.icon-btn' + (cls || ''), { title, 'aria-label': title, html: I[ic], onclick: fn });
    bar.append(h('span.nm', null, thing.name || (C.OPENINGS[thing.type] || {}).name || ''));
    if (sel.kind === 'item' && thing.mount !== 'wall') {
      bar.append(b('rotL', 'Turn left 15° (Shift+R)', () => app().rotateSelected(-15)), b('rotR', 'Turn right 15° (R)', () => app().rotateSelected(15)));
      bar.append(h('button.icon-btn', { title: 'Turn 90°', 'aria-label': 'Turn 90 degrees', onclick: () => app().rotateSelected(90), style: { fontWeight: '700', fontSize: '12px' } }, '90°'));
      bar.append(h('span.sep'));
    }
    bar.append(b('copy', 'Duplicate (Ctrl+D)', () => app().duplicateSelected()), b('trash', 'Delete (Del)', () => app().deleteSelected()));
    if (U.isPhone()) bar.append(h('span.sep'), h('button.btn.primary', { onclick: () => app().openInspector(), style: { minHeight: '34px', padding: '4px 12px' } }, 'Edit'));
    bar.hidden = false;
  };
})();
