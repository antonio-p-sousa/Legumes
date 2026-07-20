/**
 * Seed da BD "Operação Semanal" — configuração inicial derivada da semana 47
 * real, para o operador não começar do zero (ver docs/ARCHITECTURE.md §5, §9).
 *
 * O que povoa:
 *   1. Couriers + Zones — fixtures reais da w47 (test/fixtures/zones-w47.ts);
 *   2. AppConfig singleton — defaults do schema + conta DPD;
 *   3. Dishes + Doses — derivados dos line items REFEIÇÃO da w47
 *      (test/fixtures/w47-orders.json), categorizados por heurística;
 *   4. ComponentFactor — tabela de empratamento por componentes do cliente
 *      (20 jul 2026, margem de 10 g já incluída — nunca somar margem).
 *
 * Idempotente: usa upsert em tudo — correr duas vezes não duplica nada.
 * Pratos/doses usam `update: {}` (só-inserir) para nunca sobrepor edições
 * do operador; zonas/couriers convergem para os valores do fixture.
 *
 * Correr: npx tsx prisma/seed.ts   (a partir de operacao-semanal/)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  DEFAULT_COMPONENT_FACTORS,
  isMealItem,
  splitDishDose,
} from "../app/services/weekly/index";
import { COURIERS_W47, ZONES_W47 } from "../test/fixtures/zones-w47";

/** Conta DPD da loja (ARCHITECTURE.md §4.6 — 1ª coluna do CSV DPD). */
const DPD_ACCOUNT = "03290201";

const ORDERS_FIXTURE_URL = new URL(
  "../test/fixtures/w47-orders.json",
  import.meta.url,
);

// ── Heurística de categorias ─────────────────────────────────────────────────

/**
 * Infere a categoria de um prato por palavras-chave no nome (minúsculas e sem
 * acentos). A ORDEM dos testes é precedência deliberada:
 *
 *   1. poke      — antes de peixe/carne: "Poke Bowl Salmão" é poke, não peixe;
 *   2. pizza     — antes de carne: "Pizza de Fiambre de Perú" é pizza;
 *   3. sopa      — creme|sopa ("Creme de Cenoura e Abóbora…");
 *   4. sobremesa — cheesecake|bolo|sobremesa;
 *   5. peixe     — salmão|pescada|bacalhau|choco; "choco" só como palavra
 *                  inteira para não apanhar "chocolate" (que é sobremesa);
 *                  cobre também "Lasanha Integral de Salmão";
 *   6. carne     — frango|novilho|perú|carne;
 *   7. vegetariano — tofu|lentilhas|legumes|moqueca, SÓ depois de excluídos
 *                  peixe/carne ("Feijoada de Choco e Legumes" fica peixe);
 *   8. outro     — tudo o resto (o operador corrige nas Definições).
 */
export function inferCategory(baseName: string): string {
  const name = baseName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  if (/\bpoke\b/.test(name)) return "poke";
  if (/pizza/.test(name)) return "pizza";
  if (/creme|sopa/.test(name)) return "sopa";
  if (/cheesecake|bolo|sobremesa/.test(name)) return "sobremesa";
  if (/salmao|pescada|bacalhau|\bchocos?\b/.test(name)) return "peixe";
  if (/frango|novilho|\bperu\b|carne/.test(name)) return "carne";
  if (/tofu|lentilhas|legumes|moqueca/.test(name)) return "vegetariano";
  return "outro";
}

// ── Leitura do fixture de encomendas ────────────────────────────────────────

interface FixtureLineItem {
  name: string;
}

interface FixtureOrder {
  lineItems: FixtureLineItem[];
}

function readOrdersFixture(): FixtureOrder[] {
  const raw = readFileSync(fileURLToPath(ORDERS_FIXTURE_URL), "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Fixture inválido: esperava um array de encomendas em ${ORDERS_FIXTURE_URL.pathname}`,
    );
  }
  return parsed as FixtureOrder[];
}

/** Agrega os line items REFEIÇÃO em prato (baseName) → doses distintas. */
function collectDishes(orders: FixtureOrder[]): Map<string, Set<string>> {
  const dishes = new Map<string, Set<string>>();
  for (const order of orders) {
    for (const item of order.lineItems ?? []) {
      if (typeof item.name !== "string" || !item.name.trim()) continue;
      if (!isMealItem(item.name)) continue; // subscrições, embalagens, tips…
      const { base, dose } = splitDishDose(item.name);
      const labels = dishes.get(base) ?? new Set<string>();
      labels.add(dose);
      dishes.set(base, labels);
    }
  }
  return dishes;
}

// ── Seed ─────────────────────────────────────────────────────────────────────

export interface SeedSummary {
  couriers: number;
  zones: number;
  dishes: number;
  doses: number;
  componentFactors: number;
}

export async function seed(prisma: PrismaClient): Promise<SeedSummary> {
  // 1. Couriers (upsert por name) — convergem para os valores do fixture.
  for (const courier of COURIERS_W47) {
    await prisma.courier.upsert({
      where: { name: courier.name },
      create: {
        name: courier.name,
        type: courier.type,
        email: courier.email ?? null,
        ordering: courier.ordering,
      },
      update: {
        type: courier.type,
        ordering: courier.ordering,
      },
    });
  }

  // 2. Zones (upsert por matchText), ligadas ao courier pelo nome.
  for (const zone of ZONES_W47) {
    const courier = await prisma.courier.findUnique({
      where: { name: zone.courierName },
    });
    if (!courier) {
      throw new Error(
        `Zona "${zone.matchText}" refere o courier "${zone.courierName}", que não existe — verifica COURIERS_W47.`,
      );
    }
    await prisma.zone.upsert({
      where: { matchText: zone.matchText },
      create: {
        matchText: zone.matchText,
        county: zone.county,
        confDay: zone.confDay,
        courierId: courier.id,
        active: zone.active,
      },
      update: {
        county: zone.county,
        confDay: zone.confDay,
        courierId: courier.id,
        active: zone.active,
      },
    });
  }

  // 3. AppConfig singleton — defaults do schema + conta DPD.
  await prisma.appConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", dpdAccount: DPD_ACCOUNT },
    update: { dpdAccount: DPD_ACCOUNT },
  });

  // 4. Dishes + Doses derivados da w47. `update: {}` = só-inserir, para não
  //    sobrepor categorias/doses que o operador já tenha editado.
  const dishes = collectDishes(readOrdersFixture());
  for (const [baseName, doseLabels] of dishes) {
    const dish = await prisma.dish.upsert({
      where: { baseName },
      create: { baseName, category: inferCategory(baseName) },
      update: {},
    });
    for (const label of doseLabels) {
      await prisma.dose.upsert({
        where: { dishId_label: { dishId: dish.id, label } },
        create: { dishId: dish.id, label },
        update: {},
      });
    }
  }

  // 5. Fatores de componentes do empratamento (tabela do cliente, 20 jul 2026
  //    — margem de 10 g por componente JÁ incluída). `update: {}` = só-inserir,
  //    para nunca sobrepor valores editados pelo operador.
  for (const factor of DEFAULT_COMPONENT_FACTORS) {
    await prisma.componentFactor.upsert({
      where: {
        dose_component: { dose: factor.dose, component: factor.component },
      },
      create: {
        dose: factor.dose,
        component: factor.component,
        kgPerMeal: factor.kgPerMeal,
      },
      update: {},
    });
  }

  const [couriers, zones, dishCount, doses, componentFactors] =
    await Promise.all([
      prisma.courier.count(),
      prisma.zone.count(),
      prisma.dish.count(),
      prisma.dose.count(),
      prisma.componentFactor.count(),
    ]);

  return { couriers, zones, dishes: dishCount, doses, componentFactors };
}

// ── Execução direta (npx tsx prisma/seed.ts) ────────────────────────────────
// Comparação por href normalizado: no Windows a letra da drive pode diferir
// em maiúsculas/minúsculas entre import.meta.url e process.argv[1].

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase();

if (isDirectRun) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((summary) => {
      console.log(
        `Seed concluído: ${summary.zones} zonas, ${summary.couriers} estafetas, ` +
          `${summary.dishes} pratos, ${summary.doses} doses, ` +
          `${summary.componentFactors} fatores de componentes (conta DPD ${DPD_ACCOUNT}).`,
      );
    })
    .catch((error) => {
      console.error("Seed falhou:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
