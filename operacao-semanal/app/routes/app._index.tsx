import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [zones, couriers, suppliers, dishes, dosesComFicha, config] =
    await Promise.all([
      prisma.zone.count({ where: { active: true } }),
      prisma.courier.count(),
      prisma.supplier.count(),
      prisma.dish.count(),
      prisma.dose.count({ where: { ingredients: { some: {} } } }),
      prisma.appConfig.findUnique({ where: { id: "singleton" } }),
    ]);

  return { zones, couriers, suppliers, dishes, dosesComFicha, config };
};

export default function Semana() {
  const { zones, couriers, suppliers, dishes, dosesComFicha, config } =
    useLoaderData<typeof loader>();

  const configurado = zones > 0 && couriers > 0;

  return (
    <s-page heading="Semana">
      <s-section heading="Importação de encomendas">
        <s-banner tone="info" heading="Disponível na Fase 3">
          <s-paragraph>
            O cockpit da semana — importação das encomendas do Shopify,
            métricas e geração dos documentos — chega quando a app estiver
            ligada à loja. Entretanto, deixa as Definições prontas: são elas
            que alimentam os cálculos.
          </s-paragraph>
        </s-banner>
      </s-section>

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
                <s-badge tone={zones > 0 ? "success" : "critical"}>
                  {String(zones)}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/zonas">Zonas &amp; dias</Link>
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Estafetas / parceiros</s-table-cell>
              <s-table-cell>
                <s-badge tone={couriers > 0 ? "success" : "critical"}>
                  {String(couriers)}
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
                <s-badge tone={suppliers > 0 ? "success" : "warning"}>
                  {String(suppliers)}
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
                <s-badge tone={dosesComFicha > 0 ? "success" : "warning"}>
                  {`${dosesComFicha} doses com ficha · ${dishes} pratos`}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                <Link to="/app/definicoes/fichas">Fichas técnicas</Link>
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Janela e margem de compras</s-table-cell>
              <s-table-cell>
                <s-badge tone={config ? "success" : "warning"}>
                  {config
                    ? `margem +${Math.round(config.purchaseMargin * 100)} %`
                    : "por definir (usa os valores padrão)"}
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
