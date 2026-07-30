import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import {
  buildCozinhaWorkbook,
  buildEtiquetasWorkbook,
  selectRotas,
} from "./packs.server";
import {
  PEIXE_CARNE_DOSES,
  VEGETARIANO_DOSES,
  type CozinhaView,
} from "../pages/cozinha.server";
import type { Route } from "../weekly";

// ── Fixtures mínimas (determinísticas, sem BD/Shopify) ──────────────────────

function makeCozinhaView(): CozinhaView {
  return {
    days: [
      {
        confDay: "2f",
        label: "Segunda",
        confDate: "2025-11-24",
        totalMeals: 3,
        totalOrders: 2,
        peixeCarne: {
          doseColumns: [...PEIXE_CARNE_DOSES],
          rows: [
            { dish: "Frango grelhado", cells: [2, null, null, null], total: 2 },
          ],
          columnTotals: [2, 0, 0, 0],
          total: 2,
        },
        vegetariano: {
          doseColumns: [...VEGETARIANO_DOSES],
          rows: [],
          columnTotals: [0, 0, 0],
          total: 0,
        },
        pokes: [],
        doseUnica: [{ dish: "Sopa de legumes", dose: "Dose única", quantity: 1 }],
        notes: [],
      },
    ],
    totalMeals: 3,
    totalOrders: 2,
    nonMeal: [{ dish: "Granola", dose: "250g", quantity: 1 }],
  };
}

function makeRoute(overrides: Partial<Route>): Route {
  return {
    courier: "Off Limits",
    courierType: "partner",
    deliveryDay: "Segunda",
    deliveryDate: "2025-11-24",
    stops: [],
    ...overrides,
  };
}

// ── Testes ──────────────────────────────────────────────────────────────────

describe("buildCozinhaWorkbook", () => {
  test("devolve buffer xlsx não-vazio com as folhas esperadas", async () => {
    const buffer = await buildCozinhaWorkbook(makeCozinhaView());

    expect(buffer.length).toBeGreaterThan(0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      "Segunda 24-11",
      "Não-cozinha",
      "Resumo",
    ]);

    // Folha do dia: header + 2 linhas de prato + linha TOTAL do dia.
    const daySheet = wb.getWorksheet("Segunda 24-11");
    expect(daySheet?.rowCount).toBe(4);
    expect(daySheet?.getRow(4).getCell(1).value).toBe("TOTAL");
    expect(daySheet?.getRow(4).getCell(3).value).toBe(3);

    // Resumo fecha com o TOTAL da semana.
    const resumo = wb.getWorksheet("Resumo");
    expect(resumo?.getRow(3).getCell(1).value).toBe("TOTAL");
    expect(resumo?.getRow(3).getCell(2).value).toBe(3);
    expect(resumo?.getRow(3).getCell(3).value).toBe(2);
  });
});

describe("buildEtiquetasWorkbook", () => {
  test("sem etiquetas devolve workbook com uma folha vazia 'Etiquetas'", async () => {
    const buffer = await buildEtiquetasWorkbook([]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Etiquetas"]);
    // Só o cabeçalho.
    expect(wb.getWorksheet("Etiquetas")?.rowCount).toBe(1);
  });
});

describe("selectRotas", () => {
  const routes: Route[] = [
    makeRoute({ courier: "Off Limits", deliveryDate: "2025-11-24" }),
    makeRoute({ courier: "DPD", courierType: "dpd", deliveryDate: "2025-11-24" }),
    makeRoute({ courier: "Off Limits", deliveryDate: "2025-11-25" }),
  ];

  test("sem seleção devolve todas as rotas", () => {
    expect(selectRotas(routes)).toEqual(routes);
    expect(selectRotas(routes, { data: null, courier: null })).toEqual(routes);
  });

  test("filtra por data e estafeta como os query params ?data=/?courier=", () => {
    expect(selectRotas(routes, { data: "2025-11-24" })).toHaveLength(2);
    expect(selectRotas(routes, { courier: "Off Limits" })).toHaveLength(2);
    expect(
      selectRotas(routes, { data: "2025-11-24", courier: "Off Limits" }),
    ).toEqual([routes[0]]);
    expect(selectRotas(routes, { data: "2099-01-01" })).toEqual([]);
  });
});
