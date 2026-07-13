/**
 * Constantes e helpers da configuração geral partilhados entre o service
 * (.server) e o componente da rota (cliente).
 *
 * Este módulo NÃO pode importar nada server-only (Prisma, db.server, …):
 * o React Router bloqueia o build quando um export de cliente de uma rota
 * depende de um módulo `.server`.
 */

/** Formato dos extremos da janela de encomendas: "SAT_00:00" / "FRI_23:59". */
export const WINDOW_POINT_REGEX =
  /^(MON|TUE|WED|THU|FRI|SAT|SUN)_([01]\d|2[0-3]):[0-5]\d$/;

/** Conta DPD: só dígitos, 6 a 10 (ex.: "03290201"). */
export const DPD_ACCOUNT_REGEX = /^\d{6,10}$/;

/**
 * Separa "SAT_00:00" em { day: "SAT", time: "00:00" } para pré-preencher a UI.
 * Valores fora do formato caem nos defaults do schema (SAT/00:00) — a UI
 * nunca rebenta por causa de um valor antigo malformado.
 */
export function splitWindowPoint(value: string): { day: string; time: string } {
  const match = WINDOW_POINT_REGEX.exec(value?.trim() ?? "");
  if (!match) {
    return { day: "SAT", time: "00:00" };
  }
  const [day, time] = match[0].split("_");
  return { day, time };
}

/** Junta dia + hora no formato guardado na BD ("SAT_00:00"). */
export function joinWindowPoint(day: string, time: string): string {
  return `${day.trim().toUpperCase()}_${time.trim()}`;
}
