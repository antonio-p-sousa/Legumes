/**
 * Corre os SERVIÇOS REAIS das páginas sobre a fixture anonimizada da w28 e
 * escreve as views computadas em JSON — a base da demo (dados reais, código
 * real, sem credenciais Shopify).
 *
 *   npx tsx scripts/demo-w28-views.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { processOrders, DEFAULT_COMPONENT_FACTORS, type OrderInput } from "../app/services/weekly/index";
import type { WeekData } from "../app/services/pages/common.server";
import { buildSemanaView } from "../app/services/pages/semana.server";
import { buildCozinhaView } from "../app/services/pages/cozinha.server";
import { buildComprasView } from "../app/services/pages/compras.server";
import { buildEstafetasView } from "../app/services/pages/estafetas.server";
import { ZONES_W28, COURIERS_W28 } from "../test/fixtures/zones-w28";

const here = dirname(fileURLToPath(import.meta.url));
const orders: OrderInput[] = JSON.parse(
  readFileSync(join(here, "../test/fixtures/w28-orders.json"), "utf-8"),
);

const { processed } = processOrders(orders, ZONES_W28);
const created = orders.map((o) => o.createdAt).filter(Boolean).sort();

const weekData: WeekData = {
  processed,
  zones: ZONES_W28,
  couriers: COURIERS_W28,
  meta: {
    source: "demo",
    weekLabel: "2026-W28 (demonstração)",
    windowStart: created[0] ?? "",
    windowEnd: created[created.length - 1] ?? "",
    fetchedAt: new Date().toISOString(),
    totalOrders: processed.length,
    ordersSemAtributos: processed.filter((p) => p.issues.some((i) => i.startsWith("atributos-entrega"))).length,
    ordersZonaDesconhecida: processed.filter((p) => p.issues.some((i) => i.startsWith("zona-desconhecida"))).length,
  },
};

// Categoria por prato — mesma heurística do seed (precedência deliberada).
function categoria(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes("poke")) return "poke";
  if (n.includes("pizza")) return "pizza";
  if (n.includes("creme") || n.includes("sopa")) return "sopa";
  if (n.includes("cheesecake") || n.includes("bolo") || n.includes("sobremesa")) return "sobremesa";
  if (/(salmão|salmao|pescada|bacalhau|choco|camarão|camarao|atum)/.test(n)) return "peixe";
  if (/(frango|novilho|perú|peru|carne|almôndega|almondega)/.test(n)) return "carne";
  if (/(tofu|lentilha|legume|moqueca|vegetarian)/.test(n)) return "vegetariano";
  return "outro";
}
const dishNames = [...new Set(processed.flatMap((p) => p.order.lineItems.map((li) => li.name.split(" - ")[0])))];
const dishes = dishNames.map((baseName) => ({ baseName, category: categoria(baseName) }));

const semana = buildSemanaView(weekData, { purchaseMargin: 0.08, dpdAccount: "03290201" }, []);
const cozinha = buildCozinhaView(weekData, dishes, DEFAULT_COMPONENT_FACTORS);
const compras = buildComprasView(weekData, [], 0.08, []);
const estafetas = buildEstafetasView(weekData, "03290201");

const out = {
  weekLabel: weekData.meta.weekLabel,
  semana,
  cozinha,
  compras: { ...compras, dpdCsvPreview: undefined },
  estafetas: {
    deliveryDates: estafetas.deliveryDates,
    routes: estafetas.routes.map((r) => ({ ...r, stops: r.stops.slice(0, 6), totalStops: r.stops.length })),
    dpd: { shipments: estafetas.dpd.shipments, totalWeightKg: estafetas.dpd.totalWeightKg, totalVolumes: estafetas.dpd.totalVolumes, issues: estafetas.dpd.issues, csvLines: estafetas.dpd.csv.split("\r\n").slice(0, 5) },
  },
};

writeFileSync(join(here, "demo-w28-views.json"), JSON.stringify(out, null, 2), "utf-8");
console.log("OK — views escritas em scripts/demo-w28-views.json");
console.log("Semana:", JSON.stringify(semana.kpis));
console.log("Cozinha dias:", cozinha.days.map((d: any) => `${d.confDay}:${d.totalMeals}`).join(" "));
console.log("Compras missing:", compras.missing.count, "| Estafetas rotas:", estafetas.routes.length, "| DPD:", estafetas.dpd.shipments);
