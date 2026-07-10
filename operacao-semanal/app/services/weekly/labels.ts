import { WEEKDAY_TO_CONFDAY, isMealItem } from "./types";
import type { ConfDay, LabelRow, ProcessedOrder } from "./types";

/** Inverso de WEEKDAY_TO_CONFDAY: dia de confeção → weekday (0=dom … 6=sáb). */
const CONFDAY_TO_WEEKDAY: Record<ConfDay, number> = Object.fromEntries(
  Object.entries(WEEKDAY_TO_CONFDAY).map(([weekday, confDay]) => [
    confDay,
    Number(weekday),
  ]),
) as Record<ConfDay, number>;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/**
 * Gera as etiquetas de impressão: uma linha por refeição (regra 4.7).
 * Substitui o passo VBA manual de duplicação de linhas.
 *
 * Regras:
 * - Explode a quantidade: qty 3 → 3 linhas iguais.
 * - Só line items refeição; só encomendas com `confDay` resolvido (e com
 *   `delivery`, necessário para calcular a data de confeção).
 * - `dish` é o nome COMPLETO do line item, verbatim (com dose) — é o que
 *   se imprime na etiqueta.
 * - `client` = nome de envio, com fallback para o nome de faturação.
 * - `confDate` = data de confeção (yyyy-mm-dd): recua da data de entrega
 *   até ao weekday do `confDay` (0–6 dias), em aritmética UTC.
 * - Ordenação por confDate → dish → orderName (rotulagem por lote de prato).
 *
 * Função pura: não muta `orders`.
 */
export function buildLabels(orders: ProcessedOrder[]): LabelRow[] {
  const rows: LabelRow[] = [];

  for (const processed of orders) {
    if (processed.confDay === undefined || processed.delivery === null) {
      continue;
    }

    const confDate = resolveConfDate(
      processed.delivery.deliveryDate,
      processed.confDay,
    );
    const client =
      processed.order.shippingAddress?.name ?? processed.order.billingName ?? "";

    for (const item of processed.order.lineItems) {
      if (!isMealItem(item.name)) continue;

      for (let i = 0; i < item.quantity; i += 1) {
        rows.push({
          orderName: processed.order.name,
          dish: item.name,
          client,
          confDate,
        });
      }
    }
  }

  return rows.sort(
    (a, b) =>
      a.confDate.localeCompare(b.confDate) ||
      a.dish.localeCompare(b.dish, "pt") ||
      a.orderName.localeCompare(b.orderName, "pt"),
  );
}

/**
 * Data de confeção: parte da data de entrega (ISO yyyy-mm-dd) e recua até
 * ao weekday do dia de confeção — 0 dias se coincidirem, máx. 6.
 * Aritmética UTC sobre a string ISO para evitar surpresas de timezone/DST.
 */
function resolveConfDate(deliveryDate: string, confDay: ConfDay): string {
  const delivery = new Date(`${deliveryDate}T00:00:00Z`);
  const targetWeekday = CONFDAY_TO_WEEKDAY[confDay];
  const daysBack =
    (delivery.getUTCDay() - targetWeekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const confection = new Date(delivery.getTime() - daysBack * MS_PER_DAY);
  return confection.toISOString().slice(0, 10);
}
