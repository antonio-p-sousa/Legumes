/**
 * Cliente da Admin API por TOKEN estático (custom app), com a mesma interface
 * que o cliente OAuth de `authenticate.admin`. Permite ler a loja SEM o fluxo
 * embebido — basta uma custom app criada no admin da loja que dá um Admin API
 * access token (ver .env.example / docs).
 *
 * Quando `SHOPIFY_SHOP` + `SHOPIFY_ADMIN_TOKEN` estão no ambiente, o provider
 * usa este cliente para o modo "live" sem qualquer alteração de código —
 * plug-and-play no dia em que as credenciais chegarem.
 */
import type { AdminGraphqlClient } from "./graphql.server";

/** Manter em sincronia com app/shopify.server.ts (ApiVersion.October25). */
const ADMIN_API_VERSION = "2025-10";

/** Normaliza o input para o domínio "<handle>.myshopify.com" da Admin API. */
export function normalizeShopDomain(input: string): string {
  const shop = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!shop) return "";
  return shop.includes(".") ? shop : `${shop}.myshopify.com`;
}

/**
 * Cria um AdminGraphqlClient que fala com a Admin API via token estático.
 * `fetchImpl` é injetável para testes; por defeito usa o `fetch` global.
 */
export function createTokenAdminClient(
  shop: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): AdminGraphqlClient {
  const domain = normalizeShopDomain(shop);
  const url = `https://${domain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  return {
    graphql: (query, options) =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: options?.variables }),
      }),
  };
}

/**
 * Cliente por token a partir do ambiente, ou `null` se não estiver configurado
 * (`SHOPIFY_SHOP` e `SHOPIFY_ADMIN_TOKEN`). Sem eles, o provider cai no import
 * de CSV / demo.
 */
export function tokenAdminFromEnv(): AdminGraphqlClient | null {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return null;
  return createTokenAdminClient(shop, token);
}
