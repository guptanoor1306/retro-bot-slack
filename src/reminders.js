const {
  ROLES,
  ROLE_SLACK_ID_FIELDS,
  REMINDER_INTERVAL_HOURS,
  MAX_REMINDER_ROUNDS,
  CREATOR_ESCALATION_HOURS,
  nowISO,
  normalizeSlackTs,
  logInfo,
  logError,
} = require('./utils');
const { getOpenRetros, getResponsesForRetro, updateRetro } = require('./sheets');
const { buildFillRetroDmMessage, buildCreatorEscalationMessage } = require('./messages');

const MS_PER_HOUR = 60 * 60 * 1000;

async function getPendingRoles(retro) {
  const responses = await getResponsesForRetro(retro.retro_id);
  const submitted = new Set(responses.map((r) => r.role));
  return ROLES.filter((role) => !submitted.has(role));
}

async function sendReminderDms(client, retro, pendingRoles, round) {
  for (const role of pendingRoles) {
    const userId = retro[ROLE_SLACK_ID_FIELDS[role]];
    if (!userId) continue;
    try {
      await client.chat.postMessage({
        channel: userId,
        ...buildFillRetroDmMessage(retro, role, { reminderRound: round }),
      });
    } catch (error) {
      logError(`reminder DM ${userId} (${retro.retro_id})`, error);
    }
  }
}

async function notifyCreator(client, retro, pendingRoles) {
  const channelId = retro.channel_id;
  const threadTs = normalizeSlackTs(retro.thread_ts);
  if (!channelId || !threadTs || !retro.created_by) return;

  try {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      reply_broadcast: false,
      ...buildCreatorEscalationMessage(retro, pendingRoles),
    });
    logInfo(`Creator notified for overdue retro ${retro.retro_id}`);
  } catch (error) {
    logError(`creator escalation (${retro.retro_id})`, error);
  }
}

async function processRetroReminders(client) {
  const retros = await getOpenRetros();

  for (const retro of retros) {
    if (!retro.opened_at) continue;

    try {
      const pendingRoles = await getPendingRoles(retro);
      if (pendingRoles.length === 0) continue;

      const openedAt = new Date(retro.opened_at).getTime();
      const elapsedHours = (Date.now() - openedAt) / MS_PER_HOUR;
      const reminderCount = parseInt(retro.reminder_count || '0', 10) || 0;
      const nextRound = reminderCount + 1;

      if (
        nextRound <= MAX_REMINDER_ROUNDS
        && elapsedHours >= nextRound * REMINDER_INTERVAL_HOURS
      ) {
        await sendReminderDms(client, retro, pendingRoles, nextRound);
        await updateRetro(retro.retro_id, { reminder_count: String(nextRound) });
        logInfo(`Reminder round ${nextRound}/${MAX_REMINDER_ROUNDS} sent`, {
          retro_id: retro.retro_id,
          pending: pendingRoles.length,
        });
      }

      if (
        elapsedHours >= CREATOR_ESCALATION_HOURS
        && !retro.creator_notified_at
        && pendingRoles.length > 0
      ) {
        await notifyCreator(client, retro, pendingRoles);
        await updateRetro(retro.retro_id, { creator_notified_at: nowISO() });
      }
    } catch (error) {
      logError(`processRetroReminders(${retro.retro_id})`, error);
    }
  }
}

module.exports = { processRetroReminders };
