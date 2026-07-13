/**
 * Resource route: versão de impressão das rotas de estafetas.
 * GET /app/print/rotas → HTML standalone print-friendly, uma página por rota
 * (é a folha que se entrega a cada estafeta). Mesmos query params do export
 * xlsx: ?data=<yyyy-mm-dd>&courier=<nome> restringem às rotas pedidas.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildRoutes } from "../services/weekly";
import {
  buildRotasPrintSections,
  htmlResponse,
  renderPrintPage,
} from "../services/print/html.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const routes = buildRoutes(weekData.processed, weekData.couriers);

    const params = new URL(request.url).searchParams;
    const data = params.get("data");
    const courier = params.get("courier");

    const selected = routes.filter(
      (route) =>
        (data === null || route.deliveryDate === data) &&
        (courier === null || route.courier === courier),
    );
    const totalStops = selected.reduce(
      (sum, route) => sum + route.stops.length,
      0,
    );

    const html = renderPrintPage({
      title: "Estafetas — Rotas de entrega",
      subtitle:
        `Semana ${weekData.meta.weekLabel} · ${selected.length} rotas · ` +
        `${totalStops} paragens`,
      sections: buildRotasPrintSections(selected),
    });
    return htmlResponse(html);
  } catch (error) {
    console.error("Falha a gerar a versão de impressão das rotas", error);
    throw new Response(
      "Não foi possível gerar a versão de impressão das rotas.",
      { status: 500 },
    );
  }
};
