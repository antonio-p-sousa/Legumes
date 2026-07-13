/**
 * Fornecedor de encomendas da semana — a costura entre as páginas e a origem
 * dos dados.
 *
 * Duas implementações:
 *  - "live": GraphQL Admin API (graphql.server.ts) — requer a app instalada
 *    numa loja. Ativa quando há um cliente admin e DEMO_DATA não está forçado.
 *  - "demo": a amostra real anonimizada da semana 47/2025 (a mesma do golden
 *    test). Permite desenvolver e demonstrar tudo sem credenciais.
 *
 * Quem consome isto são os loaders (via common.server.ts); o motor weekly
 * nunca sabe de onde vieram as encomendas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrderInput } from "../weekly/types";
import { fetchLiveOrders, type AdminGraphqlClient } from "./graphql.server";

export interface WeekOrders {
  orders: OrderInput[];
  source: "demo" | "live";
  /** "2025-W47 (demonstração)" ou a semana corrente em modo live */
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

/**
 * Devolve as encomendas da semana: live quando possível, demo caso contrário.
 * `admin` é o cliente GraphQL devolvido por authenticate.admin (ou null).
 */
export async function fetchWeekOrders(
  admin: AdminGraphqlClient | null,
): Promise<WeekOrders> {
  const forceDemo = process.env.DEMO_DATA === "1";
  if (!admin || forceDemo) return loadDemoOrders();

  try {
    return await fetchLiveOrders(admin);
  } catch (error) {
    // Falha de API não pode deixar o operador sem página (ARCHITECTURE §10):
    // degrada para demo com aviso explícito no label.
    console.error("fetchLiveOrders falhou; a usar dados de demonstração", error);
    const demo = loadDemoOrders();
    return { ...demo, weekLabel: `${demo.weekLabel} — falha na ligação à loja` };
  }
}
