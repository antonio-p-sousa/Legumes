import { describe, expect, test } from "vitest";
import {
  EXPORT_HREFS,
  buildSemanaView,
  formatDataHoraPt,
  minutosDesde,
  type SemanaViewConfig,
} from "./semana.server";
import type { WeekData } from "./common.server";
import { processOrders } from "../weekly";
import type {
  CourierConfig,
  OrderInput,
  ProcessedOrder,
  RecipeConfig,
  ZoneConfig,
} from "../weekly";

// ── Fixture determinística ───────────────────────────────────────────────────

const ZONES: ZoneConfig[] = [
  {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "2f",
    courierName: "Off Limits",
    active: true,
  },
  {
    matchText: "Coimbra (Centro) 18-22h",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Interno",
    active: true,
  },
  {
    matchText: "Portugal Continental 08-15h",
    county: "Portugal Continental",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
  },
];

const COURIERS: CourierConfig[] = [
  { name: "Off Limits", type: "partner", ordering: "manual" },
  { name: "Interno", type: "internal", ordering: "postcode" },
  { name: "DPD", type: "dpd", ordering: "manual" },
];

const CONFIG: SemanaViewConfig = { purchaseMargin: 0.08, dpdAccount: "03290201" };

/** Fichas técnicas de TODOS os pratos vendidos na fixture. */
const RECIPES_COMPLETAS: RecipeConfig[] = [
  {
    dish: "Jardineira de Novilho",
    dose: "Bulk",
    ingredients: [
      { name: "Novilho", qtyPerMeal: 0.2, unit: "kg", supplier: "Talho Central" },
    ],
  },
  {
    dish: "Tranche de Salmão",
    dose: "Low Carb",
    ingredients: [
      { name: "Salmão", qtyPerMeal: 0.18, unit: "kg", supplier: "Peixaria Atlântico" },
    ],
  },
];

/** Só a ficha da Jardineira → "Tranche de Salmão - Low Carb" fica sem ficha. */
const RECIPES_INCOMPLETAS: RecipeConfig[] = [RECIPES_COMPLETAS[0]];

function makeAttrs(
  overrides: Partial<Record<string, string>> = {},
): Array<{ key: string; value: string }> {
  const base: Record<string, string> = {
    "Order Type": "Shipping",
    "Data de entrega": "24/11/2025",
    "Horário de entrega": "Lisboa (Centro da cidade) 19-23h",
    "Dia de entrega": "Segunda",
    ...overrides,
  };
  return Object.entries(base).map(([key, value]) => ({ key, value }));
}

function makeOrder(overrides: Partial<OrderInput> = {}): OrderInput {
  return {
    name: "#45001-LoV",
    email: "ana@example.com",
    createdAt: "2025-11-18T10:00:00Z",
    customAttributes: makeAttrs(),
    shippingAddress: {
      name: "Ana Silva",
      address1: "Rua das Flores 1",
      zip: "1000-001",
      city: "Lisboa",
      phone: "+351 912 345 678",
    },
    subtotalPrice: 40,
    totalPrice: 40,
    lineItems: [
      { name: "Jardineira de Novilho - Bulk", quantity: 2, price: 7.5 },
    ],
    ...overrides,
  };
}

/**
 * 6 encomendas:
 *  #1 Lisboa/2f  ana    40€  2× Jardineira Bulk
 *  #2 Lisboa/2f  ANA    60€  1× Salmão Low Carb + 1× Subscrição (não-refeição)
 *  #3 Coimbra/3f bruno  30€  3× Jardineira Bulk
 *  #4 DPD véspera (entrega 3ª → confeção 2f) carla 100€ 2× Salmão Low Carb
 *  #5 sem atributos de entrega  dora 25€
 *  #6 zona desconhecida         eva  20€
 */
function makeFixtureOrders(): OrderInput[] {
  return [
    makeOrder(),
    makeOrder({
      name: "#45002-LoV",
      email: "ANA@example.com",
      totalPrice: 60,
      lineItems: [
        { name: "Tranche de Salmão - Low Carb", quantity: 1, price: 8 },
        { name: "Subscrição Semanal", quantity: 1, price: 0 },
      ],
    }),
    makeOrder({
      name: "#45003-LoV",
      email: "bruno@example.com",
      totalPrice: 30,
      customAttributes: makeAttrs({
        "Horário de entrega": "Coimbra (Centro) 18-22h",
        "Data de entrega": "25/11/2025",
        "Dia de entrega": "Terça",
      }),
      lineItems: [
        { name: "Jardineira de Novilho - Bulk", quantity: 3, price: 7.5 },
      ],
    }),
    makeOrder({
      name: "#45004-LoV",
      email: "carla@example.com",
      totalPrice: 100,
      customAttributes: makeAttrs({
        "Horário de entrega": "Portugal Continental 08-15h",
        "Data de entrega": "25/11/2025",
        "Dia de entrega": "Terça",
      }),
      lineItems: [
        { name: "Tranche de Salmão - Low Carb", quantity: 2, price: 8 },
      ],
    }),
    makeOrder({
      name: "#45005-LoV",
      email: "dora@example.com",
      totalPrice: 25,
      customAttributes: [],
      lineItems: [
        { name: "Jardineira de Novilho - Bulk", quantity: 1, price: 7.5 },
      ],
    }),
    makeOrder({
      name: "#45006-LoV",
      email: "eva@example.com",
      totalPrice: 20,
      customAttributes: makeAttrs({
        "Horário de entrega": "Braga (Centro) 09-12h",
      }),
      lineItems: [
        { name: "Jardineira de Novilho - Bulk", quantity: 1, price: 7.5 },
      ],
    }),
  ];
}

function makeWeekData(processed: ProcessedOrder[]): WeekData {
  return {
    processed,
    zones: ZONES,
    couriers: COURIERS,
    meta: {
      source: "demo",
      weekLabel: "2025-W47 (demonstração)",
      windowStart: "2025-11-15T00:00:00Z",
      windowEnd: "2025-11-21T23:59:59Z",
      fetchedAt: "2025-11-22T09:00:00Z",
      totalOrders: processed.length,
      ordersSemAtributos: 0,
      ordersZonaDesconhecida: 0,
    },
  };
}

function makeFixtureView(recipes: RecipeConfig[] = RECIPES_COMPLETAS) {
  const { processed } = processOrders(makeFixtureOrders(), ZONES);
  return buildSemanaView(makeWeekData(processed), CONFIG, recipes);
}

// ── Testes ───────────────────────────────────────────────────────────────────

describe("buildSemanaView — kpis", () => {
  test("calcula encomendas, válidas e refeições com a fixture determinística", () => {
    const { kpis } = makeFixtureView();

    expect(kpis.encomendas).toBe(6);
    expect(kpis.validas).toBe(4);
    // 2f: 2 (Jardineira) + 1 (Salmão) + 2 (Salmão DPD) · 3f: 3 (Jardineira);
    // a Subscrição não é refeição e as encomendas com issues ficam de fora.
    expect(kpis.refeicoes).toBe(8);
  });

  test("semZona conta as encomendas com issues (atributos em falta + zona desconhecida)", () => {
    const { kpis } = makeFixtureView();

    expect(kpis.semZona).toBe(2);
  });

  test("faturação soma o totalPrice de todas as encomendas da janela", () => {
    const { kpis } = makeFixtureView();

    expect(kpis.faturacao).toBe(40 + 60 + 30 + 100 + 25 + 20);
  });

  test("clientes conta e-mails únicos sem distinguir maiúsculas", () => {
    const { kpis } = makeFixtureView();

    // ana aparece 2× ("ana@…" e "ANA@…") e conta 1.
    expect(kpis.clientes).toBe(5);
  });

  test("semana sem encomendas devolve kpis a zero e sem dias", () => {
    const view = buildSemanaView(makeWeekData([]), CONFIG, RECIPES_COMPLETAS);

    expect(view.kpis).toEqual({
      encomendas: 0,
      validas: 0,
      semZona: 0,
      refeicoes: 0,
      faturacao: 0,
      clientes: 0,
    });
    expect(view.dias).toEqual([]);
    expect(view.documentos).toHaveLength(5);
  });
});

describe("buildSemanaView — dias de confeção", () => {
  test("dias ordenados 2f→dom com rótulo PT, encomendas e refeições certos", () => {
    const { dias } = makeFixtureView();

    expect(dias.map((d) => d.confDay)).toEqual(["2f", "3f"]);
    expect(dias[0]).toMatchObject({
      diaPT: "Segunda",
      encomendas: 3,
      refeicoes: 5,
    });
    expect(dias[1]).toMatchObject({
      diaPT: "Terça",
      encomendas: 1,
      refeicoes: 3,
    });
  });

  test("canais listam as estafetas do dia e o DPD aparece com contagem de envios", () => {
    const { dias } = makeFixtureView();

    // 2f: Off Limits (2 encomendas locais) + 1 envio DPD recolhido na véspera.
    expect(dias[0].canais).toEqual(["Off Limits", "DPD · 1 envio"]);
    expect(dias[1].canais).toEqual(["Interno"]);
  });
});

describe("buildSemanaView — documentos", () => {
  test("devolve os 5 documentos com os hrefs de export corretos", () => {
    const { documentos } = makeFixtureView();

    expect(documentos.map((d) => [d.nome, d.href])).toEqual([
      ["Mapa de cozinha", EXPORT_HREFS.cozinha],
      ["Etiquetas", EXPORT_HREFS.etiquetas],
      ["Rotas de estafetas", EXPORT_HREFS.rotas],
      ["CSV DPD", EXPORT_HREFS.dpd],
      ["Compras", EXPORT_HREFS.compras],
    ]);
  });

  test("cozinha, etiquetas, rotas e DPD ficam 'Pronto a exportar' com detalhe derivado", () => {
    const { documentos } = makeFixtureView();
    const [cozinha, etiquetas, rotas, dpd] = documentos;

    expect(cozinha).toMatchObject({
      estado: "success",
      estadoLabel: "Pronto a exportar",
      detalhe: "2 dias · 8 refeições",
    });
    expect(etiquetas).toMatchObject({
      estado: "success",
      detalhe: "8 etiquetas",
    });
    // Off Limits 24/11 (2 paragens) + Interno 25/11 (1 paragem); DPD fora das rotas.
    expect(rotas).toMatchObject({
      estado: "success",
      detalhe: "2 rotas · 3 paragens",
    });
    // 1 envio DPD de 100€ → 100/20 = 5 kg.
    expect(dpd).toMatchObject({
      estado: "success",
      detalhe: "1 envio · 5 kg",
    });
  });

  test("compras fica warning com contagem quando há pratos vendidos sem ficha", () => {
    const { documentos } = makeFixtureView(RECIPES_INCOMPLETAS);
    const compras = documentos[4];

    expect(compras.estado).toBe("warning");
    expect(compras.estadoLabel).toBe("1 prato sem ficha");
  });

  test("compras fica success quando todos os pratos vendidos têm ficha", () => {
    const { documentos } = makeFixtureView(RECIPES_COMPLETAS);
    const compras = documentos[4];

    expect(compras.estado).toBe("success");
    expect(compras.estadoLabel).toBe("Pronto a exportar");
    expect(compras.detalhe).toBe("2 fornecedores · 2 ingredientes");
  });
});

describe("buildSemanaView — imutabilidade", () => {
  test("não muta os inputs (weekData, config e fichas congelados)", () => {
    const { processed } = processOrders(makeFixtureOrders(), ZONES);
    const weekData = Object.freeze(
      makeWeekData(
        Object.freeze(processed.map((p) => Object.freeze(p))) as never,
      ),
    ) as WeekData;
    const config = Object.freeze({ ...CONFIG });
    const recipes = Object.freeze(
      RECIPES_COMPLETAS.map((r) => Object.freeze({ ...r })),
    ) as unknown as RecipeConfig[];

    expect(() => buildSemanaView(weekData, config, recipes)).not.toThrow();
  });
});

describe("helpers de apresentação", () => {
  test("formatDataHoraPt formata ISO como dd/mm hh:mm e devolve travessão para inválidos", () => {
    expect(formatDataHoraPt("2025-11-24T08:05:00Z")).toBe("24/11 08:05");
    expect(formatDataHoraPt("2025-01-03T23:59:59Z")).toBe("03/01 23:59");
    expect(formatDataHoraPt("")).toBe("—");
    expect(formatDataHoraPt("não-é-data")).toBe("—");
  });

  test("minutosDesde devolve minutos inteiros decorridos, nunca negativos", () => {
    const fetchedAt = "2025-11-22T09:00:00Z";
    const agora = Date.parse("2025-11-22T09:07:30Z");

    expect(minutosDesde(fetchedAt, agora)).toBe(7);
    expect(minutosDesde(fetchedAt, Date.parse(fetchedAt) - 60_000)).toBe(0);
    expect(minutosDesde("inválido", agora)).toBe(0);
  });
});
