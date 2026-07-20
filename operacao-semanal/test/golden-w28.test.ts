import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildDpdCsv,
  buildKitchenMap,
  buildLabels,
  buildRoutes,
  processOrders,
} from "../app/services/weekly";
import type { ConfDay, OrderInput } from "../app/services/weekly";
import { COURIERS_W28, ZONES_W28 } from "./fixtures/zones-w28";

/**
 * GOLDEN TEST 2 — semana 28 de 2026, amostra real anonimizada (197 encomendas).
 * Valida o CALENDÁRIO NOVO de produção (DOM/2f/3f — vídeos do cliente,
 * docs/RECONCILIACAO-VIDEOS.md); o golden da w47 valida o antigo (2f/3f/4f).
 *
 * GABARITO REAL — Etiquetas produzidas pelo processo manual do cliente,
 * total validado pelo próprio em vídeo ("dá 1.254, 1.254, está tudo certo"):
 *   confeção Domingo 12/07 = 230 · Segunda 13/07 = 576 · Terça 14/07 = 448
 *   TOTAL 1254
 * A reconciliação motor↔gabarito (desvio de −11, 100% explicado) está no
 * describe da cozinha; as decisões de config estão em fixtures/zones-w28.ts.
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

const ORDERS = loadFixture<OrderInput[]>("w28-orders.json");
const GOLDEN = loadFixture<GoldenReference>("w28-golden.json");

// Sem janela: o export w28 É a semana fechada (mesma decisão do golden w47).
const { processed, excludedByWindow } = processOrders(ORDERS, ZONES_W28);
const kitchen = buildKitchenMap(processed);

const mealsByConfDay = Object.fromEntries(
  kitchen.days.map((day) => [day.confDay, day.totalMeals]),
) as Record<ConfDay, number>;

describe("golden w28 — pipeline (processOrders)", () => {
  test("processa as 197 encomendas sem excluir nenhuma", () => {
    expect(processed).toHaveLength(GOLDEN.orders);
    expect(processed).toHaveLength(197);
    expect(excludedByWindow).toHaveLength(0);
  });

  test("preserva os 918 line items e as 1353 unidades", () => {
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
    expect(lineItems).toBe(918);
    expect(units).toBe(GOLDEN.totalUnits);
    expect(units).toBe(1353);
  });

  test("receita total = 9554.33 (±0.01)", () => {
    const revenue = processed.reduce((sum, p) => sum + p.order.totalPrice, 0);

    expect(Math.abs(revenue - GOLDEN.totalRevenue)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(revenue - 9554.33)).toBeLessThanOrEqual(0.01);
  });

  test("encomendas por dia de entrega: Domingo 18 · Segunda 17 · Terça 119 · Quarta 6 (+37 sem dia)", () => {
    const byDia: Record<string, number> = {};
    for (const p of processed) {
      // "<sem dia>" replica a chave usada pelo gerador de fixtures.
      const dia = p.delivery?.dia ?? "<sem dia>";
      byDia[dia] = (byDia[dia] ?? 0) + 1;
    }

    expect(byDia).toEqual(GOLDEN.ordersByDia);
    expect(byDia).toEqual({
      Domingo: 18,
      Segunda: 17,
      Terça: 119,
      Quarta: 6,
      "<sem dia>": 37,
    });
  });

  test("unidades por dia de entrega batem certo com o golden", () => {
    const byDia: Record<string, number> = {};
    for (const p of processed) {
      const dia = p.delivery?.dia ?? "<sem dia>";
      byDia[dia] =
        (byDia[dia] ?? 0) +
        p.order.lineItems.reduce((t, li) => t + li.quantity, 0);
    }

    expect(byDia).toEqual(GOLDEN.unitsByDia);
    expect(byDia).toEqual({
      Domingo: 153,
      Segunda: 153,
      Terça: 959,
      Quarta: 41,
      "<sem dia>": 47,
    });
  });

  test("40 produtos distintos nos line items", () => {
    const names = new Set(
      processed.flatMap((p) => p.order.lineItems.map((li) => li.name)),
    );

    expect(names.size).toBe(GOLDEN.distinctProducts);
    expect(names.size).toBe(40);
  });

  // 37 encomendas SEM bloco de entrega — sinalizadas, NUNCA descartadas:
  //   · 34 renovações de subscrição: só têm "Order Type" nos Note Attributes
  //     (sem data/zona/dia) e exatamente 1 line item "Subscrição de desconto
  //     mensal - 15% OFF" — não-refeição, o processo manual apaga-as.
  //   · 3 sem Note Attributes NENHUNS (#51054-LoV, #50920-LoV, #50913-LoV) —
  //     o erro recorrente da regra 4.1; é o operador que as resolve à mão
  //     (ver reconciliação da cozinha: 11 refeições destas 3 entram no
  //     gabarito real).
  test("37 com atributos-entrega-em-falta (34 subscrições + 3 sem atributos) e 0 zona-desconhecida", () => {
    const semAtributos = processed.filter((p) =>
      p.issues.includes("atributos-entrega-em-falta"),
    );
    const zonaDesconhecida = processed.filter((p) =>
      p.issues.some((issue) => issue.startsWith("zona-desconhecida:")),
    );

    expect(semAtributos).toHaveLength(GOLDEN.ordersSemZona);
    expect(semAtributos).toHaveLength(37);

    const soSubscricao = semAtributos.filter(
      (p) =>
        p.order.customAttributes.length > 0 &&
        p.order.lineItems.length === 1 &&
        /subscri/i.test(p.order.lineItems[0].name),
    );
    const semNenhumAtributo = semAtributos.filter(
      (p) => p.order.customAttributes.length === 0,
    );

    expect(soSubscricao).toHaveLength(34);
    expect(semNenhumAtributo.map((p) => p.order.name).sort()).toEqual([
      "#50913-LoV",
      "#50920-LoV",
      "#51054-LoV",
    ]);

    expect(zonaDesconhecida).toHaveLength(0);
    // Todas as encomendas com atributos de entrega resolvem confDay.
    expect(
      processed
        .filter((p) => p.delivery !== null)
        .every((p) => p.confDay !== undefined),
    ).toBe(true);
  });
});

describe("golden w28 — cozinha (buildKitchenMap)", () => {
  // GABARITO (Etiquetas reais): Dom=230 · 2f=576 · 3f=448 (=1254).
  // O motor devolve sab=153 · dom=70 · 2f=576 · 3f=444 (=1243).
  // Desvio de −11 e um split sab/dom, 100% explicado:
  //   · 2f = 576 EXATO ✓ — 505 DPD entrega-Ter (vespera) + 56 Leiria (mesmo)
  //     + 15 pickup 19:00-19:30 (mesmo). Inclui a #50902-LoV (data ERRADA
  //     12/05/2026, uma terça de maio — "o site permitiu-lhe escolher no
  //     calendário uma data e não era suposto", vídeo 4): vespera→2f, mas é
  //     uma subscrição (não-refeição) → 0 refeições, não afeta a cozinha.
  //   · 3f = 444 = 448 − 4 — as 4 refeições da #51054-LoV (Coimbra, SEM Note
  //     Attributes): o operador juntou-as à mão à produção de terça; o motor
  //     sinaliza-a ("atributos-entrega-em-falta") e nunca inventa um dia.
  //   · Dom 230 = sab 153 + dom 70 + 7 — as 153 refeições de Lisboa entrega-
  //     DOMINGO ficam em "sab" porque a regra "vespera" da zona recua sempre
  //     um dia (wrap dom→sab), mas o operador confeciona-as no PRÓPRIO
  //     domingo ("domingo eu sei que vou confeccionar o próprio domingo");
  //     as 70 de Lisboa entrega-Segunda caem em dom via vespera ✓ ("a Lisboa,
  //     segunda-feira passa também para domingo"); as 7 da #50913-LoV
  //     (Lisboa, SEM Note Attributes) foram juntadas à mão pelo operador.
  //     Uma zona só tem UMA regra — exprimir "domingo→mesmo + segunda→vespera"
  //     exigiria uma regra nova no motor (decisão documentada em
  //     fixtures/zones-w28.ts; conservador: sab é a véspera, nunca em atraso).
  //   · A #50920-LoV (3.ª sem atributos) é só subscrição → 0 refeições.
  // Verificação: 153+70+7=230 ✓ · 576+0=576 ✓ · 444+4=448 ✓ · 1243+11=1254 ✓
  test("refeições por dia de confeção: 2f=576 · 3f=448−4 · sab+dom=153+70 (ver desvios acima)", () => {
    expect(mealsByConfDay).toEqual({ "2f": 576, "3f": 444, sab: 153, dom: 70 });
    expect(kitchen.days.map((d) => d.confDay)).toEqual([
      "2f",
      "3f",
      "sab",
      "dom",
    ]);
  });

  test("total de refeições da semana = 1243 (1254 do gabarito − 11 explicadas)", () => {
    expect(kitchen.totalMeals).toBe(1243);
  });

  test("as somas por dia são consistentes com o total", () => {
    const sum = kitchen.days.reduce((total, day) => total + day.totalMeals, 0);

    expect(sum).toBe(kitchen.totalMeals);
  });
});

describe("golden w28 — etiquetas (buildLabels)", () => {
  test("uma etiqueta por refeição: total = totalMeals do mapa de cozinha", () => {
    const labels = buildLabels(processed);

    expect(labels).toHaveLength(kitchen.totalMeals);
    expect(labels).toHaveLength(1243);
  });

  test("datas de confeção: 11/07 (sab) · 12/07 (dom) · 13/07 (2f) · 14/07 (3f)", () => {
    const porData: Record<string, number> = {};
    for (const label of buildLabels(processed)) {
      porData[label.confDate] = (porData[label.confDate] ?? 0) + 1;
    }

    expect(porData).toEqual({
      "2026-07-11": 153,
      "2026-07-12": 70,
      "2026-07-13": 576,
      "2026-07-14": 444,
    });
  });
});

describe("golden w28 — DPD (buildDpdCsv)", () => {
  const dpd = buildDpdCsv(processed, COURIERS_W28, { account: "LEGUMES" });

  // 69 encomendas "Portugal Continental 08-15h" no fixture: 62 entrega-Ter +
  // 6 entrega-Qua + a #50902-LoV (subscrição com data errada 12/05/2026, uma
  // TERÇA de maio → vespera→2f na mesma). 1 envio por encomenda DPD:
  // 63 na recolha de 2f + 6 na de 3f = 69.
  test("69 envios no total: 63 na recolha de 2f, 6 na de 3f", () => {
    const byConfDay = (confDay: ConfDay) =>
      buildDpdCsv(
        processed.filter((p) => p.confDay === confDay),
        COURIERS_W28,
        { account: "LEGUMES" },
      ).shipments;

    expect(dpd.shipments).toBe(69);
    expect(byConfDay("2f")).toBe(63);
    expect(byConfDay("3f")).toBe(6);
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

  test("só a #50902-LoV (subscrição sem morada) é sinalizada — incluída na mesma", () => {
    expect(dpd.issues).toEqual([
      "#50902-LoV: envio sem telefone",
      "#50902-LoV: envio sem morada",
      "#50902-LoV: envio sem código postal",
    ]);
  });
});

describe("golden w28 — rotas (buildRoutes)", () => {
  const routes = buildRoutes(processed, COURIERS_W28);

  // A rota de DOMINGO de Lisboa (18 paragens a 12/07) é a novidade do
  // calendário novo — não existia na w47 (Lisboa era só Segunda).
  test("6 rotas ordenadas por data e courier, incluindo a nova rota de Domingo", () => {
    const resumo = routes.map(
      (r) => `${r.deliveryDate} ${r.courier} (${r.stops.length})`,
    );

    expect(resumo).toEqual([
      "2026-07-12 Parceiro Lisboa (18)",
      "2026-07-13 Parceiro Leiria (7)",
      "2026-07-13 Parceiro Lisboa (8)",
      "2026-07-13 Recolha em loja (2)",
      "2026-07-14 Interno Coimbra (33)",
      "2026-07-14 Recolha em loja (23)",
    ]);
  });

  test("91 paragens = 197 encomendas − 69 envios DPD − 37 sem atributos", () => {
    const stops = routes.reduce((sum, r) => sum + r.stops.length, 0);

    expect(stops).toBe(91);
    expect(stops).toBe(197 - 69 - 37);
  });
});
