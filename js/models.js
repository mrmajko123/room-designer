/* Room Designer: 3D scans of your own things. Opens the files that phone scanning apps export
 * (.glb, .gltf, .obj, .zip, .usdz, .ply, .stl), and fits a scan to the size you typed. */
(function () {
  const RD = (window.RD = window.RD || {});
  const M = (RD.models = {});

  M.ACCEPT = '.glb,.gltf,.obj,.zip,.usdz,.ply,.stl,model/gltf-binary,model/gltf+json,model/obj,model/stl,model/vnd.usdz+zip,application/zip';
  M.isModelName = (name) => /\.(glb|gltf|obj|zip|usdz|ply|stl)$/i.test(name || '');

  const ext = (name) => ((name || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '';

  function sniff(buf, name) {
    const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
    const s = String.fromCharCode(...b);
    if (s.startsWith('glTF')) return 'glb';
    if (b[0] === 0x50 && b[1] === 0x4b) return /\.usdz$/i.test(name) ? 'usdz' : 'zip';
    if (s.startsWith('ply')) return 'ply';
    const e = ext(name).toLowerCase();
    if (e) return e;
    if (s.trim().startsWith('{')) return 'gltf';
    return 'obj';
  }

  function gltfLoader(manager) {
    const l = new THREE.GLTFLoader(manager);
    l.setDRACOLoader(THREE.makeDracoLoader());
    l.setMeshoptDecoder(THREE.MeshoptDecoder);
    return l;
  }

  const parseGltf = (data, manager) => new Promise((resolve, reject) => {
    gltfLoader(manager).parse(data, '', (g) => resolve(g.scene), (e) => reject(new Error('This 3D file could not be read (' + (e && e.message || e) + ').')));
  });

  function meshFromGeometry(geo, pointsOk) {
    if (!geo.attributes.normal && geo.index) geo.computeVertexNormals();
    else if (!geo.attributes.normal) geo.computeVertexNormals();
    const hasColor = !!geo.attributes.color;
    const isPoints = !geo.index && pointsOk && geo.attributes.position.count % 3 !== 0;
    if (isPoints) return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.004, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xb0b0b0 }));
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: hasColor, color: hasColor ? 0xffffff : 0xc8c2b8, roughness: 0.8 }));
  }

  /** Files inside a zip, as a name -> Uint8Array map with folder names removed too. */
  function unzip(buf) {
    const files = THREE.fflate.unzipSync(new Uint8Array(buf));
    const out = {};
    for (const [k, v] of Object.entries(files)) {
      if (/(^|\/)__MACOSX\//.test(k) || k.endsWith('/')) continue;
      out[k] = v;
      out[k.split('/').pop()] = v;
    }
    return out;
  }

  /** Loading manager that finds textures and .bin files inside a zip. */
  function zipManager(files, urls) {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const clean = decodeURIComponent(url.replace(/^\.?\//, '').split('?')[0]);
      const key = files[clean] ? clean : clean.split('/').pop();
      const data = files[key];
      if (!data) return url;
      if (!urls[key]) {
        const type = /\.png$/i.test(key) ? 'image/png' : /\.jpe?g$/i.test(key) ? 'image/jpeg' : 'application/octet-stream';
        urls[key] = URL.createObjectURL(new Blob([data], { type }));
      }
      return urls[key];
    });
    return manager;
  }

  async function parseObj(text, mtlText, manager) {
    const loader = new THREE.OBJLoader(manager);
    if (mtlText) {
      const mtl = new THREE.MTLLoader(manager).parse(mtlText, '');
      mtl.preload();
      loader.setMaterials(mtl);
    }
    const obj = loader.parse(text);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const mats = [].concat(o.material);
      mats.forEach((m) => { if (o.geometry.attributes.color && !mtlText) m.vertexColors = true; });
    });
    // let textures finish loading before the scan is used
    await new Promise((r) => { if (!manager) r(); else { manager.onLoad = r; setTimeout(r, 4000); } });
    return obj;
  }

  /** Reads a 3D file into a three.js object. Throws a readable error for unsupported files. */
  M.parse = async function (buf, name) {
    const kind = sniff(buf, name);
    const text = () => new TextDecoder().decode(buf);
    switch (kind) {
      case 'glb': return parseGltf(buf);
      case 'gltf': return parseGltf(text());
      case 'obj': return parseObj(text(), null, null);
      case 'ply': return meshFromGeometry(new THREE.PLYLoader().parse(buf), true);
      case 'stl': {
        const geo = new THREE.STLLoader().parse(buf);
        geo.rotateX(-Math.PI / 2); // STL files are usually Z-up
        return meshFromGeometry(geo, false);
      }
      case 'usdz': return new THREE.USDZLoader().parse(buf);
      case 'zip': {
        const files = unzip(buf);
        const names = Object.keys(files);
        const find = (re) => names.find((n) => re.test(n) && !/(^|\/)\._/.test(n));
        const urls = {};
        const manager = zipManager(files, urls);
        const glb = find(/\.glb$/i);
        if (glb) return parseGltf(files[glb].buffer.slice(files[glb].byteOffset, files[glb].byteOffset + files[glb].byteLength));
        const gltf = find(/\.gltf$/i);
        if (gltf) return parseGltf(new TextDecoder().decode(files[gltf]), manager);
        const obj = find(/\.obj$/i);
        if (obj) {
          const mtl = find(/\.mtl$/i);
          return parseObj(new TextDecoder().decode(files[obj]), mtl ? new TextDecoder().decode(files[mtl]) : null, manager);
        }
        for (const re of [/\.usdz$/i, /\.ply$/i, /\.stl$/i]) {
          const f = find(re);
          if (f) return M.parse(files[f].slice().buffer, f);
        }
        throw new Error('No 3D model found in this zip file. Export your scan as GLB, OBJ or USDZ.');
      }
      default:
        throw new Error('This kind of file is not supported. Export your scan as GLB, OBJ, USDZ, PLY or STL.');
    }
  };

  /** Size of a loaded scan in its own units, with a guess of how many centimetres one unit is. */
  M.measure = function (obj, rot) {
    const holder = M.orient(obj, rot);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const big = Math.max(size.x, size.y, size.z) || 1;
    // scanning apps save metres; some tools save centimetres or millimetres
    const unitCm = big > 400 ? 0.1 : big > 30 ? 1 : 100;
    return { size, unitCm, box };
  };

  /** The object turned by quarter turns rot = [x, y, z]. */
  M.orient = function (obj, rot) {
    const holder = new THREE.Group();
    holder.add(obj);
    const r = rot || [0, 0, 0];
    holder.rotation.set((r[0] * Math.PI) / 2, (r[1] * Math.PI) / 2, (r[2] * Math.PI) / 2, 'YXZ');
    holder.updateMatrixWorld(true);
    return holder;
  };

  /**
   * A copy of a scan fitted to w x d x h centimetres: standing on y = 0, centred, front towards +z.
   * Built in centimetres like the other items.
   */
  M.fit = function (template, rot, w, d, h) {
    const holder = M.orient(template.clone(true), rot);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const sx = w / (size.x || 1), sy = h / (size.y || 1), sz = d / (size.z || 1);
    const fit = new THREE.Group();
    fit.add(holder);
    fit.scale.set(sx, sy, sz);
    fit.position.set(-c.x * sx, -box.min.y * sy, -c.z * sz);
    holder.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        [].concat(o.material).forEach((m) => { if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace; });
      }
    });
    const g = new THREE.Group();
    g.add(fit);
    return g;
  };

  // Loaded scans, shared by every copy in the room.
  const cache = new Map();
  /** Starts loading a stored scan; resolves with the object (or null). */
  M.load = function (blobId, name) {
    if (!cache.has(blobId)) {
      cache.set(blobId, (async () => {
        const blob = await RD.db.getBlob(blobId);
        if (!blob) return null;
        return M.parse(await blob.arrayBuffer(), name);
      })().catch((e) => { console.warn('Scan could not be loaded', e); return null; }));
    }
    return cache.get(blobId);
  };
  M.loaded = new Map(); // blobId -> object once ready
  M.get = function (blobId, name, onReady) {
    if (M.loaded.has(blobId)) return M.loaded.get(blobId);
    M.load(blobId, name).then((obj) => {
      if (!obj) return;
      M.loaded.set(blobId, obj);
      if (onReady) onReady(blobId);
    });
    return null;
  };
  M.remember = (blobId, obj) => { M.loaded.set(blobId, obj); cache.set(blobId, Promise.resolve(obj)); };
})();
