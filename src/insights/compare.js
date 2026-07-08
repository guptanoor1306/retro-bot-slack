const { getRetroById, getRetrosByIp } = require('../sheets');
const { formatMemberLabel, formatVideoType } = require('../utils');

async function loadRetroWithResponses(retro) {
  const { getResponsesForRetro } = require('../sheets');
  const responses = await getResponsesForRetro(retro.retro_id);
  return { retro, responses };
}

function formatRetroForAnalysis({ retro, responses }) {
  const byRole = responses.map((r) => ({
    role: formatMemberLabel(r.role),
    good: r.good,
    bad: r.bad,
    action_items: r.action_items,
  }));

  return {
    retro_id: retro.retro_id,
    video_name: retro.video_name,
    ip_name: retro.ip_name,
    video_type: retro.video_type,
    release_date: retro.release_date,
    completed_at: retro.completed_at,
    channel_id: retro.channel_id,
    thread_ts: retro.thread_ts,
    roles: byRole,
  };
}

async function compareTwoRetros(olderRetroId, newerRetroId) {
  const olderRetro = await getRetroById(olderRetroId);
  const newerRetro = await getRetroById(newerRetroId);
  if (!olderRetro || !newerRetro) throw new Error('One or both retros not found');

  const olderData = await loadRetroWithResponses(olderRetro);
  const newerData = await loadRetroWithResponses(newerRetro);

  return {
    mode: 'retros',
    ip_name: newerRetro.ip_name,
    video_type: newerRetro.video_type,
    video_type_label: formatVideoType(newerRetro.video_type),
    older: formatRetroForAnalysis(olderData),
    newer: formatRetroForAnalysis(newerData),
    publish_retro_id: newerRetro.retro_id,
    has_pair: true,
  };
}

async function compareRetrosByIp(ipName, videoType = '') {
  const retros = await getRetrosByIp(ipName, { videoType, status: 'complete' });

  if (retros.length < 2) {
    return {
      mode: 'retros',
      ip_name: ipName,
      video_type: videoType,
      video_type_label: formatVideoType(videoType),
      has_pair: false,
      message: `Need at least 2 completed retros for "${ipName}"${videoType ? ` (${formatVideoType(videoType)})` : ''}. Found ${retros.length}.`,
    };
  }

  return compareTwoRetros(retros[1].retro_id, retros[0].retro_id);
}

/** @deprecated use compareTwoRetros / compareRetrosByIp */
async function compareRetrosForIp(retroId) {
  const current = await getRetroById(retroId);
  if (!current) throw new Error('Retro not found');
  return compareRetrosByIp(current.ip_name, current.video_type || '');
}

function buildComparisonSummary(comparison) {
  if (!comparison.has_pair) {
    return comparison.message || 'Not enough retros to compare.';
  }

  const older = comparison.older || comparison.previous;
  const newer = comparison.newer || comparison.latest;
  const typeLabel = comparison.video_type_label || formatVideoType(comparison.video_type);

  const lines = [
    `Retro comparison for ${comparison.ip_name}${typeLabel ? ` (${typeLabel})` : ''}`,
    '',
    `Older: ${older.video_name} (${older.release_date})`,
    `Newer: ${newer.video_name} (${newer.release_date})`,
    '',
    'Older retro action items:',
  ];

  for (const role of older.roles) {
    lines.push(`${role.role}: ${role.action_items}`);
  }

  lines.push('', 'Newer retro what was bad:');
  for (const role of newer.roles) {
    lines.push(`${role.role}: ${role.bad}`);
  }

  return lines.join('\n');
}

module.exports = {
  compareRetrosForIp,
  compareTwoRetros,
  compareRetrosByIp,
  buildComparisonSummary,
  formatRetroForAnalysis,
  loadRetroWithResponses,
};
