# Legumes — LOV · Operação Semanal

Custom app Shopify (embebida no admin) para a **Legumes e outros Vícios** ([legumeseoutrosvicios.pt](https://legumeseoutrosvicios.pt)): automatiza o processo administrativo semanal — das encomendas da loja aos documentos de **cozinha**, **compras** e **estafetas** (rotas + CSV DPD) — que hoje é feito à mão em ~75 min/semana.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| [`operacao-semanal/`](operacao-semanal/) | A app (React Router + TypeScript + Polaris + Prisma), baseada no template oficial `shopify-app-template-react-router` |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Documento de arquitetura — regras de negócio, modelo de dados, módulos do motor, fases |

## Motor de processamento

`operacao-semanal/app/services/weekly/` — funções puras, testadas com Vitest:

- `parseNoteAttributes` / `splitDishDose` — parsing dos atributos de entrega e das doses
- `resolveConfDay` / `filterOrderWindow` — dia de confeção (incl. regra DPD-véspera) e janela sáb→sex
- `buildKitchenMap` / `buildPurchaseList` / `buildRoutes` / `buildDpdCsv` / `buildLabels` — os documentos

Golden test: `operacao-semanal/test/` corre o motor sobre uma amostra **anonimizada** da semana 47/2025 e afirma os totais reais conhecidos.

## Desenvolvimento

```bash
cd operacao-semanal
npm install
npx prisma migrate dev       # BD local SQLite
npx vitest run               # testes do motor
npm run dev                  # requer Shopify CLI + credenciais da loja
```

> Dados reais de clientes (exports com PII) **não entram** neste repositório — apenas fixtures anonimizadas.
