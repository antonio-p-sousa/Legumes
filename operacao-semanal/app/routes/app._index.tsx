import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig } from "../services/definicoes/config.server";
import { loadWeekData } from "../services/pages/common.server";
import {
  buildSemanaView,
  formatDataHoraPt,
  minutosDesde,
  type ChecklistPasso,
  type SemanaDia,
} from "../services/pages/semana.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [
    weekData,
    config,
    zones,
    couriers,
    suppliers,
    dishes,
    dosesComFicha,
  ] = await Promise.all([
    loadWeekData(prisma, admin),
    getConfig(prisma),
    prisma.zone.count({ where: { active: true } }),
    prisma.courier.count(),
    prisma.supplier.count(),
    prisma.dish.count(),
    prisma.dose.count({ where: { ingredients: { some: {} } } }),
  ]);

  const view = buildSemanaView(weekData, config);
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

/**
 * Um passo da checklist semanal: número + título, badge de estado (só no
 * passo "Rever avisos"), detalhe derivado do motor e os botões de print/
 * export — o mesmo padrão de s-button secundário com href das rotas de
 * export na página Estafetas.
 */
function ChecklistPassoCard({ passo }: { passo: ChecklistPasso }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-heading>{`${passo.numero}. ${passo.titulo}`}</s-heading>
          {passo.badge !== undefined && (
            <s-badge tone={passo.badge.tone}>{passo.badge.label}</s-badge>
          )}
        </s-stack>
        <s-text color="subdued">{passo.detalhe}</s-text>
        {passo.botoes.length > 0 && (
          <s-stack direction="inline" gap="small">
            {passo.botoes.map((botao) => (
              <s-button
                key={botao.href}
                variant="secondary"
                href={botao.href}
                target="_blank"
                disabled={botao.disabled}
              >
                {botao.label}
              </s-button>
            ))}
          </s-stack>
        )}
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
  const { kpis, dias, avisos, checklist } = view;

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

          {avisos.posFecho.count > 0 && (
            <s-banner
              tone="info"
              heading={
                avisos.posFecho.count === 1
                  ? "1 encomenda recebida depois do fecho"
                  : `${avisos.posFecho.count} encomendas recebidas depois do fecho`
              }
            >
              <s-paragraph>
                {avisos.posFecho.count === 1
                  ? "Esta encomenda entrou"
                  : "Estas encomendas entraram"}{" "}
                na loja depois do fecho da janela e{" "}
                {avisos.posFecho.count === 1
                  ? "foi incluída e assinalada"
                  : "foram incluídas e assinaladas"}{" "}
                nos cálculos — foi a opção escolhida em{" "}
                <Link to="/app/definicoes/geral">Definições — Geral</Link>{" "}
                (incluir e assinalar as pós-fecho, em vez de as excluir).{" "}
                Encomendas: {avisos.posFecho.lista}.
              </s-paragraph>
            </s-banner>
          )}

          {avisos.dataAnomala.count > 0 && (
            <s-banner
              tone="warning"
              heading={
                avisos.dataAnomala.count === 1
                  ? "1 encomenda com data de entrega fora do intervalo esperado"
                  : `${avisos.dataAnomala.count} encomendas com data de entrega fora do intervalo esperado`
              }
            >
              <s-paragraph>
                {avisos.dataAnomala.count === 1
                  ? "Esta encomenda tem uma data de entrega"
                  : "Estas encomendas têm datas de entrega"}{" "}
                fora do intervalo esperado para esta semana (data passada ou
                demasiado distante) e{" "}
                {avisos.dataAnomala.count === 1
                  ? "foi incluída"
                  : "foram incluídas"}{" "}
                nos cálculos — verifica a data no Shopify antes de fechar a
                semana (o site às vezes deixa escolher datas erradas).{" "}
                Encomendas: {avisos.dataAnomala.lista}.
              </s-paragraph>
            </s-banner>
          )}

          {avisos.semAtributos.count > 0 && (
            <s-banner
              tone="warning"
              heading={
                avisos.semAtributos.count === 1
                  ? "1 encomenda sem atributos de entrega"
                  : `${avisos.semAtributos.count} encomendas sem atributos de entrega`
              }
            >
              <s-paragraph>
                Estas encomendas não trazem o bloco de atributos de entrega
                (data, horário e zona) e ficam fora dos cálculos de cozinha,
                rotas, compras e etiquetas até serem corrigidas no Shopify.{" "}
                Encomendas: {avisos.semAtributos.lista}.
              </s-paragraph>
            </s-banner>
          )}

          {avisos.semZona.count > 0 && (
            <s-banner
              tone="warning"
              heading={
                avisos.semZona.count === 1
                  ? "1 encomenda sem zona"
                  : `${avisos.semZona.count} encomendas sem zona`
              }
            >
              <s-paragraph>
                Estas encomendas têm um texto de zona que não corresponde a
                nenhuma zona configurada e ficam fora dos cálculos de cozinha,
                rotas, compras e etiquetas até serem resolvidas. Confirma os
                textos em{" "}
                <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>.{" "}
                Encomendas: {avisos.semZona.lista}.
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

          <s-section heading="Checklist da semana">
            <s-stack gap="base">
              {checklist.map((passo) => (
                <ChecklistPassoCard key={passo.numero} passo={passo} />
              ))}
            </s-stack>
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
