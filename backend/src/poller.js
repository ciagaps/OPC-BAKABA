// Faz o polling: consulta a fonte (mock ou JD) e grava data/snapshot.json.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { isAuthorized } from './jdAuth.js';
import { resolveOrgId, listAllFields, fieldOperationsForField, harvestMeasurement, seedingMeasurement, mapLimit } from './jdClient.js';
import { buildMockSnapshot, buildSnapshotFromJD } from './mapper.js';

const snapshotPath = join(config.stateDir, 'snapshot.json');
let lastStatus = { ok: false, at: null, fonte: null, erro: null, progresso: null };

function saveSnapshot(snap) {
  if (!existsSync(config.stateDir)) mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));
}

async function pollReal() {
  const orgId = config.orgId || await resolveOrgId();

  console.log('[poll] buscando talhões...');
  const fields = await listAllFields(orgId);
  console.log(`[poll] ${fields.length} talhões. Buscando operações (concorrência 6)...`);

  // operações por talhão
  const perField = await mapLimit(fields, 6, async (f) => {
    const ops = await fieldOperationsForField(orgId, f.id).catch(() => []);
    return { field: f, ops: Array.isArray(ops) ? ops : [] };
  });

  // medições das colheitas (anexadas em op._measurement)
  const harvests = [];
  for (const pf of perField)
    for (const op of pf.ops)
      if (op.fieldOperationType === 'harvest') harvests.push(op);
  console.log(`[poll] ${harvests.length} colheitas. Buscando medições...`);
  await mapLimit(harvests, 6, async (op) => {
    op._measurement = await harvestMeasurement(op).catch(() => null);
  });

  // medições dos PLANTIOS → área plantada (para % colhido / falta colher reais).
  // Só onde há colheita da mesma cultura/ano (evita buscar plantio de culturas não colhidas).
  const anoOp = op => { const d = op.endDate || op.startDate; return d ? d.slice(0, 4) : null; };
  const colhidoYC = new Set();
  for (const pf of perField)
    for (const op of pf.ops)
      if (op.fieldOperationType === 'harvest' && op.cropName && anoOp(op)) colhidoYC.add(anoOp(op) + '|' + op.cropName);
  const seedings = [];
  for (const pf of perField)
    for (const op of pf.ops)
      if (op.fieldOperationType === 'seeding' && op.cropName && colhidoYC.has(anoOp(op) + '|' + op.cropName)) seedings.push(op);
  console.log(`[poll] ${seedings.length} plantios (culturas colhidas). Buscando área plantada...`);
  await mapLimit(seedings, 6, async (op) => {
    op._measurement = await seedingMeasurement(op).catch(() => null);
  });

  console.log('[poll] montando snapshot...');
  return buildSnapshotFromJD(perField, orgId);
}

export async function pollOnce() {
  try {
    let snap;
    if (config.mock) {
      snap = buildMockSnapshot();
    } else if (!isAuthorized()) {
      throw new Error('Ainda sem autorização OAuth. Abra http://localhost:' + config.port + '/oauth/start');
    } else {
      snap = await pollReal();
    }
    saveSnapshot(snap);
    lastStatus = { ok: true, at: new Date().toISOString(), fonte: snap.fonte, erro: null };
    const nOps = (snap.operacoes || []).length, nCult = (snap.culturas || []).length;
    console.log(`[poll] ok · fonte=${snap.fonte} · operações=${nOps} · culturas=${nCult} · ${new Date().toLocaleTimeString('pt-BR')}`);
  } catch (e) {
    lastStatus = { ok: false, at: new Date().toISOString(), fonte: null, erro: e.message };
    console.error('[poll] erro:', e.message);
  }
  return lastStatus;
}

export function getLastStatus() { return lastStatus; }

export function startPolling() {
  pollOnce(); // primeira coleta imediata
  const ms = Math.max(1, config.pollMinutos) * 60 * 1000;
  setInterval(pollOnce, ms);
  console.log(`[poll] agendado a cada ${config.pollMinutos} min`);
}
