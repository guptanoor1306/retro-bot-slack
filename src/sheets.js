const { google } = require('googleapis');
const { logError, logInfo, normalizeSlackTs, formatThreadTsForSheet, retroOpenDate, todayIST } = require('./utils');

const RETROS_TAB = 'Retros';
const RESPONSES_TAB = 'Responses';
const MAPPINGS_TAB = 'PremierMappings';

const RETROS_HEADERS = [
  'retro_id', 'video_name', 'ip_name', 'platform', 'social_platform', 'video_type', 'release_date',
  'writer_slack_id', 'editor_slack_id', 'designer_slack_id', 'sound_slack_id',
  'pod_member_ids',
  'created_by', 'status', 'open_trigger', 'channel_id', 'thread_ts',
  'created_at', 'opened_at', 'completed_at', 'reminder_count', 'creator_notified_at',
];

const RESPONSES_HEADERS = [
  'response_id', 'retro_id', 'role', 'user_slack_id',
  'good', 'bad', 'action_items', 'analytics_json', 'submitted_at',
];

const MAPPINGS_HEADERS = [
  'mapping_id', 'retro_id', 'premier_video_ids', 'created_at',
];

let sheetsClient = null;

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheets() {
  if (!sheetsClient) {
    const auth = getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

function getSheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID is not set');
  return id;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, i) => {
    const value = row[i] ?? '';
    obj[header] = header === 'thread_ts' ? normalizeSlackTs(value) : value;
  });
  return obj;
}

function objectToRow(headers, obj) {
  return headers.map((header) => {
    const value = obj[header] ?? '';
    return header === 'thread_ts' ? formatThreadTsForSheet(value) : value;
  });
}

async function getTabHeaders(tab, defaultHeaders) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${tab}!1:1`,
  });
  const existing = res.data.values?.[0];
  return existing?.length ? existing : defaultHeaders;
}

async function readTab(tabName, defaultHeaders) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const range = `${tabName}!A:Z`;

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.data.values || [];

  if (rows.length === 0) return [];

  const dataHeaders = rows[0];
  return rows.slice(1).map((row) => rowToObject(dataHeaders.length ? dataHeaders : defaultHeaders, row));
}

async function appendRow(tabName, headers, values) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });

  logInfo(`Appended row to ${tabName}`, { firstCol: values[0] });
}

async function withSheetsRetry(fn, { maxAttempts = 6, baseDelayMs = 10000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error.message || '';
      const isQuota = msg.includes('Quota exceeded') || error.code === 429;
      if (!isQuota || attempt === maxAttempts) throw error;
      const delay = baseDelayMs * attempt;
      logInfo(`Sheets API quota hit, retrying in ${delay / 1000}s (${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function ensureTabExists(tabName, existingTabs, sheets, spreadsheetId) {
  if (existingTabs.has(tabName)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  existingTabs.add(tabName);
  logInfo(`Created sheet tab: ${tabName}`);
}

async function syncTabHeadersFromBatch(tab, requiredHeaders, headerRow, sheets, spreadsheetId) {
  const existing = headerRow || [];

  if (existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [requiredHeaders] },
    });
    logInfo(`Created headers for ${tab}`);
    return requiredHeaders;
  }

  const missing = requiredHeaders.filter((h) => !existing.includes(h));
  if (missing.length === 0) return existing;

  const merged = [...existing, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [merged] },
  });
  logInfo(`Added columns to ${tab}`, missing);
  return merged;
}

async function ensureHeaders() {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const tabConfigs = [
    [RETROS_TAB, RETROS_HEADERS],
    [RESPONSES_TAB, RESPONSES_HEADERS],
    [MAPPINGS_TAB, MAPPINGS_HEADERS],
  ];

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const existingTabs = new Set(meta.data.sheets?.map((s) => s.properties?.title) || []);

  const missingTabs = tabConfigs.filter(([tab]) => !existingTabs.has(tab));
  if (missingTabs.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missingTabs.map(([tab]) => ({
          addSheet: { properties: { title: tab } },
        })),
      },
    });
    missingTabs.forEach(([tab]) => existingTabs.add(tab));
    logInfo(`Created sheet tabs: ${missingTabs.map(([t]) => t).join(', ')}`);
  }

  const batchRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: tabConfigs.map(([tab]) => `${tab}!1:1`),
  });

  for (let i = 0; i < tabConfigs.length; i++) {
    const [tab, headers] = tabConfigs[i];
    const headerRow = batchRes.data.valueRanges?.[i]?.values?.[0];
    await syncTabHeadersFromBatch(tab, headers, headerRow, sheets, spreadsheetId);
  }
}

/** @deprecated use ensureHeaders — kept for any direct callers */
async function ensureTabExistsLegacy(tabName) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const existingTabs = new Set(meta.data.sheets?.map((s) => s.properties?.title) || []);
  await ensureTabExists(tabName, existingTabs, sheets, spreadsheetId);
}

async function syncTabHeaders(tab, requiredHeaders) {
  await ensureTabExistsLegacy(tab);
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!1:1`,
  });
  return syncTabHeadersFromBatch(tab, requiredHeaders, res.data.values?.[0], sheets, spreadsheetId);
}

async function createRetro(retro) {
  const headers = await getTabHeaders(RETROS_TAB, RETROS_HEADERS);
  const values = objectToRow(headers, retro);
  await appendRow(RETROS_TAB, headers, values);
  return retro;
}

async function getRetroById(retroId) {
  const rows = await readTab(RETROS_TAB, RETROS_HEADERS);
  return rows.find((r) => r.retro_id === retroId) || null;
}

async function getAllRetros() {
  return readTab(RETROS_TAB, RETROS_HEADERS);
}

async function getUniqueIpNames({ platform } = {}) {
  const rows = await readTab(RETROS_TAB, RETROS_HEADERS);
  const ips = [...new Set(
    rows
      .filter((r) => {
        if (!r.ip_name) return false;
        if (!platform) return true;
        const rowPlatform = r.platform || 'youtube';
        return rowPlatform === platform;
      })
      .map((r) => r.ip_name),
  )];
  return ips.sort((a, b) => a.localeCompare(b));
}

async function getRetrosByIp(ipName, { videoType, status, platform } = {}) {
  const rows = await readTab(RETROS_TAB, RETROS_HEADERS);
  return rows
    .filter((r) => {
      if (!r.ip_name || r.ip_name.toLowerCase() !== ipName.toLowerCase()) return false;
      if (videoType && r.video_type !== videoType) return false;
      if (status && r.status !== status) return false;
      if (platform) {
        const rowPlatform = r.platform || 'youtube';
        if (rowPlatform !== platform) return false;
      }
      return true;
    })
    .sort((a, b) => (b.completed_at || b.release_date).localeCompare(a.completed_at || a.release_date));
}

async function getOpenRetros() {
  const rows = await readTab(RETROS_TAB, RETROS_HEADERS);
  return rows.filter((r) => r.status === 'open');
}

/** Retros due to auto-open today: release was yesterday, still scheduled. */
async function getRetrosDueForAutoOpen(date = todayIST()) {
  const rows = await readTab(RETROS_TAB, RETROS_HEADERS);
  return rows.filter(
    (r) => r.status === 'scheduled' && retroOpenDate(r.release_date) === date,
  );
}

async function getCompletedRetrosByIpAndType(ipName, videoType) {
  const rows = await readTab(RETROS_TAB, RETROS_HEADERS);
  return rows
    .filter(
      (r) =>
        r.status === 'complete'
        && r.ip_name.toLowerCase() === ipName.toLowerCase()
        && r.video_type === videoType,
    )
    .sort((a, b) => (b.completed_at || b.release_date).localeCompare(a.completed_at || a.release_date));
}

async function updateRetro(retroId, updates) {
  const sheets = await getSheets();
  const spreadsheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RETROS_TAB}!A:Z`,
  });
  const rows = res.data.values || [];
  if (rows.length === 0) throw new Error('Retros sheet is empty');

  const headers = rows[0];
  const retroIdCol = headers.indexOf('retro_id');
  if (retroIdCol === -1) throw new Error('retro_id column not found');

  const rowIndex = rows.findIndex((row, i) => i > 0 && row[retroIdCol] === retroId);
  if (rowIndex === -1) throw new Error(`Retro not found: ${retroId}`);

  const updatedRow = [...rows[rowIndex]];
  while (updatedRow.length < headers.length) updatedRow.push('');

  for (const [key, value] of Object.entries(updates)) {
    const col = headers.indexOf(key);
    if (col !== -1) {
      updatedRow[col] = key === 'thread_ts' ? formatThreadTsForSheet(value) : value;
    }
  }

  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${RETROS_TAB}!A${sheetRow}:Z${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [updatedRow] },
  });

  logInfo(`Updated retro ${retroId}`, updates);
  return rowToObject(headers, updatedRow);
}

async function createResponse(response) {
  const headers = await getTabHeaders(RESPONSES_TAB, RESPONSES_HEADERS);
  const values = objectToRow(headers, response);
  await appendRow(RESPONSES_TAB, headers, values);
  return response;
}

async function getResponsesForRetro(retroId) {
  const rows = await readTab(RESPONSES_TAB, RESPONSES_HEADERS);
  return rows.filter((r) => r.retro_id === retroId);
}

async function getResponseByRole(retroId, role) {
  const responses = await getResponsesForRetro(retroId);
  return responses.find((r) => r.role === role) || null;
}

async function savePremierMapping({ mapping_id, retro_id, premier_video_ids, created_at }) {
  const headers = await getTabHeaders(MAPPINGS_TAB, MAPPINGS_HEADERS);
  const values = objectToRow(headers, { mapping_id, retro_id, premier_video_ids, created_at });
  await appendRow(MAPPINGS_TAB, headers, values);
  return { mapping_id, retro_id, premier_video_ids };
}

async function getPremierMappingForRetro(retroId) {
  const rows = await readTab(MAPPINGS_TAB, MAPPINGS_HEADERS);
  return rows.filter((r) => r.retro_id === retroId).pop() || null;
}

async function initSheets() {
  try {
    await withSheetsRetry(() => ensureHeaders());
    logInfo('Google Sheets initialized');
  } catch (error) {
    logError('initSheets', error);
    throw error;
  }
}

module.exports = {
  RETROS_HEADERS,
  RESPONSES_HEADERS,
  MAPPINGS_HEADERS,
  initSheets,
  createRetro,
  getRetroById,
  getAllRetros,
  getUniqueIpNames,
  getRetrosByIp,
  getRetrosDueForAutoOpen,
  getOpenRetros,
  getCompletedRetrosByIpAndType,
  updateRetro,
  createResponse,
  getResponsesForRetro,
  getResponseByRole,
  savePremierMapping,
  getPremierMappingForRetro,
};
