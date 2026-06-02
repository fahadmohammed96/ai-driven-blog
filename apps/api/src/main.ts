import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DB, STORAGE } from "./platform/tokens";
import { createDb, type Db } from "./platform/db/client";
import {
  ensureSchema,
  ensureTenant,
  ensureAppRole,
  ensurePgBoss,
  grantPgBossSchema,
  isRlsBypassed,
} from "./platform/db/bootstrap";
import { BatchWorker, AGENT_BATCH_QUEUE } from "./platform/ai/batch-worker";
import { DEFAULT_TENANT_ID } from "./modules/tenancy";
import type { S3Storage } from "./modules/media";

function adminUrl(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgresql://blogs:blogs@localhost:5432/blogs"
  );
}

/** Runtime (app_rw) connection — least-privilege, RLS-enforced (DEBT-005). */
function appUrl(): string {
  return process.env.DATABASE_URL ?? "postgresql://app_rw:app_rw@localhost:5432/blogs";
}

/**
 * Dev/E2E convenience: on a superuser/admin connection, migrate, seed the founder
 * tenant and provision the NOSUPERUSER app role; then ensure the bucket. The app
 * itself runs as the app role (DATABASE_URL) so RLS is enforced at runtime.
 */
async function autoBootstrap(app: Awaited<ReturnType<typeof NestFactory.create>>): Promise<void> {
  const role = process.env.APP_DB_USER ?? "app_rw";
  const { db: adminDb, pool: adminPool } = createDb(adminUrl());
  try {
    await ensureSchema(adminDb, resolve(__dirname, "../drizzle"));
    await ensureTenant(adminDb, process.env.FOUNDER_TENANT_ID ?? DEFAULT_TENANT_ID, "founder", "Founder");
    await ensureAppRole(adminDb, role, process.env.APP_DB_PASSWORD ?? "app_rw");
    // pg-boss schema + baseline queue are installed admin-side (DDL), then the
    // app role is granted DML-only on the pgboss schema (least-privilege, O0).
    await ensurePgBoss(adminUrl(), [{ name: AGENT_BATCH_QUEUE, options: { retryLimit: 2 } }]);
    await grantPgBossSchema(adminDb, role);
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

/**
 * Start the pg-boss batch worker (Slice O0) — FLAG-GATED, default OFF. e2e/dev
 * never set `WORKER_ENABLED`, so the async transport stays out of those flows
 * (the e2e gate remains isolated and green). The worker connects as the runtime
 * app role (DML only); the pgboss schema + queues were provisioned admin-side in
 * `autoBootstrap`. Concrete batch jobs/handlers (newsletter, SEO bulk, scheduled
 * analyst, Anthropic Batch API) are NOT wired here yet — they arrive with R2/O3
 * once a cross-module agent registry exists (DEBT-040); O0 lays the transport.
 */
async function startBatchWorker(
  app: Awaited<ReturnType<typeof NestFactory.create>>,
): Promise<void> {
  const worker = new BatchWorker({ connectionString: appUrl() });
  await worker.start();
  console.warn(
    "[infra] batch worker started (WORKER_ENABLED=1); no batch jobs registered yet (DEBT-040).",
  );
  const shutdown = async () => {
    try {
      await worker.stop();
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  if (process.env.DB_AUTO_MIGRATE === "1") await autoBootstrap(app);
  if (process.env.WORKER_ENABLED === "1") await startBatchWorker(app);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
