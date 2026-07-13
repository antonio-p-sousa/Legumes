import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getConfig, updateConfig } from "../services/definicoes/config.server";
import {
  joinWindowPoint,
  splitWindowPoint,
} from "../services/definicoes/config.shared";

const DIAS = [
  { value: "MON", label: "Segunda" },
  { value: "TUE", label: "Terça" },
  { value: "WED", label: "Quarta" },
  { value: "THU", label: "Quinta" },
  { value: "FRI", label: "Sexta" },
  { value: "SAT", label: "Sábado" },
  { value: "SUN", label: "Domingo" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const config = await getConfig(prisma);
  return { config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const form = await request.formData();
  const str = (name: string) => String(form.get(name) ?? "");

  // A UI mostra percentagem 0–100; o motor guarda fração 0–1.
  const marginRaw = str("purchaseMarginPct").trim().replace(",", ".");
  const marginPct = marginRaw === "" ? Number.NaN : Number(marginRaw);

  const result = await updateConfig(prisma, {
    orderWindowFrom: joinWindowPoint(
      str("orderWindowFromDay"),
      str("orderWindowFromTime"),
    ),
    orderWindowTo: joinWindowPoint(
      str("orderWindowToDay"),
      str("orderWindowToTime"),
    ),
    ignoreAfterClose: form.get("ignoreAfterClose") != null,
    purchaseMargin: marginPct / 100,
    dpdAccount: str("dpdAccount"),
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }
  return { ok: true as const };
};

export default function DefinicoesGeral() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("Definições guardadas.");
    }
  }, [actionData, shopify]);

  const errors = actionData && !actionData.ok ? actionData.errors : undefined;

  const from = splitWindowPoint(config.orderWindowFrom);
  const to = splitWindowPoint(config.orderWindowTo);
  const marginPct = Math.round(config.purchaseMargin * 10000) / 100;

  return (
    <s-page heading="Geral">
      <s-banner tone="info" heading="A ementa muda-se no Shopify">
        <s-paragraph>
          A troca de ementa no site continua a ser feita no Shopify (coleções +
          app Delivery &amp; Pickup). Esta app apenas lê as encomendas — nada do
          que defines aqui altera a loja.
        </s-paragraph>
      </s-banner>

      {errors && (
        <s-banner tone="critical" heading="Não foi possível guardar">
          <s-paragraph>
            Corrige os campos assinalados abaixo e volta a guardar.
          </s-paragraph>
        </s-banner>
      )}

      <Form method="post">
        <s-section heading="Janela de encomendas">
          <s-paragraph>
            Só as encomendas feitas dentro desta janela entram na semana a
            preparar (ementa atual).
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-select
              label="Dia de abertura"
              name="orderWindowFromDay"
              value={from.day}
            >
              {DIAS.map((dia) => (
                <s-option key={dia.value} value={dia.value}>
                  {dia.label}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              label="Hora de abertura"
              name="orderWindowFromTime"
              defaultValue={from.time}
              placeholder="00:00"
              details="Formato 24h, HH:MM."
              error={errors?.orderWindowFrom}
            />
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-select
              label="Dia de fecho"
              name="orderWindowToDay"
              value={to.day}
            >
              {DIAS.map((dia) => (
                <s-option key={dia.value} value={dia.value}>
                  {dia.label}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              label="Hora de fecho"
              name="orderWindowToTime"
              defaultValue={to.time}
              placeholder="23:59"
              details="Formato 24h, HH:MM."
              error={errors?.orderWindowTo}
            />
          </s-stack>
          <s-switch
            label="Excluir e sinalizar encomendas após o fecho"
            name="ignoreAfterClose"
            defaultChecked={config.ignoreAfterClose}
            details="Encomendas feitas depois do fecho pertencem à ementa seguinte: ficam fora dos cálculos e são sinalizadas no cockpit."
          />
        </s-section>

        <s-section heading="Compras">
          <s-number-field
            label="Margem de compras"
            name="purchaseMarginPct"
            defaultValue={String(marginPct)}
            min={0}
            max={100}
            step={0.1}
            suffix="%"
            details="Margem de segurança aplicada às quantidades da lista de compras."
            error={errors?.purchaseMargin}
          />
        </s-section>

        <s-section heading="DPD">
          <s-text-field
            label="Conta de remetente"
            name="dpdAccount"
            defaultValue={config.dpdAccount ?? ""}
            placeholder="03290201"
            details="Aparece na 1.ª coluna do CSV DPD. Deixa vazio enquanto não tiveres a conta."
            error={errors?.dpdAccount}
          />
        </s-section>

        <s-section>
          <s-button type="submit" variant="primary">
            Guardar
          </s-button>
        </s-section>
      </Form>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
