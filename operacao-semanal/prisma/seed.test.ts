/**
 * Testes do seed (prisma/seed.ts) contra uma BD SQLite REAL descartável:
 * copia prisma/dev.sqlite (já migrada) para test/tmp/seed.sqlite, limpa as
 * tabelas tocadas pelo seed e corre `seed(prisma)` sobre a cópia.
 * A dev.sqlite nunca é usada diretamente.
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COURIERS_W47, ZONES_W47 } from "../test/fixtures/zones-w47";
import { inferCategory, seed } from "./seed";
import type { SeedSummary } from "./seed";

const PRISMA_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DB = path.join(PRISMA_DIR, "dev.sqlite");
const TMP_DIR = path.join(PRISMA_DIR, "..", "test", "tmp");
const TEST_DB = path.join(TMP_DIR, "seed.sqlite");

// Contagens EXATAS derivadas de test/fixtures/w47-orders.json (185 orders):
// 19 pratos distintos (baseName) e 49 doses distintas (dishId+label).
const EXPECTED_DISHES = 19;
const EXPECTED_DOSES = 49;
// Tabela de componentes do cliente (20 jul 2026): 8 doses × 3 componentes.
const EXPECTED_COMPONENT_FACTORS = 24;

let prisma: PrismaClient;
let firstRun: SeedSummary;

beforeAll(async () => {
  mkdirSync(TMP_DIR, { recursive: true });
  copyFileSync(SOURCE_DB, TEST_DB);

  prisma = new PrismaClient({
    datasources: { db: { url: `file:${TEST_DB.replace(/\\/g, "/")}` } },
  });

  // Ponto de partida limpo e determinista nas tabelas tocadas pelo seed
  // (ordem respeita as FKs: RecipeLine → Dose → Dish; Zone → Courier).
  await prisma.recipeLine.deleteMany();
  await prisma.dose.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.courier.deleteMany();
  await prisma.appConfig.deleteMany();
  await prisma.componentFactor.deleteMany();

  firstRun = await seed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB, { force: true });
  rmSync(`${TEST_DB}-journal`, { force: true });
});

describe("seed — contagens exatas da w47", () => {
  it("cria exatamente as zonas e couriers dos fixtures", async () => {
    // Arrange — seed corrido no beforeAll sobre BD limpa.
    // Act
    const [zones, couriers] = await Promise.all([
      prisma.zone.count(),
      prisma.courier.count(),
    ]);

    // Assert
    expect(zones).toBe(ZONES_W47.length);
    expect(couriers).toBe(COURIERS_W47.length);
  });

  it("cria exatamente 19 pratos e 49 doses a partir das orders da w47", async () => {
    // Act
    const [dishes, doses] = await Promise.all([
      prisma.dish.count(),
      prisma.dose.count(),
    ]);
    console.log(`seed w47: ${dishes} pratos, ${doses} doses`);

    // Assert — números fixados a partir do fixture real.
    expect(dishes).toBe(EXPECTED_DISHES);
    expect(doses).toBe(EXPECTED_DOSES);
    expect(dishes).toBeGreaterThan(0);
    expect(doses).toBeGreaterThan(0);
  });

  it("liga cada zona ao courier certo (ex.: Portugal Continental → DPD)", async () => {
    // Act
    const zone = await prisma.zone.findUnique({
      where: { matchText: "Portugal Continental 08-15h" },
      include: { courier: true },
    });

    // Assert
    expect(zone?.confDay).toBe("vespera");
    expect(zone?.courier?.name).toBe("DPD");
    expect(zone?.courier?.type).toBe("dpd");
  });

  it("cria o AppConfig singleton com defaults do schema e conta DPD", async () => {
    // Act
    const config = await prisma.appConfig.findUnique({
      where: { id: "singleton" },
    });

    // Assert
    expect(config).not.toBeNull();
    expect(config?.dpdAccount).toBe("03290201");
    expect(config?.orderWindowFrom).toBe("SAT_00:00");
    expect(config?.orderWindowTo).toBe("FRI_23:59");
    expect(config?.ignoreAfterClose).toBe(true);
    expect(config?.purchaseMargin).toBeCloseTo(0.08);
  });
});

describe("seed — idempotência", () => {
  it("segunda execução não duplica nada", async () => {
    // Arrange — primeira execução feita no beforeAll (firstRun).
    // Act
    const secondRun = await seed(prisma);
    const configCount = await prisma.appConfig.count();

    // Assert — contagens idênticas à primeira execução.
    expect(secondRun).toEqual(firstRun);
    expect(secondRun.zones).toBe(ZONES_W47.length);
    expect(secondRun.couriers).toBe(COURIERS_W47.length);
    expect(secondRun.dishes).toBe(EXPECTED_DISHES);
    expect(secondRun.doses).toBe(EXPECTED_DOSES);
    expect(secondRun.componentFactors).toBe(EXPECTED_COMPONENT_FACTORS);
    expect(configCount).toBe(1);
  });
});

describe("seed — fatores de componentes", () => {
  it("cria exatamente 24 fatores (8 doses × 3 componentes)", async () => {
    // Act
    const count = await prisma.componentFactor.count();

    // Assert
    expect(count).toBe(EXPECTED_COMPONENT_FACTORS);
    expect(firstRun.componentFactors).toBe(EXPECTED_COMPONENT_FACTORS);
  });

  it("Zero Carbs tem Hidratos = 0 de propósito (fator explícito, não em falta)", async () => {
    // Act
    const factor = await prisma.componentFactor.findUnique({
      where: { dose_component: { dose: "Zero Carbs", component: "Hidratos" } },
    });

    // Assert
    expect(factor).not.toBeNull();
    expect(factor?.kgPerMeal).toBe(0);
  });

  it("não sobrepõe valores editados pelo operador (upsert só-inserir)", async () => {
    // Arrange — o operador ajusta um fator na BD
    const edited = await prisma.componentFactor.update({
      where: { dose_component: { dose: "Bulk", component: "Proteína" } },
      data: { kgPerMeal: 0.999 },
    });
    expect(edited.kgPerMeal).toBe(0.999);

    // Act — novo seed por cima
    await seed(prisma);
    const after = await prisma.componentFactor.findUnique({
      where: { dose_component: { dose: "Bulk", component: "Proteína" } },
    });

    // Assert — o valor editado sobrevive ao re-seed
    expect(after?.kgPerMeal).toBe(0.999);
  });
});

describe("seed — itens não-refeição ficam fora dos pratos", () => {
  it.each(["Embalagen", "Subscri", "Tip", "Voucher"])(
    'nenhum prato contém "%s"',
    async (fragment) => {
      // Act
      const dish = await prisma.dish.findFirst({
        where: { baseName: { contains: fragment } },
      });

      // Assert
      expect(dish).toBeNull();
    },
  );
});

describe("seed — categorias inferidas", () => {
  it.each([
    ["Tranche de Salmão com amêndoa e sweet chili", "peixe"],
    ["Poke Bowl Salmão com molho teriyaki", "poke"],
    ["Pizza de Fiambre de Perú", "pizza"],
    ["Creme de Cenoura e Abóbora guarnecida com espinafres", "sopa"],
    ["Feijoada de Choco e Legumes", "peixe"],
    ["Crepes de Legumes com molho asiático", "vegetariano"],
    ["Bolo de Cenoura e Aveia com topping de iogurte natural", "sobremesa"],
  ])('o prato "%s" fica na categoria "%s"', async (baseName, category) => {
    // Act
    const dish = await prisma.dish.findUnique({ where: { baseName } });

    // Assert
    expect(dish?.category).toBe(category);
  });
});

describe("inferCategory — heurística pura", () => {
  it('não confunde "chocolate" com o peixe "choco"', () => {
    // Arrange / Act / Assert — "chocolate" nunca pode cair em peixe.
    expect(inferCategory("Mousse de chocolate")).not.toBe("peixe");
    expect(inferCategory("Bolo de chocolate")).toBe("sobremesa");
    expect(inferCategory("Choco frito à Setubalense")).toBe("peixe");
  });

  it("devolve 'outro' quando nenhuma palavra-chave bate", () => {
    expect(inferCategory("Prato misterioso da casa")).toBe("outro");
  });
});
