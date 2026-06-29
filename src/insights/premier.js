const { logError, logInfo } = require('../utils');
const { getBaseUrl, getPremierToken, invalidateToken } = require('./premierAuth');

async function premierFetch(path, { retry = true } = {}) {
  const token = await getPremierToken();
  const url = path.startsWith('http') ? path : `${getBaseUrl()}${path}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && retry) {
    invalidateToken();
    const freshToken = await getPremierToken({ forceRefresh: true });
    const retryRes = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${freshToken}` },
    });
    if (!retryRes.ok) {
      throw new Error(`Premier API ${retryRes.status}: ${await retryRes.text()}`);
    }
    return retryRes.json();
  }

  if (!res.ok) {
    throw new Error(`Premier API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

/** List ended Premier sessions (paginated). */
async function listEndedPremiers({ search = '', page = 1, limit = 50 } = {}) {
  if (!process.env.PREMIER_API_URL) {
    return { items: [], note: 'Premier API not configured' };
  }

  const params = new URLSearchParams({
    status: 'ended',
    search,
    page: String(page),
    limit: String(limit),
  });

  const data = await premierFetch(`/admin/premiers?${params}`);
  const items = (data.items || data.data || []).filter(
    (item) => String(item.status).toLowerCase() === 'ended',
  );

  return {
    items: items.map((item) => ({
      id: item.id,
      teamName: item.teamName,
      topicName: item.topicName,
      status: item.status,
      createdAt: item.createdAt,
      participantCount: item.participantCount,
    })),
    total: data.total,
    page,
    limit,
  };
}

/** Fetch all ended premiers across pages (cap at maxPages). */
async function listAllEndedPremiers({ search = '', maxPages = 20 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await listEndedPremiers({ search, page, limit: 50 });
    if (!batch.items.length) break;
    all.push(...batch.items);
    if (batch.items.length < batch.limit) break;
  }
  return all;
}

/** Feedback markers for a session. */
async function fetchSessionMarkers(sessionId) {
  const data = await premierFetch(`/sessions/${sessionId}/markers/by-timestamp`);
  if (Array.isArray(data)) return data;
  return data.items || data.markers || data.data || [];
}

/**
 * Fetch Premier feedback for mapped session IDs.
 * sessionIds = Premier item.id e.g. 6a3bbb7aab7ee65306e2e432
 */
async function fetchPremierFeedback({ sessionIds = [] }) {
  if (!process.env.PREMIER_API_URL) {
    return { sessions: [], note: 'Premier API not configured' };
  }

  if (!sessionIds.length) {
    return { sessions: [], note: 'No Premier sessions selected' };
  }

  const sessions = [];
  for (const sessionId of sessionIds) {
    try {
      const markers = await fetchSessionMarkers(sessionId);
      sessions.push({
        sessionId,
        markers: markers.map(normalizeMarker),
      });
    } catch (error) {
      logError(`fetchSessionMarkers(${sessionId})`, error);
      sessions.push({ sessionId, markers: [], error: error.message });
    }
  }

  logInfo('Premier feedback fetched', { sessions: sessions.length });
  return { sessions };
}

function normalizeMarker(m) {
  return {
    id: m._id || m.id,
    feedback: m.feedback || '',
    type: m.type,
    timestamp: m.timestamp,
    aiTags: m.aiTags || [],
    isStarred: m.isStarred,
    reviewer: m.userId?.name || m.userId?.email || 'Unknown',
    createdAt: m.createdAt,
  };
}

function formatPremierForPrompt(premierData) {
  const sessions = premierData?.sessions || premierData?.videos || [];
  if (!sessions.length) {
    return premierData?.note || 'No Premier feedback available.';
  }

  return sessions.map((session) => {
    const markers = session.markers || [];
    if (!markers.length) {
      return `*Session ${session.sessionId || session.id}:* no markers`;
    }

    const lines = markers.map((m) => {
      const tags = m.aiTags?.length ? ` [${m.aiTags.join(', ')}]` : '';
      const ts = m.timestamp != null ? `@${m.timestamp}s` : '';
      return `• ${ts} *${m.type || 'note'}* (${m.reviewer}): ${m.feedback}${tags}`;
    });

    const title = session.topicName || session.teamName || session.sessionId || session.id;
    return `*Premier session: ${title}*\n${lines.join('\n')}`;
  }).join('\n\n');
}

module.exports = {
  listEndedPremiers,
  listAllEndedPremiers,
  fetchSessionMarkers,
  fetchPremierFeedback,
  formatPremierForPrompt,
};
