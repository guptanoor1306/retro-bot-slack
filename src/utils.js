const { v4: uuidv4 } = require('uuid');

const MIN_POD_MEMBERS = 4;
const MAX_POD_MEMBERS = 10;
const SOCIAL_MIN_POD_MEMBERS = 1;
const SOCIAL_MAX_POD_MEMBERS = 8;

const PLATFORMS = {
  youtube: 'YouTube',
  social: 'Social',
};

const SOCIAL_TYPES = {
  reel: 'Reel',
  carousel: 'Carousel',
  story: 'Story',
  post: 'Post',
};

const SOCIAL_ANALYTICS_BY_TYPE = {
  reel: [
    { key: 'skip_rate', label: 'Skip Rate' },
    { key: 'share_rate', label: 'Share Rate' },
    { key: 'like_rate', label: 'Like Rate' },
  ],
  carousel: [
    { key: 'skip_rate', label: 'Skip Rate' },
    { key: 'share_rate', label: 'Share Rate' },
    { key: 'like_rate', label: 'Like Rate' },
  ],
  post: [
    { key: 'skip_rate', label: 'Skip Rate' },
    { key: 'share_rate', label: 'Share Rate' },
    { key: 'like_rate', label: 'Like Rate' },
  ],
  story: [
    { key: 'swipe_away_rate', label: 'Swipe Away Rate' },
    { key: 'completion_rate', label: 'Completion Rate' },
  ],
};

const SOCIAL_MAX_COMPARE = 4;
const DEFAULT_SOCIAL_ANALYTICS_WEIGHT = 0.4;

const LEGACY_ROLES = ['writer', 'editor', 'designer', 'sound_designer'];

const LEGACY_ROLE_LABELS = {
  writer: 'Writer',
  editor: 'Editor',
  designer: 'Designer',
  sound_designer: 'Sound Designer',
};

const LEGACY_ROLE_SLACK_ID_FIELDS = {
  writer: 'writer_slack_id',
  editor: 'editor_slack_id',
  designer: 'designer_slack_id',
  sound_designer: 'sound_slack_id',
};

function podMemberRoleKey(index) {
  return `pod_member_${index}`;
}

function podMemberLabel(index) {
  return `POD Member ${index}`;
}

function usesLegacyMemberModel(retro) {
  if (!retro.pod_member_ids) return true;
  try {
    const ids = JSON.parse(retro.pod_member_ids);
    return !Array.isArray(ids) || ids.length === 0;
  } catch {
    return true;
  }
}

function parsePodMemberIds(retro) {
  if (!usesLegacyMemberModel(retro)) {
    return JSON.parse(retro.pod_member_ids).filter(Boolean);
  }

  return LEGACY_ROLES
    .map((role) => retro[LEGACY_ROLE_SLACK_ID_FIELDS[role]])
    .filter(Boolean);
}

function getPodMemberSlots(retro) {
  if (usesLegacyMemberModel(retro)) {
    return LEGACY_ROLES.map((role, index) => {
      const userId = retro[LEGACY_ROLE_SLACK_ID_FIELDS[role]];
      if (!userId) return null;
      return {
        role,
        index: index + 1,
        userId,
        label: LEGACY_ROLE_LABELS[role],
      };
    }).filter(Boolean);
  }

  return parsePodMemberIds(retro).map((userId, index) => ({
    role: podMemberRoleKey(index + 1),
    index: index + 1,
    userId,
    label: podMemberLabel(index + 1),
  }));
}

function serializePodMemberIds(ids) {
  return JSON.stringify(ids);
}

function formatMemberLabel(role) {
  const match = /^pod_member_(\d+)$/.exec(role);
  if (match) return podMemberLabel(parseInt(match[1], 10));
  return LEGACY_ROLE_LABELS[role] || role;
}

function getMemberRoleForUser(retro, userSlackId) {
  const slot = getPodMemberSlots(retro).find((s) => s.userId === userSlackId);
  return slot?.role || null;
}

/** @deprecated use getMemberRoleForUser */
function getRoleForUser(retro, userSlackId) {
  return getMemberRoleForUser(retro, userSlackId);
}

const VIDEO_TYPES = {
  long_form: 'Long-form',
  shorts_reels: 'Shorts/Reels',
  podcast: 'Podcast',
};

const REMINDER_INTERVAL_HOURS = 12;
const MAX_REMINDER_ROUNDS = 5;
const CREATOR_ESCALATION_HOURS = 60;

function addDaysIST(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Retro opens 10 AM IST the day after release (videos release ~6 PM). */
function retroOpenDate(releaseDate) {
  return addDaysIST(releaseDate, 1);
}

function getRetroPlatform(retro) {
  return retro.platform || 'youtube';
}

function isSocialRetro(retro) {
  return getRetroPlatform(retro) === 'social';
}

function getPodMemberLimits(platform) {
  if (platform === 'social') {
    return { min: SOCIAL_MIN_POD_MEMBERS, max: SOCIAL_MAX_POD_MEMBERS };
  }
  return { min: MIN_POD_MEMBERS, max: MAX_POD_MEMBERS };
}

function getSocialAnalyticsFields(contentType) {
  return SOCIAL_ANALYTICS_BY_TYPE[contentType] || [];
}

function formatContentType(type, platform = 'youtube') {
  if (platform === 'social') return SOCIAL_TYPES[type] || type || '';
  return VIDEO_TYPES[type] || type || '';
}

function formatRetroTypeLabel(retro) {
  return formatContentType(retro.video_type, getRetroPlatform(retro));
}

function formatVideoType(type) {
  return VIDEO_TYPES[type] || type || '';
}

function formatPlatformLabel(platform) {
  return PLATFORMS[platform] || platform || 'YouTube';
}

function parseAnalyticsJson(raw) {
  if (!raw) return {};
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function serializeAnalyticsJson(data) {
  return JSON.stringify(data || {});
}

function generateId(prefix) {
  return `${prefix}_${uuidv4().slice(0, 8)}`;
}

function todayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function nowISO() {
  return new Date().toISOString();
}

function logError(context, error) {
  const message = error?.message || String(error);
  const stack = error?.stack ? `\n${error.stack}` : '';
  console.error(`[ERROR] ${context}: ${message}${stack}`);
}

function logInfo(message, data) {
  if (data !== undefined) {
    console.log(`[INFO] ${message}`, data);
  } else {
    console.log(`[INFO] ${message}`);
  }
}

function parseActionValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Slack ts must keep the decimal segment — Sheets strips it if stored as a number. */
function normalizeSlackTs(ts) {
  if (ts == null || ts === '') return '';
  let s = String(ts).trim();
  if (s.startsWith("'")) s = s.slice(1);
  return s;
}

function getRetroChannelIdForPlatform(platform) {
  if (platform === 'social') {
    const socialChannel = process.env.RETRO_SOCIAL_CHANNEL_ID?.trim();
    if (socialChannel) return socialChannel;
  }
  const channelId = process.env.RETRO_CHANNEL_ID?.trim();
  if (!channelId) throw new Error('RETRO_CHANNEL_ID is not set');
  return channelId;
}

function getRetroChannelId(retro) {
  return getRetroChannelIdForPlatform(getRetroPlatform(retro));
}

function formatThreadTsForSheet(ts) {
  if (!ts) return '';
  return String(ts);
}

module.exports = {
  MIN_POD_MEMBERS,
  MAX_POD_MEMBERS,
  SOCIAL_MIN_POD_MEMBERS,
  SOCIAL_MAX_POD_MEMBERS,
  PLATFORMS,
  SOCIAL_TYPES,
  SOCIAL_ANALYTICS_BY_TYPE,
  SOCIAL_MAX_COMPARE,
  DEFAULT_SOCIAL_ANALYTICS_WEIGHT,
  LEGACY_ROLES,
  LEGACY_ROLE_LABELS,
  VIDEO_TYPES,
  REMINDER_INTERVAL_HOURS,
  MAX_REMINDER_ROUNDS,
  CREATOR_ESCALATION_HOURS,
  getRetroPlatform,
  isSocialRetro,
  getRetroChannelId,
  getRetroChannelIdForPlatform,
  getPodMemberLimits,
  getSocialAnalyticsFields,
  formatContentType,
  formatRetroTypeLabel,
  formatPlatformLabel,
  parseAnalyticsJson,
  serializeAnalyticsJson,
  podMemberRoleKey,
  podMemberLabel,
  parsePodMemberIds,
  getPodMemberSlots,
  serializePodMemberIds,
  formatMemberLabel,
  getMemberRoleForUser,
  generateId,
  todayIST,
  addDaysIST,
  retroOpenDate,
  formatVideoType,
  nowISO,
  logError,
  logInfo,
  getRoleForUser,
  parseActionValue,
  normalizeSlackTs,
  formatThreadTsForSheet,
};
