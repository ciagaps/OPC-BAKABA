// Servidor HTTP puro (sem dependências): serve o dashboard, a API de snapshot
// e o fluxo OAuth de autorização com a John Deere.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { buildAuthUrl, exchangeCode, isAuthorized } from './jdAuth.js';
import { startPolling, pollOnce, getLastStatus } from './poller.js';
import { listOrganizations, jdGet } from './jdClient.js';

const snapshotPath = join(config.stateDir, 'snapshot.json');
const oauthStates = new Set(); // proteção CSRF simples para o fluxo OAuth

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function serveFile(res, filePath) {
  if (!existsSync(filePath)) return send(res, 404, 'Arquivo não encontrado');
  const type = MIME[extname(filePath)] || 'application/octet-stream';
  send(res, 200, readFileSync(filePath), type);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // Dashboard
    if (path === '/' || path === '/index.html') {
      return serveFile(res, join(config.dashboardDir, 'index.html'));
    }

    // Dados que o dashboard consome
    if (path === '/api/snapshot') {
      if (!existsSync(snapshotPath)) {
        return send(res, 503, JSON.stringify({ erro: 'Ainda sem dados. Aguarde o primeiro poll.' }), MIME['.json']);
      }
      return serveFile(res, snapshotPath);
    }

    // Geometria dos talhões da Bakaba (mapa)
    if (path === '/api/geo') {
      const geoPath = join(config.dataDir, 'bakaba_geo.json');
      if (!existsSync(geoPath)) return send(res, 404, JSON.stringify({ erro: 'geometria ausente' }), MIME['.json']);
      return serveFile(res, geoPath);
    }

    // Mapa VIN -> nome de frota (editável em data/machine_names.json, aplica na hora)
    if (path === '/api/machine-names') {
      const p = join(config.dataDir, 'machine_names.json');
      const body = existsSync(p) ? readFileSync(p, 'utf8') : '{}';
      return send(res, 200, body, MIME['.json']);
    }

    // Logo GAPS (data URI em texto)
    if (path === '/api/logo') {
      const logoPath = join(config.dataDir, 'gaps_logo.txt');
      if (!existsSync(logoPath)) return send(res, 404, '');
      return send(res, 200, readFileSync(logoPath, 'utf8').trim(), 'text/plain; charset=utf-8');
    }

    // Diagnóstico dos dados brutos da API John Deere (para ajustar o mapeamento)
    if (path === '/api/debug') {
      if (!isAuthorized()) {
        return send(res, 400, JSON.stringify({ erro: 'Ainda não autorizado. Acesse /oauth/start primeiro.' }), MIME['.json']);
      }
      const out = {};
      try {
        const orgs = await listOrganizations();
        out.organizations = orgs.map(o => ({ id: o.id, name: o.name, type: o.type, member: o.member, links: o.links }));
        const orgId = config.orgId || orgs[0]?.id;
        out.orgIdUsado = orgId;
        if (orgId) {
          out.fields = await jdGet(`/organizations/${orgId}/fields`).catch(e => ({ erro: e.message }));
          out.farms = await jdGet(`/organizations/${orgId}/farms`).catch(e => ({ erro: e.message }));
          out.machines = await jdGet(`/organizations/${orgId}/machines`).catch(e => ({ erro: e.message }));
          out.fieldOperations = await jdGet(`/organizations/${orgId}/fieldOperations`).catch(e => ({ erro: e.message }));
        }
      } catch (e) { out.erro = e.message; }
      return send(res, 200, JSON.stringify(out, null, 2), MIME['.json']);
    }

    // Conexão da organização: leva o usuário à tela "select-organizations" da John Deere
    if (path === '/oauth/connect') {
      const orgs = await listOrganizations();
      let uri = null;
      for (const o of orgs) {
        const l = (o.links || []).find(x => x.rel === 'connections');
        if (l) { uri = l.uri; break; }
      }
      if (!uri) {
        return send(res, 200, '<h2>✅ Nenhuma conexão pendente</h2><p>O app já está conectado às organizações. Volte ao painel.</p>', MIME['.html']);
      }
      const sep = uri.includes('?') ? '&' : '?';
      const target = `${uri}${sep}redirect_uri=${encodeURIComponent(config.publicUrl + '/oauth/connected')}`;
      res.writeHead(302, { Location: target });
      return res.end();
    }
    if (path === '/oauth/connected') {
      await pollOnce();
      return send(res, 200, '<h2>✅ Organização conectada!</h2><p>Pode fechar esta aba. O painel já vai puxar os dados reais.</p>', MIME['.html']);
    }

    // Sonda genérica: GET arbitrário na API JD (ferramenta de exploração local)
    if (path === '/api/probe') {
      if (!isAuthorized()) return send(res, 400, JSON.stringify({ erro: 'não autorizado' }), MIME['.json']);
      const jdPath = url.searchParams.get('path');
      if (!jdPath) return send(res, 400, JSON.stringify({ erro: 'informe ?path=' }), MIME['.json']);
      try {
        const data = await jdGet(jdPath);
        return send(res, 200, JSON.stringify(data, null, 2), MIME['.json']);
      } catch (e) {
        return send(res, 200, JSON.stringify({ erro: e.message }), MIME['.json']);
      }
    }

    // Status do serviço (para diagnóstico)
    if (path === '/api/status') {
      const body = { ...getLastStatus(), mock: config.mock, autorizado: isAuthorized(), pollMinutos: config.pollMinutos };
      return send(res, 200, JSON.stringify(body, null, 2), MIME['.json']);
    }

    // Força uma coleta agora
    if (path === '/api/poll-now') {
      const st = await pollOnce();
      return send(res, 200, JSON.stringify(st), MIME['.json']);
    }

    // Inicia autorização OAuth com a John Deere
    if (path === '/oauth/start') {
      if (!config.clientId) return send(res, 400, 'Configure JD_CLIENT_ID no .env primeiro.');
      const state = randomUUID();
      oauthStates.add(state);
      const authUrl = await buildAuthUrl(state);
      res.writeHead(302, { Location: authUrl });
      return res.end();
    }

    // Callback: a John Deere redireciona pra cá com ?code=...
    if (path === '/oauth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) return send(res, 400, 'Faltou o parâmetro "code".');
      if (!oauthStates.has(state)) return send(res, 400, 'State inválido (possível CSRF).');
      oauthStates.delete(state);
      await exchangeCode(code);
      await pollOnce(); // já coleta com o token novo
      return send(res, 200,
        '<h2>✅ Autorizado com sucesso!</h2><p>Pode fechar esta aba. O dashboard já vai começar a puxar dados reais.</p>',
        MIME['.html']);
    }

    return send(res, 404, 'Rota não encontrada');
  } catch (e) {
    console.error('[server] erro:', e);
    return send(res, 500, 'Erro interno: ' + e.message);
  }
});

server.listen(config.port, () => {
  console.log(`\n🌾 OPC Dashboard — Fazenda Bakaba`);
  console.log(`→ Dashboard:  http://localhost:${config.port}/`);
  console.log(`→ Status:     http://localhost:${config.port}/api/status`);
  console.log(`→ Modo:       ${config.mock ? 'MOCK (dados de exemplo)' : 'REAL (John Deere OPC)'}`);
  if (!config.mock && !isAuthorized()) {
    console.log(`→ ⚠ Autorize:  http://localhost:${config.port}/oauth/start`);
  }
  console.log('');
  startPolling();
});
