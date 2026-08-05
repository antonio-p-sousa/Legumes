/**
 * View-model do cockpit "Semana" (/app).
 *
 * `buildSemanaView` é pura: recebe o WeekData já processado (loadWeekData) e
 * a configuração da app, e deriva os KPIs da semana, os cartões de dia de
 * confeção, os avisos (com os números das encomendas afetadas) e a checklist
 * do ritual semanal do operador. Reutiliza o motor weekly (buildKitchenMap,
 * buildRoutes, buildDpdCsv, buildLabels) — nunca refaz cálculos à mão.
 */
import {
  ISSUE_AFTER_CLOSE,
  ISSUE_ANOMALOUS_DELIVERY,
  ISSUE_MISSING_DELIVERY_ATTRS,
  ISSUE_UNKNOWN_ZONE_PREFIX,
  buildDpdCsv,
  buildKitchenMap,
  buildLabels,
  buildRoutes,
} from "../weekly";
import type {
  ConfDay,
  CourierConfig,
  KitchenMap,
  ProcessedOrder,
} from "../weekly";
import { CONF_DAY_PT, type WeekData } from "./common.server";

// ── Contrato do view-model ───────────────────────────────────────────────────

export interface SemanaKpis {
  /** Total de encomendas na janela (inclui as com issues). */
  encomendas: number;
  /** Encomendas sem issues — entram em todos os cálculos. */
  validas: number;
  /** Encomendas com issues (atributos em falta / zona desconhecida). */
  semZona: number;
  /** Refeições (line items refeição, quantidades explodidas). */
  refeicoes: number;
  /** Soma de totalPrice de TODAS as encomendas da janela (EUR). */
  faturacao: number;
  /** Clientes únicos por e-mail (case-insensitive; vazios ignorados). */
  clientes: number;
}

export interface SemanaDia {
  confDay: ConfDay;
  /** "Segunda" | "Terça" | ... (CONF_DAY_PT). */
  diaPT: string;
  encomendas: number;
  refeicoes: number;
  /** Estafetas com paragens no dia + "DPD · N envios" quando houver. */
  canais: string[];
}

/** Um tipo de aviso do cockpit com as encomendas afetadas. */
export interface SemanaAviso {
  /** Nº de encomendas afetadas. */
  count: number;
  /** order.name das encomendas afetadas (ex.: "#45001-LoV"), na ordem da semana. */
  encomendas: string[];
  /**
   * Lista pronta a mostrar no fim do parágrafo do banner ("#a, #b e mais N").
   * Formatada no servidor porque o componente da página não pode importar
   * helpers de um módulo .server em runtime de cliente.
   */
  lista: string;
}

export interface SemanaAvisos {
  /** Encomendas criadas depois do fecho da janela (incluídas e assinaladas). */
  posFecho: SemanaAviso;
  /** Encomendas com data de entrega fora do intervalo esperado. */
  dataAnomala: SemanaAviso;
  /** Encomendas sem o bloco de atributos de entrega. */
  semAtributos: SemanaAviso;
  /** Encomendas com texto de zona sem correspondência na configuração. */
  semZona: SemanaAviso;
  /** Encomendas distintas com pelo menos um dos avisos acima. */
  total: number;
}

export interface ChecklistBotao {
  label: string;
  /** Resource route de print/export (abre em novo separador). */
  href: string;
  disabled?: boolean;
}

export interface ChecklistPasso {
  numero: number;
  titulo: string;
  /** Contagens derivadas do motor (ex.: "2 dias · 8 refeições"). */
  detalhe: string;
  /** Badge de estado — só o passo "Rever avisos" o usa. */
  badge?: { tone: "success" | "warning"; label: string };
  botoes: ChecklistBotao[];
}

export interface SemanaView {
  kpis: SemanaKpis;
  dias: SemanaDia[];
  avisos: SemanaAvisos;
  checklist: ChecklistPasso[];
}

/** Subconjunto de AppConfig usado pelo cockpit (satisfeito pelo modelo Prisma). */
export interface SemanaViewConfig {
  dpdAccount: string | null;
}

// ── Constantes ───────────────────────────────────────────────────────────────

/** Ordem de apresentação dos dias de confeção (2ª feira → domingo). */
const DIA_ORDER: readonly ConfDay[] = ["2f", "3f", "4f", "5f", "6f", "sab", "dom"];

/** Resource routes de print/export usadas pela checklist da semana. */
export const CHECKLIST_HREFS = {
  cozinhaPrint: "/app/print/cozinha",
  cozinhaXlsx: "/app/api/export/cozinha",
  etiquetasPrint: "/app/print/etiquetas",
  etiquetasXlsx: "/app/api/export/etiquetas",
  rotasPrint: "/app/print/rotas",
  rotasXlsx: "/app/api/export/rotas",
  camaraPrint: "/app/print/rotas-camara",
  camaraXlsx: "/app/api/export/rotas-camara",
  dpdCsv: "/app/api/export/dpd",
} as const;

/** Máximo de números de encomenda listados num banner (o resto vira "e mais N"). */
export const MAX_ENCOMENDAS_LISTADAS = 10;

// ── View principal ───────────────────────────────────────────────────────────

/** Deriva a vista do cockpit a partir da semana processada. */
export function buildSemanaView(
  weekData: WeekData,
  config: SemanaViewConfig,
): SemanaView {
  const { processed, couriers } = weekData;
  const kitchen = buildKitchenMap(processed);
  const avisos = buildAvisos(processed);

  return {
    kpis: buildKpis(processed, kitchen),
    dias: buildDias(processed, kitchen, couriers),
    avisos,
    checklist: buildChecklist(processed, kitchen, couriers, config, avisos),
  };
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

function buildKpis(
  processed: ProcessedOrder[],
  kitchen: KitchenMap,
): SemanaKpis {
  const semZona = processed.filter((p) => p.issues.length > 0).length;

  const emails = new Set(
    processed
      .map((p) => p.order.email.trim().toLowerCase())
      .filter((email) => email !== ""),
  );

  const faturacao = processed.reduce(
    (sum, p) => sum + p.order.totalPrice,
    0,
  );

  return {
    encomendas: processed.length,
    validas: processed.length - semZona,
    semZona,
    refeicoes: kitchen.totalMeals,
    faturacao: round2(faturacao),
    clientes: emails.size,
  };
}

// ── Dias de confeção ─────────────────────────────────────────────────────────

function buildDias(
  processed: ProcessedOrder[],
  kitchen: KitchenMap,
  couriers: CourierConfig[],
): SemanaDia[] {
  const courierTypeByName = new Map(couriers.map((c) => [c.name, c.type]));
  const refeicoesByDay = new Map(
    kitchen.days.map((day) => [day.confDay, day.totalMeals]),
  );

  const byDay = new Map<ConfDay, ProcessedOrder[]>();
  for (const order of processed) {
    if (order.confDay === undefined) continue;
    byDay.set(order.confDay, [...(byDay.get(order.confDay) ?? []), order]);
  }

  return DIA_ORDER.filter((confDay) => byDay.has(confDay)).map((confDay) => {
    const dayOrders = byDay.get(confDay) as ProcessedOrder[];
    return {
      confDay,
      diaPT: CONF_DAY_PT[confDay] ?? confDay,
      encomendas: dayOrders.length,
      refeicoes: refeicoesByDay.get(confDay) ?? 0,
      canais: buildCanais(dayOrders, courierTypeByName),
    };
  });
}

/**
 * Canais do dia: nomes de estafetas (ordenados pt-PT) + chip "DPD · N envios"
 * no fim quando há encomendas cuja zona aponta para um courier de type "dpd".
 * Zonas sem estafeta atribuído ("") não geram chip.
 */
function buildCanais(
  dayOrders: ProcessedOrder[],
  courierTypeByName: Map<string, CourierConfig["type"]>,
): string[] {
  const estafetas = new Set<string>();
  let enviosDpd = 0;

  for (const { zone } of dayOrders) {
    const courierName = zone?.courierName ?? "";
    if (courierName === "") continue;
    if (courierTypeByName.get(courierName) === "dpd") {
      enviosDpd += 1;
    } else {
      estafetas.add(courierName);
    }
  }

  const canais = [...estafetas].sort((a, b) => a.localeCompare(b, "pt"));
  return enviosDpd > 0
    ? [...canais, `DPD · ${plural(enviosDpd, "envio", "envios")}`]
    : canais;
}

// ── Avisos da semana ─────────────────────────────────────────────────────────

/**
 * Deriva os avisos do cockpit (com os números das encomendas afetadas) a
 * partir das issues do pipeline. Pura e determinística — a ordem das listas é
 * a ordem das encomendas na semana.
 */
export function buildAvisos(processed: ProcessedOrder[]): SemanaAvisos {
  const posFecho = nomesComIssue(processed, (issues) =>
    issues.includes(ISSUE_AFTER_CLOSE),
  );
  const dataAnomala = nomesComIssue(processed, (issues) =>
    issues.includes(ISSUE_ANOMALOUS_DELIVERY),
  );
  const semAtributos = nomesComIssue(processed, (issues) =>
    issues.includes(ISSUE_MISSING_DELIVERY_ATTRS),
  );
  const semZona = nomesComIssue(processed, (issues) =>
    issues.some((issue) => issue.startsWith(ISSUE_UNKNOWN_ZONE_PREFIX)),
  );

  // Uma encomenda pode acumular avisos (ex.: pós-fecho + zona desconhecida);
  // o total conta encomendas distintas, não somas de listas.
  const total = new Set([
    ...posFecho,
    ...dataAnomala,
    ...semAtributos,
    ...semZona,
  ]).size;

  return {
    posFecho: makeAviso(posFecho),
    dataAnomala: makeAviso(dataAnomala),
    semAtributos: makeAviso(semAtributos),
    semZona: makeAviso(semZona),
    total,
  };
}

/**
 * "#a, #b, … e mais N" — mostra até MAX_ENCOMENDAS_LISTADAS números e resume
 * o resto, para os banners não crescerem sem limite em semanas grandes.
 */
export function formatListaEncomendas(nomes: string[]): string {
  if (nomes.length <= MAX_ENCOMENDAS_LISTADAS) return nomes.join(", ");
  const visiveis = nomes.slice(0, MAX_ENCOMENDAS_LISTADAS).join(", ");
  return `${visiveis} e mais ${nomes.length - MAX_ENCOMENDAS_LISTADAS}`;
}

function nomesComIssue(
  processed: ProcessedOrder[],
  match: (issues: string[]) => boolean,
): string[] {
  return processed.filter((p) => match(p.issues)).map((p) => p.order.name);
}

function makeAviso(encomendas: string[]): SemanaAviso {
  return {
    count: encomendas.length,
    encomendas,
    lista: formatListaEncomendas(encomendas),
  };
}

// ── Checklist da semana ──────────────────────────────────────────────────────

/**
 * Os passos do ritual semanal do operador, pela ordem do processo manual:
 * rever avisos → cozinha → etiquetas → rotas + câmara → CSV DPD. Os detalhes
 * e os estados disabled derivam apenas de dados já calculados pelo motor.
 */
function buildChecklist(
  processed: ProcessedOrder[],
  kitchen: KitchenMap,
  couriers: CourierConfig[],
  config: SemanaViewConfig,
  avisos: SemanaAvisos,
): ChecklistPasso[] {
  const labels = buildLabels(processed);
  const routes = buildRoutes(processed, couriers);
  const dpd = buildDpdCsv(processed, couriers, {
    account: config.dpdAccount ?? "",
  });

  const totalParagens = routes.reduce((sum, r) => sum + r.stops.length, 0);
  const semRotas = routes.length === 0;

  return [
    {
      numero: 1,
      titulo: "Rever avisos",
      detalhe:
        avisos.total === 0
          ? "Nenhuma encomenda precisa de atenção."
          : "Os detalhes estão nos avisos no topo da página.",
      badge:
        avisos.total === 0
          ? { tone: "success", label: "Sem avisos" }
          : {
              tone: "warning",
              label: plural(avisos.total, "aviso por rever", "avisos por rever"),
            },
      botoes: [],
    },
    {
      numero: 2,
      titulo: "Cozinha — mapa de produção",
      detalhe: `${plural(kitchen.days.length, "dia", "dias")} · ${plural(kitchen.totalMeals, "refeição", "refeições")}`,
      botoes: [
        { label: "Imprimir", href: CHECKLIST_HREFS.cozinhaPrint },
        { label: "Exportar xlsx", href: CHECKLIST_HREFS.cozinhaXlsx },
      ],
    },
    {
      numero: 3,
      titulo: "Etiquetas",
      detalhe: plural(labels.length, "etiqueta", "etiquetas"),
      botoes: [
        { label: "Imprimir", href: CHECKLIST_HREFS.etiquetasPrint },
        { label: "Exportar xlsx", href: CHECKLIST_HREFS.etiquetasXlsx },
      ],
    },
    {
      numero: 4,
      titulo: "Rotas + câmara",
      detalhe: `${plural(routes.length, "rota", "rotas")} · ${plural(totalParagens, "paragem", "paragens")}`,
      botoes: [
        {
          label: "Imprimir rotas",
          href: CHECKLIST_HREFS.rotasPrint,
          disabled: semRotas,
        },
        {
          label: "Exportar rotas",
          href: CHECKLIST_HREFS.rotasXlsx,
          disabled: semRotas,
        },
        { label: "Imprimir câmara", href: CHECKLIST_HREFS.camaraPrint },
        { label: "Exportar câmara", href: CHECKLIST_HREFS.camaraXlsx },
      ],
    },
    {
      numero: 5,
      titulo: "DPD — descarregar o CSV e carregá-lo no portal (como hoje)",
      detalhe: `${plural(dpd.shipments, "envio", "envios")} · ${Math.round(dpd.totalWeightKg)} kg`,
      botoes: [
        {
          label: "Descarregar CSV",
          href: CHECKLIST_HREFS.dpdCsv,
          disabled: dpd.shipments === 0,
        },
      ],
    },
  ];
}

// ── Helpers de apresentação (usados pelo loader do cockpit) ──────────────────

/**
 * "2025-11-24T10:05:00Z" → "24/11 10:05". Usa componentes UTC para o output
 * ser determinístico entre servidor e cliente (Lisboa em nov = UTC+0).
 * String vazia ou inválida → "—".
 */
export function formatDataHoraPt(iso: string): string {
  const date = new Date(iso);
  if (iso.trim() === "" || Number.isNaN(date.getTime())) return "—";

  const dd = pad2(date.getUTCDate());
  const mm = pad2(date.getUTCMonth() + 1);
  const hh = pad2(date.getUTCHours());
  const min = pad2(date.getUTCMinutes());
  return `${dd}/${mm} ${hh}:${min}`;
}

/** Minutos inteiros decorridos desde `iso` (nunca negativo; inválido → 0). */
export function minutosDesde(iso: string, agoraMs: number = Date.now()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((agoraMs - then) / 60_000));
}

// ── Internos ─────────────────────────────────────────────────────────────────

function plural(n: number, singular: string, plurale: string): string {
  return `${n} ${n === 1 ? singular : plurale}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
