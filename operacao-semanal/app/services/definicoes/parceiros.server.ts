import type { PrismaClient } from "@prisma/client";

/**
 * Definições · Parceiros & fornecedores.
 *
 * CRUD de estafetas/transportadoras (Courier) e fornecedores (Supplier).
 * Funções puras sobre um PrismaClient recebido como 1.º argumento (testável
 * contra uma SQLite descartável). Validação à entrada devolve
 * `{ ok: false, errors }` em vez de atirar; erros de BD inesperados propagam.
 */

// ─── Tipos partilhados ──────────────────────────────────────────────────────

export type FieldErrors = Record<string, string>;

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors };

export const COURIER_TYPES = ["internal", "partner", "dpd"] as const;
export type CourierType = (typeof COURIER_TYPES)[number];

export const COURIER_ORDERINGS = ["manual", "postcode", "county"] as const;
export type CourierOrdering = (typeof COURIER_ORDERINGS)[number];

export interface CourierInput {
  name: string;
  type: string;
  ordering?: string;
  email?: string;
}

export interface SupplierInput {
  name: string;
  email?: string;
  orderDay?: string;
}

export interface CourierRecord {
  id: string;
  name: string;
  type: string;
  email: string | null;
  ordering: string;
}

export interface CourierWithZoneCount extends CourierRecord {
  zoneCount: number;
}

export interface SupplierRecord {
  id: string;
  name: string;
  email: string | null;
  orderDay: string | null;
}

export interface SupplierWithIngredientCount extends SupplierRecord {
  ingredientCount: number;
}

// ─── Validação ──────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeOptional(value: string | undefined | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function validateEmail(value: string | undefined | null): {
  value: string | null;
  error?: string;
} {
  const email = normalizeOptional(value);
  if (email !== null && !EMAIL_PATTERN.test(email)) {
    return {
      value: email,
      error: "O email não tem um formato válido (ex.: nome@dominio.pt).",
    };
  }
  return { value: email };
}

interface ValidCourierData {
  name: string;
  type: CourierType;
  ordering: CourierOrdering;
  email: string | null;
}

function validateCourierInput(
  input: CourierInput,
): ServiceResult<ValidCourierData> {
  const errors: FieldErrors = {};

  const name = input.name.trim();
  if (name === "") {
    errors.name = "O nome do estafeta ou transportadora é obrigatório.";
  }

  const type = input.type.trim();
  if (!(COURIER_TYPES as readonly string[]).includes(type)) {
    errors.type =
      "Tipo inválido. Escolhe Interno (internal), Parceiro (partner) ou DPD (dpd).";
  }

  const ordering = (input.ordering ?? "").trim() || "manual";
  if (!(COURIER_ORDERINGS as readonly string[]).includes(ordering)) {
    errors.ordering =
      "Ordenação de rota inválida. Escolhe Manual (manual), Código postal (postcode) ou Concelho (county).";
  }

  const email = validateEmail(input.email);
  if (email.error) {
    errors.email = email.error;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      name,
      type: type as CourierType,
      ordering: ordering as CourierOrdering,
      email: email.value,
    },
  };
}

interface ValidSupplierData {
  name: string;
  email: string | null;
  orderDay: string | null;
}

function validateSupplierInput(
  input: SupplierInput,
): ServiceResult<ValidSupplierData> {
  const errors: FieldErrors = {};

  const name = input.name.trim();
  if (name === "") {
    errors.name = "O nome do fornecedor é obrigatório.";
  }

  const email = validateEmail(input.email);
  if (email.error) {
    errors.email = email.error;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      name,
      email: email.value,
      orderDay: normalizeOptional(input.orderDay),
    },
  };
}

// ─── Couriers (estafetas e transportadoras) ─────────────────────────────────

export async function listCouriers(
  prisma: PrismaClient,
): Promise<CourierWithZoneCount[]> {
  const couriers = await prisma.courier.findMany({
    include: { _count: { select: { zones: true } } },
    orderBy: { name: "asc" },
  });

  return couriers.map((courier) => ({
    id: courier.id,
    name: courier.name,
    type: courier.type,
    email: courier.email,
    ordering: courier.ordering,
    zoneCount: courier._count.zones,
  }));
}

export async function createCourier(
  prisma: PrismaClient,
  input: CourierInput,
): Promise<ServiceResult<CourierRecord>> {
  const validated = validateCourierInput(input);
  if (!validated.ok) {
    return validated;
  }

  const existing = await prisma.courier.findUnique({
    where: { name: validated.data.name },
  });
  if (existing) {
    return {
      ok: false,
      errors: {
        name: `Já existe um estafeta ou transportadora com o nome "${validated.data.name}". Escolhe um nome diferente.`,
      },
    };
  }

  const created = await prisma.courier.create({ data: validated.data });
  return { ok: true, data: created };
}

export async function updateCourier(
  prisma: PrismaClient,
  id: string,
  input: CourierInput,
): Promise<ServiceResult<CourierRecord>> {
  const current = await prisma.courier.findUnique({ where: { id } });
  if (!current) {
    return {
      ok: false,
      errors: {
        id: "Estafeta ou transportadora não encontrado. Atualiza a página e tenta de novo.",
      },
    };
  }

  const validated = validateCourierInput(input);
  if (!validated.ok) {
    return validated;
  }

  const sameName = await prisma.courier.findUnique({
    where: { name: validated.data.name },
  });
  if (sameName && sameName.id !== id) {
    return {
      ok: false,
      errors: {
        name: `Já existe um estafeta ou transportadora com o nome "${validated.data.name}". Escolhe um nome diferente.`,
      },
    };
  }

  const updated = await prisma.courier.update({
    where: { id },
    data: validated.data,
  });
  return { ok: true, data: updated };
}

export async function deleteCourier(
  prisma: PrismaClient,
  id: string,
): Promise<ServiceResult<{ id: string; name: string }>> {
  const courier = await prisma.courier.findUnique({
    where: { id },
    include: { _count: { select: { zones: true } } },
  });

  if (!courier) {
    return {
      ok: false,
      errors: {
        id: "Estafeta ou transportadora não encontrado. Atualiza a página e tenta de novo.",
      },
    };
  }

  if (courier._count.zones > 0) {
    return {
      ok: false,
      errors: {
        id: `Não é possível eliminar "${courier.name}": tem ${courier._count.zones} zona(s) de entrega associada(s). Reatribui essas zonas a outro estafeta em Zonas & dias antes de eliminar.`,
      },
    };
  }

  await prisma.courier.delete({ where: { id } });
  return { ok: true, data: { id: courier.id, name: courier.name } };
}

// ─── Suppliers (fornecedores) ───────────────────────────────────────────────

export async function listSuppliers(
  prisma: PrismaClient,
): Promise<SupplierWithIngredientCount[]> {
  const suppliers = await prisma.supplier.findMany({
    include: { _count: { select: { ingredients: true } } },
    orderBy: { name: "asc" },
  });

  return suppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    email: supplier.email,
    orderDay: supplier.orderDay,
    ingredientCount: supplier._count.ingredients,
  }));
}

export async function createSupplier(
  prisma: PrismaClient,
  input: SupplierInput,
): Promise<ServiceResult<SupplierRecord>> {
  const validated = validateSupplierInput(input);
  if (!validated.ok) {
    return validated;
  }

  const existing = await prisma.supplier.findUnique({
    where: { name: validated.data.name },
  });
  if (existing) {
    return {
      ok: false,
      errors: {
        name: `Já existe um fornecedor com o nome "${validated.data.name}". Escolhe um nome diferente.`,
      },
    };
  }

  const created = await prisma.supplier.create({ data: validated.data });
  return { ok: true, data: created };
}

export async function updateSupplier(
  prisma: PrismaClient,
  id: string,
  input: SupplierInput,
): Promise<ServiceResult<SupplierRecord>> {
  const current = await prisma.supplier.findUnique({ where: { id } });
  if (!current) {
    return {
      ok: false,
      errors: {
        id: "Fornecedor não encontrado. Atualiza a página e tenta de novo.",
      },
    };
  }

  const validated = validateSupplierInput(input);
  if (!validated.ok) {
    return validated;
  }

  const sameName = await prisma.supplier.findUnique({
    where: { name: validated.data.name },
  });
  if (sameName && sameName.id !== id) {
    return {
      ok: false,
      errors: {
        name: `Já existe um fornecedor com o nome "${validated.data.name}". Escolhe um nome diferente.`,
      },
    };
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: validated.data,
  });
  return { ok: true, data: updated };
}

export async function deleteSupplier(
  prisma: PrismaClient,
  id: string,
): Promise<ServiceResult<{ id: string; name: string }>> {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { _count: { select: { ingredients: true } } },
  });

  if (!supplier) {
    return {
      ok: false,
      errors: {
        id: "Fornecedor não encontrado. Atualiza a página e tenta de novo.",
      },
    };
  }

  if (supplier._count.ingredients > 0) {
    return {
      ok: false,
      errors: {
        id: `Não é possível eliminar "${supplier.name}": tem ${supplier._count.ingredients} ingrediente(s) associado(s). Reatribui esses ingredientes a outro fornecedor nas Fichas técnicas antes de eliminar.`,
      },
    };
  }

  await prisma.supplier.delete({ where: { id } });
  return { ok: true, data: { id: supplier.id, name: supplier.name } };
}
