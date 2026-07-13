/**
 * Testes do import manual de CSV:
 *  - parse (fixture csv-import-sample.csv + strings inline) — semântica igual
 *    à de scripts/generate-fixtures.py (forward-fill, agrupamento por Name,
 *    Note Attributes → customAttributes);
 *  - persistência (save/list/loadLatest/delete) contra uma BD SQLite REAL e
 *    descartável: cópia da prisma/dev.sqlite para test/tmp/csv-import.sqlite.
 */
import { readFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { OrderInput } from "../weekly/types";
import {
  CsvImportError,
  deleteImport,
  listImports,
  loadLatestImport,
  parseShopifyOrdersCsv,
  saveImport,
} from "./csv-import.server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..", "..", "..");
const SAMPLE_CSV = readFileSync(
  path.join(PROJECT_ROOT, "test", "fixtures", "csv-import-sample.csv"),
  "utf-8",
);

// ── Helpers para CSV inline (só as colunas relevantes; o parser é por nome) ──

const MINI_HEADER =
  "Name,Email,Financial Status,Subtotal,Total,Shipping Method,Created at," +
  "Lineitem quantity,Lineitem name,Lineitem price,Notes,Note Attributes,Tags," +
  "Billing Name,Shipping Name,Shipping Address1,Shipping Zip,Shipping City,Shipping Phone";

function miniCsv(...rows: string[]): string {
  return [MINI_HEADER, ...rows].join("\n");
}

const FULL_ROW =
  '#80001-LoV,a@example.com,paid,14.50,16.40,"10€ a 14,99€",2025-11-20 10:00:00 +0000,2,Prato Teste - Bulk,7.25,,"Order Type: Shipping\nDia de entrega: Segunda",moloni,Fulano Teste,Fulano Teste,Rua X 1,1000-001,Lisboa,910000009';

// ── Parse: fixture de 75 colunas ─────────────────────────────────────────────

describe("parseShopifyOrdersCsv — fixture csv-import-sample.csv", () => {
  test("agrupa por Name: 3 encomendas, 6 line items, sem warnings", () => {
    // Act
    const { orders, warnings } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert
    expect(orders.map((o) => o.name)).toEqual([
      "#90001-LoV",
      "#90002-LoV",
      "#90003-LoV",
    ]);
    expect(orders.reduce((sum, o) => sum + o.lineItems.length, 0)).toBe(6);
    expect(warnings).toEqual([]);
  });

  test("forward-fill: a 2ª linha (só Lineitem*) herda a encomenda da 1ª", () => {
    // Act
    const { orders } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert — encomenda 1 tem 2 line items e os dados da 1ª linha intactos
    const first = orders[0];
    expect(first.lineItems).toHaveLength(2);
    expect(first.lineItems[1]).toEqual({
      name: "Poke Bowl Salmão com molho teriyaki - M (com arroz)",
      quantity: 1,
      price: 9.65,
    });
    expect(first.email).toBe("teste1@example.com");
    expect(first.totalPrice).toBe(26.05);
  });

  test("encomenda multi-line-item (3 linhas) fica numa só encomenda", () => {
    // Act
    const { orders } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert
    const dpd = orders.find((o) => o.name === "#90003-LoV");
    expect(dpd?.lineItems.map((item) => item.name)).toEqual([
      "Jardineira de Novilho - Bulk",
      "Caril de Frango com arroz basmati - Low Carb",
      "Sopa de legumes da semana - Dose Única",
    ]);
    expect(dpd?.lineItems.map((item) => item.quantity)).toEqual([3, 2, 1]);
  });

  test("Note Attributes multi-linha → customAttributes[] com chave/valor", () => {
    // Act
    const { orders } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert — o bloco completo da encomenda 1 (regra 4.1 do ARCHITECTURE)
    expect(orders[0].customAttributes).toEqual([
      { key: "Order Type", value: "Shipping" },
      { key: "Data de entrega", value: "24/11/2025" },
      { key: "Horário de entrega", value: "Lisboa (Centro da cidade) 19-23h" },
      { key: "Dia de entrega", value: "Segunda" },
      { key: "Date Format", value: "dd/mm/yy" },
    ]);
    // valor com ":"-lookalike (morada com vírgulas) fica verbatim após a 1ª ":"
    const pickup = orders[1].customAttributes.find(
      (a) => a.key === "Endereço de Ponto de Recolha",
    );
    expect(pickup?.value).toBe("Rua da Loja Fictícia 3, Coimbra");
  });

  test("quantidades e preços são numéricos (ponto decimal do Shopify)", () => {
    // Act
    const { orders } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert
    const first = orders[0];
    expect(first.lineItems[0].quantity).toBe(2);
    expect(first.lineItems[0].price).toBe(7.25);
    expect(first.subtotalPrice).toBe(24.15);
    expect(typeof first.totalPrice).toBe("number");
  });

  test('"Created at" Shopify → ISO 8601 com offset', () => {
    // Act
    const { orders } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert — mesmo formato que o Python isoformat() das fixtures w47
    expect(orders[0].createdAt).toBe("2025-11-22T01:28:43+00:00");
    expect(orders[2].createdAt).toBe("2025-11-21T22:05:10+00:00");
  });

  test("morada de envio e restantes campos da 1ª linha mapeados", () => {
    // Act
    const { orders } = parseShopifyOrdersCsv(SAMPLE_CSV);

    // Assert
    expect(orders[0].shippingAddress).toEqual({
      name: "Cliente Teste Um",
      address1: "Rua Fictícia 1",
      zip: "1000-001",
      city: "Lisboa",
      phone: "910000001",
    });
    expect(orders[0].shippingLine).toBe("20€ a 24,99€");
    expect(orders[0].financialStatus).toBe("paid");
    expect(orders[0].tags).toBe("moloni");
    // Store Pickup sem colunas de shipping → sem morada, com nota verbatim
    expect(orders[1].shippingAddress).toBeUndefined();
    expect(orders[1].note).toBe(
      'Sem pepino, por favor. Embalagem "eco" se possível',
    );
  });
});

// ── Parse: casos-limite com strings inline ──────────────────────────────────

describe("parseShopifyOrdersCsv — casos-limite", () => {
  test("CSV sem as colunas mínimas → CsvImportError estruturado em pt-PT", () => {
    // Arrange — falta "Lineitem name" e "Lineitem quantity"
    const csv = "Name,Email\n#1-LoV,a@example.com";

    // Act + Assert
    let caught: unknown;
    try {
      parseShopifyOrdersCsv(csv);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CsvImportError);
    const error = caught as CsvImportError;
    expect(error.missingColumns).toEqual([
      "Lineitem name",
      "Lineitem quantity",
    ]);
    expect(error.message).toMatch(/export de encomendas do Shopify/);
    expect(error.message).toMatch(/"Lineitem name"/);
  });

  test("ficheiro vazio → CsvImportError com instrução de export", () => {
    expect(() => parseShopifyOrdersCsv("   \n  ")).toThrow(CsvImportError);
    expect(() => parseShopifyOrdersCsv("   \n  ")).toThrow(/vazio/);
  });

  test('linha sem "Name" a seguir a uma encomenda → forward-fill + warning', () => {
    // Arrange — 2ª linha sem Name mas com line item
    const csv = miniCsv(
      FULL_ROW,
      ",,,,,,,1,Prato Extra - Low Carb,6.10,,,,,,,,,",
    );

    // Act
    const { orders, warnings } = parseShopifyOrdersCsv(csv);

    // Assert
    expect(orders).toHaveLength(1);
    expect(orders[0].lineItems).toHaveLength(2);
    expect(orders[0].lineItems[1].name).toBe("Prato Extra - Low Carb");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/sem "Name"/);
    expect(warnings[0]).toMatch(/#80001-LoV/);
  });

  test('linha órfã (sem "Name" e sem encomenda anterior) → warning e ignorada', () => {
    // Arrange — a PRIMEIRA linha de dados já vem sem Name
    const csv = miniCsv(
      ",,,,,,,1,Prato Órfão - Bulk,7.00,,,,,,,,,",
      FULL_ROW,
    );

    // Act
    const { orders, warnings } = parseShopifyOrdersCsv(csv);

    // Assert
    expect(orders).toHaveLength(1);
    expect(orders[0].name).toBe("#80001-LoV");
    expect(orders[0].lineItems).toHaveLength(1);
    expect(warnings.some((w) => w.includes("órfã"))).toBe(true);
  });

  test("encomenda cuja 1ª linha não está completa → warning, não erro", () => {
    // Arrange — encomenda só com linhas de line item (sem Email/Created at)
    const csv = miniCsv("#80002-LoV,,,,,,,2,Prato Sozinho - Bulk,8.00,,,,,,,,,");

    // Act
    const { orders, warnings } = parseShopifyOrdersCsv(csv);

    // Assert
    expect(orders).toHaveLength(1);
    expect(orders[0].createdAt).toBe("");
    expect(orders[0].lineItems[0].quantity).toBe(2);
    expect(warnings.some((w) => w.match(/#80002-LoV.*dados completos/))).toBe(
      true,
    );
  });

  test("quantidade não numérica → warning e quantidade 0", () => {
    // Arrange
    const csv = miniCsv(
      '#80003-LoV,b@example.com,paid,5,5,,2025-11-20 11:00:00 +0000,muitas,Prato Estranho - Bulk,5.00,,"",,,,,,,',
    );

    // Act
    const { orders, warnings } = parseShopifyOrdersCsv(csv);

    // Assert
    expect(orders[0].lineItems[0].quantity).toBe(0);
    expect(warnings.some((w) => w.includes("quantidade inválida"))).toBe(true);
  });

  test("cabeçalho válido sem linhas de dados → 0 encomendas + warning", () => {
    // Act
    const { orders, warnings } = parseShopifyOrdersCsv(MINI_HEADER + "\n");

    // Assert
    expect(orders).toEqual([]);
    expect(warnings.some((w) => w.includes("nenhuma linha"))).toBe(true);
  });
});

// ── Persistência: BD SQLite real e descartável ──────────────────────────────

const SOURCE_DB = path.join(PROJECT_ROOT, "prisma", "dev.sqlite");
const TMP_DIR = path.join(PROJECT_ROOT, "test", "tmp");
const TEST_DB = path.join(TMP_DIR, "csv-import.sqlite");

let prisma: PrismaClient;

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true });
  await copyFile(SOURCE_DB, TEST_DB);
  prisma = new PrismaClient({
    datasources: { db: { url: `file:${TEST_DB.replace(/\\/g, "/")}` } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(TEST_DB, { force: true });
  await rm(`${TEST_DB}-journal`, { force: true });
});

beforeEach(async () => {
  await prisma.weekRun.deleteMany();
});

function sampleOrders(): OrderInput[] {
  return parseShopifyOrdersCsv(SAMPLE_CSV).orders;
}

/** Recua generatedAt para tornar a ordenação "mais recente" determinística. */
async function backdate(id: string, minutesAgo: number): Promise<void> {
  await prisma.weekRun.update({
    where: { id },
    data: { generatedAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
}

describe("saveImport + loadLatestImport", () => {
  test("round-trip: guarda e devolve as mesmas encomendas com source 'csv'", async () => {
    // Arrange
    const orders = sampleOrders();

    // Act
    const saved = await saveImport(prisma, orders, "w48_orders_export.csv");
    const loaded = await loadLatestImport(prisma);

    // Assert
    expect(saved.weekLabel).toMatch(
      /^import-\d{4}-\d{2}-\d{2} \d{2}:\d{2} — w48_orders_export\.csv$/,
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.source).toBe("csv");
    expect(loaded?.weekLabel).toBe(saved.weekLabel);
    expect(loaded?.orders).toEqual(orders);
    expect(loaded?.fetchedAt).toBe(saved.generatedAt.toISOString());
  });

  test("windowStart/End = min/max do createdAt das encomendas", async () => {
    // Arrange
    await saveImport(prisma, sampleOrders(), "semana.csv");

    // Act
    const loaded = await loadLatestImport(prisma);

    // Assert — mín é a encomenda DPD de dia 21, máx a de dia 22 às 09:15
    expect(loaded?.windowStart).toBe("2025-11-21T22:05:10+00:00");
    expect(loaded?.windowEnd).toBe("2025-11-22T09:15:00+00:00");
  });

  test("devolve o import MAIS RECENTE quando há vários", async () => {
    // Arrange
    const older = await saveImport(prisma, sampleOrders(), "antigo.csv");
    await backdate(older.id, 60);
    await saveImport(prisma, sampleOrders().slice(0, 1), "recente.csv");

    // Act
    const loaded = await loadLatestImport(prisma);

    // Assert
    expect(loaded?.weekLabel).toContain("recente.csv");
    expect(loaded?.orders).toHaveLength(1);
  });

  test("devolve null quando não há nenhum import", async () => {
    expect(await loadLatestImport(prisma)).toBeNull();
  });

  test("ignora WeekRun que não sejam imports manuais (sem prefixo import-)", async () => {
    // Arrange — snapshot de histórico de semana (fase 5), não é um import
    await prisma.weekRun.create({
      data: { weekLabel: "2025-W47", ordersJson: "[]" },
    });

    // Act + Assert
    expect(await loadLatestImport(prisma)).toBeNull();
    expect(await listImports(prisma)).toEqual([]);
  });
});

describe("listImports", () => {
  test("lista do mais recente para o mais antigo com contagem de encomendas", async () => {
    // Arrange
    const first = await saveImport(prisma, sampleOrders(), "primeiro.csv");
    await backdate(first.id, 120);
    const second = await saveImport(prisma, sampleOrders().slice(0, 2), "segundo.csv");
    await backdate(second.id, 60);
    await saveImport(prisma, sampleOrders().slice(0, 1), "terceiro.csv");

    // Act
    const imports = await listImports(prisma);

    // Assert
    expect(imports.map((entry) => entry.orderCount)).toEqual([1, 2, 3]);
    expect(imports[0].weekLabel).toContain("terceiro.csv");
    expect(imports[2].weekLabel).toContain("primeiro.csv");
    // generatedAt serializado como ISO (JSON-safe para o loader)
    expect(typeof imports[0].generatedAt).toBe("string");
  });

  test("respeita o limite pedido", async () => {
    // Arrange
    for (let index = 0; index < 4; index += 1) {
      const run = await saveImport(prisma, [], `ficheiro-${index}.csv`);
      await backdate(run.id, (4 - index) * 10);
    }

    // Act + Assert
    expect(await listImports(prisma, 2)).toHaveLength(2);
    expect(await listImports(prisma)).toHaveLength(4);
  });
});

describe("deleteImport", () => {
  test("elimina o import e o loadLatestImport recua para o anterior", async () => {
    // Arrange
    const older = await saveImport(prisma, sampleOrders(), "antigo.csv");
    await backdate(older.id, 60);
    const newer = await saveImport(prisma, sampleOrders().slice(0, 1), "novo.csv");

    // Act
    const deleted = await deleteImport(prisma, newer.id);

    // Assert
    expect(deleted).toBe(true);
    const loaded = await loadLatestImport(prisma);
    expect(loaded?.weekLabel).toContain("antigo.csv");
  });

  test("devolve false para id inexistente e não toca noutros WeekRun", async () => {
    // Arrange — um WeekRun de histórico que NUNCA deve ser apagável daqui
    const snapshot = await prisma.weekRun.create({
      data: { weekLabel: "2025-W47", ordersJson: "[]" },
    });

    // Act + Assert
    expect(await deleteImport(prisma, "import-fantasma")).toBe(false);
    expect(await deleteImport(prisma, snapshot.id)).toBe(false);
    expect(await prisma.weekRun.count()).toBe(1);
  });
});
