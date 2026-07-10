import type {
  OrderInput,
  ProcessedOrder,
  WindowConfig,
  ZoneConfig,
} from "./types";
import { parseNoteAttributes } from "./parse";
import { filterOrderWindow, matchZone, resolveConfDay } from "./schedule";

/** Issue emitida quando o bloco de Note Attributes falta ou não faz parse (4.1). */
export const ISSUE_MISSING_DELIVERY_ATTRS = "atributos-entrega-em-falta";

/** Prefixo da issue de zona sem correspondência na config: "zona-desconhecida:<texto>". */
export const ISSUE_UNKNOWN_ZONE_PREFIX = "zona-desconhecida:";

export interface PipelineResult {
  /** Uma entrada por encomenda dentro da janela — NUNCA se descarta nenhuma. */
  processed: ProcessedOrder[];
  /** Encomendas fora da janela (regra 4.4), à parte para sinalização na UI. */
  excludedByWindow: OrderInput[];
}

/**
 * Pipeline de entrada do motor: transforma as encomendas cruas do Shopify em
 * `ProcessedOrder[]` prontos para os módulos de output (cozinha, etiquetas,
 * compras, rotas, DPD). Ver ARCHITECTURE.md secções 4 e 6.
 *
 * Passos, por encomenda:
 *   1. `window` fornecida → `filterOrderWindow` (4.4); as fora-de-janela vão
 *      para `excludedByWindow` e não seguem no pipeline.
 *   2. `parseNoteAttributes` (4.1) → null ⇒ issue "atributos-entrega-em-falta".
 *   3. Com delivery: `matchZone` → undefined ⇒ issue "zona-desconhecida:<zona>".
 *   4. Com zona: `resolveConfDay` (4.3, incl. regra DPD-véspera).
 *
 * Devolve SEMPRE um `ProcessedOrder` por encomenda na janela — encomendas com
 * problemas ficam com `issues` preenchidas, nunca são descartadas em silêncio.
 *
 * Função pura: não muta `orders` nem `zones`.
 */
export function processOrders(
  orders: OrderInput[],
  zones: ZoneConfig[],
  window?: WindowConfig,
): PipelineResult {
  const { inWindow, excluded } = window
    ? filterOrderWindow(orders, window)
    : { inWindow: orders, excluded: [] as OrderInput[] };

  return {
    processed: inWindow.map((order) => processOrder(order, zones)),
    excludedByWindow: excluded,
  };
}

function processOrder(order: OrderInput, zones: ZoneConfig[]): ProcessedOrder {
  const delivery = parseNoteAttributes(order.customAttributes);
  if (delivery === null) {
    return { order, delivery: null, issues: [ISSUE_MISSING_DELIVERY_ATTRS] };
  }

  const zone = matchZone(delivery.zona, zones);
  if (zone === undefined) {
    return {
      order,
      delivery,
      issues: [`${ISSUE_UNKNOWN_ZONE_PREFIX}${delivery.zona}`],
    };
  }

  return {
    order,
    delivery,
    zone,
    confDay: resolveConfDay(zone, delivery),
    issues: [],
  };
}
