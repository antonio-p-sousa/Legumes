import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createTokenAdminClient,
  normalizeShopDomain,
  tokenAdminFromEnv,
} from "./token-client.server";

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("tokenAdminFromEnv", () => {
  test("null quando faltam as variáveis", () => {
    vi.stubEnv("SHOPIFY_SHOP", "");
    vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "");
    expect(tokenAdminFromEnv()).toBeNull();
  });

  test("cliente quando ambas presentes", () => {
    vi.stubEnv("SHOPIFY_SHOP", "legumes");
    vi.stubEnv("SHOPIFY_ADMIN_TOKEN", "shpat_x");
    expect(tokenAdminFromEnv()).not.toBeNull();
  });
});
