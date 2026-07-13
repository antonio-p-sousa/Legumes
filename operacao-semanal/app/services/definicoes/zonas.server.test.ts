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
import {
  createZone,
  deleteZone,
  listZones,
  toggleZoneActive,
  updateZone,
} from "./zonas.server";

/**
 * Testes de integração do serviço de zonas contra uma BD SQLite REAL e
 * descartável: cópia da prisma/dev.sqlite (já migrada) para
 * test/tmp/zonas.sqlite. A dev.sqlite nunca é usada diretamente.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..", "..", "..");
const SOURCE_DB = path.join(PROJECT_ROOT, "prisma", "dev.sqlite");
const TMP_DIR = path.join(PROJECT_ROOT, "test", "tmp");
const TEST_DB = path.join(TMP_DIR, "zonas.sqlite");

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
  // A cópia pode trazer dados de dev — limpa para cada teste ser determinístico
  await prisma.zone.deleteMany();
  await prisma.courier.deleteMany();
});

function makeCourier(name = "Off Limits") {
  return prisma.courier.create({ data: { name, type: "partner" } });
}

const VALID_INPUT = {
  matchText: "Lisboa (Centro da cidade) 19-23h",
  county: "Lisboa",
  confDay: "2f",
};

function expectOk<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Esperava ok=true, veio: ${JSON.stringify(result)}`);
  }
}

function expectErr<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: false }> {
  if (result.ok) {
    throw new Error(`Esperava ok=false, veio: ${JSON.stringify(result)}`);
  }
}

describe("createZone", () => {
  test("cria uma zona válida com trim nos campos e ativa por omissão", async () => {
    // Arrange
    const courier = await makeCourier();

    // Act
    const result = await createZone(prisma, {
      matchText: "  Lisboa (Centro da cidade) 19-23h  ",
      county: "  Lisboa ",
      confDay: "2f",
      courierId: courier.id,
    });

    // Assert
    expectOk(result);
    expect(result.zone.matchText).toBe("Lisboa (Centro da cidade) 19-23h");
    expect(result.zone.county).toBe("Lisboa");
    expect(result.zone.confDay).toBe("2f");
    expect(result.zone.active).toBe(true);
    expect(result.zone.courier?.name).toBe("Off Limits");
  });

  test("rejeita matchText duplicado com erro estruturado e não cria segunda zona", async () => {
    // Arrange
    await createZone(prisma, VALID_INPUT);

    // Act — o mesmo texto com espaços à volta continua a ser duplicado
    const result = await createZone(prisma, {
      matchText: " Lisboa (Centro da cidade) 19-23h ",
      county: "Outro concelho",
      confDay: "3f",
    });

    // Assert
    expectErr(result);
    expect(result.errors.matchText).toMatch(/Já existe/);
    expect(await prisma.zone.count()).toBe(1);
  });

  test("rejeita matchText e county vazios (só espaços) com erro por campo", async () => {
    // Act
    const result = await createZone(prisma, {
      matchText: "   ",
      county: "",
      confDay: "2f",
    });

    // Assert
    expectErr(result);
    expect(result.errors.matchText).toMatch(/Horário de entrega/);
    expect(result.errors.county).toBeTruthy();
    expect(await prisma.zone.count()).toBe(0);
  });

  test("rejeita confDay fora de 2f/3f/4f/vespera", async () => {
    // Act
    const result = await createZone(prisma, { ...VALID_INPUT, confDay: "5f" });

    // Assert
    expectErr(result);
    expect(result.errors.confDay).toMatch(/Dia de confeção inválido/);
  });

  test("rejeita courierId que não existe", async () => {
    // Act
    const result = await createZone(prisma, {
      ...VALID_INPUT,
      courierId: "courier-fantasma",
    });

    // Assert
    expectErr(result);
    expect(result.errors.courierId).toMatch(/já não existe/);
    expect(await prisma.zone.count()).toBe(0);
  });

  test("aceita courierId vazio como zona sem estafeta", async () => {
    // Act
    const result = await createZone(prisma, { ...VALID_INPUT, courierId: "" });

    // Assert
    expectOk(result);
    expect(result.zone.courierId).toBeNull();
    expect(result.zone.courier).toBeNull();
  });
});

describe("updateZone", () => {
  test("muda o estafeta da zona e devolve-o incluído", async () => {
    // Arrange
    const courierA = await makeCourier("Off Limits");
    const courierB = await makeCourier("CrossFit Leiria");
    const created = await createZone(prisma, {
      ...VALID_INPUT,
      courierId: courierA.id,
    });
    expectOk(created);

    // Act
    const result = await updateZone(prisma, created.zone.id, {
      ...VALID_INPUT,
      courierId: courierB.id,
    });

    // Assert
    expectOk(result);
    expect(result.zone.courierId).toBe(courierB.id);
    expect(result.zone.courier?.name).toBe("CrossFit Leiria");
  });

  test("mantém o próprio matchText mas rejeita o matchText de outra zona", async () => {
    // Arrange
    const z1 = await createZone(prisma, VALID_INPUT);
    const z2 = await createZone(prisma, {
      matchText: "Coimbra 18-20h",
      county: "Coimbra",
      confDay: "3f",
    });
    expectOk(z1);
    expectOk(z2);

    // Act
    const keepOwn = await updateZone(prisma, z2.zone.id, {
      matchText: "Coimbra 18-20h",
      county: "Coimbra",
      confDay: "4f",
    });
    const stealOther = await updateZone(prisma, z2.zone.id, VALID_INPUT);

    // Assert
    expectOk(keepOwn);
    expect(keepOwn.zone.confDay).toBe("4f");
    expectErr(stealOther);
    expect(stealOther.errors.matchText).toMatch(/Já existe/);
  });

  test("devolve erro estruturado para zona inexistente", async () => {
    // Act
    const result = await updateZone(prisma, "zona-fantasma", VALID_INPUT);

    // Assert
    expectErr(result);
    expect(result.errors.id).toMatch(/não encontrada/);
  });
});

describe("deleteZone", () => {
  test("remove a zona da BD", async () => {
    // Arrange
    const created = await createZone(prisma, VALID_INPUT);
    expectOk(created);

    // Act
    const result = await deleteZone(prisma, created.zone.id);

    // Assert
    expectOk(result);
    expect(await listZones(prisma)).toHaveLength(0);
  });

  test("devolve erro estruturado quando a zona não existe", async () => {
    // Act
    const result = await deleteZone(prisma, "zona-fantasma");

    // Assert
    expectErr(result);
    expect(result.errors.id).toMatch(/não encontrada/);
  });
});

describe("toggleZoneActive", () => {
  test("inverte o estado ativa/inativa nas duas direções", async () => {
    // Arrange
    const created = await createZone(prisma, VALID_INPUT);
    expectOk(created);
    expect(created.zone.active).toBe(true);

    // Act + Assert — desativa
    const off = await toggleZoneActive(prisma, created.zone.id);
    expectOk(off);
    expect(off.zone.active).toBe(false);

    // Act + Assert — reativa
    const on = await toggleZoneActive(prisma, created.zone.id);
    expectOk(on);
    expect(on.zone.active).toBe(true);
  });

  test("devolve erro estruturado quando a zona não existe", async () => {
    // Act
    const result = await toggleZoneActive(prisma, "zona-fantasma");

    // Assert
    expectErr(result);
    expect(result.errors.id).toMatch(/não encontrada/);
  });
});

describe("listZones", () => {
  test("ordena por matchText e inclui o estafeta (ou null)", async () => {
    // Arrange — criadas fora de ordem alfabética
    const courier = await makeCourier("DPD");
    await createZone(prisma, {
      matchText: "Lisboa (Centro) 19-23h",
      county: "Lisboa",
      confDay: "2f",
    });
    await createZone(prisma, {
      matchText: "Aveiro 10-13h",
      county: "Aveiro",
      confDay: "vespera",
      courierId: courier.id,
    });
    await createZone(prisma, {
      matchText: "Coimbra 18-20h",
      county: "Coimbra",
      confDay: "3f",
    });

    // Act
    const zones = await listZones(prisma);

    // Assert
    expect(zones.map((z) => z.matchText)).toEqual([
      "Aveiro 10-13h",
      "Coimbra 18-20h",
      "Lisboa (Centro) 19-23h",
    ]);
    expect(zones[0].courier?.name).toBe("DPD");
    expect(zones[1].courier).toBeNull();
    expect(zones[2].courier).toBeNull();
  });
});
