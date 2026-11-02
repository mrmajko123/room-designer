/* Room Designer: adding your own things. Scan them in 3D with your phone (QR code link), open a 3D
 * scan file, or make them from photos; then check the size before they go into "My stuff". */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util, I = RD.icons;
  const h = U.h;
  const app = () => RD.app;
  const S = 0.01;

  const bridge = () => (window.roomDesktop && window.roomDesktop.phoneLink) || null;
  const onPhone = () => !!window.Capacitor || (U.isTouch() && Math.min(screen.width, screen.height) < 820);

  // ------------------------------------------------------------------ "Add your own item"
  async function openAdd() {
    let close;
    const card = (icon, title, text, fn, opts) => h('button.choice' + (opts && opts.primary ? '.primary' : ''), { disabled: !!(opts && opts.disabled), onclick: () => { close(null); fn(); } },
      h('span.choice-ic', { html: I[icon] }), h('span.choice-txt', null, h('b', null, title), h('span', null, text)));
    const list = h('div.choices');
    if (onPhone()) {
      list.append(
        card('box3d', 'Open a 3D scan', 'Scan your item with a free 3D scanner app (like Scaniverse), export it as GLB, OBJ or USDZ and open the file here.', () => pickScanFile(), { primary: true }),
        card('camera', 'Quick scan with photos', 'Take a photo of the front (and the side and top if you like). Best for boxy things like dressers and desks.', () => RD.photos.openStuff()));
    } else {
      list.append(
        card('scanqr', 'Scan with your phone', bridge() ? 'Scan a QR code with your phone and 3D scan your item. It shows up here so you can check its size.' : 'Works in the Room Designer desktop app: scan a QR code with your phone and 3D scan your item.', () => phoneDialog(), { primary: true, disabled: !bridge() }),
        card('box3d', 'Open a 3D scan file', 'A .glb, .obj, .usdz, .ply, .stl or .zip from a scanner app like Scaniverse, Polycam or KIRI Engine.', () => pickScanFile()),
        card('camera', 'Make it from photos', 'Use a photo of the front (and the side and top if you like). Best for boxy things like dressers and desks.', () => RD.photos.openStuff()));
    }
    await U.modal('Add your own item', h('div', null, list,
      h('p.hint.small', { style: { marginTop: '12px' } }, 'Before it goes into My stuff you can change its width, depth and height so it matches the real thing.')), [], { onOpen: (d, c) => { close = c; } });
  }

  async function pickScanFile() {
    const files = await U.pickFiles({ accept: onPhone() ? '' : RD.models.ACCEPT });
    if (files.length) reviewModel({ blob: files[0], name: files[0].name });
  }

  // ------------------------------------------------------------------ phone link (QR code)
  async function phoneDialog() {
    const link = bridge();
    if (!link) { U.toast('Scanning with your phone works in the desktop app.'); return; }
    let info;
    try { info = await link.start(); } catch (e) { U.toast('Could not start the phone link: ' + (e.message || e)); return; }
    if (!info || !info.urls || !info.urls.length) {
      await U.modal('Connect to Wi-Fi', h('p', null, 'Your computer is not on a network. Connect it to the same Wi-Fi as your phone and try again.'), [{ label: 'OK', value: 1, primary: true }]);
      link.stop();
      return;
    }
    const url = info.urls[0];
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const status = h('div.link-status', null, h('span.dot'), h('span', null, 'Waiting for your phone…'));
    const setStatus = (text, state) => { status.className = 'link-status' + (state ? ' ' + state : ''); status.lastChild.textContent = text; };
    const body = h('div.qr-layout', null,
      h('div.qr-box', null, h('div.qr', { html: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }), h('code.qr-url', null, url)),
      h('div.qr-steps', null,
        h('ol.steps', null,
          h('li', null, 'Connect your phone to the same Wi-Fi as this computer.'),
          h('li', null, 'Open the camera on your phone and point it at the code. Tap the link that appears.'),
          h('li', null, 'Follow the steps on your phone to 3D scan your item, or take a few photos of it.'),
          h('li', null, 'It shows up here, and you can fix its size before adding it.')),
        status,
        h('details.help', null, h('summary', null, 'Not working?'),
          h('p.hint.small', null, 'If your computer asks whether Room Designer may use the network, allow it (private networks). Your phone and computer need to be on the same Wi-Fi; guest networks often block this.'),
          info.urls.length > 1 ? h('p.hint.small', null, 'Other addresses to try in your phone\'s browser: ', info.urls.slice(1).join(', ')) : null)));

    const batch = { photos: {}, model: null };
    let closeFn = null;
    let finished = null;
    const off = link.on((ev) => {
      if (ev.type === 'connected') setStatus('Phone connected. Scan your item on your phone.', 'ok');
      else if (ev.type === 'progress') setStatus(`Receiving ${ev.name || 'scan'}… ${Math.round((ev.received / Math.max(1, ev.size)) * 100)}%`, 'busy');
      else if (ev.type === 'file') {
        const blob = new Blob([ev.data], { type: ev.mime || 'application/octet-stream' });
        const file = new File([blob], ev.name || 'scan', { type: blob.type });
        if (ev.kind === 'model') batch.model = file;
        else batch.photos[ev.step || 'front'] = file;
        setStatus(ev.kind === 'model' ? 'Got your 3D scan.' : `Got the ${ev.step || ''} photo.`, 'ok');
      } else if (ev.type === 'done') {
        finished = ev.kind === 'model' ? { model: batch.model } : { photos: Object.assign({}, batch.photos) };
        batch.photos = {}; batch.model = null;
        if (closeFn) closeFn('done');
      }
    });
    const res = await U.modal('Scan with your phone', body, [{ label: 'Close', value: null }], { wide: false, onOpen: (d, c) => { closeFn = c; d.classList.add('qr-dialog'); } });
    if (off) off();
    link.stop();
    if (res !== 'done' || !finished) return;
    if (finished.model) reviewModel({ blob: finished.model, name: finished.model.name });
    else if (finished.photos && finished.photos.front) RD.photos.openStuff(null, finished.photos);
  }

  // ------------------------------------------------------------------ check the size of a 3D scan
  /**
   * Shows a 3D scan so you can name it, stand it upright and set its real size, then saves it to
   * My stuff. src: { blob, name } for a new scan; opts.def to edit one you already have.
   */
  async function reviewModel(src, opts) {
    opts = opts || {};
    const editing = opts.def ? U.clone(opts.def) : null;
    const name0 = editing ? editing.name : (src.name || 'My item').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || 'My item';
    let obj, blob = src && src.blob;
    const wait = h('div.empty', null, h('div.spinner', { style: { margin: '0 auto 10px' } }), 'Opening your scan…');
    let closeWait;
    U.modal('Opening scan', wait, [], { onOpen: (d, c) => { closeWait = c; } });
    try {
      if (editing) {
        blob = await RD.db.getBlob(editing.model.blobId);
        obj = await RD.models.load(editing.model.blobId, editing.model.name);
        if (!obj) throw new Error('The scan file is missing.');
      } else {
        obj = await RD.models.parse(await blob.arrayBuffer(), src.name);
      }
    } catch (e) {
      closeWait(null);
      await U.modal('Could not open the scan', h('p', null, e.message || String(e)), [{ label: 'OK', value: 1, primary: true }]);
      return null;
    }
    closeWait(null);

    let rot = editing ? editing.model.rot.slice() : [0, 0, 0];
    const meas = RD.models.measure(obj, rot);
    let unitCm = meas.unitCm;
    let size = { w: meas.size.x * unitCm, h: meas.size.y * unitCm, d: meas.size.z * unitCm };
    const realSize = Math.max(size.w, size.h, size.d) > 3 && Math.max(size.w, size.h, size.d) < 1000;
    let dims = editing ? { w: editing.w, d: editing.d, h: editing.h } : realSize ? { ...size } : scaleTo(size, 100);
    let keep = true;
    let mount = editing ? editing.mount || 'floor' : 'floor';
    dims = roundDims(dims);

    function scaleTo(sz, biggest) { const k = biggest / Math.max(sz.w, sz.h, sz.d, 1e-6); return { w: sz.w * k, h: sz.h * k, d: sz.d * k }; }
    function roundDims(d) { return { w: Math.round(d.w * 10) / 10, d: Math.round(d.d * 10) / 10, h: Math.round(d.h * 10) / 10 }; }

    // preview
    const stage = h('div.scan-preview');
    const labels = h('div.scan-labels');
    stage.append(labels);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    stage.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9ecef');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.7;
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(80, 200, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun, new THREE.HemisphereLight('#ffffff', '#999999', 0.5));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(400, 40, '#b5bcc4', '#d3d8de');
    grid.position.y = 0.05;
    scene.add(grid);
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    const controls = new THREE.OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; });
    let model = null, outline = null, framed = false;

    function rebuild() {
      if (model) scene.remove(model);
      if (outline) scene.remove(outline);
      model = RD.models.fit(obj, rot, dims.w, dims.d, dims.h);
      scene.add(model);
      outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.w, dims.h, dims.d)), new THREE.LineBasicMaterial({ color: '#ff5a36', transparent: true, opacity: 0.8 }));
      outline.position.y = dims.h / 2;
      scene.add(outline);
      const big = Math.max(dims.w, dims.h, dims.d);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -big; sun.shadow.camera.right = sun.shadow.camera.top = big;
      sun.shadow.camera.updateProjectionMatrix();
      if (!framed) {
        framed = true;
        controls.target.set(0, dims.h / 2, 0);
        cam.position.set(big * 1.3, big * 0.95 + dims.h / 2, big * 1.9);
      }
    }
    const v3 = new THREE.Vector3();
    function label(text, x, y, z) {
      v3.set(x, y, z).project(cam);
      const w = renderer.domElement.clientWidth, hh = renderer.domElement.clientHeight;
      return `<span class="lbl dist-lbl" style="transform:translate(${((v3.x + 1) / 2) * w}px,${((1 - v3.y) / 2) * hh}px)">${text}</span>`;
    }
    let raf = 0, alive = true;
    function loop() {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const w = stage.clientWidth, hh = stage.clientHeight;
      if (w && hh && (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(hh * renderer.getPixelRatio()))) {
        renderer.setSize(w, hh, false);
        cam.aspect = w / hh;
        cam.updateProjectionMatrix();
      }
      controls.update();
      renderer.render(scene, cam);
      labels.innerHTML = label('W ' + U.fmtLen(dims.w), 0, 0, dims.d / 2) + label('D ' + U.fmtLen(dims.d), dims.w / 2, 0, 0) + label('H ' + U.fmtLen(dims.h), dims.w / 2, dims.h / 2, dims.d / 2);
    }

    // form
    const nameIn = h('input.text', { type: 'text', value: name0 });
    const inputs = {};
    const dimRow = h('div.grid3');
    const drawDims = () => {
      dimRow.innerHTML = '';
      for (const [k, label] of [['w', 'Width'], ['d', 'Depth'], ['h', 'Height']]) {
        const input = h('input.len.text', { type: 'text', inputmode: 'decimal', value: U.lenInputValue(dims[k]), dataset: { k } });
        input.addEventListener('change', () => {
          const v = U.parseLen(input.value);
          if (!(v > 0.5 && v < 5000)) { input.value = U.lenInputValue(dims[k]); return; }
          if (keep) { const f = v / dims[k]; dims = { w: dims.w * f, d: dims.d * f, h: dims.h * f }; }
          else dims[k] = v;
          dims = roundDims(dims);
          drawDims();
          rebuild();
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
        inputs[k] = input;
        dimRow.append(h('label.field', null, h('span', null, label), h('div.len-wrap', null, input, h('i', null, U.unitLabel()))));
      }
    };
    drawDims();
    const keepIn = h('input', { type: 'checkbox', checked: true });
    keepIn.addEventListener('change', () => { keep = keepIn.checked; });
    /** Which world axis each model axis points along for quarter turns rot (rows: x, y, z), as 0/1 entries. */
    const axes = (r) => {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((r[0] * Math.PI) / 2, (r[1] * Math.PI) / 2, (r[2] * Math.PI) / 2, 'YXZ')).elements;
      return [0, 1, 2].map((i) => [0, 1, 2].map((j) => Math.round(Math.abs(m[j * 4 + i]))));
    };
    const turn = (axis) => {
      const before = axes(rot);
      rot[axis] = (rot[axis] + 1) % 4;
      const after = axes(rot);
      // quarter turns only swap measurements around: carry them over exactly (no rounding drift)
      const remap = (o) => {
        const v = [o.w, o.h, o.d], out = [0, 0, 0];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i] += after[i][k] * before[j][k] * v[j];
        return { w: out[0], h: out[1], d: out[2] };
      };
      dims = remap(dims);
      size = remap(size);
      framed = false;
      drawDims();
      rebuild();
    };
    const scanned = h('p.hint.small', null, realSize
      ? `The scan measures ${U.fmtLen(size.w)} × ${U.fmtLen(size.d)} × ${U.fmtLen(size.h)}. Scans made with photos (no LiDAR) are often a little off: measure the real thing and type it here.`
      : 'This scan has no real size. Measure your item and type its width, depth and height.');
    const mountSel = h('select.sel', null, h('option', { value: 'floor', selected: mount === 'floor' }, 'Stands on the floor'), h('option', { value: 'wall', selected: mount === 'wall' }, 'Hangs on a wall'));
    mountSel.addEventListener('change', () => { mount = mountSel.value; });
    const side = h('div.wiz-side', null,
      h('label.field', null, h('span', null, 'Name'), nameIn),
      h('div.field', null, h('span', null, 'Real size'), dimRow),
      h('label.row', null, keepIn, h('span.lab', null, 'Keep proportions')),
      scanned,
      h('div.field', null, h('span', null, 'Is it the right way up?'), h('div.btn-row', null,
        h('button.btn', { type: 'button', onclick: () => turn(0) }, h('span', { html: I.rotR }), 'Stand up'),
        h('button.btn', { type: 'button', onclick: () => turn(2) }, h('span', { html: I.rotL }), 'Tip over'),
        h('button.btn', { type: 'button', onclick: () => turn(1) }, h('span', { html: I.rotR }), 'Turn front'))),
      h('p.hint.small', null, 'The front of your item should face you when the preview starts.'),
      h('label.field', null, h('span', null, 'Where does it go?'), mountSel));
    const body = h('div.wiz', null, h('div.wiz-photo', null, stage, h('p.hint.small', null, 'Drag to look around. The orange box is the size it will have in your room.')), side);

    rebuild();
    loop();
    const res = await U.modal(editing ? 'Edit ' + editing.name : 'Check the size', body, [
      { label: 'Cancel', value: null },
      { label: editing ? 'Save' : 'Add to My stuff', value: 'ok', primary: true },
    ], { wide: true });
    // a picture for the My stuff list
    let thumbBlob = null;
    if (res === 'ok') {
      controls.autoRotate = false;
      const big = Math.max(dims.w, dims.h, dims.d);
      cam.position.set(big * 1.2, dims.h / 2 + big * 0.7, big * 1.6);
      controls.target.set(0, dims.h / 2, 0);
      controls.update();
      scene.remove(outline); scene.remove(grid);
      renderer.setSize(320, 320, false);
      cam.aspect = 1; cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      thumbBlob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/png'));
    }
    alive = false;
    cancelAnimationFrame(raf);
    controls.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    if (res !== 'ok') return null;

    const def = editing || { id: U.uid('s'), created: Date.now(), rev: 0, shape: 'model', sideColor: '#bbbbbb' };
    const old = editing ? U.clone(opts.def) : null;
    def.name = nameIn.value.trim() || 'My item';
    Object.assign(def, dims);
    def.mount = mount;
    if (!editing) {
      const blobId = await RD.db.putBlob(blob, { kind: 'scan', name: src.name });
      def.model = { blobId, name: src.name || 'scan.glb', rot };
      RD.models.remember(blobId, obj);
    } else def.model.rot = rot;
    if (thumbBlob) def.thumbId = await RD.db.putBlob(thumbBlob, { kind: 'thumb' });
    def.rev = (def.rev || 0) + 1;
    await RD.store.saveStuff(def);
    if (editing) app().refreshStuff(def, old);
    else app().addCustom(def);
    U.toast(editing ? 'Saved' : `${def.name} added to My stuff and your room`);
    return def;
  }

  RD.scanning = { openAdd, phoneDialog, reviewModel, pickScanFile };
})();
