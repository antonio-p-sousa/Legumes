# DEPLOY.md — Guia de deployment · App "Operação Semanal"

> Guia prático para pôr a app em produção quando a Loop decidir o alojamento.
> A app vive em `operacao-semanal/` (template oficial `shopify-app-template-react-router`,
> React Router 7 + Prisma, Dockerfile incluído). Nada aqui foi ainda aplicado ao código:
> este documento descreve **o que terá de mudar** e por que ordem.

---

## 1. Pré-requisitos

Antes de qualquer comando:

- [ ] **Conta Shopify Partners da Loop** com acesso à organização (não usar conta pessoal).
- [ ] **App criada no Partner Dashboard** (Apps → Create app → Create app manually).
      Anotar o **Client ID** e o **Client secret** — são o `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`.
- [ ] **Distribuição custom**: a app é privada, para a loja `legumeseoutrosvicios.pt`.
      No dashboard, escolher *Custom distribution* e indicar o domínio `.myshopify.com` da loja.
- [ ] **Shopify CLI** instalada e autenticada na conta da Loop (`npm i -g @shopify/cli`).
- [ ] **Decisão de alojamento** tomada (secção 2) + conta criada na plataforma.
- [ ] **Postgres gerido** provisionado (secção 3.3) com a connection string à mão.
- [ ] `shopify.app.toml` ainda tem `client_id = ""` — será preenchido pelo
      `shopify app config link` (secção 5.1).

---

## 2. Alojamento: Fly.io vs Vercel — recomendação

| Critério | Fly.io | Vercel |
|---|---|---|
| Modelo | Servidor long-lived (VM/Machine) | Serverless functions |
| Dockerfile existente | **Usado tal-e-qual** | Ignorado (precisa do preset `@vercel/react-router`) |
| `docker-start` (`prisma migrate deploy` no arranque) | Funciona sem alterações | Não existe "arranque" — migrações teriam de passar para o build |
| `readFileSync` da fixture demo (`test/fixtures/w47-orders.json` em runtime) | Funciona (filesystem completo da imagem) | Exige configurar `includeFiles` no bundle serverless |
| Cold starts no iframe do admin | Nenhum (com `min_machines_running = 1`) | Possíveis no primeiro load |
| Guia oficial Shopify | Sim (`fly.io/docs/js/shopify/`) | Não específico |
| Custo estimado | ~3–5 USD/mês (shared-cpu-1x, 512 MB) | Free tier chega, mas com os caveats acima |

**Recomendação: Fly.io.** Esta app é um servidor Node clássico (`react-router-serve`),
já tem Dockerfile pronto, corre migrações no boot e lê ficheiros do disco em runtime —
tudo coisas que a Vercel obriga a reconfigurar e o Fly aceita sem tocar em nada.
Região: **`mad` (Madrid)** — a mais próxima de Portugal.

---

## 3. Migração SQLite → Postgres

### 3.1 Alterações ao `prisma/schema.prisma`

O datasource está hardcoded para SQLite. Mudar para:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Campos JSON-em-String mantêm-se `String` — sem mudança.** `Dish.shopifyIds`,
`Courier.ccEmails` e `WeekRun.ordersJson` guardam JSON serializado em `String`
de propósito (comentado no schema); converter para o tipo `Json` nativo do
Postgres obrigaria a mexer no código. Não converter.

### 3.2 Re-gerar as migrações (obrigatório)

As 4 migrações em `prisma/migrations/` são SQL **específico de SQLite**
(`migration_lock.toml` diz `provider = "sqlite"`). O Prisma não permite trocar
de provider sobre o histórico existente. Caminho recomendado, **num branch**:

```bash
git checkout -b feat/postgres
# 1. editar schema.prisma (3.1)
# 2. arquivar o histórico sqlite (não pode existir prisma/migrations)
git rm -r prisma/migrations
# 3. gerar o baseline postgres contra uma BD de dev/branch (nunca a de prod)
set DATABASE_URL=postgresql://...dev...   # PowerShell: $env:DATABASE_URL = "..."
npx prisma migrate dev --name init
# 4. correr os testes (o motor não toca na BD; integração usa o client gerado)
npm test
```

Em produção nunca se corre `migrate dev` — o `docker-start` já faz
`prisma migrate deploy` em cada arranque, que aplica este baseline à BD vazia.

### 3.3 Postgres gerido — opções

| Opção | Prós | Contras |
|---|---|---|
| **Neon** (recomendado) | Free tier real, sem pausa de projeto (compute adormece e acorda em <1 s), branches de BD (útil para o passo 3.2), PITR | Região AWS eu-central-1 (latência ok) |
| Supabase | A equipa já o usa (parque-lousa, Mimo) | Free tier **pausa o projeto após ~1 semana sem tráfego** — arriscado numa app usada só à sexta |
| Fly Managed Postgres | Mesma datacenter que a app (latência mínima) | Pago desde o 1.º dia; mais uma coisa a gerir no Fly |

**Recomendação: Neon.** Com 1 operador e 1 máquina, usar a **connection string
direta (não-pooled)** em `DATABASE_URL` — dispensa `directUrl`/pgbouncer no schema.

---

## 4. Variáveis de ambiente

| Variável | Valor | Onde se define (Fly) | Notas |
|---|---|---|---|
| `SHOPIFY_API_KEY` | Client ID da app | `[env]` no `fly.toml` | Não é segredo (vai no bundle do cliente) |
| `SHOPIFY_API_SECRET` | Client secret | `fly secrets set` | **Segredo** |
| `SCOPES` | `write_products` | `[env]` no `fly.toml` | Tem de bater certo com `shopify.app.toml` |
| `SHOPIFY_APP_URL` | `https://<app>.fly.dev` | `[env]` no `fly.toml` | O `fly launch` preenche |
| `DATABASE_URL` | connection string Neon | `fly secrets set` | **Segredo**; usada pelo schema (3.1) e pelo `migrate deploy` do boot |
| `DEMO_DATA` | *(não definir)* | — | Nosso. `1` força dados demo; em prod fica ausente para a app usar a loja real |
| `NODE_ENV` | `production` | Já vem no Dockerfile | Nada a fazer |
| `PORT` | `3000` | `[env]` no `fly.toml` | `react-router-serve` lê-o; Dockerfile faz `EXPOSE 3000` |
| `SHOP_CUSTOM_DOMAIN` | *(opcional)* | — | Só se a loja usar domínio custom no admin |

Na Vercel (se um dia migrar): tudo em Project → Settings → Environment Variables.

---

## 5. Passo-a-passo (Fly.io)

### 5.1 Ligar o repositório à app do dashboard

```bash
cd operacao-semanal
shopify app config link        # escolher a org da Loop e a app criada em 1.
```

Isto preenche `client_id` no `shopify.app.toml`. Depois acrescentar ao toml:

```toml
application_url = "https://operacao-semanal.fly.dev"

[auth]
redirect_urls = ["https://operacao-semanal.fly.dev/auth/callback"]
```

### 5.2 Criar e configurar a app no Fly

```bash
fly launch --no-deploy         # deteta o Dockerfile; escolher região mad; NÃO criar Postgres do Fly
fly secrets set SHOPIFY_API_SECRET=<client-secret> DATABASE_URL=<neon-url>
```

Confirmar no `fly.toml` gerado (o `fly launch` importa `shopify app env show`):

```toml
[env]
  PORT = "3000"
  SHOPIFY_API_KEY = "<client-id>"
  SHOPIFY_APP_URL = "https://operacao-semanal.fly.dev"
  SCOPES = "write_products"

[http_service]
  internal_port = 3000
  auto_stop_machines = "off"   # embebida no admin: sem cold starts
  min_machines_running = 1
```

### 5.3 Deploy

```bash
fly deploy                     # build da imagem + arranque; docker-start corre migrate deploy
fly logs                       # confirmar "Prisma migrate" e o servidor a ouvir em :3000
```

> O deploy usa o diretório local (respeita `.dockerignore`, não o `.gitignore`),
> por isso o `package-lock.json` local entra na imagem — ver nota na secção 6.4.

### 5.4 Push da configuração Shopify + instalação na loja

```bash
shopify app deploy             # cria uma versão da app: webhooks, scopes, URLs do toml
```

Depois, no Partner Dashboard → app → *Choose distribution* → **Custom distribution** →
gerar o **install link** e abri-lo autenticado como admin da loja. A app aparece no
menu lateral do admin em Apps.

---

## 6. Pós-deploy

### 6.1 Seed de produção (UMA vez)

O `npm run seed` usa `tsx`, que é devDependency — **não existe na imagem**
(`npm ci --omit=dev`). Correr o seed a partir da máquina de dev, contra a BD de prod:

```powershell
cd operacao-semanal
$env:DATABASE_URL = "<neon-url-de-prod>"
npm run seed        # idempotente (upsert): correr 2x não duplica nada
```

(Alternativa dentro da máquina: `fly ssh console -C "npx -y tsx prisma/seed.ts"` —
funciona mas descarrega o tsx na hora.)

### 6.2 Smoke checklist

- [ ] `/app` abre dentro do admin da loja (redirect para `/app/semana`, métricas visíveis).
- [ ] `weekLabel` mostra a semana real (fonte "live"), **não** "2025-W47 (demonstração)".
- [ ] Importar um CSV em `/app/importar` e ver os dados refletidos.
- [ ] Exports descarregam: cozinha, compras, DPD, etiquetas, rotas (`/app/api/export/*`).
- [ ] Páginas de impressão abrem: `/app/print/{cozinha,compras,etiquetas,rotas}`.
- [ ] Definições gravam (fichas, zonas, parceiros, geral).

### 6.3 Três pontos a validar com a loja real

1. **Downloads dentro do iframe** — os exports usam resource routes + `download` em
   `s-button`; confirmar que o browser não bloqueia downloads iniciados no iframe do admin.
2. **`weekLabel` live** — com encomendas reais, confirmar que a janela Sáb 00:00 → Sex 23:59
   apanha a semana certa e o label deixa de ser o de demonstração/fallback
   ("— falha na ligação à loja" indica erro de API, não de deploy).
3. **Timezone** — a janela é calculada em **UTC** (`computeOrderWindow`); a loja opera em
   Europe/Lisbon (UTC+1 no verão), logo no verão o corte real desvia 1 h face ao relógio
   de parede. Validar com o Miguel se o desvio é aceitável ou se se ajusta a config.

### 6.4 Notas que afetam o deploy (descobertas no repo)

- **`test/` tem de ir na imagem Docker** — a fixture demo (`provider.server.ts` lê
  `test/fixtures/w47-orders.json` em runtime como fallback) e o seed dependem dela.
  O `.dockerignore` atual (só `.cache`, `build`, `node_modules`) está certo: **não acrescentar `test/`**.
- **`package-lock.json` está no `.gitignore`** (herança do template). O `fly deploy` local
  não sofre, mas qualquer deploy via CI/git clone falha no `npm ci`. Antes de montar CI,
  tirar o lockfile do `.gitignore` e commitá-lo.
- **`prisma/dev.sqlite` entra na imagem** (não está no `.dockerignore`) — inofensivo
  depois da migração para Postgres, mas pode acrescentar-se ao `.dockerignore` por higiene.
- **`distribution: AppDistribution.AppStore`** em `app/shopify.server.ts` é o default do
  template; para app custom de loja única confirmar se se muda para `SingleMerchant`
  aquando da instalação (não bloqueia o deploy).

---

## 7. Rollback e backups

**Rollback da app (Fly):**

```bash
fly releases                                   # listar versões e image refs
fly deploy -i registry.fly.io/<app>@<digest>   # voltar à imagem anterior
```

Atenção: se a versão nova incluiu uma migração Prisma, o rollback do código não
desfaz a migração — só recuar se a migração for retro-compatível (regra: migrações
aditivas primeiro, remoções só numa versão seguinte).

**Rollback da config Shopify:** Partner Dashboard → app → Versions → reativar a versão anterior.

**Backups do Postgres:**

- Neon: PITR/branching incluído no plano — restauro por branch a partir de um ponto no tempo.
- Backup manual antes de cada migração ou alteração grande:

```bash
pg_dump "<neon-url>" --format=custom --file=backup-$(date +%F).dump
pg_restore --dbname="<neon-url>" backup-2026-07-20.dump   # restauro
```

Cadência mínima sugerida: dump manual à sexta antes de gerar a semana, até haver
rotina automática. Os dados críticos (fichas técnicas, zonas, parceiros) são
pequenos — um dump demora segundos.
