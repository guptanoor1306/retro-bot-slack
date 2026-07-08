const {
  getPodMemberSlots,
  formatMemberLabel,
  formatVideoType,
  retroOpenDate,
  MAX_REMINDER_ROUNDS,
} = require('./utils');

function buildAssigneesText(retro) {
  const slots = getPodMemberSlots(retro);
  const lines = slots.map((slot) => `• <@${slot.userId}>`);
  return lines.length ? ['*POD Members:*', ...lines].join('\n') : '';
}

function buildRetroParentText(retro, { complete = false } = {}) {
  const typeLabel = formatVideoType(retro.video_type);
  const memberCount = getPodMemberSlots(retro).length;
  const lines = [
    complete
      ? `*Retro complete:* ${retro.video_name} :white_check_mark:`
      : `*Retro opened:* ${retro.video_name}`,
    `*IP:* ${retro.ip_name}`,
    typeLabel ? `*Type:* ${typeLabel}` : null,
    `*Release Date:* ${retro.release_date}`,
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

function buildResponseThreadMessage(role, response) {
  const memberLabel = formatMemberLabel(role);

  return {
    text: `${memberLabel} retro submitted`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${memberLabel}* (<@${response.user_slack_id}>) submitted their retro`,
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
  const memberCount = getPodMemberSlots(retro).length;
  return {
    text: `Retro opened: ${retro.video_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Retro opened early* for *${retro.video_name}*\nThread posted in <#${process.env.RETRO_CHANNEL_ID}>. DMs sent to all ${memberCount} POD members.`,
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
  buildCreatorEscalationMessage,
  buildAssigneesText,
};
