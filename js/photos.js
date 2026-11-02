/* Room Designer: photo wizards. Room photos become walls (straightened, measured, coloured) and
 * photos of your own furniture become 3D items. */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util, G = RD.geo, HM = RD.homo, PT = RD.photoTool, I = RD.icons;
  const h = U.h;
  const app = () => RD.app;
  const proj = () => RD.store.project;

  const legend = () => h('div.legend', null, PT.NAMES.map((n, i) => h('span', { dataset: { n: i + 1 } }, n)));

  function radios(name, options, value, onChange) {
    const wrap = h('div.radio-list');
    const draw = (v) => {
      wrap.innerHTML = '';
      for (const o of options) {
        const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === v });
        input.addEventListener('change', () => { draw(o.value); onChange(o.value); });
        wrap.append(h('label.radio' + (o.value === v ? '.on' : ''), null, input, h('span', null, o.label, o.sub ? h('small', null, o.sub) : null)));
      }
    };
    draw(value);
    return wrap;
  }

  async function canvasBlob(canvas, png) {
    return U.canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.88);
  }

  // ------------------------------------------------------------------ room photo -> wall / floor
  /**
   * Opens a room photo: mark a wall (or a piece of floor), see it straightened and measured, then apply.
   * opts.wall preselects a wall.
   */
  async function openWall(ph, opts) {
    opts = opts || {};
    const blob = await RD.db.getBlob(ph.id);
    if (!blob) { U.toast('This photo is missing.'); return; }
    const img = await U.loadImage(URL.createObjectURL(blob));
    const p = proj();
    const ws = G.walls(p.room.points);
    let target = opts.wall != null ? 'wall:' + opts.wall : ph.target || nextFreeWall(p);
    let corners = ph.corners && ph.target === target ? ph.corners : ph.corners || null;
    let lastRect = null;
    let mode = 'photo';
    let setLen = true;
    let floorMode = 'photo';
    let floorSize = 100;
    let markedH = p.room.height;

    const host = h('div.ce-host');
    const preview = h('div.preview-box');
    const estimate = h('div.estimate');
    const colorRow = h('div.row');
    const extras = h('div');
    const targetSel = h('select.sel', null,
      ws.map((w, i) => h('option', { value: 'wall:' + i }, `Wall ${i + 1} (${U.fmtLen(w.len)})`)),
      h('option', { value: 'floor' }, 'The floor'));
    targetSel.value = target;
    targetSel.addEventListener('change', () => { target = targetSel.value; renderExtras(); refresh(); });

    const side = h('div.wiz-side', null,
      h('label.field', null, h('span', null, 'What did you photograph?'), targetSel),
      h('label.field', null, h('span', null, 'Straightened'), preview),
      estimate, colorRow, extras);
    const body = h('div.wiz', null,
      h('div.wiz-photo', null, h('p.photo-tip', null, 'Drag the 4 dots onto the corners of the wall: where it meets the floor (1, 2) and the ceiling (3, 4). If a corner is hidden, put the dot where it would be.'), legend(), host),
      side);

    let editor = null;
    const refresh = U.debounce(() => {
      if (!editor) return;
      const c = editor.get();
      const isFloor = target === 'floor';
      const r = PT.rectify(img, c, { focal35: ph.focal35, maxOut: 520, maxSource: 1400 });
      lastRect = r;
      preview.innerHTML = '';
      r.canvas.style.maxHeight = '180px';
      preview.append(r.canvas);
      const color = HM.typicalColor(r.imageData);
      lastRect.color = color;
      colorRow.innerHTML = '';
      colorRow.append(h('span.wall-num', { style: { background: color, width: '34px', height: '34px' } }), h('span.lab', null, (isFloor ? 'Floor' : 'Wall') + ' colour from photo', h('br'), h('span.hex', null, color.toUpperCase())));
      if (isFloor) {
        estimate.hidden = true;
      } else {
        estimate.hidden = false;
        const len = r.aspect * markedH;
        lastRect.length = len;
        const wi = parseInt(target.split(':')[1], 10);
        estimate.innerHTML = '';
        estimate.append(
          h('div', null, `Wall ${wi + 1} looks about `, h('b', null, U.fmtLen(len, { m: true })), ' long'),
          h('div.hint.small', null, `Now set to ${U.fmtLen(ws[wi].len, { m: true })}. Based on a ${U.fmtLen(markedH)} ceiling` + (r.info && r.info.source === 'photo' ? ' and your camera\'s lens.' : '.') + ' A tape measure is more exact.'));
      }
    }, 60);

    function renderExtras() {
      extras.innerHTML = '';
      if (target === 'floor') {
        extras.append(
          radios('floormode', [
            { value: 'photo', label: 'Use my photo as the floor', sub: 'Repeats the marked piece of floor' },
            { value: 'color', label: 'Only use its colour', sub: 'Keeps the floor type you picked' },
          ], floorMode, (v) => { floorMode = v; }),
          h('label.field', null, h('span', null, 'Width of the marked piece'), lenInputSimple(floorSize, (v) => { floorSize = v; })));
        return;
      }
      const lenToggle = h('input', { type: 'checkbox', checked: setLen });
      lenToggle.addEventListener('change', () => { setLen = lenToggle.checked; });
      extras.append(
        radios('wallmode', [
          { value: 'photo', label: 'Show my photo on the wall', sub: 'Posters, plugs and everything else, just like in real life' },
          { value: 'color', label: 'Paint it the colour from the photo', sub: 'Clean wall you can decorate' },
        ], mode, (v) => { mode = v; }),
        h('label.row', null, lenToggle, h('span.lab', null, 'Set the wall length to the estimate')),
        h('label.field', null, h('span', null, 'Height between the marked corners (usually the ceiling height)'), lenInputSimple(markedH, (v) => { markedH = v; refresh(); })));
    }

    function lenInputSimple(cm, onChange) {
      const input = h('input.len.text', { type: 'text', inputmode: 'decimal', value: U.lenInputValue(cm) });
      input.addEventListener('change', () => { const v = U.parseLen(input.value); if (v > 0) { onChange(v); input.value = U.lenInputValue(v); } else input.value = U.lenInputValue(cm); });
      return h('div.len-wrap', null, input, h('i', null, U.unitLabel()));
    }

    renderExtras();
    const res = await U.modal('Use photo', body, [
      { label: 'Cancel', value: null },
      { label: 'Apply', value: 'ok', primary: true },
    ], {
      wide: true,
      onOpen: () => {
        editor = new PT.CornerEditor(host, img, corners, { onChange: () => refresh() });
        refresh();
      },
    });
    if (res !== 'ok' || !editor) return;
    corners = editor.get();
    await apply(ph, img, corners, target, { mode, setLen, floorMode, floorSize, markedH });
  }

  function nextFreeWall(p) {
    const i = p.room.walls.findIndex((w) => !w.photo);
    return 'wall:' + (i < 0 ? 0 : i);
  }

  async function apply(ph, img, corners, target, o) {
    const r = PT.rectify(img, corners, { focal35: ph.focal35, maxOut: target === 'floor' ? 1024 : 2048, maxSource: 2400 });
    const color = HM.typicalColor(r.imageData);
    let texId = null;
    if ((target === 'floor' && o.floorMode === 'photo') || (target !== 'floor' && o.mode === 'photo')) {
      texId = await RD.db.putBlob(await canvasBlob(r.canvas), { kind: 'rectified' });
    }
    const len = r.aspect * o.markedH;
    app().change((p) => {
      const rec = p.photos.find((x) => x.id === ph.id);
      if (rec) { rec.corners = corners; rec.target = target; }
      if (target === 'floor') {
        if (o.floorMode === 'photo') p.room.floor = { type: 'photo', color, texId, sizeCm: o.floorSize, photo: { photoId: ph.id } };
        else p.room.floor.color = color;
        return;
      }
      const i = parseInt(target.split(':')[1], 10);
      const wall = p.room.walls[i];
      if (o.mode === 'photo') { wall.finish = 'photo'; wall.photo = { photoId: ph.id, corners, texId, aspect: r.aspect }; }
      else { wall.finish = 'paint'; }
      wall.color = color;
      if (o.setLen && len > 30 && len < 5000) {
        const next = G.setWallLength(p.room.points, i, Math.round(len));
        if (next) RD.store.setOutline(p, next);
      }
    }, target === 'floor' ? 'Floor from photo' : 'Wall from photo');
    U.toast(target === 'floor' ? 'Floor updated from your photo' : `Wall ${parseInt(target.split(':')[1], 10) + 1} updated from your photo`);
  }

  // ------------------------------------------------------------------ your own furniture from photos
  const SHAPES = [
    { value: 'box', label: 'Furniture (box shape)', sub: 'Dresser, drawers, desk, cabinet, bed…' },
    { value: 'flat', label: 'Flat, on a wall', sub: 'Poster, picture, TV, mirror, shelf' },
    { value: 'cutout', label: 'Cut out from the background', sub: 'Plant, chair, guitar, anything not boxy' },
    { value: 'round', label: 'Round', sub: 'Bin, pouf, round lamp, drum' },
  ];

  /** Create or edit one of "my stuff". */
  async function openStuff(existing, preset) {
    preset = preset || {};
    const def = existing ? U.clone(existing) : {
      id: U.uid('s'), name: 'My dresser', shape: 'box', w: 80, d: 45, h: 100, sideColor: '#d9cbb5', front: null, side: null, created: Date.now(), rev: 0,
    };
    let img = null, focal35 = null, photoId = def.front && def.front.photoId;
    let editor = null, lastRect = null;
    let hTouched = !!existing;
    let tolerance = def.tolerance == null ? 30 : def.tolerance;
    // extra photos of the side and the top (optional, box-shaped things only)
    const extra = {
      side: def.side ? { photoId: def.side.photoId, corners: def.side.corners } : preset.side ? { file: preset.side } : null,
      top: def.top ? { photoId: def.top.photoId, corners: def.top.corners } : preset.top ? { file: preset.top } : null,
    };

    const host = h('div.ce-host');
    const photoCol = h('div.wiz-photo');
    const preview = h('div.preview-box', null, h('span.hint', null, 'Add a photo of the front'));
    const nameIn = h('input.text', { type: 'text', value: def.name });
    const hint = h('p.hint.small');
    const sizeBox = h('div.grid3');
    const tolRow = h('div');
    const colorBox = h('div');
    const extraBox = h('div.field');

    const sizeField = (label, key) => {
      const input = h('input.len.text', { type: 'text', inputmode: 'decimal', value: U.lenInputValue(def[key]) });
      input.addEventListener('change', () => {
        const v = U.parseLen(input.value);
        if (!(v > 0)) { input.value = U.lenInputValue(def[key]); return; }
        def[key] = Math.round(v * 10) / 10;
        if (key === 'h') hTouched = true;
        if (key === 'w' && !hTouched && lastRect) { def.h = Math.round((def.w / lastRect.aspect) * 10) / 10; drawSizes(); }
        input.value = U.lenInputValue(def[key]);
        drawHint();
      });
      return h('label.field', null, h('span', null, label), h('div.len-wrap', null, input, h('i', null, U.unitLabel())));
    };
    function drawSizes() {
      sizeBox.innerHTML = '';
      sizeBox.append(sizeField('Width', 'w'), sizeField('Height', 'h'), sizeField('Depth', 'd'));
    }
    function drawHint() {
      if (!lastRect) { hint.textContent = 'Measure your item with a tape measure for the best result.'; return; }
      const est = def.w / lastRect.aspect;
      hint.textContent = `From the photo, an item ${U.fmtLen(def.w)} wide is about ${U.fmtLen(est)} high.` + (Math.abs(est - def.h) > Math.max(3, def.h * 0.08) ? ' Check your height.' : '');
    }
    function drawTol() {
      tolRow.innerHTML = '';
      if (def.shape !== 'cutout') return;
      const r = h('input', { type: 'range', min: 5, max: 80, step: 1, value: tolerance });
      r.addEventListener('change', () => { tolerance = parseInt(r.value, 10); refresh(); });
      tolRow.append(h('div.row', null, h('span.lab', null, 'Background removal'), h('div', { style: { width: '150px' } }, r)),
        h('p.hint.small', null, 'Works best with a plain wall or floor behind the item.'));
    }
    function drawColor() {
      colorBox.innerHTML = '';
      const input = h('input.color-input', { type: 'color', value: def.sideColor });
      input.addEventListener('input', () => { def.sideColor = input.value; def.colorTouched = true; });
      colorBox.append(h('div.color-row', null, input, h('span.hint', null, def.shape === 'cutout' ? 'Shadow colour' : 'Colour of the sides and top')));
    }
    function drawSideBtn() {
      extraBox.innerHTML = '';
      if (def.shape !== 'box') return;
      extraBox.append(h('span', null, 'More photos (optional)'));
      const row = h('div.btn-row');
      for (const [slot, label] of [['side', 'side'], ['top', 'top']]) {
        const rec = extra[slot];
        const txt = !rec ? `Add ${label} photo` : rec.corners ? `${label[0].toUpperCase() + label.slice(1)} photo ✓` : `Mark ${label} photo`;
        row.append(h('button.btn' + (rec && !rec.corners ? '.primary' : ''), { type: 'button', onclick: () => editExtra(slot, label) }, h('span', { html: I.photo }), txt));
      }
      extraBox.append(row, h('p.hint.small', null, 'A photo of the side and the top makes your item look real from every angle.'));
    }
    async function loadExtra(rec) {
      if (rec.img) return;
      if (rec.file) {
        const ph = await U.readPhoto(rec.file);
        rec.photoId = await RD.db.putBlob(ph.blob, { kind: 'stuff-photo', focal35: ph.focal35 });
        rec.focal35 = ph.focal35;
        rec.img = await U.loadImage(URL.createObjectURL(ph.blob));
        rec.file = null;
      } else if (rec.photoId) {
        const b = await RD.db.getBlob(rec.photoId);
        const br = await RD.db.getBlobRecord(rec.photoId);
        if (b) { rec.img = await U.loadImage(URL.createObjectURL(b)); rec.focal35 = br && br.focal35; }
      }
    }
    async function editExtra(slot, label) {
      const rec = extra[slot] || {};
      if (!extra[slot]) {
        const files = await U.pickFiles({});
        if (!files.length) return;
        rec.file = files[0];
      }
      await loadExtra(rec);
      if (!rec.img) return;
      const c = await PT.markCorners(rec.img, `Mark the ${label}`, rec.corners, `Drag the 4 dots onto the corners of the ${label} of your item.`);
      if (c) rec.corners = c;
      if (!c && !extra[slot]) return;
      rec.changed = true;
      extra[slot] = rec;
      drawSideBtn();
    }

    const refresh = U.debounce(() => {
      if (!editor) return;
      lastRect = PT.rectify(img, editor.get(), { focal35, maxOut: 420, maxSource: 1400, cutout: def.shape === 'cutout', tolerance });
      preview.innerHTML = '';
      preview.append(lastRect.canvas);
      if (!def.colorTouched) {
        def.sideColor = shadeForSides(HM.typicalColor(lastRect.imageData));
        drawColor();
      }
      if (!hTouched) { def.h = Math.round((def.w / lastRect.aspect) * 10) / 10; drawSizes(); }
      drawHint();
    }, 80);

    async function setPhoto(file) {
      const ph = await U.readPhoto(file);
      photoId = await RD.db.putBlob(ph.blob, { kind: 'stuff-photo' });
      focal35 = ph.focal35;
      img = await U.loadImage(URL.createObjectURL(ph.blob));
      def.front = null;
      showEditor(null);
    }

    function showEditor(corners) {
      photoCol.innerHTML = '';
      if (editor) editor.destroy();
      photoCol.append(h('p.photo-tip', null, 'Drag the 4 dots onto the corners of the front of your item.'), legend(), host);
      photoCol.append(h('div.btn-row', null,
        h('button.btn', { type: 'button', onclick: () => editor.set([[0, img.naturalHeight], [img.naturalWidth, img.naturalHeight], [img.naturalWidth, 0], [0, 0]]) }, 'Use the whole photo'),
        h('button.btn', { type: 'button', onclick: () => pick(false) }, h('span', { html: I.photo }), 'Other photo')));
      editor = new PT.CornerEditor(host, img, corners, { onChange: () => refresh() });
      refresh();
    }

    async function pick(camera) {
      const files = await U.pickFiles({ camera });
      if (files.length) await setPhoto(files[0]);
    }

    function showPicker() {
      photoCol.innerHTML = '';
      photoCol.append(h('div.empty', { style: { margin: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' } },
        h('p', null, 'Take a photo of your item from the front, as straight on as you can.'),
        h('button.btn.primary', { type: 'button', onclick: () => pick(true) }, h('span', { html: I.camera }), 'Take a photo'),
        h('button.btn', { type: 'button', onclick: () => pick(false) }, h('span', { html: I.photo }), 'Choose a photo')));
    }

    const shapeRadios = radios('shape', SHAPES, def.shape, (v) => { def.shape = v; if (v === 'flat' && def.d > 10) { def.d = 3; drawSizes(); } drawTol(); drawSideBtn(); drawColor(); refresh(); });
    drawSizes(); drawTol(); drawColor(); drawSideBtn(); drawHint();
    const side = h('div.wiz-side', null,
      h('label.field', null, h('span', null, 'Name'), nameIn),
      h('label.field', null, h('span', null, 'Preview'), preview),
      h('div.field', null, h('span', null, 'What kind of thing is it?'), shapeRadios), tolRow,
      h('div.field', null, h('span', null, 'Real size (measure it)'), sizeBox), hint,
      colorBox, extraBox);
    const body = h('div.wiz', null, photoCol, side);

    const res = await U.modal(existing ? 'Edit ' + def.name : 'Add your own item', body, [
      { label: 'Cancel', value: null },
      { label: existing ? 'Save' : 'Save & add to room', value: 'ok', primary: true, check: () => { if (!img) { U.toast('Add a photo first.'); return false; } return true; } },
    ], {
      wide: true,
      onOpen: async () => {
        if (preset.front) { await setPhoto(preset.front); return; }
        if (def.front && def.front.photoId) {
          const b = await RD.db.getBlob(def.front.photoId);
          const rec = await RD.db.getBlobRecord(def.front.photoId);
          if (b) { img = await U.loadImage(URL.createObjectURL(b)); focal35 = rec && rec.focal35; showEditor(def.front.corners); return; }
        }
        showPicker();
      },
    });
    if (editor) editor.destroy();
    if (res !== 'ok' || !img) return null;

    def.name = nameIn.value.trim() || 'My item';
    def.tolerance = tolerance;
    const corners = editor ? editor.get() : def.front.corners;
    const full = PT.rectify(img, corners, { focal35, maxOut: 1024, maxSource: 2400, cutout: def.shape === 'cutout', tolerance });
    const texId = await RD.db.putBlob(await canvasBlob(full.canvas, def.shape === 'cutout'), { kind: 'stuff-front' });
    def.front = { photoId, corners, texId, aspect: full.aspect };
    // side and top photos sent from the phone still need their corners marked
    if (def.shape === 'box') {
      for (const [slot, label] of [['side', 'side'], ['top', 'top']]) {
        const rec = extra[slot];
        if (!rec || rec.corners) continue;
        await loadExtra(rec);
        const c = rec.img ? await PT.markCorners(rec.img, `Mark the ${label}`, null, `Drag the 4 dots onto the corners of the ${label} of your item. Cancel to leave this photo out.`) : null;
        if (c) { rec.corners = c; rec.changed = true; } else extra[slot] = null;
      }
    }
    for (const slot of ['side', 'top']) {
      const rec = extra[slot];
      if (def.shape !== 'box') { def[slot] = null; continue; }
      if (!rec || !(rec.changed || rec.file)) continue;
      await loadExtra(rec);
      if (!rec.img) continue;
      const c = rec.corners || [[0, rec.img.naturalHeight], [rec.img.naturalWidth, rec.img.naturalHeight], [rec.img.naturalWidth, 0], [0, 0]];
      const r = PT.rectify(rec.img, c, { focal35: rec.focal35, maxOut: 768, maxSource: 2000 });
      const tid = await RD.db.putBlob(await canvasBlob(r.canvas), { kind: 'stuff-' + slot });
      def[slot] = { photoId: rec.photoId, corners: c, texId: tid };
    }
    def.rev = (def.rev || 0) + 1;
    def.mount = def.shape === 'flat' ? 'wall' : 'floor';
    await RD.store.saveStuff(def);
    if (!existing) app().addCustom(def);
    else app().refreshStuff(def, existing);
    U.toast(existing ? 'Saved' : `${def.name} added to your room`);
    return def;
  }

  /** Sides of furniture are usually a little darker than the lit front. */
  function shadeForSides(hex) { return U.shade(hex, -0.06); }

  RD.photos = { openWall, openStuff };
})();
