/**
 * Cliente da Admin API por TOKEN, com a mesma interface que o cliente OAuth de
 * `authenticate.admin`. Permite ler a loja SEM o fluxo embebido. Dois modos:
 *
 * 1. TOKEN ESTÁTICO (legacy custom apps, pré-2026): `SHOPIFY_SHOP` +
 *    `SHOPIFY_ADMIN_TOKEN` no ambiente.
 * 2. CLIENT CREDENTIALS (apps do Dev Dashboard, 2026+): `SHOPIFY_SHOP` +
 *    `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET`. A app instalada na loja da
 *    MESMA organização troca as credenciais por um access token de ~24h em
 *    `/admin/oauth/access_token` (grant_type=client_credentials); o token é
 *    cacheado e renovado 60s antes de expirar.
 *
 * Em ambos os casos o provider passa a "live" sem qualquer alteração de código.
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

/** Renovar o token este tempo ANTES de expirar (evita usar um token no limite). */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Cache de tokens client-credentials por loja+app (módulo = processo). */
const tokenCache = new Map<string, CachedToken>();

/** Só para testes: limpa a cache de tokens. */
export function _clearClientCredentialsCache(): void {
  tokenCache.clear();
}

/**
 * Troca client_id+client_secret por um access token da Admin API
 * (client credentials grant — apps do Dev Dashboard instaladas numa loja da
 * mesma organização). Lança erro com mensagem clara se a troca falhar.
 */
async function exchangeClientCredentials(
  domain: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch,
): Promise<{ token: string; expiresInSeconds: number }> {
  const response = await fetchImpl(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Troca de client credentials falhou (HTTP ${response.status}) em ${domain}: ${body.slice(0, 300)}`,
    );
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error(
      `Troca de client credentials sem access_token na resposta de ${domain}.`,
    );
  }
  return {
    token: data.access_token,
    expiresInSeconds: data.expires_in ?? 86_399,
  };
}

/**
 * Cliente Admin API via CLIENT CREDENTIALS (Dev Dashboard, 2026+): obtém o
 * token na primeira chamada, cacheia-o e renova-o 60s antes de expirar.
 * `fetchImpl`/`nowFn` injetáveis para testes.
 */
export function createClientCredentialsAdminClient(
  shop: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch,
  nowFn: () => number = Date.now,
): AdminGraphqlClient {
  const domain = normalizeShopDomain(shop);
  const url = `https://${domain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const cacheKey = `${domain}|${clientId}`;

  async function validToken(): Promise<string> {
    const cached = tokenCache.get(cacheKey);
    if (cached && nowFn() < cached.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return cached.token;
    }
    const { token, expiresInSeconds } = await exchangeClientCredentials(
      domain,
      clientId,
      clientSecret,
      fetchImpl,
    );
    tokenCache.set(cacheKey, {
      token,
      expiresAt: nowFn() + expiresInSeconds * 1000,
    });
    return token;
  }

  return {
    graphql: async (query, options) => {
      const token = await validToken();
      return fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: options?.variables }),
      });
    },
  };
}

/**
 * Cliente por token a partir do ambiente, ou `null` se não estiver configurado.
 * Precedência: token estático (`SHOPIFY_ADMIN_TOKEN`) → client credentials
 * (`SHOPIFY_API_KEY`+`SHOPIFY_API_SECRET`). Sem `SHOPIFY_SHOP` ou sem
 * credenciais, o provider cai no import de CSV / demo.
 */
export function tokenAdminFromEnv(): AdminGraphqlClient | null {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) return null;

  const staticToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (staticToken) return createTokenAdminClient(shop, staticToken);

  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (clientId && clientSecret) {
    return createClientCredentialsAdminClient(shop, clientId, clientSecret);
  }
  return null;
}
