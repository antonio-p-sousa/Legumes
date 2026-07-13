# Cronograma — Operação Semanal (LOV)

> Atualizado a **13/07/2026**. Fonte de verdade do estado do projeto; a versão Excel
> ("Estado do Projeto - Operação Semanal.xlsx") vive na pasta OneDrive do projeto
> (não entra no repo — ver `.gitignore`).

## Fases

| Fase | Entregável | Datas | Estado |
|---|---|---|---|
| Descoberta & análise | Leitura dos ficheiros do cliente, site, processo manual | 10/07 | ✅ Concluída |
| Mockups | 6 ecrãs navegáveis (chrome Shopify Admin) | 10/07 | ✅ Concluída |
| Fase 0 — Scaffold | Template react-router + Prisma + fixtures w47 anonimizadas | 10/07 | ✅ Concluída |
| Fase 1 — Motor | 9 funções puras + golden test w47 (120 testes) | 10/07 | ✅ Concluída |
| Fase 2 — Definições | CRUD zonas/parceiros/fichas/config + seed (214 testes no total) | 13/07 | ✅ Concluída |
| Fase 3 — Cozinha | Página mapa de produção + export xlsx + cockpit | 14–15/07 prev. | ⬜ Planeada |
| Fase 4 — Estafetas | Rotas + CSV DPD + email aos parceiros | 16–17/07 prev. | ⬜ Planeada |
| Fase 5 — Compras | Página por fornecedor + estados "sem ficha" | 17–20/07 prev. | ⬜ Planeada |
| Fase 6 — Polimento | Etiquetas, histórico, "Gerar tudo", estados de erro | 21–22/07 prev. | ⬜ Planeada |
| Ligação à loja real | Custom app instalada + dados live | — | ⛔ **Bloqueada** (credenciais) |
| Piloto com operador | 1–2 semanas em paralelo com o processo manual | 27/07–07/08 prev. | ⛔ Bloqueada (dep. anterior) |
| Go-live | Operador passa a usar a app | ago prev. | ⬜ Planeada |

Datas previstas assumem credenciais da loja até ~20/07. O desenvolvimento **não está
bloqueado** até à Fase 5 — tudo corre sobre as fixtures reais anonimizadas.

## Bloqueadores (responsável)

1. **Credenciais da custom app** (Miguel/Ricardo) — bloqueia ligação à loja, `shopify app dev`, dados reais
2. **Fichas técnicas** — receitas por prato×dose (Miguel) — sem elas, Compras mostra "sem ficha"
3. **Exemplos atuais dos documentos** — compras, guia de estafetas, ficha de cozinha (Miguel)
4. **Mapa dias entrega↔confeção** — site diz dom–qua; históricos seg–qui; confirmar (Miguel/António). A config de Zonas suporta qualquer cenário
5. **Cut-off de encomendas** — proposta sexta 23:59, falta confirmação (Miguel)

## Decisões em aberto (Loop)

- Serviço de email para envio de rotas aos parceiros (Fase 4)
- BD de produção (Postgres) e alojamento (Vercel/Fly) — antes do go-live
