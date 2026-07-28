import { describe, expect, test } from "vitest";
import {
  buildPartnerRouteEmails,
  sendPartnerRoutes,
  type PartnerCourier,
} from "./route-email.server";
import {
  DryRunEmailProvider,
  type DryRunLogEntry,
} from "./provider.server";
import type { EstafetasView } from "../pages/estafetas.server";
import type { Route, RouteStop } from "../weekly";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeStop(overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    orderName: "#45004-LoV",
    client: "João Silva",
    phone: "912345678",
    address1: "Rua das Flores 1",
    zip: "1000-100",
    city: "Lisboa",
    subtotal: 42.5,
    window: "Lisboa (Centro) 19-23h",
    ...overrides,
  };
}

function makeRoute(overrides: Partial<Route> = {}): Route {
  return {
    courier: "Off Limits",
    courierType: "partner",
    deliveryDay: "Segunda",
    deliveryDate: "2025-11-24",
    stops: [makeStop()],
    ...overrides,
  };
}

/** Vista mínima mas completa — buildPartnerRouteEmails só lê `routes`. */
function makeView(routes: Route[]): EstafetasView {
  return {
    deliveryDates: [],
    routes,
    orderingByCourier: {},
    dpd: {
      csv: "",
      shipments: 0,
      totalWeightKg: 0,
      totalVolumes: 0,
      issues: [],
      porRecolha: [],
      checks: { colunas17: true, semIndicativo351: true },
    },
  };
}

function makeCourier(overrides: Partial<PartnerCourier> = {}): PartnerCourier {
  return {
    name: "Off Limits",
    type: "partner",
    email: "rotas@offlimits.pt",
    ccEmails: [],
    ...overrides,
  };
}

// ─── buildPartnerRouteEmails ─────────────────────────────────────────────────

describe("buildPartnerRouteEmails", () => {
  test("compõe email só para parceiros com email (interno e DPD excluídos)", () => {
    // Arrange — três rotas: interno, DPD e parceiro
    const view = makeView([
      makeRoute({ courier: "Interno", courierType: "internal" }),
      makeRoute({ courier: "DPD", courierType: "dpd" }),
      makeRoute({ courier: "Off Limits", courierType: "partner" }),
    ]);
    const couriers: PartnerCourier[] = [
      makeCourier({ name: "Interno", type: "internal", email: "int@lov.pt" }),
      makeCourier({ name: "DPD", type: "dpd", email: "dpd@lov.pt" }),
      makeCourier({ name: "Off Limits", type: "partner" }),
    ];

    // Act
    const { emails, skipped } = buildPartnerRouteEmails(view, couriers);

    // Assert — só o parceiro entra
    expect(emails).toHaveLength(1);
    expect(emails[0].courier).toBe("Off Limits");
    expect(skipped).toHaveLength(0);
  });

  test("parceiro com rotas mas sem email vai para skipped (sinalizado)", () => {
    // Arrange
    const view = makeView([makeRoute({ stops: [makeStop(), makeStop()] })]);
    const couriers = [makeCourier({ email: null })];

    // Act
    const { emails, skipped } = buildPartnerRouteEmails(view, couriers);

    // Assert
    expect(emails).toHaveLength(0);
    expect(skipped).toEqual([
      { courier: "Off Limits", reason: "sem-email", stopCount: 2 },
    ]);
  });

  test("inclui os CCs do parceiro na mensagem", () => {
    // Arrange
    const view = makeView([makeRoute()]);
    const couriers = [
      makeCourier({ ccEmails: ["gestao@offlimits.pt", "backup@offlimits.pt"] }),
    ];

    // Act
    const { emails } = buildPartnerRouteEmails(view, couriers);

    // Assert
    expect(emails[0].message.cc).toEqual([
      "gestao@offlimits.pt",
      "backup@offlimits.pt",
    ]);
  });

  test("assunto e corpo corretos (encomenda, cliente, morada, janela)", () => {
    // Arrange
    const view = makeView([makeRoute()]);
    const couriers = [makeCourier()];

    // Act
    const { emails } = buildPartnerRouteEmails(view, couriers);
    const message = emails[0].message;

    // Assert — assunto
    expect(message.to).toBe("rotas@offlimits.pt");
    expect(message.subject).toBe("Rotas Off Limits — 24/11/2025");
    // Assert — corpo com os quatro campos pedidos
    expect(message.text).toContain("Olá Off Limits,");
    expect(message.text).toContain("#45004-LoV");
    expect(message.text).toContain("João Silva");
    expect(message.text).toContain("Rua das Flores 1, 1000-100, Lisboa");
    expect(message.text).toContain("Lisboa (Centro) 19-23h");
    expect(message.text).toContain("Total: 1 paragem(ns).");
    // Metadados de preview
    expect(emails[0].stopCount).toBe(1);
    expect(emails[0].deliveryDates).toEqual(["2025-11-24"]);
  });

  test("agrega várias rotas do mesmo parceiro num só email", () => {
    // Arrange — duas datas de entrega para o mesmo parceiro
    const view = makeView([
      makeRoute({ deliveryDate: "2025-11-24", stops: [makeStop()] }),
      makeRoute({
        deliveryDate: "2025-11-26",
        deliveryDay: "Quarta",
        stops: [makeStop(), makeStop()],
      }),
    ]);
    const couriers = [makeCourier()];

    // Act
    const { emails } = buildPartnerRouteEmails(view, couriers);

    // Assert
    expect(emails).toHaveLength(1);
    expect(emails[0].stopCount).toBe(3);
    expect(emails[0].deliveryDates).toEqual(["2025-11-24", "2025-11-26"]);
    expect(emails[0].message.subject).toBe(
      "Rotas Off Limits — 24/11/2025 a 26/11/2025",
    );
  });
});

// ─── sendPartnerRoutes ───────────────────────────────────────────────────────

describe("sendPartnerRoutes", () => {
  test("em dry-run não envia: todos os resultados vêm com dryRun:true", async () => {
    // Arrange
    const registados: DryRunLogEntry[] = [];
    const provider = new DryRunEmailProvider((entry) => registados.push(entry));
    const view = makeView([makeRoute()]);
    const { emails } = buildPartnerRouteEmails(view, [makeCourier()]);

    // Act
    const results = await sendPartnerRoutes(provider, emails);

    // Assert — nada saiu de verdade; só foi simulado
    expect(results).toHaveLength(1);
    expect(results[0].courier).toBe("Off Limits");
    expect(results[0].to).toBe("rotas@offlimits.pt");
    expect(results.every((r) => r.result.dryRun === true)).toBe(true);
    expect(results.every((r) => r.result.ok === true)).toBe(true);
    // O provider apenas registou (não houve envio real).
    expect(registados).toHaveLength(1);
  });

  test("sem emails a enviar devolve lista vazia sem tocar no provider", async () => {
    // Arrange
    const registados: DryRunLogEntry[] = [];
    const provider = new DryRunEmailProvider((entry) => registados.push(entry));

    // Act
    const results = await sendPartnerRoutes(provider, []);

    // Assert
    expect(results).toEqual([]);
    expect(registados).toHaveLength(0);
  });
});
