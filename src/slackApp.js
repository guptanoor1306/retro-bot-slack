const { App } = require('@slack/bolt');
const {
  generateId,
  nowISO,
  logError,
  logInfo,
  getPodMemberSlots,
  getPodMemberLimits,
  getRetroChannelId,
  getSocialPlatform,
  isValidSocialTypeCombo,
  serializePodMemberIds,
  isSocialRetro,
  parseActionValue,
  normalizeSlackTs,
} = require('./utils');
const {
  createRetro,
  getRetroById,
  updateRetro,
  createResponse,
  getResponsesForRetro,
  getResponseByRole,
} = require('./sheets');
const {
  buildPlatformPickerModal,
  buildCreateYoutubeRetroModal,
  buildCreateSocialRetroModal,
  buildFillRetroModal,
  parseCreateRetroSubmission,
  parseFillRetroSubmission,
  validateSocialFillSubmission,
  buildRetroScheduledSuccessView,
  SOCIAL_PLATFORM_PICK_ACTION,
  PLATFORM_PICK_CALLBACK,
  CREATE_YOUTUBE_RETRO_CALLBACK,
  CREATE_SOCIAL_RETRO_CALLBACK,
  FILL_YOUTUBE_RETRO_CALLBACK,
  FILL_SOCIAL_RETRO_CALLBACK,
} = require('./views');
const {
  buildRetroOpenedMessage,
  buildRetroOpenedBlocks,
  buildFillRetroDmMessage,
  buildResponseThreadMessage,
  buildRetroCompleteMessage,
  buildRetroScheduledConfirmation,
  buildRetroOpenedConfirmation,
} = require('./messages');

function createSlackApp() {
  const useSocketMode = process.env.USE_SOCKET_MODE !== 'false';

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: useSocketMode,
    appToken: useSocketMode ? process.env.SLACK_APP_TOKEN : undefined,
  });

  registerHandlers(app);
  return app;
}

async function scheduleRetroFromSubmission({ ack, body, view, client, platform }) {
  const { min, max } = getPodMemberLimits(platform);
  const data = parseCreateRetroSubmission(view, { platform, maxMembers: max });

  if (!data.video_name || !data.ip_name || !data.release_date || !data.video_type) {
    const errors = {};
    if (!data.video_name) errors.video_name_block = 'Title is required';
    if (!data.ip_name) errors.ip_name_block = 'IP name is required';
    if (!data.video_type) errors.video_type_block = 'Type is required';
    if (!data.release_date) errors.release_date_block = 'Release date is required';
    await ack({ response_action: 'errors', errors });
    return;
  }

  if (data.pod_member_ids.length < min) {
    await ack({
      response_action: 'errors',
      errors: {
        [`pod_member_${min}_block`]: `Add at least ${min} POD member${min > 1 ? 's' : ''}`,
      },
    });
    return;
  }

  if (platform === 'social' && !isValidSocialTypeCombo(data.social_platform, data.video_type)) {
    await ack({
      response_action: 'errors',
      errors: { video_type_block: 'Invalid type for selected platform' },
    });
    return;
  }

  if (new Set(data.pod_member_ids).size !== data.pod_member_ids.length) {
    await ack({
      response_action: 'errors',
      errors: { pod_member_1_block: 'Each POD member must be a different person' },
    });
    return;
  }

  let dmSent = false;
  try {
    const retro = {
      retro_id: generateId('retro'),
      video_name: data.video_name,
      ip_name: data.ip_name,
      platform: data.platform,
      social_platform: platform === 'social' ? (data.social_platform || 'instagram') : '',
      video_type: data.video_type,
      release_date: data.release_date,
      link: platform === 'social' ? (data.link || '') : '',
      pod_member_ids: serializePodMemberIds(data.pod_member_ids),
      writer_slack_id: '',
      editor_slack_id: '',
      designer_slack_id: '',
      sound_slack_id: '',
      created_by: body.user.id,
      status: 'scheduled',
      open_trigger: '',
      channel_id: '',
      thread_ts: '',
      created_at: nowISO(),
      opened_at: '',
      completed_at: '',
      reminder_count: '0',
      creator_notified_at: '',
    };

    await createRetro(retro);

    try {
      await client.chat.postMessage({
        channel: body.user.id,
        ...buildRetroScheduledConfirmation(retro),
      });
      dmSent = true;
    } catch (dmError) {
      logError('schedule retro DM', dmError);
      const meta = JSON.parse(view.private_metadata || '{}');
      if (meta.channel_id) {
        await client.chat.postEphemeral({
          channel: meta.channel_id,
          user: body.user.id,
          text: `Retro scheduled for *${retro.video_name}*. Open *Messages → Retro Master* to get the *Open Retro Now* button.`,
        });
      }
    }

    await ack({
      response_action: 'update',
      view: buildRetroScheduledSuccessView(retro, { dmSent }),
    });

    logInfo('Retro scheduled', { retro_id: retro.retro_id, platform, dmSent });
  } catch (error) {
    logError('create retro submission', error);
    await ack({
      response_action: 'errors',
      errors: { video_name_block: `Could not save retro: ${error.message}` },
    });
  }
}

function registerHandlers(app) {
  app.command('/retro', async ({ ack, body, client }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildPlatformPickerModal({
          channelId: body.channel_id,
          userId: body.user_id,
        }),
      });
    } catch (error) {
      logError('/retro command', error);
    }
  });

  app.view(PLATFORM_PICK_CALLBACK, async ({ ack, body, view }) => {
    const platform = view.state.values.platform_block.platform.selected_option?.value;
    if (!platform) {
      await ack({
        response_action: 'errors',
        errors: { platform_block: 'Select a platform' },
      });
      return;
    }

    const meta = JSON.parse(view.private_metadata || '{}');
    const nextView = platform === 'social'
      ? buildCreateSocialRetroModal(meta)
      : buildCreateYoutubeRetroModal(meta);

    await ack({ response_action: 'push', view: nextView });
  });

  app.view(CREATE_YOUTUBE_RETRO_CALLBACK, async (args) => {
    await scheduleRetroFromSubmission({ ...args, platform: 'youtube' });
  });

  app.view(CREATE_SOCIAL_RETRO_CALLBACK, async (args) => {
    await scheduleRetroFromSubmission({ ...args, platform: 'social' });
  });

  app.action(SOCIAL_PLATFORM_PICK_ACTION, async ({ ack, body, client }) => {
    await ack();
    const view = body.view;
    if (!view) return;

    const meta = JSON.parse(view.private_metadata || '{}');
    const selected = body.actions?.[0]?.selected_option?.value || 'instagram';

    try {
      await client.views.update({
        view_id: view.id,
        hash: view.hash,
        view: buildCreateSocialRetroModal({
          channelId: meta.channel_id,
          userId: meta.user_id,
          socialPlatform: selected,
          viewState: view.state?.values || {},
        }),
      });
    } catch (error) {
      logError('social_platform_pick', error);
    }
  });

  app.action('open_retro_now', async ({ ack, body, client, action }) => {
    await ack();

    const payload = parseActionValue(action.value);
    if (!payload?.retro_id) return;

    try {
      const retro = await getRetroById(payload.retro_id);
      if (!retro) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'This retro no longer exists.',
        });
        return;
      }

      if (body.user.id !== retro.created_by) {
        await client.chat.postEphemeral({
          channel: body.channel?.id || body.user.id,
          user: body.user.id,
          text: 'Only the producer who created this retro can open it early.',
        });
        return;
      }

      if (retro.status !== 'scheduled') {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `This retro is already *${retro.status}*.`,
        });
        return;
      }

      await openRetro(client, retro, 'manual');
      const opened = await getRetroById(retro.retro_id);

      await client.chat.postMessage({
        channel: body.user.id,
        ...buildRetroOpenedConfirmation(opened || retro),
      });

      logInfo('Retro opened manually', { retro_id: retro.retro_id });
    } catch (error) {
      logError('open_retro_now', error);
    }
  });

  app.action('fill_retro_open', async ({ ack, body, client, action }) => {
    await ack();

    const payload = parseActionValue(action.value);
    if (!payload?.retro_id || !payload?.role) {
      logError('fill_retro_open', new Error('Invalid action payload'));
      return;
    }

    try {
      const retro = await getRetroById(payload.retro_id);
      if (!retro) {
        await client.chat.postEphemeral({
          channel: body.channel?.id || body.user.id,
          user: body.user.id,
          text: 'This retro no longer exists.',
        });
        return;
      }

      const slot = getPodMemberSlots(retro).find((s) => s.role === payload.role);
      if (!slot || body.user.id !== slot.userId) {
        await client.chat.postEphemeral({
          channel: body.channel?.id || body.user.id,
          user: body.user.id,
          text: 'You are not assigned as a POD member for this retro.',
        });
        return;
      }

      const existing = await getResponseByRole(payload.retro_id, payload.role);
      if (existing) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `You have already submitted your retro for *${retro.video_name}*.`,
        });
        return;
      }

      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildFillRetroModal({
          retroId: payload.retro_id,
          role: payload.role,
          userSlackId: body.user.id,
          videoName: retro.video_name,
          channelId: payload.channel_id || retro.channel_id,
          threadTs: normalizeSlackTs(payload.thread_ts || retro.thread_ts),
          platform: isSocialRetro(retro) ? 'social' : 'youtube',
          contentType: retro.video_type,
          socialPlatform: getSocialPlatform(retro),
        }),
      });
    } catch (error) {
      logError('fill_retro_open', error);
    }
  });

  async function handleFillSubmit({ ack, body, view, client, platform }) {
    const data = parseFillRetroSubmission(view);

    if (platform === 'social') {
      const errors = validateSocialFillSubmission(view);
      if (Object.keys(errors).length > 0) {
        await ack({ response_action: 'errors', errors });
        return;
      }
    } else if (!data.good || !data.bad || !data.action_items) {
      const errors = {};
      if (!data.good) errors.good_block = 'Please describe what was good';
      if (!data.bad) errors.bad_block = 'Please describe what was bad';
      if (!data.action_items) errors.action_items_block = 'Please add action items';
      await ack({ response_action: 'errors', errors });
      return;
    }

    await ack();

    try {
      const retro = await getRetroById(data.retro_id);
      if (!retro) {
        logError('fill retro submit', new Error(`Retro not found: ${data.retro_id}`));
        return;
      }

      const existing = await getResponseByRole(data.retro_id, data.role);
      if (existing) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'Your retro was already submitted.',
        });
        return;
      }

      const response = {
        response_id: generateId('resp'),
        retro_id: data.retro_id,
        role: data.role,
        user_slack_id: data.user_slack_id,
        good: data.good,
        bad: data.bad,
        action_items: data.action_items,
        analytics_json: data.analytics_json || '',
        submitted_at: nowISO(),
      };

      await createResponse(response);

      const channelId = data.channel_id || retro.channel_id;
      const threadTs = normalizeSlackTs(data.thread_ts || retro.thread_ts);

      if (channelId && threadTs && threadTs.includes('.')) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          reply_broadcast: false,
          ...buildResponseThreadMessage(data.role, response, retro),
        });

        const allResponses = await getResponsesForRetro(data.retro_id);
        const memberCount = getPodMemberSlots(retro).length;

        if (allResponses.length === memberCount) {
          await completeRetro(client, { ...retro, channel_id: channelId, thread_ts: threadTs }, allResponses);
        }
      } else {
        logError('fill retro submission', new Error(`Missing valid thread_ts for retro ${data.retro_id}`));
      }

      await client.chat.postMessage({
        channel: body.user.id,
        text: `Thanks! Your retro for *${retro.video_name}* has been submitted.`,
      });

      logInfo('Retro response submitted', {
        retro_id: data.retro_id,
        role: data.role,
        platform,
      });
    } catch (error) {
      logError('fill retro submission', error);
    }
  }

  app.view(FILL_YOUTUBE_RETRO_CALLBACK, async (args) => {
    await handleFillSubmit({ ...args, platform: 'youtube' });
  });

  app.view(FILL_SOCIAL_RETRO_CALLBACK, async (args) => {
    await handleFillSubmit({ ...args, platform: 'social' });
  });

  app.error((error) => {
    logError('slack app error', error);
  });
}

async function updateParentMessage(client, retro, { complete = false } = {}) {
  const threadTs = normalizeSlackTs(retro.thread_ts);
  if (!retro.channel_id || !threadTs) return;

  try {
    const text = complete
      ? `Retro complete: ${retro.video_name}`
      : `Retro opened: ${retro.video_name}`;

    await client.chat.update({
      channel: retro.channel_id,
      ts: threadTs,
      text,
      blocks: buildRetroOpenedBlocks(retro, { complete }),
    });
  } catch (error) {
    logError('updateParentMessage', error);
  }
}

async function completeRetro(client, retro, responses) {
  try {
    await updateRetro(retro.retro_id, {
      status: 'complete',
      completed_at: nowISO(),
    });

    await updateParentMessage(client, retro, { complete: true });

    await client.chat.postMessage({
      channel: retro.channel_id,
      thread_ts: normalizeSlackTs(retro.thread_ts),
      reply_broadcast: false,
      ...buildRetroCompleteMessage(retro, responses),
    });

    logInfo('Retro completed', { retro_id: retro.retro_id });
  } catch (error) {
    logError('completeRetro', error);
  }
}

async function openRetro(client, retro, openTrigger = 'scheduled') {
  const channelId = getRetroChannelId(retro);

  const message = buildRetroOpenedMessage(retro);
  const postResult = await client.chat.postMessage({
    channel: channelId,
    ...message,
  });

  const updatedRetro = await updateRetro(retro.retro_id, {
    status: 'open',
    open_trigger: openTrigger,
    channel_id: channelId,
    thread_ts: normalizeSlackTs(postResult.ts),
    opened_at: nowISO(),
    reminder_count: '0',
    creator_notified_at: '',
  });

  for (const slot of getPodMemberSlots(updatedRetro)) {
    try {
      await client.chat.postMessage({
        channel: slot.userId,
        ...buildFillRetroDmMessage(updatedRetro, slot.role),
      });
    } catch (error) {
      logError(`DM POD member ${slot.userId} for ${retro.retro_id}`, error);
    }
  }

  logInfo('Retro opened', { retro_id: retro.retro_id, thread_ts: postResult.ts });
  return updatedRetro;
}

async function backfillOpenRetroParentMessages(client) {
  const { getOpenRetros } = require('./sheets');
  const retros = await getOpenRetros();
  let updated = 0;

  for (const retro of retros) {
    if (!retro.channel_id || !retro.thread_ts) continue;
    await updateParentMessage(client, retro, { complete: false });
    updated += 1;
  }

  if (updated > 0) {
    logInfo(`Updated parent messages with assignees for ${updated} open retro(s)`);
  }
}

function createOpenRetroHandler(app) {
  return (retro, openTrigger = 'scheduled') => openRetro(app.client, retro, openTrigger);
}

module.exports = {
  createSlackApp,
  createOpenRetroHandler,
  openRetro,
  backfillOpenRetroParentMessages,
};
