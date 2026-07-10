import type {
  DishDose,
  OrderAttribute,
  OrderType,
  ParsedDelivery,
} from "./types";

/**
 * Faz parse do bloco de customAttributes (Note Attributes) de uma encomenda:
 *
 *   Order Type: Shipping | Store Pickup
 *   Data de entrega: 24/11/2025
 *   Horário de entrega: Lisboa (Centro da cidade) 19-23h
 *   Dia de entrega: Segunda
 *
 * Devolve null quando zona, data ou dia faltam — encomendas sem este bloco
 * são um erro recorrente e têm de ser sinalizadas, nunca descartadas em
 * silêncio (regra 4.1).
 */
export function parseNoteAttributes(
  attrs: OrderAttribute[],
): ParsedDelivery | null {
  const get = (key: string): string | undefined => {
    const found = attrs.find(
      (a) => normalizeKey(a.key) === key && a.value?.trim(),
    );
    return found?.value.trim();
  };

  const orderTypeRaw = get("order type");
  const rawDate = get("data de entrega");
  const zona = get("horario de entrega");
  const dia = get("dia de entrega");

  if (!zona || !rawDate || !dia) return null;

  const deliveryDate = toIsoDate(rawDate);
  if (!deliveryDate) return null;

  const orderType: OrderType =
    orderTypeRaw === "Store Pickup" ? "Store Pickup" : "Shipping";

  return { orderType, deliveryDate, zona, dia };
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** "24/11/2025" | "3/1/26" → "2025-11-24" | "2026-01-03"; null se inválida. */
function toIsoDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getDate() !== Number(day) ||
    date.getMonth() + 1 !== Number(month)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Separa o nome de produto Shopify em prato + dose (regra 4.2).
 * O formato Shopify é "Título do produto - Título da variante"; produtos sem
 * variante (Default Title) vêm só com o título → "Dose Única".
 * Pokes: "M com arroz" normaliza para "M arroz" (idem quinoa/XL).
 */
export function splitDishDose(lineItemName: string): DishDose {
  const name = lineItemName.trim();
  const idx = name.lastIndexOf(" - ");
  if (idx === -1) return { base: name, dose: "Dose Única" };

  const base = name.slice(0, idx).trim();
  const dose = name
    .slice(idx + 3)
    .trim()
    .replace(/\bcom\s+/i, "");

  return { base, dose };
}
