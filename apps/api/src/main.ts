import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DB, STORAGE } from "./platform/tokens";
import { createDb, type Db } from "./platform/db/client";
import { ensureSchema, ensureTenant, ensureAppRole, isRlsBypassed } from "./platform/db/bootstrap";
import { DEFAULT_TENANT_ID } from "./modules/tenancy";
import type { S3Storage } from "./modules/media";

function adminUrl(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgresql://blogs:blogs@localhost:5432/blogs"
  );
}

/**
 * Dev/E2E convenience: on a superuser/admin connection, migrate, seed the founder
 * tenant and provision the NOSUPERUSER app role; then ensure the bucket. The app
 * itself runs as the app role (DATABASE_URL) so RLS is enforced at runtime.
 */
async function autoBootstrap(app: Awaited<ReturnType<typeof NestFactory.create>>): Promise<void> {
  const { db: adminDb, pool: adminPool } = createDb(adminUrl());
  try {
    await ensureSchema(adminDb, resolve(__dirname, "../drizzle"));
    await ensureTenant(adminDb, process.env.FOUNDER_TENANT_ID ?? DEFAULT_TENANT_ID, "founder", "Founder");
    await ensureAppRole(adminDb, process.env.APP_DB_USER ?? "app_rw", process.env.APP_DB_PASSWORD ?? "app_rw");
  } finally {
    await adminPool.end();
  }

  await app.get<S3Storage>(STORAGE).ensureBucket();

  if (await isRlsBypassed(app.get<Db>(DB))) {
    console.warn(
      "[infra] runtime DB role bypasses RLS (superuser): set DATABASE_URL to a NOSUPERUSER role for real tenant isolation.",
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
