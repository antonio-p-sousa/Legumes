/**
 * "Rotas de câmara" — o documento que a cozinha usa para separar as refeições
 * já confecionadas na câmara refrigerada, por rota/destino. É DIFERENTE das
 * rotas de estafeta (`routes.ts`): não leva moradas nem telefones, organiza-se
 * pelo dia de PRODUÇÃO/confeção e, dentro de cada dia, por blocos de destino
 * lado a lado, cada linha = `Encomenda | Cliente | nº de REFEIÇÕES`.
 *
 * Espelha o ficheiro real do cliente `00. Rotas.xlsx` (ver
 * docs/RECONCILIACAO-VIDEOS.md, update de 28/07): por dia de confeção, blocos
 * por rota, e uma lista-mestre "refeições por cliente/dia" (no ficheiro é um
 * VLOOKUP; aqui calcula-se diretamente).
 *
 * Função pura, imutável, sem I/O nem dependências de UI/Prisma — igual ao
 * resto do motor. Os rótulos PT dos dias são definidos localmente (como em
 * `types.ts`/`kitchen.ts`) para não importar de `*.server`.
 */
import { isMealItem, WEEKDAY_TO_CONFDAY } from "./types";
import type { ConfDay, OrderInput, ProcessedOrder } from "./types";

// ── Contrato ─────────────────────────────────────────────────────────────────

/** Uma linha do bloco: encomenda, cliente e nº de refeições (não moradas). */
export interface ChamberRow {
  orderName: string;
  client: string;
  meals: number;
}

/** Bloco = destino/rota de um dia de confeção (courier × data de entrega). */
export interface ChamberBlock {
  /** Rótulo do bloco: courier, com ` · <diaPT>` quando o courier tem >1 data. */
  label: string;
  /** Nome do estafeta (ou "Sem estafeta" quando a zona não tem courier). */
  courier: string;
  /** Data de entrega (yyyy-mm-dd) das encomendas do bloco. */
  deliveryDate: string;
  /** Dia de entrega por extenso (PT), derivado da data. */
  deliveryDay: string;
  rows: ChamberRow[];
  totalMeals: number;
}

/** Linha da lista-mestre: refeições por cliente num dia. */
export interface ChamberClient {
  client: string;
  meals: number;
}

/** Um dia de produção/confeção, com os seus blocos e a lista-mestre. */
export interface ChamberDay {
  confDay: ConfDay;
  /** Rótulo PT do dia ("Segunda", ...). */
  label: string;
  blocks: ChamberBlock[];
  /** Lista-mestre "refeições por cliente" do dia, ordenada alfabeticamente. */
  master: ChamberClient[];
  totalMeals: number;
  totalOrders: number;
}

export interface ChamberDoc {
  days: ChamberDay[];
}

// ── Constantes de domínio (locais — mantêm o motor puro) ─────────────────────

/** Rótulos PT dos dias de confeção (espelho de common.server.CONF_DAY_PT). */
const CONF_DAY_PT: Record<ConfDay, string> = {
  "2f": "Segunda",
  "3f": "Terça",
  "4f": "Quarta",
  "5f": "Quinta",
  "6f": "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

/** Ordem de apresentação dos dias de produção (igual a `kitchen.ts`). */
const CONF_DAY_ORDER: readonly ConfDay[] = [
  "2f",
  "3f",
  "4f",
  "5f",
  "6f",
  "sab",
  "dom",
];

/** Rótulo do bloco quando a zona não tem estafeta atribuído (nunca descartar). */
const NO_COURIER_LABEL = "Sem estafeta";

// ── Construção ───────────────────────────────────────────────────────────────

/**
 * Constrói o documento "Rotas de câmara" a partir das encomendas processadas.
 *
 * Regras:
 * - Só entram encomendas com `confDay` resolvido (têm dia de produção); as
 *   restantes são ignoradas (não pertencem à câmara).
 * - `meals` de uma encomenda = soma das quantidades dos line items REFEIÇÃO
 *   (`isMealItem`); embalagens, subscrições, tips e vouchers não contam.
 * - Agrupamento: por `confDay` → por bloco `(zone.courierName, deliveryDate)`.
 *   Zona sem courier (courierName vazio) → bloco "Sem estafeta", nunca
 *   descartada (ARCHITECTURE §10).
 * - `label` do bloco = courier; ganha ` · <diaPT da entrega>` só quando esse
 *   courier tem mais do que uma data de entrega no mesmo dia de produção.
 * - `master` = agregado de refeições por cliente no dia (a lista-mestre).
 * - Invariante interno: `totalMeals` do dia = soma dos blocos = soma do master.
 *
 * Função pura: não muta `orders`.
 */
export function buildChamberDoc(orders: ProcessedOrder[]): ChamberDoc {
  const validOrders = orders.filter((o) => o.confDay !== undefined);

  const dayAccumulators = new Map<ConfDay, DayAccumulator>();

  for (const processed of validOrders) {
    const confDay = processed.confDay as ConfDay;
    const day = getOrCreateDay(dayAccumulators, confDay);

    const courierName = (processed.zone?.courierName ?? "").trim();
    const deliveryDate = processed.delivery?.deliveryDate ?? "";
    const meals = countMeals(processed.order);
    const client = clientName(processed.order);

    day.totalOrders += 1;

    const blockKey = toBlockKey(courierName, deliveryDate);
    const block = getOrCreateBlock(day.blocks, blockKey, courierName, deliveryDate);
    block.rows.push({ orderName: processed.order.name, client, meals });

    day.master.set(client, (day.master.get(client) ?? 0) + meals);

    const dates = day.datesByCourier.get(courierName) ?? new Set<string>();
    dates.add(deliveryDate);
    day.datesByCourier.set(courierName, dates);
  }

  const days = CONF_DAY_ORDER.filter((confDay) =>
    dayAccumulators.has(confDay),
  ).map((confDay) =>
    finalizeDay(confDay, dayAccumulators.get(confDay) as DayAccumulator),
  );

  return { days };
}

// ── Acumuladores internos ────────────────────────────────────────────────────

interface BlockAccumulator {
  courierName: string;
  deliveryDate: string;
  rows: ChamberRow[];
}

interface DayAccumulator {
  blocks: Map<string, BlockAccumulator>;
  master: Map<string, number>;
  /** courierName → conjunto de datas de entrega (decide o sufixo do rótulo). */
  datesByCourier: Map<string, Set<string>>;
  totalOrders: number;
}

function getOrCreateDay(
  days: Map<ConfDay, DayAccumulator>,
  confDay: ConfDay,
): DayAccumulator {
  const existing = days.get(confDay);
  if (existing) return existing;

  const created: DayAccumulator = {
    blocks: new Map(),
    master: new Map(),
    datesByCourier: new Map(),
    totalOrders: 0,
  };
  days.set(confDay, created);
  return created;
}

function getOrCreateBlock(
  blocks: Map<string, BlockAccumulator>,
  key: string,
  courierName: string,
  deliveryDate: string,
): BlockAccumulator {
  const existing = blocks.get(key);
  if (existing) return existing;

  const created: BlockAccumulator = { courierName, deliveryDate, rows: [] };
  blocks.set(key, created);
  return created;
}

/** Chave de bloco (courier, data) — JSON evita colisões de separador. */
function toBlockKey(courierName: string, deliveryDate: string): string {
  return JSON.stringify([courierName, deliveryDate]);
}

function finalizeDay(
  confDay: ConfDay,
  acc: DayAccumulator,
): ChamberDay {
  const blocks = [...acc.blocks.values()]
    .map((block) => finalizeBlock(block, acc))
    .sort(
      (a, b) =>
        a.courier.localeCompare(b.courier, "pt") ||
        compareStrings(a.deliveryDate, b.deliveryDate),
    );

  const master: ChamberClient[] = [...acc.master.entries()]
    .map(([client, meals]) => ({ client, meals }))
    .sort((a, b) => a.client.localeCompare(b.client, "pt"));

  const totalMeals = blocks.reduce((sum, block) => sum + block.totalMeals, 0);

  return {
    confDay,
    label: CONF_DAY_PT[confDay],
    blocks,
    master,
    totalMeals,
    totalOrders: acc.totalOrders,
  };
}

function finalizeBlock(
  block: BlockAccumulator,
  acc: DayAccumulator,
): ChamberBlock {
  const courier =
    block.courierName === "" ? NO_COURIER_LABEL : block.courierName;
  const deliveryDay = weekdayPt(block.deliveryDate);
  const multiDate =
    (acc.datesByCourier.get(block.courierName)?.size ?? 0) > 1;
  const label =
    multiDate && deliveryDay !== "" ? `${courier} · ${deliveryDay}` : courier;

  const rows = [...block.rows].sort(
    (a, b) =>
      a.client.localeCompare(b.client, "pt") ||
      a.orderName.localeCompare(b.orderName, "pt"),
  );
  const totalMeals = rows.reduce((sum, row) => sum + row.meals, 0);

  return {
    label,
    courier,
    deliveryDate: block.deliveryDate,
    deliveryDay,
    rows,
    totalMeals,
  };
}

// ── Helpers puros ────────────────────────────────────────────────────────────

/** Soma as quantidades dos line items que são refeições. */
function countMeals(order: OrderInput): number {
  return order.lineItems
    .filter((item) => isMealItem(item.name))
    .reduce((sum, item) => sum + item.quantity, 0);
}

/** Cliente = faturação, com fallback para o nome de envio, senão vazio. */
function clientName(order: OrderInput): string {
  return order.billingName ?? order.shippingAddress?.name ?? "";
}

/** "2025-11-24" → "Segunda" (weekday UTC → ConfDay → PT). "" se ilegível. */
function weekdayPt(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return "";
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const confDay = WEEKDAY_TO_CONFDAY[new Date(utcMs).getUTCDay()];
  return CONF_DAY_PT[confDay] ?? "";
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
