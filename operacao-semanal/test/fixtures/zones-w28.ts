import type {
  CourierConfig,
  ZoneConfig,
} from "../../app/services/weekly/types";

/**
 * Config de zonas/couriers do CALENDÁRIO NOVO — semana 28 de 2026.
 * (O primeiro golden, w47/2025, valida o calendário ANTIGO 2f/3f/4f;
 * este valida o novo: produção DOM / 2f / 3f — vídeos do cliente, 13 jul 2026,
 * docs/RECONCILIACAO-VIDEOS.md + docs/videos-cliente/04-folhas-por-dia.txt.)
 *
 * Regras ditas pelo cliente no vídeo 4 (o vídeo mostra o processo manual DA
 * PRÓPRIA w28 — o checkpoint "dá 1.254, 1.254, está tudo certo" é o total
 * desta semana):
 *   · "Portugal Continental passa sempre um dia para trás"        → vespera
 *   · "a Lisboa, segunda-feira passa também para domingo"         → vespera
 *   · "quando é recolha, é sempre no próprio dia"                 → mesmo
 *   · "domingo eu sei que vou confeccionar o próprio domingo"     → mesmo
 *   · "Leiria vai ser confecionado na segunda" (entrega Segunda)  → mesmo
 *   · "terça-feira, eu quero confecionar sim as coimbra e as do
 *      picape" (entregas Terça)                                   → mesmo
 *
 * Cobre TODAS as zonas distintas presentes em `w28-orders.json`
 * ("Horário de entrega"; contagens encomendas×dia e refeições×dia do fixture):
 *
 *   62×Ter + 6×Qua + 1×"Ter" c/ data errada 12/05/2026 (ver nota DPD)
 *                           "Portugal Continental 08-15h"        → DPD, vespera
 *   18×Dom + 8×Seg          "Lisboa (Centro da cidade) 19-23h"   → vespera (ver nota)
 *    7×Seg                  "Leiria (Centro da cidade) 18-21h"   → mesmo
 *   33×Ter                  "Coimbra (Centro da cidade) 18-23h"  → mesmo
 *    2×Seg                  "07:00 PM - 07:30 PM" (Store Pickup) → mesmo
 *   23×Ter                  "07:00 PM - 10:00 PM" (Store Pickup) → mesmo (slot NOVO)
 */

export const COURIERS_W28: CourierConfig[] = [
  { name: "DPD", type: "dpd", ordering: "manual" },
  { name: "Parceiro Lisboa", type: "partner", ordering: "postcode" },
  { name: "Parceiro Leiria", type: "partner", ordering: "postcode" },
  { name: "Interno Coimbra", type: "internal", ordering: "manual" },
  { name: "Recolha em loja", type: "internal", ordering: "manual" },
];

export const ZONES_W28: ZoneConfig[] = [
  // DPD nacional: recolha na VÉSPERA da entrega — regra INALTERADA do
  // calendário antigo ("Portugal Continental passa sempre um dia para trás").
  // Evidência w28: entrega Ter 14/07 (505 refeições) → confeção 2f · entrega
  // Qua 15/07 (41 refeições) → 3f. A encomenda #50902-LoV tem data de entrega
  // ERRADA 12/05/2026 (uma terça de MAIO; "o site permitiu-lhe escolher no
  // calendário uma data e não era suposto" — vídeo 4): vespera → 2f na mesma;
  // é uma subscrição (não-refeição), pelo que não afeta a cozinha — apenas o
  // nº de envios DPD (ver golden-w28.test.ts).
  {
    matchText: "Portugal Continental 08-15h",
    county: "Portugal Continental",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
  },

  // Lisboa: NOVO na w28 — "a Lisboa, segunda-feira passa também para domingo"
  // = vespera (era dia fixo 2f no calendário antigo/w47).
  // Evidência w28: 8×Seg 13/07 (70 refeições) → vespera → dom ✓ (bate com o
  // processo manual). MAS a zona também tem 18×Dom 12/07 (153 refeições), que
  // o operador confeciona no PRÓPRIO domingo ("domingo eu sei que vou
  // confeccionar o próprio domingo") — vespera manda-as para SÁBADO (wrap
  // dom→sab do motor), dia que não existe na produção real.
  // DECISÃO EMPÍRICA entre as duas regras exprimíveis numa só zona:
  //   · vespera: sab=153 + dom=70 · 2f=576 EXATO · 3f=444 (+4 explicado)
  //   · mesmo:   dom=153 · 2f=646 (+70 vs gabarito) · 3f=444
  // Escolhe-se "vespera": é a regra literal dita pelo cliente, acerta 2f/3f, e
  // o desvio fica confinado a UMA célula zona×dia (Lisboa×Domingo: 153
  // refeições em sab, véspera de dom — conservador, nunca em atraso). O
  // gabarito de domingo reconstrói-se por sab+dom: 153+70(+7 sem-atributos)
  // = 230 ✓. Desvio documentado ao detalhe no golden-w28.test.ts. Exprimir
  // "entregas de domingo confecionam no próprio dia" + "segunda passa para
  // domingo" na MESMA zona exigiria uma regra nova no motor (fora de âmbito).
  {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "vespera",
    courierName: "Parceiro Lisboa",
    active: true,
  },

  // Leiria: entrega Seg 13/07 (56 refeições) confecionada na própria segunda
  // ("Leiria vai ser confecionado na segunda") → mesmo → 2f ✓.
  // ("mesmo" em vez de dia fixo "2f": acompanha qualquer calendário futuro —
  // o parceiro vai ser substituído por PORTO com a mesma regra de confeção.)
  {
    matchText: "Leiria (Centro da cidade) 18-21h",
    county: "Leiria",
    confDay: "mesmo",
    courierName: "Parceiro Leiria",
    active: true,
  },

  // Coimbra interno: entrega Ter 14/07 (264 refeições) confecionada na própria
  // terça ("terça-feira, eu quero confecionar sim as coimbra e as do picape")
  // → mesmo → 3f ✓.
  {
    matchText: "Coimbra (Centro da cidade) 18-23h",
    county: "Coimbra",
    confDay: "mesmo",
    courierName: "Interno Coimbra",
    active: true,
  },

  // Recolhas em loja (Store Pickup, PR Coimbra): "quando é recolha, é sempre
  // no próprio dia" → mesmo, testado primeiro e confirmado à primeira:
  //   · slot 19:00-19:30 — 2×Seg 13/07 (15 refeições) → 2f ✓
  //   · slot 19:00-22:00 (NOVO na w28; na w47 era 19:00-21:00) —
  //     23×Ter 14/07 (139 refeições) → 3f ✓
  // Ao contrário da w47 (slot com dias mistos → dia fixo), na w28 cada slot
  // cai num único dia de entrega e "mesmo" reproduz o processo sem desvios.
  {
    matchText: "07:00 PM - 07:30 PM",
    county: "Coimbra",
    confDay: "mesmo",
    courierName: "Recolha em loja",
    active: true,
  },
  {
    matchText: "07:00 PM - 10:00 PM",
    county: "Coimbra",
    confDay: "mesmo",
    courierName: "Recolha em loja",
    active: true,
  },
];
