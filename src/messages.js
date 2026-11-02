const {
  getPodMemberSlots,
  formatMemberLabel,
  formatRetroTypeLabel,
  formatPlatformLabel,
  getRetroPlatform,
  isSocialRetro,
  getRetroChannelId,
  getSocialPlatform,
  resolveSocialAnalyticsFields,
  formatSocialAnalyticsMetricSummary,
  parseAnalyticsJson,
  retroOpenDate,
  MAX_REMINDER_ROUNDS,
  slackThreadPermalink,
} = require('./utils');

function buildRetroTitleLine(retro, { complete = false } = {}) {
  const platform = formatPlatformLabel(getRetroPlatform(retro));
  const typeLabel = formatRetroTypeLabel(retro);
  const prefix = isSocialRetro(retro) ? `[${platform} · ${typeLabel}]` : `[${platform} · ${typeLabel}]`;
  return complete
    ? `*Retro complete:* ${prefix} ${retro.video_name} :white_check_mark:`
    : `*Retro opened:* ${prefix} ${retro.video_name}`;
}

function buildAssigneesText(retro) {
  const slots = getPodMemberSlots(retro);
  const lines = slots.map((slot) => `• <@${slot.userId}>`);
  return lines.length ? ['*POD Members:*', ...lines].join('\n') : '';
}

function formatSocialLinkLine(retro) {
  const link = retro.link?.trim();
  if (!link || !isSocialRetro(retro)) return null;
  return `*Link:* <${link}|View post>`;
}

function buildRetroParentText(retro, { complete = false } = {}) {
  const memberCount = getPodMemberSlots(retro).length;
  const lines = [
    buildRetroTitleLine(retro, { complete }),
    `*IP:* ${retro.ip_name}`,
    `*Release Date:* ${retro.release_date}`,
    formatSocialLinkLine(retro),
  ].filter(Boolean);

  if (!complete) {
    const assignees = buildAssigneesText(retro);
    if (assignees) lines.push('', assignees);
    lines.push('', '_Responses will appear in this thread._');
  } else {
    lines.push(`All ${memberCount} POD member retros have been submitted.`);
  }

  return lines.join('\n');
}

function buildRetroOpenedMessage(retro) {
  return {
    text: `Retro opened: ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: buildRetroParentText(retro) },
      },
    ],
  };
}

function buildRetroOpenedBlocks(retro, { complete = false } = {}) {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: buildRetroParentText(retro, { complete }) },
    },
  ];
}

function buildFillRetroDmMessage(retro, role, { reminderRound = 0 } = {}) {
  const memberLabel = formatMemberLabel(role);
  const payload = JSON.stringify({
    retro_id: retro.retro_id,
    role,
    channel_id: retro.channel_id,
    thread_ts: retro.thread_ts,
  });

  const intro = reminderRound > 0
    ? `*Reminder ${reminderRound}/${MAX_REMINDER_ROUNDS}:* Your retro for *${retro.video_name}* is still pending.`
    : `*Retro reminder* for *${retro.video_name}*`;

  return {
    text: reminderRound > 0
      ? `Reminder: fill your retro for "${retro.video_name}" (${memberLabel})`
      : `Fill your retro for "${retro.video_name}" (${memberLabel})`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            intro,
            `*IP:* ${retro.ip_name}`,
            `*You are:* ${memberLabel}`,
            'Please share what was good, what was bad, and your action items.',
          ].join('\n'),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Fill Retro' },
            style: 'primary',
            action_id: 'fill_retro_open',
            value: payload,
          },
        ],
      },
    ],
  };
}

function buildCreatorEscalationMessage(retro, pendingSlots) {
  const pendingList = pendingSlots
    .map((slot) => `• *${slot.label}:* <@${slot.userId}>`)
    .join('\n');

  return {
    text: `Retro overdue: ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `<@${retro.created_by}> — *${retro.video_name}* retro is still incomplete after 60 hours.`,
            '',
            '*Pending POD members:*',
            pendingList,
            '',
            'Please follow up with the team to close this retro.',
          ].join('\n'),
        },
      },
    ],
  };
}

function formatAnalyticsSummary(response, retro) {
  const analytics = parseAnalyticsJson(response.analytics_json);
  const socialPlatform = getSocialPlatform(retro) || 'instagram';
  const contentType = retro?.video_type;
  const fields = resolveSocialAnalyticsFields({
    socialPlatform,
    contentType,
    analytics,
  });
  const lines = fields.map((metric) => formatSocialAnalyticsMetricSummary(metric, analytics));
  return lines.join('\n');
}

function buildResponseThreadMessage(role, response, retro = null) {
  const memberLabel = formatMemberLabel(role);
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${memberLabel}* (<@${response.user_slack_id}>) submitted their retro`,
      },
    },
  ];

  if (retro && isSocialRetro(retro)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Analytics*\n${formatAnalyticsSummary(response, retro)}`,
      },
    });
  }

  blocks.push(
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*What was good?*\n${response.good}` },
        { type: 'mrkdwn', text: `*What was bad?*\n${response.bad}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Action Items*\n${response.action_items}` },
    },
  );

  return {
    text: `${memberLabel} retro submitted`,
    blocks,
  };
}

function buildRetroCompleteMessage(retro, responses) {
  const slots = getPodMemberSlots(retro);
  const actionSummary = slots.map((slot) => {
    const resp = responses.find((r) => r.role === slot.role);
    const items = resp?.action_items || '_No action items submitted_';
    return `*${slot.label}:* ${items}`;
  }).join('\n');

  return {
    text: `Retro complete: ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Retro complete:* ${retro.video_name}`,
            `All ${slots.length} POD member retros have been submitted.`,
            '',
            '*Action Items Summary:*',
            actionSummary,
          ].join('\n'),
        },
      },
    ],
  };
}

function buildRetroScheduledConfirmation(retro) {
  const openDate = retroOpenDate(retro.release_date);
  const typeLabel = formatRetroTypeLabel(retro);
  const platformLabel = formatPlatformLabel(getRetroPlatform(retro));
  const payload = JSON.stringify({ retro_id: retro.retro_id });

  return {
    text: `Retro scheduled for ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `Retro scheduled for *${retro.video_name}*`,
            `*Platform:* ${platformLabel}`,
            `*IP:* ${retro.ip_name}`,
            typeLabel ? `*Type:* ${typeLabel}` : null,
            `*Release Date:* ${retro.release_date}`,
            `*Auto-opens:* ${openDate} at 10 AM IST`,
            '',
            'You can open it early with the button below.',
          ].filter(Boolean).join('\n'),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open Retro Now' },
            style: 'primary',
            action_id: 'open_retro_now',
            value: payload,
          },
        ],
      },
    ],
  };
}

function buildRetroOpenedConfirmation(retro) {
  const memberCount = getPodMemberSlots(retro).length;
  const channelId = retro.channel_id || getRetroChannelId(retro);
  return {
    text: `Retro opened: ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Retro opened early* for *${retro.video_name}*\nThread posted in <#${channelId}>. DMs sent to all ${memberCount} POD members.`,
        },
      },
    ],
  };
}

function buildInsightsThreadMessage({ ipName, videoType, analysis, platform = 'youtube' }) {
  const typeLabel = formatRetroTypeLabel({ video_type: videoType, platform });
  const platformLabel = formatPlatformLabel(platform);
  return {
    text: `IP Learning Insights: ${ipName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `:brain: IP Learning Insights`,
            `Platform: ${platformLabel}  |  IP: ${ipName}${typeLabel ? `  |  Type: ${typeLabel}` : ''}`,
            '',
            analysis,
          ].join('\n'),
        },
      },
    ],
  };
}

function formatPendingMentions(pendingSlots) {
  const mentions = pendingSlots
    .map((s) => String(s.userId || '').trim())
    .filter((id) => /^[UW][A-Z0-9]+$/.test(id))
    .map((id) => `<@${id}>`);
  if (mentions.length) return mentions.join(' ');
  return pendingSlots.map((s) => s.label || 'POD member').join(', ');
}

function escapeSlackLinkLabel(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

function groupPendingEntriesByIp(entries) {
  const byIp = new Map();
  for (const entry of entries) {
    const ip = entry.retro.ip_name?.trim() || 'Unknown IP';
    if (!byIp.has(ip)) byIp.set(ip, []);
    byIp.get(ip).push(entry);
  }
  return [...byIp.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatPendingRetroLine(index, { retro, pendingSlots }) {
  const link = slackThreadPermalink(retro.channel_id, retro.thread_ts);
  const typeLabel = formatRetroTypeLabel(retro);
  const label = escapeSlackLinkLabel(
    typeLabel ? `${retro.video_name} (${typeLabel})` : retro.video_name,
  );
  const pendingLine = formatPendingMentions(pendingSlots);
  const titlePart = link ? `<${link}|${label}>` : label;
  return `${index}. ${titlePart} — Pending: ${pendingLine}`;
}

function buildPendingRetrosMessage({ youtube = [], social = [] }) {
  const lines = [
    '*Pending retros*',
    '_Open retros with at least one unfilled POD member._',
    '',
  ];

  const appendPlatform = (platformLabel, entries) => {
    if (!entries.length) return;
    lines.push(`*${platformLabel}*`);
    for (const [ip, ipEntries] of groupPendingEntriesByIp(entries)) {
      lines.push(`_${escapeSlackLinkLabel(ip)}_`);
      ipEntries.forEach((entry, i) => {
        lines.push(formatPendingRetroLine(i + 1, entry));
      });
    }
    lines.push('');
  };

  appendPlatform(formatPlatformLabel('youtube'), youtube);
  appendPlatform(formatPlatformLabel('social'), social);

  if (!youtube.length && !social.length) {
    lines.push('No open retros with pending POD submissions. :white_check_mark:');
  }

  let text = lines.join('\n').trim();
  const maxLen = 39000;
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}\n\n_(List truncated — too many open retros.)_`;
  }

  return {
    text,
    unfurl_links: false,
    unfurl_media: false,
  };
}

module.exports = {
  buildRetroOpenedMessage,
  buildRetroOpenedBlocks,
  buildFillRetroDmMessage,
  buildResponseThreadMessage,
  buildRetroCompleteMessage,
  buildRetroScheduledConfirmation,
  buildRetroOpenedConfirmation,
  buildInsightsThreadMessage,
  buildCreatorEscalationMessage,
  buildAssigneesText,
  buildPendingRetrosMessage,
};
