/**
 * Resource route: export xlsx da lista de compras.
 *
 * Sem parâmetros → workbook completo: folha "Resumo" (fornecedor, nº de
 * ingredientes), uma folha por fornecedor (Ingrediente | Necessário |
 * +margem | Unidade) e folha "Sem ficha" (Prato | Dose | Unidades vendidas).
 *
 * ?fornecedor=<name> → só a folha desse fornecedor (o botão "Exportar" de
 * cada cartão na página /app/compras).
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig } from "../services/definicoes/config.server";
import { loadRecipes, loadWeekData } from "../services/pages/common.server";
import {
  buildComprasView,
  type ComprasSupplier,
  type ComprasView,
} from "../services/pages/compras.server";
import {
  buildWorkbook,
  xlsxResponse,
  type SheetSpec,
} from "../services/export/xlsx.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [weekData, recipes, config, supplierRows] = await Promise.all([
    loadWeekData(prisma, admin),
    loadRecipes(prisma),
    getConfig(prisma),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);

  const view = buildComprasView(
    weekData,
    recipes,
    config.purchaseMargin,
    supplierRows,
  );

  const weekSlug = slugify(weekData.meta.weekLabel);
  const fornecedor = new URL(request.url).searchParams.get("fornecedor");

  if (fornecedor) {
    const supplier = view.suppliers.find((s) => s.supplier === fornecedor);
    if (!supplier) {
      return new Response(
        `Fornecedor sem linhas de compra nesta semana: ${fornecedor}`,
        { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    const buffer = await buildWorkbook([supplierSheet(supplier)]);
    return xlsxResponse(
      buffer,
      `compras-${slugify(fornecedor)}-${weekSlug}.xlsx`,
    );
  }

  const sheets: SheetSpec[] = [
    resumoSheet(view),
    ...view.suppliers.map(supplierSheet),
    semFichaSheet(view),
  ];
  const buffer = await buildWorkbook(sheets);
  return xlsxResponse(buffer, `compras-${weekSlug}.xlsx`);
};

// ── Folhas ───────────────────────────────────────────────────────────────────

function resumoSheet(view: ComprasView): SheetSpec {
  return {
    name: "Resumo",
    columns: [
      { header: "Fornecedor", key: "fornecedor", width: 32 },
      { header: "Nº ingredientes", key: "ingredientes", width: 16 },
    ],
    rows: view.suppliers.map((supplier) => ({
      fornecedor: supplier.supplier,
      ingredientes: supplier.lines.length,
    })),
  };
}

function supplierSheet(supplier: ComprasSupplier): SheetSpec {
  return {
    name: supplier.supplier,
    columns: [
      { header: "Ingrediente", key: "ingrediente", width: 32 },
      { header: "Necessário", key: "necessario", width: 14 },
      { header: "+margem", key: "comMargem", width: 14 },
      { header: "Unidade", key: "unidade", width: 10 },
    ],
    rows: supplier.lines.map((line) => ({
      ingrediente: line.ingredient,
      necessario: line.required,
      comMargem: line.withMargin,
      unidade: line.unit,
    })),
  };
}

function semFichaSheet(view: ComprasView): SheetSpec {
  return {
    name: "Sem ficha",
    columns: [
      { header: "Prato", key: "prato", width: 40 },
      { header: "Dose", key: "dose", width: 14 },
      { header: "Unidades vendidas", key: "unidades", width: 18 },
    ],
    rows: view.missing.top.map((entry) => ({
      prato: entry.dish,
      dose: entry.dose,
      unidades: entry.unitsSold,
    })),
  };
}

/** "2025-W47 (demonstração)" → "2025-w47-demonstracao" */
function slugify(raw: string): string {
  return (
    raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "semana"
  );
}
