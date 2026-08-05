import { describe, expect, test } from "vitest";
import {
  CHECKLIST_HREFS,
  MAX_ENCOMENDAS_LISTADAS,
  buildAvisos,
  buildSemanaView,
  formatDataHoraPt,
  formatListaEncomendas,
  minutosDesde,
  type SemanaViewConfig,
} from "./semana.server";
import type { WeekData } from "./common.server";
import { processOrders } from "../weekly";
import type {
  CourierConfig,
  OrderInput,
  ProcessedOrder,
  ZoneConfig,
} from "../weekly";

// ── Fixture determinística ───────────────────────────────────────────────────

const ZONES: ZoneConfig[] = [
  {
    matchText: "Lisboa (Centro da cidade) 19-23h",
    county: "Lisboa",
    confDay: "2f",
    courierName: "Off Limits",
    active: true,
  },
  {
    matchText: "Coimbra (Centro) 18-22h",
    county: "Coimbra",
    confDay: "3f",
    courierName: "Interno",
    active: true,
  },
  {
    matchText: "Portugal Continental 08-15h",
    county: "Portugal Continental",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
  },
];

const COURIERS: CourierConfig[] = [
  { name: "Off Limits", type: "partner", ordering: "manual" },
  { name: "Interno", type: "internal", ordering: "postcode" },
  { name: "DPD", type: "dpd", ordering: "manual" },
];

const CONFIG: SemanaViewConfig = { dpdAccount: "03290201" };

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
    name: "#45001-LoV",
    email: "ana@example.com",
    createdAt: "2025-11-18T10:00:00Z",
    customAttributes: makeAttrs(),
    shippingAddress: {
      name: "Ana Silva",
      address1: "Rua das Flores 1",
      zip: "1000-001",
      city: "Lisboa",
      phone: "+351 912 345 678",
    },
    subtotalPrice: 40,
    totalPrice: 40,
    lineItems: [
      { name: "Jardineira de Novilho - Bulk", quantity: 2, price: 7.5 },
    ],
    ...overrides,
  };
}

/**
 * 6 encomendas:
 *  #1 Lisboa/2f  ana    40€  2× Jardineira Bulk
 *  #2 Lisboa/2f  ANA    60€  1× Salmão Low Carb + 1× Subscrição (não-refeição)
 *  #3 Coimbra/3f bruno  30€  3× Jardineira Bulk
 *  #4 DPD véspera (entrega 3ª → confeção 2f) carla 100€ 2× Salmão Low Carb
 *  #5 sem atributos de entrega  dora 25€
 *  #6 zona desconhecida         eva  20€
 */
function makeFixtureOrders(): OrderInput[] {
  return [
    makeOrder(),
    makeOrder({
      name: "#45002-LoV",
      email: "ANA@example.com",
      totalPrice: 60,
      lineItems: [
        { name: "Tranche de Salmão - Low Carb", quantity: 1, price: 8 },
        { name: "Subscrição Semanal", quantity: 1, price: 0 },
      ],
    }),
    makeOrder({
      name: "#45003-LoV",
      email: "bruno@example.com",
      totalPrice: 30,
      customAttributes: makeAttrs({
        "Horário de entrega": "Coimbra (Centro) 18-22h",
        "Data de entrega": "25/11/2025",
        "Dia de entrega": "Terça",
      }),
      lineItems: [
        { name: "Jardineira de Novilho - Bulk", quantity: 3, price: 7.5 },
      ],
    }),
    makeOrder({
      name: "#45004-LoV",
      email: "carla@example.com",
      totalPrice: 100,
      customAttributes: makeAttrs({
        "Horário de entrega": "Portugal Continental 08-15h",
        "Data de entrega": "25/11/2025",
        "Dia de entrega": "Terça",
      }),
      lineItems: [
        { name: "Tranche de Salmão - Low Carb", quantity: 2, price: 8 },
      ],
    }),
    makeOrder({
      name: "#45005-LoV",
      email: "dora@example.com",
      totalPrice: 25,
      customAttributes: [],
      lineItems: [
        { name: "Jardineira de Novilho - Bulk", quantity: 1, price: 7.5 },
      ],
    }),
    makeOrder({
      name: "#45006-LoV",
      email: "eva@example.com",
      totalPrice: 20,
      customAttributes: makeAttrs({
        "Horário de entrega": "Braga (Centro) 09-12h",
      }),
      lineItems: [
        { name: "Jardineira de Novilho - Bulk", quantity: 1, price: 7.5 },
      ],
    }),
  ];
}

function makeWeekData(processed: ProcessedOrder[]): WeekData {
  return {
    processed,
    zones: ZONES,
    couriers: COURIERS,
    meta: {
      source: "demo",
      weekLabel: "2025-W47 (demonstração)",
      windowStart: "2025-11-15T00:00:00Z",
      windowEnd: "2025-11-21T23:59:59Z",
      fetchedAt: "2025-11-22T09:00:00Z",
      totalOrders: processed.length,
      ordersSemAtributos: 0,
      ordersZonaDesconhecida: 0,
      ordersPosFecho: 0,
      ordersDataAnomala: 0,
    },
  };
}

function makeFixtureView(orders: OrderInput[] = makeFixtureOrders()) {
  const { processed } = processOrders(orders, ZONES);
  return buildSemanaView(makeWeekData(processed), CONFIG);
}

// ── Testes ───────────────────────────────────────────────────────────────────

describe("buildSemanaView — kpis", () => {
  test("calcula encomendas, válidas e refeições com a fixture determinística", () => {
    const { kpis } = makeFixtureView();

    expect(kpis.encomendas).toBe(6);
    expect(kpis.validas).toBe(4);
    // 2f: 2 (Jardineira) + 1 (Salmão) + 2 (Salmão DPD) · 3f: 3 (Jardineira);
    // a Subscrição não é refeição e as encomendas com issues ficam de fora.
    expect(kpis.refeicoes).toBe(8);
  });

  test("semZona conta as encomendas com issues (atributos em falta + zona desconhecida)", () => {
    const { kpis } = makeFixtureView();

    expect(kpis.semZona).toBe(2);
  });

  test("faturação soma o totalPrice de todas as encomendas da janela", () => {
    const { kpis } = makeFixtureView();

    expect(kpis.faturacao).toBe(40 + 60 + 30 + 100 + 25 + 20);
  });

  test("clientes conta e-mails únicos sem distinguir maiúsculas", () => {
    const { kpis } = makeFixtureView();

    // ana aparece 2× ("ana@…" e "ANA@…") e conta 1.
    expect(kpis.clientes).toBe(5);
  });

  test("semana sem encomendas devolve kpis a zero, sem dias e sem avisos", () => {
    const view = buildSemanaView(makeWeekData([]), CONFIG);

    expect(view.kpis).toEqual({
      encomendas: 0,
      validas: 0,
      semZona: 0,
      refeicoes: 0,
      faturacao: 0,
      clientes: 0,
    });
    expect(view.dias).toEqual([]);
    expect(view.avisos.total).toBe(0);
    expect(view.checklist).toHaveLength(5);
  });
});

describe("buildSemanaView — dias de confeção", () => {
  test("dias ordenados 2f→dom com rótulo PT, encomendas e refeições certos", () => {
    const { dias } = makeFixtureView();

    expect(dias.map((d) => d.confDay)).toEqual(["2f", "3f"]);
    expect(dias[0]).toMatchObject({
      diaPT: "Segunda",
      encomendas: 3,
      refeicoes: 5,
    });
    expect(dias[1]).toMatchObject({
      diaPT: "Terça",
      encomendas: 1,
      refeicoes: 3,
    });
  });

  test("canais listam as estafetas do dia e o DPD aparece com contagem de envios", () => {
    const { dias } = makeFixtureView();

    // 2f: Off Limits (2 encomendas locais) + 1 envio DPD recolhido na véspera.
    expect(dias[0].canais).toEqual(["Off Limits", "DPD · 1 envio"]);
    expect(dias[1].canais).toEqual(["Interno"]);
  });
});

describe("buildAvisos", () => {
  test("identifica sem atributos e zona desconhecida com os números das encomendas", () => {
    const { processed } = processOrders(makeFixtureOrders(), ZONES);
    const avisos = buildAvisos(processed);

    expect(avisos.semAtributos.count).toBe(1);
    expect(avisos.semAtributos.encomendas).toEqual(["#45005-LoV"]);
    expect(avisos.semAtributos.lista).toBe("#45005-LoV");
    expect(avisos.semZona.count).toBe(1);
    expect(avisos.semZona.encomendas).toEqual(["#45006-LoV"]);
    expect(avisos.posFecho.count).toBe(0);
    expect(avisos.dataAnomala.count).toBe(0);
    expect(avisos.total).toBe(2);
  });

  test("assinala pós-fecho e data anómala e conta encomendas distintas no total", () => {
    // Fecho a 17/11 → as 6 encomendas (criadas a 18/11) ficam pós-fecho;
    // entregas esperadas só a partir de 25/11 → as datas 24/11 são anómalas
    // (#1, #2 e #6; a #5 não tem delivery e fica de fora da verificação).
    const { processed } = processOrders(makeFixtureOrders(), ZONES, undefined, {
      markAfterClose: "2025-11-17T00:00:00Z",
      expectedDeliveryWindow: { from: "2025-11-25", to: "2025-12-08" },
    });
    const avisos = buildAvisos(processed);

    expect(avisos.posFecho.count).toBe(6);
    expect(avisos.dataAnomala.encomendas).toEqual([
      "#45001-LoV",
      "#45002-LoV",
      "#45006-LoV",
    ]);
    // Todas as encomendas têm pelo menos um aviso → total é 6, não a soma
    // das listas (6 + 3 + 1 + 1).
    expect(avisos.total).toBe(6);
  });

  test("semana sem issues devolve avisos vazios", () => {
    const { processed } = processOrders(
      makeFixtureOrders().slice(0, 4),
      ZONES,
    );
    const avisos = buildAvisos(processed);

    expect(avisos.total).toBe(0);
    expect(avisos.posFecho.lista).toBe("");
    expect(avisos.semZona.encomendas).toEqual([]);
  });
});

describe("formatListaEncomendas", () => {
  test("até 10 encomendas mostra todas separadas por vírgula", () => {
    expect(formatListaEncomendas([])).toBe("");
    expect(formatListaEncomendas(["#1-LoV", "#2-LoV"])).toBe("#1-LoV, #2-LoV");

    const dez = Array.from({ length: 10 }, (_, i) => `#${i + 1}-LoV`);
    expect(formatListaEncomendas(dez)).toBe(dez.join(", "));
    expect(formatListaEncomendas(dez)).not.toContain("e mais");
  });

  test("acima de 10 mostra as primeiras 10 e resume o resto como 'e mais N'", () => {
    const doze = Array.from({ length: 12 }, (_, i) => `#${i + 1}-LoV`);

    expect(formatListaEncomendas(doze)).toBe(
      `${doze.slice(0, MAX_ENCOMENDAS_LISTADAS).join(", ")} e mais 2`,
    );
  });
});

describe("buildSemanaView — checklist da semana", () => {
  test("devolve os 5 passos pela ordem do processo manual", () => {
    const { checklist } = makeFixtureView();

    expect(checklist.map((p) => [p.numero, p.titulo])).toEqual([
      [1, "Rever avisos"],
      [2, "Cozinha — mapa de produção"],
      [3, "Etiquetas"],
      [4, "Rotas + câmara"],
      [5, "DPD — descarregar o CSV e carregá-lo no portal (como hoje)"],
    ]);
  });

  test("botões apontam para as resource routes reais de print/export", () => {
    const { checklist } = makeFixtureView();
    const [avisos, cozinha, etiquetas, rotas, dpd] = checklist;

    expect(avisos.botoes).toEqual([]);
    expect(cozinha.botoes.map((b) => b.href)).toEqual([
      "/app/print/cozinha",
      "/app/api/export/cozinha",
    ]);
    expect(etiquetas.botoes.map((b) => b.href)).toEqual([
      "/app/print/etiquetas",
      "/app/api/export/etiquetas",
    ]);
    expect(rotas.botoes.map((b) => [b.label, b.href])).toEqual([
      ["Imprimir rotas", "/app/print/rotas"],
      ["Exportar rotas", "/app/api/export/rotas"],
      ["Imprimir câmara", "/app/print/rotas-camara"],
      ["Exportar câmara", "/app/api/export/rotas-camara"],
    ]);
    expect(dpd.botoes.map((b) => b.href)).toEqual([CHECKLIST_HREFS.dpdCsv]);
    expect(CHECKLIST_HREFS.dpdCsv).toBe("/app/api/export/dpd");
  });

  test("passo 'Rever avisos' fica verde quando não há problemas", () => {
    const { checklist } = makeFixtureView(makeFixtureOrders().slice(0, 4));

    expect(checklist[0].badge).toEqual({
      tone: "success",
      label: "Sem avisos",
    });
  });

  test("passo 'Rever avisos' fica warning com a contagem quando há problemas", () => {
    const { checklist } = makeFixtureView();

    // #45005 sem atributos + #45006 com zona desconhecida.
    expect(checklist[0].badge).toEqual({
      tone: "warning",
      label: "2 avisos por rever",
    });
  });

  test("detalhes dos passos derivam do motor (cozinha, etiquetas, rotas, DPD)", () => {
    const { checklist } = makeFixtureView();
    const [, cozinha, etiquetas, rotas, dpd] = checklist;

    expect(cozinha.detalhe).toBe("2 dias · 8 refeições");
    expect(etiquetas.detalhe).toBe("8 etiquetas");
    // Off Limits 24/11 (2 paragens) + Interno 25/11 (1 paragem); DPD fora das rotas.
    expect(rotas.detalhe).toBe("2 rotas · 3 paragens");
    // 1 envio DPD com subtotal 40€ → 40/20 = 2 kg (peso sobre o SUBTOTAL,
    // confirmado pelo cliente a 20 jul 2026).
    expect(dpd.detalhe).toBe("1 envio · 2 kg");
  });

  test("sem rotas nem envios DPD os botões respetivos ficam desativados", () => {
    const { checklist } = buildSemanaView(makeWeekData([]), CONFIG);
    const [, , , rotas, dpd] = checklist;

    expect(rotas.botoes.map((b) => [b.label, b.disabled === true])).toEqual([
      ["Imprimir rotas", true],
      ["Exportar rotas", true],
      // As rotas de câmara imprimem-se mesmo sem rotas locais (padrão da
      // página Estafetas).
      ["Imprimir câmara", false],
      ["Exportar câmara", false],
    ]);
    expect(dpd.botoes[0].disabled).toBe(true);
  });

  test("com rotas e envios DPD todos os botões ficam ativos", () => {
    const { checklist } = makeFixtureView();

    const botoes = checklist.flatMap((p) => p.botoes);
    expect(botoes.every((b) => b.disabled !== true)).toBe(true);
  });
});

describe("buildSemanaView — imutabilidade", () => {
  test("não muta os inputs (weekData e config congelados)", () => {
    const { processed } = processOrders(makeFixtureOrders(), ZONES);
    const weekData = Object.freeze(
      makeWeekData(
        Object.freeze(processed.map((p) => Object.freeze(p))) as never,
      ),
    ) as WeekData;
    const config = Object.freeze({ ...CONFIG });

    expect(() => buildSemanaView(weekData, config)).not.toThrow();
  });
});

describe("helpers de apresentação", () => {
  test("formatDataHoraPt formata ISO como dd/mm hh:mm e devolve travessão para inválidos", () => {
    expect(formatDataHoraPt("2025-11-24T08:05:00Z")).toBe("24/11 08:05");
    expect(formatDataHoraPt("2025-01-03T23:59:59Z")).toBe("03/01 23:59");
    expect(formatDataHoraPt("")).toBe("—");
    expect(formatDataHoraPt("não-é-data")).toBe("—");
  });

  test("minutosDesde devolve minutos inteiros decorridos, nunca negativos", () => {
    const fetchedAt = "2025-11-22T09:00:00Z";
    const agora = Date.parse("2025-11-22T09:07:30Z");

    expect(minutosDesde(fetchedAt, agora)).toBe(7);
    expect(minutosDesde(fetchedAt, Date.parse(fetchedAt) - 60_000)).toBe(0);
    expect(minutosDesde("inválido", agora)).toBe(0);
  });
});
