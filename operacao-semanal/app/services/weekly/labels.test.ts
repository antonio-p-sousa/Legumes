import { describe, expect, test } from "vitest";
import { buildLabels } from "./labels";
import type {
  ConfDay,
  OrderLineItem,
  ParsedDelivery,
  ProcessedOrder,
} from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface LabelOrderFixture {
  name?: string;
  confDay?: ConfDay;
  /** yyyy-mm-dd; default segunda 2025-11-24 */
  deliveryDate?: string;
  /** null simula encomenda cujos atributos não fizeram parse */
  delivery?: null;
  shippingName?: string;
  billingName?: string;
  lineItems: Array<Partial<OrderLineItem> & { name: string }>;
}

let orderCounter = 0;

function makeOrder(fixture: LabelOrderFixture): ProcessedOrder {
  orderCounter += 1;
  const name = fixture.name ?? `#4500${orderCounter}-LoV`;

  const delivery: ParsedDelivery | null =
    fixture.delivery === null
      ? null
      : {
          orderType: "Shipping",
          deliveryDate: fixture.deliveryDate ?? "2025-11-24",
          zona: "Lisboa (Centro da cidade) 19-23h",
          dia: "Segunda",
        };

  return {
    order: {
      name,
      email: "cliente@example.com",
      createdAt: "2025-11-20T10:00:00Z",
      customAttributes: [],
      ...(fixture.shippingName !== undefined && {
        shippingAddress: {
          name: fixture.shippingName,
          address1: "Rua das Flores 1",
          zip: "1000-001",
          city: "Lisboa",
          phone: "912345678",
        },
      }),
      ...(fixture.billingName !== undefined && {
        billingName: fixture.billingName,
      }),
      subtotalPrice: 30,
      totalPrice: 33,
      lineItems: fixture.lineItems.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
        price: item.price ?? 8.5,
      })),
    },
    delivery,
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

describe("buildLabels", () => {
  test("explode qty 3 em 3 linhas iguais (regra 4.7)", () => {
    // Arrange
    const orders = [
      makeOrder({
        name: "#45001-LoV",
        confDay: "2f",
        shippingName: "Ana Silva",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 3 }],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert
    expect(labels).toHaveLength(3);
    const expected = {
      orderName: "#45001-LoV",
      dish: "Jardineira de Novilho - Bulk",
      client: "Ana Silva",
      confDate: "2025-11-24",
    };
    expect(labels).toEqual([expected, expected, expected]);
  });

  test("dish é o nome completo do line item, verbatim, com a dose", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        shippingName: "Ana Silva",
        lineItems: [
          { name: "Poke Bowl Salmão com molho teriyaki - M com arroz" },
        ],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert — sem splitDishDose: imprime-se exatamente o que está na encomenda
    expect(labels[0].dish).toBe(
      "Poke Bowl Salmão com molho teriyaki - M com arroz",
    );
  });

  test("item não-refeição é excluído das etiquetas", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        shippingName: "Ana Silva",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
          { name: "Embalagens biodegradáveis", quantity: 2 },
          { name: "Subscrição de desconto mensal - 15% OFF", quantity: 1 },
        ],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert
    expect(labels).toHaveLength(1);
    expect(labels[0].dish).toBe("Jardineira de Novilho - Bulk");
  });

  test("encomenda sem confDay é excluída", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: undefined,
        shippingName: "Ana Silva",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 2 }],
      }),
    ];

    // Act & Assert
    expect(buildLabels(orders)).toEqual([]);
  });

  test("encomenda com delivery null é excluída (sem data de entrega não há confDate)", () => {
    // Arrange
    const orders = [
      makeOrder({
        confDay: "2f",
        delivery: null,
        shippingName: "Ana Silva",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      }),
    ];

    // Act & Assert
    expect(buildLabels(orders)).toEqual([]);
  });

  test("confDate recua para a véspera: entrega 3ª 2025-11-25 com confDay 2f → 2025-11-24", () => {
    // Arrange — regra DPD-recolhido-na-véspera (4.3)
    const orders = [
      makeOrder({
        confDay: "2f",
        deliveryDate: "2025-11-25",
        shippingName: "Ana Silva",
        lineItems: [{ name: "Jardineira de Novilho - Bulk" }],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert
    expect(labels[0].confDate).toBe("2025-11-24");
  });

  test("confDate igual à entrega quando o confDay coincide com o weekday da entrega", () => {
    // Arrange — 2025-11-24 é segunda; confDay 2f → recua 0 dias
    const orders = [
      makeOrder({
        confDay: "2f",
        deliveryDate: "2025-11-24",
        shippingName: "Ana Silva",
        lineItems: [{ name: "Jardineira de Novilho - Bulk" }],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert
    expect(labels[0].confDate).toBe("2025-11-24");
  });

  test("confDate atravessa o mês: entrega domingo 2025-11-02 com confDay 4f → 2025-10-29", () => {
    // Arrange — recuo de 4 dias em UTC, com mudança de mês
    const orders = [
      makeOrder({
        confDay: "4f",
        deliveryDate: "2025-11-02",
        shippingName: "Ana Silva",
        lineItems: [{ name: "Jardineira de Novilho - Bulk" }],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert
    expect(labels[0].confDate).toBe("2025-10-29");
  });

  test("client usa o nome de envio, com fallback para billingName e depois vazio", () => {
    // Arrange
    const orders = [
      makeOrder({
        name: "#45001-LoV",
        confDay: "2f",
        shippingName: "Ana Silva",
        billingName: "Bruno Costa",
        lineItems: [{ name: "Jardineira de Novilho - Bulk" }],
      }),
      makeOrder({
        name: "#45002-LoV",
        confDay: "2f",
        billingName: "Bruno Costa",
        lineItems: [{ name: "Tranche de Salmão - Low Carb" }],
      }),
      makeOrder({
        name: "#45003-LoV",
        confDay: "2f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g" }],
      }),
    ];

    // Act
    const labels = buildLabels(orders);
    const byOrder = new Map(labels.map((l) => [l.orderName, l.client]));

    // Assert
    expect(byOrder.get("#45001-LoV")).toBe("Ana Silva");
    expect(byOrder.get("#45002-LoV")).toBe("Bruno Costa");
    expect(byOrder.get("#45003-LoV")).toBe("");
  });

  test("ordena por confDate, depois dish, depois orderName (lote de prato)", () => {
    // Arrange — input desordenado de propósito
    const orders = [
      makeOrder({
        name: "#45009-LoV",
        confDay: "4f",
        deliveryDate: "2025-11-26",
        shippingName: "Carla Dias",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g" }],
      }),
      makeOrder({
        name: "#45002-LoV",
        confDay: "2f",
        deliveryDate: "2025-11-24",
        shippingName: "Bruno Costa",
        lineItems: [{ name: "Tranche de Salmão - Low Carb" }],
      }),
      makeOrder({
        name: "#45001-LoV",
        confDay: "2f",
        deliveryDate: "2025-11-24",
        shippingName: "Ana Silva",
        lineItems: [
          { name: "Tranche de Salmão - Low Carb" },
          { name: "Jardineira de Novilho - Bulk" },
        ],
      }),
    ];

    // Act
    const labels = buildLabels(orders);

    // Assert
    expect(
      labels.map((l) => `${l.confDate} | ${l.dish} | ${l.orderName}`),
    ).toEqual([
      "2025-11-24 | Jardineira de Novilho - Bulk | #45001-LoV",
      "2025-11-24 | Tranche de Salmão - Low Carb | #45001-LoV",
      "2025-11-24 | Tranche de Salmão - Low Carb | #45002-LoV",
      "2025-11-26 | Moqueca de Tofu e Legumes - 300g | #45009-LoV",
    ]);
  });

  test("não muta as encomendas de input", () => {
    // Arrange
    const orders = deepFreeze([
      makeOrder({
        confDay: "2f",
        shippingName: "Ana Silva",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Tip", quantity: 1 },
        ],
      }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(orders));

    // Act — objetos congelados lançariam TypeError se houvesse mutação
    buildLabels(orders);

    // Assert
    expect(orders).toEqual(snapshot);
  });
});
