import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDose,
  createDish,
  deleteDish,
  deleteDose,
  getDoseRecipe,
  listDishes,
  removeRecipeLine,
  toggleDoseActive,
  updateDish,
  upsertRecipeLine,
  type ServiceResult,
} from "./fichas.server";

// ── BD SQLite descartável (cópia da dev.sqlite já migrada) ────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const SOURCE_DB = path.join(ROOT, "prisma", "dev.sqlite");
const TMP_DIR = path.join(ROOT, "test", "tmp");
const TEST_DB = path.join(TMP_DIR, "fichas.sqlite");

let prisma: PrismaClient;

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  copyFileSync(SOURCE_DB, TEST_DB);
  prisma = new PrismaClient({
    datasources: { db: { url: `file:${TEST_DB.split(path.sep).join("/")}` } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${TEST_DB}${suffix}`, { force: true });
  }
});

beforeEach(async () => {
  // A cópia pode trazer dados de seed — limpa o domínio para isolar cada teste.
  await prisma.recipeLine.deleteMany();
  await prisma.dose.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.supplier.deleteMany();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function expectOk<T>(result: ServiceResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `Esperava sucesso mas recebi erros: ${JSON.stringify(result.errors)}`,
    );
  }
  return result.data;
}

function expectErrors<T>(result: ServiceResult<T>): Record<string, string> {
  if (result.ok) {
    throw new Error("Esperava erros de validação mas a operação teve sucesso.");
  }
  return result.errors;
}

async function seedDishWithDose(
  baseName = "Jardineira de Novilho",
  category = "carne",
  doseLabel = "Bulk",
) {
  const dish = expectOk(await createDish(prisma, { baseName, category }));
  const dose = expectOk(await addDose(prisma, dish.id, doseLabel));
  return { dish, dose };
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe("createDish", () => {
  test("cria um prato com nome aparado e categoria válida", async () => {
    // Arrange + Act
    const result = await createDish(prisma, {
      baseName: "  Tranche de Salmão com amêndoa  ",
      category: "peixe",
    });

    // Assert
    const dish = expectOk(result);
    expect(dish.baseName).toBe("Tranche de Salmão com amêndoa");
    expect(dish.category).toBe("peixe");
    const dishes = await listDishes(prisma);
    expect(dishes).toHaveLength(1);
  });

  test("rejeita nome vazio (só espaços)", async () => {
    // Act
    const result = await createDish(prisma, { baseName: "   ", category: "carne" });

    // Assert
    const errors = expectErrors(result);
    expect(errors.baseName).toMatch(/obrigatório/i);
    expect(await prisma.dish.count()).toBe(0);
  });

  test("rejeita baseName duplicado", async () => {
    // Arrange
    expectOk(await createDish(prisma, { baseName: "Pizza Margherita", category: "pizza" }));

    // Act — o trim tem de contar para a unicidade
    const result = await createDish(prisma, {
      baseName: "  Pizza Margherita ",
      category: "pizza",
    });

    // Assert
    const errors = expectErrors(result);
    expect(errors.baseName).toMatch(/já existe/i);
    expect(await prisma.dish.count()).toBe(1);
  });

  test("rejeita categoria inválida", async () => {
    // Act
    const result = await createDish(prisma, {
      baseName: "Bacalhau à Brás",
      category: "grelhados",
    });

    // Assert
    const errors = expectErrors(result);
    expect(errors.category).toMatch(/inválida/i);
    expect(await prisma.dish.count()).toBe(0);
  });
});

describe("updateDish", () => {
  test("atualiza nome e categoria do prato", async () => {
    // Arrange
    const { dish } = await seedDishWithDose("Sopa de Legumes", "sopa", "300g");

    // Act
    const result = await updateDish(prisma, dish.id, {
      baseName: "Creme de Legumes",
      category: "sopa",
    });

    // Assert
    const updated = expectOk(result);
    expect(updated.baseName).toBe("Creme de Legumes");
  });

  test("rejeita mudar o nome para o de outro prato", async () => {
    // Arrange
    expectOk(await createDish(prisma, { baseName: "Poke de Atum", category: "poke" }));
    const alvo = expectOk(
      await createDish(prisma, { baseName: "Poke de Salmão", category: "poke" }),
    );

    // Act
    const result = await updateDish(prisma, alvo.id, {
      baseName: "Poke de Atum",
      category: "poke",
    });

    // Assert
    const errors = expectErrors(result);
    expect(errors.baseName).toMatch(/já existe/i);
  });
});

describe("addDose", () => {
  test("cria dose ativa por omissão", async () => {
    // Arrange
    const dish = expectOk(
      await createDish(prisma, { baseName: "Frango Grelhado", category: "carne" }),
    );

    // Act
    const dose = expectOk(await addDose(prisma, dish.id, "  Low Carb "));

    // Assert
    expect(dose.label).toBe("Low Carb");
    const stored = await prisma.dose.findUnique({ where: { id: dose.id } });
    expect(stored?.active).toBe(true);
  });

  test("rejeita label duplicada no mesmo prato mas permite noutro prato", async () => {
    // Arrange
    const { dish } = await seedDishWithDose("Frango Grelhado", "carne", "Bulk");
    const outro = expectOk(
      await createDish(prisma, { baseName: "Vitela Assada", category: "carne" }),
    );

    // Act
    const duplicada = await addDose(prisma, dish.id, "Bulk");
    const noutroPrato = await addDose(prisma, outro.id, "Bulk");

    // Assert
    const errors = expectErrors(duplicada);
    expect(errors.label).toMatch(/já tem a dose/i);
    expectOk(noutroPrato);
  });
});

describe("toggleDoseActive", () => {
  test("inverte o estado ativo da dose", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();

    // Act + Assert
    const desativada = expectOk(await toggleDoseActive(prisma, dose.id));
    expect(desativada.active).toBe(false);
    const reativada = expectOk(await toggleDoseActive(prisma, dose.id));
    expect(reativada.active).toBe(true);
  });
});

describe("deleteDose", () => {
  test("apaga a dose e as linhas da ficha dela", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Novilho",
        unit: "kg",
        supplierName: "Talho Central",
        qtyPerMeal: 0.25,
      }),
    );

    // Act
    expectOk(await deleteDose(prisma, dose.id));

    // Assert — a dose e as linhas desaparecem; o ingrediente fica para reutilização
    expect(await prisma.dose.count()).toBe(0);
    expect(await prisma.recipeLine.count()).toBe(0);
    expect(await prisma.ingredient.count()).toBe(1);
  });
});

describe("upsertRecipeLine", () => {
  test("cria ingrediente e fornecedor on-the-fly", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();

    // Act
    const result = await upsertRecipeLine(prisma, {
      doseId: dose.id,
      ingredientName: " Batata ",
      unit: "kg",
      supplierName: " Frutaria Silva ",
      qtyPerMeal: 0.2,
    });

    // Assert
    expectOk(result);
    const ingredient = await prisma.ingredient.findUnique({
      where: { name: "Batata" },
      include: { supplier: true },
    });
    expect(ingredient?.unit).toBe("kg");
    expect(ingredient?.supplier?.name).toBe("Frutaria Silva");
  });

  test("rejeita qtyPerMeal não positiva", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();
    const base = {
      doseId: dose.id,
      ingredientName: "Arroz",
      unit: "kg",
      supplierName: null,
    };

    // Act + Assert
    expect(expectErrors(await upsertRecipeLine(prisma, { ...base, qtyPerMeal: 0 })).qtyPerMeal).toMatch(/maior que zero/i);
    expect(expectErrors(await upsertRecipeLine(prisma, { ...base, qtyPerMeal: -0.5 })).qtyPerMeal).toMatch(/maior que zero/i);
    expect(expectErrors(await upsertRecipeLine(prisma, { ...base, qtyPerMeal: NaN })).qtyPerMeal).toMatch(/maior que zero/i);
    expect(await prisma.recipeLine.count()).toBe(0);
  });

  test("reutiliza ingrediente existente pelo nome sem duplicar", async () => {
    // Arrange — o mesmo ingrediente em duas doses de pratos diferentes
    const a = await seedDishWithDose("Jardineira de Novilho", "carne", "Bulk");
    const b = await seedDishWithDose("Bacalhau com Natas", "peixe", "Low Carb");
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: a.dose.id,
        ingredientName: "Batata",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.2,
      }),
    );

    // Act
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: b.dose.id,
        ingredientName: "Batata",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.15,
      }),
    );

    // Assert
    expect(await prisma.ingredient.count({ where: { name: "Batata" } })).toBe(1);
    expect(await prisma.recipeLine.count()).toBe(2);
  });

  test("erro estruturado quando a unidade difere da do ingrediente existente", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Azeite",
        unit: "ml",
        supplierName: null,
        qtyPerMeal: 15,
      }),
    );

    // Act — tentar o mesmo ingrediente com unidade diferente
    const result = await upsertRecipeLine(prisma, {
      doseId: dose.id,
      ingredientName: "Azeite",
      unit: "L",
      supplierName: null,
      qtyPerMeal: 0.015,
    });

    // Assert — erro claro, nada alterado
    const errors = expectErrors(result);
    expect(errors.unit).toContain('"Azeite"');
    expect(errors.unit).toContain('"ml"');
    const ingredient = await prisma.ingredient.findUnique({ where: { name: "Azeite" } });
    expect(ingredient?.unit).toBe("ml");
  });

  test("reutiliza fornecedor existente pelo nome sem duplicar", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Cenoura",
        unit: "kg",
        supplierName: "Frutaria Silva",
        qtyPerMeal: 0.05,
      }),
    );

    // Act — outro ingrediente com o mesmo fornecedor
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Courgette",
        unit: "kg",
        supplierName: "Frutaria Silva",
        qtyPerMeal: 0.08,
      }),
    );

    // Assert
    expect(await prisma.supplier.count({ where: { name: "Frutaria Silva" } })).toBe(1);
  });

  test("atualiza a quantidade quando a linha (dose, ingrediente) já existe", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();
    const primeira = expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Novilho",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.25,
      }),
    );

    // Act
    const segunda = expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Novilho",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.3,
      }),
    );

    // Assert — mesma linha, quantidade nova
    expect(segunda.lineId).toBe(primeira.lineId);
    expect(await prisma.recipeLine.count()).toBe(1);
    const line = await prisma.recipeLine.findUnique({ where: { id: primeira.lineId } });
    expect(line?.qtyPerMeal).toBe(0.3);
  });

  test("rejeita unidade fora da lista kg/g/ml/L/un", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();

    // Act
    const result = await upsertRecipeLine(prisma, {
      doseId: dose.id,
      ingredientName: "Farinha",
      unit: "saco",
      supplierName: null,
      qtyPerMeal: 0.1,
    });

    // Assert
    const errors = expectErrors(result);
    expect(errors.unit).toMatch(/inválida/i);
  });
});

describe("getDoseRecipe", () => {
  test("devolve a dose com linhas, ingrediente e fornecedor ordenados por nome", async () => {
    // Arrange
    const { dose } = await seedDishWithDose("Jardineira de Novilho", "carne", "Bulk");
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Novilho",
        unit: "kg",
        supplierName: "Talho Central",
        qtyPerMeal: 0.25,
      }),
    );
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Batata",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.2,
      }),
    );

    // Act
    const recipe = await getDoseRecipe(prisma, dose.id);

    // Assert
    expect(recipe).not.toBeNull();
    expect(recipe?.dish.baseName).toBe("Jardineira de Novilho");
    expect(recipe?.lines.map((l) => l.ingredientName)).toEqual(["Batata", "Novilho"]);
    expect(recipe?.lines[1]?.supplierName).toBe("Talho Central");
    expect(recipe?.lines[0]?.supplierName).toBeNull();
  });

  test("devolve null quando a dose não existe", async () => {
    // Act + Assert
    expect(await getDoseRecipe(prisma, "dose-inexistente")).toBeNull();
  });
});

describe("removeRecipeLine", () => {
  test("apaga a linha da ficha", async () => {
    // Arrange
    const { dose } = await seedDishWithDose();
    const line = expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Novilho",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.25,
      }),
    );

    // Act
    const result = await removeRecipeLine(prisma, line.lineId);

    // Assert
    expectOk(result);
    expect(await prisma.recipeLine.count()).toBe(0);
  });

  test("erro estruturado quando a linha não existe", async () => {
    // Act
    const result = await removeRecipeLine(prisma, "linha-inexistente");

    // Assert
    const errors = expectErrors(result);
    expect(errors.lineId).toMatch(/não encontrada/i);
  });
});

describe("listDishes — estado derivado da ficha", () => {
  test('"completa" quando todas as doses ativas têm ingredientes (inativas não contam)', async () => {
    // Arrange — dose ativa com ficha + dose inativa sem ficha
    const { dish, dose } = await seedDishWithDose("Frango Grelhado", "carne", "Bulk");
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Frango",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.22,
      }),
    );
    const inativa = expectOk(await addDose(prisma, dish.id, "Zero Carbs"));
    expectOk(await toggleDoseActive(prisma, inativa.id));

    // Act
    const [item] = await listDishes(prisma);

    // Assert
    expect(item.status).toBe("completa");
    expect(item.activeDosesWithoutRecipe).toBe(0);
  });

  test('"incompleta" quando alguma dose ativa não tem ingredientes', async () => {
    // Arrange — uma dose com ficha, duas ativas sem ficha
    const { dish, dose } = await seedDishWithDose("Poke de Atum", "poke", "M arroz");
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Atum",
        unit: "kg",
        supplierName: null,
        qtyPerMeal: 0.15,
      }),
    );
    expectOk(await addDose(prisma, dish.id, "XL arroz"));
    expectOk(await addDose(prisma, dish.id, "M quinoa"));

    // Act
    const [item] = await listDishes(prisma);

    // Assert
    expect(item.status).toBe("incompleta");
    expect(item.activeDosesWithoutRecipe).toBe(2);
  });

  test('"sem doses" quando o prato não tem nenhuma dose', async () => {
    // Arrange
    expectOk(await createDish(prisma, { baseName: "Brownie", category: "sobremesa" }));

    // Act
    const [item] = await listDishes(prisma);

    // Assert
    expect(item.status).toBe("sem-doses");
    expect(item.doses).toHaveLength(0);
  });

  test("ordena por categoria e nome", async () => {
    // Arrange
    expectOk(await createDish(prisma, { baseName: "Vitela Assada", category: "carne" }));
    expectOk(await createDish(prisma, { baseName: "Bacalhau com Natas", category: "peixe" }));
    expectOk(await createDish(prisma, { baseName: "Frango Grelhado", category: "carne" }));

    // Act
    const dishes = await listDishes(prisma);

    // Assert
    expect(dishes.map((d) => d.baseName)).toEqual([
      "Frango Grelhado",
      "Vitela Assada",
      "Bacalhau com Natas",
    ]);
  });
});

describe("deleteDish", () => {
  test("apaga o prato com doses e linhas em cascata", async () => {
    // Arrange
    const { dish, dose } = await seedDishWithDose();
    expectOk(await addDose(prisma, dish.id, "Low Carb"));
    expectOk(
      await upsertRecipeLine(prisma, {
        doseId: dose.id,
        ingredientName: "Novilho",
        unit: "kg",
        supplierName: "Talho Central",
        qtyPerMeal: 0.25,
      }),
    );

    // Act
    const result = await deleteDish(prisma, dish.id);

    // Assert — prato, doses e linhas desaparecem; ingrediente/fornecedor ficam
    expectOk(result);
    expect(await prisma.dish.count()).toBe(0);
    expect(await prisma.dose.count()).toBe(0);
    expect(await prisma.recipeLine.count()).toBe(0);
    expect(await prisma.ingredient.count()).toBe(1);
    expect(await prisma.supplier.count()).toBe(1);
  });

  test("erro estruturado quando o prato não existe", async () => {
    // Act
    const result = await deleteDish(prisma, "prato-inexistente");

    // Assert
    const errors = expectErrors(result);
    expect(errors.dishId).toMatch(/não encontrado/i);
  });
});
