import { describe, expect, test } from "vitest";
import { buildKitchenMap } from "./kitchen";
import type {
  ConfDay,
  OrderLineItem,
  ProcessedOrder,
} from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface OrderFixture {
  name?: string;
  confDay?: ConfDay;
  lineItems: Array<Partial<OrderLineItem> & { name: string }>;
}

let orderCounter = 0;

function makeOrder(fixture: OrderFixture): ProcessedOrder {
  orderCounter += 1;
  const name = fixture.name ?? `#4500${orderCounter}-LoV`;
  return {
    order: {
      name,
      email: "cliente@example.com",
      createdAt: "2025-11-20T10:00:00Z",
      customAttributes: [],
      subtotalPrice: 30,
      totalPrice: 33,
      lineItems: fixture.lineItems.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
        price: item.price ?? 8.5,
      })),
    },
    delivery: {
      orderType: "Shipping",
      deliveryDate: "2025-11-24",
      zona: "Lisboa (Centro da cidade) 19-23h",
      dia: "Segunda",
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

describe("buildKitchenMap", () => {
  test("agrega quantidades por (dia, prato, dose) somando encomendas diferentes", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 2 }],
      }),
      makeOrder({
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 3 }],
      }),
      makeOrder({
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Low Carb", quantity: 1 }],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.days).toHaveLength(1);
    expect(map.days[0].rows).toEqual([
      { dish: "Jardineira de Novilho", dose: "Bulk", quantity: 5 },
      { dish: "Jardineira de Novilho", dose: "Low Carb", quantity: 1 },
    ]);
  });

  test("exclui encomendas sem confDay definido", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: undefined,
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 4 }],
      }),
      makeOrder({
        confDay: "3f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.days).toHaveLength(1);
    expect(map.days[0].confDay).toBe("3f");
    expect(map.totalMeals).toBe(1);
  });

  test("item não-refeição fica fora dos dias mas presente em nonMeal", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Embalagens biodegradáveis", quantity: 2 },
        ],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.days[0].rows).toEqual([
      { dish: "Jardineira de Novilho", dose: "Bulk", quantity: 2 },
    ]);
    expect(map.days[0].totalMeals).toBe(2);
    expect(map.nonMeal).toEqual([
      { dish: "Embalagens biodegradáveis", dose: "Dose Única", quantity: 2 },
    ]);
  });

  test("nonMeal agrega a semana inteira, juntando encomendas de dias diferentes", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
          { name: "Embalagens biodegradáveis", quantity: 1 },
        ],
      }),
      makeOrder({
        confDay: "4f",
        lineItems: [
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 },
          { name: "Embalagens biodegradáveis", quantity: 3 },
        ],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.nonMeal).toEqual([
      { dish: "Embalagens biodegradáveis", dose: "Dose Única", quantity: 4 },
    ]);
  });

  test("nonMeal de encomenda sem confDay não entra", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: undefined,
        lineItems: [{ name: "Voucher Oferta - €50.00", quantity: 1 }],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.nonMeal).toEqual([]);
    expect(map.days).toEqual([]);
  });

  test("rows ordenadas por prato e depois por dose", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        lineItems: [
          { name: "Tranche de Salmão - Low Carb", quantity: 1 },
          { name: "Jardineira de Novilho - Low Carb", quantity: 1 },
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 },
        ],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(
      map.days[0].rows.map((r) => `${r.dish} | ${r.dose}`),
    ).toEqual([
      "Jardineira de Novilho | Bulk",
      "Jardineira de Novilho | Low Carb",
      "Moqueca de Tofu e Legumes | 300g",
      "Tranche de Salmão | Low Carb",
    ]);
  });

  test("days ordenados pela sequência 2f → 3f → 4f, independente da ordem do input", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "4f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      }),
      makeOrder({
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
      makeOrder({
        confDay: "3f",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.days.map((d) => d.confDay)).toEqual(["2f", "3f", "4f"]);
  });

  test("totalMeals por dia e global refletem as somas das refeições", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Tranche de Salmão - Low Carb", quantity: 3 },
          { name: "Tip", quantity: 1 },
        ],
      }),
      makeOrder({
        confDay: "4f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 4 }],
      }),
    ];

    // Act
    const map = buildKitchenMap(orders);

    // Assert
    expect(map.days.map((d) => d.totalMeals)).toEqual([5, 4]);
    expect(map.totalMeals).toBe(9);
  });

  test("lista vazia devolve mapa vazio", () => {
    // Act
    const map = buildKitchenMap([]);

    // Assert
    expect(map).toEqual({ days: [], totalMeals: 0, nonMeal: [] });
  });

  test("não muta as encomendas de input", () => {
    // Arrange
    const orders = deepFreeze([
      makeOrder({
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Embalagens biodegradáveis", quantity: 1 },
        ],
      }),
      makeOrder({
        confDay: "3f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(orders));

    // Act — objetos congelados lançariam TypeError se houvesse mutação
    buildKitchenMap(orders);

    // Assert
    expect(orders).toEqual(snapshot);
  });
});
