import { describe, expect, test } from "vitest";
import { parseNoteAttributes, splitDishDose } from "./parse";
import { isMealItem } from "./types";

const FULL_ATTRS = [
  { key: "Order Type", value: "Shipping" },
  { key: "Data de entrega", value: "24/11/2025" },
  { key: "Horário de entrega", value: "Lisboa (Centro da cidade) 19-23h" },
  { key: "Dia de entrega", value: "Segunda" },
  { key: "Date Format", value: "dd/mm/yy" },
];

describe("parseNoteAttributes", () => {
  test("faz parse do bloco completo e converte a data para ISO", () => {
    const parsed = parseNoteAttributes(FULL_ATTRS);

    expect(parsed).toEqual({
      orderType: "Shipping",
      deliveryDate: "2025-11-24",
      zona: "Lisboa (Centro da cidade) 19-23h",
      dia: "Segunda",
    });
  });

  test("devolve null quando falta o horário de entrega (zona)", () => {
    const attrs = FULL_ATTRS.filter((a) => a.key !== "Horário de entrega");

    expect(parseNoteAttributes(attrs)).toBeNull();
  });

  test("devolve null quando a zona existe mas está vazia", () => {
    const attrs = FULL_ATTRS.map((a) =>
      a.key === "Horário de entrega" ? { ...a, value: "  " } : a,
    );

    expect(parseNoteAttributes(attrs)).toBeNull();
  });

  test("devolve null para encomenda sem atributos", () => {
    expect(parseNoteAttributes([])).toBeNull();
  });

  test("aceita Store Pickup e datas com um dígito / ano curto", () => {
    const parsed = parseNoteAttributes([
      { key: "Order Type", value: "Store Pickup" },
      { key: "Data de entrega", value: "3/1/26" },
      { key: "Horário de entrega", value: "Store Pickup — PR Coimbra" },
      { key: "Dia de entrega", value: "Quarta" },
    ]);

    expect(parsed?.orderType).toBe("Store Pickup");
    expect(parsed?.deliveryDate).toBe("2026-01-03");
  });

  test("devolve null para data inválida (32/13/2025)", () => {
    const attrs = FULL_ATTRS.map((a) =>
      a.key === "Data de entrega" ? { ...a, value: "32/13/2025" } : a,
    );

    expect(parseNoteAttributes(attrs)).toBeNull();
  });
});

describe("splitDishDose", () => {
  test("separa o sufixo de dose de peixe/carne", () => {
    expect(splitDishDose("Jardineira de Novilho - Bulk")).toEqual({
      base: "Jardineira de Novilho",
      dose: "Bulk",
    });
    expect(
      splitDishDose("Salmão com crosta de azeitona e chia - Low Carb"),
    ).toEqual({
      base: "Salmão com crosta de azeitona e chia",
      dose: "Low Carb",
    });
    expect(
      splitDishDose(
        "Tiras de perú salteadas com molho de pimentos fumados - Zero Carbs",
      ).dose,
    ).toBe("Zero Carbs");
  });

  test("normaliza as variantes de poke (remove o 'com')", () => {
    expect(
      splitDishDose("Poke Bowl Salmão com molho teriyaki - M com arroz"),
    ).toEqual({
      base: "Poke Bowl Salmão com molho teriyaki",
      dose: "M arroz",
    });
    expect(
      splitDishDose("Poke Bowl Frango com molho de amendoim - XL com quinoa")
        .dose,
    ).toBe("XL quinoa");
  });

  test("produtos sem variante ficam com Dose Única", () => {
    expect(splitDishDose("Pizza de Fiambre de Perú")).toEqual({
      base: "Pizza de Fiambre de Perú",
      dose: "Dose Única",
    });
    expect(
      splitDishDose("Creme de Feijão Branco, Cenoura e Espinafres").dose,
    ).toBe("Dose Única");
  });

  test("doses vegetarianas em gramas", () => {
    expect(splitDishDose("Moqueca de Tofu e Legumes - 300g").dose).toBe(
      "300g",
    );
    expect(splitDishDose("Bolonhesa de Lentilhas e Legumes - 450g").dose).toBe(
      "450g",
    );
  });
});

describe("isMealItem", () => {
  test("exclui subscrições, embalagens, tips e vouchers", () => {
    expect(isMealItem("Subscrição de desconto mensal - 15% OFF")).toBe(false);
    expect(isMealItem("Embalagens biodegradáveis")).toBe(false);
    expect(isMealItem("Tip")).toBe(false);
    expect(isMealItem("Voucher Oferta - €50.00")).toBe(false);
  });

  test("mantém refeições", () => {
    expect(isMealItem("Jardineira de Novilho - Bulk")).toBe(true);
    expect(isMealItem("New York Cheesecake de Brownie com Avelã")).toBe(true);
  });
});
