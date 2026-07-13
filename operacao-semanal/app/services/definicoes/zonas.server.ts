/**
 * Serviço de Zonas de entrega (Definições · "Zonas & dias").
 *
 * Funções puras de CRUD sobre um PrismaClient recebido como 1º argumento
 * (injetável para testes com SQLite descartável). Validação à entrada:
 * erros previsíveis (campos em falta, duplicados, referências inexistentes)
 * são devolvidos como `{ ok: false, errors }` — nunca atirados. Erros de BD
 * inesperados propagam para o ErrorBoundary da rota.
 *
 * Ver docs/ARCHITECTURE.md §4.3 (dias de confeção) e §5 (modelo Zone).
 */
import type { Courier, PrismaClient, Zone } from "@prisma/client";

import { CONF_DAY_RULES, type ConfDayRule } from "./zonas.shared";

// Re-export das constantes partilhadas com a UI (vivem em zonas.shared.ts para
// o componente da rota as poder importar sem depender de um módulo .server).
export { CONF_DAY_LABELS, CONF_DAY_RULES } from "./zonas.shared";
export type { ConfDayRule } from "./zonas.shared";

export type ZoneWithCourier = Zone & { courier: Courier | null };

export interface ZoneInput {
  matchText?: string | null;
  county?: string | null;
  confDay?: string | null;
  /** Opcional; string vazia é tratada como "sem estafeta". */
  courierId?: string | null;
}

/** Mapa campo → mensagem de erro (PT), pronto para a prop `error` dos s-*-field. */
export type ZoneErrors = Record<string, string>;

export type ZoneWriteResult =
  | { ok: true; zone: ZoneWithCourier }
  | { ok: false; errors: ZoneErrors };

export type ZoneDeleteResult = { ok: true } | { ok: false; errors: ZoneErrors };

const ZONE_NOT_FOUND: ZoneErrors = {
  id: "Zona não encontrada. Atualiza a página e tenta de novo.",
};

function isConfDayRule(value: string): value is ConfDayRule {
  return (CONF_DAY_RULES as readonly string[]).includes(value);
}

interface ValidZoneData {
  matchText: string;
  county: string;
  confDay: ConfDayRule;
  courierId: string | null;
}

/**
 * Valida e normaliza (trim) o input de uma zona. Devolve `data: null` com o
 * mapa de erros quando algo falha; `excludeZoneId` permite que um update
 * mantenha o próprio matchText sem contar como duplicado.
 */
async function validateZoneInput(
  prisma: PrismaClient,
  input: ZoneInput,
  excludeZoneId?: string,
): Promise<{ data: ValidZoneData | null; errors: ZoneErrors }> {
  const errors: ZoneErrors = {};
  const matchText = (input.matchText ?? "").trim();
  const county = (input.county ?? "").trim();
  const confDay = (input.confDay ?? "").trim();
  const courierId = (input.courierId ?? "").trim() || null;

  if (!matchText) {
    errors.matchText =
      "Indica o texto da zona — tem de ser IGUAL ao texto do atributo " +
      "«Horário de entrega» das encomendas Shopify.";
  } else {
    const existing = await prisma.zone.findUnique({ where: { matchText } });
    if (existing && existing.id !== excludeZoneId) {
      errors.matchText =
        `Já existe uma zona com o texto "${matchText}". ` +
        "Este texto é a chave de match com o Shopify e tem de ser único.";
    }
  }

  if (!county) {
    errors.county = "Indica o concelho/região desta zona.";
  }

  if (!isConfDayRule(confDay)) {
    errors.confDay =
      "Dia de confeção inválido: usa Segunda (2f), Terça (3f), " +
      "Quarta (4f) ou Véspera da entrega.";
  }

  if (courierId) {
    const courier = await prisma.courier.findUnique({
      where: { id: courierId },
    });
    if (!courier) {
      errors.courierId =
        "O estafeta escolhido já não existe. Atualiza a página e escolhe outro.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { data: null, errors };
  }
  return {
    data: { matchText, county, confDay: confDay as ConfDayRule, courierId },
    errors,
  };
}

/** Lista todas as zonas, com o estafeta incluído, ordenadas por matchText. */
export async function listZones(
  prisma: PrismaClient,
): Promise<ZoneWithCourier[]> {
  return prisma.zone.findMany({
    include: { courier: true },
    orderBy: { matchText: "asc" },
  });
}

/** Cria uma zona nova (ativa por omissão) após validar o input. */
export async function createZone(
  prisma: PrismaClient,
  input: ZoneInput,
): Promise<ZoneWriteResult> {
  const { data, errors } = await validateZoneInput(prisma, input);
  if (!data) return { ok: false, errors };

  const zone = await prisma.zone.create({
    data,
    include: { courier: true },
  });
  return { ok: true, zone };
}

/** Atualiza uma zona existente; o próprio matchText não conta como duplicado. */
export async function updateZone(
  prisma: PrismaClient,
  zoneId: string,
  input: ZoneInput,
): Promise<ZoneWriteResult> {
  const existing = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!existing) return { ok: false, errors: ZONE_NOT_FOUND };

  const { data, errors } = await validateZoneInput(prisma, input, zoneId);
  if (!data) return { ok: false, errors };

  const zone = await prisma.zone.update({
    where: { id: zoneId },
    data,
    include: { courier: true },
  });
  return { ok: true, zone };
}

/** Elimina uma zona. Zona inexistente devolve erro estruturado, não atira. */
export async function deleteZone(
  prisma: PrismaClient,
  zoneId: string,
): Promise<ZoneDeleteResult> {
  const existing = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!existing) return { ok: false, errors: ZONE_NOT_FOUND };

  await prisma.zone.delete({ where: { id: zoneId } });
  return { ok: true };
}

/** Inverte o estado ativa/inativa de uma zona. */
export async function toggleZoneActive(
  prisma: PrismaClient,
  zoneId: string,
): Promise<ZoneWriteResult> {
  const existing = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!existing) return { ok: false, errors: ZONE_NOT_FOUND };

  const zone = await prisma.zone.update({
    where: { id: zoneId },
    data: { active: !existing.active },
    include: { courier: true },
  });
  return { ok: true, zone };
}
