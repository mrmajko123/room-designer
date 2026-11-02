/* Room Designer: storage on this device (IndexedDB). Rooms, photos and "my stuff" never leave it. */
(function () {
  const RD = (window.RD = window.RD || {});
  const DB_NAME = 'room-designer';
  const STORES = ['rooms', 'blobs', 'stuff', 'settings'];
  let dbp = null;
  const memory = {}; // fallback when IndexedDB is unavailable (private windows on some browsers)
  const urls = new Map();
  const blobCache = new Map();

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) {
      const m = (memory[store] = memory[store] || new Map());
      return fn(null, m);
    }
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const r = fn(s, null);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage is full or unavailable.'));
    });
  }

  const D = (RD.db = {
    get: (store, id) => tx(store, 'readonly', (s, m) => (m ? m.get(id) : s.get(id))),
    put: (store, val) => tx(store, 'readwrite', (s, m) => (m ? m.set(val.id, val) : s.put(val))),
    del: (store, id) => tx(store, 'readwrite', (s, m) => (m ? m.delete(id) : s.delete(id))),
    all: (store) => tx(store, 'readonly', (s, m) => (m ? Array.from(m.values()) : s.getAll())).then((v) => v || []),
  });

  /** Stores a picture and returns its id. */
  D.putBlob = async function (blob, meta) {
    const id = RD.util.uid('b');
    await D.put('blobs', Object.assign({ id, blob, type: blob.type, created: Date.now() }, meta || {}));
    blobCache.set(id, blob);
    return id;
  };

  D.getBlobRecord = async function (id) {
    if (!id) return null;
    return D.get('blobs', id);
  };

  D.getBlob = async function (id) {
    if (!id) return null;
    if (blobCache.has(id)) return blobCache.get(id);
    const rec = await D.get('blobs', id);
    const blob = rec ? rec.blob : null;
    if (blob) blobCache.set(id, blob);
    return blob;
  };

  /** Object URL for a stored picture (cached; valid for the whole session). */
  D.blobUrl = async function (id) {
    if (urls.has(id)) return urls.get(id);
    const b = await D.getBlob(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(id, u);
    return u;
  };

  D.deleteBlob = async function (id) {
    blobCache.delete(id);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    await D.del('blobs', id);
  };

  D.setting = async (key, fallback) => {
    const r = await D.get('settings', key);
    return r ? r.value : fallback;
  };
  D.setSetting = (key, value) => D.put('settings', { id: key, value });
})();
