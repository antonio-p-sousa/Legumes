import { describe, expect, test } from "vitest";
import {
  ISSUE_AFTER_CLOSE,
  ISSUE_ANOMALOUS_DELIVERY,
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

describe("processOrders — markAfterClose (incluir e assinalar pós-fecho)", () => {
  // Fecho oficial: sexta 21/11 23:59:59. Antes = dentro; depois = pós-fecho.
  const FECHO = "2025-11-21T23:59:59Z";

  test("marca as encomendas criadas depois do fecho com ISSUE_AFTER_CLOSE", () => {
    // Arrange — uma encomenda pós-fecho (sábado 22/11), zona/atributos válidos.
    const posFecho = makeOrder({
      name: "#45100-LoV",
      createdAt: "2025-11-22T01:28:00Z",
    });

    // Act
    const { processed } = processOrders([posFecho], ZONES, undefined, {
      markAfterClose: FECHO,
    });

    // Assert — ENTRA nos cálculos (confDay resolvido) e fica assinalada.
    expect(processed).toHaveLength(1);
    expect(processed[0].confDay).toBe("2f");
    expect(processed[0].issues).toContain(ISSUE_AFTER_CLOSE);
  });

  test("não marca as encomendas criadas antes ou no instante do fecho", () => {
    // Arrange — uma antes do fecho e outra criada exatamente no instante (a
    // comparação é estrita: o fecho é inclusivo, logo não é pós-fecho).
    const antes = makeOrder({ name: "#1", createdAt: "2025-11-18T10:00:00Z" });
    const noFecho = makeOrder({ name: "#2", createdAt: FECHO });

    // Act
    const { processed } = processOrders([antes, noFecho], ZONES, undefined, {
      markAfterClose: FECHO,
    });

    // Assert
    expect(processed[0].issues).not.toContain(ISSUE_AFTER_CLOSE);
    expect(processed[1].issues).not.toContain(ISSUE_AFTER_CLOSE);
  });

  test("acrescenta ISSUE_AFTER_CLOSE mantendo as outras issues da encomenda", () => {
    // Arrange — pós-fecho E com zona desconhecida (duas condições a assinalar).
    const posFechoSemZona = makeOrder({
      name: "#45101-LoV",
      createdAt: "2025-11-22T05:00:00Z",
      customAttributes: makeAttrs({
        "Horário de entrega": "Braga (Centro) 09-12h",
      }),
    });

    // Act
    const { processed } = processOrders([posFechoSemZona], ZONES, undefined, {
      markAfterClose: FECHO,
    });

    // Assert — a issue de zona mantém-se e a pós-fecho é acrescentada.
    expect(processed[0].issues).toEqual([
      `${ISSUE_UNKNOWN_ZONE_PREFIX}Braga (Centro) 09-12h`,
      ISSUE_AFTER_CLOSE,
    ]);
  });

  test("sem markAfterClose nada muda — nenhuma encomenda é assinalada", () => {
    // Arrange — a mesma encomenda pós-fecho, sem passar options.
    const posFecho = makeOrder({
      name: "#45100-LoV",
      createdAt: "2025-11-22T01:28:00Z",
    });

    // Act — 3.º arg (janela) e 4.º (options) ausentes: comportamento clássico.
    const semOptions = processOrders([posFecho], ZONES);
    const optionsVazias = processOrders([posFecho], ZONES, undefined, {});

    // Assert
    expect(semOptions.processed[0].issues).not.toContain(ISSUE_AFTER_CLOSE);
    expect(optionsVazias.processed[0].issues).not.toContain(ISSUE_AFTER_CLOSE);
  });

  test("createdAt ilegível não é assinalado como pós-fecho", () => {
    // Arrange — data inválida não pode ser tratada como posterior ao fecho.
    const semData = makeOrder({ name: "#?", createdAt: "sem-data" });

    // Act
    const { processed } = processOrders([semData], ZONES, undefined, {
      markAfterClose: FECHO,
    });

    // Assert
    expect(processed[0].issues).not.toContain(ISSUE_AFTER_CLOSE);
  });

  test("não muta as issues do ProcessedOrder ao assinalar (imutabilidade)", () => {
    // Arrange — pós-fecho com uma issue prévia (atributos em falta).
    const posFechoSemAtributos = makeOrder({
      name: "#45102-LoV",
      createdAt: "2025-11-22T05:00:00Z",
      customAttributes: [],
    });

    // Act — corre duas vezes; a marcação não pode acumular nem partilhar array.
    const primeira = processOrders([posFechoSemAtributos], ZONES, undefined, {
      markAfterClose: FECHO,
    });
    const segunda = processOrders([posFechoSemAtributos], ZONES, undefined, {
      markAfterClose: FECHO,
    });

    // Assert — cada resultado tem exatamente as duas issues, sem duplicação.
    expect(primeira.processed[0].issues).toEqual([
      ISSUE_MISSING_DELIVERY_ATTRS,
      ISSUE_AFTER_CLOSE,
    ]);
    expect(segunda.processed[0].issues).toEqual([
      ISSUE_MISSING_DELIVERY_ATTRS,
      ISSUE_AFTER_CLOSE,
    ]);
  });
});

describe("processOrders — expectedDeliveryWindow (datas de entrega anómalas)", () => {
  // Entregas esperadas: do dia seguinte ao fecho (sáb 22/11) até fecho+14.
  const JANELA = { from: "2025-11-22", to: "2025-12-05" };

  test("data de entrega dentro da janela esperada não recebe a issue", () => {
    // Arrange — entrega segunda 24/11, dentro de [22/11, 05/12].
    const order = makeOrder();

    // Act
    const { processed } = processOrders([order], ZONES, undefined, {
      expectedDeliveryWindow: JANELA,
    });

    // Assert
    expect(processed[0].issues).not.toContain(ISSUE_ANOMALOUS_DELIVERY);
  });

  test("data de entrega ANTES da janela → issue, mas a encomenda entra nos cálculos", () => {
    // Arrange — data passada (fenómeno w30: o site deixou escolher 20/07).
    const anomala = makeOrder({
      name: "#45200-LoV",
      customAttributes: makeAttrs({ "Data de entrega": "20/11/2025" }),
    });

    // Act
    const { processed } = processOrders([anomala], ZONES, undefined, {
      expectedDeliveryWindow: JANELA,
    });

    // Assert — incluir-e-assinalar: confDay resolvido, issue presente.
    expect(processed).toHaveLength(1);
    expect(processed[0].confDay).toBe("2f");
    expect(processed[0].issues).toContain(ISSUE_ANOMALOUS_DELIVERY);
  });

  test("data de entrega DEPOIS da janela → issue (data suspeita, >14 dias)", () => {
    // Arrange
    const anomala = makeOrder({
      name: "#45201-LoV",
      customAttributes: makeAttrs({ "Data de entrega": "10/12/2025" }),
    });

    // Act
    const { processed } = processOrders([anomala], ZONES, undefined, {
      expectedDeliveryWindow: JANELA,
    });

    // Assert
    expect(processed[0].issues).toContain(ISSUE_ANOMALOUS_DELIVERY);
  });

  test("limites inclusivos: entrega exatamente em from ou em to → SEM issue", () => {
    // Arrange
    const noInicio = makeOrder({
      name: "#1",
      customAttributes: makeAttrs({ "Data de entrega": "22/11/2025" }),
    });
    const noFim = makeOrder({
      name: "#2",
      customAttributes: makeAttrs({ "Data de entrega": "05/12/2025" }),
    });

    // Act
    const { processed } = processOrders([noInicio, noFim], ZONES, undefined, {
      expectedDeliveryWindow: JANELA,
    });

    // Assert
    expect(processed[0].issues).not.toContain(ISSUE_ANOMALOUS_DELIVERY);
    expect(processed[1].issues).not.toContain(ISSUE_ANOMALOUS_DELIVERY);
  });

  test("encomenda sem delivery válido não rebenta nem recebe a issue anómala", () => {
    // Arrange — atributos em falta → delivery null; não há data a verificar.
    const semAtributos = makeOrder({ customAttributes: [] });

    // Act
    const { processed } = processOrders([semAtributos], ZONES, undefined, {
      expectedDeliveryWindow: JANELA,
    });

    // Assert
    expect(processed[0].issues).toEqual([ISSUE_MISSING_DELIVERY_ATTRS]);
  });

  test("acrescenta a issue mantendo as outras — incl. combinada com pós-fecho", () => {
    // Arrange — criada depois do fecho E com data de entrega passada.
    const posFechoAnomala = makeOrder({
      name: "#45202-LoV",
      createdAt: "2025-11-22T05:00:00Z",
      customAttributes: makeAttrs({ "Data de entrega": "20/11/2025" }),
    });

    // Act
    const { processed } = processOrders([posFechoAnomala], ZONES, undefined, {
      markAfterClose: "2025-11-21T23:59:59Z",
      expectedDeliveryWindow: JANELA,
    });

    // Assert — as duas marcações coexistem, cada uma por cópia imutável.
    expect(processed[0].issues).toEqual([
      ISSUE_AFTER_CLOSE,
      ISSUE_ANOMALOUS_DELIVERY,
    ]);
  });

  test("sem expectedDeliveryWindow nada muda — nenhuma encomenda é assinalada", () => {
    // Arrange — a mesma data passada, sem passar a opção.
    const anomala = makeOrder({
      customAttributes: makeAttrs({ "Data de entrega": "20/11/2025" }),
    });

    // Act — comportamento clássico (goldens chamam com 2 args).
    const semOptions = processOrders([anomala], ZONES);
    const optionsVazias = processOrders([anomala], ZONES, undefined, {});

    // Assert
    expect(semOptions.processed[0].issues).not.toContain(
      ISSUE_ANOMALOUS_DELIVERY,
    );
    expect(optionsVazias.processed[0].issues).not.toContain(
      ISSUE_ANOMALOUS_DELIVERY,
    );
  });
});
