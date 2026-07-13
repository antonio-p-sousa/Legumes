import type { PrismaClient } from "@prisma/client";

/**
 * Serviço de fichas técnicas (Dish / Dose / RecipeLine / Ingredient / Supplier).
 *
 * Todas as funções recebem o `PrismaClient` como 1.º argumento para permitir
 * testes contra uma BD SQLite descartável. Erros de validação são devolvidos
 * como `{ ok: false, errors: { campo: mensagem } }` — nunca atirados. Erros de
 * BD inesperados propagam para o ErrorBoundary da rota.
 */

// ── Constantes de domínio ─────────────────────────────────────────────────────
// Vivem em fichas.shared.ts para o componente da rota as poder importar sem
// depender de um módulo .server; re-exportadas aqui para service e testes.

import {
  DISH_CATEGORIES,
  INGREDIENT_UNITS,
  type DishCategory,
  type IngredientUnit,
} from "./fichas.shared";

export { DISH_CATEGORIES, INGREDIENT_UNITS } from "./fichas.shared";
export type { DishCategory, IngredientUnit } from "./fichas.shared";

// ── Tipos de resultado ────────────────────────────────────────────────────────

export type FieldErrors = Record<string, string>;

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors };

export type DishStatus = "completa" | "incompleta" | "sem-doses";

export interface DoseSummary {
  id: string;
  label: string;
  active: boolean;
  lineCount: number;
}

export interface DishListItem {
  id: string;
  baseName: string;
  category: string;
  doses: DoseSummary[];
  /** Estado derivado: doses INATIVAS não contam para a completude. */
  status: DishStatus;
  /** N.º de doses ativas sem qualquer ingrediente (para o badge "X doses sem ficha"). */
  activeDosesWithoutRecipe: number;
}

export interface DoseRecipe {
  dose: { id: string; label: string; active: boolean };
  dish: { id: string; baseName: string; category: string };
  lines: Array<{
    id: string;
    qtyPerMeal: number;
    ingredientName: string;
    unit: string;
    supplierName: string | null;
  }>;
}

export interface UpsertRecipeLineInput {
  doseId: string;
  ingredientName: string;
  unit: string;
  supplierName: string | null;
  qtyPerMeal: number;
}

// ── Pratos ────────────────────────────────────────────────────────────────────

export async function listDishes(prisma: PrismaClient): Promise<DishListItem[]> {
  const dishes = await prisma.dish.findMany({
    orderBy: [{ category: "asc" }, { baseName: "asc" }],
    include: {
      doses: {
        orderBy: { label: "asc" },
        include: { _count: { select: { ingredients: true } } },
      },
    },
  });

  return dishes.map((dish) => {
    const doses = dish.doses.map((dose) => ({
      id: dose.id,
      label: dose.label,
      active: dose.active,
      lineCount: dose._count.ingredients,
    }));
    const activeDosesWithoutRecipe = doses.filter(
      (dose) => dose.active && dose.lineCount === 0,
    ).length;
    const status: DishStatus =
      doses.length === 0
        ? "sem-doses"
        : activeDosesWithoutRecipe > 0
          ? "incompleta"
          : "completa";

    return {
      id: dish.id,
      baseName: dish.baseName,
      category: dish.category,
      doses,
      status,
      activeDosesWithoutRecipe,
    };
  });
}

interface DishInput {
  baseName: string;
  category: string;
}

interface ValidDishInput {
  baseName: string;
  category: DishCategory;
}

function validateDishInput(input: DishInput): ServiceResult<ValidDishInput> {
  const errors: FieldErrors = {};
  const baseName = input.baseName.trim();
  const category = input.category.trim();

  if (!baseName) {
    errors.baseName = "O nome do prato é obrigatório.";
  }
  if (!(DISH_CATEGORIES as readonly string[]).includes(category)) {
    errors.category = `Categoria inválida. Usa uma de: ${DISH_CATEGORIES.join(", ")}.`;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, data: { baseName, category: category as DishCategory } };
}

export async function createDish(
  prisma: PrismaClient,
  input: DishInput,
): Promise<ServiceResult<{ id: string; baseName: string; category: string }>> {
  const valid = validateDishInput(input);
  if (!valid.ok) return valid;

  const duplicate = await prisma.dish.findUnique({
    where: { baseName: valid.data.baseName },
  });
  if (duplicate) {
    return {
      ok: false,
      errors: {
        baseName: `Já existe um prato chamado "${valid.data.baseName}". Escolhe outro nome.`,
      },
    };
  }

  const dish = await prisma.dish.create({ data: valid.data });
  return {
    ok: true,
    data: { id: dish.id, baseName: dish.baseName, category: dish.category },
  };
}

export async function updateDish(
  prisma: PrismaClient,
  dishId: string,
  input: DishInput,
): Promise<ServiceResult<{ id: string; baseName: string; category: string }>> {
  const valid = validateDishInput(input);
  if (!valid.ok) return valid;

  const dish = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!dish) {
    return {
      ok: false,
      errors: { dishId: "Prato não encontrado. Atualiza a página e tenta de novo." },
    };
  }

  const duplicate = await prisma.dish.findUnique({
    where: { baseName: valid.data.baseName },
  });
  if (duplicate && duplicate.id !== dishId) {
    return {
      ok: false,
      errors: {
        baseName: `Já existe outro prato chamado "${valid.data.baseName}". Escolhe outro nome.`,
      },
    };
  }

  const updated = await prisma.dish.update({
    where: { id: dishId },
    data: valid.data,
  });
  return {
    ok: true,
    data: { id: updated.id, baseName: updated.baseName, category: updated.category },
  };
}

export async function deleteDish(
  prisma: PrismaClient,
  dishId: string,
): Promise<ServiceResult<{ baseName: string }>> {
  const dish = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!dish) {
    return {
      ok: false,
      errors: { dishId: "Prato não encontrado. Atualiza a página e tenta de novo." },
    };
  }

  // As doses e as linhas de ficha caem por cascade (onDelete: Cascade no schema).
  await prisma.dish.delete({ where: { id: dishId } });
  return { ok: true, data: { baseName: dish.baseName } };
}

// ── Doses ─────────────────────────────────────────────────────────────────────

export async function addDose(
  prisma: PrismaClient,
  dishId: string,
  label: string,
): Promise<ServiceResult<{ id: string; label: string }>> {
  const trimmed = label.trim();
  if (!trimmed) {
    return {
      ok: false,
      errors: { label: "O nome da dose é obrigatório (ex.: Low Carb, Bulk, 300g)." },
    };
  }

  const dish = await prisma.dish.findUnique({ where: { id: dishId } });
  if (!dish) {
    return {
      ok: false,
      errors: { dishId: "Prato não encontrado. Atualiza a página e tenta de novo." },
    };
  }

  const duplicate = await prisma.dose.findUnique({
    where: { dishId_label: { dishId, label: trimmed } },
  });
  if (duplicate) {
    return {
      ok: false,
      errors: {
        label: `O prato "${dish.baseName}" já tem a dose "${trimmed}".`,
      },
    };
  }

  const dose = await prisma.dose.create({ data: { dishId, label: trimmed } });
  return { ok: true, data: { id: dose.id, label: dose.label } };
}

export async function toggleDoseActive(
  prisma: PrismaClient,
  doseId: string,
): Promise<ServiceResult<{ id: string; label: string; active: boolean }>> {
  const dose = await prisma.dose.findUnique({ where: { id: doseId } });
  if (!dose) {
    return {
      ok: false,
      errors: { doseId: "Dose não encontrada. Atualiza a página e tenta de novo." },
    };
  }

  const updated = await prisma.dose.update({
    where: { id: doseId },
    data: { active: !dose.active },
  });
  return {
    ok: true,
    data: { id: updated.id, label: updated.label, active: updated.active },
  };
}

export async function deleteDose(
  prisma: PrismaClient,
  doseId: string,
): Promise<ServiceResult<{ label: string }>> {
  const dose = await prisma.dose.findUnique({ where: { id: doseId } });
  if (!dose) {
    return {
      ok: false,
      errors: { doseId: "Dose não encontrada. Atualiza a página e tenta de novo." },
    };
  }

  // As linhas da ficha caem por cascade (onDelete: Cascade no schema).
  await prisma.dose.delete({ where: { id: doseId } });
  return { ok: true, data: { label: dose.label } };
}

// ── Ficha técnica (linhas) ────────────────────────────────────────────────────

export async function getDoseRecipe(
  prisma: PrismaClient,
  doseId: string,
): Promise<DoseRecipe | null> {
  const dose = await prisma.dose.findUnique({
    where: { id: doseId },
    include: {
      dish: true,
      ingredients: {
        orderBy: { ingredient: { name: "asc" } },
        include: { ingredient: { include: { supplier: true } } },
      },
    },
  });
  if (!dose) return null;

  return {
    dose: { id: dose.id, label: dose.label, active: dose.active },
    dish: {
      id: dose.dish.id,
      baseName: dose.dish.baseName,
      category: dose.dish.category,
    },
    lines: dose.ingredients.map((line) => ({
      id: line.id,
      qtyPerMeal: line.qtyPerMeal,
      ingredientName: line.ingredient.name,
      unit: line.ingredient.unit,
      supplierName: line.ingredient.supplier?.name ?? null,
    })),
  };
}

function validateRecipeLineInput(
  input: UpsertRecipeLineInput,
): ServiceResult<{ ingredientName: string; unit: IngredientUnit; supplierName: string | null }> {
  const errors: FieldErrors = {};
  const ingredientName = input.ingredientName.trim();
  const unit = input.unit.trim();
  const supplierName = input.supplierName?.trim() || null;

  if (!ingredientName) {
    errors.ingredientName = "O nome do ingrediente é obrigatório.";
  }
  if (!(INGREDIENT_UNITS as readonly string[]).includes(unit)) {
    errors.unit = `Unidade inválida. Usa uma de: ${INGREDIENT_UNITS.join(", ")}.`;
  }
  if (!Number.isFinite(input.qtyPerMeal) || input.qtyPerMeal <= 0) {
    errors.qtyPerMeal =
      "A quantidade por refeição tem de ser um número maior que zero (ex.: 0.25).";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: { ingredientName, unit: unit as IngredientUnit, supplierName },
  };
}

/**
 * Cria/atualiza a linha da ficha para (dose, ingrediente).
 *
 * - O ingrediente é reutilizado pelo nome; se não existir, é criado.
 * - A unidade vive no ingrediente: um pedido com unidade diferente da do
 *   ingrediente existente devolve um erro estruturado, não altera nada.
 * - O fornecedor é criado on-the-fly se não existir; quando indicado,
 *   passa a ser o fornecedor do ingrediente (o fornecedor vive no ingrediente).
 */
export async function upsertRecipeLine(
  prisma: PrismaClient,
  input: UpsertRecipeLineInput,
): Promise<ServiceResult<{ lineId: string; ingredientName: string }>> {
  const valid = validateRecipeLineInput(input);
  if (!valid.ok) return valid;
  const { ingredientName, unit, supplierName } = valid.data;

  const dose = await prisma.dose.findUnique({ where: { id: input.doseId } });
  if (!dose) {
    return {
      ok: false,
      errors: { doseId: "Dose não encontrada. Atualiza a página e tenta de novo." },
    };
  }

  let supplierId: string | null = null;
  if (supplierName) {
    const supplier = await prisma.supplier.upsert({
      where: { name: supplierName },
      update: {},
      create: { name: supplierName },
    });
    supplierId = supplier.id;
  }

  const existing = await prisma.ingredient.findUnique({
    where: { name: ingredientName },
  });

  let ingredientId: string;
  if (existing) {
    if (existing.unit !== unit) {
      return {
        ok: false,
        errors: {
          unit:
            `O ingrediente "${ingredientName}" já existe com a unidade "${existing.unit}". ` +
            `A unidade pertence ao ingrediente: escolhe "${existing.unit}" ou usa outro nome de ingrediente.`,
        },
      };
    }
    ingredientId = existing.id;
    if (supplierId && existing.supplierId !== supplierId) {
      await prisma.ingredient.update({
        where: { id: existing.id },
        data: { supplierId },
      });
    }
  } else {
    const created = await prisma.ingredient.create({
      data: { name: ingredientName, unit, supplierId },
    });
    ingredientId = created.id;
  }

  const line = await prisma.recipeLine.upsert({
    where: { doseId_ingredientId: { doseId: input.doseId, ingredientId } },
    update: { qtyPerMeal: input.qtyPerMeal },
    create: { doseId: input.doseId, ingredientId, qtyPerMeal: input.qtyPerMeal },
  });

  return { ok: true, data: { lineId: line.id, ingredientName } };
}

export async function removeRecipeLine(
  prisma: PrismaClient,
  lineId: string,
): Promise<ServiceResult<{ ingredientName: string }>> {
  const line = await prisma.recipeLine.findUnique({
    where: { id: lineId },
    include: { ingredient: true },
  });
  if (!line) {
    return {
      ok: false,
      errors: { lineId: "Linha da ficha não encontrada. Atualiza a página e tenta de novo." },
    };
  }

  await prisma.recipeLine.delete({ where: { id: lineId } });
  return { ok: true, data: { ingredientName: line.ingredient.name } };
}
