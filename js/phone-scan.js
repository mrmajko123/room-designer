/* Room Designer phone scan page: sends 3D scans and photos to the computer that showed the QR code. */
(function () {
  const key = decodeURIComponent((location.hash || '').slice(1));
  const $ = (s) => document.querySelector(s);
  const photos = {};

  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
    window.scrollTo(0, 0);
  }
  function setConn(text, cls) { const c = $('#conn'); c.textContent = text; c.className = 'conn ' + (cls || ''); }
  function problem(title, text) {
    $('#problem-title').textContent = title;
    $('#problem-text').textContent = text;
    setConn('Not connected', 'bad');
    show('problem');
  }

  /** POST to the computer. Resolves with the reply, rejects with a readable message. */
  function post(path, params, body, onProgress) {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams(Object.assign({ t: key }, params || {}));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path + '?' + q.toString());
      if (body && body.type) xhr.setRequestHeader('Content-Type', body.type);
      if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status === 200) resolve(data);
        else reject(Object.assign(new Error(data.error || 'Your computer said no (' + xhr.status + ').'), { status: xhr.status }));
      };
      xhr.onerror = () => reject(Object.assign(new Error('Can\'t reach your computer.'), { status: 0 }));
      xhr.send(body || null);
    });
  }

  function failed(e) {
    if (e.status === 403) problem('This link has expired', 'Open "Scan with your phone" on your computer again and scan the new QR code.');
    else if (e.status === 0) problem('Can\'t reach your computer', 'Make sure your phone is on the same Wi-Fi as your computer and the "Scan with your phone" window is still open.');
    else problem('Something went wrong', e.message);
  }

  async function hello() {
    if (!key) { problem('Scan the QR code', 'Open this page by scanning the QR code shown in Room Designer on your computer.'); return; }
    try {
      await post('/api/hello');
      setConn('Connected ✓', 'ok');
      if (!$('#problem').hidden) show('home');
    } catch (e) { failed(e); }
  }

  function sending(title, note) {
    $('#sending-title').textContent = title;
    $('#sending-note').textContent = note || 'Keep this page open.';
    $('#bar').style.width = '0%';
    show('sending');
  }

  // ---- 3D scan
  $('#model-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(glb|gltf|obj|zip|usdz|ply|stl)$/i.test(file.name)) {
      alert('Pick a 3D file: GLB, OBJ, USDZ, PLY, STL or a ZIP from your scanner app.');
      return;
    }
    sending('Sending your 3D scan…', `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`);
    try {
      await post('/api/upload', { kind: 'model', name: file.name }, file, (f) => { $('#bar').style.width = Math.round(f * 100) + '%'; });
      await post('/api/done', { kind: 'model' });
      show('sent');
    } catch (err) { failed(err); }
  });

  // ---- photos
  document.querySelectorAll('.slot').forEach((slot) => {
    const input = slot.querySelector('input');
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) return;
      photos[slot.dataset.step] = f;
      const pic = slot.querySelector('.pic');
      pic.style.backgroundImage = `url(${URL.createObjectURL(f)})`;
      pic.textContent = ' ';
      slot.classList.add('done');
      slot.querySelector('.tag').textContent = 'Retake';
      $('#send-photos').disabled = !photos.front;
    });
  });

  $('#send-photos').addEventListener('click', async () => {
    const steps = ['front', 'side', 'top'].filter((s) => photos[s]);
    sending('Sending your photos…');
    try {
      for (let i = 0; i < steps.length; i++) {
        const f = photos[steps[i]];
        $('#sending-note').textContent = `Photo ${i + 1} of ${steps.length}`;
        await post('/api/upload', { kind: 'photo', step: steps[i], name: f.name || steps[i] + '.jpg' }, f, (p) => { $('#bar').style.width = Math.round(((i + p) / steps.length) * 100) + '%'; });
      }
      await post('/api/done', { kind: 'photos' });
      for (const k of Object.keys(photos)) delete photos[k];
      document.querySelectorAll('.slot').forEach((slot) => {
        slot.classList.remove('done');
        const pic = slot.querySelector('.pic');
        pic.style.backgroundImage = ''; pic.textContent = '';
        slot.querySelector('.tag').textContent = slot.dataset.step === 'front' ? 'Needed' : 'Optional';
      });
      $('#send-photos').disabled = true;
      show('sent');
    } catch (err) { failed(err); }
  });

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  $('#retry').addEventListener('click', () => { show('home'); hello(); });
  hello();
})();
