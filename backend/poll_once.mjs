// Executa UMA coleta e sai (entry-point para o agendador do GitHub Actions).
// Fluxo do CI:  node poll_once.mjs  &&  node build_static.mjs
// Requer as mesmas variáveis de ambiente da nuvem (MOCK=false, JD_CLIENT_ID/SECRET,
// JD_ORG_ID, JD_REFRESH_TOKEN, STATE_DIR). Grava snapshot.json em STATE_DIR.
import { pollOnce } from './src/poller.js';

const st = await pollOnce();
if (!st.ok) {
  console.error('[poll_once] FALHOU:', st.erro);
  process.exit(1);
}
console.log('[poll_once] ok · fonte=' + st.fonte + ' · ' + st.at);
process.exit(0);
