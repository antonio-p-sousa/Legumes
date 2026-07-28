/**
 * Resource route: export xlsx das "Rotas de câmara".
 * GET /app/api/export/rotas-camara → uma folha por dia de PRODUÇÃO; dentro de
 * cada folha, por bloco de destino: cabeçalho do bloco + linhas
 * `Encomenda | Cliente | Nº refeições` + total. Uma folha final "Refeições por
 * cliente" reúne a lista-mestre (refeições por cliente/dia).
 *
 * Filename: rotas-camara-<weekLabel-slug>.xlsx. Sem default export — download.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { slugifyWeekLabel } from "../services/pages/estafetas.server";
import { buildChamberDoc, type ChamberDoc } from "../services/weekly";
import {
  buildWorkbook,
  xlsxResponse,
  type SheetSpec,
} from "../services/export/xlsx.server";

const DAY_COLUMNS: SheetSpec["columns"] = [
  { header: "Encomenda", key: "encomenda", width: 16 },
  { header: "Cliente", key: "cliente", width: 34 },
  { header: "Nº refeições", key: "refeicoes", width: 14 },
];

const MASTER_COLUMNS: SheetSpec["columns"] = [
  { header: "Dia", key: "dia", width: 14 },
  { header: "Cliente", key: "cliente", width: 34 },
  { header: "Nº refeições", key: "refeicoes", width: 14 },
];

type DayRow = { encomenda: string; cliente: string; refeicoes: number | "" };

/**
 * Linhas de uma folha-dia: por bloco, um cabeçalho, as linhas e o total; uma
 * linha em branco separa blocos. Fecha com o total do dia.
 */
function buildDaySheetRows(day: ChamberDoc["days"][number]): DayRow[] {
  const rows: DayRow[] = [];

  day.blocks.forEach((block, index) => {
    if (index > 0) rows.push({ encomenda: "", cliente: "", refeicoes: "" });
    rows.push({ encomenda: block.label, cliente: "", refeicoes: "" });
    for (const row of block.rows) {
      rows.push({
        encomenda: row.orderName,
        cliente: row.client,
        refeicoes: row.meals,
      });
    }
    rows.push({ encomenda: "Total", cliente: "", refeicoes: block.totalMeals });
  });

  rows.push({ encomenda: "", cliente: "", refeicoes: "" });
  rows.push({ encomenda: "TOTAL DIA", cliente: "", refeicoes: day.totalMeals });
  return rows;
}

/** Uma folha por dia de produção; nomes únicos (labels PT são distintos). */
function buildSheets(doc: ChamberDoc): SheetSpec[] {
  const daySheets: SheetSpec[] = doc.days.map((day) => ({
    name: day.label,
    columns: DAY_COLUMNS,
    rows: buildDaySheetRows(day),
  }));

  const masterSheet: SheetSpec = {
    name: "Refeições por cliente",
    columns: MASTER_COLUMNS,
    rows: doc.days.flatMap((day) =>
      day.master.map((client) => ({
        dia: day.label,
        cliente: client.client,
        refeicoes: client.meals,
      })),
    ),
  };

  return [...daySheets, masterSheet];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const doc = buildChamberDoc(weekData.processed);

    const buffer = await buildWorkbook(buildSheets(doc));
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
