import { describe, expect, test } from "vitest";
import { filterOrderWindow, matchZone, resolveConfDay } from "./schedule";
import type {
  OrderInput,
  ParsedDelivery,
  WindowConfig,
  ZoneConfig,
} from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeZone(overrides: Partial<ZoneConfig> = {}): ZoneConfig {
  return {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "2f",
    courierName: "Off Limits",
    active: true,
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<ParsedDelivery> = {}): ParsedDelivery {
  return {
    orderType: "Shipping",
    deliveryDate: "2025-11-24",
    zona: "Lisboa (Centro da cidade) 19-23h",
    dia: "Segunda",
    ...overrides,
  };
}

function makeOrder(name: string, createdAt: string): OrderInput {
  return {
    name,
    email: "cliente@example.com",
    createdAt,
    customAttributes: [],
    subtotalPrice: 32.5,
    totalPrice: 36,
    lineItems: [
      { name: "Jardineira de Novilho - Bulk", quantity: 2, price: 8.5 },
    ],
  };
}

/** Sáb 2025-11-22 00:00 → Sex 2025-11-28 23:59:59 (regra 4.4). */
const WINDOW: WindowConfig = {
  windowStart: "2025-11-22T00:00:00Z",
  windowEnd: "2025-11-28T23:59:59Z",
};

// ── matchZone ────────────────────────────────────────────────────────────────

describe("matchZone", () => {
  test("faz match exato do matchText e devolve a zona", () => {
    const lisboa = makeZone();
    const coimbra = makeZone({
      matchText: "Coimbra (Cidade) 18-21h",
      county: "Coimbra",
    });

    const matched = matchZone("Lisboa (Centro da cidade) 19-23h", [
      coimbra,
      lisboa,
    ]);

    expect(matched).toBe(lisboa);
  });

  test("ignora espaços à volta (trim) em ambos os lados", () => {
    const zone = makeZone({ matchText: "  Leiria 18-20h " });

    expect(matchZone("Leiria 18-20h", [zone])).toBe(zone);
    expect(matchZone("  Leiria 18-20h  ", [makeZone({ matchText: "Leiria 18-20h" })])).toBeDefined();
  });

  test("zona inativa não faz match", () => {
    const inactive = makeZone({ active: false });

    expect(matchZone("Lisboa (Centro da cidade) 19-23h", [inactive])).toBeUndefined();
  });

  test("match parcial não conta (só igualdade exata)", () => {
    const zone = makeZone();

    expect(matchZone("Lisboa", [zone])).toBeUndefined();
    expect(matchZone("Lisboa (Centro da cidade)", [zone])).toBeUndefined();
    expect(
      matchZone("Lisboa (Centro da cidade) 19-23h extra", [zone]),
    ).toBeUndefined();
  });

  test("devolve undefined quando não há zonas configuradas", () => {
    expect(matchZone("Lisboa (Centro da cidade) 19-23h", [])).toBeUndefined();
  });
});

// ── resolveConfDay ───────────────────────────────────────────────────────────

describe("resolveConfDay", () => {
  test("dia fixo é devolvido tal e qual (2f, 3f, 4f)", () => {
    const delivery = makeDelivery();

    expect(resolveConfDay(makeZone({ confDay: "2f" }), delivery)).toBe("2f");
    expect(resolveConfDay(makeZone({ confDay: "3f" }), delivery)).toBe("3f");
    expect(resolveConfDay(makeZone({ confDay: "4f" }), delivery)).toBe("4f");
  });

  test("vespera com entrega terça 2025-11-25 confeciona na 2f (DPD recolhido na véspera)", () => {
    const dpd = makeZone({
      matchText: "Portugal Continental 08-15h",
      confDay: "vespera",
      courierName: "DPD",
    });
    const delivery = makeDelivery({ deliveryDate: "2025-11-25", dia: "Terça" });

    expect(resolveConfDay(dpd, delivery)).toBe("2f");
  });

  test("vespera com entrega quarta 2025-11-26 confeciona na 3f", () => {
    const dpd = makeZone({ confDay: "vespera" });
    const delivery = makeDelivery({
      deliveryDate: "2025-11-26",
      dia: "Quarta",
    });

    expect(resolveConfDay(dpd, delivery)).toBe("3f");
  });

  test("vespera com entrega domingo faz wrap para sábado", () => {
    const dpd = makeZone({ confDay: "vespera" });
    const delivery = makeDelivery({
      deliveryDate: "2025-11-30", // domingo
      dia: "Domingo",
    });

    expect(resolveConfDay(dpd, delivery)).toBe("sab");
  });

  test("vespera baseia-se na deliveryDate ISO, não no texto do dia", () => {
    const dpd = makeZone({ confDay: "vespera" });
    // Texto diz "Quarta" mas a data é terça 2025-11-25 → véspera é 2f, não 3f.
    const delivery = makeDelivery({
      deliveryDate: "2025-11-25",
      dia: "Quarta",
    });

    expect(resolveConfDay(dpd, delivery)).toBe("2f");
  });

  test("vespera lança erro para deliveryDate fora do formato yyyy-mm-dd", () => {
    const dpd = makeZone({ confDay: "vespera" });
    const delivery = makeDelivery({ deliveryDate: "25/11/2025" });

    expect(() => resolveConfDay(dpd, delivery)).toThrow(/inválida/);
  });
});

// ── filterOrderWindow ────────────────────────────────────────────────────────

describe("filterOrderWindow", () => {
  test("encomenda exatamente em windowStart fica DENTRO (inclusivo)", () => {
    const order = makeOrder("#45001-LoV", "2025-11-22T00:00:00Z");

    const { inWindow, excluded } = filterOrderWindow([order], WINDOW);

    expect(inWindow).toEqual([order]);
    expect(excluded).toEqual([]);
  });

  test("encomenda exatamente em windowEnd fica DENTRO (inclusivo)", () => {
    const order = makeOrder("#45002-LoV", "2025-11-28T23:59:59Z");

    const { inWindow, excluded } = filterOrderWindow([order], WINDOW);

    expect(inWindow).toEqual([order]);
    expect(excluded).toEqual([]);
  });

  test("encomenda 1 segundo depois do fecho fica FORA", () => {
    const order = makeOrder("#45003-LoV", "2025-11-29T00:00:00Z");

    const { inWindow, excluded } = filterOrderWindow([order], WINDOW);

    expect(inWindow).toEqual([]);
    expect(excluded).toEqual([order]);
  });

  test("encomenda antes do início da janela fica FORA", () => {
    const order = makeOrder("#44999-LoV", "2025-11-21T23:59:59Z");

    const { excluded } = filterOrderWindow([order], WINDOW);

    expect(excluded).toEqual([order]);
  });

  test("compara instantes: offsets ISO diferentes são equivalentes", () => {
    // 2025-11-22T01:00+01:00 é o mesmo instante que o windowStart em Z.
    const order = makeOrder("#45004-LoV", "2025-11-22T01:00:00+01:00");

    const { inWindow } = filterOrderWindow([order], WINDOW);

    expect(inWindow).toEqual([order]);
  });

  test("separa corretamente um lote misto pela ordem original", () => {
    const dentro1 = makeOrder("#45005-LoV", "2025-11-24T10:30:00Z");
    const fora = makeOrder("#45006-LoV", "2025-11-29T08:00:00Z");
    const dentro2 = makeOrder("#45007-LoV", "2025-11-28T12:00:00Z");

    const { inWindow, excluded } = filterOrderWindow(
      [dentro1, fora, dentro2],
      WINDOW,
    );

    expect(inWindow).toEqual([dentro1, dentro2]);
    expect(excluded).toEqual([fora]);
  });

  test("createdAt ilegível vai para excluded, nunca entra por engano", () => {
    const order = makeOrder("#45008-LoV", "data-sem-sentido");

    const { inWindow, excluded } = filterOrderWindow([order], WINDOW);

    expect(inWindow).toEqual([]);
    expect(excluded).toEqual([order]);
  });

  test("lança erro para janela com datas ilegíveis", () => {
    const badWindow: WindowConfig = {
      windowStart: "sábado",
      windowEnd: "sexta",
    };

    expect(() => filterOrderWindow([], badWindow)).toThrow(/inválida/);
  });

  test("não muta os arrays de input", () => {
    const orders = [
      makeOrder("#45009-LoV", "2025-11-24T10:00:00Z"),
      makeOrder("#45010-LoV", "2025-11-29T10:00:00Z"),
    ];
    const frozenOrders = Object.freeze(orders.map((o) => Object.freeze(o)));
    const snapshot = orders.map((o) => ({ ...o }));

    const result = filterOrderWindow(
      frozenOrders as OrderInput[],
      Object.freeze({ ...WINDOW }),
    );

    expect(orders).toEqual(snapshot);
    expect(result.inWindow).not.toBe(orders);
    expect(result.excluded).not.toBe(orders);
  });

  test("matchZone não muta o array de zonas", () => {
    const zones = [makeZone(), makeZone({ matchText: "Leiria 18-20h" })];
    const frozen = Object.freeze(zones.map((z) => Object.freeze(z)));

    matchZone("Leiria 18-20h", frozen as ZoneConfig[]);

    expect(zones).toHaveLength(2);
    expect(zones[0].matchText).toBe("Lisboa (Centro da cidade) 19-23h");
  });
});
