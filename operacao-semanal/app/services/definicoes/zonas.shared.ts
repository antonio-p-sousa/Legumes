/**
 * Constantes de Zonas partilhadas entre o service (.server) e o componente
 * da rota (cliente).
 *
 * Este módulo NÃO pode importar nada server-only (Prisma, db.server, …):
 * o React Router bloqueia o build quando um export de cliente de uma rota
 * depende de um módulo `.server`.
 */

/** Regras de dia de confeção aceites (ARCHITECTURE §4.3 e §5). */
export const CONF_DAY_RULES = [
  "dom",
  "2f",
  "3f",
  "4f",
  "vespera",
  "mesmo",
] as const;

export type ConfDayRule = (typeof CONF_DAY_RULES)[number];

/** Labels PT para a UI (badges da tabela e opções do select). */
export const CONF_DAY_LABELS: Record<ConfDayRule, string> = {
  // "dom" = dia fixo DOMINGO — a regra oficial de Lisboa (matriz 03/08/2026):
  // entrega de domingo confeciona no próprio dia (0) e a de segunda na véspera
  // (-1); ambas caem no domingo, logo exprime-se como dia fixo.
  dom: "Domingo",
  "2f": "Segunda",
  "3f": "Terça",
  "4f": "Quarta",
  vespera: "Véspera da entrega",
  mesmo: "Mesmo dia da entrega",
};
