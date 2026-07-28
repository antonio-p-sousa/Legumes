/**
 * Testes do histórico de semanas — funções puras sobre uma BD SQLite REAL e
 * descartável: cópia de prisma/dev.sqlite para test/tmp/historico.sqlite
 * (mesmo padrão de csv-import.server.test.ts). Cada teste começa com a tabela
 * WeekRun limpa (beforeEach) para isolamento.
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { OrderInput } from "../weekly";
import {
  countMeals,
  deleteWeekRun,
  getWeekRun,
  listWeekRuns,
  SEM_DIA,
  summarizeByDay,
} from "./historico.server";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..", "..", "..");
const SOURCE_DB = path.join(PROJECT_ROOT, "prisma", "dev.sqlite");
const TMP_DIR = path.join(PROJECT_ROOT, "test", "tmp");
const TEST_DB = path.join(TMP_DIR, "historico.sqlite");

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

// ── Helpers de fixture ───────────────────────────────────────────────────────

type LineItemSpec = { name: string; quantity: number };

function makeOrder(
  name: string,
  lineItems: LineItemSpec[],
  dia?: string,
): OrderInput {
  return {
    name,
    email: `${name}@example.com`,
    createdAt: "2025-11-20T10:00:00+00:00",
    customAttributes: dia
      ? [
          { key: "Order Type", value: "Shipping" },
          { key: "Data de entrega", value: "24/11/2025" },
          { key: "Horário de entrega", value: "Lisboa (Centro) 19-23h" },
          { key: "Dia de entrega", value: dia },
        ]
      : [],
    subtotalPrice: 0,
    totalPrice: 0,
    lineItems: lineItems.map((item) => ({ ...item, price: 0 })),
  };
}

/** Cria um WeekRun com ordersJson pré-serializado e devolve o id. */
async function createRun(weekLabel: string, orders: OrderInput[]): Promise<string> {
  const run = await prisma.weekRun.create({
    data: { weekLabel, ordersJson: JSON.stringify(orders) },
  });
  return run.id;
}

/** Recua generatedAt para tornar a ordenação determinística. */
async function backdate(id: string, minutesAgo: number): Promise<void> {
  await prisma.weekRun.update({
    where: { id },
    data: { generatedAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
}

// ── listWeekRuns ─────────────────────────────────────────────────────────────

describe("listWeekRuns", () => {
  test("conta encomendas e soma refeições, ignorando itens não-refeição", async () => {
    // Arrange — 2 encomendas: 3 refeições no total; embalagens não contam
    await createRun("2025-W47", [
      makeOrder("#1", [
        { name: "Salmão - Bulk", quantity: 2 },
        { name: "Embalagens Reutilizáveis", quantity: 5 },
      ]),
      makeOrder("#2", [{ name: "Frango - Low Carb", quantity: 1 }]),
    ]);

    // Act
    const [summary] = await listWeekRuns(prisma);

    // Assert
    expect(summary.nEncomendas).toBe(2);
    expect(summary.nRefeicoes).toBe(3);
  });

  test("ordersJson corrompido → 0 encomendas e 0 refeições", async () => {
    // Arrange — JSON inválido e JSON válido mas não-array
    await prisma.weekRun.create({
      data: { weekLabel: "corrompido", ordersJson: "{ nao e json valido" },
    });

    // Act
    const [summary] = await listWeekRuns(prisma);

    // Assert
    expect(summary.weekLabel).toBe("corrompido");
    expect(summary.nEncomendas).toBe(0);
    expect(summary.nRefeicoes).toBe(0);
  });

  test("ordena por generatedAt descendente (mais recente primeiro)", async () => {
    // Arrange
    const antigo = await createRun("antigo", []);
    await backdate(antigo, 120);
    const medio = await createRun("medio", []);
    await backdate(medio, 60);
    await createRun("recente", []);

    // Act
    const runs = await listWeekRuns(prisma);

    // Assert
    expect(runs.map((run) => run.weekLabel)).toEqual([
      "recente",
      "medio",
      "antigo",
    ]);
    // generatedAt serializado como ISO (JSON-safe para o loader)
    expect(typeof runs[0].generatedAt).toBe("string");
  });

  test("respeita o limite pedido", async () => {
    // Arrange
    for (let index = 0; index < 4; index += 1) {
      const id = await createRun(`run-${index}`, []);
      await backdate(id, (4 - index) * 10);
    }

    // Act + Assert
    expect(await listWeekRuns(prisma, 2)).toHaveLength(2);
    expect(await listWeekRuns(prisma)).toHaveLength(4);
  });
});

// ── getWeekRun ───────────────────────────────────────────────────────────────

describe("getWeekRun", () => {
  test("devolve o snapshot completo (orders) de um id existente", async () => {
    // Arrange
    const orders = [makeOrder("#10", [{ name: "Poke - M arroz", quantity: 1 }])];
    const id = await createRun("2025-W48", orders);

    // Act
    const snapshot = await getWeekRun(prisma, id);

    // Assert
    expect(snapshot?.weekLabel).toBe("2025-W48");
    expect(snapshot?.orders).toEqual(orders);
    expect(typeof snapshot?.generatedAt).toBe("string");
  });

  test("devolve undefined para id inexistente", async () => {
    // Act + Assert
    expect(await getWeekRun(prisma, "id-que-nao-existe")).toBeUndefined();
  });

  test("ordersJson corrompido → devolve o objeto com orders = []", async () => {
    // Arrange
    const run = await prisma.weekRun.create({
      data: { weekLabel: "estragado", ordersJson: "[[[" },
    });

    // Act
    const snapshot = await getWeekRun(prisma, run.id);

    // Assert
    expect(snapshot).toBeDefined();
    expect(snapshot?.orders).toEqual([]);
  });
});

// ── deleteWeekRun ────────────────────────────────────────────────────────────

describe("deleteWeekRun", () => {
  test("elimina qualquer WeekRun (mesmo sem prefixo import-) e devolve true", async () => {
    // Arrange — um snapshot de fecho de semana, sem prefixo "import-"
    const id = await createRun("2025-W47", []);

    // Act
    const deleted = await deleteWeekRun(prisma, id);

    // Assert
    expect(deleted).toBe(true);
    expect(await prisma.weekRun.count()).toBe(0);
  });

  test("devolve false para id inexistente", async () => {
    expect(await deleteWeekRun(prisma, "fantasma")).toBe(false);
  });
});

// ── countMeals + summarizeByDay (puras, sem BD) ──────────────────────────────

describe("countMeals", () => {
  test("soma quantidades das refeições e ignora subscrições/embalagens/vouchers", () => {
    // Arrange
    const orders = [
      makeOrder("#1", [
        { name: "Bacalhau - Bulk", quantity: 3 },
        { name: "Subscrição Semanal", quantity: 1 },
        { name: "Voucher Presente", quantity: 2 },
      ]),
    ];

    // Act + Assert — só as 3 refeições contam
    expect(countMeals(orders)).toBe(3);
  });
});

describe("summarizeByDay", () => {
  test("agrupa por dia, ordena pela semana e junta sem-dia no fim", () => {
    // Arrange
    const orders = [
      makeOrder("#a", [{ name: "Prato - Bulk", quantity: 2 }], "Sexta"),
      makeOrder("#b", [{ name: "Prato - Bulk", quantity: 1 }], "Segunda"),
      makeOrder("#c", [{ name: "Prato - Bulk", quantity: 1 }], "Segunda"),
      makeOrder("#d", [{ name: "Prato - Bulk", quantity: 4 }]),
    ];

    // Act
    const dias = summarizeByDay(orders);

    // Assert — Segunda antes de Sexta; "Sem dia" no fim
    expect(dias.map((dia) => dia.dia)).toEqual(["Segunda", "Sexta", SEM_DIA]);
    expect(dias[0]).toEqual({ dia: "Segunda", nEncomendas: 2, nRefeicoes: 2 });
    expect(dias[1]).toEqual({ dia: "Sexta", nEncomendas: 1, nRefeicoes: 2 });
    expect(dias[2]).toEqual({ dia: SEM_DIA, nEncomendas: 1, nRefeicoes: 4 });
  });
});
