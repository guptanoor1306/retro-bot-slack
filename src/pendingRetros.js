const { getOpenRetros, getAllResponses } = require('./sheets');
const { computePendingPodSlots } = require('./reminders');
const { getRetroPlatform, isSocialRetro } = require('./utils');

async function loadPendingRetrosByPlatform() {
  const [openRetros, allResponses] = await Promise.all([
    getOpenRetros(),
    getAllResponses(),
  ]);

  const responsesByRetroId = new Map();
  for (const response of allResponses) {
    if (!responsesByRetroId.has(response.retro_id)) {
      responsesByRetroId.set(response.retro_id, []);
    }
    responsesByRetroId.get(response.retro_id).push(response);
  }

  const sorted = openRetros.sort((a, b) => {
    const plat = getRetroPlatform(a).localeCompare(getRetroPlatform(b));
    if (plat) return plat;
    return (a.opened_at || a.release_date || '').localeCompare(b.opened_at || b.release_date || '');
  });

  const youtube = [];
  const social = [];

  for (const retro of sorted) {
    const responses = responsesByRetroId.get(retro.retro_id) || [];
    const pendingSlots = computePendingPodSlots(retro, responses);
    if (pendingSlots.length === 0) continue;

    const entry = { retro, pendingSlots };
    if (isSocialRetro(retro)) social.push(entry);
    else youtube.push(entry);
  }

  return { youtube, social };
}

module.exports = { loadPendingRetrosByPlatform };
