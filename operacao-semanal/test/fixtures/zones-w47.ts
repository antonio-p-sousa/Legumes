import type {
  CourierConfig,
  ZoneConfig,
} from "../../app/services/weekly/types";

/**
 * Config de zonas/couriers que reproduz o calendário legado da semana 47
 * (ARCHITECTURE.md 4.3 + processo manual real da w47).
 *
 * Cobre TODAS as zonas distintas presentes em `w47-orders.json`
 * ("Horário de entrega", contagens por "Dia de entrega"):
 *
 *   78×Ter + 9×Qua + 7×Qui  "Portugal Continental 08-15h"        → DPD, véspera
 *   29×Seg                  "Lisboa (Centro da cidade) 19-23h"    → 2f
 *    9×Seg                  "Leiria (Centro da cidade) 18-21h"    → 2f
 *   30×Ter                  "Coimbra (Centro da cidade) 18-23h"   → 3f
 *    3×Seg                  "07:00 PM - 07:30 PM"  (Store Pickup) → 2f
 *   18×Ter + 2×Qua          "07:00 PM - 09:00 PM"  (Store Pickup) → 3f (ver nota)
 */

export const COURIERS_W47: CourierConfig[] = [
  { name: "DPD", type: "dpd", ordering: "manual" },
  { name: "Parceiro Lisboa", type: "partner", ordering: "postcode" },
  { name: "Parceiro Leiria", type: "partner", ordering: "postcode" },
  { name: "Interno Coimbra", type: "internal", ordering: "manual" },
  { name: "Recolha em loja", type: "internal", ordering: "manual" },
];

export const ZONES_W47: ZoneConfig[] = [
  // DPD nacional: recolhido na VÉSPERA da entrega (regra 4.3) —
  // entrega Ter → confeção 2f · Qua → 3f · Qui → 4f.
  {
    matchText: "Portugal Continental 08-15h",
    county: "Portugal Continental",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
  },

  // Zonas locais: confeção no próprio dia de entrega.
  {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "2f",
    courierName: "Parceiro Lisboa",
    active: true,
  },
  {
    matchText: "Leiria (Centro da cidade) 18-21h",
    county: "Leiria",
    confDay: "2f",
    courierName: "Parceiro Leiria",
    active: true,
  },
  {
    matchText: "Coimbra (Centro da cidade) 18-23h",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Interno Coimbra",
    active: true,
  },

  // Recolha em loja (Store Pickup, PR Coimbra) — confeção no dia da recolha.
  // Slot 19:00-19:30: no fixture só aparece em entregas de SEGUNDA → 2f.
  {
    matchText: "07:00 PM - 07:30 PM",
    county: "Coimbra",
    confDay: "2f",
    courierName: "Recolha em loja",
    active: true,
  },
  // Slot 19:00-21:00: DECISÃO EMPÍRICA. No fixture cai 18×Terça e 2×Quarta
  // (#45118, #45128). Uma zona só admite UM confDay, por isso fixa-se "3f",
  // o dia certo para 18 das 20 encomendas. As 2 de Quarta ficam confecionadas
  // a 3f (um dia antes da recolha — conservador, nunca em atraso); no processo
  // manual real o operador pô-las na produção de 4f. Este desvio de 15
  // refeições 3f↔4f está documentado no golden test (golden-w47.test.ts).
  // "vespera" foi rejeitado: mandaria as 18 de Terça para 2f (≠ processo real).
  {
    matchText: "07:00 PM - 09:00 PM",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Recolha em loja",
    active: true,
  },
];
