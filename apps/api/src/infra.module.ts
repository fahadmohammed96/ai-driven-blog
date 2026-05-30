import { Global, Module } from "@nestjs/common";
import { DB, STORAGE, LLM, EMAIL } from "./platform/tokens";
import { createDb } from "./platform/db/client";
import { createLlmFromEnv } from "./platform/ai/llm";
import { S3Storage } from "./modules/media";
import { createEmailFromEnv } from "./modules/email";

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
    { provide: LLM, useFactory: createLlmFromEnv },
    { provide: EMAIL, useFactory: createEmailFromEnv },
  ],
  exports: [DB, STORAGE, LLM, EMAIL],
})
export class InfraModule {}
