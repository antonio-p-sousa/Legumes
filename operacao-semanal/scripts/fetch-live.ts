/**
 * Valida a ligação à loja Shopify sem OAuth — o comando a correr no minuto em
 * que as credenciais chegarem:
 *
 *   1. preencher no .env (ver .env.example):
 *      - Dev Dashboard (2026+): SHOPIFY_SHOP + SHOPIFY_API_KEY + SHOPIFY_API_SECRET
 *      - legacy custom app:     SHOPIFY_SHOP + SHOPIFY_ADMIN_TOKEN
 *   2. npm run fetch-live
 *
 * Imprime um resumo SEM dados pessoais (só contagens) — prova que a ligação
 * funciona e que as encomendas da janela estão a ser lidas. Não escreve nada.
 */
import { readFileSync } from "node:fs";
import { tokenAdminFromEnv } from "../app/services/orders/token-client.server";
import { fetchLiveOrders } from "../app/services/orders/graphql.server";

// Loader mínimo de .env (sem dependências): não sobrepõe variáveis já definidas.
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

async function main() {
  const admin = tokenAdminFromEnv();
  if (!admin) {
    console.error(
      "✗ Falta SHOPIFY_SHOP + credenciais (SHOPIFY_API_KEY/SHOPIFY_API_SECRET " +
        "ou SHOPIFY_ADMIN_TOKEN). Preencher no .env (ver .env.example).",
    );
    process.exit(1);
  }

  console.log(`A ligar à loja ${process.env.SHOPIFY_SHOP} ...`);
  const week = await fetchLiveOrders(admin);

  const lineItems = week.orders.reduce((s, o) => s + o.lineItems.length, 0);
  const unidades = week.orders.reduce(
    (s, o) => s + o.lineItems.reduce((a, li) => a + li.quantity, 0),
    0,
  );

  console.log("✓ Ligação OK. Resumo da semana (sem dados pessoais):");
  console.log(`  Semana:       ${week.weekLabel}`);
  console.log(`  Janela:       ${week.windowStart} → ${week.windowEnd}`);
  console.log(`  Encomendas:   ${week.orders.length}`);
  console.log(`  Line items:   ${lineItems}`);
  console.log(`  Unidades:     ${unidades}`);
  console.log(
    "\nA app está pronta a usar dados reais (o provider passa a 'live' automaticamente).",
  );
}

main().catch((error) => {
  console.error("✗ Falha na ligação:", (error as Error).message);
  process.exit(1);
});
