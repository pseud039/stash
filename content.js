// Isolated-world bridge: page hook <-> extension, plus the "drop" side
// (turning a stashed item back into a File and handing it to the page).
(() => {
  let last = { el: null, x: 0, y: 0 }; // where the user last clicked / right-clicked
  const rec = (e) => (last = { el: e.target, x: e.clientX, y: e.clientY });
  addEventListener('pointerdown', rec, true);
  addEventListener('contextmenu', rec, true);

  const call = async (m) => {
    const r = await chrome.runtime.sendMessage(m);
    if (r && r.error) throw new Error(r.error);
    return r;
  };
  const toHook = (msg) => window.postMessage({ __stash: 1, ...msg }, '*');

  function toast(text) {
    if (window !== top) return;
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText =
      'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:8px 12px;background:#0d1117;' +
      'color:#7ee787;font:12px/1.4 monospace;border:1px solid #30363d;border-radius:6px;pointer-events:none';
    document.documentElement.appendChild(d);
    setTimeout(() => d.remove(), 2500);
  }

  // ---- capture side: Blob from the page hook -> chunks -> background -> stash
  async function put(name, blob) {
    const id = uid();
    await call({ type: 'begin', id, name, mime: blob.type, size: blob.size });
    for (let off = 0; off < blob.size; off += CHUNK) {
      const buf = await blob.slice(off, off + CHUNK).arrayBuffer();
      await call({ type: 'chunk', id, b64: b64(buf) });
    }
    await call({ type: 'end', id });
    toast('Stashed: ' + name);
  }

  addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__stash !== 1) return;
    try {
      if (d.kind === 'captured') await put(d.name, d.blob);
      else if (d.kind === 'error') toast('Stash: ' + d.message);
    } catch (err) {
      toast('Stash failed: ' + err.message);
    }
  });

  // ---- drop side: stash -> File -> page
  async function fetchFile(id) {
    const meta = await call({ type: 'meta', id });
    if (!meta) throw new Error('item is gone (expired or cleared)');
    const parts = [];
    for (let i = 0; i < meta.chunks; i++) parts.push(unb64((await call({ type: 'get', id, i })).b64));
    return new File(parts, meta.name, { type: meta.mime || 'application/octet-stream' });
  }

  // Look near the clicked element for a file input (walks up a few ancestors).
  function findInput(el, anywhere) {
    let n = el;
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      if (n.matches && n.matches('input[type=file]')) return n;
      const inp = n.querySelector && n.querySelector('input[type=file]');
      if (inp) return inp;
    }
    if (!anywhere) return null;
    return [...document.querySelectorAll('input[type=file]')].find((i) => !i.disabled) || null;
  }

  function viaInput(file, input) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function viaDrop(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    const x = last.x || innerWidth / 2;
    const y = last.y || innerHeight / 2;
    const el = (last.el && last.el.isConnected && last.el) || document.elementFromPoint(x, y) || document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y })
      );
    }
  }

  async function inject(id, how) {
    const file = await fetchFile(id);
    if (how === 'input') {
      const input = findInput(last.el, true);
      if (!input) throw new Error('no file input found on this page');
      viaInput(file, input);
      return { ok: true, via: 'input' };
    }
    const near = findInput(last.el, false);
    if (near) viaInput(file, near);
    else viaDrop(file);
    return { ok: true, via: near ? 'input' : 'drop' };
  }

  chrome.runtime.onMessage.addListener((m, _sender, send) => {
    if (m.type === 'armed') toHook({ kind: 'armed', value: m.value });
    if (m.type === 'inject') {
      inject(m.id, m.how).then(send, (e) => send({ error: e.message }));
      return true;
    }
  });

  chrome.runtime
    .sendMessage({ type: 'getState' })
    .then((s) => toHook({ kind: 'armed', value: !!(s && s.armed) }))
    .catch(() => {});
})();
