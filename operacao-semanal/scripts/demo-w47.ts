/**
 * Demo: corre o motor weekly completo sobre a fixture anonimizada da semana 47
 * e imprime um resumo JSON dos documentos gerados.
 *
 *   npx tsx scripts/demo-w47.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildDpdCsv,
  buildKitchenMap,
  buildLabels,
  buildPurchaseList,
  buildRoutes,
  processOrders,
  type OrderInput,
} from "../app/services/weekly/index";
import { COURIERS_W47, ZONES_W47 } from "../test/fixtures/zones-w47";

const here = dirname(fileURLToPath(import.meta.url));
const orders: OrderInput[] = JSON.parse(
  readFileSync(join(here, "../test/fixtures/w47-orders.json"), "utf-8"),
);

const { processed } = processOrders(orders, ZONES_W47);
const valid = processed.filter((p) => p.confDay);

const kitchen = buildKitchenMap(processed);
const labels = buildLabels(processed);
const purchases = buildPurchaseList(processed, [], 0.08);
const routes = buildRoutes(processed, COURIERS_W47);
const dpd = buildDpdCsv(processed, COURIERS_W47, { account: "03290201" });

console.log(
  JSON.stringify(
    {
      encomendas: processed.length,
      validas: valid.length,
      issues: processed.filter((p) => p.issues.length).length,
      kitchen: {
        totalMeals: kitchen.totalMeals,
        days: kitchen.days.map((d) => ({
          confDay: d.confDay,
          totalMeals: d.totalMeals,
          pratos: d.rows.length,
          top: [...d.rows].sort((a, b) => b.quantity - a.quantity).slice(0, 8),
        })),
        nonMeal: kitchen.nonMeal,
      },
      etiquetas: {
        total: labels.length,
        amostra: labels.slice(0, 5),
      },
      compras: {
        fornecedores: purchases.suppliers.length,
        missingRecipes: purchases.missingRecipes.length,
        missingTop: [...purchases.missingRecipes]
          .sort((a, b) => b.unitsSold - a.unitsSold)
          .slice(0, 6),
        missingUnits: purchases.missingRecipes.reduce(
          (s, m) => s + m.unitsSold,
          0,
        ),
      },
      rotas: routes.map((r) => ({
        courier: r.courier,
        deliveryDate: r.deliveryDate,
        deliveryDay: r.deliveryDay,
        paragens: r.stops.length,
        primeiras: r.stops
          .slice(0, 3)
          .map((s) => ({ enc: s.orderName, cp: s.zip, cidade: s.city, seq: s.sequence })),
      })),
      dpd: {
        shipments: dpd.shipments,
        totalWeightKg: dpd.totalWeightKg,
        totalVolumes: dpd.totalVolumes,
        issues: dpd.issues,
        primeirasLinhas: dpd.csv.split("\r\n").slice(0, 4),
      },
    },
    null,
    2,
  ),
);
