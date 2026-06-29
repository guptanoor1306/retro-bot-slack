const state = {
  retros: [],
  premiers: [],
  ips: [],
  publishRetroId: null,
  mode: 'retros',
};

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.dataset.mode === mode);
  });
  $('publishBtn').style.display = mode === 'premiers' ? 'none' : '';
  $('copyBtn').style.display = mode === 'premiers' ? '' : 'none';
  $('actionError').textContent = '';
}

async function loadData() {
  try {
    const [ipsRes, retroRes, premierRes] = await Promise.all([
      fetch('/api/ips'),
      fetch('/api/retros'),
      fetch('/api/premier/sessions'),
    ]);
    const ipsData = await ipsRes.json();
    const retroData = await retroRes.json();
    const premierData = await premierRes.json();

    state.ips = ipsData.ips || [];
    state.retros = retroData;
    state.premiers = premierData.items || [];

    $('ipFilter').innerHTML = state.ips.length
      ? state.ips.map((ip) => `<option value="${ip}">${ip}</option>`).join('')
      : '<option value="">No IPs yet</option>';

    fillRetroSelects();
    fillPremierSelects();
  } catch (e) {
    $('actionError').textContent = e.message;
  }
}

function retroOptions(filter = {}) {
  return state.retros
    .filter((r) => {
      if (filter.ip && r.ip_name !== filter.ip) return false;
      if (filter.status && r.status !== filter.status) return false;
      return true;
    })
    .map(
      (r) =>
        `<option value="${r.retro_id}">${r.video_name} · ${r.ip_name} (${r.video_type_label || '?'}) [${r.status}]</option>`,
    )
    .join('');
}

function premierOptions() {
  return state.premiers.length
    ? state.premiers.map(
        (s) =>
          `<option value="${s.id}">${s.teamName} — ${s.topicName} (${(s.createdAt || '').slice(0, 10)})</option>`,
      ).join('')
    : '<option value="">No Premier sessions — check .env</option>';
}

function retroOptionLabel(r) {
  const date = (r.release_date || '').slice(0, 10);
  return `${r.video_name} · ${r.video_type_label || '?'} (${date})`;
}

function completedRetrosForFilter() {
  const ip = $('ipFilter')?.value;
  const type = $('typeFilter')?.value;
  if (!ip) return [];
  return state.retros
    .filter(
      (r) => r.ip_name === ip && r.status === 'complete' && (!type || r.video_type === type),
    )
    .sort((a, b) =>
      (b.completed_at || b.release_date).localeCompare(a.completed_at || a.release_date),
    );
}

function fillCompareRetroSelects() {
  const retros = completedRetrosForFilter();
  const opts = retros.length
    ? retros.map((r) => `<option value="${r.retro_id}">${retroOptionLabel(r)}</option>`).join('')
    : '<option value="">No completed retros</option>';

  const olderEl = $('retroOlder');
  const newerEl = $('retroNewer');
  if (!olderEl || !newerEl) return;

  const prevOlder = olderEl.value;
  const prevNewer = newerEl.value;

  olderEl.innerHTML = opts;
  newerEl.innerHTML = opts;

  if (retros.length >= 2) {
    olderEl.value = retros.some((r) => r.retro_id === prevOlder) ? prevOlder : retros[1].retro_id;
    newerEl.value = retros.some((r) => r.retro_id === prevNewer) ? prevNewer : retros[0].retro_id;
  }
}

function fillRetroSelects() {
  fillCompareRetroSelects();
  const all = retroOptions();
  if ($('combinedRetroA')) $('combinedRetroA').innerHTML = all || '<option value="">No retros</option>';
  if ($('combinedRetroB')) $('combinedRetroB').innerHTML = all || '<option value="">No retros</option>';
}

function fillPremierSelects() {
  const opts = premierOptions();
  ['combinedPremierA', 'combinedPremierB', 'premierA', 'premierB'].forEach((id) => {
    if ($(id)) $(id).innerHTML = opts;
  });
}

async function runRetroCompare() {
  $('actionError').textContent = '';
  const olderId = $('retroOlder').value;
  const newerId = $('retroNewer').value;
  if (!olderId || !newerId) {
    $('actionError').textContent = 'Select both retros to compare.';
    return;
  }
  if (olderId === newerId) {
    $('actionError').textContent = 'Pick two different retros.';
    return;
  }

  $('analyzeBtn').disabled = true;
  try {
    const res = await fetch('/api/analyze/retros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip_name: $('ipFilter').value,
        video_type: $('typeFilter').value,
        retro_ids: [olderId, newerId],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('analysis').value = data.analysis;
    state.publishRetroId = data.publish_retro_id;
    $('publishBtn').disabled = !data.can_publish;
    if (!data.can_publish && data.comparison?.has_pair) {
      $('actionError').textContent = 'Comparison ready but newer retro has no Slack thread yet.';
    }
  } catch (e) {
    $('actionError').textContent = e.message;
  } finally {
    $('analyzeBtn').disabled = false;
  }
}

async function runCombinedCompare() {
  $('actionError').textContent = '';
  $('analyzeCombinedBtn').disabled = true;
  try {
    const res = await fetch('/api/analyze/combined', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        retro_ids: [$('combinedRetroA').value, $('combinedRetroB').value],
        premier_session_ids: [$('combinedPremierA').value, $('combinedPremierB').value],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('analysis').value = data.analysis;
    state.publishRetroId = data.publish_retro_id;
    $('publishBtn').disabled = !data.can_publish;
  } catch (e) {
    $('actionError').textContent = e.message;
  } finally {
    $('analyzeCombinedBtn').disabled = false;
  }
}

async function runPremierCompare() {
  $('actionError').textContent = '';
  $('analyzePremierBtn').disabled = true;
  try {
    const res = await fetch('/api/analyze/premiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        premier_session_ids: [$('premierA').value, $('premierB').value],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('analysis').value = data.analysis;
  } catch (e) {
    $('actionError').textContent = e.message;
  } finally {
    $('analyzePremierBtn').disabled = false;
  }
}

async function publishToSlack() {
  if (!state.publishRetroId) {
    $('actionError').textContent = 'No retro selected for publishing.';
    return;
  }
  $('publishBtn').disabled = true;
  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        retro_id: state.publishRetroId,
        analysis: $('analysis').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Published to Slack thread!');
  } catch (e) {
    $('actionError').textContent = e.message;
  } finally {
    $('publishBtn').disabled = false;
  }
}

function copyInsights() {
  navigator.clipboard.writeText($('analysis').value).then(() => {
    showToast('Copied to clipboard!');
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

$('ipFilter')?.addEventListener('change', () => {
  fillRetroSelects();
});
$('typeFilter')?.addEventListener('change', () => {
  fillCompareRetroSelects();
});

$('analyzeBtn')?.addEventListener('click', runRetroCompare);
$('analyzeCombinedBtn')?.addEventListener('click', runCombinedCompare);
$('analyzePremierBtn')?.addEventListener('click', runPremierCompare);
$('publishBtn')?.addEventListener('click', publishToSlack);
$('copyBtn')?.addEventListener('click', copyInsights);

setMode('retros');
loadData();
