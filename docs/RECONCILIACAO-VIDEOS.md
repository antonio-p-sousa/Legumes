# Reconciliação — vídeos do cliente ↔ documentação/código

> **ATUALIZAÇÃO 28 jul 2026 — documentos logísticos do Miguel (pasta semanal w28):**
> - **`00. Rotas.xlsx` — DOCUMENTO NOVO, a app NÃO o produz.** É o documento da
>   **câmara refrigerada**: por dia de PRODUÇÃO (dom/2f/3f), blocos de rota/destino
>   lado a lado, cada linha = `Encomenda | Cliente | nº de REFEIÇÕES` (não moradas).
>   Alimentado por uma lista-mestre "refeições por cliente/dia" (VLOOKUP). Difere da
>   impressão de rotas atual da app (por estafeta, com morada/telefone/valor, para
>   navegar a entrega). Finalidade: separar as refeições por rota na câmara. → **a
>   construir** (dados já existem no motor; falta a vista "refeições por cliente por
>   rota" + impressão landscape). Ver POR-FAZER.md.
> - **Folhas de entrega por zona** (01. Lisboa, 02. Leiria, 03. Coimbra, recolha em
>   loja, entrega interna) — ✅ **já cobertas** pela impressão de rotas da app (mesmas
>   colunas: Name/Billing/Phone/Shipping.../Subtotal/Notes).
> - **CSV DPD real** (enviado ao portal) — ✅ a app gera corretamente as colunas 1-16.
> - **Código AT (col 17)** — continua a vir do **Moloni** (gerado ao emitir a guia de
>   transporte); a app **não o pode gerar** e faz bem em deixá-lo em branco. O novo
>   template só automatiza a JUNÇÃO por nº de encomenda (XLOOKUP sobre um export do
>   Moloni). ✅ A app já fornece a chave: `order.name` na coluna 15 ("Coluna O").
> - **PDFs "fecho do dia"** — são o *Relatório Final do portal DPD* (downstream do
>   upload do nosso CSV), não output da app. Fecham o ciclo, nada a fazer.
> - Nota menor: no CSV real a col 8 (telefone fixo) vem com o telemóvel repetido; a
>   app deixa-a vazia (é campo não-obrigatório — cosmético; espelhar se quiserem paridade).

> **ATUALIZAÇÃO 20 jul 2026 — respostas do Miguel (por email):**
> - **Fichas técnicas por ingrediente NÃO existem** — só a ficha da dose média (bulk)
>   e o cálculo por COMPONENTES (Proteína/Hidratos/Legumes × dose). Fichas por
>   ingrediente + fornecedores ficam para uma **2ª fase**. A 1ª fase usa a tabela de
>   fatores por dose (fornecida por screenshot; margem de 10g/componente já incluída)
>   — implementada no motor (`weekly/components.ts`).
> - **DPD**: nome correto é o de ENVIO (com fallback para faturação quando vazio) ✔
>   aplicado; volumes/peso sobre o **SUBTOTAL** (fórmula do cliente:
>   `=SE(Subtotal<80;1;(SE(Subtotal<160;2;3)))`) ✔ aplicado; >160€ = 3 volumes ✔.
> - **Margem de compras**: +8% confirmado (equivale às 10g/componente).
> - **Parceiros**: Leiria vai ser substituída por **PORTO** (2ª feira, mesma regra de
>   confeção); emails Avenidas (Lisboa) recebidos — configurar na página Parceiros
>   (campo CC múltiplo: melhoria futura).
> - **Sessão de validação**: o Miguel ainda não conhece os mockups — enviar link.
> - Pergunta dele em aberto: volumes DPD por nº de itens? (análise feita: ver
>   POR-FAZER.md)

> 7 vídeos (walkthrough do processo manual, ~63 min) transcritos localmente com
> Whisper (transcrições em `docs/videos-cliente/`). Comparados com o PDF "Tarefas
> Semanais", o `ARCHITECTURE.md` e o código. 13 jul 2026.

## ✅ Confirmam (código já correto — nada a mudar)

| Tema | Vídeo | Evidência |
|---|---|---|
| Cut-off sexta 23:59, ciclo sábado→sexta | 1, 3 | *"às 23h59 de sexta-feira é o cut-off"*; *"ciclo de sábado a sexta"* |
| Encomendas não-pagas entram na produção | 3 | *"há casos não estão pagas ainda, mas vamos sempre produzá-las"* (staff confirma ao sábado) |
| DPD: peso = valor/20 | 7 | *"cada 20€ é 1kg... 82€ são mais ou menos 4kg"* |
| DPD: volume >80€ = 2 caixas | 7 | *"acima de 80€, já são duas caixas"* |
| DPD: conta com zero à frente + apóstrofo; sem nº cliente; código AT em branco | 7 | *"deixem este espaço em branco"* (AT vem do Moloni, não exportável) |
| DPD: telefone só telemóvel (sem fixo) | 7 | descreve tirar o fixo |
| Doses Low Carb/Bulk/Extra Bulk/Zero Carbs (vazio quando não existe) | 5 | matriz prato×dose |
| Etiquetas: 1 linha/refeição, sem tips/subscrições/embalagens, com data de confeção, ordenadas por prato | 6 | passo VBA + limpeza |
| Import CSV (Shopify→OpenOffice→Sheets) | 3 | o fluxo manual que `/app/importar` substitui |

## ⚠️ Gap corrigido no código

**Regra "mesmo dia da entrega".** Os vídeos mostram *"quando é recolha, é sempre no
próprio dia"* e que o calendário de produção passou a incluir **domingo** — que o
motor não conseguia exprimir (só tinha `2f/3f/4f` fixos + `vespera`). Adicionada a
regra `mesmo` (confeção = próprio dia de entrega), relativa à data, robusta a
qualquer calendário. Aditiva — golden test da w47 intacto.
Ficheiros: `weekly/types.ts`, `weekly/schedule.ts`, `definicoes/zonas.shared.ts`,
`pages/common.server.ts` (+ 4 testes).

## ➕ A confirmar com o Miguel (não alterado — decisão de negócio)

1. **Matriz definitiva entrega↔confeção.** Fontes divergem no calendário atual:
   - Vídeos (Miguel): produção **domingo / segunda / terça**; *"já não é a segunda,
     terça e quarta"*.
   - Site: entregas domingo a quarta.
   - António (arranque): domingo / segunda / quarta.
   - Histórico/w47: segunda / terça / quarta.
   O Miguel diz *"agora mudámos"* e prometeu **facultar a matriz**. Assim que chegar,
   configuram-se as zonas (cada uma → dia fixo / `vespera` / `mesmo`). O motor já suporta.
2. **Lisboa agora na véspera.** *"a Lisboa, segunda-feira passa também para domingo"* —
   confirmar que Lisboa (entrega segunda) passa a `vespera`.
3. **DPD: nome do destinatário — shipping ou billing?** Trecho do vídeo 7 ambíguo na
   transcrição. Hoje o export usa `shippingAddress.name`. Confirmar.
4. **Limiar de 160€ = 3 volumes.** O vídeo só confirma explicitamente o limiar dos 80€
   (2 volumes). O 160€→3 é consistente mas não foi dito; confirmar.

## Notas menores (sem ação)

- Ementa semanal com ~15 pratos; 2 coleções (atual + "seguinte"). Documentos guardados
  no **Dropbox** (não Drive). A lista por cliente no WhatsApp está a tornar-se redundante
  com o método das rotas — o Miguel diz que *"já não havia necessidade"*.
- O Miguel gostaria que a entrega interna de Coimbra fosse automática por código postal
  (hoje seleciona à mão) — ideia de melhoria futura.
