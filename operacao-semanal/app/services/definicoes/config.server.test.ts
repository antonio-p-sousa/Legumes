import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  CONFIG_ID,
  getConfig,
  joinWindowPoint,
  splitWindowPoint,
  updateConfig,
  type UpdateConfigInput,
} from "./config.server";

// BD SQLite real e descartável: cópia da dev.sqlite (já migrada) para
// test/tmp — nunca tocamos na dev.sqlite diretamente.
const ROOT = process.cwd();
const SOURCE_DB = path.resolve(ROOT, "prisma", "dev.sqlite");
const TMP_DIR = path.resolve(ROOT, "test", "tmp");
const TEST_DB = path.resolve(TMP_DIR, "config.sqlite");

let db: PrismaClient;

const VALID_INPUT: UpdateConfigInput = {
  orderWindowFrom: "SAT_00:00",
  orderWindowTo: "FRI_23:59",
  ignoreAfterClose: true,
  purchaseMargin: 0.08,
  dpdAccount: null,
};

beforeAll(async () => {
  mkdirSync(TMP_DIR, { recursive: true });
  copyFileSync(SOURCE_DB, TEST_DB);
  db = new PrismaClient({
    datasources: { db: { url: `file:${TEST_DB.replace(/\\/g, "/")}` } },
  });
  // Garante ponto de partida limpo, independente do conteúdo da dev.sqlite.
  await db.appConfig.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(TEST_DB, { force: true });
});

describe("getConfig", () => {
  test("cria o singleton com os defaults do schema quando não existe", async () => {
    // Arrange — BD sem AppConfig (beforeAll fez deleteMany)

    // Act
    const config = await getConfig(db);

    // Assert
    expect(config).toMatchObject({
      id: CONFIG_ID,
      orderWindowFrom: "SAT_00:00",
      orderWindowTo: "FRI_23:59",
      ignoreAfterClose: true,
      purchaseMargin: 0.08,
      dpdAccount: null,
    });
  });

  test("é idempotente — segunda chamada devolve o mesmo registo sem duplicar", async () => {
    // Arrange
    const primeira = await getConfig(db);

    // Act
    const segunda = await getConfig(db);
    const total = await db.appConfig.count();

    // Assert
    expect(total).toBe(1);
    expect(segunda).toEqual(primeira);
  });
});

describe("updateConfig", () => {
  test("persiste alterações válidas na BD", async () => {
    // Arrange
    const input: UpdateConfigInput = {
      orderWindowFrom: "SUN_08:30",
      orderWindowTo: "THU_20:00",
      ignoreAfterClose: false,
      purchaseMargin: 0.12,
      dpdAccount: "03290201",
    };

    // Act
    const result = await updateConfig(db, input);
    const persisted = await db.appConfig.findUnique({
      where: { id: CONFIG_ID },
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(persisted).toMatchObject(input);
  });

  test("rejeita margem fora de [0, 1] sem tocar na BD", async () => {
    // Arrange
    const antes = await db.appConfig.findUnique({ where: { id: CONFIG_ID } });

    // Act
    const acima = await updateConfig(db, { ...VALID_INPUT, purchaseMargin: 1.5 });
    const abaixo = await updateConfig(db, {
      ...VALID_INPUT,
      purchaseMargin: -0.1,
    });
    const depois = await db.appConfig.findUnique({ where: { id: CONFIG_ID } });

    // Assert
    expect(acima).toMatchObject({
      ok: false,
      errors: { purchaseMargin: expect.stringContaining("entre 0% e 100%") },
    });
    expect(abaixo.ok).toBe(false);
    expect(depois).toEqual(antes);
  });

  test("rejeita margem não numérica (NaN)", async () => {
    // Act
    const result = await updateConfig(db, {
      ...VALID_INPUT,
      purchaseMargin: Number.NaN,
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.purchaseMargin).toBeDefined();
    }
  });

  test('rejeita hora de janela inválida ("SAT_25:00")', async () => {
    // Act
    const result = await updateConfig(db, {
      ...VALID_INPUT,
      orderWindowFrom: "SAT_25:00",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.orderWindowFrom).toContain("HH:MM");
      expect(result.errors.orderWindowTo).toBeUndefined();
    }
  });

  test('rejeita dia de janela inválido ("XXX_10:00")', async () => {
    // Act
    const result = await updateConfig(db, {
      ...VALID_INPUT,
      orderWindowTo: "XXX_10:00",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.orderWindowTo).toBeDefined();
      expect(result.errors.orderWindowFrom).toBeUndefined();
    }
  });

  test("rejeita conta DPD não numérica ou fora de 6–10 dígitos", async () => {
    // Act
    const letras = await updateConfig(db, {
      ...VALID_INPUT,
      dpdAccount: "ABC123",
    });
    const curta = await updateConfig(db, { ...VALID_INPUT, dpdAccount: "12345" });
    const longa = await updateConfig(db, {
      ...VALID_INPUT,
      dpdAccount: "12345678901",
    });

    // Assert
    for (const result of [letras, curta, longa]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.dpdAccount).toContain("6 a 10");
      }
    }
  });

  test("normaliza conta DPD vazia ou em branco para null", async () => {
    // Act
    const result = await updateConfig(db, { ...VALID_INPUT, dpdAccount: "   " });
    const persisted = await db.appConfig.findUnique({
      where: { id: CONFIG_ID },
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(persisted?.dpdAccount).toBeNull();
  });

  test("acumula erros de vários campos numa só resposta", async () => {
    // Act
    const result = await updateConfig(db, {
      orderWindowFrom: "SAT_99:99",
      orderWindowTo: "",
      ignoreAfterClose: true,
      purchaseMargin: 2,
      dpdAccount: "abc",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "dpdAccount",
        "orderWindowFrom",
        "orderWindowTo",
        "purchaseMargin",
      ]);
    }
  });
});

describe("splitWindowPoint / joinWindowPoint", () => {
  test("faz round-trip do valor guardado na BD", () => {
    // Arrange
    const stored = "FRI_23:59";

    // Act
    const { day, time } = splitWindowPoint(stored);

    // Assert
    expect(day).toBe("FRI");
    expect(time).toBe("23:59");
    expect(joinWindowPoint(day, time)).toBe(stored);
  });

  test("cai nos defaults do schema quando o valor está malformado", () => {
    // Act + Assert
    expect(splitWindowPoint("lixo")).toEqual({ day: "SAT", time: "00:00" });
    expect(splitWindowPoint("")).toEqual({ day: "SAT", time: "00:00" });
  });
});
