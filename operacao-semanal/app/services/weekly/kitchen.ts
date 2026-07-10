import { isMealItem } from "./types";
import type {
  ConfDay,
  KitchenDay,
  KitchenMap,
  KitchenRow,
  ProcessedOrder,
} from "./types";
import { splitDishDose } from "./parse";

/**
 * Ordem de apresentação dos dias de confeção no mapa de cozinha.
 * (2ª a 4ª são os dias normais de produção; os restantes só aparecem se
 * existirem encomendas resolvidas para eles.)
 */
const CONF_DAY_ORDER: readonly ConfDay[] = [
  "2f",
  "3f",
  "4f",
  "5f",
  "6f",
  "sab",
  "dom",
];

/** Chave de agregação (prato base, dose) — JSON evita colisões de separador. */
function toKey(dish: string, dose: string): string {
  return JSON.stringify([dish, dose]);
}

function fromKey(key: string): { dish: string; dose: string } {
  const [dish, dose] = JSON.parse(key) as [string, string];
  return { dish, dose };
}

/**
 * Constrói o mapa de produção da cozinha (pivot prato × dose × dia de
 * confeção → quantidades). Ver ARCHITECTURE.md secções 4.3 e 6.
 *
 * Regras:
 * - Só entram encomendas com `confDay` resolvido (as restantes já foram
 *   sinalizadas em `issues` a montante — nunca descartadas em silêncio aqui).
 * - Só line items refeição (`isMealItem`) entram nos dias; os restantes
 *   (subscrições, embalagens, tips, vouchers) são agregados à parte em
 *   `nonMeal`, para a semana inteira.
 * - Quantidades agregadas por (confDay, prato base, dose).
 * - `rows` ordenadas por prato e depois dose; `days` pela sequência
 *   2f → 3f → 4f → 5f → 6f → sab → dom.
 *
 * Função pura: não muta `orders`.
 */
export function buildKitchenMap(orders: ProcessedOrder[]): KitchenMap {
  const validOrders = orders.filter((o) => o.confDay !== undefined);

  const mealsByDay = new Map<ConfDay, Map<string, number>>();
  const nonMealTotals = new Map<string, number>();

  for (const processed of validOrders) {
    const confDay = processed.confDay as ConfDay;

    for (const item of processed.order.lineItems) {
      const { base, dose } = splitDishDose(item.name);
      const key = toKey(base, dose);

      if (isMealItem(item.name)) {
        const dayTotals = getOrCreateDayTotals(mealsByDay, confDay);
        dayTotals.set(key, (dayTotals.get(key) ?? 0) + item.quantity);
      } else {
        nonMealTotals.set(key, (nonMealTotals.get(key) ?? 0) + item.quantity);
      }
    }
  }

  const days: KitchenDay[] = CONF_DAY_ORDER.filter((confDay) =>
    mealsByDay.has(confDay),
  ).map((confDay) => {
    const rows = toSortedRows(mealsByDay.get(confDay) as Map<string, number>);
    const totalMeals = rows.reduce((sum, row) => sum + row.quantity, 0);
    return { confDay, totalMeals, rows };
  });

  const totalMeals = days.reduce((sum, day) => sum + day.totalMeals, 0);

  return {
    days,
    totalMeals,
    nonMeal: toSortedRows(nonMealTotals),
  };
}

function getOrCreateDayTotals(
  mealsByDay: Map<ConfDay, Map<string, number>>,
  confDay: ConfDay,
): Map<string, number> {
  const existing = mealsByDay.get(confDay);
  if (existing) return existing;

  const created = new Map<string, number>();
  mealsByDay.set(confDay, created);
  return created;
}

/** Converte o acumulador (chave (base, dose) → qty) em rows ordenadas. */
function toSortedRows(totals: Map<string, number>): KitchenRow[] {
  return [...totals.entries()]
    .map(([key, quantity]) => ({ ...fromKey(key), quantity }))
    .sort(
      (a, b) =>
        a.dish.localeCompare(b.dish, "pt") ||
        a.dose.localeCompare(b.dose, "pt"),
    );
}
