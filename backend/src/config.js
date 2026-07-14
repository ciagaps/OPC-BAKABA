// Lê variáveis de um arquivo .env (sem dependência externa) e do process.env.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const envPath = join(rootDir, '.env');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const txt = readFileSync(path, 'utf8');
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // remove aspas envolventes, se houver
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(envPath);

const port = Number(process.env.PORT || 3000);
// URL pública do serviço (usada nos redirects OAuth). Local = localhost; na nuvem defina PUBLIC_URL.
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');
// Diretório de ESTADO MUTÁVEL (tokens.json + snapshot.json). Na nuvem aponte para um volume
// persistente (ex.: STATE_DIR=/data) para não perder a autorização a cada restart/deploy.
// Os arquivos ESTÁTICOS (geo, fechamentos, machine_names, logo) continuam em dataDir (repo).
const stateDir = process.env.STATE_DIR || join(rootDir, 'data');

export const config = {
  rootDir,
  dataDir: join(rootDir, 'data'),
  stateDir,
  dashboardDir: join(rootDir, '..', 'dashboard'),
  publicUrl,

  clientId: process.env.JD_CLIENT_ID || '',
  clientSecret: process.env.JD_CLIENT_SECRET || '',
  redirectUri: process.env.JD_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
  scopes: process.env.JD_SCOPES || 'ag1 ag2 ag3 eq1 eq2 org1 org2 offline_access',
  orgId: process.env.JD_ORG_ID || '',

  mock: String(process.env.MOCK || 'true').toLowerCase() === 'true',
  pollMinutos: Number(process.env.POLL_MINUTOS || 10),
  port,

  // Documento de metadados OAuth da John Deere (well-known).
  // Dele extraímos authorization_endpoint e token_endpoint automaticamente.
  jdWellKnown: 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/.well-known/oauth-authorization-server',
  // Base das Precision Tech APIs.
  jdApiBase: 'https://partnerapi.deere.com/platform',
};
