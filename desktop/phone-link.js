/* Phone link: a small web server the desktop app runs while the "Scan with your phone" window is open.
 * Your phone (on the same Wi-Fi) opens the scan page from it by scanning a QR code, and sends 3D scans and
 * photos straight to this computer. Nothing goes through the internet. Every request needs a random key
 * that is only in the QR code. */
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_UPLOAD = 600 * 1024 * 1024; // 600 MB is plenty for detailed scans
const PAGES = {
  '/': 'scan.html',
  '/scan.html': 'scan.html',
  '/css/scan.css': 'css/scan.css',
  '/js/phone-scan.js': 'js/phone-scan.js',
  '/icons/icon.svg': 'icons/icon.svg',
  '/icons/icon-192.png': 'icons/icon-192.png',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Wi-Fi / network addresses of this computer, home-network ones first. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal || a.address.startsWith('169.254.')) continue;
      out.push(a.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * root: folder with the web app (scan.html etc.). onEvent(event) gets:
 *   { type: 'connected', device }   the phone opened the page
 *   { type: 'progress', kind, step, name, received, size }
 *   { type: 'file', kind: 'model'|'photo', step, name, mime, data: Buffer }
 *   { type: 'done', kind: 'model'|'photos' }
 */
function createPhoneLink({ root, onEvent, port: preferredPort }) {
  let server = null;
  let token = null;
  let port = null;

  const send = (res, code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  function handle(req, res) {
    const url = new URL(req.url, 'http://phone.link');
    const p = url.pathname;
    if (req.method === 'GET' && PAGES[p]) {
      fs.readFile(path.join(root, PAGES[p]), (err, data) => {
        if (err) return send(res, 404, 'Not found', 'text/plain');
        send(res, 200, data, TYPES[path.extname(PAGES[p])]);
      });
      return;
    }
    if (!p.startsWith('/api/')) return send(res, 404, 'Not found', 'text/plain');
    const key = url.searchParams.get('t') || '';
    const ok = token && key.length === token.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(token));
    if (!ok) return send(res, 403, { error: 'This link has expired. Scan the new QR code on your computer.' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

    if (p === '/api/hello') {
      const ua = String(req.headers['user-agent'] || '');
      const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'phone';
      onEvent({ type: 'connected', device });
      req.resume();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/done') {
      onEvent({ type: 'done', kind: url.searchParams.get('kind') === 'model' ? 'model' : 'photos' });
      req.resume();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/upload') {
      const kind = url.searchParams.get('kind') === 'model' ? 'model' : 'photo';
      const step = (url.searchParams.get('step') || 'front').replace(/[^a-z]/g, '').slice(0, 10);
      const name = (url.searchParams.get('name') || (kind === 'model' ? 'scan.glb' : 'photo.jpg')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
      const size = Number(req.headers['content-length']) || 0;
      if (size > MAX_UPLOAD) { req.resume(); return send(res, 413, { error: 'This file is too big (over 600 MB).' }); }
      const chunks = [];
      let received = 0, lastReport = 0, failed = false;
      req.on('data', (c) => {
        if (failed) return;
        received += c.length;
        if (received > MAX_UPLOAD) { failed = true; send(res, 413, { error: 'This file is too big.' }); req.destroy(); return; }
        chunks.push(c);
        if (received - lastReport > 512 * 1024) { lastReport = received; onEvent({ type: 'progress', kind, step, name, received, size }); }
      });
      req.on('end', () => {
        if (failed) return;
        onEvent({ type: 'file', kind, step, name, mime: String(req.headers['content-type'] || ''), data: Buffer.concat(chunks) });
        send(res, 200, { ok: true, bytes: received });
      });
      req.on('error', () => { failed = true; });
      return;
    }
    send(res, 404, { error: 'Unknown request' });
  }

  function listen(p) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(handle);
      s.once('error', reject);
      s.listen(p, '0.0.0.0', () => resolve(s));
    });
  }

  return {
    /** Starts (or keeps) the server with a fresh key. Returns { urls, port, token }. */
    async start() {
      token = crypto.randomBytes(16).toString('hex');
      if (!server) {
        try { server = await listen(preferredPort == null ? 43822 : preferredPort); } catch (e) { server = await listen(0); }
        server.requestTimeout = 0; // big scans on slow Wi-Fi
        port = server.address().port;
      }
      const urls = lanAddresses().map((ip) => `http://${ip}:${port}/scan.html#${token}`);
      return { urls, port, token };
    },
    stop() {
      token = null;
      if (server) { server.close(); server.closeAllConnections && server.closeAllConnections(); server = null; }
    },
    get running() { return !!server; },
  };
}

module.exports = { createPhoneLink, lanAddresses };
