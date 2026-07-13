import { afterEach, describe, expect, test, vi } from "vitest";
import {
  computeOrderWindow,
  fetchLiveOrders,
  isoWeekLabel,
  mapGraphqlOrder,
  type AdminGraphqlClient,
} from "./graphql.server";
import {
  CURSOR_PAGE_2,
  FULL_ORDER_NODE,
  GRAPHQL_ORDERS_PAGE_1,
  GRAPHQL_ORDERS_PAGE_2,
  MINIMAL_ORDER_NODE,
} from "../../../test/fixtures/graphql-orders-page";

// ── Helpers: admin fake sem rede ─────────────────────────────────────────────

interface RecordedCall {
  query: string;
  variables: Record<string, unknown> | undefined;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Devolve uma resposta por chamada, pela ordem dada, e regista as chamadas. */
function fakeAdmin(responses: Array<() => Response>): {
  admin: AdminGraphqlClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const admin: AdminGraphqlClient = {
    graphql: async (query, options) => {
      calls.push({ query, variables: options?.variables });
      const make = responses[Math.min(calls.length - 1, responses.length - 1)];
      return make();
    },
  };
  return { admin, calls };
}

const W48_WINDOW = {
  windowStart: "2025-11-22T00:00:00Z",
  windowEnd: "2025-11-28T23:59:59Z",
};

afterEach(() => {
  vi.useRealTimers();
});

// ── mapGraphqlOrder ──────────────────────────────────────────────────────────

describe("mapGraphqlOrder", () => {
  test("mapeia um node completo para OrderInput", () => {
    const order = mapGraphqlOrder(FULL_ORDER_NODE);

    expect(order).toEqual({
      name: "#45184-LoV",
      email: "cliente001@example.com",
      createdAt: "2025-11-22T01:28:43Z",
      financialStatus: "paid", // enum "PAID" → lowercase (paridade CSV legado)
      note: "Sem coentros, por favor",
      tags: "moloni, primeira-compra", // array → join ", "
      shippingLine: "45€ a 49,99€",
      customAttributes: [
        { key: "Order Type", value: "Shipping" },
        { key: "Data de entrega", value: "24/11/2025" },
        { key: "Horário de entrega", value: "Lisboa (Centro da cidade) 19-23h" },
        { key: "Dia de entrega", value: "Segunda" },
        { key: "Date Format", value: "dd/mm/yy" },
      ],
      shippingAddress: {
        name: "Cliente 001",
        address1: "Rua Exemplo 1",
        zip: "2685-406",
        city: "Prior Velho",
        phone: "900000001",
      },
      billingName: "Cliente 001 Faturação",
      subtotalPrice: 47.9, // string "47.9" → número
      totalPrice: 49.8,
      lineItems: [
        {
          name: "Coxa de Frango sem osso com molho de churrasco - Low Carb",
          quantity: 1,
          price: 7.25,
        },
        {
          name: "Poke Bowl Salmão com molho teriyaki - M (com arroz)",
          quantity: 2,
          price: 9.95,
        },
      ],
    });
  });

  test("campos ausentes ficam undefined/0/vazios", () => {
    const order = mapGraphqlOrder(MINIMAL_ORDER_NODE);

    expect(order.email).toBe("");
    expect(order.note).toBeUndefined();
    expect(order.tags).toBeUndefined(); // tags: [] → undefined
    expect(order.financialStatus).toBeUndefined();
    expect(order.shippingLine).toBeUndefined();
    expect(order.shippingAddress).toBeUndefined();
    expect(order.billingName).toBeUndefined();
    expect(order.subtotalPrice).toBe(0); // subtotalPriceSet null → 0
    expect(order.totalPrice).toBe(0); // "0.0" → 0
    expect(order.lineItems).toEqual([]);
    expect(order.customAttributes).toEqual([]);
  });

  test("line items sem preço/quantidade caem para 0", () => {
    const order = mapGraphqlOrder({
      name: "#1-LoV",
      lineItems: {
        edges: [{ node: { name: null, quantity: null, originalUnitPriceSet: null } }],
      },
    });

    expect(order.lineItems).toEqual([{ name: "", quantity: 0, price: 0 }]);
  });
});

// ── computeOrderWindow ───────────────────────────────────────────────────────

describe("computeOrderWindow (SAT_00:00 → FRI_23:59)", () => {
  test("domingo → janela da semana que fechou na sexta anterior", () => {
    // 2025-11-30 é domingo → sáb 22/11 00:00 até sexta 28/11 23:59
    const window = computeOrderWindow(
      new Date("2025-11-30T10:00:00Z"),
      "SAT_00:00",
      "FRI_23:59",
    );

    expect(window).toEqual(W48_WINDOW);
  });

  test("sexta 23:58 → a janela atual ainda não fechou; devolve a anterior", () => {
    const window = computeOrderWindow(
      new Date("2025-11-28T23:58:00Z"),
      "SAT_00:00",
      "FRI_23:59",
    );

    expect(window).toEqual({
      windowStart: "2025-11-15T00:00:00Z",
      windowEnd: "2025-11-21T23:59:59Z",
    });
  });

  test("sábado 00:01 → a janela que fechou sexta às 23:59", () => {
    const window = computeOrderWindow(
      new Date("2025-11-29T00:01:00Z"),
      "SAT_00:00",
      "FRI_23:59",
    );

    expect(window).toEqual(W48_WINDOW);
  });

  test("wrap de ano: início de janeiro apanha a sexta de dezembro", () => {
    // 2026-01-01 é quinta → sáb 20/12/2025 até sexta 26/12/2025
    const window = computeOrderWindow(
      new Date("2026-01-01T12:00:00Z"),
      "SAT_00:00",
      "FRI_23:59",
    );

    expect(window).toEqual({
      windowStart: "2025-12-20T00:00:00Z",
      windowEnd: "2025-12-26T23:59:59Z",
    });
  });

  test("extremo malformado atira erro claro", () => {
    expect(() =>
      computeOrderWindow(new Date(), "CAT_00:00", "FRI_23:59"),
    ).toThrow(/janela de encomendas inválido/);
  });
});

// ── isoWeekLabel ─────────────────────────────────────────────────────────────

describe("isoWeekLabel", () => {
  test("sexta 2025-11-28 pertence à semana ISO 48", () => {
    expect(isoWeekLabel("2025-11-28T23:59:59Z")).toBe("2025-W48");
  });

  test("wrap ISO: 2027-01-01 (sexta) pertence à W53 de 2026", () => {
    expect(isoWeekLabel("2027-01-01T12:00:00Z")).toBe("2026-W53");
  });
});

// ── fetchLiveOrders ──────────────────────────────────────────────────────────

describe("fetchLiveOrders", () => {
  test("pagina com endCursor e junta as 2 páginas", async () => {
    const { admin, calls } = fakeAdmin([
      () => jsonResponse(GRAPHQL_ORDERS_PAGE_1),
      () => jsonResponse(GRAPHQL_ORDERS_PAGE_2),
    ]);

    const week = await fetchLiveOrders(admin, { window: W48_WINDOW });

    expect(week.orders.map((o) => o.name)).toEqual([
      "#45184-LoV",
      "#45185-LoV",
      "#45186-LoV",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].variables?.cursor).toBeNull();
    expect(calls[1].variables?.cursor).toBe(CURSOR_PAGE_2);
    // Filtro na search syntax do Shopify, ISO 8601 UTC:
    expect(calls[0].variables?.query).toBe(
      "created_at:>=2025-11-22T00:00:00Z AND created_at:<=2025-11-28T23:59:59Z",
    );
  });

  test("devolve WeekOrders bem formado com weekLabel ISO do windowEnd", async () => {
    const { admin } = fakeAdmin([() => jsonResponse(GRAPHQL_ORDERS_PAGE_2)]);

    const week = await fetchLiveOrders(admin, { window: W48_WINDOW });

    expect(week.source).toBe("live");
    expect(week.weekLabel).toBe("2025-W48");
    expect(week.windowStart).toBe(W48_WINDOW.windowStart);
    expect(week.windowEnd).toBe(W48_WINDOW.windowEnd);
    expect(Number.isNaN(new Date(week.fetchedAt).getTime())).toBe(false);
  });

  test("sem janela explícita usa os defaults SAT_00:00/FRI_23:59", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-11-30T10:00:00Z")); // domingo

    const { admin, calls } = fakeAdmin([
      () => jsonResponse(GRAPHQL_ORDERS_PAGE_2),
    ]);
    const week = await fetchLiveOrders(admin);

    expect(calls[0].variables?.query).toBe(
      "created_at:>=2025-11-22T00:00:00Z AND created_at:<=2025-11-28T23:59:59Z",
    );
    expect(week.weekLabel).toBe("2025-W48");
  });

  test("HTTP não-ok → throw com o status", async () => {
    const { admin } = fakeAdmin([
      () => new Response("Internal Server Error", { status: 500 }),
    ]);

    await expect(
      fetchLiveOrders(admin, { window: W48_WINDOW }),
    ).rejects.toThrow(/HTTP 500/);
  });

  test("erros GraphQL no body → throw com a mensagem do erro", async () => {
    const { admin } = fakeAdmin([
      () =>
        jsonResponse({
          errors: [{ message: "Throttled" }, { message: "Field ambiguity" }],
        }),
    ]);

    await expect(
      fetchLiveOrders(admin, { window: W48_WINDOW }),
    ).rejects.toThrow(/Throttled; Field ambiguity/);
  });

  test("payload sem data.orders → throw com pista (query/scopes)", async () => {
    const { admin } = fakeAdmin([() => jsonResponse({ data: {} })]);

    await expect(
      fetchLiveOrders(admin, { window: W48_WINDOW }),
    ).rejects.toThrow(/data\.orders/);
  });
});
