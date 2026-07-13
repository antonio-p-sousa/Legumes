import type { AppConfig, PrismaClient } from "@prisma/client";

/**
 * Serviço de configuração geral da app (AppConfig — singleton).
 *
 * Funções puras de CRUD sobre um PrismaClient recebido como argumento
 * (facilita testes com uma BD SQLite descartável). A rota importa este
 * módulo e passa o singleton de app/db.server.
 */

import {
  DPD_ACCOUNT_REGEX,
  WINDOW_POINT_REGEX,
} from "./config.shared";

// Re-export dos helpers partilhados com a UI (vivem em config.shared.ts para
// o componente da rota os poder importar sem depender de um módulo .server).
export {
  DPD_ACCOUNT_REGEX,
  WINDOW_POINT_REGEX,
  joinWindowPoint,
  splitWindowPoint,
} from "./config.shared";

export const CONFIG_ID = "singleton";

export interface UpdateConfigInput {
  /** Ex.: "SAT_00:00" */
  orderWindowFrom: string;
  /** Ex.: "FRI_23:59" */
  orderWindowTo: string;
  ignoreAfterClose: boolean;
  /** Fração 0–1 (a UI mostra percentagem 0–100 e converte antes de chamar). */
  purchaseMargin: number;
  /** Opcional — string vazia/whitespace é normalizada para null. */
  dpdAccount: string | null;
}

export type UpdateConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: Record<string, string> };

/**
 * Devolve a configuração singleton, criando-a com os defaults do schema
 * quando ainda não existe (upsert — idempotente).
 */
export async function getConfig(db: PrismaClient): Promise<AppConfig> {
  return db.appConfig.upsert({
    where: { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID },
  });
}

/**
 * Valida e persiste a configuração. Erros de validação são devolvidos como
 * `{ ok: false, errors }` (campo → mensagem em PT) em vez de atirar; erros
 * inesperados de BD propagam.
 */
export async function updateConfig(
  db: PrismaClient,
  input: UpdateConfigInput,
): Promise<UpdateConfigResult> {
  const errors: Record<string, string> = {};

  const orderWindowFrom = input.orderWindowFrom?.trim() ?? "";
  const orderWindowTo = input.orderWindowTo?.trim() ?? "";

  if (!WINDOW_POINT_REGEX.test(orderWindowFrom)) {
    errors.orderWindowFrom =
      "Abertura da janela inválida: escolhe um dia e indica a hora no formato HH:MM (ex.: 00:00).";
  }
  if (!WINDOW_POINT_REGEX.test(orderWindowTo)) {
    errors.orderWindowTo =
      "Fecho da janela inválido: escolhe um dia e indica a hora no formato HH:MM (ex.: 23:59).";
  }

  if (
    typeof input.purchaseMargin !== "number" ||
    !Number.isFinite(input.purchaseMargin) ||
    input.purchaseMargin < 0 ||
    input.purchaseMargin > 1
  ) {
    errors.purchaseMargin =
      "A margem de compras tem de ser um número entre 0% e 100%.";
  }

  const dpdAccount = normalizeDpdAccount(input.dpdAccount);
  if (dpdAccount !== null && !DPD_ACCOUNT_REGEX.test(dpdAccount)) {
    errors.dpdAccount =
      "A conta DPD tem de ter apenas dígitos (6 a 10), ex.: 03290201. Deixa vazio se ainda não tiveres conta.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const data = {
    orderWindowFrom,
    orderWindowTo,
    ignoreAfterClose: input.ignoreAfterClose,
    purchaseMargin: input.purchaseMargin,
    dpdAccount,
  };

  const config = await db.appConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });

  return { ok: true, config };
}

/** "" / whitespace → null; caso contrário devolve a string aparada. */
function normalizeDpdAccount(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
