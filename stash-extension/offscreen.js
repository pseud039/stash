// The stash itself. Lives in an offscreen document so it survives the service worker
// being killed. Chunks are kept as base64 strings in plain JS memory: never written to disk.
const TTL = 30 * 60 * 1000; // items expire after 30 minutes
const items = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, it] of items) if (now - it.ts > TTL) items.delete(id);
}, 60 * 1000);

const ops = {
  begin: (m) => {
    items.set(m.id, { id: m.id, name: m.name, mime: m.mime, size: m.size, parts: [], ts: Date.now(), done: false });
    return { ok: true };
  },
  chunk: (m) => {
    items.get(m.id).parts.push(m.b64);
    return { ok: true };
  },
  end: (m) => {
    const it = items.get(m.id);
    it.done = true;
    it.ts = Date.now();
    return { ok: true };
  },
  meta: (m) => {
    const it = items.get(m.id);
    return it && it.done ? { name: it.name, mime: it.mime, size: it.size, chunks: it.parts.length } : null;
  },
  get: (m) => ({ b64: items.get(m.id).parts[m.i] }),
  list: () =>
    [...items.values()]
      .filter((i) => i.done)
      .map(({ id, name, mime, size, ts }) => ({ id, name, mime, size, ts })),
  remove: (m) => {
    items.delete(m.id);
    return { ok: true };
  },
  clear: () => {
    items.clear();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  if (m.target !== 'offscreen') return;
  try {
    send(ops[m.op](m));
  } catch (e) {
    send({ error: String(e) });
  }
});
