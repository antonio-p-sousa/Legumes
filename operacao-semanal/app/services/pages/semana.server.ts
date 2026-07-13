/**
 * View-model do cockpit "Semana" (/app).
 *
 * `buildSemanaView` é pura: recebe o WeekData já processado (loadWeekData),
 * a configuração da app e as fichas técnicas carregadas pelo loader, e deriva
 * os KPIs da semana, os cartões de dia de confeção e a tabela de documentos.
 * Reutiliza o motor weekly (buildKitchenMap, buildRoutes, buildDpdCsv,
 * buildLabels, buildPurchaseList) — nunca refaz cálculos à mão.
 */
import {
  buildDpdCsv,
  buildKitchenMap,
  buildLabels,
  buildPurchaseList,
  buildRoutes,
} from "../weekly";
import type {
  ConfDay,
  CourierConfig,
  KitchenMap,
  ProcessedOrder,
  RecipeConfig,
} from "../weekly";
import { CONF_DAY_PT, type WeekData } from "./common.server";

// ── Contrato do view-model ───────────────────────────────────────────────────

export interface SemanaKpis {
  /** Total de encomendas na janela (inclui as com issues). */
  encomendas: number;
  /** Encomendas sem issues — entram em todos os cálculos. */
  validas: number;
  /** Encomendas com issues (atributos em falta / zona desconhecida). */
  semZona: number;
  /** Refeições (line items refeição, quantidades explodidas). */
  refeicoes: number;
  /** Soma de totalPrice de TODAS as encomendas da janela (EUR). */
  faturacao: number;
  /** Clientes únicos por e-mail (case-insensitive; vazios ignorados). */
  clientes: number;
}

export interface SemanaDia {
  confDay: ConfDay;
  /** "Segunda" | "Terça" | ... (CONF_DAY_PT). */
  diaPT: string;
  encomendas: number;
  refeicoes: number;
  /** Estafetas com paragens no dia + "DPD · N envios" quando houver. */
  canais: string[];
}

export type DocumentoEstado = "success" | "warning";

export interface SemanaDocumento {
  nome: string;
  /** Tom do badge de estado. */
  estado: DocumentoEstado;
  /** Texto do badge de estado (ex.: "Pronto a exportar", "2 pratos sem ficha"). */
  estadoLabel: string;
  detalhe: string;
  /** Resource route de export. */
  href: string;
}

export interface SemanaView {
  kpis: SemanaKpis;
  dias: SemanaDia[];
  documentos: SemanaDocumento[];
}

/** Subconjunto de AppConfig usado pelo cockpit (satisfeito pelo modelo Prisma). */
export interface SemanaViewConfig {
  /** Fração 0–1. */
  purchaseMargin: number;
  dpdAccount: string | null;
}

// ── Constantes ───────────────────────────────────────────────────────────────

/** Ordem de apresentação dos dias de confeção (2ª feira → domingo). */
const DIA_ORDER: readonly ConfDay[] = ["2f", "3f", "4f", "5f", "6f", "sab", "dom"];

export const EXPORT_HREFS = {
  cozinha: "/app/api/export/cozinha",
  etiquetas: "/app/api/export/etiquetas",
  rotas: "/app/api/export/rotas",
  dpd: "/app/api/export/dpd",
  compras: "/app/api/export/compras",
} as const;

const ESTADO_PRONTO = "Pronto a exportar";

// ── View principal ───────────────────────────────────────────────────────────

/**
 * Deriva a vista do cockpit a partir da semana processada.
 * `recipes` vem de loadRecipes(prisma) — sem fichas, todos os pratos vendidos
 * contam como "sem ficha" (estado real de uma instalação nova).
 */
export function buildSemanaView(
  weekData: WeekData,
  config: SemanaViewConfig,
  recipes: RecipeConfig[],
): SemanaView {
  const { processed, couriers } = weekData;
  const kitchen = buildKitchenMap(processed);

  return {
    kpis: buildKpis(processed, kitchen),
    dias: buildDias(processed, kitchen, couriers),
    documentos: buildDocumentos(processed, kitchen, couriers, config, recipes),
  };
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

function buildKpis(
  processed: ProcessedOrder[],
  kitchen: KitchenMap,
): SemanaKpis {
  const semZona = processed.filter((p) => p.issues.length > 0).length;

  const emails = new Set(
    processed
      .map((p) => p.order.email.trim().toLowerCase())
      .filter((email) => email !== ""),
  );

  const faturacao = processed.reduce(
    (sum, p) => sum + p.order.totalPrice,
    0,
  );

  return {
    encomendas: processed.length,
    validas: processed.length - semZona,
    semZona,
    refeicoes: kitchen.totalMeals,
    faturacao: round2(faturacao),
    clientes: emails.size,
  };
}

// ── Dias de confeção ─────────────────────────────────────────────────────────

function buildDias(
  processed: ProcessedOrder[],
  kitchen: KitchenMap,
  couriers: CourierConfig[],
): SemanaDia[] {
  const courierTypeByName = new Map(couriers.map((c) => [c.name, c.type]));
  const refeicoesByDay = new Map(
    kitchen.days.map((day) => [day.confDay, day.totalMeals]),
  );

  const byDay = new Map<ConfDay, ProcessedOrder[]>();
  for (const order of processed) {
    if (order.confDay === undefined) continue;
    byDay.set(order.confDay, [...(byDay.get(order.confDay) ?? []), order]);
  }

  return DIA_ORDER.filter((confDay) => byDay.has(confDay)).map((confDay) => {
    const dayOrders = byDay.get(confDay) as ProcessedOrder[];
    return {
      confDay,
      diaPT: CONF_DAY_PT[confDay] ?? confDay,
      encomendas: dayOrders.length,
      refeicoes: refeicoesByDay.get(confDay) ?? 0,
      canais: buildCanais(dayOrders, courierTypeByName),
    };
  });
}

/**
 * Canais do dia: nomes de estafetas (ordenados pt-PT) + chip "DPD · N envios"
 * no fim quando há encomendas cuja zona aponta para um courier de type "dpd".
 * Zonas sem estafeta atribuído ("") não geram chip.
 */
function buildCanais(
  dayOrders: ProcessedOrder[],
  courierTypeByName: Map<string, CourierConfig["type"]>,
): string[] {
  const estafetas = new Set<string>();
  let enviosDpd = 0;

  for (const { zone } of dayOrders) {
    const courierName = zone?.courierName ?? "";
    if (courierName === "") continue;
    if (courierTypeByName.get(courierName) === "dpd") {
      enviosDpd += 1;
    } else {
      estafetas.add(courierName);
    }
  }

  const canais = [...estafetas].sort((a, b) => a.localeCompare(b, "pt"));
  return enviosDpd > 0
    ? [...canais, `DPD · ${plural(enviosDpd, "envio", "envios")}`]
    : canais;
}

// ── Documentos da semana ─────────────────────────────────────────────────────

function buildDocumentos(
  processed: ProcessedOrder[],
  kitchen: KitchenMap,
  couriers: CourierConfig[],
  config: SemanaViewConfig,
  recipes: RecipeConfig[],
): SemanaDocumento[] {
  const labels = buildLabels(processed);
  const routes = buildRoutes(processed, couriers);
  const dpd = buildDpdCsv(processed, couriers, {
    account: config.dpdAccount ?? "",
  });
  const purchases = buildPurchaseList(processed, recipes, config.purchaseMargin);

  const totalParagens = routes.reduce((sum, r) => sum + r.stops.length, 0);
  const totalIngredientes = purchases.suppliers.reduce(
    (sum, s) => sum + s.lines.length,
    0,
  );
  const semFicha = purchases.missingRecipes.length;

  return [
    {
      nome: "Mapa de cozinha",
      estado: "success",
      estadoLabel: ESTADO_PRONTO,
      detalhe: `${plural(kitchen.days.length, "dia", "dias")} · ${plural(kitchen.totalMeals, "refeição", "refeições")}`,
      href: EXPORT_HREFS.cozinha,
    },
    {
      nome: "Etiquetas",
      estado: "success",
      estadoLabel: ESTADO_PRONTO,
      detalhe: plural(labels.length, "etiqueta", "etiquetas"),
      href: EXPORT_HREFS.etiquetas,
    },
    {
      nome: "Rotas de estafetas",
      estado: "success",
      estadoLabel: ESTADO_PRONTO,
      detalhe: `${plural(routes.length, "rota", "rotas")} · ${plural(totalParagens, "paragem", "paragens")}`,
      href: EXPORT_HREFS.rotas,
    },
    {
      nome: "CSV DPD",
      estado: "success",
      estadoLabel: ESTADO_PRONTO,
      detalhe: `${plural(dpd.shipments, "envio", "envios")} · ${Math.round(dpd.totalWeightKg)} kg`,
      href: EXPORT_HREFS.dpd,
    },
    {
      nome: "Compras",
      estado: semFicha > 0 ? "warning" : "success",
      estadoLabel:
        semFicha > 0
          ? plural(semFicha, "prato sem ficha", "pratos sem ficha")
          : ESTADO_PRONTO,
      detalhe: `${plural(purchases.suppliers.length, "fornecedor", "fornecedores")} · ${plural(totalIngredientes, "ingrediente", "ingredientes")}`,
      href: EXPORT_HREFS.compras,
    },
  ];
}

// ── Helpers de apresentação (usados pelo loader do cockpit) ──────────────────

/**
 * "2025-11-24T10:05:00Z" → "24/11 10:05". Usa componentes UTC para o output
 * ser determinístico entre servidor e cliente (Lisboa em nov = UTC+0).
 * String vazia ou inválida → "—".
 */
export function formatDataHoraPt(iso: string): string {
  const date = new Date(iso);
  if (iso.trim() === "" || Number.isNaN(date.getTime())) return "—";

  const dd = pad2(date.getUTCDate());
  const mm = pad2(date.getUTCMonth() + 1);
  const hh = pad2(date.getUTCHours());
  const min = pad2(date.getUTCMinutes());
  return `${dd}/${mm} ${hh}:${min}`;
}

/** Minutos inteiros decorridos desde `iso` (nunca negativo; inválido → 0). */
export function minutosDesde(iso: string, agoraMs: number = Date.now()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((agoraMs - then) / 60_000));
}

// ── Internos ─────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, plurale: string): string {
  return `${n} ${n === 1 ? singular : plurale}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
