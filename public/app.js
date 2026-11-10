const state = {
  retros: [],
  youtubeIps: [],
  socialIps: [],
  publishRetroId: null,
  platform: 'youtube',
  mainView: 'checklist',
  checklist: null,
  freqReport: null,
  selectedAntiId: null,
  freqLoading: false,
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

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setMainView(view) {
  state.mainView = view;
  document.querySelectorAll('.view-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  $('viewChecklist')?.classList.toggle('view-active', view === 'checklist');
  $('viewChecklist')?.toggleAttribute('hidden', view !== 'checklist');
  $('viewCompare')?.classList.toggle('view-active', view === 'compare');
  $('viewCompare')?.toggleAttribute('hidden', view !== 'compare');
}

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
  $('youtubeInsights')?.classList.toggle('platform-active', platform === 'youtube');
  $('socialInsights')?.classList.toggle('platform-active', platform === 'social');
  $('actionError').textContent = '';
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
    fillChecklistIpFilter();
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

function fillChecklistIpFilter() {
  const el = $('checklistIpFilter');
  if (!el) return;
  const prev = el.value;
  const ips = [...new Set(state.retros.map((r) => r.ip_name).filter(Boolean))].sort();
  el.innerHTML = '<option value="">All IPs</option>'
    + ips.map((ip) => `<option value="${escapeHtml(ip)}">${escapeHtml(ip)}</option>`).join('');
  if (prev && ips.includes(prev)) el.value = prev;
}

function checklistIpForScope() {
  return $('checklistIpFilter')?.value || '';
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

function renderTimeline(report) {
  const el = $('checklistTimeline');
  if (!el) return;
  const granularity = report?.period || 'month';
  const periods = report?.periods || [];
  const hits = (report?.anti_items || []).filter((item) => item.total_retros > 0);
  if (!periods.length) {
    el.innerHTML = '<p class="muted">No timeline data yet.</p>';
    return;
  }
  const maxT = Math.max(...periods.map((p) => report.period_totals?.[p] || 0), 1);
  el.innerHTML = periods.map((p) => {
    const totalInPeriod = report.period_totals?.[p] ?? 0;
    const h = Math.max(6, Math.round((totalInPeriod / maxT) * 88));
    const title = `${periodLabel(p, granularity)}: ${totalInPeriod} piece(s) with any anti hit`;
    return `
      <div class="tl-col" title="${escapeHtml(title)}">
        <div class="tl-bar" style="height:${h}px"></div>
        <div class="tl-num">${totalInPeriod}</div>
        <div class="tl-label">${escapeHtml(periodLabel(p, granularity))}</div>
      </div>`;
  }).join('');
}

function setFreqLoading(loading) {
  state.freqLoading = loading;
  const toolbar = $('checklistToolbar');
  toolbar?.classList.toggle('is-loading', loading);
  toolbar?.querySelectorAll('select').forEach((sel) => {
    sel.disabled = loading;
  });
  const flow = document.querySelector('.checklist-flow');
  flow?.classList.toggle('is-loading', loading);
  if (loading) {
    state.selectedAntiId = null;
    closePatternDrill();
    if ($('freqMeta')) $('freqMeta').textContent = 'Loading — matching retros to checklist…';
    const el = $('checklistFrequency');
    if (el) {
      el.innerHTML = `
        <div class="loading-panel" role="status" aria-live="polite">
          <div class="spinner" aria-hidden="true"></div>
          <p class="loading-title">Analyzing retros</p>
          <p class="muted">LLM is mapping Good/Bad/Actions to checklist items. Filters unlock when this finishes.</p>
        </div>`;
    }
    if ($('checklistTimeline')) {
      $('checklistTimeline').innerHTML = '<div class="loading-shimmer" aria-hidden="true"></div>';
    }
  }
}

function formatSlackUser(slackId) {
  const id = String(slackId || '').trim();
  if (!id) return '';
  return id.startsWith('U') ? `@${id.slice(0, 3)}…${id.slice(-4)}` : id;
}

function renderPatternDrill(antiId) {
  const report = state.freqReport;
  const item = report?.anti_items?.find((i) => i.id === antiId);
  const drill = $('patternDrill');
  const body = $('patternDrillBody');
  const flow = document.querySelector('.checklist-flow');
  if (!item || !drill || !body) return;

  state.selectedAntiId = antiId;
  drill.hidden = false;
  flow?.classList.add('has-drill');

  const occ = item.occurrences || [];
  const occurrencesHtml = occ.length
    ? occ.map((o) => {
        const links = [];
        if (o.post_link) {
          links.push(`<a class="text-link" href="${escapeHtml(o.post_link)}" target="_blank" rel="noopener noreferrer">Live post</a>`);
        }
        if (o.slack_thread_link) {
          links.push(`<a class="text-link" href="${escapeHtml(o.slack_thread_link)}" target="_blank" rel="noopener noreferrer">Retro thread (Slack)</a>`);
        }
        const linkRow = links.length ? `<p class="occurrence-links">${links.join(' · ')}</p>` : '';

        const attr = o.attributed_to;
        const who = attr
          ? `${escapeHtml(attr.role_label)}${attr.user_slack_id ? ` (${escapeHtml(formatSlackUser(attr.user_slack_id))})` : ''}`
          : (o.contributors || [])
              .map((c) => escapeHtml(c.role_label))
              .filter(Boolean)
              .join(', ') || 'Team retro';

        const line = o.evidence
          ? `<blockquote class="evidence">“${escapeHtml(o.evidence)}”</blockquote>`
          : '<p class="muted">No matched line extracted — re-run after deploy or check retro text.</p>';

        const conf = o.confidence ? ` · ${escapeHtml(o.confidence)} confidence` : '';
        const social = o.social_platform ? ` · ${escapeHtml(o.social_platform)}` : '';

        return `
          <article class="occurrence">
            <h4>${escapeHtml(o.video_name || 'Untitled')}</h4>
            <p class="occurrence-meta">${escapeHtml(o.ip_name || '')} · ${escapeHtml(o.platform)}${social} · ${escapeHtml(o.date || '')}${conf}</p>
            <p class="occurrence-who"><strong>Wrote / matched:</strong> ${who}</p>
            ${line}
            ${linkRow}
          </article>`;
      }).join('')
    : '<p class="muted">No occurrences stored.</p>';

  body.innerHTML = `
    <h2>${escapeHtml(item.label)}</h2>
    <p class="drill-rule">${escapeHtml(item.description || '')}</p>
    <div class="drill-action">
      <strong>Team action</strong>
      Before the next reel: scan your retro Bad/Actions for this pattern and fix it in the edit or brief — ${occ.length} piece(s) flagged recently.
    </div>
    <p class="flow-hint">${occ.length} piece(s) · click another row to switch</p>
    ${occurrencesHtml}`;

  document.querySelectorAll('.pattern-row').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.antiId === antiId);
  });
}

function closePatternDrill() {
  state.selectedAntiId = null;
  $('patternDrill').hidden = true;
  document.querySelector('.checklist-flow')?.classList.remove('has-drill');
  document.querySelectorAll('.pattern-row').forEach((btn) => btn.classList.remove('is-active'));
}

function renderChecklistFrequency(report) {
  const el = $('checklistFrequency');
  const metaEl = $('freqMeta');
  if (!el) return;
  state.freqReport = report;
  renderChecklistKpis(report || {});

  const granularity = report?.period || 'month';
  const periodName = { week: 'Weekly', month: 'Monthly', year: 'Annual' }[granularity] || 'Monthly';
  const scoped = report?.scoped_count ?? report?.retro_count ?? 0;
  const analyzed = report?.analyzed_count ?? scoped;
  const hits = (report?.anti_items || []).filter((item) => item.total_retros > 0);

  if (metaEl) {
    metaEl.textContent = `${periodName} · ${analyzed} analyzed of ${scoped} in scope · click a row for retro quotes`;
  }

  renderTimeline(report);

  if (!hits.length) {
    el.innerHTML = '<p class="muted">No anti-pattern hits in this scope yet.</p>';
    closePatternDrill();
    return;
  }

  const maxPieces = Math.max(...hits.map((h) => h.total_retros), 1);
  el.innerHTML = hits.map((item) => {
    const pct = Math.round((item.total_retros / maxPieces) * 100);
    const active = state.selectedAntiId === item.id ? ' is-active' : '';
    return `
      <button type="button" class="pattern-row${active}" data-anti-id="${escapeHtml(item.id)}" title="${escapeHtml(item.label)}">
        <div>
          <div class="pattern-label">${escapeHtml(item.label)}</div>
          <div class="pattern-meter">
            <div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div>
          </div>
        </div>
        <div class="pattern-count">${item.total_retros}<small>pieces</small></div>
      </button>`;
  }).join('');

  el.querySelectorAll('.pattern-row').forEach((btn) => {
    btn.addEventListener('click', () => renderPatternDrill(btn.dataset.antiId));
  });

  if (state.selectedAntiId && hits.some((h) => h.id === state.selectedAntiId)) {
    renderPatternDrill(state.selectedAntiId);
  } else {
    closePatternDrill();
  }
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
  if (state.freqLoading) return;
  setFreqLoading(true);
  try {
    const period = $('checklistPeriod')?.value || 'month';
    const platform = $('checklistPlatformScope')?.value || '';
    const ip = checklistIpForScope();
    const qs = new URLSearchParams({ period, platform });
    if (ip) qs.set('ip', ip);
    const res = await fetch(`/api/checklist/anti-frequency?${qs}`);
    const report = await res.json();
    if (!res.ok) throw new Error(report.error);
    renderChecklistFrequency(report);
  } finally {
    setFreqLoading(false);
  }
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

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => setMainView(tab.dataset.view));
});

$('drillClose')?.addEventListener('click', closePatternDrill);

$('ipFilter')?.addEventListener('change', () => fillRetroSelects());
$('typeFilter')?.addEventListener('change', () => fillCompareRetroSelects());
$('socialPlatformFilter')?.addEventListener('change', () => {
  updateSocialTypeFilter();
  fillSocialRetroSelects();
});
$('socialIpFilter')?.addEventListener('change', () => fillSocialRetroSelects());
$('checklistIpFilter')?.addEventListener('change', () => refreshChecklistFrequency().catch((e) => {
  if ($('freqMeta')) $('freqMeta').textContent = e.message;
}));
$('checklistPeriod')?.addEventListener('change', () => {
  state.selectedAntiId = null;
  refreshChecklistFrequency().catch((e) => {
    if ($('freqMeta')) $('freqMeta').textContent = e.message;
  });
});
$('checklistPlatformScope')?.addEventListener('change', () => {
  state.selectedAntiId = null;
  refreshChecklistFrequency().catch((e) => {
    if ($('freqMeta')) $('freqMeta').textContent = e.message;
  });
});
$('socialTypeFilter')?.addEventListener('change', () => fillSocialRetroSelects());

$('analyzeBtn')?.addEventListener('click', runRetroCompare);
$('analyzeSocialBtn')?.addEventListener('click', runSocialCompare);
$('analyzeCombinedBtn')?.addEventListener('click', runCombinedCompare);
$('analyzePremierBtn')?.addEventListener('click', runPremierCompare);
$('publishBtn')?.addEventListener('click', publishToSlack);

setMainView('checklist');
setPlatform('youtube');
loadData();
