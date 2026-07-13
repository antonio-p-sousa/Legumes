/**
 * Resource route: export xlsx do mapa de produção da cozinha.
 * GET /app/api/export/cozinha → uma folha por dia de confeção
 * (Prato | Dose | Quantidade, agrupado por categoria e prato),
 * mais "Não-cozinha" e "Resumo". Sem default export — só download.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import {
  buildCozinhaDaySheetRows,
  buildCozinhaView,
  confDaySheetName,
  weekLabelFileToken,
  type CozinhaView,
} from "../services/pages/cozinha.server";
import {
  buildWorkbook,
  xlsxResponse,
  type SheetSpec,
} from "../services/export/xlsx.server";

const DAY_COLUMNS: SheetSpec["columns"] = [
  { header: "Prato", key: "prato", width: 44 },
  { header: "Dose", key: "dose", width: 16 },
  { header: "Quantidade", key: "quantidade", width: 12 },
];

function buildSheets(view: CozinhaView): SheetSpec[] {
  const daySheets: SheetSpec[] = view.days.map((day) => ({
    name: confDaySheetName(day),
    columns: DAY_COLUMNS,
    rows: [
      ...buildCozinhaDaySheetRows(day).map((row) => ({
        prato: row.prato,
        dose: row.dose,
        quantidade: row.quantidade,
      })),
      { prato: "TOTAL", dose: "", quantidade: day.totalMeals },
    ],
  }));

  const nonMealSheet: SheetSpec = {
    name: "Não-cozinha",
    columns: DAY_COLUMNS,
    rows: view.nonMeal.map((row) => ({
      prato: row.dish,
      dose: row.dose,
      quantidade: row.quantity,
    })),
  };

  const resumoSheet: SheetSpec = {
    name: "Resumo",
    columns: [
      { header: "Dia", key: "dia", width: 22 },
      { header: "Refeições", key: "refeicoes", width: 12 },
      { header: "Encomendas", key: "encomendas", width: 12 },
    ],
    rows: [
      ...view.days.map((day) => ({
        dia: confDaySheetName(day),
        refeicoes: day.totalMeals,
        encomendas: day.totalOrders,
      })),
      {
        dia: "TOTAL",
        refeicoes: view.totalMeals,
        encomendas: view.totalOrders,
      },
    ],
  };

  return [...daySheets, nonMealSheet, resumoSheet];
}

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
    const buffer = await buildWorkbook(buildSheets(view));
    const token = weekLabelFileToken(weekData.meta.weekLabel);

    return xlsxResponse(buffer, `cozinha-${token}.xlsx`);
  } catch (error) {
    console.error("Falha a gerar o export xlsx da cozinha", error);
    throw new Response("Não foi possível gerar o ficheiro da cozinha.", {
      status: 500,
    });
  }
};
