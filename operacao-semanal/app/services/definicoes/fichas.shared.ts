/**
 * Constantes de fichas técnicas partilhadas entre o service (.server) e o
 * componente da rota (cliente).
 *
 * Este módulo NÃO pode importar nada server-only (Prisma, db.server, …):
 * o React Router bloqueia o build quando um export de cliente de uma rota
 * depende de um módulo `.server`.
 */

export const DISH_CATEGORIES = [
  "peixe",
  "carne",
  "vegetariano",
  "poke",
  "pizza",
  "sopa",
  "sobremesa",
  "embalagem",
  "outro",
] as const;

export type DishCategory = (typeof DISH_CATEGORIES)[number];

export const INGREDIENT_UNITS = ["kg", "g", "ml", "L", "un"] as const;

export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];
