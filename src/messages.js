const { ROLES, ROLE_LABELS, formatVideoType, retroOpenDate } = require('./utils');

function buildRetroParentText(retro, { complete = false } = {}) {
  const typeLabel = formatVideoType(retro.video_type);
  const lines = [
    complete
      ? `*Retro complete:* ${retro.video_name} :white_check_mark:`
      : `*Retro opened:* ${retro.video_name}`,
    `*IP:* ${retro.ip_name}`,
    typeLabel ? `*Type:* ${typeLabel}` : null,
    `*Release Date:* ${retro.release_date}`,
  ].filter(Boolean);

  if (complete) {
    lines.push('All 4 role retros have been submitted.');
  } else {
    lines.push('_Responses will appear in this thread._');
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

function buildFillRetroDmMessage(retro, role) {
  const roleLabel = ROLE_LABELS[role];
  const payload = JSON.stringify({
    retro_id: retro.retro_id,
    role,
    channel_id: retro.channel_id,
    thread_ts: retro.thread_ts,
  });

  return {
    text: `Fill your retro for "${retro.video_name}" (${roleLabel})`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*Retro reminder* for *${retro.video_name}*`,
            `*IP:* ${retro.ip_name}`,
            `*Your role:* ${roleLabel}`,
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

function buildResponseThreadMessage(role, response) {
  const roleLabel = ROLE_LABELS[role];

  return {
    text: `${roleLabel} retro submitted`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${roleLabel}* (<@${response.user_slack_id}>) submitted their retro`,
        },
      },
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
    ],
  };
}

function buildRetroCompleteMessage(retro, responses) {
  const actionSummary = ROLES.map((role) => {
    const resp = responses.find((r) => r.role === role);
    const label = ROLE_LABELS[role];
    const items = resp?.action_items || '_No action items submitted_';
    return `*${label}:* ${items}`;
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
            'All 4 role retros have been submitted.',
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
  const typeLabel = formatVideoType(retro.video_type);
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
  return {
    text: `Retro opened: ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Retro opened early* for *${retro.video_name}*\nThread posted in <#${process.env.RETRO_CHANNEL_ID}>. DMs sent to all roles.`,
        },
      },
    ],
  };
}

function buildInsightsThreadMessage({ ipName, videoType, analysis }) {
  const typeLabel = formatVideoType(videoType);
  return {
    text: `IP Learning Insights: ${ipName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `:brain: IP Learning Insights`,
            `IP: ${ipName}${typeLabel ? `  |  Type: ${typeLabel}` : ''}`,
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
};
