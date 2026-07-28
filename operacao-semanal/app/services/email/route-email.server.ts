/**
 * Composição dos emails de rotas para os parceiros (transportadoras externas).
 *
 * A partir da vista de Estafetas (rotas já agrupadas por courier + data) e da
 * lista de couriers (com email + CCs), monta uma `EmailMessage` por cada
 * PARCEIRO (type "partner") que tenha email e rotas na semana. Parceiros com
 * rotas mas SEM email vão para `skipped` (sinalizados, não enviados).
 *
 * Funções puras: não tocam em Prisma, Shopify nem no envio. Quem envia (ou
 * simula) é o `EmailProvider` recebido em `sendPartnerRoutes`. Em dry-run,
 * `sendPartnerRoutes` não envia nada.
 */
import type { EstafetasView } from "../pages/estafetas.server";
import type { Route, RouteStop } from "../weekly";
import type { EmailMessage, EmailProvider, EmailResult } from "./provider.server";

/** Forma mínima de um courier necessária para compor os emails. */
export interface PartnerCourier {
  name: string;
  email?: string | null;
  ccEmails: string[];
  type: string;
}

/** Email pronto para um parceiro, com metadados úteis ao preview. */
export interface PartnerEmail {
  courier: string;
  message: EmailMessage;
  /** Total de paragens incluídas (soma das rotas do parceiro). */
  stopCount: number;
  /** Datas de entrega cobertas (yyyy-mm-dd), ordenadas. */
  deliveryDates: string[];
}

/** Parceiro com rotas mas sem forma de contacto — sinalizado, não enviado. */
export interface SkippedPartner {
  courier: string;
  reason: string;
  stopCount: number;
}

export interface PartnerRouteEmails {
  emails: PartnerEmail[];
  skipped: SkippedPartner[];
}

/** Resultado de "enviar" (ou simular) um email de parceiro. */
export interface PartnerSendResult {
  courier: string;
  to: string;
  result: EmailResult;
}

/**
 * Compõe os emails de rotas dos PARCEIROS a partir da vista.
 *
 * Só entram couriers `type === "partner"` COM pelo menos uma rota na semana.
 * Internos e DPD ficam de fora (internos entregam a app; DPD vai por CSV).
 * Parceiros com rotas mas sem email → `skipped`.
 */
export function buildPartnerRouteEmails(
  view: EstafetasView,
  couriers: PartnerCourier[],
): PartnerRouteEmails {
  const partnersByName = new Map(
    couriers
      .filter((courier) => courier.type === "partner")
      .map((courier) => [courier.name, courier] as const),
  );

  // Agrupa as rotas por nome de parceiro, preservando a ordem da vista.
  const routesByPartner = new Map<string, Route[]>();
  for (const route of view.routes) {
    if (!partnersByName.has(route.courier)) continue;
    const existing = routesByPartner.get(route.courier);
    routesByPartner.set(
      route.courier,
      existing ? [...existing, route] : [route],
    );
  }

  const emails: PartnerEmail[] = [];
  const skipped: SkippedPartner[] = [];

  for (const [courierName, routes] of routesByPartner) {
    const courier = partnersByName.get(courierName);
    if (!courier) continue;

    const stopCount = routes.reduce((sum, route) => sum + route.stops.length, 0);
    const email = normalizeEmail(courier.email);

    if (email === null) {
      skipped.push({
        courier: courierName,
        reason: "sem-email",
        stopCount,
      });
      continue;
    }

    const deliveryDates = [...new Set(routes.map((route) => route.deliveryDate))].sort(
      compareStrings,
    );

    emails.push({
      courier: courierName,
      stopCount,
      deliveryDates,
      message: {
        to: email,
        cc: courier.ccEmails.length > 0 ? [...courier.ccEmails] : undefined,
        subject: `Rotas ${courierName} — ${formatDateLabel(deliveryDates)}`,
        text: buildBody(courierName, routes),
      },
    });
  }

  return { emails, skipped };
}

/**
 * "Envia" cada email pelo provider recebido. Em dry-run o provider não envia —
 * apenas regista e devolve `dryRun: true`. Não lança: agrega o resultado de
 * cada parceiro (útil para preview e para envio real futuro).
 */
export async function sendPartnerRoutes(
  provider: EmailProvider,
  emails: PartnerEmail[],
): Promise<PartnerSendResult[]> {
  const results: PartnerSendResult[] = [];
  for (const email of emails) {
    const result = await provider.send(email.message);
    results.push({ courier: email.courier, to: email.message.to, result });
  }
  return results;
}

// ── privados ─────────────────────────────────────────────────────────────────

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Corpo em texto simples com as paragens agrupadas por data de entrega. */
function buildBody(courierName: string, routes: Route[]): string {
  const totalStops = routes.reduce((sum, route) => sum + route.stops.length, 0);

  const blocks = routes.map((route) => {
    const header = `${route.deliveryDay} ${formatDdMmYyyy(route.deliveryDate)} — ${route.stops.length} paragem(ns)`;
    const lines = route.stops.map((stop, index) =>
      formatStop(stop, index + 1),
    );
    return [header, ...lines].join("\n");
  });

  return [
    `Olá ${courierName},`,
    "",
    "Seguem as rotas de entrega da semana:",
    "",
    blocks.join("\n\n"),
    "",
    `Total: ${totalStops} paragem(ns).`,
    "",
    "Obrigado,",
    "Legumes e outros Vícios",
  ].join("\n");
}

/** Uma paragem: encomenda, cliente, morada e janela horária. */
function formatStop(stop: RouteStop, sequence: number): string {
  const seq = stop.sequence ?? sequence;
  const morada = [stop.address1, stop.zip, stop.city]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(", ");

  const parts = [
    `  ${seq}. ${stop.orderName} — ${stop.client || "(sem nome)"}`,
    `     Morada: ${morada || "(sem morada)"}`,
    `     Janela: ${stop.window ?? "(sem janela)"}`,
  ];
  return parts.join("\n");
}

/** ["2025-11-24"] → "24/11/2025"; várias datas → "24/11/2025 a 26/11/2025". */
function formatDateLabel(dates: string[]): string {
  if (dates.length === 0) return "sem data";
  if (dates.length === 1) return formatDdMmYyyy(dates[0]);
  return `${formatDdMmYyyy(dates[0])} a ${formatDdMmYyyy(dates[dates.length - 1])}`;
}

/** "2025-11-24" → "24/11/2025". */
function formatDdMmYyyy(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
