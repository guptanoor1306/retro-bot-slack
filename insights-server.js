require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const express = require('express');
const path = require('path');
const {
  initSheets,
  getAllRetros,
  getUniqueIpNames,
  getRetrosByIp,
  getRetroById,
} = require('./src/sheets');
const { compareRetrosByIp, compareTwoRetros, compareSocialRetros, buildComparisonSummary } = require('./src/insights/compare');
const { listAllEndedPremiers } = require('./src/insights/premier');
const { analyzeRetroComparison, analyzeCombined, analyzePremierComparison, analyzeSocialComparison } = require('./src/insights/analyze');
const { publishInsightsToThread } = require('./src/insights/slack');
const { logError, logInfo, formatVideoType, formatRetroTypeLabel, getRetroPlatform } = require('./src/utils');

const app = express();
const PORT = process.env.PORT || process.env.INSIGHTS_PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function mapRetro(r) {
  const platform = getRetroPlatform(r);
  return {
    retro_id: r.retro_id,
    video_name: r.video_name,
    ip_name: r.ip_name,
    platform,
    platform_label: platform === 'social' ? 'Social' : 'YouTube',
    social_platform: platform === 'social' ? (r.social_platform || 'instagram') : '',
    video_type: r.video_type,
    video_type_label: formatRetroTypeLabel(r),
    release_date: r.release_date,
    completed_at: r.completed_at,
    status: r.status,
    channel_id: r.channel_id,
    thread_ts: r.thread_ts,
  };
}

app.get('/api/ips', asyncHandler(async (req, res) => {
  const ips = await getUniqueIpNames({ platform: req.query.platform || '' });
  res.json({ ips });
}));

app.get('/api/retros', asyncHandler(async (req, res) => {
  let retros = await getAllRetros();
  if (req.query.ip) {
    retros = retros.filter((r) => r.ip_name?.toLowerCase() === String(req.query.ip).toLowerCase());
  }
  if (req.query.status) {
    retros = retros.filter((r) => r.status === req.query.status);
  }
  if (req.query.video_type) {
    retros = retros.filter((r) => r.video_type === req.query.video_type);
  }
  if (req.query.platform) {
    retros = retros.filter((r) => getRetroPlatform(r) === req.query.platform);
  }
  if (req.query.social_platform) {
    retros = retros.filter(
      (r) => (r.social_platform || 'instagram') === req.query.social_platform,
    );
  }
  res.json(retros.map(mapRetro));
}));

app.get('/api/premier/sessions', asyncHandler(async (req, res) => {
  const items = await listAllEndedPremiers({ search: req.query.search || '' });
  res.json({ items });
}));

app.post('/api/analyze/retros', asyncHandler(async (req, res) => {
  const { ip_name: ipName, video_type: videoType = '', retro_ids: retroIds = [] } = req.body;

  let comparison;
  if (retroIds.length === 2 && retroIds[0] && retroIds[1]) {
    comparison = await compareTwoRetros(retroIds[0], retroIds[1]);
  } else if (ipName) {
    comparison = await compareRetrosByIp(ipName, videoType);
  } else {
    return res.status(400).json({ error: 'ip_name or retro_ids required' });
  }

  const analysis = await analyzeRetroComparison(comparison);

  res.json({
    comparison,
    analysis,
    publish_retro_id: comparison.publish_retro_id || null,
    can_publish: Boolean(comparison.has_pair && comparison.newer?.thread_ts),
  });
}));

app.post('/api/analyze/social', asyncHandler(async (req, res) => {
  const { retro_ids: retroIds = [] } = req.body;
  const comparison = await compareSocialRetros(retroIds);
  const analysis = await analyzeSocialComparison(comparison);
  const publishTarget = comparison.items?.[comparison.items.length - 1];

  res.json({
    comparison,
    analysis,
    publish_retro_id: comparison.publish_retro_id || null,
    can_publish: Boolean(publishTarget?.thread_ts),
  });
}));

app.post('/api/analyze/combined', asyncHandler(async (req, res) => {
  const { retro_ids: retroIds = [], premier_session_ids: premierSessionIds = [] } = req.body;
  const result = await analyzeCombined({ retroIds, premierSessionIds });
  const newer = result.comparison?.newer;

  res.json({
    ...result,
    can_publish: Boolean(newer?.thread_ts),
  });
}));

app.post('/api/analyze/premiers', asyncHandler(async (req, res) => {
  const { premier_session_ids: premierSessionIds = [] } = req.body;
  const result = await analyzePremierComparison(premierSessionIds);
  res.json(result);
}));

app.post('/api/publish', asyncHandler(async (req, res) => {
  const { retro_id: retroId, analysis } = req.body;
  if (!retroId || !analysis) {
    return res.status(400).json({ error: 'retro_id and analysis are required' });
  }
  const result = await publishInsightsToThread({ retroId, analysis });
  res.json({ ok: true, ...result });
}));

app.use((err, _req, res, _next) => {
  logError('insights API', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

async function main() {
  await initSheets();
  app.listen(PORT, '0.0.0.0', () => {
    logInfo(`Insights dashboard listening on port ${PORT}`);
  });
}

main().catch((error) => {
  logError('insights server startup', error);
  process.exit(1);
});
