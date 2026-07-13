import { describe, expect, test } from "vitest";
import {
  buildEstafetasView,
  DPD_DEFAULT_ACCOUNT,
  slugifyWeekLabel,
} from "./estafetas.server";
import type {
  CourierConfig,
  OrderInput,
  ParsedDelivery,
  ProcessedOrder,
  ZoneConfig,
} from "../weekly";

const COURIERS: CourierConfig[] = [
  { name: "Interno", type: "internal", ordering: "manual" },
  { name: "Off Limits", type: "partner", ordering: "postcode" },
  { name: "DPD", type: "dpd", ordering: "manual" },
];

function makeZone(overrides: Partial<ZoneConfig> = {}): ZoneConfig {
  return {
    matchText: "Coimbra (Centro) 18-22h",
    county: "Coimbra",
    confDay: "2f",
    courierName: "Interno",
    active: true,
    ...overrides,
  };
}

const DPD_ZONE = makeZone({
  matchText: "Portugal Continental 08-15h",
  county: "Nacional",
  confDay: "vespera",
  courierName: "DPD",
});

function makeDelivery(overrides: Partial<ParsedDelivery> = {}): ParsedDelivery {
  return {
    orderType: "Shipping",
    deliveryDate: "2025-11-24",
    zona: "Coimbra (Centro) 18-22h",
    dia: "Segunda",
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderInput> = {}): OrderInput {
  return {
    name: "#45001-LoV",
    email: "cliente@example.com",
    createdAt: "2025-11-19T10:00:00Z",
    customAttributes: [],
    shippingAddress: {
      name: "Maria Silva",
      address1: "Rua das Flores 1",
      zip: "3000-123",
      city: "Coimbra",
      phone: "+351 912 345 678",
    },
    subtotalPrice: 60,
    totalPrice: 64.45,
    lineItems: [],
    ...overrides,
  };
}

function makeProcessed(
  overrides: Partial<ProcessedOrder> = {},
): ProcessedOrder {
  return {
    order: makeOrder(),
    delivery: makeDelivery(),
    zone: makeZone(),
    confDay: "2f",
    issues: [],
    ...overrides,
  };
}

/** Envio DPD com entrega na data dada (recolha esperada = véspera). */
function makeDpdProcessed(
  deliveryDate: string,
  dia: string,
  orderOverrides: Partial<OrderInput> = {},
): ProcessedOrder {
  return makeProcessed({
    order: makeOrder({ name: `#dpd-${deliveryDate}`, ...orderOverrides }),
    delivery: makeDelivery({
      deliveryDate,
      dia,
      zona: DPD_ZONE.matchText,
    }),
    zone: DPD_ZONE,
  });
}

describe("buildEstafetasView", () => {
  test("agrupa as rotas por data de entrega com nº de rotas e de paragens", () => {
    const lisboa = makeZone({
      matchText: "Lisboa (Centro da cidade) 19-23h",
      county: "Lisboa",
      courierName: "Off Limits",
    });
    const processed = [
      makeProcessed({ order: makeOrder({ name: "#1" }) }),
      makeProcessed({ order: makeOrder({ name: "#2" }) }),
      makeProcessed({
        order: makeOrder({ name: "#3" }),
        zone: lisboa,
        delivery: makeDelivery({ zona: lisboa.matchText }),
      }),
      makeProcessed({
        order: makeOrder({ name: "#4" }),
        delivery: makeDelivery({ deliveryDate: "2025-11-25", dia: "Terça" }),
      }),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    expect(view.deliveryDates).toEqual([
      { date: "2025-11-24", dia: "Segunda", nRotas: 2, nParagens: 3 },
      { date: "2025-11-25", dia: "Terça", nRotas: 1, nParagens: 1 },
    ]);
  });

  test("envios DPD ficam fora das rotas e entram no cartão DPD", () => {
    const processed = [
      makeProcessed(),
      makeDpdProcessed("2025-11-25", "Terça"),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    expect(view.routes).toHaveLength(1);
    expect(view.routes[0].courier).toBe("Interno");
    expect(
      view.routes.flatMap((r) => r.stops).map((s) => s.orderName),
    ).not.toContain("#dpd-2025-11-25");
    expect(view.dpd.shipments).toBe(1);
  });

  test("porRecolha agrupa os envios DPD pela véspera da entrega", () => {
    const processed = [
      makeDpdProcessed("2025-11-25", "Terça"), // recolha 24/11 (Segunda)
      makeDpdProcessed("2025-11-26", "Quarta"), // recolha 25/11 (Terça)
      makeDpdProcessed("2025-11-26", "Quarta", { name: "#dpd-b" }),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    expect(view.dpd.porRecolha).toEqual([
      { date: "2025-11-24", dia: "Segunda", shipments: 1 },
      { date: "2025-11-25", dia: "Terça", shipments: 2 },
    ]);
  });

  test("sem conta DPD na config usa a conta por omissão", () => {
    const processed = [makeDpdProcessed("2025-11-25", "Terça")];

    const viewNull = buildEstafetasView({ processed, couriers: COURIERS }, null);
    const viewVazia = buildEstafetasView({ processed, couriers: COURIERS }, "  ");

    expect(viewNull.dpd.csv.startsWith(`${DPD_DEFAULT_ACCOUNT};`)).toBe(true);
    expect(viewVazia.dpd.csv.startsWith(`${DPD_DEFAULT_ACCOUNT};`)).toBe(true);
  });

  test("com conta DPD na config usa essa conta", () => {
    const processed = [makeDpdProcessed("2025-11-25", "Terça")];

    const view = buildEstafetasView(
      { processed, couriers: COURIERS },
      "99887766",
    );

    expect(view.dpd.csv.startsWith("99887766;")).toBe(true);
  });

  test("deliveryDates e porRecolha vêm ordenadas por data ascendente", () => {
    const processed = [
      makeProcessed({
        order: makeOrder({ name: "#qua" }),
        delivery: makeDelivery({ deliveryDate: "2025-11-26", dia: "Quarta" }),
      }),
      makeProcessed({ order: makeOrder({ name: "#seg" }) }),
      makeDpdProcessed("2025-11-27", "Quinta"),
      makeDpdProcessed("2025-11-25", "Terça"),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    expect(view.deliveryDates.map((d) => d.date)).toEqual([
      "2025-11-24",
      "2025-11-26",
    ]);
    expect(view.dpd.porRecolha.map((d) => d.date)).toEqual([
      "2025-11-24",
      "2025-11-26",
    ]);
  });

  test("preserva a sequence do motor nas rotas com ordenação por código postal", () => {
    const lisboa = makeZone({
      matchText: "Lisboa (Centro da cidade) 19-23h",
      county: "Lisboa",
      courierName: "Off Limits",
    });
    const stopIn = (name: string, zip: string) =>
      makeProcessed({
        order: makeOrder({
          name,
          shippingAddress: {
            name,
            address1: "Rua X",
            zip,
            city: "Lisboa",
            phone: "",
          },
        }),
        zone: lisboa,
        delivery: makeDelivery({ zona: lisboa.matchText }),
      });
    const processed = [
      stopIn("#B", "1900-100"),
      stopIn("#A", "1000-001"),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    expect(view.routes).toHaveLength(1);
    expect(view.routes[0].stops.map((s) => s.sequence)).toEqual([1, 2]);
    expect(view.routes[0].stops.map((s) => s.orderName)).toEqual(["#A", "#B"]);
    expect(view.orderingByCourier["Off Limits"]).toBe("postcode");
    expect(view.orderingByCourier["Interno"]).toBe("manual");
    expect(view.orderingByCourier["DPD"]).toBeUndefined();
  });

  test("propaga as issues do motor DPD (ex.: envio sem telefone)", () => {
    const processed = [
      makeDpdProcessed("2025-11-25", "Terça", {
        name: "#semtel",
        shippingAddress: {
          name: "Sem Telefone",
          address1: "Rua Y",
          zip: "4000-001",
          city: "Porto",
          phone: "",
        },
      }),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    expect(view.dpd.issues).toContain("#semtel: envio sem telefone");
  });

  test("checks contratuais: 17 colunas por linha e contactos sem +351", () => {
    const processed = [
      makeDpdProcessed("2025-11-25", "Terça", {
        note: "Deixar; na portaria",
      }),
    ];

    const view = buildEstafetasView({ processed, couriers: COURIERS }, null);

    // o motor limpou o ';' da nota e o +351 do telefone — os checks confirmam
    expect(view.dpd.checks).toEqual({
      colunas17: true,
      semIndicativo351: true,
    });
  });

  test("semana sem encomendas devolve vista vazia mas coerente", () => {
    const view = buildEstafetasView({ processed: [], couriers: COURIERS }, null);

    expect(view.deliveryDates).toEqual([]);
    expect(view.routes).toEqual([]);
    expect(view.dpd.shipments).toBe(0);
    expect(view.dpd.csv).toBe("");
    expect(view.dpd.porRecolha).toEqual([]);
    expect(view.dpd.checks).toEqual({ colunas17: true, semIndicativo351: true });
  });

  test("não muta os inputs e é determinística (duas chamadas idênticas)", () => {
    const processed = [
      makeProcessed(),
      makeDpdProcessed("2025-11-25", "Terça"),
    ];
    const couriers = COURIERS.map((c) => ({ ...c }));
    const processedSnapshot = structuredClone(processed);
    const couriersSnapshot = structuredClone(couriers);

    const first = buildEstafetasView({ processed, couriers }, "12345678");
    const second = buildEstafetasView({ processed, couriers }, "12345678");

    expect(processed).toEqual(processedSnapshot);
    expect(couriers).toEqual(couriersSnapshot);
    expect(first).toEqual(second);
  });
});

describe("slugifyWeekLabel", () => {
  test("normaliza o rótulo da semana para nome de ficheiro", () => {
    expect(slugifyWeekLabel("2025-W47 (demonstração)")).toBe(
      "2025-w47-demonstracao",
    );
  });

  test("rótulo sem caracteres úteis cai em 'semana'", () => {
    expect(slugifyWeekLabel("···")).toBe("semana");
  });
});
