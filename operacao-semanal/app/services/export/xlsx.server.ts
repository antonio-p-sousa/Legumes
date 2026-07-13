/**
 * Helper partilhado de exports xlsx (resource routes /app/api/export/*).
 * Mantém os exports consistentes: cabeçalho a bold com fundo verde LOV,
 * larguras definidas por folha, uma folha por dia/rota/fornecedor.
 */
import ExcelJS from "exceljs";

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
}

export interface SheetSpec {
  /** máx. 31 chars, sem : \ / ? * [ ] (limite do formato xlsx) */
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2E7D43" },
};

function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Folha";
}

export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Operação Semanal — Legumes e outros Vícios";
  wb.created = new Date();

  for (const spec of sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(spec.name));
    ws.columns = spec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 18,
    }));
    for (const row of spec.rows) ws.addRow(row);

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = HEADER_FILL;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      // latin1-friendly seria ideal para o portal DPD; UTF-8 com BOM cobre Excel
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
