// Chamadas às Precision Tech APIs do Operations Center (John Deere).
// HAL/JSON: listas em "values", navegação por "links" (rel/uri). Paginação via itemLimit + nextPage.
import { getValidAccessToken } from './jdAuth.js';
import { config } from './config.js';

async function jdGet(pathOrUrl, { accept = 'application/vnd.deere.axiom.v3+json' } = {}) {
  const token = await getValidAccessToken();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${config.jdApiBase}${pathOrUrl}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': accept } });
  if (res.status === 401) throw new Error('Token rejeitado (401). Reautorize em /oauth/start.');
  if (res.status === 403) {
    throw new Error(`Acesso negado (403). A organização pode precisar conectar o app (/oauth/connect). Detalhe: ${await res.text()}`);
  }
  if (res.status === 429) throw new Error('Rate limit (429). Aguarde.');
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// Segue os links "nextPage" acumulando todos os "values".
async function getAllPages(pathOrUrl, { max = 5000 } = {}) {
  let url = pathOrUrl;
  if (!/itemLimit=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'itemLimit=100';
  const all = [];
  let guard = 0;
  while (url && all.length < max && guard < 200) {
    guard++;
    const data = await jdGet(url);
    for (const v of (data.values || [])) all.push(v);
    const next = (data.links || []).find(l => l.rel === 'nextPage');
    url = next ? next.uri : null;
  }
  return all;
}

// Executa fn sobre items com no máximo `limit` chamadas simultâneas.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { _erro: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return out;
}

// Organizações às quais o usuário deu acesso.
export async function listOrganizations() {
  const data = await jdGet('/organizations');
  return data?.values || [];
}

export async function resolveOrgId() {
  if (config.orgId) return config.orgId;
  const orgs = await listOrganizations();
  if (!orgs.length) throw new Error('Nenhuma organização retornada pela API.');
  console.log(`[jd] Usando org ${orgs[0].name} (${orgs[0].id}). Fixe JD_ORG_ID no .env.`);
  return orgs[0].id;
}

// Todos os talhões (fields) da organização.
export async function listAllFields(orgId) {
  return getAllPages(`/organizations/${orgId}/fields`);
}

// Todas as operações de campo de um talhão (seeding/application/harvest/tillage, todas as safras).
export async function fieldOperationsForField(orgId, fieldId) {
  return getAllPages(`/organizations/${orgId}/fields/${fieldId}/fieldOperations`);
}

// Medições de uma operação de colheita: retorna o "HarvestYieldResult" (área, wetMass, umidade, variedades…).
export async function harvestMeasurement(op) {
  const link = (op.links || []).find(l => l.rel === 'measurementTypes');
  if (!link) return null;
  const data = await jdGet(link.uri).catch(() => null);
  if (!data) return null;
  return (data.values || []).find(v => v.measurementName === 'HarvestYieldResult') || null;
}

export { jdGet, getAllPages };
