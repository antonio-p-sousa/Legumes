import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  loadComponentFactors,
  loadWeekData,
} from "../services/pages/common.server";
import {
  buildCozinhaView,
  weekLabelFileToken,
  type CozinhaDay,
  type CozinhaView,
  type DoseMatrix,
} from "../services/pages/cozinha.server";
import type { ComponentPlan, KitchenRow } from "../services/weekly";

type LoaderResult =
  | {
      ok: true;
      view: CozinhaView;
      source: "demo" | "live" | "csv";
      weekLabel: string;
      weekToken: string;
    }
  | { ok: false; error: string };

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderResult> => {
  const { admin } = await authenticate.admin(request);

  try {
    const [weekData, dishes, componentFactors] = await Promise.all([
      loadWeekData(prisma, admin),
      prisma.dish.findMany({
        select: { baseName: true, category: true },
        orderBy: { baseName: "asc" },
      }),
      loadComponentFactors(prisma),
    ]);

    return {
      ok: true,
      view: buildCozinhaView(weekData, dishes, componentFactors),
      source: weekData.meta.source,
      weekLabel: weekData.meta.weekLabel,
      weekToken: weekLabelFileToken(weekData.meta.weekLabel),
    };
  } catch (error) {
    console.error("Falha a carregar a semana para a página Cozinha", error);
    return {
      ok: false,
      error:
        "Não foi possível carregar as encomendas da semana. Atualiza a página; se o problema persistir, verifica a ligação à loja.",
    };
  }
};

// ── Componentes de apresentação ──────────────────────────────────────────────

function QuantityCell({ value }: { value: number | null }) {
  if (value === null) {
    return <s-text color="subdued">—</s-text>;
  }
  return <s-text fontVariantNumeric="tabular-nums">{String(value)}</s-text>;
}

function DoseMatrixTable({
  heading,
  matrix,
}: {
  heading: string;
  matrix: DoseMatrix;
}) {
  if (matrix.rows.length === 0) return null;

  return (
    <s-section heading={heading}>
      <s-table>
        <s-table-header-row>
          <s-table-header>Prato</s-table-header>
          {matrix.doseColumns.map((dose) => (
            <s-table-header key={dose} format="numeric">
              {dose}
            </s-table-header>
          ))}
          <s-table-header format="numeric">Total</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {matrix.rows.map((row) => (
            <s-table-row key={row.dish}>
              <s-table-cell>{row.dish}</s-table-cell>
              {row.cells.map((cell, index) => (
                <s-table-cell key={matrix.doseColumns[index]}>
                  <QuantityCell value={cell} />
                </s-table-cell>
              ))}
              <s-table-cell>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {String(row.total)}
                </s-text>
              </s-table-cell>
            </s-table-row>
          ))}
          <s-table-row>
            <s-table-cell>
              <s-text type="strong">Total</s-text>
            </s-table-cell>
            {matrix.columnTotals.map((total, index) => (
              <s-table-cell key={matrix.doseColumns[index]}>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {String(total)}
                </s-text>
              </s-table-cell>
            ))}
            <s-table-cell>
              <s-text type="strong" fontVariantNumeric="tabular-nums">
                {String(matrix.total)}
              </s-text>
            </s-table-cell>
          </s-table-row>
        </s-table-body>
      </s-table>
    </s-section>
  );
}

function SimpleRowsTable({
  heading,
  rows,
  showDose,
}: {
  heading: string;
  rows: KitchenRow[];
  showDose: boolean;
}) {
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <s-section heading={heading}>
      <s-table>
        <s-table-header-row>
          <s-table-header>Prato</s-table-header>
          {showDose && <s-table-header>Dose</s-table-header>}
          <s-table-header format="numeric">Quantidade</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {rows.map((row) => (
            <s-table-row key={`${row.dish}|${row.dose}`}>
              <s-table-cell>{row.dish}</s-table-cell>
              {showDose && <s-table-cell>{row.dose}</s-table-cell>}
              <s-table-cell>
                <s-text fontVariantNumeric="tabular-nums">
                  {String(row.quantity)}
                </s-text>
              </s-table-cell>
            </s-table-row>
          ))}
          <s-table-row>
            <s-table-cell>
              <s-text type="strong">Total</s-text>
            </s-table-cell>
            {showDose && <s-table-cell> </s-table-cell>}
            <s-table-cell>
              <s-text type="strong" fontVariantNumeric="tabular-nums">
                {String(total)}
              </s-text>
            </s-table-cell>
          </s-table-row>
        </s-table-body>
      </s-table>
    </s-section>
  );
}

/** kg com até 3 casas, em formato pt-PT ("12,345"). */
function formatKg(value: number): string {
  return value.toLocaleString("pt-PT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function ProducaoDoDia({
  day,
  plan,
}: {
  day: CozinhaDay;
  plan?: ComponentPlan;
}) {
  const planDay = plan?.days.find((d) => d.confDay === day.confDay);
  const skippedUnits =
    plan?.skipped.reduce((sum, entry) => sum + entry.units, 0) ?? 0;

  return (
    <s-section slot="aside" heading="Produção do dia">
      <s-stack gap="base">
        <s-stack direction="inline" gap="large">
          <s-stack gap="small-300">
            <s-text color="subdued">Refeições</s-text>
            <s-heading>{String(day.totalMeals)}</s-heading>
          </s-stack>
          <s-stack gap="small-300">
            <s-text color="subdued">Sacos</s-text>
            <s-heading>{String(day.totalOrders)}</s-heading>
          </s-stack>
        </s-stack>
        {plan && (
          <>
            <s-divider />
            <s-stack gap="small-300">
              <s-text type="strong">Empratamento por componentes</s-text>
              <s-text fontVariantNumeric="tabular-nums">
                {`Proteína ${formatKg(planDay?.kg["Proteína"] ?? 0)} kg · ` +
                  `Hidratos ${formatKg(planDay?.kg["Hidratos"] ?? 0)} kg · ` +
                  `Legumes ${formatKg(planDay?.kg["Legumes"] ?? 0)} kg`}
              </s-text>
              {skippedUnits > 0 && (
                <s-text color="subdued">
                  {`${skippedUnits} ${
                    skippedUnits === 1 ? "refeição" : "refeições"
                  } de dose única fora do cálculo de componentes`}
                </s-text>
              )}
            </s-stack>
          </>
        )}
        <s-divider />
        <s-stack gap="small">
          <s-text type="strong">Notas para a cozinha</s-text>
          {day.notes.length === 0 ? (
            <s-paragraph color="subdued">
              Sem notas de encomendas neste dia.
            </s-paragraph>
          ) : (
            day.notes.map((note) => (
              <s-box
                key={note.orderName}
                padding="small"
                background="subdued"
                borderRadius="base"
              >
                <s-stack gap="small-300">
                  <s-text type="strong">{note.orderName}</s-text>
                  <s-paragraph>{note.note}</s-paragraph>
                </s-stack>
              </s-box>
            ))
          )}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function Cozinha() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data.ok) {
    return (
      <s-page heading="Cozinha">
        <s-section>
          <s-banner tone="critical" heading="Erro a carregar a semana">
            <s-paragraph>{data.error}</s-paragraph>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const { view, source, weekLabel, weekToken } = data;

  const diaParam = searchParams.get("dia");
  const selectedDay =
    view.days.find((day) => day.confDay === diaParam) ?? view.days[0];

  const selectDay = (confDay: string) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("dia", confDay);
        return next;
      },
      { preventScrollReset: true },
    );
  };

  return (
    <s-page heading="Cozinha">
      <s-section>
        <s-stack gap="base">
          <s-stack
            direction="inline"
            gap="base"
            justifyContent="space-between"
            alignItems="center"
          >
            {source === "demo" ? (
              <s-badge tone="warning">
                {`Dados de demonstração — ${weekToken}`}
              </s-badge>
            ) : source === "csv" ? (
              <s-badge tone="info">{`Import manual — ${weekLabel}`}</s-badge>
            ) : (
              <s-badge tone="success">{`Semana ${weekLabel}`}</s-badge>
            )}
            <s-stack direction="inline" gap="small">
              <s-button href="/app/api/export/cozinha" variant="primary">
                Exportar xlsx
              </s-button>
              <s-button href="/app/api/export/etiquetas">
                Exportar etiquetas
              </s-button>
              <s-button
                href={
                  selectedDay
                    ? `/app/print/cozinha?dia=${selectedDay.confDay}`
                    : "/app/print/cozinha"
                }
                target="_blank"
              >
                Imprimir / PDF
              </s-button>
              <s-button href="/app/print/etiquetas" target="_blank">
                Imprimir etiquetas
              </s-button>
            </s-stack>
          </s-stack>

          {view.days.length === 0 ? (
            <s-banner tone="info" heading="Sem encomendas para produzir">
              <s-paragraph>
                Não há encomendas com dia de confeção resolvido nesta semana.
                Ou a janela de importação ainda não tem encomendas, ou as
                encomendas existentes estão sem zona/atributos de entrega —
                nesse caso resolve-as primeiro na página Semana.
              </s-paragraph>
            </s-banner>
          ) : (
            <s-stack direction="inline" gap="small">
              {view.days.map((day) => (
                <s-button
                  key={day.confDay}
                  variant={
                    day.confDay === selectedDay?.confDay
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() => selectDay(day.confDay)}
                >
                  {`${day.label} · ${day.totalMeals} refeições`}
                </s-button>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {selectedDay && (
        <>
          <DoseMatrixTable
            heading="Peixe & Carne"
            matrix={selectedDay.peixeCarne}
          />
          <DoseMatrixTable
            heading="Vegetariano"
            matrix={selectedDay.vegetariano}
          />
          <SimpleRowsTable heading="Pokes" rows={selectedDay.pokes} showDose />
          <SimpleRowsTable
            heading="Dose Única"
            rows={selectedDay.doseUnica}
            showDose={false}
          />
          <ProducaoDoDia day={selectedDay} plan={view.componentPlan} />
        </>
      )}

      {view.nonMeal.length > 0 && (
        <s-section heading="Não-cozinha (semana inteira)">
          <s-paragraph color="subdued">
            Subscrições, embalagens e outros itens que não entram na produção
            nem nos totais de refeições.
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header>Item</s-table-header>
              <s-table-header format="numeric">Quantidade</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {view.nonMeal.map((row) => (
                <s-table-row key={`${row.dish}|${row.dose}`}>
                  <s-table-cell>{row.dish}</s-table-cell>
                  <s-table-cell>
                    <s-text fontVariantNumeric="tabular-nums">
                      {String(row.quantity)}
                    </s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
