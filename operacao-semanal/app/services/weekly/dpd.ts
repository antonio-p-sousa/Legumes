import type { CourierConfig, DpdResult, ProcessedOrder } from "./types";

/** Nº fixo de colunas do Template_DPD (regra 4.6). */
const DPD_COLUMN_COUNT = 17;
/** País de destino — envios nacionais. */
const COUNTRY_CODE = "PT";
/** Peso estimado: €20 de encomenda ≈ 1 kg. */
const EUR_PER_KG = 20;
/** Limiares de preço total → nº de volumes. */
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
    const name = cleanTextField(address?.name ?? "");
    const street = cleanTextField(address?.address1 ?? "");
    // Código postal fica string tal e qual (preserva zeros à esquerda).
    const postalCode = cleanTextField(address?.zip ?? "");
    const city = cleanTextField(address?.city ?? "");
    const mobile = cleanPhone(address?.phone ?? "");
    const weightKg = roundTo(order.totalPrice / EUR_PER_KG, 4);
    const volumes = volumesFor(order.totalPrice);

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
 * Limpeza global de campos de texto: remove ";" (é o separador do CSV) e
 * achata quebras de linha para espaço (uma linha do CSV = um envio).
 */
function cleanTextField(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/;/g, "").trim();
}

/**
 * O portal DPD rejeita o indicativo: remove o prefixo "+351" e TODOS os
 * espaços e hífenes. "+351 912 345 678" → "912345678".
 */
function cleanPhone(raw: string): string {
  return cleanTextField(raw)
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

/** Nº de volumes por escalão de preço total. */
function volumesFor(totalPrice: number): number {
  if (totalPrice < TWO_VOLUMES_FROM_EUR) return 1;
  if (totalPrice < THREE_VOLUMES_FROM_EUR) return 2;
  return 3;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
