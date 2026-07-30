/**
 * Resource route: export xlsx da lista de compras.
 *
 * Sem parâmetros → workbook completo: folha "Resumo" (fornecedor, nº de
 * ingredientes), uma folha por fornecedor (Ingrediente | Necessário |
 * +margem | Unidade) e folha "Sem ficha" (Prato | Dose | Unidades vendidas).
 *
 * ?fornecedor=<name> → só a folha desse fornecedor (o botão "Exportar" de
 * cada cartão na página /app/compras).
 *
 * A montagem das folhas vive em services/export/packs.server.ts
 * (buildComprasWorkbook / buildComprasSupplierWorkbook).
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig } from "../services/definicoes/config.server";
import { loadRecipes, loadWeekData } from "../services/pages/common.server";
import { buildComprasView } from "../services/pages/compras.server";
import {
  buildComprasSupplierWorkbook,
  buildComprasWorkbook,
} from "../services/export/packs.server";
import { xlsxResponse } from "../services/export/xlsx.server";

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
    const buffer = await buildComprasSupplierWorkbook(supplier);
    return xlsxResponse(
      buffer,
      `compras-${slugify(fornecedor)}-${weekSlug}.xlsx`,
    );
  }

  const buffer = await buildComprasWorkbook(view);
  return xlsxResponse(buffer, `compras-${weekSlug}.xlsx`);
};

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
