/**
 * Vista da página Estafetas (/app/estafetas) — deriva do motor tudo o que a
 * página e os exports precisam: rotas locais agrupadas por data de entrega e
 * o resumo DPD (CSV + repartição por dia de recolha).
 *
 * Função pura: recebe os dados já processados (loadWeekData) e a conta DPD
 * (getConfig), não toca em Prisma nem Shopify. Testada com ProcessedOrder[]
 * determinísticos em estafetas.server.test.ts.
 */
import type { WeekData } from "./common.server";
import { CONF_DAY_PT } from "./common.server";
import {
  buildDpdCsv,
  buildRoutes,
  WEEKDAY_TO_CONFDAY,
  type CourierConfig,
  type DpdResult,
  type ProcessedOrder,
  type Route,
} from "../weekly";

/** Conta DPD usada quando a config ainda não tem conta definida. */
export const DPD_DEFAULT_ACCOUNT = "03290201";

/** Nº contratual de colunas do Template_DPD (regra 4.6). */
const DPD_COLUMN_COUNT = 17;

/** A vista só precisa das encomendas processadas e dos couriers da config. */
export type EstafetasSource = Pick<WeekData, "processed" | "couriers">;

export interface DeliveryDateSummary {
  /** Data de entrega (yyyy-mm-dd) */
  date: string;
  /** Dia por extenso, PT ("Segunda") */
  dia: string;
  nRotas: number;
  nParagens: number;
}

export interface DpdPickupDay {
  /** Dia de confeção/recolha (véspera da entrega), yyyy-mm-dd */
  date: string;
  /** Dia por extenso, PT ("Segunda") */
  dia: string;
  shipments: number;
}

export interface DpdChecks {
  /** Todas as linhas do CSV têm exatamente 17 campos (também garante que
   *  nenhum campo contém ';' — um ';' no texto criaria colunas a mais). */
  colunas17: boolean;
  /** Nenhum contacto leva o indicativo +351 (o portal DPD rejeita-o). */
  semIndicativo351: boolean;
}

export interface DpdView extends DpdResult {
  /** Envios agrupados pelo dia de recolha (= dia de confeção, regra 4.3). */
  porRecolha: DpdPickupDay[];
  checks: DpdChecks;
}

export interface EstafetasView {
  /** Datas de entrega com rotas locais, ordenadas ascendentemente. */
  deliveryDates: DeliveryDateSummary[];
  /** Rotas do motor (couriers internal/partner — DPD fica no cartão DPD). */
  routes: Route[];
  /** Ordenação configurada por courier, para a UI rotular cada rota. */
  orderingByCourier: Record<string, CourierConfig["ordering"]>;
  dpd: DpdView;
}

/**
 * Constrói a vista completa da página Estafetas.
 * `dpdAccount` null/vazio → conta por omissão (DPD_DEFAULT_ACCOUNT).
 */
export function buildEstafetasView(
  weekData: EstafetasSource,
  dpdAccount: string | null | undefined,
): EstafetasView {
  const routes = buildRoutes(weekData.processed, weekData.couriers);

  const account =
    dpdAccount && dpdAccount.trim() !== "" ? dpdAccount : DPD_DEFAULT_ACCOUNT;
  const dpd = buildDpdCsv(weekData.processed, weekData.couriers, { account });

  return {
    deliveryDates: summarizeDeliveryDates(routes),
    routes,
    orderingByCourier: buildOrderingByCourier(weekData.couriers),
    dpd: {
      ...dpd,
      porRecolha: groupDpdByPickupDay(weekData.processed, weekData.couriers),
      checks: runDpdChecks(dpd.csv),
    },
  };
}

/** "2025-W47 (demonstração)" → "2025-w47-demonstracao" (p/ nomes de ficheiro). */
export function slugifyWeekLabel(label: string): string {
  const slug = label
    .normalize("NFD")
    // remove marcas diacríticas (U+0300–U+036F) deixadas pelo NFD
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "semana" : slug;
}

// ── privados ─────────────────────────────────────────────────────────────────

function summarizeDeliveryDates(routes: Route[]): DeliveryDateSummary[] {
  const byDate = new Map<string, DeliveryDateSummary>();

  for (const route of routes) {
    const existing = byDate.get(route.deliveryDate);
    if (existing) {
      byDate.set(route.deliveryDate, {
        ...existing,
        nRotas: existing.nRotas + 1,
        nParagens: existing.nParagens + route.stops.length,
      });
    } else {
      byDate.set(route.deliveryDate, {
        date: route.deliveryDate,
        dia: route.deliveryDay,
        nRotas: 1,
        nParagens: route.stops.length,
      });
    }
  }

  return [...byDate.values()].sort((a, b) => compareStrings(a.date, b.date));
}

function buildOrderingByCourier(
  couriers: CourierConfig[],
): Record<string, CourierConfig["ordering"]> {
  const entries = couriers
    .filter((c) => c.type !== "dpd")
    .map((c) => [c.name, c.ordering] as const);
  return Object.fromEntries(entries);
}

/**
 * Agrupa os envios DPD pelo dia de recolha = véspera da data de entrega
 * (regra 4.3: o DPD recolhe na véspera e a confeção entra nesse dia).
 * Usa o mesmo critério de seleção do motor (zona → courier type "dpd").
 */
function groupDpdByPickupDay(
  processed: ProcessedOrder[],
  couriers: CourierConfig[],
): DpdPickupDay[] {
  const dpdCourierNames = new Set(
    couriers.filter((c) => c.type === "dpd").map((c) => c.name),
  );

  const byDate = new Map<string, DpdPickupDay>();

  for (const order of processed) {
    if (!order.zone || !dpdCourierNames.has(order.zone.courierName)) continue;
    // Sem delivery não há data de entrega — o pipeline nunca produz zona sem
    // delivery, mas protegemos a derivação na mesma.
    if (!order.delivery) continue;

    const pickupDate = addDaysIso(order.delivery.deliveryDate, -1);
    const existing = byDate.get(pickupDate);
    if (existing) {
      byDate.set(pickupDate, {
        ...existing,
        shipments: existing.shipments + 1,
      });
    } else {
      byDate.set(pickupDate, {
        date: pickupDate,
        dia: weekdayPt(pickupDate),
        shipments: 1,
      });
    }
  }

  return [...byDate.values()].sort((a, b) => compareStrings(a.date, b.date));
}

/**
 * Verifica sobre o CSV final os invariantes contratuais do portal DPD (4.6).
 * CSV vazio (0 envios) passa vacuosamente — não há nada para rejeitar.
 */
function runDpdChecks(csv: string): DpdChecks {
  const lines = csv === "" ? [] : csv.split("\r\n");
  return {
    colunas17: lines.every(
      (line) => line.split(";").length === DPD_COLUMN_COUNT,
    ),
    semIndicativo351: !csv.includes("+351"),
  };
}

/** Soma `days` (pode ser negativo) a uma data ISO yyyy-mm-dd, em UTC. */
function addDaysIso(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) {
    throw new Error(`Data inválida (esperado yyyy-mm-dd): "${isoDate}"`);
  }
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** "2025-11-24" → "Segunda" (via weekday UTC → ConfDay → rótulo PT). */
function weekdayPt(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) {
    throw new Error(`Data inválida (esperado yyyy-mm-dd): "${isoDate}"`);
  }
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const confDay = WEEKDAY_TO_CONFDAY[new Date(utcMs).getUTCDay()];
  return CONF_DAY_PT[confDay] ?? confDay;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
