importScripts('util.js');

// ---- state (chrome.storage.session: survives service-worker restarts, cleared when the browser closes)
const getState = async () => ({ armed: false, sticky: false, ...(await chrome.storage.session.get(['armed', 'sticky'])) });

async function broadcast() {
  const { armed } = await getState();
  for (const t of await chrome.tabs.query({})) {
    chrome.tabs.sendMessage(t.id, { type: 'armed', value: armed }).catch(() => {});
  }
}

// ---- offscreen document that actually holds the files
let creating = null;
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Hold stashed file data in memory between page loads',
      })
      .finally(() => (creating = null));
  }
  await creating;
}
// Store backend: this browser's offscreen document by default, or the localhost bridge
// (server.js) when a bridge URL is configured, which is what lets browsers share files.
let bridge = { url: '', token: '' };
const loadBridge = async () => {
  const s = await chrome.storage.local.get(['bridgeUrl', 'bridgeToken']);
  bridge = { url: (s.bridgeUrl || '').replace(/\/+$/, ''), token: s.bridgeToken || '' };
};
let bridgeReady = loadBridge();

// Auto bridge: the installed native host starts the bridge on demand and hands us its URL + token.
// If the host isn't installed, we quietly use this browser's own memory (and retry after a minute).
let auto = null;
let autoFailedAt = 0;
let autoError = ''; // why the automatic bridge isn't in use; shown in the popup
const ensureNative = () =>
  new Promise((res) => {
    try {
      chrome.runtime.sendNativeMessage('com.stash.bridge', { op: 'ensure' }, (r) => {
        const le = chrome.runtime.lastError; // reading it also stops Chrome logging an unchecked error
        if (le) autoError = le.message || 'native messaging failed';
        else if (!r) autoError = 'the helper returned nothing';
        else if (r.error) autoError = 'helper: ' + r.error;
        else autoError = '';
        res(r && !r.error && r.url ? r : null);
      });
    } catch (e) {
      autoError = String((e && e.message) || e);
      res(null);
    }
  });

async function resolveStore() {
  await bridgeReady;
  if (bridge.url) return bridge; // a manually entered bridge wins
  if (auto) return auto;
  if (Date.now() - autoFailedAt < 60 * 1000) return null;
  const r = await ensureNative();
  if (r) return (auto = { url: r.url, token: r.token });
  autoFailedAt = Date.now();
  return null;
}

const toOff = async (msg, retry = true) => {
  const b = await resolveStore();
  let r;
  if (b) {
    let res;
    try {
      res = await fetch(b.url + '/op', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-stash-token': b.token },
        body: JSON.stringify(msg),
      });
    } catch {
      if (!bridge.url && retry) {
        auto = null; // the bridge may have idled out: ask the host to start it again
        autoFailedAt = 0;
        return toOff(msg, false);
      }
      throw new Error('bridge unreachable (is server.js running?)');
    }
    if (res.status === 401) {
      auto = null; // token changed (reinstall): re-ask the host next time
      throw new Error('bridge rejected the token');
    }
    if (!res.ok) throw new Error('bridge: HTTP ' + res.status);
    r = await res.json();
  } else {
    await ensureOffscreen();
    r = await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
  }
  if (r && r.error) throw new Error(r.error);
  return r;
};

async function refreshBadge() {
  const { armed } = await getState();
  let n = 0;
  let down = false;
  try {
    n = (await toOff({ op: 'list' })).length;
  } catch {
    down = true; // bridge configured but not reachable
  }
  chrome.action.setBadgeBackgroundColor({ color: armed ? '#d93025' : down ? '#f0883e' : '#188038' });
  chrome.action.setBadgeText({ text: armed ? 'ON' : down ? '!' : n ? String(n) : '' });
}

async function afterCapture() {
  const { sticky } = await getState();
  if (!sticky) {
    await chrome.storage.session.set({ armed: false });
    await broadcast();
  }
  await refreshBadge();
}

// ---- plain-link downloads (no blob in the page): cancel, refetch into memory
const bypass = new Set();

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function nameFrom(res, url) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  if (m) return safeDecode(m[1] || m[2]);
  try {
    return safeDecode(new URL(url).pathname.split('/').pop()) || 'file';
  } catch {
    return 'file';
  }
}

async function stashUrl(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const id = uid();
  await toOff({
    op: 'begin',
    id,
    name: nameFrom(res, url),
    mime: (res.headers.get('content-type') || '').split(';')[0],
    size: buf.byteLength,
  });
  for (let o = 0; o < buf.byteLength; o += CHUNK) {
    await toOff({ op: 'chunk', id, b64: b64(buf.slice(o, o + CHUNK)) });
  }
  await toOff({ op: 'end', id });
  await afterCapture();
}

chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.url || '';
  if (bypass.delete(url)) return; // our own fallback download
  if (!/^https?:/i.test(url)) return; // blob:/data: are handled by the page hook; leave them alone
  const { armed } = await getState();
  if (!armed) return;
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  try {
    await stashUrl(url);
  } catch (e) {
    bypass.add(url); // couldn't fetch it ourselves: let the browser download it normally
    chrome.downloads.download({ url });
  }
});

// ---- right-click menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'stash-url',
    title: 'Stash this (in memory)',
    contexts: ['link', 'image', 'video', 'audio'],
  });
  chrome.contextMenus.create({
    id: 'drop-latest',
    title: 'Drop latest stash here',
    contexts: ['page', 'editable', 'frame'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'stash-url') await stashUrl(info.linkUrl || info.srcUrl);
    if (info.menuItemId === 'drop-latest') {
      const list = await toOff({ op: 'list' });
      const latest = list[list.length - 1];
      if (latest) {
        chrome.tabs
          .sendMessage(tab.id, { type: 'inject', id: latest.id, how: 'auto' }, { frameId: info.frameId || 0 })
          .catch(() => {});
      }
    }
  } catch (e) {
    console.warn('stash:', e);
  }
});

// ---- messages from content scripts and the popup (offscreen-bound ones carry `target`)
async function handle(m) {
  switch (m.type) {
    case 'getState':
      return {
        ...(await getState()),
        bridge: (await resolveStore())?.url || '',
        manual: !!bridge.url,
        why: bridge.url ? '' : autoError,
        extId: chrome.runtime.id,
      };
    case 'reloadBridge':
      bridgeReady = loadBridge();
      await bridgeReady;
      auto = null;
      autoFailedAt = 0;
      await refreshBadge();
      return { ok: true };
    case 'setState': {
      const patch = {};
      if ('armed' in m) patch.armed = !!m.armed;
      if ('sticky' in m) patch.sticky = !!m.sticky;
      await chrome.storage.session.set(patch);
      await broadcast();
      await refreshBadge();
      return { ok: true };
    }
    case 'list':
      return toOff({ op: 'list' });
    case 'begin':
    case 'chunk':
    case 'meta':
    case 'get': {
      const { type, ...rest } = m;
      return toOff({ op: type, ...rest });
    }
    case 'end': {
      const r = await toOff({ op: 'end', id: m.id });
      await afterCapture();
      return r;
    }
    case 'remove':
    case 'clear': {
      const r = await toOff({ op: m.type, id: m.id });
      await refreshBadge();
      return r;
    }
    case 'inject': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('no active tab');
      return chrome.tabs.sendMessage(tab.id, { type: 'inject', id: m.id, how: m.how }, { frameId: 0 });
    }
  }
  throw new Error('unknown message ' + m.type);
}

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  if (m.target) return;
  handle(m).then(send, (e) => send({ error: String(e.message || e) }));
  return true;
});

chrome.runtime.onStartup.addListener(refreshBadge);
