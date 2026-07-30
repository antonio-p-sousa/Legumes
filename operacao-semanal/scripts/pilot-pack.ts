/**
 * Pacote do piloto: gera TODOS os documentos de export da semana — os MESMOS
 * conteúdos dos endpoints /app/api/export/* — para uma pasta local, sem
 * servidor nem OAuth (usa o token client, como o live-sanity):
 *
 *   1. preencher no .env (ver .env.example): SHOPIFY_SHOP + credenciais
 *   2. npm run pilot-pack [-- <pasta-saida>]     (default: ./piloto-out)
 *
 * Escreve: cozinha-*.xlsx, compras-*.xlsx, rotas-*.xlsx, rotas-camara-*.xlsx,
 * etiquetas-*.xlsx e dpd-*.csv (nomes com o weekLabel, iguais aos downloads).
 *
 * PRIVACIDADE: os FICHEIROS contêm PII (nomes, moradas, telefones); o stdout
 * NÃO — imprime só contagens e nomes de ficheiros. Nada é escrito na loja.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { tokenAdminFromEnv } from "../app/services/orders/token-client.server";
import { getConfig } from "../app/services/definicoes/config.server";
import { loadRecipes, loadWeekData } from "../app/services/pages/common.server";
import {
  buildCozinhaView,
  weekLabelFileToken,
} from "../app/services/pages/cozinha.server";
import { buildComprasView } from "../app/services/pages/compras.server";
import {
  DPD_DEFAULT_ACCOUNT,
  slugifyWeekLabel,
} from "../app/services/pages/estafetas.server";
import {
  buildChamberDoc,
  buildDpdCsv,
  buildLabels,
  buildRoutes,
} from "../app/services/weekly";
import {
  buildComprasWorkbook,
  buildCozinhaWorkbook,
  buildEtiquetasWorkbook,
  buildRotasCamaraWorkbook,
  buildRotasWorkbook,
} from "../app/services/export/packs.server";

// Loader mínimo de .env (igual ao fetch-live/live-sanity).
try {
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // sem .env — usa o ambiente do processo
}

/** Escreve o ficheiro e imprime SÓ o nome + a contagem (nunca conteúdo). */
function writeDoc(
  outDir: string,
  filename: string,
  content: Buffer | string,
  countLabel: string,
): void {
  writeFileSync(join(outDir, filename), content);
  console.log(`  ✓ ${filename}  (${countLabel})`);
}

async function main() {
  const admin = tokenAdminFromEnv();
  if (!admin) {
    console.error(
      "✗ Falta SHOPIFY_SHOP + credenciais (SHOPIFY_API_KEY/SHOPIFY_API_SECRET " +
        "ou SHOPIFY_ADMIN_TOKEN). Preencher no .env (ver .env.example).",
    );
    process.exit(1);
  }

  const outDir = resolve(process.argv[2] ?? "./piloto-out");
  mkdirSync(outDir, { recursive: true });

  const prisma = new PrismaClient();
  try {
    const [weekData, dishes, recipes, config, supplierRows] = await Promise.all([
      loadWeekData(prisma, admin),
      prisma.dish.findMany({
        select: { baseName: true, category: true },
        orderBy: { baseName: "asc" },
      }),
      loadRecipes(prisma),
      getConfig(prisma),
      prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    ]);

    const { weekLabel } = weekData.meta;
    const token = weekLabelFileToken(weekLabel);
    const slug = slugifyWeekLabel(weekLabel);

    console.log(
      `Semana ${weekLabel} (origem: ${weekData.meta.source}): ` +
        `${weekData.meta.totalOrders} encomendas`,
    );
    console.log(`Pasta de saída: ${outDir}\n`);

    // Cozinha — mesmo workbook de /app/api/export/cozinha
    const cozinhaView = buildCozinhaView(weekData, dishes);
    writeDoc(
      outDir,
      `cozinha-${token}.xlsx`,
      await buildCozinhaWorkbook(cozinhaView),
      `${cozinhaView.days.length + 2} folhas, ${cozinhaView.totalMeals} refeições`,
    );

    // Compras — mesmo workbook de /app/api/export/compras (sem ?fornecedor=)
    const comprasView = buildComprasView(
      weekData,
      recipes,
      config.purchaseMargin,
      supplierRows,
    );
    writeDoc(
      outDir,
      `compras-${slug}.xlsx`,
      await buildComprasWorkbook(comprasView),
      `${comprasView.suppliers.length + 2} folhas, ` +
        `${comprasView.stats.ingredientes} linhas de ingrediente`,
    );

    // Rotas de estafetas — mesmo workbook de /app/api/export/rotas (todas)
    const routes = buildRoutes(weekData.processed, weekData.couriers);
    if (routes.length === 0) {
      console.log("  – rotas: sem rotas nesta semana — ficheiro não gerado");
    } else {
      writeDoc(
        outDir,
        `rotas-${slug}.xlsx`,
        await buildRotasWorkbook(routes),
        `${routes.length} rotas`,
      );
    }

    // Rotas de câmara — mesmo workbook de /app/api/export/rotas-camara
    const chamberDoc = buildChamberDoc(weekData.processed);
    writeDoc(
      outDir,
      `rotas-camara-${slug}.xlsx`,
      await buildRotasCamaraWorkbook(chamberDoc),
      `${chamberDoc.days.length + 1} folhas`,
    );

    // Etiquetas — mesmo workbook de /app/api/export/etiquetas
    const labels = buildLabels(weekData.processed);
    writeDoc(
      outDir,
      `etiquetas-${token}.xlsx`,
      await buildEtiquetasWorkbook(labels),
      `${labels.length} etiquetas`,
    );

    // DPD — mesmo CSV de /app/api/export/dpd (formato contratual, §4.6)
    const dpd = buildDpdCsv(weekData.processed, weekData.couriers, {
      account: config.dpdAccount ?? DPD_DEFAULT_ACCOUNT,
    });
    if (dpd.shipments === 0) {
      console.log("  – dpd: sem envios DPD nesta semana — ficheiro não gerado");
    } else {
      writeDoc(
        outDir,
        `dpd-${slug}.csv`,
        dpd.csv,
        `${dpd.shipments} envios, ${dpd.totalWeightKg} kg`,
      );
    }

    console.log("\n✓ Pacote do piloto completo.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("✗ Falha:", (error as Error).message);
  process.exit(1);
});
