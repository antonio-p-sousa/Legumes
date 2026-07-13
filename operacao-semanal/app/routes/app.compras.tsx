import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig } from "../services/definicoes/config.server";
import { loadRecipes, loadWeekData } from "../services/pages/common.server";
import {
  buildComprasView,
  type ComprasMissingDish,
  type ComprasSupplier,
} from "../services/pages/compras.server";

/** Quantos pratos sem ficha aparecem no banner (a tabela mostra todos). */
const MISSING_BANNER_TOP = 6;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [weekData, recipes, config, supplierRows] = await Promise.all([
    loadWeekData(prisma, admin),
    loadRecipes(prisma),
    getConfig(prisma),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);

  const view = buildComprasView(
    weekData,
    recipes,
    config.purchaseMargin,
    supplierRows,
  );

  return {
    view,
    weekLabel: weekData.meta.weekLabel,
    source: weekData.meta.source,
    marginPct: Math.round(config.purchaseMargin * 100),
  };
};

const QTY_FORMAT = new Intl.NumberFormat("pt-PT", {
  maximumFractionDigits: 3,
});

function formatQty(value: number): string {
  return QTY_FORMAT.format(value);
}

function exportUrl(fornecedor?: string): string {
  return fornecedor
    ? `/app/api/export/compras?fornecedor=${encodeURIComponent(fornecedor)}`
    : "/app/api/export/compras";
}

function missingHeading(count: number, unitsTotal: number): string {
  const pratos = count === 1 ? "1 prato sem ficha técnica" : `${count} pratos sem ficha técnica`;
  const refeicoes =
    unitsTotal === 1
      ? "1 refeição NÃO refletida nas quantidades"
      : `${unitsTotal} refeições NÃO refletidas nas quantidades`;
  return `${pratos} — ${refeicoes}`;
}

export default function Compras() {
  const { view, weekLabel, source, marginPct } = useLoaderData<typeof loader>();
  const { suppliers, missing, stats } = view;

  const hasSuppliers = suppliers.length > 0;
  const hasMissing = missing.count > 0;
  const isEmpty = !hasSuppliers && !hasMissing;

  return (
    <s-page heading={`Compras — ${weekLabel}`}>
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone={source === "live" ? "success" : "warning"}>
              {source === "live" ? "Dados da loja" : "Dados de demonstração"}
            </s-badge>
            <s-text color="subdued">{`margem +${marginPct} % aplicada às quantidades`}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              variant="primary"
              href={exportUrl()}
              download=""
              disabled={isEmpty}
            >
              Exportar tudo
            </s-button>
            <s-button
              variant="secondary"
              disabled
              accessibilityLabel="Enviar aos fornecedores — envio por email por decidir"
            >
              Enviar aos fornecedores
            </s-button>
            <s-text color="subdued">envio por email por decidir</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {hasMissing && (
        <s-banner
          tone="critical"
          heading={missingHeading(missing.count, missing.unitsTotal)}
        >
          <s-stack gap="small">
            <s-unordered-list>
              {missing.top.slice(0, MISSING_BANNER_TOP).map((entry) => (
                <s-list-item key={`${entry.dish}|${entry.dose}`}>
                  {`${entry.dish} — ${entry.dose} — ${entry.unitsSold} ${
                    entry.unitsSold === 1 ? "unidade" : "unidades"
                  }`}
                </s-list-item>
              ))}
            </s-unordered-list>
            <s-paragraph>
              <Link to="/app/definicoes/fichas">Criar fichas técnicas</Link>
            </s-paragraph>
          </s-stack>
        </s-banner>
      )}

      <s-section heading="Resumo">
        <s-stack direction="inline" gap="base">
          <KpiCard label="Fornecedores" value={stats.fornecedores} />
          <KpiCard label="Ingredientes" value={stats.ingredientes} />
          <KpiCard label="Alertas" value={stats.alertas} />
        </s-stack>
      </s-section>

      {suppliers.map((supplier) => (
        <SupplierCard key={supplier.supplier} supplier={supplier} />
      ))}

      {!hasSuppliers && hasMissing && (
        <s-section heading="Pratos sem ficha técnica">
          <s-stack gap="base">
            <s-paragraph color="subdued">
              Sem fichas técnicas, o motor não consegue converter as refeições
              vendidas em quantidades de compra. Esta é a lista completa do que
              foi vendido esta semana sem ficha, ordenada por unidades — usa-a
              como guia para criares as fichas mais urgentes primeiro.
            </s-paragraph>
            <MissingTable entries={missing.top} />
            <s-paragraph>
              <Link to="/app/definicoes/fichas">Criar fichas técnicas</Link>
            </s-paragraph>
          </s-stack>
        </s-section>
      )}

      {isEmpty && (
        <s-section heading="Sem compras para calcular">
          <s-stack gap="base">
            <s-paragraph>
              Não há encomendas com dia de confeção resolvido nesta janela, por
              isso não há quantidades de compra para mostrar. Confirma a janela
              de encomendas nas{" "}
              <Link to="/app/definicoes/geral">Definições gerais</Link> e
              garante que os pratos têm{" "}
              <Link to="/app/definicoes/fichas">fichas técnicas</Link> — são
              elas que alimentam este cálculo.
            </s-paragraph>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <s-stack
      gap="small-300"
      padding="base"
      border="base"
      borderRadius="base"
      minInlineSize="160px"
    >
      <s-text color="subdued">{label}</s-text>
      <s-heading>{String(value)}</s-heading>
    </s-stack>
  );
}

function SupplierCard({ supplier }: { supplier: ComprasSupplier }) {
  return (
    <s-section heading={supplier.supplier}>
      <s-stack gap="base">
        {(supplier.orderDay || supplier.email) && (
          <s-stack direction="inline" gap="base" alignItems="center">
            {supplier.orderDay && (
              <s-badge tone="info">{`encomendar ${supplier.orderDay}`}</s-badge>
            )}
            {supplier.email && (
              <s-text color="subdued">{supplier.email}</s-text>
            )}
          </s-stack>
        )}
        <s-table>
          <s-table-header-row>
            <s-table-header>Ingrediente</s-table-header>
            <s-table-header>Necessário</s-table-header>
            <s-table-header>+margem</s-table-header>
            <s-table-header>Unidade</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {supplier.lines.map((line) => (
              <s-table-row key={line.ingredient}>
                <s-table-cell>{line.ingredient}</s-table-cell>
                <s-table-cell>{formatQty(line.required)}</s-table-cell>
                <s-table-cell>{formatQty(line.withMargin)}</s-table-cell>
                <s-table-cell>{line.unit}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-box>
          <s-button href={exportUrl(supplier.supplier)} download="">
            Exportar
          </s-button>
        </s-box>
      </s-stack>
    </s-section>
  );
}

function MissingTable({ entries }: { entries: ComprasMissingDish[] }) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header>Prato</s-table-header>
        <s-table-header>Dose</s-table-header>
        <s-table-header>Unidades vendidas</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {entries.map((entry) => (
          <s-table-row key={`${entry.dish}|${entry.dose}`}>
            <s-table-cell>{entry.dish}</s-table-cell>
            <s-table-cell>{entry.dose}</s-table-cell>
            <s-table-cell>{String(entry.unitsSold)}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
