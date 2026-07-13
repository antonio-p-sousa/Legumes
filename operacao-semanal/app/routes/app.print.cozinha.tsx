/**
 * Resource route: versão de impressão do mapa de produção da cozinha.
 * GET /app/print/cozinha → HTML standalone print-friendly (o browser gera o
 * PDF via "Imprimir / Guardar como PDF"). ?dia=<2f|3f|4f|...> restringe ao
 * dia de confeção pedido. Sem default export — só devolve o documento.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildCozinhaView } from "../services/pages/cozinha.server";
import {
  buildCozinhaPrintSections,
  htmlResponse,
  renderPrintPage,
} from "../services/print/html.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const [weekData, dishes] = await Promise.all([
      loadWeekData(prisma, admin),
      prisma.dish.findMany({
        select: { baseName: true, category: true },
        orderBy: { baseName: "asc" },
      }),
    ]);

    const view = buildCozinhaView(weekData, dishes);
    const dia = new URL(request.url).searchParams.get("dia");

    const html = renderPrintPage({
      title: "Cozinha — Mapa de produção",
      subtitle:
        `Semana ${weekData.meta.weekLabel} · ${view.totalMeals} refeições · ` +
        `${view.totalOrders} encomendas`,
      sections: buildCozinhaPrintSections(view, dia),
    });
    return htmlResponse(html);
  } catch (error) {
    console.error("Falha a gerar a versão de impressão da cozinha", error);
    throw new Response(
      "Não foi possível gerar a versão de impressão da cozinha.",
      { status: 500 },
    );
  }
};
