import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DB, STORAGE } from "./platform/tokens";
import type { Db } from "./platform/db/client";
import { ensureSchema, ensureTenant, isRlsBypassed } from "./platform/db/bootstrap";
import { DEFAULT_TENANT_ID } from "./modules/tenancy";
import type { S3Storage } from "./modules/media";

/** Dev/E2E convenience: migrate, seed the founder tenant, ensure the bucket. */
async function autoBootstrap(app: Awaited<ReturnType<typeof NestFactory.create>>): Promise<void> {
  const db = app.get<Db>(DB);
  const storage = app.get<S3Storage>(STORAGE);
  await ensureSchema(db, resolve(__dirname, "../drizzle"));
  await ensureTenant(db, process.env.FOUNDER_TENANT_ID ?? DEFAULT_TENANT_ID, "founder", "Founder");
  await storage.ensureBucket();
  // TODO(debt): DEBT-005 — the app connects as a DB superuser, so RLS is not
  // enforced at runtime (it IS in tests, via a NOSUPERUSER role). Harden at tenant #2.
  if (await isRlsBypassed(db)) {
    console.warn(
      "[infra] RLS bypassed (superuser connection): runtime tenant isolation is deferred to tenant #2 (ADR-0002).",
    );
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  if (process.env.DB_AUTO_MIGRATE === "1") await autoBootstrap(app);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
