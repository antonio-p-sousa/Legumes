import type { CourierConfig, DpdResult, ProcessedOrder } from "./types";

/** Nº fixo de colunas do Template_DPD (regra 4.6). */
const DPD_COLUMN_COUNT = 17;
/** País de destino — envios nacionais. */
const COUNTRY_CODE = "PT";
/** Peso estimado: €20 de encomenda ≈ 1 kg. */
const EUR_PER_KG = 20;
/**
 * Limiares → nº de volumes, sobre o SUBTOTAL (sem portes).
 * Confirmado pelo cliente (20 jul 2026): "=SE(Subtotal<80;1;(SE(Subtotal<160;2;3)))"
 * — "a regra é cada volume levar 80€ aproximadamente". O peso usa a mesma
 * base (a coluna do Template_DPD é o Subtotal).
 */
const TWO_VOLUMES_FROM_EUR = 80;
const THREE_VOLUMES_FROM_EUR = 160;

/**
 * Gera o CSV de importação DPD (regra 4.6, formato do Template_DPD):
 * 17 colunas por linha, SEM cabeçalho, separador ";", linhas unidas com \r\n.
 *
 * Entram apenas encomendas cuja zona aponta para um courier de type "dpd".
 * Envios com dados em falta (telefone, morada, código postal) são
 * sinalizados em `issues` mas a linha é incluída na mesma — nunca descartar
 * silenciosamente.
 */
export function buildDpdCsv(
  orders: ProcessedOrder[],
  couriers: CourierConfig[],
  config: { account: string },
): DpdResult {
  const dpdCourierNames = new Set(
    couriers.filter((c) => c.type === "dpd").map((c) => c.name),
  );

  const dpdOrders = orders.filter(
    (p) => p.zone !== undefined && dpdCourierNames.has(p.zone.courierName),
  );

  const account = cleanTextField(config.account);
  const issues: string[] = [];
  const lines: string[] = [];
  let totalWeightKg = 0;
  let totalVolumes = 0;

  for (const { order } of dpdOrders) {
    const address = order.shippingAddress;
    // Nome de ENVIO é o correto (confirmado pelo cliente, 20 jul 2026);
    // fallback para o de faturação quando o de envio vem vazio — era por
    // isso que o processo manual usava faturação.
    const name = cleanTextField(address?.name || order.billingName || "");
    const street = cleanTextField(address?.address1 ?? "");
    // Código postal fica string tal e qual (preserva zeros à esquerda).
    const postalCode = cleanTextField(address?.zip ?? "");
    const city = cleanTextField(address?.city ?? "");
    const mobile = cleanPhone(address?.phone ?? "");
    const weightKg = roundTo(order.subtotalPrice / EUR_PER_KG, 4);
    const volumes = volumesFor(order.subtotalPrice);

    if (!mobile) issues.push(`${order.name}: envio sem telefone`);
    if (!street) issues.push(`${order.name}: envio sem morada`);
    if (!postalCode) issues.push(`${order.name}: envio sem código postal`);

    const fields: string[] = [
      account, // 1. conta
      "", // 2. nr cliente destinatário
      name, // 3. nome
      street, // 4. morada completa
      postalCode, // 5. código postal
      city, // 6. localidade
      COUNTRY_CODE, // 7. país
      "", // 8. telefone fixo
      mobile, // 9. telemóvel (sem +351)
      cleanTextField(order.email), // 10. email
      name, // 11. contacto no destino
      formatWeight(weightKg), // 12. peso (kg, vírgula decimal)
      String(volumes), // 13. volumes
      "", // 14. cobrança
      cleanTextField(order.name), // 15. referência
      cleanTextField(order.note ?? ""), // 16. observações
      "", // 17. código AT
    ];

    if (fields.length !== DPD_COLUMN_COUNT) {
      throw new Error(
        `Linha DPD com ${fields.length} colunas (esperadas ${DPD_COLUMN_COUNT})`,
      );
    }

    totalWeightKg += weightKg;
    totalVolumes += volumes;
    lines.push(fields.join(";"));
  }

  return {
    csv: lines.join("\r\n"),
    shipments: lines.length,
    totalWeightKg: roundTo(totalWeightKg, 2),
    totalVolumes,
    issues,
  };
}

/**
 * Sanitização BASE de um campo do CSV: remove ";" (é o separador) e achata
 * quebras de linha para espaço (uma linha do CSV = um envio). Sem guard de
 * fórmula — é a base do telemóvel, que não pode ganhar uma plica.
 */
function stripCsvControls(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/;/g, "").trim();
}

/**
 * Campo de texto LIVRE: sanitização base + NEUTRALIZAÇÃO de formula/CSV
 * injection.
 *
 * Os nomes/moradas/notas vêm do checkout do cliente (terceiro não-fiável). Um
 * valor que abra com "=", "+", "-", "@" é interpretado como fórmula pelo
 * Excel/Sheets ao abrir o CSV — ex.: um nome "=HYPERLINK(...)" executaria na
 * máquina do operador. Prefixamos uma plica simples (padrão OWASP CSV
 * Injection); o portal DPD recebe o valor com a plica, cosmético e recuperável.
 * (TAB não entra na regex: o trim já remove qualquer TAB inicial.)
 */
function cleanTextField(value: string): string {
  const cleaned = stripCsvControls(value);
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

/**
 * Telemóvel: só sanitização base (NUNCA o guard de fórmula — um número
 * normalizado é só dígitos e o "+" do indicativo não pode virar plica). O
 * portal DPD rejeita o indicativo: remove "+351" e todos os espaços/hífenes.
 * "+351 912 345 678" → "912345678".
 */
function cleanPhone(raw: string): string {
  return stripCsvControls(raw)
    .replace(/[\s-]/g, "")
    .replace(/^\+351/, "");
}

/**
 * Peso com VÍRGULA decimal, até 4 casas, sem zeros à direita desnecessários.
 * 3.2225 → "3,2225" · 2 → "2" · 2.5 → "2,5"
 */
function formatWeight(weightKg: number): string {
  return weightKg
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}

/** Nº de volumes por escalão do subtotal (sem portes). */
function volumesFor(subtotalPrice: number): number {
  if (subtotalPrice < TWO_VOLUMES_FROM_EUR) return 1;
  if (subtotalPrice < THREE_VOLUMES_FROM_EUR) return 2;
  return 3;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
