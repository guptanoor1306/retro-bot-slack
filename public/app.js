const state = {
  retros: [],
  premiers: [],
  youtubeIps: [],
  socialIps: [],
  publishRetroId: null,
  mode: 'retros',
  platform: 'youtube',
};

const SOCIAL_TYPE_OPTIONS = {
  instagram: [
    { value: 'reel', label: 'Reel' },
    { value: 'carousel', label: 'Carousel' },
    { value: 'story', label: 'Story' },
    { value: 'post', label: 'Post' },
  ],
  linkedin: [
    { value: 'post', label: 'Post' },
    { value: 'reel', label: 'Reel' },
  ],
};

const ALL_SOCIAL_TYPE_OPTIONS = [
  { value: 'reel', label: 'Reel' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'story', label: 'Story' },
  { value: 'post', label: 'Post' },
];

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function setPlatform(platform) {
  state.platform = platform;
  document.querySelectorAll('.platform-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.platform === platform);
  });
  $('youtubeInsights').classList.toggle('active', platform === 'youtube');
  $('socialInsights').classList.toggle('active', platform === 'social');
  $('publishBtn').style.display = '';
  $('copyBtn').style.display = platform === 'youtube' && state.mode === 'premiers' ? '' : 'none';
  $('actionError').textContent = '';
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#youtubeInsights .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  document.querySelectorAll('#youtubeInsights .panel').forEach((p) => {
    p.classList.toggle('active', p.dataset.mode === mode);
  });
  $('publishBtn').style.display = state.platform === 'social' ? '' : (mode === 'premiers' ? 'none' : '');
  $('copyBtn').style.display = mode === 'premiers' ? '' : 'none';
  $('actionError').textContent = '';
}

function retrosForPlatform(platform) {
  return state.retros.filter((r) => (r.platform || 'youtube') === platform);
}

async function loadData() {
  try {
    const [youtubeIpsRes, socialIpsRes, retroRes, premierRes] = await Promise.all([
      fetch('/api/ips?platform=youtube'),
      fetch('/api/ips?platform=social'),
      fetch('/api/retros'),
      fetch('/api/premier/sessions'),
    ]);
    const youtubeIpsData = await youtubeIpsRes.json();
    const socialIpsData = await socialIpsRes.json();
    const retroData = await retroRes.json();
    const premierData = await premierRes.json();

    state.youtubeIps = youtubeIpsData.ips || [];
    state.socialIps = socialIpsData.ips || [];
    state.retros = retroData;
    state.premiers = premierData.items || [];

    $('ipFilter').innerHTML = state.youtubeIps.length
      ? state.youtubeIps.map((ip) => `<option value="${ip}">${ip}</option>`).join('')
      : '<option value="">No YouTube IPs yet</option>';

    $('socialIpFilter').innerHTML = state.socialIps.length
      ? state.socialIps.map((ip) => `<option value="${ip}">${ip}</option>`).join('')
      : '<option value="">No Social IPs yet</option>';

    updateSocialTypeFilter();
    fillRetroSelects();
    fillSocialRetroSelects();
    fillPremierSelects();
  } catch (e) {
    $('actionError').textContent = e.message;
  }
}

function retroOptions(filter = {}) {
  return retrosForPlatform(filter.platform || 'youtube')
    .filter((r) => {
      if (filter.ip && r.ip_name !== filter.ip) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (filter.video_type && r.video_type !== filter.video_type) return false;
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
  return retrosForPlatform('youtube')
    .filter(
      (r) => r.ip_name === ip && r.status === 'complete' && (!type || r.video_type === type),
    )
    .sort((a, b) =>
      (b.completed_at || b.release_date).localeCompare(a.completed_at || a.release_date),
    );
}

function updateSocialTypeFilter() {
  const typeEl = $('socialTypeFilter');
  if (!typeEl) return;

  const platform = $('socialPlatformFilter')?.value || '';
  const prev = typeEl.value;
  const types = platform ? (SOCIAL_TYPE_OPTIONS[platform] || []) : ALL_SOCIAL_TYPE_OPTIONS;

  typeEl.innerHTML = [
    '<option value="">All types</option>',
    ...types.map((t) => `<option value="${t.value}">${t.label}</option>`),
  ].join('');

  if (prev && types.some((t) => t.value === prev)) {
    typeEl.value = prev;
  }
}

function completedSocialRetrosForFilter() {
  const ip = $('socialIpFilter')?.value;
  const socialPlatform = $('socialPlatformFilter')?.value;
  const type = $('socialTypeFilter')?.value;
  if (!ip) return [];
  return retrosForPlatform('social')
    .filter((r) => {
      if (r.ip_name !== ip || r.status !== 'complete') return false;
      if (socialPlatform && (r.social_platform || 'instagram') !== socialPlatform) return false;
      if (type && r.video_type !== type) return false;
      return true;
    })
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

function fillSocialRetroSelects() {
  const retros = completedSocialRetrosForFilter();
  const itemOpts = retros.length
    ? retros.map((r) => `<option value="${r.retro_id}">${retroOptionLabel(r)}</option>`).join('')
    : '';

  ['socialRetro1', 'socialRetro2', 'socialRetro3', 'socialRetro4'].forEach((id, index) => {
    const el = $(id);
    if (!el) return;
    const prev = el.value;
    const prefix = index < 2
      ? (itemOpts || '<option value="">No completed social retros</option>')
      : `<option value="">—</option>${itemOpts}`;
    el.innerHTML = prefix;
    if (prev && retros.some((r) => r.retro_id === prev)) {
      el.value = prev;
    } else if (index < retros.length) {
      el.value = retros[index].retro_id;
    }
  });
}

function fillRetroSelects() {
  fillCompareRetroSelects();
  const all = retroOptions({ platform: 'youtube' });
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
  } catch (e) {
    $('actionError').textContent = e.message;
  } finally {
    $('analyzeBtn').disabled = false;
  }
}

async function runSocialCompare() {
  $('actionError').textContent = '';
  const retroIds = ['socialRetro1', 'socialRetro2', 'socialRetro3', 'socialRetro4']
    .map((id) => $(id).value)
    .filter(Boolean);
  const unique = [...new Set(retroIds)];

  if (unique.length < 2) {
    $('actionError').textContent = 'Select at least 2 social retros to compare.';
    return;
  }
  if (unique.length !== retroIds.length) {
    $('actionError').textContent = 'Each piece must be a different retro.';
    return;
  }

  $('analyzeSocialBtn').disabled = true;
  try {
    const res = await fetch('/api/analyze/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retro_ids: unique }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('analysis').value = data.analysis;
    state.publishRetroId = data.publish_retro_id;
    $('publishBtn').disabled = !data.can_publish;
  } catch (e) {
    $('actionError').textContent = e.message;
  } finally {
    $('analyzeSocialBtn').disabled = false;
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

document.querySelectorAll('.platform-tab').forEach((tab) => {
  tab.addEventListener('click', () => setPlatform(tab.dataset.platform));
});

document.querySelectorAll('#youtubeInsights .tab').forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

$('ipFilter')?.addEventListener('change', () => fillRetroSelects());
$('typeFilter')?.addEventListener('change', () => fillCompareRetroSelects());
$('socialPlatformFilter')?.addEventListener('change', () => {
  updateSocialTypeFilter();
  fillSocialRetroSelects();
});
$('socialIpFilter')?.addEventListener('change', () => fillSocialRetroSelects());
$('socialTypeFilter')?.addEventListener('change', () => fillSocialRetroSelects());

$('analyzeBtn')?.addEventListener('click', runRetroCompare);
$('analyzeSocialBtn')?.addEventListener('click', runSocialCompare);
$('analyzeCombinedBtn')?.addEventListener('click', runCombinedCompare);
$('analyzePremierBtn')?.addEventListener('click', runPremierCompare);
$('publishBtn')?.addEventListener('click', publishToSlack);
$('copyBtn')?.addEventListener('click', copyInsights);

setPlatform('youtube');
setMode('retros');
loadData();
