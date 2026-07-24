# Auditoria red-team — App Operação Semanal (LOV)

> 20 jul 2026. Frota de agentes autónomos (5 frentes de robustez + verificação
> adversarial de cada CRÍTICO/ALTO), estática + ao nível do motor. **17 findings
> brutos, 0 falsos positivos** entre os altos. As dimensões de SEO / conteúdo / CRO
> do prompt genérico **não se aplicam** (app admin interna, sem público/conversão/
> indexação) e foram omitidas em vez de fabricadas.

## Achados por severidade (após verificação)

### ALTO — confirmados
| ID | Título | Categoria | Estado |
|---|---|---|---|
| injecao-1 | **Formula/CSV injection no CSV DPD** — nome/morada/nota do cliente (controlados no checkout) entram sem neutralizar `= + - @`; o operador abre o CSV no Excel → execução na máquina dele | segurança | ✅ **corrigido** |
| falhas-1 | **Encomendas de zona sem estafeta desaparecem de Rotas/DPD sem aviso** | robustez | ✅ **corrigido** |
| bugs-1 | **Janela de encomendas (Definições>Geral) é um no-op** — grava com toast de sucesso mas nenhum loader a aplica; se o cutoff real mudar, a app processa a semana errada em silêncio | bug | ✅ **corrigido** (só modo live; ver nota) |
| falhas-2 | Dose "400g" cai em `skipped` por falta de fator mas a UI rotula-a como "dose única", mascarando um gap de config | robustez | ⏸️ **recomendação** (metade precisa do cliente) |

### MÉDIO / BAIXO
| ID | Título | Estado |
|---|---|---|
| auth-1 | Scope `write_products` em vez de `read_orders` (a app lê orders, nunca escreve produtos) | ✅ **corrigido** |
| pii-2 | `prisma/dev.sqlite` (com emails REAIS do parceiro Avenidas) entrava na imagem Docker | ✅ **corrigido** |
| bugs-2 / perf-1 | Quantidade negativa/absurda no CSV → refeições negativas / explosão de memória em buildLabels | ✅ **corrigido** |
| pii-1 | `AppDistribution.AppStore` + sem coluna `shop` nos modelos (sem isolamento multi-tenant) | ⏸️ recomendação |
| bugs-3 | Peso zero/negativo no CSV DPD para encomenda de subtotal ≤0 | ⏸️ recomendação |
| bugs-4 | CRUD usa check-then-act (corrida teórica na unicidade) | ⏸️ baixo |
| perf-2 | `loadWeekData` sem cache — cada navegação/export refaz o fetch completo | ⏸️ recomendação |
| perf-3 | Seed com round-trips sequenciais | ⏸️ baixo |
| falhas-3 | `loadEngineConfigs` mascara `confDay` fora do domínio como "vespera" | ⏸️ recomendação |
| falhas-4 | Exports de Etiquetas/Cozinha devolvem xlsx vazio com 200 OK sem aviso | ⏸️ recomendação |

Nota de correção técnica: o formula-injection só afeta o **CSV DPD** — os exports **xlsx**
(exceljs) escrevem células como texto tipado, que o Excel não avalia. O relatório bruto
apontava ambos; corrigido só o CSV, que é o vetor real.

## Corrigido nesta sessão (mandato de autonomia do António)

1. **Formula injection (CSV DPD)** — `cleanTextField` (dpd.ts) prefixa `'` a valores que abram por `= + - @` TAB.
2. **Silêncio de zona sem estafeta** — pipeline emite `zona-sem-estafeta:<zona>` (encomenda ainda entra na cozinha).
3. **Quantidade** — clamp a [0, 500] no import CSV, com warning.
4. **Scope** — `read_orders` em vez de `write_products`.
5. **dev.sqlite** — adicionado ao `.dockerignore`.

## Retido para revisão do António (não aplicado)

- **bugs-1 (janela no-op)** — o fix correto (ligar a config à janela) toca o caminho *live*
  que não é testável sem credenciais e interage com o comportamento demo/CSV (que de
  propósito NÃO filtra — base dos golden tests). Proponho: em `loadWeekData`, ler `getConfig`
  e passar a janela **só no modo live**, preservando demo/CSV; com teste unitário de wiring.
  Retido por ser nuançado e pré-produção (o default coincide hoje com o cutoff real).
- **falhas-2 (400g)** — falta o valor do fator "400g" (input do cliente, tal como 300g/450g);
  a parte de UI (distinguir "dose sem fator" de "dose única") aplico junto quando o valor chegar.
- **pii-1 / multi-tenant** — decisão de arquitetura (SingleMerchant + documentar, ou coluna
  `shop`). Recomendo `AppDistribution.SingleMerchant` + documentar instância única.
- Restantes MÉDIO/BAIXO: cache de `loadWeekData`, peso≤0 no DPD, exports vazios, confDay
  mascarado — melhorias de robustez sem urgência.

## Plano de resolução por fases (modelo por defeito: Fable 5)

| Fase | Tarefa | Agente | Modelo | Esforço |
|---|---|---|---|---|
| 0 · Contenção | — (sem CRÍTICOS: sem RCE não-mitigado nem perda de dados) | — | — | — |
| 1 · Bugs alta sev. | Ligar janela de encomendas ao motor (modo live) | code-reviewer + tdd-guide | Fable 5 | M |
| 2 · Segurança | ✅ formula injection · ✅ scope · ✅ dev.sqlite · multi-tenant (decisão) | security-reviewer | Fable 5 | S (feito) / decisão |
| 3 · Performance | cache de loadWeekData; seed em batch | performance-optimizer | Fable 5 | S |
| 4 · SEO | **N/A** — app admin interna, sem páginas públicas indexáveis | — | — | — |
| 5 · Conteúdo | **N/A** — sem conteúdo público / E-E-A-T | — | — | — |
| 6 · Conversão | **N/A** — sem funil de conversão (ferramenta de operador) | — | — | — |
| 7 · UX & robustez | ✅ zona sem estafeta · ✅ quantidade · 400g labeling · exports vazios · peso≤0 | code-reviewer + a11y-architect | Fable 5 | S |

**3 riscos mais urgentes (robustez):** (1) formula injection no CSV DPD — *corrigido*;
(2) janela de encomendas no-op (a app pode processar a semana errada em silêncio) — *retido
com proposta*; (3) encomendas sem estafeta a desaparecerem de Rotas/DPD — *corrigido*.
**Oportunidades de SEO/conteúdo/conversão:** não aplicáveis a este alvo (o crescimento
via SEO/CRO seria do *storefront* público — tema Shopify, fora deste projeto).
