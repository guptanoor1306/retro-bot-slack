const {
  MIN_POD_MEMBERS,
  MAX_POD_MEMBERS,
  SOCIAL_MIN_POD_MEMBERS,
  SOCIAL_MAX_POD_MEMBERS,
  VIDEO_TYPES,
  PLATFORMS,
  SOCIAL_PLATFORMS,
  SOCIAL_IP_OPTIONS,
  getSocialTypesForPlatform,
  getSocialAnalyticsFields,
  retroOpenDate,
  formatRetroTypeLabel,
  formatPlatformLabel,
  formatMemberLabel,
  formatSocialPlatformLabel,
  getRetroPlatform,
} = require('./utils');

const PLATFORM_PICK_CALLBACK = 'platform_pick_submit';
const SOCIAL_PLATFORM_PICK_ACTION = 'social_platform_pick';
const CREATE_YOUTUBE_RETRO_CALLBACK = 'create_youtube_retro_submit';
const CREATE_SOCIAL_RETRO_CALLBACK = 'create_social_retro_submit';
const FILL_YOUTUBE_RETRO_CALLBACK = 'fill_youtube_retro_submit';
const FILL_SOCIAL_RETRO_CALLBACK = 'fill_social_retro_submit';

/** @deprecated */
const CREATE_RETRO_CALLBACK = CREATE_YOUTUBE_RETRO_CALLBACK;
/** @deprecated */
const FILL_RETRO_CALLBACK = FILL_YOUTUBE_RETRO_CALLBACK;

function buildPodMemberBlocks(minMembers, maxMembers) {
  const blocks = [];
  for (let i = 1; i <= maxMembers; i += 1) {
    blocks.push({
      type: 'input',
      block_id: `pod_member_${i}_block`,
      optional: i > minMembers,
      label: {
        type: 'plain_text',
        text: i > minMembers ? `POD Member ${i} (optional)` : `POD Member ${i}`,
      },
      element: { type: 'users_select', action_id: `pod_member_${i}` },
    });
  }
  return blocks;
}

function parsePodMembersFromView(view, maxMembers) {
  const values = view.state.values;
  const pod_member_ids = [];
  for (let i = 1; i <= maxMembers; i += 1) {
    const blockId = `pod_member_${i}_block`;
    const userId = values[blockId]?.[`pod_member_${i}`]?.selected_user;
    if (userId) pod_member_ids.push(userId);
  }
  return pod_member_ids;
}

function buildPlatformPickerModal({ channelId, userId } = {}) {
  return {
    type: 'modal',
    callback_id: PLATFORM_PICK_CALLBACK,
    private_metadata: JSON.stringify({ channel_id: channelId || '', user_id: userId || '' }),
    title: { type: 'plain_text', text: 'Create Retro' },
    submit: { type: 'plain_text', text: 'Continue' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Choose the platform for this retro. Questions and analytics will match your selection.',
        },
      },
      {
        type: 'input',
        block_id: 'platform_block',
        label: { type: 'plain_text', text: 'Platform' },
        element: {
          type: 'static_select',
          action_id: 'platform',
          placeholder: { type: 'plain_text', text: 'Select platform' },
          options: Object.entries(PLATFORMS).map(([value, text]) => ({
            text: { type: 'plain_text', text },
            value,
          })),
        },
      },
    ],
  };
}

function buildCreateYoutubeRetroModal({ channelId, userId } = {}) {
  return {
    type: 'modal',
    callback_id: CREATE_YOUTUBE_RETRO_CALLBACK,
    private_metadata: JSON.stringify({
      channel_id: channelId || '',
      user_id: userId || '',
      platform: 'youtube',
    }),
    title: { type: 'plain_text', text: 'YouTube Retro' },
    submit: { type: 'plain_text', text: 'Schedule Retro' },
    close: { type: 'plain_text', text: 'Back' },
    blocks: [
      {
        type: 'input',
        block_id: 'video_name_block',
        label: { type: 'plain_text', text: 'Video Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'video_name',
          placeholder: { type: 'plain_text', text: 'e.g. Episode 12 — The Final Cut' },
        },
      },
      {
        type: 'input',
        block_id: 'ip_name_block',
        label: { type: 'plain_text', text: 'IP Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'ip_name',
          placeholder: { type: 'plain_text', text: 'e.g. Zerodha Online' },
        },
      },
      {
        type: 'input',
        block_id: 'video_type_block',
        label: { type: 'plain_text', text: 'Type' },
        element: {
          type: 'static_select',
          action_id: 'video_type',
          placeholder: { type: 'plain_text', text: 'Select video type' },
          options: Object.entries(VIDEO_TYPES).map(([value, text]) => ({
            text: { type: 'plain_text', text },
            value,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'release_date_block',
        label: { type: 'plain_text', text: 'Release Date' },
        hint: { type: 'plain_text', text: 'Retro opens automatically at 10 AM IST the next day' },
        element: {
          type: 'datepicker',
          action_id: 'release_date',
          placeholder: { type: 'plain_text', text: 'Select release date' },
        },
      },
      ...buildPodMemberBlocks(MIN_POD_MEMBERS, MAX_POD_MEMBERS),
    ],
  };
}

function buildCreateSocialRetroModal({
  channelId,
  userId,
  socialPlatform = 'instagram',
  viewState = {},
} = {}) {
  const typeOptions = getSocialTypesForPlatform(socialPlatform);
  const savedIp = viewState?.ip_name_block?.ip_name_pick?.selected_option?.value;
  const savedType = viewState?.video_type_block?.video_type?.selected_option?.value;
  const validType = typeOptions[savedType] ? savedType : Object.keys(typeOptions)[0];

  const blocks = [
    {
      type: 'input',
      block_id: 'social_platform_block',
      dispatch_action: true,
      label: { type: 'plain_text', text: 'Platform' },
      element: {
        type: 'static_select',
        action_id: SOCIAL_PLATFORM_PICK_ACTION,
        options: Object.entries(SOCIAL_PLATFORMS).map(([value, text]) => ({
          text: { type: 'plain_text', text },
          value,
        })),
        initial_option: {
          text: { type: 'plain_text', text: SOCIAL_PLATFORMS[socialPlatform] },
          value: socialPlatform,
        },
      },
    },
    {
      type: 'input',
      block_id: 'video_name_block',
      label: { type: 'plain_text', text: 'Title' },
      element: {
        type: 'plain_text_input',
        action_id: 'video_name',
        initial_value: viewState?.video_name_block?.video_name?.value || undefined,
        placeholder: { type: 'plain_text', text: 'e.g. Summer campaign hook' },
      },
    },
    {
      type: 'input',
      block_id: 'ip_name_block',
      label: { type: 'plain_text', text: 'IP' },
      element: {
        type: 'static_select',
        action_id: 'ip_name_pick',
        options: SOCIAL_IP_OPTIONS.map((ip) => ({
          text: { type: 'plain_text', text: ip },
          value: ip,
        })),
        initial_option: {
          text: { type: 'plain_text', text: savedIp && SOCIAL_IP_OPTIONS.includes(savedIp) ? savedIp : SOCIAL_IP_OPTIONS[0] },
          value: savedIp && SOCIAL_IP_OPTIONS.includes(savedIp) ? savedIp : SOCIAL_IP_OPTIONS[0],
        },
      },
    },
    {
      type: 'input',
      block_id: 'video_type_block',
      label: { type: 'plain_text', text: 'Type' },
      element: {
        type: 'static_select',
        action_id: 'video_type',
        options: Object.entries(typeOptions).map(([value, text]) => ({
          text: { type: 'plain_text', text },
          value,
        })),
        initial_option: {
          text: { type: 'plain_text', text: typeOptions[validType] },
          value: validType,
        },
      },
    },
    {
      type: 'input',
      block_id: 'release_date_block',
      label: { type: 'plain_text', text: 'Release Date' },
      hint: { type: 'plain_text', text: 'Retro opens automatically at 10 AM IST the next day' },
      element: {
        type: 'datepicker',
        action_id: 'release_date',
        initial_date: viewState?.release_date_block?.release_date?.selected_date || undefined,
        placeholder: { type: 'plain_text', text: 'Select release date' },
      },
    },
    ...buildPodMemberBlocks(SOCIAL_MIN_POD_MEMBERS, SOCIAL_MAX_POD_MEMBERS),
  ];

  return {
    type: 'modal',
    callback_id: CREATE_SOCIAL_RETRO_CALLBACK,
    private_metadata: JSON.stringify({
      channel_id: channelId || '',
      user_id: userId || '',
      platform: 'social',
    }),
    title: { type: 'plain_text', text: 'Social Retro' },
    submit: { type: 'plain_text', text: 'Schedule Retro' },
    close: { type: 'plain_text', text: 'Back' },
    blocks,
  };
}

function buildSocialAnalyticsBlocks(socialPlatform, contentType) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Analytics (${formatSocialPlatformLabel(socialPlatform)})*` },
    },
  ];

  for (const metric of getSocialAnalyticsFields(socialPlatform, contentType)) {
    blocks.push({
      type: 'input',
      block_id: `${metric.key}_block`,
      label: { type: 'plain_text', text: metric.label },
      element: {
        type: 'plain_text_input',
        action_id: metric.key,
        placeholder: { type: 'plain_text', text: 'e.g. 42% or 1.2k' },
      },
    });
    blocks.push({
      type: 'input',
      block_id: `${metric.key}_insight_block`,
      label: { type: 'plain_text', text: `Insights on ${metric.label}` },
      element: {
        type: 'plain_text_input',
        action_id: `${metric.key}_insight`,
        multiline: true,
        placeholder: { type: 'plain_text', text: 'What are your insights on this metric?' },
      },
    });
  }

  return blocks;
}

function buildFillYoutubeRetroModal({ retroId, role, userSlackId, videoName, channelId, threadTs }) {
  const memberLabel = formatMemberLabel(role);

  return {
    type: 'modal',
    callback_id: FILL_YOUTUBE_RETRO_CALLBACK,
    private_metadata: JSON.stringify({
      retro_id: retroId,
      role,
      user_slack_id: userSlackId,
      channel_id: channelId,
      thread_ts: threadTs,
      platform: 'youtube',
    }),
    title: { type: 'plain_text', text: 'Fill Retro' },
    submit: { type: 'plain_text', text: 'Submit Retro' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Video:* ${videoName}\n*You are:* ${memberLabel}`,
        },
      },
      {
        type: 'input',
        block_id: 'good_block',
        label: { type: 'plain_text', text: 'What was good?' },
        element: {
          type: 'plain_text_input',
          action_id: 'good',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'What went well on this video?' },
        },
      },
      {
        type: 'input',
        block_id: 'bad_block',
        label: { type: 'plain_text', text: 'What was bad?' },
        element: {
          type: 'plain_text_input',
          action_id: 'bad',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'What could have been better?' },
        },
      },
      {
        type: 'input',
        block_id: 'action_items_block',
        label: { type: 'plain_text', text: 'Action Items' },
        element: {
          type: 'plain_text_input',
          action_id: 'action_items',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Concrete next steps for future videos' },
        },
      },
    ],
  };
}

function buildFillSocialRetroModal({
  retroId, role, userSlackId, videoName, channelId, threadTs, contentType, socialPlatform = 'instagram',
}) {
  const memberLabel = formatMemberLabel(role);
  const typeLabel = formatRetroTypeLabel({ video_type: contentType, platform: 'social', social_platform: socialPlatform });

  return {
    type: 'modal',
    callback_id: FILL_SOCIAL_RETRO_CALLBACK,
    private_metadata: JSON.stringify({
      retro_id: retroId,
      role,
      user_slack_id: userSlackId,
      channel_id: channelId,
      thread_ts: threadTs,
      platform: 'social',
      social_platform: socialPlatform,
      content_type: contentType,
    }),
    title: { type: 'plain_text', text: 'Fill Social Retro' },
    submit: { type: 'plain_text', text: 'Submit Retro' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Title:* ${videoName}\n*Format:* ${typeLabel}\n*You are:* ${memberLabel}`,
        },
      },
      ...buildSocialAnalyticsBlocks(socialPlatform, contentType),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Retro questions*' },
      },
      {
        type: 'input',
        block_id: 'good_block',
        label: { type: 'plain_text', text: 'What was good?' },
        element: {
          type: 'plain_text_input',
          action_id: 'good',
          multiline: true,
        },
      },
      {
        type: 'input',
        block_id: 'bad_block',
        label: { type: 'plain_text', text: 'What was bad?' },
        element: {
          type: 'plain_text_input',
          action_id: 'bad',
          multiline: true,
        },
      },
      {
        type: 'input',
        block_id: 'action_items_block',
        label: { type: 'plain_text', text: 'Action Items' },
        element: {
          type: 'plain_text_input',
          action_id: 'action_items',
          multiline: true,
        },
      },
    ],
  };
}

function buildFillRetroModal(opts) {
  if (opts.platform === 'social') {
    return buildFillSocialRetroModal(opts);
  }
  return buildFillYoutubeRetroModal(opts);
}

function parseCreateSocialSubmission(view, maxMembers) {
  const values = view.state.values;
  const social_platform = values.social_platform_block[SOCIAL_PLATFORM_PICK_ACTION].selected_option.value;
  const video_type = values.video_type_block.video_type.selected_option.value;

  return {
    platform: 'social',
    social_platform,
    video_name: values.video_name_block.video_name.value.trim(),
    ip_name: values.ip_name_block.ip_name_pick.selected_option.value,
    video_type,
    release_date: values.release_date_block.release_date.selected_date,
    pod_member_ids: parsePodMembersFromView(view, maxMembers),
  };
}

function parseCreateRetroSubmission(view, { platform, maxMembers }) {
  if (platform === 'social') return parseCreateSocialSubmission(view, maxMembers);

  const values = view.state.values;
  return {
    platform,
    social_platform: '',
    video_name: values.video_name_block.video_name.value.trim(),
    ip_name: values.ip_name_block.ip_name.value.trim(),
    video_type: values.video_type_block.video_type.selected_option.value,
    release_date: values.release_date_block.release_date.selected_date,
    pod_member_ids: parsePodMembersFromView(view, maxMembers),
  };
}

function parseFillYoutubeSubmission(view) {
  const values = view.state.values;
  const metadata = JSON.parse(view.private_metadata);

  return {
    retro_id: metadata.retro_id,
    role: metadata.role,
    user_slack_id: metadata.user_slack_id,
    channel_id: metadata.channel_id,
    thread_ts: metadata.thread_ts,
    platform: 'youtube',
    good: values.good_block.good.value.trim(),
    bad: values.bad_block.bad.value.trim(),
    action_items: values.action_items_block.action_items.value.trim(),
    analytics_json: '',
  };
}

function parseFillSocialSubmission(view) {
  const values = view.state.values;
  const metadata = JSON.parse(view.private_metadata);
  const socialPlatform = metadata.social_platform || 'instagram';
  const contentType = metadata.content_type;
  const analytics = {};

  for (const metric of getSocialAnalyticsFields(socialPlatform, contentType)) {
    analytics[metric.key] = values[`${metric.key}_block`]?.[metric.key]?.value?.trim() || '';
    analytics[`${metric.key}_insight`] =
      values[`${metric.key}_insight_block`]?.[`${metric.key}_insight`]?.value?.trim() || '';
  }

  return {
    retro_id: metadata.retro_id,
    role: metadata.role,
    user_slack_id: metadata.user_slack_id,
    channel_id: metadata.channel_id,
    thread_ts: metadata.thread_ts,
    platform: 'social',
    good: values.good_block.good.value.trim(),
    bad: values.bad_block.bad.value.trim(),
    action_items: values.action_items_block.action_items.value.trim(),
    analytics_json: JSON.stringify(analytics),
  };
}

function parseFillRetroSubmission(view) {
  const metadata = JSON.parse(view.private_metadata || '{}');
  if (metadata.platform === 'social') return parseFillSocialSubmission(view);
  return parseFillYoutubeSubmission(view);
}

function validateSocialFillSubmission(view) {
  const metadata = JSON.parse(view.private_metadata || '{}');
  const values = view.state.values;
  const errors = {};

  for (const metric of getSocialAnalyticsFields(metadata.social_platform || 'instagram', metadata.content_type)) {
    if (!values[`${metric.key}_block`]?.[metric.key]?.value?.trim()) {
      errors[`${metric.key}_block`] = `${metric.label} is required`;
    }
    if (!values[`${metric.key}_insight_block`]?.[`${metric.key}_insight`]?.value?.trim()) {
      errors[`${metric.key}_insight_block`] = `Insights on ${metric.label} are required`;
    }
  }
  if (!values.good_block?.good?.value?.trim()) errors.good_block = 'Required';
  if (!values.bad_block?.bad?.value?.trim()) errors.bad_block = 'Required';
  if (!values.action_items_block?.action_items?.value?.trim()) {
    errors.action_items_block = 'Required';
  }

  return errors;
}

function buildRetroScheduledSuccessView(retro, { dmSent = true } = {}) {
  const openDate = retroOpenDate(retro.release_date);
  const typeLabel = formatRetroTypeLabel(retro);
  const platformLabel = formatPlatformLabel(getRetroPlatform(retro));

  const dmNote = dmSent
    ? 'Check your *DM from Retro Master* for the *Open Retro Now* button.'
    : 'Could not DM you — open *Messages → Retro Master* first, then run `/retro` again. Or wait for auto-open.';

  return {
    type: 'modal',
    callback_id: 'retro_scheduled_success',
    title: { type: 'plain_text', text: 'Retro Scheduled' },
    close: { type: 'plain_text', text: 'Done' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `:white_check_mark: *${retro.video_name}* scheduled`,
            `*Platform:* ${platformLabel}${retro.social_platform ? ` · ${formatSocialPlatformLabel(retro.social_platform)}` : ''}`,
            `*IP:* ${retro.ip_name}`,
            typeLabel ? `*Type:* ${typeLabel}` : null,
            `*Release:* ${retro.release_date}`,
            `*Auto-opens:* ${openDate} at 10 AM IST`,
            '',
            dmNote,
          ].filter(Boolean).join('\n'),
        },
      },
    ],
  };
}

module.exports = {
  SOCIAL_PLATFORM_PICK_ACTION,
  PLATFORM_PICK_CALLBACK,
  CREATE_YOUTUBE_RETRO_CALLBACK,
  CREATE_SOCIAL_RETRO_CALLBACK,
  FILL_YOUTUBE_RETRO_CALLBACK,
  FILL_SOCIAL_RETRO_CALLBACK,
  CREATE_RETRO_CALLBACK,
  FILL_RETRO_CALLBACK,
  buildPlatformPickerModal,
  buildCreateRetroModal: buildCreateYoutubeRetroModal,
  buildCreateYoutubeRetroModal,
  buildCreateSocialRetroModal,
  buildFillRetroModal,
  buildFillYoutubeRetroModal,
  buildFillSocialRetroModal,
  buildRetroScheduledSuccessView,
  parseCreateRetroSubmission,
  parseFillRetroSubmission,
  validateSocialFillSubmission,
};
