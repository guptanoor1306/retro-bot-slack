const cron = require('node-cron');
const { todayIST, logInfo, logError } = require('./utils');
const { getRetrosDueForAutoOpen } = require('./sheets');
const { processRetroReminders } = require('./reminders');

function startScheduler(openRetroFn) {
  cron.schedule(
    '0 10 * * *',
    async () => {
      const date = todayIST();
      logInfo(`Scheduler running — auto-open due for ${date}`);

      try {
        const retros = await getRetrosDueForAutoOpen(date);
        logInfo(`Found ${retros.length} retro(s) to auto-open`);

        let opened = 0;
        let failed = 0;
        for (const retro of retros) {
          try {
            await openRetroFn(retro, 'scheduled');
            opened += 1;
            await new Promise((r) => setTimeout(r, 1200));
          } catch (error) {
            failed += 1;
            logError(`openRetro(${retro.retro_id})`, error);
          }
        }
        if (retros.length > 0) {
          logInfo(`Auto-open finished for ${date}`, { total: retros.length, opened, failed });
        }
      } catch (error) {
        logError('scheduler', error);
      }
    },
    { timezone: 'Asia/Kolkata' },
  );

  logInfo('Scheduler started — auto-opens retros at 10:00 AM IST the day after release');
}

function startReminderScheduler(client) {
  cron.schedule('0 * * * *', async () => {
    logInfo('Reminder scheduler running');
    try {
      await processRetroReminders(client);
    } catch (error) {
      logError('reminder scheduler', error);
    }
  });

  logInfo('Reminder scheduler started — checks hourly for 12h DM reminders and 60h creator escalation');
}

module.exports = { startScheduler, startReminderScheduler };
