import { describe, expect, test } from "vitest";
import {
  DryRunEmailProvider,
  getEmailProvider,
  type DryRunLogEntry,
  type EmailMessage,
} from "./provider.server";

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: "rotas@offlimits.pt",
    cc: ["backup@offlimits.pt"],
    subject: "Rotas Off Limits — 24/11/2025",
    text: "Olá Off Limits,\n\nSeguem as rotas.",
    ...overrides,
  };
}

describe("getEmailProvider", () => {
  test("sem EMAIL_PROVIDER configurado devolve o provider de dry-run", () => {
    // Arrange
    const env = {};

    // Act
    const provider = getEmailProvider(env);

    // Assert
    expect(provider.name).toBe("dry-run");
    expect(provider).toBeInstanceOf(DryRunEmailProvider);
  });

  test("EMAIL_PROVIDER=\"dry-run\" devolve o provider de dry-run", () => {
    // Arrange
    const env = { EMAIL_PROVIDER: "dry-run" };

    // Act
    const provider = getEmailProvider(env);

    // Assert
    expect(provider.name).toBe("dry-run");
  });

  test("provider ainda não ligado (ex.: brevo) cai em dry-run — nada real sai", () => {
    // Arrange — fornecedor real mencionado mas sem stub implementado
    const env = { EMAIL_PROVIDER: "brevo" };

    // Act
    const provider = getEmailProvider(env);

    // Assert
    expect(provider.name).toBe("dry-run");
    expect(provider).toBeInstanceOf(DryRunEmailProvider);
  });
});

describe("DryRunEmailProvider", () => {
  test("não envia: regista a mensagem e devolve dryRun:true", async () => {
    // Arrange
    const registados: DryRunLogEntry[] = [];
    const provider = new DryRunEmailProvider((entry) => registados.push(entry));
    const message = makeMessage();

    // Act
    const result = await provider.send(message);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.provider).toBe("dry-run");
    // Só registou — não houve envio real (nenhum I/O externo).
    expect(registados).toHaveLength(1);
    expect(registados[0].to).toBe("rotas@offlimits.pt");
    expect(registados[0].cc).toEqual(["backup@offlimits.pt"]);
    expect(registados[0].subject).toBe("Rotas Off Limits — 24/11/2025");
  });

  test("mensagem sem CC nem anexos regista listas/contagens vazias", async () => {
    // Arrange
    const registados: DryRunLogEntry[] = [];
    const provider = new DryRunEmailProvider((entry) => registados.push(entry));

    // Act
    await provider.send(makeMessage({ cc: undefined, attachments: undefined }));

    // Assert
    expect(registados[0].cc).toEqual([]);
    expect(registados[0].attachments).toBe(0);
  });
});
