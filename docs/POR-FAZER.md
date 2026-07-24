# POR FAZER — Operação Semanal (LOV)

> Checklist completo até ao go-live. Atualizado a **20 jul 2026** (pós-respostas do
> Miguel). Legenda: 🔴 bloqueia · 🟡 importante · 🟢 nice-to-have

## Do lado do cliente (Miguel)

- 🔴 **Matriz definitiva entrega↔confeção** — prometida nos vídeos ("aquela matriz que
  posso facultar"). Dados da w28/2026 confirmam entregas dom/seg/ter/qua com produção
  dom/seg/ter; falta a matriz oficial para configurar as zonas. O motor já suporta
  (dia fixo / véspera / mesmo dia). **Pergunta específica descoberta no golden w28:**
  as entregas de Lisboa de DOMINGO são confecionadas no sábado ou no próprio domingo?
  (o operador junta-as ao domingo; "véspera" daria sábado — se a resposta for
  "domingo→mesmo dia + segunda→véspera" na mesma zona, o motor precisa de uma regra
  composta nova, ~meio dia de trabalho)
- 🟡 **Ficheiro "w28_Registo e contabilização dos pratos"** — referido no email mas
  **não chegou na pasta** (só vieram o CSV e as Etiquetas da w28 + imagens de
  assinatura). Reenviar. A tabela de fatores por dose chegou por screenshot e já está
  implementada.
- 🟡 **Email do parceiro do PORTO** — quando a troca Leiria→Porto acontecer.
- 🟡 **Sessão de 30 min para validar os ecrãs** — o Miguel ainda não viu os mockups
  da app; enviar o link primeiro.
- 🟢 Decisão sobre volumes DPD por nº de itens (ver análise abaixo).

### Resolvido pelo Miguel a 20 jul ✔
- ~~Fichas técnicas por ingrediente~~ → **2ª fase** (1ª fase usa componentes — feito)
- ~~Lista de fornecedores~~ → 2ª fase (ligada às fichas)
- ~~DPD nome/volumes~~ → envio + subtotal (aplicado no código)
- ~~Margem de compras~~ → +8% / 10g por componente (aplicado)
- ~~Emails parceiro Lisboa~~ → recebidos (Avenidas)
- ~~Cut-off / dias~~ → confirmados nos vídeos + dados w28

## Do lado da Loop — acessos

- 🔴 **Credenciais da custom app** (Admin API token + key/secret) → ligação live
- 🟡 **Development store** na conta Partners

## Do lado da Loop — trabalho técnico

- 🔴 **Deployment** — alojar (Vercel/Fly), migrar SQLite→Postgres, publicar config
  da app no Shopify. Sem isto a app só corre em dev.
- 🔴 **Ligação real testada** — o GraphQL nunca correu contra a loja verdadeira
  (depende das credenciais). Validar: downloads no iframe, rótulo da semana, fuso.
- 🟡 **Envio de emails aos parceiros** — feature por construir; requer decisão do
  serviço (Brevo/Resend/SMTP) + campo CC múltiplo no Courier (Avenidas usa 3 CCs).
- 🟡 **Configurar zonas/parceiros reais** — quando vier a matriz: Porto (2ª, vespera?),
  novo slot pickup "07:00 PM - 10:00 PM" (mudou de texto vs 2025!), Lisboa→vespera.
- 🟡 **Janela de encomendas — modo "incluir e sinalizar"** (`ignoreAfterClose=false`):
  o cutoff configurado já é aplicado no modo live (fix 20/07), mas o switch
  "excluir vs incluir-e-sinalizar as pós-fecho" ainda não é honrado (a janela é
  sempre imposta na query GraphQL).
- 🟢 **Histórico de semanas** (ecrã) · botão "Gerar tudo" · validação de datas de
  entrega anómalas (w28 tinha uma encomenda com data 12/05 numa semana de julho).
- 🟢 **2ª FASE (nova, definida pelo Miguel)**: fichas técnicas por ingrediente +
  fornecedores + lista de compras detalhada — o modelo Dish/Dose/RecipeLine e a
  página de Fichas já existem à espera disto.

## Decisões em aberto (Loop)

- Serviço de email · Alojamento/Postgres de produção

## Validação e go-live

- 🔴 **Piloto** 1-2 semanas em paralelo com o processo manual (pode começar JÁ via
  importação de CSV — sem credenciais nem deployment)
- 🟡 Validação dos ecrãs com o Miguel · formação breve · go-live

## Análise: volumes DPD por nº de itens (pergunta do Miguel)

Sobre os 94 envios Continental reais da w47: **"1 volume por cada 13 refeições"
(arredondado para cima, máx. 3) concorda com a regra dos 80€ em 94% dos casos**;
as 6 divergências dão sempre MENOS um volume (encomendas caras com poucos itens —
pokes/Extra Bulk). Como subfaturar volumes obriga a nova guia ("se temos que cobrar,
nunca temos"), recomendação: manter a regra dos 80€ por defeito; a regra por itens é
viável como opção, idealmente híbrida (o MAIOR dos dois valores) para nunca ficar
curta. A decidir com o Miguel.
