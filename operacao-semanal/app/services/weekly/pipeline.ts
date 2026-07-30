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

/**
 * Prefixo da issue de zona correspondida mas SEM estafeta atribuído:
 * "zona-sem-estafeta:<texto>". A encomenda entra na cozinha (tem confDay) mas
 * não apareceria em Rotas nem no CSV DPD — tem de ser sinalizada, nunca cair
 * em silêncio (ARCHITECTURE §10).
 */
export const ISSUE_ZONE_NO_COURIER = "zona-sem-estafeta:";

/**
 * Issue emitida quando a encomenda foi criada DEPOIS do fecho da janela mas o
 * operador optou por INCLUÍ-LA (AppConfig.ignoreAfterClose = false). A
 * encomenda ENTRA em todos os cálculos, mas fica assinalada para o operador
 * saber que não pertence à janela oficial — nunca em silêncio (ARCHITECTURE
 * §10). Com ignoreAfterClose = true (default) estas encomendas são excluídas a
 * montante (na query) e esta issue nunca aparece.
 */
export const ISSUE_AFTER_CLOSE = "encomenda-pos-fecho";

/**
 * Issue emitida quando a DATA DE ENTREGA da encomenda cai fora da janela
 * esperada de entregas (options.expectedDeliveryWindow). O site já deixou
 * escolher datas impossíveis (w28: uma data de maio; w30: datas passadas,
 * dentro da própria janela de encomendas). A encomenda ENTRA nos cálculos
 * (incluir-e-assinalar, como a pós-fecho — precedente w28: o operador
 * produziu-a na mesma), mas o operador tem de a ver — nunca em silêncio
 * (ARCHITECTURE §10).
 */
export const ISSUE_ANOMALOUS_DELIVERY = "data-entrega-anomala";

export interface PipelineResult {
  /** Uma entrada por encomenda dentro da janela — NUNCA se descarta nenhuma. */
  processed: ProcessedOrder[];
  /** Encomendas fora da janela (regra 4.4), à parte para sinalização na UI. */
  excludedByWindow: OrderInput[];
}

export interface ProcessOrdersOptions {
  /**
   * Instante ISO do fecho oficial da janela. Quando definido, cada encomenda
   * criada ESTRITAMENTE depois deste instante recebe também a issue
   * ISSUE_AFTER_CLOSE (mantendo as restantes issues). Ausente/undefined →
   * nenhuma marcação, i.e. comportamento clássico de excluir as pós-fecho.
   */
  markAfterClose?: string;
  /**
   * Janela esperada das DATAS DE ENTREGA, em ISO yyyy-mm-dd com limites
   * INCLUSIVOS. Quando presente e a encomenda tem delivery válido, uma data
   * de entrega < from ou > to recebe também a issue ISSUE_ANOMALOUS_DELIVERY
   * (mantendo as restantes issues). Ausente → nenhuma verificação.
   */
  expectedDeliveryWindow?: { from: string; to: string };
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
 * `options.markAfterClose` (ISO) assinala as encomendas pós-fecho sem as
 * descartar: as criadas depois desse instante ganham a issue ISSUE_AFTER_CLOSE
 * (além das que já tivessem) e continuam a entrar nos cálculos. Serve o modo
 * ignoreAfterClose = false (incluir-e-sinalizar); ausente, nada muda.
 *
 * `options.expectedDeliveryWindow` (ISO yyyy-mm-dd, inclusivo) assinala as
 * encomendas cuja data de ENTREGA cai fora da janela esperada com a issue
 * ISSUE_ANOMALOUS_DELIVERY — mesmo modelo incluir-e-assinalar; ausente, nada
 * muda.
 *
 * Função pura: não muta `orders` nem `zones`.
 */
export function processOrders(
  orders: OrderInput[],
  zones: ZoneConfig[],
  window?: WindowConfig,
  options?: ProcessOrdersOptions,
): PipelineResult {
  const { inWindow, excluded } = window
    ? filterOrderWindow(orders, window)
    : { inWindow: orders, excluded: [] as OrderInput[] };

  // Instante de fecho em epoch ms (NaN quando não há marcação a fazer). A
  // comparação sobre instantes trata offsets ISO diferentes corretamente.
  const afterCloseMs = options?.markAfterClose
    ? Date.parse(options.markAfterClose)
    : Number.NaN;

  const deliveryWindow = options?.expectedDeliveryWindow;

  return {
    processed: inWindow.map((order) => {
      const result = processOrder(order, zones);
      const marked = isAfterClose(order, afterCloseMs)
        ? withAfterCloseIssue(result)
        : result;
      return hasAnomalousDelivery(marked, deliveryWindow)
        ? withAnomalousDeliveryIssue(marked)
        : marked;
    }),
    excludedByWindow: excluded,
  };
}

/** true quando a encomenda foi criada estritamente depois do instante de fecho. */
function isAfterClose(order: OrderInput, afterCloseMs: number): boolean {
  if (Number.isNaN(afterCloseMs)) return false;
  const createdAt = Date.parse(order.createdAt);
  return !Number.isNaN(createdAt) && createdAt > afterCloseMs;
}

/** Devolve uma cópia com ISSUE_AFTER_CLOSE acrescentada (sem mutar o original). */
function withAfterCloseIssue(processed: ProcessedOrder): ProcessedOrder {
  return { ...processed, issues: [...processed.issues, ISSUE_AFTER_CLOSE] };
}

/**
 * true quando há janela esperada, a encomenda tem delivery válido e a data de
 * entrega cai fora dela (limites inclusivos). deliveryDate é sempre ISO
 * yyyy-mm-dd (garantido pelo parse), logo a comparação lexicográfica é segura.
 */
function hasAnomalousDelivery(
  processed: ProcessedOrder,
  window: { from: string; to: string } | undefined,
): boolean {
  if (window === undefined || processed.delivery === null) return false;
  const { deliveryDate } = processed.delivery;
  return deliveryDate < window.from || deliveryDate > window.to;
}

/** Cópia com ISSUE_ANOMALOUS_DELIVERY acrescentada (sem mutar o original). */
function withAnomalousDeliveryIssue(processed: ProcessedOrder): ProcessedOrder {
  return {
    ...processed,
    issues: [...processed.issues, ISSUE_ANOMALOUS_DELIVERY],
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

  // Zona correspondida mas sem estafeta → a encomenda produz-se na cozinha mas
  // ficaria fora de Rotas/DPD. Sinaliza, não descarta (§10).
  const issues = zone.courierName.trim()
    ? []
    : [`${ISSUE_ZONE_NO_COURIER}${zone.matchText}`];

  return {
    order,
    delivery,
    zone,
    confDay: resolveConfDay(zone, delivery),
    issues,
  };
}
