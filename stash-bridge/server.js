#!/usr/bin/env node
// Stash bridge: keeps stashed files in this process's RAM so every browser on this
// machine can read and write the same stash. No dependencies. Listens on 127.0.0.1 only.
//   node server.js            (port 47821, or PORT=...)
// Auth: every request needs the x-stash-token header. The token comes from STASH_TOKEN,
// else ~/.stash-token (created on first run). Paste it into each browser's Stash popup once.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 47821;
const TTL = 30 * 60 * 1000; // items expire after 30 minutes
const MAX_BODY = 16 * 1024 * 1024;

const tokenFile = path.join(os.homedir(), '.stash-token');
let TOKEN = process.env.STASH_TOKEN;
if (!TOKEN) {
  try {
    TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {}
  if (!TOKEN) {
    TOKEN = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
  }
}

const items = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, it] of items) if (now - it.ts > TTL) items.delete(id);
}, 60 * 1000).unref();

// Same operations as the extension's offscreen.js, so the extension can use either store.
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

const tokenOk = (given) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST' || req.url !== '/op') return send(404, { error: 'not found' });
  if (!tokenOk(req.headers['x-stash-token'])) return send(401, { error: 'bad token' });

  let size = 0;
  const bufs = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      send(413, { error: 'request too large' });
      req.destroy();
      return;
    }
    bufs.push(c);
  });
  req.on('end', () => {
    try {
      const m = JSON.parse(Buffer.concat(bufs).toString('utf8'));
      if (!Object.prototype.hasOwnProperty.call(ops, m.op)) throw new Error('unknown op');
      send(200, ops[m.op](m));
    } catch (e) {
      send(200, { error: String(e.message || e) });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('stash bridge on http://127.0.0.1:' + PORT);
  console.log('token: ' + TOKEN);
});
