/**
 * Origem "live": encomendas via GraphQL Admin API.
 * Interface estável consumida por provider.server.ts.
 *
 * Campos da query validados contra a doc pública shopify.dev (Admin API
 * 2025-07+): Order.name/email/createdAt/note/tags/displayFinancialStatus/
 * customAttributes/shippingAddress/billingAddress/shippingLine/
 * subtotalPriceSet/totalPriceSet/lineItems existem todos com estes nomes.
 * Notas de formato do payload real:
 *  - `tags` vem como array de strings ([String!]!) → juntamos com ", " para
 *    manter o formato do CSV legado (OrderInput.tags é string).
 *  - Os montantes (MoneyV2.amount) vêm serializados como STRING ("47.9") →
 *    convertemos para número.
 *  - `displayFinancialStatus` é um enum UPPERCASE ("PAID", "PENDING", …) →
 *    passamos para lowercase para paridade com o CSV legado/fixture demo
 *    ("paid").
 *
 * Divergências face ao esboço do ARCHITECTURE.md §8 (documentadas):
 *  - `lineItems(first: 250)` em vez de `first: 50`: 250 é o máximo por página
 *    e evita ter de paginar line items dentro de cada encomenda. Uma encomenda
 *    real tem no máx. ~30 line items, portanto uma página chega sempre; se um
 *    dia excedesse 250, os restantes seriam silenciosamente truncados — não é
 *    um cenário realista neste negócio.
 *  - Campos adicionais ao esboço (note, tags, displayFinancialStatus,
 *    billingAddress{name}, shippingLine{title}): necessários para preencher o
 *    OrderInput completo (o CSV legado trazia estes dados).
 */
import type { OrderInput } from "../weekly/types";
import type { WeekOrders } from "./provider.server";
import { WINDOW_POINT_REGEX } from "../definicoes/config.shared";

/** Forma mínima do cliente devolvido por authenticate.admin(request). */
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * `first: 100` por página (moderado, respeita o custo de query do rate limit)
 * + paginação por cursor. O filtro `$query` usa a search syntax do Shopify.
 */
export const ORDERS_QUERY = `#graphql
  query OrdersInWindow($query: String!, $cursor: String) {
    orders(first: 100, query: $query, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          name
          email
          createdAt
          note
          tags
          displayFinancialStatus
          customAttributes {
            key
            value
          }
          shippingAddress {
            name
            address1
            zip
            city
            phone
          }
          billingAddress {
            name
          }
          shippingLine {
            title
          }
          subtotalPriceSet {
            shopMoney {
              amount
            }
          }
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          lineItems(first: 250) {
            edges {
              node {
                name
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ── Tipos do payload GraphQL (defensivos: tudo opcional/anulável) ───────────

interface MoneyBagNode {
  shopMoney?: { amount?: string | null } | null;
}

export interface GraphqlLineItemNode {
  name?: string | null;
  quantity?: number | null;
  originalUnitPriceSet?: MoneyBagNode | null;
}

export interface GraphqlOrderNode {
  name?: string | null;
  email?: string | null;
  createdAt?: string | null;
  note?: string | null;
  tags?: string[] | null;
  displayFinancialStatus?: string | null;
  customAttributes?: Array<{ key: string; value?: string | null }> | null;
  shippingAddress?: {
    name?: string | null;
    address1?: string | null;
    zip?: string | null;
    city?: string | null;
    phone?: string | null;
  } | null;
  billingAddress?: { name?: string | null } | null;
  shippingLine?: { title?: string | null } | null;
  subtotalPriceSet?: MoneyBagNode | null;
  totalPriceSet?: MoneyBagNode | null;
  lineItems?: { edges?: Array<{ node: GraphqlLineItemNode }> | null } | null;
}

interface OrdersQueryPayload {
  data?: {
    orders?: {
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
      edges?: Array<{ node: GraphqlOrderNode }> | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string }> | null;
}

// ── Mapeamento GraphQL → OrderInput ─────────────────────────────────────────

/** MoneyBag → número; ausente/inválido → 0. */
function toAmount(set: MoneyBagNode | null | undefined): number {
  const parsed = Number(set?.shopMoney?.amount);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Converte um node de order do GraphQL no OrderInput que o motor weekly
 * consome (o mesmo formato do CSV legado / fixture demo). Função pura.
 *
 * Convenções para campos ausentes: strings obrigatórias → "", opcionais →
 * undefined, montantes → 0, listas → [].
 */
export function mapGraphqlOrder(node: GraphqlOrderNode): OrderInput {
  return {
    name: node.name ?? "",
    email: node.email ?? "",
    createdAt: node.createdAt ?? "",
    financialStatus: node.displayFinancialStatus
      ? node.displayFinancialStatus.toLowerCase()
      : undefined,
    note: node.note ?? undefined,
    tags:
      node.tags && node.tags.length > 0 ? node.tags.join(", ") : undefined,
    shippingLine: node.shippingLine?.title ?? undefined,
    customAttributes: (node.customAttributes ?? []).map((attr) => ({
      key: attr.key,
      value: attr.value ?? "",
    })),
    shippingAddress: node.shippingAddress
      ? {
          name: node.shippingAddress.name ?? "",
          address1: node.shippingAddress.address1 ?? "",
          zip: node.shippingAddress.zip ?? "",
          city: node.shippingAddress.city ?? "",
          phone: node.shippingAddress.phone ?? "",
        }
      : undefined,
    billingName: node.billingAddress?.name ?? undefined,
    subtotalPrice: toAmount(node.subtotalPriceSet),
    totalPrice: toAmount(node.totalPriceSet),
    lineItems: (node.lineItems?.edges ?? []).map(({ node: item }) => ({
      name: item.name ?? "",
      quantity: item.quantity ?? 0,
      price: toAmount(item.originalUnitPriceSet),
    })),
  };
}

// ── Janela de encomendas (ARCHITECTURE §4.4) ────────────────────────────────

/** Dia da semana → índice UTC de Date.getUTCDay() (0=domingo … 6=sábado). */
const WEEKDAY_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

interface WindowPoint {
  weekday: number;
  hours: number;
  minutes: number;
}

/** "SAT_00:00" → { weekday: 6, hours: 0, minutes: 0 }; formato inválido → throw. */
function parseWindowPoint(value: string, label: string): WindowPoint {
  const trimmed = value.trim();
  if (!WINDOW_POINT_REGEX.test(trimmed)) {
    throw new Error(
      `Extremo da janela de encomendas inválido (${label}): "${value}". ` +
        'Esperado "DIA_HH:MM", ex.: "SAT_00:00".',
    );
  }
  const [day, time] = trimmed.split("_");
  const [hours, minutes] = time.split(":").map(Number);
  return { weekday: WEEKDAY_INDEX[day], hours, minutes };
}

/** ISO sem milissegundos ("2025-11-28T23:59:59Z") — só chamada com ms=0. */
function toIso(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

/**
 * Converte os extremos configurados ("SAT_00:00" / "FRI_23:59") na janela
 * mais recente que já TERMINOU antes de `now` — a semana a preparar é a que
 * acabou de fechar, nunca a que ainda está a receber encomendas.
 *
 * O fecho é inclusivo ao minuto: "FRI_23:59" → windowEnd às 23:59:59.
 *
 * Exemplos (from="SAT_00:00", to="FRI_23:59"):
 *  - now = domingo 2025-11-30T10:00Z  → 2025-11-22T00:00:00Z … 2025-11-28T23:59:59Z
 *    (sábado da semana ANTERIOR até à sexta 23:59 mais recente)
 *  - now = sexta 2025-11-28T23:58Z    → 2025-11-15T00:00:00Z … 2025-11-21T23:59:59Z
 *    (a janela atual só fecha às 23:59 — ainda não conta; wrap para a anterior)
 *  - now = sábado 2025-11-29T00:01Z   → 2025-11-22T00:00:00Z … 2025-11-28T23:59:59Z
 *    (a janela que fechou sexta à noite)
 *  - now = 2026-01-01T12:00Z (5ª)     → 2025-12-20T00:00:00Z … 2025-12-26T23:59:59Z
 *    (wrap de ano: a sexta mais recente foi em 2025)
 *
 * Tudo calculado em UTC. A loja opera em Europe/Lisbon (UTC+0 no inverno,
 * UTC+1 no verão): no verão o corte real desvia 1h face ao relógio de parede.
 * Aceite nesta fase — o Shopify guarda created_at em UTC e o desvio só afeta
 * encomendas feitas exatamente no minuto do fecho.
 */
export function computeOrderWindow(
  now: Date,
  from: string,
  to: string,
): { windowStart: string; windowEnd: string } {
  const fromPoint = parseWindowPoint(from, "abertura");
  const toPoint = parseWindowPoint(to, "fecho");

  // Candidato a fecho: a hora de fecho no dia UTC de `now`, recuada até ao
  // dia da semana configurado. Segundos a 59 → fecho inclusivo ao minuto.
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      toPoint.hours,
      toPoint.minutes,
      59,
      0,
    ),
  );
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() - toPoint.weekday + 7) % 7));
  // Janela tem de estar terminada: se este fecho ainda não passou (ex.: hoje é
  // sexta 23:58 e o fecho é 23:59), recua uma semana inteira.
  if (end.getTime() >= now.getTime()) {
    end.setUTCDate(end.getUTCDate() - 7);
  }

  // Abertura: a ocorrência mais recente do ponto de abertura antes do fecho.
  const start = new Date(
    Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
      fromPoint.hours,
      fromPoint.minutes,
      0,
      0,
    ),
  );
  start.setUTCDate(
    start.getUTCDate() - ((start.getUTCDay() - fromPoint.weekday + 7) % 7),
  );
  if (start.getTime() >= end.getTime()) {
    start.setUTCDate(start.getUTCDate() - 7);
  }

  return { windowStart: toIso(start), windowEnd: toIso(end) };
}

/**
 * Semana ISO 8601 da data dada → "2025-W48". Algoritmo clássico: a semana ISO
 * de uma data é a semana da 5ª feira mais próxima (2ª como 1º dia da semana).
 */
export function isoWeekLabel(isoDate: string): string {
  const input = new Date(isoDate);
  const thursday = new Date(
    Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
  );
  const weekday = thursday.getUTCDay() || 7; // 1 (2ª) … 7 (domingo)
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(
    ((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7,
  );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Fetch live ───────────────────────────────────────────────────────────────

export interface LiveOrdersOptions {
  /** Janela explícita (ISO). Ausente → janela default calculada de `now`. */
  window?: { windowStart: string; windowEnd: string };
}

/**
 * Defaults do schema AppConfig. Este módulo não tem acesso ao Prisma de
 * propósito (mantém-se puro/testável); numa fase seguinte o common.server.ts
 * lê a AppConfig e passa a janela configurada via `opts.window`.
 */
const DEFAULT_WINDOW_FROM = "SAT_00:00";
const DEFAULT_WINDOW_TO = "FRI_23:59";

/** 50 páginas × 100 orders = 5000 ≫ ~200/semana reais — guarda anti-loop. */
const MAX_PAGES = 50;

/**
 * Carrega as encomendas da janela via GraphQL Admin API, paginando por cursor.
 *
 * Filtro: search syntax do Shopify na variável `$query`, com timestamps
 * ISO 8601 UTC (aceites pela doc):
 *   `created_at:>=2025-11-22T00:00:00Z AND created_at:<=2025-11-28T23:59:59Z`
 *
 * Sem retries: qualquer falha (HTTP, erros GraphQL, payload inesperado) atira
 * um Error claro — o provider degrada para os dados demo (ARCHITECTURE §10).
 */
export async function fetchLiveOrders(
  admin: AdminGraphqlClient,
  opts?: LiveOrdersOptions,
): Promise<WeekOrders> {
  const window =
    opts?.window ??
    computeOrderWindow(new Date(), DEFAULT_WINDOW_FROM, DEFAULT_WINDOW_TO);
  const search = `created_at:>=${window.windowStart} AND created_at:<=${window.windowEnd}`;

  const orders: OrderInput[] = [];
  let cursor: string | null = null;

  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `Paginação de encomendas excedeu ${MAX_PAGES} páginas — ` +
          "cursor possivelmente em loop; abortado por segurança.",
      );
    }

    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { query: search, cursor },
    });
    if (!response.ok) {
      throw new Error(
        `Shopify Admin API: HTTP ${response.status} ao carregar encomendas.`,
      );
    }

    const payload = (await response.json()) as OrdersQueryPayload;
    if (payload.errors && payload.errors.length > 0) {
      const messages = payload.errors
        .map((err) => err.message ?? "erro sem mensagem")
        .join("; ");
      throw new Error(`Shopify Admin API devolveu erros GraphQL: ${messages}`);
    }

    const connection = payload.data?.orders;
    if (!connection) {
      throw new Error(
        "Resposta GraphQL sem `data.orders` — verificar a query e o scope " +
          "read_orders da app.",
      );
    }

    for (const edge of connection.edges ?? []) {
      orders.push(mapGraphqlOrder(edge.node));
    }

    if (!connection.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor ?? null;
    if (!cursor) {
      throw new Error(
        "Paginação inconsistente: hasNextPage=true sem endCursor na resposta.",
      );
    }
  }

  return {
    orders,
    source: "live",
    weekLabel: isoWeekLabel(window.windowEnd),
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    fetchedAt: new Date().toISOString(),
  };
}
