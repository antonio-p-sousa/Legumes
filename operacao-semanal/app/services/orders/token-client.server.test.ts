import { afterEach, describe, expect, test, vi } from "vitest";
import {
  _clearClientCredentialsCache,
  createClientCredentialsAdminClient,
  createTokenAdminClient,
  normalizeShopDomain,
  tokenAdminFromEnv,
} from "./token-client.server";

afterEach(() => {
  vi.unstubAllEnvs();
  _clearClientCredentialsCache();
});

describe("normalizeShopDomain", () => {
  test("handle simples ganha .myshopify.com", () => {
    expect(normalizeShopDomain("legumes-e-outros-vicios")).toBe(
      "legumes-e-outros-vicios.myshopify.com",
    );
  });

  test("domínio completo fica intacto", () => {
    expect(normalizeShopDomain("loja.myshopify.com")).toBe("loja.myshopify.com");
  });

  test("remove protocolo e caminho", () => {
    expect(normalizeShopDomain("https://loja.myshopify.com/admin")).toBe(
      "loja.myshopify.com",
    );
  });

  test("vazio → vazio", () => {
    expect(normalizeShopDomain("   ")).toBe("");
  });
});

describe("createTokenAdminClient", () => {
  test("faz POST ao endpoint da Admin API com o token e as variáveis", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const client = createTokenAdminClient("legumes", "shpat_x", fakeFetch);
    await client.graphql("query { shop { name } }", {
      variables: { a: 1 },
    });

    expect(captured.url).toBe(
      "https://legumes.myshopify.com/admin/api/2025-10/graphql.json",
    );
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe("shpat_x");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(captured.init?.body as string);
    expect(body.query).toContain("shop");
    expect(body.variables).toEqual({ a: 1 });
  });
});

/** fetch falso para o fluxo client credentials: 1º POST = troca de token, seguintes = GraphQL. */
function fakeCredentialsFetch(opts?: { expiresIn?: number; failExchange?: boolean }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/admin/oauth/access_token")) {
      if (opts?.failExchange) {
        return new Response('{"error":"shop_not_permitted"}', { status: 400 });
      }
      const n = calls.filter((c) => c.url.endsWith("/access_token")).length;
      return new Response(
        JSON.stringify({ access_token: `tok_${n}`, expires_in: opts?.expiresIn ?? 86_399 }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("createClientCredentialsAdminClient", () => {
  test("troca as credenciais e usa o token no GraphQL", async () => {
    const { impl, calls } = fakeCredentialsFetch();
    const client = createClientCredentialsAdminClient("legumes", "cid", "sec", impl);
    await client.graphql("query { shop { name } }");

    expect(calls[0].url).toBe("https://legumes.myshopify.com/admin/oauth/access_token");
    const form = new URLSearchParams(calls[0].init?.body as string);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("sec");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    expect(calls[1].url).toBe("https://legumes.myshopify.com/admin/api/2025-10/graphql.json");
    expect((calls[1].init?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(
      "tok_1",
    );
  });

  test("cacheia o token entre chamadas (uma troca para dois GraphQL)", async () => {
    const { impl, calls } = fakeCredentialsFetch();
    const client = createClientCredentialsAdminClient("legumes", "cid", "sec", impl);
    await client.graphql("query A");
    await client.graphql("query B");
    expect(calls.filter((c) => c.url.endsWith("/access_token"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/graphql.json"))).toHaveLength(2);
  });

  test("renova o token quando está a menos de 60s de expirar", async () => {
    const { impl, calls } = fakeCredentialsFetch({ expiresIn: 100 });
    let now = 1_000_000;
    const client = createClientCredentialsAdminClient("legumes", "cid", "sec", impl, () => now);
    await client.graphql("query A"); // troca 1 (expira em now+100s)
    now += 50_000; // faltam 50s < buffer de 60s → renova
    await client.graphql("query B"); // troca 2
    expect(calls.filter((c) => c.url.endsWith("/access_token"))).toHaveLength(2);
    const graphqlCalls = calls.filter((c) => c.url.endsWith("/graphql.json"));
    expect(
      (graphqlCalls[1].init?.headers as Record<string, string>)["X-Shopify-Access-Token"],
    ).toBe("tok_2");
  });

  test("troca falhada lança erro com o estado HTTP (o provider degrada para fallback)", async () => {
    const { impl } = fakeCredentialsFetch({ failExchange: true });
    const client = createClientCredentialsAdminClient("legumes", "cid", "sec", impl);
    await expect(client.graphql("query A")).rejects.toThrow(/HTTP 400/);
  });

  test("a cache é por loja+app (lojas diferentes não partilham token)", async () => {
    const a = fakeCredentialsFetch();
    const b = fakeCredentialsFetch();
    await createClientCredentialsAdminClient("loja-a", "cid", "sec", a.impl).graphql("q");
    await createClientCredentialsAdminClient("loja-b", "cid", "sec", b.impl).graphql("q");
    expect(a.calls.filter((c) => c.url.endsWith("/access_token"))).toHaveLength(1);
    expect(b.calls.filter((c) => c.url.endsWith("/access_token"))).toHaveLength(1);
  });
});

describe("tokenAdminFromEnv", () => {
  test("null quando faltam as variáveis", () => {
    vi.stubEnv("SHOPIFY_SHOP", "");
    vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "");
    vi.stubEnv("SHOPIFY_API_KEY", "");
    vi.stubEnv("SHOPIFY_API_SECRET", "");
    expect(tokenAdminFromEnv()).toBeNull();
  });

  test("cliente por token estático quando SHOP+ADMIN_TOKEN presentes", () => {
    vi.stubEnv("SHOPIFY_SHOP", "legumes");
    vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "shpat_x");
    expect(tokenAdminFromEnv()).not.toBeNull();
  });

  test("cliente client-credentials quando SHOP+API_KEY+API_SECRET presentes (sem token estático)", () => {
    vi.stubEnv("SHOPIFY_SHOP", "legumes");
    vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "");
    vi.stubEnv("SHOPIFY_API_KEY", "cid");
    vi.stubEnv("SHOPIFY_API_SECRET", "sec");
    expect(tokenAdminFromEnv()).not.toBeNull();
  });

  test("null com SHOP mas sem qualquer credencial", () => {
    vi.stubEnv("SHOPIFY_SHOP", "legumes");
    vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "");
    vi.stubEnv("SHOPIFY_API_KEY", "");
    vi.stubEnv("SHOPIFY_API_SECRET", "");
    expect(tokenAdminFromEnv()).toBeNull();
  });
});
