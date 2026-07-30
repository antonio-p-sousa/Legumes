/**
 * Resource route: export xlsx das rotas de estafetas.
 *
 * Sem query params → workbook com uma folha por (data de entrega, estafeta).
 * Com ?data=<yyyy-mm-dd>&courier=<nome> → apenas essa rota.
 *
 * Colunas: Seq | Encomenda | Cliente | Telefone | Morada | CP | Cidade |
 * Subtotal | Notas | Janela. Filename: rotas-<weekLabel-slug>.xlsx.
 *
 * A montagem das folhas vive em services/export/packs.server.ts
 * (selectRotas + buildRotasWorkbook) — partilhada com scripts/pilot-pack.ts.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { slugifyWeekLabel } from "../services/pages/estafetas.server";
import {
  buildRotasWorkbook,
  selectRotas,
} from "../services/export/packs.server";
import { xlsxResponse } from "../services/export/xlsx.server";
import { buildRoutes } from "../services/weekly";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const weekData = await loadWeekData(prisma, admin);
  const routes = buildRoutes(weekData.processed, weekData.couriers);

  const params = new URL(request.url).searchParams;
  const selected = selectRotas(routes, {
    data: params.get("data"),
    courier: params.get("courier"),
  });

  if (selected.length === 0) {
    return new Response(
      "Sem rotas para exportar — verifica a semana, a data e o estafeta pedidos.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const buffer = await buildRotasWorkbook(selected);
  const filename = `rotas-${slugifyWeekLabel(weekData.meta.weekLabel)}.xlsx`;
  return xlsxResponse(buffer, filename);
};
