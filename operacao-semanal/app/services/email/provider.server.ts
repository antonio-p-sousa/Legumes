/**
 * Abstração de envio de email — AGNÓSTICA AO FORNECEDOR.
 *
 * O objetivo é ter o contrato pronto para ligar um serviço real (Brevo,
 * Resend, SMTP, ...) "em minutos" assim que a decisão for tomada, SEM que hoje
 * saia um único email para o mundo.
 *
 * Estado atual: só existe o `DryRunEmailProvider`, que NUNCA envia — apenas
 * regista/loga a mensagem e devolve `{ ok: true, dryRun: true }`. Enquanto
 * `EMAIL_PROVIDER` não estiver configurado com um fornecedor REAL (e o
 * respetivo stub abaixo não estiver implementado + dependência instalada),
 * `getEmailProvider()` devolve sempre o provider de dry-run.
 *
 * Funções puras / sem I/O externo: o "envio" do dry-run é só um log injetável,
 * o que mantém tudo testável e garante que nada é enviado de verdade.
 */

/** Anexo de um email (ex.: xlsx de uma rota). `content` é o conteúdo em bruto. */
export interface EmailAttachment {
  filename: string;
  content: string;
}

/** Mensagem de email, independente do fornecedor. */
export interface EmailMessage {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

/** Resultado de uma tentativa de envio. `dryRun: true` ⇒ NADA saiu de verdade. */
export interface EmailResult {
  ok: boolean;
  /** Nome do provider que tratou (ou simulou) o envio. */
  provider: string;
  /** true quando foi simulado (nenhum email real enviado). */
  dryRun: boolean;
  detail?: string;
}

/** Contrato mínimo que qualquer fornecedor de email tem de cumprir. */
export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<EmailResult>;
}

/** Entrada registada pelo dry-run — o que TERIA sido enviado. */
export interface DryRunLogEntry {
  to: string;
  cc: string[];
  subject: string;
  bytes: number;
  attachments: number;
}

/** Logger por omissão do dry-run: escreve na consola com prefixo claro. */
function defaultDryRunLog(entry: DryRunLogEntry): void {
  // eslint-disable-next-line no-console
  console.info(
    `[email:dry-run] (NÃO enviado) para=${entry.to} cc=${entry.cc.join(", ") || "—"} assunto="${entry.subject}" corpo=${entry.bytes}B anexos=${entry.attachments}`,
  );
}

/**
 * Provider de dry-run: NÃO envia nada. Regista a mensagem (via logger
 * injetável, útil para testes) e devolve sempre `dryRun: true`.
 */
export class DryRunEmailProvider implements EmailProvider {
  readonly name = "dry-run";

  private readonly log: (entry: DryRunLogEntry) => void;

  constructor(log: (entry: DryRunLogEntry) => void = defaultDryRunLog) {
    this.log = log;
  }

  async send(msg: EmailMessage): Promise<EmailResult> {
    // Ponto único onde um envio real aconteceria — aqui é deliberadamente
    // inócuo: só regista o que teria saído.
    this.log({
      to: msg.to,
      cc: msg.cc ?? [],
      subject: msg.subject,
      bytes: Buffer.byteLength(msg.text, "utf8"),
      attachments: msg.attachments?.length ?? 0,
    });

    return {
      ok: true,
      provider: this.name,
      dryRun: true,
      detail: "Simulado (dry-run): nenhum email foi enviado.",
    };
  }
}

/** Variáveis de ambiente que este módulo lê (subconjunto testável). */
export interface EmailEnv {
  EMAIL_PROVIDER?: string;
}

/**
 * Resolve o provider de email a partir da configuração.
 *
 * - `EMAIL_PROVIDER` ausente, vazio ou "dry-run" → `DryRunEmailProvider`.
 * - Qualquer outro valor → hoje ainda NÃO há fornecedor real ligado, por isso
 *   caímos (com aviso) no `DryRunEmailProvider`. Isto é intencional: garante
 *   que NADA é enviado de verdade enquanto o serviço não for decidido e o
 *   respetivo stub não for implementado. Trocar para envio real é uma decisão
 *   deliberada — descomentar o stub + instalar a dependência + devolver aqui o
 *   provider real.
 *
 * `env` é injetável para testes; por omissão lê `process.env`.
 */
export function getEmailProvider(env: EmailEnv = process.env): EmailProvider {
  const configured = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();

  if (configured === "" || configured === "dry-run") {
    return new DryRunEmailProvider();
  }

  switch (configured) {
    // ── STUBS (por ligar) ──────────────────────────────────────────────────
    // Quando o serviço for decidido, implementar o provider correspondente
    // NOUTRO ficheiro (ex.: brevo.server.ts), instalar a dependência e devolvê-lo
    // aqui. Manter a assinatura `EmailProvider`. NÃO escrever chamadas reais
    // enquanto a decisão não estiver tomada.
    //
    // case "brevo":
    //   // npm i @getbrevo/brevo  — usa process.env.BREVO_API_KEY
    //   // return new BrevoEmailProvider(env.BREVO_API_KEY!);
    //
    // case "resend":
    //   // npm i resend  — usa process.env.RESEND_API_KEY
    //   // return new ResendEmailProvider(env.RESEND_API_KEY!);
    //
    // case "smtp":
    //   // npm i nodemailer  — usa process.env.SMTP_URL
    //   // return new SmtpEmailProvider(env.SMTP_URL!);

    default:
      // eslint-disable-next-line no-console
      console.warn(
        `[email] EMAIL_PROVIDER="${configured}" ainda não está ligado — a usar dry-run (nada é enviado). Implementa o stub correspondente para ativar o envio real.`,
      );
      return new DryRunEmailProvider();
  }
}
