import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailPort } from "./email.port";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
}

/**
 * SMTP adapter (dev/test → Mailhog; a real relay in prod until a provider API
 * adapter lands, per ADR-0006). Mailhog needs no auth and no TLS.
 */
export class SmtpEmailClient implements EmailPort {
  private readonly transport: Transporter;

  constructor(cfg: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: false,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? "" } } : {}),
    });
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}

/**
 * Build the SMTP client from env (defaults to the dev Mailhog on localhost:1025).
 * TODO(debt): DEBT-007 — a provider-API adapter (SES/Postmark) per ADR-0018 is
 * not implemented yet; this returns the SMTP adapter for all environments.
 */
export function createEmailFromEnv(): EmailPort {
  return new SmtpEmailClient({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    ...(process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : {}),
  });
}
