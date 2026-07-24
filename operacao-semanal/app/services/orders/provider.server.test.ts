import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchWeekOrders, type WeekOrders } from "./provider.server";
import type { AdminGraphqlClient } from "./graphql.server";

/**
 * Cobre a ligação da janela de encomendas configurada ao caminho live
 * (bug-1 da auditoria: a janela das Definições era um no-op). O contrato:
 * `fetchWeekOrders(admin, prisma, window)` passa `window` a `fetchLiveOrders`,
 * que a usa no filtro `created_at` da query GraphQL — mas SÓ no modo live;
 * demo/CSV (snapshots) nunca são filtrados.
 */

interface RecordedCall {
  query: string;
  variables: Record<string, unknown> | undefined;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Admin fake sem rede: devolve uma página vazia e regista as chamadas. */
function fakeAdmin(): { admin: AdminGraphqlClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const admin: AdminGraphqlClient = {
    graphql: async (query, options) => {
      calls.push({ query, variables: options?.variables });
      return jsonResponse({
        data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
      });
    },
  };
  return { admin, calls };
}

const WINDOW = {
  windowStart: "2026-07-11T00:00:00Z",
  windowEnd: "2026-07-17T23:59:59Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fetchWeekOrders — janela configurada (bug-1)", () => {
  test("modo live: a janela configurada entra no filtro created_at da query", async () => {
    const { admin, calls } = fakeAdmin();

    const result: WeekOrders = await fetchWeekOrders(admin, undefined, WINDOW);

    expect(result.source).toBe("live");
    expect(calls).toHaveLength(1);
    const search = calls[0].variables?.query as string;
    expect(search).toContain(`created_at:>=${WINDOW.windowStart}`);
    expect(search).toContain(`created_at:<=${WINDOW.windowEnd}`);
  });

  test("sem admin (demo): a janela é ignorada — snapshot não é filtrado", async () => {
    const result = await fetchWeekOrders(null, undefined, WINDOW);

    expect(result.source).toBe("demo");
    // A demo mantém as suas próprias datas (semana 47), não as da janela.
    expect(result.windowStart).not.toBe(WINDOW.windowStart);
  });

  test("DEMO_DATA=1 força demo mesmo com admin e janela", async () => {
    vi.stubEnv("DEMO_DATA", "1");
    const { admin, calls } = fakeAdmin();

    const result = await fetchWeekOrders(admin, undefined, WINDOW);

    expect(result.source).toBe("demo");
    expect(calls).toHaveLength(0); // nunca chega a chamar a API
  });

  test("falha da API degrada para demo com aviso, sem rebentar", async () => {
    const admin: AdminGraphqlClient = {
      graphql: async () =>
        new Response("erro", { status: 500 }),
    };

    const result = await fetchWeekOrders(admin, undefined, WINDOW);

    expect(result.source).toBe("demo");
    expect(result.weekLabel).toContain("falha na ligação à loja");
  });
});
