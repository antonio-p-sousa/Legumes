/**
 * Resource route: PRÉ-VISUALIZAÇÃO (dry-run) do envio de rotas por email.
 *
 * IMPORTANTE: este endpoint NUNCA envia emails. Monta as mensagens que os
 * parceiros receberiam e devolve um PREVIEW (destinatários, nº de paragens,
 * assunto). Para garantia máxima, o "envio" corre sempre num
 * `DryRunEmailProvider` — mesmo que um fornecedor real venha a ser configurado,
 * esta rota continua a ser só pré-visualização. O envio real, quando o serviço
 * for decidido, será uma ação separada e deliberada (ver provider.server.ts).
 *
 * GET (loader) e POST (action) devolvem o mesmo preview.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildEstafetasView } from "../services/pages/estafetas.server";
import { getConfig } from "../services/definicoes/config.server";
import { listCouriers } from "../services/definicoes/parceiros.server";
import {
  buildPartnerRouteEmails,
  sendPartnerRoutes,
} from "../services/email/route-email.server";
import { DryRunEmailProvider } from "../services/email/provider.server";

export interface RoutePreviewRecipient {
  courier: string;
  to: string;
  cc: string[];
  subject: string;
  stopCount: number;
  deliveryDates: string[];
}

export interface RoutePreviewSkipped {
  courier: string;
  reason: string;
  stopCount: number;
}

export interface RoutePreview {
  /** Sempre true em runtime: esta rota é só pré-visualização. */
  dryRun: boolean;
  /** Sempre false em runtime: nada foi enviado. */
  sent: boolean;
  provider: string;
  weekLabel: string;
  recipients: RoutePreviewRecipient[];
  skipped: RoutePreviewSkipped[];
  note: string;
}

async function buildPreview(request: Request): Promise<RoutePreview> {
  const { admin } = await authenticate.admin(request);

  const [weekData, config, couriers] = await Promise.all([
    loadWeekData(prisma, admin),
    getConfig(prisma),
    listCouriers(prisma),
  ]);

  const view = buildEstafetasView(weekData, config.dpdAccount);
  const { emails, skipped } = buildPartnerRouteEmails(view, couriers);

  // Provider de dry-run FORÇADO: esta rota nunca envia, seja qual for a
  // configuração de EMAIL_PROVIDER. Corre o caminho completo (compose → send)
  // sem que nada saia.
  const provider = new DryRunEmailProvider();
  await sendPartnerRoutes(provider, emails);

  return {
    dryRun: true,
    sent: false,
    provider: provider.name,
    weekLabel: weekData.meta.weekLabel,
    recipients: emails.map((email) => ({
      courier: email.courier,
      to: email.message.to,
      cc: email.message.cc ?? [],
      subject: email.message.subject,
      stopCount: email.stopCount,
      deliveryDates: email.deliveryDates,
    })),
    skipped,
    note: "Pré-visualização (dry-run): nenhum email foi enviado. O envio real fica ativo quando o serviço de email for configurado.",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return buildPreview(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return buildPreview(request);
};
