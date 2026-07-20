/**
 * Vista da página Cozinha (/app/cozinha) e dos exports xlsx associados.
 *
 * Transforma o output do motor (buildKitchenMap) numa estrutura pronta para
 * a UI: por dia de confeção, pratos agrupados por categoria (tabela Dish do
 * Prisma via baseName) e matriz prato×dose com colunas fixas por categoria.
 *
 * Tudo aqui são funções puras e testadas — quem carrega da BD/Shopify são os
 * loaders (loadWeekData + prisma.dish.findMany), não este módulo.
 */
import {
  WEEKDAY_TO_CONFDAY,
  buildComponentPlan,
  buildKitchenMap,
} from "../weekly";
import type {
  ComponentFactor,
  ComponentPlan,
  ConfDay,
  KitchenDay,
  KitchenRow,
  LabelRow,
  ProcessedOrder,
} from "../weekly";
import { CONF_DAY_PT } from "./common.server";
import type { WeekData } from "./common.server";

// ── Contrato da vista ────────────────────────────────────────────────────────

/** Projeção mínima da tabela Dish do Prisma usada para categorizar pratos. */
export interface DishCategoryInput {
  baseName: string;
  category: string;
}

export interface DoseMatrixRow {
  dish: string;
  /** Alinhado com `doseColumns`; null = dose não vendida nesse dia. */
  cells: Array<number | null>;
  total: number;
}

export interface DoseMatrix {
  /** Colunas de dose, ordem fixa da categoria + extras inesperadas no fim. */
  doseColumns: string[];
  rows: DoseMatrixRow[];
  /** Totais por coluna de dose (0 quando nenhuma linha tem essa dose). */
  columnTotals: number[];
  total: number;
}

export interface CozinhaDayNote {
  orderName: string;
  note: string;
}

export interface CozinhaDay {
  confDay: ConfDay;
  /** Rótulo PT do dia de confeção: "Segunda", "Terça", ... */
  label: string;
  /** Data de confeção (yyyy-mm-dd) derivada das entregas; null sem entregas. */
  confDate: string | null;
  /** Refeições do dia (só line items refeição). */
  totalMeals: number;
  /** Sacos = nº de encomendas com confeção neste dia. */
  totalOrders: number;
  /** Peixe & carne: colunas [Low Carb, Bulk, Extra Bulk, Zero Carbs]. */
  peixeCarne: DoseMatrix;
  /** Vegetariano: colunas [300g, 400g, 450g]. */
  vegetariano: DoseMatrix;
  /** Pokes à parte (doses M/XL × arroz/quinoa). */
  pokes: KitchenRow[];
  /** Restantes categorias (sopa, pizza, sobremesa, "outro", ...). */
  doseUnica: KitchenRow[];
  /** Notas de encomendas do dia (personalizações para a cozinha). */
  notes: CozinhaDayNote[];
}

export interface CozinhaView {
  /** Só dias com refeições, ordenados 2f → 3f → 4f → ... */
  days: CozinhaDay[];
  totalMeals: number;
  /** Total de encomendas dos dias com produção. */
  totalOrders: number;
  /** Itens não-cozinha da semana inteira (fora dos totais de refeições). */
  nonMeal: KitchenRow[];
  /**
   * Plano de empratamento por componentes (kg de Proteína/Hidratos/Legumes
   * por dia). Opcional para retrocompatibilidade — só existe quando o loader
   * passa os fatores da BD a buildCozinhaView.
   */
  componentPlan?: ComponentPlan;
}

// ── Constantes de domínio (regra 4.2) ────────────────────────────────────────

export const PEIXE_CARNE_DOSES: readonly string[] = [
  "Low Carb",
  "Bulk",
  "Extra Bulk",
  "Zero Carbs",
];

export const VEGETARIANO_DOSES: readonly string[] = ["300g", "400g", "450g"];

/** Categoria por omissão quando o prato não existe na tabela Dish. */
export const CATEGORIA_DESCONHECIDA = "outro";

type SectionKey = "peixeCarne" | "vegetariano" | "pokes" | "doseUnica";

function resolveSection(category: string): SectionKey {
  if (category === "peixe" || category === "carne") return "peixeCarne";
  if (category === "vegetariano") return "vegetariano";
  if (category === "poke") return "pokes";
  return "doseUnica";
}

// ── Vista principal ──────────────────────────────────────────────────────────

/**
 * Constrói a vista da página Cozinha a partir da semana processada e da lista
 * de pratos (baseName → category). Com `componentFactors`, calcula também o
 * plano de empratamento por componentes (campo opcional `componentPlan`).
 * Função pura: não muta os argumentos.
 */
export function buildCozinhaView(
  weekData: WeekData,
  dishes: DishCategoryInput[],
  componentFactors?: ComponentFactor[],
): CozinhaView {
  const categoryByDish = new Map(
    dishes.map((dish) => [dish.baseName, dish.category]),
  );
  const kitchen = buildKitchenMap(weekData.processed);

  const days = kitchen.days.map((day) =>
    buildDay(day, weekData.processed, categoryByDish),
  );

  return {
    days,
    totalMeals: kitchen.totalMeals,
    totalOrders: days.reduce((sum, day) => sum + day.totalOrders, 0),
    nonMeal: kitchen.nonMeal,
    ...(componentFactors
      ? { componentPlan: buildComponentPlan(weekData.processed, componentFactors) }
      : {}),
  };
}

function buildDay(
  day: KitchenDay,
  processed: ProcessedOrder[],
  categoryByDish: ReadonlyMap<string, string>,
): CozinhaDay {
  const sections: Record<SectionKey, KitchenRow[]> = {
    peixeCarne: [],
    vegetariano: [],
    pokes: [],
    doseUnica: [],
  };
  for (const row of day.rows) {
    const category = categoryByDish.get(row.dish) ?? CATEGORIA_DESCONHECIDA;
    sections[resolveSection(category)].push(row);
  }

  const dayOrders = processed.filter((o) => o.confDay === day.confDay);

  return {
    confDay: day.confDay,
    label: CONF_DAY_PT[day.confDay] ?? day.confDay,
    confDate: resolveDayConfDate(dayOrders, day.confDay),
    totalMeals: day.totalMeals,
    totalOrders: dayOrders.length,
    peixeCarne: buildDoseMatrix(sections.peixeCarne, PEIXE_CARNE_DOSES),
    vegetariano: buildDoseMatrix(sections.vegetariano, VEGETARIANO_DOSES),
    pokes: sections.pokes,
    doseUnica: sections.doseUnica,
    notes: collectDayNotes(dayOrders),
  };
}

/**
 * Matriz prato×dose de uma categoria: colunas fixas na ordem dada; doses fora
 * do domínio esperado entram como colunas extra no fim (ordenadas pt) para
 * nunca perder quantidades vendidas.
 */
function buildDoseMatrix(
  rows: KitchenRow[],
  fixedColumns: readonly string[],
): DoseMatrix {
  const extraDoses = [
    ...new Set(
      rows
        .map((row) => row.dose)
        .filter((dose) => !fixedColumns.includes(dose)),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt"));

  const doseColumns = [...fixedColumns, ...extraDoses];
  const columnIndex = new Map(doseColumns.map((dose, i) => [dose, i]));

  // rows já vêm ordenadas por prato do motor; Map preserva a ordem de inserção
  const byDish = new Map<string, Array<number | null>>();
  for (const row of rows) {
    const cells =
      byDish.get(row.dish) ?? doseColumns.map((): number | null => null);
    const index = columnIndex.get(row.dose) as number;
    cells[index] = (cells[index] ?? 0) + row.quantity;
    byDish.set(row.dish, cells);
  }

  const matrixRows: DoseMatrixRow[] = [...byDish.entries()].map(
    ([dish, cells]) => ({
      dish,
      cells,
      total: cells.reduce((sum: number, qty) => sum + (qty ?? 0), 0),
    }),
  );

  const columnTotals = doseColumns.map((_, i) =>
    matrixRows.reduce((sum, row) => sum + (row.cells[i] ?? 0), 0),
  );

  return {
    doseColumns,
    rows: matrixRows,
    columnTotals,
    total: matrixRows.reduce((sum, row) => sum + row.total, 0),
  };
}

function collectDayNotes(dayOrders: ProcessedOrder[]): CozinhaDayNote[] {
  return dayOrders
    .filter((o) => o.order.note?.trim())
    .map((o) => ({
      orderName: o.order.name,
      note: (o.order.note as string).trim(),
    }))
    .sort((a, b) => a.orderName.localeCompare(b.orderName, "pt"));
}

// ── Data de confeção ─────────────────────────────────────────────────────────

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
 * Data de confeção de uma entrega: recua da data de entrega até ao weekday do
 * dia de confeção (0–6 dias), em aritmética UTC — mesma regra do motor de
 * etiquetas (labels.ts).
 */
function confDateFromDelivery(deliveryDate: string, confDay: ConfDay): string {
  const delivery = new Date(`${deliveryDate}T00:00:00Z`);
  const daysBack =
    (delivery.getUTCDay() - CONFDAY_TO_WEEKDAY[confDay] + DAYS_PER_WEEK) %
    DAYS_PER_WEEK;
  const confection = new Date(delivery.getTime() - daysBack * MS_PER_DAY);
  return confection.toISOString().slice(0, 10);
}

/** Primeira data de confeção (mín.) das encomendas do dia; null sem entregas. */
function resolveDayConfDate(
  dayOrders: ProcessedOrder[],
  confDay: ConfDay,
): string | null {
  const dates = dayOrders
    .filter((o) => o.delivery !== null)
    .map((o) =>
      confDateFromDelivery(
        (o.delivery as NonNullable<ProcessedOrder["delivery"]>).deliveryDate,
        confDay,
      ),
    )
    .sort();
  return dates[0] ?? null;
}

// ── Helpers dos exports xlsx ─────────────────────────────────────────────────

export interface CozinhaSheetRow {
  prato: string;
  dose: string;
  quantidade: number;
}

/**
 * Linhas Prato | Dose | Quantidade de um dia, agrupadas por categoria
 * (peixe & carne → vegetariano → pokes → dose única) e ordenadas por prato,
 * com as doses na ordem das colunas da matriz.
 */
export function buildCozinhaDaySheetRows(day: CozinhaDay): CozinhaSheetRow[] {
  const rows: CozinhaSheetRow[] = [];

  for (const matrix of [day.peixeCarne, day.vegetariano]) {
    for (const row of matrix.rows) {
      matrix.doseColumns.forEach((dose, i) => {
        const quantidade = row.cells[i];
        if (quantidade !== null) rows.push({ prato: row.dish, dose, quantidade });
      });
    }
  }

  for (const row of [...day.pokes, ...day.doseUnica]) {
    rows.push({ prato: row.dish, dose: row.dose, quantidade: row.quantity });
  }

  return rows;
}

const WEEKDAY_PT: readonly string[] = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

/** Nome de folha "Segunda 24-11" (rótulo do dia + dd-mm da data de confeção). */
export function confDaySheetName(
  day: Pick<CozinhaDay, "label" | "confDate">,
): string {
  if (!day.confDate) return day.label;
  const [, month, dayOfMonth] = day.confDate.split("-");
  return `${day.label} ${dayOfMonth}-${month}`;
}

/** Nome de folha para uma data de confeção ISO: "Segunda 24-11". */
export function confDateSheetName(isoDate: string): string {
  const weekday = WEEKDAY_PT[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
  const [, month, dayOfMonth] = isoDate.split("-");
  return `${weekday} ${dayOfMonth}-${month}`;
}

/** "2025-11-24" → "24/11/2025" (formato de leitura do operador). */
export function isoToPtDate(isoDate: string): string {
  const [year, month, dayOfMonth] = isoDate.split("-");
  return `${dayOfMonth}/${month}/${year}`;
}

/**
 * Token de filename a partir do weekLabel: primeiro bloco sem espaços nem
 * parênteses/diacríticos. "2025-W47 (demonstração)" → "2025-W47".
 */
export function weekLabelFileToken(weekLabel: string): string {
  const first = weekLabel.trim().split(/\s+/)[0] ?? "";
  const cleaned = first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "semana";
}

/** Agrupa as etiquetas por data de confeção, preservando a ordem do motor. */
export function groupLabelsByConfDate(
  labels: LabelRow[],
): Array<{ confDate: string; rows: LabelRow[] }> {
  const groups = new Map<string, LabelRow[]>();
  for (const label of labels) {
    const rows = groups.get(label.confDate) ?? [];
    rows.push(label);
    groups.set(label.confDate, rows);
  }
  return [...groups.entries()].map(([confDate, rows]) => ({ confDate, rows }));
}
