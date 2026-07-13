/**
 * Versões de impressão (requisito "PDF impressão"): gera páginas HTML
 * standalone (fora do Polaris/App Bridge) prontas para Ctrl+P / "Guardar
 * como PDF" — o browser é que produz o PDF.
 *
 * Duas camadas, ambas puras e testadas em html.server.test.ts:
 *  1. renderPrintPage — template HTML completo (string, sem React) com CSS
 *     @media print, thead repetido por página e botão "Imprimir".
 *  2. buildXxxPrintSections — mapeiam as views já existentes (cozinha.server,
 *     estafetas/rotas do motor, compras.server, etiquetas do motor) para
 *     PrintSection[]. NÃO recalculam lógica de negócio.
 *
 * Todo o conteúdo dinâmico passa por escapeHtml (nomes de clientes, notas
 * livres, etc. vêm do Shopify sem qualquer garantia).
 */
import {
  confDateSheetName,
  groupLabelsByConfDate,
  isoToPtDate,
  type CozinhaView,
  type DoseMatrix,
} from "../pages/cozinha.server";
import type { ComprasView } from "../pages/compras.server";
import type { KitchenRow, LabelRow, Route } from "../weekly";

// ── Tipos do contrato de impressão ───────────────────────────────────────────

export interface PrintTableSpec {
  headers: string[];
  rows: string[][];
  /** Índices (0-based) das colunas numéricas — alinhadas à direita (.num). */
  numericCols?: number[];
  /** Linha de totais opcional — rendida em <tfoot> a bold. */
  totals?: string[];
}

export interface PrintSection {
  heading: string;
  subheading?: string;
  table: PrintTableSpec;
  /** true → a secção começa numa página nova (classe .break-before). */
  breakBefore?: boolean;
}

export interface PrintPageInput {
  title: string;
  subtitle?: string;
  /** Nota informativa no topo (visível também na impressão). */
  note?: string;
  sections: PrintSection[];
  /** Data de geração — injetável para testes determinísticos. */
  generatedAt?: Date;
}

// ── Escaping ─────────────────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapa &, <, >, " e ' — obrigatório em TODO o conteúdo dinâmico. */
export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// ── Template HTML ────────────────────────────────────────────────────────────

const FOOTER_TEXT = "Operação Semanal — Legumes e outros Vícios";

const EMPTY_SECTION_MESSAGE = "Sem dados.";
const EMPTY_PAGE_MESSAGE = "Sem dados para apresentar.";

const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: Arial, Helvetica, sans-serif;
  color: #1c1c1c;
  background: #fff;
  margin: 24px auto;
  padding: 0 16px;
  max-width: 960px;
  font-size: 13px;
  line-height: 1.4;
}
.doc-header { border-bottom: 2px solid #1c1c1c; padding-bottom: 8px; margin-bottom: 16px; }
.doc-header h1 { font-size: 20px; margin: 0 0 4px; }
.subtitle { margin: 0; font-size: 13px; color: #444; }
.generated { margin: 2px 0 0; font-size: 11px; color: #666; }
.note { border: 1px solid #999; background: #f5f5f5; padding: 6px 10px; font-size: 12px; margin: 0 0 14px; }
section.section { page-break-inside: avoid; break-inside: avoid; margin: 0 0 18px; }
section.section h2 { font-size: 15px; margin: 0 0 2px; }
.section-sub { margin: 0 0 6px; font-size: 12px; color: #555; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
thead { display: table-header-group; }
th, td { border: 1px solid #8a8a8a; padding: 3px 6px; font-size: 12px; text-align: left; vertical-align: top; }
th { background: #ececec; font-weight: bold; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tfoot tr.totals td { font-weight: bold; background: #f3f3f3; }
tr { page-break-inside: avoid; break-inside: avoid; }
.break-before { break-before: page; page-break-before: always; }
.empty { color: #666; font-style: italic; }
.doc-footer { margin-top: 24px; border-top: 1px solid #8a8a8a; padding-top: 6px; font-size: 11px; color: #666; }
.print-button {
  position: fixed; top: 16px; right: 16px; padding: 10px 16px;
  font: bold 13px Arial, Helvetica, sans-serif;
  background: #2e7d43; color: #fff; border: none; border-radius: 4px; cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
.print-button:hover { background: #256636; }
@page { size: A4; margin: 12mm; }
@media print {
  body { margin: 0; padding: 0; max-width: none; }
  .print-button { display: none; }
}
`;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** dd/mm/yyyy HH:MM (hora local do servidor). */
function formatGeneratedAt(date: Date): string {
  return (
    `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}` +
    ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

function renderTable(table: PrintTableSpec): string {
  if (table.rows.length === 0) {
    return `<p class="empty">${EMPTY_SECTION_MESSAGE}</p>`;
  }

  const numeric = new Set(table.numericCols ?? []);
  const cellClass = (index: number): string =>
    numeric.has(index) ? ' class="num"' : "";

  const thead = `<thead><tr>${table.headers
    .map((header, i) => `<th${cellClass(i)} scope="col">${escapeHtml(header)}</th>`)
    .join("")}</tr></thead>`;

  const tbody = `<tbody>${table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td${cellClass(i)}>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody>`;

  const tfoot = table.totals
    ? `<tfoot><tr class="totals">${table.totals
        .map((cell, i) => `<td${cellClass(i)}>${escapeHtml(cell)}</td>`)
        .join("")}</tr></tfoot>`
    : "";

  return `<table>${thead}${tbody}${tfoot}</table>`;
}

function renderSection(section: PrintSection): string {
  const classes = section.breakBefore ? "section break-before" : "section";
  const subheading = section.subheading
    ? `<p class="section-sub">${escapeHtml(section.subheading)}</p>`
    : "";
  return (
    `<section class="${classes}">` +
    `<h2>${escapeHtml(section.heading)}</h2>${subheading}${renderTable(section.table)}` +
    `</section>`
  );
}

/**
 * Documento HTML completo e standalone (sem React/Polaris no output).
 * Estética sóbria de documento interno; botão de impressão fixo no ecrã e
 * escondido em @media print.
 */
export function renderPrintPage(input: PrintPageInput): string {
  const generatedAt = input.generatedAt ?? new Date();

  const subtitle = input.subtitle
    ? `\n  <p class="subtitle">${escapeHtml(input.subtitle)}</p>`
    : "";
  const note = input.note
    ? `\n<p class="note">${escapeHtml(input.note)}</p>`
    : "";
  const main =
    input.sections.length === 0
      ? `<p class="empty">${EMPTY_PAGE_MESSAGE}</p>`
      : input.sections.map(renderSection).join("\n");

  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<button type="button" class="print-button" onclick="window.print()">Imprimir / Guardar como PDF</button>
<header class="doc-header">
  <h1>${escapeHtml(input.title)}</h1>${subtitle}
  <p class="generated">Gerado em ${formatGeneratedAt(generatedAt)}</p>
</header>${note}
<main>
${main}
</main>
<footer class="doc-footer">${FOOTER_TEXT}</footer>
</body>
</html>
`;
}

/** Resposta HTML das resource routes /app/print/*. */
export function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Secções: Cozinha (/app/print/cozinha) ────────────────────────────────────

function sumQuantities(rows: KitchenRow[]): number {
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

function kitchenRowCells(row: KitchenRow): string[] {
  return [row.dish, row.dose, String(row.quantity)];
}

/** Achata a matriz prato×dose em linhas Prato | Dose | Qtd (células vendidas). */
function flattenDoseMatrix(matrix: DoseMatrix): string[][] {
  const rows: string[][] = [];
  for (const row of matrix.rows) {
    matrix.doseColumns.forEach((dose, i) => {
      const quantity = row.cells[i];
      if (quantity !== null) rows.push([row.dish, dose, String(quantity)]);
    });
  }
  return rows;
}

/**
 * Uma secção por categoria de cada dia de confeção (só categorias com
 * vendas), com linha de totais; página nova entre dias. `dia` (ex.: "2f")
 * restringe ao dia pedido.
 */
export function buildCozinhaPrintSections(
  view: CozinhaView,
  dia?: string | null,
): PrintSection[] {
  const days = dia ? view.days.filter((d) => d.confDay === dia) : view.days;
  const sections: PrintSection[] = [];

  for (const day of days) {
    const dayLabel = day.confDate
      ? `${day.label} ${isoToPtDate(day.confDate)}`
      : day.label;

    const daySections: PrintSection[] = [];
    const pushCategory = (
      name: string,
      rows: string[][],
      total: number,
    ): void => {
      if (rows.length === 0) return;
      daySections.push({
        heading: `${dayLabel} — ${name}`,
        table: {
          headers: ["Prato", "Dose", "Qtd"],
          rows,
          numericCols: [2],
          totals: ["Total", "", String(total)],
        },
      });
    };

    pushCategory(
      "Peixe & carne",
      flattenDoseMatrix(day.peixeCarne),
      day.peixeCarne.total,
    );
    pushCategory(
      "Vegetariano",
      flattenDoseMatrix(day.vegetariano),
      day.vegetariano.total,
    );
    pushCategory("Pokes", day.pokes.map(kitchenRowCells), sumQuantities(day.pokes));
    pushCategory(
      "Dose única",
      day.doseUnica.map(kitchenRowCells),
      sumQuantities(day.doseUnica),
    );

    if (day.notes.length > 0) {
      daySections.push({
        heading: `${dayLabel} — Notas de encomendas`,
        table: {
          headers: ["Encomenda", "Nota"],
          rows: day.notes.map((n) => [n.orderName, n.note]),
        },
      });
    }

    if (daySections.length > 0) {
      daySections[0] = {
        ...daySections[0],
        subheading: `${day.totalMeals} refeições · ${day.totalOrders} encomendas`,
        breakBefore: sections.length > 0,
      };
    }
    sections.push(...daySections);
  }

  return sections;
}

// ── Secções: Rotas (/app/print/rotas) ────────────────────────────────────────

/**
 * Uma secção por rota — é a folha que se entrega a cada estafeta, por isso
 * cada rota (depois da primeira) começa numa página nova.
 */
export function buildRotasPrintSections(routes: Route[]): PrintSection[] {
  return routes.map((route, index) => ({
    heading: `${route.courier} — ${route.deliveryDay} ${isoToPtDate(route.deliveryDate)}`,
    subheading: `${route.stops.length} ${route.stops.length === 1 ? "paragem" : "paragens"}`,
    breakBefore: index > 0,
    table: {
      headers: [
        "Seq",
        "Encomenda",
        "Cliente",
        "Telefone",
        "Morada",
        "CP",
        "Cidade",
        "Notas",
      ],
      rows: route.stops.map((stop) => [
        stop.sequence !== undefined ? String(stop.sequence) : "",
        stop.orderName,
        stop.client,
        stop.phone,
        stop.address1,
        stop.zip,
        stop.city,
        stop.note ?? "",
      ]),
      numericCols: [0],
    },
  }));
}

// ── Secções: Compras (/app/print/compras) ────────────────────────────────────

/** 5.184 → "5,184" (o motor já arredonda; só trocamos o separador decimal). */
function formatQty(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * Uma secção por fornecedor + secção final "Pratos sem ficha técnica" quando
 * existam (omitida ao filtrar por fornecedor — a folha filtrada destina-se a
 * ser entregue ao próprio fornecedor).
 */
export function buildComprasPrintSections(
  view: ComprasView,
  fornecedor?: string | null,
): PrintSection[] {
  const suppliers = fornecedor
    ? view.suppliers.filter((s) => s.supplier === fornecedor)
    : view.suppliers;

  const sections: PrintSection[] = suppliers.map((supplier) => {
    const subheadingParts = [
      ...(supplier.orderDay ? [`Encomendar: ${supplier.orderDay}`] : []),
      ...(supplier.email ? [supplier.email] : []),
    ];
    return {
      heading: supplier.supplier,
      ...(subheadingParts.length > 0
        ? { subheading: subheadingParts.join(" · ") }
        : {}),
      table: {
        headers: ["Ingrediente", "Necessário", "+margem", "Unidade"],
        rows: supplier.lines.map((line) => [
          line.ingredient,
          formatQty(line.required),
          formatQty(line.withMargin),
          line.unit,
        ]),
        numericCols: [1, 2],
      },
    };
  });

  if (!fornecedor && view.missing.count > 0) {
    sections.push({
      heading: "Pratos sem ficha técnica",
      subheading:
        `${view.missing.count} combinações prato/dose · ` +
        `${view.missing.unitsTotal} refeições não refletidas nas compras`,
      table: {
        headers: ["Prato", "Dose", "Unidades vendidas"],
        rows: view.missing.top.map((entry) => [
          entry.dish,
          entry.dose,
          String(entry.unitsSold),
        ]),
        numericCols: [2],
      },
    });
  }

  return sections;
}

// ── Secções: Etiquetas (/app/print/etiquetas) ────────────────────────────────

export const ETIQUETAS_PRINT_NOTE =
  "Versão de conferência — as etiquetas autocolantes ficam para uma fase posterior.";

/**
 * Uma secção por data de confeção, 1 linha por refeição (o motor buildLabels
 * já explode as quantidades). `dia` = data de confeção (yyyy-mm-dd).
 */
export function buildEtiquetasPrintSections(
  labels: LabelRow[],
  dia?: string | null,
): PrintSection[] {
  const filtered = dia ? labels.filter((l) => l.confDate === dia) : labels;

  return groupLabelsByConfDate(filtered).map((group) => ({
    heading: `Confeção — ${confDateSheetName(group.confDate)}`,
    subheading: `${group.rows.length} ${group.rows.length === 1 ? "etiqueta" : "etiquetas"}`,
    table: {
      headers: ["Encomenda", "Prato", "Cliente", "Data Confeção"],
      rows: group.rows.map((row) => [
        row.orderName,
        row.dish,
        row.client,
        isoToPtDate(row.confDate),
      ]),
    },
  }));
}
