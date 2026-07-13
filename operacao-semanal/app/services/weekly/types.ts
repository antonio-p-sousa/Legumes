/**
 * Tipos partilhados do motor "Operação Semanal".
 * Ver docs/ARCHITECTURE.md secções 4 (regras de negócio) e 6 (módulos).
 *
 * Convenção: funções puras, sem I/O nem dependências de UI/Prisma.
 * Os módulos recebem config como argumentos (zonas, fichas, janela) — quem
 * carrega da BD são os loaders das rotas, não o motor.
 */

// ── Input: encomenda no formato GraphQL Admin API (simplificado) ────────────

export interface OrderAttribute {
  key: string;
  value: string;
}

export interface OrderAddress {
  name: string;
  address1: string;
  zip: string;
  city: string;
  phone: string;
}

export interface OrderLineItem {
  /** Nome do produto Shopify: "Jardineira de Novilho - Bulk" */
  name: string;
  quantity: number;
  price: number;
}

export interface OrderInput {
  /** Nº da encomenda: "#45004-LoV" */
  name: string;
  email: string;
  /** ISO 8601 */
  createdAt: string;
  financialStatus?: string;
  /** Notas do cliente (personalizações, instruções) */
  note?: string;
  tags?: string;
  /** Shipping Method do Shopify (escalão de portes) */
  shippingLine?: string;
  /** Note Attributes: Order Type, Data/Horário/Dia de entrega */
  customAttributes: OrderAttribute[];
  shippingAddress?: OrderAddress;
  billingName?: string;
  subtotalPrice: number;
  totalPrice: number;
  lineItems: OrderLineItem[];
}

// ── Parsing dos atributos de entrega (regra 4.1) ────────────────────────────

export type OrderType = "Shipping" | "Store Pickup";

export interface ParsedDelivery {
  orderType: OrderType;
  /** Data de entrega em ISO (yyyy-mm-dd), convertida de dd/mm/yyyy */
  deliveryDate: string;
  /** Texto da zona, verbatim: "Lisboa (Centro da cidade) 19-23h" */
  zona: string;
  /** Dia por extenso, verbatim: "Segunda" | "Terça" | ... */
  dia: string;
}

// ── Doses (regra 4.2) ────────────────────────────────────────────────────────

export interface DishDose {
  /** Nome base do prato, sem sufixo de dose */
  base: string;
  /** "Low Carb" | "Bulk" | "Extra Bulk" | "Zero Carbs" | "300g" | "450g"
   *  | "M arroz" | "XL quinoa" | ... | "Dose Única" */
  dose: string;
}

// ── Configuração (espelho plain-object dos modelos Prisma) ─────────────────

/**
 * Regra de dia de confeção de uma zona.
 * - "2f" | "3f" | "4f": dia da semana fixo.
 * - "vespera": dia anterior ao de entrega (ex.: DPD nacional, recolhido na
 *   véspera).
 * - "mesmo": o próprio dia de entrega (ex.: recolhas em loja e entregas locais
 *   confecionadas no dia — "quando é recolha, é sempre no próprio dia").
 * "vespera" e "mesmo" são relativas à data de entrega, por isso acompanham
 * qualquer calendário (incluindo domingo) sem reconfiguração.
 */
export type ConfDayRule = "2f" | "3f" | "4f" | "vespera" | "mesmo";

/** Dia de confeção resolvido (segunda=2f ... domingo=dom, sábado=sab). */
export type ConfDay = "2f" | "3f" | "4f" | "5f" | "6f" | "sab" | "dom";

export interface ZoneConfig {
  matchText: string;
  county: string;
  confDay: ConfDayRule;
  courierName: string;
  active: boolean;
}

export interface CourierConfig {
  name: string;
  type: "internal" | "partner" | "dpd";
  email?: string;
  ordering: "manual" | "postcode" | "county";
}

export interface RecipeIngredient {
  name: string;
  /** Quantidade por 1 refeição, na unidade do ingrediente */
  qtyPerMeal: number;
  unit: "kg" | "g" | "ml" | "L" | "un";
  supplier: string;
}

export interface RecipeConfig {
  dish: string;
  dose: string;
  ingredients: RecipeIngredient[];
}

export interface WindowConfig {
  /** ISO 8601 — início da janela (sáb 00:00) */
  windowStart: string;
  /** ISO 8601 — fim da janela (sex 23:59:59) */
  windowEnd: string;
}

// ── Encomenda processada ─────────────────────────────────────────────────────

export interface ProcessedOrder {
  order: OrderInput;
  /** null quando os atributos de entrega faltam ou não fazem parse (4.1) */
  delivery: ParsedDelivery | null;
  /** Zona correspondida na config; undefined se sem match */
  zone?: ZoneConfig;
  /** Dia de confeção resolvido (4.3, incl. regra DPD-véspera) */
  confDay?: ConfDay;
  /** Problemas detetados — nunca descartar silenciosamente */
  issues: string[];
}

// ── Outputs ──────────────────────────────────────────────────────────────────

export interface KitchenRow {
  dish: string;
  dose: string;
  quantity: number;
}

export interface KitchenDay {
  confDay: ConfDay;
  totalMeals: number;
  rows: KitchenRow[];
}

export interface KitchenMap {
  days: KitchenDay[];
  totalMeals: number;
  /** Itens não-cozinha (subscrições, embalagens, tips, vouchers) à parte */
  nonMeal: KitchenRow[];
}

export interface PurchaseLine {
  ingredient: string;
  unit: string;
  required: number;
  withMargin: number;
}

export interface SupplierPurchase {
  supplier: string;
  lines: PurchaseLine[];
}

export interface PurchaseList {
  suppliers: SupplierPurchase[];
  /** Pratos vendidos sem ficha técnica — sinalizar (4.5) */
  missingRecipes: Array<{ dish: string; dose: string; unitsSold: number }>;
}

export interface RouteStop {
  orderName: string;
  client: string;
  phone: string;
  address1: string;
  zip: string;
  city: string;
  subtotal: number;
  note?: string;
  /** Janela horária da zona */
  window?: string;
  /** Posição na rota (1-based) quando ordering != manual */
  sequence?: number;
}

export interface Route {
  courier: string;
  courierType: CourierConfig["type"];
  /** Dia de entrega por extenso ("Segunda") */
  deliveryDay: string;
  /** yyyy-mm-dd */
  deliveryDate: string;
  stops: RouteStop[];
}

export interface DpdResult {
  /** CSV final: 17 colunas, sem cabeçalho, separador ';' (4.6) */
  csv: string;
  shipments: number;
  totalWeightKg: number;
  totalVolumes: number;
  issues: string[];
}

export interface LabelRow {
  orderName: string;
  dish: string;
  client: string;
  /** Data de confeção yyyy-mm-dd */
  confDate: string;
}

// ── Constantes de domínio ────────────────────────────────────────────────────

/** Line items que NÃO são refeições (ficam fora de cozinha/etiquetas/compras). */
export const NON_MEAL_PATTERNS: RegExp[] = [
  /subscri/i,
  /embalagen/i,
  /^tip\b/i,
  /gorjeta/i,
  /voucher/i,
  /cart[aã]o.?(oferta|presente)/i,
];

export function isMealItem(lineItemName: string): boolean {
  return !NON_MEAL_PATTERNS.some((re) => re.test(lineItemName));
}

/** Dias por extenso (PT) → índice 0=domingo … 6=sábado, como Date.getDay(). */
export const DIA_TO_WEEKDAY: Record<string, number> = {
  Domingo: 0,
  Segunda: 1,
  Terça: 2,
  Quarta: 3,
  Quinta: 4,
  Sexta: 5,
  Sábado: 6,
};

export const WEEKDAY_TO_CONFDAY: Record<number, ConfDay> = {
  0: "dom",
  1: "2f",
  2: "3f",
  3: "4f",
  4: "5f",
  5: "6f",
  6: "sab",
};
