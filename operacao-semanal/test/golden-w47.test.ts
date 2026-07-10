import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildDpdCsv,
  buildKitchenMap,
  buildLabels,
  buildPurchaseList,
  buildRoutes,
  processOrders,
} from "../app/services/weekly";
import type { ConfDay, OrderInput } from "../app/services/weekly";
import { COURIERS_W47, ZONES_W47 } from "./fixtures/zones-w47";

/**
 * GOLDEN TEST — semana 47 de 2025, amostra real anonimizada (185 encomendas).
 * Alimenta o motor completo com `w47-orders.json` e afirma os totais do
 * processo manual real (`w47-golden.json` + mapa de produção do operador).
 * Ver ARCHITECTURE.md secção 11.
 */

interface GoldenReference {
  orders: number;
  lineItems: number;
  totalUnits: number;
  unitsByDia: Record<string, number>;
  ordersByDia: Record<string, number>;
  ordersSemZona: number;
  distinctProducts: number;
  totalRevenue: number;
}

function loadFixture<T>(filename: string): T {
  const url = new URL(`./fixtures/${filename}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as T;
}

const ORDERS = loadFixture<OrderInput[]>("w47-orders.json");
const GOLDEN = loadFixture<GoldenReference>("w47-golden.json");

// Sem janela: o export w47 É a semana fechada. (A última encomenda,
// #45184-LoV, foi criada sáb 22/11 01:28 — uma janela teórica sáb→sex
// tê-la-ia excluído, mas o processo manual real incluiu-a.)
const { processed, excludedByWindow } = processOrders(ORDERS, ZONES_W47);
const kitchen = buildKitchenMap(processed);

const mealsByConfDay = Object.fromEntries(
  kitchen.days.map((day) => [day.confDay, day.totalMeals]),
) as Record<ConfDay, number>;

describe("golden w47 — pipeline (processOrders)", () => {
  test("processa as 185 encomendas sem excluir nenhuma", () => {
    expect(processed).toHaveLength(GOLDEN.orders);
    expect(processed).toHaveLength(185);
    expect(excludedByWindow).toHaveLength(0);
  });

  test("preserva os 1028 line items e as 1522 unidades", () => {
    const lineItems = processed.reduce(
      (sum, p) => sum + p.order.lineItems.length,
      0,
    );
    const units = processed.reduce(
      (sum, p) =>
        sum + p.order.lineItems.reduce((t, li) => t + li.quantity, 0),
      0,
    );

    expect(lineItems).toBe(GOLDEN.lineItems);
    expect(lineItems).toBe(1028);
    expect(units).toBe(GOLDEN.totalUnits);
  });

  test("receita total = 10798.18 (±0.01)", () => {
    const revenue = processed.reduce((sum, p) => sum + p.order.totalPrice, 0);

    expect(Math.abs(revenue - GOLDEN.totalRevenue)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(revenue - 10798.18)).toBeLessThanOrEqual(0.01);
  });

  test("encomendas por dia de entrega: Segunda 41 · Terça 126 · Quarta 11 · Quinta 7", () => {
    const byDia: Record<string, number> = {};
    for (const p of processed) {
      const dia = p.delivery?.dia ?? "<sem delivery>";
      byDia[dia] = (byDia[dia] ?? 0) + 1;
    }

    expect(byDia).toEqual(GOLDEN.ordersByDia);
    expect(byDia).toEqual({ Segunda: 41, Terça: 126, Quarta: 11, Quinta: 7 });
  });

  test("unidades por dia de entrega batem certo com o golden", () => {
    const byDia: Record<string, number> = {};
    for (const p of processed) {
      const dia = p.delivery?.dia ?? "<sem delivery>";
      byDia[dia] =
        (byDia[dia] ?? 0) +
        p.order.lineItems.reduce((t, li) => t + li.quantity, 0);
    }

    expect(byDia).toEqual(GOLDEN.unitsByDia);
  });

  test("53 produtos distintos nos line items", () => {
    const names = new Set(
      processed.flatMap((p) => p.order.lineItems.map((li) => li.name)),
    );

    expect(names.size).toBe(GOLDEN.distinctProducts);
  });

  test("0 encomendas com atributos-entrega-em-falta e 0 com zona-desconhecida", () => {
    const semAtributos = processed.filter((p) =>
      p.issues.includes("atributos-entrega-em-falta"),
    );
    const zonaDesconhecida = processed.filter((p) =>
      p.issues.some((issue) => issue.startsWith("zona-desconhecida:")),
    );

    expect(semAtributos).toHaveLength(GOLDEN.ordersSemZona);
    expect(semAtributos).toHaveLength(0);
    expect(zonaDesconhecida).toHaveLength(0);
    expect(processed.every((p) => p.confDay !== undefined)).toBe(true);
  });
});

describe("golden w47 — cozinha (buildKitchenMap)", () => {
  // Referência do processo manual real da w47: 2f=940 · 3f=418 · 4f=50 (=1408).
  // O motor devolve 944 · 443 · 49 (=1436). Desvio de +28, 100% explicado:
  //   · +4 em 2f  — #45002-LoV (pickup com "Data de entrega" 17/11, semana
  //     ANTERIOR): o operador excluiu-a à mão; o motor nunca descarta.
  //   · +10 em 3f — #45000-LoV (voided) e #45001-LoV, pickups com data 18/11
  //     (semana anterior): idem, excluídas à mão pelo operador.
  //   · +15 em 3f / −15 em 4f — #45118-LoV e #45128-LoV, pickups de QUARTA no
  //     slot "07:00 PM - 09:00 PM": o operador confecionou-as a 4f; o motor
  //     fixa o slot em 3f porque uma zona só tem um confDay (decisão empírica
  //     documentada em fixtures/zones-w47.ts — 18 das 20 encomendas do slot
  //     são de Terça).
  //   · +14 em 4f — #45175-LoV e #45177-LoV (DPD Quinta, pagamento pending):
  //     o operador excluiu-as; a sinalização/exclusão é decisão do operador na
  //     UI, não do motor.
  // Verificação: 940+4=944 ✓ · 418+10+15=443 ✓ · 50−15+14=49 ✓ · 1408+28=1436 ✓
  test("refeições por dia de confeção: 2f=944 · 3f=418+25 · 4f=50−1 (ver desvios acima)", () => {
    expect(mealsByConfDay).toEqual({ "2f": 944, "3f": 443, "4f": 49 });
    expect(kitchen.days.map((d) => d.confDay)).toEqual(["2f", "3f", "4f"]);
  });

  test("total de refeições da semana = 1436 (1408 do operador + 28 explicados)", () => {
    expect(kitchen.totalMeals).toBe(1436);
  });

  test("as somas por dia são consistentes com o total", () => {
    const sum = kitchen.days.reduce((total, day) => total + day.totalMeals, 0);

    expect(sum).toBe(kitchen.totalMeals);
  });
});

describe("golden w47 — etiquetas (buildLabels)", () => {
  test("uma etiqueta por refeição: total = totalMeals do mapa de cozinha", () => {
    const labels = buildLabels(processed);

    expect(labels).toHaveLength(kitchen.totalMeals);
    expect(labels).toHaveLength(1436);
  });
});

describe("golden w47 — DPD (buildDpdCsv)", () => {
  const dpd = buildDpdCsv(processed, COURIERS_W47, { account: "LEGUMES" });

  // Referência real: "61 envios na recolha de 2f + os de 3f". O fixture contém
  // 78 encomendas DPD com entrega Terça (recolha 2f) — o valor 61 da referência
  // não é reconstituível a partir do export (curiosidade: 61 é o nº de
  // LOCALIDADES distintas desses envios; a referência do operador poderá ter
  // sido contada de um resumo por localidade). O motor emite 1 envio por
  // encomenda DPD: 78 (recolha 2f) + 9 (recolha 3f) + 7 (recolha 4f) = 94,
  // exatamente as 94 encomendas "Portugal Continental 08-15h" do fixture.
  test("94 envios no total: 78 na recolha de 2f, 9 na de 3f, 7 na de 4f", () => {
    const byConfDay = (confDay: ConfDay) =>
      buildDpdCsv(
        processed.filter((p) => p.confDay === confDay),
        COURIERS_W47,
        { account: "LEGUMES" },
      ).shipments;

    expect(dpd.shipments).toBe(94);
    expect(byConfDay("2f")).toBe(78);
    expect(byConfDay("3f")).toBe(9);
    expect(byConfDay("4f")).toBe(7);
  });

  test("todas as linhas têm exatamente 17 campos", () => {
    const lines = dpd.csv.split("\r\n");

    expect(lines).toHaveLength(dpd.shipments);
    for (const line of lines) {
      expect(line.split(";")).toHaveLength(17);
    }
  });

  test("nenhum telefone com +351 e nenhum campo com ';'", () => {
    // O separador ';' só pode existir ENTRE campos: 16 por linha.
    for (const line of dpd.csv.split("\r\n")) {
      expect(line.match(/;/g)).toHaveLength(16);
    }
    expect(dpd.csv).not.toContain("+351");
  });
});

describe("golden w47 — rotas (buildRoutes)", () => {
  const routes = buildRoutes(processed, COURIERS_W47);

  // Números do motor, fixados após inspeção: 8 rotas / 91 paragens
  // (185 encomendas − 94 DPD = 91). "Recolha em loja" tem 5 rotas porque os
  // pickups do fixture caem em 5 datas de entrega distintas — incluindo as
  // 3 encomendas com datas da semana anterior (17/11 e 18/11) que o operador
  // excluiu à mão e o motor mantém (sinalizadas pelas datas, nunca descartadas).
  test("8 rotas ordenadas por data e courier, com as paragens esperadas", () => {
    const resumo = routes.map(
      (r) => `${r.deliveryDate} ${r.courier} (${r.stops.length})`,
    );

    expect(resumo).toEqual([
      "2025-11-17 Recolha em loja (1)",
      "2025-11-18 Recolha em loja (2)",
      "2025-11-24 Parceiro Leiria (9)",
      "2025-11-24 Parceiro Lisboa (29)",
      "2025-11-24 Recolha em loja (2)",
      "2025-11-25 Interno Coimbra (30)",
      "2025-11-25 Recolha em loja (16)",
      "2025-11-26 Recolha em loja (2)",
    ]);
  });

  test("91 paragens no total = 185 encomendas − 94 envios DPD", () => {
    const stops = routes.reduce((sum, r) => sum + r.stops.length, 0);

    expect(stops).toBe(91);
  });

  test("parceiros com ordering postcode têm sequence 1..n", () => {
    const lisboa = routes.find((r) => r.courier === "Parceiro Lisboa");

    expect(lisboa?.stops.map((s) => s.sequence)).toEqual(
      lisboa?.stops.map((_, i) => i + 1),
    );
  });
});

describe("golden w47 — compras (buildPurchaseList) sem fichas técnicas", () => {
  test("com recipes=[] nada é comprado e nenhum prato desaparece em silêncio", () => {
    const purchases = buildPurchaseList(processed, [], 0.08);

    const unitsMissing = purchases.missingRecipes.reduce(
      (sum, m) => sum + m.unitsSold,
      0,
    );

    expect(purchases.suppliers).toEqual([]);
    expect(purchases.missingRecipes.length).toBeGreaterThan(0);
    // Sanity: todas as refeições da cozinha aparecem como ficha em falta.
    expect(unitsMissing).toBe(kitchen.totalMeals);
    expect(unitsMissing).toBe(1436);
  });
});
