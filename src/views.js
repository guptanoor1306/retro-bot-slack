const { ROLE_LABELS, VIDEO_TYPES, retroOpenDate, formatVideoType } = require('./utils');

const CREATE_RETRO_CALLBACK = 'create_retro_submit';
const FILL_RETRO_CALLBACK = 'fill_retro_submit';

function buildCreateRetroModal({ channelId, userId } = {}) {
  return {
    type: 'modal',
    callback_id: CREATE_RETRO_CALLBACK,
    private_metadata: JSON.stringify({ channel_id: channelId || '', user_id: userId || '' }),
    title: { type: 'plain_text', text: 'Create Retro' },
    submit: { type: 'plain_text', text: 'Schedule Retro' },
    close: { type: 'plain_text', text: 'Cancel' },
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
      {
        type: 'input',
        block_id: 'writer_block',
        label: { type: 'plain_text', text: 'Writer' },
        element: { type: 'users_select', action_id: 'writer' },
      },
      {
        type: 'input',
        block_id: 'editor_block',
        label: { type: 'plain_text', text: 'Editor' },
        element: { type: 'users_select', action_id: 'editor' },
      },
      {
        type: 'input',
        block_id: 'designer_block',
        label: { type: 'plain_text', text: 'Designer' },
        element: { type: 'users_select', action_id: 'designer' },
      },
      {
        type: 'input',
        block_id: 'sound_block',
        label: { type: 'plain_text', text: 'Sound Designer' },
        element: { type: 'users_select', action_id: 'sound_designer' },
      },
    ],
  };
}

function buildFillRetroModal({ retroId, role, userSlackId, videoName, channelId, threadTs }) {
  const roleLabel = ROLE_LABELS[role] || role;

  return {
    type: 'modal',
    callback_id: FILL_RETRO_CALLBACK,
    private_metadata: JSON.stringify({
      retro_id: retroId,
      role,
      user_slack_id: userSlackId,
      channel_id: channelId,
      thread_ts: threadTs,
    }),
    title: { type: 'plain_text', text: 'Fill Retro' },
    submit: { type: 'plain_text', text: 'Submit Retro' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Video:* ${videoName}\n*Your Role:* ${roleLabel}`,
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

function parseCreateRetroSubmission(view) {
  const values = view.state.values;
  return {
    video_name: values.video_name_block.video_name.value.trim(),
    ip_name: values.ip_name_block.ip_name.value.trim(),
    video_type: values.video_type_block.video_type.selected_option.value,
    release_date: values.release_date_block.release_date.selected_date,
    writer_slack_id: values.writer_block.writer.selected_user,
    editor_slack_id: values.editor_block.editor.selected_user,
    designer_slack_id: values.designer_block.designer.selected_user,
    sound_slack_id: values.sound_block.sound_designer.selected_user,
  };
}

function parseFillRetroSubmission(view) {
  const values = view.state.values;
  const metadata = JSON.parse(view.private_metadata);

  return {
    retro_id: metadata.retro_id,
    role: metadata.role,
    user_slack_id: metadata.user_slack_id,
    channel_id: metadata.channel_id,
    thread_ts: metadata.thread_ts,
    good: values.good_block.good.value.trim(),
    bad: values.bad_block.bad.value.trim(),
    action_items: values.action_items_block.action_items.value.trim(),
  };
}

function buildRetroScheduledSuccessView(retro, { dmSent = true } = {}) {
  const openDate = retroOpenDate(retro.release_date);
  const typeLabel = formatVideoType(retro.video_type);

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
  CREATE_RETRO_CALLBACK,
  FILL_RETRO_CALLBACK,
  buildCreateRetroModal,
  buildFillRetroModal,
  buildRetroScheduledSuccessView,
  parseCreateRetroSubmission,
  parseFillRetroSubmission,
};
