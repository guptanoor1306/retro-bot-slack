const { WebClient } = require('@slack/web-api');
const { normalizeSlackTs, logError } = require('../utils');
const { getRetroById } = require('../sheets');
const { buildInsightsThreadMessage } = require('../messages');

const { cleanAnalysisOutput } = require('./format');

async function publishInsightsToThread({ retroId, analysis }) {
  const retro = await getRetroById(retroId);
  if (!retro) throw new Error('Retro not found');

  const channelId = retro.channel_id || process.env.RETRO_CHANNEL_ID;
  const threadTs = normalizeSlackTs(retro.thread_ts);

  if (!channelId || !threadTs || !threadTs.includes('.')) {
    throw new Error('Retro has no Slack thread — open the retro first');
  }

  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  const message = buildInsightsThreadMessage({
    ipName: retro.ip_name,
    videoType: retro.video_type,
    platform: retro.platform || 'youtube',
    analysis: cleanAnalysisOutput(analysis),
  });

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    reply_broadcast: false,
    ...message,
  });

  return { channel_id: channelId, thread_ts: threadTs };
}

module.exports = { publishInsightsToThread };
