# ARCHITECTURE.md — App "Operação Semanal" · Legumes & outros Vícios

> Documento de arquitetura para desenvolvimento com Claude Code.
> Lê este ficheiro inteiro antes de escrever código. Constrói por fases (secção 9).
> Para detalhes de UI/ecrãs, ver `BRIEF_DESIGN.md` (companheiro deste documento).

---

## 1. Contexto de domínio (porque é que esta app existe)

A **Legumes & outros Vícios** (legumeseoutrosvicios.pt) vende marmitas saudáveis por encomenda
semanal numa loja Shopify. O cliente encomenda durante a semana; a loja confeciona e entrega na
semana seguinte. Todas as sextas, o operador tem de preparar a semana seguinte para **três equipas**:

- **Cozinha** — o que confecionar, por dia de produção.
- **Compras** — que ingredientes comprar, por fornecedor.
- **Estafetas** — que entregas fazer, onde e quando (rotas + guias DPD).

Hoje isto é feito à mão em Google Sheets/Excel num processo de ~2h com passos manuais frágeis
(fórmulas copiadas, filtros, VBA para duplicar linhas). **Esta app automatiza esse processo**
a partir das encomendas do Shopify.

**Utilizador:** 1 operador administrativo, perfil gestor, não técnico.
**Idioma da UI:** português de Portugal. **Moeda:** EUR.

Os conceitos de negócio essenciais (doses, zonas, fichas técnicas, regra do DPD) estão na secção 4.
Não os reinventes — vêm do processo real do cliente.

---

## 2. Stack técnica

App **custom (privada), embebida no Shopify Admin**. Stack recomendada pela Shopify (2026):

| Camada | Tecnologia | Notas |
|---|---|---|
| Framework | **Remix** (template oficial Shopify) | scaffold via `shopify app init` → React Router/Remix template |
| Linguagem | **TypeScript** | obrigatório para algo além de protótipo |
| UI | **Polaris** (React) + **App Bridge** | Polaris para parecer nativo; App Bridge para nav, toasts, title bar |
| Auth | App Bridge session tokens (managed install + token exchange) | template trata disto out-of-the-box |
| API Shopify | **GraphQL Admin API** (via `authenticate.admin`) | preferir GraphQL a REST; usar webhooks, não polling |
| BD | **Prisma** + SQLite (dev) / Postgres (prod) | guarda dados que NÃO vêm do Shopify (ver secção 5) |
| Deploy | Vercel ou Fly.io | quase zero-config com o template Remix |
| Dev assist | **Shopify MCP server** | dá ao Claude Code acesso aos schemas GraphQL atuais — configurar antes de codar |

**Antes de começar:** configura o Shopify MCP server na ferramenta de IA para teres os schemas
GraphQL corretos (evita alucinações de campos). Scaffold com `shopify app init`, escolhe o
template Remix + TypeScript.

**Regras do template embebido (não esquecer):**
- Usar `Link` de `@remix-run/react` ou `@shopify/polaris`, **nunca** `<a>`.
- Usar `useSubmit`/`<Form/>` de `@remix-run/react`, **nunca** `<form>` minúsculo.
- Usar o `redirect` devolvido por `authenticate.admin`, não o de `@remix-run/node`.
- A app aparece como item no menu lateral do admin; cada rota Remix = uma página.

---

## 3. O que vem do Shopify vs. o que a app guarda

**Do Shopify (read-only, via GraphQL Admin API):**
- Encomendas (orders) com line items, cliente, morada, e `customAttributes` (= "Note Attributes").
- Produtos / variantes (para o catálogo de pratos e doses).

**Guardado na BD da app (Prisma) — definido pelo operador:**
- Fichas técnicas (prato/dose → ingredientes + fornecedor + quantidade).
- Zonas de entrega (texto-match → concelho → dia de confeção → estafeta).
- Parceiros/estafetas e fornecedores.
- Configuração da semana (janela de encomendas, margem de compras).
- Documentos gerados / histórico de semanas (opcional, ver fase 5).

A app **não escreve** nas encomendas do Shopify (exceto, opcionalmente, tags — fase futura).
É essencialmente um motor de leitura + transformação + exportação.

---

## 4. Regras de negócio (a lógica central — NÃO simplificar)

### 4.1 Zona e dia vêm dos atributos da encomenda
Cada order traz em `customAttributes` (Note Attributes no export) um bloco:
```
Order Type: Shipping | Store Pickup
Data de entrega: 24/11/2025
Horário de entrega: Lisboa (Centro da cidade) 19-23h
Dia de entrega: Segunda
Date Format: dd/mm/yy
```
A app faz **parse** destes campos (ver secção 6) e match do `Horário de entrega` com as zonas
configuradas na BD. Encomendas sem este bloco preenchido são um **erro recorrente** — sinalizar,
não descartar silenciosamente.

### 4.2 Doses
O nome do produto no Shopify junta prato + dose: `"Tranche de Salmão... - Low Carb"`.
A app separa o sufixo de dose. Doses possíveis:
- Peixe/carne: `Low Carb`, `Bulk`, `Extra Bulk`, `Zero Carbs` (nem todos os pratos têm todas).
- Vegetariano: `300g`, `400g`, `450g`.
- Pokes: variantes `M`/`XL` × `arroz`/`quinoa` (12 combinações).

### 4.3 Dia de confeção — regra por zona
Cada zona define como se calcula o dia de confeção a partir da data de entrega:
- **Dia fixo** (`2f`|`3f`|`4f`): confeciona sempre nesse dia da semana.
- **`vespera`**: dia ANTERIOR ao de entrega. **DPD nacional ("Portugal Continental
  08-15h") é recolhido na véspera** → entra na produção do dia anterior. **A regra mais fácil de errar.**
- **`mesmo`**: o PRÓPRIO dia de entrega. Recolhas em loja e entregas locais
  confecionadas no dia — confirmado nos vídeos do cliente: *"quando é recolha, é
  sempre no próprio dia"*. `vespera` e `mesmo` são relativas à data de entrega,
  por isso acompanham qualquer calendário (incl. domingo) sem reconfiguração.

> ⚠️ **Calendário em revisão (jul 2026).** Os vídeos do cliente indicam que os dias
> de produção passaram de **2ª/3ª/4ª** para **domingo/segunda/terça**, e que **Lisboa**
> passou a ser confecionada na véspera (como o DPD). As fontes ainda divergem no 3.º dia
> (terça vs quarta) e o Miguel prometeu uma **matriz definitiva** entrega↔confeção.
> Até lá, o mapeamento concreto de cada zona (qual usa `mesmo`/`vespera`/dia fixo) fica
> por confirmar; o motor já suporta as três regras. Mapa histórico (semana 47, base do
> golden test):
```
Entrega Segunda  → confeção 2ª feira
Entrega Terça    → confeção 3ª feira (local) ; DPD recolhido 2ª
Entrega Quarta   → confeção 4ª feira (local) ; DPD recolhido 3ª
Entrega Quinta+  → confeção 4ª feira (último dia de confeção)
```

### 4.4 Janela de encomendas
Sábado 00h00 → Sexta 23h59. Encomendas pós-fecho (ementa antiga) **não entram**. Configurável.

### 4.5 Compras = Σ (ficha técnica × quantidade vendida) × (1 + margem)
Derivado puro. Para cada (prato, dose) vendido, multiplica a ficha técnica e agrega por
ingrediente/fornecedor. Margem de segurança configurável (ex.: +8%). Prato sem ficha técnica →
sinalizar (senão as compras ficam curtas).

### 4.6 Export DPD
CSV de 17 colunas, **sem cabeçalho**, separador `;`. Contacto **sem `+351`**. Texto **sem `;`**
(é o separador). Colunas (ver `Template_DPD`): conta, nr cliente dest, nome, morada completa,
código postal, localidade, país, telefone fixo, telemóvel, email, contacto destino, peso,
volumes, cobrança, referência, observações, código AT.

### 4.7 Etiquetas = uma linha por refeição
Para impressão: explodir a quantidade (qty=3 → 3 linhas), cada uma com prato + cliente + data
de confeção. Substitui o passo VBA manual atual.

---

## 5. Modelo de dados (Prisma schema)

```prisma
// Sessão Shopify (já vem no template)
model Session { /* não tocar — gerido pelo template */ }

model Dish {
  id          String   @id @default(cuid())
  baseName    String   @unique          // "Tranche de Salmão com amêndoa e sweet chili"
  category    String                     // peixe|carne|vegetariano|poke|pizza|sopa|sobremesa|embalagem
  shopifyIds  String[]                   // ids de produto Shopify associados (match)
  doses       Dose[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Dose {
  id          String       @id @default(cuid())
  dish        Dish         @relation(fields: [dishId], references: [id], onDelete: Cascade)
  dishId      String
  label       String                     // "Low Carb" | "Bulk" | "300g" | "M arroz" ...
  active      Boolean      @default(true)
  ingredients RecipeLine[]
  @@unique([dishId, label])
}

model Ingredient {
  id         String       @id @default(cuid())
  name       String       @unique        // "Tranche de salmão"
  supplier   Supplier?    @relation(fields: [supplierId], references: [id])
  supplierId String?
  unit       String                       // kg|g|ml|L|un
  lines      RecipeLine[]
}

model RecipeLine {                          // ficha técnica: 1 ingrediente numa dose
  id           String     @id @default(cuid())
  dose         Dose       @relation(fields: [doseId], references: [id], onDelete: Cascade)
  doseId       String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId String
  qtyPerMeal   Float                       // quantidade por 1 refeição, na unidade do ingrediente
  @@unique([doseId, ingredientId])
}

model Supplier {
  id          String       @id @default(cuid())
  name        String       @unique
  email       String?
  orderDay    String?                      // dia em que se encomenda (texto livre)
  ingredients Ingredient[]
}

model Zone {
  id          String   @id @default(cuid())
  matchText   String   @unique             // "Lisboa (Centro da cidade) 19-23h"
  county      String                        // concelho/região
  confDay     String                        // "2f" | "3f" | "4f" | "vespera"
  courier     Courier? @relation(fields: [courierId], references: [id])
  courierId   String?
  active      Boolean  @default(true)
}

model Courier {
  id        String  @id @default(cuid())
  name      String  @unique                // "Off Limits", "CrossFit Leiria", "DPD", "Interno"
  type      String                          // internal|partner|dpd
  email     String?                         // p/ envio de rota (partner)
  ordering  String  @default("manual")      // manual|postcode|county
  zones     Zone[]
}

model AppConfig {
  id              String @id @default("singleton")
  orderWindowFrom String @default("SAT_00:00")
  orderWindowTo   String @default("FRI_23:59")
  ignoreAfterClose Boolean @default(true)
  purchaseMargin  Float  @default(0.08)
  dpdAccount      String?
}

model WeekRun {                              // histórico opcional (fase 5)
  id         String   @id @default(cuid())
  weekLabel  String                          // "2025-W47"
  generatedAt DateTime @default(now())
  ordersJson Json                            // snapshot processado
}
```

---

## 6. Lógica de processamento (o "motor")

Módulo central `app/services/weekly/` — funções puras, testáveis, sem dependência de UI:

```
parseNoteAttributes(raw: string): { orderType, dataEntrega, zona, dia } | null
  // regex sobre o bloco de customAttributes. Devolve null se faltar o campo zona.

splitDishDose(lineItemName: string): { base: string, dose: string }
  // separa o sufixo " - Low Carb" etc. Pokes tratados à parte.

resolveConfDay(zona: Zone, dia: string): "2f" | "3f" | "4f"
  // aplica 4.3 incl. a regra DPD-recolhido-na-véspera.

buildKitchenMap(orders, dishes): KitchenMap
  // pivot prato×dose×confDay → quantidades. (output Cozinha)

buildPurchaseList(orders, recipes, margin): PurchaseList
  // Σ ficha técnica × qty, agregado por fornecedor, +margem. Sinaliza pratos sem ficha. (Compras)

buildRoutes(orders, zones, couriers): Route[]
  // agrupa por zona/dia, ordena por ordering do courier. (Estafetas)

buildDpdCsv(orders): string
  // 17 colunas, sem header, ';' separador, sem +351, sem ';' no texto. (4.6)

buildLabels(orders): LabelRow[]
  // explode qty → 1 linha/refeição. (4.7)

filterOrderWindow(orders, config): orders
  // aplica 4.4.
```

**Importante:** o Shopify GraphQL devolve cada order já estruturada (line items aninhados), ao
contrário do CSV plano (que precisava de forward-fill). Não replicar o forward-fill do CSV — só
é preciso ao importar o ficheiro CSV legado.

---

## 7. Rotas Remix (mapa de páginas)

```
/app                         → redirect para /app/semana
/app/semana                  → cockpit: importa orders da janela, métricas, 3 dias, gerar tudo
/app/cozinha                 → mapa de produção (seletor de dia de confeção)
/app/compras                 → lista por fornecedor
/app/estafetas               → rotas + DPD (seletor de dia de entrega)
/app/definicoes/fichas       → editor de fichas técnicas
/app/definicoes/zonas        → zonas & calendário
/app/definicoes/parceiros    → parceiros, DPD, estafeta interno
/app/definicoes/margens      → margem compras, janela de importação
/app/api/export/cozinha      → resource route: gera xlsx
/app/api/export/compras      → resource route: gera xlsx
/app/api/export/dpd          → resource route: gera csv
/app/api/export/etiquetas    → resource route: gera xlsx
```

Cada página de leitura usa um `loader` que: `authenticate.admin(request)` → query GraphQL de
orders na janela → passa pelo motor (secção 6) → devolve JSON tipado para o componente Polaris.
Mutações (criar/editar fichas, zonas) via `action` + Prisma.

---

## 8. Queries GraphQL (orientação)

> Usa o Shopify MCP server para confirmar os campos atuais antes de escrever. Esboço:

```graphql
query OrdersInWindow($query: String!, $cursor: String) {
  orders(first: 100, query: $query, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      name email createdAt
      customAttributes { key value }      # ← Note Attributes (zona/dia/data)
      shippingAddress { name address1 zip city phone }
      lineItems(first: 50) { edges { node {
        name quantity
        originalUnitPriceSet { shopMoney { amount } }
      }}}
      subtotalPriceSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
    }}
  }
}
```
Paginação obrigatória (>100 orders/semana). Filtro `query` por data (`created_at:>=...`). Respeitar
rate limits (custo de query GraphQL); usar `first` moderado + cursor.

---

## 9. Fases de desenvolvimento (construir por esta ordem)

**Fase 0 — Scaffold.** `shopify app init` (Remix+TS). Confirmar app embebida a abrir no dev store.
Configurar MCP server. Prisma migrate inicial com o schema da secção 5.

**Fase 1 — Leitura de orders + parser.** Query GraphQL de orders na janela. Implementar e
**testar** `parseNoteAttributes`, `splitDishDose`, `resolveConfDay`, `filterOrderWindow` com
fixtures reais (usar uma amostra anonimizada do CSV w47 como golden test). Página `/app/semana`
a mostrar métricas + tabela de dias. Banner de orders sem zona (4.1).

**Fase 2 — Definições.** CRUD de zonas, parceiros/couriers, fornecedores e config. Sem isto o
resto não calcula. Editor de fichas técnicas (Dish/Dose/RecipeLine).

**Fase 3 — Cozinha.** `buildKitchenMap` + página com seletor de dia + tabelas por dose. Export xlsx.

**Fase 4 — Estafetas.** `buildRoutes` + `buildDpdCsv` + página. Export xlsx por rota + CSV DPD.
Envio de rota por email aos parceiros (resource route + serviço de email).

**Fase 5 — Compras.** `buildPurchaseList` (depende das fichas da fase 2). Página por fornecedor.
Export xlsx. Estados de "prato sem ficha".

**Fase 6 — Polimento.** Estados vazios/erro (secção 10), histórico de semanas (WeekRun),
"Fechar e gerar tudo" no cockpit, etiquetas.

Cada fase deve terminar com a app a correr e essa parte utilizável antes de avançar.

---

## 10. Estados a tratar (não só caminho feliz)

- Primeira utilização sem fichas técnicas → Compras mostra empty state que leva a Definições.
- Orders sem zona → banner no cockpit, excluídas dos cálculos até resolvidas.
- Prato vendido sem ficha técnica → sinalizar na lista de compras.
- Janela de importação vazia / fora de horas → mensagem clara.
- Paginação de orders → loading state; não assumir <100 orders.
- Falha de export/email → toast de erro App Bridge, não falha silenciosa.

---

## 11. Testes

- **Unitários** (Vitest): todo o módulo `weekly/` com fixtures reais. Casos-armadilha:
  DPD na véspera (4.3), order sem zona, prato com dose em falta, qty>1 nas etiquetas,
  limpeza `+351`/`;` no DPD.
- **Integração**: loaders/actions com Prisma em SQLite de teste.
- **E2E** (opcional, Playwright): fluxo cockpit → gerar → export.

Golden test recomendado: alimentar o motor com a amostra w47 e afirmar os totais conhecidos
(185 orders, 1028 line items, splits por dia 2f/3f/4f).

---

## 12. Decisões fechadas / em aberto

**Fechadas:** Remix+Polaris+Prisma; app só-leitura sobre orders; calendário 2f/3f/4f do ficheiro;
fichas/zonas/ordenação definidas pelo operador; fornecedor ao nível do ingrediente; export
manual DPD (CSV).

**Em aberto (confirmar com cliente, não assumir):** geocoding p/ otimização real de rotas;
integração direta DPD↔Shopify (guia gerada no Moloni — incerto); escrever tags nas orders;
serviço de email a usar para enviar rotas aos parceiros; Postgres provider em produção.
