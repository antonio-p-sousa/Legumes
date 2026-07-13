import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Semana</s-link>
        <s-link href="/app/cozinha">Cozinha</s-link>
        <s-link href="/app/compras">Compras</s-link>
        <s-link href="/app/estafetas">Estafetas</s-link>
        <s-link href="/app/definicoes/fichas">Fichas técnicas</s-link>
        <s-link href="/app/definicoes/zonas">Zonas &amp; dias</s-link>
        <s-link href="/app/definicoes/parceiros">Parceiros &amp; fornecedores</s-link>
        <s-link href="/app/definicoes/geral">Geral</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
