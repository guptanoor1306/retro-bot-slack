const { getRetroById, getRetrosByIp } = require('../sheets');
const {
  formatMemberLabel,
  formatVideoType,
  formatRetroTypeLabel,
  parseAnalyticsJson,
  getSocialAnalyticsFields,
  getSocialPlatform,
  SOCIAL_MAX_COMPARE,
} = require('../utils');

async function loadRetroWithResponses(retro) {
  const { getResponsesForRetro } = require('../sheets');
  const responses = await getResponsesForRetro(retro.retro_id);
  return { retro, responses };
}

function formatSocialRetroForAnalysis({ retro, responses }) {
  const members = responses.map((r) => ({
    role: formatMemberLabel(r.role),
    good: r.good,
    bad: r.bad,
    action_items: r.action_items,
    analytics: parseAnalyticsJson(r.analytics_json),
  }));

  return {
    retro_id: retro.retro_id,
    video_name: retro.video_name,
    ip_name: retro.ip_name,
    platform: 'social',
    social_platform: getSocialPlatform(retro),
    video_type: retro.video_type,
    video_type_label: formatRetroTypeLabel(retro),
    release_date: retro.release_date,
    completed_at: retro.completed_at,
    channel_id: retro.channel_id,
    thread_ts: retro.thread_ts,
    members,
    analytics_fields: getSocialAnalyticsFields(getSocialPlatform(retro), retro.video_type),
  };
}

function formatRetroForAnalysis({ retro, responses }) {
  if ((retro.platform || 'youtube') === 'social') {
    return formatSocialRetroForAnalysis({ retro, responses });
  }

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
  const retros = await getRetrosByIp(ipName, {
    videoType,
    status: 'complete',
    platform: 'youtube',
  });

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

async function compareSocialRetros(retroIds) {
  const uniqueIds = [...new Set(retroIds.filter(Boolean))];
  if (uniqueIds.length < 2 || uniqueIds.length > SOCIAL_MAX_COMPARE) {
    throw new Error(`Select 2 to ${SOCIAL_MAX_COMPARE} different social retros`);
  }

  const retros = await Promise.all(uniqueIds.map((id) => getRetroById(id)));
  if (retros.some((r) => !r)) throw new Error('One or more retros not found');
  if (retros.some((r) => (r.platform || 'youtube') !== 'social')) {
    throw new Error('All selected retros must be Social platform');
  }

  const items = await Promise.all(retros.map((retro) => loadRetroWithResponses(retro)));
  const sorted = items
    .map((item) => formatSocialRetroForAnalysis(item))
    .sort((a, b) => (a.completed_at || a.release_date).localeCompare(b.completed_at || b.release_date));

  return {
    mode: 'social',
    ip_name: sorted[0]?.ip_name || '',
    video_type: sorted[0]?.video_type || '',
    video_type_label: sorted[0]?.video_type_label || '',
    items: sorted,
    publish_retro_id: sorted[sorted.length - 1]?.retro_id || null,
    has_comparison: true,
  };
}

function buildSocialComparisonSummary(comparison) {
  if (!comparison.has_comparison) {
    return comparison.message || 'Not enough social retros to compare.';
  }

  const lines = [
    `Social retro comparison for ${comparison.ip_name}${comparison.video_type_label ? ` (${comparison.video_type_label})` : ''}`,
    `Comparing ${comparison.items.length} pieces:`,
    '',
  ];

  for (const item of comparison.items) {
    lines.push(`--- ${item.video_name} (${item.release_date}) ---`);
    for (const member of item.members) {
      lines.push(`${member.role}:`);
      for (const field of item.analytics_fields) {
        const value = member.analytics?.[field.key] || 'n/a';
        const insight = member.analytics?.[`${field.key}_insight`] || 'n/a';
        lines.push(`  ${field.label}: ${value} — ${insight}`);
      }
      lines.push(`  Good: ${member.good}`);
      lines.push(`  Bad: ${member.bad}`);
      lines.push(`  Action items: ${member.action_items}`);
    }
    lines.push('');
  }

  return lines.join('\n');
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
  compareSocialRetros,
  buildComparisonSummary,
  buildSocialComparisonSummary,
  formatRetroForAnalysis,
  formatSocialRetroForAnalysis,
  loadRetroWithResponses,
};
