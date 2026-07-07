const { v4: uuidv4 } = require('uuid');

const ROLES = ['writer', 'editor', 'designer', 'sound_designer'];

const ROLE_LABELS = {
  writer: 'Writer',
  editor: 'Editor',
  designer: 'Designer',
  sound_designer: 'Sound Designer',
};

const ROLE_SLACK_ID_FIELDS = {
  writer: 'writer_slack_id',
  editor: 'editor_slack_id',
  designer: 'designer_slack_id',
  sound_designer: 'sound_slack_id',
};

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

function formatVideoType(type) {
  return VIDEO_TYPES[type] || type || '';
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

function getRoleForUser(retro, userSlackId) {
  for (const role of ROLES) {
    const field = ROLE_SLACK_ID_FIELDS[role];
    if (retro[field] === userSlackId) return role;
  }
  return null;
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

function formatThreadTsForSheet(ts) {
  if (!ts) return '';
  return String(ts);
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  ROLE_SLACK_ID_FIELDS,
  VIDEO_TYPES,
  REMINDER_INTERVAL_HOURS,
  MAX_REMINDER_ROUNDS,
  CREATOR_ESCALATION_HOURS,
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
