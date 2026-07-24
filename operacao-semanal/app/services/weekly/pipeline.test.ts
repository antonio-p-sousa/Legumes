import { describe, expect, test } from "vitest";
import {
  ISSUE_MISSING_DELIVERY_ATTRS,
  ISSUE_UNKNOWN_ZONE_PREFIX,
  ISSUE_ZONE_NO_COURIER,
  processOrders,
} from "./pipeline";
import type { OrderInput, ZoneConfig } from "./types";

const ZONES: ZoneConfig[] = [
  {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "2f",
    courierName: "Parceiro Lisboa",
    active: true,
  },
  {
    matchText: "Portugal Continental 08-15h",
    county: "Portugal Continental",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
  },
  {
    matchText: "Zona Desativada 10-12h",
    county: "Porto",
    confDay: "3f",
    courierName: "Parceiro Porto",
    active: false,
  },
];

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
    name: "#45004-LoV",
    email: "cliente@example.com",
    createdAt: "2025-11-18T10:00:00Z",
    customAttributes: makeAttrs(),
    subtotalPrice: 40,
    totalPrice: 42,
    lineItems: [
      { name: "Jardineira de Novilho - Bulk", quantity: 2, price: 7.5 },
    ],
    ...overrides,
  };
}

describe("processOrders", () => {
  test("sem janela processa todas as encomendas e não exclui nenhuma", () => {
    const orders = [makeOrder(), makeOrder({ name: "#45005-LoV" })];

    const result = processOrders(orders, ZONES);

    expect(result.processed).toHaveLength(2);
    expect(result.excludedByWindow).toHaveLength(0);
  });

  test("com janela envia as encomendas fora dela para excludedByWindow", () => {
    const dentro = makeOrder({ createdAt: "2025-11-18T10:00:00Z" });
    const fora = makeOrder({
      name: "#45099-LoV",
      createdAt: "2025-11-22T10:00:00Z",
    });
    const window = {
      windowStart: "2025-11-15T00:00:00Z",
      windowEnd: "2025-11-21T23:59:59Z",
    };

    const result = processOrders([dentro, fora], ZONES, window);

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0].order.name).toBe("#45004-LoV");
    expect(result.excludedByWindow).toEqual([fora]);
  });

  test("sinaliza atributos-entrega-em-falta quando o bloco de entrega não faz parse", () => {
    const order = makeOrder({ customAttributes: [] });

    const { processed } = processOrders([order], ZONES);

    expect(processed[0].delivery).toBeNull();
    expect(processed[0].zone).toBeUndefined();
    expect(processed[0].confDay).toBeUndefined();
    expect(processed[0].issues).toEqual([ISSUE_MISSING_DELIVERY_ATTRS]);
  });

  test("sinaliza zona-desconhecida com o texto verbatim da zona sem match", () => {
    const order = makeOrder({
      customAttributes: makeAttrs({
        "Horário de entrega": "Braga (Centro) 09-12h",
      }),
    });

    const { processed } = processOrders([order], ZONES);

    expect(processed[0].delivery?.zona).toBe("Braga (Centro) 09-12h");
    expect(processed[0].zone).toBeUndefined();
    expect(processed[0].confDay).toBeUndefined();
    expect(processed[0].issues).toEqual([
      `${ISSUE_UNKNOWN_ZONE_PREFIX}Braga (Centro) 09-12h`,
    ]);
  });

  test("zona inativa não faz match e é sinalizada como desconhecida", () => {
    const order = makeOrder({
      customAttributes: makeAttrs({
        "Horário de entrega": "Zona Desativada 10-12h",
        "Dia de entrega": "Terça",
        "Data de entrega": "25/11/2025",
      }),
    });

    const { processed } = processOrders([order], ZONES);

    expect(processed[0].zone).toBeUndefined();
    expect(processed[0].issues).toEqual([
      `${ISSUE_UNKNOWN_ZONE_PREFIX}Zona Desativada 10-12h`,
    ]);
  });

  test("resolve o confDay de zona local com dia fixo e não emite issues", () => {
    const order = makeOrder();

    const { processed } = processOrders([order], ZONES);

    expect(processed[0].zone?.matchText).toBe(
      "Lisboa (Centro da cidade) 19-23h",
    );
    expect(processed[0].confDay).toBe("2f");
    expect(processed[0].issues).toEqual([]);
  });

  test("resolve o confDay pela véspera para zona DPD (entrega Terça → 2f)", () => {
    const order = makeOrder({
      customAttributes: makeAttrs({
        "Horário de entrega": "Portugal Continental 08-15h",
        "Data de entrega": "25/11/2025",
        "Dia de entrega": "Terça",
      }),
    });

    const { processed } = processOrders([order], ZONES);

    expect(processed[0].confDay).toBe("2f");
    expect(processed[0].issues).toEqual([]);
  });

  test("zona correspondida SEM estafeta → confDay definido e issue zona-sem-estafeta", () => {
    // Arrange — zona ativa com courierName vazio (estafeta por atribuir)
    const zones: ZoneConfig[] = [
      {
        matchText: "Aveiro (Centro) 18-21h",
        county: "Aveiro",
        confDay: "3f",
        courierName: "",
        active: true,
      },
    ];
    const order = makeOrder({
      customAttributes: makeAttrs({
        "Horário de entrega": "Aveiro (Centro) 18-21h",
        "Dia de entrega": "Terça",
        "Data de entrega": "25/11/2025",
      }),
    });

    // Act
    const { processed } = processOrders([order], zones);

    // Assert — entra na cozinha (tem confDay) mas é sinalizada com o matchText
    expect(processed[0].zone?.matchText).toBe("Aveiro (Centro) 18-21h");
    expect(processed[0].confDay).toBe("3f");
    expect(processed[0].issues).toEqual([
      `${ISSUE_ZONE_NO_COURIER}Aveiro (Centro) 18-21h`,
    ]);
  });

  test("courierName só com espaços conta como sem estafeta", () => {
    // Arrange
    const zones: ZoneConfig[] = [
      {
        matchText: "Aveiro (Centro) 18-21h",
        county: "Aveiro",
        confDay: "3f",
        courierName: "   ",
        active: true,
      },
    ];
    const order = makeOrder({
      customAttributes: makeAttrs({
        "Horário de entrega": "Aveiro (Centro) 18-21h",
        "Dia de entrega": "Terça",
        "Data de entrega": "25/11/2025",
      }),
    });

    // Act
    const { processed } = processOrders([order], zones);

    // Assert
    expect(processed[0].confDay).toBe("3f");
    expect(processed[0].issues).toEqual([
      `${ISSUE_ZONE_NO_COURIER}Aveiro (Centro) 18-21h`,
    ]);
  });

  test("zona com estafeta normal NÃO emite zona-sem-estafeta", () => {
    // Arrange — zona Lisboa (courierName "Parceiro Lisboa")
    const order = makeOrder();

    // Act
    const { processed } = processOrders([order], ZONES);

    // Assert
    expect(processed[0].zone?.courierName).toBe("Parceiro Lisboa");
    expect(
      processed[0].issues.some((issue) =>
        issue.startsWith(ISSUE_ZONE_NO_COURIER),
      ),
    ).toBe(false);
    expect(processed[0].confDay).toBe("2f");
  });

  test("nunca descarta: devolve um ProcessedOrder por cada encomenda, pela mesma ordem", () => {
    const orders = [
      makeOrder({ name: "#1", customAttributes: [] }),
      makeOrder({
        name: "#2",
        customAttributes: makeAttrs({ "Horário de entrega": "Marte 08-15h" }),
      }),
      makeOrder({ name: "#3" }),
    ];

    const { processed } = processOrders(orders, ZONES);

    expect(processed.map((p) => p.order.name)).toEqual(["#1", "#2", "#3"]);
    expect(processed.every((p) => p.issues.length <= 1)).toBe(true);
  });

  test("não muta os inputs (encomendas, zonas e janela congeladas)", () => {
    const order = Object.freeze(
      makeOrder({ customAttributes: Object.freeze(makeAttrs()) as never }),
    );
    const orders = Object.freeze([order]) as unknown as OrderInput[];
    const zones = Object.freeze(
      ZONES.map((z) => Object.freeze({ ...z })),
    ) as unknown as ZoneConfig[];
    const window = Object.freeze({
      windowStart: "2025-11-15T00:00:00Z",
      windowEnd: "2025-11-21T23:59:59Z",
    });

    expect(() => processOrders(orders, zones, window)).not.toThrow();
  });
});
