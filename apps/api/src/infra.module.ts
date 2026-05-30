import { Global, Module } from "@nestjs/common";
import { DB, STORAGE, LLM } from "./platform/tokens";
import { createDb } from "./platform/db/client";
import { createLlmFromEnv } from "./platform/ai/llm";
import { S3Storage } from "./modules/media";

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://blogs:blogs@localhost:5432/blogs";
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
  ],
  exports: [DB, STORAGE, LLM],
})
export class InfraModule {}
