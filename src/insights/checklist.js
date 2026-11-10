const fs = require('fs');
const path = require('path');
const { getAllRetros, getAllResponses } = require('../sheets');
const { getRetroPlatform, isSocialRetro, logInfo } = require('../utils');
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

function periodBucket(isoDate, period) {
  if (!isoDate) return '';
  const d = isoDate.slice(0, 10);
  if (period === 'week') {
    const dt = new Date(`${d}T12:00:00Z`);
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() - day + 1);
    return dt.toISOString().slice(0, 10);
  }
  return d.slice(0, 7);
}

async function buildAntiFrequencyReportAsync({
  period = 'month',
  ip = '',
  platform = '',
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

  const counts = new Map();
  const retroHits = new Map();
  const bucketRetroIds = new Map();

  const maxLlm = parseInt(process.env.CHECKLIST_LLM_MAX_RETROS || '25', 10) || 25;
  if (checklistMatchMode() === 'llm') {
    scoped = scoped
      .sort((a, b) => (b.completed_at || b.release_date || '').localeCompare(a.completed_at || a.release_date || ''))
      .slice(0, maxLlm);
    logInfo('Checklist frequency LLM scope', { retros: scoped.length, maxLlm });
  }

  for (const retro of scoped) {
    const bucket = periodBucket(retro.completed_at || retro.release_date, period);
    if (!bucket) continue;
    const analysis = await analyzeRetroChecklistAsync({
      retro,
      responses: responsesByRetro.get(retro.retro_id) || [],
    });
    if (!analysis.applies || !analysis.antiChecks.length) continue;

    if (!bucketRetroIds.has(bucket)) bucketRetroIds.set(bucket, new Set());
    bucketRetroIds.get(bucket).add(retro.retro_id);

    for (const anti of analysis.antiChecks) {
      const key = `${bucket}::${anti.id}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!retroHits.has(anti.id)) {
        retroHits.set(anti.id, { id: anti.id, label: anti.label, retro_ids: new Set(), buckets: new Map() });
      }
      const hit = retroHits.get(anti.id);
      hit.retro_ids.add(retro.retro_id);
      hit.buckets.set(bucket, (hit.buckets.get(bucket) || 0) + 1);
    }
  }

  const antiItems = (def.antiChecks || []).map((item) => {
    const hit = retroHits.get(item.id);
    const byPeriod = {};
    if (hit) {
      for (const [bucket, count] of hit.buckets.entries()) {
        byPeriod[bucket] = count;
      }
    }
    return {
      id: item.id,
      label: item.label,
      total_retros: hit ? hit.retro_ids.size : 0,
      by_period: byPeriod,
    };
  }).sort((a, b) => b.total_retros - a.total_retros);

  const periods = [...new Set([...counts.keys()].map((k) => k.split('::')[0]))].sort();

  return {
    period,
    title: def.title,
    retro_count: scoped.length,
    periods,
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
  analyzeRetroChecklistAsync,
  checklistMatchMode,
  buildAntiFrequencyReportAsync,
  buildComparisonChecklistReport,
  formatChecklistReportForPrompt,
};
