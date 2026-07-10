import type {
  ProcessedOrder,
  PurchaseLine,
  PurchaseList,
  RecipeConfig,
  SupplierPurchase,
} from "./types";
import { isMealItem } from "./types";
import { splitDishDose } from "./parse";

/**
 * Lista de compras (regra 4.5):
 *
 *   compras = Σ (ficha técnica × quantidade vendida) × (1 + margem)
 *
 * Para cada line item refeição de encomendas com dia de confeção resolvido,
 * separa (prato, dose), procura a ficha técnica com match exato e agrega as
 * quantidades por (fornecedor, ingrediente). A margem aplica-se sobre o total
 * agregado e o arredondamento (3 casas) só acontece no fim — nunca durante a
 * agregação, para não acumular erro.
 *
 * Pratos vendidos sem ficha técnica vão para `missingRecipes` com o total de
 * unidades vendidas — NUNCA descartar em silêncio, senão as compras ficam
 * curtas (4.5 / secção 10).
 */
export function buildPurchaseList(
  orders: ProcessedOrder[],
  recipes: RecipeConfig[],
  margin: number,
): PurchaseList {
  const recipeIndex = buildRecipeIndex(recipes);

  /** supplier → ingredient → acumulador (unidade vem da ficha técnica) */
  const bySupplier = new Map<string, Map<string, IngredientAccumulator>>();
  /** "dish␟dose" → prato vendido sem ficha técnica */
  const missing = new Map<
    string,
    { dish: string; dose: string; unitsSold: number }
  >();

  for (const processed of orders) {
    if (!processed.confDay) continue;

    for (const item of processed.order.lineItems) {
      if (!isMealItem(item.name)) continue;

      const { base, dose } = splitDishDose(item.name);
      const recipe = recipeIndex.get(dishDoseKey(base, dose));

      if (!recipe) {
        accumulateMissing(missing, base, dose, item.quantity);
        continue;
      }

      for (const ingredient of recipe.ingredients) {
        accumulateIngredient(
          bySupplier,
          ingredient.supplier,
          ingredient.name,
          ingredient.unit,
          ingredient.qtyPerMeal * item.quantity,
        );
      }
    }
  }

  return {
    suppliers: toSortedSuppliers(bySupplier, margin),
    missingRecipes: toSortedMissing(missing),
  };
}

// ── Internos ─────────────────────────────────────────────────────────────────

interface IngredientAccumulator {
  unit: string;
  required: number;
}

/** Separador improvável em nomes de pratos/doses (U+241F, symbol for unit separator). */
const KEY_SEPARATOR = "␟";

function dishDoseKey(dish: string, dose: string): string {
  return `${dish}${KEY_SEPARATOR}${dose}`;
}

function buildRecipeIndex(
  recipes: RecipeConfig[],
): Map<string, RecipeConfig> {
  const index = new Map<string, RecipeConfig>();
  for (const recipe of recipes) {
    index.set(dishDoseKey(recipe.dish, recipe.dose), recipe);
  }
  return index;
}

function accumulateMissing(
  missing: Map<string, { dish: string; dose: string; unitsSold: number }>,
  dish: string,
  dose: string,
  quantity: number,
): void {
  const key = dishDoseKey(dish, dose);
  const current = missing.get(key);
  missing.set(
    key,
    current
      ? { ...current, unitsSold: current.unitsSold + quantity }
      : { dish, dose, unitsSold: quantity },
  );
}

function accumulateIngredient(
  bySupplier: Map<string, Map<string, IngredientAccumulator>>,
  supplier: string,
  ingredient: string,
  unit: string,
  quantity: number,
): void {
  const ingredients =
    bySupplier.get(supplier) ?? new Map<string, IngredientAccumulator>();
  if (!bySupplier.has(supplier)) bySupplier.set(supplier, ingredients);

  const current = ingredients.get(ingredient);
  ingredients.set(
    ingredient,
    current
      ? { ...current, required: current.required + quantity }
      : { unit, required: quantity },
  );
}

function toSortedSuppliers(
  bySupplier: Map<string, Map<string, IngredientAccumulator>>,
  margin: number,
): SupplierPurchase[] {
  return [...bySupplier.entries()]
    .sort(([a], [b]) => comparePt(a, b))
    .map(([supplier, ingredients]) => ({
      supplier,
      lines: [...ingredients.entries()]
        .sort(([a], [b]) => comparePt(a, b))
        .map(
          ([ingredient, acc]): PurchaseLine => ({
            ingredient,
            unit: acc.unit,
            required: round3(acc.required),
            withMargin: round3(acc.required * (1 + margin)),
          }),
        ),
    }));
}

function toSortedMissing(
  missing: Map<string, { dish: string; dose: string; unitsSold: number }>,
): PurchaseList["missingRecipes"] {
  return [...missing.values()].sort(
    (a, b) => comparePt(a.dish, b.dish) || comparePt(a.dose, b.dose),
  );
}

function comparePt(a: string, b: string): number {
  return a.localeCompare(b, "pt");
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
