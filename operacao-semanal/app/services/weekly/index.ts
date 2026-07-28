/**
 * Barrel do motor "Operação Semanal" — ponto de entrada único para loaders e
 * testes. Ver ARCHITECTURE.md secção 6 (módulos) e `types.ts` (contrato).
 *
 * Fluxo típico:
 *   processOrders(orders, zones, window)  → ProcessedOrder[]
 *     → buildKitchenMap · buildLabels · buildPurchaseList
 *     → buildRoutes · buildDpdCsv
 */

// Contrato de tipos + constantes de domínio (isMealItem, mapas de dias).
export * from "./types";

// Parsing dos atributos de entrega e do nome prato+dose (4.1, 4.2).
export { parseNoteAttributes, splitDishDose } from "./parse";

// Zonas, dia de confeção e janela de encomendas (4.1, 4.3, 4.4).
export { filterOrderWindow, matchZone, resolveConfDay } from "./schedule";

// Pipeline de entrada: OrderInput[] → ProcessedOrder[] (nunca descarta).
export {
  ISSUE_AFTER_CLOSE,
  ISSUE_MISSING_DELIVERY_ATTRS,
  ISSUE_UNKNOWN_ZONE_PREFIX,
  ISSUE_ZONE_NO_COURIER,
  processOrders,
} from "./pipeline";
export type { PipelineResult, ProcessOrdersOptions } from "./pipeline";

// Outputs: cozinha (4.3), etiquetas (4.7), compras (4.5), rotas e DPD (4.6).
export { buildKitchenMap } from "./kitchen";
export { buildLabels } from "./labels";
export { buildPurchaseList } from "./purchases";
export { buildRoutes } from "./routes";
export { buildDpdCsv } from "./dpd";

// Rotas de câmara: separação das refeições na câmara refrigerada por dia de
// produção e bloco de destino (espelha o `00. Rotas.xlsx` do cliente).
export { buildChamberDoc } from "./chamber";
export type {
  ChamberBlock,
  ChamberClient,
  ChamberDay,
  ChamberDoc,
  ChamberRow,
} from "./chamber";

// Modelo de COMPONENTES do empratamento (1.ª fase — kg por dose/componente,
// sem fichas técnicas por ingrediente; ver components.ts).
export {
  COMPONENT_NAMES,
  DEFAULT_COMPONENT_FACTORS,
  buildComponentPlan,
  normalizeDoseForFactors,
} from "./components";
export type {
  ComponentFactor,
  ComponentName,
  ComponentPlan,
  ComponentPlanDay,
  ComponentSkipped,
} from "./components";
