const state = {
  retros: [],
  premiers: [],
  youtubeIps: [],
  socialIps: [],
  publishRetroId: null,
  mode: 'retros',
  platform: 'youtube',
  checklist: null,
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
  $('actionError').textContent = '';
  refreshChecklistFrequency().catch(() => {});
}

function retrosForPlatform(platform) {
  return state.retros.filter((r) => (r.platform || 'youtube') === platform);
}

async function loadData() {
  try {
    const [youtubeIpsRes, socialIpsRes, retroRes] = await Promise.all([
      fetch('/api/ips?platform=youtube'),
      fetch('/api/ips?platform=social'),
      fetch('/api/retros'),
    ]);
    const youtubeIpsData = await youtubeIpsRes.json();
    const socialIpsData = await socialIpsRes.json();
    const retroData = await retroRes.json();

    state.youtubeIps = youtubeIpsData.ips || [];
    state.socialIps = socialIpsData.ips || [];
    state.retros = retroData;

    $('ipFilter').innerHTML = state.youtubeIps.length
      ? state.youtubeIps.map((ip) => `<option value="${ip}">${ip}</option>`).join('')
      : '<option value="">No YouTube IPs yet</option>';

    $('socialIpFilter').innerHTML = state.socialIps.length
      ? state.socialIps.map((ip) => `<option value="${ip}">${ip}</option>`).join('')
      : '<option value="">No Social IPs yet</option>';

    updateSocialTypeFilter();
    fillRetroSelects();
    fillSocialRetroSelects();
    await loadChecklistPanel();
  } catch (e) {
    $('actionError').textContent = e.message;
  }
}

function renderChecklistDefinition(def) {
  const doEl = $('checklistDo');
  const antiEl = $('checklistAnti');
  if (!doEl || !antiEl) return;
  doEl.innerHTML = (def.checks || [])
    .map((c) => `<li>${c.label}</li>`)
    .join('') || '<li class="muted">None configured</li>';
  antiEl.innerHTML = (def.antiChecks || [])
    .map((c) => `<li>${c.label}</li>`)
    .join('') || '<li class="muted">None configured</li>';
}

function periodLabel(periodKey, granularity) {
  if (granularity === 'year') return periodKey;
  if (granularity === 'month' && /^\d{4}-\d{2}$/.test(periodKey)) {
    const [y, m] = periodKey.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  }
  if (granularity === 'week') return `Wk ${periodKey}`;
  return periodKey;
}

function checklistIpForScope() {
  const platformScope = $('checklistPlatformScope')?.value || '';
  if (platformScope === 'social') return $('socialIpFilter')?.value || '';
  if (platformScope === 'youtube') return $('ipFilter')?.value || '';
  return '';
}

function renderChecklistKpis(report) {
  const scoped = report.scoped_count ?? report.retro_count ?? 0;
  const analyzed = report.analyzed_count ?? scoped;
  const withAnti = report.retros_with_anti ?? 0;
  if ($('kpiScoped')) $('kpiScoped').textContent = String(scoped);
  if ($('kpiAnalyzed')) {
    $('kpiAnalyzed').textContent = analyzed < scoped ? `${analyzed}*` : String(analyzed);
    $('kpiAnalyzed').title = analyzed < scoped ? `Capped analysis; set CHECKLIST_FREQ_MAX_RETROS=0 for all` : '';
  }
  if ($('kpiWithAnti')) $('kpiWithAnti').textContent = String(withAnti);
}

function renderChecklistFrequency(report) {
  const el = $('checklistFrequency');
  if (!el) return;
  renderChecklistKpis(report || {});

  const granularity = report?.period || 'month';
  const periodName = { week: 'Weekly', month: 'Monthly', year: 'Annual' }[granularity] || 'Monthly';
  const scoped = report?.scoped_count ?? report?.retro_count ?? 0;
  const analyzed = report?.analyzed_count ?? scoped;
  const hits = (report?.anti_items || []).filter((item) => item.total_retros > 0);

  if (!hits.length) {
    el.innerHTML = `
      <p class="freq-meta">${periodName} view · ${analyzed} analyzed of ${scoped} completed Shorts/Reel retros · matcher: ${report?.matcher || 'n/a'}</p>
      <p class="muted">No anti-pattern hits in this scope yet.</p>`;
    return;
  }

  const maxPieces = Math.max(...hits.map((h) => h.total_retros), 1);
  const topBars = hits
    .slice(0, 8)
    .map((item) => {
      const pct = Math.round((item.total_retros / maxPieces) * 100);
      const shortLabel = item.label.replace(/^[AC]\d+:\s*/, '');
      return `
        <div class="bar-row">
          <div class="bar-label" title="${item.label}">${shortLabel}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="bar-val">${item.total_retros}</div>
        </div>`;
    })
    .join('');

  const periods = report.periods || [];
  const timeline = periods.map((p) => {
    const totalInPeriod = report.period_totals?.[p]
      ?? hits.reduce((sum, item) => sum + (item.by_period?.[p] || 0), 0);
    const maxT = Math.max(...periods.map((pk) => report.period_totals?.[pk] || 0), 1);
    const h = Math.max(8, Math.round((totalInPeriod / maxT) * 72));
    return `
      <div class="timeline-col" title="${periodLabel(p, granularity)}: ${totalInPeriod} piece(s) with anti hits">
        <div class="timeline-bar" style="height:${h}px"></div>
        <div class="timeline-lbl">${periodLabel(p, granularity)}</div>
        <div class="timeline-num">${totalInPeriod}</div>
      </div>`;
  }).join('');

  const tableRows = hits.map((item) => {
    const cells = [
      item.label,
      String(item.total_retros),
      ...periods.map((p) => String(item.by_period?.[p] || 0)),
    ];
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }).join('');

  el.innerHTML = `
    <p class="freq-meta">${periodName} buckets (IST) · ${analyzed} analyzed of ${scoped} in scope · ${report.retros_with_anti || 0} with anti hits</p>
    <div class="chart-grid">
      <div class="chart-panel">
        <h4>Top anti-patterns <span class="muted">(pieces affected)</span></h4>
        <div class="bar-chart">${topBars}</div>
      </div>
      <div class="chart-panel">
        <h4>Pieces with anti hits over time</h4>
        <div class="timeline-chart">${timeline || '<p class="muted">No periods yet</p>'}</div>
      </div>
    </div>
    <details class="freq-table-wrap">
      <summary>Table view</summary>
      <table class="freq-table">
        <thead><tr>
          <th>Anti-pattern</th>
          <th>Pieces</th>
          ${periods.map((p) => `<th>${periodLabel(p, granularity)}</th>`).join('')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </details>`;
}

function renderChecklistCompareFlags(report) {
  const el = $('checklistCompareFlags');
  if (!el) return;
  if (!report) {
    el.innerHTML = '<span class="muted">Run a compare to flag repeated anti-patterns.</span>';
    return;
  }
  const repeated = report.repeated_anti || [];
  if (!repeated.length) {
    el.innerHTML = '<span class="muted">No repeated anti-checklist items matched in this comparison.</span>';
    return;
  }
  el.innerHTML = repeated
    .map((r) => {
      const ev = r.evidence ? ` — "${r.evidence}"` : '';
      return `<div class="flag">⚠ ${r.label}${r.count ? ` — ${r.count} pieces` : ''}${r.note ? ` (${r.note})` : ''}${ev}</div>`;
    })
    .join('');
}

async function refreshChecklistFrequency() {
  const period = $('checklistPeriod')?.value || 'month';
  const platform = $('checklistPlatformScope')?.value || '';
  const ip = checklistIpForScope();
  const qs = new URLSearchParams({ period, platform });
  if (ip) qs.set('ip', ip);
  const res = await fetch(`/api/checklist/anti-frequency?${qs}`);
  const report = await res.json();
  if (!res.ok) throw new Error(report.error);
  renderChecklistFrequency(report);
}

async function loadChecklistPanel() {
  try {
    const res = await fetch('/api/checklist/shorts-reels');
    const def = await res.json();
    state.checklist = def;
    renderChecklistDefinition(def);
    await refreshChecklistFrequency();
  } catch (e) {
    if ($('checklistFrequency')) $('checklistFrequency').textContent = e.message;
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
    renderChecklistCompareFlags(data.checklist_report);
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
    renderChecklistCompareFlags(data.checklist_report);
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

$('ipFilter')?.addEventListener('change', () => {
  fillRetroSelects();
  refreshChecklistFrequency().catch((e) => {
    if ($('checklistFrequency')) $('checklistFrequency').textContent = e.message;
  });
});
$('typeFilter')?.addEventListener('change', () => fillCompareRetroSelects());
$('socialPlatformFilter')?.addEventListener('change', () => {
  updateSocialTypeFilter();
  fillSocialRetroSelects();
});
$('socialIpFilter')?.addEventListener('change', () => {
  fillSocialRetroSelects();
  refreshChecklistFrequency().catch((e) => {
    if ($('checklistFrequency')) $('checklistFrequency').textContent = e.message;
  });
});
$('checklistPeriod')?.addEventListener('change', () => refreshChecklistFrequency().catch((e) => {
  if ($('checklistFrequency')) $('checklistFrequency').textContent = e.message;
}));
$('checklistPlatformScope')?.addEventListener('change', () => refreshChecklistFrequency().catch((e) => {
  if ($('checklistFrequency')) $('checklistFrequency').textContent = e.message;
}));
$('socialTypeFilter')?.addEventListener('change', () => fillSocialRetroSelects());

$('analyzeBtn')?.addEventListener('click', runRetroCompare);
$('analyzeSocialBtn')?.addEventListener('click', runSocialCompare);
$('analyzeCombinedBtn')?.addEventListener('click', runCombinedCompare);
$('analyzePremierBtn')?.addEventListener('click', runPremierCompare);
$('publishBtn')?.addEventListener('click', publishToSlack);

setPlatform('youtube');
loadData();
