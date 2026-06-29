const cron = require('node-cron');
const { todayIST, logInfo, logError } = require('./utils');
const { getRetrosDueForAutoOpen } = require('./sheets');

function startScheduler(openRetroFn) {
  cron.schedule(
    '0 10 * * *',
    async () => {
      const date = todayIST();
      logInfo(`Scheduler running — auto-open due for ${date}`);

      try {
        const retros = await getRetrosDueForAutoOpen(date);
        logInfo(`Found ${retros.length} retro(s) to auto-open`);

        for (const retro of retros) {
          try {
            await openRetroFn(retro, 'scheduled');
          } catch (error) {
            logError(`openRetro(${retro.retro_id})`, error);
          }
        }
      } catch (error) {
        logError('scheduler', error);
      }
    },
    { timezone: 'Asia/Kolkata' },
  );

  logInfo('Scheduler started — auto-opens retros at 10:00 AM IST the day after release');
}

module.exports = { startScheduler };
