/**
 * Resource route: export xlsx das rotas de estafetas.
 *
 * Sem query params → workbook com uma folha por (data de entrega, estafeta).
 * Com ?data=<yyyy-mm-dd>&courier=<nome> → apenas essa rota.
 *
 * Colunas: Seq | Encomenda | Cliente | Telefone | Morada | CP | Cidade |
 * Subtotal | Notas | Janela. Filename: rotas-<weekLabel-slug>.xlsx.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { slugifyWeekLabel } from "../services/pages/estafetas.server";
import {
  buildWorkbook,
  xlsxResponse,
  type SheetSpec,
} from "../services/export/xlsx.server";
import { buildRoutes, type Route } from "../services/weekly";

const ROUTE_COLUMNS: SheetSpec["columns"] = [
  { header: "Seq", key: "seq", width: 6 },
  { header: "Encomenda", key: "encomenda", width: 14 },
  { header: "Cliente", key: "cliente", width: 24 },
  { header: "Telefone", key: "telefone", width: 14 },
  { header: "Morada", key: "morada", width: 36 },
  { header: "CP", key: "cp", width: 10 },
  { header: "Cidade", key: "cidade", width: 16 },
  { header: "Subtotal", key: "subtotal", width: 10 },
  { header: "Notas", key: "notas", width: 40 },
  { header: "Janela", key: "janela", width: 28 },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const weekData = await loadWeekData(prisma, admin);
  const routes = buildRoutes(weekData.processed, weekData.couriers);

  const params = new URL(request.url).searchParams;
  const data = params.get("data");
  const courier = params.get("courier");

  const selected = routes.filter(
    (route) =>
      (data === null || route.deliveryDate === data) &&
      (courier === null || route.courier === courier),
  );

  if (selected.length === 0) {
    return new Response(
      "Sem rotas para exportar — verifica a semana, a data e o estafeta pedidos.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const buffer = await buildWorkbook(buildRouteSheets(selected));
  const filename = `rotas-${slugifyWeekLabel(weekData.meta.weekLabel)}.xlsx`;
  return xlsxResponse(buffer, filename);
};

/** Uma folha por rota, com nomes únicos ("24-11 Off Limits", ...). */
function buildRouteSheets(routes: Route[]): SheetSpec[] {
  const usedNames = new Set<string>();

  return routes.map((route) => ({
    name: uniqueSheetName(sheetNameFor(route), usedNames),
    columns: ROUTE_COLUMNS,
    rows: route.stops.map((stop) => ({
      seq: stop.sequence ?? "",
      encomenda: stop.orderName,
      cliente: stop.client,
      telefone: stop.phone,
      morada: stop.address1,
      cp: stop.zip,
      cidade: stop.city,
      subtotal: stop.subtotal,
      notas: stop.note ?? "",
      janela: stop.window ?? "",
    })),
  }));
}

/** "2025-11-24" + "Off Limits" → "24-11 Off Limits" (cabe nos 31 chars xlsx). */
function sheetNameFor(route: Route): string {
  const ddMm = `${route.deliveryDate.slice(8, 10)}-${route.deliveryDate.slice(5, 7)}`;
  return `${ddMm} ${route.courier}`.slice(0, 31);
}

/**
 * O xlsx exige nomes de folha únicos; nomes longos truncados aos 31 chars
 * podem colidir — desambigua com um sufixo numérico.
 */
function uniqueSheetName(base: string, used: Set<string>): string {
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}
