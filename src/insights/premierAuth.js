const { logError, logInfo } = require('../utils');

const TOKEN_TTL_MS = () => {
  const hours = Number(process.env.PREMIER_TOKEN_TTL_HOURS || 3.5);
  return hours * 60 * 60 * 1000;
};

let tokenCache = { token: null, expiresAt: 0 };

function getBaseUrl() {
  const base = process.env.PREMIER_API_URL?.replace(/\/$/, '');
  if (!base) throw new Error('PREMIER_API_URL is not set');
  return base;
}

function extractToken(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data === 'string') return data;
  return (
    data.token
    || data.accessToken
    || data.access_token
    || data.jwt
    || data.data?.token
    || data.data?.accessToken
    || data.data?.access_token
    || null
  );
}

async function loginForToken() {
  const email = process.env.PREMIER_EMAIL;
  const password = process.env.PREMIER_PASSWORD;
  const loginPath = process.env.PREMIER_LOGIN_PATH || '/auth/admin/login';

  if (!email || !password) {
    throw new Error('Set PREMIER_EMAIL and PREMIER_PASSWORD (or PREMIER_BEARER_TOKEN)');
  }

  const res = await fetch(`${getBaseUrl()}${loginPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Premier login failed (${res.status}): ${text}`);
  }

  const data = JSON.parse(text);
  const token = extractToken(data);
  if (!token) {
    throw new Error('Premier login response did not include a token');
  }

  tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS() };
  logInfo('Premier token refreshed');
  return token;
}

async function getPremierToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  if (process.env.PREMIER_BEARER_TOKEN && !process.env.PREMIER_EMAIL) {
    return process.env.PREMIER_BEARER_TOKEN;
  }

  return loginForToken();
}

function invalidateToken() {
  tokenCache = { token: null, expiresAt: 0 };
}

module.exports = {
  getBaseUrl,
  getPremierToken,
  invalidateToken,
  loginForToken,
};
