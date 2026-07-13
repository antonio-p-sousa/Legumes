import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createZone,
  deleteZone,
  listZones,
  toggleZoneActive,
} from "../services/definicoes/zonas.server";
import {
  CONF_DAY_LABELS,
  CONF_DAY_RULES,
  type ConfDayRule,
} from "../services/definicoes/zonas.shared";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [zones, couriers] = await Promise.all([
    listZones(prisma),
    prisma.courier.findMany({ orderBy: { name: "asc" } }),
  ]);

  return { zones, couriers };
};

type ActionResult =
  | { ok: true; intent: string; message: string; zoneId?: string }
  | {
      ok: false;
      intent: string;
      errors: Record<string, string>;
      values?: Record<string, string>;
    };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create") {
    const values = {
      matchText: String(formData.get("matchText") ?? ""),
      county: String(formData.get("county") ?? ""),
      confDay: String(formData.get("confDay") ?? ""),
      courierId: String(formData.get("courierId") ?? ""),
    };
    const result = await createZone(prisma, values);
    if (!result.ok) {
      return { ok: false, intent, errors: result.errors, values };
    }
    return {
      ok: true,
      intent,
      message: `Zona "${result.zone.matchText}" criada.`,
      zoneId: result.zone.id,
    };
  }

  const zoneId = String(formData.get("zoneId") ?? "");

  if (intent === "toggle") {
    const result = await toggleZoneActive(prisma, zoneId);
    if (!result.ok) return { ok: false, intent, errors: result.errors };
    return {
      ok: true,
      intent,
      message: result.zone.active
        ? `Zona "${result.zone.matchText}" ativada.`
        : `Zona "${result.zone.matchText}" desativada — deixa de entrar nos cálculos da semana.`,
    };
  }

  if (intent === "delete") {
    const result = await deleteZone(prisma, zoneId);
    if (!result.ok) return { ok: false, intent, errors: result.errors };
    return { ok: true, intent, message: "Zona eliminada." };
  }

  return {
    ok: false,
    intent,
    errors: { intent: "Operação desconhecida. Atualiza a página e tenta de novo." },
  };
};

const CONF_DAY_BADGE_TONE: Record<ConfDayRule, "info" | "warning"> = {
  "2f": "info",
  "3f": "info",
  "4f": "info",
  vespera: "warning",
};

function confDayLabel(confDay: string): string {
  return CONF_DAY_LABELS[confDay as ConfDayRule] ?? confDay;
}

function confDayTone(confDay: string): "info" | "warning" | "neutral" {
  return CONF_DAY_BADGE_TONE[confDay as ConfDayRule] ?? "neutral";
}

export default function Zonas() {
  const { zones, couriers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  const createErrors: Record<string, string> =
    actionData && !actionData.ok && actionData.intent === "create"
      ? actionData.errors
      : {};
  const createValues: Record<string, string> =
    actionData && !actionData.ok && actionData.intent === "create"
      ? (actionData.values ?? {})
      : {};
  const generalError =
    actionData && !actionData.ok && actionData.intent !== "create"
      ? Object.values(actionData.errors)[0]
      : undefined;
  const createFormKey =
    actionData?.ok && actionData.intent === "create" && actionData.zoneId
      ? actionData.zoneId
      : "nova-zona";

  return (
    <s-page heading="Zonas & dias">
      <s-section heading="Zonas de entrega">
        <s-banner tone="info" heading="Regra «Véspera da entrega» (DPD)">
          <s-paragraph>
            As zonas com confeção «Véspera da entrega» seguem a regra da
            recolha DPD: a encomenda é recolhida no dia anterior ao da entrega
            e por isso entra na produção desse dia anterior. Exemplo: entrega
            à Terça → recolha e confeção na Segunda.
          </s-paragraph>
        </s-banner>

        {generalError && (
          <s-banner
            tone="critical"
            heading="Não foi possível concluir a operação"
          >
            <s-paragraph>{generalError}</s-paragraph>
          </s-banner>
        )}

        {zones.length === 0 ? (
          <s-banner tone="info" heading="Ainda não há zonas configuradas">
            <s-paragraph>
              Sem zonas, o motor não consegue fazer o match do atributo
              «Horário de entrega» das encomendas — ficariam todas sinalizadas
              como «sem zona». Cria abaixo uma zona por cada texto de zona
              usado na loja. Nota: o seed inicial da app pode criar
              automaticamente as zonas atuais da operação.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Texto da zona (Shopify)</s-table-header>
              <s-table-header>Concelho</s-table-header>
              <s-table-header>Confeção</s-table-header>
              <s-table-header>Estafeta</s-table-header>
              <s-table-header>Estado</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {zones.map((zone) => (
                <s-table-row key={zone.id}>
                  <s-table-cell>{zone.matchText}</s-table-cell>
                  <s-table-cell>{zone.county}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={confDayTone(zone.confDay)}>
                      {confDayLabel(zone.confDay)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {zone.courier ? (
                      zone.courier.name
                    ) : (
                      <s-text color="subdued">por atribuir</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={zone.active ? "success" : "neutral"}>
                      {zone.active ? "Ativa" : "Inativa"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <input type="hidden" name="zoneId" value={zone.id} />
                        <s-button
                          type="submit"
                          variant="tertiary"
                          disabled={isSubmitting}
                        >
                          {zone.active ? "Desativar" : "Ativar"}
                        </s-button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="zoneId" value={zone.id} />
                        <s-button
                          type="submit"
                          variant="tertiary"
                          tone="critical"
                          disabled={isSubmitting}
                        >
                          Eliminar
                        </s-button>
                      </Form>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Nova zona">
        <Form method="post" key={createFormKey}>
          <input type="hidden" name="intent" value="create" />
          <s-stack gap="base">
            <s-text-field
              label="Texto da zona (Shopify)"
              name="matchText"
              details="Tem de ser IGUAL ao texto do atributo «Horário de entrega» das encomendas."
              placeholder="Lisboa (Centro da cidade) 19-23h"
              defaultValue={createValues.matchText}
              error={createErrors.matchText}
            />
            <s-text-field
              label="Concelho"
              name="county"
              placeholder="Lisboa"
              defaultValue={createValues.county}
              error={createErrors.county}
            />
            <s-select
              label="Dia de confeção"
              name="confDay"
              error={createErrors.confDay}
            >
              {CONF_DAY_RULES.map((rule) => (
                <s-option
                  key={rule}
                  value={rule}
                  defaultSelected={createValues.confDay === rule}
                >
                  {CONF_DAY_LABELS[rule]}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Estafeta"
              name="courierId"
              details="Opcional — podes atribuir mais tarde."
              error={createErrors.courierId}
            >
              <s-option value="" defaultSelected={!createValues.courierId}>
                Sem estafeta (por atribuir)
              </s-option>
              {couriers.map((courier) => (
                <s-option
                  key={courier.id}
                  value={courier.id}
                  defaultSelected={createValues.courierId === courier.id}
                >
                  {courier.name}
                </s-option>
              ))}
            </s-select>
            <s-box>
              <s-button type="submit" variant="primary" loading={isSubmitting}>
                Criar zona
              </s-button>
            </s-box>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
