// OAuth 2.0 com a John Deere: gera URL de login, troca "code" por token e renova o token.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const tokensPath = join(config.stateDir, 'tokens.json');
let cachedMeta = null; // metadados OAuth (endpoints) da John Deere

async function getMeta() {
  if (cachedMeta) return cachedMeta;
  const res = await fetch(config.jdWellKnown);
  if (!res.ok) throw new Error(`Falha ao buscar metadados OAuth da JD: ${res.status}`);
  cachedMeta = await res.json();
  return cachedMeta;
}

function saveTokens(tok) {
  if (!existsSync(config.stateDir)) mkdirSync(config.stateDir, { recursive: true });
  // guarda também quando expira (epoch ms) para sabermos quando renovar
  const withExpiry = {
    ...tok,
    obtained_at: Date.now(),
    expires_at: Date.now() + (Number(tok.expires_in || 3600) - 60) * 1000,
  };
  writeFileSync(tokensPath, JSON.stringify(withExpiry, null, 2));
  return withExpiry;
}

export function loadTokens() {
  if (existsSync(tokensPath)) {
    try { return JSON.parse(readFileSync(tokensPath, 'utf8')); }
    catch { /* cai para o seed de env abaixo */ }
  }
  // Bootstrap na nuvem: se não há arquivo de tokens mas foi fornecido um refresh_token
  // por variável de ambiente, usa-o. O primeiro refresh grava tokens.json no STATE_DIR.
  const seed = process.env.JD_REFRESH_TOKEN;
  if (seed) return { refresh_token: seed.trim() };
  return null;
}

export function isAuthorized() {
  return !!loadTokens()?.refresh_token;
}

// URL para o usuário autorizar o app (abrir no navegador).
export async function buildAuthUrl(state) {
  const meta = await getMeta();
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
  });
  return `${meta.authorization_endpoint}?${p.toString()}`;
}

function basicAuthHeader() {
  const raw = `${config.clientId}:${config.clientSecret}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

// Troca o "code" (recebido no callback) por access_token + refresh_token.
export async function exchangeCode(code) {
  const meta = await getMeta();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`Troca de code falhou: ${res.status} ${await res.text()}`);
  return saveTokens(await res.json());
}

async function refresh(refreshToken) {
  const meta = await getMeta();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`Refresh do token falhou: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  // a JD nem sempre devolve novo refresh_token; preserva o antigo se faltar
  if (!tok.refresh_token) tok.refresh_token = refreshToken;
  return saveTokens(tok);
}

// Retorna um access_token válido, renovando automaticamente se necessário.
export async function getValidAccessToken() {
  let tok = loadTokens();
  if (!tok?.refresh_token) throw new Error('Sem autorização. Abra /oauth/start no navegador.');
  if (!tok.access_token || Date.now() >= (tok.expires_at || 0)) {
    tok = await refresh(tok.refresh_token);
  }
  return tok.access_token;
}
