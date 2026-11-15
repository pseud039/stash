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
const toOff = async (msg) => {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
  if (r && r.error) throw new Error(r.error);
  return r;
};

async function refreshBadge() {
  const { armed } = await getState();
  const n = (await toOff({ op: 'list' })).length;
  chrome.action.setBadgeBackgroundColor({ color: armed ? '#d93025' : '#188038' });
  chrome.action.setBadgeText({ text: armed ? 'ON' : n ? String(n) : '' });
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
      return getState();
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
