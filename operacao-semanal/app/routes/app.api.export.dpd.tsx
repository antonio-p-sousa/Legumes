/**
 * Resource route: export do CSV de importação DPD.
 *
 * O conteúdo é EXATAMENTE o que o motor produz (buildDpdCsv): 17 colunas,
 * sem cabeçalho, separador ';', linhas unidas com \r\n. O formato é
 * contratual com o portal DPD (ARCHITECTURE §4.6) — não alterar aqui.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { getConfig } from "../services/definicoes/config.server";
import {
  DPD_DEFAULT_ACCOUNT,
  slugifyWeekLabel,
} from "../services/pages/estafetas.server";
import { csvResponse } from "../services/export/xlsx.server";
import { buildDpdCsv } from "../services/weekly";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [weekData, config] = await Promise.all([
    loadWeekData(prisma, admin),
    getConfig(prisma),
  ]);

  const dpd = buildDpdCsv(weekData.processed, weekData.couriers, {
    account: config.dpdAccount ?? DPD_DEFAULT_ACCOUNT,
  });

  if (dpd.shipments === 0) {
    return new Response(
      "Sem envios DPD nesta semana — nada para exportar.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const filename = `dpd-${slugifyWeekLabel(weekData.meta.weekLabel)}.csv`;
  return csvResponse(dpd.csv, filename);
};
