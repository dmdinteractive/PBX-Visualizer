/* Admin UI — reads and writes /api/config. Saving applies to the running board
 * immediately; phones and messages hot-swap, and a switch-connection change
 * reconnects AMI without a restart. */

const $ = (id) => document.getElementById(id);
let cfg = null;

async function load() {
  const res = await fetch('/api/config');
  cfg = await res.json();
  $('exhibit').value = cfg.exhibit || '';
  $('subtitle').value = cfg.subtitle || '';
  $('officeName').value = cfg.officeName || '';
  $('messagesName').value = cfg.messagesName || '';
  $('tollName').value = cfg.tollName || '';
  $('mode').value = cfg.mode || 'simulate';
  $('amiHost').value = cfg.ami?.host || '';
  $('amiPort').value = cfg.ami?.port || 5038;
  $('amiUser').value = cfg.ami?.username || '';
  $('amiSecret').value = '';
  renderRows('stations', cfg.stations || []);
  renderRows('services', cfg.services || []);
  flash('');
}

function renderRows(which, list) {
  const tb = document.querySelector(`#${which} tbody`);
  tb.innerHTML = '';
  for (const s of list) addRow(which, s.id, s.name);
  updateCounts();
}

function addRow(which, id = '', name = '') {
  const tb = document.querySelector(`#${which} tbody`);
  const tr = document.createElement('tr');
  const isSvc = which === 'services';
  tr.innerHTML = `
    <td class="ext"><input class="id" value="${esc(id)}" placeholder="${isSvc ? '201' : '101'}" inputmode="numeric" /></td>
    <td class="nm"><input class="name" value="${esc(name)}" placeholder="${isSvc ? 'name of the recording' : 'label (optional)'}" /></td>
    <td class="act"><button type="button" class="del" title="Remove">&times;</button></td>`;
  tr.querySelector('.del').onclick = () => { tr.remove(); updateCounts(); };
  tb.appendChild(tr);
  updateCounts();
  return tr;
}

function collect(which) {
  return [...document.querySelectorAll(`#${which} tbody tr`)]
    .map((tr) => ({
      id: tr.querySelector('.id').value.trim(),
      name: tr.querySelector('.name').value.trim(),
    }))
    .filter((s) => s.id !== '');
}

function updateCounts() {
  $('stationCount').textContent = `(${collect('stations').length})`;
  $('serviceCount').textContent = `(${collect('services').length})`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

function flash(msg, isErr) {
  const el = $('flash');
  el.hidden = !msg;
  el.textContent = msg;
  el.className = 'flash' + (isErr ? ' err' : '');
}

document.querySelectorAll('[data-add]').forEach((b) => {
  b.onclick = () => {
    const which = b.dataset.add;
    const tr = addRow(which);
    tr.querySelector('.id').focus();
  };
});

$('addRange').onclick = () => {
  const spec = prompt('Add a range of phones, e.g.  101-131');
  if (!spec) return;
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(spec);
  if (!m) return flash('Range must look like 101-131', true);
  const a = Number(m[1]), b = Number(m[2]);
  if (b < a || b - a > 500) return flash('That range looks wrong', true);
  const have = new Set(collect('stations').map((s) => s.id));
  for (let n = a; n <= b; n++) if (!have.has(String(n))) addRow('stations', String(n), '');
  flash(`Added ${b - a + 1} phones — remember to save.`);
};

$('reload').onclick = () => load();

$('save').onclick = async () => {
  const patch = {
    exhibit: $('exhibit').value.trim(),
    subtitle: $('subtitle').value.trim(),
    officeName: $('officeName').value.trim(),
    messagesName: $('messagesName').value.trim(),
    tollName: $('tollName').value.trim(),
    mode: $('mode').value,
    ami: {
      host: $('amiHost').value.trim(),
      port: Number($('amiPort').value) || 5038,
      username: $('amiUser').value.trim(),
    },
    stations: collect('stations'),
    services: collect('services'),
  };
  // Only send the secret if they actually typed a new one.
  const secret = $('amiSecret').value;
  if (secret) patch.ami.secret = secret;
  else patch.ami.secret = cfg.ami?.secret ?? '';

  $('save').disabled = true;
  $('status').textContent = 'Saving…';
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'save failed');
    cfg = out.config;
    $('amiSecret').value = '';
    flash('Saved. The board updated immediately.');
    $('status').textContent = '';
  } catch (err) {
    flash(err.message, true);
    $('status').textContent = '';
  } finally {
    $('save').disabled = false;
  }
};

load();
