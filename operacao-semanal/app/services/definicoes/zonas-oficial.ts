/**
 * Configuração OFICIAL de zonas e estafetas — "Matriz de entrega vs. confeção"
 * enviada pelo cliente a 03/08/2026 (PDF na pasta do projeto) + áudios do
 * mesmo dia ("lógica 0 = confeção no próprio dia; -1 = no dia anterior";
 * "as entregas de domingo são confecionadas NO PRÓPRIO DIA").
 *
 * Calendário oficial (entrega → confeção):
 *   dom  Lisboa 19-23h           → dom  (0)   ┐ ambas caem no domingo →
 *   seg  Lisboa 19-23h           → dom  (-1)  ┘ zona = dia fixo "dom"
 *   seg  Leiria 18-21h           → seg  (0)   → "mesmo"
 *   ter  Portugal Continental    → seg  (-1)  ┐ DPD recolhe na véspera →
 *   qua  Portugal Continental    → ter  (-1)  ┘ "vespera"
 *   ter  Coimbra 18-23h          → ter  (0)   → "mesmo"
 *   ter  Pickup Coimbra 07-10PM  → ter  (0)   ┐ ambos caem na terça →
 *   qua  Pickup Coimbra 07-10PM  → ter  (-1)  ┘ zona = dia fixo "3f"
 *   (CORRIGIDO 05/08 — WhatsApp do cliente: "o primeiro dia de pickup estava
 *    errado, é confecionado no próprio dia" + matriz refeita. Fecha o ponto
 *    de vigilância: a prática da w28 estava certa.)
 *
 * Este ficheiro alimenta o seed (instalações novas). A fixture zones-w47/w28
 * fica INTOCADA — documenta o processo empírico dessas semanas (golden tests).
 */
import type { CourierConfig, ZoneConfig } from "../weekly/types";

export const COURIERS_OFICIAL: CourierConfig[] = [
  { name: "DPD", type: "dpd", ordering: "manual" },
  { name: "Parceiro Lisboa", type: "partner", ordering: "postcode" },
  { name: "Parceiro Leiria", type: "partner", ordering: "postcode" },
  { name: "Interno Coimbra", type: "internal", ordering: "manual" },
  { name: "Recolha em loja", type: "internal", ordering: "manual" },
];

export const ZONES_OFICIAL: ZoneConfig[] = [
  {
    matchText: "Portugal Continental 08-15h",
    county: "Portugal Continental",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
  },
  {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "dom",
    courierName: "Parceiro Lisboa",
    active: true,
  },
  {
    matchText: "Leiria (Centro da cidade) 18-21h",
    county: "Leiria",
    confDay: "mesmo",
    courierName: "Parceiro Leiria",
    active: true,
  },
  {
    matchText: "Coimbra (Centro da cidade) 18-23h",
    county: "Coimbra",
    confDay: "mesmo",
    courierName: "Interno Coimbra",
    active: true,
  },
  // Slot de pickup ATUAL (o único na matriz oficial): dia fixo TERÇA — o de
  // terça no próprio dia (0) e o de quarta na véspera (-1), ambos → 3f.
  {
    matchText: "07:00 PM - 10:00 PM",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Recolha em loja",
    active: true,
  },
  // Slots de pickup ANTIGOS — mantidos ativos para encomendas antigas/histórico,
  // com a mesma regra oficial de pickup (terça).
  {
    matchText: "07:00 PM - 07:30 PM",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Recolha em loja",
    active: true,
  },
  {
    matchText: "07:00 PM - 09:00 PM",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Recolha em loja",
    active: true,
  },
];
