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
    updateRetroPreview();
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

function fillRetroSelects() {
  const ip = $('ipFilter')?.value;
  const completed = retroOptions({ ip, status: 'complete' });
  const all = retroOptions();
  if ($('retroOlder')) $('retroOlder').innerHTML = completed || '<option value="">No completed retros</option>';
  if ($('retroNewer')) $('retroNewer').innerHTML = completed || '<option value="">No completed retros</option>';
  if ($('combinedRetroA')) $('combinedRetroA').innerHTML = all || '<option value="">No retros</option>';
  if ($('combinedRetroB')) $('combinedRetroB').innerHTML = all || '<option value="">No retros</option>';
}

function fillPremierSelects() {
  const opts = premierOptions();
  ['combinedPremierA', 'combinedPremierB', 'premierA', 'premierB'].forEach((id) => {
    if ($(id)) $(id).innerHTML = opts;
  });
}

function updateRetroPreview() {
  const ip = $('ipFilter').value;
  const type = $('typeFilter').value;
  const completed = state.retros.filter(
    (r) => r.ip_name === ip && r.status === 'complete' && (!type || r.video_type === type),
  );
  const el = $('retroPreview');
  if (completed.length < 2) {
    el.innerHTML = `<span class="badge">${completed.length} completed retro(s) — need 2+ to compare</span>`;
    return;
  }
  el.innerHTML = `<span class="badge ok">Will compare:</span> <strong>${completed[1]?.video_name}</strong> → <strong>${completed[0]?.video_name}</strong>`;
}

async function runRetroCompare() {
  $('actionError').textContent = '';
  $('analyzeBtn').disabled = true;
  try {
    const res = await fetch('/api/analyze/retros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip_name: $('ipFilter').value,
        video_type: $('typeFilter').value,
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
  updateRetroPreview();
});
$('typeFilter')?.addEventListener('change', updateRetroPreview);

$('analyzeBtn')?.addEventListener('click', runRetroCompare);
$('analyzeCombinedBtn')?.addEventListener('click', runCombinedCompare);
$('analyzePremierBtn')?.addEventListener('click', runPremierCompare);
$('publishBtn')?.addEventListener('click', publishToSlack);
$('copyBtn')?.addEventListener('click', copyInsights);

setMode('retros');
loadData();
