// Shared helpers: loaded by the service worker (importScripts) and by the content script.
const CHUNK = 1 << 20; // 1 MiB of raw bytes per message
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
