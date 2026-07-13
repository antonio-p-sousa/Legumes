import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  useLoaderData,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { loadWeekData } from "../services/pages/common.server";
import { buildEstafetasView } from "../services/pages/estafetas.server";
import { getConfig } from "../services/definicoes/config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [weekData, config] = await Promise.all([
    loadWeekData(prisma, admin),
    getConfig(prisma),
  ]);

  const view = buildEstafetasView(weekData, config.dpdAccount);

  const requested = new URL(request.url).searchParams.get("data");
  const selectedDate = view.deliveryDates.some((d) => d.date === requested)
    ? requested
    : (view.deliveryDates[0]?.date ?? null);

  return { view, meta: weekData.meta, selectedDate };
};

/** Paragens visíveis por rota na página — a lista completa vai no xlsx. */
const MAX_VISIBLE_STOPS = 12;

const ROUTE_TABLE_COLUMNS = 8;

const ORDERING_LABELS: Record<string, string> = {
  manual: "ordem manual",
  postcode: "ordenada por código postal",
  county: "ordenada por localidade",
};

/** "2025-11-24" → "24/11" */
function formatDdMm(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

/** 64.45 → "64,45 €" */
function formatEur(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

/** 12.5 → "12,5 kg" */
function formatKg(value: number): string {
  return `${String(value).replace(".", ",")} kg`;
}

export default function Estafetas() {
  const { view, meta, selectedDate } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  const activeRoutes = view.routes.filter(
    (route) => route.deliveryDate === selectedDate,
  );
  const semNada = view.deliveryDates.length === 0 && view.dpd.shipments === 0;
  const isDemo = meta.source === "demo";

  return (
    <s-page heading="Estafetas">
      <s-section heading={`Semana ${meta.weekLabel}`}>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small">
            <s-badge
              tone={
                isDemo ? "warning" : meta.source === "csv" ? "info" : "success"
              }
            >
              {isDemo
                ? "Dados de demonstração"
                : meta.source === "csv"
                  ? "Import manual"
                  : "Dados da loja"}
            </s-badge>
            <s-badge tone="neutral">{`${meta.totalOrders} encomendas`}</s-badge>
          </s-stack>
          <s-stack direction="inline" gap="small">
            <s-button
              variant="secondary"
              href="/app/api/export/rotas"
              target="_blank"
              disabled={view.routes.length === 0}
            >
              Exportar xlsx (todas as rotas)
            </s-button>
            <s-button
              variant="secondary"
              href="/app/print/rotas"
              target="_blank"
              disabled={view.routes.length === 0}
            >
              Imprimir / PDF
            </s-button>
            <s-button variant="secondary" disabled>
              Enviar rotas por email
            </s-button>
          </s-stack>
          <s-text color="subdued">
            O envio de rotas por email aos parceiros fica indisponível até o
            serviço de email estar decidido (decisão em aberto com o cliente).
          </s-text>
        </s-stack>
      </s-section>

      {semNada && (
        <s-section heading="Sem entregas nesta semana">
          <s-banner tone="info" heading="Não há rotas nem envios DPD">
            <s-paragraph>
              Nenhuma encomenda da semana produziu rotas locais ou envios DPD.
              Confirma que as encomendas têm o bloco de atributos de entrega,
              que as <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>{" "}
              cobrem os textos de zona usados na loja e que cada zona tem
              estafeta atribuído em{" "}
              <Link to="/app/definicoes/parceiros">
                Parceiros &amp; fornecedores
              </Link>
              .
            </s-paragraph>
          </s-banner>
        </s-section>
      )}

      {view.deliveryDates.length > 0 && (
        <s-section heading="Rotas por dia de entrega">
          <s-stack direction="inline" gap="small">
            {view.deliveryDates.map((day) => (
              <s-button
                key={day.date}
                variant={day.date === selectedDate ? "primary" : "secondary"}
                onClick={() => setSearchParams({ data: day.date })}
              >
                {`${day.dia} ${formatDdMm(day.date)} · ${day.nParagens} paragens`}
              </s-button>
            ))}
          </s-stack>
        </s-section>
      )}

      {activeRoutes.map((route) => {
        const visibleStops = route.stops.slice(0, MAX_VISIBLE_STOPS);
        const hiddenCount = route.stops.length - visibleStops.length;
        const exportHref = `/app/api/export/rotas?data=${route.deliveryDate}&courier=${encodeURIComponent(route.courier)}`;

        return (
          <s-section
            key={`${route.deliveryDate} ${route.courier}`}
            heading={`${route.courier} — ${route.deliveryDay} ${formatDdMm(route.deliveryDate)}`}
          >
            <s-stack gap="base">
              <s-stack direction="inline" gap="small">
                <s-badge
                  tone={route.courierType === "internal" ? "info" : "success"}
                >
                  {route.courierType === "internal" ? "Interno" : "Parceiro"}
                </s-badge>
                <s-badge tone="neutral">{`${route.stops.length} paragens`}</s-badge>
                <s-badge tone="neutral">
                  {ORDERING_LABELS[
                    view.orderingByCourier[route.courier] ?? "manual"
                  ] ?? "ordem manual"}
                </s-badge>
                <s-button
                  variant="secondary"
                  href={exportHref}
                  target="_blank"
                >
                  Exportar xlsx
                </s-button>
              </s-stack>

              <s-table>
                <s-table-header-row>
                  <s-table-header>#</s-table-header>
                  <s-table-header>Encomenda</s-table-header>
                  <s-table-header>Cliente</s-table-header>
                  <s-table-header>Morada</s-table-header>
                  <s-table-header>CP</s-table-header>
                  <s-table-header>Cidade</s-table-header>
                  <s-table-header format="currency">Subtotal</s-table-header>
                  <s-table-header>Notas</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {visibleStops.map((stop) => (
                    <s-table-row key={stop.orderName}>
                      <s-table-cell>
                        {stop.sequence !== undefined
                          ? String(stop.sequence)
                          : "—"}
                      </s-table-cell>
                      <s-table-cell>{stop.orderName}</s-table-cell>
                      <s-table-cell>{stop.client}</s-table-cell>
                      <s-table-cell>{stop.address1}</s-table-cell>
                      <s-table-cell>{stop.zip}</s-table-cell>
                      <s-table-cell>{stop.city}</s-table-cell>
                      <s-table-cell>{formatEur(stop.subtotal)}</s-table-cell>
                      <s-table-cell>
                        {stop.note ? (
                          stop.note
                        ) : (
                          <s-text color="subdued">—</s-text>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                  {hiddenCount > 0 && (
                    <s-table-row>
                      <s-table-cell>…</s-table-cell>
                      <s-table-cell>
                        <s-text color="subdued">
                          {`… mais ${hiddenCount} paragens — lista completa no xlsx`}
                        </s-text>
                      </s-table-cell>
                      {Array.from(
                        { length: ROUTE_TABLE_COLUMNS - 2 },
                        (_, index) => (
                          <s-table-cell key={index} />
                        ),
                      )}
                    </s-table-row>
                  )}
                </s-table-body>
              </s-table>
            </s-stack>
          </s-section>
        );
      })}

      <s-section heading="DPD Nacional">
        <s-stack gap="base">
          {view.dpd.shipments === 0 ? (
            <s-text color="subdued">
              Sem envios DPD nesta semana — nenhuma encomenda caiu numa zona
              com estafeta do tipo DPD.
            </s-text>
          ) : (
            <>
              <s-stack direction="inline" gap="small">
                <s-badge tone="neutral">{`${view.dpd.shipments} envios`}</s-badge>
                <s-badge tone="neutral">{formatKg(view.dpd.totalWeightKg)}</s-badge>
                <s-badge tone="neutral">{`${view.dpd.totalVolumes} volumes`}</s-badge>
              </s-stack>

              <s-table>
                <s-table-header-row>
                  <s-table-header>Recolha</s-table-header>
                  <s-table-header>Data</s-table-header>
                  <s-table-header format="numeric">Envios</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {view.dpd.porRecolha.map((day) => (
                    <s-table-row key={day.date}>
                      <s-table-cell>{day.dia}</s-table-cell>
                      <s-table-cell>{formatDdMm(day.date)}</s-table-cell>
                      <s-table-cell>{String(day.shipments)}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>

              {view.dpd.issues.length > 0 && (
                <s-banner tone="warning" heading="Envios com dados em falta">
                  <s-paragraph>
                    Estes envios seguem no CSV na mesma — corrige os dados no
                    Shopify e volta a exportar:
                  </s-paragraph>
                  <s-unordered-list>
                    {view.dpd.issues.map((issue) => (
                      <s-list-item key={issue}>{issue}</s-list-item>
                    ))}
                  </s-unordered-list>
                </s-banner>
              )}

              <s-stack direction="inline" gap="small">
                <s-badge tone={view.dpd.checks.colunas17 ? "success" : "critical"}>
                  {view.dpd.checks.colunas17
                    ? "17 colunas"
                    : "colunas diferentes de 17"}
                </s-badge>
                <s-badge tone={view.dpd.checks.colunas17 ? "success" : "critical"}>
                  {view.dpd.checks.colunas17
                    ? "sem ';' no texto"
                    : "';' no texto"}
                </s-badge>
                <s-badge
                  tone={view.dpd.checks.semIndicativo351 ? "success" : "critical"}
                >
                  {view.dpd.checks.semIndicativo351 ? "sem +351" : "+351 presente"}
                </s-badge>
              </s-stack>
            </>
          )}

          <s-box>
            <s-button
              variant="primary"
              href="/app/api/export/dpd"
              target="_blank"
              disabled={view.dpd.shipments === 0}
            >
              Exportar CSV DPD
            </s-button>
          </s-box>
        </s-stack>
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
