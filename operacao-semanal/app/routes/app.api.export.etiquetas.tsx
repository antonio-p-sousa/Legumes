/**
 * Resource route: export xlsx das etiquetas de impressão.
 * GET /app/api/export/etiquetas → uma folha por data de confeção,
 * 1 linha por refeição (o motor buildLabels já explode as quantidades),
 * ordenadas por lote de prato como o motor devolve. Sem default export.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildLabels } from "../services/weekly";
import type { LabelRow } from "../services/weekly";
import {
  confDateSheetName,
  groupLabelsByConfDate,
  isoToPtDate,
  weekLabelFileToken,
} from "../services/pages/cozinha.server";
import {
  buildWorkbook,
  xlsxResponse,
  type SheetSpec,
} from "../services/export/xlsx.server";

const LABEL_COLUMNS: SheetSpec["columns"] = [
  { header: "Encomenda", key: "encomenda", width: 14 },
  { header: "Prato", key: "prato", width: 52 },
  { header: "Cliente", key: "cliente", width: 28 },
  { header: "Data Confeção", key: "dataConfecao", width: 14 },
];

function buildSheets(labels: LabelRow[]): SheetSpec[] {
  const groups = groupLabelsByConfDate(labels);

  if (groups.length === 0) {
    // Workbook xlsx precisa de ≥1 folha; sem etiquetas devolve-se uma vazia.
    return [{ name: "Etiquetas", columns: LABEL_COLUMNS, rows: [] }];
  }

  return groups.map((group) => ({
    name: confDateSheetName(group.confDate),
    columns: LABEL_COLUMNS,
    rows: group.rows.map((row) => ({
      encomenda: row.orderName,
      prato: row.dish,
      cliente: row.client,
      dataConfecao: isoToPtDate(row.confDate),
    })),
  }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const labels = buildLabels(weekData.processed);
    const buffer = await buildWorkbook(buildSheets(labels));
    const token = weekLabelFileToken(weekData.meta.weekLabel);

    return xlsxResponse(buffer, `etiquetas-${token}.xlsx`);
  } catch (error) {
    console.error("Falha a gerar o export xlsx das etiquetas", error);
    throw new Response("Não foi possível gerar o ficheiro de etiquetas.", {
      status: 500,
    });
  }
};
