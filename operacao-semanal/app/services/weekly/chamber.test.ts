import { describe, expect, test } from "vitest";
import { buildChamberDoc } from "./chamber";
import type { ConfDay, OrderLineItem, ProcessedOrder } from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface OrderFixture {
  name?: string;
  confDay?: ConfDay;
  courierName?: string;
  /** Sem zona (nem confDay habitual) — para o caso da encomenda ignorada. */
  noZone?: boolean;
  deliveryDate?: string;
  billingName?: string;
  shippingName?: string;
  lineItems: Array<Partial<OrderLineItem> & { name: string }>;
}

let orderCounter = 0;

function makeOrder(fixture: OrderFixture): ProcessedOrder {
  orderCounter += 1;
  const name = fixture.name ?? `#4500${orderCounter}-LoV`;
  const deliveryDate = fixture.deliveryDate ?? "2025-11-24"; // Segunda
  const courierName = fixture.courierName ?? "Interno";

  return {
    order: {
      name,
      email: "cliente@example.com",
      createdAt: "2025-11-20T10:00:00Z",
      customAttributes: [],
      subtotalPrice: 30,
      totalPrice: 33,
      billingName: fixture.billingName,
      shippingAddress: fixture.shippingName
        ? {
            name: fixture.shippingName,
            address1: "Rua X",
            zip: "1000-001",
            city: "Lisboa",
            phone: "912345678",
          }
        : undefined,
      lineItems: fixture.lineItems.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
        price: item.price ?? 8.5,
      })),
    },
    delivery: {
      orderType: "Shipping",
      deliveryDate,
      zona: "Lisboa (Centro da cidade) 19-23h",
      dia: "Segunda",
    },
    zone: fixture.noZone
      ? undefined
      : {
          matchText: "Lisboa (Centro da cidade) 19-23h",
          county: "Lisboa",
          confDay: "2f",
          courierName,
          active: true,
        },
    confDay: fixture.confDay,
    issues: [],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ── Testes ───────────────────────────────────────────────────────────────────

describe("buildChamberDoc", () => {
  test("meals só conta refeições (exclui embalagens, subscrições e tips)", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        billingName: "Ana",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Tranche de Salmão - Low Carb", quantity: 1 },
          { name: "Embalagens biodegradáveis", quantity: 3 },
          { name: "Subscrição semanal", quantity: 1 },
          { name: "Tip", quantity: 1 },
        ],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert — 2 + 1 refeições; não-refeições ignoradas
    expect(doc.days[0].blocks[0].rows[0].meals).toBe(3);
    expect(doc.days[0].totalMeals).toBe(3);
  });

  test("agrupa por confDay e por (courier, data) no mesmo dia", () => {
    // Arrange — mesmo dia de produção, mesmo courier/data → 1 bloco, 2 linhas
    const orders = [
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-24",
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-24",
        billingName: "Bruno",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 2 }],
      }),
      // courier diferente → bloco à parte
      makeOrder({
        confDay: "2f",
        courierName: "Off Limits",
        deliveryDate: "2025-11-24",
        billingName: "Carla",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert
    expect(doc.days).toHaveLength(1);
    expect(doc.days[0].blocks).toHaveLength(2);
    const interno = doc.days[0].blocks.find((b) => b.courier === "Interno");
    expect(interno?.rows).toHaveLength(2);
    expect(interno?.totalMeals).toBe(3);
  });

  test("mesmo courier com datas diferentes gera blocos distintos", () => {
    // Arrange — confDay fixo "2f", mas duas datas de entrega distintas
    const orders = [
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-24",
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-25",
        billingName: "Bruno",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert — 2 blocos (mesmo courier, datas diferentes)
    expect(doc.days[0].blocks).toHaveLength(2);
    expect(doc.days[0].blocks.map((b) => b.deliveryDate)).toEqual([
      "2025-11-24",
      "2025-11-25",
    ]);
  });

  test("courierName vazio cai no bloco 'Sem estafeta' (nunca descartado)", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        courierName: "",
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 2 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert
    expect(doc.days[0].blocks[0].courier).toBe("Sem estafeta");
    expect(doc.days[0].blocks[0].label).toBe("Sem estafeta");
    expect(doc.days[0].totalMeals).toBe(2);
  });

  test("master soma refeições por cliente e ordena alfabeticamente (pt)", () => {
    // Arrange — mesmo cliente em duas encomendas do mesmo dia
    const orders = [
      makeOrder({
        confDay: "2f",
        billingName: "Zé",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 2 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: "Ana",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: "Ana",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 3 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert — Ana agregada (1+3=4), ordem alfabética Ana < Zé
    expect(doc.days[0].master).toEqual([
      { client: "Ana", meals: 4 },
      { client: "Zé", meals: 2 },
    ]);
  });

  test("invariante: totalMeals do dia = soma dos blocos = soma do master", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 2 }],
      }),
      makeOrder({
        confDay: "2f",
        courierName: "Off Limits",
        billingName: "Bruno",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 3 }],
      }),
      makeOrder({
        confDay: "2f",
        courierName: "",
        billingName: "Ana",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);
    const day = doc.days[0];

    // Assert
    const somaBlocos = day.blocks.reduce((s, b) => s + b.totalMeals, 0);
    const somaMaster = day.master.reduce((s, c) => s + c.meals, 0);
    expect(somaBlocos).toBe(day.totalMeals);
    expect(somaMaster).toBe(day.totalMeals);
    expect(day.totalMeals).toBe(6);
  });

  test("encomenda sem confDay é ignorada", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: undefined,
        noZone: true,
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 4 }],
      }),
      makeOrder({
        confDay: "3f",
        billingName: "Bruno",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert — só o dia 3f, com uma encomenda
    expect(doc.days).toHaveLength(1);
    expect(doc.days[0].confDay).toBe("3f");
    expect(doc.days[0].totalOrders).toBe(1);
    expect(doc.days[0].totalMeals).toBe(1);
  });

  test("rótulo do bloco ganha o dia quando o courier tem >1 data", () => {
    // Arrange — Interno com duas datas no mesmo dia de produção
    const orders = [
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-24", // Segunda
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-25", // Terça
        billingName: "Bruno",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert
    expect(doc.days[0].blocks.map((b) => b.label)).toEqual([
      "Interno · Segunda",
      "Interno · Terça",
    ]);
  });

  test("rótulo do bloco é só o courier quando há uma única data", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        courierName: "Interno",
        deliveryDate: "2025-11-24",
        billingName: "Ana",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert
    expect(doc.days[0].blocks[0].label).toBe("Interno");
    expect(doc.days[0].blocks[0].deliveryDay).toBe("Segunda");
  });

  test("days ordenados pela sequência 2f → 3f → 4f, independente do input", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "4f",
        billingName: "Ana",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: "Bruno",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "3f",
        billingName: "Carla",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert
    expect(doc.days.map((d) => d.confDay)).toEqual(["2f", "3f", "4f"]);
    expect(doc.days.map((d) => d.label)).toEqual([
      "Segunda",
      "Terça",
      "Quarta",
    ]);
  });

  test("rows do bloco ordenadas por cliente (localeCompare pt)", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        billingName: "Zé",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: "Álvaro",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: "Bruno",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert — Álvaro (acento) ordena antes de Bruno, Zé por último
    expect(doc.days[0].blocks[0].rows.map((r) => r.client)).toEqual([
      "Álvaro",
      "Bruno",
      "Zé",
    ]);
  });

  test("cliente = billingName, com fallback para o nome de envio e depois vazio", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        billingName: "Faturação",
        shippingName: "Envio",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: undefined,
        shippingName: "Só Envio",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        billingName: undefined,
        shippingName: undefined,
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
    ];

    // Act
    const doc = buildChamberDoc(orders);

    // Assert — ordenados por cliente: "" < "Faturação" < "Só Envio"
    expect(doc.days[0].blocks[0].rows.map((r) => r.client)).toEqual([
      "",
      "Faturação",
      "Só Envio",
    ]);
  });

  test("lista vazia devolve documento sem dias", () => {
    // Act
    const doc = buildChamberDoc([]);

    // Assert
    expect(doc).toEqual({ days: [] });
  });

  test("não muta as encomendas de input", () => {
    // Arrange
    const orders = deepFreeze([
      makeOrder({
        confDay: "2f",
        billingName: "Ana",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Embalagens biodegradáveis", quantity: 1 },
        ],
      }),
      makeOrder({
        confDay: "3f",
        billingName: "Bruno",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(orders));

    // Act — objetos congelados lançariam TypeError se houvesse mutação
    buildChamberDoc(orders);

    // Assert
    expect(orders).toEqual(snapshot);
  });
});
