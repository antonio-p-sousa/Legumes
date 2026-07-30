/**
 * Resource route: export xlsx do mapa de produção da cozinha.
 * GET /app/api/export/cozinha → uma folha por dia de confeção
 * (Prato | Dose | Quantidade, agrupado por categoria e prato),
 * mais "Não-cozinha" e "Resumo". Sem default export — só download.
 *
 * A montagem das folhas vive em services/export/packs.server.ts
 * (buildCozinhaWorkbook) — partilhada com scripts/pilot-pack.ts.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import {
  buildCozinhaView,
  weekLabelFileToken,
} from "../services/pages/cozinha.server";
import { buildCozinhaWorkbook } from "../services/export/packs.server";
import { xlsxResponse } from "../services/export/xlsx.server";

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
    const buffer = await buildCozinhaWorkbook(view);
    const token = weekLabelFileToken(weekData.meta.weekLabel);

    return xlsxResponse(buffer, `cozinha-${token}.xlsx`);
  } catch (error) {
    console.error("Falha a gerar o export xlsx da cozinha", error);
    throw new Response("Não foi possível gerar o ficheiro da cozinha.", {
      status: 500,
    });
  }
};
