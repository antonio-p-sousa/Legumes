/**
 * Resource route: versão de impressão das "Rotas de câmara".
 * GET /app/print/rotas-camara → HTML standalone LANDSCAPE (o browser gera o
 * PDF via "Imprimir / Guardar como PDF"). É o documento que a cozinha usa para
 * separar as refeições na câmara refrigerada, por dia de PRODUÇÃO e bloco de
 * destino lado a lado — cada linha `Encomenda | Cliente | Nº refeições`.
 *
 * NÃO imprime a lista-mestre (refeições por cliente): essa é coluna de
 * trabalho, o cliente não a imprime; fica disponível no export xlsx.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildChamberDoc, type ChamberDoc } from "../services/weekly";
import {
  htmlResponse,
  renderPrintPage,
  type PrintSection,
} from "../services/print/html.server";

/**
 * Uma secção por dia de produção; dentro, um bloco (coluna) por rota/destino,
 * lado a lado. Página nova por dia (breakBefore). A lista-mestre fica de fora.
 */
function buildChamberSections(doc: ChamberDoc): PrintSection[] {
  return doc.days.map((day, index) => ({
    heading: day.label,
    subheading:
      `${day.totalMeals} ${day.totalMeals === 1 ? "refeição" : "refeições"} · ` +
      `${day.totalOrders} ${day.totalOrders === 1 ? "encomenda" : "encomendas"}`,
    breakBefore: index > 0,
    // `columns` (blocos lado a lado) tem precedência na renderização; a `table`
    // é obrigatória no contrato mas fica só como fallback quando o dia não tem
    // blocos (dia sem encomendas nunca chega aqui, mas mantém o tipo coeso).
    table: { headers: ["Encomenda", "Cliente", "Nº refeições"], rows: [] },
    columns: day.blocks.map((block) => ({
      heading: `${block.label} · ${block.totalMeals} ref.`,
      table: {
        headers: ["Encomenda", "Cliente", "Nº refeições"],
        numericCols: [2],
        rows: block.rows.map((row) => [
          row.orderName,
          row.client,
          String(row.meals),
        ]),
        totals: ["Total", "", String(block.totalMeals)],
      },
    })),
  }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const doc = buildChamberDoc(weekData.processed);

    const totalMeals = doc.days.reduce((sum, day) => sum + day.totalMeals, 0);

    const html = renderPrintPage({
      title: `Rotas de câmara — ${weekData.meta.weekLabel}`,
      subtitle:
        `${doc.days.length} ${doc.days.length === 1 ? "dia de produção" : "dias de produção"} · ` +
        `${totalMeals} refeições`,
      note: "Separação das refeições na câmara refrigerada, por dia de produção e rota. Não inclui moradas.",
      landscape: true,
      sections: buildChamberSections(doc),
    });
    return htmlResponse(html);
  } catch (error) {
    console.error("Falha a gerar a versão de impressão das rotas de câmara", error);
    throw new Response(
      "Não foi possível gerar a versão de impressão das rotas de câmara.",
      { status: 500 },
    );
  }
};
