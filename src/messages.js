const {
  getPodMemberSlots,
  formatMemberLabel,
  formatRetroTypeLabel,
  formatPlatformLabel,
  getRetroPlatform,
  isSocialRetro,
  getRetroChannelId,
  getSocialAnalyticsFields,
  getSocialPlatform,
  parseAnalyticsJson,
  retroOpenDate,
  MAX_REMINDER_ROUNDS,
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
  const lines = getSocialAnalyticsFields(socialPlatform, contentType).map((metric) => {
    const value = analytics[metric.key] || '_n/a_';
    const insight = analytics[`${metric.key}_insight`] || '_n/a_';
    return `*${metric.label}:* ${value}\n_${insight}_`;
  });
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
};
