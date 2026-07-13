/**
 * Fornecedor de encomendas da semana — a costura entre as páginas e a origem
 * dos dados.
 *
 * Três implementações, por ordem de precedência:
 *  - "live": GraphQL Admin API (graphql.server.ts) — requer a app instalada
 *    numa loja. Ativa quando há um cliente admin e DEMO_DATA não está forçado.
 *  - "csv": o import manual mais recente (csv-import.server.ts) — o operador
 *    exporta o CSV de encomendas do Shopify à mão e faz upload em
 *    /app/importar. Ativa quando não há ligação live e existe um import.
 *  - "demo": a amostra real anonimizada da semana 47/2025 (a mesma do golden
 *    test). Permite desenvolver e demonstrar tudo sem credenciais.
 *
 * Quem consome isto são os loaders (via common.server.ts); o motor weekly
 * nunca sabe de onde vieram as encomendas.
 *
 * NOTA PARA O INTEGRADOR: para as páginas passarem a ver os imports manuais,
 * common.server.ts (loadWeekData) só precisa de UMA alteração de linha:
 *   fetchWeekOrders(admin)  →  fetchWeekOrders(admin, prisma)
 * O parâmetro é opcional de propósito para não partir os call sites atuais.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { OrderInput } from "../weekly/types";
import { loadLatestImport } from "./csv-import.server";
import { fetchLiveOrders, type AdminGraphqlClient } from "./graphql.server";

export interface WeekOrders {
  orders: OrderInput[];
  source: "demo" | "live" | "csv";
  /** "2025-W47 (demonstração)", o rótulo do import manual, ou a semana live */
  weekLabel: string;
  /** ISO — limites reais das encomendas carregadas */
  windowStart: string;
  windowEnd: string;
  fetchedAt: string;
}

const DEMO_FIXTURE = join(
  process.cwd(),
  "test",
  "fixtures",
  "w47-orders.json",
);

export function loadDemoOrders(): WeekOrders {
  let raw: string;
  try {
    raw = readFileSync(DEMO_FIXTURE, "utf-8");
  } catch (cause) {
    throw new Error(
      `Fixture de demonstração em falta: ${DEMO_FIXTURE}. ` +
        "Sem ligação à loja, as páginas precisam desta amostra para funcionar.",
      { cause },
    );
  }
  const orders = JSON.parse(raw) as OrderInput[];
  const created = orders.map((o) => o.createdAt).sort();
  return {
    orders,
    source: "demo",
    weekLabel: "2025-W47 (demonstração)",
    windowStart: created[0] ?? "",
    windowEnd: created[created.length - 1] ?? "",
    fetchedAt: new Date().toISOString(),
  };
}

/** Sem live: import manual mais recente se existir, senão demonstração. */
async function loadFallbackOrders(prisma?: PrismaClient): Promise<WeekOrders> {
  if (prisma) {
    const imported = await loadLatestImport(prisma);
    if (imported) return imported;
  }
  return loadDemoOrders();
}

/**
 * Devolve as encomendas da semana: live quando possível, senão o import
 * manual de CSV mais recente, senão demo.
 * `admin` é o cliente GraphQL devolvido por authenticate.admin (ou null).
 * `prisma` é opcional: sem ele o comportamento live/demo é o de sempre.
 */
export async function fetchWeekOrders(
  admin: AdminGraphqlClient | null,
  prisma?: PrismaClient,
): Promise<WeekOrders> {
  const forceDemo = process.env.DEMO_DATA === "1";
  if (!admin || forceDemo) return loadFallbackOrders(prisma);

  try {
    return await fetchLiveOrders(admin);
  } catch (error) {
    // Falha de API não pode deixar o operador sem página (ARCHITECTURE §10):
    // degrada para import/demo com aviso explícito no label.
    console.error("fetchLiveOrders falhou; a usar dados locais", error);
    const fallback = await loadFallbackOrders(prisma);
    return {
      ...fallback,
      weekLabel: `${fallback.weekLabel} — falha na ligação à loja`,
    };
  }
}
