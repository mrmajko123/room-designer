/* Room Designer: shared helpers (DOM, units, colours, images, dialogs). */
(function () {
  const RD = (window.RD = window.RD || {});
  const U = (RD.util = {});

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Tiny element builder: h('button.primary', {onclick}, 'Text', child...). */
  U.h = function (tag, attrs, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  };

  U.uid = (prefix) => (prefix || '') + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  U.clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  U.round = (v, step) => Math.round(v / (step || 1)) * (step || 1);
  U.debounce = function (fn, ms) {
    let t = null;
    const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    d.flush = (...args) => { clearTimeout(t); fn(...args); };
    return d;
  };
  U.clone = (o) => JSON.parse(JSON.stringify(o));
  U.isPhone = () => window.matchMedia('(max-width: 760px)').matches;
  U.isTouch = () => window.matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- units
  // Everything is stored in centimetres; "imperial" shows feet and inches.
  U.units = 'metric';
  U.setUnits = (u) => { U.units = u === 'imperial' ? 'imperial' : 'metric'; };

  U.fmtLen = function (cm, opts) {
    if (cm == null || isNaN(cm)) return '';
    if (U.units === 'imperial') {
      const inches = Math.round((cm / 2.54) * 2) / 2;
      if (opts && opts.inches) return `${inches}"`;
      const ft = Math.floor(inches / 12);
      const rest = Math.round((inches - ft * 12) * 2) / 2;
      if (!ft) return `${rest}"`;
      return rest ? `${ft}' ${rest}"` : `${ft}'`;
    }
    const v = Math.round(cm * 10) / 10;
    if (opts && opts.m && Math.abs(v) >= 100) return `${(v / 100).toFixed(2).replace(/\.?0+$/, '')} m`;
    return `${v} cm`;
  };

  /** Parses "250", "2.5m", "250 cm", "8'2\"", "8 ft 2 in", "98in" into centimetres (NaN if unreadable). */
  U.parseLen = function (str) {
    if (typeof str === 'number') return U.units === 'imperial' ? str * 2.54 : str;
    let s = String(str || '').trim().toLowerCase().replace(',', '.').replace(/[’′]/g, "'").replace(/[”″]/g, '"');
    if (!s) return NaN;
    const num = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
    let m;
    if ((m = s.match(new RegExp(`^${num}\\s*(?:'|ft|feet|foot)\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`)))) {
      return (parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * 2.54;
    }
    if ((m = s.match(new RegExp(`^${num}\\s*(mm|cm|m|in|inch|inches|"|ft|')?$`)))) {
      const v = parseFloat(m[1]);
      switch (m[2]) {
        case 'mm': return v / 10;
        case 'cm': return v;
        case 'm': return v * 100;
        case 'in': case 'inch': case 'inches': case '"': return v * 2.54;
        case 'ft': case "'": return v * 30.48;
        default: return U.units === 'imperial' ? v * 2.54 : v;
      }
    }
    return NaN;
  };

  /** Value to show in a length input (bare number in the current unit). */
  U.lenInputValue = (cm) => (U.units === 'imperial' ? String(Math.round((cm / 2.54) * 2) / 2) : String(Math.round(cm * 10) / 10));
  U.unitLabel = () => (U.units === 'imperial' ? 'in' : 'cm');

  // ---------------------------------------------------------------- colours
  U.hexToRgb = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  U.mix = (a, b, t) => {
    const x = U.hexToRgb(a), y = U.hexToRgb(b);
    return U.rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  };
  U.shade = (hex, t) => (t > 0 ? U.mix(hex, '#ffffff', t) : U.mix(hex, '#000000', -t));
  U.luma = (hex) => { const [r, g, b] = U.hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

  // ---------------------------------------------------------------- images
  U.blobToDataURL = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  U.dataURLToBlob = async (url) => (await fetch(url)).blob();

  U.loadImage = (src) => new Promise((res, rej) => {
    const img = new Image();
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    img.onload = () => { res(img); if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => rej(new Error('This picture could not be opened.'));
    img.src = url;
  });

  U.canvasToBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type || 'image/jpeg', q || 0.9));

  /** Reads the 35 mm-equivalent focal length from a JPEG's EXIF data (null if missing). */
  U.exifFocal35 = function (buf) {
    try {
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xffd8) return null;
      let off = 2;
      while (off < v.byteLength - 4) {
        const marker = v.getUint16(off);
        const size = v.getUint16(off + 2);
        if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
          const t = off + 10;
          const le = v.getUint16(t) === 0x4949;
          const u16 = (p) => v.getUint16(t + p, le), u32 = (p) => v.getUint32(t + p, le);
          const readIfd = (p) => {
            const n = u16(p), tags = {};
            for (let i = 0; i < n; i++) {
              const e = p + 2 + i * 12;
              tags[u16(e)] = { type: u16(e + 2), value: u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8) };
            }
            return tags;
          };
          const ifd0 = readIfd(u32(4));
          if (!ifd0[0x8769]) return null;
          const exif = readIfd(ifd0[0x8769].value);
          const f = exif[0xa405];
          return f && f.value > 8 && f.value < 400 ? f.value : null;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + size;
      }
    } catch (e) { /* not a readable JPEG */ }
    return null;
  };

  /**
   * Reads a picture the user picked: applies its rotation, shrinks it to maxSize and re-encodes it.
   * Returns { blob, width, height, focal35 }.
   */
  U.readPhoto = async function (file, maxSize) {
    maxSize = maxSize || 2048;
    let focal35 = null;
    if (/jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name || '')) focal35 = U.exifFocal35(await file.slice(0, 256 * 1024).arrayBuffer());
    const img = await U.loadImage(file);
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const keepAlpha = /png|webp|gif/i.test(file.type);
    const blob = await U.canvasToBlob(c, keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
    return { blob, width: w, height: h, focal35 };
  };

  /** Pixels of an image (optionally scaled down so the longest side is at most maxSize). */
  U.imageData = function (img, maxSize) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = maxSize ? Math.min(1, maxSize / Math.max(w0, h0)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  };

  U.imageDataToCanvas = function (data) {
    const c = document.createElement('canvas');
    c.width = data.width; c.height = data.height;
    const id = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
    c.getContext('2d').putImageData(id, 0, 0);
    return c;
  };

  U.pickFiles = function (opts) {
    return new Promise((resolve) => {
      const input = U.h('input', { type: 'file', accept: (opts && opts.accept) || 'image/*', multiple: !!(opts && opts.multiple), style: { display: 'none' } });
      if (opts && opts.camera) input.setAttribute('capture', 'environment');
      input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); });
      document.body.append(input);
      input.click();
    });
  };

  /** Saves a file: native share/save sheet in the phone app, a normal download elsewhere. */
  U.saveFile = async function (blob, name) {
    const cap = window.Capacitor;
    const FS = cap && cap.Plugins && cap.Plugins.Filesystem;
    const Share = cap && cap.Plugins && cap.Plugins.Share;
    if (FS && Share) {
      try {
        const data = (await U.blobToDataURL(blob)).split(',')[1];
        const res = await FS.writeFile({ path: name, data, directory: 'CACHE' });
        await Share.share({ title: name, url: res.uri, dialogTitle: 'Save or share' });
        return;
      } catch (e) {
        if (e && /cancel/i.test(String(e.message || e))) return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = U.h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  };

  // ---------------------------------------------------------------- toasts & dialogs
  U.toast = function (msg, opts) {
    const host = U.$('#toasts');
    for (const old of host.children) if (old.firstChild && old.firstChild.textContent === msg) old.remove();
    const t = U.h('div.toast', { role: 'status' }, U.h('span', null, msg));
    if (opts && opts.action) {
      t.append(U.h('button.link', { onclick: () => { opts.action.run(); t.remove(); } }, opts.action.label));
    }
    host.append(t);
    setTimeout(() => t.classList.add('out'), (opts && opts.timeout) || 3200);
    setTimeout(() => t.remove(), ((opts && opts.timeout) || 3200) + 400);
  };

  /** Modal dialog. content: element; buttons: [{label, value, primary, danger}]. Resolves with the value. */
  U.modal = function (title, content, buttons, opts) {
    return new Promise((resolve) => {
      const dlg = U.h('dialog.modal' + (opts && opts.wide ? '.wide' : '') + (opts && opts.full ? '.full' : ''));
      const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      const head = U.h('header', null, U.h('h2', null, title), U.h('button.icon-btn.close', { 'aria-label': 'Close', onclick: () => close(null), html: RD.icons ? RD.icons.close : '×' }));
      const body = U.h('div.modal-body', null, content);
      const foot = buttons && buttons.length
        ? U.h('footer', null, buttons.map((b) => U.h('button' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), {
          onclick: () => { if (!b.check || b.check()) close(b.value); },
        }, b.label)))
        : null;
      dlg.append(head, body, foot || '');
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
      document.body.append(dlg);
      dlg.showModal();
      dlg.closeWith = close;
      if (opts && opts.onOpen) opts.onOpen(dlg, close);
    });
  };

  U.confirm = (title, text, okLabel, danger) =>
    U.modal(title, U.h('p', null, text), [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: !danger, danger }]).then((v) => !!v);

  U.prompt = function (title, value, okLabel) {
    const input = U.h('input.text', { type: 'text', value: value || '' });
    return U.modal(title, input, [{ label: 'Cancel', value: null }, { label: okLabel || 'Save', value: 'ok', primary: true }], {
      onOpen: (dlg, close) => {
        setTimeout(() => { input.focus(); input.select(); }, 30);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close('ok'); });
      },
    }).then((v) => (v === 'ok' ? input.value.trim() : null));
  };
})();
