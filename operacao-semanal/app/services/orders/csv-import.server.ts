/**
 * Importação manual do CSV de encomendas do Shopify — o caminho de dados
 * quando a app ainda NÃO tem credenciais da loja: o operador exporta o CSV
 * à mão (Encomendas → Exportar) e faz upload em /app/importar.
 *
 * O parse replica a transformação de scripts/generate-fixtures.py (a mesma
 * que gerou as fixtures w47): o export clássico tem 75 colunas, uma linha
 * por line item; a 1ª linha de cada encomenda traz os dados completos e as
 * seguintes só os campos Lineitem* — daí o agrupamento por "Name"
 * (forward-fill). Ver docs/ARCHITECTURE.md secção 6 (nota sobre o CSV legado).
 *
 * O resultado é OrderInput[] — exatamente o formato que o motor weekly e o
 * provider live/demo já usam — guardado como snapshot num WeekRun com
 * weekLabel prefixado por "import-".
 */
import Papa from "papaparse";
import type { PrismaClient, WeekRun } from "@prisma/client";
import type {
  OrderAttribute,
  OrderInput,
  OrderLineItem,
} from "../weekly/types";
import type { WeekOrders } from "./provider.server";

// ── Constantes ───────────────────────────────────────────────────────────────

/** Prefixo que distingue snapshots de import manual de outros WeekRun. */
export const IMPORT_LABEL_PREFIX = "import-";

/** Sem estas colunas não há encomendas para reconstruir. */
const REQUIRED_COLUMNS = ["Name", "Lineitem name", "Lineitem quantity"] as const;

/** Colunas que enriquecem a encomenda; a falta gera warning, não erro. */
const EXPECTED_COLUMNS = [
  "Email",
  "Created at",
  "Financial Status",
  "Notes",
  "Note Attributes",
  "Tags",
  "Shipping Method",
  "Subtotal",
  "Total",
  "Lineitem price",
  "Billing Name",
  "Shipping Name",
  "Shipping Address1",
  "Shipping Zip",
  "Shipping City",
  "Shipping Phone",
] as const;

const DEFAULT_LIST_LIMIT = 10;

/** "2025-11-22 01:28:43 +0000" (formato do export Shopify). */
const SHOPIFY_DATE_RE =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/;

// ── Erro estruturado ─────────────────────────────────────────────────────────

/** Erro de validação do CSV — mensagem pronta a mostrar ao operador. */
export class CsvImportError extends Error {
  readonly missingColumns: string[];

  constructor(message: string, missingColumns: string[] = []) {
    super(message);
    this.name = "CsvImportError";
    this.missingColumns = missingColumns;
  }
}

// ── Parse ────────────────────────────────────────────────────────────────────

export interface CsvParseResult {
  orders: OrderInput[];
  /** Problemas não-fatais — mostrar ao operador, nunca descartar em silêncio. */
  warnings: string[];
}

type CsvRow = Record<string, string>;

function cell(row: CsvRow, column: string): string {
  return (row[column] ?? "").trim();
}

/** "Chave: valor" por linha → OrderAttribute[] (mesma semântica do Python). */
function parseNoteAttributes(raw: string): OrderAttribute[] {
  const attributes: OrderAttribute[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(":")) continue;
    const separator = trimmed.indexOf(":");
    attributes.push({
      key: trimmed.slice(0, separator).trim(),
      value: trimmed.slice(separator + 1).trim(),
    });
  }
  return attributes;
}

/** "2025-11-22 01:28:43 +0000" → "2025-11-22T01:28:43+00:00" (ISO 8601). */
function toIso(raw: string, orderName: string, warnings: string[]): string {
  if (!raw) return "";
  const match = SHOPIFY_DATE_RE.exec(raw);
  if (match) {
    const [, date, time, sign, offsetHours, offsetMinutes] = match;
    return `${date}T${time}${sign}${offsetHours}:${offsetMinutes}`;
  }
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  warnings.push(
    `Encomenda ${orderName}: data "Created at" irreconhecível ("${raw}") — ficou vazia.`,
  );
  return "";
}

/** Números do Shopify vêm com ponto decimal; vazio → 0. */
function toMoney(raw: string): number {
  if (!raw) return 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function buildLineItems(
  orderName: string,
  rows: CsvRow[],
  warnings: string[],
): OrderLineItem[] {
  const items: OrderLineItem[] = [];
  for (const row of rows) {
    const name = cell(row, "Lineitem name");
    if (!name) {
      warnings.push(
        `Encomenda ${orderName}: linha sem "Lineitem name" — item ignorado.`,
      );
      continue;
    }
    const rawQuantity = cell(row, "Lineitem quantity");
    const quantity = Number.parseInt(rawQuantity, 10);
    if (!Number.isFinite(quantity)) {
      warnings.push(
        `Encomenda ${orderName}: quantidade inválida ("${rawQuantity}") em "${name}" — assumido 0.`,
      );
    }
    items.push({
      name,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      price: toMoney(cell(row, "Lineitem price")),
    });
  }
  return items;
}

function buildShippingAddress(
  first: CsvRow,
): OrderInput["shippingAddress"] | undefined {
  const hasAny = [
    "Shipping Name",
    "Shipping Address1",
    "Shipping City",
    "Shipping Zip",
  ].some((column) => cell(first, column));
  if (!hasAny) return undefined;
  return {
    name: cell(first, "Shipping Name"),
    address1: cell(first, "Shipping Address1"),
    zip: cell(first, "Shipping Zip"),
    city: cell(first, "Shipping City"),
    phone: cell(first, "Shipping Phone"),
  };
}

function buildOrder(
  orderName: string,
  rows: CsvRow[],
  warnings: string[],
): OrderInput {
  const first = rows[0];
  if (!cell(first, "Email") && !cell(first, "Created at")) {
    warnings.push(
      `Encomenda ${orderName}: a primeira linha não tem os dados completos ` +
        `(Email e "Created at" vazios) — cliente, moradas e totais podem faltar.`,
    );
  }
  return {
    name: orderName,
    email: cell(first, "Email"),
    createdAt: toIso(cell(first, "Created at"), orderName, warnings),
    financialStatus: cell(first, "Financial Status") || undefined,
    note: cell(first, "Notes") || undefined,
    tags: cell(first, "Tags") || undefined,
    shippingLine: cell(first, "Shipping Method") || undefined,
    customAttributes: parseNoteAttributes(first["Note Attributes"] ?? ""),
    shippingAddress: buildShippingAddress(first),
    billingName: cell(first, "Billing Name") || undefined,
    subtotalPrice: toMoney(cell(first, "Subtotal")),
    totalPrice: toMoney(cell(first, "Total")),
    lineItems: buildLineItems(orderName, rows, warnings),
  };
}

/**
 * Export clássico do Shopify (75 colunas, 1 linha por line item) → OrderInput[].
 *
 * Agrupa por "Name": a 1ª linha de cada encomenda tem os dados completos, as
 * seguintes só os Lineitem*. Linha sem "Name" é forward-filled para a
 * encomenda anterior (com warning); sem encomenda anterior é ignorada (órfã).
 *
 * @throws CsvImportError quando faltam as colunas mínimas ou o ficheiro
 *   está vazio — mensagem em pt-PT pronta a mostrar.
 */
export function parseShopifyOrdersCsv(csvText: string): CsvParseResult {
  if (!csvText.trim()) {
    throw new CsvImportError(
      "O ficheiro está vazio. Exporta as encomendas no Shopify em " +
        "Encomendas → Exportar e volta a tentar.",
    );
  }

  const parsed = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const columns = parsed.meta.fields ?? [];
  const missingRequired = REQUIRED_COLUMNS.filter(
    (column) => !columns.includes(column),
  );
  if (missingRequired.length > 0) {
    throw new CsvImportError(
      "O ficheiro não parece ser um export de encomendas do Shopify: " +
        `faltam as colunas obrigatórias ${missingRequired
          .map((column) => `"${column}"`)
          .join(", ")}. ` +
        "Usa Encomendas → Exportar → formato «CSV simples» sem alterar as colunas.",
      [...missingRequired],
    );
  }

  const warnings: string[] = [];

  const missingExpected = EXPECTED_COLUMNS.filter(
    (column) => !columns.includes(column),
  );
  if (missingExpected.length > 0) {
    warnings.push(
      `Colunas em falta no export: ${missingExpected
        .map((column) => `"${column}"`)
        .join(", ")} — os campos correspondentes ficam vazios.`,
    );
  }

  for (const parseError of parsed.errors.slice(0, 5)) {
    warnings.push(
      `Problema de formato no CSV (linha ${parseError.row ?? "?"}): ${parseError.message}`,
    );
  }

  // Agrupamento por Name com forward-fill de linhas sem Name (CSV legado).
  const grouped = new Map<string, CsvRow[]>();
  let previousName = "";
  parsed.data.forEach((row, index) => {
    const dataLine = index + 1; // 1-based, sem contar o cabeçalho
    let name = cell(row, "Name");
    if (!name) {
      if (!previousName) {
        warnings.push(
          `Linha de dados ${dataLine} sem "Name" e sem encomenda anterior — ignorada (linha órfã).`,
        );
        return;
      }
      warnings.push(
        `Linha de dados ${dataLine} sem "Name" — associada à encomenda anterior ${previousName}.`,
      );
      name = previousName;
    }
    previousName = name;
    const rows = grouped.get(name);
    if (rows) {
      rows.push(row);
    } else {
      grouped.set(name, [row]);
    }
  });

  if (grouped.size === 0) {
    warnings.push("O CSV tem cabeçalho mas nenhuma linha de encomenda.");
  }

  const orders = Array.from(grouped.entries(), ([orderName, rows]) =>
    buildOrder(orderName, rows, warnings),
  );

  return { orders, warnings };
}

// ── Persistência (WeekRun com prefixo "import-") ─────────────────────────────

export interface ImportSummary {
  id: string;
  weekLabel: string;
  /** ISO 8601 — serializável no loader */
  generatedAt: string;
  orderCount: number;
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function countOrders(ordersJson: string): number {
  try {
    const parsed = JSON.parse(ordersJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** Grava o import como snapshot WeekRun ("import-<yyyy-mm-dd hh:mm> — <ficheiro>"). */
export async function saveImport(
  prisma: PrismaClient,
  orders: OrderInput[],
  filename: string,
): Promise<WeekRun> {
  return prisma.weekRun.create({
    data: {
      weekLabel: `${IMPORT_LABEL_PREFIX}${formatStamp(new Date())} — ${filename}`,
      ordersJson: JSON.stringify(orders),
    },
  });
}

/** Últimos imports manuais, do mais recente para o mais antigo. */
export async function listImports(
  prisma: PrismaClient,
  limit = DEFAULT_LIST_LIMIT,
): Promise<ImportSummary[]> {
  const runs = await prisma.weekRun.findMany({
    where: { weekLabel: { startsWith: IMPORT_LABEL_PREFIX } },
    orderBy: { generatedAt: "desc" },
    take: limit,
  });
  return runs.map((run) => ({
    id: run.id,
    weekLabel: run.weekLabel,
    generatedAt: run.generatedAt.toISOString(),
    orderCount: countOrders(run.ordersJson),
  }));
}

/**
 * O import manual mais recente como WeekOrders (source "csv"), ou null.
 * windowStart/End = min/max do createdAt das encomendas importadas.
 */
export async function loadLatestImport(
  prisma: PrismaClient,
): Promise<WeekOrders | null> {
  const run = await prisma.weekRun.findFirst({
    where: { weekLabel: { startsWith: IMPORT_LABEL_PREFIX } },
    orderBy: { generatedAt: "desc" },
  });
  if (!run) return null;

  let orders: OrderInput[];
  try {
    orders = JSON.parse(run.ordersJson) as OrderInput[];
  } catch (error) {
    // Snapshot corrompido não pode derrubar as páginas — trata como inexistente.
    console.error(`Import ${run.id} com ordersJson inválido; ignorado`, error);
    return null;
  }

  const created = orders
    .map((order) => order.createdAt)
    .filter(Boolean)
    .sort();

  return {
    orders,
    source: "csv",
    weekLabel: run.weekLabel,
    windowStart: created[0] ?? "",
    windowEnd: created[created.length - 1] ?? "",
    fetchedAt: run.generatedAt.toISOString(),
  };
}

/** Elimina um import manual. Devolve false se já não existir (ou não for import). */
export async function deleteImport(
  prisma: PrismaClient,
  id: string,
): Promise<boolean> {
  const result = await prisma.weekRun.deleteMany({
    where: { id, weekLabel: { startsWith: IMPORT_LABEL_PREFIX } },
  });
  return result.count > 0;
}
