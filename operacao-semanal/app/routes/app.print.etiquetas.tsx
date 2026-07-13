/**
 * Resource route: versão de impressão (conferência) das etiquetas.
 * GET /app/print/etiquetas → HTML standalone print-friendly com 1 linha por
 * refeição (o motor buildLabels explode as quantidades), agrupado por data
 * de confeção. ?dia=<yyyy-mm-dd> restringe a essa data de confeção.
 * Nota no topo: é uma versão de conferência — as etiquetas autocolantes
 * ficam para uma fase posterior.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildLabels } from "../services/weekly";
import {
  buildEtiquetasPrintSections,
  ETIQUETAS_PRINT_NOTE,
  htmlResponse,
  renderPrintPage,
} from "../services/print/html.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const weekData = await loadWeekData(prisma, admin);
    const labels = buildLabels(weekData.processed);

    const dia = new URL(request.url).searchParams.get("dia");
    const sections = buildEtiquetasPrintSections(labels, dia);
    const totalEtiquetas = sections.reduce(
      (sum, section) => sum + section.table.rows.length,
      0,
    );

    const html = renderPrintPage({
      title: "Etiquetas — Versão de conferência",
      subtitle: `Semana ${weekData.meta.weekLabel} · ${totalEtiquetas} etiquetas`,
      note: ETIQUETAS_PRINT_NOTE,
      sections,
    });
    return htmlResponse(html);
  } catch (error) {
    console.error("Falha a gerar a versão de impressão das etiquetas", error);
    throw new Response(
      "Não foi possível gerar a versão de impressão das etiquetas.",
      { status: 500 },
    );
  }
};
