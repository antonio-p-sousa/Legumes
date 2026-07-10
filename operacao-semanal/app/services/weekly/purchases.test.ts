import { describe, expect, test } from "vitest";
import { buildPurchaseList } from "./purchases";
import type {
  ConfDay,
  OrderLineItem,
  ProcessedOrder,
  RecipeConfig,
} from "./types";

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

// ── Testes ───────────────────────────────────────────────────────────────────

describe("buildPurchaseList", () => {
  test("aplica a margem de 0.08 sobre o total agregado", () => {
    // Arrange
    const orders = [
      makeOrder([{ name: "Jardineira de Novilho - Bulk", quantity: 4 }], "2f"),
    ];

    // Act
    const list = buildPurchaseList(orders, [FICHA_JARDINEIRA_BULK], 0.08);

    // Assert — 4 × 0.25 kg = 1 kg de novilho; 1 × 1.08 = 1.08
    const talho = list.suppliers.find((s) => s.supplier === "Talho Central");
    expect(talho?.lines).toEqual([
      { ingredient: "Novilho", unit: "kg", required: 1, withMargin: 1.08 },
    ]);
    expect(list.missingRecipes).toEqual([]);
  });

  test("prato sem ficha técnica vai para missingRecipes com unitsSold somado", () => {
    // Arrange — mesmo (prato, dose) vendido em duas encomendas diferentes
    const orders = [
      makeOrder([{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 2 }], "2f"),
      makeOrder([{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 3 }], "3f"),
    ];

    // Act
    const list = buildPurchaseList(orders, [FICHA_JARDINEIRA_BULK], 0.08);

    // Assert — nunca descartar em silêncio (4.5)
    expect(list.missingRecipes).toEqual([
      { dish: "Moqueca de Tofu e Legumes", dose: "300g", unitsSold: 5 },
    ]);
    expect(list.suppliers).toEqual([]);
  });

  test("dose sem ficha não usa a ficha de outra dose do mesmo prato (match exato)", () => {
    // Arrange — só existe ficha para Bulk, vende-se Low Carb
    const orders = [
      makeOrder([{ name: "Jardineira de Novilho - Low Carb", quantity: 1 }], "2f"),
    ];

    // Act
    const list = buildPurchaseList(orders, [FICHA_JARDINEIRA_BULK], 0.08);

    // Assert
    expect(list.suppliers).toEqual([]);
    expect(list.missingRecipes).toEqual([
      { dish: "Jardineira de Novilho", dose: "Low Carb", unitsSold: 1 },
    ]);
  });

  test("mesmo ingrediente do mesmo fornecedor vindo de 2 pratos agrega numa linha só", () => {
    // Arrange — Batata da Frutaria Silva aparece nas duas fichas
    const orders = [
      makeOrder(
        [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          {
            name: "Tranche de Salmão com amêndoa e sweet chili - Low Carb",
            quantity: 3,
          },
        ],
        "2f",
      ),
    ];

    // Act
    const list = buildPurchaseList(
      orders,
      [FICHA_JARDINEIRA_BULK, FICHA_SALMAO_LOWCARB],
      0,
    );

    // Assert — 2×0.2 + 3×0.1 = 0.7 kg numa única linha
    const frutaria = list.suppliers.find((s) => s.supplier === "Frutaria Silva");
    expect(frutaria?.lines).toEqual([
      { ingredient: "Batata", unit: "kg", required: 0.7, withMargin: 0.7 },
    ]);
  });

  test("mesmo ingrediente de fornecedores diferentes NÃO agrega", () => {
    // Arrange — "Batata" existe na Frutaria Silva e no Mercado Abastecedor
    const fichaComOutroFornecedor: RecipeConfig = {
      dish: "Bacalhau com Broa",
      dose: "Bulk",
      ingredients: [
        {
          name: "Batata",
          qtyPerMeal: 0.15,
          unit: "kg",
          supplier: "Mercado Abastecedor",
        },
      ],
    };
    const orders = [
      makeOrder(
        [
          { name: "Jardineira de Novilho - Bulk", quantity: 1 },
          { name: "Bacalhau com Broa - Bulk", quantity: 1 },
        ],
        "4f",
      ),
    ];

    // Act
    const list = buildPurchaseList(
      orders,
      [FICHA_JARDINEIRA_BULK, fichaComOutroFornecedor],
      0,
    );

    // Assert — uma linha de Batata em cada fornecedor, sem se misturarem
    const frutaria = list.suppliers.find((s) => s.supplier === "Frutaria Silva");
    const mercado = list.suppliers.find(
      (s) => s.supplier === "Mercado Abastecedor",
    );
    expect(frutaria?.lines).toEqual([
      { ingredient: "Batata", unit: "kg", required: 0.2, withMargin: 0.2 },
    ]);
    expect(mercado?.lines).toEqual([
      { ingredient: "Batata", unit: "kg", required: 0.15, withMargin: 0.15 },
    ]);
  });

  test("quantity > 1 multiplica a ficha técnica", () => {
    // Arrange
    const orders = [
      makeOrder(
        [
          {
            name: "Tranche de Salmão com amêndoa e sweet chili - Low Carb",
            quantity: 5,
          },
        ],
        "3f",
      ),
    ];

    // Act
    const list = buildPurchaseList(orders, [FICHA_SALMAO_LOWCARB], 0);

    // Assert — 5 × 0.18 = 0.9 kg de salmão
    const peixaria = list.suppliers.find(
      (s) => s.supplier === "Peixaria Atlântico",
    );
    expect(peixaria?.lines).toEqual([
      {
        ingredient: "Tranche de salmão",
        unit: "kg",
        required: 0.9,
        withMargin: 0.9,
      },
    ]);
  });

  test("item não-refeição é ignorado: nem compras nem missingRecipes", () => {
    // Arrange
    const orders = [
      makeOrder(
        [
          { name: "Embalagens biodegradáveis", quantity: 10 },
          { name: "Subscrição de desconto mensal - 15% OFF", quantity: 1 },
          { name: "Voucher Oferta - €50.00", quantity: 1 },
        ],
        "2f",
      ),
    ];

    // Act
    const list = buildPurchaseList(orders, [FICHA_JARDINEIRA_BULK], 0.08);

    // Assert
    expect(list.suppliers).toEqual([]);
    expect(list.missingRecipes).toEqual([]);
  });

  test("encomenda sem confDay é ignorada por completo", () => {
    // Arrange — sem confDay (ex.: order sem zona), mesmo com refeições válidas
    const orders = [
      makeOrder([{ name: "Jardineira de Novilho - Bulk", quantity: 3 }]),
      makeOrder([{ name: "Moqueca de Tofu e Legumes - 300g", quantity: 2 }]),
    ];

    // Act
    const list = buildPurchaseList(orders, [FICHA_JARDINEIRA_BULK], 0.08);

    // Assert
    expect(list.suppliers).toEqual([]);
    expect(list.missingRecipes).toEqual([]);
  });

  test("arredonda a 3 casas no fim da agregação (0.1 + 0.2 = 0.3, não 0.30000000000000004)", () => {
    // Arrange — 1×0.1 + 2×0.1 = 0.1 + 0.2, o clássico do float
    const ficha: RecipeConfig = {
      dish: "Creme de Legumes",
      dose: "Dose Única",
      ingredients: [
        { name: "Cenoura", qtyPerMeal: 0.1, unit: "kg", supplier: "Frutaria Silva" },
      ],
    };
    const orders = [
      makeOrder([{ name: "Creme de Legumes", quantity: 1 }], "2f"),
      makeOrder([{ name: "Creme de Legumes", quantity: 2 }], "3f"),
    ];

    // Act
    const list = buildPurchaseList(orders, [ficha], 0);

    // Assert — exatamente 0.3, com 3 casas
    expect(list.suppliers[0].lines[0].required).toBe(0.3);
    expect(list.suppliers[0].lines[0].withMargin).toBe(0.3);
  });

  test("ordena fornecedores alfabeticamente, linhas por ingrediente e missing por prato", () => {
    // Arrange — fichas propositadamente fora de ordem
    const fichaZebra: RecipeConfig = {
      dish: "Wrap de Frango",
      dose: "Bulk",
      ingredients: [
        { name: "Tortilha", qtyPerMeal: 1, unit: "un", supplier: "Zebra Foods" },
        { name: "Frango", qtyPerMeal: 0.2, unit: "kg", supplier: "Aviário Norte" },
        { name: "Alface", qtyPerMeal: 0.05, unit: "kg", supplier: "Aviário Norte" },
      ],
    };
    const orders = [
      makeOrder(
        [
          { name: "Wrap de Frango - Bulk", quantity: 1 },
          { name: "Zimbro Assado - Bulk", quantity: 1 },
          { name: "Arroz de Pato - Bulk", quantity: 1 },
        ],
        "2f",
      ),
    ];

    // Act
    const list = buildPurchaseList(orders, [fichaZebra], 0.08);

    // Assert
    expect(list.suppliers.map((s) => s.supplier)).toEqual([
      "Aviário Norte",
      "Zebra Foods",
    ]);
    expect(list.suppliers[0].lines.map((l) => l.ingredient)).toEqual([
      "Alface",
      "Frango",
    ]);
    expect(list.missingRecipes.map((m) => m.dish)).toEqual([
      "Arroz de Pato",
      "Zimbro Assado",
    ]);
  });

  test("não muta as encomendas nem as fichas técnicas de input", () => {
    // Arrange
    const orders = [
      makeOrder(
        [
          { name: "Jardineira de Novilho - Bulk", quantity: 2 },
          { name: "Moqueca de Tofu e Legumes - 300g", quantity: 1 },
        ],
        "2f",
      ),
    ];
    const recipes = [FICHA_JARDINEIRA_BULK, FICHA_SALMAO_LOWCARB];
    const ordersSnapshot = structuredClone(orders);
    const recipesSnapshot = structuredClone(recipes);

    // Act
    buildPurchaseList(orders, recipes, 0.08);

    // Assert
    expect(orders).toEqual(ordersSnapshot);
    expect(recipes).toEqual(recipesSnapshot);
  });

  test("listas vazias produzem resultado vazio", () => {
    // Arrange / Act
    const list = buildPurchaseList([], [], 0.08);

    // Assert
    expect(list).toEqual({ suppliers: [], missingRecipes: [] });
  });
});
