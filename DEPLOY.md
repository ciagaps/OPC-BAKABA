# Publicar o painel OPC de graça (GitHub Pages)

Resultado: um link público, sempre no ar, que se atualiza sozinho a cada ~30 min.
Custo: **R$ 0**. Sem servidor pra manter, sem hibernação.

Como funciona: o **GitHub Actions** coleta os dados do Operations Center de tempos em
tempos, gera um **relatório HTML autocontido** (arquivo único, no mesmo formato dos
relatórios de milho/feijão) e publica no **GitHub Pages**. O link abre instantâneo
(é uma CDN). Sem login — quem tiver o link acessa.

> Já deixei tudo pronto no código: o coletor (`backend/poll_once.mjs`), o gerador
> (`backend/build_static.mjs`) e a automação (`.github/workflows/deploy.yml`).
> Você só precisa dos passos abaixo, todos na tela do GitHub.

---

## Passo a passo (uma vez só)

### 1. Conta e repositório
- Crie uma conta em github.com (grátis), se ainda não tiver.
- New repository → nome ex.: `opc-bakaba` → **Public** → Create.
  (Precisa ser público para o Pages ser grátis; o dado fica acessível por link, sem senha — já combinado.)

### 2. Subir o código
Se eu já rodei o `git init` + commit local, falta só ligar ao GitHub:
```
cd "opc-dashboard"
git remote add origin https://github.com/SEU-USUARIO/opc-bakaba.git
git branch -M main
git push -u origin main
```
(Ou use o GitHub Desktop: "Add Local Repository" → apontar para a pasta `opc-dashboard` → Publish.)
Confira no GitHub que **`.env` e `tokens.json` NÃO** aparecem (o `.gitignore` bloqueia).

### 3. Cadastrar os 3 segredos
No repositório: **Settings → Secrets and variables → Actions → New repository secret**.
Crie os três (os valores estão na sua máquina — veja o comando no fim):
- `JD_CLIENT_ID`
- `JD_CLIENT_SECRET`
- `JD_REFRESH_TOKEN`

### 4. Ligar o Pages
**Settings → Pages → Source = GitHub Actions.** (Só selecionar; não precisa escolher branch.)

### 5. Primeira publicação
**Actions → "Atualizar painel OPC" → Run workflow.** Em ~1 min termina e o link
aparece (formato `https://SEU-USUARIO.github.io/opc-bakaba/`). Daí em diante ele se
atualiza sozinho a cada ~30 min, e você pode forçar quando quiser pelo mesmo
"Run workflow".

---

## Como pegar os valores dos 3 segredos
Rode isto na pasta `opc-dashboard/backend` e copie cada valor para o segredo correspondente:
```
node -e "const e=require('fs').readFileSync('.env','utf8');for(const l of e.split(/\r?\n/)){if(/^JD_CLIENT_(ID|SECRET)=/.test(l))console.log(l);}"
node -e "console.log('JD_REFRESH_TOKEN='+require('./data/tokens.json').refresh_token)"
```

## Ajustes possíveis
- **Frequência:** edite o `cron` em `.github/workflows/deploy.yml` (`*/30 * * * *` = 30 min).
- **Atualização manual:** aba Actions → Run workflow (equivale ao "Atualizar agora").
- **Novos fechamentos/dados:** commit + push regenera e republica sozinho.

## Se um dia quiser LOGIN de verdade (dado protegido por senha)
Aí não dá pra ser custo zero: precisa de um servidor sempre ligado. O mais barato é
o **Railway (~US$ 5/mês)** — nesse caso o mesmo código roda como servidor (`npm start`)
com as variáveis `PUBLIC_URL`, `STATE_DIR=/data` (volume) e `JD_REFRESH_TOKEN`, e dá
pra adicionar autenticação. Só seguir por aqui se a exposição pública virar problema.
