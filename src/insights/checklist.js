const fs = require('fs');
const path = require('path');
const { getAllRetros, getAllResponses } = require('../sheets');
const {
  getRetroPlatform,
  isSocialRetro,
  logInfo,
  formatMemberLabel,
  slackThreadPermalink,
  parseAnalyticsJson,
  mergeMemberAnalytics,
} = require('../utils');
const { classifyRetroAgainstChecklist, checklistMatchMode } = require('./checklistLlm');

const CHECKLIST_PATH = path.join(__dirname, '../../data/shorts-reels-checklist.json');

let cachedChecklist = null;

function loadChecklistDefinition() {
  if (cachedChecklist) return cachedChecklist;
  const raw = fs.readFileSync(CHECKLIST_PATH, 'utf8');
  cachedChecklist = JSON.parse(raw);
  return cachedChecklist;
}

function retroMatchesChecklistScope(retro) {
  const def = loadChecklistDefinition();
  const applies = def.appliesTo || {};
  if (isSocialRetro(retro)) {
    if (!applies.socialTypes?.includes(retro.video_type)) return false;
    return true;
  }
  return applies.youtubeVideoTypes?.includes(retro.video_type);
}

function collectResponseText(responses = []) {
  return responses
    .map((r) => [r.good, r.bad, r.action_items].filter(Boolean).join('\n'))
    .join('\n');
}

function responseContributors(responses = []) {
  return responses
    .filter((r) => r.submitted_at || r.good || r.bad || r.action_items)
    .map((r) => ({
      role: r.role,
      role_label: formatMemberLabel(r.role),
      user_slack_id: r.user_slack_id || '',
      submitted_at: r.submitted_at || '',
    }));
}

function attributeEvidence(evidence, responses = []) {
  const ev = String(evidence || '').trim();
  if (!ev) return null;
  const needle = ev.toLowerCase().slice(0, 48);
  for (const r of responses) {
    for (const field of ['bad', 'good', 'action_items']) {
      const text = r[field];
      if (!text?.trim()) continue;
      if (
        text.toLowerCase().includes(needle)
        || (needle.length > 12 && text.toLowerCase().includes(needle.slice(0, 24)))
      ) {
        return {
          role: r.role,
          role_label: formatMemberLabel(r.role),
          user_slack_id: r.user_slack_id || '',
          field,
          submitted_at: r.submitted_at || '',
        };
      }
    }
  }
  return null;
}

function matchChecklistItems(text, items = []) {
  if (!text?.trim()) return [];
  const haystack = text.toLowerCase();
  return items
    .filter((item) => (item.signals || item.keywords || []).some((kw) => haystack.includes(String(kw).toLowerCase())))
    .map((item) => ({ id: item.id, label: item.label }));
}

async function analyzeRetroChecklistAsync({ retro, responses, text: presetText } = {}) {
  if (!retroMatchesChecklistScope(retro)) {
    return { applies: false, checks: [], antiChecks: [], matcher: 'none' };
  }
  const def = loadChecklistDefinition();
  const text = presetText ?? collectResponseText(responses);
  const llm = await classifyRetroAgainstChecklist({
    videoName: retro.video_name,
    ipName: retro.ip_name,
    retroText: text,
    definition: def,
  });
  if (llm) {
    return { applies: true, ...llm };
  }
  return {
    applies: true,
    checks: matchChecklistItems(text, def.checks),
    antiChecks: matchChecklistItems(text, def.antiChecks),
    matcher: 'keyword',
  };
}

function retroDateKey(isoDate) {
  if (!isoDate) return '';
  return String(isoDate).trim().slice(0, 10);
}

/** When the team finished the retro form (not video release date). */
function retroFilledDate(retro) {
  return retroDateKey(retro.completed_at);
}

function istTodayDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Calendar week/month/year bucket for today (IST). */
function currentPeriodBucket(period) {
  return periodBucket(istTodayDateKey(), period);
}

function listFilledPeriodBuckets(retros, period) {
  const set = new Set([currentPeriodBucket(period)]);
  for (const retro of retros) {
    const filled = retroFilledDate(retro);
    if (!filled) continue;
    set.add(periodBucket(filled, period));
  }
  return [...set].sort();
}

/** Bucket keys for charts (week = Monday start, IST calendar date from sheet). */
function periodBucket(isoDate, period) {
  const d = retroDateKey(isoDate);
  if (!d) return '';
  if (period === 'year') return d.slice(0, 4);
  if (period === 'week') {
    const dt = new Date(`${d}T12:00:00+05:30`);
    const day = dt.getDay() || 7;
    dt.setDate(dt.getDate() - day + 1);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const dayNum = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayNum}`;
  }
  return d.slice(0, 7);
}

function ensurePatternHitStore(store, pattern) {
  if (!store.has(pattern.id)) {
    store.set(pattern.id, {
      id: pattern.id,
      label: pattern.label,
      retro_ids: new Set(),
      buckets: new Map(),
      occurrences: [],
    });
  }
  return store.get(pattern.id);
}

function appendPatternOccurrence(hit, pattern, retro, bucket, responses) {
  const evidence = pattern.evidence || '';
  hit.retro_ids.add(retro.retro_id);
  hit.buckets.set(bucket, (hit.buckets.get(bucket) || 0) + 1);
  hit.occurrences.push({
    retro_id: retro.retro_id,
    video_name: retro.video_name,
    ip_name: retro.ip_name,
    platform: getRetroPlatform(retro) || 'youtube',
    social_platform: retro.social_platform || '',
    date: retroFilledDate(retro),
    bucket,
    evidence,
    confidence: pattern.confidence || '',
    post_link: String(retro.link || '').trim(),
    slack_thread_link: slackThreadPermalink(retro.channel_id, retro.thread_ts),
    contributors: responseContributors(responses),
    attributed_to: attributeEvidence(evidence, responses),
  });
}

function rollupPatternItems(defItems, hitStore, metaById) {
  return (defItems || [])
    .map((item) => {
      const hit = hitStore.get(item.id);
      const byPeriod = {};
      if (hit) {
        for (const [bucket, count] of hit.buckets.entries()) {
          byPeriod[bucket] = count;
        }
      }
      const meta = metaById.get(item.id) || item;
      return {
        id: item.id,
        label: item.label,
        description: meta.description || '',
        total_retros: hit ? hit.retro_ids.size : 0,
        by_period: byPeriod,
        occurrences: hit?.occurrences || [],
      };
    })
    .sort((a, b) => b.total_retros - a.total_retros);
}

function parseAnalyticsNumber(val) {
  if (val == null || val === '') return null;
  const chunk = String(val).trim().split(/[|/]/)[0].trim();
  const s = chunk.replace(/%/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

async function buildChecklistPerformanceHighlights({ ip = '', platform = '' } = {}) {
  const [retros, responses] = await Promise.all([getAllRetros(), getAllResponses()]);
  const responsesByRetro = new Map();
  for (const r of responses) {
    if (!responsesByRetro.has(r.retro_id)) responsesByRetro.set(r.retro_id, []);
    responsesByRetro.get(r.retro_id).push(r);
  }

  let scoped = retros.filter((r) => retroMatchesChecklistScope(r));
  if (ip) scoped = scoped.filter((r) => r.ip_name?.toLowerCase() === ip.toLowerCase());
  if (platform) {
    scoped = scoped.filter((r) => (getRetroPlatform(r) || 'youtube') === platform);
  }

  const rows = [];
  for (const retro of scoped) {
    const members = (responsesByRetro.get(retro.retro_id) || []).map((r) => ({
      analytics: parseAnalyticsJson(r.analytics_json),
    }));
    const analytics = mergeMemberAnalytics(members);
    const skipRate = parseAnalyticsNumber(analytics.skip_rate);
    const followRate = parseAnalyticsNumber(analytics.follow_rate);
    if (skipRate == null && followRate == null) continue;

    rows.push({
      retro_id: retro.retro_id,
      video_name: retro.video_name,
      ip_name: retro.ip_name,
      status: retro.status,
      platform: getRetroPlatform(retro) || 'youtube',
      release_date: retroDateKey(retro.completed_at || retro.release_date),
      skip_rate: skipRate,
      follow_rate: followRate,
      skip_rate_label: String(analytics.skip_rate || '').trim(),
      follow_rate_label: String(analytics.follow_rate || '').trim(),
      post_link: String(retro.link || '').trim(),
      slack_thread_link: slackThreadPermalink(retro.channel_id, retro.thread_ts),
    });
  }

  const withSkip = rows.filter((r) => r.skip_rate != null);
  if (!withSkip.length) {
    return {
      scoped_count: scoped.length,
      with_metrics: 0,
      metric: 'skip_rate',
      note: 'Add skip rate (and follow rate) in retro analytics to rank pieces here.',
      best: null,
      worst: null,
      avg_skip: null,
      avg_follow: null,
    };
  }

  const avgSkip = withSkip.reduce((sum, r) => sum + r.skip_rate, 0) / withSkip.length;
  const withFollow = rows.filter((r) => r.follow_rate != null);
  const avgFollow = withFollow.length
    ? withFollow.reduce((sum, r) => sum + r.follow_rate, 0) / withFollow.length
    : null;

  const best = withSkip.reduce((a, b) => (a.skip_rate <= b.skip_rate ? a : b));
  const worst = withSkip.reduce((a, b) => (a.skip_rate >= b.skip_rate ? a : b));

  return {
    scoped_count: scoped.length,
    with_metrics: withSkip.length,
    metric: 'skip_rate',
    avg_skip: Math.round(avgSkip * 10) / 10,
    avg_follow: avgFollow != null ? Math.round(avgFollow * 1000) / 1000 : null,
    best: {
      ...best,
      follow_vs_avg: best.follow_rate != null && avgFollow
        ? Math.round((best.follow_rate / avgFollow) * 10) / 10
        : null,
    },
    worst,
  };
}

async function buildAntiFrequencyReportAsync({
  period = 'month',
  ip = '',
  platform = '',
  focus_period: focusPeriod = '',
} = {}) {
  const def = loadChecklistDefinition();
  const [retros, responses] = await Promise.all([getAllRetros(), getAllResponses()]);

  const responsesByRetro = new Map();
  for (const r of responses) {
    if (!responsesByRetro.has(r.retro_id)) responsesByRetro.set(r.retro_id, []);
    responsesByRetro.get(r.retro_id).push(r);
  }

  let scoped = retros.filter((r) => r.status === 'complete' && retroMatchesChecklistScope(r));
  if (ip) scoped = scoped.filter((r) => r.ip_name?.toLowerCase() === ip.toLowerCase());
  if (platform) {
    scoped = scoped.filter((r) => (getRetroPlatform(r) || 'youtube') === platform);
  }

  const focusBucket = focusPeriod || currentPeriodBucket(period);
  scoped = scoped.filter((r) => {
    const filled = retroFilledDate(r);
    return filled && periodBucket(filled, period) === focusBucket;
  });

  const antiCounts = new Map();
  const checkCounts = new Map();
  const antiHits = new Map();
  const checkHits = new Map();
  const bucketRetroIds = new Map();

  const scopedTotal = scoped.length;
  const freqMax = parseInt(process.env.CHECKLIST_FREQ_MAX_RETROS || '0', 10);
  if (checklistMatchMode() === 'llm' && freqMax > 0 && scoped.length > freqMax) {
    scoped = scoped
      .sort((a, b) => (b.completed_at || b.release_date || '').localeCompare(a.completed_at || a.release_date || ''))
      .slice(0, freqMax);
    logInfo('Checklist frequency LLM scope (capped)', { analyzed: scoped.length, scopedTotal, freqMax });
  } else if (checklistMatchMode() === 'llm') {
    logInfo('Checklist frequency LLM scope (all)', { analyzed: scoped.length });
  }

  const retrosWithAnti = new Set();
  const retrosWithDo = new Set();

  for (const retro of scoped) {
    const bucket = periodBucket(retroFilledDate(retro), period);
    if (!bucket) continue;
    const responses = responsesByRetro.get(retro.retro_id) || [];
    const analysis = await analyzeRetroChecklistAsync({ retro, responses });
    if (!analysis.applies) continue;

    const hasAnti = analysis.antiChecks?.length > 0;
    const hasDo = analysis.checks?.length > 0;
    if (!hasAnti && !hasDo) continue;

    if (!bucketRetroIds.has(bucket)) bucketRetroIds.set(bucket, new Set());
    bucketRetroIds.get(bucket).add(retro.retro_id);
    if (hasAnti) retrosWithAnti.add(retro.retro_id);
    if (hasDo) retrosWithDo.add(retro.retro_id);

    for (const check of analysis.checks || []) {
      const key = `${bucket}::${check.id}`;
      checkCounts.set(key, (checkCounts.get(key) || 0) + 1);
      const hit = ensurePatternHitStore(checkHits, check);
      appendPatternOccurrence(hit, check, retro, bucket, responses);
    }

    for (const anti of analysis.antiChecks || []) {
      const key = `${bucket}::${anti.id}`;
      antiCounts.set(key, (antiCounts.get(key) || 0) + 1);
      const hit = ensurePatternHitStore(antiHits, anti);
      appendPatternOccurrence(hit, anti, retro, bucket, responses);
    }
  }

  const checkById = new Map((def.checks || []).map((i) => [i.id, i]));
  const antiById = new Map((def.antiChecks || []).map((i) => [i.id, i]));

  const checkItems = rollupPatternItems(def.checks, checkHits, checkById);
  const antiItems = rollupPatternItems(def.antiChecks, antiHits, antiById);

  const periods = [
    ...new Set([
      ...[...antiCounts.keys(), ...checkCounts.keys()].map((k) => k.split('::')[0]),
    ]),
  ].sort();

  const periodTotals = {};
  for (const p of periods) {
    periodTotals[p] = bucketRetroIds.get(p)?.size || 0;
  }

  return {
    period,
    focus_period: focusBucket,
    focus_period_label: focusBucket,
    filled_date_field: 'completed_at',
    title: def.title,
    scoped_count: scopedTotal,
    analyzed_count: scoped.length,
    retros_with_anti: retrosWithAnti.size,
    retros_with_do: retrosWithDo.size,
    retro_count: scopedTotal,
    period_totals: periodTotals,
    periods,
    check_items: checkItems,
    anti_items: antiItems,
    checks: def.checks,
    anti_checks: def.antiChecks,
    matcher: checklistMatchMode(),
  };
}

async function analyzeComparisonSide(def, side, scopeRetro) {
  const text = (side.roles || side.members || [])
    .map((r) => [r.good, r.bad, r.action_items].filter(Boolean).join('\n'))
    .join('\n');
  const retro = {
    ...scopeRetro,
    retro_id: side.retro_id,
    video_name: side.video_name,
    release_date: side.release_date,
    ip_name: side.ip_name,
  };
  const analysis = await analyzeRetroChecklistAsync({ retro, responses: [], text });
  return {
    retro_id: side.retro_id,
    video_name: side.video_name,
    release_date: side.release_date,
    checks: analysis.checks || [],
    antiChecks: analysis.antiChecks || [],
    matcher: analysis.matcher,
  };
}

async function buildComparisonChecklistReport(comparison) {
  const def = loadChecklistDefinition();
  if (comparison.mode === 'social' && comparison.items) {
    const itemReports = [];
    for (const item of comparison.items) {
      const pseudoRetro = {
        platform: 'social',
        video_type: item.video_type,
        social_platform: item.social_platform,
        ip_name: item.ip_name,
      };
      if (!retroMatchesChecklistScope({ ...pseudoRetro, platform: 'social' })) continue;
      const text = (item.members || [])
        .map((m) => [m.good, m.bad, m.action_items].filter(Boolean).join('\n'))
        .join('\n');
      const analysis = await analyzeRetroChecklistAsync({
        retro: { ...pseudoRetro, video_name: item.video_name },
        text,
      });
      itemReports.push({
        retro_id: item.retro_id,
        video_name: item.video_name,
        release_date: item.release_date,
        antiChecks: analysis.antiChecks,
        checks: analysis.checks,
        matcher: analysis.matcher,
        applies: true,
      });
    }

    const repeatedAnti = [];
    const antiCount = new Map();
    const antiEvidence = new Map();
    for (const row of itemReports) {
      for (const anti of row.antiChecks) {
        antiCount.set(anti.id, (antiCount.get(anti.id) || 0) + 1);
        if (!antiEvidence.has(anti.id)) antiEvidence.set(anti.id, anti.evidence);
      }
    }
    for (const [id, count] of antiCount.entries()) {
      if (count >= 2) {
        const label = def.antiChecks.find((a) => a.id === id)?.label || id;
        repeatedAnti.push({
          id,
          label,
          count,
          flagged: true,
          evidence: antiEvidence.get(id) || '',
        });
      }
    }

    return {
      scope: 'social',
      items: itemReports,
      repeated_anti: repeatedAnti,
      matcher: checklistMatchMode(),
    };
  }

  if (!comparison.has_pair) return { scope: 'youtube', items: [], repeated_anti: [] };

  const videoType = comparison.video_type || comparison.newer?.video_type;
  if (videoType !== 'shorts_reels') {
    return {
      scope: 'youtube',
      items: [],
      repeated_anti: [],
      note: 'Checklist applies to YouTube Shorts/Reels retros only',
    };
  }

  const scopeRetro = { platform: 'youtube', video_type: 'shorts_reels', ip_name: comparison.ip_name };
  const older = await analyzeComparisonSide(def, comparison.older, scopeRetro);
  const newer = await analyzeComparisonSide(def, comparison.newer, scopeRetro);
  const repeatedAnti = [];

  for (const anti of newer.antiChecks) {
    const inOlder = older.antiChecks.some((a) => a.id === anti.id);
    if (inOlder) {
      repeatedAnti.push({
        id: anti.id,
        label: anti.label,
        flagged: true,
        note: 'Appears in both retros (older and newer)',
        evidence: [older.antiChecks.find((a) => a.id === anti.id)?.evidence, anti.evidence]
          .filter(Boolean)
          .join(' | '),
      });
    }
  }

  for (const anti of newer.antiChecks) {
    if (!older.antiChecks.some((a) => a.id === anti.id)) {
      repeatedAnti.push({
        id: anti.id,
        label: anti.label,
        flagged: false,
        note: 'Newer retro only (first time in this pair)',
        evidence: anti.evidence || '',
      });
    }
  }

  return {
    scope: 'youtube',
    older,
    newer,
    repeated_anti: repeatedAnti.filter((r) => r.flagged),
    newer_only_anti: repeatedAnti.filter((r) => !r.flagged),
    matcher: checklistMatchMode(),
  };
}

function formatChecklistReportForPrompt(report) {
  if (!report) return '';
  const lines = ['### Checklist (Reels/Shorts)', ''];
  if (report.repeated_anti?.length) {
    lines.push(`Repeated anti-patterns (${report.matcher || 'llm'} match on retro text):`);
    for (const row of report.repeated_anti) {
      const ev = row.evidence ? ` — "${row.evidence}"` : '';
      lines.push(`- ${row.label}${row.count ? ` (${row.count} pieces)` : ''}${row.note ? ` — ${row.note}` : ''}${ev}`);
    }
  } else {
    lines.push('No repeated anti-patterns matched between selected retros.');
  }
  return lines.join('\n');
}

module.exports = {
  loadChecklistDefinition,
  retroMatchesChecklistScope,
  retroFilledDate,
  periodBucket,
  currentPeriodBucket,
  listFilledPeriodBuckets,
  analyzeRetroChecklistAsync,
  checklistMatchMode,
  buildAntiFrequencyReportAsync,
  buildChecklistPerformanceHighlights,
  buildComparisonChecklistReport,
  formatChecklistReportForPrompt,
};
