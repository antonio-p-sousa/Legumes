/**
 * Fixture: resposta simulada da query OrdersInWindow em 2 páginas.
 *
 * Espelha o formato REAL do payload do GraphQL Admin API (2025-07+):
 *  - montantes (MoneyV2.amount) como STRING ("47.9");
 *  - `tags` como array de strings;
 *  - `displayFinancialStatus` como enum UPPERCASE ("PAID");
 *  - campos opcionais ausentes como null.
 *
 * Usada por app/services/orders/graphql.server.test.ts — testes sem rede.
 * Os dados seguem o padrão anonimizado das fixtures w47 (Cliente NNN,
 * clienteNNN@example.com, telefones 9NNNNNNNN, Rua Exemplo N).
 */
import type { GraphqlOrderNode } from "../../app/services/orders/graphql.server";

/** Encomenda completa — todos os campos preenchidos (página 1). */
export const FULL_ORDER_NODE: GraphqlOrderNode = {
  name: "#45184-LoV",
  email: "cliente001@example.com",
  createdAt: "2025-11-22T01:28:43Z",
  note: "Sem coentros, por favor",
  tags: ["moloni", "primeira-compra"],
  displayFinancialStatus: "PAID",
  customAttributes: [
    { key: "Order Type", value: "Shipping" },
    { key: "Data de entrega", value: "24/11/2025" },
    { key: "Horário de entrega", value: "Lisboa (Centro da cidade) 19-23h" },
    { key: "Dia de entrega", value: "Segunda" },
    { key: "Date Format", value: "dd/mm/yy" },
  ],
  shippingAddress: {
    name: "Cliente 001",
    address1: "Rua Exemplo 1",
    zip: "2685-406",
    city: "Prior Velho",
    phone: "900000001",
  },
  billingAddress: { name: "Cliente 001 Faturação" },
  shippingLine: { title: "45€ a 49,99€" },
  subtotalPriceSet: { shopMoney: { amount: "47.9" } },
  totalPriceSet: { shopMoney: { amount: "49.8" } },
  lineItems: {
    edges: [
      {
        node: {
          name: "Coxa de Frango sem osso com molho de churrasco - Low Carb",
          quantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: "7.25" } },
        },
      },
      {
        node: {
          name: "Poke Bowl Salmão com molho teriyaki - M (com arroz)",
          quantity: 2,
          originalUnitPriceSet: { shopMoney: { amount: "9.95" } },
        },
      },
    ],
  },
};

/** Encomenda mínima — opcionais a null/vazio (página 1). */
export const MINIMAL_ORDER_NODE: GraphqlOrderNode = {
  name: "#45185-LoV",
  email: null,
  createdAt: "2025-11-23T10:00:00Z",
  note: null,
  tags: [],
  displayFinancialStatus: null,
  customAttributes: [],
  shippingAddress: null,
  billingAddress: null,
  shippingLine: null,
  subtotalPriceSet: null,
  totalPriceSet: { shopMoney: { amount: "0.0" } },
  lineItems: { edges: [] },
};

/** Encomenda da página 2 — pickup com qty > 1. */
export const PAGE_2_ORDER_NODE: GraphqlOrderNode = {
  name: "#45186-LoV",
  email: "cliente003@example.com",
  createdAt: "2025-11-28T22:15:09Z",
  note: null,
  tags: ["moloni"],
  displayFinancialStatus: "PARTIALLY_REFUNDED",
  customAttributes: [
    { key: "Order Type", value: "Store Pickup" },
    { key: "Data de entrega", value: "26/11/2025" },
    { key: "Horário de entrega", value: "Store Pickup — PR Coimbra" },
    { key: "Dia de entrega", value: "Quarta" },
    { key: "Date Format", value: "dd/mm/yy" },
  ],
  shippingAddress: null,
  billingAddress: { name: "Cliente 003" },
  shippingLine: null,
  subtotalPriceSet: { shopMoney: { amount: "21.75" } },
  totalPriceSet: { shopMoney: { amount: "21.75" } },
  lineItems: {
    edges: [
      {
        node: {
          name: "Jardineira de Novilho - Bulk",
          quantity: 3,
          originalUnitPriceSet: { shopMoney: { amount: "7.25" } },
        },
      },
    ],
  },
};

export const CURSOR_PAGE_2 = "cursor-page-2";

/** Página 1: 2 encomendas, hasNextPage=true com cursor para a página 2. */
export const GRAPHQL_ORDERS_PAGE_1 = {
  data: {
    orders: {
      pageInfo: { hasNextPage: true, endCursor: CURSOR_PAGE_2 },
      edges: [{ node: FULL_ORDER_NODE }, { node: MINIMAL_ORDER_NODE }],
    },
  },
};

/** Página 2 (final): 1 encomenda, hasNextPage=false. */
export const GRAPHQL_ORDERS_PAGE_2 = {
  data: {
    orders: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [{ node: PAGE_2_ORDER_NODE }],
    },
  },
};
