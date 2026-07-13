/**
 * Vista da página Compras (Fase 5).
 *
 * Deriva do motor (buildPurchaseList, regra 4.5) a estrutura pronta para a
 * UI e para o export xlsx: fornecedores enriquecidos com email/dia de
 * encomenda (quando existem na BD), agregado de pratos sem ficha técnica e
 * estatísticas para os KPIs.
 *
 * Função pura: recebe tudo como argumentos (semana processada, fichas,
 * margem e fornecedores) e devolve objetos novos — nunca muta os inputs.
 */
import type { WeekData } from "./common.server";
import {
  buildPurchaseList,
  type PurchaseLine,
  type RecipeConfig,
} from "../weekly";

/** Forma mínima de um fornecedor vindo da BD (prisma.supplier.findMany). */
export interface SupplierInfo {
  name: string;
  email?: string | null;
  orderDay?: string | null;
}

export interface ComprasSupplier {
  supplier: string;
  /** Só presente quando existe na BD (string não vazia). */
  email?: string;
  /** Dia em que se encomenda a este fornecedor — só quando existe na BD. */
  orderDay?: string;
  lines: PurchaseLine[];
}

export interface ComprasMissingDish {
  dish: string;
  dose: string;
  unitsSold: number;
}

export interface ComprasMissing {
  /** Nº de combinações (prato, dose) vendidas sem ficha técnica. */
  count: number;
  /** Total de refeições NÃO refletidas nas quantidades de compra. */
  unitsTotal: number;
  /**
   * Todas as entradas, ordenadas por unitsSold desc (desempate por prato e
   * dose, pt). A UI corta o top N que precisar; o export usa a lista inteira.
   */
  top: ComprasMissingDish[];
}

export interface ComprasStats {
  fornecedores: number;
  /** Linhas de ingrediente distintas (por par fornecedor+ingrediente). */
  ingredientes: number;
  /** Alertas = pratos sem ficha técnica (== missing.count). */
  alertas: number;
}

export interface ComprasView {
  suppliers: ComprasSupplier[];
  missing: ComprasMissing;
  stats: ComprasStats;
}

export function buildComprasView(
  weekData: Pick<WeekData, "processed">,
  recipes: RecipeConfig[],
  margin: number,
  suppliersInfo: SupplierInfo[],
): ComprasView {
  const purchases = buildPurchaseList(weekData.processed, recipes, margin);

  const infoByName = new Map(suppliersInfo.map((info) => [info.name, info]));

  const suppliers = purchases.suppliers.map((supplier) =>
    enrichSupplier(supplier, infoByName.get(supplier.supplier)),
  );

  const top = [...purchases.missingRecipes].sort(compareMissing);

  return {
    suppliers,
    missing: {
      count: top.length,
      unitsTotal: top.reduce((sum, entry) => sum + entry.unitsSold, 0),
      top,
    },
    stats: {
      fornecedores: suppliers.length,
      ingredientes: suppliers.reduce(
        (sum, supplier) => sum + supplier.lines.length,
        0,
      ),
      alertas: top.length,
    },
  };
}

// ── Internos ─────────────────────────────────────────────────────────────────

function enrichSupplier(
  supplier: { supplier: string; lines: PurchaseLine[] },
  info: SupplierInfo | undefined,
): ComprasSupplier {
  const email = normalizeOptional(info?.email);
  const orderDay = normalizeOptional(info?.orderDay);

  return {
    supplier: supplier.supplier,
    // spreads condicionais para os campos não existirem de todo quando não
    // há info na BD — a UI testa presença e o JSON do loader fica limpo
    ...(email !== undefined ? { email } : {}),
    ...(orderDay !== undefined ? { orderDay } : {}),
    lines: supplier.lines.map((line) => ({ ...line })),
  };
}

/** unitsSold desc; desempate estável por prato e dose (ordem pt). */
function compareMissing(
  a: ComprasMissingDish,
  b: ComprasMissingDish,
): number {
  return (
    b.unitsSold - a.unitsSold ||
    a.dish.localeCompare(b.dish, "pt") ||
    a.dose.localeCompare(b.dose, "pt")
  );
}

/** "" / whitespace / null → undefined (campo omitido); senão string aparada. */
function normalizeOptional(
  raw: string | null | undefined,
): string | undefined {
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}
