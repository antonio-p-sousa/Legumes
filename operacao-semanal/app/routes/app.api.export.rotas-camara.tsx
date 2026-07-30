/**
 * Resource route: export xlsx das "Rotas de câmara".
 * GET /app/api/export/rotas-camara → uma folha por dia de PRODUÇÃO; dentro de
 * cada folha, por bloco de destino: cabeçalho do bloco + linhas
 * `Encomenda | Cliente | Nº refeições` + total. Uma folha final "Refeições por
 * cliente" reúne a lista-mestre (refeições por cliente/dia).
 *
 * Filename: rotas-camara-<weekLabel-slug>.xlsx. Sem default export — download.
 *
 * A montagem das folhas vive em services/export/packs.server.ts
 * (buildRotasCamaraWorkbook) — partilhada com scripts/pilot-pack.ts.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { slugifyWeekLabel } from "../services/pages/estafetas.server";
import { buildChamberDoc } from "../services/weekly";
import { buildRotasCamaraWorkbook } from "../services/export/packs.server";
import { xlsxResponse } from "../services/export/xlsx.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const doc = buildChamberDoc(weekData.processed);

    const buffer = await buildRotasCamaraWorkbook(doc);
    const filename = `rotas-camara-${slugifyWeekLabel(weekData.meta.weekLabel)}.xlsx`;
    return xlsxResponse(buffer, filename);
  } catch (error) {
    console.error("Falha a gerar o export xlsx das rotas de câmara", error);
    throw new Response(
      "Não foi possível gerar o ficheiro das rotas de câmara.",
      { status: 500 },
    );
  }
};
