import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createCourier,
  createSupplier,
  deleteCourier,
  deleteSupplier,
  listCouriers,
  listSuppliers,
  updateCourier,
  updateSupplier,
} from "./parceiros.server";

// ─── BD SQLite real, descartável (cópia da dev.sqlite já migrada) ───────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..", "..", "..");
const SOURCE_DB = path.join(PROJECT_ROOT, "prisma", "dev.sqlite");
const TMP_DIR = path.join(PROJECT_ROOT, "test", "tmp");
const TEST_DB = path.join(TMP_DIR, "parceiros.sqlite");

let prisma: PrismaClient;

beforeAll(async () => {
  mkdirSync(TMP_DIR, { recursive: true });
  copyFileSync(SOURCE_DB, TEST_DB);

  prisma = new PrismaClient({
    datasources: { db: { url: `file:${TEST_DB.replace(/\\/g, "/")}` } },
  });

  // Estado inicial limpo nos domínios deste service (ordem respeita as FKs).
  await prisma.recipeLine.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.courier.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.supplier.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(TEST_DB, { force: true });
  rmSync(`${TEST_DB}-journal`, { force: true });
});

// ─── Couriers (estafetas e transportadoras) ─────────────────────────────────

describe("createCourier", () => {
  test("cria um estafeta válido e normaliza espaços", async () => {
    // Arrange
    const input = {
      name: "  Off Limits  ",
      type: "partner",
      ordering: "postcode",
      email: " rotas@offlimits.pt ",
    };

    // Act
    const result = await createCourier(prisma, input);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Off Limits");
      expect(result.data.type).toBe("partner");
      expect(result.data.ordering).toBe("postcode");
      expect(result.data.email).toBe("rotas@offlimits.pt");
    }
  });

  test("aplica ordering 'manual' por omissão e guarda email vazio como null", async () => {
    // Arrange + Act
    const result = await createCourier(prisma, {
      name: "Interno Coimbra",
      type: "internal",
      ordering: "",
      email: "   ",
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ordering).toBe("manual");
      expect(result.data.email).toBeNull();
    }
  });

  test("rejeita nome vazio com erro no campo name", async () => {
    // Arrange + Act
    const result = await createCourier(prisma, {
      name: "   ",
      type: "partner",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/obrigatório/i);
    }
  });

  test("rejeita tipo fora de internal|partner|dpd", async () => {
    // Arrange + Act
    const result = await createCourier(prisma, {
      name: "Transportadora X",
      type: "externo",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.type).toMatch(/Tipo inválido/);
    }
  });

  test("rejeita ordenação fora de manual|postcode|county", async () => {
    // Arrange + Act
    const result = await createCourier(prisma, {
      name: "Transportadora Y",
      type: "partner",
      ordering: "alfabetica",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.ordering).toMatch(/Ordenação de rota inválida/);
    }
  });

  test("rejeita email com formato inválido", async () => {
    // Arrange + Act
    const result = await createCourier(prisma, {
      name: "Transportadora Z",
      type: "dpd",
      email: "sem-arroba.pt",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.email).toMatch(/formato válido/);
    }
  });

  test("rejeita nome duplicado com mensagem de unicidade", async () => {
    // Arrange — "Off Limits" já foi criado acima
    const result = await createCourier(prisma, {
      name: "Off Limits",
      type: "internal",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/Já existe/);
    }
  });
});

describe("updateCourier", () => {
  test("atualiza os campos de um estafeta existente", async () => {
    // Arrange
    const created = await createCourier(prisma, {
      name: "CrossFit Leiria",
      type: "partner",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Act
    const result = await updateCourier(prisma, created.data.id, {
      name: "CrossFit Leiria (novo)",
      type: "partner",
      ordering: "county",
      email: "leiria@crossfit.pt",
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("CrossFit Leiria (novo)");
      expect(result.data.ordering).toBe("county");
      expect(result.data.email).toBe("leiria@crossfit.pt");
    }
  });

  test("rejeita mudar o nome para um nome já usado por outro estafeta", async () => {
    // Arrange
    const created = await createCourier(prisma, {
      name: "Estafeta Temporário",
      type: "internal",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Act — "Off Limits" pertence a outro registo
    const result = await updateCourier(prisma, created.data.id, {
      name: "Off Limits",
      type: "internal",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/Já existe/);
    }
  });

  test("devolve erro estruturado para id inexistente", async () => {
    // Act
    const result = await updateCourier(prisma, "id-que-nao-existe", {
      name: "Fantasma",
      type: "internal",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.id).toMatch(/não encontrado/);
    }
  });
});

describe("deleteCourier", () => {
  test("elimina um estafeta sem zonas associadas", async () => {
    // Arrange
    const created = await createCourier(prisma, {
      name: "Estafeta Descartável",
      type: "internal",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Act
    const result = await deleteCourier(prisma, created.data.id);

    // Assert
    expect(result.ok).toBe(true);
    const remaining = await prisma.courier.findUnique({
      where: { id: created.data.id },
    });
    expect(remaining).toBeNull();
  });

  test("recusa eliminar um estafeta com zonas associadas e pede para reatribuir", async () => {
    // Arrange
    const created = await createCourier(prisma, {
      name: "DPD Nacional",
      type: "dpd",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.zone.create({
      data: {
        matchText: "Portugal Continental 08-15h (teste parceiros)",
        county: "Nacional",
        confDay: "vespera",
        courierId: created.data.id,
      },
    });

    // Act
    const result = await deleteCourier(prisma, created.data.id);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.id).toMatch(/1 zona\(s\) de entrega associada/);
      expect(result.errors.id).toMatch(/Reatribui/);
    }
    const stillThere = await prisma.courier.findUnique({
      where: { id: created.data.id },
    });
    expect(stillThere).not.toBeNull();
  });

  test("devolve erro estruturado para id inexistente", async () => {
    // Act
    const result = await deleteCourier(prisma, "id-que-nao-existe");

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.id).toMatch(/não encontrado/);
    }
  });
});

describe("listCouriers", () => {
  test("devolve os estafetas ordenados por nome com contagem de zonas", async () => {
    // Act
    const couriers = await listCouriers(prisma);

    // Assert
    const names = couriers.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    const dpd = couriers.find((c) => c.name === "DPD Nacional");
    expect(dpd?.zoneCount).toBe(1);

    const offLimits = couriers.find((c) => c.name === "Off Limits");
    expect(offLimits?.zoneCount).toBe(0);
  });
});

// ─── Suppliers (fornecedores) ───────────────────────────────────────────────

describe("createSupplier", () => {
  test("cria um fornecedor válido com dia de encomenda em texto livre", async () => {
    // Arrange + Act
    const result = await createSupplier(prisma, {
      name: "  Peixaria Central  ",
      email: "encomendas@peixariacentral.pt",
      orderDay: " Quinta-feira até às 12h ",
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Peixaria Central");
      expect(result.data.orderDay).toBe("Quinta-feira até às 12h");
    }
  });

  test("rejeita nome vazio", async () => {
    // Act
    const result = await createSupplier(prisma, { name: "" });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/obrigatório/i);
    }
  });

  test("rejeita email inválido", async () => {
    // Act
    const result = await createSupplier(prisma, {
      name: "Talho do Bairro",
      email: "talho@sem-dominio",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.email).toMatch(/formato válido/);
    }
  });

  test("rejeita nome duplicado", async () => {
    // Arrange — "Peixaria Central" já existe
    const result = await createSupplier(prisma, {
      name: "Peixaria Central",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toMatch(/Já existe/);
    }
  });
});

describe("updateSupplier", () => {
  test("atualiza os campos de um fornecedor existente", async () => {
    // Arrange
    const created = await createSupplier(prisma, {
      name: "Hortas de Coimbra",
      orderDay: "Segunda",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Act
    const result = await updateSupplier(prisma, created.data.id, {
      name: "Hortas de Coimbra & Filhos",
      email: "geral@hortascoimbra.pt",
      orderDay: "Terça",
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Hortas de Coimbra & Filhos");
      expect(result.data.email).toBe("geral@hortascoimbra.pt");
      expect(result.data.orderDay).toBe("Terça");
    }
  });

  test("devolve erro estruturado para id inexistente", async () => {
    // Act
    const result = await updateSupplier(prisma, "id-que-nao-existe", {
      name: "Fantasma Lda",
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.id).toMatch(/não encontrado/);
    }
  });
});

describe("deleteSupplier", () => {
  test("elimina um fornecedor sem ingredientes associados", async () => {
    // Arrange
    const created = await createSupplier(prisma, {
      name: "Fornecedor Descartável",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Act
    const result = await deleteSupplier(prisma, created.data.id);

    // Assert
    expect(result.ok).toBe(true);
    const remaining = await prisma.supplier.findUnique({
      where: { id: created.data.id },
    });
    expect(remaining).toBeNull();
  });

  test("recusa eliminar um fornecedor com ingredientes associados", async () => {
    // Arrange
    const created = await createSupplier(prisma, {
      name: "Peixe Fresco Lda",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await prisma.ingredient.create({
      data: {
        name: "Tranche de salmão (teste parceiros)",
        unit: "kg",
        supplierId: created.data.id,
      },
    });

    // Act
    const result = await deleteSupplier(prisma, created.data.id);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.id).toMatch(/1 ingrediente\(s\) associado/);
      expect(result.errors.id).toMatch(/Reatribui/);
    }
    const stillThere = await prisma.supplier.findUnique({
      where: { id: created.data.id },
    });
    expect(stillThere).not.toBeNull();
  });
});

describe("listSuppliers", () => {
  test("devolve os fornecedores ordenados por nome com contagem de ingredientes", async () => {
    // Act
    const suppliers = await listSuppliers(prisma);

    // Assert
    const names = suppliers.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    const peixe = suppliers.find((s) => s.name === "Peixe Fresco Lda");
    expect(peixe?.ingredientCount).toBe(1);

    const peixaria = suppliers.find((s) => s.name === "Peixaria Central");
    expect(peixaria?.ingredientCount).toBe(0);
  });
});
