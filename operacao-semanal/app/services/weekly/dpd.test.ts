import { describe, expect, test } from "vitest";
import { buildDpdCsv } from "./dpd";
import type {
  CourierConfig,
  OrderInput,
  ParsedDelivery,
  ProcessedOrder,
  ZoneConfig,
} from "./types";

const COURIERS: CourierConfig[] = [
  { name: "Interno", type: "internal", ordering: "manual" },
  { name: "DPD", type: "dpd", ordering: "manual" },
];

const CONFIG = { account: "LEGUMES01" };

// Índices das 17 colunas do Template_DPD (regra 4.6)
const COL = {
  conta: 0,
  nrClienteDest: 1,
  nome: 2,
  morada: 3,
  codigoPostal: 4,
  localidade: 5,
  pais: 6,
  telefoneFixo: 7,
  telemovel: 8,
  email: 9,
  contactoDestino: 10,
  peso: 11,
  volumes: 12,
  cobranca: 13,
  referencia: 14,
  observacoes: 15,
  codigoAT: 16,
} as const;

function makeDpdZone(overrides: Partial<ZoneConfig> = {}): ZoneConfig {
  return {
    matchText: "Portugal Continental 08-15h",
    county: "Nacional",
    confDay: "vespera",
    courierName: "DPD",
    active: true,
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<ParsedDelivery> = {}): ParsedDelivery {
  return {
    orderType: "Shipping",
    deliveryDate: "2025-11-26",
    zona: "Portugal Continental 08-15h",
    dia: "Quarta",
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderInput> = {}): OrderInput {
  return {
    name: "#45003-LoV",
    email: "cliente@example.com",
    createdAt: "2025-11-19T10:00:00Z",
    customAttributes: [],
    shippingAddress: {
      name: "Maria Silva",
      address1: "Rua das Flores 1, 2º Esq",
      zip: "4700-123",
      city: "Braga",
      phone: "+351 912 345 678",
    },
    subtotalPrice: 60,
    totalPrice: 64.45,
    lineItems: [],
    ...overrides,
  };
}

function makeProcessed(
  overrides: Partial<ProcessedOrder> = {},
): ProcessedOrder {
  return {
    order: makeOrder(),
    delivery: makeDelivery(),
    zone: makeDpdZone(),
    confDay: "3f",
    issues: [],
    ...overrides,
  };
}

function firstLineFields(csv: string): string[] {
  return csv.split("\r\n")[0].split(";");
}

describe("buildDpdCsv", () => {
  test("remove o prefixo +351 e todos os espaços do telemóvel", () => {
    const result = buildDpdCsv([makeProcessed()], COURIERS, CONFIG);

    expect(firstLineFields(result.csv)[COL.telemovel]).toBe("912345678");
  });

  test("remove hífenes do telemóvel sem indicativo", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({
          shippingAddress: {
            name: "Rui",
            address1: "Rua A",
            zip: "1000-001",
            city: "Lisboa",
            phone: "912-345-678",
          },
        }),
      }),
    ];

    const result = buildDpdCsv(orders, COURIERS, CONFIG);

    expect(firstLineFields(result.csv)[COL.telemovel]).toBe("912345678");
  });

  test("limpa ';' das observações e restantes campos de texto", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({ note: "Deixar na portaria; tocar à campainha" }),
      }),
    ];

    const result = buildDpdCsv(orders, COURIERS, CONFIG);

    const fields = firstLineFields(result.csv);
    expect(fields[COL.observacoes]).toBe(
      "Deixar na portaria tocar à campainha",
    );
    expect(fields).toHaveLength(17);
  });

  test("preserva o código postal tal e qual, com zero à esquerda", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({
          shippingAddress: {
            name: "Ana",
            address1: "Rua B",
            zip: "0435-123",
            city: "Vila",
            phone: "913333333",
          },
        }),
      }),
    ];

    const result = buildDpdCsv(orders, COURIERS, CONFIG);

    expect(firstLineFields(result.csv)[COL.codigoPostal]).toBe("0435-123");
  });

  test("volumes nos limiares do SUBTOTAL: 79.99→1, 80→2, 159.99→2, 160→3", () => {
    // totalPrice deliberadamente diferente (subtotal + portes) para provar
    // que a base é o subtotal — fórmula confirmada pelo cliente (20 jul):
    // =SE(Subtotal<80;1;(SE(Subtotal<160;2;3)))
    const at = (subtotalPrice: number) =>
      makeProcessed({
        order: makeOrder({ subtotalPrice, totalPrice: subtotalPrice + 4.9 }),
      });

    const result = buildDpdCsv(
      [at(79.99), at(80), at(159.99), at(160)],
      COURIERS,
      CONFIG,
    );

    const volumes = result.csv
      .split("\r\n")
      .map((line) => line.split(";")[COL.volumes]);
    expect(volumes).toEqual(["1", "2", "2", "3"]);
    expect(result.totalVolumes).toBe(1 + 2 + 2 + 3);
  });

  test("peso = subtotal/20 com vírgula decimal e sem zeros à direita", () => {
    const at = (subtotalPrice: number) =>
      makeProcessed({
        order: makeOrder({ subtotalPrice, totalPrice: subtotalPrice + 4.9 }),
      });

    const result = buildDpdCsv([at(64.45), at(40), at(50)], COURIERS, CONFIG);

    const pesos = result.csv
      .split("\r\n")
      .map((line) => line.split(";")[COL.peso]);
    expect(pesos).toEqual(["3,2225", "2", "2,5"]);
  });

  test("cada linha tem exatamente 17 campos", () => {
    const orders = [
      makeProcessed(),
      makeProcessed({
        order: makeOrder({ name: "#45004-LoV", note: "Obs; com separador" }),
      }),
    ];

    const result = buildDpdCsv(orders, COURIERS, CONFIG);

    for (const line of result.csv.split("\r\n")) {
      expect(line.split(";")).toHaveLength(17);
    }
  });

  test("não tem cabeçalho — a primeira linha é já um envio", () => {
    const result = buildDpdCsv([makeProcessed()], COURIERS, CONFIG);

    const fields = firstLineFields(result.csv);
    expect(fields[COL.conta]).toBe("LEGUMES01");
    expect(fields[COL.referencia]).toBe("#45003-LoV");
  });

  test("linhas unidas com \\r\\n, sem newline final", () => {
    const orders = [
      makeProcessed(),
      makeProcessed({ order: makeOrder({ name: "#45004-LoV" }) }),
    ];

    const result = buildDpdCsv(orders, COURIERS, CONFIG);

    expect(result.csv.split("\r\n")).toHaveLength(2);
    expect(result.csv.endsWith("\r\n")).toBe(false);
    expect(result.csv).not.toMatch(/(?<!\r)\n/);
  });

  test("preenche campos fixos e espelha nome no contacto de destino", () => {
    const result = buildDpdCsv([makeProcessed()], COURIERS, CONFIG);

    const fields = firstLineFields(result.csv);
    expect(fields[COL.nome]).toBe("Maria Silva");
    expect(fields[COL.contactoDestino]).toBe("Maria Silva");
    expect(fields[COL.morada]).toBe("Rua das Flores 1, 2º Esq");
    expect(fields[COL.localidade]).toBe("Braga");
    expect(fields[COL.pais]).toBe("PT");
    expect(fields[COL.email]).toBe("cliente@example.com");
    expect(fields[COL.nrClienteDest]).toBe("");
    expect(fields[COL.telefoneFixo]).toBe("");
    expect(fields[COL.cobranca]).toBe("");
    expect(fields[COL.codigoAT]).toBe("");
  });

  test("observações vazias quando a encomenda não tem nota", () => {
    const result = buildDpdCsv(
      [makeProcessed({ order: makeOrder({ note: undefined }) })],
      COURIERS,
      CONFIG,
    );

    expect(firstLineFields(result.csv)[COL.observacoes]).toBe("");
  });

  test("encomenda de courier não-DPD não entra no CSV", () => {
    const local = makeProcessed({
      order: makeOrder({ name: "#LOCAL-1" }),
      zone: makeDpdZone({
        matchText: "Coimbra (Centro) 18-22h",
        courierName: "Interno",
        confDay: "2f",
      }),
    });

    const result = buildDpdCsv([local, makeProcessed()], COURIERS, CONFIG);

    expect(result.shipments).toBe(1);
    expect(result.csv).not.toContain("#LOCAL-1");
  });

  test("devolve resultado vazio quando não há envios DPD", () => {
    const result = buildDpdCsv([], COURIERS, CONFIG);

    expect(result).toEqual({
      csv: "",
      shipments: 0,
      totalWeightKg: 0,
      totalVolumes: 0,
      issues: [],
    });
  });

  test("sinaliza envio sem telefone e sem morada mas inclui a linha", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({ name: "#45009-LoV", shippingAddress: undefined }),
      }),
    ];

    const result = buildDpdCsv(orders, COURIERS, CONFIG);

    expect(result.shipments).toBe(1);
    expect(result.issues).toContain("#45009-LoV: envio sem telefone");
    expect(result.issues).toContain("#45009-LoV: envio sem morada");
    expect(firstLineFields(result.csv)).toHaveLength(17);
  });

  test("agrega totais: shipments, peso a 2 casas e volumes", () => {
    const at = (name: string, subtotalPrice: number) =>
      makeProcessed({
        order: makeOrder({ name, subtotalPrice, totalPrice: subtotalPrice + 4.9 }),
      });

    const result = buildDpdCsv(
      [at("#1", 64.45), at("#2", 40)],
      COURIERS,
      CONFIG,
    );

    expect(result.shipments).toBe(2);
    expect(result.totalWeightKg).toBe(5.22); // 3.2225 + 2 = 5.2225 → 5.22
    expect(result.totalVolumes).toBe(2);
  });

  test("nome de envio vazio cai para o nome de faturação (cliente, 20 jul)", () => {
    const order = makeOrder({});
    order.shippingAddress = { ...order.shippingAddress!, name: "" };
    order.billingName = "Cliente Faturação";

    const result = buildDpdCsv([makeProcessed({ order })], COURIERS, CONFIG);

    const fields = result.csv.split(";");
    expect(fields[2]).toBe("Cliente Faturação"); // nome
    expect(fields[10]).toBe("Cliente Faturação"); // contacto no destino
  });

  test("não muta os inputs", () => {
    const orders = [
      makeProcessed({
        order: makeOrder({ note: "Nota; original" }),
      }),
    ];
    const couriers = COURIERS.map((c) => ({ ...c }));
    const ordersSnapshot = structuredClone(orders);
    const couriersSnapshot = structuredClone(couriers);
    const config = { ...CONFIG };

    buildDpdCsv(orders, couriers, config);

    expect(orders).toEqual(ordersSnapshot);
    expect(couriers).toEqual(couriersSnapshot);
    expect(config).toEqual(CONFIG);
  });
});
