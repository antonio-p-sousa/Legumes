import { describe, expect, test } from "vitest";
import {
  PEIXE_CARNE_DOSES,
  VEGETARIANO_DOSES,
  buildCozinhaDaySheetRows,
  buildCozinhaView,
  confDaySheetName,
  confDateSheetName,
  groupLabelsByConfDate,
  isoToPtDate,
  weekLabelFileToken,
  type DishCategoryInput,
} from "./cozinha.server";
import type { WeekData } from "./common.server";
import type {
  ConfDay,
  LabelRow,
  OrderLineItem,
  ProcessedOrder,
} from "../weekly";

// ── Fixtures (construídas à mão — determinísticas) ──────────────────────────

interface OrderFixture {
  name?: string;
  confDay?: ConfDay;
  deliveryDate?: string;
  note?: string;
  lineItems: Array<Partial<OrderLineItem> & { name: string }>;
}

function makeProcessed(fixture: OrderFixture, index: number): ProcessedOrder {
  const name = fixture.name ?? `#4500${index}-LoV`;
  return {
    order: {
      name,
      email: "cliente@example.com",
      createdAt: "2025-11-20T10:00:00Z",
      note: fixture.note,
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
      deliveryDate: fixture.deliveryDate ?? "2025-11-24",
      zona: "Lisboa (Centro da cidade) 19-23h",
      dia: "Segunda",
    },
    confDay: fixture.confDay,
    issues: [],
  };
}

function makeWeekData(fixtures: OrderFixture[]): WeekData {
  const processed = fixtures.map(makeProcessed);
  return {
    processed,
    zones: [],
    couriers: [],
    meta: {
      source: "demo",
      weekLabel: "2025-W47 (demonstração)",
      windowStart: "2025-11-15T00:00:00Z",
      windowEnd: "2025-11-21T23:59:59Z",
      fetchedAt: "2025-11-21T12:00:00Z",
      totalOrders: processed.length,
      ordersSemAtributos: 0,
      ordersZonaDesconhecida: 0,
    },
  };
}

const DISHES: DishCategoryInput[] = [
  { baseName: "Tranche de Salmão", category: "peixe" },
  { baseName: "Jardineira de Novilho", category: "carne" },
  { baseName: "Moqueca de Tofu e Legumes", category: "vegetariano" },
  { baseName: "Poke Bowl Salmão", category: "poke" },
  { baseName: "Creme de Cenoura", category: "sopa" },
];

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

describe("buildCozinhaView", () => {
  test("agrupa os pratos do dia por categoria (peixe & carne, vegetariano, pokes, dose única)", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Tranche de Salmão - Low Carb", quantity: 2 },
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 3 },
          { name: "Poke Bowl Salmão - M arroz", quantity: 1 },
          { name: "Creme de Cenoura", quantity: 2 },
        ],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    const day = view.days[0];
    expect(day.peixeCarne.rows.map((r) => r.dish)).toEqual([
      "Jardineira de Novilho",
      "Tranche de Salmão",
    ]);
    expect(day.vegetariano.rows.map((r) => r.dish)).toEqual([
      "Moqueca de Tofu e Legumes",
    ]);
    expect(day.pokes).toEqual([
      { dish: "Poke Bowl Salmão", dose: "M arroz", quantity: 1 },
    ]);
    expect(day.doseUnica).toEqual([
      { dish: "Creme de Cenoura", dose: "Dose Única", quantity: 2 },
    ]);
  });

  test("colunas de dose na ordem fixa da categoria", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Tranche de Salmão - Zero Carbs", quantity: 1 },
          { name: "Moqueca de Tofu e Legumes - 450g", quantity: 1 },
        ],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    expect(view.days[0].peixeCarne.doseColumns).toEqual([
      "Low Carb",
      "Bulk",
      "Extra Bulk",
      "Zero Carbs",
    ]);
    expect(view.days[0].vegetariano.doseColumns).toEqual([
      "300g",
      "400g",
      "450g",
    ]);
    expect(view.days[0].peixeCarne.doseColumns).toEqual([
      ...PEIXE_CARNE_DOSES,
    ]);
    expect(view.days[0].vegetariano.doseColumns).toEqual([
      ...VEGETARIANO_DOSES,
    ]);
  });

  test("matriz com dose ausente → célula null; doses vendidas na célula certa", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 4 },
          { name: "Jardineira de Novilho - Zero Carbs", quantity: 1 },
        ],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert — [Low Carb, Bulk, Extra Bulk, Zero Carbs]
    expect(view.days[0].peixeCarne.rows).toEqual([
      {
        dish: "Jardineira de Novilho",
        cells: [null, 4, null, 1],
        total: 5,
      },
    ]);
  });

  test("dose inesperada em peixe/carne entra como coluna extra — nunca se perde quantidade", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Jardineira de Novilho - Dose Família", quantity: 1 },
        ],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    const matrix = view.days[0].peixeCarne;
    expect(matrix.doseColumns).toEqual([
      "Low Carb",
      "Bulk",
      "Extra Bulk",
      "Zero Carbs",
      "Dose Família",
    ]);
    expect(matrix.rows[0].cells).toEqual([null, 2, null, null, 1]);
    expect(matrix.total).toBe(3);
  });

  test("totais por linha, por coluna, por dia e globais", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Tranche de Salmão - Low Carb", quantity: 2 },
          { name: "Jardineira de Novilho - Low Carb", quantity: 1 },
          { name: "Jardineira de Novilho - Bulk", quantity: 3 },
        ],
      },
      {
        confDay: "4f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 4 }],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    const segunda = view.days[0];
    expect(segunda.peixeCarne.columnTotals).toEqual([3, 3, 0, 0]);
    expect(segunda.peixeCarne.total).toBe(6);
    expect(segunda.totalMeals).toBe(6);
    expect(view.days[1].totalMeals).toBe(4);
    expect(view.totalMeals).toBe(10);
  });

  test("nonMeal fica à parte e fora dos totais de refeições", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Embalagens biodegradáveis", quantity: 5 },
        ],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    expect(view.nonMeal).toEqual([
      { dish: "Embalagens biodegradáveis", dose: "Dose Única", quantity: 5 },
    ]);
    expect(view.days[0].totalMeals).toBe(2);
    expect(view.totalMeals).toBe(2);
    const dishesNoDia = [
      ...view.days[0].peixeCarne.rows.map((r) => r.dish),
      ...view.days[0].vegetariano.rows.map((r) => r.dish),
      ...view.days[0].pokes.map((r) => r.dish),
      ...view.days[0].doseUnica.map((r) => r.dish),
    ];
    expect(dishesNoDia).not.toContain("Embalagens biodegradáveis");
  });

  test("dia default = primeiro com refeições (ordem 2f → 3f → 4f), mesmo com input desordenado", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "4f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      },
      {
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
      {
        confDay: undefined, // sem confDay → não cria dia
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 9 }],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    expect(view.days.map((d) => d.confDay)).toEqual(["2f", "4f"]);
    expect(view.days[0].confDay).toBe("2f"); // o default da página é days[0]
    expect(view.days[0].label).toBe("Segunda");
    expect(view.days[1].label).toBe("Quarta");
  });

  test("prato sem categoria na tabela Dish cai em 'outro' → secção Dose Única", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [{ name: "Prato Misterioso - Bulk", quantity: 2 }],
      },
    ]);

    // Act — "Prato Misterioso" não existe em DISHES
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    expect(view.days[0].peixeCarne.rows).toEqual([]);
    expect(view.days[0].doseUnica).toEqual([
      { dish: "Prato Misterioso", dose: "Bulk", quantity: 2 },
    ]);
  });

  test("notas do dia: só encomendas desse dia com note não-vazia, ordenadas por encomenda", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        name: "#45002-LoV",
        confDay: "2f",
        note: "  Sem coentros, por favor.  ",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
      {
        name: "#45001-LoV",
        confDay: "2f",
        note: "Entregar na portaria.",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      },
      {
        name: "#45003-LoV",
        confDay: "2f",
        note: "   ", // só espaços → não conta
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
      {
        name: "#45004-LoV",
        confDay: "4f",
        note: "Nota de outro dia.",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    expect(view.days[0].notes).toEqual([
      { orderName: "#45001-LoV", note: "Entregar na portaria." },
      { orderName: "#45002-LoV", note: "Sem coentros, por favor." },
    ]);
    expect(view.days[1].notes).toEqual([
      { orderName: "#45004-LoV", note: "Nota de outro dia." },
    ]);
  });

  test("sacos = nº de encomendas do dia; total global de encomendas soma os dias", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 2 }],
      },
      {
        confDay: "2f",
        lineItems: [{ name: "Tranche de Salmão - Low Carb", quantity: 1 }],
      },
      {
        confDay: "4f",
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);

    // Assert
    expect(view.days[0].totalOrders).toBe(2);
    expect(view.days[1].totalOrders).toBe(1);
    expect(view.totalOrders).toBe(3);
  });

  test("confDate deriva da entrega — incl. DPD recolhido na véspera (entrega 3ª → confeção 2ª)", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        deliveryDate: "2025-11-24", // segunda → confeção no próprio dia
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
      {
        confDay: "4f",
        deliveryDate: "2025-11-27", // quinta → confeção na quarta 26
        lineItems: [{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 }],
      },
    ]);
    const weekDataDpd = makeWeekData([
      {
        confDay: "2f",
        deliveryDate: "2025-11-25", // terça, DPD véspera → confeção segunda 24
        lineItems: [{ name: "Jardineira de Novilho - Bulk", quantity: 1 }],
      },
    ]);

    // Act
    const view = buildCozinhaView(weekData, DISHES);
    const viewDpd = buildCozinhaView(weekDataDpd, DISHES);

    // Assert
    expect(view.days[0].confDate).toBe("2025-11-24");
    expect(view.days[1].confDate).toBe("2025-11-26");
    expect(viewDpd.days[0].confDate).toBe("2025-11-24");
  });

  test("semana vazia devolve vista vazia (empty state da página)", () => {
    // Act
    const view = buildCozinhaView(makeWeekData([]), DISHES);

    // Assert
    expect(view).toEqual({
      days: [],
      totalMeals: 0,
      totalOrders: 0,
      nonMeal: [],
    });
  });

  test("não muta o weekData nem a lista de pratos", () => {
    // Arrange
    const weekData = deepFreeze(
      makeWeekData([
        {
          confDay: "2f",
          note: "Nota.",
          lineItems: [
            { name: "Jardineira de Novilho - Bulk", quantity: 2 },
            { name: "Embalagens biodegradáveis", quantity: 1 },
          ],
        },
      ]),
    );
    const dishes = deepFreeze(
      DISHES.map((d) => ({ ...d })),
    ) as DishCategoryInput[];
    const snapshot = JSON.parse(JSON.stringify(weekData));

    // Act — objetos congelados lançariam TypeError se houvesse mutação
    buildCozinhaView(weekData, dishes);

    // Assert
    expect(weekData).toEqual(snapshot);
  });
});

describe("buildCozinhaDaySheetRows", () => {
  test("linhas Prato|Dose|Quantidade agrupadas por categoria, doses na ordem das colunas", () => {
    // Arrange
    const weekData = makeWeekData([
      {
        confDay: "2f",
        lineItems: [
          { name: "Creme de Cenoura", quantity: 2 },
          { name: "Poke Bowl Salmão - M arroz", quantity: 1 },
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 3 },
          { name: "Jardineira de Novilho - Zero Carbs", quantity: 1 },
          { name: "Jardineira de Novilho - Bulk", quantity: 4 },
        ],
      },
    ]);
    const view = buildCozinhaView(weekData, DISHES);

    // Act
    const rows = buildCozinhaDaySheetRows(view.days[0]);

    // Assert — peixe & carne primeiro (Bulk antes de Zero Carbs), depois
    // vegetariano, pokes e dose única
    expect(rows).toEqual([
      { prato: "Jardineira de Novilho", dose: "Bulk", quantidade: 4 },
      { prato: "Jardineira de Novilho", dose: "Zero Carbs", quantidade: 1 },
      { prato: "Moqueca de Tofu e Legumes", dose: "300g", quantidade: 3 },
      { prato: "Poke Bowl Salmão", dose: "M arroz", quantidade: 1 },
      { prato: "Creme de Cenoura", dose: "Dose Única", quantidade: 2 },
    ]);
  });
});

describe("helpers de export", () => {
  test("confDaySheetName produz 'Segunda 24-11' e cai no rótulo sem data", () => {
    expect(confDaySheetName({ label: "Segunda", confDate: "2025-11-24" })).toBe(
      "Segunda 24-11",
    );
    expect(confDaySheetName({ label: "Quarta", confDate: null })).toBe(
      "Quarta",
    );
  });

  test("confDateSheetName deriva o weekday da própria data", () => {
    expect(confDateSheetName("2025-11-24")).toBe("Segunda 24-11");
    expect(confDateSheetName("2025-11-26")).toBe("Quarta 26-11");
  });

  test("isoToPtDate converte para dd/mm/yyyy", () => {
    expect(isoToPtDate("2025-11-24")).toBe("24/11/2025");
  });

  test("weekLabelFileToken remove espaços, parênteses e diacríticos", () => {
    expect(weekLabelFileToken("2025-W47 (demonstração)")).toBe("2025-W47");
    expect(weekLabelFileToken("2026-W29")).toBe("2026-W29");
    expect(weekLabelFileToken("   ")).toBe("semana");
  });

  test("groupLabelsByConfDate agrupa por data preservando a ordem do motor", () => {
    // Arrange — já ordenadas por confDate → dish → orderName (como o motor)
    const labels: LabelRow[] = [
      { orderName: "#1", dish: "A - Bulk", client: "Ana", confDate: "2025-11-24" },
      { orderName: "#2", dish: "B - Bulk", client: "Rui", confDate: "2025-11-24" },
      { orderName: "#3", dish: "A - Bulk", client: "Zé", confDate: "2025-11-26" },
    ];

    // Act
    const groups = groupLabelsByConfDate(labels);

    // Assert
    expect(groups.map((g) => g.confDate)).toEqual([
      "2025-11-24",
      "2025-11-26",
    ]);
    expect(groups[0].rows.map((r) => r.orderName)).toEqual(["#1", "#2"]);
    expect(groups[1].rows.map((r) => r.orderName)).toEqual(["#3"]);
  });
});
