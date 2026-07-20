/**
 * Costura comum dos loaders das páginas de operação (Semana, Cozinha,
 * Compras, Estafetas): BD → configs do motor → encomendas → ProcessedOrder[].
 *
 * As páginas NÃO falam com o Prisma nem com o Shopify diretamente para isto —
 * consomem loadWeekData e derivam o que precisam com o motor (buildKitchenMap,
 * buildRoutes, ...).
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminGraphqlClient } from "../orders/graphql.server";
import { fetchWeekOrders, type WeekOrders } from "../orders/provider.server";
import {
  COMPONENT_NAMES,
  processOrders,
  type ComponentFactor,
  type ComponentName,
  type ConfDayRule,
  type CourierConfig,
  type ProcessedOrder,
  type RecipeConfig,
  type ZoneConfig,
} from "../weekly";

export interface WeekData {
  processed: ProcessedOrder[];
  zones: ZoneConfig[];
  couriers: CourierConfig[];
  meta: Pick<WeekOrders, "source" | "weekLabel" | "windowStart" | "windowEnd" | "fetchedAt"> & {
    totalOrders: number;
    ordersSemAtributos: number;
    ordersZonaDesconhecida: number;
  };
}

const CONF_DAY_RULES: ReadonlySet<string> = new Set([
  "2f",
  "3f",
  "4f",
  "vespera",
  "mesmo",
]);

export async function loadEngineConfigs(prisma: PrismaClient): Promise<{
  zones: ZoneConfig[];
  couriers: CourierConfig[];
}> {
  const [zoneRows, courierRows] = await Promise.all([
    prisma.zone.findMany({ include: { courier: true } }),
    prisma.courier.findMany(),
  ]);

  const zones: ZoneConfig[] = zoneRows.map((z) => ({
    matchText: z.matchText,
    county: z.county,
    // valores fora do domínio (BD editada à mão) caem em "vespera" e são
    // detetáveis nos testes; o CRUD de zonas valida à entrada
    confDay: (CONF_DAY_RULES.has(z.confDay) ? z.confDay : "vespera") as ConfDayRule,
    courierName: z.courier?.name ?? "",
    active: z.active,
  }));

  const couriers: CourierConfig[] = courierRows.map((c) => ({
    name: c.name,
    type: c.type as CourierConfig["type"],
    email: c.email ?? undefined,
    ordering: c.ordering as CourierConfig["ordering"],
  }));

  return { zones, couriers };
}

export async function loadRecipes(
  prisma: PrismaClient,
): Promise<RecipeConfig[]> {
  const dishes = await prisma.dish.findMany({
    include: {
      doses: {
        where: { active: true },
        include: {
          ingredients: { include: { ingredient: { include: { supplier: true } } } },
        },
      },
    },
  });

  const recipes: RecipeConfig[] = [];
  for (const dish of dishes) {
    for (const dose of dish.doses) {
      if (dose.ingredients.length === 0) continue; // sem ficha → missingRecipes
      recipes.push({
        dish: dish.baseName,
        dose: dose.label,
        ingredients: dose.ingredients.map((line) => ({
          name: line.ingredient.name,
          qtyPerMeal: line.qtyPerMeal,
          unit: line.ingredient.unit as RecipeConfig["ingredients"][number]["unit"],
          supplier: line.ingredient.supplier?.name ?? "Sem fornecedor",
        })),
      });
    }
  }
  return recipes;
}

/**
 * Fatores de empratamento por componentes (BD → motor). O seed só escreve
 * componentes do domínio; linhas fora dele (BD editada à mão) são ignoradas —
 * o motor não saberia empratá-las e o CRUD futuro valida à entrada.
 */
export async function loadComponentFactors(
  prisma: PrismaClient,
): Promise<ComponentFactor[]> {
  const rows = await prisma.componentFactor.findMany({
    orderBy: [{ dose: "asc" }, { component: "asc" }],
  });

  return rows
    .filter((row): row is (typeof rows)[number] & { component: ComponentName } =>
      (COMPONENT_NAMES as readonly string[]).includes(row.component),
    )
    .map((row) => ({
      dose: row.dose,
      component: row.component,
      kgPerMeal: row.kgPerMeal,
    }));
}

/**
 * Carrega e processa a semana inteira. `admin` null → dados de demonstração.
 * Em modo demo NÃO aplicamos a janela de encomendas (a amostra w47 é uma
 * semana já fechada; o golden test estabeleceu este comportamento).
 */
export async function loadWeekData(
  prisma: PrismaClient,
  admin: AdminGraphqlClient | null,
): Promise<WeekData> {
  const [{ zones, couriers }, week] = await Promise.all([
    loadEngineConfigs(prisma),
    fetchWeekOrders(admin, prisma),
  ]);

  const { processed } = processOrders(week.orders, zones);

  return {
    processed,
    zones,
    couriers,
    meta: {
      source: week.source,
      weekLabel: week.weekLabel,
      windowStart: week.windowStart,
      windowEnd: week.windowEnd,
      fetchedAt: week.fetchedAt,
      totalOrders: processed.length,
      ordersSemAtributos: processed.filter((p) =>
        p.issues.some((i) => i.startsWith("atributos-entrega")),
      ).length,
      ordersZonaDesconhecida: processed.filter((p) =>
        p.issues.some((i) => i.startsWith("zona-desconhecida")),
      ).length,
    },
  };
}

/** Rótulos PT dos dias de confeção, partilhados pelas páginas de operação. */
export const CONF_DAY_PT: Record<string, string> = {
  "2f": "Segunda",
  "3f": "Terça",
  "4f": "Quarta",
  "5f": "Quinta",
  "6f": "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};
