require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const { initSheets } = require('./src/sheets');
const { createSlackApp, createOpenRetroHandler } = require('./src/slackApp');
const { startScheduler, startReminderScheduler } = require('./src/scheduler');
const { logError, logInfo } = require('./src/utils');

async function main() {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SHEET_ID',
    'RETRO_CHANNEL_ID',
  ];

  const useSocketMode = process.env.USE_SOCKET_MODE !== 'false';
  if (useSocketMode) required.push('SLACK_APP_TOKEN');

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  await initSheets();

  const app = createSlackApp();
  const openRetro = createOpenRetroHandler(app);

  startScheduler(openRetro);
  startReminderScheduler(app.client);

  const port = process.env.PORT || 3000;

  if (useSocketMode) {
    await app.start();
    logInfo('Retro Bot running in Socket Mode');
  } else {
    await app.start(port);
    logInfo(`Retro Bot running on port ${port}`);
  }
}

main().catch((error) => {
  logError('startup', error);
  process.exit(1);
});
