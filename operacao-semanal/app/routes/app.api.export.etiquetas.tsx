/**
 * Resource route: export xlsx das etiquetas de impressão.
 * GET /app/api/export/etiquetas → uma folha por data de confeção,
 * 1 linha por refeição (o motor buildLabels já explode as quantidades),
 * ordenadas por lote de prato como o motor devolve. Sem default export.
 *
 * A montagem das folhas vive em services/export/packs.server.ts
 * (buildEtiquetasWorkbook) — partilhada com scripts/pilot-pack.ts.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildLabels } from "../services/weekly";
import { weekLabelFileToken } from "../services/pages/cozinha.server";
import { buildEtiquetasWorkbook } from "../services/export/packs.server";
import { xlsxResponse } from "../services/export/xlsx.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const labels = buildLabels(weekData.processed);
    const buffer = await buildEtiquetasWorkbook(labels);
    const token = weekLabelFileToken(weekData.meta.weekLabel);

    return xlsxResponse(buffer, `etiquetas-${token}.xlsx`);
  } catch (error) {
    console.error("Falha a gerar o export xlsx das etiquetas", error);
    throw new Response("Não foi possível gerar o ficheiro de etiquetas.", {
      status: 500,
    });
  }
};
