// Connectivity smoke check for the dev compose stack.
// Proves the app can reach Postgres, MinIO and Mailhog. Exits non-zero on failure.
import pg from "pg";

const PG_URL = process.env.DATABASE_URL ?? "postgresql://blogs:blogs@localhost:5432/blogs";
const MINIO_HEALTH = process.env.MINIO_HEALTH_URL ?? "http://localhost:9000/minio/health/live";
const MAILHOG_API = process.env.MAILHOG_API_URL ?? "http://localhost:8025/api/v2/messages";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(name, fn, tries = 30, delayMs = 1000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await fn();
      console.log(`OK   ${name}`);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(delayMs);
    }
  }
  throw new Error(`FAIL ${name}: ${lastErr?.message ?? String(lastErr)}`);
}

async function checkPostgres() {
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const res = await client.query("select 1 as ok");
    if (res.rows[0]?.ok !== 1) throw new Error("unexpected query result");
  } finally {
    await client.end();
  }
}

async function checkHttp(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function main() {
  await retry("postgres", checkPostgres);
  await retry("minio   ", () => checkHttp(MINIO_HEALTH));
  await retry("mailhog ", () => checkHttp(MAILHOG_API));
  console.log("\nAll dev services reachable.");
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
