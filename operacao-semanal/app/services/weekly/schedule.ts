import type {
  ConfDay,
  OrderInput,
  ParsedDelivery,
  WindowConfig,
  ZoneConfig,
} from "./types";
import { WEEKDAY_TO_CONFDAY } from "./types";

const DAYS_IN_WEEK = 7;

/**
 * Faz match do texto de zona da encomenda ("Horário de entrega") com as zonas
 * configuradas na BD (regra 4.1).
 *
 * Match EXATO do `matchText` (com trim em ambos os lados) e apenas zonas
 * ativas. Devolve `undefined` quando não há correspondência — quem chama é
 * responsável por sinalizar a encomenda, nunca descartar em silêncio.
 */
export function matchZone(
  zona: string,
  zones: ZoneConfig[],
): ZoneConfig | undefined {
  const target = zona.trim();
  return zones.find((zone) => zone.active && zone.matchText.trim() === target);
}

/**
 * Resolve o dia de confeção de uma encomenda (regra 4.3):
 *
 * - Zonas com dia fixo ("2f" | "3f" | "4f") confecionam nesse dia, tal e qual.
 * - Zonas "vespera" (DPD nacional, recolhido na véspera da entrega) entram na
 *   produção do dia ANTERIOR ao de entrega — weekday-1 com wrap
 *   (domingo → sábado). Esta é a regra mais fácil de errar.
 * - Zonas "mesmo" (recolhas em loja e entregas locais confecionadas no dia)
 *   confecionam no PRÓPRIO dia de entrega. Confirmado nos vídeos do cliente:
 *   "quando é recolha, é sempre no próprio dia".
 *
 * O dia da semana é derivado da `deliveryDate` ISO (yyyy-mm-dd), nunca do
 * texto "Dia de entrega" — e a aritmética é feita em UTC para não depender
 * do timezone local do processo. As regras "vespera"/"mesmo" acompanham
 * qualquer calendário (incl. domingo) sem reconfiguração.
 */
export function resolveConfDay(
  zone: ZoneConfig,
  delivery: ParsedDelivery,
): ConfDay {
  if (zone.confDay === "vespera") {
    const deliveryWeekday = isoWeekday(delivery.deliveryDate);
    const eveWeekday = (deliveryWeekday + DAYS_IN_WEEK - 1) % DAYS_IN_WEEK;
    return WEEKDAY_TO_CONFDAY[eveWeekday];
  }
  if (zone.confDay === "mesmo") {
    return WEEKDAY_TO_CONFDAY[isoWeekday(delivery.deliveryDate)];
  }
  return zone.confDay;
}

/** "2025-11-25" → 2 (0=domingo … 6=sábado), calculado em UTC. */
function isoWeekday(isoDate: string): number {
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error(
      `Data de entrega inválida (esperado yyyy-mm-dd): "${isoDate}"`,
    );
  }
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(utcMs).getUTCDay();
}

/**
 * Aplica a janela de encomendas (regra 4.4): só entram encomendas com
 * `createdAt` dentro de [windowStart, windowEnd], INCLUSIVE em ambos os
 * extremos. A comparação é feita sobre instantes (epoch ms), pelo que
 * strings ISO com offsets diferentes são comparadas corretamente.
 *
 * As excluídas são devolvidas à parte para poderem ser sinalizadas na UI
 * (encomendas pós-fecho = ementa antiga). Encomendas com `createdAt`
 * ilegível vão para `excluded` — nunca entram por engano.
 *
 * Não muta os arrays de input.
 */
export function filterOrderWindow(
  orders: OrderInput[],
  window: WindowConfig,
): { inWindow: OrderInput[]; excluded: OrderInput[] } {
  const start = Date.parse(window.windowStart);
  const end = Date.parse(window.windowEnd);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(
      `Janela de encomendas inválida: "${window.windowStart}" → "${window.windowEnd}"`,
    );
  }

  const inWindow: OrderInput[] = [];
  const excluded: OrderInput[] = [];

  for (const order of orders) {
    const createdAt = Date.parse(order.createdAt);
    const isInside =
      !Number.isNaN(createdAt) && createdAt >= start && createdAt <= end;
    if (isInside) {
      inWindow.push(order);
    } else {
      excluded.push(order);
    }
  }

  return { inWindow, excluded };
}
