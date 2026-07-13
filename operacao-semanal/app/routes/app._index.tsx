import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig } from "../services/definicoes/config.server";
import { loadRecipes, loadWeekData } from "../services/pages/common.server";
import {
  buildSemanaView,
  formatDataHoraPt,
  minutosDesde,
  type SemanaDia,
} from "../services/pages/semana.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [
    weekData,
    config,
    recipes,
    zones,
    couriers,
    suppliers,
    dishes,
    dosesComFicha,
  ] = await Promise.all([
    loadWeekData(prisma, admin),
    getConfig(prisma),
    loadRecipes(prisma),
    prisma.zone.count({ where: { active: true } }),
    prisma.courier.count(),
    prisma.supplier.count(),
    prisma.dish.count(),
    prisma.dose.count({ where: { ingredients: { some: {} } } }),
  ]);

  const view = buildSemanaView(weekData, config, recipes);
  const { meta } = weekData;

  return {
    view,
    semana: {
      weekLabel: meta.weekLabel,
      source: meta.source,
      janela: `${formatDataHoraPt(meta.windowStart)} → ${formatDataHoraPt(meta.windowEnd)}`,
      importadoHaMin: minutosDesde(meta.fetchedAt),
    },
    configuracao: {
      zones,
      couriers,
      suppliers,
      dishes,
      dosesComFicha,
      margemPct: Math.round(config.purchaseMargin * 100),
    },
  };
};

const EUR_FORMAT = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
});

function KpiCard({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra?: string;
}) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        {extra !== undefined && <s-text color="subdued">{extra}</s-text>}
      </s-stack>
    </s-box>
  );
}

function DiaCard({ dia }: { dia: SemanaDia }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small">
        <s-heading>{`Confeção · ${dia.diaPT}`}</s-heading>
        <s-text color="subdued">
          {dia.encomendas === 1 ? "1 encomenda" : `${dia.encomendas} encomendas`}
          {" · "}
          {dia.refeicoes === 1 ? "1 refeição" : `${dia.refeicoes} refeições`}
        </s-text>
        {dia.canais.length > 0 && (
          <s-stack direction="inline" gap="small-200">
            {dia.canais.map((canal) => (
              <s-badge key={canal} tone="info">
                {canal}
              </s-badge>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-box>
  );
}

export default function Semana() {
  const { view, semana, configuracao } = useLoaderData<typeof loader>();
  const { kpis, dias, documentos } = view;

  const temEncomendas = kpis.encomendas > 0;
  const configurado = configuracao.zones > 0 && configuracao.couriers > 0;
  const isDemo = semana.source === "demo";
  const isImport = semana.source === "csv";
  const badgeModo = isDemo
    ? `Dados de demonstração — ${semana.weekLabel.replace(/\s*\(demonstração\)/, "")}`
    : isImport
      ? "Import manual de CSV"
      : "Dados da loja";
  const badgeTone = isDemo ? "warning" : isImport ? "info" : "success";

  return (
    <s-page heading={`Semana — ${semana.weekLabel}`}>
      <s-section>
        <s-stack gap="small">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={badgeTone}>{badgeModo}</s-badge>
            <s-text color="subdued">
              Janela: {semana.janela} · importado há {semana.importadoHaMin} min
            </s-text>
          </s-stack>

          {kpis.semZona > 0 && (
            <s-banner
              tone="warning"
              heading={
                kpis.semZona === 1
                  ? "1 encomenda sem zona"
                  : `${kpis.semZona} encomendas sem zona`
              }
            >
              <s-paragraph>
                Estas encomendas não têm zona correspondida (atributos de
                entrega em falta ou texto de zona desconhecido) e ficam fora
                dos cálculos de cozinha, rotas, compras e etiquetas até serem
                resolvidas. Confirma os textos em{" "}
                <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>.
              </s-paragraph>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {!temEncomendas ? (
        <s-section heading="Sem encomendas nesta janela">
          <s-banner tone="info" heading="Janela de importação vazia">
            <s-paragraph>
              Não há encomendas dentro da janela de importação{" "}
              {`(${semana.janela})`}. Confirma a janela nas{" "}
              <Link to="/app/definicoes/geral">Definições — Geral</Link> ou
              volta quando entrarem encomendas na loja.
            </s-paragraph>
          </s-banner>
        </s-section>
      ) : (
        <>
          <s-section heading="Resumo da semana">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
              gap="base"
            >
              <KpiCard
                label="Encomendas"
                value={String(kpis.encomendas)}
                extra={`${kpis.validas} válidas`}
              />
              <KpiCard label="Refeições" value={String(kpis.refeicoes)} />
              <KpiCard
                label="Faturação"
                value={EUR_FORMAT.format(kpis.faturacao)}
              />
              <KpiCard label="Clientes" value={String(kpis.clientes)} />
            </s-grid>
          </s-section>

          <s-section heading="Dias de confeção">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
              gap="base"
            >
              {dias.map((dia) => (
                <DiaCard key={dia.confDay} dia={dia} />
              ))}
            </s-grid>
          </s-section>

          <s-section heading="Documentos da semana">
            <s-table>
              <s-table-header-row>
                <s-table-header>Documento</s-table-header>
                <s-table-header>Estado</s-table-header>
                <s-table-header>Detalhe</s-table-header>
                <s-table-header>Exportar</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {documentos.map((doc) => (
                  <s-table-row key={doc.href}>
                    <s-table-cell>{doc.nome}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={doc.estado}>{doc.estadoLabel}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{doc.detalhe}</s-table-cell>
                    <s-table-cell>
                      <s-link href={doc.href} target="_blank">
                        Exportar
                      </s-link>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}

      <s-section heading="Estado da configuração">
        {!configurado && (
          <s-banner tone="warning" heading="Configuração incompleta">
            <s-paragraph>
              Sem zonas de entrega e estafetas configurados, a cozinha, as
              compras e as rotas não conseguem calcular. Começa pelas{" "}
              <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>.
            </s-paragraph>
          </s-banner>
        )}
        <s-table>
          <s-table-header-row>
            <s-table-header>Área</s-table-header>
            <s-table-header>Estado</s-table-header>
            <s-table-header>Abrir</s-table-header>
          </s-table-header-row>
          <s-table-body>
            <s-table-row>
              <s-table-cell>Zonas de entrega ativas</s-table-cell>
              <s-table-cell>
                <s-badge tone={configuracao.zones > 0 ? "success" : "critical"}>
                  {String(configuracao.zones)}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Estafetas / parceiros</s-table-cell>
              <s-table-cell>
                <s-badge
                  tone={configuracao.couriers > 0 ? "success" : "critical"}
                >
                  {String(configuracao.couriers)}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/parceiros">
                  Parceiros &amp; fornecedores
                </Link>
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Fornecedores</s-table-cell>
              <s-table-cell>
                <s-badge
                  tone={configuracao.suppliers > 0 ? "success" : "warning"}
                >
                  {String(configuracao.suppliers)}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/parceiros">
                  Parceiros &amp; fornecedores
                </Link>
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Pratos com ficha técnica</s-table-cell>
              <s-table-cell>
                <s-badge
                  tone={configuracao.dosesComFicha > 0 ? "success" : "warning"}
                >
                  {`${configuracao.dosesComFicha} doses com ficha · ${configuracao.dishes} pratos`}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/fichas">Fichas técnicas</Link>
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Janela e margem de compras</s-table-cell>
              <s-table-cell>
                <s-badge tone="success">
                  {`margem +${configuracao.margemPct} %`}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/geral">Geral</Link>
              </s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
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
