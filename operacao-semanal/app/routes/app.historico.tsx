/**
 * /app/historico — histórico de semanas processadas (snapshots WeekRun).
 *
 * Lista todos os WeekRun (imports de CSV e futuros fechos de semana) do mais
 * recente para o mais antigo, com contagem de encomendas e refeições. "Ver"
 * abre um resumo do snapshot (?id=<id>) com o detalhe por dia de entrega;
 * "Eliminar" remove o snapshot. Só leitura de dados — nada é enviado para fora.
 */
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
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  countMeals,
  deleteWeekRun,
  getWeekRun,
  listWeekRuns,
  summarizeByDay,
  type DaySummary,
} from "../services/pages/historico.server";

const DATE_FORMAT = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

interface DetalheView {
  id: string;
  weekLabel: string;
  generatedAt: string;
  nEncomendas: number;
  nRefeicoes: number;
  dias: DaySummary[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const selectedId = url.searchParams.get("id");

  const runs = await listWeekRuns(prisma);

  let detalhe: DetalheView | null = null;
  let detalheEmFalta: string | null = null;

  if (selectedId) {
    const snapshot = await getWeekRun(prisma, selectedId);
    if (snapshot) {
      detalhe = {
        id: snapshot.id,
        weekLabel: snapshot.weekLabel,
        generatedAt: snapshot.generatedAt,
        nEncomendas: snapshot.orders.length,
        nRefeicoes: countMeals(snapshot.orders),
        dias: summarizeByDay(snapshot.orders),
      };
    } else {
      detalheEmFalta = selectedId;
    }
  }

  return { runs, detalhe, detalheEmFalta };
};

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    const deleted = await deleteWeekRun(prisma, id);
    if (!deleted) {
      return {
        ok: false,
        error:
          "Este registo já não existe — talvez tenha sido eliminado entretanto. Atualiza a página.",
      };
    }
    return { ok: true, message: "Semana eliminada do histórico." };
  }

  return {
    ok: false,
    error: "Operação desconhecida. Atualiza a página e tenta de novo.",
  };
};

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

function DetalheSection({ detalhe }: { detalhe: DetalheView }) {
  return (
    <s-section heading={`Resumo · ${detalhe.weekLabel}`}>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone="info">{formatDate(detalhe.generatedAt)}</s-badge>
          <Link to="/app/historico">Voltar ao histórico</Link>
        </s-stack>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
          gap="base"
        >
          <KpiCard label="Encomendas" value={String(detalhe.nEncomendas)} />
          <KpiCard label="Refeições" value={String(detalhe.nRefeicoes)} />
          <KpiCard label="Dias de entrega" value={String(detalhe.dias.length)} />
        </s-grid>

        {detalhe.dias.length === 0 ? (
          <s-banner tone="info" heading="Snapshot sem encomendas">
            <s-paragraph>
              Este registo não tem encomendas para resumir (snapshot vazio ou
              dados corrompidos).
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Dia de entrega</s-table-header>
              <s-table-header>Encomendas</s-table-header>
              <s-table-header>Refeições</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {detalhe.dias.map((dia) => (
                <s-table-row key={dia.dia}>
                  <s-table-cell>{dia.dia}</s-table-cell>
                  <s-table-cell>{String(dia.nEncomendas)}</s-table-cell>
                  <s-table-cell>{String(dia.nRefeicoes)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

export default function Historico() {
  const { runs, detalhe, detalheEmFalta } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  const deleteError = actionData && !actionData.ok ? actionData.error : undefined;

  return (
    <s-page heading="Histórico de semanas">
      <s-section>
        <s-paragraph>
          Cada semana processada fica guardada aqui como um snapshot. Abre uma
          semana para rever o resumo por dia de entrega, ou elimina snapshots
          antigos que já não precises.
        </s-paragraph>
      </s-section>

      {detalheEmFalta && (
        <s-section>
          <s-banner tone="warning" heading="Semana não encontrada">
            <s-paragraph>
              O snapshot pedido já não existe — pode ter sido eliminado. Escolhe
              outra semana na lista abaixo.
            </s-paragraph>
          </s-banner>
        </s-section>
      )}

      {detalhe && <DetalheSection detalhe={detalhe} />}

      <s-section heading="Semanas guardadas">
        {deleteError && (
          <s-banner tone="critical" heading="Não foi possível eliminar">
            <s-paragraph>{deleteError}</s-paragraph>
          </s-banner>
        )}

        {runs.length === 0 ? (
          <s-banner tone="info" heading="Ainda não há semanas no histórico">
            <s-paragraph>
              Assim que importares um CSV de encomendas (Importar CSV) ou
              fechares uma semana, o snapshot aparece aqui para consulta.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Semana</s-table-header>
              <s-table-header>Data</s-table-header>
              <s-table-header>Encomendas</s-table-header>
              <s-table-header>Refeições</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {runs.map((run) => (
                <s-table-row key={run.id}>
                  <s-table-cell>{run.weekLabel}</s-table-cell>
                  <s-table-cell>{formatDate(run.generatedAt)}</s-table-cell>
                  <s-table-cell>{String(run.nEncomendas)}</s-table-cell>
                  <s-table-cell>{String(run.nRefeicoes)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <Link to={`/app/historico?id=${run.id}`}>Ver</Link>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={run.id} />
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
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
