// Runs in the page's own JS world so it can see the Blob a site hands to its
// "download" link. When armed, the download is diverted into the stash instead.
(() => {
  if (window.__stashHooked) return;
  window.__stashHooked = true;

  let armed = false;
  const blobs = new Map(); // blob: URL -> Blob, so we still have it if the page revokes the URL

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreate.apply(this, arguments);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(url);
    return origRevoke.apply(this, arguments);
  };

  const isDownloadLink = (a) =>
    a instanceof HTMLAnchorElement && !!a.href && (a.hasAttribute('download') || a.href.startsWith('blob:'));

  const nameFor = (a) => {
    const d = a.getAttribute('download');
    if (d) return d;
    try {
      return decodeURIComponent(new URL(a.href).pathname.split('/').pop()) || 'file';
    } catch {
      return 'file';
    }
  };

  const post = (msg) => window.postMessage({ __stash: 1, ...msg }, '*');

  async function grab(a) {
    try {
      let blob = blobs.get(a.href);
      if (!blob) {
        const res = await fetch(a.href, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        blob = await res.blob();
      }
      post({ kind: 'captured', name: nameFor(a), blob });
    } catch (err) {
      post({ kind: 'error', message: 'capture failed, downloading normally (' + err + ')' });
      origClick.call(a); // never lose the file: fall back to a normal download
    }
  }

  // Sites trigger downloads three ways; cover all of them.
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (armed && isDownloadLink(this)) return void grab(this);
    return origClick.apply(this, arguments);
  };

  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (armed && ev && ev.type === 'click' && isDownloadLink(this)) {
      grab(this);
      return true;
    }
    return origDispatch.apply(this, arguments);
  };

  document.addEventListener(
    'click',
    (e) => {
      const a = e.target && e.target.closest && e.target.closest('a');
      if (armed && a && isDownloadLink(a)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        grab(a);
      }
    },
    true
  );

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__stash !== 1) return;
    if (d.kind === 'armed') armed = !!d.value;
    if (d.kind === 'fallback') {
      // stashing failed after we had already diverted the download: save it normally instead
      const a = document.createElement('a');
      a.href = origCreate.call(URL, d.blob);
      a.download = d.name;
      origClick.call(a);
    }
  });
})();
