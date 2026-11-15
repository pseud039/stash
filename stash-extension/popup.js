const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const fmt = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m + 'm ago';
};

// Plain-language meaning of the errors Chrome gives for native messaging.
function explain(why, extId) {
  if (/not found/i.test(why))
    return 'Helper not installed for this browser. Run the Stash installer, then fully close and reopen the browser.';
  if (/forbidden/i.test(why))
    return 'The browser refused the helper: this extension\'s ID (' + extId + ') does not match. Load the extension from the Stash package, not a copy.';
  if (/exited/i.test(why))
    return 'The helper crashed on start. Run its --logs command (see README) and check for errors.';
  if (/^helper:/i.test(why)) return why.replace(/^helper:/i, 'The helper could not start the bridge:') + '. See its --logs.';
  return 'Helper problem: ' + why;
}

async function drop(id, how) {
  const r = await send({ type: 'inject', id, how });
  if (r && r.error) {
    $('#msg').textContent = /Receiving end|Could not establish/.test(r.error)
      ? 'Reload this tab once, then try again.'
      : r.error;
  } else {
    window.close();
  }
}

async function render() {
  const st = await send({ type: 'getState' });
  $('#arm').textContent = st.armed ? 'Catching... (click to stop)' : 'Catch next download';
  $('#arm').classList.toggle('on', !!st.armed);
  $('#sticky').checked = !!st.sticky;
  $('#store').textContent = st.bridge
    ? 'shared across browsers' + (st.manual ? ' (manual bridge)' : '')
    : 'this browser only (bridge not installed)';
  $('#msg').textContent = '';
  $('#why').textContent = st.bridge || !st.why ? '' : explain(st.why, st.extId);

  let list = await send({ type: 'list' });
  if (list && list.error) {
    $('#msg').textContent = list.error;
    list = [];
  }
  const ul = $('#list');
  ul.textContent = '';
  if (!list || !list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing stashed.';
    ul.append(li);
    return;
  }
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  for (const it of [...list].reverse()) {
    const li = document.createElement('li');
    const name = document.createElement('span'); // textContent only: file names come from untrusted pages
    name.className = 'name';
    name.textContent = it.name;
    name.title = it.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = fmt(it.size) + ' · ' + ago(it.ts);
    li.append(
      name,
      meta,
      mk('Drop', () => drop(it.id, 'auto')),
      mk('Input', () => drop(it.id, 'input')),
      mk('x', async () => {
        await send({ type: 'remove', id: it.id });
        render();
      })
    );
    ul.append(li);
  }
}

$('#arm').onclick = async () => {
  const st = await send({ type: 'getState' });
  await send({ type: 'setState', armed: !st.armed });
  render();
};
$('#sticky').onchange = async (e) => {
  await send({ type: 'setState', sticky: e.target.checked });
};
$('#clear').onclick = async () => {
  await send({ type: 'clear' });
  render();
};

chrome.storage.local.get(['bridgeUrl', 'bridgeToken']).then((s) => {
  $('#burl').value = s.bridgeUrl || '';
  $('#btok').value = s.bridgeToken || '';
});
$('#bsave').onclick = async () => {
  await chrome.storage.local.set({ bridgeUrl: $('#burl').value.trim(), bridgeToken: $('#btok').value.trim() });
  await send({ type: 'reloadBridge' });
  render();
};
$('#boff').onclick = async () => {
  await chrome.storage.local.remove(['bridgeUrl', 'bridgeToken']);
  $('#burl').value = '';
  $('#btok').value = '';
  await send({ type: 'reloadBridge' });
  render();
};

render();
