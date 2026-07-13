import { describe, expect, test } from "vitest";
import { buildComprasView, type SupplierInfo } from "./compras.server";
import type {
  ConfDay,
  OrderLineItem,
  ProcessedOrder,
  RecipeConfig,
} from "../weekly";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeOrder(
  lineItems: Array<Pick<OrderLineItem, "name" | "quantity">>,
  confDay?: ConfDay,
): ProcessedOrder {
  return {
    order: {
      name: "#45004-LoV",
      email: "cliente@example.com",
      createdAt: "2025-11-19T10:00:00Z",
      customAttributes: [],
      subtotalPrice: 30,
      totalPrice: 33,
      lineItems: lineItems.map((li) => ({ ...li, price: 9.9 })),
    },
    delivery: {
      orderType: "Shipping",
      deliveryDate: "2025-11-24",
      zona: "Lisboa (Centro da cidade) 19-23h",
      dia: "Segunda",
    },
    confDay,
    issues: [],
  };
}

function makeWeekData(orders: ProcessedOrder[]): { processed: ProcessedOrder[] } {
  return { processed: orders };
}

const FICHA_JARDINEIRA_BULK: RecipeConfig = {
  dish: "Jardineira de Novilho",
  dose: "Bulk",
  ingredients: [
    { name: "Novilho", qtyPerMeal: 0.25, unit: "kg", supplier: "Talho Central" },
    { name: "Batata", qtyPerMeal: 0.2, unit: "kg", supplier: "Frutaria Silva" },
  ],
};

const FICHA_SALMAO_LOWCARB: RecipeConfig = {
  dish: "Tranche de Salmão com amêndoa e sweet chili",
  dose: "Low Carb",
  ingredients: [
    {
      name: "Tranche de salmão",
      qtyPerMeal: 0.18,
      unit: "kg",
      supplier: "Peixaria Atlântico",
    },
    { name: "Batata", qtyPerMeal: 0.1, unit: "kg", supplier: "Frutaria Silva" },
  ],
};

const SUPPLIERS_INFO: SupplierInfo[] = [
  {
    name: "Talho Central",
    email: "encomendas@talhocentral.pt",
    orderDay: "Quinta-feira",
  },
  { name: "Frutaria Silva", email: null, orderDay: null },
  { name: "Peixaria Atlântico", email: "peixe@atlantico.pt", orderDay: null },
];

// ── Testes ───────────────────────────────────────────────────────────────────

describe("buildComprasView", () => {
  test("aplica a margem da config sobre as quantidades agregadas", () => {
    // Arrange — 4 × 0.25 kg = 1 kg de novilho; 1 × 1.08 = 1.08
    const weekData = makeWeekData([
      makeOrder([{ name: "Jardineira de Novilho - Bulk", quantity: 4 }], "2f"),
    ]);

    // Act
    const view = buildComprasView(
      weekData,
      [FICHA_JARDINEIRA_BULK],
      0.08,
      SUPPLIERS_INFO,
    );

    // Assert
    const talho = view.suppliers.find((s) => s.supplier === "Talho Central");
    expect(talho?.lines).toEqual([
      { ingredient: "Novilho", unit: "kg", required: 1, withMargin: 1.08 },
    ]);
  });

  test("agrega pratos sem ficha por (prato, dose) e ordena por unitsSold desc", () => {
    // Arrange — Moqueca vendida em 2 encomendas (2+3=5), Arroz de Pato 1×2
    const weekData = makeWeekData([
      makeOrder(
        [
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 2 },
          { name: "Arroz de Pato - Bulk", quantity: 2 },
        ],
        "2f",
      ),
      makeOrder([{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 3 }], "3f"),
    ]);

    // Act
    const view = buildComprasView(weekData, [], 0.08, SUPPLIERS_INFO);

    // Assert — mais vendido primeiro, agregação somada por combinação
    expect(view.missing.top).toEqual([
      { dish: "Moqueca de Tofu e Legumes", dose: "300g", unitsSold: 5 },
      { dish: "Arroz de Pato", dose: "Bulk", unitsSold: 2 },
    ]);
    expect(view.missing.count).toBe(2);
    expect(view.missing.unitsTotal).toBe(7);
  });

  test("empata por unidades → desempata por prato e dose em ordem pt", () => {
    // Arrange — três combinações todas com 1 unidade
    const weekData = makeWeekData([
      makeOrder(
        [
          { name: "Zimbro Assado - Bulk", quantity: 1 },
          { name: "Arroz de Pato - Low Carb", quantity: 1 },
          { name: "Arroz de Pato - Bulk", quantity: 1 },
        ],
        "4f",
      ),
    ]);

    // Act
    const view = buildComprasView(weekData, [], 0, []);

    // Assert
    expect(view.missing.top).toEqual([
      { dish: "Arroz de Pato", dose: "Bulk", unitsSold: 1 },
      { dish: "Arroz de Pato", dose: "Low Carb", unitsSold: 1 },
      { dish: "Zimbro Assado", dose: "Bulk", unitsSold: 1 },
    ]);
  });

  test("enriquece o fornecedor com email e orderDay quando existem na BD", () => {
    // Arrange
    const weekData = makeWeekData([
      makeOrder([{ name: "Jardineira de Novilho - Bulk", quantity: 1 }], "2f"),
    ]);

    // Act
    const view = buildComprasView(
      weekData,
      [FICHA_JARDINEIRA_BULK],
      0.08,
      SUPPLIERS_INFO,
    );

    // Assert
    const talho = view.suppliers.find((s) => s.supplier === "Talho Central");
    expect(talho?.email).toBe("encomendas@talhocentral.pt");
    expect(talho?.orderDay).toBe("Quinta-feira");
  });

  test("fornecedor sem info extra fica sem os campos email/orderDay", () => {
    // Arrange — Frutaria Silva tem email/orderDay null; e um fornecedor com
    // email vazio/whitespace também não deve ser enriquecido
    const weekData = makeWeekData([
      makeOrder([{ name: "Jardineira de Novilho - Bulk", quantity: 1 }], "2f"),
    ]);
    const info: SupplierInfo[] = [
      { name: "Frutaria Silva", email: "   ", orderDay: null },
      // Talho Central propositadamente ausente da BD
    ];

    // Act
    const view = buildComprasView(weekData, [FICHA_JARDINEIRA_BULK], 0.08, info);

    // Assert — campos omitidos de todo, não apenas undefined
    const frutaria = view.suppliers.find((s) => s.supplier === "Frutaria Silva");
    const talho = view.suppliers.find((s) => s.supplier === "Talho Central");
    expect(frutaria).toBeDefined();
    expect(talho).toBeDefined();
    expect("email" in (frutaria ?? {})).toBe(false);
    expect("orderDay" in (frutaria ?? {})).toBe(false);
    expect("email" in (talho ?? {})).toBe(false);
    expect("orderDay" in (talho ?? {})).toBe(false);
  });

  test("stats contam fornecedores, linhas de ingrediente e alertas", () => {
    // Arrange — 2 fichas → 3 fornecedores; Batata partilhada agrega numa
    // única linha na Frutaria Silva (3 linhas no total); 1 prato sem ficha
    // → 1 alerta
    const weekData = makeWeekData([
      makeOrder(
        [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          {
            name: "Tranche de Salmão com amêndoa e sweet chili - Low Carb",
            quantity: 1,
          },
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 },
        ],
        "2f",
      ),
    ]);

    // Act
    const view = buildComprasView(
      weekData,
      [FICHA_JARDINEIRA_BULK, FICHA_SALMAO_LOWCARB],
      0.08,
      SUPPLIERS_INFO,
    );

    // Assert
    expect(view.stats).toEqual({
      fornecedores: 3,
      ingredientes: 3,
      alertas: 1,
    });
  });

  test("sem fichas técnicas: tudo em missing e unitsTotal = total de refeições", () => {
    // Arrange — 3+4=7 refeições; item não-refeição não conta
    const weekData = makeWeekData([
      makeOrder(
        [
          { name: "Jardineira de Novilho - Bulk", quantity: 3 },
          { name: "Embalagens biodegradáveis", quantity: 10 },
        ],
        "2f",
      ),
      makeOrder([{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 4 }], "3f"),
    ]);

    // Act — estado real atual: BD seed sem receitas
    const view = buildComprasView(weekData, [], 0.08, SUPPLIERS_INFO);

    // Assert
    expect(view.suppliers).toEqual([]);
    expect(view.missing.count).toBe(2);
    expect(view.missing.unitsTotal).toBe(7);
    expect(view.stats).toEqual({ fornecedores: 0, ingredientes: 0, alertas: 2 });
  });

  test("ordena os fornecedores alfabeticamente (pt)", () => {
    // Arrange — fornecedores propositadamente fora de ordem na ficha
    const fichaZebra: RecipeConfig = {
      dish: "Wrap de Frango",
      dose: "Bulk",
      ingredients: [
        { name: "Tortilha", qtyPerMeal: 1, unit: "un", supplier: "Zebra Foods" },
        { name: "Frango", qtyPerMeal: 0.2, unit: "kg", supplier: "Aviário Norte" },
      ],
    };
    const weekData = makeWeekData([
      makeOrder([{ name: "Wrap de Frango - Bulk", quantity: 1 }], "2f"),
    ]);

    // Act
    const view = buildComprasView(weekData, [fichaZebra], 0.08, []);

    // Assert
    expect(view.suppliers.map((s) => s.supplier)).toEqual([
      "Aviário Norte",
      "Zebra Foods",
    ]);
  });

  test("encomenda sem confDay não entra nem nas compras nem no missing", () => {
    // Arrange — order sem zona resolvida (confDay undefined)
    const weekData = makeWeekData([
      makeOrder([{ name: "Jardineira de Novilho - Bulk", quantity: 3 }]),
    ]);

    // Act
    const view = buildComprasView(
      weekData,
      [FICHA_JARDINEIRA_BULK],
      0.08,
      SUPPLIERS_INFO,
    );

    // Assert
    expect(view.suppliers).toEqual([]);
    expect(view.missing).toEqual({ count: 0, unitsTotal: 0, top: [] });
  });

  test("semana vazia produz vista vazia com stats a zero", () => {
    // Arrange / Act
    const view = buildComprasView(makeWeekData([]), [], 0.08, SUPPLIERS_INFO);

    // Assert
    expect(view).toEqual({
      suppliers: [],
      missing: { count: 0, unitsTotal: 0, top: [] },
      stats: { fornecedores: 0, ingredientes: 0, alertas: 0 },
    });
  });

  test("não muta weekData, fichas nem suppliersInfo de input", () => {
    // Arrange
    const weekData = makeWeekData([
      makeOrder(
        [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 },
        ],
        "2f",
      ),
    ]);
    const recipes = [FICHA_JARDINEIRA_BULK, FICHA_SALMAO_LOWCARB];
    const info = structuredClone(SUPPLIERS_INFO);
    const weekSnapshot = structuredClone(weekData);
    const recipesSnapshot = structuredClone(recipes);
    const infoSnapshot = structuredClone(info);

    // Act
    const view = buildComprasView(weekData, recipes, 0.08, info);
    // mexer no resultado também não pode afetar os inputs
    view.suppliers.forEach((s) => s.lines.forEach((l) => (l.required = -1)));

    // Assert
    expect(weekData).toEqual(weekSnapshot);
    expect(recipes).toEqual(recipesSnapshot);
    expect(info).toEqual(infoSnapshot);
  });
});
