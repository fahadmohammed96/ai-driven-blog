import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import type { PinterestPin } from "@blogs/contracts";
import { TokenBucket } from "./token-bucket";
import { OAuthSession, InMemoryCredentialStore, createHttpTokenEndpoint, type OAuthToken } from "./oauth";
import { PinterestConnector } from "./pinterest";
import { AuthError, RateLimitedError } from "./connector";

const here = dirname(fileURLToPath(import.meta.url));

// The OpenAPI document IS the contract: we derive request obligations from it
// (required body props + bearer security), so the server isn't a hand-made mock.
// TODO(debt): DEBT-006 — this validates the `required` fields + security from the
// spec, not the full schema (no Prism/openapi-backend runtime). Upgrade at the 2nd connector.
const SPEC = JSON.parse(readFileSync(join(here, "pinterest.openapi.json"), "utf8")) as Spec;

interface Spec {
  paths: Record<
    string,
    {
      post: {
        security?: unknown[];
        requestBody: { content: { "application/json": { schema: { required: string[] } } } };
      };
    }
  >;
}

function requiredBody(path: string): string[] {
  return SPEC.paths[path]!.post.requestBody.content["application/json"].schema.required;
}
function needsBearer(path: string): boolean {
  return Array.isArray(SPEC.paths[path]!.post.security);
}

const PIN: PinterestPin = {
  channel: "pinterest",
  title: "Una settimana in Giappone",
  description: "Tokyo e Kyoto in sette giorni",
  imageAssetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

/** A server that enforces the OpenAPI contract and behaves like the channel. */
function startContractServer(opts: { pinLimit?: number } = {}): Promise<{
  url: string;
  addValidAccessToken: (t: string) => void;
  close: () => Promise<void>;
}> {
  const pinLimit = opts.pinLimit ?? Number.POSITIVE_INFINITY;
  const validRefresh = new Set<string>(["rt-1"]);
  const validAccess = new Set<string>();
  let issued = 0;
  let pinsCreated = 0;

  const readJson = (req: Parameters<Parameters<typeof createServer>[1]>[0]): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
    });

  const server: Server = createServer(async (req, res) => {
    const send = (code: number, body?: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(body ? JSON.stringify(body) : "");
    };
    const body = await readJson(req);
    const missing = (path: string) => requiredBody(path).filter((k) => !(k in body));

    if (req.url === "/oauth/token" && req.method === "POST") {
      if (missing("/oauth/token").length) return send(400);
      if (!validRefresh.has(String(body.refresh_token))) return send(401);
      issued += 1;
      const access = `at-${issued}`;
      const refresh = `rt-next-${issued}`;
      validAccess.add(access);
      validRefresh.add(refresh);
      return send(200, { access_token: access, refresh_token: refresh, expires_in: 3600 });
    }

    if (req.url === "/pins" && req.method === "POST") {
      if (needsBearer("/pins")) {
        const auth = req.headers.authorization ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!validAccess.has(token)) return send(401);
      }
      if (missing("/pins").length) return send(400);
      if (pinsCreated >= pinLimit) return send(429);
      pinsCreated += 1;
      return send(201, { id: `pin-${pinsCreated}` });
    }
    return send(404);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        addValidAccessToken: (t) => validAccess.add(t),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function connect(
  url: string,
  seed: OAuthToken,
  store: InMemoryCredentialStore,
  bucket = new TokenBucket({ capacity: 100, refillPerSec: 0 }),
): PinterestConnector {
  void store.save("tenant-a", "pinterest", seed);
  const session = new OAuthSession({
    store,
    endpoint: createHttpTokenEndpoint(`${url}/oauth/token`),
    tenantId: "tenant-a",
    connector: "pinterest",
  });
  return new PinterestConnector({ session, bucket }, { apiBaseUrl: url, boardId: "board-1" });
}

describe("PinterestConnector contract", () => {
  it("publishes a pin, refreshing an expired access token first (201)", async () => {
    const srv = await startContractServer();
    const connector = connect(
      srv.url,
      { accessToken: "seed-expired", refreshToken: "rt-1", expiresAt: 0 },
      new InMemoryCredentialStore(),
    );
    const pin = await connector.publishPin(PIN);
    expect(pin.id).toMatch(/^pin-/);
    await srv.close();
  });

  it("refreshes once and retries when the channel rejects the token with 401", async () => {
    const srv = await startContractServer();
    const connector = connect(
      srv.url,
      { accessToken: "stale-but-not-expired", refreshToken: "rt-1", expiresAt: Date.now() + 3_600_000 },
      new InMemoryCredentialStore(),
    );
    const pin = await connector.publishPin(PIN);
    expect(pin.id).toMatch(/^pin-/);
    await srv.close();
  });

  it("raises AuthError when the refresh token is unknown", async () => {
    const srv = await startContractServer();
    const connector = connect(
      srv.url,
      { accessToken: "x", refreshToken: "rt-unknown", expiresAt: 0 },
      new InMemoryCredentialStore(),
    );
    await expect(connector.publishPin(PIN)).rejects.toBeInstanceOf(AuthError);
    await srv.close();
  });

  it("enforces the client-side rate limit before calling the channel", async () => {
    const srv = await startContractServer();
    const store = new InMemoryCredentialStore();
    srv.addValidAccessToken("good-token");
    const connector = connect(
      srv.url,
      { accessToken: "good-token", refreshToken: "rt-1", expiresAt: Date.now() + 3_600_000 },
      store,
      new TokenBucket({ capacity: 1, refillPerSec: 0 }),
    );
    expect((await connector.publishPin(PIN)).id).toMatch(/^pin-/);
    await expect(connector.publishPin(PIN)).rejects.toBeInstanceOf(RateLimitedError);
    await srv.close();
  });

  it("maps a documented 429 from the channel to RateLimitedError", async () => {
    const srv = await startContractServer({ pinLimit: 1 });
    const store = new InMemoryCredentialStore();
    srv.addValidAccessToken("good-token");
    const connector = connect(
      srv.url,
      { accessToken: "good-token", refreshToken: "rt-1", expiresAt: Date.now() + 3_600_000 },
      store,
    );
    expect((await connector.publishPin(PIN)).id).toMatch(/^pin-/);
    await expect(connector.publishPin(PIN)).rejects.toBeInstanceOf(RateLimitedError);
    await srv.close();
  });
});
