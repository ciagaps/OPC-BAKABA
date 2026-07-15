// Converte dados brutos (mock ou API John Deere) no formato do dashboard editorial.
// Modelo espelha o relatório GAPS (milho safrinha) adaptado p/ soja:
//   talhão · variedade · produtividade 2026 · produtividade safra anterior · status · massa · evolução diária
// Geometria dos talhões da Bakaba (reaproveitada do relatório de milho) é servida à parte (/api/geo).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const SACA_KG = 60;
const VARIEDADES = ['BMX Foco IPRO', 'TMG 7062 IPRO', 'Pioneer 96Y90'];

// hash determinístico do nome → gerador pseudo-aleatório estável (mesmo talhão = mesmos números)
function seeded(name, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return (h % 100000) / 100000; // 0..1
}

// lista real de talhões da Bakaba (nome + área), extraída do relatório de milho
function loadTalhoesRef() {
  const p = join(config.dataDir, 'bakaba_talhoes.json');
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch {}
  }
  // fallback mínimo se o arquivo não existir
  return [{ talhao: 'BKB01', ha: 100 }, { talhao: 'BKB02', ha: 120 }, { talhao: 'BKB03', ha: 90 }];
}

// ─── MOCK de soja gerado sobre os talhões reais da Bakaba ───
function buildMockTalhoes() {
  const ref = loadTalhoesRef();
  return ref.map(r => {
    const nome = r.talhao;
    const ha = r.ha || 100;
    const s1 = seeded(nome, 1), s2 = seeded(nome, 2), s3 = seeded(nome, 3), s4 = seeded(nome, 4), s5 = seeded(nome, 5);
    const variedade = VARIEDADES[Math.floor(s1 * VARIEDADES.length)];

    // ~52% finalizado, ~16% andamento, ~32% pendente → progresso realista de meia-safra
    const status = s2 < 0.52 ? 'Finalizado' : s2 < 0.68 ? 'Andamento' : 'Pendente';

    let produtiv = 0, ha_colhido = 0, massaMolhada = 0, umidade = null, fim = null, inicio = null;
    // produtividade soja plausível: 50..76 sc/ha
    const prodBase = 50 + s3 * 26;
    // safra anterior (24/25) conhecida para (quase) todos os talhões
    const prod25 = Number((prodBase * (0.86 + s4 * 0.30)).toFixed(1));

    const diasIni = ['10/06', '12/06', '15/06', '18/06', '20/06', '22/06', '24/06', '26/06', '28/06', '01/07'];
    const diasFim = ['11/06', '13/06', '16/06', '19/06', '21/06', '23/06', '25/06', '27/06', '29/06', '02/07'];

    if (status === 'Finalizado') {
      produtiv = Number(prodBase.toFixed(1));
      ha_colhido = ha;
      umidade = Number((13 + s5 * 2.4).toFixed(1));
      inicio = diasIni[Math.floor(s3 * diasIni.length)];
      fim = diasFim[Math.floor(s4 * diasFim.length)];
      massaMolhada = Math.round(produtiv * ha_colhido * SACA_KG * 1.06);
    } else if (status === 'Andamento') {
      produtiv = Number(prodBase.toFixed(1));
      ha_colhido = Number((ha * (0.3 + s4 * 0.5)).toFixed(1));
      umidade = Number((13 + s5 * 2.4).toFixed(1));
      inicio = diasIni[Math.floor(s3 * diasIni.length)];
      massaMolhada = Math.round(produtiv * ha_colhido * SACA_KG * 1.06);
    }

    const dif = produtiv > 0 && prod25 > 0 ? Number((produtiv - prod25).toFixed(1)) : 0;
    const plantioPool = ['18/11', '22/11', '26/11', '01/12', '05/12'];

    return {
      talhao: nome,
      farm: r.farm || 'Bakaba',
      variedade,
      ha_talhao: Number(ha.toFixed(1)),
      ha_colhido: Number(ha_colhido.toFixed(1)),
      pct: ha ? Number((ha_colhido / ha).toFixed(3)) : 0,
      produtiv,
      prod25,
      dif,
      umidade,
      massaMolhada,
      status,
      plantio: plantioPool[Math.floor(s1 * plantioPool.length)],
      inicio,
      fim,
    };
  });
}

// evolução diária de área colhida (ha/dia) com linha de meta
function buildMockEvol() {
  const dias = ['15/06','16/06','17/06','18/06','19/06','20/06','21/06','22/06','23/06','24/06','25/06','26/06','27/06','28/06','29/06','30/06','01/07','02/07'];
  return dias.map((d, i) => {
    const s = seeded(d, 7);
    // domingos/paradas viram 0
    const ha = (i % 7 === 5 || i % 7 === 6) ? 0 : Math.round(180 + s * 170);
    return { d, ha, meta: 350 };
  });
}

const MOCK_MAQUINAS = [
  { maq: 'CA02', op: 'CLEOMARQUES',    ini: '09:20', fim: '17:38', ha: 35.43, vel: 7.0, hah: 6.0, status: 'concluido' },
  { maq: 'CA03', op: 'JOHN LENNO',     ini: '08:40', fim: '17:51', ha: 35.63, vel: 6.8, hah: 5.8, status: 'concluido' },
  { maq: 'CA04', op: 'LEANDRO',        ini: '08:35', fim: '17:48', ha: 30.12, vel: 7.3, hah: 6.5, status: 'concluido' },
  { maq: 'CA05', op: 'SIDINEY',        ini: '09:00', fim: null,    ha: 35.94, vel: 7.6, hah: 8.3, status: 'operando' },
  { maq: 'CA07', op: 'RAIMUNDO',       ini: '09:00', fim: null,    ha: 32.81, vel: 7.6, hah: 8.0, status: 'operando' },
  { maq: 'CA08', op: 'RAFAEL',         ini: '10:25', fim: '17:52', ha: 30.00, vel: 6.7, hah: 7.6, status: 'concluido' },
  { maq: 'CA09', op: 'ELIONAN',        ini: '08:30', fim: null,    ha: 39.08, vel: 7.1, hah: 6.1, status: 'operando' },
  { maq: 'CA10', op: 'JOSÉ FRANCISCO', ini: '10:05', fim: '17:39', ha: 19.02, vel: 5.8, hah: 6.2, status: 'concluido' },
  { maq: 'CA20', op: 'WUARDERSON',     ini: '10:00', fim: null,    ha: 32.89, vel: 7.4, hah: 6.7, status: 'operando' },
];

function resumo(talhoes, maquinas) {
  const areaTotal = talhoes.reduce((s, t) => s + (t.ha_talhao || 0), 0);
  const areaColhida = talhoes.reduce((s, t) => s + (t.ha_colhido || 0), 0);
  const colhidos = talhoes.filter(t => t.produtiv > 0 && t.ha_colhido > 0);
  const areaProd = colhidos.reduce((s, t) => s + t.ha_colhido, 0);
  const prodMedia = areaProd ? colhidos.reduce((s, t) => s + t.produtiv * t.ha_colhido, 0) / areaProd : 0;

  const comAnterior = talhoes.filter(t => t.prod25 > 0);
  const areaAnt = comAnterior.reduce((s, t) => s + t.ha_talhao, 0);
  const prodMediaAnterior = areaAnt ? comAnterior.reduce((s, t) => s + t.prod25 * t.ha_talhao, 0) / areaAnt : 0;

  const producaoSacas = colhidos.reduce((s, t) => s + t.produtiv * t.ha_colhido, 0);
  const massaTotalKg = talhoes.reduce((s, t) => s + (t.massaMolhada || 0), 0);
  const melhor = [...colhidos].sort((a, b) => b.produtiv - a.produtiv)[0] || null;

  const haMaq = maquinas.reduce((s, m) => s + (m.ha || 0), 0);
  const hahs = maquinas.map(m => m.hah).filter(Boolean);
  const topMaq = [...maquinas].sort((a, b) => (b.ha || 0) - (a.ha || 0))[0] || null;

  return {
    areaTotal: Number(areaTotal.toFixed(1)),
    areaColhida: Number(areaColhida.toFixed(1)),
    areaRestante: Number((areaTotal - areaColhida).toFixed(1)),
    percentRestante: areaTotal ? Number(((areaTotal - areaColhida) / areaTotal * 100).toFixed(1)) : 0,
    percentColhido: areaTotal ? Number((areaColhida / areaTotal * 100).toFixed(1)) : 0,
    produtividadeMedia: Number(prodMedia.toFixed(1)),
    produtividadeMediaAnterior: Number(prodMediaAnterior.toFixed(1)),
    variacaoSafra: Number((prodMedia - prodMediaAnterior).toFixed(1)),
    producaoTotalSacas: Math.round(producaoSacas),
    massaTotalT: Number((massaTotalKg / 1000).toFixed(1)),
    melhorTalhao: melhor ? { talhao: melhor.talhao, variedade: melhor.variedade, produtiv: melhor.produtiv } : null,
    talhoesTotal: talhoes.length,
    talhoesFinalizados: talhoes.filter(t => t.status === 'Finalizado').length,
    talhoesAndamento: talhoes.filter(t => t.status === 'Andamento').length,
    talhoesPendentes: talhoes.filter(t => t.status === 'Pendente').length,
    variedades: [...new Set(talhoes.map(t => t.variedade))],
    fazendas: [...new Set(talhoes.map(t => t.farm))].filter(f => f && f !== '—'),
    // frota
    maquinasOperando: maquinas.filter(m => m.status === 'operando').length,
    maquinasTotal: maquinas.length,
    haColhidoFrota: Number(haMaq.toFixed(2)),
    topMaquina: topMaq ? { maq: topMaq.maq, op: topMaq.op, ha: topMaq.ha } : null,
  };
}

export function buildMockSnapshot() {
  const talhoes = buildMockTalhoes();
  return {
    geradoEm: new Date().toISOString(),
    fonte: 'MOCK',
    fazenda: 'Fazenda Bakaba',
    safra: 'Soja 25/26',
    safraAnterior: '24/25',
    cultura: 'Soja',
    atualizado: new Date().toLocaleDateString('pt-BR'),
    resumo: resumo(talhoes, MOCK_MAQUINAS),
    talhoes,
    evolucao: buildMockEvol(),
    maquinas: MOCK_MAQUINAS,
  };
}

// ─── Conversão dos dados REAIS da John Deere ───
const CROP_LABELS = { SOYBEANS: 'Soja', CORN: 'Milho', CORN_WET: 'Milho', COTTON: 'Algodão', SORGHUM: 'Sorgo', WHEAT: 'Trigo', BEANS: 'Feijão', DRY_BEANS: 'Feijão', MUNG_BEAN: 'Feijão Mungo', SESAME: 'Gergelim', RICE: 'Arroz', MILLET: 'Milheto' };
const OP_LABELS = { seeding: 'Plantio', application: 'Aplicação', harvest: 'Colheita', tillage: 'Preparo de solo' };
const SCALE_BY_CROP = { CORN_WET: 150, CORN: 150, SOYBEANS: 110, SORGHUM: 60, MUNG_BEAN: 60, SESAME: 20 }; // escala do mapa (sc/ha) por cultura
const STD_MOISTURE = 13; // umidade padrão p/ correção de produtividade
const cropLabel = c => CROP_LABELS[c] || (c ? String(c).replace(/_/g, ' ') : '—');
const harvestYear = o => { const d = o.endDate || o.startDate; return d ? d.slice(0, 4) : null; }; // ano pela data da colheita

// nome mesclado do OPC -> componentes do shapefile. "BKB051_052_053_054" -> [BKB051,BKB052,BKB053,BKB054]
function expandFieldName(name) {
  const m = String(name).match(/^([A-Za-z]+)(\d+[A-Za-z]?)((?:_\d+[A-Za-z]?)+)$/);
  if (!m) return [name]; // não mesclado
  const prefix = m[1], first = prefix + m[2];
  const rest = m[3].split('_').filter(Boolean).map(n => prefix + n);
  return [first, ...rest];
}

// mapa VIN -> nome amigável da frota (CA03, etc.), preenchido em data/machine_names.json
function loadMachineNames() {
  const p = join(config.dataDir, 'machine_names.json');
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch {} }
  return {};
}
const maqNome = (names, vin) => names[vin] || (vin ? vin.slice(-6) : '—');

// dados oficiais de fechamento (planilha → JSON). Mapeia dataset ano|cultura → arquivo.
const FECHAMENTOS = { '2026|SOYBEANS': 'fechamento_soja_2026.json', '2025|CORN_WET': 'fechamento_milho_2025.json', '2026|MUNG_BEAN': 'opc_feijao_2026.json' };
function loadFechamento(file) {
  const p = join(config.dataDir, file);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch {} }
  return null;
}
// chave canônica p/ casar nomes independente de ordem/padding/separador:
// "BKB23"/"BKB023"→"BKB|23"; "NSA03/04"/"NSA03_04"→"NSA|3_4"; "01 NSA"→"NSA|1"; "BKB050A"→"BKB|50A"
function canonParts(name) {
  const s = String(name).toUpperCase();
  const pref = (s.match(/BKB|NSA|SGD/) || [''])[0] || (s.match(/^[A-Z]+/) || [''])[0];
  const rest = pref ? s.split(pref).join(' ') : s;
  const nums = (rest.match(/\d+[A-Z]?/g) || []).map(n => {
    const m = n.match(/^(\d+)([A-Z]?)$/); return String(parseInt(m[1], 10)) + (m[2] || '');
  });
  return { pref, nums };
}
function canonicalKey(name) { const { pref, nums } = canonParts(name); return pref + '|' + nums.join('_'); }
function canonicalKeys(name) { // chave completa + cada componente (mesclados)
  const { pref, nums } = canonParts(name);
  const keys = [pref + '|' + nums.join('_')];
  if (nums.length > 1) nums.forEach(n => keys.push(pref + '|' + n));
  return keys;
}

// enriquece um dataset com os dados conferidos do fechamento (produtividade col J, ano anterior col Q, máquinas, evolução)
function enrichFromFechamento(ds, file, fleetOnly = false) {
  if (!ds) return;
  const fz = loadFechamento(file);
  if (!fz || !fz.talhoes) return;
  // fleetOnly (ex.: feijão em andamento): NÃO sobrescreve área/%/talhões (vêm da API ao vivo);
  // apenas acrescenta a frota (operador, l/h, ha/h) e o ranking de operadores da exportação.
  if (!fleetOnly) {
  const byKey = {};
  for (const t of fz.talhoes) for (const k of canonicalKeys(t.talhao)) byKey[k] = t;
  for (const t of ds.talhoes) {
    t.produtivOpc = t.produtiv; // preserva estimativa do sensor OPC
    // casa por chave completa OU por componente (OPC mesclado NSA03_04 ↔ fechamento separado "03 NSA"/"04 NSA")
    const f = canonicalKeys(t.talhao).map(k => byKey[k]).find(Boolean);
    if (f) {
      t._fz = true;                                   // marca: consta no fechamento (plantado com esta cultura)
      t.produtiv = f.produtiv;                        // col J = PRODUTIVIDADE EM SC/HA (principal)
      t.produtivArmazem = f.produtivArmazem;          // col M (referência)
      if (f.prod25 != null && f.prod25 > 0) {         // col Q = ano anterior (real)
        t.prod25 = f.prod25;
        t.dif = (t.produtiv != null) ? Number((t.produtiv - t.prod25).toFixed(1)) : null;
      }
      if (f.variedade) t.variedade = f.variedade;
      if (f.ha_colher != null && f.ha_colher > 0) t.ha_colher = f.ha_colher;
    }
  }
  // só os talhões que constam no fechamento (plantados com a cultura). Remove fantasmas do OPC (ex.: SGD, BKB37 no milho).
  ds.talhoes = ds.talhoes.filter(t => t._fz);
  // adiciona talhões do fechamento que não vieram do OPC (mapeando aos polígonos do shapefile)
  const ref = talhaoRefMap();
  const shpByKey = {};
  for (const nm of Object.keys(ref)) for (const k of canonicalKeys(nm)) (shpByKey[k] = shpByKey[k] || []).push(nm);
  const presentes = new Set(ds.talhoes.map(t => canonicalKey(t.talhao)));
  for (const f of fz.talhoes) {
    if (presentes.has(canonicalKey(f.talhao))) continue;
    const alvos = [...new Set(canonicalKeys(f.talhao).flatMap(k => shpByKey[k] || []))];
    for (const nm of (alvos.length ? alvos : [f.talhao])) {
      if (presentes.has(canonicalKey(nm))) continue;
      ds.talhoes.push({
        talhao: nm, farm: ref[nm]?.farm || '—', variedade: f.variedade || '—',
        ha_talhao: ref[nm]?.ha ?? f.ha_talhao ?? null, ha_colhido: ref[nm]?.ha ?? f.ha_colhido ?? 0, pct: 1,
        produtiv: f.produtiv, prod25: (f.prod25 > 0 ? f.prod25 : null),
        dif: (f.produtiv != null && f.prod25 > 0) ? Number((f.produtiv - f.prod25).toFixed(1)) : null,
        produtivArmazem: f.produtivArmazem, produtivOpc: null, umidade: null, massaMolhada: 0,
        status: 'Finalizado', inicio: f.inicio, fim: f.fim, _fz: true,
      });
      presentes.add(canonicalKey(nm));
    }
  }
  ds.resumo = resumoColheita(ds.talhoes);
  // KPIs de média usam os TOTAIS OFICIAIS da planilha (não a média por talhão do OPC)
  if (fz.oficial) {
    const o = fz.oficial, R = ds.resumo;
    if (o.media != null) R.produtividadeMedia = Number(o.media.toFixed(1));
    if (o.mediaAnterior != null) R.produtividadeMediaAnterior = Number(o.mediaAnterior.toFixed(1));
    if (o.media != null && o.mediaAnterior != null) R.variacaoSafra = Number((o.media - o.mediaAnterior).toFixed(1));
    if (o.producaoSc != null) R.producaoTotalSacas = Math.round(o.producaoSc);
    if (o.area != null) { R.areaColhida = Number(o.area.toFixed(1)); R.areaTotal = Number(o.area.toFixed(1)); R.areaRestante = 0; R.percentColhido = 100; R.percentRestante = 0; }
  }
  ds.fonte = 'FECHAMENTO+OPC';
  } else {
    ds.fonte = 'JOHN_DEERE_OPC'; // feijão: área/progresso ao vivo; só a frota vem da exportação
  }
  if (fz.operadores && fz.operadores.length) ds.operadores = fz.operadores; // ranking de ha por operador (quando a planilha tem)
  // máquinas: a LISTA do fechamento é a oficial (ha/l-h/ha-h reais); enriquece com operador/vin do OPC
  if (fz.maquinas && fz.maquinas.length) {
    const opcByCa = {}; ds.maquinas.forEach(m => { if (m.maq) opcByCa[m.maq] = m; });
    ds.maquinas = fz.maquinas.filter(fm => fm.haTotal).map(fm => {
      const o = opcByCa[fm.ca] || {};
      const op = fm.operador || o.op || '—'; // operador da planilha quando houver (soja); senão o do OPC (milho)
      return { maq: fm.ca, vin: o.vin || null, op, operadores: fm.operador ? [fm.operador] : (o.operadores || []), ops: o.ops ?? null,
        ha: Number(fm.haTotal.toFixed(1)), lh: fm.lh, haHr: fm.haHr, haOpc: o.ha ?? null, status: 'concluido' };
    }).sort((a, b) => (b.ha || 0) - (a.ha || 0));
  }
  // evolução diária real (com meta) — só no modo fechamento; no fleetOnly mantém a evolução ao vivo
  if (!fleetOnly && fz.evolucao && fz.evolucao.length) {
    ds.evolucao = fz.evolucao.map(e => ({ d: e.data.slice(8, 10) + '/' + e.data.slice(5, 7), ha: e.ha, meta: e.meta }));
  }
}

// nome do talhão -> { farm, ha } (do shapefile)
function talhaoRefMap() {
  const m = {};
  for (const t of loadTalhoesRef()) m[t.talhao] = { farm: t.farm || 'Bakaba', ha: t.ha ?? null };
  return m;
}

// medições de uma colheita (op._measurement = HarvestYieldResult)
function harvestValues(op) {
  const m = op._measurement;
  const g = o => (o && typeof o.value === 'number') ? o.value : null;
  const area = g(m?.area), wetT = g(m?.wetMass), moist = g(m?.averageMoisture);
  let produtiv = null;
  if (area && wetT) {
    const scWet = (wetT * 1000) / SACA_KG / area;                     // sacas/ha na umidade colhida
    produtiv = moist ? scWet * (100 - moist) / (100 - STD_MOISTURE) : scWet; // corrige p/ 13%
  }
  return {
    area: area != null ? Number(area.toFixed(1)) : null,
    produtiv: produtiv != null ? Number(produtiv.toFixed(1)) : null,
    umidade: moist ? Number(moist.toFixed(1)) : null,
    massaMolhada: wetT ? Math.round(wetT * 1000) : 0,
    variedades: (m?.varietyTotals || []).map(v => normVar(v.name)).filter(Boolean),
  };
}

// área plantada de uma operação de plantio (op._measurement = medição de plantio com `area`)
const seedingArea = op => { const a = op?._measurement?.area; return (a && typeof a.value === 'number') ? a.value : 0; };

// normaliza nome de variedade (maiúsculas, espaços) p/ reduzir duplicados (Olimpo/OLIMPO)
function normVar(n) {
  if (!n || n === '---') return null;
  return String(n).trim().replace(/\s+/g, ' ').toUpperCase();
}

function opMachines(op) {
  return (op.fieldOperationMachines || []).map(fm => ({
    vin: fm.vin || null,
    operadores: (fm.operators || []).map(o => o.name).filter(Boolean),
  }));
}

function resumoColheita(talhoes) {
  const areaTotal = talhoes.reduce((s, t) => s + (t.ha_talhao || 0), 0);
  const areaColhida = talhoes.reduce((s, t) => s + (t.ha_colhido || 0), 0);
  const comProd = talhoes.filter(t => t.produtiv > 0 && t.ha_colhido > 0);
  const areaProd = comProd.reduce((s, t) => s + t.ha_colhido, 0);
  const prodMedia = areaProd ? comProd.reduce((s, t) => s + t.produtiv * t.ha_colhido, 0) / areaProd : 0;
  const producaoSacas = comProd.reduce((s, t) => s + t.produtiv * t.ha_colhido, 0);
  const massaKg = talhoes.reduce((s, t) => s + (t.massaMolhada || 0), 0);
  const melhor = [...comProd].sort((a, b) => b.produtiv - a.produtiv)[0] || null;
  // safra anterior (produtividade do mesmo talhão no ano anterior)
  const comAnt = talhoes.filter(t => t.prod25 > 0 && t.ha_colhido > 0);
  const areaAnt = comAnt.reduce((s, t) => s + t.ha_colhido, 0);
  const prodMediaAnt = areaAnt ? comAnt.reduce((s, t) => s + t.prod25 * t.ha_colhido, 0) / areaAnt : null;
  return {
    areaTotal: Number(areaTotal.toFixed(1)),
    areaColhida: Number(areaColhida.toFixed(1)),
    areaRestante: Number(Math.max(0, areaTotal - areaColhida).toFixed(1)),
    percentColhido: areaTotal ? Number(Math.min(100, areaColhida / areaTotal * 100).toFixed(1)) : 0,
    percentRestante: areaTotal ? Number(Math.max(0, (areaTotal - areaColhida) / areaTotal * 100).toFixed(1)) : 0,
    produtividadeMedia: Number(prodMedia.toFixed(1)),
    produtividadeMediaAnterior: prodMediaAnt != null ? Number(prodMediaAnt.toFixed(1)) : null,
    variacaoSafra: prodMediaAnt != null ? Number((prodMedia - prodMediaAnt).toFixed(1)) : null,
    producaoTotalSacas: Math.round(producaoSacas),
    massaTotalT: Number((massaKg / 1000).toFixed(1)),
    melhorTalhao: melhor ? { talhao: melhor.talhao, variedade: melhor.variedade, produtiv: melhor.produtiv } : null,
    talhoesTotal: talhoes.length,
    talhoesFinalizados: talhoes.filter(t => t.status === 'Finalizado').length,
    talhoesAndamento: talhoes.filter(t => t.status === 'Andamento').length,
    talhoesPendentes: talhoes.filter(t => t.status === 'Pendente').length,
    variedades: [...new Set(talhoes.map(t => t.variedade).filter(v => v && v !== '—'))],
    fazendas: [...new Set(talhoes.map(t => t.farm))].filter(f => f && f !== '—'),
  };
}

function machineList(maqMap, crop) {
  const names = loadMachineNames();
  return Object.values(maqMap)
    .filter(m => !crop || m.culturas.has(cropLabel(crop)))
    .map(m => ({
      maq: maqNome(names, m.vin), vin: m.vin,
      op: [...m.operadores][0] || '—', operadores: [...m.operadores],
      ops: m.ops, ha: Number(m.area.toFixed(1)), status: 'concluido',
    }))
    .sort((a, b) => b.ha - a.ha);
}

export function buildSnapshotFromJD(perField, orgId) {
  const ref = talhaoRefMap();
  const operacoes = [];
  const cropSet = new Set();
  const maqMap = {}; // vin -> agregado

  for (const { field, ops } of perField) {
    const nome = field.name;
    const farm = ref[nome]?.farm || 'Bakaba';
    for (const op of ops) {
      const tipo = op.fieldOperationType;
      const hv = tipo === 'harvest' ? harvestValues(op) : null;
      const maqs = opMachines(op);
      const operadores = [...new Set(maqs.flatMap(m => m.operadores))];
      const ini = op.startDate ? op.startDate.slice(0, 10) : null;
      const fim = op.endDate ? op.endDate.slice(0, 10) : null;
      operacoes.push({
        talhao: nome, farm, tipo, tipoLabel: OP_LABELS[tipo] || tipo,
        cropName: op.cropName || null, cropLabel: op.cropName ? cropLabel(op.cropName) : null,
        cropSeason: op.cropSeason || null,
        anoData: (fim || ini) ? (fim || ini).slice(0, 4) : null,
        ini, fim,
        area: hv ? hv.area : null, produtiv: hv ? hv.produtiv : null,
        variedades: hv ? hv.variedades : [], operadores,
      });
      if (tipo === 'harvest' && op.cropName) cropSet.add(op.cropName);
      const nMaq = maqs.filter(m => m.vin).length || 1; // área do talhão dividida entre as máquinas que colheram
      for (const m of maqs) {
        if (!m.vin) continue;
        (maqMap[m.vin] = maqMap[m.vin] || { vin: m.vin, operadores: new Set(), ops: 0, area: 0, culturas: new Set() });
        m.operadores.forEach(o => maqMap[m.vin].operadores.add(o));
        maqMap[m.vin].ops++;
        if (hv?.area) maqMap[m.vin].area += hv.area / nMaq;
        if (op.cropName) maqMap[m.vin].culturas.add(cropLabel(op.cropName));
      }
    }
  }

  // índice de produtividade por talhão/cultura/ano (p/ comparativo ano-a-ano)
  const prodIdx = {};
  for (const { field, ops } of perField)
    for (const o of ops)
      if (o.fieldOperationType === 'harvest' && o.cropName) {
        const yr = harvestYear(o); if (!yr) continue;
        const hv = harvestValues(o); if (hv.produtiv == null) continue;
        const fi = prodIdx[field.name] || (prodIdx[field.name] = {});
        const ci = fi[o.cropName] || (fi[o.cropName] = {});
        if (!ci[yr] || (hv.area || 0) > ci[yr]._area) ci[yr] = { v: hv.produtiv, _area: hv.area || 0 };
      }
  const prodAno = (field, crop, yr) => prodIdx[field]?.[crop]?.[String(yr)]?.v ?? null;

  // pares ano|cultura com colheita
  const yearCropSet = new Set();
  for (const { ops } of perField)
    for (const o of ops)
      if (o.fieldOperationType === 'harvest' && o.cropName) {
        const yr = harvestYear(o); if (yr) yearCropSet.add(yr + '|' + o.cropName);
      }

  const datasets = {};
  const anosMap = {}; // ano -> [culturas]
  for (const yc of yearCropSet) {
    const [yr, crop] = yc.split('|');
    const anterior = String(Number(yr) - 1);
    const talhoes = perField.flatMap(({ field, ops }) => {
      const nome = field.name;
      const hOps = ops.filter(o => o.fieldOperationType === 'harvest' && o.cropName === crop && harvestYear(o) === yr);
      const sOps = ops.filter(o => o.fieldOperationType === 'seeding' && o.cropName === crop && harvestYear(o) === yr);
      if (!hOps.length && !sOps.length) return []; // talhão fora desta cultura/ano
      let best = null, bestHv = null;
      for (const o of hOps) { const hv = harvestValues(o); if (!best || (hv.area || 0) > (bestHv?.area || 0)) { best = o; bestHv = hv; } }
      const colhido = !!best;
      const produtiv = bestHv?.produtiv ?? null;
      const prod25 = prodAno(nome, crop, anterior);
      const dif = (produtiv != null && prod25 != null) ? Number((produtiv - prod25).toFixed(1)) : null;
      const variedade = bestHv?.variedades[0] || '—';
      const umidade = bestHv?.umidade ?? null;
      const inicio = best?.startDate ? best.startDate.slice(0, 10) : null;
      const fim = best?.endDate ? best.endDate.slice(0, 10) : null;

      // Área PLANTADA medida (soma dos plantios). Quando existe, o total do talhão passa
      // a ser a área plantada e o colhido a área medida da colheita — assim % e "falta colher"
      // ficam reais (crucial p/ culturas em andamento, ex.: feijão). Sem plantio medido,
      // mantém o comportamento antigo (área do shapefile, colhido = tudo ou nada).
      const plantedField = sOps.reduce((s, o) => s + seedingArea(o), 0);
      const harvestField = bestHv?.area ?? 0;
      const usePlanted = plantedField > 0;
      const status = usePlanted
        ? (harvestField <= 0 ? 'Pendente' : (best?.endDate ? 'Finalizado' : 'Andamento'))
        : (colhido ? (best.endDate ? 'Finalizado' : 'Andamento') : 'Pendente');

      // campo mesclado no OPC (BKB051_052_053_054) → espalha nos polígonos componentes do shapefile
      let comps;
      if (ref[nome]) comps = [nome];
      else { const ex = expandFieldName(nome).filter(c => ref[c]); comps = ex.length ? ex : [nome]; }
      const somaHa = comps.reduce((s, c) => s + (ref[c]?.ha || 0), 0) || 1;
      const massaTot = bestHv?.massaMolhada ?? 0;
      const mesclado = comps.length > 1 ? nome : null;

      return comps.map(c => {
        const frac = mesclado ? ((ref[c]?.ha || 0) / somaHa) : 1; // fração do componente (por área do shapefile)
        const shpHa = ref[c]?.ha ?? (comps.length === 1 ? (bestHv?.area ?? null) : null);
        let ha_talhao, ha_colhido, pct;
        if (usePlanted) {
          ha_talhao = Number((plantedField * frac).toFixed(1));
          ha_colhido = Number((harvestField * frac).toFixed(1));
          pct = ha_talhao ? Number(Math.min(1, ha_colhido / ha_talhao).toFixed(3)) : 0;
        } else {
          ha_talhao = shpHa != null ? Number(shpHa.toFixed(1)) : null;
          ha_colhido = colhido ? (shpHa ?? 0) : 0;
          pct = colhido ? 1 : 0;
        }
        return {
          talhao: c, farm: ref[c]?.farm || 'Bakaba',
          variedade,
          ha_talhao, ha_colhido, pct,
          produtiv, prod25, dif, umidade,
          massaMolhada: mesclado ? Math.round(massaTot * frac) : massaTot,
          status, inicio, fim, mesclado,
        };
      });
    });

    const evolMap = {};
    for (const { ops } of perField)
      for (const o of ops)
        if (o.fieldOperationType === 'harvest' && o.cropName === crop && harvestYear(o) === yr && o.endDate) {
          const d = o.endDate.slice(0, 10);
          evolMap[d] = (evolMap[d] || 0) + (harvestValues(o).area || 0);
        }
    const evolucao = Object.keys(evolMap).sort().map(d => ({ d: d.slice(8, 10) + '/' + d.slice(5, 7), ha: Number(evolMap[d].toFixed(1)), meta: null }));

    datasets[yc] = { resumo: resumoColheita(talhoes), talhoes, evolucao, maquinas: machineListYC(perField, crop, yr), safraAnterior: anterior, scaleMax: SCALE_BY_CROP[crop] || 110 };
    if (FECHAMENTOS[yc]) enrichFromFechamento(datasets[yc], FECHAMENTOS[yc], yc === '2026|MUNG_BEAN'); // feijão: só frota (área/progresso vêm da API ao vivo)
    (anosMap[yr] = anosMap[yr] || []).push({ key: yc, crop, label: cropLabel(crop), talhoes: talhoes.filter(t => t.status !== 'Pendente').length, area: datasets[yc].resumo.areaColhida });
  }

  const anos = Object.keys(anosMap).sort((a, b) => b.localeCompare(a))
    .map(ano => ({ ano, culturas: anosMap[ano].sort((a, b) => b.area - a.area) }));

  return {
    geradoEm: new Date().toISOString(),
    fonte: 'JOHN_DEERE_OPC',
    fazenda: 'Fazenda Bakaba', orgId,
    atualizado: new Date().toLocaleDateString('pt-BR'),
    anos, datasets, operacoes,
    maquinas: machineList(maqMap, null),
  };
}

// máquinas que colheram uma cultura num ano específico
function machineListYC(perField, crop, yr) {
  const names = loadMachineNames();
  const mm = {};
  for (const { ops } of perField)
    for (const o of ops) {
      if (o.fieldOperationType !== 'harvest' || o.cropName !== crop || harvestYear(o) !== yr) continue;
      const hv = harvestValues(o);
      const maqsVin = (o.fieldOperationMachines || []).filter(fm => fm.vin);
      const nMaq = maqsVin.length || 1; // área do talhão dividida entre as colheitadeiras
      for (const fm of maqsVin) {
        const e = mm[fm.vin] || (mm[fm.vin] = { vin: fm.vin, operadores: new Set(), ops: 0, area: 0 });
        (fm.operators || []).forEach(op => op.name && e.operadores.add(op.name));
        e.ops++; if (hv.area) e.area += hv.area / nMaq;
      }
    }
  return Object.values(mm).map(m => ({
    maq: maqNome(names, m.vin), vin: m.vin, op: [...m.operadores][0] || '—',
    operadores: [...m.operadores], ops: m.ops, ha: Number(m.area.toFixed(1)), status: 'concluido',
  })).sort((a, b) => b.ha - a.ha);
}
