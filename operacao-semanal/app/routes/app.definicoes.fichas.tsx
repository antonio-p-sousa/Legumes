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
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  addDose,
  createDish,
  deleteDish,
  deleteDose,
  getDoseRecipe,
  listDishes,
  removeRecipeLine,
  toggleDoseActive,
  upsertRecipeLine,
  type FieldErrors,
} from "../services/definicoes/fichas.server";
import {
  DISH_CATEGORIES,
  INGREDIENT_UNITS,
} from "../services/definicoes/fichas.shared";

const FICHAS_PATH = "/app/definicoes/fichas";

const CATEGORY_LABELS: Record<string, string> = {
  peixe: "Peixe",
  carne: "Carne",
  vegetariano: "Vegetariano",
  poke: "Poke",
  pizza: "Pizza",
  sopa: "Sopa",
  sobremesa: "Sobremesa",
  embalagem: "Embalagem",
  outro: "Outro",
};

function editorUrl(dishId: string, doseId?: string | null): string {
  return doseId
    ? `${FICHAS_PATH}?dish=${dishId}&dose=${doseId}`
    : `${FICHAS_PATH}?dish=${dishId}`;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const dishParam = url.searchParams.get("dish");
  const doseParam = url.searchParams.get("dose");

  const dishes = await listDishes(prisma);
  const selectedDish = dishParam
    ? (dishes.find((dish) => dish.id === dishParam) ?? null)
    : null;

  let recipe = null;
  if (selectedDish) {
    const doseId =
      doseParam && selectedDish.doses.some((dose) => dose.id === doseParam)
        ? doseParam
        : (selectedDish.doses.find((dose) => dose.active)?.id ??
          selectedDish.doses[0]?.id ??
          null);
    if (doseId) {
      recipe = await getDoseRecipe(prisma, doseId);
    }
  }

  return { dishes, selectedDish, recipe };
};

// ── Action ────────────────────────────────────────────────────────────────────

type ActionResult =
  | { ok: true; intent: string; message: string }
  | { ok: false; intent: string; errors: FieldErrors };

function success(intent: string, message: string): ActionResult {
  return { ok: true, intent, message };
}

function failure(intent: string, errors: FieldErrors): ActionResult {
  return { ok: false, intent, errors };
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

/** Aceita vírgula decimal ("0,25") — o serviço valida > 0 e finito. */
function parseQty(formData: FormData, name: string): number {
  const raw = text(formData, name).trim().replace(",", ".");
  return raw === "" ? NaN : Number(raw);
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = text(formData, "intent");

  switch (intent) {
    case "create-dish": {
      const result = await createDish(prisma, {
        baseName: text(formData, "baseName"),
        category: text(formData, "category"),
      });
      return result.ok
        ? success(intent, `Prato "${result.data.baseName}" criado.`)
        : failure(intent, result.errors);
    }
    case "delete-dish": {
      const result = await deleteDish(prisma, text(formData, "dishId"));
      return result.ok
        ? success(intent, `Prato "${result.data.baseName}" apagado.`)
        : failure(intent, result.errors);
    }
    case "add-dose": {
      const result = await addDose(
        prisma,
        text(formData, "dishId"),
        text(formData, "label"),
      );
      return result.ok
        ? success(intent, `Dose "${result.data.label}" criada.`)
        : failure(intent, result.errors);
    }
    case "toggle-dose": {
      const result = await toggleDoseActive(prisma, text(formData, "doseId"));
      return result.ok
        ? success(
            intent,
            result.data.active
              ? `Dose "${result.data.label}" ativada.`
              : `Dose "${result.data.label}" desativada.`,
          )
        : failure(intent, result.errors);
    }
    case "delete-dose": {
      const result = await deleteDose(prisma, text(formData, "doseId"));
      return result.ok
        ? success(intent, `Dose "${result.data.label}" apagada.`)
        : failure(intent, result.errors);
    }
    case "upsert-line": {
      const result = await upsertRecipeLine(prisma, {
        doseId: text(formData, "doseId"),
        ingredientName: text(formData, "ingredientName"),
        unit: text(formData, "unit"),
        supplierName: text(formData, "supplierName") || null,
        qtyPerMeal: parseQty(formData, "qtyPerMeal"),
      });
      return result.ok
        ? success(intent, `Ingrediente "${result.data.ingredientName}" guardado na ficha.`)
        : failure(intent, result.errors);
    }
    case "remove-line": {
      const result = await removeRecipeLine(prisma, text(formData, "lineId"));
      return result.ok
        ? success(intent, `Ingrediente "${result.data.ingredientName}" removido da ficha.`)
        : failure(intent, result.errors);
    }
    default:
      return failure(intent, {
        intent: "Operação desconhecida. Atualiza a página e tenta de novo.",
      });
  }
};

// ── Componente ────────────────────────────────────────────────────────────────

/** Campos com erro apresentado inline no próprio formulário, por intent. */
const INLINE_ERROR_KEYS: Record<string, string[]> = {
  "create-dish": ["baseName", "category"],
  "add-dose": ["label"],
  "upsert-line": ["ingredientName", "qtyPerMeal", "unit", "supplierName"],
};

export default function FichasTecnicas() {
  const { dishes, selectedDish, recipe } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  const failed = actionData && !actionData.ok ? actionData : null;
  const fieldError = (intent: string, field: string): string | undefined =>
    failed && failed.intent === intent ? failed.errors[field] : undefined;
  const bannerMessages = failed
    ? Object.entries(failed.errors)
        .filter(([key]) => !(INLINE_ERROR_KEYS[failed.intent] ?? []).includes(key))
        .map(([, message]) => message)
    : [];

  // Action explícita com os query params atuais para o editor não fechar
  // depois de submeter (o loader volta a ler ?dish/?dose).
  const formAction = selectedDish
    ? editorUrl(selectedDish.id, recipe?.dose.id)
    : FICHAS_PATH;

  return (
    <s-page heading="Fichas técnicas">
      <s-banner tone="warning" heading="Fichas em falta afetam as compras">
        <s-paragraph>
          Pratos sem ficha aparecem na lista de compras como &quot;sem
          ficha&quot; — as quantidades calculadas não incluem esses pratos.
          Preenche a ficha de cada dose ativa antes de gerar a semana.
        </s-paragraph>
      </s-banner>

      {bannerMessages.length > 0 && (
        <s-banner tone="critical" heading="Não foi possível concluir a operação">
          {bannerMessages.map((message) => (
            <s-paragraph key={message}>{message}</s-paragraph>
          ))}
        </s-banner>
      )}

      <s-section heading="Pratos">
        {dishes.length === 0 ? (
          <s-banner tone="info" heading="Ainda não há pratos">
            <s-paragraph>
              Os pratos da ementa são criados pelo seed a partir das encomendas
              do Shopify. As receitas (ingredientes e quantidades por dose) têm
              de ser preenchidas à mão nesta página — os materiais do cliente
              ainda estão por receber. Podes também criar pratos manualmente no
              formulário &quot;Novo prato&quot; abaixo.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Prato</s-table-header>
              <s-table-header>Categoria</s-table-header>
              <s-table-header>Doses</s-table-header>
              <s-table-header>Ficha</s-table-header>
              <s-table-header>Ações</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {dishes.map((dish) => (
                <s-table-row key={dish.id}>
                  <s-table-cell>{dish.baseName}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone="neutral">
                      {CATEGORY_LABELS[dish.category] ?? dish.category}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {dish.doses.length === 0 ? (
                      <s-text color="subdued">—</s-text>
                    ) : (
                      <s-stack direction="inline" gap="small-300">
                        {dish.doses.map((dose) =>
                          dose.active ? (
                            <s-badge key={dose.id} tone="info">
                              {dose.label}
                            </s-badge>
                          ) : (
                            <s-badge key={dose.id} tone="neutral">
                              {`${dose.label} · inativa`}
                            </s-badge>
                          ),
                        )}
                      </s-stack>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {dish.status === "completa" && (
                      <s-badge tone="success">Completa</s-badge>
                    )}
                    {dish.status === "incompleta" && (
                      <s-badge tone="critical">
                        {dish.activeDosesWithoutRecipe === 1
                          ? "1 dose sem ficha"
                          : `${dish.activeDosesWithoutRecipe} doses sem ficha`}
                      </s-badge>
                    )}
                    {dish.status === "sem-doses" && (
                      <s-badge tone="neutral">Sem doses</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <Link to={editorUrl(dish.id)}>Editar ficha</Link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {selectedDish && (
        <s-section heading={`Ficha técnica — ${selectedDish.baseName}`}>
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-300" alignItems="center">
              {selectedDish.doses.length === 0 ? (
                <s-text color="subdued">
                  Este prato ainda não tem doses — cria a primeira abaixo.
                </s-text>
              ) : (
                selectedDish.doses.map((dose) =>
                  dose.id === recipe?.dose.id ? (
                    <s-badge key={dose.id} tone="info" color="strong">
                      {dose.active ? dose.label : `${dose.label} · inativa`}
                    </s-badge>
                  ) : (
                    <Link key={dose.id} to={editorUrl(selectedDish.id, dose.id)}>
                      <s-badge tone={dose.active ? "info" : "neutral"}>
                        {dose.active ? dose.label : `${dose.label} · inativa`}
                      </s-badge>
                    </Link>
                  ),
                )
              )}
              <Link to={FICHAS_PATH}>Fechar editor</Link>
            </s-stack>

            {recipe && (
              <>
                {recipe.lines.length === 0 ? (
                  <s-paragraph color="subdued">
                    A dose &quot;{recipe.dose.label}&quot; ainda não tem
                    ingredientes — adiciona a primeira linha abaixo.
                  </s-paragraph>
                ) : (
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Ingrediente</s-table-header>
                      <s-table-header format="numeric">Qtd/refeição</s-table-header>
                      <s-table-header>Unidade</s-table-header>
                      <s-table-header>Fornecedor</s-table-header>
                      <s-table-header>Remover</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {recipe.lines.map((line) => (
                        <s-table-row key={line.id}>
                          <s-table-cell>{line.ingredientName}</s-table-cell>
                          <s-table-cell>{String(line.qtyPerMeal)}</s-table-cell>
                          <s-table-cell>{line.unit}</s-table-cell>
                          <s-table-cell>
                            {line.supplierName ?? (
                              <s-text color="subdued">sem fornecedor</s-text>
                            )}
                          </s-table-cell>
                          <s-table-cell>
                            <Form method="post" action={formAction}>
                              <input type="hidden" name="intent" value="remove-line" />
                              <input type="hidden" name="lineId" value={line.id} />
                              <s-button
                                type="submit"
                                variant="tertiary"
                                tone="critical"
                                accessibilityLabel={`Remover ${line.ingredientName} da ficha`}
                              >
                                Remover
                              </s-button>
                            </Form>
                          </s-table-cell>
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                )}

                <Form method="post" action={formAction}>
                  <input type="hidden" name="intent" value="upsert-line" />
                  <input type="hidden" name="doseId" value={recipe.dose.id} />
                  <s-stack direction="inline" gap="base" alignItems="end">
                    <s-text-field
                      label="Ingrediente"
                      name="ingredientName"
                      placeholder="Tranche de salmão"
                      details="Se já existir um ingrediente com este nome, é reutilizado (a unidade e o fornecedor vêm do ingrediente existente)."
                      error={fieldError("upsert-line", "ingredientName")}
                    />
                    <s-number-field
                      label="Qtd/refeição"
                      name="qtyPerMeal"
                      placeholder="0.250"
                      error={fieldError("upsert-line", "qtyPerMeal")}
                    />
                    <s-select
                      label="Unidade"
                      name="unit"
                      error={fieldError("upsert-line", "unit")}
                    >
                      {INGREDIENT_UNITS.map((unit) => (
                        <s-option key={unit} value={unit}>
                          {unit}
                        </s-option>
                      ))}
                    </s-select>
                    <s-text-field
                      label="Fornecedor (opcional)"
                      name="supplierName"
                      placeholder="Talho Central"
                      details="Criado automaticamente se não existir."
                      error={fieldError("upsert-line", "supplierName")}
                    />
                    <s-button type="submit" variant="primary">
                      Adicionar linha
                    </s-button>
                  </s-stack>
                </Form>

                <s-stack direction="inline" gap="small-300">
                  <Form method="post" action={formAction}>
                    <input type="hidden" name="intent" value="toggle-dose" />
                    <input type="hidden" name="doseId" value={recipe.dose.id} />
                    <s-button type="submit" variant="secondary">
                      {recipe.dose.active ? "Desativar dose" : "Ativar dose"}
                    </s-button>
                  </Form>
                  <Form method="post" action={editorUrl(selectedDish.id)}>
                    <input type="hidden" name="intent" value="delete-dose" />
                    <input type="hidden" name="doseId" value={recipe.dose.id} />
                    <s-button type="submit" variant="secondary" tone="critical">
                      Apagar dose
                    </s-button>
                  </Form>
                </s-stack>
              </>
            )}

            <s-divider />

            <Form method="post" action={formAction}>
              <input type="hidden" name="intent" value="add-dose" />
              <input type="hidden" name="dishId" value={selectedDish.id} />
              <s-stack direction="inline" gap="base" alignItems="end">
                <s-text-field
                  label="Nova dose"
                  name="label"
                  placeholder="Low Carb, Bulk, 300g, M arroz…"
                  error={fieldError("add-dose", "label")}
                />
                <s-button type="submit" variant="secondary">
                  Criar dose
                </s-button>
              </s-stack>
            </Form>

            <Form method="post" action={FICHAS_PATH}>
              <input type="hidden" name="intent" value="delete-dish" />
              <input type="hidden" name="dishId" value={selectedDish.id} />
              <s-button type="submit" variant="tertiary" tone="critical">
                Apagar prato e todas as doses
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Novo prato">
        <Form method="post" action={formAction}>
          <input type="hidden" name="intent" value="create-dish" />
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field
              label="Nome do prato"
              name="baseName"
              placeholder="Tranche de Salmão com amêndoa e sweet chili"
              error={fieldError("create-dish", "baseName")}
            />
            <s-select
              label="Categoria"
              name="category"
              error={fieldError("create-dish", "category")}
            >
              {DISH_CATEGORIES.map((category) => (
                <s-option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit" variant="primary">
              Criar prato
            </s-button>
          </s-stack>
        </Form>
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
