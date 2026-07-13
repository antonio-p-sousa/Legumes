import { describe, expect, test } from "vitest";
import {
  buildComprasPrintSections,
  buildCozinhaPrintSections,
  buildEtiquetasPrintSections,
  buildRotasPrintSections,
  escapeHtml,
  ETIQUETAS_PRINT_NOTE,
  htmlResponse,
  renderPrintPage,
  type PrintSection,
} from "./html.server";
import type { CozinhaDay, CozinhaView, DoseMatrix } from "../pages/cozinha.server";
import type { ComprasView } from "../pages/compras.server";
import type { LabelRow, Route } from "../weekly";

// ── Fixtures determinísticas ─────────────────────────────────────────────────

const GENERATED_AT = new Date(2026, 6, 10, 9, 30); // 10/07/2026 09:30 local

function makeSection(overrides: Partial<PrintSection> = {}): PrintSection {
  return {
    heading: "Secção de teste",
    table: {
      headers: ["Prato", "Qtd"],
      rows: [
        ["Jardineira de Novilho", "4"],
        ["Caril de Grão", "2"],
      ],
    },
    ...overrides,
  };
}

function renderBasic(overrides: Partial<PrintSection> = {}): string {
  return renderPrintPage({
    title: "Documento de teste",
    subtitle: "Semana 2025-W47",
    sections: [makeSection(overrides)],
    generatedAt: GENERATED_AT,
  });
}

const EMPTY_MATRIX: DoseMatrix = {
  doseColumns: [],
  rows: [],
  columnTotals: [],
  total: 0,
};

function makeCozinhaDay(overrides: Partial<CozinhaDay> = {}): CozinhaDay {
  return {
    confDay: "2f",
    label: "Segunda",
    confDate: "2025-11-24",
    totalMeals: 6,
    totalOrders: 2,
    peixeCarne: {
      doseColumns: ["Low Carb", "Bulk"],
      rows: [{ dish: "Tranche de Salmão", cells: [3, null], total: 3 }],
      columnTotals: [3, 0],
      total: 3,
    },
    vegetariano: EMPTY_MATRIX,
    pokes: [],
    doseUnica: [{ dish: "Sopa de Legumes", dose: "Dose Única", quantity: 3 }],
    notes: [{ orderName: "#45001-LoV", note: "Sem coentros, por favor" }],
    ...overrides,
  };
}

function makeCozinhaView(days: CozinhaDay[]): CozinhaView {
  return {
    days,
    totalMeals: days.reduce((sum, d) => sum + d.totalMeals, 0),
    totalOrders: days.reduce((sum, d) => sum + d.totalOrders, 0),
    nonMeal: [],
  };
}

const ROUTES: Route[] = [
  {
    courier: "Interno",
    courierType: "internal",
    deliveryDay: "Segunda",
    deliveryDate: "2025-11-24",
    stops: [
      {
        orderName: "#45001-LoV",
        client: "Maria Silva",
        phone: "912345678",
        address1: "Rua das Flores 1",
        zip: "3000-123",
        city: "Coimbra",
        subtotal: 60,
        note: "Deixar na portaria",
        window: "Coimbra (Centro) 18-22h",
        sequence: 1,
      },
    ],
  },
  {
    courier: "Off Limits",
    courierType: "partner",
    deliveryDay: "Terça",
    deliveryDate: "2025-11-25",
    stops: [
      {
        orderName: "#45002-LoV",
        client: "João Costa",
        phone: "913222111",
        address1: "Av. Central 10",
        zip: "2400-000",
        city: "Leiria",
        subtotal: 45,
      },
    ],
  },
];

const COMPRAS_VIEW: ComprasView = {
  suppliers: [
    {
      supplier: "Peixaria Central",
      email: "geral@peixaria.pt",
      orderDay: "quinta-feira",
      lines: [
        { ingredient: "Tranche de salmão", unit: "kg", required: 5.2, withMargin: 5.616 },
      ],
    },
    {
      supplier: "Hortas do Mondego",
      lines: [{ ingredient: "Batata", unit: "kg", required: 12, withMargin: 12.96 }],
    },
  ],
  missing: {
    count: 1,
    unitsTotal: 4,
    top: [{ dish: "Poke Havaiano", dose: "M arroz", unitsSold: 4 }],
  },
  stats: { fornecedores: 2, ingredientes: 2, alertas: 1 },
};

const LABELS: LabelRow[] = [
  { orderName: "#45001-LoV", dish: "Tranche de Salmão - Low Carb", client: "Maria Silva", confDate: "2025-11-24" },
  { orderName: "#45001-LoV", dish: "Tranche de Salmão - Low Carb", client: "Maria Silva", confDate: "2025-11-24" },
  { orderName: "#45002-LoV", dish: "Caril de Grão - 400g", client: "João Costa", confDate: "2025-11-25" },
];

// ── escapeHtml ───────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  test("escapa &, <, >, aspas duplas e aspas simples", () => {
    expect(escapeHtml(`Tomate & "cebola" <script>'x'</script>`)).toBe(
      "Tomate &amp; &quot;cebola&quot; &lt;script&gt;&#39;x&#39;&lt;/script&gt;",
    );
  });

  test("devolve texto simples inalterado", () => {
    expect(escapeHtml("Jardineira de Novilho — Bulk")).toBe(
      "Jardineira de Novilho — Bulk",
    );
  });
});

// ── renderPrintPage ──────────────────────────────────────────────────────────

describe("renderPrintPage", () => {
  test("contém título, subtítulo, secção e células da tabela", () => {
    const html = renderBasic();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Documento de teste</title>");
    expect(html).toContain("<h1>Documento de teste</h1>");
    expect(html).toContain("Semana 2025-W47");
    expect(html).toContain("<h2>Secção de teste</h2>");
    expect(html).toContain("<td>Jardineira de Novilho</td>");
    expect(html).toContain("<td>4</td>");
  });

  test("escapa conteúdo malicioso (nota de cliente com <script>)", () => {
    const html = renderBasic({
      table: {
        headers: ["Encomenda", "Nota"],
        rows: [["#45001-LoV", `<script>alert("pwn")</script> & 'fim'`]],
      },
    });
    expect(html).not.toContain(`<script>alert("pwn")</script>`);
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt; &amp; &#39;fim&#39;",
    );
  });

  test("numericCols alinham à direita via classe .num (th e td)", () => {
    const html = renderBasic({
      table: {
        headers: ["Prato", "Qtd"],
        rows: [["Sopa", "7"]],
        numericCols: [1],
      },
    });
    expect(html).toContain('<th class="num" scope="col">Qtd</th>');
    expect(html).toContain('<td class="num">7</td>');
    expect(html).toContain('<th scope="col">Prato</th>'); // coluna 0 sem .num
    expect(html).toContain("<td>Sopa</td>");
  });

  test("breakBefore gera a classe de quebra de página", () => {
    const withBreak = renderBasic({ breakBefore: true });
    const withoutBreak = renderBasic();
    expect(withBreak).toContain('<section class="section break-before">');
    expect(withoutBreak).not.toContain("break-before\"");
    expect(withBreak).toContain("page-break-before: always");
  });

  test("botão de imprimir presente e escondido em @media print", () => {
    const html = renderBasic();
    expect(html).toContain("window.print()");
    expect(html).toContain("Imprimir / Guardar como PDF");
    expect(html).toMatch(
      /@media print[^]*\.print-button\s*\{\s*display:\s*none;\s*\}/,
    );
  });

  test("estrutura thead/tbody com cabeçalhos repetidos por página", () => {
    const html = renderBasic();
    expect(html).toContain("<thead><tr>");
    expect(html).toContain("<tbody><tr>");
    expect(html).toContain("thead { display: table-header-group; }");
  });

  test("linha de totais rendida em tfoot", () => {
    const html = renderBasic({
      table: {
        headers: ["Prato", "Qtd"],
        rows: [["Sopa", "7"]],
        numericCols: [1],
        totals: ["Total", "7"],
      },
    });
    expect(html).toContain('<tfoot><tr class="totals"><td>Total</td><td class="num">7</td></tr></tfoot>');
  });

  test("rodapé institucional presente", () => {
    expect(renderBasic()).toContain(
      "Operação Semanal — Legumes e outros Vícios",
    );
  });

  test("secção sem linhas → mensagem 'Sem dados.'; página sem secções → mensagem global", () => {
    const emptySection = renderBasic({
      table: { headers: ["Prato", "Qtd"], rows: [] },
    });
    expect(emptySection).toContain('<p class="empty">Sem dados.</p>');
    expect(emptySection).not.toContain("<tbody>");

    const emptyPage = renderPrintPage({
      title: "Vazio",
      sections: [],
      generatedAt: GENERATED_AT,
    });
    expect(emptyPage).toContain("Sem dados para apresentar.");
  });

  test("determinismo: mesma view + mesma data de geração → mesma string", () => {
    const a = renderBasic();
    const b = renderBasic();
    expect(a).toBe(b);
    expect(a).toContain("Gerado em 10/07/2026 09:30");
  });

  test("nota informativa aparece escapada no topo", () => {
    const html = renderPrintPage({
      title: "Etiquetas",
      note: `${ETIQUETAS_PRINT_NOTE} <b>x</b>`,
      sections: [makeSection()],
      generatedAt: GENERATED_AT,
    });
    expect(html).toContain(
      `<p class="note">${escapeHtml(ETIQUETAS_PRINT_NOTE)} &lt;b&gt;x&lt;/b&gt;</p>`,
    );
  });
});

// ── htmlResponse ─────────────────────────────────────────────────────────────

describe("htmlResponse", () => {
  test("devolve Response text/html utf-8 com o corpo intacto", async () => {
    const response = htmlResponse("<!doctype html><html></html>");
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toBe("<!doctype html><html></html>");
  });
});

// ── buildCozinhaPrintSections ────────────────────────────────────────────────

describe("buildCozinhaPrintSections", () => {
  test("gera secções por categoria com totais e notas do dia", () => {
    const sections = buildCozinhaPrintSections(
      makeCozinhaView([makeCozinhaDay()]),
    );

    expect(sections.map((s) => s.heading)).toEqual([
      "Segunda 24/11/2025 — Peixe & carne",
      "Segunda 24/11/2025 — Dose única",
      "Segunda 24/11/2025 — Notas de encomendas",
    ]);
    // matriz achatada: só células vendidas (Bulk=null não aparece)
    expect(sections[0].table.rows).toEqual([
      ["Tranche de Salmão", "Low Carb", "3"],
    ]);
    expect(sections[0].table.totals).toEqual(["Total", "", "3"]);
    expect(sections[0].subheading).toBe("6 refeições · 2 encomendas");
    expect(sections[0].breakBefore).toBe(false); // primeiro dia sem quebra
    expect(sections[2].table.rows).toEqual([
      ["#45001-LoV", "Sem coentros, por favor"],
    ]);
  });

  test("dia seguinte começa em página nova e ?dia= filtra", () => {
    const view = makeCozinhaView([
      makeCozinhaDay(),
      makeCozinhaDay({ confDay: "3f", label: "Terça", confDate: "2025-11-25", notes: [] }),
    ]);

    const all = buildCozinhaPrintSections(view);
    const firstOfSecondDay = all.find((s) =>
      s.heading.startsWith("Terça"),
    ) as PrintSection;
    expect(firstOfSecondDay.breakBefore).toBe(true);

    const only3f = buildCozinhaPrintSections(view, "3f");
    expect(only3f.every((s) => s.heading.startsWith("Terça"))).toBe(true);
    expect(buildCozinhaPrintSections(view, "4f")).toEqual([]);
  });
});

// ── buildRotasPrintSections ──────────────────────────────────────────────────

describe("buildRotasPrintSections", () => {
  test("uma secção por rota, com paragens e página nova a partir da 2ª", () => {
    const sections = buildRotasPrintSections(ROUTES);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("Interno — Segunda 24/11/2025");
    expect(sections[0].subheading).toBe("1 paragem");
    expect(sections[0].breakBefore).toBe(false);
    expect(sections[1].breakBefore).toBe(true);
    expect(sections[0].table.rows[0]).toEqual([
      "1",
      "#45001-LoV",
      "Maria Silva",
      "912345678",
      "Rua das Flores 1",
      "3000-123",
      "Coimbra",
      "Deixar na portaria",
    ]);
    // sem sequence nem note → células vazias, nunca "undefined"
    expect(sections[1].table.rows[0][0]).toBe("");
    expect(sections[1].table.rows[0][7]).toBe("");
  });
});

// ── buildComprasPrintSections ────────────────────────────────────────────────

describe("buildComprasPrintSections", () => {
  test("secção por fornecedor + secção final de pratos sem ficha", () => {
    const sections = buildComprasPrintSections(COMPRAS_VIEW);

    expect(sections.map((s) => s.heading)).toEqual([
      "Peixaria Central",
      "Hortas do Mondego",
      "Pratos sem ficha técnica",
    ]);
    expect(sections[0].subheading).toBe(
      "Encomendar: quinta-feira · geral@peixaria.pt",
    );
    expect(sections[1].subheading).toBeUndefined();
    // decimais com vírgula (o motor já arredonda a 3 casas)
    expect(sections[0].table.rows[0]).toEqual([
      "Tranche de salmão",
      "5,2",
      "5,616",
      "kg",
    ]);
    expect(sections[2].table.rows).toEqual([["Poke Havaiano", "M arroz", "4"]]);
  });

  test("?fornecedor= filtra e omite a secção de pratos sem ficha", () => {
    const sections = buildComprasPrintSections(COMPRAS_VIEW, "Hortas do Mondego");
    expect(sections.map((s) => s.heading)).toEqual(["Hortas do Mondego"]);
  });
});

// ── buildEtiquetasPrintSections ──────────────────────────────────────────────

describe("buildEtiquetasPrintSections", () => {
  test("uma secção por data de confeção, 1 linha por refeição", () => {
    const sections = buildEtiquetasPrintSections(LABELS);

    expect(sections.map((s) => s.heading)).toEqual([
      "Confeção — Segunda 24-11",
      "Confeção — Terça 25-11",
    ]);
    expect(sections[0].subheading).toBe("2 etiquetas");
    expect(sections[0].table.rows).toEqual([
      ["#45001-LoV", "Tranche de Salmão - Low Carb", "Maria Silva", "24/11/2025"],
      ["#45001-LoV", "Tranche de Salmão - Low Carb", "Maria Silva", "24/11/2025"],
    ]);
  });

  test("?dia= filtra pela data de confeção; sem match → sem secções", () => {
    const sections = buildEtiquetasPrintSections(LABELS, "2025-11-25");
    expect(sections).toHaveLength(1);
    expect(sections[0].subheading).toBe("1 etiqueta");
    expect(buildEtiquetasPrintSections(LABELS, "2025-12-01")).toEqual([]);
  });
});
