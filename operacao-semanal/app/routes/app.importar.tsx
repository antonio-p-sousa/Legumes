/**
 * /app/importar — importação manual do CSV de encomendas do Shopify.
 *
 * Enquanto a app não está ligada à loja (sem credenciais da API), o operador
 * exporta o CSV à mão (Encomendas → Exportar) e faz aqui o upload. O import
 * mais recente passa a alimentar todas as páginas (ver provider.server.ts).
 */
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
  CsvImportError,
  deleteImport,
  listImports,
  parseShopifyOrdersCsv,
  saveImport,
} from "../services/orders/csv-import.server";

/** Um export semanal real anda nos poucos MB; acima disto é engano. */
const MAX_CSV_BYTES = 20 * 1024 * 1024;

const DATE_FORMAT = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "short",
  timeStyle: "short",
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const imports = await listImports(prisma);
  return { imports };
};

interface ImportSummaryView {
  orders: number;
  lineItems: number;
  units: number;
  deliveryDays: string[];
  warnings: string[];
}

type ActionResult =
  | { ok: true; intent: string; message: string; summary?: ImportSummaryView }
  | { ok: false; intent: string; error: string; warnings?: string[] };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "delete") {
    const importId = String(formData.get("importId") ?? "");
    const deleted = await deleteImport(prisma, importId);
    if (!deleted) {
      return {
        ok: false,
        intent,
        error:
          "Este import já não existe — talvez tenha sido eliminado entretanto. Atualiza a página.",
      };
    }
    return {
      ok: true,
      intent,
      message:
        "Import eliminado. As páginas passam a usar o import anterior (ou os dados de demonstração).",
    };
  }

  if (intent === "import") {
    const file = formData.get("csv");
    if (!(file instanceof File) || file.size === 0) {
      return {
        ok: false,
        intent,
        error:
          "Seleciona primeiro o ficheiro CSV exportado do Shopify (Encomendas → Exportar).",
      };
    }
    if (file.size > MAX_CSV_BYTES) {
      return {
        ok: false,
        intent,
        error:
          "O ficheiro excede 20 MB — não parece um export semanal de encomendas. Confirma que exportaste só as encomendas da semana.",
      };
    }

    let parsed;
    try {
      parsed = parseShopifyOrdersCsv(await file.text());
    } catch (error) {
      if (error instanceof CsvImportError) {
        return { ok: false, intent, error: error.message };
      }
      throw error;
    }

    if (parsed.orders.length === 0) {
      return {
        ok: false,
        intent,
        error:
          "O CSV foi lido mas não tem nenhuma encomenda. Confirma que exportaste as encomendas da semana certa.",
        warnings: parsed.warnings,
      };
    }

    const record = await saveImport(
      prisma,
      parsed.orders,
      file.name || "encomendas.csv",
    );

    const deliveryDays = new Set<string>();
    let lineItems = 0;
    let units = 0;
    for (const order of parsed.orders) {
      lineItems += order.lineItems.length;
      for (const item of order.lineItems) units += item.quantity;
      const day = order.customAttributes.find(
        (attribute) => attribute.key === "Dia de entrega",
      )?.value;
      if (day) deliveryDays.add(day);
    }

    return {
      ok: true,
      intent,
      message: `Import concluído: ${parsed.orders.length} encomendas (${record.weekLabel}).`,
      summary: {
        orders: parsed.orders.length,
        lineItems,
        units,
        deliveryDays: Array.from(deliveryDays),
        warnings: parsed.warnings,
      },
    };
  }

  return {
    ok: false,
    intent,
    error: "Operação desconhecida. Atualiza a página e tenta de novo.",
  };
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

export default function Importar() {
  const { imports } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  const importError =
    actionData && !actionData.ok && actionData.intent === "import"
      ? actionData.error
      : undefined;
  const deleteError =
    actionData && !actionData.ok && actionData.intent !== "import"
      ? actionData.error
      : undefined;
  const summary =
    actionData?.ok && actionData.intent === "import"
      ? actionData.summary
      : undefined;
  const failWarnings =
    actionData && !actionData.ok ? (actionData.warnings ?? []) : [];
  // O upload com sucesso remonta o formulário (limpa o ficheiro selecionado)
  const uploadFormKey = actionData?.ok ? actionData.message : "upload-csv";

  return (
    <s-page heading="Importar CSV de encomendas">
      <s-section>
        <s-banner tone="info" heading="Modo sem ligação à loja">
          <s-paragraph>
            Enquanto a app não está ligada à loja, importa aqui o CSV semanal
            exportado do Shopify (Encomendas → Exportar). O import mais
            recente passa a alimentar todas as páginas — Semana, Cozinha,
            Compras e Estafetas.
          </s-paragraph>
        </s-banner>
      </s-section>

      <s-section heading="Carregar export do Shopify">
        {importError && (
          <s-banner tone="critical" heading="Não foi possível importar">
            <s-paragraph>{importError}</s-paragraph>
            {failWarnings.length > 0 && (
              <s-stack gap="small">
                {failWarnings.map((warning, index) => (
                  <s-text key={`${index}-${warning}`} color="subdued">
                    {warning}
                  </s-text>
                ))}
              </s-stack>
            )}
          </s-banner>
        )}

        {summary && (
          <s-banner tone="success" heading="Import concluído">
            <s-paragraph>
              {summary.orders} encomendas · {summary.lineItems} line items ·{" "}
              {summary.units} refeições/unidades · dias de entrega detetados:{" "}
              {summary.deliveryDays.length > 0
                ? summary.deliveryDays.join(", ")
                : "nenhum (encomendas sem atributos de entrega)"}
              .
            </s-paragraph>
            {summary.warnings.length > 0 && (
              <s-stack gap="small">
                <s-text>
                  {summary.warnings.length === 1
                    ? "1 aviso durante a leitura:"
                    : `${summary.warnings.length} avisos durante a leitura:`}
                </s-text>
                {summary.warnings.map((warning, index) => (
                  <s-text key={`${index}-${warning}`} color="subdued">
                    {warning}
                  </s-text>
                ))}
              </s-stack>
            )}
          </s-banner>
        )}

        <Form method="post" encType="multipart/form-data" key={uploadFormKey}>
          <input type="hidden" name="intent" value="import" />
          <s-stack gap="base">
            <s-drop-zone
              name="csv"
              accept=".csv,text/csv"
              label="Ficheiro CSV de encomendas"
            >
              <s-paragraph>
                Arrasta o ficheiro para aqui ou clica para escolher.
              </s-paragraph>
            </s-drop-zone>
            <s-box>
              <s-button type="submit" variant="primary" loading={isSubmitting}>
                Importar
              </s-button>
            </s-box>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Imports anteriores">
        {deleteError && (
          <s-banner
            tone="critical"
            heading="Não foi possível concluir a operação"
          >
            <s-paragraph>{deleteError}</s-paragraph>
          </s-banner>
        )}

        {imports.length === 0 ? (
          <s-banner tone="info" heading="Ainda não há imports">
            <s-paragraph>
              Sem imports, as páginas mostram os dados de demonstração
              (semana 47/2025). Faz o primeiro upload acima para veres a
              operação com as encomendas reais da semana.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Import</s-table-header>
              <s-table-header>Data</s-table-header>
              <s-table-header>Encomendas</s-table-header>
              <s-table-header>Estado</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {imports.map((entry, index) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>{entry.weekLabel}</s-table-cell>
                  <s-table-cell>{formatDate(entry.generatedAt)}</s-table-cell>
                  <s-table-cell>{entry.orderCount}</s-table-cell>
                  <s-table-cell>
                    {index === 0 ? (
                      <s-badge tone="success">Ativo</s-badge>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="importId" value={entry.id} />
                      <s-button
                        type="submit"
                        variant="tertiary"
                        tone="critical"
                        disabled={isSubmitting}
                      >
                        Eliminar
                      </s-button>
                    </Form>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
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
