/**
 * Sanidade do motor sobre a loja REAL: busca a semana ao vivo, corre o
 * processOrders com as zonas da BD local e imprime SÓ AGREGADOS — contagens,
 * dias de confeção e textos de zona não reconhecidos (slots de entrega, não
 * dados pessoais). Nada é escrito; nenhuma morada/nome é impresso.
 *
 *   npm run live-sanity
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { tokenAdminFromEnv } from "../app/services/orders/token-client.server";
import { fetchLiveOrders } from "../app/services/orders/graphql.server";
import { processOrders, isMealItem } from "../app/services/weekly/index";
import { loadEngineConfigs } from "../app/services/pages/common.server";

// Loader mínimo de .env (igual ao fetch-live).
try {
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // sem .env
}

async function main() {
  const admin = tokenAdminFromEnv();
  if (!admin) {
    console.error("✗ Credenciais em falta no .env.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const { zones } = await loadEngineConfigs(prisma);
  await prisma.$disconnect();

  console.log(`Zonas ativas na BD local: ${zones.filter((z) => z.active).length}`);
  const week = await fetchLiveOrders(admin);
  const { processed } = processOrders(week.orders, zones);

  const valid = processed.filter((p) => p.issues.length === 0);
  const semAttrs = processed.filter((p) =>
    p.issues.some((i) => i.startsWith("atributos-entrega")),
  );
  const zonaDesc = processed.filter((p) =>
    p.issues.some((i) => i.startsWith("zona-desconhecida")),
  );
  const semCourier = processed.filter((p) =>
    p.issues.some((i) => i.startsWith("zona-sem-estafeta")),
  );

  console.log(`\nSemana ${week.weekLabel}: ${processed.length} encomendas`);
  console.log(`  ✓ válidas (zona+dia resolvidos):  ${valid.length}`);
  console.log(`  ⚠ sem atributos de entrega:       ${semAttrs.length}`);
  console.log(`  ⚠ zona desconhecida:              ${zonaDesc.length}`);
  console.log(`  ⚠ zona sem estafeta:              ${semCourier.length}`);

  // Dias de confeção (agregado)
  const porDia = new Map<string, { encomendas: number; refeicoes: number }>();
  for (const p of valid) {
    const key = p.confDay ?? "sem-dia";
    const cur = porDia.get(key) ?? { encomendas: 0, refeicoes: 0 };
    cur.encomendas += 1;
    cur.refeicoes += p.order.lineItems
      .filter((li) => isMealItem(li.name))
      .reduce((s, li) => s + li.quantity, 0);
    porDia.set(key, cur);
  }
  console.log("\nConfeção por dia (válidas):");
  for (const [dia, v] of [...porDia.entries()].sort()) {
    console.log(`  ${dia}: ${v.encomendas} encomendas, ${v.refeicoes} refeições`);
  }

  // Textos de zona não reconhecidos (são slots de entrega da loja, sem PII)
  const desconhecidas = new Map<string, number>();
  for (const p of zonaDesc) {
    const issue = p.issues.find((i) => i.startsWith("zona-desconhecida"));
    const texto = issue?.replace("zona-desconhecida:", "") ?? "?";
    desconhecidas.set(texto, (desconhecidas.get(texto) ?? 0) + 1);
  }
  if (desconhecidas.size > 0) {
    console.log("\nTextos de zona NÃO reconhecidos (a configurar em Definições):");
    for (const [texto, n] of [...desconhecidas.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)} × "${texto}"`);
    }
  } else {
    console.log("\n✓ Todos os textos de zona foram reconhecidos.");
  }
}

main().catch((error) => {
  console.error("✗ Falha:", (error as Error).message);
  process.exit(1);
});
