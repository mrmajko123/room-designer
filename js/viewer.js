/* Room Designer: the 3D view. Builds the room and everything in it with three.js, and handles
 * orbiting, the top-down plan, walking around, selecting and dragging. Data is in centimetres;
 * the 3D scene is in metres. */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = RD.util, G = RD.geo, T = RD.tex, C = RD.catalog;
  const S = 0.01;
  const LIGHT_POOL = 8;
  const aabb = (pts) => ({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) });

  class Viewer {
    constructor(container, hooks) {
      this.el = container;
      this.hooks = hooks; // { project(), stuff(id), update(fn), select(sel), cornersChanged(points) }
      this.view = '3d';
      this.night = false;
      this.cutaway = true;
      this.quality = 'high';
      this.selected = null;
      this.items = new Map(); // id -> { key, group, it }
      this.textures = new Map();
      this.roomKey = '';
      this.dirty = true;
      this.animated = [];
      this.lastTime = performance.now();
      this.startTime = this.lastTime;
      this.walk = { yaw: 0, pitch: 0, keys: new Set(), move: [0, 0, 0] };
      this.editCorners = false;
      this.showWallNumbers = false;

      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;
      r.toneMapping = THREE.NeutralToneMapping;
      r.toneMappingExposure = 1;
      T.setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
      r.domElement.className = 'gl';
      container.append(r.domElement);
      this.labels = U.h('div.labels');
      container.append(this.labels);

      const scene = (this.scene = new THREE.Scene());
      const pmrem = new THREE.PMREMGenerator(r);
      scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
      pmrem.dispose();

      this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
      this.ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 300);
      this.walkCam = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
      this.camera = this.persp;

      this.hemi = new THREE.HemisphereLight('#ffffff', '#b8a990', 1);
      this.sun = new THREE.DirectionalLight('#fff6ea', 1.6);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.02;
      this.sun.shadow.radius = 4;
      this.mainSpot = new THREE.SpotLight('#fff3dd', 0, 0, 1.25, 1, 2);
      this.mainSpot.castShadow = true;
      this.mainSpot.shadow.mapSize.set(1024, 1024);
      this.mainSpot.shadow.bias = -0.0005;
      this.mainSpot.shadow.radius = 5;
      scene.add(this.hemi, this.sun, this.sun.target, this.mainSpot, this.mainSpot.target);
      this.pool = [];
      for (let i = 0; i < LIGHT_POOL; i++) {
        const l = new THREE.PointLight('#ffffff', 0, 4, 2);
        this.pool.push(l);
        scene.add(l);
      }

      this.roomGroup = new THREE.Group();
      this.itemsGroup = new THREE.Group();
      this.helpers = new THREE.Group();
      scene.add(this.roomGroup, this.itemsGroup, this.helpers);

      // Post-processing: bloom makes LEDs and lamps glow.
      this.composer = new THREE.EffectComposer(r);
      this.renderPass = new THREE.RenderPass(scene, this.camera);
      this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.9);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new THREE.OutputPass());

      this.raycaster = new THREE.Raycaster();
      this.bindPointer();
      this.orbit = new THREE.OrbitControls(this.persp, r.domElement);
      this.orbit.enableDamping = true;
      this.orbit.dampingFactor = 0.12;
      this.orbit.maxPolarAngle = Math.PI * 0.495;
      this.orbit.minDistance = 0.5;
      this.orbit.maxDistance = 40;
      this.orbit.screenSpacePanning = true;
      this.orbit.addEventListener('change', () => this.onCameraChange());
      this.top = new THREE.OrbitControls(this.ortho, r.domElement);
      this.top.enableRotate = false;
      this.top.screenSpacePanning = true;
      this.top.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.top.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      this.top.enabled = false;
      this.top.addEventListener('change', () => this.onCameraChange());

      r.localClippingEnabled = true;
      // wall glow never shows above the ceiling (sloped or flat) or below the floor
      this.clipBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      this.clipPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.5), this.clipBottom];
      this.applyLighting();
      new ResizeObserver(() => this.resize()).observe(container);
      this.resize();
      const loop = () => {
        requestAnimationFrame(loop);
        this.tick();
      };
      requestAnimationFrame(loop);
    }

    // ------------------------------------------------------------------ basics
    project() { return this.hooks.project(); }
    get room() { return this.project().room; }

    resize() {
      const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
      this.renderer.setSize(w, h, false);
      this.composer.setSize(w, h);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.persp.aspect = this.walkCam.aspect = w / h;
      this.persp.updateProjectionMatrix();
      this.walkCam.updateProjectionMatrix();
      this.updateOrtho();
      this.dirty = true;
    }

    updateOrtho() {
      const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
      const span = this.orthoSpan || 6;
      const a = w / h;
      const hh = a > 1 ? span / 2 : span / 2 / a;
      this.ortho.left = -hh * a; this.ortho.right = hh * a; this.ortho.top = hh; this.ortho.bottom = -hh;
      this.ortho.updateProjectionMatrix();
    }

    requestRender() { this.dirty = true; }

    onCameraChange() {
      this.updateCutaway();
      this.dirty = true;
    }

    tick() {
      if (!this.project()) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      let moving = false;
      if (this.view === '3d') moving = this.orbit.update();
      else if (this.view === 'top') moving = this.top.update();
      else moving = this.updateWalk(dt);
      if (moving) this.dirty = true;
      if (this.animated.length) {
        this.animateLeds((now - this.startTime) / 1000);
        this.dirty = true;
      }
      if (!this.dirty) return;
      this.dirty = false;
      this.render();
      this.updateLabels();
    }

    render() {
      this.renderPass.camera = this.camera;
      if (this.quality === 'high') this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    }

    setQuality(q) {
      this.quality = q === 'low' ? 'low' : 'high';
      this.renderer.setPixelRatio(this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = this.quality !== 'low';
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      this.resize();
    }

    // ------------------------------------------------------------------ lighting
    setNight(on) {
      this.night = !!on;
      this.applyLighting();
      this.applyLights();
      this.dirty = true;
    }

    applyLighting() {
      const n = this.night;
      this.scene.background = new THREE.Color(n ? '#0a0c11' : '#e4e8ee');
      this.scene.environmentIntensity = n ? 0.04 : 0.45;
      this.hemi.intensity = n ? 0.06 : 0.7;
      this.sun.intensity = n ? 0 : 1.1;
      this.bloom.strength = n ? 0.65 : 0.15;
      this.bloom.radius = n ? 0.4 : 0.25;
      this.bloom.threshold = n ? 0.85 : 1.1;
      this.scene.traverse((o) => {
        if (!o.userData.glow) return;
        o.material.opacity = (o.userData.glowBase || 0.8) * (n ? 1 : 0.22);
        // wall glow never shows above the ceiling or below the floor
        o.material.clippingPlanes = this.clipPlanes;
      });
    }

    /** Hands the pooled lights to the light sources in the room: main lights first, then lamps, then LEDs. */
    applyLights() {
      const specs = [];
      const pri = { main: 0, lamp: 1, led: 2 };
      const add = (group, spec, item) => {
        if (!group.visible && !(item && item.wallHidden)) return;
        const p = new THREE.Vector3(spec.pos[0], spec.pos[1], spec.pos[2]);
        group.updateWorldMatrix(true, false);
        p.applyMatrix4(group.matrixWorld);
        specs.push({ spec, p, owner: group });
      };
      for (const rec of this.items.values()) {
        if (rec.model.userData.lights) for (const s of rec.model.userData.lights) add(rec.model, s, rec);
      }
      for (const g of this.roomLeds || []) for (const s of g.userData.lights || []) add(g, s);
      specs.sort((a, b) => pri[a.spec.kind] - pri[b.spec.kind]);
      const n = this.night;
      // The first main light becomes a spotlight with shadows.
      const main = specs.find((s) => s.spec.kind === 'main');
      if (main) {
        this.mainSpot.position.copy(main.p);
        this.mainSpot.target.position.set(main.p.x, 0, main.p.z);
        this.mainSpot.color.set(main.spec.color);
        this.mainSpot.intensity = main.spec.intensity * (n ? 1.1 : 0.08);
        this.mainSpot.distance = 0;
        main.used = true;
      } else this.mainSpot.intensity = 0;
      let i = 0;
      for (const s of specs) {
        if (s.used) continue;
        if (i >= this.pool.length) break;
        const l = this.pool[i++];
        l.position.copy(s.p);
        l.color.set(s.spec.color);
        const k = s.spec.kind === 'main' ? (n ? 1 : 0.15) : s.spec.kind === 'lamp' ? (n ? 1 : 0.3) : n ? 1 : 0.2;
        l.intensity = s.spec.intensity * k;
        l.distance = s.spec.distance || 0;
        l.userData.owner = s.owner;
        l.userData.baseIntensity = l.intensity;
      }
      for (; i < this.pool.length; i++) { this.pool[i].intensity = 0; this.pool[i].userData.owner = null; }
      this.dirty = true;
    }

    animateLeds(t) {
      for (const a of this.animated) {
        let col = null, k = 1;
        if (a.mode === 'breathe') k = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.2));
        if (a.mode === 'cycle' || a.mode === 'rainbow') col = new THREE.Color().setHSL((t * 0.08 + a.phase) % 1, 1, 0.55);
        for (const m of a.mats) {
          m.emissiveIntensity = m.userData.led.base * k;
          if (a.mode === 'cycle') m.emissive.copy(col);
          if (a.mode === 'rainbow' && m.emissiveMap) m.emissiveMap.offset.x = (m.emissiveMap.offset.x - 0.004) % 1;
        }
        for (const gl of a.glows) {
          if (col) gl.material.color.copy(col);
          gl.material.opacity = (gl.userData.glowBase || 0.8) * (this.night ? 1 : 0.22) * k;
        }
        for (const l of this.pool) {
          if (l.userData.owner !== a.group) continue;
          if (col) l.color.copy(col);
          l.intensity = l.userData.baseIntensity * k;
        }
      }
    }

    // ------------------------------------------------------------------ syncing with the project
    sync() {
      const p = this.project();
      const roomKey = JSON.stringify([p.room, p.openings]);
      let roomChanged = false;
      if (roomKey !== this.roomKey) {
        this.roomKey = roomKey;
        this.buildRoom();
        roomChanged = true;
      }
      const seen = new Set();
      for (const it of p.items) {
        seen.add(it.id);
        const rec = this.items.get(it.id);
        const shapeKey = JSON.stringify([it.type, it.w, it.d, it.h, it.color, it.color2, it.opts, it.customId, it.mount, it.type === 'custom' ? (this.hooks.stuff(it.customId) || {}).rev : 0]);
        if (!rec || rec.shapeKey !== shapeKey) {
          if (rec) this.disposeItem(rec);
          this.items.set(it.id, this.buildItem(it, shapeKey));
        } else {
          rec.it = it;
        }
        this.placeItem(this.items.get(it.id));
      }
      for (const [id, rec] of this.items) if (!seen.has(id)) { this.disposeItem(rec); this.items.delete(id); }
      this.collectAnimated();
      this.updateCutaway();
      this.applyLights();
      this.applyLighting();
      if (this.selected) {
        const still = this.selected.kind === 'item' ? this.items.has(this.selected.id)
          : this.selected.kind === 'opening' ? p.openings.some((o) => o.id === this.selected.id)
          : this.selected.kind === 'wall' ? this.selected.index < p.room.points.length : true;
        if (!still) this.select(null);
        else this.showSelection();
      }
      if (roomChanged && this.view === 'walk') this.clampWalk();
      this.dirty = true;
    }

    disposeItem(rec) {
      this.itemsGroup.remove(rec.group);
      rec.group.traverse((o) => {
        if (o.geometry && !o.geometry.userData.shared && o.userData.ownGeo) o.geometry.dispose();
      });
    }

    buildItem(it, shapeKey) {
      const group = new THREE.Group();
      group.userData = { kind: 'item', id: it.id };
      const ctx = this.buildContext();
      const model = C.build(it, ctx);
      model.scale.setScalar(S);
      group.add(model);
      this.itemsGroup.add(group);
      return { it, group, model, shapeKey };
    }

    /** What item builders need: pictures, "my stuff" and loaded 3D scans. */
    buildContext() {
      return {
        texture: (id) => this.texture(id),
        custom: (id) => this.hooks.stuff(id),
        model: (blobId, name) => RD.models.get(blobId, name, () => this.modelReady()),
      };
    }

    /** A 3D scan finished loading: rebuild the things that use it. */
    modelReady() {
      for (const rec of this.items.values()) if (rec.it.type === 'custom') rec.shapeKey = '';
      this.sync();
    }

    /** Where an item sits, in centimetres: {x, y, z, rot}. */
    itemPose(it) {
      const room = this.room;
      if (it.mount === 'wall') {
        const ws = G.walls(room.points);
        const w = ws[it.wall] || ws[0];
        const along = U.clamp(it.along == null ? w.len / 2 : it.along, 0, w.len);
        const p = G.pointOnWall(w, along);
        const off = it.d / 2 + 0.3;
        return { x: p[0] + w.n[0] * off, z: p[1] + w.n[1] * off, y: it.y || 0, rot: G.facingAngle(w), wall: w.i };
      }
      if (it.mount === 'ceiling') return { x: it.x, z: it.z, y: this.ceilingAt(it.x, it.z) - it.h, rot: it.rot || 0 };
      return { x: it.x, z: it.z, y: it.y || 0, rot: it.rot || 0 };
    }

    placeItem(rec) {
      const pose = this.itemPose(rec.it);
      rec.group.position.set(pose.x * S, pose.y * S, pose.z * S);
      rec.group.rotation.set(0, pose.rot, 0);
      rec.wall = pose.wall;
      rec.group.visible = !(rec.it.mount === 'ceiling' && this.view === 'top');
    }

    collectAnimated() {
      this.animated = [];
      const add = (group, mode, phase) => {
        const mats = [], glows = [];
        group.traverse((o) => {
          if (o.material && o.material.userData && o.material.userData.led) mats.push(o.material);
          if (o.userData.glow) glows.push(o);
        });
        this.animated.push({ group, mode, mats, glows, phase: phase || 0 });
      };
      for (const rec of this.items.values()) {
        const mode = rec.it.opts && rec.it.opts.mode;
        if (mode && mode !== 'solid') add(rec.model, mode, (rec.it.x || 0) * 0.001);
      }
      const led = this.room.led;
      if (led && led.on && led.mode && led.mode !== 'solid') for (const g of this.roomLeds || []) add(g, led.mode, 0);
    }

    /** Texture from a stored picture; loads in the background and redraws when ready. */
    texture(blobId) {
      if (!blobId) return null;
      if (this.textures.has(blobId)) return this.textures.get(blobId);
      const tex = new THREE.Texture();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      tex.userData.copies = [];
      this.textures.set(blobId, tex);
      RD.db.getBlob(blobId).then((blob) => (blob ? U.loadImage(blob) : null)).then((img) => {
        if (!img) return;
        for (const t of [tex].concat(tex.userData.copies)) { t.image = img; t.needsUpdate = true; }
        this.dirty = true;
      }).catch(() => {});
      return tex;
    }

    /** Separate copy of a picture texture (own repeat/offset), kept up to date when the picture loads. */
    textureCopy(blobId) {
      const base = this.texture(blobId);
      const t = base.clone();
      t.userData = {};
      if (base.image) t.needsUpdate = true;
      else base.userData.copies.push(t);
      return t;
    }

    // ------------------------------------------------------------------ room
    buildRoom() {
      const old = this.roomGroup;
      old.traverse((o) => { if (o.geometry && o.userData.own) o.geometry.dispose(); });
      old.clear();
      const room = this.room;
      const pts = room.points;
      const H = room.height;
      const t = room.thickness || 12;
      const walls = (this.walls = G.walls(pts));
      const planes = (this.planes = G.ceilingPlanes(room));
      const sloped = (this.sloped = G.hasSlopes(room));
      const profiles = (this.profiles = walls.map((w, i) => G.wallProfile(room, i, planes)));
      this.clipPlanes = planes.map((p) => new THREE.Plane(new THREE.Vector3(p.a, -1, p.b), p.c * S).normalize()).concat([this.clipBottom]);
      const outer = G.offsetOutward(pts, t);
      this.wallFrames = [];
      this.roomLeds = [];
      const openings = this.project().openings || [];

      // Floor and ceiling.
      const floorGeo = this.planGeometry(pts, 0, true);
      const fl = room.floor || {};
      let fmap = null;
      if (fl.type === 'photo' && fl.texId) {
        fmap = this.textureCopy(fl.texId);
        const size = (fl.sizeCm || 100) / 100;
        fmap.wrapS = fmap.wrapT = THREE.RepeatWrapping;
        fmap.repeat.set(1 / size, 1 / size);
      } else {
        fmap = T.pattern(fl.type || 'wood', fl.color || '#b98a5a', fl.color2);
        if (fmap) fmap.repeat.set(1 / fmap.userData.sizeM, 1 / fmap.userData.sizeM);
      }
      const floorMat = new THREE.MeshStandardMaterial({
        color: fmap ? '#ffffff' : fl.color || '#cfc8bd', map: fmap,
        roughness: fl.type === 'tile' || fl.type === 'checker' ? 0.35 : fl.type === 'carpet' ? 0.98 : 0.6,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.receiveShadow = true;
      floor.userData = { kind: 'floor', own: true };
      this.roomGroup.add(floor);
      this.floorMesh = floor;

      const ceilGeo = sloped ? this.slopedCeilingGeometry(room, planes) : this.planGeometry(pts, H, false);
      const ceil = new THREE.Mesh(ceilGeo, new THREE.MeshStandardMaterial({ color: (room.ceiling && room.ceiling.color) || '#ffffff', roughness: 0.9 }));
      ceil.userData = { kind: 'ceiling', own: true };
      ceil.receiveShadow = true;
      this.roomGroup.add(ceil);
      this.ceilingMesh = ceil;

      // Dark outline of the walls on the ground (visible where walls are cut away).
      const ring = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], -p[1])));
      ring.holes.push(new THREE.Path(pts.map((p) => new THREE.Vector2(p[0], -p[1]))));
      const ringGeo = new THREE.ShapeGeometry(ring);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.scale(S, S, S);
      const ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#3a3d42', side: THREE.DoubleSide }));
      ringMesh.position.y = 0.001;
      ringMesh.userData.own = true;
      this.roomGroup.add(ringMesh);

      const shellMat = T.mat('#f2f0ec', { rough: 0.9, side: THREE.DoubleSide });
      const capMat = new THREE.MeshBasicMaterial({ color: '#3a3d42', side: THREE.DoubleSide });

      walls.forEach((w, i) => {
        const frame = new THREE.Group();
        frame.matrixAutoUpdate = false;
        const basis = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(w.dir[0], 0, w.dir[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(w.n[0], 0, w.n[1]));
        basis.setPosition(w.a[0] * S, 0, w.a[1] * S);
        frame.matrix.copy(basis).multiply(new THREE.Matrix4().makeScale(S, S, S));
        frame.userData = { kind: 'wallFrame', index: i };
        this.roomGroup.add(frame);
        this.wallFrames.push(frame);

        const prof = profiles[i];
        const topH = Math.max(...prof.map((q) => q[1]));
        const holes = this.wallHoles(openings, i, w.len, prof);
        // Inside surface (the part you paint).
        const surfGeo = this.wallSurface(0, w.len, prof, holes);
        const surf = new THREE.Mesh(surfGeo, this.wallMaterial(room.walls[i] || {}, w.len, topH));
        surf.receiveShadow = true;
        surf.userData = { kind: 'wall', index: i, own: true };
        frame.add(surf);

        // Outside, thickness and the dark top edge.
        const s0 = (outer[i][0] - w.a[0]) * w.dir[0] + (outer[i][1] - w.a[1]) * w.dir[1];
        const s1 = (outer[(i + 1) % pts.length][0] - w.a[0]) * w.dir[0] + (outer[(i + 1) % pts.length][1] - w.a[1]) * w.dir[1];
        const outGeo = this.wallSurface(s0, s1, prof, holes);
        outGeo.translate(0, 0, -t);
        const parts = [outGeo];
        for (const hl of holes) parts.push(this.reveal(hl, t));
        const shell = new THREE.Mesh(THREE.mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), shellMat);
        shell.userData = { kind: 'shell', own: true };
        frame.add(shell);
        // the top edge follows the wall's height (sloped under a sloping ceiling)
        const capQuads = [];
        for (let k = 1; k < prof.length; k++) {
          const [u0, h0] = prof[k - 1], [u1, h1] = prof[k];
          capQuads.push(this.quadGeo([[u0, h0, 0], [u1, h1, 0], [k === prof.length - 1 ? s1 : u1, h1, -t], [k === 1 ? s0 : u0, h0, -t]]));
        }
        const cap = new THREE.Mesh(THREE.mergeGeometries(capQuads), capMat);
        cap.userData.own = true;
        frame.add(cap);

        for (const op of openings.filter((o) => o.wall === i)) {
          const m = C.buildOpening(op, t);
          const along = U.clamp(op.along, op.width / 2, w.len - op.width / 2);
          m.position.set(along, op.sill || 0, 0);
          m.userData = { kind: 'opening', id: op.id };
          frame.add(m);
        }

        // LED strip around the room: along the floor, or just under the top of each wall (following slopes).
        const led = room.led;
        if (led && led.on) {
          const g = new THREE.Group();
          const segs = led.where === 'floor' ? [[[2, 9], [w.len - 2, 9]]] : prof.slice(1).map((q, k) => [prof[k], q]);
          const lights = [];
          for (const [[u0, h0], [u1, h1]] of segs) {
            const len = Math.hypot(u1 - u0, h1 - h0);
            if (len < 8) continue;
            const fake = { w: len - 4, d: 1.6, h: 1.4, color: led.color || '#9b5cff', opts: { mode: led.mode, brightness: led.brightness || 1 } };
            const strip = C.build(Object.assign({ type: 'ledStrip' }, fake), null);
            const holder = new THREE.Group();
            holder.position.set((u0 + u1) / 2, (h0 + h1) / 2 - 3, 1);
            holder.rotation.z = Math.atan2(h1 - h0, u1 - u0);
            holder.add(strip);
            g.add(holder);
            if (len > 60) {
              const mu = (u0 + u1) / 2, mh = (h0 + h1) / 2;
              for (const l of strip.userData.lights || []) lights.push(Object.assign({}, l, { pos: [mu, led.where === 'floor' ? 35 : mh - 33, 45], intensity: l.intensity * 0.8 * Math.min(1, len / w.len) }));
            }
            strip.userData.lights = null;
          }
          g.userData.lights = lights.slice(0, 2);
          frame.add(g);
          this.roomLeds.push(g);
        }
      });

      // Plan view: outline of the sloping parts of the ceiling.
      if (this.slopeLines) this.helpers.remove(this.slopeLines);
      this.slopeLines = new THREE.Group();
      this.slopeLabels = [];
      if (sloped) {
        const dash = new THREE.LineDashedMaterial({ color: '#ff5a36', dashSize: 0.08, gapSize: 0.06, depthTest: false, transparent: true });
        for (const pc of G.ceilingPieces(room, planes)) {
          if (pc.plane.wall < 0) continue;
          const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pc.poly.map((q) => new THREE.Vector3(q[0] * S, 0.006, q[1] * S))), dash);
          line.computeLineDistances();
          line.renderOrder = 5;
          this.slopeLines.add(line);
          const sl = room.walls[pc.plane.wall].slope;
          const info = G.slopeInfo(room, sl);
          const cx = pc.poly.reduce((a, q) => a + q[0], 0) / pc.poly.length, cz = pc.poly.reduce((a, q) => a + q[1], 0) / pc.poly.length;
          this.slopeLabels.push({ x: cx, z: cz, text: `Slope ${Math.round(info.angle)}° · ${U.fmtLen(sl.knee)} → ${U.fmtLen(H)}` });
        }
      }
      this.slopeLines.visible = this.view === 'top';
      this.helpers.add(this.slopeLines);

      // Sun shadow covers the whole room.
      const b = G.bounds(pts);
      const cx = b.cx * S, cz = b.cz * S, rad = Math.max(b.w, b.l) * S * 0.75 + 1;
      this.sun.position.set(cx + rad * 0.5, H * S + 6, cz + rad * 0.35);
      this.sun.target.position.set(cx, 0, cz);
      const sc = this.sun.shadow.camera;
      sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 0.5; sc.far = 20;
      sc.updateProjectionMatrix();

      // Plan grid for the top view.
      if (this.grid) this.helpers.remove(this.grid);
      const size = Math.ceil(Math.max(b.w, b.l) / 100 + 2);
      this.grid = new THREE.GridHelper(size, size * 2, '#9aa3ad', '#c9cfd6');
      this.grid.material.transparent = true;
      this.grid.material.opacity = 0.5;
      this.grid.position.set(Math.round(b.cx / 50) * 0.5, 0.003, Math.round(b.cz / 50) * 0.5);
      this.grid.visible = this.view === 'top';
      this.helpers.add(this.grid);

      if (!this.cameraPlaced) { this.cameraPlaced = true; this.focusRoom(true); }
      for (const rec of this.items.values()) this.placeItem(rec);
    }

    /** Triangulated floor/ceiling at height y (cm); faces up for the floor, down for the ceiling. */
    planGeometry(pts, y, up) {
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const pos = [], nor = [], uv = [];
      for (const [a, b0, c0] of tris) {
        let b = b0, c = c0;
        const pa = pts[a], pb = pts[b], pc = pts[c];
        const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
        if ((ny < 0) === up) { const tmp = b; b = c; c = tmp; }
        for (const k of [a, b, c]) {
          pos.push(pts[k][0] * S, y * S, pts[k][1] * S);
          nor.push(0, up ? 1 : -1, 0);
          uv.push(pts[k][0] / 100, pts[k][1] / 100);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    }

    /** Door and window holes on a wall, clamped to the wall (and under its top) and not overlapping. */
    wallHoles(openings, i, len, prof) {
      const holes = openings.filter((o) => o.wall === i).map((o) => {
        const along = U.clamp(o.along, o.width / 2, len - o.width / 2);
        const sill = o.sill || 0;
        const u0 = Math.max(1, along - o.width / 2), u1 = Math.min(len - 1, along + o.width / 2);
        return { u0, u1, v0: sill <= 0.5 ? 0 : sill, v1: Math.min(G.profileMin(prof, u0, u1) - 2, sill + o.height) };
      }).filter((h) => h.u1 - h.u0 > 2 && h.v1 - h.v0 > 2).sort((a, b) => a.u0 - b.u0);
      const out = [];
      for (const h of holes) {
        const prev = out[out.length - 1];
        if (prev && h.u0 < prev.u1 + 1) continue;
        out.push(h);
      }
      return out;
    }

    /**
     * Wall face from u = a to u = b (cm) whose top follows prof ([[u, h], ...]), with door notches and
     * window holes. UVs in metres.
     */
    wallSurface(a, b, prof, holes) {
      const doors = holes.filter((h) => h.v0 === 0);
      const wins = holes.filter((h) => h.v0 > 0);
      const pts = [[a, 0]];
      for (const d of doors) pts.push([d.u0, 0], [d.u0, d.v1], [d.u1, d.v1], [d.u1, 0]);
      pts.push([b, 0], [b, G.profileAt(prof, b)]);
      for (let k = prof.length - 1; k >= 0; k--) if (prof[k][0] > a + 0.01 && prof[k][0] < b - 0.01) pts.push([prof[k][0], prof[k][1]]);
      pts.push([a, G.profileAt(prof, a)]);
      const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
      for (const w of wins) shape.holes.push(new THREE.Path([[w.u0, w.v0], [w.u1, w.v0], [w.u1, w.v1], [w.u0, w.v1]].map((p) => new THREE.Vector2(p[0], p[1]))));
      const g = new THREE.ShapeGeometry(shape);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 100, uv.getY(k) / 100);
      return g;
    }

    /** Sloped ceiling: each flat piece at its own slant, facing down into the room. */
    slopedCeilingGeometry(room, planes) {
      const pos = [], uv = [];
      for (const pc of G.ceilingPieces(room, planes)) {
        const pts = pc.poly;
        const tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []);
        const hAt = (q) => pc.plane.a * q[0] + pc.plane.b * q[1] + pc.plane.c;
        for (const [a, b0, c0] of tris) {
          let b = b0, c = c0;
          const pa = pts[a], pb = pts[b], pc2 = pts[c];
          const ny = (pb[1] - pa[1]) * (pc2[0] - pa[0]) - (pb[0] - pa[0]) * (pc2[1] - pa[1]);
          if (ny > 0) { const tmp = b; b = c; c = tmp; }
          for (const k of [a, b, c]) {
            pos.push(pts[k][0] * S, hAt(pts[k]) * S, pts[k][1] * S);
            uv.push(pts[k][0] / 100, pts[k][1] / 100);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    }

    /** Ceiling height (cm) above a point of the floor. */
    ceilingAt(x, z) { return G.ceilingAt(this.room, x, z, this.planes); }

    /** How high the top of wall i is, at its lowest, between u0 and u1 (cm). */
    wallTop(i, u0, u1) {
      const prof = (this.profiles && this.profiles[i]) || G.wallProfile(this.room, i);
      return G.profileMin(prof, Math.max(0, u0), u1);
    }

    /** The inside edges of a door/window hole through the thickness of the wall. */
    reveal(h, t) {
      const quads = [];
      if (h.v0 > 0) quads.push([[h.u0, h.v0, 0], [h.u1, h.v0, 0], [h.u1, h.v0, -t], [h.u0, h.v0, -t]]);
      quads.push([[h.u0, h.v1, 0], [h.u1, h.v1, 0], [h.u1, h.v1, -t], [h.u0, h.v1, -t]]);
      quads.push([[h.u0, h.v0, 0], [h.u0, h.v1, 0], [h.u0, h.v1, -t], [h.u0, h.v0, -t]]);
      quads.push([[h.u1, h.v0, 0], [h.u1, h.v1, 0], [h.u1, h.v1, -t], [h.u1, h.v0, -t]]);
      return THREE.mergeGeometries(quads.map((q) => this.quadGeo(q)));
    }

    quadGeo(q) {
      const pos = [...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      g.computeVertexNormals();
      return g;
    }

    wallMaterial(wall, len, H) {
      const finish = wall.finish || 'paint';
      const color = wall.color || '#f4f1ea';
      if (finish === 'photo' && wall.photo && wall.photo.texId) {
        const tex = this.textureCopy(wall.photo.texId);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(100 / len, 100 / H);
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      }
      const map = T.pattern(finish, color, wall.color2);
      if (map) map.repeat.set(1 / map.userData.sizeM, 1 / map.userData.sizeM);
      return new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, map, roughness: finish === 'paint' ? 0.92 : 0.8 });
    }

    // ------------------------------------------------------------------ cutaway walls
    setCutaway(on) { this.cutaway = !!on; this.updateCutaway(); this.dirty = true; }

    updateCutaway() {
      if (!this.walls || !this.wallFrames) return;
      const cam = this.camera.position;
      this.hiddenWalls = new Set();
      this.walls.forEach((w, i) => {
        let hide = false;
        if (this.view === '3d' && this.cutaway) {
          const mx = ((w.a[0] + w.b[0]) / 2) * S, mz = ((w.a[1] + w.b[1]) / 2) * S;
          hide = (cam.x - mx) * w.n[0] + (cam.z - mz) * w.n[1] < -0.05;
        }
        if (hide) this.hiddenWalls.add(i);
        if (this.wallFrames[i]) this.wallFrames[i].visible = !hide;
      });
      for (const rec of this.items.values()) {
        const ceilingHidden = rec.it.mount === 'ceiling' && this.view === 'top';
        rec.wallHidden = rec.it.mount === 'wall' && this.hiddenWalls.has(rec.wall);
        rec.group.visible = !ceilingHidden && !rec.wallHidden;
      }
      if (this.ceilingMesh) this.ceilingMesh.visible = this.view === 'walk' || (this.view === '3d' && this.sloped);
      if (this.slopeLines) this.slopeLines.visible = this.view === 'top';
      const before = this.lastHiddenKey;
      this.lastHiddenKey = Array.from(this.hiddenWalls).join(',');
      if (before !== undefined && before !== this.lastHiddenKey) this.applyLights();
    }

    // ------------------------------------------------------------------ views
    setView(v) {
      const prev = this.view;
      this.view = v;
      this.orbit.enabled = v === '3d';
      this.top.enabled = v === 'top';
      if (v === '3d') this.camera = this.persp;
      if (v === 'top') {
        this.camera = this.ortho;
        if (prev !== 'top') this.focusTop();
      }
      if (v === 'walk') {
        this.camera = this.walkCam;
        if (prev !== 'walk') this.startWalk();
      }
      if (this.grid) this.grid.visible = v === 'top';
      for (const rec of this.items.values()) this.placeItem(rec);
      this.updateCutaway();
      this.showSelection();
      this.renderer.domElement.style.cursor = v === 'walk' ? 'grab' : '';
      this.dirty = true;
    }

    focusRoom(instant) {
      const b = G.bounds(this.room.points);
      const H = this.room.height;
      const target = new THREE.Vector3(b.cx * S, H * S * 0.3, b.cz * S);
      // distance so the whole room fits, also on narrow phone screens
      const radius = (Math.hypot(b.w, b.l, H) * S) / 2;
      const fov = (this.persp.fov * Math.PI) / 180;
      const fit = radius / Math.sin(Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.persp.aspect)) / 2);
      const dir = new THREE.Vector3(-0.42, 0.78, 0.95).normalize();
      this.orbit.target.copy(target);
      this.persp.position.copy(target).addScaledVector(dir, fit * 0.92);
      this.persp.lookAt(target);
      this.orbit.update();
      this.updateCutaway();
      this.dirty = true;
      if (!instant) this.focusTop();
    }

    focusTop() {
      const b = G.bounds(this.room.points);
      this.orthoSpan = Math.max(b.w, b.l) * S * 1.3 + 0.8;
      this.ortho.zoom = 1;
      this.updateOrtho();
      const pad = U.isPhone() ? 0.12 : 0;
      this.ortho.position.set(b.cx * S, 30, b.cz * S + this.orthoSpan * pad);
      this.ortho.up.set(0, 0, -1);
      this.ortho.lookAt(b.cx * S, 0, b.cz * S + this.orthoSpan * pad);
      this.top.target.set(b.cx * S, 0, b.cz * S + this.orthoSpan * pad);
      this.top.update();
    }

    startWalk() {
      const pts = this.room.points;
      const b = G.bounds(pts);
      let x = b.cx, z = b.cz;
      if (!G.pointInPolygon(x, z, pts)) { const p = G.nearestWall(pts, x, z); const q = G.pointOnWall(p.wall, p.along); x = q[0] + p.wall.n[0] * 60; z = q[1] + p.wall.n[1] * 60; }
      // stand just inside the door (or in front of the longest wall) looking into the room
      const ws = G.walls(pts);
      const door = this.project().openings.find((o) => o.type !== 'window');
      const w0 = door ? ws[door.wall] : ws.reduce((a, w) => (w.len > a.len ? w : a), ws[0]);
      const back = G.pointOnWall(w0, door ? door.along : w0.len / 2);
      x = back[0] + w0.n[0] * 45; z = back[1] + w0.n[1] * 45;
      this.walk.pos = [x, z];
      this.walk.yaw = Math.atan2(-w0.n[0], -w0.n[1]);
      this.walk.pitch = -0.08;
      this.clampWalk();
      this.updateWalkCamera();
    }

    clampWalk() {
      if (!this.walk.pos) return;
      let [x, z] = G.keepInside(this.room.points, this.walk.pos[0], this.walk.pos[1], 40, 40, 0, 0);
      // don't walk into a sloping ceiling: step back towards the middle of the room
      const b = G.bounds(this.room.points);
      const eye = Math.min(160, this.room.height - 20);
      for (let k = 0; k < 60 && this.ceilingAt(x, z) < eye + 25; k++) {
        const dx = b.cx - x, dz = b.cz - z, d = Math.hypot(dx, dz) || 1;
        x += (dx / d) * 4; z += (dz / d) * 4;
      }
      this.walk.pos = [x, z];
      this.updateWalkCamera();
    }

    updateWalkCamera() {
      const eye = Math.min(160, this.room.height - 20);
      const c = this.walkCam;
      c.position.set(this.walk.pos[0] * S, eye * S, this.walk.pos[1] * S);
      c.rotation.set(0, 0, 0);
      c.rotation.order = 'YXZ';
      c.rotation.y = this.walk.yaw;
      c.rotation.x = this.walk.pitch;
      this.dirty = true;
    }

    /** move: [forward, strafe, turn] from -1 to 1 (on-screen buttons). */
    setWalkInput(forward, strafe, turn) { this.walk.move = [forward, strafe, turn]; }

    updateWalk(dt) {
      if (this.view !== 'walk' || !this.walk.pos) return false;
      const k = this.walk.keys;
      let f = this.walk.move[0], s = this.walk.move[1], t = this.walk.move[2];
      if (k.has('w') || k.has('arrowup')) f += 1;
      if (k.has('s') || k.has('arrowdown')) f -= 1;
      if (k.has('a')) s -= 1;
      if (k.has('d')) s += 1;
      if (k.has('arrowleft') || k.has('q')) t += 1;
      if (k.has('arrowright') || k.has('e')) t -= 1;
      if (!f && !s && !t) return false;
      this.walk.yaw += t * dt * 1.6;
      const speed = 140 * dt;
      const sin = Math.sin(this.walk.yaw), cos = Math.cos(this.walk.yaw);
      this.walk.pos[0] += (-sin * f + cos * s) * speed;
      this.walk.pos[1] += (-cos * f - sin * s) * speed;
      this.clampWalk();
      return true;
    }

    // ------------------------------------------------------------------ picking & dragging
    ndc(e) {
      const r = this.renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    }

    visibleChain(o) {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    }

    /** What is under the pointer: {kind: 'item'|'opening'|'wall'|'floor', id|index, point, object}. */
    pick(e, opts) {
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const targets = [this.itemsGroup, this.roomGroup];
      const hits = this.raycaster.intersectObjects(targets, true);
      for (const h of hits) {
        if (h.object.userData.glow || h.object.isLine || !this.visibleChain(h.object)) continue;
        if (h.object.material && h.object.material.userData && h.object.material.userData.noPick) continue;
        for (let o = h.object; o; o = o.parent) {
          const k = o.userData && o.userData.kind;
          if (k === 'item' || k === 'opening') {
            if (opts && opts.exclude === o.userData.id) break;
            return { kind: k, id: o.userData.id, point: h.point, object: h.object, face: h.face };
          }
          if (k === 'wall') return { kind: 'wall', index: o.userData.index, point: h.point, object: o };
          if (k === 'floor') return { kind: 'floor', point: h.point };
          if (k === 'shell' || k === 'ceiling') return null;
        }
      }
      return null;
    }

    bindPointer() {
      const c = this.renderer.domElement;
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
      window.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      window.addEventListener('pointercancel', (e) => this.onUp(e, true));
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('wheel', () => { this.dirty = true; }, { passive: true });
    }

    onDown(e) {
      if (this.downInfo && this.downInfo.id !== e.pointerId) { this.cancelDrag(); this.downInfo.multi = true; return; }
      const hit = this.pick(e);
      this.downInfo = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), hit, moved: false };
      if (hit && (hit.kind === 'item' || hit.kind === 'opening') && e.button === 0) {
        if (!this.selected || this.selected.id !== hit.id) this.select({ kind: hit.kind, id: hit.id });
        this.orbit.enabled = this.top.enabled = false;
        this.prepareDrag(hit, e);
      } else if (this.view === 'walk') {
        this.downInfo.look = { yaw: this.walk.yaw, pitch: this.walk.pitch };
      }
    }

    onMove(e) {
      const d = this.downInfo;
      if (!d || d.id !== e.pointerId) { if (e.pointerType === 'mouse' && !e.buttons) this.hover(e); return; }
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (dist > 4) d.moved = true;
      if (this.drag && d.moved && !d.multi) {
        this.drag.active = true;
        this.dragTo(e);
      } else if (d.look && d.moved) {
        const k = U.isTouch() ? 0.006 : 0.004;
        this.walk.yaw = d.look.yaw + (e.clientX - d.x) * k;
        this.walk.pitch = U.clamp(d.look.pitch + (e.clientY - d.y) * k, -1.2, 1.2);
        this.updateWalkCamera();
      }
    }

    onUp(e, cancelled) {
      const d = this.downInfo;
      if (!d || d.id !== e.pointerId) return;
      this.downInfo = null;
      const wasDrag = this.drag && this.drag.active;
      if (wasDrag && !cancelled) this.commitDrag();
      this.drag = null;
      this.orbit.enabled = this.view === '3d';
      this.top.enabled = this.view === 'top';
      if (!d.moved && !d.multi && !cancelled && performance.now() - d.t < 700) {
        const h = d.hit;
        if (!h) this.select(null);
        else if (h.kind === 'wall') this.select({ kind: 'wall', index: h.index });
        else if (h.kind === 'floor') this.select({ kind: 'floor' });
      }
    }

    hover(e) {
      if (this.hoverPending) return;
      this.hoverPending = true;
      requestAnimationFrame(() => {
        this.hoverPending = false;
        if (this.downInfo || this.view === 'walk') return;
        const h = this.pick(e);
        this.renderer.domElement.style.cursor = h && (h.kind === 'item' || h.kind === 'opening') ? 'grab' : '';
      });
    }

    prepareDrag(hit, e) {
      const p = this.project();
      if (hit.kind === 'item') {
        const it = p.items.find((i) => i.id === hit.id);
        if (!it || it.locked) return;
        const rec = this.items.get(it.id);
        const pose = this.itemPose(it);
        this.drag = { kind: 'item', it, rec, pose: Object.assign({}, pose), start: Object.assign({}, pose) };
        if (it.mount === 'wall') {
          const loc = this.wallLocal(e, pose.wall);
          if (loc) { this.drag.offA = (it.along == null ? 0 : it.along) - loc.u; this.drag.offY = (it.y || 0) - loc.v; }
          this.drag.wall = pose.wall;
          this.drag.along = it.along;
          this.drag.y = it.y || 0;
        } else {
          const planeY = (it.mount === 'ceiling' ? this.room.height : pose.y) * S;
          const P = this.planeHit(e, planeY);
          if (P) this.drag.off = [pose.x - P.x / S, pose.z - P.z / S];
          else this.drag.off = [0, 0];
        }
      } else {
        const op = p.openings.find((o) => o.id === hit.id);
        if (!op) return;
        const loc = this.wallLocal(e, op.wall);
        this.drag = { kind: 'opening', op, wall: op.wall, along: op.along, sill: op.sill, offA: loc ? op.along - loc.u : 0, offY: loc ? (op.sill || 0) - loc.v : 0 };
      }
      this.renderer.domElement.style.cursor = 'grabbing';
    }

    cancelDrag() {
      if (!this.drag) return;
      if (this.drag.kind === 'item') this.placeItem(this.drag.rec);
      this.drag = null;
      this.buildRoomIfDirty();
    }

    buildRoomIfDirty() { this.roomKey = ''; this.sync(); }

    planeHit(e, y) {
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
      const P = new THREE.Vector3();
      return this.raycaster.ray.intersectPlane(plane, P) ? P : null;
    }

    /** Pointer position on wall i's plane, in wall coordinates (u along, v up), cm. */
    wallLocal(e, i) {
      const w = this.walls[i];
      if (!w) return null;
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const n = new THREE.Vector3(w.n[0], 0, w.n[1]);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(w.a[0] * S, 0, w.a[1] * S));
      const P = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plane, P)) return null;
      return { u: (P.x / S - w.a[0]) * w.dir[0] + (P.z / S - w.a[1]) * w.dir[1], v: P.y / S };
    }

    /** Wall under the pointer (only walls you can see), in wall coordinates. */
    wallUnderPointer(e) {
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const surfaces = [];
      this.wallFrames.forEach((f) => { if (f.visible) f.children.forEach((c) => { if (c.userData.kind === 'wall') surfaces.push(c); }); });
      const hit = this.raycaster.intersectObjects(surfaces, false)[0];
      if (!hit) return null;
      const i = hit.object.userData.index;
      const w = this.walls[i];
      return { i, u: (hit.point.x / S - w.a[0]) * w.dir[0] + (hit.point.z / S - w.a[1]) * w.dir[1], v: hit.point.y / S };
    }

    dragTo(e) {
      const d = this.drag;
      const room = this.room;
      if (d.kind === 'opening') {
        let hit = this.wallUnderPointer(e);
        if (!hit) { const l = this.wallLocal(e, d.wall); if (l) hit = Object.assign({ i: d.wall }, l); }
        if (!hit) return;
        const w = this.walls[hit.i];
        d.wall = hit.i;
        d.along = U.round(U.clamp(hit.u + d.offA, d.op.width / 2 + 1, w.len - d.op.width / 2 - 1), 1);
        if (d.op.type === 'window') d.sill = U.round(U.clamp(hit.v + d.offY, 5, Math.max(5, this.wallTop(hit.i, d.along - d.op.width / 2, d.along + d.op.width / 2) - d.op.height - 5)), 1);
        this.previewOpening(d);
        return;
      }
      const it = d.it;
      if (it.mount === 'wall') {
        let hit = this.wallUnderPointer(e);
        if (!hit) { const l = this.wallLocal(e, d.wall); if (l) hit = Object.assign({ i: d.wall }, l); }
        if (!hit) return;
        const w = this.walls[hit.i];
        d.wall = hit.i;
        d.along = U.round(U.clamp(hit.u + (d.offA || 0), Math.min(it.w / 2, w.len / 2), Math.max(w.len - it.w / 2, w.len / 2)), 0.5);
        const top = this.wallTop(hit.i, d.along - it.w / 2, d.along + it.w / 2);
        let y = U.clamp(hit.v + (d.offY || 0), 0, Math.max(0, top - it.h));
        if (top - it.h - y < 6) y = Math.max(0, top - it.h - 1); // snap to just under the top of the wall
        if (y < 4) y = 0;
        d.y = U.round(y, 0.5);
        const pose = this.itemPose(Object.assign({}, it, { wall: d.wall, along: d.along, y: d.y }));
        d.rec.group.position.set(pose.x * S, pose.y * S, pose.z * S);
        d.rec.group.rotation.y = pose.rot;
        d.rec.wall = d.wall;
      } else if (it.mount === 'ceiling') {
        const P = this.planeHit(e, room.height * S);
        if (!P) return;
        let x = P.x / S + d.off[0], z = P.z / S + d.off[1];
        [x, z] = G.keepInside(room.points, x, z, it.w, it.d, it.rot || 0, 0);
        d.pose.x = U.round(x, 0.5); d.pose.z = U.round(z, 0.5);
        d.rec.group.position.set(d.pose.x * S, (this.ceilingAt(d.pose.x, d.pose.z) - it.h) * S, d.pose.z * S);
      } else {
        // Floor items can also stand on other things (a lamp on a desk).
        let baseY = 0;
        this.raycaster.setFromCamera(this.ndc(e), this.camera);
        const others = [];
        for (const rec of this.items.values()) if (rec !== d.rec && rec.group.visible && rec.it.mount !== 'ceiling' && rec.it.type !== 'rug') others.push(rec.group);
        const hits = this.raycaster.intersectObjects(others, true);
        for (const h of hits) {
          if (h.object.userData.glow || !h.face) continue;
          const nrm = h.face.normal.clone().transformDirection(h.object.matrixWorld);
          if (nrm.y > 0.7 && h.point.y / S < room.height - it.h) baseY = h.point.y / S;
          break;
        }
        const P = this.planeHit(e, baseY * S);
        if (!P) return;
        let x = P.x / S + d.off[0], z = P.z / S + d.off[1];
        if (baseY < 0.5) {
          baseY = 0;
          [x, z] = G.keepInside(room.points, x, z, it.w, it.d, it.rot || 0, this.snapWalls === false ? 0 : 8);
        }
        d.pose.x = U.round(x, 0.5); d.pose.z = U.round(z, 0.5); d.pose.y = U.round(baseY, 0.5);
        d.rec.group.position.set(d.pose.x * S, d.pose.y * S, d.pose.z * S);
        this.showMeasures(Object.assign({}, it, { x: d.pose.x, z: d.pose.z, y: d.pose.y }));
      }
      this.dirty = true;
    }

    previewOpening(d) {
      const frame = this.wallFrames[d.op.wall];
      if (!frame) return;
      if (d.wall !== d.op.wall) return; // moved to another wall: shown when released
      for (const c of frame.children) {
        if (c.userData.kind === 'opening' && c.userData.id === d.op.id) c.position.set(d.along, d.sill || 0, 0);
      }
      this.dirty = true;
    }

    commitDrag() {
      const d = this.drag;
      if (d.kind === 'opening') {
        this.hooks.update((p) => {
          const op = p.openings.find((o) => o.id === d.op.id);
          if (!op) return;
          op.wall = d.wall; op.along = d.along; if (d.sill != null) op.sill = d.sill;
        }, 'Move ' + (d.op.type === 'window' ? 'window' : 'door'));
        return;
      }
      const it = d.it;
      this.hooks.update((p) => {
        const t = p.items.find((i) => i.id === it.id);
        if (!t) return;
        if (t.mount === 'wall') { t.wall = d.wall; t.along = d.along; t.y = d.y; }
        else { t.x = d.pose.x; t.z = d.pose.z; if (t.mount !== 'ceiling') t.y = d.pose.y; }
      }, 'Move ' + it.name);
    }

    // ------------------------------------------------------------------ selection
    select(sel, silent) {
      this.selected = sel;
      this.showSelection();
      if (!silent) this.hooks.select(sel);
      this.dirty = true;
    }

    showSelection() {
      this.helpers.children.filter((c) => c.userData.sel).forEach((c) => { this.helpers.remove(c); c.geometry && c.geometry.dispose(); });
      for (const rec of this.items.values()) {
        const old = rec.group.children.find((c) => c.userData.sel);
        if (old) rec.group.remove(old);
      }
      this.measures = null;
      const s = this.selected;
      if (!s) { this.dirty = true; return; }
      const lineMat = new THREE.LineBasicMaterial({ color: '#ff5a36', depthTest: false, transparent: true });
      if (s.kind === 'item') {
        const rec = this.items.get(s.id);
        if (!rec) return;
        const it = rec.it;
        const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(it.w * S + 0.02, Math.max(it.h, 1) * S + 0.02, Math.max(it.d, 1) * S + 0.02)), lineMat);
        box.position.y = (it.h * S) / 2;
        box.userData.sel = true;
        box.renderOrder = 10;
        rec.group.add(box);
        if (it.mount === 'floor' || !it.mount) this.showMeasures(it);
      } else if (s.kind === 'wall' || s.kind === 'opening') {
        const p = this.project();
        const i = s.kind === 'wall' ? s.index : (p.openings.find((o) => o.id === s.id) || {}).wall;
        const w = this.walls && this.walls[i];
        if (!w) return;
        let pts;
        if (s.kind === 'wall') pts = [[0, 0], [w.len, 0]].concat(((this.profiles && this.profiles[i]) || [[w.len, this.room.height], [0, this.room.height]]).slice().reverse());
        else {
          const op = p.openings.find((o) => o.id === s.id);
          const a = U.clamp(op.along, op.width / 2, w.len - op.width / 2);
          pts = [[a - op.width / 2, op.sill], [a + op.width / 2, op.sill], [a + op.width / 2, op.sill + op.height], [a - op.width / 2, op.sill + op.height]];
        }
        const g = new THREE.BufferGeometry().setFromPoints(pts.concat([pts[0]]).map(([u, v]) => new THREE.Vector3(
          (w.a[0] + w.dir[0] * u + w.n[0] * 1) * S, v * S, (w.a[1] + w.dir[1] * u + w.n[1] * 1) * S)));
        const line = new THREE.Line(g, lineMat);
        line.userData.sel = true;
        line.renderOrder = 10;
        this.helpers.add(line);
      } else if (s.kind === 'floor') {
        const pts = this.room.points;
        const g = new THREE.BufferGeometry().setFromPoints(pts.concat([pts[0]]).map((p) => new THREE.Vector3(p[0] * S, 0.005, p[1] * S)));
        const line = new THREE.Line(g, lineMat);
        line.userData.sel = true;
        this.helpers.add(line);
      }
      this.dirty = true;
    }

    /** Distances from a floor item to the walls on each side (shown as labels). */
    showMeasures(it) {
      const pts = this.room.points;
      const fp = G.footprint(it.x, it.z, it.w, it.d, it.rot || 0);
      const minX = Math.min(...fp.map((p) => p[0])), maxX = Math.max(...fp.map((p) => p[0]));
      const minZ = Math.min(...fp.map((p) => p[1])), maxZ = Math.max(...fp.map((p) => p[1]));
      const rays = [
        { from: [minX, it.z], dir: [-1, 0] }, { from: [maxX, it.z], dir: [1, 0] },
        { from: [it.x, minZ], dir: [0, -1] }, { from: [it.x, maxZ], dir: [0, 1] },
      ];
      const out = [];
      for (const r of rays) {
        let best = Infinity;
        for (const w of G.walls(pts)) {
          // ray / segment intersection in plan
          const ex = w.b[0] - w.a[0], ez = w.b[1] - w.a[1];
          const den = r.dir[0] * ez - r.dir[1] * ex;
          if (Math.abs(den) < 1e-9) continue;
          const ax = w.a[0] - r.from[0], az = w.a[1] - r.from[1];
          const tt = (ax * ez - az * ex) / den;
          const uu = (ax * r.dir[1] - az * r.dir[0]) / den;
          if (tt > -0.5 && uu >= 0 && uu <= 1) best = Math.min(best, Math.max(0, tt));
        }
        if (best < Infinity && best < 2000) out.push({ from: r.from, to: [r.from[0] + r.dir[0] * best, r.from[1] + r.dir[1] * best], dist: best });
      }
      this.measures = out;
      this.dirty = true;
    }

    // ------------------------------------------------------------------ HTML labels (wall numbers, distances, corners)
    toScreen(x, y, z) {
      const v = new THREE.Vector3(x * S, y * S, z * S).project(this.camera);
      const r = this.renderer.domElement;
      return { x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight, behind: v.z > 1 };
    }

    updateLabels() {
      const L = this.labels;
      const frag = [];
      const room = this.room;
      if (!room || !this.walls) return;
      const showWalls = this.view === 'top' || (this.showWallNumbers && this.view === '3d');
      if (showWalls) {
        this.walls.forEach((w, i) => {
          if (this.hiddenWalls && this.hiddenWalls.has(i) && this.view !== 'top') return;
          const mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2;
          const inset = this.view === 'top' ? -(this.room.thickness || 12) - 26 : 2;
          const topY = this.profiles && this.profiles[i] ? G.profileAt(this.profiles[i], w.len / 2) : room.height;
          const p = this.toScreen(mx + w.n[0] * inset, this.view === 'top' ? 0 : topY + 10, mz + w.n[1] * inset);
          if (p.behind) return;
          frag.push(`<div class="lbl wall-lbl" style="transform:translate(${p.x}px,${p.y}px)"><b>${i + 1}</b>${this.view === 'top' ? `<span>${U.fmtLen(w.len)}</span>` : ''}</div>`);
        });
      }
      if (this.view === 'top' && this.slopeLabels) {
        for (const l of this.slopeLabels) {
          const p = this.toScreen(l.x, 0, l.z);
          frag.push(`<div class="lbl slope-lbl" style="transform:translate(${p.x}px,${p.y}px)">${l.text}</div>`);
        }
      }
      this.updateCompass();
      if (this.measures && this.selected && this.selected.kind === 'item' && this.view !== 'walk') {
        for (const m of this.measures) {
          if (m.dist < 0.5) continue;
          const a = this.toScreen(m.from[0], 1, m.from[1]), b = this.toScreen(m.to[0], 1, m.to[1]);
          if (a.behind || b.behind) continue;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 18) continue;
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          frag.push(`<div class="measure" style="width:${len}px;transform:translate(${a.x}px,${a.y}px) rotate(${ang}rad)"></div>`);
          frag.push(`<div class="lbl dist-lbl" style="transform:translate(${(a.x + b.x) / 2}px,${(a.y + b.y) / 2}px)">${U.fmtLen(m.dist)}</div>`);
        }
      }
      L.innerHTML = frag.join('');
      this.updateCornerHandles();
    }

    /** Compass in the corner of the view when you've said which way your room faces. */
    updateCompass() {
      const f = this.room && this.room.facing;
      if (f == null || f === '') { if (this.compassEl) this.compassEl.hidden = true; return; }
      if (!this.compassEl) {
        this.compassEl = U.h('div.compass', { title: 'North' }, U.h('div.needle', null, U.h('b', null, 'N')));
        this.el.append(this.compassEl);
      }
      let off = 0;
      if (this.view !== 'top') {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        off = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
      }
      this.compassEl.hidden = false;
      this.compassEl.firstChild.style.transform = `rotate(${-(Number(f) + off)}deg)`;
    }

    // ------------------------------------------------------------------ editing the room outline in the top view
    setEditCorners(on) {
      this.editCorners = !!on;
      if (on && this.view !== 'top') this.setView('top');
      this.dirty = true;
      if (!on && this.cornerLayer) { this.cornerLayer.remove(); this.cornerLayer = null; }
    }

    updateCornerHandles() {
      if (!this.editCorners || this.view !== 'top') {
        if (this.cornerLayer) { this.cornerLayer.remove(); this.cornerLayer = null; }
        return;
      }
      const pts = this.cornerDrag ? this.cornerDrag.pts : this.room.points;
      if (!this.cornerLayer) {
        this.cornerLayer = U.h('div.corner-layer');
        this.el.append(this.cornerLayer);
      }
      const layer = this.cornerLayer;
      if (layer.childElementCount !== pts.length * 2) {
        layer.innerHTML = '';
        pts.forEach((_, i) => {
          const h = U.h('div.corner-handle', { title: 'Drag to move this corner. Tap to remove it.', dataset: { i } });
          h.addEventListener('pointerdown', (e) => this.startCornerDrag(e, i));
          const plus = U.h('button.corner-add', { title: 'Add a corner here', 'aria-label': 'Add a corner', dataset: { i } }, '+');
          plus.addEventListener('click', () => this.hooks.addCorner(i));
          layer.append(h, plus);
        });
      }
      const hs = layer.querySelectorAll('.corner-handle');
      const ps = layer.querySelectorAll('.corner-add');
      pts.forEach((p, i) => {
        const s = this.toScreen(p[0], 0, p[1]);
        hs[i].style.transform = `translate(${s.x}px,${s.y}px)`;
        const q = pts[(i + 1) % pts.length];
        const m = this.toScreen((p[0] + q[0]) / 2, 0, (p[1] + q[1]) / 2);
        ps[i].style.transform = `translate(${m.x}px,${m.y}px)`;
      });
    }

    startCornerDrag(e, i) {
      e.preventDefault();
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY };
      this.cornerDrag = { i, pts: this.room.points.map((p) => p.slice()), moved: false };
      this.top.enabled = false;
      const move = (ev) => {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 3) this.cornerDrag.moved = true;
        if (!this.cornerDrag.moved) return;
        const P = this.planeHit(ev, 0);
        if (!P) return;
        let x = U.round(P.x / S, 5), z = U.round(P.z / S, 5);
        const pts = this.cornerDrag.pts;
        const n = pts.length;
        // line up with the neighbouring corners to keep square corners
        for (const j of [(i - 1 + n) % n, (i + 1) % n]) {
          if (Math.abs(pts[j][0] - x) < 12) x = pts[j][0];
          if (Math.abs(pts[j][1] - z) < 12) z = pts[j][1];
        }
        pts[i] = [x, z];
        this.previewOutline(pts);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.top.enabled = this.view === 'top';
        const cd = this.cornerDrag;
        this.cornerDrag = null;
        if (this.outlinePreview) { this.helpers.remove(this.outlinePreview); this.outlinePreview = null; }
        if (!cd.moved) this.hooks.cornerTapped(i);
        else this.hooks.cornersChanged(cd.pts);
        this.dirty = true;
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    previewOutline(pts) {
      if (this.outlinePreview) this.helpers.remove(this.outlinePreview);
      const g = new THREE.BufferGeometry().setFromPoints(pts.concat([pts[0]]).map((p) => new THREE.Vector3(p[0] * S, this.room.height * S + 0.02, p[1] * S)));
      this.outlinePreview = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ff5a36', depthTest: false }));
      this.outlinePreview.renderOrder = 20;
      this.helpers.add(this.outlinePreview);
      this.dirty = true;
    }

    // ------------------------------------------------------------------ placing new things
    /** Where the camera is looking, on the floor (cm). */
    viewCenter() {
      if (this.view === 'walk' && this.walk.pos) return [this.walk.pos[0] - Math.sin(this.walk.yaw) * 120, this.walk.pos[1] - Math.cos(this.walk.yaw) * 120];
      const t = this.view === 'top' ? this.top.target : this.orbit.target;
      return [t.x / S, t.z / S];
    }

    /** Plan rectangles that new floor items should not overlap: other furniture and the space in front of doors. */
    blockedAreas(skipId) {
      const p = this.project();
      const out = [];
      for (const o of p.items) {
        if (o.id === skipId || o.mount === 'wall' || o.mount === 'ceiling' || o.type === 'rug' || (o.y || 0) > 0) continue;
        const fp = G.footprint(o.x, o.z, o.w, o.d, o.rot || 0);
        out.push(aabb(fp));
      }
      const ws = this.walls || G.walls(this.room.points);
      for (const op of p.openings) {
        if (op.type === 'window') continue;
        const w = ws[op.wall];
        if (!w) continue;
        const a = G.pointOnWall(w, op.along - op.width / 2), b = G.pointOnWall(w, op.along + op.width / 2);
        const depth = op.type === 'door' ? Math.max(80, op.width) : 70;
        out.push(aabb([a, b, [a[0] + w.n[0] * depth, a[1] + w.n[1] * depth], [b[0] + w.n[0] * depth, b[1] + w.n[1] * depth]]));
      }
      return out;
    }

    fits(it, x, z, rot, blocked) {
      const fp = G.footprint(x, z, it.w, it.d, rot);
      const pts = this.room.points;
      if (!fp.every((p) => G.pointInPolygon(p[0], p[1], pts) || G.nearestWall(pts, p[0], p[1]).dist < 1.5)) return false;
      const box = aabb(fp);
      return !blocked.some((b) => box.x1 > b.x0 + 1 && box.x0 < b.x1 - 1 && box.z1 > b.z0 + 1 && box.z0 < b.z1 - 1);
    }

    /**
     * A free spot for a new floor item. Furniture that belongs against a wall gets the free stretch of wall
     * nearest to where you are looking; everything else goes near the middle of the view.
     */
    findSpot(it, againstWall) {
      const blocked = it.type === 'rug' ? [] : this.blockedAreas(it.id);
      const [cx, cz] = this.viewCenter();
      if (againstWall) {
        const ws = this.walls || G.walls(this.room.points);
        const cands = [];
        for (const w of ws) {
          if (w.len < it.w + 2) continue;
          for (let a = it.w / 2 + 1; a <= w.len - it.w / 2 - 1; a += 5) {
            const p = G.pointOnWall(w, a);
            const x = p[0] + w.n[0] * (it.d / 2 + 1), z = p[1] + w.n[1] * (it.d / 2 + 1);
            cands.push({ x, z, rot: G.facingAngle(w), dist: Math.hypot(x - cx, z - cz) + (this.hiddenWalls && this.hiddenWalls.has(w.i) ? 150 : 0) });
          }
        }
        cands.sort((a, b) => a.dist - b.dist);
        for (const c of cands) if (this.fits(it, c.x, c.z, c.rot, blocked)) return c;
      }
      const rot = it.rot || 0;
      for (let r = 0; r <= 600; r += 20) {
        const steps = r ? Math.max(8, Math.round(r / 12)) : 1;
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          let [x, z] = G.keepInside(this.room.points, cx + Math.cos(a) * r, cz + Math.sin(a) * r, it.w, it.d, rot, 0);
          if (this.fits(it, x, z, rot, blocked)) return { x, z, rot };
        }
      }
      const [x, z] = G.keepInside(this.room.points, cx, cz, it.w, it.d, rot, 0);
      return { x, z, rot };
    }

    spawnSpot(it) { const s = this.findSpot(it, false); return [s.x, s.z]; }

    /** The wall you are looking at most directly (for new wall items, doors and windows). */
    facingWall() {
      const ws = this.walls || G.walls(this.room.points);
      const cam = this.camera.position;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      let best = 0, bestScore = -Infinity;
      ws.forEach((w, i) => {
        if (this.hiddenWalls && this.hiddenWalls.has(i)) return;
        const facing = -(dir.x * w.n[0] + dir.z * w.n[1]);
        const mx = ((w.a[0] + w.b[0]) / 2) * S, mz = ((w.a[1] + w.b[1]) / 2) * S;
        const toWall = new THREE.Vector3(mx - cam.x, 0, mz - cam.z).normalize();
        const score = facing + 0.6 * (toWall.x * dir.x + toWall.z * dir.z) + w.len / 2000;
        if (score > bestScore) { bestScore = score; best = i; }
      });
      return best;
    }

    /** A free stretch of wall i for something `width` wide at height y..y+h (cm). */
    freeAlong(i, width, skipId, y, hgt) {
      const w = (this.walls || G.walls(this.room.points))[i];
      const p = this.project();
      const y0 = y == null ? 0 : y, y1 = hgt == null ? 10000 : y0 + hgt;
      const over = (a0, a1) => a1 > y0 && a0 < y1;
      const used = p.openings.filter((o) => o.wall === i && o.id !== skipId && over(o.sill || 0, (o.sill || 0) + o.height)).map((o) => [o.along - o.width / 2, o.along + o.width / 2])
        .concat(p.items.filter((o) => o.mount === 'wall' && o.wall === i && o.id !== skipId && over(o.y || 0, (o.y || 0) + o.h)).map((o) => [o.along - o.w / 2, o.along + o.w / 2]));
      for (const o of p.items) {
        if (o.mount === 'wall' || o.mount === 'ceiling' || o.id === skipId || o.type === 'rug') continue;
        const fp = G.footprint(o.x, o.z, o.w, o.d, o.rot || 0);
        const near = fp.some((q) => Math.abs((q[0] - w.a[0]) * w.n[0] + (q[1] - w.a[1]) * w.n[1]) < 25);
        if (!near || !over(o.y || 0, (o.y || 0) + o.h)) continue;
        const al = fp.map((q) => (q[0] - w.a[0]) * w.dir[0] + (q[1] - w.a[1]) * w.dir[1]);
        used.push([Math.min(...al), Math.max(...al)]);
      }
      const cands = [w.len / 2];
      for (let s = 1; s < 40; s++) { cands.push(w.len / 2 + s * 10, w.len / 2 - s * 10); }
      for (const c of cands) {
        if (c - width / 2 < 3 || c + width / 2 > w.len - 3) continue;
        if (!used.some(([a, b]) => c + width / 2 > a - 3 && c - width / 2 < b + 3)) return c;
      }
      return w.len / 2;
    }

    // ------------------------------------------------------------------ export
    screenshot() {
      this.updateCutaway();
      this.render();
      return new Promise((res) => this.renderer.domElement.toBlob(res, 'image/png'));
    }

    exportGLB() {
      return new Promise((resolve, reject) => {
        const root = new THREE.Group();
        // the cut-away walls and the ceiling belong in the model too
        const hidden = [];
        this.roomGroup.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
        this.itemsGroup.traverse((o) => { if (!o.visible && o.userData.kind === 'item') { hidden.push(o); o.visible = true; } });
        root.add(this.roomGroup.clone(), this.itemsGroup.clone());
        for (const o of hidden) o.visible = false;
        root.traverse((o) => { if (o.userData.glow || o.userData.sel || o.isLine) o.visible = false; });
        new THREE.GLTFExporter().parse(root, (res) => resolve(new Blob([res], { type: 'model/gltf-binary' })), reject, { binary: true, onlyVisible: true });
      });
    }

    /** Small preview picture of an item for the catalogue. */
    thumbnail(it) {
      if (!this.thumbR) {
        this.thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.thumbR.setSize(160, 160, false);
        this.thumbR.toneMapping = THREE.NeutralToneMapping;
        this.thumbScene = new THREE.Scene();
        this.thumbScene.environment = this.scene.environment;
        this.thumbScene.environmentIntensity = 0.8;
        const dl = new THREE.DirectionalLight('#ffffff', 1.6);
        dl.position.set(1, 2, 1.5);
        this.thumbScene.add(dl, new THREE.HemisphereLight('#ffffff', '#888888', 0.8));
        this.thumbCam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      }
      const g = C.build(Object.assign({ opts: {} }, it), this.buildContext());
      g.scale.setScalar(S);
      if (it.mount === 'ceiling') g.rotation.x = 0.0;
      this.thumbScene.add(g);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z) || 1;
      const flat = size.y < r * 0.08;
      const dir = flat ? new THREE.Vector3(0.3, 1.6, 1).normalize() : new THREE.Vector3(0.75, 0.45, 1.25).normalize();
      this.thumbCam.position.copy(center).addScaledVector(dir, r * 2.3);
      this.thumbCam.lookAt(center);
      this.thumbR.render(this.thumbScene, this.thumbCam);
      const url = this.thumbR.domElement.toDataURL('image/png');
      this.thumbScene.remove(g);
      return url;
    }
  }

  RD.Viewer = Viewer;
})();
