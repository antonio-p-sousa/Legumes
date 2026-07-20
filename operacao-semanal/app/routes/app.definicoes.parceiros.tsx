import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createCourier,
  createSupplier,
  deleteCourier,
  deleteSupplier,
  listCouriers,
  listSuppliers,
  updateCourier,
  updateSupplier,
} from "../services/definicoes/parceiros.server";
import type { FieldErrors } from "../services/definicoes/parceiros.server";

// ─── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [couriers, suppliers] = await Promise.all([
    listCouriers(prisma),
    listSuppliers(prisma),
  ]);

  return { couriers, suppliers };
};

// ─── Action ─────────────────────────────────────────────────────────────────

type ActionResponse =
  | { ok: true; intent: string; message: string; ts: number }
  | { ok: false; intent: string; errors: FieldErrors };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResponse> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const text = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const intent = text("intent");

  switch (intent) {
    case "criar-estafeta": {
      const result = await createCourier(prisma, {
        name: text("name"),
        type: text("type"),
        ordering: text("ordering"),
        email: text("email"),
        ccEmails: text("ccEmails"),
      });
      return result.ok
        ? {
            ok: true,
            intent,
            message: `Estafeta "${result.data.name}" criado.`,
            ts: Date.now(),
          }
        : { ok: false, intent, errors: result.errors };
    }

    case "atualizar-estafeta": {
      const result = await updateCourier(prisma, text("id"), {
        name: text("name"),
        type: text("type"),
        ordering: text("ordering"),
        email: text("email"),
        ccEmails: text("ccEmails"),
      });
      return result.ok
        ? {
            ok: true,
            intent,
            message: `Estafeta "${result.data.name}" atualizado.`,
            ts: Date.now(),
          }
        : { ok: false, intent, errors: result.errors };
    }

    case "eliminar-estafeta": {
      const result = await deleteCourier(prisma, text("id"));
      return result.ok
        ? {
            ok: true,
            intent,
            message: `Estafeta "${result.data.name}" eliminado.`,
            ts: Date.now(),
          }
        : { ok: false, intent, errors: result.errors };
    }

    case "criar-fornecedor": {
      const result = await createSupplier(prisma, {
        name: text("name"),
        email: text("email"),
        orderDay: text("orderDay"),
      });
      return result.ok
        ? {
            ok: true,
            intent,
            message: `Fornecedor "${result.data.name}" criado.`,
            ts: Date.now(),
          }
        : { ok: false, intent, errors: result.errors };
    }

    case "atualizar-fornecedor": {
      const result = await updateSupplier(prisma, text("id"), {
        name: text("name"),
        email: text("email"),
        orderDay: text("orderDay"),
      });
      return result.ok
        ? {
            ok: true,
            intent,
            message: `Fornecedor "${result.data.name}" atualizado.`,
            ts: Date.now(),
          }
        : { ok: false, intent, errors: result.errors };
    }

    case "eliminar-fornecedor": {
      const result = await deleteSupplier(prisma, text("id"));
      return result.ok
        ? {
            ok: true,
            intent,
            message: `Fornecedor "${result.data.name}" eliminado.`,
            ts: Date.now(),
          }
        : { ok: false, intent, errors: result.errors };
    }

    default:
      return {
        ok: false,
        intent,
        errors: { intent: "Operação desconhecida. Atualiza a página e tenta de novo." },
      };
  }
};

// ─── Etiquetas de apresentação ──────────────────────────────────────────────

const COURIER_TYPE_LABELS: Record<string, string> = {
  internal: "Interno",
  partner: "Parceiro",
  dpd: "DPD",
};

const COURIER_TYPE_TONES: Record<string, "info" | "success" | "warning"> = {
  internal: "info",
  partner: "success",
  dpd: "warning",
};

const COURIER_ORDERING_LABELS: Record<string, string> = {
  manual: "Manual",
  postcode: "Código postal",
  county: "Concelho",
};

const DPD_NOTE =
  'Tipo "DPD": as encomendas destas zonas saem no CSV DPD, não nas rotas.';

// ─── Página ─────────────────────────────────────────────────────────────────

export default function Parceiros() {
  const { couriers, suppliers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const courierEdit =
    couriers.find((c) => c.id === searchParams.get("estafeta")) ?? null;
  const supplierEdit =
    suppliers.find((s) => s.id === searchParams.get("fornecedor")) ?? null;

  useEffect(() => {
    if (!actionData?.ok) return;
    shopify.toast.show(actionData.message);
    if (
      actionData.intent === "atualizar-estafeta" ||
      actionData.intent === "atualizar-fornecedor"
    ) {
      setSearchParams(new URLSearchParams(), { replace: true });
    }
  }, [actionData, shopify, setSearchParams]);

  const errorsFor = (...intents: string[]): FieldErrors =>
    actionData && !actionData.ok && intents.includes(actionData.intent)
      ? actionData.errors
      : {};

  const courierFormErrors = errorsFor("criar-estafeta", "atualizar-estafeta");
  const courierDeleteError = errorsFor("eliminar-estafeta").id;
  const supplierFormErrors = errorsFor(
    "criar-fornecedor",
    "atualizar-fornecedor",
  );
  const supplierDeleteError = errorsFor("eliminar-fornecedor").id;

  const successTs = actionData?.ok ? actionData.ts : 0;
  const courierFormKey = `estafeta-${courierEdit?.id ?? "novo"}-${successTs}`;
  const supplierFormKey = `fornecedor-${supplierEdit?.id ?? "novo"}-${successTs}`;

  return (
    <s-page heading="Parceiros & fornecedores">
      {/* ── Secção 1: Estafetas e transportadoras ── */}
      <s-section heading="Estafetas e transportadoras">
        <s-paragraph color="subdued">
          Quem entrega as marmitas. Cada zona de entrega (em{" "}
          <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>) aponta para
          um destes estafetas. {DPD_NOTE}
        </s-paragraph>

        {courierDeleteError && (
          <s-banner tone="critical" heading="Não foi possível eliminar">
            <s-paragraph>{courierDeleteError}</s-paragraph>
          </s-banner>
        )}

        {couriers.length === 0 ? (
          <s-banner tone="info" heading="Ainda sem estafetas configurados">
            <s-paragraph>
              Sem estafetas, as rotas não têm a quem ser atribuídas. Cria o
              primeiro no formulário abaixo — por exemplo, o estafeta interno
              e a DPD para as entregas nacionais.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Nome</s-table-header>
              <s-table-header>Tipo</s-table-header>
              <s-table-header>Ordenação de rota</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header format="numeric">Zonas</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {couriers.map((courier) => (
                <s-table-row key={courier.id}>
                  <s-table-cell>{courier.name}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={COURIER_TYPE_TONES[courier.type] ?? "neutral"}
                    >
                      {COURIER_TYPE_LABELS[courier.type] ?? courier.type}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {COURIER_ORDERING_LABELS[courier.ordering] ??
                      courier.ordering}
                  </s-table-cell>
                  <s-table-cell>
                    {courier.email ?? "—"}
                    {courier.ccEmails.length > 0 && (
                      <>
                        {" "}
                        <s-badge tone="neutral">
                          {`+${courier.ccEmails.length} CC`}
                        </s-badge>
                      </>
                    )}
                  </s-table-cell>
                  <s-table-cell>{String(courier.zoneCount)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <Link to={`?estafeta=${courier.id}`}>Editar</Link>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="eliminar-estafeta"
                        />
                        <input type="hidden" name="id" value={courier.id} />
                        <s-button
                          type="submit"
                          variant="tertiary"
                          tone="critical"
                          accessibilityLabel={`Eliminar ${courier.name}`}
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

        <s-heading>
          {courierEdit
            ? `Editar "${courierEdit.name}"`
            : "Adicionar estafeta ou transportadora"}
        </s-heading>
        <Form method="post" key={courierFormKey}>
          <input
            type="hidden"
            name="intent"
            value={courierEdit ? "atualizar-estafeta" : "criar-estafeta"}
          />
          {courierEdit && (
            <input type="hidden" name="id" value={courierEdit.id} />
          )}
          <s-stack direction="block" gap="base">
            {courierFormErrors.id && (
              <s-banner tone="critical" heading="Não foi possível guardar">
                <s-paragraph>{courierFormErrors.id}</s-paragraph>
              </s-banner>
            )}
            <s-stack direction="inline" gap="base" alignItems="start">
              <s-text-field
                label="Nome"
                name="name"
                placeholder="Ex.: Off Limits"
                defaultValue={courierEdit?.name ?? ""}
                error={courierFormErrors.name}
                required
              />
              <s-select
                label="Tipo"
                name="type"
                details={DPD_NOTE}
                error={courierFormErrors.type}
              >
                <s-option
                  value="internal"
                  defaultSelected={(courierEdit?.type ?? "internal") === "internal"}
                >
                  Interno
                </s-option>
                <s-option
                  value="partner"
                  defaultSelected={courierEdit?.type === "partner"}
                >
                  Parceiro
                </s-option>
                <s-option
                  value="dpd"
                  defaultSelected={courierEdit?.type === "dpd"}
                >
                  DPD
                </s-option>
              </s-select>
              <s-select
                label="Ordenação de rota"
                name="ordering"
                error={courierFormErrors.ordering}
              >
                <s-option
                  value="manual"
                  defaultSelected={(courierEdit?.ordering ?? "manual") === "manual"}
                >
                  Manual
                </s-option>
                <s-option
                  value="postcode"
                  defaultSelected={courierEdit?.ordering === "postcode"}
                >
                  Código postal
                </s-option>
                <s-option
                  value="county"
                  defaultSelected={courierEdit?.ordering === "county"}
                >
                  Concelho
                </s-option>
              </s-select>
              <s-text-field
                label="Email"
                name="email"
                placeholder="Para envio da rota (opcional)"
                defaultValue={courierEdit?.email ?? ""}
                error={courierFormErrors.email}
              />
            </s-stack>
            <s-text-area
              label="Emails em CC (um por linha)"
              name="ccEmails"
              rows={3}
              placeholder={"comercial@parceiro.pt\nlogistica@parceiro.pt"}
              defaultValue={courierEdit?.ccEmails.join("\n") ?? ""}
              error={courierFormErrors.ccEmails}
              details="Para o envio automático das rotas; ex.: parceiro com vários contactos. Também aceita emails separados por vírgula."
            />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button type="submit" variant="primary">
                {courierEdit ? "Guardar alterações" : "Adicionar estafeta"}
              </s-button>
              {courierEdit && (
                <Link to="/app/definicoes/parceiros">Cancelar edição</Link>
              )}
            </s-stack>
          </s-stack>
        </Form>
      </s-section>

      {/* ── Secção 2: Fornecedores ── */}
      <s-section heading="Fornecedores">
        <s-paragraph color="subdued">
          A quem se compram os ingredientes. Cada ingrediente das{" "}
          <Link to="/app/definicoes/fichas">Fichas técnicas</Link> aponta para
          um fornecedor; a lista de compras agrega por fornecedor.
        </s-paragraph>

        {supplierDeleteError && (
          <s-banner tone="critical" heading="Não foi possível eliminar">
            <s-paragraph>{supplierDeleteError}</s-paragraph>
          </s-banner>
        )}

        {suppliers.length === 0 ? (
          <s-banner tone="info" heading="Ainda sem fornecedores configurados">
            <s-paragraph>
              Sem fornecedores, a lista de compras não sabe a quem agregar os
              ingredientes. Cria o primeiro no formulário abaixo.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Nome</s-table-header>
              <s-table-header>Email</s-table-header>
              <s-table-header>Dia de encomenda</s-table-header>
              <s-table-header format="numeric">Ingredientes</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {suppliers.map((supplier) => (
                <s-table-row key={supplier.id}>
                  <s-table-cell>{supplier.name}</s-table-cell>
                  <s-table-cell>{supplier.email ?? "—"}</s-table-cell>
                  <s-table-cell>{supplier.orderDay ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {String(supplier.ingredientCount)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <Link to={`?fornecedor=${supplier.id}`}>Editar</Link>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="eliminar-fornecedor"
                        />
                        <input type="hidden" name="id" value={supplier.id} />
                        <s-button
                          type="submit"
                          variant="tertiary"
                          tone="critical"
                          accessibilityLabel={`Eliminar ${supplier.name}`}
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

        <s-heading>
          {supplierEdit
            ? `Editar "${supplierEdit.name}"`
            : "Adicionar fornecedor"}
        </s-heading>
        <Form method="post" key={supplierFormKey}>
          <input
            type="hidden"
            name="intent"
            value={supplierEdit ? "atualizar-fornecedor" : "criar-fornecedor"}
          />
          {supplierEdit && (
            <input type="hidden" name="id" value={supplierEdit.id} />
          )}
          <s-stack direction="block" gap="base">
            {supplierFormErrors.id && (
              <s-banner tone="critical" heading="Não foi possível guardar">
                <s-paragraph>{supplierFormErrors.id}</s-paragraph>
              </s-banner>
            )}
            <s-stack direction="inline" gap="base" alignItems="start">
              <s-text-field
                label="Nome"
                name="name"
                placeholder="Ex.: Peixaria Central"
                defaultValue={supplierEdit?.name ?? ""}
                error={supplierFormErrors.name}
                required
              />
              <s-text-field
                label="Email"
                name="email"
                placeholder="Para envio da encomenda (opcional)"
                defaultValue={supplierEdit?.email ?? ""}
                error={supplierFormErrors.email}
              />
              <s-text-field
                label="Dia de encomenda"
                name="orderDay"
                placeholder='Ex.: "Quinta até às 12h" (texto livre)'
                defaultValue={supplierEdit?.orderDay ?? ""}
                error={supplierFormErrors.orderDay}
                details="Quando é que a encomenda tem de ser feita a este fornecedor."
              />
            </s-stack>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button type="submit" variant="primary">
                {supplierEdit ? "Guardar alterações" : "Adicionar fornecedor"}
              </s-button>
              {supplierEdit && (
                <Link to="/app/definicoes/parceiros">Cancelar edição</Link>
              )}
            </s-stack>
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
