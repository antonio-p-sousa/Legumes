/**
 * Construtores dos DOCUMENTOS de export (xlsx) — a montagem das folhas que
 * antes vivia inline nas resource routes /app/api/export/*.
 *
 * Cada função recebe a(s) vista(s)/inputs JÁ computados (buildCozinhaView,
 * buildComprasView, buildRoutes, buildChamberDoc, buildLabels) e devolve o
 * Buffer do workbook. As routes ficam finas (authenticate + load + build +
 * response) e um script node puro (scripts/pilot-pack.ts) gera os MESMOS
 * bytes sem servidor.
 *
 * REGRA: este módulo NÃO importa app/shopify.server.ts nem rotas — só
 * services (+ exceljs via xlsx.server). O CSV DPD não tem builder aqui:
 * já sai pronto do motor (buildDpdCsv, formato contratual §4.6).
 */
import {
  buildCozinhaDaySheetRows,
  confDaySheetName,
  confDateSheetName,
  groupLabelsByConfDate,
  isoToPtDate,
  type CozinhaView,
} from "../pages/cozinha.server";
import type { ComprasSupplier, ComprasView } from "../pages/compras.server";
import type { ChamberDoc, LabelRow, Route } from "../weekly";
import { buildWorkbook, type SheetSpec } from "./xlsx.server";

// ── Cozinha ──────────────────────────────────────────────────────────────────

const COZINHA_DAY_COLUMNS: SheetSpec["columns"] = [
  { header: "Prato", key: "prato", width: 44 },
  { header: "Dose", key: "dose", width: 16 },
  { header: "Quantidade", key: "quantidade", width: 12 },
];

function buildCozinhaSheets(view: CozinhaView): SheetSpec[] {
  const daySheets: SheetSpec[] = view.days.map((day) => ({
    name: confDaySheetName(day),
    columns: COZINHA_DAY_COLUMNS,
    rows: [
      ...buildCozinhaDaySheetRows(day).map((row) => ({
        prato: row.prato,
        dose: row.dose,
        quantidade: row.quantidade,
      })),
      { prato: "TOTAL", dose: "", quantidade: day.totalMeals },
    ],
  }));

  const nonMealSheet: SheetSpec = {
    name: "Não-cozinha",
    columns: COZINHA_DAY_COLUMNS,
    rows: view.nonMeal.map((row) => ({
      prato: row.dish,
      dose: row.dose,
      quantidade: row.quantity,
    })),
  };

  const resumoSheet: SheetSpec = {
    name: "Resumo",
    columns: [
      { header: "Dia", key: "dia", width: 22 },
      { header: "Refeições", key: "refeicoes", width: 12 },
      { header: "Encomendas", key: "encomendas", width: 12 },
    ],
    rows: [
      ...view.days.map((day) => ({
        dia: confDaySheetName(day),
        refeicoes: day.totalMeals,
        encomendas: day.totalOrders,
      })),
      {
        dia: "TOTAL",
        refeicoes: view.totalMeals,
        encomendas: view.totalOrders,
      },
    ],
  };

  return [...daySheets, nonMealSheet, resumoSheet];
}

/** Mapa de produção da cozinha: uma folha por dia + "Não-cozinha" + "Resumo". */
export async function buildCozinhaWorkbook(view: CozinhaView): Promise<Buffer> {
  return buildWorkbook(buildCozinhaSheets(view));
}

// ── Compras ──────────────────────────────────────────────────────────────────

function comprasResumoSheet(view: ComprasView): SheetSpec {
  return {
    name: "Resumo",
    columns: [
      { header: "Fornecedor", key: "fornecedor", width: 32 },
      { header: "Nº ingredientes", key: "ingredientes", width: 16 },
    ],
    rows: view.suppliers.map((supplier) => ({
      fornecedor: supplier.supplier,
      ingredientes: supplier.lines.length,
    })),
  };
}

function comprasSupplierSheet(supplier: ComprasSupplier): SheetSpec {
  return {
    name: supplier.supplier,
    columns: [
      { header: "Ingrediente", key: "ingrediente", width: 32 },
      { header: "Necessário", key: "necessario", width: 14 },
      { header: "+margem", key: "comMargem", width: 14 },
      { header: "Unidade", key: "unidade", width: 10 },
    ],
    rows: supplier.lines.map((line) => ({
      ingrediente: line.ingredient,
      necessario: line.required,
      comMargem: line.withMargin,
      unidade: line.unit,
    })),
  };
}

function comprasSemFichaSheet(view: ComprasView): SheetSpec {
  return {
    name: "Sem ficha",
    columns: [
      { header: "Prato", key: "prato", width: 40 },
      { header: "Dose", key: "dose", width: 14 },
      { header: "Unidades vendidas", key: "unidades", width: 18 },
    ],
    rows: view.missing.top.map((entry) => ({
      prato: entry.dish,
      dose: entry.dose,
      unidades: entry.unitsSold,
    })),
  };
}

/** Lista de compras completa: "Resumo" + uma folha por fornecedor + "Sem ficha". */
export async function buildComprasWorkbook(view: ComprasView): Promise<Buffer> {
  const sheets: SheetSpec[] = [
    comprasResumoSheet(view),
    ...view.suppliers.map(comprasSupplierSheet),
    comprasSemFichaSheet(view),
  ];
  return buildWorkbook(sheets);
}

/** Variante ?fornecedor= do export de compras: só a folha desse fornecedor. */
export async function buildComprasSupplierWorkbook(
  supplier: ComprasSupplier,
): Promise<Buffer> {
  return buildWorkbook([comprasSupplierSheet(supplier)]);
}

// ── Rotas de estafetas ───────────────────────────────────────────────────────

const ROUTE_COLUMNS: SheetSpec["columns"] = [
  { header: "Seq", key: "seq", width: 6 },
  { header: "Encomenda", key: "encomenda", width: 14 },
  { header: "Cliente", key: "cliente", width: 24 },
  { header: "Telefone", key: "telefone", width: 14 },
  { header: "Morada", key: "morada", width: 36 },
  { header: "CP", key: "cp", width: 10 },
  { header: "Cidade", key: "cidade", width: 16 },
  { header: "Subtotal", key: "subtotal", width: 10 },
  { header: "Notas", key: "notas", width: 40 },
  { header: "Janela", key: "janela", width: 28 },
];

export interface RotasSelection {
  /** Data de entrega yyyy-mm-dd (query param ?data=); ausente → todas. */
  data?: string | null;
  /** Nome do estafeta (query param ?courier=); ausente → todos. */
  courier?: string | null;
}

/** Filtro das variantes ?data=/?courier= do export de rotas. */
export function selectRotas(
  routes: Route[],
  selection?: RotasSelection,
): Route[] {
  const data = selection?.data ?? null;
  const courier = selection?.courier ?? null;
  return routes.filter(
    (route) =>
      (data === null || route.deliveryDate === data) &&
      (courier === null || route.courier === courier),
  );
}

/** "2025-11-24" + "Off Limits" → "24-11 Off Limits" (cabe nos 31 chars xlsx). */
function sheetNameFor(route: Route): string {
  const ddMm = `${route.deliveryDate.slice(8, 10)}-${route.deliveryDate.slice(5, 7)}`;
  return `${ddMm} ${route.courier}`.slice(0, 31);
}

/**
 * O xlsx exige nomes de folha únicos; nomes longos truncados aos 31 chars
 * podem colidir — desambigua com um sufixo numérico.
 */
function uniqueSheetName(base: string, used: Set<string>): string {
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Uma folha por rota, com nomes únicos ("24-11 Off Limits", ...). */
function buildRouteSheets(routes: Route[]): SheetSpec[] {
  const usedNames = new Set<string>();

  return routes.map((route) => ({
    name: uniqueSheetName(sheetNameFor(route), usedNames),
    columns: ROUTE_COLUMNS,
    rows: route.stops.map((stop) => ({
      seq: stop.sequence ?? "",
      encomenda: stop.orderName,
      cliente: stop.client,
      telefone: stop.phone,
      morada: stop.address1,
      cp: stop.zip,
      cidade: stop.city,
      subtotal: stop.subtotal,
      notas: stop.note ?? "",
      janela: stop.window ?? "",
    })),
  }));
}

/**
 * Rotas de estafetas: uma folha por (data de entrega, estafeta). O caller
 * garante ≥1 rota (as routes devolvem 404 quando a seleção fica vazia).
 */
export async function buildRotasWorkbook(routes: Route[]): Promise<Buffer> {
  return buildWorkbook(buildRouteSheets(routes));
}

// ── Rotas de câmara ──────────────────────────────────────────────────────────

const CAMARA_DAY_COLUMNS: SheetSpec["columns"] = [
  { header: "Encomenda", key: "encomenda", width: 16 },
  { header: "Cliente", key: "cliente", width: 34 },
  { header: "Nº refeições", key: "refeicoes", width: 14 },
];

const CAMARA_MASTER_COLUMNS: SheetSpec["columns"] = [
  { header: "Dia", key: "dia", width: 14 },
  { header: "Cliente", key: "cliente", width: 34 },
  { header: "Nº refeições", key: "refeicoes", width: 14 },
];

type CamaraDayRow = {
  encomenda: string;
  cliente: string;
  refeicoes: number | "";
};

/**
 * Linhas de uma folha-dia: por bloco, um cabeçalho, as linhas e o total; uma
 * linha em branco separa blocos. Fecha com o total do dia.
 */
function buildCamaraDaySheetRows(day: ChamberDoc["days"][number]): CamaraDayRow[] {
  const rows: CamaraDayRow[] = [];

  day.blocks.forEach((block, index) => {
    if (index > 0) rows.push({ encomenda: "", cliente: "", refeicoes: "" });
    rows.push({ encomenda: block.label, cliente: "", refeicoes: "" });
    for (const row of block.rows) {
      rows.push({
        encomenda: row.orderName,
        cliente: row.client,
        refeicoes: row.meals,
      });
    }
    rows.push({ encomenda: "Total", cliente: "", refeicoes: block.totalMeals });
  });

  rows.push({ encomenda: "", cliente: "", refeicoes: "" });
  rows.push({ encomenda: "TOTAL DIA", cliente: "", refeicoes: day.totalMeals });
  return rows;
}

/** Uma folha por dia de produção; nomes únicos (labels PT são distintos). */
function buildCamaraSheets(doc: ChamberDoc): SheetSpec[] {
  const daySheets: SheetSpec[] = doc.days.map((day) => ({
    name: day.label,
    columns: CAMARA_DAY_COLUMNS,
    rows: buildCamaraDaySheetRows(day),
  }));

  const masterSheet: SheetSpec = {
    name: "Refeições por cliente",
    columns: CAMARA_MASTER_COLUMNS,
    rows: doc.days.flatMap((day) =>
      day.master.map((client) => ({
        dia: day.label,
        cliente: client.client,
        refeicoes: client.meals,
      })),
    ),
  };

  return [...daySheets, masterSheet];
}

/** Rotas de câmara: uma folha por dia de produção + "Refeições por cliente". */
export async function buildRotasCamaraWorkbook(doc: ChamberDoc): Promise<Buffer> {
  return buildWorkbook(buildCamaraSheets(doc));
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

const LABEL_COLUMNS: SheetSpec["columns"] = [
  { header: "Encomenda", key: "encomenda", width: 14 },
  { header: "Prato", key: "prato", width: 52 },
  { header: "Cliente", key: "cliente", width: 28 },
  { header: "Data Confeção", key: "dataConfecao", width: 14 },
];

function buildEtiquetasSheets(labels: LabelRow[]): SheetSpec[] {
  const groups = groupLabelsByConfDate(labels);

  if (groups.length === 0) {
    // Workbook xlsx precisa de ≥1 folha; sem etiquetas devolve-se uma vazia.
    return [{ name: "Etiquetas", columns: LABEL_COLUMNS, rows: [] }];
  }

  return groups.map((group) => ({
    name: confDateSheetName(group.confDate),
    columns: LABEL_COLUMNS,
    rows: group.rows.map((row) => ({
      encomenda: row.orderName,
      prato: row.dish,
      cliente: row.client,
      dataConfecao: isoToPtDate(row.confDate),
    })),
  }));
}

/** Etiquetas: uma folha por data de confeção, 1 linha por refeição. */
export async function buildEtiquetasWorkbook(
  labels: LabelRow[],
): Promise<Buffer> {
  return buildWorkbook(buildEtiquetasSheets(labels));
}
