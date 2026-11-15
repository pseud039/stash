const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const fmt = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m + 'm ago';
};

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

  const list = await send({ type: 'list' });
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

render();
