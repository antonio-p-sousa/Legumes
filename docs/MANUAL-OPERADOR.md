# Manual do operador — App "Operação Semanal"

> Guia rápido de utilização semanal, para quem prepara a logística (não técnico).
> A app vive dentro do **admin do Shopify**, no menu **Apps → Operação Semanal**.

## O que a app faz

Substitui o trabalho manual de sexta-feira: a partir das encomendas da loja, gera
automaticamente os documentos para as três equipas — **cozinha**, **compras** e
**estafetas** — mais as etiquetas e o ficheiro para a DPD.

## Rotina semanal (todas as sextas)

1. **Trocar a ementa no site** — como sempre, no Shopify (coleções + app Delivery &
   Pickup). A app **não** faz isto; só lê as encomendas.
2. **Abrir a app** → **Apps → Operação Semanal → Semana**.
3. No topo, confirmar a **semana** e a **janela de encomendas** (sáb→sex). Se as
   encomendas ainda não estiverem carregadas, clicar em **Reimportar**.
4. Ver os **avisos** (banner amarelo): encomendas sem zona ou fora da janela ficam
   sinalizadas — resolver antes de gerar, se preciso.
5. Descarregar os documentos na tabela **Documentos da semana** (cada um tem o seu
   botão de exportar).

## Os ecrãs

| Ecrã | Para que serve | Exporta |
|---|---|---|
| **Semana** | Visão geral: nº de encomendas, refeições, faturação; estado de tudo | — |
| **Cozinha** | O que confecionar, por dia — prato × dose + kg de componentes | xlsx · PDF |
| **Rotas de câmara** | Separar as refeições por rota na câmara (nº de refeições por cliente) | xlsx · PDF |
| **Compras** | O que comprar, por fornecedor (quando as fichas estiverem preenchidas) | xlsx |
| **Estafetas** | Rotas de entrega (morada/telefone) + **CSV para a DPD** | xlsx · CSV · PDF |
| **Etiquetas** | Uma etiqueta por refeição (prato + cliente + data de confeção) | xlsx · PDF |

## Definições (configura-se uma vez, ajusta-se quando muda)

- **Zonas & dias** — que dia se confeciona cada zona de entrega. É aqui que se reflete
  qualquer mudança no calendário (ex.: trocar Leiria por Porto) — **sem depender de
  informática**.
- **Parceiros & fornecedores** — estafetas (com emails para envio de rotas) e fornecedores.
- **Fichas técnicas** — composição dos pratos (para as Compras).
- **Geral** — janela de encomendas, margem de compras, conta DPD.

## Se ainda não houver ligação automática à loja

Enquanto a app não está ligada em tempo real ao Shopify, funciona na mesma:
- No Shopify, **Encomendas → Exportar → CSV** (como já se faz hoje).
- Na app, **Importar CSV** → carregar o ficheiro. A partir daí, todos os documentos
  são gerados na mesma.

## Notas

- A app **não altera** nada na loja — só lê as encomendas. É seguro clicar à vontade.
- O **código AT** no ficheiro DPD continua a vir do Moloni (a app deixa esse campo em
  branco, tal como o processo manual).
- Dúvidas ou algo que não bate certo: falar com a equipa da Loop Future.
