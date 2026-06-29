require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { WebClient } = require('@slack/web-api');
const { initSheets, getRetrosDueForAutoOpen } = require('../src/sheets');
const { openRetro } = require('../src/slackApp');
const { todayIST, logInfo, logError } = require('../src/utils');

async function main() {
  const date = process.argv[2] || todayIST();

  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('SLACK_BOT_TOKEN is not set');
    process.exit(1);
  }

  await initSheets();
  const client = new WebClient(process.env.SLACK_BOT_TOKEN);

  logInfo(`Manually running auto-open check for ${date}`);
  const retros = await getRetrosDueForAutoOpen(date);

  if (retros.length === 0) {
    logInfo(`No scheduled retros due for auto-open on ${date}.`);
    return;
  }

  for (const retro of retros) {
    try {
      await openRetro(client, retro, 'scheduled');
      logInfo(`Opened retro: ${retro.video_name} (${retro.retro_id})`);
    } catch (error) {
      logError(`openRetro(${retro.retro_id})`, error);
    }
  }
}

main().catch((error) => {
  logError('open-retros script', error);
  process.exit(1);
});
