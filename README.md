# Dashboard de Colheita AO VIVO — Fazenda Bakaba

Painel web que se atualiza sozinho com os dados da colheita vindos do
**John Deere Operations Center (OPC)**. Feito para a Safra Soja 25/26.

## Como funciona

```
[Colheitadeiras] → JDLink → [Operations Center] → API REST
                                       │  (polling a cada N min)
                                       ▼
                         backend (Node, sem dependências)
                                       │  grava data/snapshot.json
                                       ▼
                         dashboard/index.html  (auto-refresh 60s)
```

- **Backend** (`backend/`): consulta a API da John Deere de tempos em tempos e grava um `snapshot.json`. Também serve o dashboard e cuida do login OAuth.
- **Dashboard** (`dashboard/index.html`): lê `snapshot.json` e desenha o painel, atualizando sozinho.

## Rodar agora (modo exemplo, sem credenciais)

Requer Node 20+ (você tem o 24). Não precisa `npm install`.

```bash
cd backend
node src/server.js
```

Abra **http://localhost:3000/** — o painel aparece com **dados de exemplo** (MOCK),
que espelham o relatório de 02/07/2026. Serve para validar o visual.

## Ligar os dados reais do Operations Center

1. Acesse **developer.deere.com**, faça login com a conta MyJohnDeere da fazenda e crie uma **Application**.
2. No app, cadastre o Redirect URI: `http://localhost:3000/oauth/callback`
   (em produção/nuvem, troque pela URL pública).
3. Copie **Client ID** e **Client Secret** para o arquivo `backend/.env`:
   ```
   JD_CLIENT_ID=...
   JD_CLIENT_SECRET=...
   MOCK=false
   ```
4. Suba o servidor e acesse **http://localhost:3000/oauth/start** — faça login e
   autorize o app a ler os dados da **organização da Fazenda Bakaba**.
5. Pronto: o painel passa a puxar dados reais e a atualizar a cada `POLL_MINUTOS`.

> **Telemetria (posição/status das máquinas):** exige que as colheitadeiras tenham
> **JDLink ativo** e o compartilhamento de dados habilitado na organização.

## Endpoints úteis

| URL | Para quê |
|-----|----------|
| `/` | O dashboard |
| `/api/snapshot` | JSON atual (o que o painel consome) |
| `/api/status` | Diagnóstico: modo, autorização, último poll |
| `/api/poll-now` | Força uma coleta imediata |
| `/oauth/start` | Inicia a autorização com a John Deere |

## Onde ainda falta encaixar os dados reais

O arquivo `backend/src/mapper.js`, função `buildSnapshotFromJD()`, é o ponto onde os
dados da API viram o formato do painel. Os campos de **área/produtividade por máquina
no dia** dependem do schema exato devolvido pela API (Field Operations + Telemetria),
que será ajustado ao conectar de verdade — os pontos estão marcados com `TODO(dados reais)`.

## Levar para a nuvem

O mesmo código roda em Render / Railway / VM. Basta:
- definir as variáveis de ambiente (as mesmas do `.env`),
- trocar `JD_REDIRECT_URI` pela URL pública `https://.../oauth/callback`,
- cadastrar essa URL no app da John Deere.
