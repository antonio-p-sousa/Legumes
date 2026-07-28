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

**Bloqueado nas credenciais (não há mais a fazer sem elas):**
- 🔴 **Deployment** — alojar (Fly.io), migrar SQLite→Postgres, publicar config no Shopify.
  Preparado ao máximo: `fly.toml`, `.env.example`, schema Postgres verificado offline
  (`prisma/postgres-init.sql`), checklist final com stop points de conta/billing (DEPLOY.md).
- 🔴 **Ligação real testada** — plug-and-play: `SHOPIFY_SHOP`+`SHOPIFY_ADMIN_TOKEN` no
  `.env` → `npm run fetch-live` valida; a app passa a "live" sem código novo. Falta só
  validar (com a loja): downloads no iframe, rótulo da semana, fuso.

**Feito (interno, sem dependências):**
- ✅ **Rotas de câmara** — documento novo (28/07): motor + impressão landscape + export.
- ✅ **Incluir e assinalar pós-fecho** (`ignoreAfterClose=false`) — encomendas depois do
  fecho entram e ficam assinaladas (banner no cockpit) quando o operador escolhe incluir.
- ✅ **Histórico de semanas** (`/app/historico`) — lista/vê/elimina snapshots (WeekRun).
- ✅ **Envio de emails agnóstico** — interface + dry-run/preview construídos; o botão
  "Enviar rotas" mostra quem receberia. **Falta só a DECISÃO do serviço** (Brevo/Resend/
  SMTP) para ativar o envio real — depois pluga-se em minutos. Campo CC múltiplo já existe.
- ✅ **CI** (GitHub Actions), **manual do operador**, **de-risking Postgres**.

**Ainda por fazer (dependente):**
- 🟡 **Configurar zonas/parceiros reais** — quando vier a matriz: Porto (2ª), slot pickup
  "07:00 PM - 10:00 PM", Lisboa→vespera. É configuração na app (Definições), não código.
- 🟢 Botão "Gerar tudo" · validação de datas de entrega anómalas (nice-to-have).
- 🟢 **2ª FASE (Miguel)**: fichas por ingrediente + fornecedores + compras detalhadas —
  modelo Dish/Dose/RecipeLine + página de Fichas já existem à espera dos dados.

## ESTADO FINAL — trabalho Loop restante (29 jul 2026)

**Trabalho Loop restante = só integração real + piloto, ambos à espera de
credenciais/materiais.** Todo o trabalho interno sem dependências está feito, testado
(445 testes, CI verde) e no GitHub. O que falta, exatamente:

1. **Integração real** — precisa do **token da custom app** (dono da loja cria; instruções
   em `O_que_falta_legumes.docx`). Depois: `npm run fetch-live` → validar → deploy
   (Fly+Neon, precisa de **contas/billing** — decisão do António).
2. **Piloto** — precisa dos **materiais do Miguel** (matriz entrega↔confeção; opcional:
   ficheiro w28_Registo). Pode arrancar já por import de CSV assim que houver a matriz
   para configurar as zonas.
3. **Decisões da Loop** — serviço de email (ativa o envio real) + provider Postgres.

Nada disto é código à espera de ser escrito — é acessos, materiais e decisões.

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
