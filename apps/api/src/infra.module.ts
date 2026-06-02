import { Global, Module } from "@nestjs/common";
import { DB, STORAGE, LLM, EMAIL, EMAIL_DRAFT_SINK, PAYMENT, NOTIFICATION } from "./platform/tokens";
import { createDb, type Db } from "./platform/db/client";
import { createLlmFromEnv } from "./platform/ai/llm";
import { S3Storage } from "./modules/media";
import { createEmailFromEnv, makeEmailDraftSink, type EmailPort } from "./modules/email";
import { createPaymentFromEnv } from "./modules/commerce";
import { createNotificationFromEnv } from "./modules/crm";

function databaseUrl(): string {
  // Runtime connects as the least-privilege app role so RLS is enforced (DEBT-005).
  // Migrations/seed/role-provisioning use DATABASE_ADMIN_URL (see main.ts bootstrap).
  return process.env.DATABASE_URL ?? "postgresql://app_rw:app_rw@localhost:5432/blogs";
}

function storageConfig() {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minio",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minio12345",
    bucket: process.env.S3_BUCKET ?? "media",
    forcePathStyle: true,
  };
}

/** Base URL of the unsubscribe endpoint (per-subscriber token appended on send). */
function unsubscribeBaseUrl(): string {
  const root = (process.env.PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${root}/newsletter/unsubscribe`;
}

/**
 * Shared runtime adapters (DB/object-storage/LLM) built from env, exposed
 * globally as DI tokens so controllers compose the functional core without
 * each wiring its own infrastructure.
 */
@Global()
@Module({
  providers: [
    { provide: DB, useFactory: () => createDb(databaseUrl()).db },
    { provide: STORAGE, useFactory: () => new S3Storage(storageConfig()) },
    // TODO(debt): DEBT-023 — the live LLM token is still the platform key; the
    // per-tenant `ProviderRegistry` (+ `DbCredentialStore`) is not wired here
    // yet, so BYOK is inactive on the travel `generateDraft` path.
    { provide: LLM, useFactory: createLlmFromEnv },
    { provide: EMAIL, useFactory: createEmailFromEnv },
    // The `email_draft` gate sink, built from the shared DB + EMAIL adapters and
    // exposed as a token so the unified `/agent-proposals` controller can approve
    // an email draft without `modules/content` importing `modules/email`.
    {
      provide: EMAIL_DRAFT_SINK,
      useFactory: (db: Db, email: EmailPort) =>
        makeEmailDraftSink({ db, email, unsubscribeBaseUrl: unsubscribeBaseUrl() }),
      inject: [DB, EMAIL],
    },
    { provide: PAYMENT, useFactory: createPaymentFromEnv },
    { provide: NOTIFICATION, useFactory: createNotificationFromEnv },
  ],
  exports: [DB, STORAGE, LLM, EMAIL, EMAIL_DRAFT_SINK, PAYMENT, NOTIFICATION],
})
export class InfraModule {}
