/**
 * Histórico de semanas (/app/historico).
 *
 * A BD guarda snapshots processados em WeekRun (id, weekLabel, generatedAt,
 * ordersJson = JSON serializado de OrderInput[]). Hoje só o import manual de
 * CSV cria WeekRuns (csv-import.server.ts, com weekLabel prefixado por
 * "import-"), mas o histórico mostra TODOS os WeekRun — imports e futuros
 * snapshots de fecho de semana — do mais recente para o mais antigo.
 *
 * Funções puras sobre o PrismaClient recebido (sem I/O de UI/Shopify). O parse
 * do ordersJson é defensivo: um snapshot corrompido conta 0 encomendas e 0
 * refeições em vez de derrubar a página (regra: nunca falhar em silêncio, mas
 * também nunca deixar dado mau partir a app).
 */
import type { PrismaClient } from "@prisma/client";
import {
  DIA_TO_WEEKDAY,
  isMealItem,
  parseNoteAttributes,
  type OrderInput,
} from "../weekly";

/** Quantos WeekRun mostrar por omissão no histórico. */
export const DEFAULT_HISTORY_LIMIT = 30;

/** Rótulo do grupo de encomendas sem dia de entrega reconhecível. */
export const SEM_DIA = "Sem dia";

// ── Contrato do view-model ───────────────────────────────────────────────────

export interface WeekRunSummary {
  id: string;
  weekLabel: string;
  /** ISO 8601 — serializável no loader. */
  generatedAt: string;
  /** Nº de encomendas no snapshot (comprimento do ordersJson parseado). */
  nEncomendas: number;
  /** Soma das quantidades dos line items refeição (isMealItem). */
  nRefeicoes: number;
}

export interface WeekRunSnapshot {
  id: string;
  weekLabel: string;
  /** ISO 8601. */
  generatedAt: string;
  /** Encomendas do snapshot ([] se o ordersJson estiver corrompido). */
  orders: OrderInput[];
}

export interface DaySummary {
  /** "Segunda" | "Terça" | ... | "Sem dia". */
  dia: string;
  nEncomendas: number;
  nRefeicoes: number;
}

// ── Parsing defensivo ────────────────────────────────────────────────────────

/** ordersJson → OrderInput[]; JSON inválido ou não-array → []. */
function parseOrders(ordersJson: string): OrderInput[] {
  try {
    const parsed = JSON.parse(ordersJson);
    return Array.isArray(parsed) ? (parsed as OrderInput[]) : [];
  } catch {
    return [];
  }
}

/** Refeições numa encomenda: soma das quantidades dos line items refeição. */
function mealsInOrder(order: OrderInput | undefined): number {
  if (!order || !Array.isArray(order.lineItems)) return 0;
  let total = 0;
  for (const item of order.lineItems) {
    if (!item || typeof item.name !== "string") continue;
    if (!isMealItem(item.name)) continue;
    total += Number.isFinite(item.quantity) ? item.quantity : 0;
  }
  return total;
}

/** Total de refeições de um snapshot (line items refeição, quantidades somadas). */
export function countMeals(orders: OrderInput[]): number {
  if (!Array.isArray(orders)) return 0;
  return orders.reduce((sum, order) => sum + mealsInOrder(order), 0);
}

// ── Consultas ────────────────────────────────────────────────────────────────

/**
 * Últimos WeekRun (todos, não só imports), do mais recente para o mais antigo,
 * já resumidos: nº de encomendas e nº de refeições por snapshot.
 */
export async function listWeekRuns(
  prisma: PrismaClient,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<WeekRunSummary[]> {
  const runs = await prisma.weekRun.findMany({
    orderBy: { generatedAt: "desc" },
    take: limit,
  });
  return runs.map((run) => {
    const orders = parseOrders(run.ordersJson);
    return {
      id: run.id,
      weekLabel: run.weekLabel,
      generatedAt: run.generatedAt.toISOString(),
      nEncomendas: orders.length,
      nRefeicoes: countMeals(orders),
    };
  });
}

/**
 * Snapshot completo (encomendas) de um WeekRun, para re-visualização.
 * `undefined` quando o id não existe; ordersJson corrompido → orders = [].
 */
export async function getWeekRun(
  prisma: PrismaClient,
  id: string,
): Promise<WeekRunSnapshot | undefined> {
  const run = await prisma.weekRun.findUnique({ where: { id } });
  if (!run) return undefined;
  return {
    id: run.id,
    weekLabel: run.weekLabel,
    generatedAt: run.generatedAt.toISOString(),
    orders: parseOrders(run.ordersJson),
  };
}

/**
 * Elimina um WeekRun por id (qualquer um — import ou snapshot de fecho).
 * Devolve false se o id já não existir. Ao contrário de csv-import.deleteImport,
 * NÃO se limita aos imports: o histórico gere todos os WeekRun.
 */
export async function deleteWeekRun(
  prisma: PrismaClient,
  id: string,
): Promise<boolean> {
  const result = await prisma.weekRun.deleteMany({ where: { id } });
  return result.count > 0;
}

// ── Resumo por dia (para a vista de detalhe) ─────────────────────────────────

/** Ordena os dias pela semana (Segunda→Domingo) e empurra "Sem dia" para o fim. */
function compareDias(a: DaySummary, b: DaySummary): number {
  const weekdayA = DIA_TO_WEEKDAY[a.dia];
  const weekdayB = DIA_TO_WEEKDAY[b.dia];
  if (weekdayA === undefined && weekdayB === undefined) {
    return a.dia.localeCompare(b.dia, "pt");
  }
  if (weekdayA === undefined) return 1;
  if (weekdayB === undefined) return -1;
  // Domingo (0) é o fim da semana operacional, não o início.
  const orderA = weekdayA === 0 ? 7 : weekdayA;
  const orderB = weekdayB === 0 ? 7 : weekdayB;
  return orderA - orderB;
}

/**
 * Agrupa as encomendas de um snapshot por dia de entrega (Note Attributes),
 * com contagem de encomendas e refeições por dia. Encomendas sem dia
 * reconhecível caem em "Sem dia". Ordenado por dia da semana.
 */
export function summarizeByDay(orders: OrderInput[]): DaySummary[] {
  const byDay = new Map<string, DaySummary>();
  if (Array.isArray(orders)) {
    for (const order of orders) {
      const attrs = Array.isArray(order?.customAttributes)
        ? order.customAttributes
        : [];
      const delivery = parseNoteAttributes(attrs);
      const dia = delivery?.dia ?? SEM_DIA;
      const current = byDay.get(dia) ?? { dia, nEncomendas: 0, nRefeicoes: 0 };
      byDay.set(dia, {
        dia,
        nEncomendas: current.nEncomendas + 1,
        nRefeicoes: current.nRefeicoes + mealsInOrder(order),
      });
    }
  }
  return Array.from(byDay.values()).sort(compareDias);
}
