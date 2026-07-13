/**
 * Resource route: versão de impressão da lista de compras.
 * GET /app/print/compras → HTML standalone print-friendly: uma secção por
 * fornecedor (Ingrediente | Necessário | +margem | Unidade) + secção final
 * "Pratos sem ficha técnica" quando existam. ?fornecedor=<nome> restringe a
 * esse fornecedor (e omite a secção de pratos sem ficha — folha para
 * entregar ao próprio fornecedor).
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig } from "../services/definicoes/config.server";
import { loadRecipes, loadWeekData } from "../services/pages/common.server";
import { buildComprasView } from "../services/pages/compras.server";
import {
  buildComprasPrintSections,
  htmlResponse,
  renderPrintPage,
} from "../services/print/html.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
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
    const fornecedor = new URL(request.url).searchParams.get("fornecedor");
    const margemPct = Math.round(config.purchaseMargin * 100);

    const html = renderPrintPage({
      title: "Compras — Lista por fornecedor",
      subtitle:
        `Semana ${weekData.meta.weekLabel} · margem +${margemPct}%` +
        (fornecedor ? ` · fornecedor: ${fornecedor}` : ""),
      sections: buildComprasPrintSections(view, fornecedor),
    });
    return htmlResponse(html);
  } catch (error) {
    console.error("Falha a gerar a versão de impressão das compras", error);
    throw new Response(
      "Não foi possível gerar a versão de impressão das compras.",
      { status: 500 },
    );
  }
};
