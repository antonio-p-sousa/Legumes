import { describe, expect, test } from "vitest";
import {
  DEFAULT_COMPONENT_FACTORS,
  buildComponentPlan,
  normalizeDoseForFactors,
} from "./components";
import type { ComponentFactor } from "./components";
import type { ConfDay, OrderLineItem, ProcessedOrder } from "./types";

// ── Fixtures (construídas à mão — determinísticas) ──────────────────────────

interface OrderFixture {
  confDay?: ConfDay;
  lineItems: Array<Partial<OrderLineItem> & { name: string }>;
}

function makeProcessed(fixture: OrderFixture, index: number): ProcessedOrder {
  return {
    order: {
      name: `#4500${index}-LoV`,
      email: "cliente@example.com",
      createdAt: "2026-07-16T10:00:00Z",
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
      deliveryDate: "2026-07-20",
      zona: "Lisboa (Centro da cidade) 19-23h",
      dia: "Segunda",
    },
    confDay: fixture.confDay,
    issues: [],
  };
}

function makeOrders(fixtures: OrderFixture[]): ProcessedOrder[] {
  return fixtures.map(makeProcessed);
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

const FACTORS: ComponentFactor[] = [...DEFAULT_COMPONENT_FACTORS];

// ── Testes ───────────────────────────────────────────────────────────────────

describe("normalizeDoseForFactors", () => {
  test("colapsa as variantes de poke M em 'Dose M' (arroz e quinoa, com e sem parênteses)", () => {
    // Arrange / Act / Assert
    expect(normalizeDoseForFactors("M arroz")).toBe("Dose M");
    expect(normalizeDoseForFactors("M quinoa")).toBe("Dose M");
    expect(normalizeDoseForFactors("M (arroz)")).toBe("Dose M");
    expect(normalizeDoseForFactors("M (quinoa)")).toBe("Dose M");
  });

  test("colapsa as variantes de poke XL em 'Dose XL'", () => {
    expect(normalizeDoseForFactors("XL arroz")).toBe("Dose XL");
    expect(normalizeDoseForFactors("XL quinoa")).toBe("Dose XL");
    expect(normalizeDoseForFactors("XL (arroz)")).toBe("Dose XL");
    expect(normalizeDoseForFactors("XL (quinoa)")).toBe("Dose XL");
  });

  test("devolve as restantes doses tal e qual", () => {
    expect(normalizeDoseForFactors("Low Carb")).toBe("Low Carb");
    expect(normalizeDoseForFactors("Zero Carbs")).toBe("Zero Carbs");
    expect(normalizeDoseForFactors("300g")).toBe("300g");
    expect(normalizeDoseForFactors("Dose Única")).toBe("Dose Única");
    expect(normalizeDoseForFactors("Dose M")).toBe("Dose M");
  });
});

describe("buildComponentPlan", () => {
  test("aplica os fatores por dose e componente (kg = qty × fator)", () => {
    // Arrange — 2× Low Carb: P 2×0,110 · H 2×0,100 · L 2×0,090
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 2 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert
    expect(plan.days).toEqual([
      {
        confDay: "2f",
        kg: { Proteína: 0.22, Hidratos: 0.2, Legumes: 0.18 },
        meals: 2,
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("pokes M/XL normalizam para os fatores de Dose M/Dose XL", () => {
    // Arrange — splitDishDose produz "M arroz" / "XL quinoa"
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [
          { name: "Poke Bowl Salmão com molho teriyaki - M com arroz", quantity: 1 },
          { name: "Poke Bowl Frango com molho de amendoim - XL com quinoa", quantity: 1 },
        ],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert — Dose M (0,105/0,105/0,135) + Dose XL (0,155/0,185/0,235)
    expect(plan.skipped).toEqual([]);
    expect(plan.days[0].kg).toEqual({
      Proteína: 0.26,
      Hidratos: 0.29,
      Legumes: 0.37,
    });
    expect(plan.days[0].meals).toBe(2);
  });

  test("Zero Carbs com Hidratos = 0 explícito NÃO é skipped", () => {
    // Arrange
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Zero Carbs", quantity: 3 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert — dose coberta (fator 0 conta como fator), hidratos a 0 kg
    expect(plan.skipped).toEqual([]);
    expect(plan.days[0].kg).toEqual({
      Proteína: 0.48,
      Hidratos: 0,
      Legumes: 0.48,
    });
  });

  test("doses sem qualquer fator vão para skipped com unidades agregadas", () => {
    // Arrange — sopa e pizza sem variante → "Dose Única" (sem fator na tabela)
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [
          { name: "Creme de Cenoura e Abóbora", quantity: 2 },
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
        ],
      },
      {
        confDay: "4f",
        lineItems: [{ name: "Pizza de Fiambre de Perú", quantity: 3 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert — 2 + 3 unidades agregadas na mesma dose; Bulk continua no plano
    expect(plan.skipped).toEqual([{ dose: "Dose Única", units: 5 }]);
    expect(plan.days).toEqual([
      {
        confDay: "2f",
        kg: { Proteína: 0.16, Hidratos: 0.145, Legumes: 0.13 },
        meals: 1,
      },
    ]);
  });

  test("agrega por dia de confeção, ordenado 2f → 3f → 4f mesmo com input desordenado", () => {
    // Arrange
    const orders = makeOrders([
      {
        confDay: "4f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      },
      {
        confDay: "2f",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      },
      {
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert
    expect(plan.days.map((d) => d.confDay)).toEqual(["2f", "4f"]);
    expect(plan.days[0].kg).toEqual({
      Proteína: 0.27,
      Hidratos: 0.245,
      Legumes: 0.22,
    });
    expect(plan.days[0].meals).toBe(2);
    expect(plan.days[1].kg).toEqual({
      Proteína: 0.11,
      Hidratos: 0.11,
      Legumes: 0.11,
    });
  });

  test("totals somam os dias todos por componente", () => {
    // Arrange
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [{ name: "Tranche de Salmão - Extra Bulk", quantity: 2 }],
      },
      {
        confDay: "3f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 450g", quantity: 1 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert — EB 2×(0,210/0,190/0,170) + 450g 1×(0,160/0,160/0,160)
    expect(plan.totals).toEqual({
      Proteína: 0.58,
      Hidratos: 0.54,
      Legumes: 0.5,
    });
  });

  test("arredonda a 3 casas no fim (sem lixo de vírgula flutuante)", () => {
    // Arrange — 3×0,145 = 0,43499999… em FP; arredondado tem de dar 0,435
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 3 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert
    expect(plan.days[0].kg.Hidratos).toBe(0.435);
    expect(plan.totals.Hidratos).toBe(0.435);
    expect(plan.days[0].kg.Proteína).toBe(0.48);
    expect(plan.days[0].kg.Legumes).toBe(0.39);
  });

  test("encomendas sem confDay resolvido ficam fora do plano", () => {
    // Arrange — sinalizadas a montante em issues; aqui não entram nem em skipped
    const orders = makeOrders([
      {
        confDay: undefined,
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 9 }],
      },
      {
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].meals).toBe(1);
    expect(plan.totals.Proteína).toBe(0.16);
    expect(plan.skipped).toEqual([]);
  });

  test("line items não-refeição (embalagens, subscrições, tips) são ignorados", () => {
    // Arrange
    const orders = makeOrders([
      {
        confDay: "2f",
        lineItems: [
          { name: "Embalagens biodegradáveis", quantity: 5 },
          { name: "Subscrição semanal", quantity: 1 },
          { name: "Tip", quantity: 1 },
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
        ],
      },
    ]);

    // Act
    const plan = buildComponentPlan(orders, FACTORS);

    // Assert — nem no plano nem em skipped
    expect(plan.days[0].meals).toBe(1);
    expect(plan.skipped).toEqual([]);
    expect(plan.totals).toEqual({
      Proteína: 0.16,
      Hidratos: 0.145,
      Legumes: 0.13,
    });
  });

  test("semana vazia devolve plano vazio", () => {
    // Act
    const plan = buildComponentPlan([], FACTORS);

    // Assert
    expect(plan).toEqual({
      days: [],
      totals: { Proteína: 0, Hidratos: 0, Legumes: 0 },
      skipped: [],
    });
  });

  test("não muta as encomendas nem os fatores", () => {
    // Arrange — objetos congelados lançariam TypeError se houvesse mutação
    const orders = deepFreeze(
      makeOrders([
        {
          confDay: "2f",
          lineItems: [
            { name: "Jardineira de Novilho - Bulk", quantity: 2 },
            { name: "Creme de Cenoura e Abóbora", quantity: 1 },
          ],
        },
      ]),
    );
    const factors = deepFreeze(FACTORS.map((f) => ({ ...f })));
    const ordersSnapshot = JSON.parse(JSON.stringify(orders));
    const factorsSnapshot = JSON.parse(JSON.stringify(factors));

    // Act
    buildComponentPlan(orders, factors);

    // Assert
    expect(orders).toEqual(ordersSnapshot);
    expect(factors).toEqual(factorsSnapshot);
  });
});

describe("DEFAULT_COMPONENT_FACTORS", () => {
  test("tem 24 fatores (8 doses × 3 componentes), com Zero Carbs/Hidratos = 0", () => {
    // Assert
    expect(DEFAULT_COMPONENT_FACTORS).toHaveLength(24);
    const zcHidratos = DEFAULT_COMPONENT_FACTORS.find(
      (f) => f.dose === "Zero Carbs" && f.component === "Hidratos",
    );
    expect(zcHidratos?.kgPerMeal).toBe(0);
    const doses = new Set(DEFAULT_COMPONENT_FACTORS.map((f) => f.dose));
    expect([...doses].sort()).toEqual(
      [
        "300g",
        "450g",
        "Bulk",
        "Dose M",
        "Dose XL",
        "Extra Bulk",
        "Low Carb",
        "Zero Carbs",
      ].sort(),
    );
  });
});
