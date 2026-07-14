// Gera um relatório HTML AUTOCONTIDO (arquivo único, abre offline, sem servidor)
// a partir do painel ao vivo (dashboard/index.html) + os dados atuais.
//
// Técnica: embute snapshot/geo/machine-names/logo num dicionário D e sobrescreve
// window.fetch para servir esses caminhos /api/* a partir do embed. O Chart.js
// (que no painel vem de CDN) é embutido inline, deixando o arquivo 100% offline.
//
// Uso:  node build_static.mjs [saida.html]
//   sem argumento → grava em ../public/index.html (o que o GitHub Pages publica)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { config } from './src/config.js';

const readIf = (p, fallback = null) => (existsSync(p) ? readFileSync(p, 'utf8') : fallback);
const readJson = (p, fallback) => { const t = readIf(p); return t ? JSON.parse(t) : fallback; };

export function buildStatic(outPath) {
  const dash = join(config.dashboardDir, 'index.html');
  let html = readFileSync(dash, 'utf8');

  // 1) Dados embutidos (mesmos que o painel busca via /api/*)
  const D = {
    '/api/snapshot': readJson(join(config.stateDir, 'snapshot.json'), null),
    '/api/geo': readJson(join(config.dataDir, 'bakaba_geo.json'), null),
    '/api/machine-names': readJson(join(config.dataDir, 'machine_names.json'), {}),
    '/api/logo': (readIf(join(config.dataDir, 'gaps_logo.txt'), '') || '').trim(),
  };
  if (!D['/api/snapshot']) throw new Error('snapshot.json ausente — rode um poll antes de gerar o relatório.');

  // 2) Shim: intercepta os /api/* e devolve o embed; demais URLs caem no fetch real.
  //    Também esconde o botão "Atualizar agora" (sem sentido num arquivo estático).
  const shim = `<script>(function(){
var D=${JSON.stringify(D)};
var of=window.fetch?window.fetch.bind(window):null;
window.fetch=function(u,o){var k=String(u).split("?")[0];
  if(Object.prototype.hasOwnProperty.call(D,k)){var d=D[k];
    return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(d)},text:function(){return Promise.resolve(typeof d==="string"?d:JSON.stringify(d))}});}
  return of?of(u,o):Promise.reject(new Error("offline"));};
})();</script>
<style>#btnRefresh,#ftRefresh{display:none!important}</style>
`;
  html = html.replace('</head>', shim + '</head>');

  // 3) Embute o Chart.js (troca o <script src=CDN> por inline) → arquivo offline.
  const chartPath = join(config.dataDir, 'chart.umd.min.js');
  const chartJs = readIf(chartPath, null);
  if (chartJs) {
    html = html.replace(/<script[^>]*src=["']https?:\/\/[^"']*[Cc]hart[^"']*["'][^>]*>\s*<\/script>/,
      `<script>/* Chart.js embutido */\n${chartJs}\n</script>`);
  }

  // 4) Carimbo de geração (não altera o layout; fica num comentário rastreável)
  const stamp = new Date().toISOString();
  html = html.replace('</body>', `<!-- gerado ${stamp} por build_static.mjs -->\n</body>`);

  const out = isAbsolute(outPath) ? outPath : join(config.rootDir, outPath);
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html), embutidoChart: !!chartJs, snapshotFonte: D['/api/snapshot'].fonte };
}

// Execução direta pela CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build_static.mjs')) {
  const arg = process.argv[2] || join('..', 'public', 'index.html');
  const r = buildStatic(arg);
  console.log(`[build_static] gerado: ${r.out}`);
  console.log(`[build_static] ${(r.bytes/1024/1024).toFixed(2)} MB · Chart embutido: ${r.embutidoChart} · fonte: ${r.snapshotFonte}`);
}
