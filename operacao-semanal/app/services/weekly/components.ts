/**
 * Modelo de COMPONENTES do empratamento (1.ª fase — sem fichas técnicas por
 * ingrediente, que ficam para a 2.ª fase): cada dose tem um fator em kg por
 * componente (Proteína/Hidratos/Legumes) e a cozinha emprata com base nesses
 * kg. Réplica da folha "Registo e contabilização dos pratos" do cliente.
 *
 * Função pura, sem I/O — os fatores vêm da BD (tabela ComponentFactor) via
 * loaders (app/services/pages/common.server.ts → loadComponentFactors).
 */
import { isMealItem } from "./types";
import type { ConfDay, ProcessedOrder } from "./types";
import { splitDishDose } from "./parse";

// ── Tipos ────────────────────────────────────────────────────────────────────

export const COMPONENT_NAMES = ["Proteína", "Hidratos", "Legumes"] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];

/** Fator de empratamento: kg de um componente por 1 refeição de uma dose. */
export interface ComponentFactor {
  dose: string;
  component: ComponentName;
  kgPerMeal: number;
}

export interface ComponentPlanDay {
  confDay: ConfDay;
  /** kg por componente no dia, arredondados a 3 casas. */
  kg: Record<ComponentName, number>;
  /** Refeições incluídas no cálculo (doses com fator) neste dia. */
  meals: number;
}

/** Dose vendida sem qualquer fator — fora do cálculo, mas nunca silenciada. */
export interface ComponentSkipped {
  dose: string;
  units: number;
}

export interface ComponentPlan {
  /** Só dias com refeições com fator, ordenados 2f → 3f → ... → dom. */
  days: ComponentPlanDay[];
  /** kg por componente na semana inteira, arredondados a 3 casas. */
  totals: Record<ComponentName, number>;
  /**
   * Doses SEM QUALQUER fator (ex.: "Dose Única" de pizza/sopa/sobremesa),
   * agregadas com unidades. Não é erro — o empratamento por componentes não
   * se aplica — mas sinaliza-se sempre. Dose com fator 0 explícito
   * (Zero Carbs/Hidratos) NÃO entra aqui.
   */
  skipped: ComponentSkipped[];
}

// ── Fatores por omissão ──────────────────────────────────────────────────────

/**
 * Tabela de fatores fornecida pelo cliente (screenshot de 20 jul 2026, folha
 * "Registo e contabilização dos pratos"): [dose, Proteína, Hidratos, Legumes]
 * em kg por refeição.
 *
 * Os valores JÁ INCLUEM a margem de 10 g (0,010 kg) por componente — NUNCA
 * aplicar margem adicional. Zero Carbs tem Hidratos = 0 de propósito (não é
 * fator em falta).
 */
const FACTOR_TABLE: ReadonlyArray<
  readonly [dose: string, proteina: number, hidratos: number, legumes: number]
> = [
  ["Low Carb", 0.11, 0.1, 0.09],
  ["Bulk", 0.16, 0.145, 0.13],
  ["Extra Bulk", 0.21, 0.19, 0.17],
  ["Zero Carbs", 0.16, 0, 0.16],
  ["300g", 0.11, 0.11, 0.11],
  ["450g", 0.16, 0.16, 0.16],
  ["Dose M", 0.105, 0.105, 0.135],
  ["Dose XL", 0.155, 0.185, 0.235],
];

export const DEFAULT_COMPONENT_FACTORS: readonly ComponentFactor[] =
  FACTOR_TABLE.flatMap(
    ([dose, proteina, hidratos, legumes]): ComponentFactor[] => [
      { dose, component: "Proteína", kgPerMeal: proteina },
      { dose, component: "Hidratos", kgPerMeal: hidratos },
      { dose, component: "Legumes", kgPerMeal: legumes },
    ],
  );

// ── Normalização de doses ────────────────────────────────────────────────────

/**
 * Normaliza a dose de um line item para o nome usado na tabela de fatores:
 * as variantes de poke ("M arroz"/"XL quinoa" vindas de splitDishDose, ou
 * "M (arroz)"/"XL (quinoa)") colapsam em "Dose M"/"Dose XL" — os fatores de
 * poke não distinguem arroz de quinoa. As restantes doses ficam tal e qual.
 */
export function normalizeDoseForFactors(dose: string): string {
  const match = dose
    .trim()
    .match(/^(M|XL)\s*\(?\s*(?:com\s+)?(?:arroz|quinoa)\s*\)?$/i);
  if (!match) return dose;
  return match[1].toUpperCase() === "XL" ? "Dose XL" : "Dose M";
}

// ── Plano de componentes ─────────────────────────────────────────────────────

/** Mesma ordem de apresentação dos dias de confeção do kitchen.ts. */
const CONF_DAY_ORDER: readonly ConfDay[] = [
  "2f",
  "3f",
  "4f",
  "5f",
  "6f",
  "sab",
  "dom",
];

const KG_DECIMALS = 3;
const KG_ROUNDING_FACTOR = 10 ** KG_DECIMALS;

function roundKg(value: number): number {
  return Math.round(value * KG_ROUNDING_FACTOR) / KG_ROUNDING_FACTOR;
}

function zeroKg(): Record<ComponentName, number> {
  return { Proteína: 0, Hidratos: 0, Legumes: 0 };
}

/** Indexa os fatores por dose → componente → kg (última entrada ganha). */
function indexFactors(
  factors: readonly ComponentFactor[],
): Map<string, Partial<Record<ComponentName, number>>> {
  const byDose = new Map<string, Partial<Record<ComponentName, number>>>();
  for (const factor of factors) {
    const existing = byDose.get(factor.dose) ?? {};
    byDose.set(factor.dose, { ...existing, [factor.component]: factor.kgPerMeal });
  }
  return byDose;
}

/**
 * Constrói o plano de empratamento por componentes da semana:
 * kg = Σ qty × fator, agregado por dia de confeção e por componente.
 *
 * Regras:
 * - Só encomendas com `confDay` resolvido (as restantes já foram sinalizadas
 *   em `issues` a montante);
 * - Só line items refeição (`isMealItem`);
 * - Dose via splitDishDose + normalizeDoseForFactors;
 * - Doses sem qualquer fator → agregadas em `skipped` com unidades (nunca
 *   silenciadas); fator 0 explícito conta como coberto (kg 0);
 * - Arredondamento a 3 casas só no fim (dias e totais), para não acumular
 *   erros de vírgula flutuante.
 *
 * Função pura: não muta `orders` nem `factors`.
 */
export function buildComponentPlan(
  orders: readonly ProcessedOrder[],
  factors: readonly ComponentFactor[],
): ComponentPlan {
  const factorsByDose = indexFactors(factors);

  const rawByDay = new Map<
    ConfDay,
    { kg: Record<ComponentName, number>; meals: number }
  >();
  const skippedUnits = new Map<string, number>();

  for (const processed of orders) {
    if (processed.confDay === undefined) continue;
    const confDay = processed.confDay;

    for (const item of processed.order.lineItems) {
      if (!isMealItem(item.name)) continue;

      const { dose } = splitDishDose(item.name);
      const normalized = normalizeDoseForFactors(dose);
      const doseFactors = factorsByDose.get(normalized);

      if (doseFactors === undefined) {
        skippedUnits.set(
          normalized,
          (skippedUnits.get(normalized) ?? 0) + item.quantity,
        );
        continue;
      }

      const day = rawByDay.get(confDay) ?? { kg: zeroKg(), meals: 0 };
      const kg = { ...day.kg };
      for (const component of COMPONENT_NAMES) {
        kg[component] += item.quantity * (doseFactors[component] ?? 0);
      }
      rawByDay.set(confDay, { kg, meals: day.meals + item.quantity });
    }
  }

  const days: ComponentPlanDay[] = CONF_DAY_ORDER.filter((confDay) =>
    rawByDay.has(confDay),
  ).map((confDay) => {
    const raw = rawByDay.get(confDay) as {
      kg: Record<ComponentName, number>;
      meals: number;
    };
    return {
      confDay,
      kg: {
        Proteína: roundKg(raw.kg.Proteína),
        Hidratos: roundKg(raw.kg.Hidratos),
        Legumes: roundKg(raw.kg.Legumes),
      },
      meals: raw.meals,
    };
  });

  const rawTotals = [...rawByDay.values()].reduce(
    (totals, day) => ({
      Proteína: totals.Proteína + day.kg.Proteína,
      Hidratos: totals.Hidratos + day.kg.Hidratos,
      Legumes: totals.Legumes + day.kg.Legumes,
    }),
    zeroKg(),
  );

  const skipped: ComponentSkipped[] = [...skippedUnits.entries()]
    .map(([dose, units]) => ({ dose, units }))
    .sort((a, b) => a.dose.localeCompare(b.dose, "pt"));

  return {
    days,
    totals: {
      Proteína: roundKg(rawTotals.Proteína),
      Hidratos: roundKg(rawTotals.Hidratos),
      Legumes: roundKg(rawTotals.Legumes),
    },
    skipped,
  };
}
