import { describe, expect, test } from "vitest";
import { buildRoutes } from "./routes";
import type {
  CourierConfig,
  OrderInput,
  ParsedDelivery,
  ProcessedOrder,
  ZoneConfig,
} from "./types";

const COURIERS: CourierConfig[] = [
  { name: "Interno", type: "internal", ordering: "manual" },
  { name: "Off Limits", type: "partner", ordering: "postcode" },
  { name: "CrossFit Leiria", type: "partner", ordering: "county" },
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

describe("buildRoutes", () => {
  test("exclui encomendas sem zona ou sem atributos de entrega", () => {
    const orders = [
      makeProcessed({ zone: undefined }),
      makeProcessed({ delivery: null }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes).toEqual([]);
  });

  test("encomenda de courier DPD não aparece nas rotas (vai no CSV DPD)", () => {
    const dpdOrder = makeProcessed({
      order: makeOrder({ name: "#45002-LoV" }),
      zone: makeZone({
        matchText: "Portugal Continental 08-15h",
        courierName: "DPD",
        confDay: "vespera",
      }),
    });
    const localOrder = makeProcessed();

    const routes = buildRoutes([dpdOrder, localOrder], COURIERS);

    expect(routes).toHaveLength(1);
    expect(routes[0].courier).toBe("Interno");
    expect(
      routes.flatMap((r) => r.stops).map((s) => s.orderName),
    ).not.toContain("#45002-LoV");
  });

  test("agrupa por courier e por data de entrega", () => {
    const orders = [
      makeProcessed({ order: makeOrder({ name: "#1" }) }),
      makeProcessed({ order: makeOrder({ name: "#2" }) }),
      makeProcessed({
        order: makeOrder({ name: "#3" }),
        delivery: makeDelivery({ deliveryDate: "2025-11-25", dia: "Terça" }),
      }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      courier: "Interno",
      courierType: "internal",
      deliveryDay: "Segunda",
      deliveryDate: "2025-11-24",
    });
    expect(routes[0].stops.map((s) => s.orderName)).toEqual(["#1", "#2"]);
    expect(routes[1]).toMatchObject({
      deliveryDay: "Terça",
      deliveryDate: "2025-11-25",
    });
  });

  test("ordering postcode ordena as paragens por código postal e numera sequence 1..n", () => {
    const zone = makeZone({
      matchText: "Lisboa (Centro da cidade) 19-23h",
      county: "Lisboa",
      courierName: "Off Limits",
    });
    const orders = [
      makeProcessed({
        order: makeOrder({
          name: "#B",
          shippingAddress: {
            name: "B",
            address1: "Rua B",
            zip: "1900-100",
            city: "Lisboa",
            phone: "",
          },
        }),
        zone,
      }),
      makeProcessed({
        order: makeOrder({
          name: "#A",
          shippingAddress: {
            name: "A",
            address1: "Rua A",
            zip: "1000-001",
            city: "Lisboa",
            phone: "",
          },
        }),
        zone,
      }),
      makeProcessed({
        order: makeOrder({
          name: "#C",
          shippingAddress: {
            name: "C",
            address1: "Rua C",
            zip: "1500-050",
            city: "Lisboa",
            phone: "",
          },
        }),
        zone,
      }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes).toHaveLength(1);
    expect(routes[0].stops.map((s) => s.zip)).toEqual([
      "1000-001",
      "1500-050",
      "1900-100",
    ]);
    expect(routes[0].stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
  });

  test("ordering county ordena por localidade e depois código postal, com sequence", () => {
    const zone = makeZone({
      matchText: "Leiria e arredores 18-22h",
      county: "Leiria",
      courierName: "CrossFit Leiria",
    });
    const stopIn = (name: string, city: string, zip: string) =>
      makeProcessed({
        order: makeOrder({
          name,
          shippingAddress: { name, address1: "Rua X", zip, city, phone: "" },
        }),
        zone,
      });
    const orders = [
      stopIn("#3", "Leiria", "2415-000"),
      stopIn("#1", "Batalha", "2440-100"),
      stopIn("#2", "Leiria", "2400-001"),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes[0].stops.map((s) => s.orderName)).toEqual([
      "#1",
      "#2",
      "#3",
    ]);
    expect(routes[0].stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
  });

  test("ordering manual preserva a ordem de entrada e não atribui sequence", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({
          name: "#Z",
          shippingAddress: {
            name: "Z",
            address1: "Rua Z",
            zip: "9999-999",
            city: "Coimbra",
            phone: "",
          },
        }),
      }),
      makeProcessed({
        order: makeOrder({
          name: "#A",
          shippingAddress: {
            name: "A",
            address1: "Rua A",
            zip: "1000-001",
            city: "Coimbra",
            phone: "",
          },
        }),
      }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes[0].stops.map((s) => s.orderName)).toEqual(["#Z", "#A"]);
    expect(routes[0].stops.every((s) => s.sequence === undefined)).toBe(true);
  });

  test("preenche os campos da paragem a partir da encomenda e da zona", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({ note: "Deixar na portaria" }),
      }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes[0].stops[0]).toEqual({
      orderName: "#45001-LoV",
      client: "Maria Silva",
      phone: "+351 912 345 678",
      address1: "Rua das Flores 1",
      zip: "3000-123",
      city: "Coimbra",
      subtotal: 60,
      note: "Deixar na portaria",
      window: "Coimbra (Centro) 18-22h",
    });
  });

  test("sem shippingAddress usa billingName como cliente e campos vazios", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({
          shippingAddress: undefined,
          billingName: "João Faturação",
        }),
      }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes[0].stops[0]).toMatchObject({
      client: "João Faturação",
      phone: "",
      address1: "",
      zip: "",
      city: "",
    });
  });

  test("rotas ordenadas por data de entrega e depois por courier", () => {
    const orders = [
      makeProcessed({
        zone: makeZone({
          matchText: "Lisboa 19-23h",
          courierName: "Off Limits",
        }),
        delivery: makeDelivery({ deliveryDate: "2025-11-25", dia: "Terça" }),
      }),
      makeProcessed({
        delivery: makeDelivery({ deliveryDate: "2025-11-25", dia: "Terça" }),
      }),
      makeProcessed(),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(
      routes.map((r) => [r.deliveryDate, r.courier]),
    ).toEqual([
      ["2025-11-24", "Interno"],
      ["2025-11-25", "Interno"],
      ["2025-11-25", "Off Limits"],
    ]);
  });

  test("ignora encomendas cuja zona aponta para courier não configurado", () => {
    const orders = [
      makeProcessed({
        zone: makeZone({ courierName: "Courier Fantasma" }),
      }),
    ];

    const routes = buildRoutes(orders, COURIERS);

    expect(routes).toEqual([]);
  });

  test("não muta os inputs (encomendas nem couriers)", () => {
    const orders = [
      makeProcessed({
        zone: makeZone({
          matchText: "Lisboa 19-23h",
          courierName: "Off Limits",
        }),
        order: makeOrder({ name: "#2" }),
      }),
      makeProcessed({ order: makeOrder({ name: "#1" }) }),
    ];
    const couriers = COURIERS.map((c) => ({ ...c }));
    const ordersSnapshot = structuredClone(orders);
    const couriersSnapshot = structuredClone(couriers);

    buildRoutes(orders, couriers);

    expect(orders).toEqual(ordersSnapshot);
    expect(couriers).toEqual(couriersSnapshot);
  });
});
